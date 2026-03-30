/**
 * Kneeboard tab — preview and download kneeboard cards.
 *
 * Shows a live preview of each card and a download button.
 * Cards are rendered to PNG via the HTML→Canvas pipeline.
 */

import { useState, useEffect, createElement } from 'react';
import { useMissionStore } from '../../store/missionStore';
import { RouteCard, type KneeboardSpeedRef } from '../../kneeboard/RouteCard';
import { renderCardToDataUrl, renderCardToBlob, downloadBlob } from '../../kneeboard/renderCard';
import type { Weather } from '../../utils/atmosphere';
import { isPlayerGroup } from '../../utils/groups';

export function KneeboardTab() {
  const groups = useMissionStore((s) => s.groups);
  const overview = useMissionStore((s) => s.overview);
  const wx = overview?.weather as Weather | undefined;

  const playerGroups = groups.filter(isPlayerGroup);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(
    playerGroups[0]?.groupId ?? null,
  );
  const [coordFormat, setCoordFormat] = useState<'mgrs' | 'latlon'>('mgrs');
  const [speedRef, setSpeedRef] = useState<KneeboardSpeedRef>('auto');
  const [machThreshold, setMachThreshold] = useState(18000); // ft
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);

  const selectedGroup = groups.find((g) => g.groupId === selectedGroupId);

  // Update preview when selection or settings change
  useEffect(() => {
    if (!selectedGroup) {
      setPreviewUrl(null);
      return;
    }

    let cancelled = false;
    const el = createElement(RouteCard, {
      group: selectedGroup,
      weather: wx,
      coordFormat,
      speedRef,
      machThreshold,
    });

    renderCardToDataUrl(el)
      .then((url) => {
        if (!cancelled) setPreviewUrl(url);
      })
      .catch((e) => {
        console.error('Kneeboard render failed:', e);
        if (!cancelled) setPreviewUrl(null);
      });

    return () => { cancelled = true; };
  }, [selectedGroup, wx, coordFormat, speedRef, machThreshold]);

  const handleDownloadOne = async () => {
    if (!selectedGroup) return;
    setRendering(true);
    try {
      const el = createElement(RouteCard, { group: selectedGroup, weather: wx, coordFormat, speedRef, machThreshold });
      const blob = await renderCardToBlob(el);
      downloadBlob(blob, `${selectedGroup.groupName.replace(/\s+/g, '_')}_Route.png`);
    } catch (e) {
      console.error('Download failed:', e);
    }
    setRendering(false);
  };

  const handleDownloadAll = async () => {
    setRendering(true);
    try {
      for (const g of playerGroups) {
        const el = createElement(RouteCard, { group: g, weather: wx, coordFormat, speedRef, machThreshold });
        const blob = await renderCardToBlob(el);
        downloadBlob(blob, `${g.groupName.replace(/\s+/g, '_')}_Route.png`);
        // Small delay between downloads so browser doesn't block them
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (e) {
      console.error('Batch download failed:', e);
    }
    setRendering(false);
  };

  const selectStyle: React.CSSProperties = {
    background: '#0f1a28',
    border: '1px solid #1a2a3a',
    borderRadius: 4,
    color: '#ccdae8',
    fontSize: 13,
    padding: '4px 8px',
  };

  const btnStyle: React.CSSProperties = {
    background: '#0f2a4a',
    border: '1px solid #1a3a5a',
    borderRadius: 4,
    color: '#ccdae8',
    padding: '6px 14px',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
  };

  return (
    <div style={{ maxWidth: 700 }}>
      <h2 style={{ color: '#ccdae8', fontSize: 18, margin: '0 0 16px', fontWeight: 600 }}>
        Kneeboards
      </h2>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 13, color: '#5a7a8a' }}>
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

        <label style={{ fontSize: 13, color: '#5a7a8a' }}>
          Coords:
          <select
            value={coordFormat}
            onChange={(e) => setCoordFormat(e.target.value as 'mgrs' | 'latlon')}
            style={{ ...selectStyle, marginLeft: 6 }}
          >
            <option value="mgrs">MGRS</option>
            <option value="latlon">Lat/Lon</option>
          </select>
        </label>

        <label style={{ fontSize: 13, color: '#5a7a8a' }}>
          Speed:
          <select
            value={speedRef}
            onChange={(e) => setSpeedRef(e.target.value as KneeboardSpeedRef)}
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
          <label style={{ fontSize: 13, color: '#5a7a8a' }}>
            Mach above:
            <select
              value={machThreshold}
              onChange={(e) => setMachThreshold(Number(e.target.value))}
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

        <button onClick={handleDownloadOne} disabled={!selectedGroup || rendering} style={btnStyle}>
          {rendering ? 'Rendering...' : 'Download PNG'}
        </button>

        <button
          onClick={handleDownloadAll}
          disabled={rendering || playerGroups.length === 0}
          style={{ ...btnStyle, background: '#1a3a2a' }}
        >
          Download All Flights
        </button>
      </div>

      {/* Preview */}
      {previewUrl ? (
        <div style={{
          border: '1px solid #1a3a5a',
          borderRadius: 6,
          overflow: 'hidden',
          display: 'inline-block',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        }}>
          <img
            src={previewUrl}
            alt="Kneeboard preview"
            style={{ display: 'block', width: 600, height: 850 }}
          />
        </div>
      ) : (
        <div style={{
          width: 600,
          height: 400,
          border: '1px dashed #1a3a5a',
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#5a7a8a',
          fontSize: 15,
        }}>
          {playerGroups.length === 0 ? 'No player flights in this mission' : 'Select a flight to preview'}
        </div>
      )}
    </div>
  );
}
