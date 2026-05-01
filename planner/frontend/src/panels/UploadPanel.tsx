import { useCallback, useRef, useState } from 'react';
import { uploadMission } from '../api/client';
import { useMissionStore } from '../store/missionStore';
import { setActiveTheater } from '../projection/dcsProjection';
import { VERSION } from '../version';
import { useAiStore } from '../ai/aiStore';
import { AiSettingsPanel } from './AiSettingsPanel';

export function UploadPanel({ onLoaded }: { onLoaded?: () => void } = {}) {
  const loadMission = useMissionStore((s) => s.loadMission);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const aiProvider = useAiStore((s) => s.provider);
  const aiCreds = useAiStore((s) => ({
    provider: s.provider,
    anthropicKey: s.anthropicKey, geminiKey: s.geminiKey,
    anthropicModel: s.anthropicModel, geminiModel: s.geminiModel,
  }));
  const lastTestOk = useAiStore((s) => s.lastTestOk[s.provider]);
  const lastTestedAt = useAiStore((s) => s.lastTestedAt[s.provider]);
  const aiKey = aiCreds.provider === 'anthropic' ? aiCreds.anthropicKey : aiCreds.geminiKey;
  const [aiOpen, setAiOpen] = useState(false);

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
        background: '#1a1a1a',
        color: '#cccccc',
        fontFamily: 'system-ui, sans-serif',
        paddingTop: 40,
        paddingBottom: 40,
      }}
    >
      <div style={{ maxWidth: 700, width: '100%', padding: '0 20px' }}>
        {/* AI settings — top-right corner of the upload screen so users
            can plug in their Anthropic key before they start planning.
            Color reflects state: green=tested OK, amber=key set but
            never tested or last test failed, grey=no key set. */}
        <div style={{
          display: 'flex', justifyContent: 'flex-end', marginBottom: 8,
        }}>
          <button
            onClick={() => setAiOpen(true)}
            style={{
              background: aiKey
                ? (lastTestOk && lastTestedAt > 0
                    ? 'rgba(63, 185, 80, 0.1)'
                    : 'rgba(210, 153, 34, 0.1)')
                : 'transparent',
              border: `1px solid ${aiKey
                ? (lastTestOk && lastTestedAt > 0 ? '#3fb950' : '#d29922')
                : '#3a3a3a'}`,
              borderRadius: 4,
              color: aiKey
                ? (lastTestOk && lastTestedAt > 0 ? '#3fb950' : '#d29922')
                : '#aaaaaa',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              padding: '5px 12px',
              fontFamily: 'inherit',
            }}
            title={aiKey
              ? `${aiProvider === 'gemini' ? 'Gemini' : 'Anthropic'} API key is set. Click to view / change settings.`
              : 'No AI key set. Click to add a free Gemini key (or paid Anthropic) for vision-based SOP extraction.'}
          >
            {aiKey
              ? `🔑 AI Connected (${aiProvider === 'gemini' ? 'Gemini' : 'Anthropic'})`
              : '🔑 Connect AI'}
          </button>
        </div>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <h1 style={{ color: '#e0e0e0', margin: '0 0 8px', fontSize: 28, fontWeight: 700 }}>
            DCS Mission Planner
          </h1>
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

        {/* Standalone tools */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 24, justifyContent: 'center' }}>
          <button onClick={handleStandaloneDtc} style={toolBtnStyle}>
            F/A-18C DTC Generator
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
      </div>
    </div>
  );
}

const toolBtnStyle: React.CSSProperties = {
  background: '#2a2a2a',
  border: '1px solid #4a4a4a',
  borderRadius: 6,
  color: '#e0e0e0',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 500,
  padding: '10px 20px',
};
