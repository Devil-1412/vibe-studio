import { randomUUID } from 'crypto';
import * as path from 'path';
import {
  AgentAdapter,
  HOME,
  POINTS_PROMPT,
  RunOptions,
  RunPlan,
  SessionMeta,
  TranscriptParser,
  clip,
  effortLabel,
  headLines,
  isEffort,
  lineCount,
  oneLine,
  pretty,
  safeJson,
  tailLines,
  todoEntries,
  tildify,
  walkJsonl,
} from './common';
import type { Attachment, ChatItem, PlanItem, QuestionEntry, QuestionItem } from '../types';

const ROOT = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude');
const PROJECTS = path.join(ROOT, 'projects');

// Context the client injects into user turns; the Claude panel does not show these as typed text.
const WRAPPERS =
  /<(system-reminder|browser_instruction|ide_selection|ide_opened_file|ide_diagnostics|local-command-caveat|user-prompt-submit-hook|command-message)>[\s\S]*?<\/\1>/g;
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;
// Slash commands that are part of Claude Code itself, not skills.
const BUILT_IN_COMMANDS = new Set(
  'add-dir agents bug chrome clear compact config context cost doctor effort exit export fast feedback help hooks ide init login logout mcp memory model permissions plugin plugins recap release-notes resume review rewind status statusline terminal-setup theme todos upgrade usage vim'.split(
    ' ',
  ),
);

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return pretty(content);
  return content
    .map((p: any) => (p?.type === 'text' ? p.text ?? '' : p?.type === 'image' ? '[image]' : ''))
    .filter(Boolean)
    .join('\n');
}

function diffText(before: unknown, after: unknown): string {
  const lines = (prefix: string, s: unknown) =>
    String(s ?? '')
      .split('\n')
      .map((l) => prefix + l)
      .join('\n');
  return clip(`${lines('- ', before)}\n${lines('+ ', after)}`, 6000);
}

function toolName(name: string): string {
  if (name === 'WebFetch') return 'Web Fetch';
  if (!name.startsWith('mcp__')) return name;
  const [, server, ...rest] = name.split('__');
  return `${server.replace(/^claude[-_]ai[-_]/i, '').replace(/^claude-in-/, '')} [${rest.join('__')}]`;
}

const MCP_HINTS = ['query', 'message', 'channel', 'repo', 'url', 'path', 'title', 'text'];

function toolSummary(name: string, input: any): string {
  if (name === 'Bash' && typeof input?.description === 'string' && input.description.trim()) return oneLine(input.description);
  if (name === 'Grep' && typeof input?.pattern === 'string') {
    const where = [input.path && `in ${tildify(String(input.path))}`, input.glob, input.type].filter((x) => typeof x === 'string' && x);
    return oneLine(`"${input.pattern}"${where.length ? ` (${where.join(', ')})` : ''}`);
  }
  if (name === 'Glob' && typeof input?.pattern === 'string') return oneLine(`pattern: "${input.pattern}"`);
  if (name === 'Skill' && typeof input?.skill === 'string') return `${input.skill} skill`;
  if (name.startsWith('mcp__')) {
    const hint = MCP_HINTS.map((k) => input?.[k]).find((v) => typeof v === 'string' && v.trim());
    if (hint) return oneLine(hint, 40);
  }
  const v =
    input?.command ??
    input?.file_path ??
    input?.notebook_path ??
    input?.path ??
    input?.pattern ??
    input?.url ??
    input?.query ??
    input?.description ??
    input?.prompt ??
    input?.skill ??
    input?.subject ??
    input?.action;
  return typeof v === 'string' ? oneLine(tildify(v)) : '';
}

/** "3 lines of output" for Grep, "Found 4 files" for Glob; the lines Claude adds around the list don't count. */
function resultLine(name: string, output: string): string | undefined {
  if (name !== 'Grep' && name !== 'Glob') return undefined;
  const lines = output.split('\n').filter((l) => l.trim() && !/^(Found \d+ files?|\(Results are truncated)/.test(l));
  const n = lines.length;
  if (!n || /^No (files|matches) found/i.test(lines[0])) return name === 'Glob' ? 'No files found' : 'No matches found';
  return name === 'Glob' ? `Found ${n} file${n === 1 ? '' : 's'}` : `${n} line${n === 1 ? '' : 's'} of output`;
}

/** The user turned a tool call down (Esc, or "no" in the panel). */
const turnedDown = (text: string, result: unknown) => result === 'User rejected tool use' || /doesn't want to proceed|tool use was rejected/i.test(text);

const planFile = (p: unknown) => (typeof p === 'string' && p.trim() ? path.basename(p.trim()) : undefined);

/** ExitPlanMode → plan card; undefined (generic row) when the input has no plan text. */
function planItem(id: string, input: any): PlanItem | undefined {
  const plan = typeof input?.plan === 'string' ? input.plan.trim() : '';
  return plan ? { id, kind: 'plan', plan: clip(plan, 20000), file: planFile(input.planFilePath), status: 'waiting' } : undefined;
}

/** AskUserQuestion → question card; undefined (generic row) when the input has no usable question. */
function questionItem(id: string, input: any): QuestionItem | undefined {
  if (!Array.isArray(input?.questions)) return undefined;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const questions: QuestionEntry[] = input.questions.flatMap((q: any) => {
    const question = text(q?.question);
    if (!question) return [];
    const options = (Array.isArray(q.options) ? q.options : []).flatMap((o: any) => (text(o?.label) ? [{ label: o.label.trim(), description: text(o.description) }] : []));
    return [{ question, header: text(q.header), multiSelect: !!q.multiSelect, options }];
  });
  return questions.length ? { id, kind: 'question', questions, status: 'waiting' } : undefined;
}

/**
 * Splits a recorded answer into the option labels picked and typed text. Multi-select answers are the labels joined
 * by ", " (typed text rides along as a further part); a single-select answer is one label or all typed text.
 */
function pickAnswer(q: QuestionEntry, answer: string): void {
  const chosen: string[] = [];
  const other: string[] = [];
  let rest = answer;
  while (rest) {
    const label = q.options
      .map((o) => o.label)
      .filter((l) => rest === l || (q.multiSelect && rest.startsWith(l + ', ')))
      .sort((a, b) => b.length - a.length)[0];
    if (label) {
      chosen.push(label);
      rest = rest.slice(label.length + 2);
      continue;
    }
    const cut = q.multiSelect ? rest.indexOf(', ') : -1;
    other.push(cut < 0 ? rest : rest.slice(0, cut));
    rest = cut < 0 ? '' : rest.slice(cut + 2);
  }
  q.chosen = chosen;
  q.other = other.join(', ') || undefined;
}

type Card = Extract<ChatItem, { kind: 'plan' | 'question' }>;

export class ClaudeParser extends TranscriptParser {
  cwd?: string;
  aiTitle?: string;
  customTitle?: string;
  /** agentId → Agent tool_use id, and reports that arrived before their agent id was known. */
  private readonly agentIds = new Map<string, string>();
  private readonly earlyReports = new Map<string, string>();
  /** The compact row waiting for its summary, which arrives a few lines after the boundary. */
  private compactId?: string;
  /** The plain tool row for each plan/question card, used when its result turns out to be a shape we don't read. */
  private readonly generic = new Map<string, ChatItem>();
  /** How long a prompt-cache entry lives, from the newest call that wrote to it. */
  private cacheTtl = 5 * 60_000;

  /** sidechain = this is a sub-agent's own transcript, where every line is marked isSidechain. */
  constructor(private readonly sidechain = false) {
    super();
  }

  feed(line: string): void {
    const head = line.slice(0, 48);
    if (head.includes('"type":"api-request') || head.includes('"type":"file-history')) return;
    const d = safeJson(line);
    if (!d || typeof d !== 'object') return;
    if (!this.cwd && typeof d.cwd === 'string') this.cwd = d.cwd;
    this.stamp(d.timestamp);
    switch (d.type) {
      case 'cost-state':
        if (typeof d.totalCostUSD === 'number') this.usage = { ...this.usage, cost: d.totalCostUSD };
        return;
      case 'ai-title':
        if (d.aiTitle) this.aiTitle = d.aiTitle;
        return;
      case 'custom-title':
        if (d.customTitle || d.title) this.customTitle = d.customTitle || d.title;
        return;
      case 'summary':
        if (!this.aiTitle && d.summary) this.aiTitle = d.summary;
        return;
      case 'attachment':
        // a hand-back can also arrive as a queued command
        if (typeof d.attachment?.prompt === 'string' && d.attachment.prompt.includes('<agent-message')) this.handback(d.attachment.prompt);
        return;
      case 'user':
        if (!d.isSidechain || this.sidechain) this.user(d);
        return;
      case 'assistant':
        if (!d.isSidechain || this.sidechain) this.assistant(d);
        return;
      case 'system':
        if (d.subtype === 'compact_boundary') {
          const meta = d.compactMetadata ?? {};
          this.compactId = d.uuid;
          this.add({ id: d.uuid, kind: 'compact', text: '', trigger: typeof meta.trigger === 'string' ? meta.trigger : undefined, preTokens: typeof meta.preTokens === 'number' ? meta.preTokens : undefined });
        } else if (d.level === 'error' && typeof d.content === 'string')
          this.add({ id: d.uuid, kind: 'note', text: d.content, tone: 'error' });
        return;
    }
  }

  private user(d: any): void {
    if (d.isMeta) {
      const content = d.message?.content;
      this.handback(typeof content === 'string' ? content : resultText(content));
      return;
    }
    const id: string = d.uuid ?? `u${this.items.length}`;
    const content = d.message?.content;
    if (d.isCompactSummary) {
      this.compactSummary(id, typeof content === 'string' ? content : resultText(content));
      return;
    }
    const texts: string[] = [];
    if (typeof content === 'string') texts.push(content);
    else if (Array.isArray(content)) {
      for (const part of content) {
        if (part?.type === 'tool_result') this.attachResult(part, d.toolUseResult);
        else if (part?.type === 'text') texts.push(part.text ?? '');
        else if (part?.type === 'image') texts.push('[image]');
        else if (part?.type === 'document') texts.push('[document]');
      }
    }
    if (texts.length) this.userText(id, texts.join('\n\n'));
  }

  private userText(id: string, raw: string): void {
    const cmd = /<command-name>\s*([^<]*)<\/command-name>/.exec(raw);
    if (cmd) {
      const command = cmd[1].trim().replace(/^\//, '');
      if (!BUILT_IN_COMMANDS.has(command)) this.useSkill(command);
      const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(raw)?.[1]?.trim();
      this.add({ id, kind: 'user', text: [cmd[1].trim(), args].filter(Boolean).join(' ') });
      return;
    }
    const out = /<local-command-(stdout|stderr)>([\s\S]*?)<\/local-command-\1>/.exec(raw);
    if (out) {
      const t = out[2].replace(ANSI, '').trim();
      if (t) this.add({ id, kind: 'note', text: t, tone: out[1] === 'stderr' ? 'error' : 'info' });
      return;
    }
    if (raw.includes('<task-notification>')) {
      // A background agent finished: the Agent map carries the outcome, no separate note.
      const agent = this.get(/<tool-use-id>([^<]+)<\/tool-use-id>/.exec(raw)?.[1] ?? '');
      if (agent?.kind === 'agent') {
        const status = /<status>([^<]+)<\/status>/.exec(raw)?.[1] ?? 'completed';
        agent.status = status === 'failed' ? 'failed' : /killed|stopped/.test(status) ? 'stopped' : 'done';
        agent.endedAt = this.ts;
        const num = (tag: string) => Number(new RegExp(`<${tag}>(\\d+)</${tag}>`).exec(raw)?.[1]) || undefined;
        agent.tokens = num('total_tokens') ?? agent.tokens;
        agent.toolUses = num('tool_uses') ?? agent.toolUses;
        agent.durationMs = num('duration_ms') ?? agent.durationMs;
        const result = /<result>([\s\S]*?)<\/result>/.exec(raw)?.[1]?.trim();
        if (result && !agent.report) agent.report = clip(result, 20000);
        this.touch(agent.id);
        return;
      }
      const s = /<summary>([\s\S]*?)<\/summary>/.exec(raw)?.[1];
      this.add({ id, kind: 'note', text: s ? oneLine(s, 300) : 'Background task update' });
      return;
    }
    const text = raw.replace(WRAPPERS, '').trim();
    if (!text) return;
    if (text.startsWith('[Request interrupted by user')) {
      this.add({ id, kind: 'note', text: text.includes('for tool use') ? 'Tool interrupted' : 'Interrupted' });
      return;
    }
    if (text.startsWith('This session is being continued from a previous conversation')) {
      this.compactSummary(id, text);
      return;
    }
    this.add({ id, kind: 'user', text });
    this.startTurn(text);
  }

  /** The summary joins the compact row the boundary opened; without one (older logs) it gets a row of its own. */
  private compactSummary(id: string, text: string): void {
    const row = this.compactId ? this.get(this.compactId) : undefined;
    this.compactId = undefined;
    if (row?.kind === 'compact' && !row.text) {
      row.text = clip(text.trim(), 20000);
      this.touch(row.id);
    } else this.add({ id, kind: 'compact', text: clip(text.trim(), 20000) });
  }

  /** A sub-agent's final report arrives as a meta message: <agent-message from="ID">… The report follows: …</agent-message> */
  private handback(raw: string): void {
    const m = /<agent-message from="([^"]+)">([\s\S]*?)<\/agent-message>/.exec(raw);
    if (!m) return;
    const marker = 'The report follows:';
    const at = m[2].indexOf(marker);
    // the harness indents every report line by two spaces
    const report = clip((at >= 0 ? m[2].slice(at + marker.length) : m[2]).replace(/^ {2}/gm, '').trim(), 20000);
    const agent = this.get(this.agentIds.get(m[1]) ?? '');
    if (agent?.kind !== 'agent') {
      this.earlyReports.set(m[1], report);
      return;
    }
    agent.report = report;
    if (agent.status === 'running') agent.status = 'done';
    this.touch(agent.id);
  }

  private attachResult(part: any, result: any): void {
    this.activity();
    this.settleEdits(part.tool_use_id, !part.is_error);
    let item = this.get(part.tool_use_id);
    if (item?.kind === 'agent') {
      const r = result && typeof result === 'object' ? result : {};
      const text = resultText(part.content);
      const agentId: string | undefined = r.agentId ?? /agentId: (\w+)/.exec(text)?.[1] ?? /from "(\w+)"/.exec(text)?.[1];
      if (agentId) {
        item.agentId = agentId;
        this.agentIds.set(agentId, item.id);
        const early = this.earlyReports.get(agentId);
        if (early) item.report = early;
      }
      if (typeof r.resolvedModel === 'string') item.model = r.resolvedModel;
      if (r.status === 'async_launched') item.background = true; // still running; a task-notification ends it
      else {
        item.status = part.is_error ? 'failed' : 'done';
        item.endedAt = this.ts;
        // older runs return the report as the tool result; newer ones hand it back separately
        if (!item.report && !/delivered to you as a message/.test(text)) item.report = clip(text.replace(/\n*agentId: \w+[\s\S]*$/, '').trim(), 20000);
      }
      if (typeof r.totalDurationMs === 'number') item.durationMs = r.totalDurationMs;
      if (typeof r.totalToolUseCount === 'number') item.toolUses = r.totalToolUseCount;
      if (typeof r.totalTokens === 'number') item.tokens = r.totalTokens;
      this.touch(item.id);
      return;
    }
    if (item?.kind === 'plan' || item?.kind === 'question') {
      if (this.settleCard(item, part, result)) return;
      item = this.get(part.tool_use_id); // swapped for its plain tool row
    }
    if (!item || item.kind !== 'tool') return;
    const text = resultText(part.content);
    item.output = clip(text);
    item.isError = !!part.is_error;
    if (!item.isError) item.result = resultLine(item.name, text); // counted before clip() cuts the output
    this.touch(item.id);
  }

  /** A plan or question card takes its outcome from the tool result. False = unknown shape: the card becomes its plain tool row. */
  private settleCard(item: Card, part: any, result: any): boolean {
    const text = resultText(part.content);
    const isError = !!part.is_error;
    if (item.kind === 'plan') {
      if (!isError && /approved/i.test(text)) item.status = 'approved';
      else if (isError || turnedDown(text, result) || /keep planning|not approved/i.test(text)) item.status = 'kept';
      else return this.degrade(item);
      item.file ??= planFile(result?.filePath) ?? planFile(/saved to:\s*(.+)/i.exec(text)?.[1]);
    } else if (isError) {
      if (!turnedDown(text, result)) return this.degrade(item);
      item.status = 'declined';
      item.reason = /(?:the user said|following reason[^:\n]*):\s*([\s\S]+)$/i.exec(text)?.[1]?.trim();
    } else if (result?.answers && typeof result.answers === 'object') {
      for (const q of item.questions) {
        const a = result.answers[q.question];
        const answer = Array.isArray(a) ? a.join(', ') : typeof a === 'string' ? a : '';
        if (answer) pickAnswer(q, answer);
      }
      const answered = item.questions.some((q) => q.chosen?.length || q.other);
      if (answered) item.status = 'answered';
      else if (Object.keys(result.answers).length) Object.assign(item, { status: 'answered', text: clip(text.trim(), 4000) }); // keyed some other way
      else item.status = 'none';
    } else if (text.trim()) {
      Object.assign(item, { status: 'answered', text: clip(text.trim(), 4000) });
    } else item.status = 'none';
    this.touch(item.id);
    return true;
  }

  private degrade(card: Card): false {
    const row = this.generic.get(card.id);
    if (row) this.add({ ...row, ts: card.ts });
    return false;
  }

  private assistant(d: any): void {
    const m = d.message;
    if (!m || !Array.isArray(m.content)) return;
    const base: string = d.uuid ?? m.id ?? `a${this.items.length}`;
    const synthetic = m.model === '<synthetic>' || d.isApiErrorMessage;
    if (!synthetic && typeof m.model === 'string' && m.model) this.model = m.model;
    this.activity();
    const u = m.usage;
    if (!synthetic && u && typeof u.input_tokens === 'number') {
      // Everything the model read this call = what sits in the context window.
      const context = u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      this.usage = { ...this.usage, context, out: u.output_tokens ?? 0, ...this.cache(u.cache_creation) };
    }
    m.content.forEach((b: any, i: number) => {
      const id = `${base}:${i}`;
      if (b?.type === 'text') {
        const t = String(b.text ?? '').trim();
        if (!t || t === '(no content)') return;
        if (synthetic) this.add({ id, kind: 'note', text: t, tone: d.isApiErrorMessage ? 'error' : 'info' });
        else this.add({ id, kind: 'assistant', text: t });
      } else if (b?.type === 'thinking') {
        const t = String(b.thinking ?? '').trim();
        if (t) this.add({ id, kind: 'thinking', text: t });
      } else if (b?.type === 'tool_use' || b?.type === 'server_tool_use') {
        this.addTool(b, id);
      }
    });
  }

  /**
   * Prompt-cache estimate. A call that wrote 1 h tokens means a 1 h TTL, one that wrote only 5 min tokens means 5 min; a
   * call that only read the cache keeps the last TTL (default 5 min). Every call that touches the cache renews it, so it
   * likely lapses one TTL after the newest call. Approximate: the line's timestamp is when the reply was written, not
   * when the request started, and sub-agents keep caches of their own.
   */
  private cache(creation: any) {
    if (creation?.ephemeral_1h_input_tokens > 0) this.cacheTtl = 60 * 60_000;
    else if (creation?.ephemeral_5m_input_tokens > 0) this.cacheTtl = 5 * 60_000;
    return this.ts ? { cacheAt: this.ts, cacheUntil: this.ts + this.cacheTtl } : {};
  }

  private addTool(b: any, fallbackId: string): void {
    const name: string = b.name ?? 'tool';
    const input = b.input ?? {};
    if (name === 'Agent' || name === 'Task') {
      this.add({
        id: b.id ?? fallbackId,
        kind: 'agent',
        agentType: String(input.subagent_type || 'general-purpose'),
        description: String(input.description ?? ''),
        prompt: clip(String(input.prompt ?? ''), 8000),
        model: typeof input.model === 'string' ? input.model : undefined,
        background: !!input.run_in_background,
        status: 'running',
        startedAt: this.ts || undefined,
      });
      return;
    }
    if (name === 'TodoWrite' && Array.isArray(input.todos)) {
      this.add({ id: b.id ?? fallbackId, kind: 'todo', items: todoEntries(input.todos, 'content') });
      return;
    }
    let body: string;
    let diff = false;
    if (name === 'Edit') {
      body = diffText(input.old_string, input.new_string);
      diff = true;
    } else if (name === 'MultiEdit' && Array.isArray(input.edits)) {
      body = input.edits.map((e: any) => diffText(e.old_string, e.new_string)).join('\n⋯\n');
      diff = true;
    } else if (name === 'Write') {
      body = diffText('', input.content).replace(/^- \n/, '');
      diff = true;
    } else if (name === 'Bash' && typeof input.command === 'string') {
      body = input.command;
    } else {
      body = clip(pretty(input), 4000);
    }
    const id: string = b.id ?? fallbackId;
    if (name === 'Skill' && typeof input.skill === 'string') this.useSkill(input.skill);
    const file = input.file_path ?? input.notebook_path;
    if (typeof file === 'string') {
      if (name === 'Edit') this.planEdits(id, [{ path: file, adds: lineCount(input.new_string), dels: lineCount(input.old_string) }]);
      else if (name === 'MultiEdit' && Array.isArray(input.edits)) {
        const adds = input.edits.reduce((n: number, e: any) => n + lineCount(e.new_string), 0);
        const dels = input.edits.reduce((n: number, e: any) => n + lineCount(e.old_string), 0);
        this.planEdits(id, [{ path: file, adds, dels }]);
      } else if (name === 'Write') this.planEdits(id, [{ path: file, adds: lineCount(input.content), dels: 0 }]);
      else if (name === 'NotebookEdit') this.planEdits(id, [{ path: file, adds: lineCount(input.new_source), dels: 0 }]);
    }
    const row: ChatItem = { id, kind: 'tool', name: toolName(name), summary: toolSummary(name, input), input: body, diff };
    const card = name === 'ExitPlanMode' ? planItem(id, input) : name === 'AskUserQuestion' ? questionItem(id, input) : undefined;
    if (card) this.generic.set(id, row);
    this.add(card ?? row);
  }
}

const MODES = [
  { value: 'acceptEdits', label: 'Accept edits' },
  { value: 'auto', label: 'Auto' },
  { value: 'plan', label: 'Plan only' },
  { value: 'manual', label: 'Ask' },
  { value: 'bypassPermissions', label: 'Bypass permissions' },
];

// Current family. Older versions show up from the user's own transcripts, plus the vibeStudio.claudeModels setting.
const CURRENT_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'];
const FAMILIES = ['opus', 'sonnet', 'haiku', 'fable'];

/** claude-opus-4-1-20250805 → "Opus 4.1", claude-3-5-sonnet-20241022 → "Sonnet 3.5". */
export function claudeModelLabel(id: string): string {
  const longContext = /\[1m\]$/i.test(id);
  const parts = id
    .replace(/\[1m\]$/i, '')
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .split('-');
  const family = parts.find((p) => FAMILIES.includes(p));
  if (!family) return id;
  const version = parts.filter((p) => /^\d{1,2}$/.test(p)).join('.');
  const label = `${family[0].toUpperCase()}${family.slice(1)}${version ? ` ${version}` : ''}`;
  return longContext ? `${label} (1M context)` : label;
}

// From `claude --help`: --effort <level> (low, medium, high, xhigh, max).
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

/** The content block Claude Code records for an attachment: image, PDF, or a pasted text file. */
function attachmentBlock(a: Attachment) {
  if (a.type.startsWith('image/')) return { type: 'image', source: { type: 'base64', media_type: a.type, data: a.data } };
  if (a.type === 'application/pdf') return { type: 'document', source: { type: 'base64', media_type: a.type, data: a.data } };
  return { type: 'document', source: { type: 'text', media_type: 'text/plain', data: a.data }, title: a.name };
}

function args({ mode, model, effort, chrome, points }: RunOptions): string[] {
  return [
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    mode,
    ...(model ? ['--model', model] : []),
    ...(effort && isEffort(effort) ? ['--effort', effort] : []),
    ...(chrome ? ['--chrome'] : []),
    ...(points ? ['--append-system-prompt', POINTS_PROMPT] : []),
  ];
}

export const claude: AgentAdapter = {
  id: 'claude',
  label: 'Claude',
  modes: MODES,
  supportsChosenId: true,

  // projects/<project>/<session>.jsonl; deeper folders hold sub-agent transcripts.
  listFiles: () => walkJsonl(PROJECTS, 1),

  async readMeta(file, size): Promise<SessionMeta | null> {
    const parser = new ClaudeParser();
    for (const line of await headLines(file, 64 * 1024)) parser.feed(line);
    if (!parser.items.some((i) => i.kind === 'user') && size > 64 * 1024) {
      for (const line of await headLines(file, Math.min(size, 2 * 1024 * 1024))) parser.feed(line);
    }
    if (size > 64 * 1024) for (const line of await tailLines(file, size, 64 * 1024)) parser.feed(line);
    const firstUser = parser.items.find((i) => i.kind === 'user');
    const title = parser.customTitle || parser.aiTitle || (firstUser ? oneLine(firstUser.text, 90) : '');
    if (!title) return null;
    return { id: path.basename(file, '.jsonl'), title, cwd: parser.cwd ?? '', model: parser.model };
  },

  createParser: (opts) => new ClaudeParser(opts?.sidechain),

  knownModels: async () => CURRENT_MODELS.map((value) => ({ value, label: claudeModelLabel(value) })),
  modelLabel: claudeModelLabel,
  efforts: async () => ({ levels: EFFORTS.map((value) => ({ value, label: effortLabel(value) })), byModel: {} }),

  supportsChrome: true,
  // -p / SDK runs leave the Artifact tool off ("sdk_default_off") unless this is set; settings that disable it still win.
  env: { CLAUDE_CODE_ARTIFACT: '1' },
  // Same protocol the Claude Code VS Code extension uses to drive the CLI.
  live: {
    // --permission-prompt-tool stdio: what the mode does not decide comes to us as a can_use_tool request, answered by a card in the tile.
    args: (id, opts, fresh) => ['-p', '--input-format', 'stream-json', fresh ? '--session-id' : '--resume', id, '--permission-prompt-tool', 'stdio', ...args(opts)],
    message: (text, attachments) =>
      JSON.stringify({
        type: 'user',
        session_id: '',
        parent_tool_use_id: null,
        message: { role: 'user', content: attachments?.length ? [...(text ? [{ type: 'text', text }] : []), ...attachments.map(attachmentBlock)] : text },
      }),
    interrupt: () => JSON.stringify({ type: 'control_request', request_id: randomUUID(), request: { subtype: 'interrupt' } }),
    // same request the Claude Code panel sends for its "Stop agent" button
    stopTask: (taskId) => JSON.stringify({ type: 'control_request', request_id: randomUUID(), request: { subtype: 'stop_task', task_id: taskId } }),
    isTurnEnd: (line) => line.includes('"type":"result"') && safeJson(line)?.type === 'result',
    controlReply(line) {
      if (!line.includes('"control_request"')) return undefined;
      const d = safeJson(line);
      if (d?.type !== 'control_request') return undefined;
      if (d.request?.subtype === 'can_use_tool') return undefined; // the user answers this one
      return JSON.stringify({ type: 'control_response', response: { subtype: 'error', request_id: d.request_id, error: 'Not supported by Vibe Studio' } });
    },
  },
  resumePlan: (id, text, opts): RunPlan => ({ args: ['-p', '--resume', id, ...args(opts)], stdin: text }),
  newPlan: (text, newId, opts): RunPlan => ({ args: ['-p', '--session-id', newId, ...args(opts)], stdin: text }),

  errorFromStdout(line) {
    const d = safeJson(line);
    if (d?.type !== 'result') return undefined;
    if (!d.is_error && d.subtype === 'success') return undefined;
    return String(d.result || (Array.isArray(d.errors) && d.errors.join('\n')) || d.subtype || 'Claude reported an error');
  },

  expectedFile: (id, cwd) => path.join(PROJECTS, cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${id}.jsonl`),
};
