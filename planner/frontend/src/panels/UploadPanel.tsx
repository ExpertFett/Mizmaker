import { useCallback, useState } from 'react';
import { uploadMission } from '../api/client';
import { useMissionStore } from '../store/missionStore';
import { setActiveTheater } from '../projection/dcsProjection';

export function UploadPanel() {
  const loadMission = useMissionStore((s) => s.loadMission);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setLoading(true);
      setError(null);
      try {
        const data = await uploadMission(file);
        setActiveTheater(data.theater);
        loadMission(data);
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
        height: '100vh',
        background: '#0a1520',
        color: '#8fa8c0',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          border: '2px dashed #2a3a4a',
          borderRadius: 12,
          padding: '60px 80px',
          textAlign: 'center',
          cursor: 'pointer',
        }}
        onClick={() => document.getElementById('file-input')?.click()}
      >
        <h1 style={{ color: '#ccdae8', margin: '0 0 12px' }}>DCS Mission Map Planner</h1>
        <p style={{ margin: '0 0 20px', fontSize: 14 }}>
          Drop a .miz file here or click to browse
        </p>
        <input
          id="file-input"
          type="file"
          accept=".miz"
          onChange={onChange}
          style={{ display: 'none' }}
        />
        {loading && <p style={{ color: '#4a8fd4' }}>Parsing mission...</p>}
        {error && <p style={{ color: '#d95050' }}>{error}</p>}
      </div>
    </div>
  );
}
