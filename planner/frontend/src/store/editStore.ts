import { create } from 'zustand';
import type { WaypointEdit, UnitEdit } from '../types/mission';
import type { PopupAttackInput } from '../utils/popupAttack';

export interface KneeboardCards {
  // Per-flight cards
  lineup: boolean;
  flight: boolean;
  comms: boolean;
  routeDetail: boolean;
  fuelLadder: boolean;
  homePlate: boolean;
  // Shared mission cards
  supportAssets: boolean;
  radioLadder: boolean;
  airbaseRef: boolean;
  bullseyeRef: boolean;
  threatCard: boolean;
  weatherBrief: boolean;
  /** SOP Comms Card — synthesised from the active SOP. Emits a placeholder
   *  if no SOP is active so the checkbox doesn't silently produce nothing. */
  sopComms: boolean;
  /** Mission Goals Card — squadron objective list grouped by side.
   *  Pulls from useGoalsStore. Renders an empty-state placeholder when
   *  the goals list is empty so an enabled checkbox can't silently
   *  produce a blank card. */
  goalsCard: boolean;
  /** DMPI Card — target list with coordinates / elevation / weapon
   *  delivery. Pulls from useDmpiStore. Renders an empty-state
   *  placeholder when the DMPI list is empty. (v0.9.16) */
  dmpiCard: boolean;
  /** Notes Card — free-text mission notes the planner types in the
   *  Kneeboard tab. Renders the planner's notesText verbatim as a
   *  printable card. Empty-state placeholder when no text. (v0.9.69) */
  notesCard: boolean;
  /** Weapon-employment reference card(s) — one page per selected store
   *  (envelope, profile, switchology, mistakes). Which stores appear is
   *  driven by KneeboardSettings.weaponIds. Defaults OFF. */
  weaponsRef: boolean;
  /** Auto-inject the weapon-employment cards PER FLIGHT based on each
   *  flight's actual loadout (pylon item names matched via WeaponSpec.matches).
   *  Independent of weaponsRef. Defaults OFF. Lands the right cards in each
   *  aircraft's KNEEBOARD folder on .miz download — no manual picking. */
  weaponsAuto: boolean;
  /** Popup-attack reference card(s) — one card per profile defined in
   *  KneeboardSettings.popupAttacks (see utils/popupAttack.ts). Side profile
   *  + parameter table + reference points. Defaults OFF. (v1.17.x) */
  popupAttack: boolean;
}

export interface KneeboardSettings {
  coordFormat: 'mgrs' | 'latlon';
  speedRef: 'auto' | 'cas' | 'tas' | 'gs' | 'mach';
  machThreshold: number;
  cards: KneeboardCards;
  /** Threat card information density. 'full' = every system named,
   *  MGRS, exact rings (mission-debrief / mission-design view).
   *  'operational' = rings + sizes shown but no designations /
   *  MGRS. 'realistic' = vague clustered threat zones, intel-summary
   *  inventory (default — printed kneeboards shouldn't spoil the
   *  mission for training pilots). Drives the ThreatCard's
   *  `fidelity` prop. */
  threatFidelity: 'full' | 'operational' | 'realistic';
  /** When true, the threat card draws its map (rings in full /
   *  operational, fuzzy blobs in realistic). When false, the map
   *  is suppressed entirely — pilots see only the inventory /
   *  expected-resistance summary text and a "positions withheld"
   *  notice. Independent of fidelity so the user can pick
   *  "realistic + map" or "realistic + no map" without changing
   *  the inventory presentation. (v0.9.23) */
  threatMapVisible: boolean;
  /** Free-text mission notes the planner types in the Kneeboard tab.
   *  Rendered by the Notes card (when enabled). Persists in the
   *  settings object so it survives tab switches. (v0.9.69) */
  notesText: string;
  /** Optional heading shown at the top of the Notes card. Defaults
   *  to "MISSION NOTES" when blank. (v0.9.69) */
  notesTitle: string;
  /** Per-card planner notes, keyed by card type (lineup, flight,
   *  comms, fuelLadder, routeDetail, weatherBrief, threatCard,
   *  airbaseRef, radioLadder, bullseyeRef, supportAssets). The text
   *  for a key is rendered inside that card's existing NOTES box.
   *  Lets the planner write a different note per card type rather
   *  than only the standalone Notes card. (v0.9.70) */
  cardNotes: Record<string, string>;
  /** Selected weapon ids for the Weapon Reference card (see weaponData.ts).
   *  Empty = card produces nothing even when cards.weaponsRef is on. */
  weaponIds: string[];
  /** Popup-attack profiles defined for this mission (one card per profile
   *  when cards.popupAttack is on). Empty = card produces nothing. */
  popupAttacks: PopupAttackInput[];
  /** Kneeboard color scheme. 'night' = dark background (default,
   *  cockpit-at-night), 'day' = white background (daylight / printing).
   *  Drives the --kb-* CSS variables the cards resolve. (v0.9.74) */
  theme: 'night' | 'day';
}

interface EditState {
  edits: (WaypointEdit | UnitEdit)[];
  isDirty: boolean;
  injectKneeboards: boolean;
  /** When true, the download path empties the .miz's
   *  `["requiredModules"]` block so anyone can load the mission
   *  regardless of which DCS mods they have installed. Defaults
   *  to true — most squadron missions want to be playable by all
   *  members, and stripping is reversible (DCS-ME re-adds entries
   *  when the user opens the mission and re-saves). v0.9.32. */
  stripRequiredModules: boolean;
  kneeboardSettings: KneeboardSettings;
  addEdit: (edit: WaypointEdit | UnitEdit) => void;
  /** Remove a single queued edit by its index. Used by the Edits
   *  preview panel; existing tabs use addEdit/clearEdits and don't
   *  need to know about indices. */
  removeEditAt: (index: number) => void;
  clearEdits: () => void;
  setInjectKneeboards: (v: boolean) => void;
  setStripRequiredModules: (v: boolean) => void;
  setKneeboardSettings: (s: Partial<KneeboardSettings>) => void;
}

// localStorage-backed survival for popup-attack profiles (v1.17.8). Pilots
// who tune a profile for one mission usually want it next session too —
// without persistence the array resets every page-refresh / mission re-upload.
// Tucked OUTSIDE the store so the read happens once at module-init.
const POPUP_ATTACKS_LS_KEY = 'dcsopt.kneeboard.popupAttacks';
function loadPopupAttacks(): PopupAttackInput[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(POPUP_ATTACKS_LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PopupAttackInput[]) : [];
  } catch { return []; }
}
function savePopupAttacks(p: PopupAttackInput[]): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(POPUP_ATTACKS_LS_KEY, JSON.stringify(p)); }
  catch { /* quota / private mode — best effort */ }
}

export const useEditStore = create<EditState>((set) => ({
  edits: [],
  isDirty: false,
  injectKneeboards: false,
  stripRequiredModules: true,  // squadron-friendly default (v0.9.32)
  kneeboardSettings: {
    coordFormat: 'mgrs', speedRef: 'auto', machThreshold: 18000,
    // Default to 'realistic' fog-of-war so a fresh setup never
    // spoils a training mission. Mission designers / instructors
    // can switch to 'full' for their own debrief copy.
    threatFidelity: 'realistic',
    threatMapVisible: true,
    notesText: '',
    notesTitle: '',
    cardNotes: {},
    weaponIds: [],
    popupAttacks: loadPopupAttacks(),
    theme: 'night',
    cards: {
      lineup: true, flight: true, comms: true, routeDetail: true, fuelLadder: true, homePlate: true,
      supportAssets: true, radioLadder: true, airbaseRef: true, bullseyeRef: true, threatCard: true, weatherBrief: true,
      // Notes + weapon-reference + popup-attack cards default OFF — only emit
      // them when the planner has opted in (notes written / weapons picked /
      // profiles defined), so an empty card doesn't ride along every download.
      sopComms: true, goalsCard: true, dmpiCard: true, notesCard: false, weaponsRef: false, weaponsAuto: false, popupAttack: false,
    },
  },

  addEdit: (edit) =>
    set((s) => ({ edits: [...s.edits, edit], isDirty: true })),

  removeEditAt: (index) =>
    set((s) => {
      if (index < 0 || index >= s.edits.length) return s;
      const next = s.edits.slice(0, index).concat(s.edits.slice(index + 1));
      return { edits: next, isDirty: next.length > 0 };
    }),

  clearEdits: () => set({ edits: [], isDirty: false }),

  setInjectKneeboards: (v) => set({ injectKneeboards: v }),

  setStripRequiredModules: (v) => set({ stripRequiredModules: v }),

  setKneeboardSettings: (s) =>
    set((prev) => ({ kneeboardSettings: { ...prev.kneeboardSettings, ...s } })),
}));

// Mirror popup-attack profile changes into localStorage so they survive
// page reloads + mission re-uploads. Selector subscription (vs. a full
// subscribe) means we only write when the array reference actually
// changes — not on every unrelated edit-store mutation.
if (typeof window !== 'undefined') {
  useEditStore.subscribe((s, prev) => {
    if (s.kneeboardSettings.popupAttacks !== prev.kneeboardSettings.popupAttacks) {
      savePopupAttacks(s.kneeboardSettings.popupAttacks);
    }
  });
}
