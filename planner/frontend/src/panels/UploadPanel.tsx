import { useCallback, useRef, useState } from 'react';
import { uploadMission } from '../api/client';
import { useMissionStore } from '../store/missionStore';
import { setActiveTheater } from '../projection/dcsProjection';

export function UploadPanel({ onLoaded }: { onLoaded?: () => void } = {}) {
  const loadMission = useMissionStore((s) => s.loadMission);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setLoading(true);
      setError(null);
      try {
        const data = await uploadMission(file);
        setActiveTheater(data.theater);
        loadMission(data);
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

  const handleStandaloneDtc = async () => {
    try {
      const res = await fetch('/api/dtc/export-standalone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dtcName: 'Standalone' }),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'Standalone.dtc';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('DTC export failed:', e);
    }
  };

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
        background: '#080f1c',
        color: '#8fa8c0',
        fontFamily: 'system-ui, sans-serif',
        paddingTop: 40,
        paddingBottom: 40,
      }}
    >
      <div style={{ maxWidth: 700, width: '100%', padding: '0 20px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <h1 style={{ color: '#ccdae8', margin: '0 0 8px', fontSize: 28, fontWeight: 700 }}>
            DCS Mission Planner
          </h1>
          <p style={{ color: '#5a7a8a', fontSize: 14, margin: 0 }}>
            VMFA-224(AW) Skunkworks
          </p>
        </div>

        {/* Upload zone */}
        <div
          onDrop={onDrop}
          onDragOver={(e) => e.preventDefault()}
          onDragEnter={(e) => e.preventDefault()}
          style={{
            border: '2px dashed #2a3a4a',
            borderRadius: 10,
            padding: '40px 30px',
            textAlign: 'center',
            cursor: 'pointer',
            background: '#0a1520',
            marginBottom: 20,
          }}
          onClick={() => fileRef.current?.click()}
        >
          <h2 style={{ color: '#ccdae8', margin: '0 0 8px', fontSize: 18 }}>
            Drop .miz file here or click to browse
          </h2>
          <p style={{ color: '#5a7a8a', fontSize: 14, margin: 0 }}>
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

        {/* Standalone tools */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 24, justifyContent: 'center' }}>
          <button onClick={handleStandaloneDtc} style={toolBtnStyle}>
            F/A-18C DTC Generator
          </button>
        </div>

        {/* Feature list */}
        <div style={{
          background: '#0a1520',
          borderRadius: 8,
          padding: '20px 24px',
          fontSize: 14,
          lineHeight: 1.7,
        }}>
          <p style={{ color: '#ccdae8', fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
            What is this?
          </p>
          <p style={{ color: '#5a7a8a', marginBottom: 12 }}>
            A mission planning tool for DCS World. Upload a .miz, edit your mission, download the modified file. Nothing is saved on the server.
          </p>
          <p style={{ color: '#ccdae8', fontWeight: 600, marginBottom: 6 }}>Features:</p>
          <ul style={{ margin: '0 0 0 18px', color: '#6a8a9a', padding: 0 }}>
            <li><strong style={{ color: '#4a8fd4' }}>Interactive Map</strong> — route planning with waypoint editing, drag to move, right-click to add</li>
            <li><strong style={{ color: '#4a8fd4' }}>Flight Planning</strong> — per-waypoint speed (GS/CAS/TAS/Mach), altitude, ETE with wind correction</li>
            <li><strong style={{ color: '#4a8fd4' }}>Datalink</strong> — Link16 STN, voice callsigns, donors, team members</li>
            <li><strong style={{ color: '#4a8fd4' }}>Laser Codes</strong> — per flight with auto-increment for wingmen</li>
            <li><strong style={{ color: '#4a8fd4' }}>Loadouts</strong> — swap weapons per pylon, fuse/arming settings, copy loadouts</li>
            <li><strong style={{ color: '#4a8fd4' }}>Liveries</strong> — bulk-apply across units</li>
            <li><strong style={{ color: '#4a8fd4' }}>Batch Edit</strong> — skill levels and radio frequencies by country/type</li>
            <li><strong style={{ color: '#4a8fd4' }}>Weather</strong> — full editor with presets, wind layers, clouds, fog</li>
            <li><strong style={{ color: '#4a8fd4' }}>Find &amp; Replace</strong> — regex-capable name replacement</li>
            <li><strong style={{ color: '#4a8fd4' }}>DTC Generator</strong> — F/A-18C Data Cartridge files</li>
            <li><strong style={{ color: '#4a8fd4' }}>Threat Rings</strong> — SAM/AAA visualization with friendly/enemy coloring</li>
            <li><strong style={{ color: '#4a8fd4' }}>Mission Drawings</strong> — renders DCS drawing tool objects on the map</li>
            <li><strong style={{ color: '#4a8fd4' }}>Elevation</strong> — SRTM terrain data with MGRS grid</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

const toolBtnStyle: React.CSSProperties = {
  background: 'rgba(74, 143, 212, 0.1)',
  border: '1px solid #1a3a5a',
  borderRadius: 6,
  color: '#4a8fd4',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 500,
  padding: '10px 20px',
};
