import { useCallback, useRef, useState } from 'react';
import { uploadMission } from '../api/client';
import { useMissionStore } from '../store/missionStore';
import { useGoalsStore } from '../store/goalsStore';
import { useDmpiStore } from '../store/dmpiStore';
import { useVisibilityStore } from '../store/visibilityStore';
import { setActiveTheater } from '../projection/dcsProjection';
import { VERSION } from '../version';
import { useAiStore } from '../ai/aiStore';
import { useAuthStore, discordDisplayName, discordAvatarUrl } from '../store/authStore';
import { AiSettingsPanel } from './AiSettingsPanel';

export function UploadPanel({ onLoaded }: { onLoaded?: () => void } = {}) {
  const loadMission = useMissionStore((s) => s.loadMission);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const aiProvider = useAiStore((s) => s.provider);
  const aiAnthropicKey = useAiStore((s) => s.anthropicKey);
  const aiGeminiKey = useAiStore((s) => s.geminiKey);
  // React 19's useSyncExternalStore rejects selectors that return new
  // references each call — pick scalars only, derive at the JSX level.
  const lastTestOk = useAiStore((s) => s.lastTestOk[s.provider]);
  const lastTestedAt = useAiStore((s) => s.lastTestedAt[s.provider]);
  const aiKey = aiProvider === 'anthropic' ? aiAnthropicKey : aiGeminiKey;
  const [aiOpen, setAiOpen] = useState(false);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const handleFile = useCallback(
    async (file: File) => {
      setLoading(true);
      setError(null);
      try {
        const data = await uploadMission(file);
        setActiveTheater(data.theater);
        loadMission(data);
        // Seed the Mission Goals store from whatever the .miz had in
        // its `["goals"]` block. Closes the round-trip the writer
        // shipped in v0.9.13 — re-uploading a planner-generated mission
        // now shows the existing goals instead of a blank tab.
        useGoalsStore.getState().setAll(data.missionGoals || []);
        // Same pattern for DMPIs — read out of the planner-private
        // `["plannerDmpis"]` key (v0.9.15). DCS-ME-authored missions
        // have no key so this is a no-op for fresh uploads.
        useDmpiStore.getState().setAll(data.plannerDmpis || []);
        // Visibility filter (v0.9.26) — seed the per-group hidden set
        // from the mission's `["plannerHiddenGroups"]`. Same no-op
        // semantics for DCS-ME-authored / un-touched missions.
        useVisibilityStore.getState().setAll(data.plannerHiddenGroups || []);
        onLoaded?.();
      } catch (e: any) {
        setError(e.message || 'Upload failed');
      } finally {
        setLoading(false);
      }
    },
    [loadMission],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  return (
    <div
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 0,
        background: '#1a1a1a',
        color: '#cccccc',
        fontFamily: 'system-ui, sans-serif',
        paddingTop: 40,
        paddingBottom: 40,
      }}
    >
      {/* Auth chip — top-right, out of the centered flow. Shows the logged-in
          Discord identity + Log out, or a Log in link for guests. */}
      <div style={{ position: 'fixed', top: 12, right: 16, zIndex: 50, display: 'flex', alignItems: 'center', gap: 8 }}>
        {user ? (
          <>
            {discordAvatarUrl(user) && (
              <img src={discordAvatarUrl(user)!} alt="" style={{ width: 24, height: 24 }} />
            )}
            <span style={{ fontSize: 13, color: '#cccccc' }}>{discordDisplayName(user)}</span>
            <button onClick={() => logout()} style={{
              background: 'transparent', border: '1px solid #4a4a4a', color: '#aaaaaa',
              fontSize: 12, padding: '3px 10px', cursor: 'pointer', fontFamily: 'inherit',
            }}>Log out</button>
          </>
        ) : (
          <a href="/api/auth/discord/login" style={{
            fontSize: 12, color: '#6ab4f0', textDecoration: 'none',
            border: '1px solid #4a4a4a', padding: '3px 10px',
          }}>Log in with Discord</a>
        )}
      </div>

      <div style={{ maxWidth: 1040, width: '100%', padding: '0 20px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <img
            src="/logo.png"
            alt="DCS:OPT — Digital Combat Simulator Operational Planning Team"
            style={{ width: 480, maxWidth: '85%', height: 'auto', display: 'block', margin: '0 auto 12px' }}
          />
          <p style={{ color: '#aaaaaa', fontSize: 14, margin: 0 }}>
            VMFA-224(AW) Skunkworks
            <span style={{
              marginLeft: 10, padding: '2px 6px',
              border: '1px solid #4a4a4a', color: '#cccccc',
              fontFamily: "'B612 Mono', monospace", fontSize: 11,
              letterSpacing: 0.5,
            }}>{VERSION}</span>
          </p>
        </div>

        <AiSettingsPanel open={aiOpen} onClose={() => setAiOpen(false)} />

        {/* Upload zone */}
        <div
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          onDragEnter={(e) => e.preventDefault()}
          style={{
            border: '2px dashed #3a3a3a',
            borderRadius: 10,
            padding: '40px 30px',
            textAlign: 'center',
            cursor: 'pointer',
            background: '#222222',
            marginBottom: 20,
          }}
          onClick={() => fileRef.current?.click()}
        >
          <h2 style={{ color: '#e0e0e0', margin: '0 0 8px', fontSize: 18 }}>
            Drop .miz file here or click to browse
          </h2>
          <p style={{ color: '#aaaaaa', fontSize: 14, margin: 0 }}>
            Upload a DCS mission file to start planning
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".miz"
            onChange={onChange}
            style={{ display: 'none' }}
          />
          {loading && <p style={{ color: '#4a8fd4', marginTop: 12 }}>Parsing mission...</p>}
          {error && <p style={{ color: '#d95050', marginTop: 12 }}>{error}</p>}
        </div>

        {/* Secondary entry: jump straight into Live mode without a .miz —
            Olympus groups are server/group-based and don't actually need
            a mission. Adds ?live=1 to the URL; App.tsx routes to LiveTerminal. */}
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <button
            onClick={() => { window.location.href = window.location.pathname + '?live=1'; }}
            style={{
              background: 'transparent', border: '1px solid #3a3a3a', color: '#aaaaaa',
              padding: '8px 18px', borderRadius: 6, cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 13,
            }}
            title="Open the multiplayer Live terminal (Olympus groups) without uploading a mission"
          >
            or → <span style={{ color: '#e0e0e0', fontWeight: 600 }}>Go Live without a mission</span>
          </button>
        </div>

        {/* AI Connection card — explains what BYOK is, why you might
            want it, and what it costs. Was previously a tiny button
            tucked in the top-right corner; promoted here so first-time
            users see what AI does and how to enable it. */}
        <div style={{
          background: '#222222',
          border: `1px solid ${aiKey
            ? (lastTestOk && lastTestedAt > 0 ? 'rgba(63, 185, 80, 0.4)' : 'rgba(210, 153, 34, 0.4)')
            : '#3a3a3a'}`,
          borderRadius: 8,
          padding: '20px 24px',
          marginBottom: 20,
        }}>
          <div style={{
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
            marginBottom: 10, flexWrap: 'wrap', gap: 12,
          }}>
            <p style={{ color: '#e0e0e0', fontSize: 16, fontWeight: 600, margin: 0 }}>
              ✨ AI-Powered SOP Extraction <span style={{ color: '#aaaaaa', fontSize: 13, fontWeight: 400, marginLeft: 8 }}>(optional)</span>
            </p>
            {aiKey && lastTestOk && lastTestedAt > 0 && (
              <span style={{
                fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
                color: '#3fb950',
                border: '1px solid rgba(63, 185, 80, 0.5)',
                borderRadius: 3, padding: '2px 8px',
              }}>
                CONNECTED — {aiProvider === 'gemini' ? 'GEMINI' : 'ANTHROPIC'}
              </span>
            )}
            {aiKey && !(lastTestOk && lastTestedAt > 0) && (
              <span style={{
                fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
                color: '#d29922',
                border: '1px solid rgba(210, 153, 34, 0.5)',
                borderRadius: 3, padding: '2px 8px',
              }}>
                KEY SET — UNTESTED
              </span>
            )}
          </div>
          <p style={{ color: '#aaaaaa', fontSize: 13, lineHeight: 1.6, margin: '0 0 10px' }}>
            Drop a kneeboard PNG / squadron SOP image into the SOP tab and the AI will
            read the page and fill in callsigns, frequencies, TACAN, and laser codes
            for you. <strong style={{ color: '#cccccc' }}>Your typed values always win</strong> —
            extraction only fills empty fields.
          </p>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 10, marginBottom: 14,
          }}>
            <div style={infoTileStyle('#3fb950')}>
              <div style={tileLabelStyle}>FREE OPTION</div>
              <div style={tileBodyStyle}>
                <strong style={{ color: '#e0e0e0' }}>Google Gemini</strong> — free key in 30s at{' '}
                <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" style={{ color: '#3fb950' }}>
                  aistudio.google.com
                </a>. 1500 extractions/day on the free tier. No credit card.
              </div>
            </div>
            <div style={infoTileStyle('#a371f7')}>
              <div style={tileLabelStyle}>PAID OPTION</div>
              <div style={tileBodyStyle}>
                <strong style={{ color: '#e0e0e0' }}>Anthropic (Claude)</strong> — get a key at{' '}
                <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" style={{ color: '#c8a8ff' }}>
                  console.anthropic.com
                </a>. Pay-per-use (~$0.02/extract). Separate from Claude.ai Pro.
              </div>
            </div>
            <div style={infoTileStyle('#6ab4f0')}>
              <div style={tileLabelStyle}>PRIVACY</div>
              <div style={tileBodyStyle}>
                Your key lives in <strong style={{ color: '#e0e0e0' }}>this browser only</strong>.
                Calls go directly browser → provider. Railway never sees the key or your images.
              </div>
            </div>
          </div>
          <button
            onClick={() => setAiOpen(true)}
            style={{
              background: aiKey
                ? (lastTestOk && lastTestedAt > 0
                    ? 'rgba(63, 185, 80, 0.15)'
                    : 'rgba(210, 153, 34, 0.15)')
                : 'rgba(74, 143, 212, 0.12)',
              border: `1px solid ${aiKey
                ? (lastTestOk && lastTestedAt > 0 ? '#3fb950' : '#d29922')
                : '#4a8fd4'}`,
              borderRadius: 4,
              color: aiKey
                ? (lastTestOk && lastTestedAt > 0 ? '#3fb950' : '#d29922')
                : '#6ab4f0',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              padding: '8px 18px',
              fontFamily: 'inherit',
            }}
          >
            {aiKey
              ? '🔑 Manage AI Connection'
              : '🔑 Connect AI'}
          </button>
        </div>

        {/* Feature list */}
        <div style={{
          background: '#222222',
          borderRadius: 8,
          padding: '20px 24px',
          fontSize: 14,
          lineHeight: 1.7,
        }}>
          <p style={{ color: '#e0e0e0', fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
            What is this?
          </p>
          <p style={{ color: '#aaaaaa', marginBottom: 12 }}>
            A mission planning tool for DCS World. Upload a .miz, edit your mission, download the modified file. Nothing is saved on the server.
          </p>
          <p style={{ color: '#e0e0e0', fontWeight: 600, marginBottom: 6 }}>Features:</p>
          <ul style={{ margin: '0 0 0 18px', color: '#aaaaaa', padding: 0 }}>
            <li><strong style={{ color: '#ffffff' }}>Interactive Map</strong> — route planning with waypoint editing, drag to move, right-click to add</li>
            <li><strong style={{ color: '#ffffff' }}>Flight Planning</strong> — per-waypoint speed (GS/CAS/TAS/Mach), altitude, ETE with wind correction</li>
            <li><strong style={{ color: '#ffffff' }}>Datalink</strong> — Link16 STN, voice callsigns, donors, team members</li>
            <li><strong style={{ color: '#ffffff' }}>Laser Codes</strong> — per flight with auto-increment for wingmen</li>
            <li><strong style={{ color: '#ffffff' }}>Loadouts</strong> — swap weapons per pylon, fuse/arming settings, copy loadouts</li>
            <li><strong style={{ color: '#ffffff' }}>Liveries</strong> — bulk-apply across units</li>
            <li><strong style={{ color: '#ffffff' }}>Batch Edit</strong> — skill levels and radio frequencies by country/type</li>
            <li><strong style={{ color: '#ffffff' }}>Weather</strong> — full editor with presets, wind layers, clouds, fog</li>
            <li><strong style={{ color: '#ffffff' }}>Find &amp; Replace</strong> — regex-capable name replacement</li>
            <li><strong style={{ color: '#ffffff' }}>DTC Generator</strong> — F/A-18C Data Cartridge files</li>
            <li><strong style={{ color: '#ffffff' }}>Threat Rings</strong> — SAM/AAA visualization with friendly/enemy coloring</li>
            <li><strong style={{ color: '#ffffff' }}>Mission Drawings</strong> — renders DCS drawing tool objects on the map</li>
            <li><strong style={{ color: '#ffffff' }}>Elevation</strong> — SRTM terrain data with MGRS grid</li>
          </ul>
        </div>

        {/* DCS:OPT Suite — sibling product tiles (matches landing page style) */}
        <div style={{ marginTop: 30, paddingTop: 24, borderTop: '1px solid #2a2a2a' }}>
          <div style={{
            fontSize: 12, fontWeight: 700, color: '#888', textAlign: 'center',
            letterSpacing: 2, marginBottom: 14,
          }}>
            PART OF THE DCS:OPT SUITE
          </div>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            {[
              { name: 'Ops Bot',    desc: 'Discord moderation, scheduling, social alerts, server stats.', href: 'https://dcsoptbot-production-0c4b.up.railway.app' },
              { name: 'Ready Room', desc: 'Squadron roster, qualifications, mission ops, attendance.',    href: 'https://dcsoptreadyroom.up.railway.app' },
            ].map((p) => (
              <a key={p.name} href={p.href} target="_blank" rel="noreferrer"
                 style={{
                   flex: '1 1 280px', maxWidth: 360, background: '#1a1a1a',
                   border: '1px solid #2e2e2e', padding: '14px 18px', textDecoration: 'none',
                   display: 'block', color: '#e0e0e0', transition: 'border-color 0.15s',
                 }}
                 onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#e8833a')}
                 onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#2e2e2e')}
              >
                <div style={{ fontSize: 14, fontWeight: 700, color: '#e8833a', marginBottom: 4 }}>
                  DCS:OPT {p.name} <span style={{ color: '#888', fontSize: 11, fontWeight: 400 }}>↗</span>
                </div>
                <div style={{ fontSize: 13, color: '#9a9a9a', lineHeight: 1.5 }}>{p.desc}</div>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Tile within the AI explanation card. Color-coded left border for the
// three categories (free / paid / privacy) so the card scans visually
// without requiring users to read every line.
function infoTileStyle(accent: string): React.CSSProperties {
  return {
    background: '#1a1a1a',
    border: '1px solid #3a3a3a',
    borderLeft: `3px solid ${accent}`,
    borderRadius: 4,
    padding: '8px 10px',
  };
}
const tileLabelStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: '#888', letterSpacing: 1,
  marginBottom: 4, textTransform: 'uppercase',
};
const tileBodyStyle: React.CSSProperties = {
  fontSize: 12, color: '#aaaaaa', lineHeight: 1.5,
};
