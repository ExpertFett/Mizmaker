import { useState, useCallback, useMemo } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { useEffectiveGroups } from '../../store/effectiveGroups';
import { useSopStore } from '../../sop/sopStore';
import type { SOP } from '../../sop/types';
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

// SA page (2026 radar/SA DTC update). Mirrors data.SA in the .dtc.
interface MezThreat {
  id?: string;
  num?: number;
  text: string;
  threat_level: number;
  threat_ring_radius: number;
  threat_type: string;
  x: number;
  y: number;
}
type Dcltr = Record<string, boolean>;
interface CorridorPoint { id?: string; x: number; y: number; }
interface Corridor { id?: string; num?: number; note: string; points: CorridorPoint[]; }
interface CapPoint {
  id?: string; num?: number; note: string;
  x: number; y: number;
  course: number; diameter: number; length: number;  // course °, diameter/length metres
  turn_direction: 'Left' | 'Right';
}
/** Minimal runtime waypoint shape from the backend NAV_PTS — x/y DCS world
 *  coords + a label. (The display-oriented NavPoint interface omits these; the
 *  corridor editor needs the world coords.) */
interface SaWaypoint { x?: number; y?: number; text_note?: string; wypt_num?: number; }

interface SaData {
  MEZ_THRTS: MezThreat[];
  mirror_MEZ_THRTS?: boolean;
  CAP_PTS?: CapPoint[];
  CORRIDORS?: Corridor[];
  FAOR_FLOT?: { FAOR: Corridor[]; FLOT: Corridor[] };
  Default_CAP_Point?: number;
  Default_CORRIDORS_Point?: number;
  Default_FAOR_Line?: number;
  Default_FLOT_Line?: number;
  Default_MEZ_THRTS_Level?: number;
  SETTINGS: {
    DCLTR_SETTINGS: { MREJ1: Dcltr; MREJ2: Dcltr };
    SENSORS_SETTINGS: {
      FF_tracks: boolean; FRIEND_Symbols: number; PPLI_tracks: boolean;
      RWR_Symbols: number; SURV_tracks: boolean; UNK_tracks: boolean;
    };
  };
}

interface DtcData {
  COMM: { COMM1: CommRadio; COMM2: CommRadio };
  WYPT: { NAV_PTS: NavPoint[]; NAV_SETTINGS: NavSettings };
  CMDS: Record<string, CmdsProgram>;
  SA?: SaData;
  ALR67?: unknown;
  TCN?: unknown[];
}

const DCLTR_ORDER = [
  'Bullseye_TDC_Info', 'CAP', 'CORR', 'Compase_Rose', 'Countermeasure_Inventory',
  'FAOR', 'FLOT', 'Ground_Speed', 'MEZ_Names', 'MEZ_Rings', 'SEQ', 'Waypoint_Info',
];
const DCLTR_LABELS: Record<string, string> = {
  Bullseye_TDC_Info: 'Bullseye / TDC info', CAP: 'CAP points', CORR: 'Corridors',
  Compase_Rose: 'Compass rose', Countermeasure_Inventory: 'CM inventory',
  FAOR: 'FAOR line', FLOT: 'FLOT line', Ground_Speed: 'Ground speed',
  MEZ_Names: 'MEZ names', MEZ_Rings: 'MEZ rings', SEQ: 'Sequence', Waypoint_Info: 'Waypoint info',
};

type SubTab = 'comm' | 'cmds' | 'waypoints' | 'nav' | 'fuel' | 'tools' | 'presets' | 'sa';

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
/* Real .dtc → display-shape normalization                             */
/*                                                                      */
/* The preview endpoint returns the real file shape: CMDS nested under  */
/* ALR67.CMDS.CMDSProgramSettings, TACAN/ICLS/ACLS with                 */
/* Channel/ChannelMode/Mode/OnOff, COMM modulation as 0/1. The tab's    */
/* editors are built around a flatter display shape (top-level CMDS,    */
/* TACAN.{channel,band,mode,enabled}, modulation 'AM'/'FM'). Without    */
/* this normalize on load, CMDS + NAV showed defaults/zeros and edits   */
/* never reached the export. The backend maps the SAME display shape    */
/* back to the real file on generate, so the round-trip is closed.      */
/* ------------------------------------------------------------------ */

function modToStr(m: unknown): string {
  if (m === 1 || m === '1') return 'FM';
  if (typeof m === 'string' && m.trim().toUpperCase() === 'FM') return 'FM';
  return 'AM';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeLoadedDtc(raw: Record<string, any>): DtcData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: Record<string, any> = { ...raw };

  // COMM — modulation 0/1 → 'AM'/'FM', frequency → string.
  for (const radio of ['COMM1', 'COMM2'] as const) {
    const r = raw.COMM?.[radio];
    if (r && typeof r === 'object') {
      const nr: Record<string, CommChannel> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const [k, ch] of Object.entries(r as Record<string, any>)) {
        if (ch && typeof ch === 'object') {
          nr[k] = {
            frequency: ch.frequency != null ? String(ch.frequency) : '',
            modulation: modToStr(ch.modulation),
            name: ch.name ?? '',
          };
        }
      }
      data.COMM = { ...data.COMM, [radio]: nr };
    }
  }

  // CMDS — lift ALR67.CMDS.CMDSProgramSettings into the flat display map.
  const progs = raw.ALR67?.CMDS?.CMDSProgramSettings;
  if (progs && typeof progs === 'object') {
    const cmds: Record<string, CmdsProgram> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const [name, p] of Object.entries(progs as Record<string, any>)) {
      cmds[name] = {
        chaffQty: Number(p?.Chaff?.Quantity ?? 0),
        chaffInterval: Number(p?.Chaff?.Interval ?? 0),
        flareQty: Number(p?.Flare?.Quantity ?? 0),
        flareInterval: Number(p?.Flare?.Interval ?? 0),
      };
    }
    data.CMDS = cmds;
  }

  // NAV settings — real keys → display keys (other NAV_SETTINGS fields kept
  // by the spread so they pass through to export untouched).
  const ns = raw.WYPT?.NAV_SETTINGS;
  if (ns && typeof ns === 'object') {
    const t = ns.TACAN ?? {};
    const ic = ns.ICLS ?? {};
    const ac = ns.ACLS ?? {};
    data.WYPT = {
      ...data.WYPT,
      NAV_SETTINGS: {
        ...ns,
        TACAN: {
          channel: Number(t.Channel ?? 1),
          band: t.ChannelMode === 2 ? 'Y' : 'X',
          mode: t.Mode === 2 ? 'A-A' : 'T-R',
          enabled: !!t.OnOff,
        },
        ICLS: { channel: Number(ic.Channel ?? 1), enabled: !!ic.OnOff },
        ACLS: { frequency: ac.Frequency != null ? String(ac.Frequency) : '', enabled: !!ac.OnOff },
      },
    };
  }

  return data as unknown as DtcData;
}

/* ------------------------------------------------------------------ */
/* SOP -> DTC COMM synthesis                                            */
/*                                                                      */
/* When an SOP is active the DTC tab can auto-fill both Hornet radios   */
/* in one click. Convention used here matches how Fett's school         */
/* actually flies the F-18:                                             */
/*   COMM1 (aux):    intra-flight squadron freqs + primary tanker       */
/*   COMM2 (front):  mission services (Strike/Marshal/Tower/AWACS/JTAC) */
/* GUARD (243.000 or whatever the SOP guard entry says) is duplicated   */
/* on both radios at slot 20 + the GUARD slot.                          */
/* Channel labels truncate at 12 chars to fit the Hornet UFC.           */
/* ------------------------------------------------------------------ */

function nameForUfc(raw: string, fallback: string): string {
  const v = (raw || fallback || '').trim().toUpperCase();
  return v.slice(0, 12);
}

/**
 * v1.19.77 — build COMM pages from the SOP's comm plan button maps.
 * When the plan carries FA-18C maps, the DTC ladder is the SAME
 * ladder the Radio tab generates — one source of truth, ending the
 * era of this file's own synthesis convention silently disagreeing
 * with the preset tables. Returns null when the plan has no Hornet
 * maps (caller falls back to buildSopComms below).
 */
function buildCommsFromPlan(sop: SOP): {
  COMM1: CommRadio;
  COMM2: CommRadio;
  filledCh1: number;
  filledCh2: number;
} | null {
  const plan = sop.commPlan;
  if (!plan) return null;
  const netById = new Map(plan.nets.map((n) => [n.id, n]));
  const buildRadio = (radio: number): { page: CommRadio; filled: number } | null => {
    const map = plan.maps.find((m) => m.aircraft === 'FA-18C_hornet' && m.radio === radio);
    if (!map) return null;
    const page: CommRadio = {};
    let filled = 0;
    for (const [pbStr, netId] of Object.entries(map.buttons)) {
      const pb = parseInt(pbStr, 10);
      if (!Number.isInteger(pb) || pb < 1 || pb > 20) continue; // DTC carries 20 slots
      const net = netById.get(netId);
      if (!net || net.kind !== 'radio' || !net.frequency) continue;
      page[`Channel_${pb}`] = {
        frequency: net.frequency.toFixed(3),
        modulation: net.modulation ?? 'AM',
        name: nameForUfc(net.name, `CH${pb}`),
      };
      filled++;
    }
    return { page, filled };
  };
  const r1 = buildRadio(1);
  const r2 = buildRadio(2);
  if (!r1 && !r2) return null;
  // GUARD aux slot anchored from the catalog's guard net when present.
  const guardNet = plan.nets.find((n) => /guard/i.test(n.name) && n.kind === 'radio' && n.frequency);
  const guardCh: CommChannel = {
    frequency: (guardNet?.frequency ?? 243.0).toFixed(3),
    modulation: guardNet?.modulation ?? 'AM',
    name: 'GUARD',
  };
  const comm1 = r1 ? { ...r1.page, GUARD: { ...guardCh } } : {};
  const comm2 = r2 ? { ...r2.page, GUARD: { ...guardCh } } : {};
  return { COMM1: comm1, COMM2: comm2, filledCh1: r1?.filled ?? 0, filledCh2: r2?.filled ?? 0 };
}

function buildSopComms(sop: SOP): {
  COMM1: CommRadio;
  COMM2: CommRadio;
  filledCh1: number;
  filledCh2: number;
} {
  const comm1: CommRadio = {};
  const comm2: CommRadio = {};

  // Resolve guard once — used on both radios.
  const guardEntry = sop.comms.find((c) => /guard/i.test(c.role));
  const guardCh: CommChannel = {
    frequency: (guardEntry?.frequency ?? 243.0).toFixed(3),
    modulation: guardEntry?.modulation ?? 'AM',
    name: 'GUARD',
  };

  // ---- COMM1 (intra-flight) ----
  let ch = 1;
  const flightsByPriority = [...sop.flights]
    .filter((f) => f.callsign && f.defaultFreq && f.defaultFreq > 0)
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));

  for (const f of flightsByPriority) {
    if (ch > 18) break;
    comm1[`Channel_${ch}`] = {
      frequency: (f.defaultFreq ?? 0).toFixed(3),
      modulation: f.defaultMod ?? 'AM',
      name: nameForUfc(f.callsign, `FLT${ch}`),
    };
    ch++;
  }

  // Primary tanker on the next free channel (cap at 19 so guard can sit at 20).
  const primaryTanker = sop.tankers?.find((t) => t.frequency && t.frequency > 0);
  if (primaryTanker && ch <= 19) {
    comm1[`Channel_${ch}`] = {
      frequency: (primaryTanker.frequency ?? 0).toFixed(3),
      modulation: primaryTanker.modulation ?? 'AM',
      name: nameForUfc(primaryTanker.callsign, 'TANKER'),
    };
    ch++;
  }
  const filledCh1 = ch - 1;

  // Always anchor guard at slot 20 + GUARD aux slot.
  comm1['Channel_20'] = { ...guardCh };
  comm1['GUARD'] = { ...guardCh };

  // ---- COMM2 (mission services) ----
  ch = 1;
  for (const c of sop.comms) {
    if (/guard/i.test(c.role)) continue;
    if (!c.frequency || c.frequency <= 0) continue;
    if (ch > 18) break;
    comm2[`Channel_${ch}`] = {
      frequency: c.frequency.toFixed(3),
      modulation: c.modulation ?? 'AM',
      name: nameForUfc(c.role, `COMM${ch}`),
    };
    ch++;
  }

  for (const a of sop.supportAssets ?? []) {
    if (ch > 18) break;
    if (!a.frequency || a.frequency <= 0) continue;
    comm2[`Channel_${ch}`] = {
      frequency: a.frequency.toFixed(3),
      modulation: a.modulation ?? 'AM',
      name: nameForUfc(a.role || a.callsign, `AST${ch}`),
    };
    ch++;
  }

  // Tankers beyond the primary land here so the wingman has them too.
  const extraTankers = (sop.tankers ?? []).slice(primaryTanker ? 1 : 0);
  for (const t of extraTankers) {
    if (ch > 18) break;
    if (!t.frequency || t.frequency <= 0) continue;
    comm2[`Channel_${ch}`] = {
      frequency: t.frequency.toFixed(3),
      modulation: t.modulation ?? 'AM',
      name: nameForUfc(t.callsign, 'TANKER'),
    };
    ch++;
  }
  const filledCh2 = ch - 1;

  comm2['Channel_20'] = { ...guardCh };
  comm2['GUARD'] = { ...guardCh };

  return { COMM1: comm1, COMM2: comm2, filledCh1, filledCh2 };
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

// COMMON_FREQS preset list removed — was declared for a quick-fill UI
// that never shipped. Restore from git history if we add that feature.

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

  // SOP integration — when active, the "Apply SOP" buttons in COMM and
  // Presets subtabs synthesize both Hornet radios from this. We read
  // sops + activeId as scalars (React 19 / useSyncExternalStore won't
  // tolerate object-returning selectors).
  const sops = useSopStore((s) => s.sops);
  const activeSopId = useSopStore((s) => s.activeId);
  const activeSop = useMemo(
    () => (activeSopId ? sops.find((s) => s.id === activeSopId) ?? null : null),
    [activeSopId, sops],
  );

  const [selectedFlight, setSelectedFlight] = useState<string>(dtcFlights[0] ?? '');
  const [dtcData, setDtcData] = useState<DtcData | null>(null);

  // DTC clipboard for cross-flight copy/paste (v0.9.38). Lives in
  // tab-level state so the buffer survives switching between
  // flights, but resets when the user leaves the DTC tab. Stores
  // the source flight name alongside the data so the paste UI
  // can show "Pasted from Bengal 1" feedback.
  const [dtcClipboard, setDtcClipboard] = useState<{
    sourceFlight: string;
    data: DtcData;
  } | null>(null);
  const [clipboardMsg, setClipboardMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<SubTab>('comm');
  const [exporting, setExporting] = useState(false);
  const [steerNotes, setSteerNotes] = useState<Record<number, string>>({});
  const [templateMsg, setTemplateMsg] = useState('');
  const [sopApplyMsg, setSopApplyMsg] = useState('');

  const handleLoad = useCallback(async () => {
    if (!sessionId || !selectedFlight) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await dtcPreview(sessionId, selectedFlight);
      const raw = resp.dtc?.data;
      setDtcData(raw ? normalizeLoadedDtc(raw) : null);
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

  /**
   * Overwrites both COMM radios with channels synthesized from the active
   * SOP. Existing channels not produced by the SOP are preserved on each
   * radio so a partial SOP doesn't blow away pilot edits.
   */
  const applySopComms = useCallback(
    (target: 'both' | 'COMM1' | 'COMM2' = 'both') => {
      if (!activeSop) return;
      // v1.19.77 — comm plan button maps win over the legacy synthesis
      // so the DTC and the Radio tab generate the SAME ladder.
      const built = buildCommsFromPlan(activeSop) ?? buildSopComms(activeSop);
      setDtcData((prev) => {
        if (!prev) return prev;
        const nextComm1 =
          target === 'both' || target === 'COMM1'
            ? { ...prev.COMM.COMM1, ...built.COMM1 }
            : prev.COMM.COMM1;
        const nextComm2 =
          target === 'both' || target === 'COMM2'
            ? { ...prev.COMM.COMM2, ...built.COMM2 }
            : prev.COMM.COMM2;
        return { ...prev, COMM: { COMM1: nextComm1, COMM2: nextComm2 } };
      });
      const summary =
        target === 'both'
          ? `COMM1 (${built.filledCh1} ch) + COMM2 (${built.filledCh2} ch)`
          : target === 'COMM1'
          ? `COMM1 (${built.filledCh1} ch)`
          : `COMM2 (${built.filledCh2} ch)`;
      setSopApplyMsg(`Applied SOP "${activeSop.name}" → ${summary}`);
      setTemplateMsg('');
      setTimeout(() => setSopApplyMsg(''), 3500);
    },
    [activeSop],
  );

  /**
   * One-click "Auto-Setup DTC" (v0.9.78). Fills everything we can derive
   * for the loaded flight in a single action, so the pilot doesn't have
   * to walk every subtab:
   *   COMM  — from the active SOP (both radios) if one is loaded, else a
   *           sensible default frequency pack on COMM1.
   *   CMDS  — a balanced default chaff/flare program set, but only when
   *           CMDS is still empty/all-zero (never clobbers tuned programs).
   *   NAV   — flips TACAN/ICLS on when a channel is present but disabled
   *           (the backend usually fills the channel from the carrier;
   *           this just switches it on).
   * Everything MERGES over existing values — it won't wipe pilot edits.
   * Waypoints already come from the mission route, so they're untouched.
   */
  const handleAutoSetup = useCallback(() => {
    if (!dtcData) return;
    const did: string[] = [];
    let next: DtcData = {
      ...dtcData,
      COMM: { ...dtcData.COMM },
      CMDS: { ...(dtcData.CMDS ?? {}) },
    };

    // 1) COMM — comm plan wins over legacy synthesis (v1.19.77)
    if (activeSop) {
      const built = buildCommsFromPlan(activeSop) ?? buildSopComms(activeSop);
      next.COMM = {
        COMM1: { ...next.COMM.COMM1, ...built.COMM1 },
        COMM2: { ...next.COMM.COMM2, ...built.COMM2 },
      };
      did.push(`COMM ← SOP "${activeSop.name}" (${built.filledCh1}+${built.filledCh2} ch)`);
    } else {
      const pack = FREQ_PRESET_PACKS[0]; // Carrier Strike — broad default
      const radio = { ...next.COMM.COMM1 };
      for (const ch of pack.channels) {
        radio[`Channel_${ch.ch}`] = { frequency: ch.freq, modulation: ch.mod, name: ch.name };
      }
      next.COMM = { ...next.COMM, COMM1: radio };
      did.push(`COMM1 ← "${pack.name}" pack (no SOP active)`);
    }

    // 2) CMDS — only fill when nothing meaningful is set yet
    const cmds = next.CMDS ?? {};
    const cmdsEmpty = Object.keys(cmds).length === 0
      || Object.values(cmds).every((p) => !p || (p.chaffQty === 0 && p.flareQty === 0));
    if (cmdsEmpty) {
      const tpl = DTC_TEMPLATES[0]; // Carrier Day Strike — balanced
      next.CMDS = { ...cmds, ...(tpl.data.CMDS as Record<string, CmdsProgram>) };
      did.push(`CMDS ← "${tpl.name}"`);
    } else {
      did.push('CMDS kept (already set)');
    }

    // 3) NAV — switch on TACAN/ICLS that have a channel but are off
    const nav = next.WYPT?.NAV_SETTINGS;
    if (nav) {
      const ns = { ...nav };
      let navTouched = false;
      if (ns.TACAN && ns.TACAN.channel > 0 && !ns.TACAN.enabled) {
        ns.TACAN = { ...ns.TACAN, enabled: true }; navTouched = true;
      }
      if (ns.ICLS && ns.ICLS.channel > 0 && !ns.ICLS.enabled) {
        ns.ICLS = { ...ns.ICLS, enabled: true }; navTouched = true;
      }
      if (navTouched) {
        next = { ...next, WYPT: { ...next.WYPT, NAV_SETTINGS: ns } };
        did.push('NAV TACAN/ICLS enabled');
      }
    }

    setDtcData(next);
    setSopApplyMsg(`⚡ Auto-Setup: ${did.join(' · ')}`);
    setTemplateMsg('');
    setTimeout(() => setSopApplyMsg(''), 6000);
  }, [dtcData, activeSop]);

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
      <div style={{ color: '#aaaaaa', fontSize: 15, padding: 20 }}>
        No F/A-18C flights found in this mission for DTC generation.
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: '#e0e0e0' }}>
            F/A-18C DTC Builder
          </h2>
          {activeSop && (
            <span
              title={`Active SOP: ${activeSop.name}. Use "Apply SOP" on the COMM tab to fill both radios.`}
              style={{
                padding: '2px 8px',
                borderRadius: 4,
                background: '#1a3a1a',
                border: '1px solid #2a5a2a',
                color: '#3fb950',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.5,
              }}
            >
              SOP
            </span>
          )}
        </div>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#aaaaaa' }}>
          Load, edit, and export Data Transfer Cartridge files for Hornet flights.
        </p>
      </div>

      {/* Flight selector + Load */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <label style={{ color: '#cccccc', fontSize: 14 }}>Flight:</label>
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

        {/* Copy/Paste DTC across flights (v0.9.38). Copy stages
            the current dtcData in a tab-scoped clipboard;
            Paste applies it to the currently-loaded flight,
            wholesale. Useful for "I already configured Bengal 1
            with all my COMMs / CMDS / waypoints — copy that
            same setup to Hawk 2 / 3 / 4 instead of re-typing." */}
        {dtcData && (
          <button
            onClick={() => {
              setDtcClipboard({ sourceFlight: selectedFlight, data: dtcData });
              setClipboardMsg(`Copied DTC from ${selectedFlight}`);
              setTimeout(() => setClipboardMsg(null), 3000);
            }}
            style={{ ...btnStyle, background: '#262626', borderColor: '#4a8fd4', color: '#4a8fd4' }}
            title="Copy this flight's full DTC (COMM, CMDS, waypoints, NAV) to the clipboard"
          >
            📋 Copy DTC
          </button>
        )}
        {dtcData && dtcClipboard && dtcClipboard.sourceFlight !== selectedFlight && (
          <button
            onClick={() => {
              if (!confirm(
                `Paste DTC from "${dtcClipboard.sourceFlight}" onto "${selectedFlight}"?\n\n` +
                `This replaces COMM, CMDS, waypoints, and NAV settings on the current flight.`,
              )) return;
              setDtcData(dtcClipboard.data);
              setClipboardMsg(`Pasted DTC from ${dtcClipboard.sourceFlight} → ${selectedFlight}`);
              setTimeout(() => setClipboardMsg(null), 3000);
            }}
            style={{ ...btnStyle, background: '#262626', borderColor: '#3fb950', color: '#3fb950' }}
            title={`Paste the DTC copied from "${dtcClipboard.sourceFlight}"`}
          >
            📥 Paste DTC
          </button>
        )}
        {clipboardMsg && (
          <span style={{ color: '#3fb950', fontSize: 12, marginLeft: 8 }}>
            ✓ {clipboardMsg}
          </span>
        )}
      </div>

      {error && (
        <div style={{ color: '#d95050', fontSize: 14, marginBottom: 12 }}>{error}</div>
      )}

      {sopApplyMsg && (
        <div
          style={{
            color: '#3fb950',
            fontSize: 12,
            padding: '6px 12px',
            background: '#0a1218',
            borderRadius: 6,
            border: '1px solid #1a3a1a',
            marginBottom: 12,
          }}
        >
          ✓ {sopApplyMsg}
        </div>
      )}

      {!dtcData && !loading && (
        <div style={{ color: '#aaaaaa', fontSize: 14, padding: 20 }}>
          Select a flight and click "Load DTC" to begin editing.
        </div>
      )}

      {dtcData && (
        <>
          {/* Auto-Setup — one click fills COMM + CMDS (+ enables nav) so
              the pilot doesn't have to walk every subtab. Merges over
              existing values; never wipes edits. (v0.9.78) */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12,
            padding: '8px 12px', background: '#2a2418',
            border: '1px solid #4a3f1a', borderRadius: 6,
          }}>
            <button
              onClick={handleAutoSetup}
              style={{ ...btnStyle, background: '#3a3018', borderColor: '#fbb941', color: '#fbb941', fontWeight: 600 }}
              title="Fill COMM (from the active SOP, or a default pack), a balanced CMDS program, and switch on TACAN/ICLS — in one click. Merges over existing values; doesn't wipe your edits."
            >
              ⚡ Auto-Setup DTC
            </button>
            <span style={{ fontSize: 12, color: '#cccccc', flex: 1 }}>
              Fills COMM + CMDS and enables nav from{' '}
              <strong style={{ color: '#fbb941' }}>
                {activeSop ? `SOP "${activeSop.name}"` : 'sensible defaults'}
              </strong>{' '}
              in one click. Merges — won't overwrite channels/programs you've already set.
            </span>
          </div>

          {/* Sub-tab navigation */}
          <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid #3a3a3a', flexWrap: 'wrap' }}>
            {([
              { key: 'comm', label: 'COMM' },
              { key: 'cmds', label: 'CMDS' },
              { key: 'waypoints', label: 'Waypoints' },
              { key: 'nav', label: 'NAV' },
              { key: 'fuel', label: 'Fuel' },
              { key: 'sa', label: 'SA' },
              { key: 'tools', label: 'Tools' },
              { key: 'presets', label: 'Presets' },
            ] as { key: SubTab; label: string }[]).map((t) => (
              <button
                key={t.key}
                onClick={() => setSubTab(t.key)}
                style={{
                  background: subTab === t.key ? '#262626' : 'transparent',
                  border: 'none',
                  borderBottom: subTab === t.key ? '2px solid #4a8fd4' : '2px solid transparent',
                  color: subTab === t.key ? '#e0e0e0' : '#aaaaaa',
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

          {/* v1.19.67 — display:none so sub-tab state survives switching.
              Particularly important for CommSubTab + WaypointsSubTab which
              carry steer-notes / preset-form state that's annoying to
              re-enter after a stray click on a sibling sub-tab. */}
          <div style={{ display: subTab === 'comm' ? 'block' : 'none' }}>
            <CommSubTab
              data={dtcData.COMM}
              onUpdate={updateComm}
              activeSop={activeSop}
              onApplySop={applySopComms}
            />
          </div>
          <div style={{ display: subTab === 'cmds' ? 'block' : 'none' }}>
            <CmdsSubTab data={dtcData.CMDS ?? {}} onUpdate={updateCmds} />
          </div>
          <div style={{ display: subTab === 'waypoints' ? 'block' : 'none' }}>
            <WaypointsSubTab data={dtcData.WYPT?.NAV_PTS ?? []} steerNotes={steerNotes} setSteerNotes={setSteerNotes} />
          </div>
          <div style={{ display: subTab === 'nav' ? 'block' : 'none' }}>
            <NavSubTab data={dtcData.WYPT?.NAV_SETTINGS ?? { TACAN: { channel: 1, band: 'X', mode: 'T-R', enabled: false }, ICLS: { channel: 1, enabled: false } }} onUpdate={updateNav} selectedFlight={selectedFlight} />
          </div>
          <div style={{ display: subTab === 'fuel' ? 'block' : 'none' }}>
            <FuelPlannerSubTab waypoints={dtcData.WYPT?.NAV_PTS ?? []} />
          </div>
          <div style={{ display: subTab === 'sa' ? 'block' : 'none' }}>
            <SaSubTab data={dtcData.SA} navPts={(dtcData.WYPT?.NAV_PTS ?? []) as unknown as SaWaypoint[]} setDtcData={setDtcData} />
          </div>
          <div style={{ display: subTab === 'tools' ? 'block' : 'none' }}>
            <ToolsSubTab waypoints={dtcData.WYPT?.NAV_PTS ?? []} dtcData={dtcData} setDtcData={setDtcData} selectedFlight={selectedFlight} />
          </div>
          <div style={{ display: subTab === 'presets' ? 'block' : 'none' }}>
            <PresetsSubTab
              setDtcData={setDtcData}
              templateMsg={templateMsg}
              setTemplateMsg={setTemplateMsg}
              activeSop={activeSop}
              onApplySop={applySopComms}
            />
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* COMM sub-tab                                                        */
/* ------------------------------------------------------------------ */

function CommSubTab({ data, onUpdate, activeSop, onApplySop }: {
  data: { COMM1: CommRadio; COMM2: CommRadio };
  onUpdate: (radio: 'COMM1' | 'COMM2', channelKey: string, field: keyof CommChannel, value: string) => void;
  activeSop: SOP | null;
  onApplySop: (target?: 'both' | 'COMM1' | 'COMM2') => void;
}) {
  return (
    <div>
      {/* SOP auto-fill row — only shows when an SOP is active. Three buttons:
          fill both radios, just COMM1, or just COMM2. Buttons merge over
          existing channels rather than wiping them. */}
      {activeSop && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 12px',
            marginBottom: 12,
            background: '#0a1218',
            border: '1px solid #1a3a1a',
            borderRadius: 6,
          }}
        >
          <span
            style={{
              padding: '2px 8px',
              borderRadius: 4,
              background: '#1a3a1a',
              border: '1px solid #2a5a2a',
              color: '#3fb950',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.5,
            }}
          >
            SOP
          </span>
          <span style={{ color: '#cccccc', fontSize: 12, flex: 1 }}>
            Apply <strong style={{ color: '#e0e0e0' }}>{activeSop.name}</strong> — COMM1 = squadron flights + tanker, COMM2 = mission services. GUARD anchored on Ch 20 of both.
          </span>
          <button
            onClick={() => onApplySop('both')}
            style={{
              background: '#1a3a1a',
              border: '1px solid #2a5a2a',
              borderRadius: 4,
              color: '#3fb950',
              cursor: 'pointer',
              fontSize: 12,
              padding: '5px 12px',
              fontWeight: 600,
            }}
          >
            Apply SOP (Both)
          </button>
          <button
            onClick={() => onApplySop('COMM1')}
            style={{
              background: '#262626',
              border: '1px solid #3a3a3a',
              borderRadius: 4,
              color: '#aaaaaa',
              cursor: 'pointer',
              fontSize: 11,
              padding: '5px 10px',
            }}
          >
            COMM1 only
          </button>
          <button
            onClick={() => onApplySop('COMM2')}
            style={{
              background: '#262626',
              border: '1px solid #3a3a3a',
              borderRadius: 4,
              color: '#aaaaaa',
              cursor: 'pointer',
              fontSize: 11,
              padding: '5px 10px',
            }}
          >
            COMM2 only
          </button>
        </div>
      )}

      {/* Radio tables */}
      <div style={{ display: 'flex', gap: 24 }}>
        {(['COMM1', 'COMM2'] as const).map((radio) => (
          <div key={radio} style={{ flex: 1 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 600, color: '#cccccc' }}>{radio}</h3>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#e0e0e0' }}>
              <thead>
                <tr style={{ color: '#aaaaaa', borderBottom: '1px solid #3a3a3a', background: '#1a1a1a' }}>
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
                    <tr key={chKey} style={{ borderBottom: '1px solid #262626' }}>
                      <td style={{ ...tdStyle, color: '#aaaaaa', fontFamily: "'B612 Mono', monospace", width: 40 }}>
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
        background: '#4a4a4a', border: '1px solid #2a5a8a', borderRadius: 4,
        color: '#6ab4f0', padding: '5px 14px', fontSize: 12, cursor: 'pointer',
        fontWeight: 600,
      }}>
        Auto Fill
      </button>
    </div>
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#e0e0e0', maxWidth: 760 }}>
      <thead>
        <tr style={{ color: '#aaaaaa', borderBottom: '1px solid #3a3a3a', background: '#1a1a1a' }}>
          <th style={thStyle}>Program</th>
          <th style={thStyle}>Chaff Qty</th>
          <th style={thStyle}>Chaff Interval</th>
          <th style={thStyle}>Flare Qty</th>
          <th style={thStyle}>Flare Interval</th>
          {/* v0.9.37 — total expendables per program button-press
              (chaff + flare). Helps the user see at a glance how
              loud each program is before settling on the loadout. */}
          <th style={thStyle} title="Chaff + Flare per program activation">Total</th>
        </tr>
      </thead>
      <tbody>
        {CMDS_PROGRAMS.map((prog) => {
          const p = data[prog] ?? { chaffQty: 0, chaffInterval: 0, flareQty: 0, flareInterval: 0 };
          const rowTotal = (p.chaffQty || 0) + (p.flareQty || 0);
          return (
            <tr key={prog} style={{ borderBottom: '1px solid #262626' }}>
              <td style={{ ...tdStyle, color: '#cccccc', fontWeight: 600 }}>{programLabel(prog)}</td>
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
              <td style={{ ...tdStyle, fontFamily: "'B612 Mono', monospace",
                color: rowTotal === 0 ? '#666' : '#e0e0e0', fontWeight: 600 }}>
                {rowTotal}
              </td>
            </tr>
          );
        })}
        {/* Column totals row — sum across every program. Useful for
            "if I burn through every program once, here's the ammo
            cost" quick math. Right-aligned faded for visual weight. */}
        <tr style={{ borderTop: '2px solid #3a3a3a', background: '#0a1218' }}>
          <td style={{ ...tdStyle, color: '#888', fontWeight: 600,
            textTransform: 'uppercase', fontSize: 11, letterSpacing: 0.5 }}>
            Total
          </td>
          {(() => {
            const sumChaff = CMDS_PROGRAMS.reduce(
              (s, prog) => s + (data[prog]?.chaffQty || 0), 0);
            const sumFlare = CMDS_PROGRAMS.reduce(
              (s, prog) => s + (data[prog]?.flareQty || 0), 0);
            return (
              <>
                <td style={{ ...tdStyle, fontFamily: "'B612 Mono', monospace",
                  color: '#e0e0e0', fontWeight: 600 }}>{sumChaff}</td>
                <td style={tdStyle} />
                <td style={{ ...tdStyle, fontFamily: "'B612 Mono', monospace",
                  color: '#e0e0e0', fontWeight: 600 }}>{sumFlare}</td>
                <td style={tdStyle} />
                <td style={{ ...tdStyle, fontFamily: "'B612 Mono', monospace",
                  color: '#fbb941', fontWeight: 700 }}>{sumChaff + sumFlare}</td>
              </>
            );
          })()}
        </tr>
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
  // Compute leg distances (simplified great circle approx). This hook MUST
  // run before any early return so the hook order stays stable when `data`
  // toggles between empty and populated — otherwise React throws
  // "rendered fewer hooks than expected" and the tab crashes.
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

  if (data.length === 0) {
    return <div style={{ color: '#aaaaaa', fontSize: 14 }}>No waypoints in DTC data.</div>;
  }

  const totalDist = distances.reduce((s, d) => s + d, 0);

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
        <span style={{ color: '#aaaaaa', fontSize: 12 }}>
          {data.length} waypoints · Total: <strong style={{ color: '#e0e0e0' }}>{totalDist.toFixed(1)} nm</strong>
        </span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#e0e0e0' }}>
        <thead>
          <tr style={{ color: '#aaaaaa', borderBottom: '1px solid #3a3a3a', background: '#1a1a1a' }}>
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
              <tr key={wpNum} style={{ borderBottom: '1px solid #262626' }}>
                <td style={{ ...tdStyle, fontFamily: "'B612 Mono', monospace", color: '#aaaaaa' }}>{wpNum}</td>
                <td style={tdStyle}>{wp.name || '-'}</td>
                <td style={{ ...tdStyle, fontFamily: "'B612 Mono', monospace", fontSize: 12 }}>{wp.lat}</td>
                <td style={{ ...tdStyle, fontFamily: "'B612 Mono', monospace", fontSize: 12 }}>{wp.lon}</td>
                <td style={{ ...tdStyle, fontFamily: "'B612 Mono', monospace" }}>{wp.alt}</td>
                <td style={{ ...tdStyle, fontFamily: "'B612 Mono', monospace", color: distances[i] > 0 ? '#d29922' : '#3a3a3a', fontSize: 12 }}>
                  {distances[i] > 0 ? distances[i].toFixed(1) : '—'}
                </td>
                <td style={tdStyle}>
                  <input
                    value={steerNotes[wpNum] ?? ''}
                    onChange={(e) => setSteerNotes((prev) => ({ ...prev, [wpNum]: e.target.value }))}
                    placeholder="IP, push, fence in..."
                    style={{ ...monoInputStyle, width: '100%', fontSize: 11, fontFamily: 'inherit', color: '#cccccc' }}
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
  // v1.19.66 — overlay staged TACAN/ICLS/frequency edits so this tab
  // reflects what the Carriers / Comm Cards panels have queued.
  const groups = useEffectiveGroups();
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
        entry.freq = `${freqMhz} ${g.modulation === 1 ? 'FM' : 'AM'}`;
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
        flex: '1 1 300px', maxWidth: 420, background: '#1a1a1a',
        border: '1px solid #3a3a3a', borderRadius: 6, padding: 12,
        maxHeight: 400, overflowY: 'auto', alignSelf: 'flex-start',
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#aaaaaa', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
          Mission Nav Data
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: '#aaaaaa', borderBottom: '1px solid #3a3a3a' }}>
              <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 600 }}>Unit</th>
              <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 600 }}>Freq</th>
              <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 600 }}>TACAN</th>
              <th style={{ textAlign: 'left', padding: '4px 6px', fontWeight: 600 }}>ICLS</th>
            </tr>
          </thead>
          <tbody>
            {navRefs.map((r) => (
              <tr key={r.name} style={{
                borderBottom: '1px solid #262626',
                background: r.isSelected ? 'rgba(74, 143, 212, 0.08)' : 'transparent',
              }}>
                <td style={{ padding: '4px 6px', color: r.isSelected ? '#6ab4f0' : '#cccccc', fontWeight: r.isSelected ? 600 : 400 }}>
                  {r.name}
                </td>
                <td style={{ padding: '4px 6px', color: '#e0e0e0', fontFamily: "'B612 Mono', monospace" }}>{r.freq || '-'}</td>
                <td style={{ padding: '4px 6px', color: '#d29922', fontFamily: "'B612 Mono', monospace" }}>{r.tacan || '-'}</td>
                <td style={{ padding: '4px 6px', color: '#3fb950', fontFamily: "'B612 Mono', monospace" }}>{r.icls || '-'}</td>
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
  // v1.19.66 — overlay staged TACAN/ICLS/frequency edits so this tab
  // reflects what the Carriers / Comm Cards panels have queued.
  const groups = useEffectiveGroups();

  // Find tankers in mission (groups with task "Refueling" or "Tanker")
  const tankers = useMemo(() => {
    return groups.filter((g) =>
      g.task === 'Refueling' || g.task === 'Tanker' ||
      g.groupName.toLowerCase().includes('tanker') || g.groupName.toLowerCase().includes('texaco') ||
      g.groupName.toLowerCase().includes('shell') || g.groupName.toLowerCase().includes('arco')
    ).map((g) => ({
      name: g.groupName,
      freq: g.frequency ? (g.frequency >= 1e6 ? (g.frequency / 1e6).toFixed(3) : g.frequency.toFixed(3)) + (g.modulation === 1 ? ' FM' : ' AM') : null,
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
        background: '#0a1218', borderRadius: 6, border: '1px solid #222222',
        flexWrap: 'wrap', alignItems: 'center',
      }}>
        <label style={{ color: '#aaaaaa', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          Start Fuel (lbs)
          <input type="number" value={startFuel} onChange={(e) => setStartFuel(Number(e.target.value))}
            style={{ ...monoInputStyle, width: 80 }} />
        </label>
        <label style={{ color: '#aaaaaa', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          Bingo (lbs)
          <input type="number" value={bingo} onChange={(e) => setBingo(Number(e.target.value))}
            style={{ ...monoInputStyle, width: 70 }} />
        </label>
        <label style={{ color: '#aaaaaa', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          GS (kts)
          <input type="number" value={groundSpeed} onChange={(e) => setGroundSpeed(Number(e.target.value))}
            style={{ ...monoInputStyle, width: 60 }} />
        </label>
        <label style={{ color: '#aaaaaa', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          Burn (lbs/hr)
          <input type="number" value={burnRate} onChange={(e) => setBurnRate(Number(e.target.value))}
            style={{ ...monoInputStyle, width: 70 }} />
        </label>
        <div style={{ display: 'flex', gap: 3, marginLeft: 4 }}>
          {BURN_PRESETS.map((p) => (
            <button key={p.label} onClick={() => setBurnRate(p.rate)}
              style={{
                background: burnRate === p.rate ? '#4a4a4a' : '#262626',
                border: `1px solid ${burnRate === p.rate ? '#2a5a8a' : '#3a3a3a'}`,
                borderRadius: 3, color: burnRate === p.rate ? '#6ab4f0' : '#aaaaaa',
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
        background: '#262626', borderRadius: 4, border: '1px solid #3a3a3a',
      }}>
        <FuelStat label="Total Dist" value={`${totalDist.toFixed(1)} nm`} />
        <FuelStat label="Total Time" value={`${totalTime.toFixed(0)} min`} />
        <FuelStat label="Total Burn" value={`${totalBurn.toFixed(0)} lbs`} />
        <FuelStat label="Landing Fuel" value={`${(startFuel - totalBurn).toFixed(0)} lbs`}
          color={(startFuel - totalBurn) < bingo ? '#d95050' : (startFuel - totalBurn) < bingo * 1.3 ? '#d29922' : '#3fb950'} />
      </div>

      {/* Fuel plan table */}
      {waypoints.length === 0 ? (
        <div style={{ color: '#aaaaaa', fontSize: 14 }}>No waypoints — load DTC with waypoints first.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#e0e0e0', maxWidth: 800 }}>
          <thead>
            <tr style={{ color: '#aaaaaa', borderBottom: '1px solid #3a3a3a', background: '#1a1a1a' }}>
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
                <tr key={leg.wpNum} style={{ borderBottom: '1px solid #262626' }}>
                  <td style={{ ...tdStyle, fontFamily: "'B612 Mono', monospace", color: '#aaaaaa' }}>{leg.wpNum}</td>
                  <td style={tdStyle}>{leg.name}</td>
                  <td style={{ ...tdStyle, fontFamily: "'B612 Mono', monospace" }}>{leg.legNm > 0 ? leg.legNm.toFixed(1) : '—'}</td>
                  <td style={{ ...tdStyle, fontFamily: "'B612 Mono', monospace" }}>{leg.legMin > 0 ? leg.legMin.toFixed(1) : '—'}</td>
                  <td style={{ ...tdStyle, fontFamily: "'B612 Mono', monospace" }}>{leg.fuelUsed > 0 ? leg.fuelUsed.toFixed(0) : '—'}</td>
                  <td style={{
                    ...tdStyle, fontFamily: "'B612 Mono', monospace", fontWeight: 600,
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
        <div style={{ color: '#aaaaaa', fontSize: 12, marginBottom: 6 }}>Fuel Gauge</div>
        <div style={{
          height: 24, background: '#0a1218', borderRadius: 4,
          border: '1px solid #3a3a3a', position: 'relative', overflow: 'hidden',
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
          marginTop: 16, padding: 12, background: '#1a1a1a',
          border: '1px solid #3a3a3a', borderRadius: 6,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#aaaaaa', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
            Tankers in Mission
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {tankers.map((t) => (
              <div key={t.name} style={{
                padding: '8px 12px', background: '#262626', borderRadius: 4,
                border: '1px solid #3a3a3a', fontSize: 12,
              }}>
                <div style={{ color: '#e0e0e0', fontWeight: 600, marginBottom: 4 }}>{t.name}</div>
                <div style={{ display: 'flex', gap: 12 }}>
                  {t.freq && <span style={{ color: '#cccccc', fontFamily: "'B612 Mono', monospace" }}>{t.freq}</span>}
                  {t.tacan && <span style={{ color: '#d29922', fontFamily: "'B612 Mono', monospace" }}>TCN {t.tacan}</span>}
                  {!t.freq && !t.tacan && <span style={{ color: '#4a4a4a' }}>No freq/TACAN set</span>}
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
      <div style={{ color: '#aaaaaa', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' as const }}>{label}</div>
      <div style={{ color: color || '#e0e0e0', fontSize: 14, fontWeight: 600, fontFamily: "'B612 Mono', monospace" }}>{value}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tools sub-tab                                                       */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* SA sub-tab — SA-page setup (2026 radar/SA DTC update).               */
/* Edits dtcData.SA in place; the full SA object flows to the backend   */
/* on export (build_dtc_from_edits accepts the uppercase "SA" object).  */
/* ------------------------------------------------------------------ */
function SaSubTab({ data, navPts, setDtcData }: {
  data?: SaData;
  navPts: SaWaypoint[];
  setDtcData: React.Dispatch<React.SetStateAction<DtcData | null>>;
}) {
  if (!data || !data.SETTINGS) {
    return <div style={{ color: '#aaaaaa', fontSize: 13, padding: 12 }}>Load a flight's DTC to set up its SA page.</div>;
  }
  const mutate = (fn: (sa: SaData) => SaData) =>
    setDtcData((prev) => (prev && prev.SA ? { ...prev, SA: fn(prev.SA) } : prev));
  const sensors = data.SETTINGS.SENSORS_SETTINGS;
  type SensorKey = keyof SaData['SETTINGS']['SENSORS_SETTINGS'];
  const setSensor = (k: SensorKey, v: boolean | number) =>
    mutate((sa) => ({ ...sa, SETTINGS: { ...sa.SETTINGS, SENSORS_SETTINGS: { ...sa.SETTINGS.SENSORS_SETTINGS, [k]: v } } }));
  const toggleDcltr = (mrej: 'MREJ1' | 'MREJ2', k: string) =>
    mutate((sa) => ({ ...sa, SETTINGS: { ...sa.SETTINGS, DCLTR_SETTINGS: { ...sa.SETTINGS.DCLTR_SETTINGS, [mrej]: { ...sa.SETTINGS.DCLTR_SETTINGS[mrej], [k]: !sa.SETTINGS.DCLTR_SETTINGS[mrej][k] } } } }));
  const renumber = (arr: MezThreat[]) => arr.map((m, i) => ({ ...m, num: i + 1, id: `MEZ_THRTS_${i + 1}` }));
  const setMez = (i: number, k: keyof MezThreat, v: string | number) =>
    mutate((sa) => ({ ...sa, MEZ_THRTS: sa.MEZ_THRTS.map((m, idx) => (idx === i ? ({ ...m, [k]: v } as MezThreat) : m)) }));
  const addMez = () =>
    mutate((sa) => ({ ...sa, MEZ_THRTS: renumber([...sa.MEZ_THRTS, { text: 'NEW', threat_level: 1, threat_ring_radius: 1, threat_type: 'Custom', x: 0, y: 0 }]) }));
  const removeMez = (i: number) =>
    mutate((sa) => ({ ...sa, MEZ_THRTS: renumber(sa.MEZ_THRTS.filter((_, idx) => idx !== i)) }));

  // --- CAP points (manual: anchored at a picked waypoint, editable orbit) ---
  const caps: CapPoint[] = data.CAP_PTS ?? [];
  const wpLabel = (w: SaWaypoint, i: number) => (w.text_note && w.text_note.trim()) || `WP${w.wypt_num ?? i + 1}`;
  const renumberCaps = (arr: CapPoint[]) => arr.map((c, i) => ({ ...c, num: i + 1, id: `CAP_PTS_${i + 1}` }));
  const mutateCaps = (fn: (arr: CapPoint[]) => CapPoint[]) =>
    mutate((sa) => ({ ...sa, CAP_PTS: renumberCaps(fn(sa.CAP_PTS ?? [])) }));
  const addCapAt = (w: SaWaypoint) =>
    mutateCaps((arr) => [...arr, { note: 'CAP', x: w.x ?? 0, y: w.y ?? 0, course: 0, diameter: 9260, length: 37040, turn_direction: 'Left' as const }]);
  const setCap = (i: number, k: keyof CapPoint, v: string | number) =>
    mutateCaps((arr) => arr.map((c, idx) => (idx === i ? ({ ...c, [k]: v } as CapPoint) : c)));
  const removeCap = (i: number) => mutateCaps((arr) => arr.filter((_, idx) => idx !== i));

  const card: React.CSSProperties = { background: '#222', border: '1px solid #3a3a3a', borderRadius: 4, padding: 12, marginBottom: 14 };
  const head: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#e0e0e0', marginBottom: 8 };
  const chk = (on: boolean): React.CSSProperties => ({ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: on ? '#cfe6ff' : '#888', cursor: 'pointer', padding: '3px 0' });
  const numIn: React.CSSProperties = { width: 64, background: '#262626', border: '1px solid #3a3a3a', borderRadius: 3, color: '#e0e0e0', fontSize: 12, padding: '3px 5px', fontFamily: 'inherit' };
  const txtIn: React.CSSProperties = { ...numIn, width: 130 };

  const trackToggles: [SensorKey, string][] = [
    ['FF_tracks', 'Fighter-to-fighter'], ['PPLI_tracks', 'PPLI (own flight)'],
    ['SURV_tracks', 'Surveillance'], ['UNK_tracks', 'Unknown'],
  ];

  return (
    <div>
      <p style={{ fontSize: 12, color: '#aaaaaa', marginTop: 0, marginBottom: 14, lineHeight: 1.5 }}>
        SA-page setup written onto the cartridge (2026 radar/SA DTC). Threat rings auto-fill from the mission's enemy SAMs — rename, retune, or add your own markers below.
      </p>

      <div style={card}>
        <div style={head}>Track display</div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          {trackToggles.map(([k, label]) => (
            <label key={k} style={chk(!!sensors[k])}>
              <input type="checkbox" checked={!!sensors[k]} onChange={() => setSensor(k, !sensors[k])} />
              {label}
            </label>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 18, marginTop: 8 }}>
          <label style={{ fontSize: 12, color: '#aaa', display: 'flex', flexDirection: 'column', gap: 3 }}>Friend symbols
            <input type="number" min={0} max={5} style={numIn} value={sensors.FRIEND_Symbols} onChange={(e) => setSensor('FRIEND_Symbols', Number(e.target.value))} /></label>
          <label style={{ fontSize: 12, color: '#aaa', display: 'flex', flexDirection: 'column', gap: 3 }}>RWR symbols
            <input type="number" min={0} max={5} style={numIn} value={sensors.RWR_Symbols} onChange={(e) => setSensor('RWR_Symbols', Number(e.target.value))} /></label>
        </div>
      </div>

      <div style={card}>
        <div style={head}>Declutter (master reject levels)</div>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          {(['MREJ1', 'MREJ2'] as const).map((mrej) => (
            <div key={mrej} style={{ flex: '1 1 220px', minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#4a8fd4', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{mrej === 'MREJ1' ? 'Reject 1' : 'Reject 2'}</div>
              {DCLTR_ORDER.map((k) => (
                <label key={k} style={chk(!!data.SETTINGS.DCLTR_SETTINGS[mrej][k])}>
                  <input type="checkbox" checked={!!data.SETTINGS.DCLTR_SETTINGS[mrej][k]} onChange={() => toggleDcltr(mrej, k)} />
                  {DCLTR_LABELS[k] ?? k}
                </label>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={head}>Threat rings / markers ({data.MEZ_THRTS.length})</div>
          <button onClick={addMez} style={{ background: '#1a2a1a', border: '1px solid #3fb950', color: '#3fb950', borderRadius: 3, fontSize: 12, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>+ Add marker</button>
        </div>
        {data.MEZ_THRTS.length === 0 ? (
          <div style={{ fontSize: 12, color: '#888' }}>No enemy SAMs in this mission — add markers by hand, or they'll auto-fill when the mission has threats.</div>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
            <thead><tr style={{ textAlign: 'left', color: '#888' }}>
              <th style={{ padding: '4px 6px' }}>#</th><th style={{ padding: '4px 6px' }}>Name</th><th style={{ padding: '4px 6px' }}>Level</th><th style={{ padding: '4px 6px' }}>Radius</th><th style={{ padding: '4px 6px' }}>Position</th><th />
            </tr></thead>
            <tbody>
              {data.MEZ_THRTS.map((m, i) => (
                <tr key={i} style={{ borderTop: '1px solid #2f2f2f' }}>
                  <td style={{ padding: '4px 6px', color: '#888' }}>{i + 1}</td>
                  <td style={{ padding: '4px 6px' }}><input style={txtIn} value={m.text} onChange={(e) => setMez(i, 'text', e.target.value)} /></td>
                  <td style={{ padding: '4px 6px' }}><input type="number" style={numIn} value={m.threat_level} onChange={(e) => setMez(i, 'threat_level', Number(e.target.value))} /></td>
                  <td style={{ padding: '4px 6px' }}><input type="number" style={numIn} value={m.threat_ring_radius} onChange={(e) => setMez(i, 'threat_ring_radius', Number(e.target.value))} /></td>
                  <td style={{ padding: '4px 6px', color: '#888', fontFamily: "'B612 Mono', monospace", fontSize: 11 }}>{Math.round(m.x)}, {Math.round(m.y)}</td>
                  <td style={{ padding: '4px 6px' }}><button onClick={() => removeMez(i)} title="Remove" style={{ background: 'none', border: 'none', color: '#e0554f', cursor: 'pointer', fontSize: 14 }}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ fontSize: 11, color: '#777', marginTop: 8, lineHeight: 1.5 }}>
          Level/radius mirror a hand-built DTC (Custom type). Confirm the radius unit in-jet and we'll size rings to real SAM ranges automatically.
        </div>
      </div>

      {/* Corridors / FAOR / FLOT — all named polylines (same DCS shape),
          built by picking the flight's waypoints. */}
      <SaLineEditor title="Corridors" addLabel="+ Corridor" idPrefix="CORR" navPts={navPts}
        lines={data.CORRIDORS ?? []}
        onChange={(l) => mutate((sa) => ({ ...sa, CORRIDORS: l }))}
        emptyHint="No corridors. Add one, then pick waypoints to draw the lane (e.g. ingress → egress)." />
      <SaLineEditor title="FAOR lines" addLabel="+ FAOR" idPrefix="FAOR" navPts={navPts}
        lines={data.FAOR_FLOT?.FAOR ?? []}
        onChange={(l) => mutate((sa) => ({ ...sa, FAOR_FLOT: { FAOR: l, FLOT: sa.FAOR_FLOT?.FLOT ?? [] } }))}
        emptyHint="No FAOR boundaries. Add one and pick waypoints to outline the area of responsibility." />
      <SaLineEditor title="FLOT / LOA lines" addLabel="+ FLOT" idPrefix="FLOT" navPts={navPts}
        lines={data.FAOR_FLOT?.FLOT ?? []}
        onChange={(l) => mutate((sa) => ({ ...sa, FAOR_FLOT: { FAOR: sa.FAOR_FLOT?.FAOR ?? [], FLOT: l } }))}
        emptyHint="No FLOT/LOA lines. Add one and pick waypoints to mark the forward line." />

      {/* CAP points — racetrack orbits anchored at a waypoint. */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={head}>CAP points ({caps.length})</div>
          <select value="" onChange={(e) => { if (e.target.value === '') return; const wi = Number(e.target.value); if (navPts[wi]) addCapAt(navPts[wi]); }}
                  style={{ background: '#1a2330', border: '1px solid #4a8fd4', color: '#cfe6ff', borderRadius: 3, fontSize: 12, padding: '4px 8px', fontFamily: 'inherit' }}>
            <option value="">+ CAP at waypoint…</option>
            {navPts.map((w, wi) => (w.x != null && w.y != null ? <option key={wi} value={wi}>{wpLabel(w, wi)}</option> : null))}
          </select>
        </div>
        {caps.length === 0 ? (
          <div style={{ fontSize: 12, color: '#888' }}>No CAP points. Add one anchored at a waypoint, then set the orbit course / length / diameter.</div>
        ) : (
          caps.map((c, i) => (
            <div key={i} style={{ borderTop: i ? '1px solid #2f2f2f' : 'none', padding: '8px 0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input style={{ ...txtIn, width: 110 }} value={c.note} onChange={(e) => setCap(i, 'note', e.target.value)} placeholder="Name" />
              <label style={{ fontSize: 11, color: '#aaa' }}>Crs° <input type="number" style={{ ...numIn, width: 54 }} value={c.course} onChange={(e) => setCap(i, 'course', Number(e.target.value))} /></label>
              <label style={{ fontSize: 11, color: '#aaa' }}>Len(m) <input type="number" style={{ ...numIn, width: 72 }} value={c.length} onChange={(e) => setCap(i, 'length', Number(e.target.value))} /></label>
              <label style={{ fontSize: 11, color: '#aaa' }}>Dia(m) <input type="number" style={{ ...numIn, width: 64 }} value={c.diameter} onChange={(e) => setCap(i, 'diameter', Number(e.target.value))} /></label>
              <select value={c.turn_direction} onChange={(e) => setCap(i, 'turn_direction', e.target.value)} style={{ ...numIn, width: 68 }}>
                <option value="Left">Left</option><option value="Right">Right</option>
              </select>
              <span style={{ fontSize: 11, color: '#888', fontFamily: "'B612 Mono', monospace" }}>@ {Math.round(c.x)}, {Math.round(c.y)}</span>
              <button onClick={() => removeCap(i)} title="Remove" style={{ background: 'none', border: 'none', color: '#e0554f', cursor: 'pointer', fontSize: 14, marginLeft: 'auto' }}>×</button>
            </div>
          ))
        )}
        <div style={{ fontSize: 11, color: '#777', marginTop: 8, lineHeight: 1.5 }}>
          Anchored at the picked waypoint; length/diameter in metres (9260 m ≈ 5 nm). Auto-fill from Mission-Editor orbit tasks lands once we map an orbit sample.
        </div>
      </div>
    </div>
  );
}

/* SA polyline editor — shared by Corridors, FAOR, and FLOT (identical DCS
   shape: a named line of points). Points are picked from the flight's
   waypoints so nobody hand-types world coords. Re-ids to <PREFIX>_n /
   <PREFIX>_n_PT_m on every change. */
function SaLineEditor({ title, addLabel, lines, idPrefix, navPts, onChange, emptyHint }: {
  title: string;
  addLabel: string;
  lines: Corridor[];
  idPrefix: string;
  navPts: SaWaypoint[];
  onChange: (lines: Corridor[]) => void;
  emptyHint: string;
}) {
  const wpLabel = (w: SaWaypoint, i: number) => (w.text_note && w.text_note.trim()) || `WP${w.wypt_num ?? i + 1}`;
  const renumber = (arr: Corridor[]): Corridor[] =>
    arr.map((c, ci) => ({
      ...c, num: ci + 1, id: `${idPrefix}_${ci + 1}`,
      points: c.points.map((p, pi) => ({ ...p, id: `${idPrefix}_${ci + 1}_PT_${pi + 1}` })),
    }));
  const set = (fn: (arr: Corridor[]) => Corridor[]) => onChange(renumber(fn(lines)));
  const defaultNote = title.replace(/ lines$/i, '').replace(/s$/, '');
  const addLine = () => set((arr) => [...arr, { note: defaultNote, points: [] }]);
  const removeLine = (ci: number) => set((arr) => arr.filter((_, i) => i !== ci));
  const setNote = (ci: number, note: string) => set((arr) => arr.map((c, i) => (i === ci ? { ...c, note } : c)));
  const addPt = (ci: number, w: SaWaypoint) => set((arr) => arr.map((c, i) => (i === ci ? { ...c, points: [...c.points, { x: w.x ?? 0, y: w.y ?? 0 }] } : c)));
  const removePt = (ci: number, pi: number) => set((arr) => arr.map((c, i) => (i === ci ? { ...c, points: c.points.filter((_, j) => j !== pi) } : c)));
  const pointLabel = (p: CorridorPoint) => {
    const w = navPts.find((n) => n.x === p.x && n.y === p.y);
    return w ? wpLabel(w, 0) : `${Math.round(p.x)}, ${Math.round(p.y)}`;
  };

  const card: React.CSSProperties = { background: '#222', border: '1px solid #3a3a3a', borderRadius: 4, padding: 12, marginBottom: 14 };
  const head: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#e0e0e0' };
  const txtIn: React.CSSProperties = { background: '#262626', border: '1px solid #3a3a3a', borderRadius: 3, color: '#e0e0e0', fontSize: 12, padding: '3px 5px', fontFamily: 'inherit' };

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={head}>{title} ({lines.length})</div>
        <button onClick={addLine} style={{ background: '#1a2330', border: '1px solid #4a8fd4', color: '#cfe6ff', borderRadius: 3, fontSize: 12, padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit' }}>{addLabel}</button>
      </div>
      {lines.length === 0 ? (
        <div style={{ fontSize: 12, color: '#888' }}>{emptyHint}</div>
      ) : (
        lines.map((c, ci) => (
          <div key={ci} style={{ borderTop: ci ? '1px solid #2f2f2f' : 'none', padding: '8px 0' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <input style={{ ...txtIn, flex: 1 }} value={c.note} onChange={(e) => setNote(ci, e.target.value)} placeholder="Name" />
              <span style={{ fontSize: 11, color: '#888' }}>{c.points.length} pt{c.points.length === 1 ? '' : 's'}</span>
              <button onClick={() => removeLine(ci)} title="Remove" style={{ background: 'none', border: 'none', color: '#e0554f', cursor: 'pointer', fontSize: 14 }}>×</button>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {c.points.map((p, pi) => (
                <span key={pi} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#262626', border: '1px solid #3a3a3a', borderRadius: 3, padding: '2px 6px', fontSize: 11, color: '#cccccc' }}>
                  {pi + 1}. {pointLabel(p)}
                  <button onClick={() => removePt(ci, pi)} style={{ background: 'none', border: 'none', color: '#e0554f', cursor: 'pointer', fontSize: 12, padding: 0, lineHeight: 1 }}>×</button>
                </span>
              ))}
              <select value="" onChange={(e) => { if (e.target.value === '') return; const wi = Number(e.target.value); if (navPts[wi]) addPt(ci, navPts[wi]); }}
                      style={{ ...txtIn, width: 160 }}>
                <option value="">+ add waypoint…</option>
                {navPts.map((w, wi) => (w.x != null && w.y != null
                  ? <option key={wi} value={wi}>{wpLabel(w, wi)}</option>
                  : null))}
              </select>
            </div>
          </div>
        ))
      )}
      <div style={{ fontSize: 11, color: '#777', marginTop: 8, lineHeight: 1.5 }}>
        {navPts.length === 0
          ? 'No waypoints on this flight yet — points are picked from the route.'
          : 'Points come from this flight’s waypoints (DCS coords). Add them in order; fine-tune the exact path in the DCS DTC Manager if needed.'}
      </div>
    </div>
  );
}

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
              background: toolSection === t.key ? '#4a4a4a20' : 'transparent',
              border: `1px solid ${toolSection === t.key ? '#4a8fd4' : '#3a3a3a'}`,
              borderRadius: 14, color: toolSection === t.key ? '#4a8fd4' : '#aaaaaa',
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
      <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: '#cccccc' }}>
        Bullseye Reference
      </h4>
      <p style={{ color: '#aaaaaa', fontSize: 12, margin: '0 0 12px' }}>
        Enter bullseye coordinates to see bearing/range from each waypoint.
      </p>
      <div style={{ display: 'flex', gap: 12, marginBottom: 14, alignItems: 'center' }}>
        <label style={{ color: '#aaaaaa', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          BE Lat
          <input value={beLat} onChange={(e) => setBeLat(e.target.value)} placeholder="N41°15'30&quot;"
            style={{ ...monoInputStyle, width: 130 }} />
        </label>
        <label style={{ color: '#aaaaaa', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          BE Lon
          <input value={beLon} onChange={(e) => setBeLon(e.target.value)} placeholder="E044°30'00&quot;"
            style={{ ...monoInputStyle, width: 130 }} />
        </label>
      </div>

      {results.length > 0 && beLatNum !== null && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, color: '#e0e0e0', maxWidth: 500 }}>
          <thead>
            <tr style={{ color: '#aaaaaa', borderBottom: '1px solid #3a3a3a', background: '#1a1a1a' }}>
              <th style={{ ...thStyle, width: 36 }}>#</th>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Bearing</th>
              <th style={thStyle}>Range (nm)</th>
              <th style={thStyle}>Bullseye Call</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.wpNum} style={{ borderBottom: '1px solid #262626' }}>
                <td style={{ ...tdStyle, fontFamily: "'B612 Mono', monospace", color: '#aaaaaa' }}>{r.wpNum}</td>
                <td style={tdStyle}>{r.name || '-'}</td>
                <td style={{ ...tdStyle, fontFamily: "'B612 Mono', monospace" }}>{r.valid ? `${r.bearing.toFixed(0)}°` : '—'}</td>
                <td style={{ ...tdStyle, fontFamily: "'B612 Mono', monospace" }}>{r.valid ? r.range.toFixed(1) : '—'}</td>
                <td style={{ ...tdStyle, fontFamily: "'B612 Mono', monospace", color: '#d29922', fontWeight: 600 }}>
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
      <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: '#cccccc' }}>
        Speed / Time Calculator
      </h4>
      <p style={{ color: '#aaaaaa', fontSize: 12, margin: '0 0 12px' }}>
        Compute required ground speed or arrival time for a waypoint.
      </p>

      {/* Mode selector */}
      <div style={{ display: 'flex', gap: 3, marginBottom: 14 }}>
        {(['zulu_tot', 'zulu_speed', 'minutes'] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} style={{
            background: mode === m ? '#4a4a4a' : '#262626',
            border: `1px solid ${mode === m ? '#2a5a8a' : '#3a3a3a'}`,
            borderRadius: 3, color: mode === m ? '#6ab4f0' : '#aaaaaa',
            fontSize: 11, padding: '4px 10px', cursor: 'pointer', fontWeight: 600,
          }}>
            {modeLabel[m]}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ color: '#aaaaaa', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
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
          <label style={{ color: '#aaaaaa', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            Enroute (min)
            <input type="number" value={tosMinutes} onChange={(e) => setTosMinutes(Number(e.target.value))}
              min={1} max={300} style={{ ...monoInputStyle, width: 60 }} />
          </label>
        )}

        {(mode === 'zulu_tot' || mode === 'zulu_speed') && (
          <label style={{ color: '#aaaaaa', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            Depart (Zulu)
            <input value={departZulu} onChange={(e) => setDepartZulu(e.target.value)}
              placeholder="08:00" style={{ ...monoInputStyle, width: 70 }} />
          </label>
        )}

        {mode === 'zulu_tot' && (
          <label style={{ color: '#aaaaaa', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            TOT (Zulu)
            <input value={totZulu} onChange={(e) => setTotZulu(e.target.value)}
              placeholder="08:45" style={{ ...monoInputStyle, width: 70 }} />
          </label>
        )}

        {mode === 'zulu_speed' && (
          <label style={{ color: '#aaaaaa', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            GS (kts)
            <input type="number" value={inputSpeed} onChange={(e) => setInputSpeed(Number(e.target.value))}
              min={50} max={1200} style={{ ...monoInputStyle, width: 70 }} />
          </label>
        )}
      </div>

      {totalNm > 0 && (
        <div style={{ color: '#aaaaaa', fontSize: 12, marginBottom: 8 }}>
          Distance to target: <span style={{ color: '#e0e0e0', fontFamily: "'B612 Mono', monospace" }}>{totalNm.toFixed(1)} nm</span>
        </div>
      )}

      {result && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12,
          padding: '12px', background: '#0a1218', borderRadius: 6, border: '1px solid #222222',
        }}>
          <div>
            <div style={{ color: '#aaaaaa', fontSize: 10, fontWeight: 600 }}>DISTANCE</div>
            <div style={{ color: '#e0e0e0', fontSize: 16, fontWeight: 600, fontFamily: "'B612 Mono', monospace" }}>{totalNm.toFixed(1)} nm</div>
          </div>
          <div>
            <div style={{ color: '#aaaaaa', fontSize: 10, fontWeight: 600 }}>{mode === 'zulu_speed' ? 'GS' : 'REQ GS'}</div>
            <div style={{ color: '#4a8fd4', fontSize: 16, fontWeight: 600, fontFamily: "'B612 Mono', monospace" }}>{result.gs.toFixed(0)} kts</div>
          </div>
          <div>
            <div style={{ color: '#aaaaaa', fontSize: 10, fontWeight: 600 }}>~MACH</div>
            <div style={{ color: '#d29922', fontSize: 16, fontWeight: 600, fontFamily: "'B612 Mono', monospace" }}>{result.mach.toFixed(2)}</div>
          </div>
          <div>
            <div style={{ color: '#aaaaaa', fontSize: 10, fontWeight: 600 }}>ENROUTE</div>
            <div style={{ color: '#e0e0e0', fontSize: 16, fontWeight: 600, fontFamily: "'B612 Mono', monospace" }}>{result.enrouteMin.toFixed(0)} min</div>
          </div>
          {result.departureZulu && (
            <div>
              <div style={{ color: '#aaaaaa', fontSize: 10, fontWeight: 600 }}>DEPART</div>
              <div style={{ color: '#3fb950', fontSize: 16, fontWeight: 600, fontFamily: "'B612 Mono', monospace" }}>{result.departureZulu}</div>
            </div>
          )}
          {result.arrivalZulu && (
            <div>
              <div style={{ color: '#aaaaaa', fontSize: 10, fontWeight: 600 }}>{mode === 'zulu_speed' ? 'ETA' : 'TOT'}</div>
              <div style={{ color: '#3fb950', fontSize: 16, fontWeight: 600, fontFamily: "'B612 Mono', monospace" }}>{result.arrivalZulu}</div>
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
      <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: '#cccccc' }}>
        Copy DTC to Wingman
      </h4>
      <p style={{ color: '#aaaaaa', fontSize: 12, margin: '0 0 12px' }}>
        Offset COMM1 frequencies for wingman DTC. Waypoints and CMDS are copied as-is.
      </p>

      <div style={{ display: 'flex', gap: 12, marginBottom: 14, alignItems: 'center' }}>
        <label style={{ color: '#aaaaaa', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          Freq Offset (MHz)
          <input type="number" value={freqOffset} step={0.025} min={-5} max={5}
            onChange={(e) => setFreqOffset(Number(e.target.value))}
            style={{ ...monoInputStyle, width: 80 }} />
        </label>
        <button onClick={applyWingmanOffset} style={{
          ...btnStyle, background: '#4a4a4a', color: '#4a8fd4',
        }}>
          Apply Offset to COMM1
        </button>
        {copied && <span style={{ color: '#3fb950', fontSize: 12 }}>✓ Offset applied!</span>}
      </div>

      {wingmanPreview.length > 0 && (
        <div style={{ maxWidth: 500 }}>
          <div style={{ color: '#aaaaaa', fontSize: 11, marginBottom: 6 }}>Preview (COMM1 offset +{freqOffset} MHz):</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: '#e0e0e0' }}>
            <thead>
              <tr style={{ color: '#aaaaaa', borderBottom: '1px solid #3a3a3a', background: '#1a1a1a' }}>
                <th style={{ ...thStyle, fontSize: 11 }}>Ch</th>
                <th style={{ ...thStyle, fontSize: 11 }}>Name</th>
                <th style={{ ...thStyle, fontSize: 11 }}>Original</th>
                <th style={{ ...thStyle, fontSize: 11 }}>→ Wingman</th>
              </tr>
            </thead>
            <tbody>
              {wingmanPreview.map((p) => (
                <tr key={p.ch} style={{ borderBottom: '1px solid #262626' }}>
                  <td style={{ ...tdStyle, fontFamily: "'B612 Mono', monospace", color: '#aaaaaa' }}>{p.ch}</td>
                  <td style={tdStyle}>{p.name}</td>
                  <td style={{ ...tdStyle, fontFamily: "'B612 Mono', monospace" }}>{p.origFreq}</td>
                  <td style={{ ...tdStyle, fontFamily: "'B612 Mono', monospace", color: '#d29922' }}>{p.newFreq}</td>
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
  background: '#262626',
  border: '1px solid #3a3a3a',
  borderRadius: 3,
  color: '#e0e0e0',
  fontFamily: "'B612 Mono', monospace",
  fontSize: 14,
  padding: '4px 6px',
  boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = {
  background: '#262626',
  border: '1px solid #3a3a3a',
  borderRadius: 3,
  color: '#e0e0e0',
  fontSize: 14,
  padding: '4px 8px',
  fontFamily: 'inherit',
};

const btnStyle: React.CSSProperties = {
  background: '#262626',
  border: '1px solid #4a4a4a',
  borderRadius: 4,
  color: '#4a8fd4',
  cursor: 'pointer',
  fontSize: 14,
  padding: '6px 14px',
  fontFamily: 'inherit',
};

const fieldsetStyle: React.CSSProperties = {
  border: '1px solid #3a3a3a',
  borderRadius: 4,
  padding: '12px 16px',
  margin: 0,
};

const legendStyle: React.CSSProperties = {
  color: '#cccccc',
  fontSize: 14,
  fontWeight: 600,
  padding: '0 6px',
};

const fieldLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  color: '#cccccc',
  fontSize: 13,
};

/* ------------------------------------------------------------------ */
/* Presets sub-tab                                                      */
/* ------------------------------------------------------------------ */

function PresetsSubTab({ setDtcData, templateMsg, setTemplateMsg, activeSop, onApplySop }: {
  setDtcData: React.Dispatch<React.SetStateAction<DtcData | null>>;
  templateMsg: string;
  setTemplateMsg: (msg: string) => void;
  activeSop: SOP | null;
  onApplySop: (target?: 'both' | 'COMM1' | 'COMM2') => void;
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
      {templateMsg && <div style={{ color: '#3fb950', fontSize: 12, padding: '6px 12px', background: '#0a1218', borderRadius: 6, border: '1px solid #222222' }}>✓ {templateMsg}</div>}

      {/* Active SOP — synthesized COMM pack. Same wiring as the COMM tab's
          inline button, mirrored here so pilots can find it next to the
          other preset packs. */}
      {activeSop && (
        <div style={{ padding: '12px 14px', background: '#0a1218', borderRadius: 6, border: '1px solid #1a3a1a' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span
              style={{
                padding: '2px 8px',
                borderRadius: 4,
                background: '#1a3a1a',
                border: '1px solid #2a5a2a',
                color: '#3fb950',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 0.5,
              }}
            >
              SOP
            </span>
            <div style={{ fontSize: 12, color: '#aaaaaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1 }}>
              Active SOP — {activeSop.name}
            </div>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: '#262626', border: '1px solid #4a4a4a', borderRadius: 6,
            padding: '8px 12px',
          }}>
            <span style={{ flex: 1, color: '#e0e0e0', fontSize: 13, fontWeight: 600 }}>{activeSop.name}</span>
            <span style={{ color: '#aaaaaa', fontSize: 11, flex: 2 }}>
              COMM1: {activeSop.flights?.length ?? 0} flight callsigns + tanker · COMM2: {activeSop.comms?.length ?? 0} comms + {activeSop.supportAssets?.length ?? 0} support
            </span>
            <button
              onClick={() => onApplySop('both')}
              style={{
                background: '#1a3a1a', border: '1px solid #2a5a2a', borderRadius: 4,
                color: '#3fb950', cursor: 'pointer', fontSize: 11, padding: '3px 10px',
                fontWeight: 600,
              }}
            >
              → Both
            </button>
            <button
              onClick={() => onApplySop('COMM1')}
              style={{
                background: '#4a4a4a', border: '1px solid #2a5a8a', borderRadius: 4,
                color: '#6ab4f0', cursor: 'pointer', fontSize: 11, padding: '3px 10px',
              }}
            >
              → COMM1
            </button>
            <button
              onClick={() => onApplySop('COMM2')}
              style={{
                background: '#3a3a3a', border: '1px solid #3a3a3a', borderRadius: 4,
                color: '#cccccc', cursor: 'pointer', fontSize: 11, padding: '3px 10px',
              }}
            >
              → COMM2
            </button>
          </div>
        </div>
      )}

      {/* DTC Templates */}
      <div style={{ padding: '12px 14px', background: '#0a1218', borderRadius: 6, border: '1px solid #222222' }}>
        <div style={{ fontSize: 12, color: '#aaaaaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
          DTC Templates
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {DTC_TEMPLATES.map((tpl) => (
            <button
              key={tpl.name}
              onClick={() => applyTemplate(tpl)}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: '#262626', border: '1px solid #4a4a4a', borderRadius: 6,
                color: '#e0e0e0', cursor: 'pointer', fontSize: 13, padding: '8px 12px',
                textAlign: 'left',
              }}
            >
              <span style={{ fontWeight: 600 }}>{tpl.name}</span>
              <span style={{ color: '#aaaaaa', fontSize: 11 }}>{tpl.description}</span>
            </button>
          ))}
        </div>
      </div>

      {/* COMM Frequency Preset Packs */}
      <div style={{ padding: '12px 14px', background: '#0a1218', borderRadius: 6, border: '1px solid #222222' }}>
        <div style={{ fontSize: 12, color: '#aaaaaa', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
          COMM Frequency Packs
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {FREQ_PRESET_PACKS.map((pack) => (
            <div key={pack.name} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#262626', border: '1px solid #4a4a4a', borderRadius: 6,
              padding: '8px 12px',
            }}>
              <span style={{ flex: 1, color: '#e0e0e0', fontSize: 13, fontWeight: 600 }}>{pack.name}</span>
              <span style={{ color: '#aaaaaa', fontSize: 11, flex: 2 }}>{pack.description}</span>
              <button
                onClick={() => applyPresetPack(pack, 'COMM1')}
                style={{
                  background: '#4a4a4a', border: '1px solid #2a5a8a', borderRadius: 4,
                  color: '#6ab4f0', cursor: 'pointer', fontSize: 11, padding: '3px 10px',
                }}
              >
                → COMM1
              </button>
              <button
                onClick={() => applyPresetPack(pack, 'COMM2')}
                style={{
                  background: '#3a3a3a', border: '1px solid #3a3a3a', borderRadius: 4,
                  color: '#cccccc', cursor: 'pointer', fontSize: 11, padding: '3px 10px',
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

