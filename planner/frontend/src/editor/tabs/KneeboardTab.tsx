/**
 * Kneeboard tab — preview and download kneeboard cards.
 *
 * Shows a live preview of each card and a download button.
 * Cards are rendered to PNG via the HTML→Canvas pipeline.
 */

import { useState, useEffect, useMemo, createElement } from 'react';
import JSZip from 'jszip';
import { useMissionStore } from '../../store/missionStore';
import { useEffectiveGroups } from '../../store/effectiveGroups';
import { useEditStore, type KneeboardCards } from '../../store/editStore';
import { RouteCard, type KneeboardSpeedRef } from '../../kneeboard/RouteCard';
import { FlightCard } from '../../kneeboard/FlightCard';
import { StationLoadoutCard } from '../../kneeboard/StationLoadoutCard';
import { CamelotCard } from '../../kneeboard/CamelotCard';
import { ReconImageryCard } from '../../kneeboard/ReconImageryCard';
import { RouteProfileCard } from '../../kneeboard/RouteProfileCard';
import { sampleRoute, fetchRouteTerrain, type RouteSample } from '../../utils/routeProfile';
import { AirfieldDiagramCard, airfieldCardCount } from '../../kneeboard/AirfieldDiagramCard';
import { airfieldsForFlight } from '../../utils/airfieldSelect';
import { fetchFieldElevations } from '../../utils/fieldElevation';
import { CommsCard } from '../../kneeboard/CommsCard';
import { RouteDetailCard } from '../../kneeboard/RouteDetailCard';
import { StripMapCard, stripMapPageCount } from '../../kneeboard/StripMapCard';
import { RadioPresetCard } from '../../kneeboard/RadioPresetCard';
import { FuelLadderCard } from '../../kneeboard/FuelLadderCard';
import { getAircraftPerf, computeJokerBingo } from '../../kneeboard/fuelModel';
import { SupportAssetsCard, supportAssetsPageCount } from '../../kneeboard/SupportAssetsCard';
import { RadioLadderCard } from '../../kneeboard/RadioLadderCard';
import { buildRadioLadder, applyLadderOrder } from '../../kneeboard/radioLadder';
import { presetsForUnits } from '../../kneeboard/radioPresets';
import { RadioLadderOrderEditor } from './RadioLadderOrderEditor';
import { FlightLeadControls } from './FlightLeadControls';
import { AirbaseRefCard } from '../../kneeboard/AirbaseRefCard';
import { BullseyeRefCard } from '../../kneeboard/BullseyeRefCard';
import { ThreatCard, threatCardPageCount } from '../../kneeboard/ThreatCard';
import { WeatherBriefCard } from '../../kneeboard/WeatherBriefCard';
import { HomePlateCard } from '../../kneeboard/HomePlateCard';
import { SopCommsCard, sopCommsPageCount } from '../../kneeboard/SopCommsCard';
import { TransponderCard } from '../../kneeboard/TransponderCard';
import { DmpiCard } from '../../kneeboard/DmpiCard';
import { TargetImageryCard } from '../../kneeboard/TargetImageryCard';
import { NotesCard } from '../../kneeboard/NotesCard';
import { WeaponCard, weaponCardPageCount } from '../../kneeboard/WeaponCard';
import { WEAPONS, matchWeaponsToLoadout } from '../../kneeboard/weaponData';
import { PopupAttackCard } from '../../kneeboard/PopupAttackCard';
import type { PopupAttackInput } from '../../utils/popupAttack';
import { PopupAttackEditor } from './PopupAttackEditor';
import { renderCardToBlob, downloadBlob } from '../../kneeboard/renderCard';
import { kbThemeStyle, type KneeboardTheme } from '../../kneeboard/cardStyles';
import { KneeboardThemeCustomizer } from './KneeboardThemeCustomizer';
import { useSopStore } from '../../sop/sopStore';
import { useDmpiStore } from '../../store/dmpiStore';
import type { Weather } from '../../utils/atmosphere';
import { isPlayerGroup } from '../../utils/groups';
import { resolveOptions, NOTES_FRACTION, type KneeboardOptions } from '../../kneeboard/options';

const PER_FLIGHT_CARDS: { key: keyof KneeboardCards; label: string; desc: string }[] = [
  { key: 'lineup', label: 'Lineup Card', desc: 'Waypoints, coords, alt, speed, ETE' },
  { key: 'flight', label: 'Flight Card', desc: 'Callsigns, loadout, fuel, datalink' },
  { key: 'stationLoadout', label: 'Station Loadout', desc: 'Stores drawn on the airframe, one box per pylon, with laser codes' },
  { key: 'routeProfile', label: 'Route Profile', desc: 'Side view: terrain under the route, planned altitude, per-leg MSA' },
  { key: 'airfieldDiagram', label: 'Airfield Diagrams', desc: 'Generated plate per usable field: runway headings, ATC, elevation' },
  { key: 'camelot', label: 'Camelot Kneeboards', desc: 'Squadron-format flight card: crew/IFF/laser grid, comms, flight plan, tanker line' },
  { key: 'comms', label: 'Comms Card', desc: 'Radio presets, mission phase flow' },
  { key: 'routeDetail', label: 'Route Detail', desc: 'Map with route, threats, terrain' },
  { key: 'stripMap', label: 'Strip Map', desc: 'North-up route map with per-leg doghouse (MC / DIST / TIME / ALT)' },
  { key: 'radioPresets', label: 'Radio Presets', desc: 'Per-airframe preset button card from the SOP comm plan (skipped when the active SOP has no map for the airframe)' },
  { key: 'fuelLadder', label: 'Fuel Ladder', desc: 'Fuel burn per leg, joker/bingo' },
  { key: 'homePlate', label: 'Home Plate / Divert', desc: 'Departure field + nearest diverts' },
  { key: 'weaponsAuto', label: 'Weapon Cards (auto)', desc: "Auto-inject employment cards for each flight's actual loadout (matched from pylons)" },
];

const SHARED_CARDS: { key: keyof KneeboardCards; label: string; desc: string }[] = [
  { key: 'supportAssets', label: 'Support Assets', desc: 'Tankers, AWACS, frequencies' },
  { key: 'radioLadder', label: 'Radio Ladder', desc: 'Shared frequency reference' },
  { key: 'airbaseRef', label: 'Airbase Reference', desc: 'Airfield info, ILS, TACAN' },
  { key: 'bullseyeRef', label: 'Bullseye Reference', desc: 'Bullseye point and radials' },
  { key: 'threatCard', label: 'Threat Card', desc: 'Enemy air defenses map + inventory' },
  { key: 'weatherBrief', label: 'Weather Briefing', desc: 'Full weather summary card' },
  { key: 'sopComms', label: 'SOP Comms', desc: 'Callsigns, freqs, GUARD, laser base — needs active SOP' },
  { key: 'transponder', label: 'Transponder / IFF', desc: 'Per-flight Mode 1/2/3 squawk plan — needs an active SOP with a transponder plan' },
  { key: 'dmpiCard', label: 'DMPI List', desc: 'Designated targets with coords + weapon delivery' },
  { key: 'targetImagery', label: 'Target Imagery', desc: 'Overhead satellite picture of each DMPI, aim point marked' },
  { key: 'notesCard', label: 'Mission Notes', desc: 'Free-text planner notes — type below' },
  { key: 'weaponsRef', label: 'Weapon Reference', desc: 'Per-store employment, switchology, mistakes — pick stores below' },
  { key: 'popupAttack', label: 'Popup Attack Profiles', desc: 'Physics-based popup/lay-down side-profile cards — define profiles below' },
];

// Cards that have a NOTES box the planner can fill with typed notes.
// `perFlight` cards render once per player flight, so a note here shows
// on every flight's copy of that card. Order roughly follows the card
// list above. (v0.9.70)
const NOTE_CARDS: { key: keyof KneeboardCards; label: string; perFlight: boolean }[] = [
  { key: 'lineup', label: 'Route Card', perFlight: true },
  { key: 'flight', label: 'Flight Card', perFlight: true },
  { key: 'stationLoadout', label: 'Station Loadout', perFlight: true },
  { key: 'routeProfile', label: 'Route Profile', perFlight: true },
  { key: 'airfieldDiagram', label: 'Airfield Diagrams', perFlight: true },
  { key: 'camelot', label: 'Camelot Kneeboards', perFlight: true },
  { key: 'reconImagery', label: 'Recon Imagery', perFlight: false },
  { key: 'comms', label: 'Comms Card', perFlight: true },
  { key: 'routeDetail', label: 'Route Detail', perFlight: true },
  { key: 'stripMap', label: 'Strip Map', perFlight: true },
  { key: 'radioPresets', label: 'Radio Presets', perFlight: true },
  { key: 'fuelLadder', label: 'Fuel Ladder', perFlight: true },
  { key: 'supportAssets', label: 'Support Assets', perFlight: false },
  { key: 'radioLadder', label: 'Radio Ladder', perFlight: false },
  { key: 'airbaseRef', label: 'Airbase Reference', perFlight: false },
  { key: 'bullseyeRef', label: 'Bullseye Reference', perFlight: false },
  { key: 'threatCard', label: 'Threat Card', perFlight: false },
  { key: 'weatherBrief', label: 'Weather Briefing', perFlight: false },
];

export function KneeboardTab() {
  // v1.19.66 — kneeboards must match what'll be in the downloaded
  // .miz. Reading missionStore directly meant printed cards could
  // contradict the mission they ship inside (TACAN/ICLS/freq edits
  // staged elsewhere wouldn't render).
  const groups = useEffectiveGroups();
  const overview = useMissionStore((s) => s.overview);
  const clientUnits = useMissionStore((s) => s.clientUnits);
  const threats = useMissionStore((s) => s.threats);
  const airbases = useMissionStore((s) => s.airbases);
  const drawings = useMissionStore((s) => s.drawings);
  const theater = useMissionStore((s) => s.theater) || overview?.theater || '';
  const wx = overview?.weather as Weather | undefined;

  const injectKneeboards = useEditStore((s) => s.injectKneeboards);
  const setInjectKneeboards = useEditStore((s) => s.setInjectKneeboards);
  const kneeboardSettings = useEditStore((s) => s.kneeboardSettings);
  const setKneeboardSettings = useEditStore((s) => s.setKneeboardSettings);

  // Active SOP feeds the SOP Comms card. Read scalars only — React 19's
  // useSyncExternalStore rejects object-returning selectors as
  // infinite-loop hazards.
  const sops = useSopStore((s) => s.sops);
  const activeSopId = useSopStore((s) => s.activeId);
  const activeSop = useMemo(
    () => (activeSopId ? sops.find((s) => s.id === activeSopId) ?? null : null),
    [activeSopId, sops],
  );

  // DMPIs feed the DMPI card. (v1.19.110 — the Mission Goals card was removed
  // along with the Goals tab; goals were an SP-oriented objective list.)
  const dmpis = useDmpiStore((s) => s.dmpis);

  const coordFormat = kneeboardSettings.coordFormat;
  const speedRef = kneeboardSettings.speedRef as KneeboardSpeedRef;
  const machThreshold = kneeboardSettings.machThreshold;
  // Default 'full' for older settings objects that pre-date v0.9.6.
  const threatFidelity = kneeboardSettings.threatFidelity ?? 'full';
  // Default true for older settings objects that pre-date v0.9.23
  // — preserves the existing fog-of-war map render unless the
  // user explicitly turns it off.
  const threatMapVisible = kneeboardSettings.threatMapVisible !== false;
  // Free-text planner notes (v0.9.69). Default '' for settings objects
  // that pre-date the field.
  const notesText = kneeboardSettings.notesText ?? '';
  const notesTitle = kneeboardSettings.notesTitle ?? '';
  // Per-card notes map (v0.9.70) — keyed by card type. Each card's
  // NOTES box renders cardNotes[key] when set.
  const cardNotes = kneeboardSettings.cardNotes ?? {};
  // Per-flight Fuel Ladder overrides, keyed by group name (v1.19.108).
  const fuelOverrides = kneeboardSettings.fuelOverrides ?? {};
  // Planner's custom Radio Ladder rung order (v1.19.119).
  const radioLadderOrder = kneeboardSettings.radioLadderOrder ?? [];
  // Flight lead controls. Resolved once so every card sees the same numbers
  // and a stored blob missing a newer option still loads. (v1.19.126)
  const opts = resolveOptions(kneeboardSettings.options);
  const cardsPerFlight = kneeboardSettings.cardsPerFlight ?? {};
  const camelotOverrides = kneeboardSettings.camelotOverrides ?? {};
  const reconGroupIds = kneeboardSettings.reconGroupIds ?? [];
  // Notes box height rides the theme-variable channel, so one value on the
  // capture container resizes every notes box on every card at once.
  const themeVars = {
    ...(kneeboardSettings.customThemeVars ?? {}),
    '--kb-notes-max-h': `${Math.round(850 * NOTES_FRACTION[opts.layout.notesSize])}px`,
  };
  /** The card set for one flight — the global set unless that flight has
   *  overrides. A tanker does not need a popup attack card. */
  const cardsFor = (groupName: string): KneeboardCards =>
    ({ ...cards, ...(cardsPerFlight[groupName] ?? {}) });
  // Per-flight Flight Card "Flight Data" overrides (TACAN/ICLS/IFF), keyed by
  // group name (v1.19.109).
  const flightDataOverrides = kneeboardSettings.flightDataOverrides ?? {};
  const weaponIds = kneeboardSettings.weaponIds ?? [];
  const popupAttacks = kneeboardSettings.popupAttacks ?? [];
  // Day/night color scheme (v0.9.74). Default 'night' for settings
  // objects that pre-date the field.
  const theme: KneeboardTheme = kneeboardSettings.theme ?? 'night';
  // User-supplied CSS-variable overrides when theme === 'custom'.
  // Forwarded to every kbThemeStyle / applyKbTheme call so the live
  // preview + the PNG render see the same colours. (v1.19.37)
  const customThemeVars = kneeboardSettings.customThemeVars;

  const playerGroups = groups.filter(isPlayerGroup);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(
    playerGroups[0]?.groupId ?? null,
  );
  const [rendering, setRendering] = useState(false);

  // Rebuild stamp — milliseconds since epoch, bumped when the user
  // hits the Rebuild button. Cards already re-render on state change
  // via their own useMemo deps, but cross-tab edits (e.g. a SOP
  // tweak in the SOP tab while the kneeboard tab is mounted) can
  // make the user uncertain whether the carousel is current. The
  // timestamp + key bump gives them a visible "yes, fresh" cue
  // without forcing them to reload the page.
  const [rebuildAt, setRebuildAt] = useState(() => Date.now());

  // Auto-select first player group when groups load
  useEffect(() => {
    if (selectedGroupId === null && playerGroups.length > 0) {
      setSelectedGroupId(playerGroups[0].groupId);
    }
  }, [playerGroups, selectedGroupId]);

  const selectedGroup = groups.find((g) => g.groupId === selectedGroupId);

  // Preview is now rendered directly in the DOM (no canvas pipeline needed)

  const cards = kneeboardSettings.cards;

  const coalition = playerGroups[0]?.coalition || 'blue';

  /** Render all enabled card PNGs for a single group. Returns name+blob pairs. */
  /** Sort rendered card files into the planner's deck order. The filename
   *  carries the card type after the flight name, which is what the order
   *  keys on. Unlisted types keep their derived position at the end. */
  const inDeckOrder = (files: { name: string; blob: Blob }[]) => {
    const order = opts.layout.cardOrder;
    if (order.length === 0) return files;
    const rank = (n: string) => {
      const i = order.findIndex((k) => n.toLowerCase().includes(k.toLowerCase()));
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    return [...files].sort((a, b) => rank(a.name) - rank(b.name));
  };

  const renderGroupCards = async (g: typeof selectedGroup): Promise<{ name: string; blob: Blob }[]> => {
    if (!g) return [];
    const results: { name: string; blob: Blob }[] = [];
    const safeName = g.groupName.replace(/\s+/g, '_');
    // Per-flight card overrides sit on top of the global set, so a tanker can
    // drop the popup card without changing what the strikers get. (v1.19.126)
    const cards = cardsFor(g.groupName);

    if (cards.lineup) {
      const el = createElement(RouteCard, { group: g, weather: wx, coordFormat, speedRef, machThreshold, overview: overview || undefined, notes: cardNotes.lineup });
      results.push({ name: `${safeName}_Route.png`, blob: await renderCardToBlob(el, theme, themeVars) });
    }
    if (cards.flight) {
      const el = createElement(FlightCard, { opts, group: g, clientUnits, laserCodeBase: activeSop?.laserCodeBase, overview: overview || undefined, notes: cardNotes.flight, fuelOverride: fuelOverrides[g.groupName], flightDataOverride: flightDataOverrides[g.groupName] });
      results.push({ name: `${safeName}_Flight.png`, blob: await renderCardToBlob(el, theme, themeVars) });
    }
    if (cards.stationLoadout) {
      const el = createElement(StationLoadoutCard, { opts,
        group: g, clientUnits, overview: overview || undefined,
        laserCodeBase: activeSop?.laserCodeBase, notes: cardNotes.stationLoadout,
      });
      results.push({ name: `${safeName}_Stations.png`, blob: await renderCardToBlob(el, theme, themeVars) });
    }
    if (cards.routeProfile) {
      // Terrain has to be in hand before the card is rasterised — html2canvas
      // captures whatever is on screen at that instant, so an in-flight fetch
      // would export an empty profile.
      const samples = await fetchRouteTerrain(sampleRoute(g.waypoints));
      const el = createElement(RouteProfileCard, { opts,
        group: g, samples, overview: overview || undefined, notes: cardNotes.routeProfile,
      });
      results.push({ name: `${safeName}_Profile.png`, blob: await renderCardToBlob(el, theme, themeVars) });
    }
    if (cards.camelot) {
      const el = createElement(CamelotCard, {
        group: g, clientUnits, allGroups: groups, airbases,
        overview: overview || undefined,
        overrides: camelotOverrides[g.groupName],
        laserCodeBase: activeSop?.laserCodeBase,
        flightDataOverride: flightDataOverrides[g.groupName],
        notes: cardNotes.camelot,
      });
      results.push({ name: `${safeName}_Camelot.png`, blob: await renderCardToBlob(el, theme, customThemeVars) });
    }
    if (cards.airfieldDiagram) {
      const fields = airfieldsForFlight(g, airbases, coalition, opts.diverts.count, opts.diverts.enemyFields);
      // One elevation request for all the fields rather than one each.
      const elevs = await fetchFieldElevations(fields);
      const pages = airfieldCardCount(fields.length);
      for (let pg = 0; pg < pages; pg++) {
        const el = createElement(AirfieldDiagramCard, { opts,
          airbases: fields, elevationFt: elevs, coalition, page: pg,
          overview: overview || undefined, coordFormat, notes: cardNotes.airfieldDiagram,
        });
        results.push({
          name: pages > 1 ? `${safeName}_Fields_${pg + 1}.png` : `${safeName}_Fields.png`,
          blob: await renderCardToBlob(el, theme, themeVars),
        });
      }
    }
    if (cards.comms) {
      const el = createElement(CommsCard, { group: g, allGroups: groups, overview: overview || undefined, notes: cardNotes.comms, airbases, sopComms: activeSop?.comms });
      results.push({ name: `${safeName}_Comms.png`, blob: await renderCardToBlob(el, theme, themeVars) });
    }
    if (cards.routeDetail) {
      const el = createElement(RouteDetailCard, { group: g, threats, overview: overview || undefined, notes: cardNotes.routeDetail, coordFormat, drawings });
      results.push({ name: `${safeName}_RouteDetail.png`, blob: await renderCardToBlob(el, theme, themeVars) });
    }
    if (cards.stripMap) {
      const sheets = stripMapPageCount(g, opts.nav.waypointsPerStripPage);
      for (let sp = 0; sp < sheets; sp++) {
        const el = createElement(StripMapCard, { opts,
          group: g, overview: overview || undefined, notes: cardNotes.stripMap,
          page: sp, threats, airbases, clientUnits,
          fuelOverride: fuelOverrides[g.groupName],
        });
        results.push({
          name: sheets > 1 ? `${g.groupName}_StripMap_${sp + 1}.png` : `${g.groupName}_StripMap.png`,
          blob: await renderCardToBlob(el, theme, themeVars),
        });
      }
    }
    {
      // v1.19.77 — radio preset card from the SOP comm plan (per
      // airframe; skipped when the plan has no map for this type).
      const acType = g.units[0]?.type || '';
      if (cards.radioPresets && activeSop?.commPlan?.maps.some((m) => m.aircraft === acType)) {
        const el = createElement(RadioPresetCard, { aircraft: acType, plan: activeSop.commPlan, overview: overview || undefined });
        results.push({ name: `RadioPresets_${acType}.png`, blob: await renderCardToBlob(el, theme, themeVars) });
      }
    }
    if (cards.fuelLadder) {
      const el = createElement(FuelLadderCard, { opts, group: g, clientUnits, overview: overview || undefined, notes: cardNotes.fuelLadder, fuelOverride: fuelOverrides[g.groupName] });
      results.push({ name: `${safeName}_Fuel.png`, blob: await renderCardToBlob(el, theme, themeVars) });
    }
    if (cards.homePlate) {
      const el = createElement(HomePlateCard, { opts, group: g, airbases, allGroups: groups, overview: overview || undefined, coordFormat });
      results.push({ name: `${safeName}_HomePlate.png`, blob: await renderCardToBlob(el, theme, themeVars) });
    }
    if (cards.weaponsAuto) {
      // Auto-inject one weapon-employment card per matched store from this
      // flight's actual pylons (see weaponData.matches). Pylons live on the
      // ClientUnit shape, so match the lead MissionUnit by unitId.
      const leadId = g.units[0]?.unitId;
      const lead = clientUnits.find((c) => c.unitId === leadId);
      const pylonNames = (lead?.pylons || []).map((p) => p.name || '');
      const ids = matchWeaponsToLoadout(pylonNames);
      for (const id of ids) {
        const el = createElement(WeaponCard, { weaponIds: [id], page: 0, overview: overview || undefined });
        results.push({ name: `${safeName}_W_${id}.png`, blob: await renderCardToBlob(el, theme, themeVars) });
      }
    }
    return inDeckOrder(results);
  };

  /** Render enabled shared cards. */
  const renderSharedCards = async (): Promise<{ name: string; blob: Blob }[]> => {
    const results: { name: string; blob: Blob }[] = [];
    if (cards.supportAssets) {
      const pageCount = supportAssetsPageCount({ groups, coalition });
      for (let p = 0; p < pageCount; p++) {
        const fname = pageCount === 1 ? 'Support_Assets.png' : `Support_Assets_${p + 1}.png`;
        const el = createElement(SupportAssetsCard, { opts, presets: presetsForUnits(clientUnits), groups, coalition, overview: overview || undefined, page: p, notes: cardNotes.supportAssets });
        results.push({ name: fname, blob: await renderCardToBlob(el, theme, themeVars) });
      }
    }
    if (cards.radioLadder) {
      const el = createElement(RadioLadderCard, { opts, groups, coalition, group: selectedGroup, airbases, sopComms: activeSop?.comms, presets: presetsForUnits(clientUnits), order: radioLadderOrder, overview: overview || undefined, notes: cardNotes.radioLadder });
      results.push({ name: 'Radio_Ladder.png', blob: await renderCardToBlob(el, theme, themeVars) });
    }
    if (cards.airbaseRef) {
      // Pass groups + coalition so the route-relevance filter fires.
      // Without them the card falls back to listing all theater
      // airfields — Kola has 71, Sinai has 51, way too many to be
      // useful as a kneeboard reference.
      const el = createElement(AirbaseRefCard, { opts,
        airbases, theater, overview: overview || undefined, groups, coalition,
        notes: cardNotes.airbaseRef, coordFormat,
      });
      results.push({ name: 'Airbase_Ref.png', blob: await renderCardToBlob(el, theme, themeVars) });
    }
    if (cards.bullseyeRef && overview) {
      const el = createElement(BullseyeRefCard, { overview, airbases, groups, threats, coalition, notes: cardNotes.bullseyeRef, coordFormat });
      results.push({ name: 'Bullseye_Ref.png', blob: await renderCardToBlob(el, theme, themeVars) });
    }
    if (cards.threatCard) {
      const pageCount = threatCardPageCount({ threats, playerCoalition: coalition, opts });
      for (let p = 0; p < pageCount; p++) {
        const fname = pageCount === 1 ? 'Threat_Card.png' : `Threat_Card_${p + 1}.png`;
        const el = createElement(ThreatCard, { opts, threats, playerCoalition: coalition, overview: overview || undefined, page: p, fidelity: threatFidelity, mapVisible: threatMapVisible, notes: cardNotes.threatCard, coordFormat });
        results.push({ name: fname, blob: await renderCardToBlob(el, theme, themeVars) });
      }
    }
    if (cards.weatherBrief && overview) {
      const el = createElement(WeatherBriefCard, { opts, overview, notes: cardNotes.weatherBrief });
      results.push({ name: 'Weather_Brief.png', blob: await renderCardToBlob(el, theme, themeVars) });
    }
    // SOP Comms card — only generated if a SOP is currently active.
    // No-op when the user has the toggle on but no SOP loaded; we don't
    // want to silently fail or emit a blank card. The carousel shows a
    // hint in that case so it's discoverable.
    if (cards.reconImagery) {
      for (const gid of reconGroupIds) {
        const rg = groups.find((g) => g.groupId === gid);
        if (!rg) continue;
        const el = createElement(ReconImageryCard, {
          group: rg, overview: overview || undefined, coordFormat,
          notes: cardNotes.reconImagery,
        });
        const safe = rg.groupName.replace(/[^A-Za-z0-9]+/g, '_');
        results.push({ name: `Recon_${safe}.png`, blob: await renderCardToBlob(el, theme, customThemeVars) });
      }
    }
    if (cards.sopComms && activeSop) {
      // One card per source comm sheet when the SOP carries them.
      const pages = sopCommsPageCount(activeSop);
      for (let p = 0; p < pages; p++) {
        const el = createElement(SopCommsCard, { sop: activeSop, overview: overview || undefined, page: p });
        results.push({
          name: pages > 1 ? `SOP_Comms_${p + 1}.png` : 'SOP_Comms.png',
          blob: await renderCardToBlob(el, theme, themeVars),
        });
      }
    }
    // Transponder card — only when the active SOP carries a transponder plan.
    if (cards.transponder && activeSop?.transponder?.assignments?.length) {
      const el = createElement(TransponderCard, { transponder: activeSop.transponder, squadron: activeSop.squadron, overview: overview || undefined });
      results.push({ name: 'Transponder.png', blob: await renderCardToBlob(el, theme, themeVars) });
    }
    if (cards.dmpiCard) {
      const el = createElement(DmpiCard, {
        dmpis,
        squadron: activeSop?.squadron,
        overview: overview || undefined,
        coordFormat,
      });
      results.push({ name: 'DMPI_List.png', blob: await renderCardToBlob(el, theme, themeVars) });
    }
    if (cards.targetImagery && dmpis.length > 0) {
      const valid = dmpis.filter((d) => d.name.trim() && (d.lat !== 0 || d.lon !== 0));
      for (let i = 0; i < valid.length; i++) {
        const el = createElement(TargetImageryCard, { opts,
          dmpi: valid[i], index: i + 1, total: valid.length,
          overview: overview || undefined, coordFormat,
          squadron: activeSop?.squadron, groups,
        });
        const safe = (valid[i].name || `Target_${i + 1}`).replace(/\s+/g, '_');
        results.push({ name: `Target_${i + 1}_${safe}.png`, blob: await renderCardToBlob(el, theme, themeVars) });
      }
    }
    if (cards.notesCard) {
      const el = createElement(NotesCard, {
        text: notesText,
        title: notesTitle,
        squadron: activeSop?.squadron,
        overview: overview || undefined,
      });
      results.push({ name: 'Mission_Notes.png', blob: await renderCardToBlob(el, theme, themeVars) });
    }
    if (cards.weaponsRef && weaponIds.length > 0) {
      const pageCount = weaponCardPageCount(weaponIds);
      for (let p = 0; p < pageCount; p++) {
        const el = createElement(WeaponCard, { weaponIds, page: p, overview: overview || undefined });
        results.push({ name: `Weapon_${p + 1}.png`, blob: await renderCardToBlob(el, theme, themeVars) });
      }
    }
    if (cards.popupAttack && popupAttacks.length > 0) {
      const total = popupAttacks.length;
      for (let i = 0; i < total; i++) {
        const el = createElement(PopupAttackCard, { input: popupAttacks[i], overview: overview || undefined, index: i + 1, total });
        const safe = (popupAttacks[i].name || `Attack_${i + 1}`).replace(/\s+/g, '_');
        results.push({ name: `Popup_${i + 1}_${safe}.png`, blob: await renderCardToBlob(el, theme, themeVars) });
      }
    }
    return inDeckOrder(results);
  };

  const enabledPerFlightCount = PER_FLIGHT_CARDS.filter((c) => cards[c.key]).length;
  const enabledSharedCount = SHARED_CARDS.filter((c) => cards[c.key]).length;
  const noCardsSelected = enabledPerFlightCount === 0 && enabledSharedCount === 0;

  const handleDownloadOne = async () => {
    if (!selectedGroup) return;
    if (noCardsSelected) { alert('No card types selected'); return; }
    setRendering(true);
    try {
      const zip = new JSZip();
      const safeName = selectedGroup.groupName.replace(/\s+/g, '_');
      const folder = zip.folder(safeName)!;

      const rendered = await renderGroupCards(selectedGroup);
      for (const r of rendered) folder.file(r.name, r.blob);

      // Include shared cards too
      const shared = await renderSharedCards();
      if (shared.length > 0) {
        const sharedFolder = zip.folder('Shared')!;
        for (const r of shared) sharedFolder.file(r.name, r.blob);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(zipBlob, `${safeName}_Kneeboards.zip`);
    } catch (e) {
      console.error('Download failed:', e);
      alert('PNG export failed — check browser console for details.');
    }
    setRendering(false);
  };

  const handleDownloadAll = async () => {
    if (noCardsSelected) { alert('No card types selected'); return; }
    setRendering(true);
    try {
      const zip = new JSZip();

      // Per-flight cards in subfolders
      for (const g of playerGroups) {
        const safeName = g.groupName.replace(/\s+/g, '_');
        const folder = zip.folder(safeName)!;
        const rendered = await renderGroupCards(g);
        for (const r of rendered) folder.file(r.name, r.blob);
      }

      // Shared cards
      const shared = await renderSharedCards();
      if (shared.length > 0) {
        const sharedFolder = zip.folder('Shared')!;
        for (const r of shared) sharedFolder.file(r.name, r.blob);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(zipBlob, 'Kneeboards.zip');
    } catch (e) {
      console.error('Batch download failed:', e);
    }
    setRendering(false);
  };

  const selectStyle: React.CSSProperties = {
    background: '#262626',
    border: '1px solid #3a3a3a',
    borderRadius: 4,
    color: '#e0e0e0',
    fontSize: 13,
    padding: '4px 8px',
  };

  const btnStyle: React.CSSProperties = {
    background: '#333333',
    border: '1px solid #4a4a4a',
    borderRadius: 4,
    color: '#e0e0e0',
    padding: '6px 14px',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
  };

  return (
    <div style={{ maxWidth: 1500 }}>
      <h2 style={{ color: '#e0e0e0', fontSize: 18, margin: '0 0 16px', fontWeight: 600 }}>
        Kneeboards
      </h2>

      {/* v1.19.111 — two columns: settings on the left, a STICKY live-preview
          column on the right so card edits are visible without scrolling down. */}
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13, color: '#aaaaaa' }}>
          Flight:
          <select
            value={selectedGroupId ?? ''}
            onChange={(e) => setSelectedGroupId(Number(e.target.value) || null)}
            style={{ ...selectStyle, marginLeft: 6 }}
          >
            {playerGroups.map((g) => (
              <option key={g.groupId} value={g.groupId}>{g.groupName}</option>
            ))}
          </select>
        </label>

        <label style={{ fontSize: 13, color: '#aaaaaa' }}>
          Coords:
          <select
            value={coordFormat}
            onChange={(e) => setKneeboardSettings({ coordFormat: e.target.value as 'mgrs' | 'latlon' })}
            style={{ ...selectStyle, marginLeft: 6 }}
          >
            <option value="mgrs">MGRS</option>
            <option value="latlon">Lat/Lon</option>
          </select>
        </label>

        <label style={{ fontSize: 13, color: '#aaaaaa' }}>
          Speed:
          <select
            value={speedRef}
            onChange={(e) => setKneeboardSettings({ speedRef: e.target.value as KneeboardSpeedRef })}
            style={{ ...selectStyle, marginLeft: 6 }}
          >
            <option value="auto">Auto (CAS/Mach)</option>
            <option value="cas">CAS</option>
            <option value="tas">TAS</option>
            <option value="gs">GS</option>
            <option value="mach">Mach</option>
          </select>
        </label>

        {speedRef === 'auto' && (
          <label style={{ fontSize: 13, color: '#aaaaaa' }}>
            Mach above:
            <select
              value={machThreshold}
              onChange={(e) => setKneeboardSettings({ machThreshold: Number(e.target.value) })}
              style={{ ...selectStyle, marginLeft: 6 }}
            >
              <option value={10000}>FL100</option>
              <option value={15000}>FL150</option>
              <option value={18000}>FL180</option>
              <option value={20000}>FL200</option>
              <option value={25000}>FL250</option>
              <option value={30000}>FL300</option>
            </select>
          </label>
        )}

        <label
          style={{ fontSize: 13, color: '#aaaaaa' }}
          title="How much info the threat card reveals. Realistic = vague threat zones, no specific systems (training default)."
        >
          Threat fidelity:
          <select
            value={threatFidelity}
            onChange={(e) => setKneeboardSettings({
              threatFidelity: e.target.value as 'full' | 'operational' | 'realistic',
            })}
            style={{
              ...selectStyle,
              marginLeft: 6,
              // Tint the dropdown red when the user has chosen a
              // revealing fidelity, so they're reminded that the
              // kneeboards they're about to print will spoil the
              // threat picture for pilots. Realistic stays neutral.
              color: threatFidelity === 'full' ? '#d95050'
                : threatFidelity === 'operational' ? '#d29922'
                : '#3fb950',
              borderColor: threatFidelity === 'full' ? '#5a2a2a'
                : threatFidelity === 'operational' ? '#5a4a2a'
                : '#3a3a3a',
            }}
          >
            <option value="realistic">Realistic — vague zones (default)</option>
            <option value="operational">Operational — rings, no IDs</option>
            <option value="full">Full — everything (DEBRIEF ONLY)</option>
          </select>
        </label>

        {/* Map-visible tickbox — independent of fidelity. When off,
            the threat card replaces its map portion with a
            "Threat positions withheld" placeholder; the inventory
            text below it still renders. Lets the user pick "show
            inventory but no positions on the map at all" — useful
            when even the realistic blobs are too revealing. */}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            color: '#aaaaaa',
            cursor: 'pointer',
            userSelect: 'none',
          }}
          title="When off, the threat card hides the map entirely. The inventory / expected-resistance text still shows."
        >
          <input
            type="checkbox"
            checked={threatMapVisible}
            onChange={(e) => setKneeboardSettings({ threatMapVisible: e.target.checked })}
            style={{ accentColor: '#4a8fd4' }}
          />
          Show threats on map
        </label>

        {/* Day / Night color scheme. Unchecked = night (dark, default);
            checked = day (white background, for printing / daylight). */}
        <label
          style={{
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 13,
            color: '#aaaaaa', cursor: 'pointer', userSelect: 'none',
          }}
          title="White background for the kneeboards (daylight / printing). Off = dark night background."
        >
          <input
            type="checkbox"
            checked={theme === 'day'}
            onChange={(e) => setKneeboardSettings({ theme: e.target.checked ? 'day' : 'night' })}
            style={{ accentColor: '#4a8fd4' }}
          />
          Day mode (white)
        </label>

        <button onClick={handleDownloadOne} disabled={!selectedGroup || rendering || noCardsSelected} style={btnStyle}>
          {rendering ? 'Rendering...' : 'Download .zip'}
        </button>

        <button
          onClick={handleDownloadAll}
          disabled={rendering || playerGroups.length === 0 || noCardsSelected}
          style={{ ...btnStyle, background: '#1a3a2a' }}
        >
          Download All .zip
        </button>
      </div>

      {/* Theme customizer — pick colors / font / accent for the
          kneeboards, save named themes, share via .json. (v1.19.37) */}
      <KneeboardThemeCustomizer />

      {/* Card Selection */}
      <div style={{
        marginBottom: 16, padding: '10px 14px', background: '#1a1a1a', borderRadius: 6,
        border: '1px solid #3a3a3a',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#e0e0e0' }}>Card Types</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => {
                const all: Partial<KneeboardCards> = {};
                [...PER_FLIGHT_CARDS, ...SHARED_CARDS].forEach((c) => { all[c.key] = true; });
                setKneeboardSettings({ cards: { ...kneeboardSettings.cards, ...all } });
              }}
              style={{ ...btnStyle, padding: '2px 8px', fontSize: 11 }}
            >All</button>
            <button
              onClick={() => {
                const none: Partial<KneeboardCards> = {};
                [...PER_FLIGHT_CARDS, ...SHARED_CARDS].forEach((c) => { none[c.key] = false; });
                setKneeboardSettings({ cards: { ...kneeboardSettings.cards, ...none } });
              }}
              style={{ ...btnStyle, padding: '2px 8px', fontSize: 11 }}
            >None</button>
          </div>
        </div>

        <div style={{ fontSize: 11, color: '#5a8a6a', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
          Per-Flight ({playerGroups.length} flight{playerGroups.length !== 1 ? 's' : ''})
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '6px 24px', marginBottom: 12 }}>
          {PER_FLIGHT_CARDS.map((card) => (
            <label key={card.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#e0e0e0', cursor: 'pointer', padding: '3px 0' }}>
              <input
                type="checkbox"
                checked={kneeboardSettings.cards[card.key]}
                onChange={(e) => setKneeboardSettings({ cards: { ...kneeboardSettings.cards, [card.key]: e.target.checked } })}
                style={{ accentColor: '#4a8fd4', flexShrink: 0 }}
              />
              <span style={{ whiteSpace: 'nowrap' }}>{card.label}</span>
              <span style={{ fontSize: 11, color: '#555555' }}>{card.desc}</span>
            </label>
          ))}
        </div>

        <div style={{ fontSize: 11, color: '#5a8a6a', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
          Shared (Mission-wide)
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '6px 24px', marginBottom: 10 }}>
          {SHARED_CARDS.map((card) => (
            <label key={card.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#e0e0e0', cursor: 'pointer', padding: '3px 0' }}>
              <input
                type="checkbox"
                checked={kneeboardSettings.cards[card.key]}
                onChange={(e) => setKneeboardSettings({ cards: { ...kneeboardSettings.cards, [card.key]: e.target.checked } })}
                style={{ accentColor: '#4a8fd4', flexShrink: 0 }}
              />
              <span style={{ whiteSpace: 'nowrap' }}>{card.label}</span>
              <span style={{ fontSize: 11, color: '#555555' }}>{card.desc}</span>
            </label>
          ))}
        </div>

        {/* Inject toggle */}
        <div style={{ borderTop: '1px solid #3a3a3a', paddingTop: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#e0e0e0', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={injectKneeboards}
              onChange={(e) => setInjectKneeboards(e.target.checked)}
              style={{ accentColor: '#4a8fd4' }}
            />
            Inject selected cards into .miz on download
          </label>
        </div>
      </div>

      {/* Per-card notes — fill the NOTES box on existing cards. Only
          shows inputs for cards that are currently enabled, so the
          panel tracks the Card Types selection above. Each note prints
          inside that card's NOTES box (replacing the blank ruled
          space). Per-flight cards show the same note on every flight's
          copy. (v0.9.70) */}
      <div style={{
        marginBottom: 16, padding: '10px 14px', background: '#1a1a1a', borderRadius: 6,
        border: '1px solid #3a3a3a',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#e0e0e0' }}>Notes on Cards</span>
          <span style={{ fontSize: 11, color: '#666' }}>
            Fills the NOTES box on each enabled card
          </span>
        </div>

        {(() => {
          const enabled = NOTE_CARDS.filter((c) => cards[c.key]);
          if (enabled.length === 0) {
            return (
              <div style={{ fontSize: 12, color: '#888', fontStyle: 'italic', padding: '6px 0' }}>
                No note-capable cards are enabled. Tick cards in Card Types above
                (Route, Flight, Comms, Threat, etc.) to add notes to them.
              </div>
            );
          }
          return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {enabled.map((c) => (
                <label key={c.key} style={{ display: 'block', fontSize: 11, color: '#aaaaaa' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span style={{ color: '#cccccc', fontWeight: 600 }}>{c.label}</span>
                    {c.perFlight && (
                      <span
                        title="This card is rendered once per flight — the note shows on every flight's copy."
                        style={{ fontSize: 9, color: '#5a8a6a', border: '1px solid #2a4a3a', borderRadius: 3, padding: '0 4px' }}
                      >
                        per-flight
                      </span>
                    )}
                  </span>
                  <textarea
                    value={cardNotes[c.key] ?? ''}
                    onChange={(e) => setKneeboardSettings({
                      cardNotes: { ...cardNotes, [c.key]: e.target.value },
                    })}
                    placeholder={`Notes for the ${c.label}…`}
                    rows={3}
                    style={{
                      width: '100%', background: '#262626', border: '1px solid #3a3a3a', borderRadius: 4,
                      color: '#e0e0e0', fontSize: 12, padding: '6px 8px', fontFamily: 'inherit',
                      lineHeight: 1.4, resize: 'vertical',
                    }}
                  />
                </label>
              ))}
            </div>
          );
        })()}
      </div>

      {/* Per-flight card overrides. The global set above is the default; a
          flight only stores the keys it disagrees with, so adding a new card
          type later still reaches every flight. (v1.19.126) */}
      {selectedGroup && isPlayerGroup(selectedGroup) && (() => {
        const gName = selectedGroup.groupName;
        const ovr = cardsPerFlight[gName] ?? {};
        const overridden = Object.keys(ovr).length;
        const setCard = (key: keyof KneeboardCards, on: boolean) => {
          const next = { ...ovr };
          // Matching the global set means there is nothing to override.
          if (cards[key] === on) delete next[key];
          else next[key] = on;
          const map = { ...cardsPerFlight };
          if (Object.keys(next).length === 0) delete map[gName];
          else map[gName] = next;
          setKneeboardSettings({ cardsPerFlight: map });
        };
        const effective = cardsFor(gName);
        return (
          <div style={{ border: '1px solid #333333', borderRadius: 4, padding: '8px 10px', marginTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#cccccc' }}>
                Cards for {gName}
              </span>
              <span style={{ fontSize: 11, color: '#888888', flex: 1 }}>
                {overridden ? `${overridden} differ from the default set` : 'using the default set'}
              </span>
              {overridden > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const map = { ...cardsPerFlight };
                    delete map[gName];
                    setKneeboardSettings({ cardsPerFlight: map });
                  }}
                  style={{
                    fontSize: 10, cursor: 'pointer', padding: '1px 6px',
                    background: 'transparent', color: '#7aa7ff',
                    border: '1px solid #3a3a3a', borderRadius: 2,
                  }}
                >
                  reset
                </button>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '2px 10px' }}>
              {PER_FLIGHT_CARDS.map((c) => {
                const on = effective[c.key] ?? false;
                const differs = c.key in ovr;
                return (
                  <label key={c.key} style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    fontSize: 11.5, color: differs ? '#e0b566' : '#cccccc', cursor: 'pointer',
                  }}>
                    <input type="checkbox" checked={on}
                           onChange={(e) => setCard(c.key, e.target.checked)} />
                    {c.label}
                  </label>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Camelot card fields the mission cannot answer — event name, MIDS,
          push time, IFF bases. Per flight. (v1.19.132) */}
      {cards.camelot && selectedGroup && isPlayerGroup(selectedGroup) && (() => {
        const gName = selectedGroup.groupName;
        const ovr = camelotOverrides[gName] ?? {};
        const setField = (key: string, val: string) => {
          const next = { ...ovr, [key]: val || undefined };
          const map = { ...camelotOverrides, [gName]: next };
          if (Object.values(next).every((v) => !v)) delete map[gName];
          setKneeboardSettings({ camelotOverrides: map });
        };
        const field = (label: string, key: keyof typeof ovr, width = 90, hint = '') => (
          <label style={{ display: 'block', fontSize: 11, color: '#aaaaaa' }}>
            <span style={{ display: 'block', color: '#cccccc', fontWeight: 600, marginBottom: 3 }}>{label}</span>
            <input
              type="text" value={ovr[key] ?? ''} placeholder={hint}
              onChange={(e) => setField(key, e.target.value)}
              style={{ width, background: '#262626', border: '1px solid #3a3a3a',
                       borderRadius: 3, color: '#e0e0e0', fontSize: 12, padding: '4px 6px' }}
            />
          </label>
        );
        return (
          <div style={{ border: '1px solid #333333', borderRadius: 4, padding: '8px 10px', marginTop: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#cccccc', marginBottom: 6 }}>
              Camelot card — {gName}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {field('Event', 'event', 110, 'OREX98')}
              {field('MIDS A', 'midsA', 54, '30')}
              {field('MIDS B', 'midsB', 54, '31')}
              {field('Push', 'push', 64, '9.53')}
              {field('M1', 'm1', 48, '21')}
              {field('M3 base', 'm3Base', 64, '3211')}
            </div>
            <div style={{ fontSize: 10, color: '#888888', marginTop: 5 }}>
              M3 counts up per crew row. Laser, presets, flight plan, home field and the
              tanker line fill from the mission; blank cells stay blank for handwriting.
            </div>
          </div>
        );
      })()}

      {/* Recon imagery group picker — one monochrome print per picked group,
          targets numbered. (v1.19.132) */}
      {cards.reconImagery && (() => {
        const candidates = groups
          .filter((g) => (g.units ?? []).some((u) => u.lat != null))
          .filter((g) => g.category !== 'static')
          .sort((a, b) => (a.coalition === b.coalition ? a.groupName.localeCompare(b.groupName)
            : a.coalition === 'red' ? -1 : 1));
        const togglePick = (gid: number, on: boolean) => {
          const next = on ? [...reconGroupIds, gid] : reconGroupIds.filter((x) => x !== gid);
          setKneeboardSettings({ reconGroupIds: next });
        };
        return (
          <div style={{ border: '1px solid #333333', borderRadius: 4, padding: '8px 10px', marginTop: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#cccccc', marginBottom: 2 }}>
              Recon imagery — pick target groups
            </div>
            <div style={{ fontSize: 10, color: '#888888', marginBottom: 6 }}>
              One print per group: monochrome satellite of the mission coordinates,
              every unit numbered with a coordinate table. Red groups listed first.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
                          gap: '2px 10px', maxHeight: 180, overflowY: 'auto' }}>
              {candidates.map((g) => (
                <label key={g.groupId} style={{
                  display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5,
                  color: g.coalition === 'red' ? '#e08a8a' : '#cccccc', cursor: 'pointer',
                }}>
                  <input type="checkbox" checked={reconGroupIds.includes(g.groupId)}
                         onChange={(e) => togglePick(g.groupId, e.target.checked)} />
                  {g.groupName}
                  <span style={{ color: '#777777', fontSize: 10 }}>({g.units.length})</span>
                </label>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Flight lead controls — the doctrine and presentation numbers the
          cards used to hardcode. (v1.19.126) */}
      <div style={{ marginTop: 10 }}>
        <FlightLeadControls
          value={opts}
          onChange={(next) => setKneeboardSettings({ options: next })}
        />
      </div>

      {/* Radio Ladder rung order — drag to override the derived phase order
          before the card renders. (v1.19.119) */}
      {cards.radioLadder && (() => {
        const rows = applyLadderOrder(
          buildRadioLadder({
            group: selectedGroup, allGroups: groups, coalition,
            airbases, sopComms: activeSop?.comms ?? [],
          }),
          radioLadderOrder,
        );
        return (
          <div style={{
            border: '1px solid #333333', borderRadius: 4,
            padding: '8px 10px', marginTop: 10,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#cccccc', marginBottom: 6 }}>
              Radio Ladder order
            </div>
            <RadioLadderOrderEditor
              rows={rows}
              order={radioLadderOrder}
              onChange={(next) => setKneeboardSettings({ radioLadderOrder: next })}
            />
          </div>
        );
      })()}

      {/* Fuel Ladder overrides — per selected flight. Pin a real Start /
          Joker / Bingo (absolute lbs) instead of the loadout-fuel + 35%/20%
          defaults. Only shows when the Fuel Ladder card is enabled and a
          player flight is selected. (v1.19.108) */}
      {cards.fuelLadder && selectedGroup && isPlayerGroup(selectedGroup) && (() => {
        const gName = selectedGroup.groupName;
        const ovr = fuelOverrides[gName] ?? {};
        const rep = clientUnits.find((cu) => cu.groupName === gName);
        const perf = getAircraftPerf(selectedGroup.units[0]?.type || '');
        const rawFuel = rep?.fuel ?? 0;
        // Mirror the card's kg/fraction → lbs conversion for the placeholders.
        const autoStart = rawFuel <= 1
          ? Math.round(rawFuel * perf.maxFuelLbs)
          : Math.round(rawFuel * 2.20462);
        const effStart = ovr.start ?? autoStart;
        // Floored bingo, shared with the cards (fuelModel.computeJokerBingo) so
        // the editor's placeholder matches what actually prints.
        const { joker: autoJoker, bingo: autoBingo } = computeJokerBingo(effStart, undefined, opts.fuel);
        const hasOvr = ovr.start != null || ovr.joker != null || ovr.bingo != null;
        const parse = (s: string) => {
          const v = parseInt(s.replace(/[^0-9]/g, ''), 10);
          return Number.isFinite(v) ? v : undefined;
        };
        const setKey = (key: 'start' | 'joker' | 'bingo', val: number | undefined) => {
          const next: { start?: number; joker?: number; bingo?: number } = { ...ovr };
          if (val == null) delete next[key]; else next[key] = val;
          const map = { ...fuelOverrides };
          if (next.start == null && next.joker == null && next.bingo == null) delete map[gName];
          else map[gName] = next;
          setKneeboardSettings({ fuelOverrides: map });
        };
        const clearAll = () => {
          const map = { ...fuelOverrides };
          delete map[gName];
          setKneeboardSettings({ fuelOverrides: map });
        };
        const field = (label: string, key: 'start' | 'joker' | 'bingo', auto: number) => (
          <label style={{ display: 'block', fontSize: 11, color: '#aaaaaa' }}>
            <span style={{ display: 'block', color: '#cccccc', fontWeight: 600, marginBottom: 3 }}>{label}</span>
            <input
              value={ovr[key] ?? ''}
              onChange={(e) => setKey(key, parse(e.target.value))}
              placeholder={`auto ${auto.toLocaleString()}`}
              inputMode="numeric"
              style={{
                width: '100%', boxSizing: 'border-box', background: '#262626',
                border: '1px solid #3a3a3a', borderRadius: 4, color: '#e0e0e0',
                fontSize: 13, padding: '6px 8px', fontFamily: 'inherit',
              }}
            />
          </label>
        );
        return (
          <div style={{
            marginBottom: 16, padding: '10px 14px', background: '#1a1a1a', borderRadius: 6,
            border: '1px solid #3a3a3a',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#e0e0e0' }}>
                Fuel Ladder — {gName}
              </span>
              <span style={{ fontSize: 11, color: '#666' }}>Absolute lbs · blank = auto</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {field('Start (lbs)', 'start', autoStart)}
              {field('Joker (lbs)', 'joker', autoJoker)}
              {field('Bingo (lbs)', 'bingo', autoBingo)}
            </div>
            {hasOvr && (
              <button
                onClick={clearAll}
                style={{
                  marginTop: 8, background: '#2a2a2a', border: '1px solid #3a3a3a',
                  borderRadius: 4, color: '#aaaaaa', fontSize: 11, padding: '4px 10px',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Reset to auto
              </button>
            )}
          </div>
        );
      })()}

      {/* Flight Card "Flight Data" overrides — per selected flight. Fill the
          TACAN / ICLS / IFF M1 / IFF M3 row at the top of the Flight Card.
          IFF codes live only here (DCS doesn't store them in the .miz); TACAN
          & ICLS also have a real editor in the TACAN tab that sets them in the
          jet — these overrides only fill the card. (v1.19.109) */}
      {cards.flight && selectedGroup && isPlayerGroup(selectedGroup) && (() => {
        const gName = selectedGroup.groupName;
        const ovr = flightDataOverrides[gName] ?? {};
        const autoTacan = selectedGroup.tacan
          ? `${selectedGroup.tacan.channel}${selectedGroup.tacan.band}${selectedGroup.tacan.callsign ? ` (${selectedGroup.tacan.callsign})` : ''}`
          : '';
        const autoIcls = selectedGroup.icls?.channel ? String(selectedGroup.icls.channel) : '';
        const hasOvr = !!(ovr.tacan || ovr.icls || ovr.iffM1 || ovr.iffM3);
        const setKey = (key: 'tacan' | 'icls' | 'iffM1' | 'iffM3', raw: string) => {
          const v = raw.trim();
          const next: { tacan?: string; icls?: string; iffM1?: string; iffM3?: string } = { ...ovr };
          if (!v) delete next[key]; else next[key] = v;
          const map = { ...flightDataOverrides };
          if (!next.tacan && !next.icls && !next.iffM1 && !next.iffM3) delete map[gName];
          else map[gName] = next;
          setKneeboardSettings({ flightDataOverrides: map });
        };
        const clearAll = () => {
          const map = { ...flightDataOverrides };
          delete map[gName];
          setKneeboardSettings({ flightDataOverrides: map });
        };
        const field = (label: string, key: 'tacan' | 'icls' | 'iffM1' | 'iffM3', ph: string) => (
          <label style={{ display: 'block', fontSize: 11, color: '#aaaaaa' }}>
            <span style={{ display: 'block', color: '#cccccc', fontWeight: 600, marginBottom: 3 }}>{label}</span>
            <input
              value={ovr[key] ?? ''}
              onChange={(e) => setKey(key, e.target.value)}
              placeholder={ph}
              style={{
                width: '100%', boxSizing: 'border-box', background: '#262626',
                border: '1px solid #3a3a3a', borderRadius: 4, color: '#e0e0e0',
                fontSize: 13, padding: '6px 8px', fontFamily: 'inherit',
              }}
            />
          </label>
        );
        return (
          <div style={{
            marginBottom: 16, padding: '10px 14px', background: '#1a1a1a', borderRadius: 6,
            border: '1px solid #3a3a3a',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#e0e0e0' }}>Flight Data — {gName}</span>
              <span style={{ fontSize: 11, color: '#666' }}>Fills the Flight Card top row</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 12 }}>
              {field('TACAN', 'tacan', autoTacan || 'e.g. 51X')}
              {field('ICLS', 'icls', autoIcls || 'e.g. 11')}
              {field('IFF M1', 'iffM1', 'e.g. 41')}
              {field('IFF M3', 'iffM3', 'e.g. 4300')}
            </div>
            <div style={{ fontSize: 11, color: '#666', marginTop: 6, lineHeight: 1.4 }}>
              IFF M1/M3 live only here — DCS doesn't store them in the mission.
              TACAN &amp; ICLS also have a real editor in the <b>TACAN tab</b> (which sets them in the jet); these fields only fill the card.
            </div>
            {hasOvr && (
              <button
                onClick={clearAll}
                style={{
                  marginTop: 8, background: '#2a2a2a', border: '1px solid #3a3a3a',
                  borderRadius: 4, color: '#aaaaaa', fontSize: 11, padding: '4px 10px',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Reset to auto
              </button>
            )}
          </div>
        );
      })()}

      {/* Standalone Mission Notes card editor — feeds the dedicated
          "Mission Notes" kneeboard card (separate from the per-card
          notes above). Typing here auto-enables that card. */}
      <div style={{
        marginBottom: 16, padding: '10px 14px', background: '#1a1a1a', borderRadius: 6,
        border: '1px solid #3a3a3a',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: '#e0e0e0' }}>Standalone Notes Card</span>
          <span style={{ fontSize: 11, color: '#666' }}>
            Prints as its own “Mission Notes” page
          </span>
        </div>

        <label style={{ display: 'block', fontSize: 11, color: '#aaaaaa', marginBottom: 8 }}>
          <span style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>Card heading (optional)</span>
          <input
            value={notesTitle}
            onChange={(e) => setKneeboardSettings({ notesTitle: e.target.value })}
            placeholder="MISSION NOTES"
            style={{
              display: 'block', width: '100%', marginTop: 4,
              background: '#262626', border: '1px solid #3a3a3a', borderRadius: 4,
              color: '#e0e0e0', fontSize: 13, padding: '6px 8px', fontFamily: 'inherit',
            }}
          />
        </label>

        <textarea
          value={notesText}
          onChange={(e) => {
            // Auto-enable the card the moment the planner starts typing
            // so they don't get a "where's my note?" surprise. They can
            // still untick it in Card Types if they want to suppress it.
            const next = e.target.value;
            setKneeboardSettings({
              notesText: next,
              ...(next.trim() && !cards.notesCard ? { cards: { ...cards, notesCard: true } } : {}),
            });
          }}
          placeholder={
            'e.g.\n' +
            '• ROE: weapons tight until JTAC clears\n' +
            '• Code-word for abort: "BINGO HORN"\n' +
            '• Tanker drops off-station at 1430Z — plan fuel accordingly\n' +
            '• Divert to Batumi if Senaki socks in'
          }
          rows={8}
          style={{
            width: '100%', background: '#262626', border: '1px solid #3a3a3a', borderRadius: 4,
            color: '#e0e0e0', fontSize: 13, padding: '8px', fontFamily: 'inherit',
            lineHeight: 1.5, resize: 'vertical',
          }}
        />
        <div style={{ fontSize: 11, color: '#666', marginTop: 6 }}>
          {notesText.trim().length > 0
            ? `${notesText.trim().length} characters · line breaks are preserved on the card`
            : 'Tip: keep it punchy — long notes may run off the bottom of a single card.'}
        </div>
      </div>

      {/* Spoiler banner — shown when the user has chosen a fidelity
          that reveals enemy positions to the pilot. Easy to miss the
          dropdown when generating kneeboards in a hurry; the banner
          is the second-chance surface. */}
      {cards.threatCard && threatFidelity !== 'realistic' && (
        <div
          style={{
            margin: '10px 0',
            padding: '10px 14px',
            background: threatFidelity === 'full'
              ? 'rgba(217, 80, 80, 0.10)'
              : 'rgba(210, 153, 34, 0.08)',
            border: `1px solid ${threatFidelity === 'full' ? '#5a2a2a' : '#5a4a2a'}`,
            borderRadius: 6,
            fontSize: 13,
            color: threatFidelity === 'full' ? '#d95050' : '#d29922',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ fontWeight: 700 }}>
            {threatFidelity === 'full' ? 'SPOILER WARNING' : 'PARTIAL REVEAL'}
          </span>
          <span style={{ color: '#cccccc' }}>
            {threatFidelity === 'full'
              ? 'Threat card will show every SAM with name, range, and MGRS — only print this for instructor / debrief copies.'
              : 'Threat card will show ring sizes and rough positions. Pilot kneeboards usually want "Realistic — vague zones" instead.'}
          </span>
        </div>
      )}

      {/* Weapon Reference — pick which stores get a card. Shown when the
          Weapon Reference card type is enabled. */}
      {cards.weaponsRef && (
        <div style={{ margin: '10px 0', padding: '10px 14px', background: '#222', border: '1px solid #3a3a3a', borderRadius: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#e0e0e0', marginBottom: 8 }}>
            Weapon cards <span style={{ color: '#888', fontWeight: 400 }}>— {weaponIds.length} selected (one card each)</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {WEAPONS.map((w) => {
              const on = weaponIds.includes(w.id);
              return (
                <button key={w.id}
                  onClick={() => setKneeboardSettings({ weaponIds: on ? weaponIds.filter((x) => x !== w.id) : [...weaponIds, w.id] })}
                  style={{
                    background: on ? 'rgba(74,158,255,0.18)' : 'transparent',
                    border: `1px solid ${on ? '#4a9eff' : '#3a3a3a'}`,
                    color: on ? '#cfe6ff' : '#aaaaaa', borderRadius: 14, padding: '3px 10px',
                    fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                  }}>
                  {w.name}
                </button>
              );
            })}
          </div>
          {weaponIds.length === 0 && (
            <div style={{ fontSize: 11, color: '#d29922', marginTop: 6 }}>Pick at least one store, or the card produces nothing.</div>
          )}
        </div>
      )}

      {/* Popup Attack profile editor — appears when the card type is on. */}
      {cards.popupAttack && (
        <PopupAttackEditor limits={opts.weapons.popup}
          profiles={popupAttacks}
          onChange={(next) => setKneeboardSettings({ popupAttacks: next })}
        />
      )}

      {/* Rebuild bar — sits between the settings panel and the
          carousel. Bumps `rebuildAt` which both re-mounts the
          carousel (key prop) and refreshes the timestamp the user
          reads to confirm freshness. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          margin: '0 0 10px',
          padding: '8px 12px',
          background: '#1a1a1a',
          border: '1px solid #3a3a3a',
          borderRadius: 6,
          fontSize: 12,
        }}
      >
        <button
          onClick={() => setRebuildAt(Date.now())}
          style={{
            background: '#262626',
            border: '1px solid #4a8fd4',
            borderRadius: 4,
            color: '#4a8fd4',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
            padding: '4px 12px',
            fontFamily: 'inherit',
          }}
          title="Force re-render of every preview card"
        >
          ↻ Rebuild
        </button>
        <span style={{ color: '#aaaaaa' }}>
          Last built:{' '}
          <span style={{ color: '#cccccc', fontFamily: "'B612 Mono', monospace" }}>
            {new Date(rebuildAt).toLocaleTimeString()}
          </span>
        </span>
        <span style={{ color: '#666', fontSize: 11, marginLeft: 'auto' }}>
          Cards auto-update on edits — Rebuild is a manual refresh / sanity check.
        </span>
      </div>

        </div>{/* end settings column */}

        {/* Live Preview Carousel — sticky right column, sized to the native
            600px card; a tall (850px) card scrolls within the sticky panel. */}
        <div style={{
          position: 'sticky', top: 8, flexShrink: 0, alignSelf: 'flex-start',
          width: 636, maxHeight: 'calc(100vh - 60px)', overflow: 'auto',
        }}>
        <CardCarousel
        key={rebuildAt}
        selectedGroup={selectedGroup}
        playerGroups={playerGroups}
        cards={cards}
        groups={groups}
        clientUnits={clientUnits}
        threats={threats}
        airbases={airbases}
        drawings={drawings}
        theater={theater}
        overview={overview}
        coalition={coalition}
        wx={wx}
        coordFormat={coordFormat}
        speedRef={speedRef}
        machThreshold={machThreshold}
        threatFidelity={threatFidelity}
        threatMapVisible={threatMapVisible}
        activeSop={activeSop}
        dmpis={dmpis}
        notesText={notesText}
        notesTitle={notesTitle}
        cardNotes={cardNotes}
        fuelOverrides={fuelOverrides}
          radioLadderOrder={radioLadderOrder}
          opts={opts}
          camelotOverrides={camelotOverrides}
          reconGroupIds={reconGroupIds}
        flightDataOverrides={flightDataOverrides}
        weaponIds={weaponIds}
        popupAttacks={popupAttacks}
        theme={theme}
        customThemeVars={customThemeVars}
      />
        </div>{/* end preview column */}
      </div>{/* end two-column row */}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Card Carousel                                                       */
/* ------------------------------------------------------------------ */

interface CarouselProps {
  selectedGroup: ReturnType<typeof useMissionStore.getState>['groups'][number] | undefined;
  playerGroups: ReturnType<typeof useMissionStore.getState>['groups'];
  cards: KneeboardCards;
  groups: ReturnType<typeof useMissionStore.getState>['groups'];
  clientUnits: ReturnType<typeof useMissionStore.getState>['clientUnits'];
  threats: ReturnType<typeof useMissionStore.getState>['threats'];
  airbases: ReturnType<typeof useMissionStore.getState>['airbases'];
  drawings: ReturnType<typeof useMissionStore.getState>['drawings'];
  theater: string;
  overview: ReturnType<typeof useMissionStore.getState>['overview'];
  coalition: string;
  wx: Weather | undefined;
  coordFormat: 'mgrs' | 'latlon';
  speedRef: KneeboardSpeedRef;
  machThreshold: number;
  threatFidelity: 'full' | 'operational' | 'realistic';
  threatMapVisible: boolean;
  activeSop: ReturnType<typeof useSopStore.getState>['sops'][number] | null;
  dmpis: ReturnType<typeof useDmpiStore.getState>['dmpis'];
  notesText: string;
  notesTitle: string;
  cardNotes: Record<string, string>;
  fuelOverrides: Record<string, { start?: number; joker?: number; bingo?: number }>;
  radioLadderOrder: string[];
  opts: KneeboardOptions;
  camelotOverrides: Record<string, { event?: string; midsA?: string; midsB?: string; push?: string; m3Base?: string; m1?: string }>;
  reconGroupIds: number[];
  flightDataOverrides: Record<string, { tacan?: string; icls?: string; iffM1?: string; iffM3?: string }>;
  weaponIds: string[];
  popupAttacks: PopupAttackInput[];
  theme: KneeboardTheme;
  /** Custom theme overrides forwarded from KneeboardTab when the user
   *  is in 'custom' mode. Both the live preview wrapper and the PNG
   *  capture need it. (v1.19.37) */
  customThemeVars?: Record<string, string>;
}

interface CardEntry {
  key: string;
  label: string;
  element: React.ReactElement;
}

function CardCarousel({
  selectedGroup, cards, groups, clientUnits, threats, drawings,
  airbases, theater, overview, coalition, wx, coordFormat, speedRef, machThreshold,
  threatFidelity,
  threatMapVisible,
  activeSop,
  dmpis,
  notesText,
  notesTitle,
  cardNotes,
  fuelOverrides, radioLadderOrder, opts, camelotOverrides, reconGroupIds,
  flightDataOverrides,
  weaponIds,
  popupAttacks,
  theme,
  customThemeVars,
}: CarouselProps) {
  const [cardIndex, setCardIndex] = useState(0);
  const [selectedPilotId, setSelectedPilotId] = useState<number | null>(null);

  // Terrain for the Route Profile preview. Fetched rather than computed, so
  // it arrives after the first paint — the card renders its planned-altitude
  // line immediately and the ground fills in when the samples land.
  const [profileSamples, setProfileSamples] = useState<RouteSample[]>([]);
  useEffect(() => {
    if (!cards.routeProfile || !selectedGroup) { setProfileSamples([]); return; }
    const base = sampleRoute(selectedGroup.waypoints);
    setProfileSamples(base);
    let live = true;
    fetchRouteTerrain(base).then((withTerrain) => {
      // Guard the late resolve: switching flights mid-fetch must not paint
      // the previous route's terrain onto the new one.
      if (live) setProfileSamples(withTerrain);
    });
    return () => { live = false; };
  }, [cards.routeProfile, selectedGroup]);

  // Airfields for the diagram set, and their elevations. Same late-resolve
  // guard as the profile: switching flights mid-fetch must not paint the
  // previous flight's numbers onto the new one.
  const diagramFields = useMemo(
    () => (cards.airfieldDiagram ? airfieldsForFlight(selectedGroup, airbases, coalition, opts.diverts.count, opts.diverts.enemyFields) : []),
    [cards.airfieldDiagram, selectedGroup, airbases, coalition]);
  const [fieldElevations, setFieldElevations] = useState<(number | null)[]>([]);
  useEffect(() => {
    if (diagramFields.length === 0) { setFieldElevations([]); return; }
    let live = true;
    fetchFieldElevations(diagramFields).then((e) => { if (live) setFieldElevations(e); });
    return () => { live = false; };
  }, [diagramFields]);

  // Build pilot list for the Tactical C/S selector (units in selected group)
  const pilots = useMemo(() => {
    if (!selectedGroup) return [];
    return clientUnits
      .filter((u) => u.groupName === selectedGroup.groupName)
      .map((u) => ({ unitId: u.unitId, name: u.name }));
  }, [selectedGroup, clientUnits]);

  // Reset pilot selection when group changes
  useEffect(() => {
    setSelectedPilotId(null);
  }, [selectedGroup?.groupId]);

  // Build list of enabled cards
  const cardList = useMemo<CardEntry[]>(() => {
    const list: CardEntry[] = [];

    if (selectedGroup) {
      if (cards.lineup) {
        list.push({
          key: 'lineup', label: 'Route Card',
          element: createElement(RouteCard, { group: selectedGroup, weather: wx, coordFormat, speedRef, machThreshold, overview: overview || undefined, notes: cardNotes.lineup }),
        });
      }
      if (cards.flight) {
        list.push({
          key: 'flight', label: 'Flight Card',
          element: createElement(FlightCard, { opts, group: selectedGroup, clientUnits, laserCodeBase: activeSop?.laserCodeBase, overview: overview || undefined, highlightUnitId: selectedPilotId ?? undefined, notes: cardNotes.flight, fuelOverride: fuelOverrides[selectedGroup.groupName], flightDataOverride: flightDataOverrides[selectedGroup.groupName] }),
        });
      }
      if (cards.airfieldDiagram) {
        const pages = airfieldCardCount(diagramFields.length);
        for (let pg = 0; pg < pages; pg++) {
          list.push({
            key: `airfieldDiagram-${pg}`,
            label: pages > 1 ? `Airfield Diagrams (${pg + 1}/${pages})` : 'Airfield Diagrams',
            element: createElement(AirfieldDiagramCard, { opts,
              airbases: diagramFields, elevationFt: fieldElevations, coalition, page: pg,
              overview: overview || undefined, coordFormat, notes: cardNotes.airfieldDiagram,
            }),
          });
        }
      }
      if (cards.routeProfile) {
        list.push({
          key: 'routeProfile', label: 'Route Profile',
          element: createElement(RouteProfileCard, { opts,
            group: selectedGroup, samples: profileSamples,
            overview: overview || undefined, notes: cardNotes.routeProfile,
          }),
        });
      }
      if (cards.camelot) {
        list.push({
          key: 'camelot', label: 'Camelot Kneeboard',
          element: createElement(CamelotCard, {
            group: selectedGroup, clientUnits, allGroups: groups, airbases,
            overview: overview || undefined,
            overrides: camelotOverrides[selectedGroup.groupName],
            laserCodeBase: activeSop?.laserCodeBase,
            flightDataOverride: flightDataOverrides[selectedGroup.groupName],
            notes: cardNotes.camelot,
          }),
        });
      }
      if (cards.stationLoadout) {
        list.push({
          key: 'stationLoadout', label: 'Station Loadout',
          element: createElement(StationLoadoutCard, { opts,
            group: selectedGroup, clientUnits, overview: overview || undefined,
            laserCodeBase: activeSop?.laserCodeBase, notes: cardNotes.stationLoadout,
          }),
        });
      }
      if (cards.comms) {
        list.push({
          key: 'comms', label: 'Comms Card',
          element: createElement(CommsCard, { group: selectedGroup, allGroups: groups, overview: overview || undefined, notes: cardNotes.comms, airbases, sopComms: activeSop?.comms }),
        });
      }
      if (cards.routeDetail) {
        list.push({
          key: 'routeDetail', label: 'Route Detail',
          element: createElement(RouteDetailCard, { group: selectedGroup, threats, overview: overview || undefined, notes: cardNotes.routeDetail, coordFormat, drawings }),
        });
      }
      if (cards.stripMap) {
        list.push({
          key: 'stripMap', label: 'Strip Map',
          element: createElement(StripMapCard, { opts,
            group: selectedGroup, overview: overview || undefined, notes: cardNotes.stripMap,
            threats, airbases, clientUnits, fuelOverride: fuelOverrides[selectedGroup.groupName],
          }),
        });
      }
      {
        const acType = selectedGroup.units[0]?.type || '';
        if (cards.radioPresets && activeSop?.commPlan?.maps.some((m) => m.aircraft === acType)) {
          list.push({
            key: 'radioPresets', label: 'Radio Presets',
            element: createElement(RadioPresetCard, { aircraft: acType, plan: activeSop.commPlan, overview: overview || undefined }),
          });
        }
      }
      if (cards.fuelLadder) {
        list.push({
          key: 'fuelLadder', label: 'Fuel Ladder',
          element: createElement(FuelLadderCard, { opts, group: selectedGroup, clientUnits, overview: overview || undefined, notes: cardNotes.fuelLadder, fuelOverride: fuelOverrides[selectedGroup.groupName] }),
        });
      }
      if (cards.homePlate) {
        list.push({
          key: 'homePlate', label: 'Home Plate / Divert',
          element: createElement(HomePlateCard, { opts, group: selectedGroup, airbases, allGroups: groups, overview: overview || undefined, coordFormat }),
        });
      }
      if (cards.weaponsAuto) {
        // Preview entries: one card per weapon matched from this flight's pylons.
        const leadId = selectedGroup.units[0]?.unitId;
        const lead = clientUnits.find((c) => c.unitId === leadId);
        const pylonNames = (lead?.pylons || []).map((p) => p.name || '');
        const ids = matchWeaponsToLoadout(pylonNames);
        for (const id of ids) {
          list.push({
            key: `weaponsAuto-${id}`, label: `Weapon · ${id.toUpperCase()}`,
            element: createElement(WeaponCard, { weaponIds: [id], page: 0, overview: overview || undefined }),
          });
        }
      }
    }

    // Shared cards
    if (cards.supportAssets) {
      const pageCount = supportAssetsPageCount({ groups, coalition });
      for (let p = 0; p < pageCount; p++) {
        const suffix = pageCount === 1 ? '' : ` (${p + 1}/${pageCount})`;
        list.push({
          key: `supportAssets-${p}`, label: `Support Assets${suffix}`,
          element: createElement(SupportAssetsCard, { opts, presets: presetsForUnits(clientUnits), groups, coalition, overview: overview || undefined, page: p, notes: cardNotes.supportAssets }),
        });
      }
    }
    if (cards.radioLadder) {
      list.push({
        key: 'radioLadder', label: 'Radio Ladder',
        element: createElement(RadioLadderCard, { opts, groups, coalition, group: selectedGroup, airbases, sopComms: activeSop?.comms, presets: presetsForUnits(clientUnits), order: radioLadderOrder, overview: overview || undefined, notes: cardNotes.radioLadder }),
      });
    }
    if (cards.airbaseRef) {
      list.push({
        key: 'airbaseRef', label: 'Airbase Reference',
        element: createElement(AirbaseRefCard, { opts,
          airbases, theater, overview: overview || undefined, groups, coalition,
          notes: cardNotes.airbaseRef, coordFormat,
        }),
      });
    }
    if (cards.bullseyeRef && overview) {
      list.push({
        key: 'bullseyeRef', label: 'Bullseye Reference',
        element: createElement(BullseyeRefCard, { overview, airbases, groups, threats, coalition, notes: cardNotes.bullseyeRef, coordFormat }),
      });
    }
    if (cards.threatCard) {
      const pageCount = threatCardPageCount({ threats, playerCoalition: coalition, opts });
      for (let p = 0; p < pageCount; p++) {
        const suffix = pageCount === 1 ? '' : ` (${p + 1}/${pageCount})`;
        list.push({
          key: `threatCard-${p}`, label: `Threat Card${suffix}`,
          element: createElement(ThreatCard, { opts, threats, playerCoalition: coalition, overview: overview || undefined, page: p, fidelity: threatFidelity, mapVisible: threatMapVisible, notes: cardNotes.threatCard, coordFormat }),
        });
      }
    }
    if (cards.weatherBrief && overview) {
      list.push({
        key: 'weatherBrief', label: 'Weather Briefing',
        element: createElement(WeatherBriefCard, { opts, overview, notes: cardNotes.weatherBrief }),
      });
    }
    if (cards.reconImagery) {
      for (const gid of reconGroupIds) {
        const rg = groups.find((g) => g.groupId === gid);
        if (!rg) continue;
        list.push({
          key: `recon-${gid}`, label: `Recon — ${rg.groupName}`,
          element: createElement(ReconImageryCard, {
            group: rg, overview: overview || undefined, coordFormat,
            notes: cardNotes.reconImagery,
          }),
        });
      }
    }
    if (cards.sopComms && activeSop) {
      const sopPages = sopCommsPageCount(activeSop);
      for (let p = 0; p < sopPages; p++) {
        const suffix = sopPages === 1 ? '' : ` (${p + 1}/${sopPages})`;
        list.push({
          key: `sopComms-${p}`, label: `SOP Comms${suffix}`,
          element: createElement(SopCommsCard, { sop: activeSop, overview: overview || undefined, page: p }),
        });
      }
    }
    if (cards.transponder && activeSop?.transponder?.assignments?.length) {
      list.push({
        key: 'transponder', label: 'Transponder / IFF',
        element: createElement(TransponderCard, { transponder: activeSop.transponder, squadron: activeSop.squadron, overview: overview || undefined }),
      });
    }
    if (cards.dmpiCard) {
      list.push({
        key: 'dmpiCard', label: 'DMPI List',
        element: createElement(DmpiCard, {
          dmpis, squadron: activeSop?.squadron, overview: overview || undefined, coordFormat,
        }),
      });
    }
    if (cards.targetImagery && dmpis.length > 0) {
      const valid = dmpis.filter((d) => d.name.trim() && (d.lat !== 0 || d.lon !== 0));
      valid.forEach((d, i) => {
        list.push({
          key: `targetImagery-${d.id}`, label: `Target — ${d.name}`,
          element: createElement(TargetImageryCard, { opts,
            dmpi: d, index: i + 1, total: valid.length,
            overview: overview || undefined, coordFormat,
            squadron: activeSop?.squadron, groups,
          }),
        });
      });
    }
    if (cards.notesCard) {
      list.push({
        key: 'notesCard', label: 'Mission Notes',
        element: createElement(NotesCard, {
          text: notesText, title: notesTitle,
          squadron: activeSop?.squadron, overview: overview || undefined,
        }),
      });
    }
    if (cards.weaponsRef && weaponIds.length > 0) {
      const pageCount = weaponCardPageCount(weaponIds);
      for (let p = 0; p < pageCount; p++) {
        list.push({
          key: `weaponsRef-${p}`, label: `Weapon Reference${pageCount > 1 ? ` (${p + 1}/${pageCount})` : ''}`,
          element: createElement(WeaponCard, { weaponIds, page: p, overview: overview || undefined }),
        });
      }
    }
    if (cards.popupAttack && popupAttacks.length > 0) {
      const total = popupAttacks.length;
      for (let i = 0; i < total; i++) {
        list.push({
          key: `popupAttack-${i}`,
          label: `Popup · ${popupAttacks[i].name || `Attack ${i + 1}`}${total > 1 ? ` (${i + 1}/${total})` : ''}`,
          element: createElement(PopupAttackCard, { input: popupAttacks[i], overview: overview || undefined, index: i + 1, total }),
        });
      }
    }

    // Planner's deck order. Keys are card types, so every page of a
    // multi-sheet card travels with its type and stays in sequence. Anything
    // the order does not mention keeps its derived position, after the ones
    // that do — a stale order degrades to a partial preference.
    const order = opts.layout.cardOrder;
    if (order.length === 0) return list;
    const rank = (key: string) => {
      const type = key.split('-')[0];
      const i = order.indexOf(type);
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    return [...list].sort((a, b) => rank(a.key) - rank(b.key));
  // profileSamples and fieldElevations arrive ASYNC after their fetch
  // effects — leaving them out of this list froze the Route Profile card at
  // its initial empty samples forever ("Route needs at least two positioned
  // waypoints" with a fully planned route; Fett report 2026-08-23) and left
  // airfield diagrams without elevations. Every value the card elements
  // close over must be here or the stale element keeps rendering.
  }, [selectedGroup, cards, groups, clientUnits, threats, airbases, theater, overview, coalition, wx, coordFormat, speedRef, machThreshold, threatFidelity, threatMapVisible, activeSop, dmpis, notesText, notesTitle, cardNotes, fuelOverrides, flightDataOverrides, weaponIds, popupAttacks, profileSamples, fieldElevations, diagramFields, opts, drawings, radioLadderOrder, camelotOverrides, reconGroupIds, selectedPilotId]);

  // Clamp index when list changes
  useEffect(() => {
    if (cardIndex >= cardList.length) setCardIndex(Math.max(0, cardList.length - 1));
  }, [cardList.length, cardIndex]);

  if (cardList.length === 0) {
    return (
      <div style={{
        width: 600, height: 400, border: '1px dashed #4a4a4a', borderRadius: 6,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#aaaaaa', fontSize: 15,
      }}>
        {!selectedGroup ? 'Select a flight to preview' : 'No card types selected'}
      </div>
    );
  }

  const current = cardList[cardIndex];

  const arrowBtn: React.CSSProperties = {
    background: '#262626',
    border: '1px solid #4a4a4a',
    borderRadius: 6,
    color: '#4a8fd4',
    cursor: 'pointer',
    fontSize: 22,
    fontWeight: 700,
    width: 40,
    height: 40,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'inherit',
  };

  const arrowDisabled: React.CSSProperties = {
    ...arrowBtn,
    color: '#3a3a3a',
    cursor: 'default',
  };

  return (
    <div>
      {/* Nav bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 12, marginBottom: 10,
      }}>
        {/* Tactical C/S pilot selector */}
        {pilots.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 8 }}>
            <span style={{ fontSize: 11, color: '#aaaaaa', fontWeight: 600, letterSpacing: 0.5 }}>PILOT:</span>
            <select
              value={selectedPilotId ?? '__all__'}
              onChange={(e) => setSelectedPilotId(e.target.value === '__all__' ? null : Number(e.target.value))}
              style={{
                background: '#262626', border: '1px solid #4a4a4a', borderRadius: 3,
                color: selectedPilotId ? '#4a8fd4' : '#cccccc',
                fontSize: 12, fontWeight: 600, padding: '3px 8px', fontFamily: 'inherit',
              }}
            >
              <option value="__all__">All</option>
              {pilots.map((p) => (
                <option key={p.unitId} value={p.unitId}>{p.name}</option>
              ))}
            </select>
          </div>
        )}

        <button
          onClick={() => setCardIndex((i) => Math.max(0, i - 1))}
          disabled={cardIndex === 0}
          style={cardIndex === 0 ? arrowDisabled : arrowBtn}
        >
          ‹
        </button>
        <div style={{ textAlign: 'center', minWidth: 180 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#e0e0e0' }}>
            {current.label}
          </div>
          <div style={{ fontSize: 11, color: '#aaaaaa' }}>
            {cardIndex + 1} / {cardList.length}
          </div>
        </div>
        <button
          onClick={() => setCardIndex((i) => Math.min(cardList.length - 1, i + 1))}
          disabled={cardIndex === cardList.length - 1}
          style={cardIndex === cardList.length - 1 ? arrowDisabled : arrowBtn}
        >
          ›
        </button>
      </div>

      {/* Card preview — themed wrapper sets the --kb-* CSS variables so
          the in-page preview matches the day/night PNG output. */}
      <div style={{
        border: '1px solid #4a4a4a',
        borderRadius: 6,
        overflow: 'hidden',
        display: 'inline-block',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        ...kbThemeStyle(theme, customThemeVars),
      }}>
        {current.element}
      </div>

      {/* Dot indicators */}
      <div style={{
        display: 'flex', justifyContent: 'center', gap: 6, marginTop: 10,
      }}>
        {cardList.map((c, i) => (
          <button
            key={c.key}
            onClick={() => setCardIndex(i)}
            title={c.label}
            style={{
              width: i === cardIndex ? 20 : 8,
              height: 8,
              borderRadius: 4,
              border: 'none',
              background: i === cardIndex ? '#4a8fd4' : '#3a3a3a',
              cursor: 'pointer',
              transition: 'width 0.15s, background 0.15s',
              padding: 0,
            }}
          />
        ))}
      </div>
    </div>
  );
}

