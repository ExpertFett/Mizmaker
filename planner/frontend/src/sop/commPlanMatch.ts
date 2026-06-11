/**
 * Comm-plan matching + channel-building helpers (v1.19.79, task #61).
 *
 * Pure functions shared by the SOP Check discrepancy engine and the
 * Auto-Setup appliers so the two can't drift. No React, no stores —
 * just functions over MissionGroup[] and a CommPlan. Unit-testable.
 *
 * Two jobs:
 *   1. channelsFromCommPlan() — turn an airframe's button maps into the
 *      per-radio ChannelSpec[] the `radioPresets` edit + Radio applier
 *      consume. Mirrors RadioPresetsSection.buildPresetsFromCommPlan but
 *      in the writeback shape (freq_mhz, not display strings) and drops
 *      MIDS/empty buttons — only real radio frequencies get written to
 *      the .miz preset slots.
 *   2. matchAssetNets() — pair in-mission AI assets (tankers / AWACS)
 *      with the comm-plan nets that represent them, so we can enforce
 *      "the AI broadcasts on the freq the players will tune via presets."
 *      Matching is role + order based, NOT by callsign text: the card's
 *      net names ("Texaco 1") rarely match the mission author's group
 *      names ("Shell"), but the ROLE (tanker vs AWACS) is reliable.
 */

import { isPlayerGroup } from '../utils/groups';
import type { MissionGroup } from '../types/mission';
import type { CommNet, CommPlan } from './types';

/** The shape the `radioPresets` edit + backend writeback expect. */
export interface ChannelSpec {
  ch: number;
  freq_mhz: number;
  modulation: 0 | 1;
  name: string;
}

/**
 * Build per-radio channel lists from a comm plan's button maps for one
 * airframe. Returns a Map<radioNumber, ChannelSpec[]> or null when the
 * plan has no map for this airframe (caller falls back to heuristics).
 *
 * Only `radio`-kind nets with a real frequency become channels — MIDS
 * voice nets and empty buttons are skipped (they aren't .miz radio
 * presets). Channel numbers are preserved sparse: a map with buttons
 * {1, 11, 24} yields exactly those three channels, so a 24-preset
 * Tomcat radio survives intact.
 */
export function channelsFromCommPlan(
  aircraft: string,
  plan: CommPlan | undefined,
): Map<number, ChannelSpec[]> | null {
  if (!plan) return null;
  const maps = plan.maps.filter((m) => m.aircraft === aircraft);
  if (maps.length === 0) return null;

  const netById = new Map(plan.nets.map((n) => [n.id, n]));
  const out = new Map<number, ChannelSpec[]>();

  for (const m of maps) {
    const channels: ChannelSpec[] = [];
    for (const [btnStr, netId] of Object.entries(m.buttons)) {
      const ch = Number(btnStr);
      if (!Number.isFinite(ch) || ch <= 0) continue;
      const net = netById.get(netId);
      if (!net || net.kind !== 'radio' || net.frequency == null) continue;
      channels.push({
        ch,
        freq_mhz: net.frequency,
        modulation: net.modulation === 'FM' ? 1 : 0,
        name: net.name.slice(0, 16),
      });
    }
    if (channels.length > 0) {
      channels.sort((a, b) => a.ch - b.ch);
      out.set(m.radio, channels);
    }
  }
  return out.size > 0 ? out : null;
}

/* ------------------------------------------------------------------ */
/* AI-asset ↔ net role matching                                        */
/* ------------------------------------------------------------------ */

export type AssetRole = 'tanker' | 'awacs';

// Canonical DCS tanker/AWACS callsigns + the generic role words. Kept
// TIGHT on purpose: a false positive here makes the comms applier
// rewrite an AI group's frequency onto the wrong net. We dropped loose
// tokens that collide with real flight callsigns — "Boomer" (a player
// callsign), bare "E2"/"E3" (match "Colt E2"), "S3", "Ascot" (a
// transport callsign), "Basket"/"Petro". Aircraft designators require a
// hyphen (E-2/E-3, KC-135) so they can't match arbitrary words.
const TANKER_NET = /\b(texaco|shell|arco|exxon|tanker|kc-1[0-9]{2})\b/i;
const AWACS_NET = /\b(overlord|magic|wizard|darkstar|sentry|focus|awacs|hawkeye|e-[23])\b/i;

/** Classify a comm-plan net's name into an AI-asset role, or null. */
export function classifyNetRole(name: string): AssetRole | null {
  const n = name || '';
  if (TANKER_NET.test(n)) return 'tanker';
  if (AWACS_NET.test(n)) return 'awacs';
  return null;
}

/** Classify a mission group into an AI-asset role by task, then name. */
export function groupAssetRole(g: MissionGroup): AssetRole | null {
  if (isPlayerGroup(g)) return null;
  const task = (g.task || '').toLowerCase();
  if (task === 'refueling') return 'tanker';
  if (task === 'awacs') return 'awacs';
  const name = g.groupName || '';
  if (TANKER_NET.test(name)) return 'tanker';
  if (AWACS_NET.test(name)) return 'awacs';
  return null;
}

export interface AssetPairing {
  group: MissionGroup;
  net: CommNet;
  role: AssetRole;
}

/** First whitespace/hyphen-delimited word, lowercased — the callsign root. */
function firstWord(s: string): string {
  return (s || '').split(/[-\s]/)[0].toLowerCase();
}

/**
 * Pair in-mission AI assets with the comm-plan nets that represent
 * them. For each role (tanker, AWACS) we sort the mission groups and
 * the matching nets by name and pair them by index — so one tanker
 * lines up with the one tanker net, and "Texaco 1 / Texaco 2" line up
 * with two mission tankers in a stable order. Unpaired surplus on
 * either side is simply left out (no enforcement, no false flag).
 *
 * Order-based pairing is a heuristic; both the SOP Check row and the
 * applier surface exactly which group↔net pair they acted on so the
 * user can see and correct it.
 */
export function matchAssetNets(
  groups: MissionGroup[],
  plan: CommPlan | undefined,
): AssetPairing[] {
  if (!plan || plan.nets.length === 0) return [];
  const out: AssetPairing[] = [];

  for (const role of ['tanker', 'awacs'] as AssetRole[]) {
    const groupsOfRole = groups
      .filter((g) => groupAssetRole(g) === role)
      .sort((a, b) => (a.groupName || '').localeCompare(b.groupName || ''));
    const netsOfRole = plan.nets
      .filter((n) => n.kind === 'radio' && n.frequency != null && classifyNetRole(n.name) === role)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    // Pass 1 — match by callsign root: a group named "Shell" pairs with
    // the net whose name contains "shell" ("Shell 1"), regardless of
    // alphabetical position. This is the reliable signal when the card's
    // net names actually correspond to the mission's asset callsigns.
    const usedNet = new Set<number>();
    const leftover: MissionGroup[] = [];
    for (const g of groupsOfRole) {
      const gw = firstWord(g.groupName);
      const idx = gw
        ? netsOfRole.findIndex((n, i) => !usedNet.has(i) && n.name.toLowerCase().includes(gw))
        : -1;
      if (idx >= 0) {
        usedNet.add(idx);
        out.push({ group: g, net: netsOfRole[idx], role });
      } else {
        leftover.push(g);
      }
    }
    // Pass 2 — order-zip the remainder against still-unused nets. This is
    // the fallback for the common case where card names ("Texaco 1")
    // differ from mission callsigns ("Shell").
    const freeNets = netsOfRole.filter((_, i) => !usedNet.has(i));
    const pairs = Math.min(leftover.length, freeNets.length);
    for (let i = 0; i < pairs; i++) {
      out.push({ group: leftover[i], net: freeNets[i], role });
    }
  }
  return out;
}
