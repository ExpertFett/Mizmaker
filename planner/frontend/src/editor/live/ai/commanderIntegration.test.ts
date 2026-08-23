/**
 * End-to-end through the real chain: agent loop → real tool schemas → real
 * executors → a fake Olympus.
 *
 * Only the model and the network are stubbed. This is the substitute for a
 * live-fire test against a real server — the Live terminal is behind Discord
 * auth, so this is the last point where the whole path can be exercised
 * automatically. It's what catches a mismatch between what the schemas let the
 * model say and what the executors actually do with it.
 */

import { describe, it, expect, vi } from 'vitest';
import { runCommanderTurn, type TurnFn } from './commanderAgent';
import { buildTools, describeToolCall } from './commanderTools';
import { executeCommanderTool } from './commanderExecutors';
import { buildCommanderSystem } from './commanderSystemPrompt';
import type { AnthropicAnyBlock } from '../../../ai/anthropicClient';
import type { CmdrUnit, CommanderEnv } from './commanderTypes';
import type { UnitDbEntry } from '../../../api/groups';

const SAM: CmdrUnit = {
  olympusID: 3001, name: 'S-300PS 40B6MD sr', unitName: 'SAM-1',
  groupName: 'SAM-1', category: 'GroundUnit', coalition: 1,
  alive: 1, controlled: 1, human: 0, ROE: 1, alarmState: 2,
  position: { lat: 41.5, lng: 41.5, alt: 100 },
};

const PLAYER: CmdrUnit = {
  olympusID: 9001, name: 'FA-18C_hornet', unitName: 'Viper 1-1',
  groupName: 'Viper', category: 'Aircraft', coalition: 2,
  alive: 1, controlled: 1, human: 1,
  position: { lat: 41.2, lng: 41.2, alt: 6096 },
};

const DB: Record<string, UnitDbEntry> = {
  'Su-27': { label: 'Su-27 Flanker-B', loadouts: [{ name: 'CAP', code: 'CAP_CODE', roles: ['CAP'] }] },
};

function makeEnv(sent: Array<{ command: string; params: Record<string, unknown> }>): CommanderEnv {
  return {
    getUnits: () => [SAM, PLAYER],
    getAirbases: () => [{ name: 'Batumi', lat: 41.6, lng: 41.6, coalition: 2 }],
    getBullseye: () => ({ lat: 41.0, lng: 41.0 }),
    caps: { spawn: true, command: true, delete: true, effects: true },
    send: async (command, params) => { sent.push({ command, params }); return { ok: true }; },
    getUnitDb: async () => DB,
  };
}

const tool = (id: string, name: string, input: Record<string, unknown>): AnthropicAnyBlock =>
  ({ type: 'tool_use', id, name, input });

function scripted(steps: Array<{ content: AnthropicAnyBlock[]; stopReason: string }>): TurnFn {
  let i = 0;
  return vi.fn(async () => {
    const s = steps[Math.min(i, steps.length - 1)];
    i++;
    return { content: s.content, stopReason: s.stopReason, usage: { input_tokens: 1, output_tokens: 1 }, model: 'claude-sonnet-5' };
  });
}

const CAPS = { spawn: true, command: true, delete: true, effects: true };

function run(steps: Array<{ content: AnthropicAnyBlock[]; stopReason: string }>, sent: Array<{ command: string; params: Record<string, unknown> }>) {
  const env = makeEnv(sent);
  return runCommanderTurn({
    apiKey: 'sk-ant-test',
    model: 'claude-sonnet-5',
    system: buildCommanderSystem({
      bullseye: env.getBullseye(), airbases: env.getAirbases(), caps: CAPS, role: 'admin',
    }),
    tools: buildTools(CAPS),
    history: [],
    userText: 'test order',
    executeTool: (name, input, includeProtected) =>
      executeCommanderTool(name, input, env, { includeProtected }),
    hooks: {
      requestApproval: async () => ({ approved: true as const, includeProtected: false }),
      onAssistantContent: () => {},
      onToolStatus: () => {},
      isCancelled: () => false,
    },
    turnFn: scripted(steps),
  });
}

describe('picture → order', () => {
  it('sends the right Olympus command for a weapons-hold order', async () => {
    const sent: Array<{ command: string; params: Record<string, unknown> }> = [];
    const r = await run([
      { content: [tool('t1', 'get_picture', { coalition: 'red' })], stopReason: 'tool_use' },
      { content: [tool('t2', 'set_behavior', { unit_ids: [3001], roe: 'hold' })], stopReason: 'tool_use' },
      { content: [{ type: 'text', text: 'SAM-1 is weapons hold.' }], stopReason: 'end_turn' },
    ], sent);

    expect(r.stopped).toBe('done');
    // ROE is 1-based on the wire: hold = 4.
    expect(sent).toEqual([{ command: 'setROE', params: { ID: 3001, ROE: 4 } }]);
  });

  it('feeds a picture the model can actually read IDs out of', async () => {
    const sent: Array<{ command: string; params: Record<string, unknown> }> = [];
    const r = await run([
      { content: [tool('t1', 'get_picture', {})], stopReason: 'tool_use' },
      { content: [{ type: 'text', text: 'ok' }], stopReason: 'end_turn' },
    ], sent);

    const result = r.messages
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .find((b) => b.type === 'tool_result');
    const text = String(result!.content);
    expect(text).toContain('3001|S-300PS 40B6MD sr|SAM-1|RED');
    expect(text).toContain('HUMAN');   // the player is flagged, not hidden
  });
});

describe('spawn round trip', () => {
  it('carries a searched unit type through to an exact Olympus spawn', async () => {
    const sent: Array<{ command: string; params: Record<string, unknown> }> = [];
    await run([
      { content: [tool('t1', 'search_unit_types', { category: 'aircraft', query: 'Su-27' })], stopReason: 'tool_use' },
      {
        content: [tool('t2', 'spawn_units', {
          category: 'aircraft', unit_type: 'Su-27', count: 2, coalition: 'red',
          lat: 69.06, lng: 18.55, altitude_ft: 20000, loadout_name: 'CAP',
        })],
        stopReason: 'tool_use',
      },
      { content: [{ type: 'text', text: 'Two Flankers inbound.' }], stopReason: 'end_turn' },
    ], sent);

    expect(sent).toHaveLength(1);
    expect(sent[0].command).toBe('spawnAircrafts');
    const units = sent[0].params.units as Array<Record<string, unknown>>;
    expect(units).toHaveLength(2);
    expect(units[0].unitType).toBe('Su-27');
    expect(units[0].altitude).toBe(6096);
    expect(units[0].loadout).toBe('CAP_CODE');
    // Extra keys here would make Olympus silently drop the spawn.
    expect(Object.keys(units[0]).sort()).toEqual(['altitude', 'liveryID', 'loadout', 'location', 'skill', 'unitType']);
  });
});

describe('safety rails hold end to end', () => {
  it('will not command a human-piloted unit even when the model asks', async () => {
    const sent: Array<{ command: string; params: Record<string, unknown> }> = [];
    const r = await run([
      { content: [tool('t1', 'set_behavior', { unit_ids: [9001], roe: 'free' })], stopReason: 'tool_use' },
      { content: [{ type: 'text', text: 'That one is a player.' }], stopReason: 'end_turn' },
    ], sent);

    expect(sent).toHaveLength(0);
    const result = r.messages
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .find((b) => b.type === 'tool_result');
    expect(result!.is_error).toBe(true);
    expect(String(result!.content)).toMatch(/human-piloted/);
  });

  it('reports a stale ID back to the model instead of retargeting', async () => {
    const sent: Array<{ command: string; params: Record<string, unknown> }> = [];
    const r = await run([
      { content: [tool('t1', 'delete_units', { unit_ids: [4242] })], stopReason: 'tool_use' },
      { content: [{ type: 'text', text: 'That unit is gone.' }], stopReason: 'end_turn' },
    ], sent);

    expect(sent).toHaveLength(0);
    const result = r.messages
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .find((b) => b.type === 'tool_result');
    expect(String(result!.content)).toMatch(/not in the current picture/);
  });

  it('every tool the schemas offer is executable', async () => {
    // Guards against a schema whose name has no executor branch — the model
    // would call it and get "not implemented" mid-mission.
    const env = makeEnv([]);
    for (const t of buildTools(CAPS)) {
      const r = await executeCommanderTool(t.name, {}, env);
      expect(r.text).not.toMatch(/is not implemented/);
      expect(r.text).not.toMatch(/^Unknown tool/);
    }
  });

  it('every tool the schemas offer has a human-readable card summary', async () => {
    for (const t of buildTools(CAPS)) {
      const s = describeToolCall(t.name, { unit_ids: [3001], lat: 1, lng: 2, kind: 'smoke' }, [SAM]);
      expect(s.length).toBeGreaterThan(0);
      // The fallback prints raw JSON — a sign the tool has no case arm.
      expect(s).not.toMatch(/^\w+\(\{/);
    }
  });
});
