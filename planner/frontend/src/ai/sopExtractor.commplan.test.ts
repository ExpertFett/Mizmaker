/**
 * Tests for the radio-preset-card → comm plan merge (v1.19.78).
 *
 * The AI vision call can't be unit-tested (needs a key + an image), but
 * mergePartialIntoSop's comm-plan handling is pure: it resolves the
 * model's button→net-NAME maps into the id-referenced CommPlan, dedupes
 * nets by name across radios, honours >20 buttons (Tomcat 24), maps the
 * airframe title to a DCS type, and respects "user map wins on
 * re-import". Those are the correctness guarantees worth locking down.
 */

import { describe, it, expect } from 'vitest';
import { mergePartialIntoSop } from './sopExtractor';
import { makeEmptySop } from '../sop/types';

// A slice of the real Hornet card: two radios sharing core nets (App. A
// on both = ONE net), AI-variant services as distinct nets, a MIDS net,
// and the VHF JTAC net the band rules care about.
const hornetPartial = {
  commPlan: {
    aircraftTitle: 'Hornet',
    nets: [
      { name: 'Tower CVN', kind: 'radio', frequency: 228.5, modulation: 'AM' },
      { name: 'AI Tower CVN', kind: 'radio', frequency: 228.55, modulation: 'AM' },
      { name: 'App. A CVN', kind: 'radio', frequency: 228.0, modulation: 'AM' },
      { name: 'Marshal CVN', kind: 'radio', frequency: 306.0, modulation: 'AM' },
      { name: 'Texaco 1', kind: 'radio', frequency: 332.1, modulation: 'AM' },
      { name: 'JTAC 1', kind: 'radio', frequency: 142.1, modulation: 'AM' },
      { name: 'MIDS A Flight', kind: 'midsA', midsChannel: 1 },
    ],
    radioMaps: [
      { radio: 1, radioLabel: 'Radio 1', buttons: { '1': 'Tower CVN', '2': 'App. A CVN', '3': 'Marshal CVN', '11': 'Texaco 1' } },
      { radio: 2, radioLabel: 'Radio 2', buttons: { '1': 'AI Tower CVN', '2': 'App. A CVN', '18': 'JTAC 1', '19': 'MIDS A Flight' } },
    ],
  },
};

describe('mergePartialIntoSop — comm plan', () => {
  it('builds a comm plan with deduped nets and id-referenced button maps', () => {
    const sop = mergePartialIntoSop(makeEmptySop(), hornetPartial as never);
    const plan = sop.commPlan!;
    expect(plan).toBeTruthy();
    // App. A CVN appears on both radios but must be ONE net.
    expect(plan.nets.length).toBe(7);
    expect(plan.nets.filter((n) => n.name === 'App. A CVN').length).toBe(1);
    // Two radio maps, mapped to the DCS type, not the title word.
    expect(plan.maps.length).toBe(2);
    expect(plan.maps.every((m) => m.aircraft === 'FA-18C_hornet')).toBe(true);
  });

  it('resolves button net-names to existing net ids (no dangles)', () => {
    const sop = mergePartialIntoSop(makeEmptySop(), hornetPartial as never);
    const plan = sop.commPlan!;
    const ids = new Set(plan.nets.map((n) => n.id));
    for (const m of plan.maps) {
      for (const netId of Object.values(m.buttons)) {
        expect(ids.has(netId)).toBe(true);
      }
    }
    // Button 1 on both radios resolves to DIFFERENT nets (Tower vs AI Tower).
    const r1 = plan.maps.find((m) => m.radio === 1)!;
    const r2 = plan.maps.find((m) => m.radio === 2)!;
    expect(r1.buttons[1]).not.toBe(r2.buttons[1]);
    const towerNet = plan.nets.find((n) => n.id === r1.buttons[1]);
    expect(towerNet?.name).toBe('Tower CVN');
    expect(towerNet?.frequency).toBe(228.5);
  });

  it('preserves MIDS nets as voice (channel, no frequency)', () => {
    const sop = mergePartialIntoSop(makeEmptySop(), hornetPartial as never);
    const mids = sop.commPlan!.nets.find((n) => n.name === 'MIDS A Flight')!;
    expect(mids.kind).toBe('midsA');
    expect(mids.midsChannel).toBe(1);
    expect(mids.frequency).toBeUndefined();
  });

  it('honours >20 buttons (Tomcat radio with 24 presets)', () => {
    const tomcat = {
      commPlan: {
        aircraftTitle: 'Tomcat',
        nets: [
          { name: 'JTAC 2', kind: 'radio', frequency: 142.2, modulation: 'AM' },
          { name: 'Silver', kind: 'radio', frequency: 153.0, modulation: 'AM' },
        ],
        radioMaps: [
          { radio: 1, radioLabel: 'Rear', buttons: { '21': 'Silver', '24': 'JTAC 2' } },
        ],
      },
    };
    const sop = mergePartialIntoSop(makeEmptySop(), tomcat as never);
    const map = sop.commPlan!.maps[0];
    expect(map.aircraft).toBe('F-14B');
    expect(Object.keys(map.buttons).map(Number).sort((a, b) => a - b)).toEqual([21, 24]);
  });

  it('does not overwrite a user-built map on re-import (user wins)', () => {
    let sop = mergePartialIntoSop(makeEmptySop(), hornetPartial as never);
    // Simulate a user edit: blank out radio 1's buttons.
    sop = { ...sop, commPlan: { ...sop.commPlan!, maps: sop.commPlan!.maps.map((m) => m.radio === 1 ? { ...m, buttons: {} } : m) } };
    // Re-import the same card.
    const after = mergePartialIntoSop(sop, hornetPartial as never);
    const r1 = after.commPlan!.maps.find((m) => m.radio === 1)!;
    // Still blank — the re-import didn't clobber the user's edit.
    expect(Object.keys(r1.buttons).length).toBe(0);
  });
});
