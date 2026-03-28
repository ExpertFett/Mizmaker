import { useState, useCallback } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { dtcPreview, dtcGenerate } from '../../api/client';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface CommChannel {
  frequency: string;
  modulation: string;
  name: string;
}

interface CommRadio {
  [channelKey: string]: CommChannel;
}

interface NavPoint {
  number: number;
  name: string;
  lat: string;
  lon: string;
  alt: number;
}

interface TacanSettings {
  channel: number;
  band: string;
  mode: string;
  enabled: boolean;
}

interface IclsSettings {
  channel: number;
  enabled: boolean;
}

interface AclsSettings {
  frequency: string;
  enabled: boolean;
}

interface NavSettings {
  TACAN: TacanSettings;
  ICLS: IclsSettings;
  ACLS?: AclsSettings;
}

interface CmdsProgram {
  chaffQty: number;
  chaffInterval: number;
  flareQty: number;
  flareInterval: number;
}

interface DtcData {
  COMM: { COMM1: CommRadio; COMM2: CommRadio };
  WYPT: { NAV_PTS: NavPoint[]; NAV_SETTINGS: NavSettings };
  CMDS: Record<string, CmdsProgram>;
  ALR67?: unknown;
  TCN?: unknown[];
}

type SubTab = 'comm' | 'cmds' | 'waypoints' | 'nav';

const COMM_CHANNELS = [
  ...Array.from({ length: 20 }, (_, i) => `Channel_${i + 1}`),
  'CUE', 'GUARD', 'MAN', 'MAR_S',
];

const COMM_CHANNEL_LABELS: Record<string, string> = {
  CUE: 'CUE',
  GUARD: 'GUARD',
  MAN: 'MAN',
  MAR_S: 'MAR/S',
};

function channelLabel(key: string): string {
  if (COMM_CHANNEL_LABELS[key]) return COMM_CHANNEL_LABELS[key];
  const m = key.match(/Channel_(\d+)/);
  return m ? m[1] : key;
}

const CMDS_PROGRAMS = [
  'AUTO_1', 'AUTO_2', 'AUTO_3',
  'MAN_1', 'MAN_2', 'MAN_3', 'MAN_4', 'MAN_5', 'MAN_6',
  'BYP',
];

function programLabel(key: string): string {
  return key.replace('_', ' ');
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export function DtcTab() {
  const dtcFlights = useMissionStore((s) => s.dtcFlights);
  const sessionId = useMissionStore((s) => s.sessionId);

  const [selectedFlight, setSelectedFlight] = useState<string>(dtcFlights[0] ?? '');
  const [dtcData, setDtcData] = useState<DtcData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<SubTab>('comm');
  const [exporting, setExporting] = useState(false);

  const handleLoad = useCallback(async () => {
    if (!sessionId || !selectedFlight) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await dtcPreview(sessionId, selectedFlight);
      setDtcData(resp.dtc?.data ?? null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load DTC');
    } finally {
      setLoading(false);
    }
  }, [sessionId, selectedFlight]);

  const updateComm = useCallback((radio: 'COMM1' | 'COMM2', channelKey: string, field: keyof CommChannel, value: string) => {
    setDtcData((prev) => {
      if (!prev) return prev;
      const radioData = { ...prev.COMM[radio] };
      radioData[channelKey] = { ...radioData[channelKey], [field]: value };
      return { ...prev, COMM: { ...prev.COMM, [radio]: radioData } };
    });
  }, []);

  const updateCmds = useCallback((program: string, field: keyof CmdsProgram, value: number) => {
    setDtcData((prev) => {
      if (!prev) return prev;
      const cmds = { ...prev.CMDS };
      cmds[program] = { ...cmds[program], [field]: value };
      return { ...prev, CMDS: cmds };
    });
  }, []);

  const updateNav = useCallback((section: 'TACAN' | 'ICLS' | 'ACLS', field: string, value: unknown) => {
    setDtcData((prev) => {
      if (!prev) return prev;
      const settings = { ...prev.WYPT.NAV_SETTINGS };
      if (section === 'TACAN') {
        settings.TACAN = { ...settings.TACAN, [field]: value };
      } else if (section === 'ICLS') {
        settings.ICLS = { ...settings.ICLS, [field]: value };
      } else if (section === 'ACLS') {
        settings.ACLS = { ...(settings.ACLS ?? { frequency: '', enabled: false }), [field]: value };
      }
      return { ...prev, WYPT: { ...prev.WYPT, NAV_SETTINGS: settings } };
    });
  }, []);

  const handleExport = useCallback(async () => {
    if (!sessionId || !selectedFlight || !dtcData) return;
    setExporting(true);
    setError(null);
    try {
      const blob = await dtcGenerate(sessionId, selectedFlight, dtcData);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedFlight}.dtc`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }, [sessionId, selectedFlight, dtcData]);

  if (dtcFlights.length === 0) {
    return (
      <div style={{ color: '#5a7a8a', fontSize: 14, padding: 20 }}>
        No F/A-18C flights found in this mission for DTC generation.
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#ccdae8' }}>
          F/A-18C DTC Builder
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: '#5a7a8a' }}>
          Load, edit, and export Data Transfer Cartridge files for Hornet flights.
        </p>
      </div>

      {/* Flight selector + Load */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <label style={{ color: '#8fa8c0', fontSize: 13 }}>Flight:</label>
        <select
          value={selectedFlight}
          onChange={(e) => { setSelectedFlight(e.target.value); setDtcData(null); }}
          style={selectStyle}
        >
          {dtcFlights.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <button onClick={handleLoad} disabled={loading} style={btnStyle}>
          {loading ? 'Loading...' : 'Load DTC'}
        </button>
        {dtcData && (
          <button onClick={handleExport} disabled={exporting} style={{ ...btnStyle, background: '#1a4a2a', borderColor: '#2a6a3a' }}>
            {exporting ? 'Exporting...' : 'Export .dtc'}
          </button>
        )}
      </div>

      {error && (
        <div style={{ color: '#d95050', fontSize: 13, marginBottom: 12 }}>{error}</div>
      )}

      {!dtcData && !loading && (
        <div style={{ color: '#5a7a8a', fontSize: 13, padding: 20 }}>
          Select a flight and click "Load DTC" to begin editing.
        </div>
      )}

      {dtcData && (
        <>
          {/* Sub-tab navigation */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid #1a2a3a' }}>
            {(['comm', 'cmds', 'waypoints', 'nav'] as SubTab[]).map((t) => (
              <button
                key={t}
                onClick={() => setSubTab(t)}
                style={{
                  background: subTab === t ? '#0f1a28' : 'transparent',
                  border: 'none',
                  borderBottom: subTab === t ? '2px solid #4a8fd4' : '2px solid transparent',
                  color: subTab === t ? '#ccdae8' : '#5a7a8a',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  padding: '8px 16px',
                  fontWeight: subTab === t ? 600 : 400,
                }}
              >
                {t === 'comm' ? 'COMM' : t === 'cmds' ? 'CMDS' : t === 'waypoints' ? 'Waypoints' : 'NAV'}
              </button>
            ))}
          </div>

          {subTab === 'comm' && <CommSubTab data={dtcData.COMM} onUpdate={updateComm} />}
          {subTab === 'cmds' && <CmdsSubTab data={dtcData.CMDS ?? {}} onUpdate={updateCmds} />}
          {subTab === 'waypoints' && <WaypointsSubTab data={dtcData.WYPT?.NAV_PTS ?? []} />}
          {subTab === 'nav' && <NavSubTab data={dtcData.WYPT?.NAV_SETTINGS ?? { TACAN: { channel: 1, band: 'X', mode: 'T-R', enabled: false }, ICLS: { channel: 1, enabled: false } }} onUpdate={updateNav} />}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* COMM sub-tab                                                        */
/* ------------------------------------------------------------------ */

function CommSubTab({ data, onUpdate }: {
  data: { COMM1: CommRadio; COMM2: CommRadio };
  onUpdate: (radio: 'COMM1' | 'COMM2', channelKey: string, field: keyof CommChannel, value: string) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 24 }}>
      {(['COMM1', 'COMM2'] as const).map((radio) => (
        <div key={radio} style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: '#8fa8c0' }}>{radio}</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: '#ccdae8' }}>
            <thead>
              <tr style={{ color: '#5a7a8a', borderBottom: '1px solid #1a2a3a', background: '#080f1c' }}>
                <th style={thStyle}>Ch</th>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Freq (MHz)</th>
                <th style={thStyle}>Mod</th>
              </tr>
            </thead>
            <tbody>
              {COMM_CHANNELS.map((chKey) => {
                const ch = data[radio]?.[chKey] ?? { frequency: '', modulation: 'AM', name: '' };
                return (
                  <tr key={chKey} style={{ borderBottom: '1px solid #0f1a28' }}>
                    <td style={{ ...tdStyle, color: '#5a7a8a', fontFamily: 'monospace', width: 40 }}>
                      {channelLabel(chKey)}
                    </td>
                    <td style={tdStyle}>
                      <input
                        value={ch.name ?? ''}
                        onChange={(e) => onUpdate(radio, chKey, 'name', e.target.value)}
                        style={{ ...monoInputStyle, width: '100%' }}
                      />
                    </td>
                    <td style={tdStyle}>
                      <input
                        value={ch.frequency ?? ''}
                        onChange={(e) => onUpdate(radio, chKey, 'frequency', e.target.value)}
                        style={{ ...monoInputStyle, width: 90 }}
                      />
                    </td>
                    <td style={tdStyle}>
                      <select
                        value={ch.modulation ?? 'AM'}
                        onChange={(e) => onUpdate(radio, chKey, 'modulation', e.target.value)}
                        style={{ ...selectStyle, fontSize: 12, padding: '3px 4px' }}
                      >
                        <option value="AM">AM</option>
                        <option value="FM">FM</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* CMDS sub-tab                                                        */
/* ------------------------------------------------------------------ */

function CmdsSubTab({ data, onUpdate }: {
  data: Record<string, CmdsProgram>;
  onUpdate: (program: string, field: keyof CmdsProgram, value: number) => void;
}) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: '#ccdae8', maxWidth: 700 }}>
      <thead>
        <tr style={{ color: '#5a7a8a', borderBottom: '1px solid #1a2a3a', background: '#080f1c' }}>
          <th style={thStyle}>Program</th>
          <th style={thStyle}>Chaff Qty</th>
          <th style={thStyle}>Chaff Interval</th>
          <th style={thStyle}>Flare Qty</th>
          <th style={thStyle}>Flare Interval</th>
        </tr>
      </thead>
      <tbody>
        {CMDS_PROGRAMS.map((prog) => {
          const p = data[prog] ?? { chaffQty: 0, chaffInterval: 0, flareQty: 0, flareInterval: 0 };
          return (
            <tr key={prog} style={{ borderBottom: '1px solid #0f1a28' }}>
              <td style={{ ...tdStyle, color: '#8fa8c0', fontWeight: 600 }}>{programLabel(prog)}</td>
              <td style={tdStyle}>
                <input
                  type="number"
                  value={p.chaffQty}
                  onChange={(e) => onUpdate(prog, 'chaffQty', Number(e.target.value))}
                  style={{ ...monoInputStyle, width: 60 }}
                />
              </td>
              <td style={tdStyle}>
                <input
                  type="number"
                  step="0.1"
                  value={p.chaffInterval}
                  onChange={(e) => onUpdate(prog, 'chaffInterval', Number(e.target.value))}
                  style={{ ...monoInputStyle, width: 70 }}
                />
              </td>
              <td style={tdStyle}>
                <input
                  type="number"
                  value={p.flareQty}
                  onChange={(e) => onUpdate(prog, 'flareQty', Number(e.target.value))}
                  style={{ ...monoInputStyle, width: 60 }}
                />
              </td>
              <td style={tdStyle}>
                <input
                  type="number"
                  step="0.1"
                  value={p.flareInterval}
                  onChange={(e) => onUpdate(prog, 'flareInterval', Number(e.target.value))}
                  style={{ ...monoInputStyle, width: 70 }}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------ */
/* Waypoints sub-tab (read-only)                                       */
/* ------------------------------------------------------------------ */

function WaypointsSubTab({ data }: { data: NavPoint[] }) {
  if (data.length === 0) {
    return <div style={{ color: '#5a7a8a', fontSize: 13 }}>No waypoints in DTC data.</div>;
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: '#ccdae8', maxWidth: 800 }}>
      <thead>
        <tr style={{ color: '#5a7a8a', borderBottom: '1px solid #1a2a3a', background: '#080f1c' }}>
          <th style={{ ...thStyle, width: 40 }}>#</th>
          <th style={thStyle}>Name</th>
          <th style={thStyle}>Lat</th>
          <th style={thStyle}>Lon</th>
          <th style={thStyle}>Alt (ft)</th>
        </tr>
      </thead>
      <tbody>
        {data.map((wp, i) => (
          <tr key={wp.number ?? i} style={{ borderBottom: '1px solid #0f1a28' }}>
            <td style={{ ...tdStyle, fontFamily: 'monospace', color: '#5a7a8a' }}>{wp.number ?? i + 1}</td>
            <td style={tdStyle}>{wp.name || '-'}</td>
            <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{wp.lat}</td>
            <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{wp.lon}</td>
            <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{wp.alt}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------ */
/* NAV sub-tab                                                         */
/* ------------------------------------------------------------------ */

function NavSubTab({ data, onUpdate }: {
  data: NavSettings;
  onUpdate: (section: 'TACAN' | 'ICLS' | 'ACLS', field: string, value: unknown) => void;
}) {
  const tacan = data.TACAN;
  const icls = data.ICLS;
  const acls = data.ACLS ?? { frequency: '', enabled: false };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 500 }}>
      {/* TACAN */}
      <fieldset style={fieldsetStyle}>
        <legend style={legendStyle}>TACAN</legend>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={fieldLabelStyle}>
            Channel
            <input
              type="number"
              min={1}
              max={126}
              value={tacan.channel}
              onChange={(e) => onUpdate('TACAN', 'channel', Number(e.target.value))}
              style={{ ...monoInputStyle, width: 60 }}
            />
          </label>
          <label style={fieldLabelStyle}>
            Band
            <select
              value={tacan.band}
              onChange={(e) => onUpdate('TACAN', 'band', e.target.value)}
              style={{ ...selectStyle, fontSize: 12, padding: '3px 4px' }}
            >
              <option value="X">X</option>
              <option value="Y">Y</option>
            </select>
          </label>
          <label style={fieldLabelStyle}>
            Mode
            <select
              value={tacan.mode}
              onChange={(e) => onUpdate('TACAN', 'mode', e.target.value)}
              style={{ ...selectStyle, fontSize: 12, padding: '3px 4px' }}
            >
              <option value="T-R">T-R</option>
              <option value="A-A">A-A</option>
            </select>
          </label>
          <label style={{ ...fieldLabelStyle, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={tacan.enabled}
              onChange={(e) => onUpdate('TACAN', 'enabled', e.target.checked)}
              style={{ marginRight: 4 }}
            />
            On
          </label>
        </div>
      </fieldset>

      {/* ICLS */}
      <fieldset style={fieldsetStyle}>
        <legend style={legendStyle}>ICLS</legend>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <label style={fieldLabelStyle}>
            Channel
            <input
              type="number"
              min={1}
              max={20}
              value={icls.channel}
              onChange={(e) => onUpdate('ICLS', 'channel', Number(e.target.value))}
              style={{ ...monoInputStyle, width: 60 }}
            />
          </label>
          <label style={{ ...fieldLabelStyle, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={icls.enabled}
              onChange={(e) => onUpdate('ICLS', 'enabled', e.target.checked)}
              style={{ marginRight: 4 }}
            />
            On
          </label>
        </div>
      </fieldset>

      {/* ACLS */}
      <fieldset style={fieldsetStyle}>
        <legend style={legendStyle}>ACLS</legend>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <label style={fieldLabelStyle}>
            Frequency
            <input
              value={acls.frequency}
              onChange={(e) => onUpdate('ACLS', 'frequency', e.target.value)}
              style={{ ...monoInputStyle, width: 100 }}
            />
          </label>
          <label style={{ ...fieldLabelStyle, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={acls.enabled}
              onChange={(e) => onUpdate('ACLS', 'enabled', e.target.checked)}
              style={{ marginRight: 4 }}
            />
            On
          </label>
        </div>
      </fieldset>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const thStyle: React.CSSProperties = {
  padding: '6px 10px',
  textAlign: 'left',
  fontWeight: 600,
  fontSize: 12,
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '4px 10px',
  verticalAlign: 'middle',
};

const monoInputStyle: React.CSSProperties = {
  background: '#0f1a28',
  border: '1px solid #1a2a3a',
  borderRadius: 3,
  color: '#ccdae8',
  fontFamily: 'monospace',
  fontSize: 13,
  padding: '4px 6px',
  boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = {
  background: '#0f1a28',
  border: '1px solid #1a2a3a',
  borderRadius: 3,
  color: '#ccdae8',
  fontSize: 13,
  padding: '4px 8px',
  fontFamily: 'inherit',
};

const btnStyle: React.CSSProperties = {
  background: '#0f1a28',
  border: '1px solid #1a3a5a',
  borderRadius: 4,
  color: '#4a8fd4',
  cursor: 'pointer',
  fontSize: 13,
  padding: '6px 14px',
  fontFamily: 'inherit',
};

const fieldsetStyle: React.CSSProperties = {
  border: '1px solid #1a2a3a',
  borderRadius: 4,
  padding: '12px 16px',
  margin: 0,
};

const legendStyle: React.CSSProperties = {
  color: '#8fa8c0',
  fontSize: 13,
  fontWeight: 600,
  padding: '0 6px',
};

const fieldLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  color: '#8fa8c0',
  fontSize: 12,
};
