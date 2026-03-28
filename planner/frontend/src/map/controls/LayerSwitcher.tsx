import { useMapStore, type ViewMode } from '../../store/mapStore';
import { useMissionStore } from '../../store/missionStore';

const OVERLAY_LAYERS = [
  { id: 'units', label: 'Units' },
  { id: 'routes', label: 'Routes' },
  { id: 'threats', label: 'Threats' },
  { id: 'airbases', label: 'Airbases' },
];

const BASE_MAPS = [
  { id: 'dark', label: 'Dark' },
  { id: 'osm', label: 'Street' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'topo', label: 'Topo' },
];

const VIEW_MODES: { id: ViewMode; label: string; color: string }[] = [
  { id: 'all', label: 'All', color: '#ccdae8' },
  { id: 'blue', label: 'Blue', color: '#4a8fd4' },
  { id: 'red', label: 'Red', color: '#d95050' },
  { id: 'players', label: 'Players', color: '#3fb950' },
];

export function LayerSwitcher() {
  const { layers, toggleLayer, viewMode, setViewMode, addWaypointMode, setAddWaypointMode, measureMode, setMeasureMode } =
    useMapStore();
  const selectedGroupId = useMissionStore((s) => s.selectedGroupId);

  const setBaseMap = (id: string) => {
    useMapStore.setState((s) => ({ layers: { ...s.layers, baseMap: id } }));
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 10,
        right: 10,
        background: 'rgba(10, 20, 35, 0.92)',
        borderRadius: 6,
        padding: '10px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 100,
        fontSize: 12,
        color: '#ccc',
        minWidth: 140,
      }}
    >
      {/* View mode */}
      <div style={{ borderBottom: '1px solid #1a2a3a', paddingBottom: 6 }}>
        <div style={{ fontSize: 10, color: '#5a7a8a', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
          View
        </div>
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          {VIEW_MODES.map((vm) => (
            <button
              key={vm.id}
              onClick={() => setViewMode(vm.id)}
              style={{
                flex: 1,
                padding: '3px 4px',
                fontSize: 10,
                background: viewMode === vm.id ? 'rgba(255,255,255,0.08)' : '#0f1a28',
                border: `1px solid ${viewMode === vm.id ? vm.color : '#1a2a3a'}`,
                borderRadius: 3,
                color: viewMode === vm.id ? vm.color : '#5a7a8a',
                cursor: 'pointer',
                fontWeight: viewMode === vm.id ? 600 : 400,
              }}
            >
              {vm.label}
            </button>
          ))}
        </div>
      </div>

      {/* Base map selector */}
      <div style={{ borderBottom: '1px solid #1a2a3a', paddingBottom: 6 }}>
        <div style={{ fontSize: 10, color: '#5a7a8a', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
          Base Map
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {BASE_MAPS.map((bm) => (
            <button
              key={bm.id}
              onClick={() => setBaseMap(bm.id)}
              style={{
                flex: 1,
                padding: '3px 6px',
                fontSize: 10,
                background: (layers.baseMap || 'osm') === bm.id ? '#1a3a5a' : '#0f1a28',
                border: `1px solid ${(layers.baseMap || 'osm') === bm.id ? '#4a8fd4' : '#1a2a3a'}`,
                borderRadius: 3,
                color: (layers.baseMap || 'osm') === bm.id ? '#ccdae8' : '#5a7a8a',
                cursor: 'pointer',
              }}
            >
              {bm.label}
            </button>
          ))}
        </div>
      </div>

      {/* Overlay toggles */}
      <div style={{ borderBottom: '1px solid #1a2a3a', paddingBottom: 6 }}>
        <div style={{ fontSize: 10, color: '#5a7a8a', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
          Layers
        </div>
        {OVERLAY_LAYERS.map((l) => (
          <label key={l.id} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <input
              type="checkbox"
              checked={layers[l.id] ?? true}
              onChange={() => toggleLayer(l.id)}
              style={{ accentColor: '#4a8fd4' }}
            />
            {l.label}
          </label>
        ))}
      </div>

      {/* Tools */}
      <div>
        <div style={{ fontSize: 10, color: '#5a7a8a', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
          Tools
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <button
            onClick={() => setAddWaypointMode(!addWaypointMode)}
            disabled={!selectedGroupId}
            style={{
              padding: '5px 8px',
              fontSize: 11,
              background: addWaypointMode ? '#1a4a2a' : '#0f1a28',
              border: `1px solid ${addWaypointMode ? '#3fb950' : '#1a2a3a'}`,
              borderRadius: 3,
              color: addWaypointMode ? '#3fb950' : selectedGroupId ? '#ccdae8' : '#3a4a5a',
              cursor: selectedGroupId ? 'pointer' : 'not-allowed',
              textAlign: 'left',
            }}
          >
            + Add Waypoint {addWaypointMode && '(active)'}
          </button>
          <button
            onClick={() => setMeasureMode(!measureMode)}
            style={{
              padding: '5px 8px',
              fontSize: 11,
              background: measureMode ? '#3a3a1a' : '#0f1a28',
              border: `1px solid ${measureMode ? '#d29922' : '#1a2a3a'}`,
              borderRadius: 3,
              color: measureMode ? '#d29922' : '#ccdae8',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            Measure {measureMode && '(active)'}
          </button>
        </div>
      </div>
    </div>
  );
}
