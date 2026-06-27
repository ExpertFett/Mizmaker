import { useState } from 'react';
import { useMapStore, type ViewMode } from '../../store/mapStore';
import type { UnitCategory } from '../../types/mission';
import { useDraggable } from './useDraggable';
import { ResizeGrip } from './ResizeGrip';


const OVERLAY_LAYERS = [
  { id: 'units', label: 'Units' },
  { id: 'routes', label: 'Routes' },
  { id: 'threats', label: 'Threats' },
  { id: 'airbases', label: 'Airbases' },
  { id: 'bullseye', label: 'Bullseye' },
  { id: 'drawings', label: 'Drawings' },
  { id: 'plannerDrawings', label: 'Plan Overlays' },
  { id: 'triggerZones', label: 'Trigger Zones' },
];

// Per-category filter labels — order matches the typical
// importance for a flight planner (planes / helos first since
// they're what pilots care about, statics last since they're
// usually scenery / debris).
const UNIT_CATEGORIES: { id: UnitCategory; label: string }[] = [
  { id: 'plane',      label: 'Aircraft' },
  { id: 'helicopter', label: 'Helicopters' },
  { id: 'ship',       label: 'Ships' },
  { id: 'vehicle',    label: 'Vehicles' },
  { id: 'static',     label: 'Statics' },
];

const BASE_MAPS = [
  { id: 'dark', label: 'Dark' },
  { id: 'osm', label: 'Street' },
  { id: 'satellite', label: 'Satellite' },
  { id: 'topo', label: 'Topo' },
];

const VIEW_MODES: { id: ViewMode; label: string; color: string }[] = [
  { id: 'all', label: 'All', color: '#e0e0e0' },
  { id: 'blue', label: 'Blue', color: '#4a8fd4' },
  { id: 'red', label: 'Red', color: '#d95050' },
  { id: 'players', label: 'Players', color: '#3fb950' },
];

export function LayerSwitcher() {
  const {
    layers, toggleLayer, viewMode, setViewMode, adminMode, setAdminMode,
    measureMode, setMeasureMode,
    highlightMode, setHighlightMode,
  } = useMapStore();
  const { containerRef, handleProps, resizeHandleProps, resetPosition: _resetPosition } = useDraggable('layerSwitcher');
  const [collapsed, setCollapsed] = useState(false);
  // Unit-category dropdown — collapsed by default to keep the
  // panel compact. Counts in the button label so the user knows
  // their filter state at a glance without expanding.
  const [categoryOpen, setCategoryOpen] = useState(false);
  const unitCategoryFilter = useMapStore((s) => s.unitCategoryFilter);
  const toggleUnitCategory = useMapStore((s) => s.toggleUnitCategory);
  const setUnitCategoryFilter = useMapStore((s) => s.setUnitCategoryFilter);
  const visibleCategoryCount = UNIT_CATEGORIES.filter((c) => unitCategoryFilter[c.id]).length;

  // Use the typed actions on mapStore — same effect as the previous
  // inline setState calls but goes through the action interface so
  // future audit / replay can hook it.
  const setBaseMap = useMapStore((s) => s.setBaseMap);
  const setMapLang = useMapStore((s) => s.setMapLang);

  return (
    <>
    {/* Collapsed tab — fixed position so it's always above OL canvas */}
    {collapsed && (
      <div
        onClick={() => setCollapsed(false)}
        style={{
          position: 'fixed',
          top: 420,
          right: 0,
          background: 'rgba(10, 20, 35, 0.95)',
          borderRadius: '6px 0 0 6px',
          padding: '10px 6px 10px 8px',
          zIndex: 10000,
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 4,
          border: '1px solid #4a4a4a',
          borderRight: 'none',
        }}
        title="Show layers"
      >
        <span style={{ color: '#4a8fd4', fontSize: 12, fontWeight: 700 }}>◀</span>
        <span style={{
          writingMode: 'vertical-lr',
          color: '#aaaaaa', fontSize: 10, fontWeight: 600,
          letterSpacing: 1, textTransform: 'uppercase',
        }}>LAYERS</span>
      </div>
    )}

    {/* Expanded panel */}
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top: 420,
        right: 10,
        background: 'rgba(10, 20, 35, 0.94)',
        borderRadius: 6,
        padding: 0,
        display: collapsed ? 'none' : 'flex',
        flexDirection: 'column',
        gap: 0,
        zIndex: 1000,
        fontSize: 14,
        color: '#ccc',
        minWidth: 150,
        overflow: 'hidden',
      }}
    >
      {/* Drag handle + collapse button */}
      <div style={{
        display: 'flex', alignItems: 'center',
        background: 'rgba(20, 40, 70, 0.4)',
        borderBottom: '1px solid rgba(26, 42, 58, 0.5)',
      }}>
        <div {...handleProps} style={{
          ...handleProps.style,
          flex: 1,
          padding: '4px 14px 2px',
          fontSize: 9, color: '#4a4a4a', textAlign: 'center', letterSpacing: 2,
          userSelect: 'none',
        }}>⠿</div>
        <button
          onClick={() => setCollapsed(true)}
          style={{
            background: 'none', border: 'none', color: '#4a4a4a',
            cursor: 'pointer', fontSize: 11, padding: '3px 8px',
            lineHeight: 1,
          }}
          title="Hide panel"
        >▶</button>
      </div>
          <div style={{ padding: '8px 14px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* View mode */}
            <div style={{ borderBottom: '1px solid #3a3a3a', paddingBottom: 6 }}>
              <div style={sectionLabel}>View</div>
              <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                {VIEW_MODES.map((vm) => (
                  <button
                    key={vm.id}
                    onClick={() => setViewMode(vm.id)}
                    style={{
                      flex: 1, padding: '4px 5px', fontSize: 12,
                      background: viewMode === vm.id ? 'rgba(255,255,255,0.08)' : '#262626',
                      border: `1px solid ${viewMode === vm.id ? vm.color : '#3a3a3a'}`,
                      borderRadius: 3,
                      color: viewMode === vm.id ? vm.color : '#aaaaaa',
                      cursor: 'pointer', fontWeight: viewMode === vm.id ? 600 : 400,
                    }}
                  >
                    {vm.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Base map */}
            <div style={{ borderBottom: '1px solid #3a3a3a', paddingBottom: 6 }}>
              <div style={sectionLabel}>Base Map</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {BASE_MAPS.map((bm) => (
                  <button
                    key={bm.id}
                    onClick={() => setBaseMap(bm.id)}
                    style={{
                      flex: 1, padding: '4px 6px', fontSize: 12,
                      background: (layers.baseMap || 'dark') === bm.id ? '#4a4a4a' : '#262626',
                      border: `1px solid ${(layers.baseMap || 'dark') === bm.id ? '#4a8fd4' : '#3a3a3a'}`,
                      borderRadius: 3,
                      color: (layers.baseMap || 'dark') === bm.id ? '#e0e0e0' : '#aaaaaa',
                      cursor: 'pointer',
                    }}
                  >
                    {bm.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Map Language (only relevant for Street map) */}
            {(layers.baseMap || 'dark') === 'osm' && (
              <div style={{ borderBottom: '1px solid #3a3a3a', paddingBottom: 6 }}>
                <div style={sectionLabel}>Labels</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[
                    { id: 'en', label: 'English' },
                    { id: 'local', label: 'Local' },
                  ].map((l) => (
                    <button
                      key={l.id}
                      onClick={() => setMapLang(l.id)}
                      style={{
                        flex: 1, padding: '4px 6px', fontSize: 12,
                        background: (layers.mapLang || 'en') === l.id ? '#4a4a4a' : '#262626',
                        border: `1px solid ${(layers.mapLang || 'en') === l.id ? '#4a8fd4' : '#3a3a3a'}`,
                        borderRadius: 3,
                        color: (layers.mapLang || 'en') === l.id ? '#e0e0e0' : '#aaaaaa',
                        cursor: 'pointer',
                      }}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Layers */}
            <div style={{ borderBottom: '1px solid #3a3a3a', paddingBottom: 6 }}>
              <div style={sectionLabel}>Layers</div>
              {OVERLAY_LAYERS.map((l) => (
                <label key={l.id} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, fontSize: 13 }}>
                  <input type="checkbox" checked={layers[l.id] ?? true} onChange={() => toggleLayer(l.id)} style={{ accentColor: '#4a8fd4' }} />
                  {l.label}
                </label>
              ))}

              {/* Unit Type filter — replaces the v0.9.23 single
                  "Statics" toggle. Renders as an inline dropdown:
                  click the button to expand 5 category checkboxes,
                  click again to collapse. Count in the label
                  ("4/5") gives the user their filter state at a
                  glance even when collapsed. */}
              <button
                onClick={() => setCategoryOpen((o) => !o)}
                style={{
                  marginTop: 4,
                  width: '100%',
                  padding: '4px 8px',
                  background: '#262626',
                  border: '1px solid #3a3a3a',
                  borderRadius: 3,
                  color: '#cccccc',
                  fontSize: 12,
                  fontFamily: 'inherit',
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
                title="Filter map units by category"
              >
                <span>
                  Unit Types{' '}
                  <span style={{ color: '#888', fontSize: 11 }}>
                    ({visibleCategoryCount}/{UNIT_CATEGORIES.length})
                  </span>
                </span>
                <span style={{ color: '#888', fontSize: 10 }}>{categoryOpen ? '▴' : '▾'}</span>
              </button>

              {categoryOpen && (
                <div
                  style={{
                    marginTop: 4,
                    padding: '6px 8px',
                    background: '#1a1a1a',
                    border: '1px solid #3a3a3a',
                    borderRadius: 3,
                  }}
                >
                  {/* All / None bulk toggles. "All" turns every
                      category back on, "None" hides everything —
                      handy when the user wants a clean threat-only
                      view (uncheck all unit types but leave the
                      threat layer on in the section above). */}
                  <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                    <button
                      onClick={() => setUnitCategoryFilter({
                        plane: true, helicopter: true, vehicle: true, ship: true, static: true,
                      })}
                      style={categoryBulkBtn}
                    >
                      All
                    </button>
                    <button
                      onClick={() => setUnitCategoryFilter({
                        plane: false, helicopter: false, vehicle: false, ship: false, static: false,
                      })}
                      style={categoryBulkBtn}
                    >
                      None
                    </button>
                  </div>
                  {UNIT_CATEGORIES.map((c) => (
                    <label
                      key={c.id}
                      style={{
                        cursor: 'pointer', display: 'flex', alignItems: 'center',
                        gap: 6, marginBottom: 2, fontSize: 12,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={unitCategoryFilter[c.id]}
                        onChange={() => toggleUnitCategory(c.id)}
                        style={{ accentColor: '#4a8fd4' }}
                      />
                      {c.label}
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Tools */}
            <div>
              <div style={sectionLabel}>Tools</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button
                  onClick={() => setMeasureMode(!measureMode)}
                  style={{
                    padding: '6px 10px', fontSize: 13,
                    background: measureMode ? '#3a3a1a' : '#262626',
                    border: `1px solid ${measureMode ? '#d29922' : '#3a3a3a'}`,
                    borderRadius: 4, textAlign: 'left',
                    color: measureMode ? '#d29922' : '#e0e0e0', cursor: 'pointer',
                  }}
                >
                  {measureMode ? '\u{1F4CF} Measuring... (Esc)' : '\u{1F4CF} Measure'}
                </button>

                {/* v1.19.74 — collaborative highlight pen. NOT role-gated:
                    every session participant (wingmen included) can mark
                    the map; strokes broadcast live to all clients. */}
                <button
                  onClick={() => setHighlightMode(!highlightMode)}
                  title="Freehand-highlight anything on the map. Everyone in the session sees your strokes live, tagged with your flight name."
                  style={{
                    padding: '6px 10px', fontSize: 13,
                    background: highlightMode ? '#3a2a1a' : '#262626',
                    border: `1px solid ${highlightMode ? '#ffa500' : '#3a3a3a'}`,
                    borderRadius: 4, textAlign: 'left',
                    color: highlightMode ? '#ffa500' : '#e0e0e0', cursor: 'pointer',
                  }}
                >
                  {highlightMode ? '✏ Highlighting... (click again to stop)' : '✏ Highlight'}
                </button>

                <label style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                  background: adminMode ? 'rgba(210, 153, 34, 0.1)' : '#262626',
                  border: `1px solid ${adminMode ? '#d29922' : '#3a3a3a'}`,
                  borderRadius: 4, cursor: 'pointer', fontSize: 13,
                  color: adminMode ? '#d29922' : '#e0e0e0',
                }}>
                  <input type="checkbox" checked={adminMode} onChange={() => setAdminMode(!adminMode)}
                    style={{ accentColor: '#d29922' }} />
                  {adminMode ? '\u{1F512} Admin Lock ON' : '\u{1F513} Admin Lock'}
                </label>
              </div>
            </div>
          </div>
      <ResizeGrip {...resizeHandleProps} />
    </div>
    </>
  );
}

const sectionLabel: React.CSSProperties = {
  fontSize: 11, color: '#aaaaaa', marginBottom: 4,
  textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600,
};

const categoryBulkBtn: React.CSSProperties = {
  flex: 1, padding: '2px 4px', fontSize: 11,
  background: '#262626', border: '1px solid #3a3a3a',
  borderRadius: 3, color: '#aaaaaa', cursor: 'pointer',
  fontFamily: 'inherit',
};
