/**
 * Tests for detectCarrierInfo (v1.19.53).
 *
 * Tester report 2026-06-09: CVN-73 USS George Washington was being
 * detected as CVN-71 Roosevelt — auto-set TACAN to channel 71 and
 * displayed "Blue Ghost" callsign. Two root causes:
 *   1. CVN-73 HULL_DB entry had wrong callsign ("Blue Ghost" is
 *      CV-16 USS Lexington, not GW). Same for the `washington`
 *      lowercase entry.
 *   2. The HULL_DB scan iterated in insertion order. DCS reuses the
 *      `CVN_71` unit type across skin variants, so a group named
 *      "CVN-73" with unit type "CVN_71_Washington" hit `CVN-71` first
 *      and returned tacan=71.
 *
 * Fix: 4-tier priority — group-name hull number wins over unit-type
 * hull number wins over group-name keyword wins over unit-type keyword.
 */

import { describe, it, expect } from 'vitest';
import { detectCarrierInfo, findHullDefaults } from './CarrierSetupPanel';
import type { MissionGroup } from '../../types/mission';

function group(overrides: Partial<MissionGroup> & { unitType?: string } = {}): MissionGroup {
  const { unitType, ...rest } = overrides;
  return {
    groupId: 1,
    groupName: 'CVN-73',
    coalition: 'blue',
    country: 'USA',
    category: 'ship',
    task: '',
    frequency: 0,
    modulation: 0,
    units: [{
      unitId: 1, name: 'CVN', type: unitType || 'CVN_71',
      x: 0, y: 0, heading: 0, payload: { pylons: [] }, livery_id: '',
    } as never],
    waypoints: [],
    ...rest,
  };
}

describe('detectCarrierInfo — hull priority (v1.19.53 fix)', () => {
  it('CVN-73 in group name beats CVN-71 in unit type', () => {
    // The headline bug: group says CVN-73 (Washington), unit type is
    // the legacy DCS Supercarrier `CVN_71` reused by Washington skin.
    // Group name MUST win.
    const info = detectCarrierInfo(group({
      groupName: 'CVN-73 George Washington',
      unitType: 'CVN_71_Washington',
    }));
    expect(info.tacanCh).toBe(73);
    expect(info.callsign).toBe('War Fighter');
  });

  it('CVN-73 callsign is War Fighter, not Blue Ghost', () => {
    // CV-16 USS Lexington is Blue Ghost (WWII Essex-class). CVN-73 GW
    // is War Fighter. This regression was the original symptom.
    const info = detectCarrierInfo(group({ groupName: 'CVN-73' }));
    expect(info.callsign).toBe('War Fighter');
    expect(info.callsign).not.toBe('Blue Ghost');
  });

  it('washington keyword in group name also returns War Fighter', () => {
    // Same fix applied to the lowercase `washington` HULL_DB entry —
    // a user-named group "USS Washington CSG" should also get the
    // correct callsign even without the hull number in the name.
    const info = detectCarrierInfo(group({
      groupName: 'USS Washington CSG',
      unitType: 'CVN_71',
    }));
    expect(info.callsign).toBe('War Fighter');
    expect(info.tacanCh).toBe(73);
  });

  it('still matches CVN-71 correctly when that is genuinely the carrier', () => {
    const info = detectCarrierInfo(group({
      groupName: 'CVN-71 Roosevelt',
      unitType: 'CVN_71',
    }));
    expect(info.tacanCh).toBe(71);
    expect(info.callsign).toBe('Rough Rider');
  });

  it('CVN-72 wins over a stray CVN-71 unit type', () => {
    const info = detectCarrierInfo(group({
      groupName: 'CVN-72 Lincoln',
      unitType: 'CVN_71_Lincoln',
    }));
    expect(info.tacanCh).toBe(72);
    expect(info.callsign).toBe('Lucky Abe');
  });

  it('group-name hull number wins for vinson + roosevelt mismatches too', () => {
    const v = detectCarrierInfo(group({ groupName: 'CVN-70 Vinson', unitType: 'CVN_71' }));
    expect(v.tacanCh).toBe(70);
    expect(v.callsign).toBe('Golden Eagle');
    const r = detectCarrierInfo(group({ groupName: 'CVN-71 TR', unitType: 'Stennis' }));
    expect(r.tacanCh).toBe(71);
    expect(r.callsign).toBe('Rough Rider');
  });

  it('existing .miz TACAN overrides hull-DB default', () => {
    // A planner who manually configured TACAN 99X on the carrier
    // shouldn't have us overwrite it. (Same rule as before — sanity
    // check the override layer still works after the priority rewrite.)
    const g = group({
      groupName: 'CVN-73',
      tacan: { channel: 99, band: 'X', callsign: 'GW99' },
    });
    const info = detectCarrierInfo(g);
    expect(info.tacanCh).toBe(99);
    expect(info.tacanCallsign).toBe('GW99');
    // But the CARRIER callsign + hull data still come from the DB.
    expect(info.callsign).toBe('War Fighter');
  });

  it('unknown hull number falls through to generic CVN synth', () => {
    // CVN-99 is in nobody's DB — should still synth a sensible result
    // (tacan = hull number, generic "Carrier" callsign). Use a neutral
    // unit type so we don't accidentally hit a real DCS hull in tier 3.
    const info = detectCarrierInfo(group({ groupName: 'CVN-99', unitType: 'UnknownShip' }));
    expect(info.tacanCh).toBe(99);
    expect(info.callsign).toBe('Carrier');
    expect(info.label).toBe('CVN');
  });

  it('v1.19.61 — CVN_71_Washington unit type lands on Washington (not Roosevelt)', () => {
    // Tester re-report: "the carrier tab is still making the GW 71".
    // Residual case from v1.19.53: when the GROUP NAME doesn't identify
    // the hull, the unit type "CVN_71_Washington" used to match the
    // CVN-71 regex in tier 3 BEFORE the "washington" keyword in tier 4
    // → returned Rough Rider + tacan 71. Now the keyword runs first.
    const info = detectCarrierInfo(group({
      groupName: 'Carrier-1',  // no hull identifier — forces fall-through to utype
      unitType: 'CVN_71_Washington',
    }));
    expect(info.tacanCh).toBe(73);
    expect(info.callsign).toBe('War Fighter');
  });

  it('v1.19.61 — CVN_71_Roosevelt unit type still lands on Roosevelt', () => {
    // Symmetric regression: the swap must not break the Roosevelt case.
    const info = detectCarrierInfo(group({
      groupName: 'Carrier-1',
      unitType: 'CVN_71_Roosevelt',
    }));
    expect(info.tacanCh).toBe(71);
    expect(info.callsign).toBe('Rough Rider');
  });

  it('v1.19.61 — bare CVN_71 unit type with no skin keyword still maps to Roosevelt', () => {
    // When the utype carries ONLY the engine model number with no skin
    // suffix, tier 3 (keyword) fails and tier 4 (CVN-NN regex) is the
    // fallback. Should still resolve to CVN-71.
    const info = detectCarrierInfo(group({
      groupName: 'Carrier-1',
      unitType: 'CVN_71',
    }));
    expect(info.tacanCh).toBe(71);
    expect(info.callsign).toBe('Rough Rider');
  });

  it('LHA/LHD detection still works', () => {
    const info = detectCarrierInfo(group({
      groupName: 'LHA-1 Tarawa',
      unitType: 'LHA_Tarawa',
    }));
    expect(info.label).toBe('LHA');
    expect(info.hasIcls).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* v1.19.68 — findHullDefaults: hull-DB lookup with NO AWA overlay     */
/* ------------------------------------------------------------------ */

describe('findHullDefaults (v1.19.68 — sync-to-hull-DB helper)', () => {
  it('returns CVN-71 Roosevelt for a Roosevelt-keyword group', () => {
    const hull = findHullDefaults(group({
      groupName: 'Carrier-1',
      unitType: 'CVN_71_Roosevelt',
    }));
    expect(hull).not.toBeNull();
    expect(hull!.tacan).toBe(71);
    expect(hull!.callsign).toBe('Rough Rider');
  });

  it('returns CVN-73 War Fighter for CVN-73 in group name', () => {
    const hull = findHullDefaults(group({
      groupName: 'CVN-73',
      unitType: 'CVN_71_Washington',
    }));
    expect(hull!.tacan).toBe(73);
    expect(hull!.callsign).toBe('War Fighter');
  });

  it('returns null for a custom carrier name with no recognised hull', () => {
    const hull = findHullDefaults(group({
      groupName: 'BlueWaterStrike-Lead',
      unitType: 'Type_071',
    }));
    expect(hull).toBeNull();
  });

  it('returns LHA hull (no ICLS) for tarawa', () => {
    const hull = findHullDefaults(group({
      groupName: 'LHA-Tarawa-1',
      unitType: 'LHA_Tarawa',
    }));
    expect(hull!.hasIcls).toBe(false);
    expect(hull!.tacan).toBe(1);
  });

  it('does NOT apply existing AWA overlay — sync would clobber to canonical', () => {
    // detectCarrierInfo would keep the AWA-set channel of 50 because
    // existing values win over the hull DB. findHullDefaults must
    // ignore the AWA entirely so the sync button does its job.
    const hull = findHullDefaults(group({
      groupName: 'CVN-71',
      tacan: { channel: 50, band: 'X', callsign: 'Custom' },
    }));
    expect(hull!.tacan).toBe(71);
    expect(hull!.callsign).toBe('Rough Rider');
  });
});
