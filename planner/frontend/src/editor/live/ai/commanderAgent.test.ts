/**
 * The tool-use loop.
 *
 * turnFn is injected, so these exercise the real control flow with a scripted
 * API. The verbatim-echo test is the load-bearing one: current models return
 * thinking blocks with signatures, and filtering or reordering them 400s the
 * next call — a failure that only appears on the second iteration.
 */

import { describe, it, expect, vi } from 'vitest';
import { runCommanderTurn, type AgentHooks, type TurnFn } from './commanderAgent';
import type { AnthropicAnyBlock } from '../../../ai/anthropicClient';

const text = (t: string): AnthropicAnyBlock => ({ type: 'text', text: t });
const toolUse = (id: string, name: string, input: Record<string, unknown> = {}): AnthropicAnyBlock =>
  ({ type: 'tool_use', id, name, input });

function makeHooks(over: Partial<AgentHooks> = {}): AgentHooks {
  return {
    requestApproval: vi.fn(async () => ({ approved: true as const, includeProtected: false })),
    onAssistantContent: vi.fn(),
    onToolStatus: vi.fn(),
    isCancelled: () => false,
    ...over,
  };
}

/** Scripted API: one entry per expected iteration. */
function scriptedTurn(script: Array<{ content: AnthropicAnyBlock[]; stopReason: string }>): TurnFn {
  let i = 0;
  return vi.fn(async () => {
    const step = script[Math.min(i, script.length - 1)];
    i++;
    return {
      content: step.content,
      stopReason: step.stopReason,
      usage: { input_tokens: 10, output_tokens: 5 },
      model: 'claude-sonnet-5',
    };
  });
}

const base = {
  apiKey: 'sk-ant-test',
  model: 'claude-sonnet-5',
  system: 'sys',
  tools: [],
  history: [],
  userText: 'make the SAM go weapons hold',
};

describe('runCommanderTurn', () => {
  it('returns immediately on end_turn', async () => {
    const r = await runCommanderTurn({
      ...base,
      executeTool: vi.fn(),
      hooks: makeHooks(),
      turnFn: scriptedTurn([{ content: [text('Copy.')], stopReason: 'end_turn' }]),
    });
    expect(r.stopped).toBe('done');
    expect(r.messages.at(-1)).toEqual({ role: 'assistant', content: [text('Copy.')] });
  });

  it('executes a tool call and feeds the result back for a second turn', async () => {
    const executeTool = vi.fn(async () => ({ text: '✓ setROE sent to 1/1 units' }));
    const turnFn = scriptedTurn([
      { content: [toolUse('tu_1', 'set_behavior', { unit_ids: [1], roe: 'hold' })], stopReason: 'tool_use' },
      { content: [text('SAM is weapons hold.')], stopReason: 'end_turn' },
    ]);

    const r = await runCommanderTurn({ ...base, executeTool, hooks: makeHooks(), turnFn });

    expect(executeTool).toHaveBeenCalledWith('set_behavior', { unit_ids: [1], roe: 'hold' }, false);
    expect(turnFn).toHaveBeenCalledTimes(2);
    expect(r.stopped).toBe('done');
  });

  it('puts every tool result in ONE user message', async () => {
    const turnFn = scriptedTurn([
      {
        content: [toolUse('tu_1', 'get_picture'), toolUse('tu_2', 'get_bullseye')],
        stopReason: 'tool_use',
      },
      { content: [text('done')], stopReason: 'end_turn' },
    ]);
    const r = await runCommanderTurn({
      ...base,
      executeTool: vi.fn(async () => ({ text: 'ok' })),
      hooks: makeHooks(),
      turnFn,
    });

    const resultMsgs = r.messages.filter(
      (m) => m.role === 'user' && Array.isArray(m.content)
        && (m.content as AnthropicAnyBlock[]).some((b) => b.type === 'tool_result'),
    );
    expect(resultMsgs).toHaveLength(1);
    expect(resultMsgs[0].content as AnthropicAnyBlock[]).toHaveLength(2);
  });

  it('echoes assistant content verbatim, including unknown block types', async () => {
    // A thinking block carries a signature; altering it breaks the next call.
    const thinking: AnthropicAnyBlock = { type: 'thinking', thinking: '', signature: 'sig-abc' };
    const blocks = [thinking, text('Copy.')];
    const r = await runCommanderTurn({
      ...base,
      executeTool: vi.fn(),
      hooks: makeHooks(),
      turnFn: scriptedTurn([{ content: blocks, stopReason: 'end_turn' }]),
    });
    expect(r.messages.at(-1)!.content).toEqual(blocks);
    expect((r.messages.at(-1)!.content as AnthropicAnyBlock[])[0]).toBe(thinking);
  });

  it('does not execute a denied tool but still returns a tool_result for it', async () => {
    const executeTool = vi.fn();
    const hooks = makeHooks({
      requestApproval: vi.fn(async () => ({ approved: false as const, reason: 'wrong group' })),
    });
    const turnFn = scriptedTurn([
      { content: [toolUse('tu_1', 'delete_units', { unit_ids: [1] })], stopReason: 'tool_use' },
      { content: [text('Understood, holding.')], stopReason: 'end_turn' },
    ]);

    const r = await runCommanderTurn({ ...base, executeTool, hooks, turnFn });

    expect(executeTool).not.toHaveBeenCalled();
    const results = r.messages
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .filter((b) => b.type === 'tool_result');
    expect(results).toHaveLength(1);
    expect(String(results[0].content)).toMatch(/Denied by the Game Master: wrong group/);
    expect(hooks.onToolStatus).toHaveBeenCalledWith('tu_1', 'denied');
  });

  it('marks a failing tool as an error result rather than throwing', async () => {
    const turnFn = scriptedTurn([
      { content: [toolUse('tu_1', 'set_behavior')], stopReason: 'tool_use' },
      { content: [text('That failed.')], stopReason: 'end_turn' },
    ]);
    const r = await runCommanderTurn({
      ...base,
      executeTool: vi.fn(async () => { throw new Error('relay down'); }),
      hooks: makeHooks(),
      turnFn,
    });
    const result = r.messages
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .find((b) => b.type === 'tool_result');
    expect(result!.is_error).toBe(true);
    expect(String(result!.content)).toMatch(/relay down/);
  });

  it('stops at the iteration cap when the model keeps calling tools', async () => {
    const turnFn = scriptedTurn([{ content: [toolUse('tu_x', 'get_picture')], stopReason: 'tool_use' }]);
    const r = await runCommanderTurn({
      ...base,
      executeTool: vi.fn(async () => ({ text: 'ok' })),
      hooks: makeHooks(),
      turnFn,
      maxIterations: 3,
    });
    expect(r.stopped).toBe('iteration_cap');
    expect(turnFn).toHaveBeenCalledTimes(3);
  });

  it('accumulates usage across iterations', async () => {
    const turnFn = scriptedTurn([
      { content: [toolUse('tu_1', 'get_picture')], stopReason: 'tool_use' },
      { content: [text('done')], stopReason: 'end_turn' },
    ]);
    const r = await runCommanderTurn({
      ...base, executeTool: vi.fn(async () => ({ text: 'ok' })), hooks: makeHooks(), turnFn,
    });
    expect(r.usage).toEqual({ input: 20, output: 10 });
  });

  it('surfaces a refusal as its own terminal state', async () => {
    const r = await runCommanderTurn({
      ...base,
      executeTool: vi.fn(),
      hooks: makeHooks(),
      turnFn: scriptedTurn([{ content: [], stopReason: 'refusal' }]),
    });
    expect(r.stopped).toBe('refusal');
  });

  it('reports max_tokens separately so the UI can suggest a shorter order', async () => {
    const r = await runCommanderTurn({
      ...base,
      executeTool: vi.fn(),
      hooks: makeHooks(),
      turnFn: scriptedTurn([{ content: [text('half a sen')], stopReason: 'max_tokens' }]),
    });
    expect(r.stopped).toBe('max_tokens');
  });

  it('stops before calling the API when already cancelled', async () => {
    const turnFn = scriptedTurn([{ content: [text('hi')], stopReason: 'end_turn' }]);
    const r = await runCommanderTurn({
      ...base,
      executeTool: vi.fn(),
      hooks: makeHooks({ isCancelled: () => true }),
      turnFn,
    });
    expect(r.stopped).toBe('cancelled');
    expect(turnFn).not.toHaveBeenCalled();
  });

  it('closes out every pending tool id when cancelled mid-batch', async () => {
    // An unmatched tool_use id would 400 the next request.
    let cancelled = false;
    const hooks = makeHooks({
      isCancelled: () => cancelled,
      requestApproval: vi.fn(async () => { cancelled = true; return { approved: true as const, includeProtected: false }; }),
    });
    const turnFn = scriptedTurn([
      { content: [toolUse('tu_1', 'get_picture'), toolUse('tu_2', 'get_bullseye')], stopReason: 'tool_use' },
    ]);
    const r = await runCommanderTurn({
      ...base, executeTool: vi.fn(async () => ({ text: 'ok' })), hooks, turnFn,
    });
    const results = r.messages
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .filter((b) => b.type === 'tool_result');
    expect(results.map((b) => b.tool_use_id)).toEqual(['tu_1', 'tu_2']);
  });

  it('returns an error state instead of throwing when the API call fails', async () => {
    const r = await runCommanderTurn({
      ...base,
      executeTool: vi.fn(),
      hooks: makeHooks(),
      turnFn: vi.fn(async () => { throw new Error('401 bad key'); }),
    });
    expect(r.stopped).toBe('error');
    expect(r.error).toMatch(/401 bad key/);
  });

  it('passes the includeProtected decision through to the executor', async () => {
    const executeTool = vi.fn(async () => ({ text: 'ok' }));
    const hooks = makeHooks({
      requestApproval: vi.fn(async () => ({ approved: true as const, includeProtected: true })),
    });
    const turnFn = scriptedTurn([
      { content: [toolUse('tu_1', 'delete_units', { unit_ids: [2] })], stopReason: 'tool_use' },
      { content: [text('done')], stopReason: 'end_turn' },
    ]);
    await runCommanderTurn({ ...base, executeTool, hooks, turnFn });
    expect(executeTool).toHaveBeenCalledWith('delete_units', { unit_ids: [2] }, true);
  });
});
