/**
 * Radio frequency in MHz, whatever unit it arrived in.
 *
 * Mission data is normalised at the parser (see normalize_freq_mhz in
 * miz_parser.py), so anything reaching a card from the .miz is already MHz.
 * SOP frequencies are not: they come from what a planner typed or what the
 * vision extractor read off a squadron sheet, either of which can produce
 * 251000000 or 251000 instead of 251.
 *
 * Mirrors the backend's rule so both sides agree. Safe because the ranges do
 * not overlap — a DCS radio spans roughly 30-400 MHz, so nothing real lands
 * between 1,000 and 1,000,000.
 */
export function toMhz(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value) || value <= 0) return 0;
  if (value >= 1e6) return value / 1e6;   // Hz
  if (value >= 1e3) return value / 1e3;   // kHz
  return value;                            // already MHz
}
