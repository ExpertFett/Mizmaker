import { useMissionStore } from './store/missionStore';
import { UploadPanel } from './panels/UploadPanel';
import { MissionEditor } from './editor/MissionEditor';
import { JoinSession } from './session/JoinSession';

export default function App() {
  const sessionId = useMissionStore((s) => s.sessionId);

  // Check if this is a join URL: /join/{sessionId}?token={token}
  const path = window.location.pathname;
  const joinMatch = path.match(/^\/join\/([a-f0-9-]+)/);
  const joinToken = new URLSearchParams(window.location.search).get('token');

  if (joinMatch && joinToken && !sessionId) {
    return <JoinSession sessionId={joinMatch[1]} token={joinToken} />;
  }

  if (!sessionId) {
    return <UploadPanel />;
  }

  return <MissionEditor />;
}
