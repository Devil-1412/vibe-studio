import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AgentId, Attachment, ChatItem, FileStat, ModeOption, TodoEntry, Usage } from '../types';

export interface SessionFile {
  file: string;
  mtimeMs: number;
  size: number;
}

export interface SessionMeta {
  id: string;
  title: string;
  cwd: string;
  /** Last model the session used, when the transcript says. */
  model?: string;
}

/** One user prompt and the work that followed it, by transcript timestamps. */
export interface Turn {
  start: number;
  end: number;
  text: string;
  /** The agent reported the turn finished; later activity belongs to another turn. */
  closed?: boolean;
}

export interface Edit extends FileStat {
  ts: number;
}

/** Turns transcript lines into chat items. Items are only appended or patched in place. */
export abstract class TranscriptParser {
  readonly items: ChatItem[] = [];
  model?: string;
  effort?: string;
  usage: Usage = {};
  /** Files this session edited successfully, keyed by absolute path. */
  readonly files = new Map<string, FileStat>();
  readonly edits: Edit[] = [];
  readonly turns: Turn[] = [];
  /** Skills and commands the session ran, in first-use order. */
  readonly skillsUsed = new Set<string>();
  /** Timestamp of the line being parsed. */
  protected ts = 0;
  private readonly pendingEdits = new Map<string, FileStat[]>();
  private readonly index = new Map<string, number>();
  private dirty = new Set<string>();

  abstract feed(line: string): void;

  /** First and last timestamp seen; a sub-agent's run time. */
  firstTs = 0;
  lastTs = 0;

  protected stamp(timestamp: unknown): void {
    if (typeof timestamp !== 'string') return;
    const t = Date.parse(timestamp);
    if (Number.isNaN(t)) return;
    this.ts = t;
    this.firstTs ||= t;
    this.lastTs = t;
  }

  protected useSkill(name: string): void {
    const clean = name.trim().replace(/^[/$]/, '');
    if (clean) this.skillsUsed.add(clean);
  }

  protected startTurn(text: string): void {
    this.turns.push({ start: this.ts, end: this.ts, text: oneLine(text, 140) });
  }

  /** The agent did something: the current turn lasts at least until now. */
  protected activity(): void {
    const turn = this.turns[this.turns.length - 1];
    if (turn && !turn.closed && this.ts > turn.end) turn.end = this.ts;
  }

  protected endTurn(): void {
    this.activity();
    const turn = this.turns[this.turns.length - 1];
    if (turn) turn.closed = true;
  }

  /** An edit that is already known to have been applied. */
  protected recordEdit(e: FileStat): void {
    const f = this.files.get(e.path) ?? { path: e.path, adds: 0, dels: 0 };
    f.adds += e.adds;
    f.dels += e.dels;
    this.files.set(e.path, f);
    this.edits.push({ ...e, ts: this.ts });
  }

  /** Edits a tool call will make; counted only once its result comes back without an error. */
  protected planEdits(toolId: string, edits: FileStat[]): void {
    if (edits.length) this.pendingEdits.set(toolId, edits);
  }

  protected settleEdits(toolId: string, ok: boolean): void {
    const list = this.pendingEdits.get(toolId);
    if (!list) return;
    this.pendingEdits.delete(toolId);
    if (!ok) return;
    for (const e of list) this.recordEdit(e);
  }

  protected add(item: ChatItem): void {
    item.ts ??= this.ts || undefined;
    const at = this.index.get(item.id);
    if (at !== undefined) {
      this.items[at] = item;
    } else {
      this.index.set(item.id, this.items.length);
      this.items.push(item);
    }
    this.dirty.add(item.id);
  }

  protected get(id: string): ChatItem | undefined {
    const at = this.index.get(id);
    return at === undefined ? undefined : this.items[at];
  }

  protected touch(id: string): void {
    this.dirty.add(id);
  }

  /** Ids added or changed since the last call. */
  takeDirty(): string[] {
    const out = [...this.dirty];
    this.dirty = new Set();
    return out;
  }

  indexOf(id: string): number {
    return this.index.get(id) ?? -1;
  }
}

/** Appended to the agent's instructions when `points` is on. */
export const POINTS_PROMPT =
  'When you report findings, results or a summary to the user, write them as short bullet points, one idea per point, with no long paragraphs. Use a numbered list for steps in order. Keep code and commands in code blocks.';

/** Low usage mode: fewer tokens per turn, without taking away what the agent can do. */
export const LOW_PROMPT =
  'Be brief: no recaps, no restating the question, and do not repeat file contents or long output you already showed. Prefer targeted reads and searches over reading whole files. Hand small self-contained tasks (searching, reading many files, running tests) to sub-agents so this conversation stays small.';

/** What Vibe Studio adds to the agent's instructions for this run, or ''. */
export const extraInstructions = (o: { points?: boolean; low?: boolean }): string => [o.points && POINTS_PROMPT, o.low && LOW_PROMPT].filter(Boolean).join(' ');

export interface RunOptions {
  mode: string;
  /** '' = let the CLI use its default. */
  model: string;
  /** '' = let the CLI use its default. */
  effort: string;
  chrome: boolean;
  /** Ask for reports in bullet points (vibeStudio.reportInPoints). */
  points?: boolean;
  /** Low usage mode is on: the model and effort were chosen by the webview, this adds no MCP servers and the short-answers instruction. */
  low?: boolean;
}

export interface EffortInfo {
  levels: ModeOption[];
  /** Levels each model supports, when the agent says. */
  byModel: Record<string, string[]>;
}

export function effortLabel(level: string): string {
  return level === 'xhigh' ? 'Extra high' : level.charAt(0).toUpperCase() + level.slice(1);
}

/** Effort values end up inside CLI config strings; only plain words get through. */
export const isEffort = (s: string) => /^[a-z]+$/.test(s);

export interface RunPlan {
  args: string[];
  /** Prompt is written to stdin so it can never be parsed as a flag. */
  stdin: string;
}

export interface AgentAdapter {
  id: AgentId;
  label: string;
  modes: ModeOption[];
  listFiles(): Promise<SessionFile[]>;
  /** Null when the file is not a user-facing session (sub-agent, empty, ...). */
  readMeta(file: string, size: number): Promise<SessionMeta | null>;
  /** Optional title override that can change without the transcript changing. */
  titleFor?(id: string): string | undefined;
  refreshTitles?(): Promise<void>;
  /** sidechain: parse a sub-agent's own transcript (Claude marks those lines isSidechain). */
  createParser(opts?: { sidechain?: boolean }): TranscriptParser;
  resumePlan(id: string, text: string, opts: RunOptions): RunPlan;
  /** newId is set for agents that accept a caller-chosen session id. */
  newPlan(text: string, newId: string, opts: RunOptions): RunPlan;
  /** Whether the agent can drive the user's Chrome (Claude in Chrome). */
  supportsChrome: boolean;
  /** Extra environment for every run, e.g. to opt into tools that headless runs leave off. */
  env?: Record<string, string>;
  /**
   * A process that stays up across messages, one JSON line per message. Without it every message is a
   * fresh resume, which re-runs SessionStart hooks and MCP startup each time.
   */
  live?: {
    args(id: string, opts: RunOptions, fresh: boolean): string[];
    message(text: string, attachments?: Attachment[]): string;
    interrupt(): string;
    /** Changes the permission mode of the running process, so its sub-agents keep going. */
    setMode(mode: string): string;
    /** Stops one sub-agent (or background task) without ending the turn. */
    stopTask(taskId: string): string;
    isTurnEnd(line: string): boolean;
    controlReply(line: string): string | undefined;
  };
  /** Models to offer besides the ones seen in past sessions. */
  knownModels(): Promise<ModeOption[]>;
  /** Display name for a model id. */
  modelLabel(id: string): string;
  efforts(): Promise<EffortInfo>;
  supportsChosenId: boolean;
  /** Picks the session id out of a stdout line for agents that assign their own. */
  idFromStdout?(line: string): string | undefined;
  /** Error text from a stdout line, if the line reports a failure. */
  errorFromStdout(line: string): string | undefined;
  /** Where a brand new session's transcript will be written, if predictable. */
  expectedFile?(id: string, cwd: string): string | undefined;
}

export const HOME = os.homedir();

export function tildify(p: string): string {
  return p.startsWith(HOME) ? '~' + p.slice(HOME.length) : p;
}

export function oneLine(s: string, max = 160): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** TodoWrite / update_plan entries; `field` names the text key. Unknown statuses count as pending. */
export function todoEntries(list: unknown[], field: string): TodoEntry[] {
  return list
    .map((t: any) => ({ text: String(t?.[field] ?? '').trim(), status: t?.status === 'completed' || t?.status === 'in_progress' ? t.status : 'pending' }))
    .filter((t) => t.text);
}

export function lineCount(s: unknown): number {
  const text = String(s ?? '');
  return text ? text.split('\n').length : 0;
}

/** Per-file +/- line counts in an apply_patch style patch. */
export function patchStats(patch: string, cwd?: string): FileStat[] {
  const out: FileStat[] = [];
  let cur: FileStat | undefined;
  for (const line of patch.split('\n')) {
    const m = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/.exec(line);
    if (m) {
      const p = m[1].trim();
      cur = { path: cwd && !path.isAbsolute(p) ? path.join(cwd, p) : p, adds: 0, dels: 0 };
      out.push(cur);
    } else if (cur && !line.startsWith('***')) {
      if (line.startsWith('+')) cur.adds++;
      else if (line.startsWith('-')) cur.dels++;
    }
  }
  return out;
}

export function clip(s: string, max = 6000): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n… (${(s.length - max).toLocaleString()} more characters)`;
}

export function pretty(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function safeJson(line: string): any {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/** Complete lines found in the first `bytes` of a file. */
export async function headLines(file: string, bytes: number): Promise<string[]> {
  const fh = await fs.promises.open(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    const text = buf.subarray(0, bytesRead).toString('utf8');
    const lines = text.split('\n');
    if (bytesRead === bytes) lines.pop(); // last one may be cut
    return lines.filter(Boolean);
  } finally {
    await fh.close();
  }
}

/** Complete lines found in the last `bytes` of a file. */
export async function tailLines(file: string, size: number, bytes: number): Promise<string[]> {
  const start = Math.max(0, size - bytes);
  const fh = await fs.promises.open(file, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    const { bytesRead } = await fh.read(buf, 0, buf.length, start);
    const lines = buf.subarray(0, bytesRead).toString('utf8').split('\n');
    if (start > 0) lines.shift(); // first one may be cut
    return lines.filter(Boolean);
  } finally {
    await fh.close();
  }
}

export async function walkJsonl(dir: string, depth: number): Promise<SessionFile[]> {
  const out: SessionFile[] = [];
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && depth > 0) {
      out.push(...(await walkJsonl(full, depth - 1)));
    } else if (e.isFile() && e.name.endsWith('.jsonl')) {
      try {
        const st = await fs.promises.stat(full);
        out.push({ file: full, mtimeMs: st.mtimeMs, size: st.size });
      } catch {
        /* removed while scanning */
      }
    }
  }
  return out;
}
