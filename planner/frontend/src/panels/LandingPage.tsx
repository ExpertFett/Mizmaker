/**
 * Landing / intro page — the public face of DCS:OPT.
 *
 * Sells the tool, then gates entry: "Log in with Discord" (identity only) or
 * "Continue as guest". Shown by App until the user logs in or chooses guest.
 * Invite (/join/...) links bypass this entirely.
 */

import { useAuthStore } from '../store/authStore';
import { VERSION } from '../version';

interface LandingPageProps {
  /** ?auth_error value from the OAuth redirect, if any. */
  authError?: string | null;
  /** ?detail value (e.g. Discord's own error code) for a precise message. */
  authDetail?: string | null;
}

const FEATURES: { title: string; body: string }[] = [
  { title: 'Surgical .miz editing', body: 'Edits your mission in place — your formatting, triggers, and scripting stay intact.' },
  { title: 'Interactive map & routing', body: 'Drag waypoints, plan legs, get per-leg fuel, ETE, and wind-corrected timing.' },
  { title: 'Kneeboard cards', body: 'Auto-built route, threat, comms, fuel, bullseye & DMPI cards — exported as cockpit PNGs.' },
  { title: 'Brief generator', body: 'Wing + per-flight briefings to PowerPoint / PDF — built on your own squadron template.' },
  { title: 'F/A-18C DTC', body: 'Generate Data Cartridge files: waypoints, comms presets, and more, one click.' },
  { title: 'Threats, datalink & loadouts', body: 'SAM/AAA threat rings, Link-16 STN, laser codes, pylon loadouts, liveries, weather, ATIS.' },
  { title: 'Optional AI (your key)', body: 'Bring your own Gemini/Anthropic key to extract SOPs from images and draft the brief.' },
  { title: 'Private by design', body: 'Runs in your browser. Missions are processed in-session — nothing is stored on our servers.' },
];

const STEPS: { n: string; title: string; body: string }[] = [
  { n: '1', title: 'Upload', body: 'Drop in your .miz file.' },
  { n: '2', title: 'Plan', body: 'Map, loadouts, weather, threats, comms, DTC.' },
  { n: '3', title: 'Export', body: 'Modified .miz, kneeboards, brief, and DTC.' },
];

const PAGE_BG = '#141414';
const CARD_BG = '#1e1e1e';
const BORDER = '#2e2e2e';
const TEXT = '#e6e6e6';
const MUTED = '#9a9a9a';
const ACCENT = '#e8833a';        // DCS:OPT orange
const DISCORD = '#5865F2';

export function LandingPage({ authError, authDetail }: LandingPageProps) {
  const enterGuest = useAuthStore((s) => s.enterGuest);

  let errMsg =
    authError === 'unconfigured' ? 'Discord login isn’t set up yet — continue as guest for now.'
    : authError === 'nocode' ? 'Discord login was cancelled or returned no code. Try again.'
    : authError === 'state' ? 'Login security check failed (state cookie missing/expired). Make sure cookies aren’t blocked, then try again.'
    : authError === 'token' ? 'Discord rejected the login (token exchange) — usually a bad Client Secret or a redirect URI that doesn’t match the Discord app.'
    : authError === 'user' ? 'Couldn’t fetch your Discord profile after login. Try again.'
    : authError === 'failed' ? 'Discord login failed or was cancelled. Try again, or continue as guest.'
    : null;
  if (errMsg && authDetail) {
    errMsg += `  (Discord said: ${authDetail})`;
  }

  return (
    <div style={{
      minHeight: '100vh', width: '100%', overflowY: 'auto',
      background: PAGE_BG, color: TEXT,
      fontFamily: "'B612', system-ui, sans-serif",
    }}>
      {/* Hero */}
      <div style={{
        maxWidth: 920, margin: '0 auto', padding: '64px 24px 40px',
        textAlign: 'center',
      }}>
        <img src="/logo.png" alt="DCS:OPT"
             style={{ width: 460, maxWidth: '90%', height: 'auto', margin: '0 auto 14px', display: 'block' }} />
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
          <span style={{
            fontSize: 12, fontWeight: 800, letterSpacing: 3, color: '#141414',
            background: ACCENT, padding: '4px 14px',
          }}>BETA</span>
        </div>
        <p style={{ fontSize: 20, color: TEXT, margin: '0 0 6px', fontWeight: 600 }}>
          Operational planning for DCS World, built by aircrew.
        </p>
        <p style={{ fontSize: 16, color: MUTED, margin: '0 auto 28px', maxWidth: 620, lineHeight: 1.5 }}>
          Upload your <code style={{ color: ACCENT }}>.miz</code>, plan the whole mission, and export
          everything your flight needs — modified mission, kneeboards, briefings, and DTC.
        </p>

        {/* CTAs */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <a href="/api/auth/discord/login" style={{
            display: 'inline-flex', alignItems: 'center', gap: 10,
            background: DISCORD, color: '#fff', textDecoration: 'none',
            fontSize: 16, fontWeight: 700, padding: '13px 26px',
            border: `1px solid ${DISCORD}`,
          }}>
            <DiscordMark /> Log in with Discord
          </a>
          <button onClick={enterGuest} style={{
            background: 'transparent', color: TEXT,
            fontSize: 16, fontWeight: 600, padding: '13px 26px',
            border: `1px solid ${BORDER}`, cursor: 'pointer',
            fontFamily: 'inherit',
          }}>
            Continue as guest
          </button>
        </div>
        {errMsg && (
          <p style={{ marginTop: 16, fontSize: 14, color: '#d9a24a' }}>{errMsg}</p>
        )}
        <p style={{ marginTop: 14, fontSize: 13, color: MUTED }}>
          Login is optional — it’s identity only (no email, nothing posted). Guests get the full tool.
        </p>
      </div>

      {/* Feature grid */}
      <div style={{ maxWidth: 1040, margin: '0 auto', padding: '8px 24px 8px' }}>
        <div style={{
          display: 'grid', gap: 14,
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        }}>
          {FEATURES.map((f) => (
            <div key={f.title} style={{
              background: CARD_BG, border: `1px solid ${BORDER}`,
              borderLeft: `3px solid ${ACCENT}`, padding: '16px 18px',
            }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, marginBottom: 6 }}>{f.title}</div>
              <div style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.5 }}>{f.body}</div>
            </div>
          ))}
        </div>
      </div>

      {/* How it works */}
      <div style={{ maxWidth: 1040, margin: '0 auto', padding: '36px 24px 8px' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: TEXT, textAlign: 'center', margin: '0 0 20px', letterSpacing: 1 }}>
          HOW IT WORKS
        </h2>
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
          {STEPS.map((s) => (
            <div key={s.n} style={{
              flex: '1 1 240px', maxWidth: 300, background: CARD_BG,
              border: `1px solid ${BORDER}`, padding: '18px 20px', textAlign: 'center',
            }}>
              <div style={{
                width: 38, height: 38, lineHeight: '38px', margin: '0 auto 10px',
                borderRadius: '50%', background: ACCENT, color: '#141414',
                fontWeight: 800, fontSize: 18,
              }}>{s.n}</div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>{s.title}</div>
              <div style={{ fontSize: 13.5, color: MUTED, lineHeight: 1.5 }}>{s.body}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div style={{
        maxWidth: 1040, margin: '40px auto 0', padding: '20px 24px 40px',
        borderTop: `1px solid ${BORDER}`, textAlign: 'center',
        color: MUTED, fontSize: 13,
      }}>
        DCS:OPT — VMFA-224(AW) Skunkworks
        <span style={{
          marginLeft: 10, padding: '2px 6px', border: `1px solid ${BORDER}`,
          fontFamily: "'B612 Mono', monospace", fontSize: 11, letterSpacing: 0.5,
        }}>{VERSION}</span>
      </div>
    </div>
  );
}

/** Inline Discord glyph so we don't pull in an icon dependency. */
function DiscordMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
      <path d="M20.317 4.369a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.211.375-.444.864-.608 1.249a18.27 18.27 0 0 0-5.487 0 12.6 12.6 0 0 0-.617-1.25.077.077 0 0 0-.079-.036A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.891.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.029ZM8.02 15.331c-1.182 0-2.157-1.085-2.157-2.419 0-1.333.956-2.418 2.157-2.418 1.21 0 2.176 1.095 2.157 2.418 0 1.334-.956 2.419-2.157 2.419Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.418 2.157-2.418 1.21 0 2.176 1.095 2.157 2.418 0 1.334-.946 2.419-2.157 2.419Z"/>
    </svg>
  );
}
