import * as path from 'path';
import { claude } from './adapters/claude';
import { codex } from './adapters/codex';
import type { AgentAdapter, SessionMeta } from './adapters/common';
import type { AgentId, SessionStatus, SessionSummary } from './types';

export const ADAPTERS: Record<AgentId, AgentAdapter> = { claude, codex };

interface Entry {
  agent: AgentId;
  key: string;
  file: string;
  mtimeMs: number;
  size: number;
  meta: SessionMeta | null;
}

const UUID_LEN = 36;

function idFromFile(agent: AgentId, file: string): string {
  const base = path.basename(file, '.jsonl');
  // codex: rollout-<timestamp>-<uuid>.jsonl
  return agent === 'codex' ? base.slice(-UUID_LEN) : base;
}

export function splitKey(key: string): { agent: AgentId; id: string } {
  const at = key.indexOf(':');
  return { agent: key.slice(0, at) as AgentId, id: key.slice(at + 1) };
}

/** Every session transcript on disk, with cheap metadata for the sidebar. */
export class SessionIndex {
  private byFile = new Map<string, Entry>();
  private byKey = new Map<string, Entry>();
  private scanning?: Promise<boolean>;

  scan(): Promise<boolean> {
    this.scanning ??= this.doScan().finally(() => (this.scanning = undefined));
    return this.scanning;
  }

  private async doScan(): Promise<boolean> {
    let changed = false;
    const seen = new Set<string>();
    for (const adapter of Object.values(ADAPTERS)) {
      await adapter.refreshTitles?.();
      for (const f of await adapter.listFiles()) {
        seen.add(f.file);
        const prev = this.byFile.get(f.file);
        if (prev && prev.mtimeMs === f.mtimeMs && prev.size === f.size) continue;
        let meta: SessionMeta | null = null;
        try {
          meta = await adapter.readMeta(f.file, f.size);
        } catch {
          meta = prev?.meta ?? null;
        }
        const id = meta?.id ?? idFromFile(adapter.id, f.file);
        this.byFile.set(f.file, { agent: adapter.id, key: `${adapter.id}:${id}`, file: f.file, mtimeMs: f.mtimeMs, size: f.size, meta });
        changed = true;
      }
    }
    for (const file of [...this.byFile.keys()]) {
      if (!seen.has(file)) {
        this.byFile.delete(file);
        changed = true;
      }
    }
    if (changed) {
      this.byKey.clear();
      for (const e of this.byFile.values()) {
        const prev = this.byKey.get(e.key);
        if (!prev || prev.mtimeMs < e.mtimeMs) this.byKey.set(e.key, e);
      }
    }
    return changed;
  }

  fileFor(key: string): string | undefined {
    return this.byKey.get(key)?.file;
  }

  cwdFor(key: string): string | undefined {
    return this.byKey.get(key)?.meta?.cwd || undefined;
  }

  /** Every model the agent's past sessions used. */
  modelsSeen(agent: AgentId): string[] {
    const out = new Set<string>();
    for (const e of this.byKey.values()) if (e.agent === agent && e.meta?.model) out.add(e.meta.model);
    return [...out];
  }

  summaries(statusFor: (key: string, mtimeMs: number) => SessionStatus): SessionSummary[] {
    const out: SessionSummary[] = [];
    for (const e of this.byKey.values()) {
      if (!e.meta) continue;
      const adapter = ADAPTERS[e.agent];
      out.push({
        key: e.key,
        agent: e.agent,
        id: e.meta.id,
        title: adapter.titleFor?.(e.meta.id) || e.meta.title || 'Untitled',
        cwd: e.meta.cwd,
        project: e.meta.cwd ? path.basename(e.meta.cwd) : '',
        updatedAt: e.mtimeMs,
        status: statusFor(e.key, e.mtimeMs),
      });
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }
}
