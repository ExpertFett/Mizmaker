import { useMissionStore } from './store/missionStore';
import { UploadPanel } from './panels/UploadPanel';
import { MissionEditor } from './editor/MissionEditor';

export default function App() {
  const sessionId = useMissionStore((s) => s.sessionId);

  if (!sessionId) {
    return <UploadPanel />;
  }

  return <MissionEditor />;
}
