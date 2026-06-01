/**
 * Auto picture-call summary for the GCI/ATC controller scope.
 *
 * Given an anchor (own-ship / GCI station / friendly track) and a list of
 * hostile tracks, group the bandits into low / mid / high altitude bands and
 * emit a controller-style "picture" call per band:
 *
 *   `2 bandits @ 075° / 12 NM / 18K HOT`
 *
 * The single-bandit case collapses to a plain BRAA call without the "N
 * bandits" prefix. Groups with no tracks are dropped.
 *
 * Altitude bands (in feet AGL/ASL — we don't disambiguate yet):
 *   low    : <10K
 *   mid    : 10–30K
 *   high   : >30K
 *
 * The aggregate BRAA for a band is the *closest* track's BRAA, with the
 * altitude rounded across the band. Picking closest > centroid keeps the
 * call honest about the most immediate threat, which is what GCI cares
 * about. Aspect is reported only if every track in the band reports the
 * same aspect bucket; otherwise we drop the aspect to avoid lying.
 */

import { computeBraa, formatBra, type LL, type AspectLabel } from './braCalc';
import { bullseyeBR, formatBullseye } from './bullseye';

export interface PictureTrack extends LL {
  /** Optional id / callsign to label the track in the per-track table. */
  id?: string | number;
  /** Track / heading in degrees true. When null/undefined, aspect is dropped. */
  trackDeg?: number | null;
  /** Coalition (1=red/hostile, 2=blue/friendly, 0/undefined = neutral). */
  coalition?: number;
}

export type AltBand = 'low' | 'mid' | 'high';

export interface BandLine {
  band: AltBand;
  count: number;
  line: string;
}

export interface PictureCall {
  anchor: LL;
  bands: BandLine[];
  totalBandits: number;
  /** Optional bullseye reference; when present, each band gets a parallel
   *  bullseye-relative line so the DM can call either form on the radio. */
  bullseye?: LL;
  bandsBE?: BandLine[];
}

function bandOf(altFt: number | undefined): AltBand {
  if (altFt == null || !Number.isFinite(altFt)) return 'mid';
  if (altFt < 10_000) return 'low';
  if (altFt > 30_000) return 'high';
  return 'mid';
}

/** Build a picture call. Only tracks with `coalition === 1` (red/hostile)
 *  are considered. Returns `null` when there are no hostiles.
 *  When `bullseye` is provided, the result also carries `bandsBE` — the
 *  same bands but called bullseye-relative so the DM can read either off
 *  the panel and use whichever the receiving flight prefers. */
export function buildPictureCall(anchor: LL, tracks: PictureTrack[], bullseye?: LL): PictureCall | null {
  const bandits = tracks.filter((t) => t.coalition === 1);
  if (bandits.length === 0) return null;
  // Group by alt band.
  const grouped: Record<AltBand, PictureTrack[]> = { low: [], mid: [], high: [] };
  for (const b of bandits) grouped[bandOf(b.altFt)].push(b);
  const bands: BandLine[] = [];
  const bandsBE: BandLine[] = [];
  for (const band of ['low', 'mid', 'high'] as const) {
    const arr = grouped[band];
    if (arr.length === 0) continue;
    // Closest track's BRAA drives the call.
    let closest = arr[0];
    let closestRng = Infinity;
    const allAspects = new Set<AspectLabel | null>();
    for (const t of arr) {
      const braa = computeBraa(anchor, t, t.trackDeg ?? null);
      if (braa.rangeNm < closestRng) { closestRng = braa.rangeNm; closest = t; }
      allAspects.add(braa.aspectLabel);
    }
    const closestBraa = computeBraa(anchor, closest, closest.trackDeg ?? null);
    const base = formatBra(closestBraa);
    const aspect = allAspects.size === 1 ? [...allAspects][0] : null;
    const aspectStr = aspect ? ` ${aspect}` : '';
    const altK = closest.altFt != null && Number.isFinite(closest.altFt)
      ? `${Math.round(closest.altFt / 1000)}K`
      : '—';
    const prefix = arr.length === 1 ? '1 bandit' : `${arr.length} bandits`;
    bands.push({ band, count: arr.length, line: `${prefix} @ ${base}${aspectStr}` });
    if (bullseye) {
      const be = bullseyeBR(bullseye, { lat: closest.lat, lng: closest.lng });
      bandsBE.push({
        band, count: arr.length,
        line: `${prefix} @ ${formatBullseye(be)} ${altK}${aspectStr}`,
      });
    }
  }
  return { anchor, bands, totalBandits: bandits.length, bullseye, bandsBE: bullseye ? bandsBE : undefined };
}

/** Convert the picture call to a single-string radio readout (for clipboard,
 *  text-comms broadcast, etc.). Prefers the bullseye-relative form when
 *  available — that's the call most flights actually want to hear. */
export function formatPictureCall(p: PictureCall, opts: { mode?: 'braa' | 'bullseye' } = {}): string {
  if (p.bands.length === 0) return 'No bandits.';
  const useBE = (opts.mode ?? (p.bandsBE ? 'bullseye' : 'braa')) === 'bullseye' && p.bandsBE;
  const lines = useBE ? p.bandsBE! : p.bands;
  const head = p.totalBandits === 1 ? 'PICTURE — single' : `PICTURE — ${p.totalBandits} contact${p.totalBandits === 1 ? '' : 's'}`;
  return [head, ...lines.map((b) => `  ${b.band.toUpperCase()}: ${b.line}`)].join('\n');
}
