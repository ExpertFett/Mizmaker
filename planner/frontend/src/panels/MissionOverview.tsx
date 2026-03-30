import { useMissionStore } from '../store/missionStore';
import { formatTime } from '../utils/conversions';

export function MissionOverview() {
  const overview = useMissionStore((s) => s.overview);
  const filename = useMissionStore((s) => s.filename);
  const groups = useMissionStore((s) => s.groups);
  const units = useMissionStore((s) => s.units);
  const threats = useMissionStore((s) => s.threats);

  if (!overview) return null;

  const blueGroups = groups.filter((g) => g.coalition === 'blue').length;
  const redGroups = groups.filter((g) => g.coalition === 'red').length;
  const clientUnits = units.filter((u) => u.skill === 'Client' || u.skill === 'Player').length;

  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid #1a2a3a' }}>
      <div style={{ fontSize: 13, color: '#6a8a9a', marginBottom: 4 }}>{filename}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: '#ccdae8', marginBottom: 8 }}>
        {overview.sortie || overview.theater}
      </div>
      <div style={{ fontSize: 14, color: '#8fa8c0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
        <span>Theater: {overview.theater}</span>
        <span>Date: {overview.date}</span>
        <span>Start: {formatTime(overview.start_time)}</span>
        <span>Clients: {clientUnits}</span>
        <span style={{ color: '#4a8fd4' }}>Blue: {blueGroups} groups</span>
        <span style={{ color: '#d95050' }}>Red: {redGroups} groups</span>
        <span>Threats: {threats.length}</span>
        <span>Total units: {units.length}</span>
      </div>
    </div>
  );
}
