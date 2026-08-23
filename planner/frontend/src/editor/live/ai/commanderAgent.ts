/**
 * The tool-use loop.
 *
 * Pure by construction: the API call and the tool executor are both injected,
 * so the whole control flow — approval, denial, cancellation, iteration cap,
 * verbatim block echo — is testable without a network or an Olympus server.
 *
 * The three Messages-API invariants this encodes, each of which is a 400 or a
 * silent behaviour regression if broken:
 *   - assistant content goes back into history exactly as received (thinking
 *     blocks carry signatures; opus-5 has thinking on by default)
 *   - every tool_use id gets exactly one tool_result, including denied ones
 *   - all of a turn's tool results ride in ONE user message
 */

import {
  anthropicAgentTurn, isToolUseBlock,
  type AgentTurnResult, type AnthropicAnyBlock, type AnthropicMessage,
  type AnthropicToolDef, type AnthropicToolResultBlock, type AnthropicToolUseBlock,
} from '../../../ai/anthropicClient';
import type { ToolExecResult } from './commanderTypes';

export type ApprovalDecision =
  | { approved: true; includeProtected: boolean }
  | { approved: false; reason?: string };

export type ToolStatus = 'running' | 'done' | 'denied' | 'error';

export interface AgentHooks {
  /** Resolve a proposed tool call. Auto-resolves for read-only / auto-exec. */
  requestApproval: (tu: AnthropicToolUseBlock) => Promise<ApprovalDecision>;
  /** Render assistant output as it lands. */
  onAssistantContent: (blocks: AnthropicAnyBlock[]) => void;
  onToolStatus: (toolUseId: string, status: ToolStatus, resultText?: string) => void;
  isCancelled: () => boolean;
}

export type TurnFn = (opts: {
  apiKey: string; model: string; system?: string;
  messages: AnthropicMessage[]; tools?: AnthropicToolDef[]; maxTokens?: number;
}) => Promise<AgentTurnResult>;

export interface RunTurnOpts {
  apiKey: string;
  model: string;
  system: string;
  tools: AnthropicToolDef[];
  /** Prior turns, content blocks verbatim. */
  history: AnthropicMessage[];
  userText: string;
  executeTool: (name: string, input: Record<string, unknown>, includeProtected: boolean) => Promise<ToolExecResult>;
  hooks: AgentHooks;
  maxIterations?: number;
  maxTokensPerCall?: number;
  /** Injected for tests; defaults to the real API call. */
  turnFn?: TurnFn;
}

export type TurnStop = 'done' | 'iteration_cap' | 'cancelled' | 'refusal' | 'max_tokens' | 'error';

export interface RunTurnResult {
  messages: AnthropicMessage[];
  usage: { input: number; output: number };
  stopped: TurnStop;
  error?: string;
}

const DEFAULT_MAX_ITERATIONS = 12;

export async function runCommanderTurn(opts: RunTurnOpts): Promise<RunTurnResult> {
  const {
    apiKey, model, system, tools, history, userText, executeTool, hooks,
    maxIterations = DEFAULT_MAX_ITERATIONS, maxTokensPerCall = 8192,
    turnFn = anthropicAgentTurn,
  } = opts;

  const messages: AnthropicMessage[] = [
    ...history,
    { role: 'user', content: [{ type: 'text', text: userText }] },
  ];
  const usage = { input: 0, output: 0 };

  for (let i = 0; i < maxIterations; i++) {
    if (hooks.isCancelled()) return { messages, usage, stopped: 'cancelled' };

    let res: AgentTurnResult;
    try {
      res = await turnFn({ apiKey, model, system, messages, tools, maxTokens: maxTokensPerCall });
    } catch (e) {
      return {
        messages, usage, stopped: 'error',
        error: e instanceof Error ? e.message : 'Request failed',
      };
    }

    usage.input += res.usage?.input_tokens || 0;
    usage.output += res.usage?.output_tokens || 0;

    hooks.onAssistantContent(res.content);
    // VERBATIM — never filter or reorder. See file header.
    messages.push({ role: 'assistant', content: res.content });

    if (res.stopReason === 'refusal') return { messages, usage, stopped: 'refusal' };
    if (res.stopReason !== 'tool_use') {
      return { messages, usage, stopped: res.stopReason === 'max_tokens' ? 'max_tokens' : 'done' };
    }

    const toolUses = res.content.filter(isToolUseBlock);
    if (!toolUses.length) return { messages, usage, stopped: 'done' };

    const results: AnthropicToolResultBlock[] = [];
    for (const tu of toolUses) {
      // Cancelling mid-batch still has to close out every pending id, or the
      // next request 400s on an unmatched tool_use.
      if (hooks.isCancelled()) {
        results.push({
          type: 'tool_result', tool_use_id: tu.id,
          content: 'Cancelled by the Game Master before execution.',
        });
        hooks.onToolStatus(tu.id, 'denied');
        continue;
      }

      let decision: ApprovalDecision;
      try {
        decision = await hooks.requestApproval(tu);
      } catch {
        decision = { approved: false, reason: 'approval failed' };
      }

      if (!decision.approved) {
        const why = decision.reason ? `: ${decision.reason}` : '';
        results.push({
          type: 'tool_result', tool_use_id: tu.id,
          content: `Denied by the Game Master${why}. Do not retry this action without new instructions.`,
        });
        hooks.onToolStatus(tu.id, 'denied');
        continue;
      }

      hooks.onToolStatus(tu.id, 'running');
      let r: ToolExecResult;
      try {
        r = await executeTool(tu.name, tu.input || {}, decision.includeProtected);
      } catch (e) {
        r = { text: e instanceof Error ? e.message : 'Tool execution failed', isError: true };
      }
      results.push({
        type: 'tool_result', tool_use_id: tu.id,
        content: r.text, ...(r.isError ? { is_error: true } : {}),
      });
      hooks.onToolStatus(tu.id, r.isError ? 'error' : 'done', r.text);
    }

    // ONE user message carrying every result. See file header.
    messages.push({ role: 'user', content: results });
  }

  return { messages, usage, stopped: 'iteration_cap' };
}
