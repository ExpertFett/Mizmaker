import { useEffect, useRef, useCallback } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import XYZ from 'ol/source/XYZ';
import { fromLonLat, toLonLat } from 'ol/proj';
import { boundingExtent } from 'ol/extent';
import { defaults as defaultControls } from 'ol/control';
import ScaleLine from 'ol/control/ScaleLine';
import { defaults as defaultInteractions } from 'ol/interaction';
import type { Draw } from 'ol/interaction';
import type VectorLayer from 'ol/layer/Vector';
import 'ol/ol.css';

import { useMissionStore } from '../store/missionStore';
import { useMapStore } from '../store/mapStore';
import { createUnitLayer, populateUnitLayer } from './layers/unitLayer';
import { createRouteLayer, populateRouteLayer } from './layers/routeLayer';
import { createThreatLayer, populateThreatLayer } from './layers/threatLayer';
import { createAirbaseLayer, populateAirbaseLayer } from './layers/airbaseLayer';
import { createBullseyeLayer, populateBullseyeLayer } from './layers/bullseyeLayer';
import { createDrawingLayer, populateDrawingLayer } from './layers/drawingLayer';
import { createTriggerZoneLayer, populateTriggerZoneLayer } from './layers/triggerZoneLayer';
import { createPlannerDrawingLayer, populatePlannerDrawingLayer } from './layers/plannerDrawingLayer';
import { useDrawingStore } from '../store/drawingStore';
import { useDmpiStore } from '../store/dmpiStore';
import { latLonToDcs } from '../projection/dcsProjection';
import { formatLatLon, metersToFeet } from '../utils/conversions';
import { haversineDistance, bearing } from '../utils/navmath';
import { getElevation } from '../utils/elevation';
import { sessionEdit } from '../api/client';
import { forward as toMGRS } from 'mgrs';
// Terrain-rgb tile layers removed — elevation is fully self-hosted via backend SRTM
import { setupWaypointDrag } from './interactions/waypointDrag';
import { isPlayerGroup } from '../utils/groups';
import { createWaypointAdd } from './interactions/waypointAdd';
import { createMeasureTool } from './interactions/measureTool';
import { LayerSwitcher } from './controls/LayerSwitcher';

import { WeatherPanel } from './controls/WeatherPanel';

const THEATER_CENTERS: Record<string, [number, number]> = {
  Caucasus: [43.5, 41.0],
  Syria: [37.0, 35.0],
  PersianGulf: [56.0, 26.0],
  Nevada: [-115.8, 36.2],
  SinaiMap: [33.0, 30.0],
  Normandy: [-0.6, 49.2],
  TheChannel: [2.3, 51.0],
  MarianaIslands: [145.0, 15.0],
  Falklands: [-59.0, -51.5],
  Kola: [33.0, 69.0],
  Afghanistan: [65.0, 34.0],
  Iraq: [44.0, 33.0],
  TopEndAustralia: [131.0, -12.5],
  SouthEastAsia: [106.0, 14.0],
  GermanyCW: [11.0, 51.0],
};

// Tile layer factories
function createDarkLayer(): TileLayer {
  // Use `dark_all` (not `dark_nolabels`) so city/town/country labels are
  // visible by default — previously the map was label-free, which hid
  // towns entirely. Airfields come from our own airbase overlay layer.
  return new TileLayer({
    source: new XYZ({
      url: 'https://{a-d}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      maxZoom: 20,
      attributions: '&copy; CARTO',
    }),
    properties: { name: 'dark' },
    visible: true, // default
  });
}

function createOsmLayer(lang: string = 'en'): TileLayer {
  const source = lang === 'local'
    ? new OSM()
    : new XYZ({
        url: `https://{a-d}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png`,
        maxZoom: 20,
        attributions: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
      });
  return new TileLayer({ source, properties: { name: 'osm' }, visible: false });
}

function createSatelliteLayer(): TileLayer {
  return new TileLayer({
    source: new XYZ({
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      maxZoom: 19,
      attributions: 'Tiles &copy; Esri',
    }),
    properties: { name: 'satellite' },
    visible: false,
  });
}

function createTopoLayer(): TileLayer {
  return new TileLayer({
    source: new XYZ({
      url: 'https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png',
      maxZoom: 17,
      attributions: 'Map data: OpenTopoMap (CC-BY-SA)',
    }),
    properties: { name: 'topo' },
    visible: false,
  });
}

interface MapContainerProps {
  /** Called after the user clicks on the map while in DMPI pick mode.
   *  Editor uses this to flip back to the DMPI tab. Optional — when
   *  unset, picking still completes and writes coordinates, the user
   *  just stays on the map. */
  onDmpiPicked?: () => void;
}

export function MapContainer({ onDmpiPicked }: MapContainerProps = {}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<Map | null>(null);
  const baseLayers = useRef<{ dark: TileLayer; osm: TileLayer; satellite: TileLayer; topo: TileLayer } | null>(null);
  const layerRefs = useRef<{
    unit: ReturnType<typeof createUnitLayer> | null;
    route: ReturnType<typeof createRouteLayer> | null;
    threat: ReturnType<typeof createThreatLayer> | null;
    airbase: ReturnType<typeof createAirbaseLayer> | null;
    bullseye: ReturnType<typeof createBullseyeLayer> | null;
    drawing: ReturnType<typeof createDrawingLayer> | null;
    triggerZone: ReturnType<typeof createTriggerZoneLayer> | null;
    plannerDrawing: ReturnType<typeof createPlannerDrawingLayer> | null;
  }>({ unit: null, route: null, threat: null, airbase: null, bullseye: null, drawing: null, triggerZone: null, plannerDrawing: null });
  const dragCleanup = useRef<(() => void) | null>(null);
  const isInteracting = useRef(false); // true during drag or add — blocks route layer redraws
  const pendingRedraw = useRef(false); // set when a redraw was skipped during interaction
  const interactionRefs = useRef<{
    addDraw: Draw | null;
    measureDraw: Draw | null;
    measureLayer: VectorLayer | null;
  }>({ addDraw: null, measureDraw: null, measureLayer: null });
  const coordRef = useRef<HTMLDivElement>(null);
  const { theater, units, groups, threats, airbases, drawings, triggerZones, selectedGroupId, selectGroup, overview } =
    useMissionStore();
  const { layers, viewMode, hiddenGroupIds, addWaypointMode, measureMode, setSelectedWpIndex } = useMapStore();

  // Helper: update a specific group's waypoints from server response
  const _updateGroupWaypoints = useCallback((groupName: string, waypoints: any[]) => {
    const { groups } = useMissionStore.getState();
    const updated = groups.map((g) =>
      g.groupName === groupName ? { ...g, waypoints } : g,
    );
    useMissionStore.getState().setGroups(updated);
  }, []);

  // Handle waypoint drag start — block route layer redraws during drag
  const handleDragStart = useCallback(() => {
    isInteracting.current = true;
    pendingRedraw.current = false;
  }, []);

  // Handle waypoint drag end — server-authoritative
  const handleDragEnd = useCallback(
    async (groupId: number, wpIndex: number, lat: number, lon: number) => {
      isInteracting.current = false;
      const { x, y } = latLonToDcs(lat, lon);
      const { groups, sessionId: sid, sessionToken } = useMissionStore.getState();
      const group = groups.find((g) => g.groupId === groupId);
      if (!group || !sid) return;

      // Optimistic local update for instant feedback
      const updatedGroups = groups.map((g) => {
        if (g.groupId !== groupId) return g;
        const newWps = g.waypoints.map((wp) => {
          if (wp.waypoint_number !== wpIndex) return wp;
          return { ...wp, x, y, lat, lon };
        });
        for (let i = 1; i < newWps.length; i++) {
          const prev = newWps[i - 1];
          const curr = newWps[i];
          if (prev.lat && prev.lon && curr.lat && curr.lon) {
            const dist = haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon);
            const brg = bearing(prev.lat, prev.lon, curr.lat, curr.lon);
            curr.leg_distance_nm = dist / 1852;
            curr.leg_bearing_deg = brg;
            const legSpeed = newWps[i - 1].speed_ms || curr.speed_ms;
            curr.cumulative_eta = (newWps[i - 1].cumulative_eta || 0) + (legSpeed > 0 ? dist / legSpeed : 0);
          }
        }
        return { ...g, waypoints: newWps };
      });
      useMissionStore.getState().setGroups(updatedGroups);

      // POST to server — server is source of truth
      try {
        const result = await sessionEdit(sid, {
          groupName: group.groupName,
          action: 'move',
          wpIndex,
          data: { x, y, lat, lon },
        }, sessionToken || undefined);
        // Update store from server response (authoritative)
        if (result.ok) {
          _updateGroupWaypoints(result.groupName, result.waypoints);
        }
      } catch (e) {
        console.error('Server edit failed:', e);
      }
    },
    [],
  );

  // Handle waypoint add — server-authoritative
  const handleAddWaypoint = useCallback(
    async (lat: number, lon: number) => {
      const { groups, sessionId: sid, sessionToken, selectedGroupId: selId, assignedGroup } = useMissionStore.getState();
      if (!selId) return;
      const { x, y } = latLonToDcs(lat, lon);
      const group = groups.find((g) => g.groupId === selId);
      if (!group || !sid) return;
      // Flight leads can only add waypoints to their assigned group
      if (assignedGroup && group.groupName !== assignedGroup) return;

      const prevWp = group.waypoints[group.waypoints.length - 1];
      const newWp = {
        waypoint_number: group.waypoints.length,
        waypoint_name: `WP${group.waypoints.length}`,
        waypoint_type: 'Turning Point',
        waypoint_action: 'Turning Point',
        x, y, lat, lon,
        altitude_m: 6096,
        altitude_type: 'BARO' as const,
        speed_ms: prevWp?.speed_ms || 200,
        eta_seconds: 0,
        eta_locked: false,
        speed_locked: true,
      };

      // Optimistic local update
      const updatedGroups = groups.map((g) => {
        if (g.groupId !== selId) return g;
        return { ...g, waypoints: [...g.waypoints, newWp] };
      });
      useMissionStore.getState().setGroups(updatedGroups);

      // POST to server
      try {
        const result = await sessionEdit(sid, {
          groupName: group.groupName,
          action: 'add',
          data: { waypoint: newWp },
        }, sessionToken || undefined);
        if (result.ok) {
          _updateGroupWaypoints(result.groupName, result.waypoints);
        }
      } catch (e) {
        console.error('Server add failed:', e);
      }
    },
    [_updateGroupWaypoints],
  );

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return;

    const darkLayer = createDarkLayer();
    const initLang = useMapStore.getState().layers.mapLang || 'en';
    const osmLayer = createOsmLayer(initLang);
    const satLayer = createSatelliteLayer();
    const topoLayer = createTopoLayer();
    baseLayers.current = { dark: darkLayer, osm: osmLayer, satellite: satLayer, topo: topoLayer };

    const unitLayer = createUnitLayer();
    const routeLayer = createRouteLayer();
    const threatLayer = createThreatLayer();
    const airbaseLayer = createAirbaseLayer();
    const bullseyeLayer = createBullseyeLayer();
    const drawingLayer = createDrawingLayer();
    const triggerZoneLayer = createTriggerZoneLayer();
    const plannerDrawingLayer = createPlannerDrawingLayer();
    layerRefs.current = { unit: unitLayer, route: routeLayer, threat: threatLayer, airbase: airbaseLayer, bullseye: bullseyeLayer, drawing: drawingLayer, triggerZone: triggerZoneLayer, plannerDrawing: plannerDrawingLayer };

    // Compute initial center from mission data already in store (avoids Caucasus flash on tab-switch remounts)
    const initStore = useMissionStore.getState();
    const initVisibleGrps = initStore.role === 'flight_lead'
      ? initStore.groups.filter((g) => g.coalition === 'blue')
      : initStore.groups;
    const initCoords: [number, number][] = [];
    for (const g of initVisibleGrps) {
      for (const wp of g.waypoints) {
        if (wp.lat && wp.lon) initCoords.push([wp.lon, wp.lat]);
      }
    }
    let initialCenter: [number, number] = [44, 41];
    let initialZoom = 7;
    if (initCoords.length > 0) {
      const lons = initCoords.map((c) => c[0]);
      const lats = initCoords.map((c) => c[1]);
      initialCenter = [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2];
    } else if (initStore.theater && THEATER_CENTERS[initStore.theater]) {
      initialCenter = THEATER_CENTERS[initStore.theater];
    }

    const map = new Map({
      target: mapRef.current,
      layers: [
        darkLayer, osmLayer, satLayer, topoLayer,
        drawingLayer, triggerZoneLayer, plannerDrawingLayer, threatLayer, airbaseLayer, bullseyeLayer, routeLayer, unitLayer,
      ],
      interactions: defaultInteractions({ doubleClickZoom: false }),
      view: new View({
        center: fromLonLat(initialCenter),
        zoom: initialZoom,
        maxZoom: 19,
        minZoom: 3,
      }),
      controls: defaultControls().extend([
        new ScaleLine({ units: 'nautical' }),
      ]),
    });

    // If mission data is already loaded, fit to extent now (eliminates any visible flash)
    if (initCoords.length > 1) {
      const lons = initCoords.map((c) => c[0]);
      const lats = initCoords.map((c) => c[1]);
      const extent = boundingExtent([
        fromLonLat([Math.min(...lons), Math.min(...lats)]),
        fromLonLat([Math.max(...lons), Math.max(...lats)]),
      ]);
      map.getView().fit(extent, { padding: [60, 60, 60, 60], maxZoom: 12 });
      hasFitted.current = true;
    }

    // Click to select group — or open waypoint popup if clicking a waypoint
    map.on('click', (e) => {
      const { addWaypointMode, measureMode } = useMapStore.getState();
      if (addWaypointMode || measureMode) return;

      // DMPI placement mode — when armed from the DMPI tab, the next
      // click captures coords into the targeted DMPI and triggers the
      // editor to flip back. Runs BEFORE feature-hit detection so a
      // click that lands on a unit / waypoint still goes to the DMPI
      // (the user wanted those coordinates, not to select the unit).
      const { pickingForId, finishPicking } = useDmpiStore.getState();
      if (pickingForId) {
        const [lon, lat] = toLonLat(e.coordinate);
        finishPicking(lat, lon);
        onDmpiPicked?.();
        return;
      }

      // Collect all features at click point
      const hits: any[] = [];
      map.forEachFeatureAtPixel(e.pixel, (f) => { hits.push(f); }, { hitTolerance: 10 });

      // Prioritize waypoint hits
      const wpHit = hits.find((f) => f.get('featureType') === 'waypoint' && f.get('wpIndex') > 0);
      if (wpHit) {
        const gid = wpHit.get('groupId');
        const wpi = wpHit.get('wpIndex');
        selectGroup(gid);
        setSelectedWpIndex(wpi);
        return;
      }

      // Then check for unit or route hits
      const groupHit = hits.find((f) => f.get('groupId') != null);
      if (groupHit) {
        selectGroup(groupHit.get('groupId'));
        setSelectedWpIndex(null);
        return;
      }

      // Clicked empty space — deselect waypoint
      setSelectedWpIndex(null);
    });

    // Double-click to edit waypoint (keep for compatibility)
    map.on('dblclick', (e) => {
      const hits: any[] = [];
      map.forEachFeatureAtPixel(e.pixel, (f) => { hits.push(f); }, { hitTolerance: 10 });
      const hit = hits.find((f) => f.get('featureType') === 'waypoint' && f.get('wpIndex') > 0);
      if (hit) {
        e.preventDefault();
        e.stopPropagation();
        selectGroup(hit.get('groupId'));
        setSelectedWpIndex(hit.get('wpIndex'));
      }
    });

    // Coordinate display + hover tooltip for units/routes
    let lastElevStr = '';
    map.on('pointermove', (e) => {
      if (!coordRef.current) return;
      const [lon, lat] = toLonLat(e.coordinate);

      const llStr = formatLatLon(lat, lon);

      let mgrsStr = '';
      try { mgrsStr = toMGRS([lon, lat], 5); } catch { mgrsStr = '—'; }

      let dcsStr = '';
      try {
        const { x, y } = latLonToDcs(lat, lon);
        dcsStr = `x:${Math.round(x)} y:${Math.round(y)}`;
      } catch { /* no theater set */ }

      // Elevation from local SRTM data via backend (no external APIs)
      getElevation(lat, lon, (elev) => {
        if (elev !== null) {
          lastElevStr = `${Math.round(elev)}m / ${Math.round(metersToFeet(elev))}ft`;
          updateCoordDisplay();
        }
      });

      function updateCoordDisplay() {
        if (!coordRef.current) return;
        coordRef.current.innerHTML =
          `<span style="color:#e0e0e0">${llStr}</span>` +
          `<br/><span style="color:#d29922">${mgrsStr}</span>` +
          (dcsStr ? `<br/><span style="color:#aaaaaa">${dcsStr}</span>` : '') +
          (lastElevStr ? `<br/><span style="color:#3fb950">Elev: ${lastElevStr}</span>` : '');
      }
      updateCoordDisplay();

      // Tooltip — only for units and route lines, NOT waypoints (waypoints use the edit popup)
      const tooltip = document.getElementById('map-tooltip');
      if (!tooltip) return;

      const hit = map.forEachFeatureAtPixel(e.pixel, (f) => f, { hitTolerance: 14 });
      if (hit) {
        const unit = hit.get('unit');
        const groupName = hit.get('groupName');
        const wp = hit.get('waypoint');

        if (unit) {
          const coalColor = unit.coalition === 'blue' ? '#4a8fd4' : unit.coalition === 'red' ? '#d95050' : '#cccccc';
          const header = `<b style="color:${coalColor}">${unit.name}</b>`;
          const meta = `<span style="color:#aaaaaa">${unit.coalition} &middot; ${unit.country}${unit.task ? ' &middot; ' + unit.task : ''}</span>`;

          let roster = '';
          if (unit.unitList && unit.unitList.length > 0) {
            const lines = unit.unitList.map((u: any) => {
              const skill = u.skill === 'Client' || u.skill === 'Player'
                ? '<span style="color:#3fb950">Player</span>'
                : `<span style="color:#aaaaaa">${u.skill || ''}</span>`;
              return `<div style="padding:1px 0">${u.name} <span style="color:#aaaaaa">${u.type}</span> ${skill}</div>`;
            });
            roster = `<div style="margin-top:4px;border-top:1px solid #3a3a3a;padding-top:4px;max-height:200px;overflow:auto">${lines.join('')}</div>`;
          }

          tooltip.innerHTML = header + '<br/>' + meta + roster;
          tooltip.style.display = 'block';
        } else if (wp) {
          // Waypoints don't show a hover tooltip — click opens the edit popup instead
          tooltip.style.display = 'none';
        } else if (groupName && hit.get('featureType') === 'route') {
          tooltip.innerHTML = `<b>${groupName}</b>`;
          tooltip.style.display = 'block';
        } else {
          tooltip.style.display = 'none';
        }

        if (tooltip.style.display === 'block') {

          tooltip.style.left = `${e.pixel[0] + 14}px`;
          tooltip.style.top = `${e.pixel[1] - 8}px`;
        }
      } else {
        tooltip.style.display = 'none';
      }
    });

    // Right-click to deselect group
    map.getViewport().addEventListener('contextmenu', (e) => {
      e.preventDefault();
      useMissionStore.getState().selectGroup(null as any);
      useMapStore.getState().setSelectedWpIndex(null);
    });

    // Esc key to cancel modes
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        useMapStore.getState().setAddWaypointMode(false);
        useMapStore.getState().setMeasureMode(false);
        useMapStore.getState().setSelectedWpIndex(null);
      }
    };
    document.addEventListener('keydown', onKeyDown);

    mapInstance.current = map;

    return () => {
      map.setTarget(undefined);
      mapInstance.current = null;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  // Setup waypoint drag (raw pointer events — no OL interaction conflicts)
  useEffect(() => {
    const map = mapInstance.current;
    const route = layerRefs.current.route;
    if (!map || !route) return;

    // Clean up previous drag listeners
    if (dragCleanup.current) {
      dragCleanup.current();
      dragCleanup.current = null;
    }

    // Don't enable drag in add-waypoint or measure modes
    if (addWaypointMode || measureMode) return;

    const isEditLocked = (groupId: number): boolean => {
      const { adminMode: am } = useMapStore.getState();
      const { assignedGroup, groups } = useMissionStore.getState();
      const g = groups.find((gr) => gr.groupId === groupId);
      if (!g) return true;
      // Admin lock for non-player AI groups
      if (am && !isPlayerGroup(g)) return true;
      // Collaborative: if assigned to a specific group, lock all others
      if (assignedGroup && g.groupName !== assignedGroup) return true;
      return false;
    };
    dragCleanup.current = setupWaypointDrag(map, route, { onDragEnd: handleDragEnd, onDragStart: handleDragStart, isEditLocked });

    return () => {
      if (dragCleanup.current) {
        dragCleanup.current();
        dragCleanup.current = null;
      }
    };
  }, [handleDragEnd, handleDragStart, addWaypointMode, measureMode, groups, selectedGroupId, viewMode]);

  // Add waypoint mode toggle
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    if (interactionRefs.current.addDraw) {
      map.removeInteraction(interactionRefs.current.addDraw);
      interactionRefs.current.addDraw = null;
    }

    if (addWaypointMode) {
      const draw = createWaypointAdd(map, { onAdd: handleAddWaypoint });
      map.addInteraction(draw);
      interactionRefs.current.addDraw = draw;
    }
  }, [addWaypointMode, handleAddWaypoint]);

  // Measure mode toggle
  useEffect(() => {
    const map = mapInstance.current;
    if (!map) return;

    if (interactionRefs.current.measureDraw) {
      map.removeInteraction(interactionRefs.current.measureDraw);
      interactionRefs.current.measureDraw = null;
    }
    if (interactionRefs.current.measureLayer) {
      map.removeLayer(interactionRefs.current.measureLayer);
      interactionRefs.current.measureLayer = null;
    }

    if (measureMode) {
      const { draw, layer } = createMeasureTool(map);
      map.addLayer(layer);
      map.addInteraction(draw);
      interactionRefs.current.measureDraw = draw;
      interactionRefs.current.measureLayer = layer;
    }
  }, [measureMode]);

  // Planner drawings — auto-generated from mission data
  const plannerDrawings = useDrawingStore((s) => s.drawings);


  // Populate planner drawing layer
  useEffect(() => {
    if (layerRefs.current.plannerDrawing) {
      populatePlannerDrawingLayer(layerRefs.current.plannerDrawing, plannerDrawings);
    }
  }, [plannerDrawings]);

  // Fit map to content on initial load only
  const hasFitted = useRef(false);
  const role = useMissionStore((s) => s.role);
  useEffect(() => {
    if (!mapInstance.current || !theater || hasFitted.current) return;
    if (groups.length === 0) return; // wait for data

    // Collect all waypoint coords from visible groups
    const coords: [number, number][] = [];
    const visibleGrps = role === 'flight_lead' ? groups.filter((g) => g.coalition === 'blue') : groups;
    for (const g of visibleGrps) {
      for (const wp of g.waypoints) {
        if (wp.lat && wp.lon) coords.push([wp.lon, wp.lat]);
      }
    }

    if (coords.length > 1) {
      // Fit to waypoint extent
      const lons = coords.map((c) => c[0]);
      const lats = coords.map((c) => c[1]);
      const extent = boundingExtent([
        fromLonLat([Math.min(...lons), Math.min(...lats)]),
        fromLonLat([Math.max(...lons), Math.max(...lats)]),
      ]);
      mapInstance.current.getView().fit(extent, { padding: [60, 60, 60, 60], maxZoom: 12 });
    } else {
      // Fallback to theater center
      const center = THEATER_CENTERS[theater];
      if (center) {
        mapInstance.current.getView().setCenter(fromLonLat(center));
        mapInstance.current.getView().setZoom(7);
      }
    }
    hasFitted.current = true;
  }, [theater, groups, role]);

  // Filter data for flight leads — blue only
  const isFlightLead = role === 'flight_lead';
  const visibleUnits = isFlightLead ? units.filter((u) => u.coalition === 'blue') : units;
  const visibleGroups = isFlightLead ? groups.filter((g) => g.coalition === 'blue') : groups;
  const visibleThreats = isFlightLead ? [] : threats;

  // Populate layers (re-filter when viewMode changes)
  useEffect(() => {
    if (layerRefs.current.unit) populateUnitLayer(layerRefs.current.unit, visibleUnits, visibleGroups, viewMode, hiddenGroupIds, !!layers.statics);
  }, [visibleUnits, visibleGroups, viewMode, hiddenGroupIds, layers.statics]);

  useEffect(() => {
    if (!layerRefs.current.route) return;
    // Skip route layer rebuild during active drag/add — would destroy the feature being interacted with
    if (isInteracting.current) {
      pendingRedraw.current = true;
      return;
    }
    populateRouteLayer(layerRefs.current.route, visibleGroups, selectedGroupId, viewMode, hiddenGroupIds);
    pendingRedraw.current = false;
  }, [visibleGroups, selectedGroupId, viewMode, hiddenGroupIds]);

  useEffect(() => {
    if (layerRefs.current.threat) populateThreatLayer(layerRefs.current.threat, visibleThreats, viewMode);
  }, [visibleThreats, viewMode]);

  useEffect(() => {
    if (layerRefs.current.airbase) populateAirbaseLayer(layerRefs.current.airbase, airbases);
  }, [airbases]);

  useEffect(() => {
    if (layerRefs.current.bullseye) populateBullseyeLayer(layerRefs.current.bullseye, overview?.bullseye);
  }, [overview?.bullseye]);

  useEffect(() => {
    if (layerRefs.current.drawing) populateDrawingLayer(layerRefs.current.drawing, drawings);
  }, [drawings]);

  useEffect(() => {
    if (layerRefs.current.triggerZone) populateTriggerZoneLayer(layerRefs.current.triggerZone, triggerZones, !!layers.triggerZones);
  }, [triggerZones, layers.triggerZones]);

  // Toggle overlay layer visibility
  useEffect(() => {
    if (layerRefs.current.unit) layerRefs.current.unit.setVisible(layers.units);
    if (layerRefs.current.route) layerRefs.current.route.setVisible(layers.routes);
    if (layerRefs.current.threat) layerRefs.current.threat.setVisible(layers.threats);
    if (layerRefs.current.airbase) layerRefs.current.airbase.setVisible(layers.airbases);
    if (layerRefs.current.bullseye) layerRefs.current.bullseye.setVisible(layers.bullseye !== false);
    if (layerRefs.current.drawing) layerRefs.current.drawing.setVisible(layers.drawings !== false);
    if (layerRefs.current.plannerDrawing) layerRefs.current.plannerDrawing.setVisible(layers.plannerDrawings !== false);
  }, [layers]);

  // Toggle base map
  useEffect(() => {
    if (!baseLayers.current) return;
    const bm = layers.baseMap || 'dark';
    baseLayers.current.dark.setVisible(bm === 'dark');
    baseLayers.current.osm.setVisible(bm === 'osm');
    baseLayers.current.satellite.setVisible(bm === 'satellite');
    baseLayers.current.topo.setVisible(bm === 'topo');
  }, [layers]);

  // Switch street map language (swap OSM layer source)
  useEffect(() => {
    if (!baseLayers.current || !mapInstance.current) return;
    const lang = layers.mapLang || 'en';
    const oldOsm = baseLayers.current.osm;
    const wasVisible = oldOsm.getVisible();
    const newOsm = createOsmLayer(lang);
    newOsm.setVisible(wasVisible);
    mapInstance.current.getLayers().insertAt(1, newOsm); // osm is 2nd base layer
    mapInstance.current.removeLayer(oldOsm);
    baseLayers.current.osm = newOsm;
  }, [layers.mapLang]);

  // Fit to selected group
  useEffect(() => {
    if (!baseLayers.current || !mapInstance.current) return;
    const lang = layers.mapLang || 'en';
    const oldOsm = baseLayers.current.osm;
    const wasVisible = oldOsm.getVisible();
    const newOsm = createOsmLayer(lang);
    newOsm.setVisible(wasVisible);
    mapInstance.current.getLayers().insertAt(1, newOsm);
    mapInstance.current.removeLayer(oldOsm);
    baseLayers.current.osm = newOsm;
  }, [layers.mapLang]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%', position: 'relative', zIndex: 0 }} />
      <WeatherPanel coordRef={coordRef} />
      <LayerSwitcher />

      {/* Instructional overlays */}
      {addWaypointMode && (
        <div style={{
          position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(63, 185, 80, 0.15)', border: '1px solid #3fb950', borderRadius: 6,
          padding: '8px 20px', color: '#3fb950', fontSize: 13, fontWeight: 500, zIndex: 200,
          pointerEvents: 'none',
        }}>
          Click map to place waypoint &middot; Right-click anytime &middot; Esc to cancel
        </div>
      )}
      {measureMode && (
        <div style={{
          position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(210, 153, 34, 0.15)', border: '1px solid #d29922', borderRadius: 6,
          padding: '8px 20px', color: '#d29922', fontSize: 13, fontWeight: 500, zIndex: 200,
          pointerEvents: 'none',
        }}>
          Click to measure &middot; Double-click to finish &middot; Esc to cancel
        </div>
      )}
      <DmpiPickBanner />

      <div
        id="map-tooltip"
        style={{
          display: 'none',
          position: 'absolute',
          background: 'rgba(10, 20, 35, 0.95)',
          border: '1px solid #4a4a4a',
          borderRadius: 5,
          padding: '8px 12px',
          fontSize: 12,
          color: '#e0e0e0',
          pointerEvents: 'none',
          zIndex: 150,
          maxWidth: 380,
          whiteSpace: 'nowrap',
        }}
      />
    </div>
  );
}

/** Top-of-map banner shown when a DMPI is armed for click-to-place.
 *  Lives below MapContainer; reads pickingForId / dmpis from the
 *  store so it's a self-contained widget with no props. */
function DmpiPickBanner() {
  const pickingForId = useDmpiStore((s) => s.pickingForId);
  const dmpi = useDmpiStore((s) => {
    if (!s.pickingForId) return null;
    return s.dmpis.find((d) => d.id === s.pickingForId) ?? null;
  });
  const cancel = useDmpiStore((s) => s.cancelPicking);
  if (!pickingForId) return null;
  return (
    <div style={{
      position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(74, 143, 212, 0.15)', border: '1px solid #4a8fd4', borderRadius: 6,
      padding: '8px 20px', color: '#4a8fd4', fontSize: 13, fontWeight: 500, zIndex: 200,
      display: 'flex', alignItems: 'center', gap: 14,
    }}>
      <span>📍 Click anywhere to set coordinates for <strong>{dmpi?.name ?? '—'}</strong></span>
      <button
        onClick={cancel}
        style={{
          background: '#262626', border: '1px solid #3a3a3a', borderRadius: 3,
          color: '#aaaaaa', cursor: 'pointer', fontSize: 12, padding: '3px 10px',
          fontFamily: 'inherit',
        }}
      >
        Cancel
      </button>
    </div>
  );
}
