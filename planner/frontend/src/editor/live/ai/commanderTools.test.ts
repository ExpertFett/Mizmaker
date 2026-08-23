/**
 * Tool schemas, capability gating, and the approval-card summaries.
 *
 * The gating tests matter because the tool list is what the model believes it
 * can do — offering a spawn tool to an ATC seat produces a confusing refusal
 * from the backend instead of an honest "you can't do that here".
 */

import { describe, it, expect } from 'vitest';
import {
  alwaysConfirm, buildTools, describeToolCall, isKnownTool, isMutating, requiredCap,
} from './commanderTools';
import type { CmdrCaps, CmdrUnit } from './commanderTypes';

const ALL: CmdrCaps = { spawn: true, command: true, delete: true, effects: true };
const OBSERVER: CmdrCaps = { spawn: false, command: false, delete: false, effects: false };
const JTAC: CmdrCaps = { spawn: false, command: false, delete: false, effects: true };
const COMMANDER: CmdrCaps = { spawn: true, command: true, delete: true, effects: true };

const names = (caps: CmdrCaps) => buildTools(caps).map((t) => t.name).sort();

describe('buildTools', () => {
  it('offers the full set to a commander', () => {
    expect(names(COMMANDER)).toEqual([
      'attack_unit', 'delete_units', 'fire_at_point', 'get_airbases', 'get_bullseye',
      'get_picture', 'move_units', 'search_unit_types', 'set_altitude_speed',
      'set_behavior', 'spawn_effect', 'spawn_units',
    ]);
  });

  it('offers nothing to an observer', () => {
    expect(buildTools(OBSERVER)).toEqual([]);
  });

  it('offers a JTAC only its effects tool — no read tools, no commands', () => {
    expect(names(JTAC)).toEqual(['spawn_effect']);
  });

  it('withholds spawn and delete from a command-only role', () => {
    const n = names({ spawn: false, command: true, delete: false, effects: false });
    expect(n).not.toContain('spawn_units');
    expect(n).not.toContain('delete_units');
    expect(n).toContain('set_behavior');
  });

  it('produces well-formed schemas', () => {
    for (const t of buildTools(ALL)) {
      expect(t.name).toBeTruthy();
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.input_schema.type).toBe('object');
      expect(t.input_schema.properties).toBeTypeOf('object');
      for (const req of t.input_schema.required || []) {
        expect(Object.keys(t.input_schema.properties)).toContain(req);
      }
    }
  });
});

describe('classification', () => {
  it('treats the four read tools as non-mutating', () => {
    for (const n of ['get_picture', 'search_unit_types', 'get_airbases', 'get_bullseye']) {
      expect(isMutating(n)).toBe(false);
    }
  });
  it('treats everything else as mutating', () => {
    for (const n of ['spawn_units', 'move_units', 'set_behavior', 'delete_units', 'spawn_effect']) {
      expect(isMutating(n)).toBe(true);
    }
  });
  it('recognises its own tool names', () => {
    expect(isKnownTool('get_picture')).toBe(true);
    expect(isKnownTool('rm_rf')).toBe(false);
  });
  it('maps tools to the capability they need', () => {
    expect(requiredCap('spawn_units')).toBe('spawn');
    expect(requiredCap('delete_units')).toBe('delete');
    expect(requiredCap('spawn_effect')).toBe('effects');
    expect(requiredCap('nope')).toBeNull();
  });
});

describe('alwaysConfirm', () => {
  it('always confirms a delete, even in auto-execute', () => {
    expect(alwaysConfirm('delete_units', { unit_ids: [1] })).toBe(true);
  });
  it('always confirms an explosion but not smoke', () => {
    expect(alwaysConfirm('spawn_effect', { kind: 'explosion' })).toBe(true);
    expect(alwaysConfirm('spawn_effect', { kind: 'smoke' })).toBe(false);
  });
  it('does not force confirmation on routine orders', () => {
    expect(alwaysConfirm('set_behavior', {})).toBe(false);
    expect(alwaysConfirm('spawn_units', {})).toBe(false);
  });
});

describe('describeToolCall', () => {
  const units: CmdrUnit[] = [
    { olympusID: 1, unitName: 'Enfield 1-1', name: 'FA-18C_hornet' },
    { olympusID: 2, unitName: 'Enfield 1-2', name: 'FA-18C_hornet' },
    { olympusID: 3, groupName: 'SAM-1', name: 'S-300PS' },
    { olympusID: 4, unitName: 'Dodge 1', name: 'Su-27' },
  ];

  it('describes a spawn with count, coalition and altitude', () => {
    const s = describeToolCall('spawn_units', {
      unit_type: 'Su-27', count: 2, coalition: 'red', lat: 69.06, lng: 18.55, altitude_ft: 20000,
    }, units);
    expect(s).toContain('2× Su-27');
    expect(s).toContain('RED');
    expect(s).toContain('20,000 ft');
  });

  it('spells out the ROE in words a GM would recognise', () => {
    const s = describeToolCall('set_behavior', { unit_ids: [3], roe: 'hold' }, units);
    expect(s).toContain('WEAPONS HOLD');
    expect(s).toContain('SAM-1 (#3)');
  });

  it('names the first few units and counts the rest', () => {
    const s = describeToolCall('move_units', { unit_ids: [1, 2, 3, 4], path: [{ lat: 1, lng: 2 }] }, units);
    expect(s).toContain('Enfield 1-1 (#1)');
    expect(s).toContain('+1 more');
  });

  it('shouts about a delete', () => {
    expect(describeToolCall('delete_units', { unit_ids: [1] }, units)).toMatch(/^DELETE/);
  });

  it('falls back to a raw id for a unit that is no longer in the picture', () => {
    expect(describeToolCall('delete_units', { unit_ids: [999] }, units)).toContain('#999');
  });

  it('names the attack target', () => {
    const s = describeToolCall('attack_unit', { unit_ids: [1], target_id: 4 }, units);
    expect(s).toContain('Dodge 1 (#4)');
  });
});
