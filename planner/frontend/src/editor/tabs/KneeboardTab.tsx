/**
 * Kneeboard tab — preview and download kneeboard cards.
 *
 * Shows a live preview of each card and a download button.
 * Cards are rendered to PNG via the HTML→Canvas pipeline.
 */

import { useState, useEffect, useMemo, createElement } from 'react';
import JSZip from 'jszip';
import { useMissionStore } from '../../store/missionStore';
import { useEditStore, type KneeboardCards } from '../../store/editStore';
import { RouteCard, type KneeboardSpeedRef } from '../../kneeboard/RouteCard';
import { FlightCard } from '../../kneeboard/FlightCard';
import { CommsCard } from '../../kneeboard/CommsCard';
import { RouteDetailCard } from '../../kneeboard/RouteDetailCard';
import { FuelLadderCard } from '../../kneeboard/FuelLadderCard';
import { SupportAssetsCard, supportAssetsPageCount } from '../../kneeboard/SupportAssetsCard';
import { RadioLadderCard } from '../../kneeboard/RadioLadderCard';
import { AirbaseRefCard } from '../../kneeboard/AirbaseRefCard';
import { BullseyeRefCard } from '../../kneeboard/BullseyeRefCard';
import { ThreatCard, threatCardPageCount } from '../../kneeboard/ThreatCard';
import { WeatherBriefCard } from '../../kneeboard/WeatherBriefCard';
import { HomePlateCard } from '../../kneeboard/HomePlateCard';
import { SopCommsCard } from '../../kneeboard/SopCommsCard';
import { GoalsCard } from '../../kneeboard/GoalsCard';
import { DmpiCard } from '../../kneeboard/DmpiCard';
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
import { useGoalsStore } from '../../store/goalsStore';
import { useDmpiStore } from '../../store/dmpiStore';
import type { Weather } from '../../utils/atmosphere';
import { isPlayerGroup } from '../../utils/groups';

const PER_FLIGHT_CARDS: { key: keyof KneeboardCards; label: string; desc: string }[] = [
  { key: 'lineup', label: 'Lineup Card', desc: 'Waypoints, coords, alt, speed, ETE' },
  { key: 'flight', label: 'Flight Card', desc: 'Callsigns, loadout, fuel, datalink' },
  { key: 'comms', label: 'Comms Card', desc: 'Radio presets, mission phase flow' },
  { key: 'routeDetail', label: 'Route Detail', desc: 'Map with route, threats, terrain' },
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
  { key: 'goalsCard', label: 'Mission Goals', desc: 'Objectives by side (BLUE/RED/NEUTRAL/ALL) + points' },
  { key: 'dmpiCard', label: 'DMPI List', desc: 'Designated targets with coords + weapon delivery' },
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
  { key: 'comms', label: 'Comms Card', perFlight: true },
  { key: 'routeDetail', label: 'Route Detail', perFlight: true },
  { key: 'fuelLadder', label: 'Fuel Ladder', perFlight: true },
  { key: 'supportAssets', label: 'Support Assets', perFlight: false },
  { key: 'radioLadder', label: 'Radio Ladder', perFlight: false },
  { key: 'airbaseRef', label: 'Airbase Reference', perFlight: false },
  { key: 'bullseyeRef', label: 'Bullseye Reference', perFlight: false },
  { key: 'threatCard', label: 'Threat Card', perFlight: false },
  { key: 'weatherBrief', label: 'Weather Briefing', perFlight: false },
];

export function KneeboardTab() {
  const groups = useMissionStore((s) => s.groups);
  const overview = useMissionStore((s) => s.overview);
  const clientUnits = useMissionStore((s) => s.clientUnits);
  const threats = useMissionStore((s) => s.threats);
  const airbases = useMissionStore((s) => s.airbases);
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

  // Goals feed the Mission Goals card. Even if the goals list is
  // empty we still pass it through — the card renders an explicit
  // empty-state placeholder so an enabled checkbox can't silently
  // produce a blank PNG.
  const goals = useGoalsStore((s) => s.goals);
  // DMPIs feed the DMPI card — same pattern (v0.9.16).
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
  const renderGroupCards = async (g: typeof selectedGroup): Promise<{ name: string; blob: Blob }[]> => {
    if (!g) return [];
    const results: { name: string; blob: Blob }[] = [];
    const safeName = g.groupName.replace(/\s+/g, '_');

    if (cards.lineup) {
      const el = createElement(RouteCard, { group: g, weather: wx, coordFormat, speedRef, machThreshold, overview: overview || undefined, notes: cardNotes.lineup });
      results.push({ name: `${safeName}_Route.png`, blob: await renderCardToBlob(el, theme, customThemeVars) });
    }
    if (cards.flight) {
      const el = createElement(FlightCard, { group: g, clientUnits, overview: overview || undefined, notes: cardNotes.flight });
      results.push({ name: `${safeName}_Flight.png`, blob: await renderCardToBlob(el, theme, customThemeVars) });
    }
    if (cards.comms) {
      const el = createElement(CommsCard, { group: g, allGroups: groups, overview: overview || undefined, notes: cardNotes.comms });
      results.push({ name: `${safeName}_Comms.png`, blob: await renderCardToBlob(el, theme, customThemeVars) });
    }
    if (cards.routeDetail) {
      const el = createElement(RouteDetailCard, { group: g, threats, overview: overview || undefined, notes: cardNotes.routeDetail, coordFormat });
      results.push({ name: `${safeName}_RouteDetail.png`, blob: await renderCardToBlob(el, theme, customThemeVars) });
    }
    if (cards.fuelLadder) {
      const el = createElement(FuelLadderCard, { group: g, clientUnits, overview: overview || undefined, notes: cardNotes.fuelLadder });
      results.push({ name: `${safeName}_Fuel.png`, blob: await renderCardToBlob(el, theme, customThemeVars) });
    }
    if (cards.homePlate) {
      const el = createElement(HomePlateCard, { group: g, airbases, overview: overview || undefined, coordFormat });
      results.push({ name: `${safeName}_HomePlate.png`, blob: await renderCardToBlob(el, theme, customThemeVars) });
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
        results.push({ name: `${safeName}_W_${id}.png`, blob: await renderCardToBlob(el, theme, customThemeVars) });
      }
    }
    return results;
  };

  /** Render enabled shared cards. */
  const renderSharedCards = async (): Promise<{ name: string; blob: Blob }[]> => {
    const results: { name: string; blob: Blob }[] = [];
    if (cards.supportAssets) {
      const pageCount = supportAssetsPageCount({ groups, coalition });
      for (let p = 0; p < pageCount; p++) {
        const fname = pageCount === 1 ? 'Support_Assets.png' : `Support_Assets_${p + 1}.png`;
        const el = createElement(SupportAssetsCard, { groups, coalition, overview: overview || undefined, page: p, notes: cardNotes.supportAssets });
        results.push({ name: fname, blob: await renderCardToBlob(el, theme, customThemeVars) });
      }
    }
    if (cards.radioLadder) {
      const el = createElement(RadioLadderCard, { groups, coalition, overview: overview || undefined, notes: cardNotes.radioLadder });
      results.push({ name: 'Radio_Ladder.png', blob: await renderCardToBlob(el, theme, customThemeVars) });
    }
    if (cards.airbaseRef) {
      // Pass groups + coalition so the route-relevance filter fires.
      // Without them the card falls back to listing all theater
      // airfields — Kola has 71, Sinai has 51, way too many to be
      // useful as a kneeboard reference.
      const el = createElement(AirbaseRefCard, {
        airbases, theater, overview: overview || undefined, groups, coalition,
        notes: cardNotes.airbaseRef, coordFormat,
      });
      results.push({ name: 'Airbase_Ref.png', blob: await renderCardToBlob(el, theme, customThemeVars) });
    }
    if (cards.bullseyeRef && overview) {
      const el = createElement(BullseyeRefCard, { overview, airbases, groups, threats, coalition, notes: cardNotes.bullseyeRef, coordFormat });
      results.push({ name: 'Bullseye_Ref.png', blob: await renderCardToBlob(el, theme, customThemeVars) });
    }
    if (cards.threatCard) {
      const pageCount = threatCardPageCount({ threats, playerCoalition: coalition });
      for (let p = 0; p < pageCount; p++) {
        const fname = pageCount === 1 ? 'Threat_Card.png' : `Threat_Card_${p + 1}.png`;
        const el = createElement(ThreatCard, { threats, playerCoalition: coalition, overview: overview || undefined, page: p, fidelity: threatFidelity, mapVisible: threatMapVisible, notes: cardNotes.threatCard, coordFormat });
        results.push({ name: fname, blob: await renderCardToBlob(el, theme, customThemeVars) });
      }
    }
    if (cards.weatherBrief && overview) {
      const el = createElement(WeatherBriefCard, { overview, notes: cardNotes.weatherBrief });
      results.push({ name: 'Weather_Brief.png', blob: await renderCardToBlob(el, theme, customThemeVars) });
    }
    // SOP Comms card — only generated if a SOP is currently active.
    // No-op when the user has the toggle on but no SOP loaded; we don't
    // want to silently fail or emit a blank card. The carousel shows a
    // hint in that case so it's discoverable.
    if (cards.sopComms && activeSop) {
      const el = createElement(SopCommsCard, { sop: activeSop, overview: overview || undefined });
      results.push({ name: 'SOP_Comms.png', blob: await renderCardToBlob(el, theme, customThemeVars) });
    }
    // Mission Goals card — emitted even when the goals list is empty
    // so the user gets a clear "no goals defined" placeholder rather
    // than a missing card. The squadron line falls through from the
    // active SOP for consistency with the SopCommsCard header.
    if (cards.goalsCard) {
      const el = createElement(GoalsCard, {
        goals,
        squadron: activeSop?.squadron,
        overview: overview || undefined,
      });
      results.push({ name: 'Mission_Goals.png', blob: await renderCardToBlob(el, theme, customThemeVars) });
    }
    if (cards.dmpiCard) {
      const el = createElement(DmpiCard, {
        dmpis,
        squadron: activeSop?.squadron,
        overview: overview || undefined,
        coordFormat,
      });
      results.push({ name: 'DMPI_List.png', blob: await renderCardToBlob(el, theme, customThemeVars) });
    }
    if (cards.notesCard) {
      const el = createElement(NotesCard, {
        text: notesText,
        title: notesTitle,
        squadron: activeSop?.squadron,
        overview: overview || undefined,
      });
      results.push({ name: 'Mission_Notes.png', blob: await renderCardToBlob(el, theme, customThemeVars) });
    }
    if (cards.weaponsRef && weaponIds.length > 0) {
      const pageCount = weaponCardPageCount(weaponIds);
      for (let p = 0; p < pageCount; p++) {
        const el = createElement(WeaponCard, { weaponIds, page: p, overview: overview || undefined });
        results.push({ name: `Weapon_${p + 1}.png`, blob: await renderCardToBlob(el, theme, customThemeVars) });
      }
    }
    if (cards.popupAttack && popupAttacks.length > 0) {
      const total = popupAttacks.length;
      for (let i = 0; i < total; i++) {
        const el = createElement(PopupAttackCard, { input: popupAttacks[i], overview: overview || undefined, index: i + 1, total });
        const safe = (popupAttacks[i].name || `Attack_${i + 1}`).replace(/\s+/g, '_');
        results.push({ name: `Popup_${i + 1}_${safe}.png`, blob: await renderCardToBlob(el, theme, customThemeVars) });
      }
    }
    return results;
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
    <div style={{ maxWidth: 1100 }}>
      <h2 style={{ color: '#e0e0e0', fontSize: 18, margin: '0 0 16px', fontWeight: 600 }}>
        Kneeboards
      </h2>

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
        <PopupAttackEditor
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

      {/* Live Preview Carousel */}
      <CardCarousel
        key={rebuildAt}
        selectedGroup={selectedGroup}
        playerGroups={playerGroups}
        cards={cards}
        groups={groups}
        clientUnits={clientUnits}
        threats={threats}
        airbases={airbases}
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
        goals={goals}
        dmpis={dmpis}
        notesText={notesText}
        notesTitle={notesTitle}
        cardNotes={cardNotes}
        weaponIds={weaponIds}
        popupAttacks={popupAttacks}
        theme={theme}
        customThemeVars={customThemeVars}
      />
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
  goals: ReturnType<typeof useGoalsStore.getState>['goals'];
  dmpis: ReturnType<typeof useDmpiStore.getState>['dmpis'];
  notesText: string;
  notesTitle: string;
  cardNotes: Record<string, string>;
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
  selectedGroup, cards, groups, clientUnits, threats,
  airbases, theater, overview, coalition, wx, coordFormat, speedRef, machThreshold,
  threatFidelity,
  threatMapVisible,
  activeSop,
  goals,
  dmpis,
  notesText,
  notesTitle,
  cardNotes,
  weaponIds,
  popupAttacks,
  theme,
  customThemeVars,
}: CarouselProps) {
  const [cardIndex, setCardIndex] = useState(0);
  const [selectedPilotId, setSelectedPilotId] = useState<number | null>(null);

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
          element: createElement(FlightCard, { group: selectedGroup, clientUnits, overview: overview || undefined, highlightUnitId: selectedPilotId ?? undefined, notes: cardNotes.flight }),
        });
      }
      if (cards.comms) {
        list.push({
          key: 'comms', label: 'Comms Card',
          element: createElement(CommsCard, { group: selectedGroup, allGroups: groups, overview: overview || undefined, notes: cardNotes.comms }),
        });
      }
      if (cards.routeDetail) {
        list.push({
          key: 'routeDetail', label: 'Route Detail',
          element: createElement(RouteDetailCard, { group: selectedGroup, threats, overview: overview || undefined, notes: cardNotes.routeDetail, coordFormat }),
        });
      }
      if (cards.fuelLadder) {
        list.push({
          key: 'fuelLadder', label: 'Fuel Ladder',
          element: createElement(FuelLadderCard, { group: selectedGroup, clientUnits, overview: overview || undefined, notes: cardNotes.fuelLadder }),
        });
      }
      if (cards.homePlate) {
        list.push({
          key: 'homePlate', label: 'Home Plate / Divert',
          element: createElement(HomePlateCard, { group: selectedGroup, airbases, overview: overview || undefined, coordFormat }),
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
          element: createElement(SupportAssetsCard, { groups, coalition, overview: overview || undefined, page: p, notes: cardNotes.supportAssets }),
        });
      }
    }
    if (cards.radioLadder) {
      list.push({
        key: 'radioLadder', label: 'Radio Ladder',
        element: createElement(RadioLadderCard, { groups, coalition, overview: overview || undefined, notes: cardNotes.radioLadder }),
      });
    }
    if (cards.airbaseRef) {
      list.push({
        key: 'airbaseRef', label: 'Airbase Reference',
        element: createElement(AirbaseRefCard, {
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
      const pageCount = threatCardPageCount({ threats, playerCoalition: coalition });
      for (let p = 0; p < pageCount; p++) {
        const suffix = pageCount === 1 ? '' : ` (${p + 1}/${pageCount})`;
        list.push({
          key: `threatCard-${p}`, label: `Threat Card${suffix}`,
          element: createElement(ThreatCard, { threats, playerCoalition: coalition, overview: overview || undefined, page: p, fidelity: threatFidelity, mapVisible: threatMapVisible, notes: cardNotes.threatCard, coordFormat }),
        });
      }
    }
    if (cards.weatherBrief && overview) {
      list.push({
        key: 'weatherBrief', label: 'Weather Briefing',
        element: createElement(WeatherBriefCard, { overview, notes: cardNotes.weatherBrief }),
      });
    }
    if (cards.sopComms && activeSop) {
      list.push({
        key: 'sopComms', label: 'SOP Comms',
        element: createElement(SopCommsCard, { sop: activeSop, overview: overview || undefined }),
      });
    }
    // Mission Goals card always renders when enabled, even with an
    // empty goals list — the card has its own empty-state placeholder
    // so the preview carousel matches what the PNG export will emit.
    if (cards.goalsCard) {
      list.push({
        key: 'goalsCard', label: 'Mission Goals',
        element: createElement(GoalsCard, {
          goals, squadron: activeSop?.squadron, overview: overview || undefined,
        }),
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

    return list;
  }, [selectedGroup, cards, groups, clientUnits, threats, airbases, theater, overview, coalition, wx, coordFormat, speedRef, machThreshold, threatFidelity, threatMapVisible, activeSop, goals, dmpis, notesText, notesTitle, cardNotes, weaponIds, popupAttacks]);

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

