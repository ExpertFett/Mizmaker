/**
 * SpawnPanel — Olympus-style spawn flow for the Live terminal.
 *
 * Step 1 (browse): collapsible categories (Aircraft / Helicopters / SAM /
 * AAA / Ground / Ships / Effects / Starred); expand → search + (air) role
 * chips + unit rows. Step 2 (configure): photo + description + tags, coalition,
 * count, altitude (AGL/ASL), Role → Weapons(loadout) → Livery → Skill, a
 * heading dial, and a loadout drawer. Reports a `placeFn` up to LiveMap so a
 * map click spawns the configured unit (or places an effect) at that point.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getUnitDatabase, sendCommand, unitImageUrl,
  type GroupSummary, type ServerProfile, type UnitCategory, type UnitDbEntry,
} from '../../api/groups';

const C = {
  bg: 'rgba(13,19,29,0.96)', border: '#243349', borderHi: '#3a6ea5', accent: '#4a9eff',
  accentDim: 'rgba(74,158,255,0.18)', text: '#dce6f2', dim: '#8aa0ba', red: '#e0554f',
  blue: '#5a9fd4', green: '#3fb950',
};

type Cat = 'aircraft' | 'helicopter' | 'sam' | 'aaa' | 'groundunit' | 'navyunit' | 'effects' | 'starred';
const SAM_TYPES = new Set(['SAM Site', 'SAM Site Parts', 'Radar (EWR)', 'AirDefence']);
const CATS: { id: Cat; label: string; db?: UnitCategory }[] = [
  { id: 'aircraft', label: 'Aircraft', db: 'aircraft' },
  { id: 'helicopter', label: 'Helicopters', db: 'helicopter' },
  { id: 'sam', label: 'Surface to Air Missiles (SAM sites)', db: 'groundunit' },
  { id: 'aaa', label: 'Anti Aircraft Artillery (AAA)', db: 'groundunit' },
  { id: 'groundunit', label: 'Ground Units', db: 'groundunit' },
  { id: 'navyunit', label: 'Ships and submarines', db: 'navyunit' },
  { id: 'effects', label: 'Effects (smokes, explosions etc)' },
  { id: 'starred', label: 'Starred Spawns' },
];
const SPAWN_CMD: Record<string, string> = {
  aircraft: 'spawnAircrafts', helicopter: 'spawnHelicopters',
  sam: 'spawnGroundUnits', aaa: 'spawnGroundUnits', groundunit: 'spawnGroundUnits', navyunit: 'spawnNavyUnits',
};
const SKILLS = ['Average', 'Good', 'High', 'Excellent', 'Random'];
const SMOKE_COLORS = ['green', 'red', 'white', 'blue', 'orange'];
const EXPLOSIONS: { label: string; type: string }[] = [
  { label: 'High explosive', type: 'normal' }, { label: 'Napalm', type: 'napalm' },
  { label: 'White phosphorous', type: 'phosphorous' }, { label: 'Fire', type: 'fire' },
];
const STAR_KEY = 'dcsopt.live.starred';

const isAir = (c: Cat) => c === 'aircraft' || c === 'helicopter';
function groundBucket(type?: string): Cat {
  if (type && SAM_TYPES.has(type)) return 'sam';
  if (type === 'AAA') return 'aaa';
  return 'groundunit';
}

interface Sel { cat: Cat; key: string; entry: UnitDbEntry; }
type PlaceFn = ((lat: number, lng: number) => void) | null;

export function SpawnPanel({ group, profile, onClose, onPlace }: {
  group: GroupSummary; profile: ServerProfile; onClose: () => void;
  onPlace: (fn: PlaceFn, label: string) => void;
}) {
  const dbCache = useRef<Partial<Record<UnitCategory, Record<string, UnitDbEntry>>>>({});
  const [expanded, setExpanded] = useState<Cat | null>('aircraft');
  const [dbState, setDbState] = useState<{ loading: boolean; err?: string }>({ loading: false });
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string | null>(null);
  const [dbVersion, setDbVersion] = useState(0);  // bumped when a DB finishes loading

  const [sel, setSel] = useState<Sel | null>(null);
  const [effect, setEffect] = useState<'smoke' | 'explosion' | null>(null);

  // Config (units)
  const [coalition, setCoalition] = useState<'blue' | 'red'>('blue');
  const [count, setCount] = useState(1);
  const [altFt, setAltFt] = useState(20000);
  const [altType, setAltType] = useState<'AGL' | 'ASL'>('AGL');
  const [role, setRole] = useState('');
  const [loadoutName, setLoadoutName] = useState('');
  const [liveryID, setLiveryID] = useState('');
  const [skill, setSkill] = useState('High');
  const [heading, setHeading] = useState(0);
  const [imgFail, setImgFail] = useState(false);
  const [loadoutOpen, setLoadoutOpen] = useState(false);

  // Effects config
  const [smokeColor, setSmokeColor] = useState('green');
  const [explType, setExplType] = useState('normal');

  const [cmdMsg, setCmdMsg] = useState('');
  const [starred, setStarred] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(STAR_KEY) || '[]'); } catch { return []; }
  });
  const toggleStar = (k: string) => setStarred((prev) => {
    const next = prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k];
    try { localStorage.setItem(STAR_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });

  // Load the DB for the expanded (db-backed) category.
  useEffect(() => {
    const meta = CATS.find((c) => c.id === expanded);
    const dbCat = meta?.db;
    if (!dbCat || dbCache.current[dbCat]) { setDbState({ loading: false }); return; }
    let cancelled = false;
    setDbState({ loading: true });
    getUnitDatabase(group.id, profile.id, dbCat).then((r) => {
      if (cancelled) return;
      if (r.ok && r.data) { dbCache.current[dbCat] = r.data; setDbState({ loading: false }); setDbVersion((n) => n + 1); }
      else setDbState({ loading: false, err: r.error || 'failed to load database' });
    }).catch((e) => { if (!cancelled) setDbState({ loading: false, err: e instanceof Error ? e.message : 'failed' }); });
    return () => { cancelled = true; };
  }, [expanded, group.id, profile.id]);

  // Entries for the currently-expanded category (after the SAM/AAA/ground split).
  const entries = useMemo(() => {
    const meta = CATS.find((c) => c.id === expanded);
    if (!meta?.db) return [] as [string, UnitDbEntry][];
    const data = dbCache.current[meta.db]; if (!data) return [];
    const q = search.trim().toLowerCase();
    return Object.entries(data).filter(([k, v]) => {
      if (expanded === 'sam' || expanded === 'aaa' || expanded === 'groundunit') {
        if (groundBucket(v.type) !== expanded) return false;
      }
      if (roleFilter && isAir(expanded!)) {
        if (!(v.loadouts || []).some((l) => (l.roles || []).includes(roleFilter))) return false;
      }
      if (q && !(k.toLowerCase().includes(q) || (v.label || '').toLowerCase().includes(q))) return false;
      return true;
    }).sort((a, b) => (a[1].label || a[0]).localeCompare(b[1].label || b[0])).slice(0, 200);
  }, [expanded, search, roleFilter, dbVersion]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Role chips (union across the air category's loadouts).
  const roleChips = useMemo(() => {
    const meta = CATS.find((c) => c.id === expanded);
    if (!meta?.db || !isAir(expanded!)) return [] as string[];
    const data = dbCache.current[meta.db]; if (!data) return [];
    const s = new Set<string>();
    for (const v of Object.values(data)) for (const l of v.loadouts || []) for (const r of l.roles || []) if (r) s.add(r);
    return Array.from(s).sort();
  }, [expanded, dbVersion]);  // eslint-disable-line react-hooks/exhaustive-deps

  // Open the config page for a unit, seeding sensible defaults.
  const openUnit = (cat: Cat, key: string, entry: UnitDbEntry) => {
    setImgFail(false); setLoadoutOpen(false); setEffect(null);
    setCount(1); setSkill('High'); setLiveryID(''); setHeading(0); setAltType('AGL');
    setAltFt(cat === 'helicopter' ? 1000 : 20000);
    const roles = Array.from(new Set((entry.loadouts || []).flatMap((l) => l.roles || []).filter(Boolean)));
    const firstRole = roles[0] || '';
    setRole(firstRole);
    const firstLo = (entry.loadouts || []).find((l) => (l.roles || []).includes(firstRole)) || (entry.loadouts || [])[0];
    setLoadoutName(firstLo?.name || '');
    setSel({ cat, key, entry });
  };

  // When the role changes, jump to the first loadout serving it.
  const onRoleChange = (r: string) => {
    setRole(r);
    const lo = (sel?.entry.loadouts || []).find((l) => (l.roles || []).includes(r)) || (sel?.entry.loadouts || [])[0];
    setLoadoutName(lo?.name || '');
  };

  const loadoutsForRole = (sel?.entry.loadouts || []).filter((l) => !role || (l.roles || []).includes(role));
  const currentLoadout = (sel?.entry.loadouts || []).find((l) => l.name === loadoutName);
  const liveries = sel?.entry.liveries || {};

  const run = useCallback(async (command: string, params: Record<string, unknown>, label: string) => {
    setCmdMsg(`${label}…`);
    try { const r = await sendCommand(group.id, profile.id, command, params); setCmdMsg(r.ok ? `✓ ${label} sent` : `✗ ${r.error}`); }
    catch (e) { setCmdMsg(`✗ ${e instanceof Error ? e.message : 'failed'}`); }
  }, [group.id, profile.id]);

  // Report the active place-function up to LiveMap whenever the config changes.
  useEffect(() => {
    if (sel) {
      const cat = sel.cat, entry = sel.entry, n = Math.max(1, count);
      const fn: PlaceFn = (lat, lng) => {
        const air = isAir(cat);
        const one = (): Record<string, unknown> => {
          const u: Record<string, unknown> = { unitType: entry.name || sel.key, location: { lat, lng }, liveryID, skill, heading: heading * Math.PI / 180 };
          if (air) { u.altitude = Math.round(altFt * 0.3048); u.loadout = currentLoadout?.code || ''; }
          return u;
        };
        const units = Array.from({ length: n }, one);
        const params: Record<string, unknown> = { units, coalition, country: '', immediate: false, spawnPoints: 0 };
        if (air) params.airbaseName = '';
        run(SPAWN_CMD[cat], params, `Spawn ${entry.label || sel.key}`);
      };
      onPlace(fn, `Click the map to place ${entry.label || sel.key}${n > 1 ? ` ×${n}` : ''}`);
    } else if (effect === 'smoke') {
      onPlace((lat, lng) => run('smoke', { color: smokeColor, location: { lat, lng } }, `${smokeColor} smoke`), `Click the map: ${smokeColor} smoke`);
    } else if (effect === 'explosion') {
      onPlace((lat, lng) => run('explosion', { explosionType: explType, intensity: 50, location: { lat, lng } }, 'Explosion'), 'Click the map: explosion');
    } else {
      onPlace(null, '');
    }
  }, [sel, effect, coalition, count, altFt, role, loadoutName, liveryID, skill, heading, smokeColor, explType, currentLoadout, onPlace, run]);

  const back = () => { setSel(null); setEffect(null); onPlace(null, ''); };

  // ── Config view ──────────────────────────────────────────────────────────
  if (sel || effect) {
    return (
      <Dock>
        <Header onClose={onClose} onBack={back} title={sel ? (sel.entry.label || sel.key) : effect === 'smoke' ? 'Smoke' : 'Explosion'} />
        <div style={{ overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sel && (() => {
            const e = sel.entry;
            const tags = (e.abilities || '').split(/\s+/).filter(Boolean);
            const air = isAir(sel.cat);
            return <>
              {e.filename && !imgFail && (
                <img src={unitImageUrl(group.id, profile.id, e.filename)} alt={e.label}
                     onError={() => setImgFail(true)}
                     style={{ width: '100%', borderRadius: 6, border: `1px solid ${C.border}`, objectFit: 'cover', maxHeight: 150 }} />
              )}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong style={{ fontSize: 15 }}>{e.label || sel.key}</strong>
                  <button onClick={() => toggleStar(`${sel.cat}:${sel.key}`)} title="Favourite (Starred Spawns)"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, color: starred.includes(`${sel.cat}:${sel.key}`) ? '#ffd24a' : C.dim }}>
                    {starred.includes(`${sel.cat}:${sel.key}`) ? '★' : '☆'}
                  </button>
                </div>
                {e.description && <div style={{ color: C.dim, fontSize: 12, marginTop: 3 }}>{e.description}</div>}
                {tags.length > 0 && <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>{tags.map((t) => <span key={t} style={chip}>{t}</span>)}</div>}
                <div style={{ color: C.dim, fontSize: 10, marginTop: 4, opacity: 0.7 }}>blueprint: {(e.loadouts || []).length} loadouts · {Object.keys(e.liveries || {}).length} liveries</div>
              </div>

              <Row label="Coalition">
                <button onClick={() => setCoalition((c) => c === 'blue' ? 'red' : 'blue')}
                        style={{ ...inp, cursor: 'pointer', width: 70, color: coalition === 'red' ? C.red : C.blue, borderColor: coalition === 'red' ? C.red : C.blue, fontWeight: 600 }}>
                  {coalition.toUpperCase()}
                </button>
              </Row>
              <Row label="Units">
                <Stepper value={count} min={1} max={20} onChange={setCount} />
              </Row>

              {air && <>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: 12, color: C.dim }}>Altitude</span>
                    <div style={{ display: 'flex', gap: 0, border: `1px solid ${C.border}`, borderRadius: 4, overflow: 'hidden' }}>
                      {(['AGL', 'ASL'] as const).map((t) => (
                        <button key={t} onClick={() => setAltType(t)} style={{ ...seg, ...(altType === t ? segOn : {}) }}>{t}</button>
                      ))}
                    </div>
                  </div>
                  <div style={{ color: C.accent, fontWeight: 700, fontSize: 14 }}>{altFt.toLocaleString()} FT</div>
                  <input type="range" min={0} max={sel.cat === 'helicopter' ? 15000 : 45000} step={500} value={altFt}
                         onChange={(ev) => setAltFt(Number(ev.target.value))} style={{ width: '100%' }} />
                </div>
                <Row label="Role">
                  <select value={role} onChange={(ev) => onRoleChange(ev.target.value)} style={{ ...inp, flex: 1 }}>
                    {Array.from(new Set((e.loadouts || []).flatMap((l) => l.roles || []).filter(Boolean))).map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </Row>
                <Row label="Weapons">
                  <select value={loadoutName} onChange={(ev) => setLoadoutName(ev.target.value)} style={{ ...inp, flex: 1 }}>
                    {loadoutsForRole.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
                  </select>
                </Row>
              </>}

              <Row label="Livery">
                <select value={liveryID} onChange={(ev) => setLiveryID(ev.target.value)} style={{ ...inp, flex: 1 }}>
                  <option value="">Default</option>
                  {Object.entries(liveries).map(([id, l]) => <option key={id} value={id}>{l.name || id}</option>)}
                </select>
              </Row>
              <Row label="Skill">
                <select value={skill} onChange={(ev) => setSkill(ev.target.value)} style={{ ...inp, flex: 1 }}>
                  {SKILLS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Row>

              {air && (
                <Row label="Heading">
                  <Stepper value={heading} min={0} max={359} wrap onChange={setHeading} />
                  <HeadingDial value={heading} onChange={setHeading} />
                </Row>
              )}

              {air && currentLoadout && (currentLoadout.items || []).length > 0 && (
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 5 }}>
                  <button onClick={() => setLoadoutOpen((o) => !o)}
                          style={{ width: '100%', textAlign: 'left', background: 'rgba(255,255,255,0.03)', border: 'none', color: C.text, padding: '7px 9px', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', borderRadius: 5 }}>
                    {loadoutOpen ? '▾' : '▸'} Loadout ({(currentLoadout.items || []).length})
                  </button>
                  {loadoutOpen && (
                    <div style={{ padding: '4px 9px 8px', fontSize: 12, color: C.dim }}>
                      {(currentLoadout.items || []).map((it, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '2px 0' }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
                          <span style={{ color: C.text }}>×{it.quantity}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>;
          })()}

          {effect === 'smoke' && (
            <Row label="Colour">
              <select value={smokeColor} onChange={(ev) => setSmokeColor(ev.target.value)} style={{ ...inp, flex: 1 }}>
                {SMOKE_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Row>
          )}
          {effect === 'explosion' && (
            <Row label="Type">
              <select value={explType} onChange={(ev) => setExplType(ev.target.value)} style={{ ...inp, flex: 1 }}>
                {EXPLOSIONS.map((x) => <option key={x.type} value={x.type}>{x.label}</option>)}
              </select>
            </Row>
          )}

          <div style={{ fontSize: 11, color: C.accent }}>Click the map to place.</div>
          {cmdMsg && <div style={{ fontSize: 12, color: cmdMsg.startsWith('✗') ? C.red : C.green }}>{cmdMsg}</div>}
        </div>
      </Dock>
    );
  }

  // ── Browse view ──────────────────────────────────────────────────────────
  const starEntries: { cat: Cat; key: string; entry: UnitDbEntry }[] = [];
  if (expanded === 'starred') {
    for (const sk of starred) {
      const [cat, key] = [sk.slice(0, sk.indexOf(':')) as Cat, sk.slice(sk.indexOf(':') + 1)];
      const meta = CATS.find((c) => c.id === cat);
      const data = meta?.db ? dbCache.current[meta.db] : undefined;
      if (data?.[key]) starEntries.push({ cat, key, entry: data[key] });
    }
  }

  return (
    <Dock>
      <Header onClose={onClose} title="Spawn menu" />
      <div style={{ padding: '10px 12px 0' }}>
        <input placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inp, width: '100%', boxSizing: 'border-box' }} />
      </div>
      <div style={{ overflowY: 'auto', padding: '8px 6px 10px', flex: 1 }}>
        {CATS.map((cat) => {
          const open = expanded === cat.id;
          return (
            <div key={cat.id}>
              <button onClick={() => { setExpanded(open ? null : cat.id); setRoleFilter(null); }}
                      style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, background: 'none', border: 'none', borderBottom: `1px solid ${C.border}`, color: C.text, padding: '11px 8px', cursor: 'pointer', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', textAlign: 'left' }}>
                <span>{cat.label}</span><span style={{ color: C.dim }}>{open ? '▾' : '‹'}</span>
              </button>
              {open && (
                <div style={{ padding: '6px 4px 10px' }}>
                  {cat.id === 'effects' && (['smoke', 'explosion'] as const).map((ef) => (
                    <UnitRow key={ef} label={ef === 'smoke' ? 'Smoke' : 'Explosion'} icon={ef === 'smoke' ? '💨' : '💥'} onClick={() => { setEffect(ef); }} />
                  ))}
                  {cat.id === 'starred' && (starEntries.length === 0
                    ? <div style={{ color: C.dim, fontSize: 12, padding: 8 }}>No starred units yet. ★ a unit on its config page.</div>
                    : starEntries.map(({ cat: c2, key, entry }) => (
                      <UnitRow key={`${c2}:${key}`} label={entry.label || key} icon={catIcon(c2)} badge={badgeFor(entry)} onClick={() => openUnit(c2, key, entry)} />
                    )))}
                  {cat.db && <>
                    {dbState.loading && <div style={{ color: C.dim, fontSize: 12, padding: 8 }}>Loading database…</div>}
                    {dbState.err && <div style={{ color: C.red, fontSize: 12, padding: 8 }}>✗ {dbState.err}</div>}
                    {isAir(cat.id) && roleChips.length > 0 && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                        {roleChips.map((r) => (
                          <button key={r} onClick={() => setRoleFilter(roleFilter === r ? null : r)}
                                  style={{ ...chip, cursor: 'pointer', ...(roleFilter === r ? { background: C.accentDim, borderColor: C.accent, color: '#cfe6ff' } : {}) }}>{r}</button>
                        ))}
                      </div>
                    )}
                    {entries.map(([key, entry]) => (
                      <UnitRow key={key} label={entry.label || key} icon={catIcon(cat.id)} badge={badgeFor(entry)} onClick={() => openUnit(cat.id, key, entry)} />
                    ))}
                    {!dbState.loading && cat.db && entries.length === 0 && !dbState.err && <div style={{ color: C.dim, fontSize: 12, padding: 8 }}>No matches.</div>}
                  </>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Dock>
  );
}

// ── small pieces ─────────────────────────────────────────────────────────
function Dock({ children }: { children: React.ReactNode }) {
  return <div style={{ position: 'absolute', top: 56, left: 56, bottom: 44, width: 300, zIndex: 3, display: 'flex', flexDirection: 'column', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, boxShadow: '0 6px 20px rgba(0,0,0,0.45)', overflow: 'hidden' }}>{children}</div>;
}
function Header({ title, onClose, onBack }: { title: string; onClose: () => void; onBack?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', borderBottom: `1px solid ${C.border}`, background: 'rgba(255,255,255,0.03)' }}>
      {onBack && <button onClick={onBack} title="Back" style={iconBtn}>←</button>}
      <span style={{ fontSize: 13, fontWeight: 700, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
      <button onClick={onClose} title="Close" style={iconBtn}>×</button>
    </div>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, color: C.dim, width: 64, flexShrink: 0 }}>{label}</span>
      {children}
    </div>
  );
}
function UnitRow({ label, icon, badge, onClick }: { label: string; icon: string; badge?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', color: C.text, padding: '6px 8px', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', textAlign: 'left', borderRadius: 4 }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}>
      <span style={{ width: 18, textAlign: 'center', flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {badge && <span style={chip}>{badge}</span>}
      <span style={{ color: C.dim }}>›</span>
    </button>
  );
}
function Stepper({ value, min, max, wrap, onChange }: { value: number; min: number; max: number; wrap?: boolean; onChange: (n: number) => void }) {
  const clamp = (n: number) => wrap ? ((n - min + (max - min + 1)) % (max - min + 1)) + min : Math.max(min, Math.min(max, n));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, border: `1px solid ${C.border}`, borderRadius: 4, overflow: 'hidden' }}>
      <button onClick={() => onChange(clamp(value - 1))} style={stepBtn}>−</button>
      <span style={{ minWidth: 36, textAlign: 'center', fontSize: 13 }}>{value}</span>
      <button onClick={() => onChange(clamp(value + 1))} style={stepBtn}>+</button>
    </div>
  );
}
function HeadingDial({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const set = (e: React.MouseEvent | MouseEvent) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const deg = (Math.atan2(e.clientX - cx, -(e.clientY - cy)) * 180 / Math.PI + 360) % 360;
    onChange(Math.round(deg));
  };
  const onDown = (e: React.MouseEvent) => {
    set(e);
    const move = (ev: MouseEvent) => set(ev);
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
  const R = 16;  // bug orbit radius
  const dx = Math.sin(value * Math.PI / 180) * R;
  const dy = -Math.cos(value * Math.PI / 180) * R;
  return (
    <div ref={ref} onMouseDown={onDown} title="Drag to set heading"
         style={{ width: 46, height: 46, borderRadius: '50%', boxSizing: 'border-box', border: `1px solid ${C.borderHi}`, position: 'relative', cursor: 'grab', background: 'radial-gradient(circle, rgba(74,158,255,0.10), rgba(0,0,0,0.35))', flexShrink: 0 }}>
      <span style={{ position: 'absolute', top: 1, left: '50%', transform: 'translateX(-50%)', fontSize: 7, color: C.dim }}>N</span>
      {/* needle toward heading */}
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: 2, height: R, background: C.accent, borderRadius: 1, transformOrigin: 'bottom center', transform: `translate(-50%,-100%) rotate(${value}deg)` }} />
      {/* centre hub */}
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: 4, height: 4, borderRadius: '50%', background: C.text, transform: 'translate(-50%,-50%)' }} />
      {/* round heading bug on the rim */}
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: 7, height: 7, borderRadius: '50%', background: C.accent, border: '1px solid #0b0f16', transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))` }} />
    </div>
  );
}

function catIcon(c: Cat): string {
  return c === 'aircraft' ? '✈' : c === 'helicopter' ? '🚁' : c === 'sam' ? '📡' : c === 'aaa' ? '🎯' : c === 'navyunit' ? '🚢' : '🪖';
}
function badgeFor(e: UnitDbEntry): string | undefined {
  const roles = Array.from(new Set((e.loadouts || []).flatMap((l) => l.roles || []).filter((r) => r && r !== 'No task')));
  return roles[0];
}

const inp: React.CSSProperties = { background: 'rgba(0,0,0,0.35)', border: `1px solid ${C.border}`, color: C.text, padding: '5px 7px', fontSize: 12, fontFamily: 'inherit', borderRadius: 4, outline: 'none' };
const chip: React.CSSProperties = { background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.border}`, borderRadius: 10, padding: '1px 8px', fontSize: 11, color: C.dim, whiteSpace: 'nowrap' };
const iconBtn: React.CSSProperties = { background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 16, lineHeight: 1, fontFamily: 'inherit' };
const stepBtn: React.CSSProperties = { background: 'rgba(255,255,255,0.04)', border: 'none', color: C.text, cursor: 'pointer', fontSize: 14, width: 26, height: 24, fontFamily: 'inherit' };
const seg: React.CSSProperties = { background: 'transparent', border: 'none', color: C.dim, padding: '3px 9px', cursor: 'pointer', fontSize: 11, fontFamily: 'inherit' };
const segOn: React.CSSProperties = { background: C.accentDim, color: '#cfe6ff' };
