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
import { renderCardToBlob, downloadBlob } from '../../kneeboard/renderCard';
import type { Weather } from '../../utils/atmosphere';
import { isPlayerGroup } from '../../utils/groups';

const PER_FLIGHT_CARDS: { key: keyof KneeboardCards; label: string; desc: string }[] = [
  { key: 'lineup', label: 'Lineup Card', desc: 'Waypoints, coords, alt, speed, ETE' },
  { key: 'flight', label: 'Flight Card', desc: 'Callsigns, loadout, fuel, datalink' },
  { key: 'comms', label: 'Comms Card', desc: 'Radio presets, mission phase flow' },
  { key: 'routeDetail', label: 'Route Detail', desc: 'Map with route, threats, terrain' },
  { key: 'fuelLadder', label: 'Fuel Ladder', desc: 'Fuel burn per leg, joker/bingo' },
  { key: 'homePlate', label: 'Home Plate / Divert', desc: 'Departure field + nearest diverts' },
];

const SHARED_CARDS: { key: keyof KneeboardCards; label: string; desc: string }[] = [
  { key: 'supportAssets', label: 'Support Assets', desc: 'Tankers, AWACS, frequencies' },
  { key: 'radioLadder', label: 'Radio Ladder', desc: 'Shared frequency reference' },
  { key: 'airbaseRef', label: 'Airbase Reference', desc: 'Airfield info, ILS, TACAN' },
  { key: 'bullseyeRef', label: 'Bullseye Reference', desc: 'Bullseye point and radials' },
  { key: 'threatCard', label: 'Threat Card', desc: 'Enemy air defenses map + inventory' },
  { key: 'weatherBrief', label: 'Weather Briefing', desc: 'Full weather summary card' },
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

  const coordFormat = kneeboardSettings.coordFormat;
  const speedRef = kneeboardSettings.speedRef as KneeboardSpeedRef;
  const machThreshold = kneeboardSettings.machThreshold;

  const playerGroups = groups.filter(isPlayerGroup);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(
    playerGroups[0]?.groupId ?? null,
  );
  const [rendering, setRendering] = useState(false);

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
      const el = createElement(RouteCard, { group: g, weather: wx, coordFormat, speedRef, machThreshold, overview: overview || undefined });
      results.push({ name: `${safeName}_Route.png`, blob: await renderCardToBlob(el) });
    }
    if (cards.flight) {
      const el = createElement(FlightCard, { group: g, clientUnits, overview: overview || undefined });
      results.push({ name: `${safeName}_Flight.png`, blob: await renderCardToBlob(el) });
    }
    if (cards.comms) {
      const el = createElement(CommsCard, { group: g, allGroups: groups, overview: overview || undefined });
      results.push({ name: `${safeName}_Comms.png`, blob: await renderCardToBlob(el) });
    }
    if (cards.routeDetail) {
      const el = createElement(RouteDetailCard, { group: g, threats, overview: overview || undefined });
      results.push({ name: `${safeName}_RouteDetail.png`, blob: await renderCardToBlob(el) });
    }
    if (cards.fuelLadder) {
      const el = createElement(FuelLadderCard, { group: g, clientUnits, overview: overview || undefined });
      results.push({ name: `${safeName}_Fuel.png`, blob: await renderCardToBlob(el) });
    }
    if (cards.homePlate) {
      const el = createElement(HomePlateCard, { group: g, airbases, overview: overview || undefined });
      results.push({ name: `${safeName}_HomePlate.png`, blob: await renderCardToBlob(el) });
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
        const el = createElement(SupportAssetsCard, { groups, coalition, overview: overview || undefined, page: p });
        results.push({ name: fname, blob: await renderCardToBlob(el) });
      }
    }
    if (cards.radioLadder) {
      const el = createElement(RadioLadderCard, { groups, coalition, overview: overview || undefined });
      results.push({ name: 'Radio_Ladder.png', blob: await renderCardToBlob(el) });
    }
    if (cards.airbaseRef) {
      // Pass groups + coalition so the route-relevance filter fires.
      // Without them the card falls back to listing all theater
      // airfields — Kola has 71, Sinai has 51, way too many to be
      // useful as a kneeboard reference.
      const el = createElement(AirbaseRefCard, {
        airbases, theater, overview: overview || undefined, groups, coalition,
      });
      results.push({ name: 'Airbase_Ref.png', blob: await renderCardToBlob(el) });
    }
    if (cards.bullseyeRef && overview) {
      const el = createElement(BullseyeRefCard, { overview, airbases, groups, threats, coalition });
      results.push({ name: 'Bullseye_Ref.png', blob: await renderCardToBlob(el) });
    }
    if (cards.threatCard) {
      const pageCount = threatCardPageCount({ threats, playerCoalition: coalition });
      for (let p = 0; p < pageCount; p++) {
        const fname = pageCount === 1 ? 'Threat_Card.png' : `Threat_Card_${p + 1}.png`;
        const el = createElement(ThreatCard, { threats, playerCoalition: coalition, overview: overview || undefined, page: p });
        results.push({ name: fname, blob: await renderCardToBlob(el) });
      }
    }
    if (cards.weatherBrief && overview) {
      const el = createElement(WeatherBriefCard, { overview });
      results.push({ name: 'Weather_Brief.png', blob: await renderCardToBlob(el) });
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

      {/* Live Preview Carousel */}
      <CardCarousel
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
}

interface CardEntry {
  key: string;
  label: string;
  element: React.ReactElement;
}

function CardCarousel({
  selectedGroup, cards, groups, clientUnits, threats,
  airbases, theater, overview, coalition, wx, coordFormat, speedRef, machThreshold,
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
          element: createElement(RouteCard, { group: selectedGroup, weather: wx, coordFormat, speedRef, machThreshold, overview: overview || undefined }),
        });
      }
      if (cards.flight) {
        list.push({
          key: 'flight', label: 'Flight Card',
          element: createElement(FlightCard, { group: selectedGroup, clientUnits, overview: overview || undefined, highlightUnitId: selectedPilotId ?? undefined }),
        });
      }
      if (cards.comms) {
        list.push({
          key: 'comms', label: 'Comms Card',
          element: createElement(CommsCard, { group: selectedGroup, allGroups: groups, overview: overview || undefined }),
        });
      }
      if (cards.routeDetail) {
        list.push({
          key: 'routeDetail', label: 'Route Detail',
          element: createElement(RouteDetailCard, { group: selectedGroup, threats, overview: overview || undefined }),
        });
      }
      if (cards.fuelLadder) {
        list.push({
          key: 'fuelLadder', label: 'Fuel Ladder',
          element: createElement(FuelLadderCard, { group: selectedGroup, clientUnits, overview: overview || undefined }),
        });
      }
      if (cards.homePlate) {
        list.push({
          key: 'homePlate', label: 'Home Plate / Divert',
          element: createElement(HomePlateCard, { group: selectedGroup, airbases, overview: overview || undefined }),
        });
      }
    }

    // Shared cards
    if (cards.supportAssets) {
      const pageCount = supportAssetsPageCount({ groups, coalition });
      for (let p = 0; p < pageCount; p++) {
        const suffix = pageCount === 1 ? '' : ` (${p + 1}/${pageCount})`;
        list.push({
          key: `supportAssets-${p}`, label: `Support Assets${suffix}`,
          element: createElement(SupportAssetsCard, { groups, coalition, overview: overview || undefined, page: p }),
        });
      }
    }
    if (cards.radioLadder) {
      list.push({
        key: 'radioLadder', label: 'Radio Ladder',
        element: createElement(RadioLadderCard, { groups, coalition, overview: overview || undefined }),
      });
    }
    if (cards.airbaseRef) {
      list.push({
        key: 'airbaseRef', label: 'Airbase Reference',
        element: createElement(AirbaseRefCard, {
          airbases, theater, overview: overview || undefined, groups, coalition,
        }),
      });
    }
    if (cards.bullseyeRef && overview) {
      list.push({
        key: 'bullseyeRef', label: 'Bullseye Reference',
        element: createElement(BullseyeRefCard, { overview, airbases, groups, threats, coalition }),
      });
    }
    if (cards.threatCard) {
      const pageCount = threatCardPageCount({ threats, playerCoalition: coalition });
      for (let p = 0; p < pageCount; p++) {
        const suffix = pageCount === 1 ? '' : ` (${p + 1}/${pageCount})`;
        list.push({
          key: `threatCard-${p}`, label: `Threat Card${suffix}`,
          element: createElement(ThreatCard, { threats, playerCoalition: coalition, overview: overview || undefined, page: p }),
        });
      }
    }
    if (cards.weatherBrief && overview) {
      list.push({
        key: 'weatherBrief', label: 'Weather Briefing',
        element: createElement(WeatherBriefCard, { overview }),
      });
    }

    return list;
  }, [selectedGroup, cards, groups, clientUnits, threats, airbases, theater, overview, coalition, wx, coordFormat, speedRef, machThreshold]);

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

      {/* Card preview */}
      <div style={{
        border: '1px solid #4a4a4a',
        borderRadius: 6,
        overflow: 'hidden',
        display: 'inline-block',
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
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
