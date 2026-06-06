/**
 * Live mode — the "DM terminal" entry flow (Phase A frontend).
 *
 * Discord login gate → create/join a group (invite code) → pick a group's
 * shared server profile → "Enter terminal". Multi-tenant: each group manages
 * its own Olympus/LotATC connection profiles (backend services/groups.py).
 *
 * The terminal itself (live picture + control) is Phases B–D; for now
 * "Enter terminal" lands on a stub that confirms the selected server. The
 * Olympus relay (test/connect) gets wired in next.
 */

import { useEffect, useState, useCallback } from 'react';
import { useAuthStore, discordDisplayName } from '../../store/authStore';
import { LiveMap } from './LiveMap';
import {
  listGroups, createGroup, joinGroup, listProfiles, createProfile, updateProfile, deleteProfile,
  createInvite, listMembers, removeMember, setMemberRole, testProfile, getTelemetry, getTelemetryHex,
  sendCommand, ApiError, ROLE_LABEL, can,
  type GroupSummary, type ServerProfile, type GroupMember, type MeInfo, type ProfileInput, type LiveRole,
} from '../../api/groups';

const ROLE_OPTS: LiveRole[] = ['admin', 'commander', 'jtac', 'atc', 'operator'];

export function LiveTerminal() {
  const user = useAuthStore((s) => s.user);
  const checked = useAuthStore((s) => s.checked);
  const checkMe = useAuthStore((s) => s.checkMe);

  useEffect(() => { if (!checked) checkMe(); }, [checked, checkMe]);

  if (!checked) return <Centered><span style={dim}>Loading…</span></Centered>;
  if (!user) return <LoginPrompt name="" />;
  return <GroupsView />;
}

// ---------------------------------------------------------------------------
function LoginPrompt({ name }: { name: string }) {
  return (
    <Centered>
      <div style={{ ...card, maxWidth: 420, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>🛰</div>
        <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>Live Server Terminal</h2>
        <p style={{ ...dim, lineHeight: 1.6, margin: '0 0 18px' }}>
          The Live terminal connects to your group's DCS / Olympus server. Log in with
          Discord to access your group{name ? `, ${name}` : ''} and its servers.
        </p>
        <a href="/api/auth/discord/login" style={{ ...btnPrimary, display: 'inline-block', textDecoration: 'none' }}>
          Log in with Discord
        </a>
      </div>
    </Centered>
  );
}

// ---------------------------------------------------------------------------
function GroupsView() {
  const user = useAuthStore((s) => s.user);
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [me, setMe] = useState<MeInfo | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unconfigured' | 'error'>('loading');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const { groups: gs, me: meInfo } = await listGroups();
      setGroups(gs);
      setMe(meInfo);
      setSelected((cur) => cur && gs.some((g) => g.id === cur) ? cur : (gs[0]?.id ?? null));
      setStatus('ready');
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) { setStatus('unconfigured'); return; }
      setError(e instanceof Error ? e.message : 'Failed to load groups');
      setStatus('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (status === 'loading') return <Centered><span style={dim}>Loading groups…</span></Centered>;
  if (status === 'unconfigured') return (
    <Centered>
      <div style={{ ...card, maxWidth: 440, textAlign: 'center' }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 17 }}>Live not available yet</h2>
        <p style={{ ...dim, lineHeight: 1.6, margin: 0 }}>
          This server hasn't been configured for the Live terminal. (Backend needs Supabase
          + the encryption key.) Planning and Editing work as normal.
        </p>
      </div>
    </Centered>
  );
  if (status === 'error') return (
    <Centered><div style={{ ...card, maxWidth: 440, borderColor: '#d95050', color: '#d95050' }}>✗ {error}</div></Centered>
  );

  const selectedGroup = groups.find((g) => g.id === selected) || null;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', color: '#e0e0e0' }}>
      {/* Top bar: group selector + identity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px', borderBottom: '1px solid #3a3a3a', flexShrink: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#9cd0ff', letterSpacing: 0.5 }}>LIVE</span>
        {groups.length > 0 && (
          <select
            value={selected ?? ''}
            onChange={(e) => setSelected(e.target.value)}
            style={{ ...input, width: 'auto', minWidth: 180 }}
          >
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name} ({ROLE_LABEL[g.role] || g.role})</option>
            ))}
          </select>
        )}
        <div style={{ marginLeft: 'auto', fontSize: 12, color: '#888' }}>
          {discordDisplayName(user)}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 18 }}>
        {groups.length === 0
          ? <GroupPicker onChanged={load} />
          : selectedGroup && me
            ? <GroupDashboard group={selectedGroup} me={me} onChanged={load} />
            : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function GroupPicker({ onChanged }: { onChanged: () => void }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const doCreate = async () => {
    if (!name.trim()) return;
    setBusy(true); setErr('');
    try { await createGroup(name.trim()); onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  };
  const doJoin = async () => {
    if (!code.trim()) return;
    setBusy(true); setErr('');
    try { await joinGroup(code.trim()); onChanged(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ maxWidth: 520, margin: '0 auto' }}>
      <p style={{ ...dim, lineHeight: 1.6 }}>
        You're not in a group yet. Create one for your squadron (you'll be its admin),
        or join an existing one with an invite code.
      </p>
      <div style={card}>
        <h3 style={h3}>Create a group</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={{ ...input, flex: 1 }} placeholder="Squadron / group name" value={name}
                 onChange={(e) => setName(e.target.value)} />
          <button style={btnPrimary} onClick={doCreate} disabled={busy || !name.trim()}>Create</button>
        </div>
      </div>
      <div style={{ ...card, marginTop: 12 }}>
        <h3 style={h3}>Join with a code</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={{ ...input, flex: 1 }} placeholder="Invite code" value={code}
                 onChange={(e) => setCode(e.target.value)} />
          <button style={btn} onClick={doJoin} disabled={busy || !code.trim()}>Join</button>
        </div>
      </div>
      {err && <div style={errBox}>✗ {err}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
function GroupDashboard({ group, me, onChanged }: { group: GroupSummary; me: MeInfo; onChanged: () => void }) {
  const isAdmin = group.role === 'admin';
  const [profiles, setProfiles] = useState<ServerProfile[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [entered, setEntered] = useState<ServerProfile | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const reload = useCallback(async () => {
    setErr('');
    try {
      setProfiles((await listProfiles(group.id)).profiles);
      setMembers((await listMembers(group.id)).members);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed to load'); }
  }, [group.id]);

  useEffect(() => { reload(); setEntered(null); }, [reload]);

  if (entered) return <Terminal group={group} profile={entered} onExit={() => setEntered(null)} />;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 2px', fontSize: 18 }}>{group.name}</h2>
      <p style={{ ...dim, margin: '0 0 16px', fontSize: 12 }}>You are {ROLE_LABEL[group.role] || group.role}.</p>

      {/* Server profiles */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={h3}>Servers</h3>
      </div>
      {profiles.length === 0 && <p style={dim}>No servers yet.{isAdmin ? ' Add one below.' : ''}</p>}
      {profiles.map((p) => (
        editingId === p.id ? (
          <ProfileForm key={p.id} gid={group.id} profile={p}
                       onDone={() => { setEditingId(null); reload(); }}
                       onCancel={() => setEditingId(null)} />
        ) : (
          <div key={p.id} style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              <div style={{ ...dim, fontSize: 12 }}>
                Olympus {p.olympusHost || '—'}:{p.olympusPort ?? 3000}
                {p.lotatcUrl ? ` · LotATC ${p.lotatcUrl}` : ''}
                {p.hasPassword ? ' · 🔒' : ''}
              </div>
            </div>
            <TestButton gid={group.id} pid={p.id} />
            <button style={btnPrimary} onClick={() => setEntered(p)}>Enter terminal</button>
            {isAdmin && <button style={btn} onClick={() => setEditingId(p.id)}>Edit</button>}
            {isAdmin && (
              <button style={{ ...btn, color: '#d95050', borderColor: '#5a2a2a' }}
                      onClick={async () => { await deleteProfile(group.id, p.id); reload(); }}>Delete</button>
            )}
          </div>
        )
      ))}

      {isAdmin && editingId === null && <AddServer gid={group.id} onAdded={reload} />}

      {/* Admin: invites + members */}
      {isAdmin && (
        <>
          <InvitePanel gid={group.id} />
          <h3 style={{ ...h3, marginTop: 22 }}>Members</h3>
          {members.map((m) => (
            <div key={m.userId} style={{ ...card, display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, padding: '8px 14px' }}>
              <span style={{ flex: 1 }}>{m.username || m.userId.slice(0, 8)}{m.userId === me.id ? ' (you)' : ''}</span>
              <select value={ROLE_OPTS.includes(m.role as LiveRole) ? m.role : 'operator'}
                      title="Mission role"
                      onChange={async (e) => { try { await setMemberRole(group.id, m.userId, e.target.value as LiveRole); } catch (err) { alert(err instanceof Error ? err.message : 'failed'); } reload(); }}
                      style={{ background: '#1a1a1a', border: '1px solid #4a4a4a', color: '#e0e0e0', borderRadius: 4, padding: '3px 6px', fontSize: 12, fontFamily: 'inherit' }}>
                {ROLE_OPTS.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
              {m.userId !== me.id && (
                <button style={{ ...btn, padding: '4px 10px', color: '#d95050', borderColor: '#5a2a2a' }}
                        onClick={async () => { await removeMember(group.id, m.userId); reload(); }}>Remove</button>
              )}
            </div>
          ))}
        </>
      )}

      {/* Leave (non-admins / self) */}
      <div style={{ marginTop: 22, borderTop: '1px solid #2e2e2e', paddingTop: 12 }}>
        <button style={{ ...btn, color: '#d95050', borderColor: '#5a2a2a' }}
                onClick={async () => { await removeMember(group.id, me.id); onChanged(); }}>
          Leave group
        </button>
      </div>

      {err && <div style={errBox}>✗ {err}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
function AddServer({ gid, onAdded }: { gid: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  if (!open) return <button style={{ ...btn, marginTop: 4 }} onClick={() => setOpen(true)}>+ Add server</button>;
  return <ProfileForm gid={gid} onDone={() => { setOpen(false); onAdded(); }} onCancel={() => setOpen(false)} />;
}

/** Add OR edit a server profile. In edit mode the password field is left blank
 *  and only sent if the admin types a new one (so editing other fields doesn't
 *  wipe the stored password). */
function ProfileForm({ gid, profile, onDone, onCancel }: {
  gid: string; profile?: ServerProfile; onDone: () => void; onCancel: () => void;
}) {
  const isEdit = !!profile;
  const [f, setF] = useState({
    name: profile?.name ?? '',
    olympusHost: profile?.olympusHost ?? '',
    olympusPort: String(profile?.olympusPort ?? 3000),
    olympusPassword: '',
    lotatcUrl: profile?.lotatcUrl ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const up = (patch: Partial<typeof f>) => setF((s) => ({ ...s, ...patch }));

  const submit = async () => {
    if (!f.name.trim()) return;
    setBusy(true); setErr('');
    try {
      const data: ProfileInput = {
        name: f.name.trim(),
        olympusHost: f.olympusHost.trim() || undefined,
        olympusPort: Number(f.olympusPort) || 3000,
        lotatcUrl: f.lotatcUrl.trim() || undefined,
      };
      if (f.olympusPassword) data.olympusPassword = f.olympusPassword; // only if typed
      if (isEdit) await updateProfile(gid, profile!.id, data);
      else await createProfile(gid, data);
      onDone();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ ...card, marginBottom: 8 }}>
      <h3 style={h3}>{isEdit ? 'Edit server' : 'Add server'}</h3>
      <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 8, alignItems: 'center' }}>
        <label style={lbl}>Name</label>
        <input style={input} value={f.name} placeholder="Main Server" onChange={(e) => up({ name: e.target.value })} />
        <label style={lbl}>Olympus host</label>
        <input style={input} value={f.olympusHost} placeholder="IP or hostname (no http://)" onChange={(e) => up({ olympusHost: e.target.value })} />
        <label style={lbl}>Olympus port</label>
        <input style={{ ...input, width: 110 }} value={f.olympusPort} onChange={(e) => up({ olympusPort: e.target.value.replace(/[^0-9]/g, '') })} />
        <label style={lbl}>Role password</label>
        <input style={input} type="password" value={f.olympusPassword}
               placeholder={isEdit ? '(unchanged — leave blank to keep)' : 'Game Master password'}
               onChange={(e) => up({ olympusPassword: e.target.value })} />
        <label style={lbl}>LotATC URL</label>
        <input style={input} value={f.lotatcUrl} placeholder="(optional) JSON export URL" onChange={(e) => up({ lotatcUrl: e.target.value })} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button style={btnPrimary} onClick={submit} disabled={busy || !f.name.trim()}>
          {isEdit ? 'Save changes' : 'Save'}
        </button>
        <button style={btn} onClick={onCancel}>Cancel</button>
      </div>
      <p style={{ ...dim, fontSize: 11, margin: '8px 0 0' }}>
        Olympus port is usually <strong>3000</strong> (the web port); host is just the IP/hostname.
      </p>
      {err && <div style={errBox}>✗ {err}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
function InvitePanel({ gid }: { gid: string }) {
  const [code, setCode] = useState('');
  const [role, setRole] = useState<LiveRole>('operator');
  const [err, setErr] = useState('');

  const gen = async () => {
    setErr('');
    try { setCode((await createInvite(gid, { role })).code); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
  };

  return (
    <div style={{ ...card, marginTop: 14 }}>
      <h3 style={h3}>Invite members</h3>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select style={{ ...input, width: 'auto' }} value={role} onChange={(e) => setRole(e.target.value as LiveRole)}>
          {ROLE_OPTS.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        <button style={btn} onClick={gen}>Generate code</button>
        {code && (
          <code style={{ background: '#111', border: '1px solid #3a3a3a', padding: '6px 10px', borderRadius: 4, fontSize: 14, color: '#9cd0ff', userSelect: 'all' }}>
            {code}
          </code>
        )}
      </div>
      {code && <p style={{ ...dim, fontSize: 11, margin: '8px 0 0' }}>Share this code — they enter it under "Join with a code".</p>}
      {err && <div style={errBox}>✗ {err}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
function TestButton({ gid, pid }: { gid: string; pid: string }) {
  const [s, setS] = useState<{ kind: 'idle' | 'testing' | 'ok' | 'fail'; msg?: string }>({ kind: 'idle' });
  const run = async () => {
    setS({ kind: 'testing' });
    try {
      const r = await testProfile(gid, pid);
      setS(r.ok ? { kind: 'ok' } : { kind: 'fail', msg: r.error || 'Failed' });
    } catch (e) {
      setS({ kind: 'fail', msg: e instanceof Error ? e.message : 'Failed' });
    }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <button style={btn} onClick={run} disabled={s.kind === 'testing'}>
        {s.kind === 'testing' ? 'Testing…' : 'Test'}
      </button>
      {s.kind === 'ok' && <span style={{ color: '#3fb950', fontSize: 12, whiteSpace: 'nowrap' }}>✓ ok</span>}
      {s.kind === 'fail' && (
        <span title={s.msg} style={{ color: '#d95050', fontSize: 12, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          ✗ {s.msg}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
type Feed<T> = { loading: boolean; data?: T; err?: string };

function scalarEntries(obj: unknown): [string, string][] {
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj as Record<string, unknown>)
    .filter(([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v))
    .map(([k, v]) => [k, String(v)]);
}

function unitsInfo(data: any): { count: number | null; note?: string; rows: any[] } {
  if (data && data._nonJson) return { count: null, note: `binary feed (${data.bytes} bytes) — decoder TBD`, rows: [] };
  if (Array.isArray(data)) return { count: data.length, rows: data.slice(0, 50) };
  if (data && typeof data === 'object') {
    const vals = Object.values(data);
    return { count: vals.length, rows: vals.slice(0, 50) };
  }
  return { count: null, note: 'no data', rows: [] };
}

const COALITION: Record<number, string> = { 0: 'NEU', 1: 'RED', 2: 'BLUE' };

function unitRow(u: any) {
  const name = u?.unitName ?? u?.name ?? u?.ID ?? u?.id ?? '—';
  const type = u?.name ?? u?.type ?? '—';                       // DCS type, e.g. FA-18C_hornet
  const cn = u?.coalition ?? u?.coalitionID;
  const coal = typeof cn === 'number' ? (COALITION[cn] ?? String(cn)) : '—';
  const lat = u?.position?.lat ?? u?.latitude ?? u?.lat;
  const lng = u?.position?.lng ?? u?.longitude ?? u?.lng ?? u?.lon;
  const pos = (typeof lat === 'number' && typeof lng === 'number')
    ? `${lat.toFixed(3)}, ${lng.toFixed(3)}` : '—';
  return { name: String(name), type: String(type), coal, pos };
}

function Terminal({ group, profile, onExit }: { group: GroupSummary; profile: ServerProfile; onExit: () => void }) {
  const [mission, setMission] = useState<Feed<unknown>>({ loading: true });
  const [live, setLive] = useState(false);
  const [units, setUnits] = useState<Feed<any> | null>(null);
  // v1.19.46 — default to the map view. The 'table' view is a low-level
  // mission-fields dump + raw telemetry inspector that was useful for
  // debugging the Olympus bridge in Phase A but reads as "debug screen"
  // to a controller who just clicked Enter terminal. Map is what they
  // actually want; Table is still one click away on the toggle.
  const [view, setView] = useState<'table' | 'map'>('map');

  // Heartbeat: poll the mission resource (small JSON) every 5s.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const r = await getTelemetry(group.id, profile.id, 'mission');
        if (cancelled) return;
        if (r.ok) { setMission({ loading: false, data: r.data }); setLive(true); }
        else { setMission({ loading: false, err: r.error }); setLive(false); }
      } catch (e) {
        if (!cancelled) { setMission({ loading: false, err: e instanceof Error ? e.message : 'Failed' }); setLive(false); }
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [group.id, profile.id]);

  const loadUnits = async () => {
    setUnits({ loading: true });
    try {
      const r = await getTelemetry(group.id, profile.id, 'units');
      setUnits(r.ok ? { loading: false, data: r.data } : { loading: false, err: r.error });
    } catch (e) {
      setUnits({ loading: false, err: e instanceof Error ? e.message : 'Failed' });
    }
  };

  const canEffects = can(group.role, 'effects');
  const canDelete = can(group.role, 'delete');
  const canAct = canEffects || canDelete;
  const [cmdMsg, setCmdMsg] = useState('');
  const runCmd = async (command: string, params: Record<string, unknown>, label: string, refresh = false) => {
    setCmdMsg(`${label}…`);
    try {
      const r = await sendCommand(group.id, profile.id, command, params);
      setCmdMsg(r.ok ? `✓ ${label} sent` : `✗ ${r.error}`);
      if (r.ok && refresh) setTimeout(loadUnits, 800);
    } catch (e) {
      setCmdMsg(`✗ ${e instanceof Error ? e.message : 'Failed'}`);
    }
  };

  const [sample, setSample] = useState<{ loading: boolean; hex?: string; bytes?: number; err?: string } | null>(null);
  const grabSample = async () => {
    setSample({ loading: true });
    try {
      const r = await getTelemetryHex(group.id, profile.id, 'units');
      setSample(r.ok ? { loading: false, hex: r.hex, bytes: r.bytes } : { loading: false, err: r.error });
    } catch (e) {
      setSample({ loading: false, err: e instanceof Error ? e.message : 'Failed' });
    }
  };

  const missionRows = scalarEntries(mission.data);
  const u = units?.data !== undefined ? unitsInfo(units.data) : null;

  return (
    <div style={{ maxWidth: view === 'map' ? 1700 : 760, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <button style={btn} onClick={onExit}>← Back to {group.name}</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginLeft: 'auto' }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: live ? '#3fb950' : '#d95050', boxShadow: live ? '0 0 5px #3fb950' : 'none' }} />
          <span style={{ fontSize: 12, color: live ? '#3fb950' : '#d95050' }}>{live ? 'Live' : 'No signal'}</span>
        </div>
      </div>

      <h2 style={{ margin: '0 0 2px', fontSize: 18 }}>{profile.name}</h2>
      <p style={{ ...dim, margin: '0 0 12px', fontSize: 12 }}>
        Olympus {profile.olympusHost || '—'}:{profile.olympusPort ?? 3000}
      </p>

      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {(['table', 'map'] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} style={{
            ...btn, background: view === v ? 'rgba(74,143,212,0.15)' : '#333',
            borderColor: view === v ? '#4a8fd4' : '#4a4a4a', color: view === v ? '#9cd0ff' : '#e0e0e0',
          }}>{v === 'table' ? 'Table' : 'Map'}</button>
        ))}
      </div>

      {view === 'map' ? (
        <LiveMap group={group} profile={profile} />
      ) : (
      <>
      {/* Mission heartbeat */}
      <h3 style={h3}>Mission</h3>
      <div style={{ ...card, marginBottom: 14 }}>
        {mission.loading && <span style={dim}>Connecting…</span>}
        {mission.err && <span style={{ color: '#d95050', fontSize: 13 }}>✗ {mission.err}</span>}
        {!mission.err && missionRows.length === 0 && !mission.loading && <span style={dim}>Connected (no mission fields).</span>}
        {missionRows.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', fontSize: 13, padding: '3px 0' }}>
            <span style={{ width: 160, color: '#888', flexShrink: 0 }}>{k}</span>
            <span style={{ color: '#e0e0e0' }}>{v}</span>
          </div>
        ))}
      </div>

      {/* Units */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h3 style={{ ...h3, margin: 0 }}>Units</h3>
        <button style={btn} onClick={loadUnits} disabled={units?.loading}>
          {units?.loading ? 'Loading…' : 'Refresh units'}
        </button>
        {u?.count != null && <span style={{ ...dim, fontSize: 12 }}>{u.count} units</span>}
        {cmdMsg && <span style={{ fontSize: 12, marginLeft: 'auto', color: cmdMsg.startsWith('✗') ? '#d95050' : '#3fb950' }}>{cmdMsg}</span>}
      </div>
      {canAct && <p style={{ ...dim, fontSize: 11, margin: '4px 0 0' }}>{canEffects && '💨 drops green smoke at a unit (safe). '}{canDelete && '✕ deletes it from the live mission.'}</p>}
      <div style={{ ...card, marginTop: 8 }}>
        {!units && <span style={dim}>Click "Refresh units" to pull the live unit picture.</span>}
        {units?.err && <span style={{ color: '#d95050', fontSize: 13 }}>✗ {units.err}</span>}
        {u?.note && <span style={dim}>{u.note}</span>}
        {u && u.rows.length > 0 && (
          <div style={{ fontSize: 12 }}>
            <div style={{ display: 'flex', color: '#888', borderBottom: '1px solid #3a3a3a', padding: '4px 0' }}>
              <span style={{ flex: 1 }}>Name</span><span style={{ width: 56 }}>Side</span>
              <span style={{ width: 140 }}>Type</span><span style={{ width: 130 }}>Position</span>
              {canAct && <span style={{ width: 78 }}>Actions</span>}
            </div>
            {u.rows.map((raw: any, i: number) => {
              const r = unitRow(raw);
              const pos = raw?.position;
              const hasPos = pos && typeof pos.lat === 'number';
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', padding: '3px 0', borderBottom: '1px solid #2e2e2e' }}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                  <span style={{ width: 56, color: r.coal === 'RED' ? '#d95050' : r.coal === 'BLUE' ? '#5a9fd4' : '#aaa' }}>{r.coal}</span>
                  <span style={{ width: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.type}</span>
                  <span style={{ width: 130 }}>{r.pos}</span>
                  {canAct && (
                    <span style={{ width: 78, display: 'flex', gap: 4 }}>
                      {canEffects && hasPos && raw.olympusID != null && (
                        <button title="Drop green smoke at this unit (safe test)" style={miniBtn}
                                onClick={() => runCmd('smoke', { color: 'green', location: { lat: pos.lat, lng: pos.lng } }, 'Smoke')}>💨</button>
                      )}
                      {canDelete && raw.olympusID != null && (
                        <button title="Delete this unit from the live mission" style={{ ...miniBtn, color: '#d95050' }}
                                onClick={() => { if (window.confirm(`Delete "${r.name}" from the LIVE mission?`)) runCmd('deleteUnit', { ID: raw.olympusID, explosion: false, explosionType: '', immediate: true }, 'Delete', true); }}>✕</button>
                      )}
                    </span>
                  )}
                </div>
              );
            })}
            {u.count != null && u.count > u.rows.length && <div style={{ ...dim, paddingTop: 6 }}>…and {u.count - u.rows.length} more</div>}
          </div>
        )}
      </div>

      {/* Debug: capture a raw sample of the binary units feed for decoding. */}
      <div style={{ marginTop: 18, borderTop: '1px dashed #3a3a3a', paddingTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ ...dim, fontSize: 12 }}>Decoder dev:</span>
          <button style={btn} onClick={grabSample} disabled={sample?.loading}>
            {sample?.loading ? 'Capturing…' : 'Capture raw units sample'}
          </button>
          {sample?.bytes != null && <span style={{ ...dim, fontSize: 12 }}>{sample.bytes} bytes total</span>}
        </div>
        {sample?.err && <div style={errBox}>✗ {sample.err}</div>}
        {sample?.hex && (
          <>
            <p style={{ ...dim, fontSize: 11, margin: '8px 0 4px' }}>
              Select all + copy this and paste it back to Claude:
            </p>
            <textarea readOnly value={sample.hex} onFocus={(e) => e.currentTarget.select()}
                      style={{ width: '100%', height: 120, background: '#111', color: '#9cd0ff',
                               border: '1px solid #3a3a3a', borderRadius: 4, fontFamily: 'monospace',
                               fontSize: 11, padding: 8, resize: 'vertical' }} />
          </>
        )}
      </div>

      <p style={{ ...dim, fontSize: 11, marginTop: 14 }}>
        Auto-refreshing live picture. Switch to <strong>Map</strong> for the tactical view; admin actions drop smoke / delete a unit.
      </p>
      </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, color: '#e0e0e0' }}>
      {children}
    </div>
  );
}

const dim: React.CSSProperties = { color: '#aaaaaa' };
const card: React.CSSProperties = { background: '#222222', border: '1px solid #3a3a3a', borderRadius: 6, padding: '14px 16px' };
const h3: React.CSSProperties = { margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: '#cccccc', letterSpacing: 0.4, textTransform: 'uppercase' };
const lbl: React.CSSProperties = { fontSize: 13, color: '#aaaaaa' };
const input: React.CSSProperties = { background: '#1a1a1a', border: '1px solid #4a4a4a', color: '#e0e0e0', padding: '7px 10px', fontSize: 14, fontFamily: 'inherit', borderRadius: 4 };
const btn: React.CSSProperties = { background: '#333333', border: '1px solid #4a4a4a', borderRadius: 4, color: '#e0e0e0', padding: '8px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'inherit' };
const miniBtn: React.CSSProperties = { background: '#2a2a2a', border: '1px solid #4a4a4a', borderRadius: 3, color: '#e0e0e0', padding: '1px 6px', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' };
const btnPrimary: React.CSSProperties = { background: '#2a3a4a', border: '1px solid #4a8fd4', borderRadius: 4, color: '#9cd0ff', padding: '8px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit' };
const errBox: React.CSSProperties = { marginTop: 12, padding: '8px 12px', border: '1px solid #d95050', color: '#d95050', background: '#1c1c1c', fontSize: 13, borderRadius: 4 };
