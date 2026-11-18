// Builds the Agent map: every sub-agent a chat started, nested under the agent that started it,
// with status, usage and tool calls read from each agent's own transcript. No vscode import, so the
// parser check script can run it too.
import * as fs from 'fs';
import * as path from 'path';
import { ADAPTERS } from './store';
import { TailReader } from './tail';
import type { AgentId, AgentItem, AgentMap, AgentNode, AgentStatus, AgentTool, ChatItem } from './types';

const MAX_AGENTS = 200;
const MAX_DEPTH = 5;
const MAX_TOOLS = 300;
const CACHE_MAX = 200;
/** A running agent whose transcript has been quiet this long ended without reporting back. */
export const QUIET_MS = 120_000;

export interface AgentFile {
  file: string;
  agentId: string;
  /** The agent's own meta file says it is done. */
  finished?: boolean;
  mtime: number;
}

interface Meta {
  agentId: string;
  finished?: boolean;
}

const metaCache = new Map<string, { at: number; byTool: Map<string, Meta> }>();

/** spawn tool-call id → agent, from the .meta.json Claude writes beside each sub-agent transcript. */
function metasIn(dir: string): Map<string, Meta> {
  const hit = metaCache.get(dir);
  if (hit && Date.now() - hit.at < 1500) return hit.byTool;
  const byTool = new Map<string, Meta>();
  try {
    for (const name of fs.readdirSync(dir)) {
      const m = /^agent-(.+)\.meta\.json$/.exec(name);
      if (!m) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
        if (typeof meta.toolUseId === 'string') byTool.set(meta.toolUseId, { agentId: m[1], finished: meta.finished === true });
      } catch {
        /* half-written */
      }
    }
  } catch {
    /* no sub-agents yet */
  }
  metaCache.set(dir, { at: Date.now(), byTool });
  return byTool;
}

/** A running foreground agent has no agent id in the chat yet; its meta file still names the spawn call. */
export function claudeAgentFile(sessionFile: string, item: AgentItem): AgentFile | undefined {
  const dir = path.join(sessionFile.replace(/\.jsonl$/, ''), 'subagents');
  const meta = metasIn(dir).get(item.id);
  const agentId = meta?.agentId ?? item.agentId;
  if (!agentId || !/^[\w-]+$/.test(agentId)) return undefined;
  const file = path.join(dir, `agent-${agentId}.jsonl`);
  try {
    return { file, agentId, finished: meta?.finished, mtime: fs.statSync(file).mtimeMs };
  } catch {
    return undefined;
  }
}

/** Codex agents are threads with their own rollout file. */
export function codexAgentFile(fileFor: (key: string) => string | undefined, item: AgentItem): AgentFile | undefined {
  const file = item.agentId ? fileFor(`codex:${item.agentId}`) : undefined;
  if (!file) return undefined;
  try {
    return { file, agentId: item.agentId!, mtime: fs.statSync(file).mtimeMs };
  } catch {
    return undefined;
  }
}

/** `alive`: Vibe Studio runs this chat's process, which would have reported the agent ending, so a quiet transcript only means it is busy. */
export function agentStatus(item: AgentItem, f: AgentFile | undefined, now = Date.now(), alive = false): AgentStatus {
  if (item.status === 'done') return 'finished';
  if (item.status !== 'running') return item.status;
  if (f?.finished) return 'finished';
  return alive || now - (f?.mtime ?? item.startedAt ?? 0) < QUIET_MS ? 'working' : 'stopped';
}

interface Loaded {
  tools: AgentTool[];
  children: AgentItem[];
  model?: string;
  context?: number;
  out?: number;
  firstTs: number;
  lastTs: number;
}

const loaded = new Map<string, { sig: number; data: Loaded }>();

async function load(agent: AgentId, f: AgentFile): Promise<Loaded> {
  const hit = loaded.get(f.file);
  if (hit?.sig === f.mtime) return hit.data;
  const parser = ADAPTERS[agent].createParser({ sidechain: true });
  await new TailReader(f.file).read((line) => parser.feed(line));
  const tools: AgentTool[] = [];
  const children: AgentItem[] = [];
  for (const it of parser.items) {
    if (it.kind === 'tool') tools.push({ id: it.id, name: it.name, summary: it.summary, running: it.output === undefined, isError: it.isError });
    else if (it.kind === 'agent') {
      children.push(it);
      tools.push({ id: it.id, name: 'Agent', summary: it.description, running: it.status === 'running' });
    } else if (it.kind === 'todo') {
      // a checklist is still a tool call in the agent's list
      tools.push({ id: it.id, name: 'Todos', summary: `${it.items.filter((t) => t.status === 'completed').length}/${it.items.length} done`, running: false });
    }
  }
  const data: Loaded = {
    tools: tools.slice(-MAX_TOOLS),
    children,
    model: parser.model,
    context: parser.usage.context,
    out: parser.usage.out,
    firstTs: parser.firstTs,
    lastTs: parser.lastTs,
  };
  if (loaded.size >= CACHE_MAX) loaded.clear();
  loaded.set(f.file, { sig: f.mtime, data });
  return data;
}

export interface MapInput {
  agent: AgentId;
  items: ChatItem[];
  main: AgentMap['main'];
  canStop: boolean;
  resolve(item: AgentItem): AgentFile | undefined;
  now?: number;
}

export async function buildAgentMap(inp: MapInput): Promise<AgentMap> {
  const now = inp.now ?? Date.now();
  const agents: AgentNode[] = [];
  const seen = new Set<string>();

  const visit = async (items: ChatItem[], parentId: string | undefined, depth: number): Promise<void> => {
    for (const it of items) {
      if (it.kind !== 'agent' || seen.has(it.id) || agents.length >= MAX_AGENTS) continue;
      seen.add(it.id);
      const f = inp.resolve(it);
      const sub = f ? await load(inp.agent, f) : undefined;
      const status = agentStatus(it, f, now, inp.canStop);
      const startedAt = it.startedAt ?? (sub?.firstTs || undefined);
      const endedAt = it.endedAt ?? (status !== 'working' && sub?.lastTs ? sub.lastTs : undefined);
      const tools = sub?.tools ?? [];
      const current = tools.filter((t) => t.running).pop() ?? tools[tools.length - 1];
      agents.push({
        id: it.id,
        parentId,
        agentId: f?.agentId ?? it.agentId,
        description: it.description,
        agentType: it.agentType,
        model: it.model ?? sub?.model,
        background: it.background,
        status,
        prompt: it.prompt,
        result: it.report,
        startedAt,
        endedAt,
        durationMs: it.durationMs ?? (startedAt && endedAt ? endedAt - startedAt : undefined),
        // the last call's context plus its output is what the CLI reports as the agent's total
        tokens: it.tokens ?? (sub?.context != null ? sub.context + (sub.out ?? 0) : undefined),
        toolUses: it.toolUses ?? (sub ? tools.length : undefined),
        activity: status === 'working' && current ? `${current.name} ${current.summary}`.trim() : undefined,
        tools,
      });
      if (sub && depth < MAX_DEPTH) await visit(sub.children, it.id, depth + 1);
    }
  };

  await visit(inp.items, undefined, 0);
  return { main: inp.main, agents, canStop: inp.canStop, now };
}
