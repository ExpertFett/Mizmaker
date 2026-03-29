import { useMapStore, type ViewMode } from '../../store/mapStore';


const OVERLAY_LAYERS = [
  { id: 'units', label: 'Units' },
  { id: 'routes', label: 'Routes' },
  { id: 'threats', label: 'Threats' },
  { id: 'airbases', label: 'Airbases' },
  { id: 'drawings', label: 'Drawings' },
  { id: 'triggerZones', label: 'Trigger Zones' },
  { id: 'statics', label: 'Statics' },
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
  const {
    layers, toggleLayer, viewMode, setViewMode, adminMode, setAdminMode,
    measureMode, setMeasureMode,
  } = useMapStore();

  const setBaseMap = (id: string) => {
    useMapStore.setState((s) => ({ layers: { ...s.layers, baseMap: id } }));
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 10,
        right: 10,
        background: 'rgba(10, 20, 35, 0.94)',
        borderRadius: 6,
        padding: '10px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 100,
        fontSize: 13,
        color: '#ccc',
        minWidth: 150,
      }}
    >
      {/* View mode */}
      <div style={{ borderBottom: '1px solid #1a2a3a', paddingBottom: 6 }}>
        <div style={sectionLabel}>View</div>
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          {VIEW_MODES.map((vm) => (
            <button
              key={vm.id}
              onClick={() => setViewMode(vm.id)}
              style={{
                flex: 1, padding: '4px 5px', fontSize: 11,
                background: viewMode === vm.id ? 'rgba(255,255,255,0.08)' : '#0f1a28',
                border: `1px solid ${viewMode === vm.id ? vm.color : '#1a2a3a'}`,
                borderRadius: 3,
                color: viewMode === vm.id ? vm.color : '#5a7a8a',
                cursor: 'pointer', fontWeight: viewMode === vm.id ? 600 : 400,
              }}
            >
              {vm.label}
            </button>
          ))}
        </div>
      </div>

      {/* Base map */}
      <div style={{ borderBottom: '1px solid #1a2a3a', paddingBottom: 6 }}>
        <div style={sectionLabel}>Base Map</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {BASE_MAPS.map((bm) => (
            <button
              key={bm.id}
              onClick={() => setBaseMap(bm.id)}
              style={{
                flex: 1, padding: '4px 6px', fontSize: 11,
                background: (layers.baseMap || 'dark') === bm.id ? '#1a3a5a' : '#0f1a28',
                border: `1px solid ${(layers.baseMap || 'dark') === bm.id ? '#4a8fd4' : '#1a2a3a'}`,
                borderRadius: 3,
                color: (layers.baseMap || 'dark') === bm.id ? '#ccdae8' : '#5a7a8a',
                cursor: 'pointer',
              }}
            >
              {bm.label}
            </button>
          ))}
        </div>
      </div>

      {/* Layers */}
      <div style={{ borderBottom: '1px solid #1a2a3a', paddingBottom: 6 }}>
        <div style={sectionLabel}>Layers</div>
        {OVERLAY_LAYERS.map((l) => (
          <label key={l.id} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, fontSize: 12 }}>
            <input type="checkbox" checked={layers[l.id] ?? true} onChange={() => toggleLayer(l.id)} style={{ accentColor: '#4a8fd4' }} />
            {l.label}
          </label>
        ))}
      </div>

      {/* Tools */}
      <div>
        <div style={sectionLabel}>Tools</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button
            onClick={() => setMeasureMode(!measureMode)}
            style={{
              padding: '6px 10px', fontSize: 12,
              background: measureMode ? '#3a3a1a' : '#0f1a28',
              border: `1px solid ${measureMode ? '#d29922' : '#1a2a3a'}`,
              borderRadius: 4, textAlign: 'left',
              color: measureMode ? '#d29922' : '#ccdae8', cursor: 'pointer',
            }}
          >
            {measureMode ? '\u{1F4CF} Measuring... (Esc)' : '\u{1F4CF} Measure'}
          </button>

          <label style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
            background: adminMode ? 'rgba(210, 153, 34, 0.1)' : '#0f1a28',
            border: `1px solid ${adminMode ? '#d29922' : '#1a2a3a'}`,
            borderRadius: 4, cursor: 'pointer', fontSize: 12,
            color: adminMode ? '#d29922' : '#ccdae8',
          }}>
            <input type="checkbox" checked={adminMode} onChange={() => setAdminMode(!adminMode)}
              style={{ accentColor: '#d29922' }} />
            {adminMode ? '\u{1F512} Admin Lock ON' : '\u{1F513} Admin Lock'}
          </label>
        </div>
      </div>
    </div>
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: 10, color: '#5a7a8a', marginBottom: 4,
  textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600,
};
