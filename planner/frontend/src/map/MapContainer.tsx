import { useEffect, useRef, useCallback, useState } from 'react';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import XYZ from 'ol/source/XYZ';
import { fromLonLat, toLonLat } from 'ol/proj';
import { defaults as defaultControls } from 'ol/control';
import ScaleLine from 'ol/control/ScaleLine';
import type { Draw } from 'ol/interaction';
import type VectorLayer from 'ol/layer/Vector';
import 'ol/ol.css';

import { useMissionStore } from '../store/missionStore';
import { useMapStore } from '../store/mapStore';
import { useEditStore } from '../store/editStore';
import { createUnitLayer, populateUnitLayer } from './layers/unitLayer';
import { createRouteLayer, populateRouteLayer } from './layers/routeLayer';
import { createThreatLayer, populateThreatLayer } from './layers/threatLayer';
import { createAirbaseLayer, populateAirbaseLayer } from './layers/airbaseLayer';
import { latLonToDcs } from '../projection/dcsProjection';
import { formatLatLon, metersToFeet } from '../utils/conversions';
import { haversineDistance, bearing } from '../utils/navmath';
import { getElevation } from '../utils/elevation';
import { forward as toMGRS } from 'mgrs';
// Terrain-rgb tile layers removed — elevation is fully self-hosted via backend SRTM
import { setupWaypointDrag } from './interactions/waypointDrag';
import { createWaypointAdd } from './interactions/waypointAdd';
import { createMeasureTool } from './interactions/measureTool';
import { editWaypoints } from '../api/client';
import { WaypointEditPopup } from './controls/WaypointEditPopup';
import { LayerSwitcher } from './controls/LayerSwitcher';
import { CoordinateDisplay } from './controls/CoordinateDisplay';

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
  }>({ unit: null, route: null, threat: null, airbase: null });
  const dragCleanup = useRef<(() => void) | null>(null);
  const interactionRefs = useRef<{
    addDraw: Draw | null;
    measureDraw: Draw | null;
    measureLayer: VectorLayer | null;
  }>({ addDraw: null, measureDraw: null, measureLayer: null });
  const coordRef = useRef<HTMLDivElement>(null);
  const [editPopup, setEditPopup] = useState<{ groupId: number; wpIndex: number; x: number; y: number } | null>(null);

  const { theater, units, groups, threats, airbases, selectedGroupId, selectGroup, sessionId, updateGroupData } =
    useMissionStore();
  const { layers, viewMode, addWaypointMode, measureMode } = useMapStore();
  const addEdit = useEditStore((s) => s.addEdit);

  // Handle waypoint drag end — client-side store update, queues edit for download
  const handleDragEnd = useCallback(
    (groupId: number, wpIndex: number, lat: number, lon: number) => {
      const { x, y } = latLonToDcs(lat, lon);
      const edit = { type: 'waypointMove' as const, groupId, wpIndex, x, y };
      addEdit(edit);

      // Update store client-side with recomputed distances/bearings
      const { groups } = useMissionStore.getState();
      const updatedGroups = groups.map((g) => {
        if (g.groupId !== groupId) return g;
        const newWps = g.waypoints.map((wp) => {
          if (wp.waypoint_number !== wpIndex) return wp;
          return { ...wp, x, y, lat, lon };
        });
        // Recompute leg distances and bearings
        for (let i = 1; i < newWps.length; i++) {
          const prev = newWps[i - 1];
          const curr = newWps[i];
          if (prev.lat && prev.lon && curr.lat && curr.lon) {
            const dist = haversineDistance(prev.lat, prev.lon, curr.lat, curr.lon);
            const brg = bearing(prev.lat, prev.lon, curr.lat, curr.lon);
            curr.leg_distance_nm = dist / 1852;
            curr.leg_bearing_deg = brg;
            curr.cumulative_eta = (newWps[i - 1].cumulative_eta || 0) + (curr.speed_ms > 0 ? dist / curr.speed_ms : 0);
          }
        }
        return { ...g, waypoints: newWps };
      });
      useMissionStore.setState({ groups: updatedGroups });
    },
    [addEdit],
  );

  // Handle waypoint add
  const handleAddWaypoint = useCallback(
    async (lat: number, lon: number) => {
      if (!sessionId || !selectedGroupId) return;
      const { x, y } = latLonToDcs(lat, lon);
      const group = useMissionStore.getState().groups.find((g) => g.groupId === selectedGroupId);
      if (!group) return;
      const afterIndex = group.waypoints.length; // append at end
      const edit = {
        type: 'waypointInsert' as const,
        groupId: selectedGroupId,
        afterIndex,
        waypointData: {
          x, y,
          waypoint_name: `WP${afterIndex + 1}`,
          altitude_m: 6096, // 20000 ft default
          altitude_type: 'BARO' as const,
          speed_ms: 200,
          waypoint_type: 'Turning Point',
          waypoint_action: 'Turning Point',
        },
      };
      addEdit(edit);
      try {
        const result = await editWaypoints(sessionId, [edit]);
        if (result.ok) {
          updateGroupData(result.groups, result.units, result.threats, result.airbases);
        }
      } catch (e) {
        console.error('Add waypoint failed:', e);
      }
    },
    [sessionId, selectedGroupId, addEdit, updateGroupData],
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
    layerRefs.current = { unit: unitLayer, route: routeLayer, threat: threatLayer, airbase: airbaseLayer };

    const map = new Map({
      target: mapRef.current,
      layers: [
        darkLayer, osmLayer, satLayer, topoLayer,
        threatLayer, airbaseLayer, routeLayer, unitLayer,
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
          tooltip.innerHTML = `<b>WP${wp.waypoint_number} ${wp.waypoint_name}</b><br/>${groupName || ''}`;
          tooltip.style.display = 'block';
        } else if (groupName && hit.get('featureType') === 'route') {
          tooltip.innerHTML = `<b>${groupName}</b>`;
          tooltip.style.display = 'block';
        } else {
          tooltip.style.display = 'none';
        }

        if (tooltip.style.display === 'block') {
          const rect = map.getTargetElement().getBoundingClientRect();
          tooltip.style.left = `${e.pixel[0] + 14}px`;
          tooltip.style.top = `${e.pixel[1] - 8}px`;
        }
      } else {
        tooltip.style.display = 'none';
      }
    });

    mapInstance.current = map;

    return () => {
      map.setTarget(undefined);
      mapInstance.current = null;
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

    dragCleanup.current = setupWaypointDrag(map, route, { onDragEnd: handleDragEnd });

    return () => {
      if (dragCleanup.current) {
        dragCleanup.current();
        dragCleanup.current = null;
      }
    };
  }, [handleDragEnd, addWaypointMode, measureMode, groups, selectedGroupId, viewMode]);

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

  // Center map on theater change
  useEffect(() => {
    if (!mapInstance.current || !theater) return;
    const center = THEATER_CENTERS[theater];
    if (center) {
      mapInstance.current.getView().animate({ center: fromLonLat(center), zoom: 7, duration: 500 });
    }
  }, [theater]);

  // Populate layers (re-filter when viewMode changes)
  useEffect(() => {
    if (layerRefs.current.unit) populateUnitLayer(layerRefs.current.unit, units, groups, viewMode);
  }, [units, groups, viewMode]);

  useEffect(() => {
    if (layerRefs.current.route) populateRouteLayer(layerRefs.current.route, groups, selectedGroupId, viewMode);
  }, [groups, selectedGroupId, viewMode]);

  useEffect(() => {
    if (layerRefs.current.threat) populateThreatLayer(layerRefs.current.threat, threats, viewMode);
  }, [threats, viewMode]);

  useEffect(() => {
    if (layerRefs.current.airbase) populateAirbaseLayer(layerRefs.current.airbase, airbases);
  }, [airbases]);

  // Toggle overlay layer visibility
  useEffect(() => {
    if (layerRefs.current.unit) layerRefs.current.unit.setVisible(layers.units);
    if (layerRefs.current.route) layerRefs.current.route.setVisible(layers.routes);
    if (layerRefs.current.threat) layerRefs.current.threat.setVisible(layers.threats);
    if (layerRefs.current.airbase) layerRefs.current.airbase.setVisible(layers.airbases);
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

  // Fit to selected group
  useEffect(() => {
    if (!mapInstance.current || !selectedGroupId) return;
    const group = groups.find((g) => g.groupId === selectedGroupId);
    if (!group) return;
    const wps = group.waypoints.filter((w) => w.lat && w.lon);
    if (wps.length === 0) return;

    const extent = [
      Math.min(...wps.map((w) => w.lon!)),
      Math.min(...wps.map((w) => w.lat!)),
      Math.max(...wps.map((w) => w.lon!)),
      Math.max(...wps.map((w) => w.lat!)),
    ];
    const p1 = fromLonLat([extent[0], extent[1]]);
    const p2 = fromLonLat([extent[2], extent[3]]);
    mapInstance.current.getView().fit([p1[0], p1[1], p2[0], p2[1]], {
      padding: [60, 60, 60, 60],
      maxZoom: 12,
      duration: 500,
    });
  }, [selectedGroupId, groups]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
      <LayerSwitcher />
      <CoordinateDisplay coordRef={coordRef} />
      <div
        id="map-tooltip"
        style={{
          display: 'none',
          position: 'absolute',
          background: 'rgba(10, 20, 35, 0.92)',
          border: '1px solid #1a3a5a',
          borderRadius: 4,
          padding: '6px 10px',
          fontSize: 11,
          color: '#ccdae8',
          pointerEvents: 'none',
          zIndex: 150,
          maxWidth: 350,
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
