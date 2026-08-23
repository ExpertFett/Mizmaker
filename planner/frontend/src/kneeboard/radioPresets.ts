/**
 * Preset-channel annotation for kneeboard cards.
 *
 * A frequency alone makes a pilot dial manually. What the jet actually has
 * is a programmed preset — VMFA-224 runs Strike on channel 5 of both radios
 * — so a card that prints "288.000 AM" is hiding the one number the pilot
 * would rather use. Every client unit's `Radio[]` block is already parsed
 * out of the .miz into ClientUnit.radioPresets, so the channel can be
 * recovered by matching the frequency; nothing has to be typed in.
 *
 * Suffix convention follows the Hornet's two radios: radio 1 is COMM1 (left)
 * and radio 2 is COMM2 (right).
 *   (5)      same channel on both radios — the common squadron case
 *   (5L)     left radio only
 *   (5L/7R)  programmed on both, different channels
 */

import type { RadioPresetRadio } from '../types/mission';

/** Frequencies come from several parsers at slightly different precision;
 *  1 kHz is tighter than any real channel spacing and loose enough to
 *  survive a float round-trip. */
const MATCH_TOLERANCE_MHZ = 0.001;

/** Default radio labels — the Hornet's COMM1/COMM2. Other airframes name
 *  their radios differently, so the caller can pass its own pair. */
const RADIO_SUFFIX: Record<number, string> = { 1: 'L', 2: 'R' };

/**
 * Find the preset channel(s) carrying `freqMhz`.
 *
 * Returns "" when nothing matches — callers can append unconditionally.
 */
export function presetLabel(
  freqMhz: number | null | undefined,
  presets: RadioPresetRadio[] | undefined,
  labels?: readonly [string, string],
): string {
  if (freqMhz == null || !Number.isFinite(freqMhz) || !presets?.length) return '';

  const hits: { radio: number; ch: number }[] = [];
  for (const r of presets) {
    const match = r.channels.find((c) => Math.abs(c.freq_mhz - freqMhz) <= MATCH_TOLERANCE_MHZ);
    if (match) hits.push({ radio: r.radio, ch: match.ch });
  }
  if (!hits.length) return '';

  // Programmed identically on every radio it appears on, and on more than
  // one — no point spelling out which side.
  const channels = new Set(hits.map((h) => h.ch));
  if (hits.length > 1 && channels.size === 1) return `(${hits[0].ch})`;

  const suffix = (radio: number) =>
    (labels ? labels[radio - 1] : RADIO_SUFFIX[radio]) ?? String(radio);
  return `(${hits.map((h) => `${h.ch}${suffix(h.radio)}`).join('/')})`;
}

/** `freq` + its preset annotation, space-separated, with neither half
 *  forced when the other is missing. */
export function freqWithPreset(
  text: string,
  freqMhz: number | null | undefined,
  presets: RadioPresetRadio[] | undefined,
  labels?: readonly [string, string],
): string {
  const label = presetLabel(freqMhz, presets, labels);
  return label ? `${text} ${label}` : text;
}

/**
 * The presets to annotate a card with.
 *
 * Shared (non-flight) cards still want annotations, so they fall back to the
 * first client unit that has any. Presets are per-airframe, so a mixed
 * package can only ever be annotated for one of them — flight cards should
 * pass their own unit's presets rather than relying on this.
 */
export function presetsForUnits(
  units: { radioPresets?: RadioPresetRadio[] }[] | undefined,
): RadioPresetRadio[] | undefined {
  return units?.find((u) => u.radioPresets?.length)?.radioPresets;
}
