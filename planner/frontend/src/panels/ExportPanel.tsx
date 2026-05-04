import { createElement } from 'react';
import { useMissionStore } from '../store/missionStore';
import { useEditStore } from '../store/editStore';
import { exportJson, closeSession } from '../api/client';
import type { WaypointEdit } from '../types/mission';
import { isPlayerGroup } from '../utils/groups';
import { RouteCard } from '../kneeboard/RouteCard';
import { FlightCard } from '../kneeboard/FlightCard';
import { CommsCard } from '../kneeboard/CommsCard';
import { RouteDetailCard } from '../kneeboard/RouteDetailCard';
import { FuelLadderCard } from '../kneeboard/FuelLadderCard';
import { SupportAssetsCard, supportAssetsPageCount } from '../kneeboard/SupportAssetsCard';
import { RadioLadderCard } from '../kneeboard/RadioLadderCard';
import { AirbaseRefCard } from '../kneeboard/AirbaseRefCard';
import { BullseyeRefCard } from '../kneeboard/BullseyeRefCard';
import { WeatherBriefCard } from '../kneeboard/WeatherBriefCard';
import { ThreatCard, threatCardPageCount } from '../kneeboard/ThreatCard';
import { SopCommsCard } from '../kneeboard/SopCommsCard';
import { GoalsCard } from '../kneeboard/GoalsCard';
import { renderCardToBlob } from '../kneeboard/renderCard';
import { useSopStore } from '../sop/sopStore';
import { useGoalsStore } from '../store/goalsStore';
import type { Weather } from '../utils/atmosphere';

/** Mirrors the backend's EditResult shape returned in the X-Edit-Results header. */
interface EditResult {
  field: string;
  status: 'applied' | 'noop' | 'skipped' | 'invalid';
  unitId?: number;
  groupId?: number;
  reason?: string;
  textDelta?: number;
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]); // strip data:...;base64, prefix
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function ExportPanel() {
  const { sessionId, filename, clear, groups, overview, clientUnits, threats, airbases, theater, missionOptions } = useMissionStore();
  const { edits, isDirty, clearEdits, injectKneeboards, kneeboardSettings } = useEditStore();
  // Active SOP — needed if the user has the SOP Comms kneeboard card
  // enabled and wants it injected into the .miz on download.
  const sopList = useSopStore((s) => s.sops);
  const activeSopId = useSopStore((s) => s.activeId);
  const activeSop = activeSopId ? sopList.find((s) => s.id === activeSopId) ?? null : null;
  // Goals feed the Mission Goals kneeboard card on inject. Read directly
  // from the store rather than via store-action prop drilling — this
  // panel is small and the card has its own empty-state placeholder.
  const goals = useGoalsStore((s) => s.goals);

  const handleDownload = async () => {
    if (!sessionId) { alert('No session'); return; }

    const isWaypointEdit = (e: any): e is WaypointEdit =>
      'type' in e && typeof e.type === 'string' && e.type.startsWith('waypoint');
    const unitEdits = edits.filter((e) => !isWaypointEdit(e));

    // Always include forcedOptions so mission options changes are saved
    if (Object.keys(missionOptions).length > 0) {
      unitEdits.push({ field: 'forcedOptions', value: missionOptions });
    }

    // Persist Mission Goals into the .miz on download. We always emit
    // the missionGoals edit when the user has at least one non-blank
    // goal staged — the backend handler tolerates an empty payload
    // (writes an empty goals block) but we'd rather avoid touching
    // the goals block at all when the user hasn't engaged with the
    // tab. That keeps the diff minimal for missions where the goals
    // tab was never opened.
    const validGoals = goals.filter((g) => g.text.trim().length > 0);
    if (validGoals.length > 0) {
      unitEdits.push({ field: 'missionGoals', value: validGoals });
    }

    // Render kneeboard PNGs if inject is enabled
    let kneeboards: { aircraft_type: string; filename: string; data: string }[] = [];
    if (injectKneeboards) {
      const playerGroups = groups.filter(isPlayerGroup);
      const wx = overview?.weather as Weather | undefined;
      const cards = kneeboardSettings.cards;
      const coalition = playerGroups[0]?.coalition || 'blue';

      const addCard = async (aircraftType: string, filename: string, el: React.ReactElement) => {
        const blob = await renderCardToBlob(el);
        kneeboards.push({ aircraft_type: aircraftType, filename, data: await blobToBase64(blob) });
      };

      // Per-flight cards
      for (const g of playerGroups) {
        const aircraftType = g.units[0]?.type || 'unknown';
        const safeName = g.groupName.replace(/\s+/g, '_');
        try {
          if (cards.lineup)
            await addCard(aircraftType, `${safeName}_Route.png`,
              createElement(RouteCard, { group: g, weather: wx, coordFormat: kneeboardSettings.coordFormat, speedRef: kneeboardSettings.speedRef as any, machThreshold: kneeboardSettings.machThreshold }));
          if (cards.flight)
            await addCard(aircraftType, `${safeName}_Flight.png`,
              createElement(FlightCard, { group: g, clientUnits }));
          if (cards.comms)
            await addCard(aircraftType, `${safeName}_Comms.png`,
              createElement(CommsCard, { group: g, allGroups: groups }));
          if (cards.routeDetail)
            await addCard(aircraftType, `${safeName}_RouteDetail.png`,
              createElement(RouteDetailCard, { group: g, threats }));
          if (cards.fuelLadder)
            await addCard(aircraftType, `${safeName}_Fuel.png`,
              createElement(FuelLadderCard, { group: g, clientUnits }));
        } catch (e) {
          console.error(`Kneeboard render failed for ${g.groupName}:`, e);
        }
      }

      // Shared cards — inject into KNEEBOARD/IMAGES/ (no aircraft type subfolder)
      try {
        const sharedType = '_SHARED_';
        if (cards.supportAssets) {
          const pageCount = supportAssetsPageCount({ groups, coalition });
          for (let p = 0; p < pageCount; p++) {
            const fname = pageCount === 1 ? 'Support_Assets.png' : `Support_Assets_${p + 1}.png`;
            await addCard(sharedType, fname, createElement(SupportAssetsCard, { groups, coalition, page: p }));
          }
        }
        if (cards.radioLadder)
          await addCard(sharedType, 'Radio_Ladder.png', createElement(RadioLadderCard, { groups, coalition }));
        if (cards.airbaseRef)
          await addCard(sharedType, 'Airbase_Ref.png', createElement(AirbaseRefCard, {
            airbases, theater: theater || '', groups, coalition,
            // groups + coalition trigger the route-relevance filter so we
            // don't dump all 36 Kola airfields onto a kneeboard.
          }));
        if (cards.bullseyeRef && overview)
          await addCard(sharedType, 'Bullseye_Ref.png', createElement(BullseyeRefCard, { overview, airbases, groups, threats, coalition }));
        if (cards.threatCard) {
          const pageCount = threatCardPageCount({ threats, playerCoalition: coalition });
          for (let p = 0; p < pageCount; p++) {
            const fname = pageCount === 1 ? 'Threat_Card.png' : `Threat_Card_${p + 1}.png`;
            await addCard(sharedType, fname, createElement(ThreatCard, { threats, playerCoalition: coalition, page: p, fidelity: kneeboardSettings.threatFidelity ?? 'full' }));
          }
        }
        if (cards.weatherBrief && overview)
          await addCard(sharedType, 'Weather_Brief.png', createElement(WeatherBriefCard, { overview }));
        // SOP Comms — only injected when an SOP is active. The carousel
        // already shows a "select SOP" hint if the toggle is on but no
        // SOP is loaded; here we just silently skip rather than emit an
        // empty card.
        if (cards.sopComms && activeSop)
          await addCard(sharedType, 'SOP_Comms.png',
            createElement(SopCommsCard, { sop: activeSop, overview: overview || undefined }));
        // Mission Goals — always emitted when the toggle is on, even
        // with an empty list. The card itself shows an explicit
        // placeholder so a "no goals" mission still gets a visible
        // card rather than a missing slot.
        if (cards.goalsCard)
          await addCard(sharedType, 'Mission_Goals.png',
            createElement(GoalsCard, { goals, squadron: activeSop?.squadron, overview: overview || undefined }));
      } catch (e) {
        console.error('Shared kneeboard render failed:', e);
      }
    }

    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, unitEdits, kneeboards }),
      });

      if (!res.ok) {
        const err = await res.text();
        alert(`Download failed: ${res.status} ${err}`);
        return;
      }

      // Parse edit-results header (silent-failure surfacing)
      const resultsHeader = res.headers.get('X-Edit-Results');
      let editResults: EditResult[] = [];
      if (resultsHeader) {
        try {
          const decoded = atob(resultsHeader);
          const parsed = JSON.parse(decoded);
          editResults = parsed.results || [];
        } catch (e) {
          console.warn('Failed to parse X-Edit-Results header:', e);
        }
      }

      const blob = await res.blob();
      console.log('Blob:', blob.size, 'bytes', blob.type);

      if (blob.size === 0) { alert('Empty file returned'); return; }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Append _edited to filename so users don't confuse original and modified .miz
      const baseName = (filename || 'mission.miz').replace(/\.miz$/i, '');
      a.download = `${baseName}_edited.miz`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      clearEdits();

      // Surface only dropped / invalid edits in a popup. Noops are
      // logged to the console but not alerted — earlier the popup also
      // listed every "value already matched, no-op" edit, which was
      // noisy (Auto Deconflict in the comms tab generated tons of them
      // for unchanged modulation fields). Real anomalies that the user
      // needs to see still surface as a popup.
      const dropped = editResults.filter(
        (r) => r.status === 'skipped' || r.status === 'invalid',
      );
      const noops = editResults.filter((r) => r.status === 'noop');
      if (noops.length > 0) {
        console.info(`[edits] ${noops.length} no-op edit(s) — value already matched or target absent:`,
          noops);
      }
      if (dropped.length > 0) {
        const lines: string[] = [];
        lines.push(`⚠️ ${dropped.length} edit${dropped.length !== 1 ? 's' : ''} were DROPPED:`);
        for (const r of dropped.slice(0, 8)) {
          const tag = r.unitId ? `unit ${r.unitId}` : r.groupId ? `group ${r.groupId}` : '';
          lines.push(`  • ${r.field} ${tag} — ${r.reason || r.status}`);
        }
        if (dropped.length > 8) lines.push(`  …and ${dropped.length - 8} more`);
        alert(lines.join('\n'));
      }
    } catch (e: any) {
      console.error('Download error:', e);
      alert(`Download error: ${e.message}`);
    }
  };

  const handleExportJson = async () => {
    if (!sessionId) return;
    try {
      const data = await exportJson(sessionId);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (filename || 'mission').replace('.miz', '') + '_planning.json';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export failed:', e);
    }
  };

  const handleNewFile = async () => {
    if (sessionId) {
      await closeSession(sessionId);
    }
    clearEdits();
    clear();
  };

  return (
    <div style={{ padding: '10px 12px', borderTop: '1px solid #3a3a3a' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button onClick={handleDownload} style={{ ...btnStyle, width: '100%' }}>
          {isDirty ? 'Download .miz *' : 'Download .miz'}
        </button>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={handleExportJson} style={{ ...btnStyle, flex: 1, background: '#1a3a2a' }}>
            JSON
          </button>
          <button onClick={handleNewFile} style={{ ...btnStyle, flex: 1, background: '#2a1a1a', color: '#d95050' }}>
            New
          </button>
        </div>
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: '#333333',
  border: '1px solid #4a4a4a',
  borderRadius: 4,
  color: '#e0e0e0',
  padding: '7px 10px',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
};
