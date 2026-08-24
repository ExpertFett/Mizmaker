/**
 * Resume banner — the way back into a session after a refresh or crash.
 *
 * The server keeps an uploaded session for two hours, and the queued edits
 * already persist in localStorage per session. This banner is the missing
 * front door: it offers the stored session by name and age, and resuming is
 * the existing /join flow pointed at the user's own token, so the payload is
 * identical to what the original upload returned.
 *
 * The offer is quiet on purpose — a dismissable strip above the upload box,
 * not a modal. Uploading a new mission is always allowed; loadMission will
 * simply overwrite the resume point with the new session.
 */

import { useEffect, useState, useCallback } from 'react';
import { useMissionStore } from '../store/missionStore';
import {
  getResumePoint, clearResumePoint, resumeAge, type ResumePoint,
} from './resume';

export function ResumeBanner() {
  const loadMission = useMissionStore((s) => s.loadMission);
  const [point, setPoint] = useState<ResumePoint | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'expired'>('idle');

  useEffect(() => { setPoint(getResumePoint()); }, []);

  const resume = useCallback(async () => {
    if (!point) return;
    setState('loading');
    try {
      const res = await fetch(
        `/api/sessions/${point.sessionId}/join?token=${encodeURIComponent(point.token)}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      loadMission(data);
      // loadMission re-saves the point; App switches to the editor on its own.
    } catch {
      // 404 = the server aged the session out; anything else, same answer for
      // the user — this session is gone, say so instead of a silent no-op.
      clearResumePoint();
      setState('expired');
    }
  }, [point, loadMission]);

  if (!point) return null;

  if (state === 'expired') {
    return (
      <div style={{ ...strip, borderColor: '#6b4a3a' }}>
        <span style={{ color: '#d9a050' }}>
          Session for <b>{point.filename}</b> has expired on the server — re-upload the file.
        </span>
        <button style={btn} onClick={() => setPoint(null)}>dismiss</button>
      </div>
    );
  }

  return (
    <div style={strip}>
      <span style={{ color: '#cccccc' }}>
        <b style={{ color: '#ffffff' }}>{point.filename}</b>
        <span style={{ color: '#888888' }}>
          {' '}— {point.theater || 'session'} uploaded {resumeAge(point)}
        </span>
      </span>
      <span style={{ display: 'flex', gap: 8 }}>
        <button
          style={{ ...btn, background: '#2d4a6b', borderColor: '#4a7ab5', color: '#ffffff' }}
          disabled={state === 'loading'}
          onClick={resume}
        >
          {state === 'loading' ? 'Resuming…' : 'Resume session'}
        </button>
        <button
          style={btn}
          onClick={() => { clearResumePoint(); setPoint(null); }}
        >
          dismiss
        </button>
      </span>
    </div>
  );
}

const strip: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  maxWidth: 640,
  width: '100%',
  margin: '0 auto 18px',
  padding: '10px 14px',
  background: '#22282e',
  border: '1px solid #3a4a5a',
  borderRadius: 4,
  fontSize: 14,
};

const btn: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid #4a4a4a',
  color: '#aaaaaa',
  fontSize: 12,
  padding: '4px 12px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
};
