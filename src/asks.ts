// Questions the CLI asks the host over its control channel (`can_use_tool`): tool permissions, AskUserQuestion and
// ExitPlanMode. The shapes follow what the Claude Code VS Code extension sends and accepts. No vscode import.
import { randomUUID } from 'crypto';
import type { AskAnswer, PendingAsk } from './types';

/** A `can_use_tool` control request from the CLI, or undefined for anything else. */
export function parseAsk(d: any): PendingAsk | undefined {
  const r = d?.request;
  if (d?.type !== 'control_request' || r?.subtype !== 'can_use_tool' || typeof d.request_id !== 'string') return undefined;
  const tool = String(r.tool_name ?? 'tool');
  return {
    id: d.request_id,
    toolUseId: typeof r.tool_use_id === 'string' ? r.tool_use_id : undefined,
    agentId: typeof r.agent_id === 'string' ? r.agent_id : undefined,
    kind: tool === 'AskUserQuestion' ? 'question' : tool === 'ExitPlanMode' ? 'plan' : 'tool',
    tool,
    input: r.input ?? {},
    description: typeof r.description === 'string' ? r.description : typeof r.title === 'string' ? r.title : undefined,
    suggestions: Array.isArray(r.permission_suggestions) ? r.permission_suggestions : [],
    state: 'pending',
  };
}

/** The id of a request the CLI withdrew (an interrupt, or another prompt answered first). */
export function cancelledId(d: any): string | undefined {
  return d?.type === 'control_cancel_request' && typeof d.request_id === 'string' ? d.request_id : undefined;
}

const reply = (id: string, body: object) => JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: id, response: body } });

const REJECTED = "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file).";

/** The lines to write back for an answer. Approving a plan first switches the CLI's permission mode. */
export function answerLines(ask: PendingAsk, a: AskAnswer): string[] {
  if (!a.allow) {
    const why = a.message?.trim();
    const message = ask.kind === 'plan' && !why ? 'User chose to stay in plan mode and continue planning' : why ? `${REJECTED} The user provided the following reason for the rejection: ${why}` : `${REJECTED} STOP what you are doing and wait for the user to tell you how to proceed.`;
    return [reply(ask.id, { behavior: 'deny', message, interrupt: !why })];
  }
  const out: string[] = [];
  let updatedPermissions: unknown[] | undefined;
  // "always" remembers for this session only; the CLI's other destinations would write the project's settings files
  if (a.always) updatedPermissions = ask.suggestions.map((s) => (s?.type === 'setMode' ? s : { ...s, destination: 'session' }));
  if (a.mode === 'acceptEdits') out.push(JSON.stringify({ type: 'control_request', request_id: randomUUID(), request: { subtype: 'set_permission_mode', mode: 'acceptEdits' } }));
  if (a.mode === 'default') updatedPermissions = [{ type: 'setMode', mode: 'default', destination: 'session' }];
  const updatedInput = ask.kind === 'question' ? { ...ask.input, answers: a.answers ?? {} } : ask.input;
  out.push(reply(ask.id, { behavior: 'allow', updatedInput, ...(updatedPermissions && { updatedPermissions }) }));
  return out;
}

/** Pending and recent asks per chat. */
export class Asks {
  private byKey = new Map<string, PendingAsk[]>();

  list(key: string): PendingAsk[] {
    return this.byKey.get(key) ?? [];
  }

  add(key: string, ask: PendingAsk): void {
    this.byKey.set(key, [...this.list(key).filter((a) => a.id !== ask.id), ask].slice(-20));
  }

  find(key: string, id: string): PendingAsk | undefined {
    return this.list(key).find((a) => a.id === id);
  }

  /** Marks one ask (or every pending one) answered or expired; true if anything changed. */
  settle(key: string, state: 'answered' | 'expired', id?: string): boolean {
    let changed = false;
    this.byKey.set(
      key,
      this.list(key).map((a) => {
        if (a.state !== 'pending' || (id && a.id !== id)) return a;
        changed = true;
        return { ...a, state };
      }),
    );
    return changed;
  }

  pending(key: string): PendingAsk[] {
    return this.list(key).filter((a) => a.state === 'pending');
  }
}
