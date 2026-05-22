import { useEffect, useState } from 'react';
import { useMissionStore } from './store/missionStore';
import { useAuthStore } from './store/authStore';
import { UploadPanel } from './panels/UploadPanel';
import { LandingPage } from './panels/LandingPage';
import { MissionEditor } from './editor/MissionEditor';
import { JoinSession } from './session/JoinSession';

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

  useEffect(() => {
    checkMe();
    // Strip the OAuth result params so they don't linger in the URL/bookmarks.
    const u = new URL(window.location.href);
    if (u.searchParams.has('auth') || u.searchParams.has('auth_error')) {
      u.searchParams.delete('auth');
      u.searchParams.delete('auth_error');
      window.history.replaceState({}, '', u.pathname + u.search + u.hash);
    }
  }, [checkMe]);

  // Check if this is a join URL: /join/{sessionId}?token={token}
  const path = window.location.pathname;
  const joinMatch = path.match(/^\/join\/([a-f0-9-]+)/);
  const joinToken = new URLSearchParams(window.location.search).get('token');

  // Invite links bypass the landing/login gate entirely — a flight lead's
  // link should drop the recipient straight into the shared session.
  if (joinMatch && joinToken && !sessionId) {
    return <JoinSession sessionId={joinMatch[1]} token={joinToken} />;
  }

  // Wait for the auth probe before deciding (avoids a landing-page flash for
  // already-logged-in users on refresh). Returning guests skip the wait.
  if (!checked && !enteredAsGuest) {
    return <div style={{ height: '100vh', background: '#141414' }} />;
  }

  // Gate: landing/login page until the user logs in or chooses guest.
  if (!user && !enteredAsGuest) {
    return <LandingPage authError={authError} />;
  }

  if (!sessionId) {
    return <UploadPanel />;
  }

  return <MissionEditor />;
}
