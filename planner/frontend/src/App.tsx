import { useEffect, useState, type ReactNode } from 'react';
import { useMissionStore } from './store/missionStore';
import { useAuthStore } from './store/authStore';
import { UploadPanel } from './panels/UploadPanel';
import { LandingPage } from './panels/LandingPage';
import { MissionEditor } from './editor/MissionEditor';
import { JoinSession } from './session/JoinSession';
import { DiscordButton } from './panels/DiscordButton';
import { LiveTerminal } from './editor/live/LiveTerminal';
import { LiveErrorBoundary } from './editor/live/LiveErrorBoundary';
import { GuidePanel } from './panels/GuidePanel';
import { HelpButton } from './panels/HelpButton';

export default function App() {
  const sessionId = useMissionStore((s) => s.sessionId);
  const user = useAuthStore((s) => s.user);
  const checked = useAuthStore((s) => s.checked);
  const enteredAsGuest = useAuthStore((s) => s.enteredAsGuest);
  const checkMe = useAuthStore((s) => s.checkMe);

  // Capture the OAuth result param ONCE (before the effect cleans the URL, and
  // stable across the re-render that checkMe triggers) so the landing page can
  // reliably surface a login error.
  const [authError] = useState(() => new URLSearchParams(window.location.search).get('auth_error'));
  const [authDetail] = useState(() => new URLSearchParams(window.location.search).get('detail'));
  // Guide overlay — opens on `?guide=1` or via the floating Help button.
  const [guideOpen, setGuideOpen] = useState(() => new URLSearchParams(window.location.search).get('guide') === '1');

  useEffect(() => {
    checkMe();
    // Strip the OAuth result params so they don't linger in the URL/bookmarks.
    const u = new URL(window.location.href);
    if (u.searchParams.has('auth') || u.searchParams.has('auth_error') || u.searchParams.has('detail')) {
      u.searchParams.delete('auth');
      u.searchParams.delete('auth_error');
      u.searchParams.delete('detail');
      window.history.replaceState({}, '', u.pathname + u.search + u.hash);
    }
  }, [checkMe]);

  // Check if this is a join URL: /join/{sessionId}?token={token}
  const path = window.location.pathname;
  const joinMatch = path.match(/^\/join\/([a-f0-9-]+)/);
  const joinToken = new URLSearchParams(window.location.search).get('token');
  // ?live=1 → go straight to LiveTerminal without a .miz (Olympus groups don't
  // need a mission). Honoured only when there's no editor session active.
  const liveStandalone = new URLSearchParams(window.location.search).get('live') === '1';

  // Pick the active view. The Discord button is rendered alongside ALL views
  // (below) so it's visible everywhere in the program.
  let view: ReactNode;
  if (joinMatch && joinToken && !sessionId) {
    // Invite links bypass the landing/login gate — straight into the session.
    view = <JoinSession sessionId={joinMatch[1]} token={joinToken} />;
  } else if (!checked && !enteredAsGuest) {
    // Wait for the auth probe (avoids a landing-page flash for logged-in users
    // on refresh). Returning guests skip the wait.
    view = <div style={{ height: '100vh', background: '#141414' }} />;
  } else if (!user && !enteredAsGuest) {
    // Gate: landing/login page until the user logs in or chooses guest.
    view = <LandingPage authError={authError} authDetail={authDetail} />;
  } else if (!sessionId && liveStandalone) {
    view = <LiveStandalone />;
  } else if (!sessionId) {
    view = <UploadPanel />;
  } else {
    view = <MissionEditor />;
  }

  // Strip `?guide=1` from the URL once we've consumed it so it doesn't keep
  // reopening on every refresh.
  useEffect(() => {
    if (guideOpen) {
      const u = new URL(window.location.href);
      if (u.searchParams.has('guide')) {
        u.searchParams.delete('guide');
        window.history.replaceState({}, '', u.toString());
      }
    }
  }, [guideOpen]);

  return (
    <>
      {view}
      <DiscordButton />
      <HelpButton onClick={() => setGuideOpen(true)} />
      {guideOpen && <GuidePanel onClose={() => setGuideOpen(false)} />}
    </>
  );
}

/** Wrapper around LiveTerminal for the no-mission entry path (?live=1): adds a
 *  small "Back to Upload" header so the user can return to the file picker
 *  without manually editing the URL. */
function LiveStandalone() {
  const back = () => {
    const u = new URL(window.location.href);
    u.searchParams.delete('live');
    window.history.replaceState({}, '', u.pathname + u.search + u.hash);
    window.location.reload();
  };
  return (
    <div style={{ minHeight: '100vh', background: '#141414' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #2a2a2a', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={back} style={{ background: 'transparent', border: '1px solid #4a4a4a', color: '#cccccc', padding: '6px 14px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, borderRadius: 4 }}>← Back to Upload</button>
        <span style={{ fontSize: 13, color: '#888' }}>Live mode · no mission loaded</span>
      </div>
      <LiveErrorBoundary>
        <LiveTerminal />
      </LiveErrorBoundary>
    </div>
  );
}
