/**
 * useEffectiveGroups — single source of truth for "what does the user
 * actually see in the .miz on download?"
 *
 * Background. The planner has two parallel state systems:
 *   missionStore.groups  — the read-only display of what's CURRENTLY
 *                          in the session's mission_text on the backend
 *   editStore.edits      — the queued edits that will be APPLIED on the
 *                          next download (POST /api/download with
 *                          unitEdits, then surgical text replacement)
 *
 * Tabs that display group-level fields used to read missionStore only,
 * so a value the user edited in tab A wouldn't show up in tab B until
 * after a download + re-upload round-trip. The bug class hit TacanTab in
 * v1.19.62 (Carrier panel's TACAN edits didn't reflect there) and the
 * Fable audit (2026-06-09) found 4 more tabs with the same gap: DtcTab,
 * CommCardTab, BriefGenTab, KneeboardTab. This hook generalises the
 * v1.19.62 overlay so every consumer gets the same merged view in one
 * line of code, and a future field-type addition only needs editing
 * here.
 *
 * What it overlays today:
 *   - tacan (channel / band / callsign)  — from `tacan` edits
 *   - icls  (channel)                    — from `icls` edits
 *   - frequency                          — from `groupFrequency` edits
 *
 * Edits are append-no-dedup; the backend processes them in order with
 * last-wins. We mirror that here so the preview matches the eventual
 * .miz: later staged edits overwrite earlier ones for the same field
 * on the same groupId.
 *
 * What it does NOT overlay (intentionally):
 *   - radioFrequency edits   — these are PER-UNIT (BatchEditTab,
 *                              BattlefieldCommandersTab, JtacSetupPanel
 *                              dispatch them with unitId, not groupId).
 *                              Group display fields don't read them.
 *                              A unit-level overlay can live alongside
 *                              once a consumer needs it.
 *   - renames / loadout / waypoints — owned by their own stores
 *                              (allGroupsRenamer, clientUnits, etc.).
 */

import { useMemo } from 'react';
import { useMissionStore } from './missionStore';
import { useEditStore } from './editStore';
import type { MissionGroup } from '../types/mission';

type AnyEdit = {
  field?: string;
  groupId?: number;
  value?: unknown;
};

type TacanValue = {
  channel?: number;
  band?: string;
  callsign?: string;
};

type IclsValue = {
  channel?: number;
};

/**
 * Pure merge — given a groups array and the current edits queue,
 * return groups with staged group-level overlays applied. No React,
 * no store reads — call sites that already have both arrays in hand
 * (or that need a snapshot from an async handler) use this directly.
 */
export function mergeStagedIntoGroups(
  groups: MissionGroup[],
  edits: readonly unknown[],
): MissionGroup[] {
  const tacanByGid = new Map<number, TacanValue>();
  const iclsByGid = new Map<number, number>();
  const freqByGid = new Map<number, number>();

  for (const raw of edits) {
    const e = raw as AnyEdit;
    if (e.groupId == null) continue;

    if (e.field === 'tacan' && e.value && typeof e.value === 'object') {
      tacanByGid.set(e.groupId, e.value as TacanValue);
    } else if (e.field === 'icls' && e.value && typeof e.value === 'object') {
      const ch = (e.value as IclsValue).channel;
      if (typeof ch === 'number') iclsByGid.set(e.groupId, ch);
    } else if (e.field === 'groupFrequency' && typeof e.value === 'number') {
      freqByGid.set(e.groupId, e.value);
    }
  }

  if (tacanByGid.size === 0 && iclsByGid.size === 0 && freqByGid.size === 0) {
    return groups;
  }

  return groups.map((g) => {
    const tacanOv = tacanByGid.get(g.groupId);
    const iclsCh = iclsByGid.get(g.groupId);
    const freqHz = freqByGid.get(g.groupId);
    if (!tacanOv && iclsCh == null && freqHz == null) return g;

    const next: MissionGroup = { ...g };
    if (tacanOv) {
      const base = g.tacan ?? { channel: 0, band: 'X', callsign: '' };
      next.tacan = {
        channel: tacanOv.channel ?? base.channel,
        band: tacanOv.band ?? base.band,
        callsign: tacanOv.callsign ?? base.callsign,
      };
    }
    if (iclsCh != null) {
      next.icls = { channel: iclsCh };
    }
    if (freqHz != null) {
      next.frequency = freqHz;
    }
    return next;
  });
}

export function useEffectiveGroups(): MissionGroup[] {
  const groups = useMissionStore((s) => s.groups);
  const edits = useEditStore((s) => s.edits);
  return useMemo(() => mergeStagedIntoGroups(groups, edits), [groups, edits]);
}

/**
 * Snapshot version of `useEffectiveGroups` for imperative call sites
 * (event handlers, async render pipelines). Reads the current store
 * state once — does NOT subscribe. Use the hook in render bodies.
 */
export function getEffectiveGroupsSnapshot(): MissionGroup[] {
  const groups = useMissionStore.getState().groups;
  const edits = useEditStore.getState().edits;
  return mergeStagedIntoGroups(groups, edits);
}
