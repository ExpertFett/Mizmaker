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
import { SupportAssetsCard } from '../kneeboard/SupportAssetsCard';
import { RadioLadderCard } from '../kneeboard/RadioLadderCard';
import { AirbaseRefCard } from '../kneeboard/AirbaseRefCard';
import { BullseyeRefCard } from '../kneeboard/BullseyeRefCard';
import { WeatherBriefCard } from '../kneeboard/WeatherBriefCard';
import { renderCardToBlob } from '../kneeboard/renderCard';
import type { Weather } from '../utils/atmosphere';

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

  const handleDownload = async () => {
    if (!sessionId) { alert('No session'); return; }

    const isWaypointEdit = (e: any): e is WaypointEdit =>
      'type' in e && typeof e.type === 'string' && e.type.startsWith('waypoint');
    const unitEdits = edits.filter((e) => !isWaypointEdit(e));

    // Always include forcedOptions so mission options changes are saved
    if (Object.keys(missionOptions).length > 0) {
      unitEdits.push({ field: 'forcedOptions', value: missionOptions });
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
        if (cards.supportAssets)
          await addCard(sharedType, 'Support_Assets.png', createElement(SupportAssetsCard, { groups, coalition }));
        if (cards.radioLadder)
          await addCard(sharedType, 'Radio_Ladder.png', createElement(RadioLadderCard, { groups, coalition }));
        if (cards.airbaseRef)
          await addCard(sharedType, 'Airbase_Ref.png', createElement(AirbaseRefCard, { airbases, theater: theater || '' }));
        if (cards.bullseyeRef && overview)
          await addCard(sharedType, 'Bullseye_Ref.png', createElement(BullseyeRefCard, { overview, airbases, groups, threats, coalition }));
        if (cards.weatherBrief && overview)
          await addCard(sharedType, 'Weather_Brief.png', createElement(WeatherBriefCard, { overview }));
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
    <div style={{ padding: '10px 12px', borderTop: '1px solid #1a2a3a' }}>
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
  background: '#0f2a4a',
  border: '1px solid #1a3a5a',
  borderRadius: 4,
  color: '#ccdae8',
  padding: '7px 10px',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
};
