/**
 * IadsPanel — Live "Draw tool" IADS generator.
 *
 * Flow: pick IADS mode → choose a CIRCLE (click centre + radius) or POLYGON
 * (click vertices) area → either pick a threat TIER (auto-composes a layered
 * net scaled to the area) or hand-build a composition → Generate. For each site
 * the generator distributes a centre inside the area and spawns that recipe's
 * component group via Olympus `spawnGroundUnits` (one call/site, so DCS links it
 * into a functional group). The Dynamic AEGIS engine then auto-adopts each site.
 *
 * Recipes are resolved against the LIVE ground database so only sites this
 * server supports are offered (mods/version differences degrade gracefully).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getUnitDatabase, sendCommand, type GroupSummary, type ServerProfile } from '../../api/groups';
import {
  IADS_RECIPES, type IadsRecipe, type IadsKind,
  IADS_TIERS, applyTier, areaEffectiveRadiusNm,
  distributeInArea, offsetLatLng, type IadsArea,
} from './iadsRecipes';

const C = {
  bg: 'rgba(13,19,29,0.96)', border: '#243349', accent: '#4a9eff',
  accentDim: 'rgba(74,158,255,0.18)', text: '#dce6f2', dim: '#8aa0ba',
  red: '#e0554f', blue: '#5a9fd4', green: '#3fb950', amber: '#d8a657',
};

const KIND_LABEL: Record<IadsKind, string> = { ewr: 'Early Warning', area: 'Area SAM', shorad: 'SHORAD / AAA' };
const KIND_ORDER: IadsKind[] = ['ewr', 'area', 'shorad'];

export function IadsPanel({ group, profile, area, shape, onShape, onRadius, onUndoVertex, onClear, onClose }: {
  group: GroupSummary; profile: ServerProfile;
  area: IadsArea | null;
  shape: 'circle' | 'polygon' | 'freehand';
  onShape: (s: 'circle' | 'polygon' | 'freehand') => void;
  onRadius: (nm: number) => void;
  onUndoVertex: () => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [dbKeys, setDbKeys] = useState<Set<string> | null>(null);
  const [dbErr, setDbErr] = useState('');
  const [coalition, setCoalition] = useState<'blue' | 'red' | 'neutral'>('red');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [spacing, setSpacing] = useState(8); // min NM between sites
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const cancelRef = useRef(false);

  // Load the ground DB once (keys are the DCS type names recipes reference).
  useEffect(() => {
    let cancelled = false;
    getUnitDatabase(group.id, profile.id, 'groundunit').then((r) => {
      if (cancelled) return;
      if (r.ok && r.data) setDbKeys(new Set(Object.keys(r.data)));
      else setDbErr(r.error || 'Could not load ground database.');
    }).catch((e) => { if (!cancelled) setDbErr(e instanceof Error ? e.message : 'failed'); });
    return () => { cancelled = true; };
  }, [group.id, profile.id]);

  // Recipes whose components all exist on this server.
  const supported = useMemo(() => {
    if (!dbKeys) return [] as IadsRecipe[];
    return IADS_RECIPES.filter((r) => r.components.every((c) => dbKeys.has(c.type)));
  }, [dbKeys]);
  const unsupportedCount = dbKeys ? IADS_RECIPES.length - supported.length : 0;

  const byKind = useMemo(() => {
    const m: Record<IadsKind, IadsRecipe[]> = { ewr: [], area: [], shorad: [] };
    for (const r of supported) m[r.kind].push(r);
    return m;
  }, [supported]);

  // An area is "ready" to generate into: circle centre placed, or polygon ≥3 verts.
  const ready = !!area && (area.shape === 'circle' || (area.shape === 'polygon' && area.verts.length >= 3));
  const polyVerts = area && area.shape === 'polygon' ? area.verts.length : 0;
  const effR = ready && area ? Math.round(areaEffectiveRadiusNm(area)) : 0;

  const totalSites = Object.values(counts).reduce((a, b) => a + b, 0);
  const setCount = (code: string, n: number) => setCounts((p) => ({ ...p, [code]: Math.max(0, n) }));
  const applyPreset = (tierCode: string) => {
    const tier = IADS_TIERS.find((t) => t.code === tierCode);
    if (!tier || !ready || !area) return;
    setCounts(applyTier(tier, area, supported));
  };

  const generate = useCallback(async () => {
    if (!ready || !area || totalSites === 0) return;
    const queue: IadsRecipe[] = [];
    for (const r of supported) for (let i = 0; i < (counts[r.code] || 0); i++) queue.push(r);
    const centres = distributeInArea(area, queue.length, spacing);

    setBusy(true); cancelRef.current = false;
    let ok = 0, fail = 0;
    for (let i = 0; i < queue.length; i++) {
      if (cancelRef.current) break;
      const recipe = queue[i];
      const c = centres[i] || (area.shape === 'circle' ? { lat: area.lat, lng: area.lng } : area.verts[0]);
      const units = recipe.components.map((comp) => {
        const p = offsetLatLng(c.lat, c.lng, comp.dx, comp.dy);
        return { unitType: comp.type, location: { lat: p.lat, lng: p.lng }, skill: 'High', liveryID: '' };
      });
      const params = { units, coalition, country: '', immediate: false, spawnPoints: 0 };
      setStatus(`Spawning ${i + 1}/${queue.length}: ${recipe.label}…`);
      try {
        const r = await sendCommand(group.id, profile.id, 'spawnGroundUnits', params);
        r.ok ? ok++ : fail++;
      } catch { fail++; }
      await new Promise((res) => setTimeout(res, 160)); // be gentle on Olympus
    }
    setBusy(false);
    setStatus(cancelRef.current
      ? `Stopped — ${ok} site${ok === 1 ? '' : 's'} spawned.`
      : `Done: ${ok} site${ok === 1 ? '' : 's'} spawned${fail ? `, ${fail} failed` : ''}. Dynamic AEGIS will adopt them.`);
  }, [ready, area, totalSites, supported, counts, spacing, coalition, group.id, profile.id]);

  return (
    <div style={{ position: 'absolute', top: 56, left: 56, bottom: 44, width: 300, zIndex: 4, display: 'flex', flexDirection: 'column', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, boxShadow: '0 6px 20px rgba(0,0,0,0.45)', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', borderBottom: `1px solid ${C.border}`, background: 'rgba(255,255,255,0.03)' }}>
        <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>IADS GENERATOR</span>
        <button onClick={onClose} title="Close" style={iconBtn}>×</button>
      </div>

      <div style={{ overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
        {/* Shape toggle */}
        <Row label="Area">
          <div style={{ display: 'flex', border: `1px solid ${C.border}`, borderRadius: 5, overflow: 'hidden' }}>
            {(['circle', 'polygon', 'freehand'] as const).map((s) => (
              <button key={s} onClick={() => onShape(s)}
                      title={s === 'freehand' ? 'Drag on the map to draw a freeform area' : undefined}
                      style={{ background: shape === s ? C.accentDim : 'transparent', color: shape === s ? '#cfe6ff' : C.dim, border: 'none', padding: '4px 12px', cursor: 'pointer', fontSize: 12, fontWeight: shape === s ? 700 : 400, fontFamily: 'inherit' }}>
                {s === 'circle' ? '◎ Circle' : s === 'polygon' ? '⬡ Polygon' : '✎ Freehand'}
              </button>
            ))}
          </div>
        </Row>

        {/* Area state / controls */}
        {!ready ? (
          <div style={{ fontSize: 12, color: C.accent, lineHeight: 1.5, background: C.accentDim, border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 10px' }}>
            {shape === 'circle'
              ? 'Click the map to drop the IADS centre, then set a radius.'
              : shape === 'polygon'
                ? `Click the map to add polygon vertices (${polyVerts}/3 min).`
                : 'Drag on the map to draw a freeform area (release to finish).'}
            {shape === 'polygon' && polyVerts > 0 && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button onClick={onUndoVertex} style={{ ...mbtn, flex: 1, padding: '4px' }}>Undo</button>
                <button onClick={onClear} style={{ ...mbtn, flex: 1, padding: '4px' }}>Clear</button>
              </div>
            )}
          </div>
        ) : (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {area && area.shape === 'circle' ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                  <span style={{ color: C.dim }}>Centre</span>
                  <span style={{ fontFamily: 'monospace' }}>{area.lat.toFixed(3)}, {area.lng.toFixed(3)}</span>
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                    <span style={{ color: C.dim }}>Radius</span>
                    <span style={{ color: C.accent, fontWeight: 700 }}>{area.radiusNm} NM</span>
                  </div>
                  <input type="range" min={3} max={120} step={1} value={area.radiusNm}
                         onChange={(e) => onRadius(Number(e.target.value))} style={{ width: '100%' }} />
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                <span style={{ color: C.dim }}>Polygon</span>
                <span>{polyVerts} vertices · ~{effR} NM</span>
              </div>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              {shape === 'polygon' && <button onClick={onUndoVertex} style={{ ...mbtn, flex: 1, padding: '5px' }}>Undo vertex</button>}
              <button onClick={onClear} style={{ ...mbtn, flex: 1, padding: '5px' }}>Clear area</button>
            </div>
          </div>
        )}

        {/* Coalition + spacing */}
        <Row label="Side">
          <div style={{ display: 'flex', border: `1px solid ${C.border}`, borderRadius: 5, overflow: 'hidden' }}>
            {(['blue', 'neutral', 'red'] as const).map((c) => {
              const on = coalition === c; const col = c === 'red' ? C.red : c === 'blue' ? C.blue : '#bbbbbb';
              return (
                <button key={c} onClick={() => setCoalition(c)}
                        style={{ background: on ? `${col}22` : 'transparent', color: on ? col : C.dim, border: 'none', padding: '4px 12px', cursor: 'pointer', fontSize: 12, fontWeight: on ? 700 : 400, fontFamily: 'inherit' }}>
                  {c === 'neutral' ? 'NEU' : c.toUpperCase()}
                </button>
              );
            })}
          </div>
        </Row>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
            <span style={{ color: C.dim }}>Min spacing</span>
            <span style={{ color: C.text }}>{spacing} NM</span>
          </div>
          <input type="range" min={0} max={30} step={1} value={spacing}
                 onChange={(e) => setSpacing(Number(e.target.value))} style={{ width: '100%' }} />
        </div>

        {/* Threat tiers */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: C.dim, margin: '2px 0 5px' }}>THREAT TIER</div>
          <div style={{ display: 'flex', gap: 5 }}>
            {IADS_TIERS.map((t) => (
              <button key={t.code} onClick={() => applyPreset(t.code)} disabled={!ready || supported.length === 0} title={t.desc}
                      style={{ ...mbtn, flex: 1, padding: '6px 4px', opacity: (!ready || supported.length === 0) ? 0.45 : 1 }}>
                {t.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>Auto-fills the composition, scaled to the area. Tweak below, then Generate.</div>
        </div>

        {/* Composition */}
        {dbErr && <div style={{ fontSize: 12, color: C.red }}>✗ {dbErr}</div>}
        {!dbKeys && !dbErr && <div style={{ fontSize: 12, color: C.dim }}>Loading ground database…</div>}
        {dbKeys && KIND_ORDER.map((k) => byKind[k].length > 0 && (
          <div key={k}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: C.dim, margin: '2px 0 5px' }}>{KIND_LABEL[k].toUpperCase()}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {byKind[k].map((r) => (
                <div key={r.code} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${r.label} — ${r.components.length} unit${r.components.length === 1 ? '' : 's'}`}>{r.label}</span>
                  {r.threat > 0 && <span style={{ fontSize: 10, color: C.dim }}>{r.threat}nm</span>}
                  <Stepper value={counts[r.code] || 0} onChange={(n) => setCount(r.code, n)} />
                </div>
              ))}
            </div>
          </div>
        ))}
        {dbKeys && supported.length === 0 && !dbErr && (
          <div style={{ fontSize: 12, color: C.amber }}>No recipe components matched this server's ground database. (Mod/version mismatch — edit iadsRecipes.ts.)</div>
        )}
        {unsupportedCount > 0 && (
          <div style={{ fontSize: 11, color: C.dim }}>{unsupportedCount} recipe{unsupportedCount === 1 ? '' : 's'} hidden (components not on this server).</div>
        )}
      </div>

      {/* Footer */}
      <div style={{ borderTop: `1px solid ${C.border}`, padding: 10, display: 'flex', flexDirection: 'column', gap: 7, background: 'rgba(255,255,255,0.02)' }}>
        {status && <div style={{ fontSize: 11, color: status.startsWith('Done') || status.startsWith('Stopped') ? C.green : C.accent }}>{status}</div>}
        <div style={{ display: 'flex', gap: 6 }}>
          {!busy ? (
            <button onClick={generate} disabled={!ready || totalSites === 0}
                    style={{ ...mbtn, flex: 1, padding: '9px', fontWeight: 700, opacity: (!ready || totalSites === 0) ? 0.45 : 1,
                             background: (!ready || totalSites === 0) ? 'rgba(255,255,255,0.04)' : C.accentDim,
                             borderColor: (!ready || totalSites === 0) ? C.border : C.accent, color: (!ready || totalSites === 0) ? C.dim : '#cfe6ff' }}>
              Generate IADS{totalSites > 0 ? ` (${totalSites} site${totalSites === 1 ? '' : 's'})` : ''}
            </button>
          ) : (
            <button onClick={() => { cancelRef.current = true; }} style={{ ...mbtn, flex: 1, padding: '9px', fontWeight: 700, borderColor: C.red, color: C.red }}>Stop</button>
          )}
        </div>
        <div style={{ fontSize: 10, color: C.dim, lineHeight: 1.4 }}>
          Spawns functional groups that Dynamic AEGIS adopts. Requires aegis-iads-v0.9.0-beta-dynamic.lua (autonomous) or aegis-iads-v0.9.1-beta-networked.lua (networked sectors — recommended) running with dynamicDiscovery on.
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, color: C.dim, width: 52, flexShrink: 0 }}>{label}</span>
      {children}
    </div>
  );
}
function Stepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, border: `1px solid ${C.border}`, borderRadius: 4, overflow: 'hidden' }}>
      <button onClick={() => onChange(value - 1)} style={stepBtn}>−</button>
      <span style={{ minWidth: 26, textAlign: 'center', fontSize: 13, color: value > 0 ? C.accent : C.dim }}>{value}</span>
      <button onClick={() => onChange(value + 1)} style={stepBtn}>+</button>
    </div>
  );
}

const iconBtn: React.CSSProperties = { background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 16, lineHeight: 1, fontFamily: 'inherit' };
const stepBtn: React.CSSProperties = { background: 'rgba(255,255,255,0.04)', border: 'none', color: C.text, cursor: 'pointer', fontSize: 14, width: 24, height: 22, fontFamily: 'inherit' };
const mbtn: React.CSSProperties = { background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`, color: C.text, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', borderRadius: 5 };
