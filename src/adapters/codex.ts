import * as fs from 'fs';
import * as path from 'path';
import {
  AgentAdapter,
  HOME,
  extraInstructions,
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
  tildify,
  todoEntries,
  walkJsonl,
} from './common';

const ROOT = process.env.CODEX_HOME || path.join(HOME, '.codex');
const SESSIONS = path.join(ROOT, 'sessions');
const INDEX = path.join(ROOT, 'session_index.jsonl');
const HIDDEN_SOURCES = new Set(['subagent', 'guardian_review']);

function isInjected(text: string): boolean {
  const s = text.trimStart();
  return (
    s.startsWith('# AGENTS.md instructions') ||
    s.startsWith('<image') ||
    s.startsWith('</image') ||
    /^<([a-z_]+)[^>]*>[\s\S]*<\/\1>\s*$/.test(s)
  );
}

function outputText(output: unknown): string {
  if (typeof output === 'string') {
    const parsed = safeJson(output);
    if (parsed && typeof parsed.output === 'string') return parsed.output;
    return output;
  }
  if (Array.isArray(output)) {
    return output
      .map((p: any) => (typeof p?.text === 'string' ? p.text : p?.type === 'input_image' ? '[image]' : ''))
      .filter(Boolean)
      .join('\n');
  }
  if (output && typeof (output as any).content !== 'undefined') return outputText((output as any).content);
  return pretty(output);
}

function patchFiles(patch: string): string {
  const files = [...patch.matchAll(/\*\*\* (?:Update|Add|Delete) File: (.+)/g)].map((m) => path.basename(m[1].trim()));
  return files.join(', ');
}

function shellText(command: unknown): string {
  if (Array.isArray(command)) {
    // ["bash", "-lc", "<script>"] → the script is what matters
    const last = command[command.length - 1];
    return command.length >= 3 && /^-\w*c$/.test(String(command[command.length - 2])) ? String(last) : command.join(' ');
  }
  return String(command ?? '');
}

/** The `exec` tool wraps calls in JavaScript; pull out the command or patch it runs. */
function describeExec(code: string): { name: string; summary: string; input: string; diff: boolean } {
  const patchAt = code.indexOf('*** Begin Patch');
  if (patchAt >= 0) {
    const end = code.indexOf('*** End Patch', patchAt);
    let patch = code.slice(patchAt, end >= 0 ? end + 13 : undefined);
    // Patches passed inside a JS string literal arrive with escaped newlines and quotes.
    if (!patch.includes('\n') && patch.includes('\\n')) {
      patch = patch.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    return { name: 'Edit', summary: patchFiles(patch), input: clip(patch), diff: true };
  }
  const cmd = /\b(?:cmd|command)\s*:\s*("(?:[^"\\]|\\.)*"|`[^`]*`|'(?:[^'\\]|\\.)*')/.exec(code);
  if (cmd) {
    let s = cmd[1];
    try {
      s = s.startsWith('"') ? JSON.parse(s) : s.slice(1, -1);
    } catch {
      s = s.slice(1, -1);
    }
    return { name: 'Shell', summary: oneLine(tildify(s)), input: s, diff: false };
  }
  const call = /tools\.([A-Za-z0-9_]+)\(/.exec(code);
  const first = code.split('\n').find((l) => l.trim()) ?? '';
  return { name: call ? call[1] : 'exec', summary: oneLine(first), input: clip(code, 4000), diff: false };
}

export class CodexParser extends TranscriptParser {
  cwd?: string;
  id?: string;
  threadSource?: string;
  /** agent thread id → spawn_agent call id */
  private readonly agentThreads = new Map<string, string>();

  feed(line: string): void {
    if (line.length > 200_000 && line.slice(0, 120).includes('"world_state"')) return;
    const d = safeJson(line);
    if (!d || typeof d !== 'object') return;
    const p = d.payload ?? {};
    this.stamp(d.timestamp);
    switch (d.type) {
      case 'session_meta':
        this.id ??= p.id;
        this.cwd ??= p.cwd;
        this.threadSource ??= typeof p.thread_source === 'string' ? p.thread_source : undefined;
        return;
      case 'compacted':
        this.add({ id: `compact:${d.timestamp}`, kind: 'note', text: 'Conversation compacted' });
        return;
      case 'turn_context':
        if (typeof p.model === 'string' && p.model) this.model = p.model;
        if (typeof p.effort === 'string' && p.effort) this.effort = p.effort;
        return;
      case 'event_msg':
        if (p.type === 'thread_settings_applied') {
          const s = p.thread_settings ?? {};
          if (typeof s.model === 'string' && s.model) this.model = s.model;
          if (typeof s.reasoning_effort === 'string' && s.reasoning_effort) this.effort = s.reasoning_effort;
        } else if (p.type === 'token_count' && p.info) {
          const last = p.info.last_token_usage ?? {};
          const context = typeof last.total_tokens === 'number' ? last.total_tokens : (last.input_tokens ?? 0) + (last.output_tokens ?? 0);
          this.usage = {
            ...this.usage,
            context: context || this.usage.context,
            window: typeof p.info.model_context_window === 'number' ? p.info.model_context_window : this.usage.window,
            total: p.info.total_token_usage?.total_tokens ?? this.usage.total,
          };
        } else if (p.type === 'task_started') this.startTurn('');
        else if (p.type === 'task_complete') this.endTurn();
        else if (p.type === 'item_completed' && p.item?.type === 'FileChange') this.fileChange(p.item);
        else if (p.type === 'item_completed' && p.item?.type === 'SubAgentActivity') this.agentActivity(p.item);
        else if (p.type === 'turn_aborted') {
          this.endTurn();
          this.add({ id: `abort:${p.turn_id}`, kind: 'note', text: 'Turn interrupted' });
        }
        else if (p.type === 'error')
          this.add({ id: `err:${d.timestamp}`, kind: 'note', text: String(p.message ?? 'Error'), tone: 'error' });
        return;
      case 'response_item':
        this.responseItem(p, d.timestamp);
        return;
    }
  }

  private responseItem(p: any, ts: string): void {
    const id: string = p.call_id ?? p.id ?? `${p.type}:${ts}:${this.items.length}`;
    if (!(p.type === 'message' && p.role === 'user')) this.activity();
    switch (p.type) {
      case 'message': {
        const parts: any[] = Array.isArray(p.content) ? p.content : [];
        if (p.role === 'user') {
          // A picked skill arrives as an injected <skill><name>…</name> block.
          for (const c of parts) {
            if (typeof c?.text !== 'string') continue;
            for (const m of c.text.matchAll(/<skill>\s*<name>([^<]+)<\/name>/g)) this.useSkill(m[1]);
          }
          const texts = parts
            .map((c) => (c?.type === 'input_image' ? '[image]' : typeof c?.text === 'string' && !isInjected(c.text) ? c.text : ''))
            .filter(Boolean);
          const text = texts.join('\n\n').trim();
          if (text) {
            this.add({ id, kind: 'user', text });
            // task_started opens the turn; the prompt that follows names it.
            const turn = this.turns[this.turns.length - 1];
            if (turn && !turn.closed && !turn.text) turn.text = oneLine(text, 140);
            else this.startTurn(text);
          }
        } else if (p.role === 'assistant') {
          const text = parts
            .map((c) => (typeof c?.text === 'string' ? c.text : ''))
            .join('')
            .trim();
          if (text) this.add({ id, kind: 'assistant', text });
        }
        return;
      }
      case 'reasoning': {
        const text = (Array.isArray(p.summary) ? p.summary : [])
          .map((s: any) => s?.text ?? '')
          .join('\n\n')
          .trim();
        if (text) this.add({ id, kind: 'thinking', text });
        return;
      }
      case 'custom_tool_call': {
        const input = String(p.input ?? '');
        if (p.name === 'apply_patch') {
          this.add({ id, kind: 'tool', name: 'Edit', summary: patchFiles(input), input: clip(input), diff: true });
        } else if (p.name === 'exec') {
          this.add({ id, kind: 'tool', ...describeExec(input) });
          this.skillsFromCommand(input);
        } else {
          this.add({ id, kind: 'tool', name: p.name ?? 'tool', summary: oneLine(input), input: clip(input, 4000) });
        }
        return;
      }
      case 'function_call':
        this.functionCall(id, p);
        return;
      case 'local_shell_call': {
        const cmd = shellText(p.action?.command);
        this.add({ id, kind: 'tool', name: 'Shell', summary: oneLine(tildify(cmd)), input: cmd });
        this.skillsFromCommand(cmd);
        return;
      }
      case 'web_search_call': {
        const q = p.action?.query ?? p.action?.url ?? (Array.isArray(p.action?.queries) ? p.action.queries[0] : '');
        this.add({ id, kind: 'tool', name: 'Web search', summary: oneLine(String(q ?? '')), input: pretty(p.action ?? {}) });
        return;
      }
      case 'function_call_output':
      case 'custom_tool_call_output':
      case 'local_shell_call_output': {
        const item = this.get(p.call_id);
        const text = outputText(p.output);
        const failed = p.status === 'failed' || /\bexit code: [1-9]/.test(text.slice(0, 200));
        if (!item || item.kind !== 'tool') return;
        item.output = clip(text);
        item.isError = failed;
        this.touch(item.id);
        return;
      }
    }
  }

  /** started carries the spawn call id; later events only the agent's thread id. */
  private agentActivity(a: any): void {
    const agent = this.get(this.agentThreads.get(a.agent_thread_id) ?? a.id);
    if (agent?.kind !== 'agent') return;
    if (a.kind === 'started' && typeof a.agent_thread_id === 'string') {
      agent.agentId = a.agent_thread_id;
      this.agentThreads.set(a.agent_thread_id, agent.id);
      if (typeof a.model === 'string') agent.model = a.model;
    } else if (a.kind === 'completed') agent.status = 'done';
    else if (a.kind === 'interrupted') agent.status = 'stopped';
    else if (a.kind === 'failed' || a.kind === 'errored') agent.status = 'failed';
    if (agent.status !== 'running') agent.endedAt = this.ts;
    this.touch(agent.id);
  }

  /** Codex loads a skill by reading its SKILL.md, so a read of one means the skill was used. */
  private skillsFromCommand(text: string): void {
    if (!text.includes('SKILL.md')) return;
    for (const m of text.matchAll(/plugins\/cache\/[^/\s'"]+\/([^/\s'"]+)\/[^/\s'"]+\/skills\/([\w.-]+)\/SKILL\.md/g)) this.useSkill(`${m[1]}:${m[2]}`);
    for (const m of text.matchAll(/\.codex\/skills\/(?:\.system\/)?([\w.-]+)\/SKILL\.md/g)) this.useSkill(m[1]);
  }

  /** Codex logs every applied change as a FileChange item with a unified diff per file. */
  private fileChange(item: any): void {
    for (const [file, change] of Object.entries<any>(item.changes ?? {})) {
      const full = this.cwd && !path.isAbsolute(file) ? path.join(this.cwd, file) : file;
      let adds = 0;
      let dels = 0;
      if (typeof change?.unified_diff === 'string') {
        for (const line of change.unified_diff.split('\n')) {
          if (line.startsWith('+') && !line.startsWith('+++')) adds++;
          else if (line.startsWith('-') && !line.startsWith('---')) dels++;
        }
      } else if (typeof change?.content === 'string') {
        if (change.type === 'delete') dels = lineCount(change.content);
        else adds = lineCount(change.content);
      }
      this.recordEdit({ path: full, adds, dels });
    }
  }

  private functionCall(id: string, p: any): void {
    const args = typeof p.arguments === 'string' ? safeJson(p.arguments) ?? p.arguments : p.arguments ?? {};
    const name: string = p.name ?? 'tool';
    if (name === 'exec_command' || name === 'shell' || name === 'container.exec' || name === 'local_shell') {
      const cmd = name === 'exec_command' ? String(args?.cmd ?? '') : shellText(args?.command);
      this.add({ id, kind: 'tool', name: 'Shell', summary: oneLine(tildify(cmd)), input: cmd });
      this.skillsFromCommand(cmd);
    } else if (name === 'apply_patch') {
      const patch = String(args?.input ?? args ?? '');
      this.add({ id, kind: 'tool', name: 'Edit', summary: patchFiles(patch), input: clip(patch), diff: true });
    } else if (name === 'spawn_agent') {
      const message = typeof args?.message === 'string' ? args.message : '';
      this.add({
        id,
        kind: 'agent',
        agentType: 'Codex agent',
        description: String(args?.task_name ?? 'sub-agent'),
        // Codex stores the brief encrypted (gAAAA…); only show it when it is readable
        prompt: message.startsWith('gAAAA') ? '' : clip(message, 8000),
        model: typeof args?.model === 'string' ? args.model : undefined,
        status: 'running',
        startedAt: this.ts || undefined,
      });
    } else if (name === 'update_plan' && Array.isArray(args?.plan)) {
      this.add({ id, kind: 'todo', items: todoEntries(args.plan, 'step') });
    } else {
      const first = args && typeof args === 'object' ? Object.values(args).find((v) => typeof v === 'string') : args;
      this.add({
        id,
        kind: 'tool',
        name: p.namespace ? `${p.namespace}: ${name}` : name,
        summary: oneLine(tildify(String(first ?? ''))),
        input: clip(pretty(args), 4000),
      });
    }
  }
}

const effortArgs = (effort: string) => (effort && isEffort(effort) ? ['-c', `model_reasoning_effort="${effort}"`] : []);

let titles = new Map<string, string>();
let titlesMtime = -1;
const modelNames = new Map<string, string>();
const modelEfforts: Record<string, string[]> = {};

/** Models the Codex CLI cached from its own model list. The file format is not documented, so read it defensively. */
async function cachedModels(): Promise<{ value: string; label: string }[]> {
  try {
    const raw = JSON.parse(await fs.promises.readFile(path.join(ROOT, 'models_cache.json'), 'utf8'));
    const list: unknown[] = Array.isArray(raw) ? raw : Array.isArray(raw?.models) ? raw.models : Array.isArray(raw?.data) ? raw.data : [];
    const out: { value: string; label: string }[] = [];
    for (const m of list as any[]) {
      const slug = typeof m === 'string' ? m : m?.slug ?? m?.id ?? m?.model;
      if (typeof slug !== 'string' || !slug) continue;
      if (m?.visibility === 'hide' || m?.visibility === 'hidden') continue;
      const label = typeof m?.display_name === 'string' && m.display_name ? m.display_name : slug;
      modelNames.set(slug, label);
      if (Array.isArray(m?.supported_reasoning_levels)) {
        modelEfforts[slug] = m.supported_reasoning_levels
          .map((l: any) => (typeof l === 'string' ? l : l?.effort))
          .filter((e: unknown): e is string => typeof e === 'string' && isEffort(e));
      }
      out.push({ value: slug, label });
    }
    return out;
  } catch {
    return [];
  }
}

export const codex: AgentAdapter = {
  id: 'codex',
  label: 'Codex',
  modes: [
    { value: 'workspace-write', label: 'Workspace write' },
    { value: 'read-only', label: 'Read only' },
    { value: 'danger-full-access', label: 'Full access' },
  ],
  supportsChosenId: false,

  // sessions/YYYY/MM/DD/rollout-*.jsonl
  listFiles: () => walkJsonl(SESSIONS, 3),

  async refreshTitles() {
    try {
      const st = await fs.promises.stat(INDEX);
      if (st.mtimeMs === titlesMtime) return;
      const next = new Map<string, string>();
      for (const line of (await fs.promises.readFile(INDEX, 'utf8')).split('\n')) {
        const d = safeJson(line);
        if (d?.id && d.thread_name) next.set(d.id, d.thread_name);
      }
      titles = next;
      titlesMtime = st.mtimeMs;
    } catch {
      /* no index yet */
    }
  },

  titleFor: (id) => titles.get(id),

  async readMeta(file, size): Promise<SessionMeta | null> {
    for (const bytes of [128 * 1024, 1024 * 1024, 4 * 1024 * 1024]) {
      const parser = new CodexParser();
      for (const line of await headLines(file, Math.min(size, bytes))) parser.feed(line);
      if (parser.threadSource && HIDDEN_SOURCES.has(parser.threadSource)) return null;
      const firstUser = parser.items.find((i) => i.kind === 'user');
      if (parser.id && (firstUser || titles.has(parser.id))) {
        return { id: parser.id, title: firstUser ? oneLine(firstUser.text, 90) : '', cwd: parser.cwd ?? '', model: parser.model };
      }
      if (bytes >= size) break;
    }
    return null;
  },

  createParser: () => new CodexParser(),

  knownModels: cachedModels,
  modelLabel: (id) => modelNames.get(id) ?? id,
  async efforts() {
    await cachedModels();
    const all = new Set<string>();
    for (const levels of Object.values(modelEfforts)) for (const l of levels) all.add(l);
    // Fallback when the cache is missing: the levels Codex's own picker uses.
    const levels = all.size ? [...all] : ['low', 'medium', 'high', 'xhigh'];
    return { levels: levels.map((value) => ({ value, label: effortLabel(value) })), byModel: { ...modelEfforts } };
  },

  supportsChrome: false,
  resumePlan: (id, text, { mode, model, effort, points, low }): RunPlan => ({
    args: [
      'exec',
      'resume',
      '--json',
      '--skip-git-repo-check',
      '-c',
      `sandbox_mode="${mode}"`,
      '-c',
      'approval_policy="never"',
      ...(model ? ['-m', model] : []),
      ...effortArgs(effort),
      ...(points || low ? ['-c', `developer_instructions=${JSON.stringify(extraInstructions({ points, low }))}`] : []),
      id,
      '-',
    ],
    stdin: text,
  }),
  newPlan: (text, _newId, { mode, model, effort, points, low }): RunPlan => ({
    args: [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '-s',
      mode,
      '-c',
      'approval_policy="never"',
      ...(model ? ['-m', model] : []),
      ...effortArgs(effort),
      ...(points || low ? ['-c', `developer_instructions=${JSON.stringify(extraInstructions({ points, low }))}`] : []),
      '-',
    ],
    stdin: text,
  }),

  idFromStdout(line) {
    const d = safeJson(line);
    return d?.type === 'thread.started' ? d.thread_id : d?.msg?.type === 'session_configured' ? d.msg.session_id : undefined;
  },

  errorFromStdout(line) {
    const d = safeJson(line);
    if (d?.type === 'error') return String(d.message ?? 'Codex reported an error');
    if (d?.type === 'turn.failed') return String(d.error?.message ?? 'Turn failed');
    return undefined;
  },
};
