import { useEffect, useRef, useCallback, useState } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import XYZ from 'ol/source/XYZ';
import { fromLonLat, toLonLat } from 'ol/proj';
import { boundingExtent } from 'ol/extent';
import { defaults as defaultControls } from 'ol/control';
import ScaleLine from 'ol/control/ScaleLine';
import type { Draw } from 'ol/interaction';
import type VectorLayer from 'ol/layer/Vector';
import 'ol/ol.css';

import { useMissionStore } from '../store/missionStore';
import { useMapStore } from '../store/mapStore';
import { createUnitLayer, populateUnitLayer } from './layers/unitLayer';
import { createRouteLayer, populateRouteLayer } from './layers/routeLayer';
import { createThreatLayer, populateThreatLayer } from './layers/threatLayer';
import { createAirbaseLayer, populateAirbaseLayer } from './layers/airbaseLayer';
import { createDrawingLayer, populateDrawingLayer } from './layers/drawingLayer';
import { createTriggerZoneLayer, populateTriggerZoneLayer } from './layers/triggerZoneLayer';
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

import { WaypointEditPopup } from './controls/WaypointEditPopup';
import { LayerSwitcher } from './controls/LayerSwitcher';
import { CoordinateDisplay } from './controls/CoordinateDisplay';
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
  return new TileLayer({
    source: new XYZ({
      url: 'https://{a-d}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',
      maxZoom: 20,
      attributions: '&copy; CARTO',
    }),
    properties: { name: 'dark' },
    visible: true, // default
  });
}

function createOsmLayer(): TileLayer {
  return new TileLayer({ source: new OSM(), properties: { name: 'osm' }, visible: false });
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

export function MapContainer() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<Map | null>(null);
  const baseLayers = useRef<{ dark: TileLayer; osm: TileLayer; satellite: TileLayer; topo: TileLayer } | null>(null);
  const layerRefs = useRef<{
    unit: ReturnType<typeof createUnitLayer> | null;
    route: ReturnType<typeof createRouteLayer> | null;
    threat: ReturnType<typeof createThreatLayer> | null;
    airbase: ReturnType<typeof createAirbaseLayer> | null;
    drawing: ReturnType<typeof createDrawingLayer> | null;
    triggerZone: ReturnType<typeof createTriggerZoneLayer> | null;
  }>({ unit: null, route: null, threat: null, airbase: null, drawing: null, triggerZone: null });
  const dragCleanup = useRef<(() => void) | null>(null);
  const isInteracting = useRef(false); // true during drag or add — blocks route layer redraws
  const pendingRedraw = useRef(false); // set when a redraw was skipped during interaction
  const interactionRefs = useRef<{
    addDraw: Draw | null;
    measureDraw: Draw | null;
    measureLayer: VectorLayer | null;
  }>({ addDraw: null, measureDraw: null, measureLayer: null });
  const coordRef = useRef<HTMLDivElement>(null);
  const [editPopup, setEditPopup] = useState<{ groupId: number; wpIndex: number; x: number; y: number } | null>(null);

  const { theater, units, groups, threats, airbases, drawings, triggerZones, selectedGroupId, selectGroup } =
    useMissionStore();
  const { layers, viewMode, hiddenGroupIds, addWaypointMode, measureMode } = useMapStore();

  // Helper: update a specific group's waypoints from server response
  const _updateGroupWaypoints = useCallback((groupName: string, waypoints: any[]) => {
    const { groups } = useMissionStore.getState();
    const updated = groups.map((g) =>
      g.groupName === groupName ? { ...g, waypoints } : g,
    );
    useMissionStore.setState({ groups: updated });
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
      useMissionStore.setState({ groups: updatedGroups });

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
      useMissionStore.setState({ groups: updatedGroups });

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
    const osmLayer = createOsmLayer();
    const satLayer = createSatelliteLayer();
    const topoLayer = createTopoLayer();
    baseLayers.current = { dark: darkLayer, osm: osmLayer, satellite: satLayer, topo: topoLayer };

    const unitLayer = createUnitLayer();
    const routeLayer = createRouteLayer();
    const threatLayer = createThreatLayer();
    const airbaseLayer = createAirbaseLayer();
    const drawingLayer = createDrawingLayer();
    const triggerZoneLayer = createTriggerZoneLayer();
    layerRefs.current = { unit: unitLayer, route: routeLayer, threat: threatLayer, airbase: airbaseLayer, drawing: drawingLayer, triggerZone: triggerZoneLayer };

    const map = new Map({
      target: mapRef.current,
      layers: [
        darkLayer, osmLayer, satLayer, topoLayer,
        drawingLayer, triggerZoneLayer, threatLayer, airbaseLayer, routeLayer, unitLayer,
      ],
      view: new View({
        center: fromLonLat([44, 41]),
        zoom: 7,
        maxZoom: 19,
        minZoom: 3,
      }),
      controls: defaultControls().extend([
        new ScaleLine({ units: 'nautical' }),
      ]),
    });

    // Click to select group (only when not in add/measure mode)
    map.on('click', (e) => {
      const { addWaypointMode, measureMode } = useMapStore.getState();
      if (addWaypointMode || measureMode) return;

      const feature = map.forEachFeatureAtPixel(e.pixel, (f) => f, { hitTolerance: 8 });
      if (feature) {
        const gid = feature.get('groupId');
        if (gid != null) {
          selectGroup(gid);
          return;
        }
      }
    });

    // Double-click to edit waypoint
    map.on('dblclick', (e) => {
      const hit = map.forEachFeatureAtPixel(
        e.pixel,
        (f, layer) => {
          if (layer === routeLayer && f.get('featureType') === 'waypoint' && f.get('wpIndex') > 0) return f;
          return undefined;
        },
        { hitTolerance: 10 },
      );
      if (hit) {
        e.preventDefault();
        e.stopPropagation();
        const gid = hit.get('groupId');
        const wpi = hit.get('wpIndex');
        const pixel = map.getPixelFromCoordinate((hit.getGeometry() as any).getCoordinates());
        setEditPopup({ groupId: gid, wpIndex: wpi, x: pixel[0], y: pixel[1] });
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
          `<span style="color:#ccdae8">${llStr}</span>` +
          `<br/><span style="color:#d29922">${mgrsStr}</span>` +
          (dcsStr ? `<br/><span style="color:#5a7a8a">${dcsStr}</span>` : '') +
          (lastElevStr ? `<br/><span style="color:#3fb950">Elev: ${lastElevStr}</span>` : '');
      }
      updateCoordDisplay();

      // Tooltip
      const tooltip = document.getElementById('map-tooltip');
      if (!tooltip) return;

      const hit = map.forEachFeatureAtPixel(e.pixel, (f) => f, { hitTolerance: 14 });
      if (hit) {
        const unit = hit.get('unit');
        const groupName = hit.get('groupName');
        const wp = hit.get('waypoint');

        if (unit) {
          const coalColor = unit.coalition === 'blue' ? '#4a8fd4' : unit.coalition === 'red' ? '#d95050' : '#8fa8c0';
          const header = `<b style="color:${coalColor}">${unit.name}</b>`;
          const meta = `<span style="color:#5a7a8a">${unit.coalition} &middot; ${unit.country}${unit.task ? ' &middot; ' + unit.task : ''}</span>`;

          let roster = '';
          if (unit.unitList && unit.unitList.length > 0) {
            const lines = unit.unitList.map((u: any) => {
              const skill = u.skill === 'Client' || u.skill === 'Player'
                ? '<span style="color:#3fb950">Player</span>'
                : `<span style="color:#5a7a8a">${u.skill || ''}</span>`;
              return `<div style="padding:1px 0">${u.name} <span style="color:#6a8a9a">${u.type}</span> ${skill}</div>`;
            });
            roster = `<div style="margin-top:4px;border-top:1px solid #1a2a3a;padding-top:4px;max-height:200px;overflow:auto">${lines.join('')}</div>`;
          }

          tooltip.innerHTML = header + '<br/>' + meta + roster;
          tooltip.style.display = 'block';
        } else if (wp) {
          const altFt = Math.round(metersToFeet(wp.altitude_m || 0));
          const spdKts = Math.round((wp.speed_ms || 0) * 1.94384);
          const altType = wp.altitude_type === 'RADIO' ? 'AGL' : 'MSL';
          const dist = wp.leg_distance_nm ? `${wp.leg_distance_nm.toFixed(1)} nm` : '';
          const brg = wp.leg_bearing_deg ? `${Math.round(wp.leg_bearing_deg)}\u00B0` : '';
          const pos = wp.lat && wp.lon ? formatLatLon(wp.lat, wp.lon) : '';

          tooltip.innerHTML =
            `<b>WP${wp.waypoint_number} ${wp.waypoint_name}</b>` +
            `<br/><span style="color:#6a8a9a">${groupName || ''}</span>` +
            `<div style="margin-top:4px;border-top:1px solid #1a2a3a;padding-top:4px;font-family:monospace;font-size:11px">` +
            (pos ? `<div>${pos}</div>` : '') +
            `<div>Alt: ${altFt} ft ${altType}</div>` +
            `<div>Spd: ${spdKts} kts</div>` +
            (dist ? `<div>Leg: ${dist} ${brg}</div>` : '') +
            `</div>`;
          tooltip.style.display = 'block';
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

    // Right-click to add waypoint (no mode toggle needed)
    map.getViewport().addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const { selectedGroupId: gid } = useMissionStore.getState();
      const { adminMode: am } = useMapStore.getState();
      if (!gid) return;
      const group = useMissionStore.getState().groups.find((g) => g.groupId === gid);
      if (!group) return;
      if (am && !isPlayerGroup(group)) return;

      const pixel = map.getEventPixel(e);
      const coord = map.getCoordinateFromPixel(pixel);
      const [lon, lat] = toLonLat(coord);
      handleAddWaypoint(lat, lon);
    });

    // Esc key to cancel modes
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        useMapStore.getState().setAddWaypointMode(false);
        useMapStore.getState().setMeasureMode(false);
        setEditPopup(null);
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

  // Filter data for flight leads — blue only
  const role = useMissionStore((s) => s.role);
  const isFlightLead = role === 'flight_lead';
  const visibleUnits = isFlightLead ? units.filter((u) => u.coalition === 'blue') : units;
  const visibleGroups = isFlightLead ? groups.filter((g) => g.coalition === 'blue') : groups;
  const visibleThreats = isFlightLead ? [] : threats;

  // Fit map to content on initial load only
  const hasFitted = useRef(false);
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
    if (layerRefs.current.drawing) populateDrawingLayer(layerRefs.current.drawing, drawings);
  }, [drawings]);

  useEffect(() => {
    if (layerRefs.current.triggerZone) populateTriggerZoneLayer(layerRefs.current.triggerZone, triggerZones);
  }, [triggerZones]);

  // Toggle overlay layer visibility
  useEffect(() => {
    if (layerRefs.current.unit) layerRefs.current.unit.setVisible(layers.units);
    if (layerRefs.current.route) layerRefs.current.route.setVisible(layers.routes);
    if (layerRefs.current.threat) layerRefs.current.threat.setVisible(layers.threats);
    if (layerRefs.current.airbase) layerRefs.current.airbase.setVisible(layers.airbases);
    if (layerRefs.current.drawing) layerRefs.current.drawing.setVisible(layers.drawings !== false);
    if (layerRefs.current.triggerZone) layerRefs.current.triggerZone.setVisible(layers.triggerZones !== false);
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


  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
      <WeatherPanel />
      <LayerSwitcher />
      <CoordinateDisplay coordRef={coordRef} />

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

      <div
        id="map-tooltip"
        style={{
          display: 'none',
          position: 'absolute',
          background: 'rgba(10, 20, 35, 0.95)',
          border: '1px solid #1a3a5a',
          borderRadius: 5,
          padding: '8px 12px',
          fontSize: 12,
          color: '#ccdae8',
          pointerEvents: 'none',
          zIndex: 150,
          maxWidth: 380,
          whiteSpace: 'nowrap',
        }}
      />
      {editPopup && (
        <WaypointEditPopup
          groupId={editPopup.groupId}
          wpIndex={editPopup.wpIndex}
          pixelX={editPopup.x}
          pixelY={editPopup.y}
          onClose={() => setEditPopup(null)}
        />
      )}
    </div>
  );
}
