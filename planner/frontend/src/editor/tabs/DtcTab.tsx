import { useState, useCallback, useMemo } from 'react';
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

type SubTab = 'comm' | 'cmds' | 'waypoints' | 'nav' | 'fuel' | 'tools' | 'presets';

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
/* COMM Frequency Presets                                               */
/* ------------------------------------------------------------------ */

interface FreqPresetPack {
  name: string;
  description: string;
  channels: { ch: number; name: string; freq: string; mod: string }[];
}

const FREQ_PRESET_PACKS: FreqPresetPack[] = [
  {
    name: 'Carrier Strike',
    description: 'Standard CVN strike package freqs',
    channels: [
      { ch: 1, name: 'STRIKE', freq: '270.800', mod: 'AM' },
      { ch: 2, name: 'MARSHAL', freq: '264.200', mod: 'AM' },
      { ch: 3, name: 'TOWER', freq: '305.000', mod: 'AM' },
      { ch: 4, name: 'DEPART', freq: '254.200', mod: 'AM' },
      { ch: 5, name: 'AWACS', freq: '251.000', mod: 'AM' },
      { ch: 6, name: 'TANKER', freq: '277.800', mod: 'AM' },
      { ch: 7, name: 'INTFLT', freq: '275.350', mod: 'AM' },
      { ch: 8, name: 'TACA', freq: '315.700', mod: 'AM' },
    ],
  },
  {
    name: 'Range Package',
    description: 'Air-to-ground range operations',
    channels: [
      { ch: 1, name: 'RANGE', freq: '268.000', mod: 'AM' },
      { ch: 2, name: 'JTAC', freq: '238.900', mod: 'AM' },
      { ch: 3, name: 'FAC', freq: '252.600', mod: 'AM' },
      { ch: 4, name: 'TOWER', freq: '305.000', mod: 'AM' },
      { ch: 5, name: 'AWACS', freq: '251.000', mod: 'AM' },
      { ch: 6, name: 'TANKER', freq: '277.800', mod: 'AM' },
    ],
  },
  {
    name: 'CAP Package',
    description: 'Combat Air Patrol standard freqs',
    channels: [
      { ch: 1, name: 'CAP PRI', freq: '257.000', mod: 'AM' },
      { ch: 2, name: 'CAP SEC', freq: '262.000', mod: 'AM' },
      { ch: 3, name: 'AWACS', freq: '251.000', mod: 'AM' },
      { ch: 4, name: 'TANKER', freq: '277.800', mod: 'AM' },
      { ch: 5, name: 'TOWER', freq: '305.000', mod: 'AM' },
      { ch: 6, name: 'DEPART', freq: '254.200', mod: 'AM' },
      { ch: 7, name: 'INTFLT', freq: '275.350', mod: 'AM' },
    ],
  },
  {
    name: 'CAS Package',
    description: 'Close Air Support operations',
    channels: [
      { ch: 1, name: 'CAS PRI', freq: '268.000', mod: 'AM' },
      { ch: 2, name: 'JTAC1', freq: '238.900', mod: 'AM' },
      { ch: 3, name: 'JTAC2', freq: '234.600', mod: 'AM' },
      { ch: 4, name: 'AWACS', freq: '251.000', mod: 'AM' },
      { ch: 5, name: 'TANKER', freq: '277.800', mod: 'AM' },
      { ch: 6, name: 'TOWER', freq: '305.000', mod: 'AM' },
      { ch: 7, name: 'INTFLT', freq: '275.350', mod: 'AM' },
      { ch: 8, name: 'ARTY', freq: '246.500', mod: 'AM' },
    ],
  },
  {
    name: 'SEAD Package',
    description: 'Suppression of Enemy Air Defenses',
    channels: [
      { ch: 1, name: 'SEAD PRI', freq: '265.500', mod: 'AM' },
      { ch: 2, name: 'SEAD SEC', freq: '269.000', mod: 'AM' },
      { ch: 3, name: 'AWACS', freq: '251.000', mod: 'AM' },
      { ch: 4, name: 'STRIKE', freq: '270.800', mod: 'AM' },
      { ch: 5, name: 'TANKER', freq: '277.800', mod: 'AM' },
      { ch: 6, name: 'TOWER', freq: '305.000', mod: 'AM' },
    ],
  },
];

const COMMON_FREQS: { name: string; freq: string; mod: string }[] = [
  { name: 'GUARD', freq: '243.000', mod: 'AM' },
  { name: 'NATO COM', freq: '251.000', mod: 'AM' },
  { name: 'TANKER', freq: '277.800', mod: 'AM' },
  { name: 'MARSHAL', freq: '264.200', mod: 'AM' },
  { name: 'TOWER', freq: '305.000', mod: 'AM' },
  { name: 'DEPART', freq: '254.200', mod: 'AM' },
  { name: 'UHF EMER', freq: '282.800', mod: 'AM' },
];

/* ------------------------------------------------------------------ */
/* Fuel Planner Data                                                   */
/* ------------------------------------------------------------------ */

const DEFAULT_FUEL_BURN = 5800; // lbs/hr cruise for F/A-18C
const HORNET_INTERNAL_FUEL = 10860; // lbs
const HORNET_BINGO_DEFAULT = 3000; // lbs

const BURN_PRESETS: { label: string; rate: number }[] = [
  { label: 'Econ', rate: 3800 },
  { label: 'Cruise', rate: 5800 },
  { label: 'Low Alt', rate: 7200 },
  { label: 'Mil', rate: 9500 },
  { label: 'Combat', rate: 12000 },
];


/* ------------------------------------------------------------------ */
/* DTC Templates                                                       */
/* ------------------------------------------------------------------ */

interface DtcTemplate {
  name: string;
  description: string;
  data: Partial<DtcData>;
}

const DTC_TEMPLATES: DtcTemplate[] = [
  {
    name: 'Carrier Day Strike',
    description: 'Standard carrier-based day strike package — CMDS aggressive, TACAN CVN',
    data: {
      CMDS: {
        AUTO_1: { chaffQty: 2, chaffInterval: 0.5, flareQty: 2, flareInterval: 0.5 },
        AUTO_2: { chaffQty: 4, chaffInterval: 1.0, flareQty: 4, flareInterval: 1.0 },
        MAN_1: { chaffQty: 1, chaffInterval: 0.2, flareQty: 1, flareInterval: 0.2 },
        MAN_2: { chaffQty: 6, chaffInterval: 0.5, flareQty: 0, flareInterval: 0 },
        MAN_3: { chaffQty: 0, chaffInterval: 0, flareQty: 6, flareInterval: 0.5 },
      } as Record<string, CmdsProgram>,
    },
  },
  {
    name: 'SAM Suppression',
    description: 'Heavy chaff programs for SEAD/DEAD missions',
    data: {
      CMDS: {
        AUTO_1: { chaffQty: 6, chaffInterval: 0.3, flareQty: 2, flareInterval: 0.5 },
        AUTO_2: { chaffQty: 8, chaffInterval: 0.5, flareQty: 4, flareInterval: 1.0 },
        MAN_1: { chaffQty: 10, chaffInterval: 0.2, flareQty: 0, flareInterval: 0 },
        MAN_2: { chaffQty: 1, chaffInterval: 0.2, flareQty: 1, flareInterval: 0.2 },
      } as Record<string, CmdsProgram>,
    },
  },
  {
    name: 'Air-to-Air Focus',
    description: 'CAP loadout with balanced countermeasures',
    data: {
      CMDS: {
        AUTO_1: { chaffQty: 2, chaffInterval: 0.5, flareQty: 2, flareInterval: 0.5 },
        AUTO_2: { chaffQty: 1, chaffInterval: 1.0, flareQty: 1, flareInterval: 1.0 },
        MAN_1: { chaffQty: 1, chaffInterval: 0.2, flareQty: 1, flareInterval: 0.2 },
      } as Record<string, CmdsProgram>,
    },
  },
  {
    name: 'CAS Low & Slow',
    description: 'Heavy flare programs for IR threat environment',
    data: {
      CMDS: {
        AUTO_1: { chaffQty: 1, chaffInterval: 1.0, flareQty: 4, flareInterval: 0.3 },
        AUTO_2: { chaffQty: 2, chaffInterval: 0.5, flareQty: 6, flareInterval: 0.5 },
        MAN_1: { chaffQty: 0, chaffInterval: 0, flareQty: 8, flareInterval: 0.2 },
        MAN_2: { chaffQty: 1, chaffInterval: 0.2, flareQty: 1, flareInterval: 0.2 },
      } as Record<string, CmdsProgram>,
    },
  },
];

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
  const [steerNotes, setSteerNotes] = useState<Record<number, string>>({});
  const [templateMsg, setTemplateMsg] = useState('');

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
      <div style={{ color: '#5a7a8a', fontSize: 15, padding: 20 }}>
        No F/A-18C flights found in this mission for DTC generation.
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#ccdae8' }}>
          F/A-18C DTC Builder
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#5a7a8a' }}>
          Load, edit, and export Data Transfer Cartridge files for Hornet flights.
        </p>
      </div>

      {/* Flight selector + Load */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <label style={{ color: '#8fa8c0', fontSize: 14 }}>Flight:</label>
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
        <div style={{ color: '#d95050', fontSize: 14, marginBottom: 12 }}>{error}</div>
      )}

      {!dtcData && !loading && (
        <div style={{ color: '#5a7a8a', fontSize: 14, padding: 20 }}>
          Select a flight and click "Load DTC" to begin editing.
        </div>
      )}

      {dtcData && (
        <>
          {/* Sub-tab navigation */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid #1a2a3a', flexWrap: 'wrap' }}>
            {([
              { key: 'comm', label: 'COMM' },
              { key: 'cmds', label: 'CMDS' },
              { key: 'waypoints', label: 'Waypoints' },
              { key: 'nav', label: 'NAV' },
              { key: 'fuel', label: 'Fuel' },
              { key: 'tools', label: 'Tools' },
              { key: 'presets', label: 'Presets' },
            ] as { key: SubTab; label: string }[]).map((t) => (
              <button
                key={t.key}
                onClick={() => setSubTab(t.key)}
                style={{
                  background: subTab === t.key ? '#0f1a28' : 'transparent',
                  border: 'none',
                  borderBottom: subTab === t.key ? '2px solid #4a8fd4' : '2px solid transparent',
                  color: subTab === t.key ? '#ccdae8' : '#5a7a8a',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontFamily: 'inherit',
                  padding: '8px 16px',
                  fontWeight: subTab === t.key ? 600 : 400,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {subTab === 'comm' && <CommSubTab data={dtcData.COMM} onUpdate={updateComm} />}
          {subTab === 'cmds' && <CmdsSubTab data={dtcData.CMDS ?? {}} onUpdate={updateCmds} />}
          {subTab === 'waypoints' && <WaypointsSubTab data={dtcData.WYPT?.NAV_PTS ?? []} steerNotes={steerNotes} setSteerNotes={setSteerNotes} />}
          {subTab === 'nav' && <NavSubTab data={dtcData.WYPT?.NAV_SETTINGS ?? { TACAN: { channel: 1, band: 'X', mode: 'T-R', enabled: false }, ICLS: { channel: 1, enabled: false } }} onUpdate={updateNav} selectedFlight={selectedFlight} />}
          {subTab === 'fuel' && <FuelPlannerSubTab waypoints={dtcData.WYPT?.NAV_PTS ?? []} />}
          {subTab === 'tools' && <ToolsSubTab waypoints={dtcData.WYPT?.NAV_PTS ?? []} dtcData={dtcData} setDtcData={setDtcData} selectedFlight={selectedFlight} />}
          {subTab === 'presets' && <PresetsSubTab setDtcData={setDtcData} templateMsg={templateMsg} setTemplateMsg={setTemplateMsg} />}
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
    <div>
      {/* Radio tables */}
      <div style={{ display: 'flex', gap: 24 }}>
        {(['COMM1', 'COMM2'] as const).map((radio) => (
          <div key={radio} style={{ flex: 1 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 600, color: '#8fa8c0' }}>{radio}</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#ccdae8' }}>
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
                          style={{ ...selectStyle, fontSize: 13, padding: '3px 4px' }}
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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* CMDS sub-tab                                                        */
/* ------------------------------------------------------------------ */

const CMDS_AUTOFILL: Record<string, CmdsProgram> = {
  AUTO_1: { chaffQty: 2, chaffInterval: 0.5, flareQty: 2, flareInterval: 0.5 },
  AUTO_2: { chaffQty: 4, chaffInterval: 1.0, flareQty: 4, flareInterval: 1.0 },
  AUTO_3: { chaffQty: 1, chaffInterval: 1.0, flareQty: 1, flareInterval: 1.0 },
  MAN_1: { chaffQty: 1, chaffInterval: 0.2, flareQty: 1, flareInterval: 0.2 },
  MAN_2: { chaffQty: 6, chaffInterval: 0.5, flareQty: 0, flareInterval: 0 },
  MAN_3: { chaffQty: 0, chaffInterval: 0, flareQty: 6, flareInterval: 0.5 },
  MAN_4: { chaffQty: 10, chaffInterval: 0.2, flareQty: 0, flareInterval: 0 },
  MAN_5: { chaffQty: 0, chaffInterval: 0, flareQty: 10, flareInterval: 0.2 },
  MAN_6: { chaffQty: 2, chaffInterval: 0.5, flareQty: 2, flareInterval: 0.5 },
  BYP: { chaffQty: 1, chaffInterval: 0.5, flareQty: 1, flareInterval: 0.5 },
};

function CmdsSubTab({ data, onUpdate }: {
  data: Record<string, CmdsProgram>;
  onUpdate: (program: string, field: keyof CmdsProgram, value: number) => void;
}) {
  const handleAutoFill = () => {
    for (const [prog, vals] of Object.entries(CMDS_AUTOFILL)) {
      onUpdate(prog, 'chaffQty', vals.chaffQty);
      onUpdate(prog, 'chaffInterval', vals.chaffInterval);
      onUpdate(prog, 'flareQty', vals.flareQty);
      onUpdate(prog, 'flareInterval', vals.flareInterval);
    }
  };

  return (
    <>
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
      <button onClick={handleAutoFill} style={{
        background: '#1a3a5a', border: '1px solid #2a5a8a', borderRadius: 4,
        color: '#6ab4f0', padding: '5px 14px', fontSize: 12, cursor: 'pointer',
        fontWeight: 600,
      }}>
        Auto Fill
      </button>
    </div>
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#ccdae8', maxWidth: 700 }}>
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
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Waypoints sub-tab (read-only)                                       */
/* ------------------------------------------------------------------ */

function WaypointsSubTab({ data, steerNotes, setSteerNotes }: {
  data: NavPoint[];
  steerNotes: Record<number, string>;
  setSteerNotes: React.Dispatch<React.SetStateAction<Record<number, string>>>;
}) {
  if (data.length === 0) {
    return <div style={{ color: '#5a7a8a', fontSize: 14 }}>No waypoints in DTC data.</div>;
  }

  // Compute leg distances (simplified great circle approx)
  const distances = useMemo(() => {
    const dists: number[] = [0];
    for (let i = 1; i < data.length; i++) {
      const prev = data[i - 1];
      const curr = data[i];
      const lat1 = parseCoord(prev.lat);
      const lon1 = parseCoord(prev.lon);
      const lat2 = parseCoord(curr.lat);
      const lon2 = parseCoord(curr.lon);
      if (lat1 !== null && lon1 !== null && lat2 !== null && lon2 !== null) {
        dists.push(haversineNm(lat1, lon1, lat2, lon2));
      } else {
        dists.push(0);
      }
    }
    return dists;
  }, [data]);

  const totalDist = distances.reduce((s, d) => s + d, 0);

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
        <span style={{ color: '#5a7a8a', fontSize: 12 }}>
          {data.length} waypoints · Total: <strong style={{ color: '#ccdae8' }}>{totalDist.toFixed(1)} nm</strong>
        </span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#ccdae8' }}>
        <thead>
          <tr style={{ color: '#5a7a8a', borderBottom: '1px solid #1a2a3a', background: '#080f1c' }}>
            <th style={{ ...thStyle, width: 36 }}>#</th>
            <th style={thStyle}>Name</th>
            <th style={thStyle}>Lat</th>
            <th style={thStyle}>Lon</th>
            <th style={thStyle}>Alt (ft)</th>
            <th style={{ ...thStyle, width: 70 }}>Leg nm</th>
            <th style={thStyle}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {data.map((wp, i) => {
            const wpNum = wp.number ?? i + 1;
            return (
              <tr key={wpNum} style={{ borderBottom: '1px solid #0f1a28' }}>
                <td style={{ ...tdStyle, fontFamily: 'monospace', color: '#5a7a8a' }}>{wpNum}</td>
                <td style={tdStyle}>{wp.name || '-'}</td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>{wp.lat}</td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>{wp.lon}</td>
                <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{wp.alt}</td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', color: distances[i] > 0 ? '#d29922' : '#2a3a4a', fontSize: 12 }}>
                  {distances[i] > 0 ? distances[i].toFixed(1) : '—'}
                </td>
                <td style={tdStyle}>
                  <input
                    value={steerNotes[wpNum] ?? ''}
                    onChange={(e) => setSteerNotes((prev) => ({ ...prev, [wpNum]: e.target.value }))}
                    placeholder="IP, push, fence in..."
                    style={{ ...monoInputStyle, width: '100%', fontSize: 11, fontFamily: 'inherit', color: '#8fa8c0' }}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* NAV sub-tab                                                         */
/* ------------------------------------------------------------------ */

function NavSubTab({ data, onUpdate, selectedFlight }: {
  data: NavSettings;
  onUpdate: (section: 'TACAN' | 'ICLS' | 'ACLS', field: string, value: unknown) => void;
  selectedFlight: string;
}) {
  const groups = useMissionStore((s) => s.groups);
  const tacan = data.TACAN;
  const icls = data.ICLS;
  const acls = data.ACLS ?? { frequency: '', enabled: false };

  // Collect nav-relevant data from all mission groups
  const navRefs = useMemo(() => {
    const refs: { name: string; type: string; freq?: string; tacan?: string; icls?: string; isSelected?: boolean }[] = [];
    for (const g of groups) {
      const hasNav = g.tacan || g.icls || g.frequency;
      if (!hasNav) continue;
      const entry: typeof refs[0] = { name: g.groupName, type: g.category || '' };
      if (g.frequency) {
        const freqMhz = g.frequency >= 1e6 ? (g.frequency / 1e6).toFixed(3) : g.frequency.toFixed(3);
        entry.freq = `${freqMhz} ${g.modulation === 1 ? 'AM' : 'FM'}`;
      }
      if (g.tacan) entry.tacan = `${g.tacan.channel}${g.tacan.band}${g.tacan.callsign ? ' ' + g.tacan.callsign : ''}`;
      if (g.icls) entry.icls = `CH ${g.icls.channel}`;
      if (g.groupName === selectedFlight) entry.isSelected = true;
      refs.push(entry);
    }
    return refs;
  }, [groups, selectedFlight]);

  return (
    <div style={{ display: 'flex', gap: 20 }}>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 500, flex: '1 1 auto' }}>
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
              style={{ ...selectStyle, fontSize: 13, padding: '3px 4px' }}
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
              style={{ ...selectStyle, fontSize: 13, padding: '3px 4px' }}
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

    {/* Mission Nav Reference */}
    {navRefs.length > 0 && (
      <div style={{
        flex: '1 1 300px', maxWidth: 420, background: '#080f1c',
        border: '1px solid #1a2a3a', borderRadius: 6, padding: 12,
        maxHeight: 400, overflowY: 'auto', alignSelf: 'flex-start',
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#5a7a8a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
          Mission Nav Data
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: '#5a7a8a', borderBottom: '1px solid #1a2a3a' }}>
              <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 600 }}>Unit</th>
              <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 600 }}>Freq</th>
              <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 600 }}>TACAN</th>
              <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 600 }}>ICLS</th>
            </tr>
          </thead>
          <tbody>
            {navRefs.map((r) => (
              <tr key={r.name} style={{
                borderBottom: '1px solid #0f1a28',
                background: r.isSelected ? 'rgba(74, 143, 212, 0.08)' : 'transparent',
              }}>
                <td style={{ padding: '4px 6px', color: r.isSelected ? '#6ab4f0' : '#8fa8c0', fontWeight: r.isSelected ? 600 : 400 }}>
                  {r.name}
                </td>
                <td style={{ padding: '4px 6px', color: '#ccdae8', fontFamily: 'monospace' }}>{r.freq || '-'}</td>
                <td style={{ padding: '4px 6px', color: '#d29922', fontFamily: 'monospace' }}>{r.tacan || '-'}</td>
                <td style={{ padding: '4px 6px', color: '#3fb950', fontFamily: 'monospace' }}>{r.icls || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fuel Planner sub-tab                                                */
/* ------------------------------------------------------------------ */

function FuelPlannerSubTab({ waypoints }: { waypoints: NavPoint[] }) {
  const groups = useMissionStore((s) => s.groups);

  // Find tankers in mission (groups with task "Refueling" or "Tanker")
  const tankers = useMemo(() => {
    return groups.filter((g) =>
      g.task === 'Refueling' || g.task === 'Tanker' ||
      g.groupName.toLowerCase().includes('tanker') || g.groupName.toLowerCase().includes('texaco') ||
      g.groupName.toLowerCase().includes('shell') || g.groupName.toLowerCase().includes('arco')
    ).map((g) => ({
      name: g.groupName,
      freq: g.frequency ? (g.frequency >= 1e6 ? (g.frequency / 1e6).toFixed(3) : g.frequency.toFixed(3)) + (g.modulation === 1 ? ' AM' : ' FM') : null,
      tacan: g.tacan ? `${g.tacan.channel}${g.tacan.band}${g.tacan.callsign ? ' ' + g.tacan.callsign : ''}` : null,
    }));
  }, [groups]);
  const [startFuel, setStartFuel] = useState(HORNET_INTERNAL_FUEL);
  const [bingo, setBingo] = useState(HORNET_BINGO_DEFAULT);
  const [groundSpeed, setGroundSpeed] = useState(420);
  const [burnRate, setBurnRate] = useState(DEFAULT_FUEL_BURN);

  const fuelPlan = useMemo(() => {
    const plan: { wpNum: number; name: string; legNm: number; legMin: number; fuelUsed: number; fuelRemaining: number }[] = [];
    let remaining = startFuel;

    for (let i = 0; i < waypoints.length; i++) {
      const wp = waypoints[i];
      let legNm = 0;
      if (i > 0) {
        const prev = waypoints[i - 1];
        const lat1 = parseCoord(prev.lat);
        const lon1 = parseCoord(prev.lon);
        const lat2 = parseCoord(wp.lat);
        const lon2 = parseCoord(wp.lon);
        if (lat1 !== null && lon1 !== null && lat2 !== null && lon2 !== null) {
          legNm = haversineNm(lat1, lon1, lat2, lon2);
        }
      }
      const legMin = groundSpeed > 0 ? (legNm / groundSpeed) * 60 : 0;
      const fuelUsed = (burnRate / 60) * legMin;
      remaining -= fuelUsed;

      plan.push({
        wpNum: wp.number ?? i + 1,
        name: wp.name || `WP ${i + 1}`,
        legNm,
        legMin,
        fuelUsed,
        fuelRemaining: remaining,
      });
    }
    return plan;
  }, [waypoints, startFuel, groundSpeed, burnRate]);

  const totalDist = fuelPlan.reduce((s, p) => s + p.legNm, 0);
  const totalTime = fuelPlan.reduce((s, p) => s + p.legMin, 0);
  const totalBurn = startFuel - (fuelPlan.length > 0 ? fuelPlan[fuelPlan.length - 1].fuelRemaining : startFuel);

  return (
    <div>
      {/* Settings row */}
      <div style={{
        display: 'flex', gap: 16, marginBottom: 14, padding: '10px 12px',
        background: '#0a1218', borderRadius: 6, border: '1px solid #12202e',
        flexWrap: 'wrap', alignItems: 'center',
      }}>
        <label style={{ color: '#5a7a8a', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          Start Fuel (lbs)
          <input type="number" value={startFuel} onChange={(e) => setStartFuel(Number(e.target.value))}
            style={{ ...monoInputStyle, width: 80 }} />
        </label>
        <label style={{ color: '#5a7a8a', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          Bingo (lbs)
          <input type="number" value={bingo} onChange={(e) => setBingo(Number(e.target.value))}
            style={{ ...monoInputStyle, width: 70 }} />
        </label>
        <label style={{ color: '#5a7a8a', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          GS (kts)
          <input type="number" value={groundSpeed} onChange={(e) => setGroundSpeed(Number(e.target.value))}
            style={{ ...monoInputStyle, width: 60 }} />
        </label>
        <label style={{ color: '#5a7a8a', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          Burn (lbs/hr)
          <input type="number" value={burnRate} onChange={(e) => setBurnRate(Number(e.target.value))}
            style={{ ...monoInputStyle, width: 70 }} />
        </label>
        <div style={{ display: 'flex', gap: 3, marginLeft: 4 }}>
          {BURN_PRESETS.map((p) => (
            <button key={p.label} onClick={() => setBurnRate(p.rate)}
              style={{
                background: burnRate === p.rate ? '#1a3a5a' : '#0f1a28',
                border: `1px solid ${burnRate === p.rate ? '#2a5a8a' : '#1a2a3a'}`,
                borderRadius: 3, color: burnRate === p.rate ? '#6ab4f0' : '#5a7a8a',
                fontSize: 10, padding: '3px 7px', cursor: 'pointer', fontWeight: 600,
              }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary bar */}
      <div style={{
        display: 'flex', gap: 20, marginBottom: 14, padding: '8px 12px',
        background: '#0f1a28', borderRadius: 4, border: '1px solid #1a2a3a',
      }}>
        <FuelStat label="Total Dist" value={`${totalDist.toFixed(1)} nm`} />
        <FuelStat label="Total Time" value={`${totalTime.toFixed(0)} min`} />
        <FuelStat label="Total Burn" value={`${totalBurn.toFixed(0)} lbs`} />
        <FuelStat label="Landing Fuel" value={`${(startFuel - totalBurn).toFixed(0)} lbs`}
          color={(startFuel - totalBurn) < bingo ? '#d95050' : (startFuel - totalBurn) < bingo * 1.3 ? '#d29922' : '#3fb950'} />
      </div>

      {/* Fuel plan table */}
      {waypoints.length === 0 ? (
        <div style={{ color: '#5a7a8a', fontSize: 14 }}>No waypoints — load DTC with waypoints first.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#ccdae8', maxWidth: 800 }}>
          <thead>
            <tr style={{ color: '#5a7a8a', borderBottom: '1px solid #1a2a3a', background: '#080f1c' }}>
              <th style={{ ...thStyle, width: 36 }}>#</th>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Leg (nm)</th>
              <th style={thStyle}>Time (min)</th>
              <th style={thStyle}>Fuel Used</th>
              <th style={thStyle}>Fuel Rem.</th>
            </tr>
          </thead>
          <tbody>
            {fuelPlan.map((leg) => {
              const belowBingo = leg.fuelRemaining < bingo;
              const nearBingo = leg.fuelRemaining < bingo * 1.3;
              return (
                <tr key={leg.wpNum} style={{ borderBottom: '1px solid #0f1a28' }}>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', color: '#5a7a8a' }}>{leg.wpNum}</td>
                  <td style={tdStyle}>{leg.name}</td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{leg.legNm > 0 ? leg.legNm.toFixed(1) : '—'}</td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{leg.legMin > 0 ? leg.legMin.toFixed(1) : '—'}</td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{leg.fuelUsed > 0 ? leg.fuelUsed.toFixed(0) : '—'}</td>
                  <td style={{
                    ...tdStyle, fontFamily: 'monospace', fontWeight: 600,
                    color: belowBingo ? '#d95050' : nearBingo ? '#d29922' : '#3fb950',
                  }}>
                    {leg.fuelRemaining.toFixed(0)}
                    {belowBingo && ' ⚠ BINGO'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Visual fuel gauge */}
      <div style={{ marginTop: 16 }}>
        <div style={{ color: '#5a7a8a', fontSize: 12, marginBottom: 6 }}>Fuel Gauge</div>
        <div style={{
          height: 24, background: '#0a1218', borderRadius: 4,
          border: '1px solid #1a2a3a', position: 'relative', overflow: 'hidden',
        }}>
          {/* Bingo line */}
          <div style={{
            position: 'absolute', left: `${(bingo / startFuel) * 100}%`, top: 0, bottom: 0,
            width: 2, background: '#d95050', zIndex: 2,
          }} />
          <div style={{
            position: 'absolute', left: `${(bingo / startFuel) * 100}%`, top: -2,
            color: '#d95050', fontSize: 9, transform: 'translateX(-50%)',
          }}>BINGO</div>
          {/* Current fuel */}
          {fuelPlan.length > 0 && (
            <div style={{
              height: '100%',
              width: `${Math.max(0, (fuelPlan[fuelPlan.length - 1].fuelRemaining / startFuel) * 100)}%`,
              background: fuelPlan[fuelPlan.length - 1].fuelRemaining < bingo
                ? 'linear-gradient(90deg, #d95050, #d95050aa)'
                : fuelPlan[fuelPlan.length - 1].fuelRemaining < bingo * 1.3
                ? 'linear-gradient(90deg, #d29922, #d29922aa)'
                : 'linear-gradient(90deg, #3fb950, #3fb950aa)',
              borderRadius: 3,
              transition: 'width 0.3s',
            }} />
          )}
        </div>
      </div>

      {/* Tanker reference */}
      {tankers.length > 0 && (
        <div style={{
          marginTop: 16, padding: 12, background: '#080f1c',
          border: '1px solid #1a2a3a', borderRadius: 6,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#5a7a8a', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Tankers in Mission
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {tankers.map((t) => (
              <div key={t.name} style={{
                padding: '8px 12px', background: '#0f1a28', borderRadius: 4,
                border: '1px solid #1a2a3a', fontSize: 12,
              }}>
                <div style={{ color: '#ccdae8', fontWeight: 600, marginBottom: 4 }}>{t.name}</div>
                <div style={{ display: 'flex', gap: 12 }}>
                  {t.freq && <span style={{ color: '#8fa8c0', fontFamily: 'monospace' }}>{t.freq}</span>}
                  {t.tacan && <span style={{ color: '#d29922', fontFamily: 'monospace' }}>TCN {t.tacan}</span>}
                  {!t.freq && !t.tacan && <span style={{ color: '#3a5a6a' }}>No freq/TACAN set</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FuelStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ color: '#5a7a8a', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' as const }}>{label}</div>
      <div style={{ color: color || '#ccdae8', fontSize: 14, fontWeight: 600, fontFamily: 'monospace' }}>{value}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tools sub-tab                                                       */
/* ------------------------------------------------------------------ */

function ToolsSubTab({ waypoints, dtcData, setDtcData, selectedFlight }: {
  waypoints: NavPoint[];
  dtcData: DtcData;
  setDtcData: React.Dispatch<React.SetStateAction<DtcData | null>>;
  selectedFlight: string;
}) {
  const [toolSection, setToolSection] = useState<'bullseye' | 'speedtime' | 'wingman'>('bullseye');

  return (
    <div>
      {/* Tool selector pills */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {([
          { key: 'bullseye', label: '◎ Bullseye Ref' },
          { key: 'speedtime', label: '⏱ Speed/Time' },
          { key: 'wingman', label: '✈ Copy to Wingman' },
        ] as { key: typeof toolSection; label: string }[]).map((t) => (
          <button
            key={t.key}
            onClick={() => setToolSection(t.key)}
            style={{
              background: toolSection === t.key ? '#1a3a5a20' : 'transparent',
              border: `1px solid ${toolSection === t.key ? '#4a8fd4' : '#1a2a3a'}`,
              borderRadius: 14, color: toolSection === t.key ? '#4a8fd4' : '#5a7a8a',
              cursor: 'pointer', fontSize: 12, padding: '5px 14px',
              fontWeight: toolSection === t.key ? 600 : 400,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {toolSection === 'bullseye' && <BullseyeRef waypoints={waypoints} />}
      {toolSection === 'speedtime' && <SpeedTimeCalc waypoints={waypoints} />}
      {toolSection === 'wingman' && <CopyToWingman dtcData={dtcData} setDtcData={setDtcData} selectedFlight={selectedFlight} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Bullseye Reference                                                  */
/* ------------------------------------------------------------------ */

function BullseyeRef({ waypoints }: { waypoints: NavPoint[] }) {
  const [beLat, setBeLat] = useState('');
  const [beLon, setBeLon] = useState('');

  const beLatNum = parseCoord(beLat);
  const beLonNum = parseCoord(beLon);

  const results = useMemo(() => {
    if (beLatNum === null || beLonNum === null) return [];
    return waypoints.map((wp, i) => {
      const wLat = parseCoord(wp.lat);
      const wLon = parseCoord(wp.lon);
      if (wLat === null || wLon === null) return { wpNum: wp.number ?? i + 1, name: wp.name, bearing: 0, range: 0, valid: false };
      const range = haversineNm(beLatNum, beLonNum, wLat, wLon);
      const bearing = calcBearing(beLatNum, beLonNum, wLat, wLon);
      return { wpNum: wp.number ?? i + 1, name: wp.name, bearing, range, valid: true };
    });
  }, [waypoints, beLatNum, beLonNum]);

  return (
    <div>
      <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: '#8fa8c0' }}>
        Bullseye Reference
      </h4>
      <p style={{ color: '#5a7a8a', fontSize: 12, margin: '0 0 12px' }}>
        Enter bullseye coordinates to see bearing/range from each waypoint.
      </p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 14, alignItems: 'center' }}>
        <label style={{ color: '#5a7a8a', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          BE Lat
          <input value={beLat} onChange={(e) => setBeLat(e.target.value)} placeholder="N41°15'30&quot;"
            style={{ ...monoInputStyle, width: 130 }} />
        </label>
        <label style={{ color: '#5a7a8a', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          BE Lon
          <input value={beLon} onChange={(e) => setBeLon(e.target.value)} placeholder="E044°30'00&quot;"
            style={{ ...monoInputStyle, width: 130 }} />
        </label>
      </div>

      {results.length > 0 && beLatNum !== null && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#ccdae8', maxWidth: 500 }}>
          <thead>
            <tr style={{ color: '#5a7a8a', borderBottom: '1px solid #1a2a3a', background: '#080f1c' }}>
              <th style={{ ...thStyle, width: 36 }}>#</th>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Bearing</th>
              <th style={thStyle}>Range (nm)</th>
              <th style={thStyle}>Bullseye Call</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.wpNum} style={{ borderBottom: '1px solid #0f1a28' }}>
                <td style={{ ...tdStyle, fontFamily: 'monospace', color: '#5a7a8a' }}>{r.wpNum}</td>
                <td style={tdStyle}>{r.name || '-'}</td>
                <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{r.valid ? `${r.bearing.toFixed(0)}°` : '—'}</td>
                <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{r.valid ? r.range.toFixed(1) : '—'}</td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', color: '#d29922', fontWeight: 600 }}>
                  {r.valid ? `${r.bearing.toFixed(0).padStart(3, '0')}/${r.range.toFixed(0)}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Speed / Time Calculator                                             */
/* ------------------------------------------------------------------ */

function zuluToMinutes(zulu: string): number | null {
  const m = zulu.match(/^(\d{1,2}):?(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function minutesToZulu(min: number): string {
  const h = Math.floor(((min % 1440) + 1440) % 1440 / 60);
  const m = Math.round(((min % 1440) + 1440) % 1440 % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}Z`;
}

function SpeedTimeCalc({ waypoints }: { waypoints: NavPoint[] }) {
  const [mode, setMode] = useState<'minutes' | 'zulu_tot' | 'zulu_speed'>('zulu_tot');
  const [tosMinutes, setTosMinutes] = useState(30);
  const [targetWp, setTargetWp] = useState(1);
  const [departZulu, setDepartZulu] = useState('');
  const [totZulu, setTotZulu] = useState('');
  const [inputSpeed, setInputSpeed] = useState(420);

  // Distance from WP1 to target WP
  const totalNm = useMemo(() => {
    let nm = 0;
    const targetIdx = waypoints.findIndex((wp) => (wp.number ?? 0) === targetWp);
    if (targetIdx <= 0) return 0;
    for (let i = 1; i <= targetIdx; i++) {
      const prev = waypoints[i - 1];
      const curr = waypoints[i];
      const lat1 = parseCoord(prev.lat);
      const lon1 = parseCoord(prev.lon);
      const lat2 = parseCoord(curr.lat);
      const lon2 = parseCoord(curr.lon);
      if (lat1 !== null && lon1 !== null && lat2 !== null && lon2 !== null) {
        nm += haversineNm(lat1, lon1, lat2, lon2);
      }
    }
    return nm;
  }, [waypoints, targetWp]);

  const result = useMemo(() => {
    if (totalNm <= 0) return null;

    if (mode === 'minutes') {
      if (tosMinutes <= 0) return null;
      const gs = (totalNm / tosMinutes) * 60;
      return { gs, mach: gs / 590, enrouteMin: tosMinutes, arrivalZulu: null, departureZulu: null };
    }

    if (mode === 'zulu_tot') {
      const dep = zuluToMinutes(departZulu);
      const tot = zuluToMinutes(totZulu);
      if (dep === null || tot === null) return null;
      let enroute = tot - dep;
      if (enroute <= 0) enroute += 1440; // next day
      const gs = (totalNm / enroute) * 60;
      return { gs, mach: gs / 590, enrouteMin: enroute, arrivalZulu: minutesToZulu(tot), departureZulu: minutesToZulu(dep) };
    }

    if (mode === 'zulu_speed') {
      const dep = zuluToMinutes(departZulu);
      if (dep === null || inputSpeed <= 0) return null;
      const enroute = (totalNm / inputSpeed) * 60;
      const arrival = dep + enroute;
      return { gs: inputSpeed, mach: inputSpeed / 590, enrouteMin: enroute, arrivalZulu: minutesToZulu(arrival), departureZulu: minutesToZulu(dep) };
    }

    return null;
  }, [mode, totalNm, tosMinutes, departZulu, totZulu, inputSpeed]);

  const modeLabel = { minutes: 'Minutes', zulu_tot: 'Zulu TOT', zulu_speed: 'Zulu + Speed' };

  return (
    <div>
      <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: '#8fa8c0' }}>
        Speed / Time Calculator
      </h4>
      <p style={{ color: '#5a7a8a', fontSize: 12, margin: '0 0 12px' }}>
        Compute required ground speed or arrival time for a waypoint.
      </p>

      {/* Mode selector */}
      <div style={{ display: 'flex', gap: 3, marginBottom: 14 }}>
        {(['zulu_tot', 'zulu_speed', 'minutes'] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} style={{
            background: mode === m ? '#1a3a5a' : '#0f1a28',
            border: `1px solid ${mode === m ? '#2a5a8a' : '#1a2a3a'}`,
            borderRadius: 3, color: mode === m ? '#6ab4f0' : '#5a7a8a',
            fontSize: 11, padding: '4px 10px', cursor: 'pointer', fontWeight: 600,
          }}>
            {modeLabel[m]}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ color: '#5a7a8a', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          Target WP
          <select value={targetWp} onChange={(e) => setTargetWp(Number(e.target.value))}
            style={{ ...selectStyle, fontSize: 13, padding: '3px 6px' }}>
            {waypoints.map((wp, i) => (
              <option key={wp.number ?? i + 1} value={wp.number ?? i + 1}>
                WP {wp.number ?? i + 1} — {wp.name || 'unnamed'}
              </option>
            ))}
          </select>
        </label>

        {mode === 'minutes' && (
          <label style={{ color: '#5a7a8a', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            Enroute (min)
            <input type="number" value={tosMinutes} onChange={(e) => setTosMinutes(Number(e.target.value))}
              min={1} max={300} style={{ ...monoInputStyle, width: 60 }} />
          </label>
        )}

        {(mode === 'zulu_tot' || mode === 'zulu_speed') && (
          <label style={{ color: '#5a7a8a', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            Depart (Zulu)
            <input value={departZulu} onChange={(e) => setDepartZulu(e.target.value)}
              placeholder="08:00" style={{ ...monoInputStyle, width: 70 }} />
          </label>
        )}

        {mode === 'zulu_tot' && (
          <label style={{ color: '#5a7a8a', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            TOT (Zulu)
            <input value={totZulu} onChange={(e) => setTotZulu(e.target.value)}
              placeholder="08:45" style={{ ...monoInputStyle, width: 70 }} />
          </label>
        )}

        {mode === 'zulu_speed' && (
          <label style={{ color: '#5a7a8a', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            GS (kts)
            <input type="number" value={inputSpeed} onChange={(e) => setInputSpeed(Number(e.target.value))}
              min={50} max={1200} style={{ ...monoInputStyle, width: 70 }} />
          </label>
        )}
      </div>

      {totalNm > 0 && (
        <div style={{ color: '#5a7a8a', fontSize: 12, marginBottom: 8 }}>
          Distance to target: <span style={{ color: '#ccdae8', fontFamily: 'monospace' }}>{totalNm.toFixed(1)} nm</span>
        </div>
      )}

      {result && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12,
          padding: '12px', background: '#0a1218', borderRadius: 6, border: '1px solid #12202e',
        }}>
          <div>
            <div style={{ color: '#5a7a8a', fontSize: 10, fontWeight: 600 }}>DISTANCE</div>
            <div style={{ color: '#ccdae8', fontSize: 16, fontWeight: 600, fontFamily: 'monospace' }}>{totalNm.toFixed(1)} nm</div>
          </div>
          <div>
            <div style={{ color: '#5a7a8a', fontSize: 10, fontWeight: 600 }}>{mode === 'zulu_speed' ? 'GS' : 'REQ GS'}</div>
            <div style={{ color: '#4a8fd4', fontSize: 16, fontWeight: 600, fontFamily: 'monospace' }}>{result.gs.toFixed(0)} kts</div>
          </div>
          <div>
            <div style={{ color: '#5a7a8a', fontSize: 10, fontWeight: 600 }}>~MACH</div>
            <div style={{ color: '#d29922', fontSize: 16, fontWeight: 600, fontFamily: 'monospace' }}>{result.mach.toFixed(2)}</div>
          </div>
          <div>
            <div style={{ color: '#5a7a8a', fontSize: 10, fontWeight: 600 }}>ENROUTE</div>
            <div style={{ color: '#ccdae8', fontSize: 16, fontWeight: 600, fontFamily: 'monospace' }}>{result.enrouteMin.toFixed(0)} min</div>
          </div>
          {result.departureZulu && (
            <div>
              <div style={{ color: '#5a7a8a', fontSize: 10, fontWeight: 600 }}>DEPART</div>
              <div style={{ color: '#3fb950', fontSize: 16, fontWeight: 600, fontFamily: 'monospace' }}>{result.departureZulu}</div>
            </div>
          )}
          {result.arrivalZulu && (
            <div>
              <div style={{ color: '#5a7a8a', fontSize: 10, fontWeight: 600 }}>{mode === 'zulu_speed' ? 'ETA' : 'TOT'}</div>
              <div style={{ color: '#3fb950', fontSize: 16, fontWeight: 600, fontFamily: 'monospace' }}>{result.arrivalZulu}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Copy DTC to Wingman                                                 */
/* ------------------------------------------------------------------ */

function CopyToWingman({ dtcData, setDtcData, selectedFlight: _selectedFlight }: {
  dtcData: DtcData;
  setDtcData: React.Dispatch<React.SetStateAction<DtcData | null>>;
  selectedFlight: string;
}) {
  const [freqOffset, setFreqOffset] = useState(0.5);
  const [copied, setCopied] = useState(false);

  const wingmanPreview = useMemo(() => {
    if (!dtcData?.COMM?.COMM1) return [];
    const channels: { ch: string; origFreq: string; newFreq: string; name: string }[] = [];
    for (const chKey of COMM_CHANNELS.slice(0, 20)) {
      const ch = dtcData.COMM.COMM1[chKey];
      if (ch && ch.frequency && parseFloat(ch.frequency) > 0) {
        const orig = parseFloat(ch.frequency);
        const newFreq = (orig + freqOffset).toFixed(3);
        channels.push({ ch: channelLabel(chKey), origFreq: ch.frequency, newFreq, name: ch.name ?? '' });
      }
    }
    return channels;
  }, [dtcData, freqOffset]);

  const applyWingmanOffset = () => {
    setDtcData((prev) => {
      if (!prev) return prev;
      const comm1 = { ...prev.COMM.COMM1 };
      for (const chKey of COMM_CHANNELS.slice(0, 20)) {
        const ch = comm1[chKey];
        if (ch && ch.frequency && parseFloat(ch.frequency) > 0) {
          const newFreq = (parseFloat(ch.frequency) + freqOffset).toFixed(3);
          comm1[chKey] = { ...ch, frequency: newFreq };
        }
      }
      return { ...prev, COMM: { ...prev.COMM, COMM1: comm1 } };
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  return (
    <div>
      <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: '#8fa8c0' }}>
        Copy DTC to Wingman
      </h4>
      <p style={{ color: '#5a7a8a', fontSize: 12, margin: '0 0 12px' }}>
        Offset COMM1 frequencies for wingman DTC. Waypoints and CMDS are copied as-is.
      </p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 14, alignItems: 'center' }}>
        <label style={{ color: '#5a7a8a', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          Freq Offset (MHz)
          <input type="number" value={freqOffset} step={0.025} min={-5} max={5}
            onChange={(e) => setFreqOffset(Number(e.target.value))}
            style={{ ...monoInputStyle, width: 80 }} />
        </label>
        <button onClick={applyWingmanOffset} style={{
          ...btnStyle, background: '#1a3a5a', color: '#4a8fd4',
        }}>
          Apply Offset to COMM1
        </button>
        {copied && <span style={{ color: '#3fb950', fontSize: 12 }}>✓ Offset applied!</span>}
      </div>

      {wingmanPreview.length > 0 && (
        <div style={{ maxWidth: 500 }}>
          <div style={{ color: '#5a7a8a', fontSize: 11, marginBottom: 6 }}>Preview (COMM1 offset +{freqOffset} MHz):</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: '#ccdae8' }}>
            <thead>
              <tr style={{ color: '#5a7a8a', borderBottom: '1px solid #1a2a3a', background: '#080f1c' }}>
                <th style={{ ...thStyle, fontSize: 11 }}>Ch</th>
                <th style={{ ...thStyle, fontSize: 11 }}>Name</th>
                <th style={{ ...thStyle, fontSize: 11 }}>Original</th>
                <th style={{ ...thStyle, fontSize: 11 }}>→ Wingman</th>
              </tr>
            </thead>
            <tbody>
              {wingmanPreview.map((p) => (
                <tr key={p.ch} style={{ borderBottom: '1px solid #0f1a28' }}>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', color: '#5a7a8a' }}>{p.ch}</td>
                  <td style={tdStyle}>{p.name}</td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{p.origFreq}</td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', color: '#d29922' }}>{p.newFreq}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Coordinate & navigation helpers                                     */
/* ------------------------------------------------------------------ */

/** Parse a DCS-style coordinate string (e.g. "N41°15'30\"" or decimal) to decimal degrees */
function parseCoord(raw: string): number | null {
  if (!raw) return null;
  // Try decimal first
  const dec = parseFloat(raw);
  if (!isNaN(dec) && raw.match(/^-?\d+(\.\d+)?$/)) return dec;

  // DMS: N41°15'30" or similar
  const m = raw.match(/([NSEW]?)(\d+)[°]?\s*(\d+)?[']?\s*(\d+\.?\d*)?["]?/i);
  if (m) {
    const dir = (m[1] || '').toUpperCase();
    let deg = parseInt(m[2], 10);
    const min = parseInt(m[3] || '0', 10);
    const sec = parseFloat(m[4] || '0');
    let result = deg + min / 60 + sec / 3600;
    if (dir === 'S' || dir === 'W') result = -result;
    return result;
  }
  return null;
}

/** Haversine distance in nautical miles */
function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3440.065; // Earth radius in nm
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Calculate bearing from point 1 to point 2 in degrees */
function calcBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
    Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
  const brng = Math.atan2(y, x) * 180 / Math.PI;
  return (brng + 360) % 360;
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const thStyle: React.CSSProperties = {
  padding: '6px 10px',
  textAlign: 'left',
  fontWeight: 600,
  fontSize: 13,
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
  fontSize: 14,
  padding: '4px 6px',
  boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = {
  background: '#0f1a28',
  border: '1px solid #1a2a3a',
  borderRadius: 3,
  color: '#ccdae8',
  fontSize: 14,
  padding: '4px 8px',
  fontFamily: 'inherit',
};

const btnStyle: React.CSSProperties = {
  background: '#0f1a28',
  border: '1px solid #1a3a5a',
  borderRadius: 4,
  color: '#4a8fd4',
  cursor: 'pointer',
  fontSize: 14,
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
  fontSize: 14,
  fontWeight: 600,
  padding: '0 6px',
};

const fieldLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  color: '#8fa8c0',
  fontSize: 13,
};

/* ------------------------------------------------------------------ */
/* Presets sub-tab                                                      */
/* ------------------------------------------------------------------ */

function PresetsSubTab({ setDtcData, templateMsg, setTemplateMsg }: {
  setDtcData: React.Dispatch<React.SetStateAction<DtcData | null>>;
  templateMsg: string;
  setTemplateMsg: (msg: string) => void;
}) {
  const applyTemplate = (tpl: DtcTemplate) => {
    setDtcData((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      if (tpl.data.CMDS) next.CMDS = { ...prev.CMDS, ...tpl.data.CMDS };
      if (tpl.data.COMM) next.COMM = { ...prev.COMM, ...tpl.data.COMM };
      return next;
    });
    setTemplateMsg(`Applied "${tpl.name}" template`);
    setTimeout(() => setTemplateMsg(''), 3000);
  };

  const applyPresetPack = (pack: FreqPresetPack, radio: 'COMM1' | 'COMM2') => {
    setDtcData((prev) => {
      if (!prev) return prev;
      const radioData = { ...prev.COMM[radio] };
      for (const ch of pack.channels) {
        const chKey = `Channel_${ch.ch}`;
        radioData[chKey] = { frequency: ch.freq, modulation: ch.mod, name: ch.name };
      }
      return { ...prev, COMM: { ...prev.COMM, [radio]: radioData } };
    });
    setTemplateMsg(`Loaded "${pack.name}" → ${radio}`);
    setTimeout(() => setTemplateMsg(''), 3000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {templateMsg && <div style={{ color: '#3fb950', fontSize: 12, padding: '6px 12px', background: '#0a1218', borderRadius: 6, border: '1px solid #12202e' }}>✓ {templateMsg}</div>}

      {/* DTC Templates */}
      <div style={{ padding: '12px 14px', background: '#0a1218', borderRadius: 6, border: '1px solid #12202e' }}>
        <div style={{ fontSize: 12, color: '#5a7a8a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
          DTC Templates
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {DTC_TEMPLATES.map((tpl) => (
            <button
              key={tpl.name}
              onClick={() => applyTemplate(tpl)}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: '#0f1a28', border: '1px solid #1a3a5a', borderRadius: 6,
                color: '#ccdae8', cursor: 'pointer', fontSize: 13, padding: '8px 12px',
                textAlign: 'left',
              }}
            >
              <span style={{ fontWeight: 600 }}>{tpl.name}</span>
              <span style={{ color: '#5a7a8a', fontSize: 11 }}>{tpl.description}</span>
            </button>
          ))}
        </div>
      </div>

      {/* COMM Frequency Preset Packs */}
      <div style={{ padding: '12px 14px', background: '#0a1218', borderRadius: 6, border: '1px solid #12202e' }}>
        <div style={{ fontSize: 12, color: '#5a7a8a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
          COMM Frequency Packs
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {FREQ_PRESET_PACKS.map((pack) => (
            <div key={pack.name} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#0f1a28', border: '1px solid #1a3a5a', borderRadius: 6,
              padding: '8px 12px',
            }}>
              <span style={{ flex: 1, color: '#ccdae8', fontSize: 13, fontWeight: 600 }}>{pack.name}</span>
              <span style={{ color: '#5a7a8a', fontSize: 11, flex: 2 }}>{pack.description}</span>
              <button
                onClick={() => applyPresetPack(pack, 'COMM1')}
                style={{
                  background: '#1a3a5a', border: '1px solid #2a5a8a', borderRadius: 4,
                  color: '#6ab4f0', cursor: 'pointer', fontSize: 11, padding: '3px 10px',
                }}
              >
                → COMM1
              </button>
              <button
                onClick={() => applyPresetPack(pack, 'COMM2')}
                style={{
                  background: '#1a2a3a', border: '1px solid #2a3a4a', borderRadius: 4,
                  color: '#8aaabe', cursor: 'pointer', fontSize: 11, padding: '3px 10px',
                }}
              >
                → COMM2
              </button>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

