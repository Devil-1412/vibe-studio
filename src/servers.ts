// Dev servers per project and worktree: who listens on which port, found with lsof and git. macOS and Linux.
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { ProjectServers, ServerEntry } from './types';

export interface Listener extends ServerEntry {}

/** `lsof -iTCP -sTCP:LISTEN -nP -F pcn`: one p (pid) line, then c (command) and n (address) lines. */
export function parseListeners(out: string): Listener[] {
  const found = new Map<string, Listener>();
  let pid = 0;
  let cmd = '';
  for (const line of out.split('\n')) {
    const tag = line[0];
    const val = line.slice(1);
    if (tag === 'p') pid = Number(val);
    else if (tag === 'c') cmd = val;
    else if (tag === 'n') {
      const port = Number(val.slice(val.lastIndexOf(':') + 1));
      if (pid && port > 0) found.set(`${pid}:${port}`, { pid, port, cmd });
    }
  }
  return [...found.values()];
}

/** `lsof -a -d cwd -p … -Fpn`: pid to working folder. */
export function parseCwds(out: string): Map<number, string> {
  const cwds = new Map<number, string>();
  let pid = 0;
  for (const line of out.split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1));
    else if (line[0] === 'n' && pid) cwds.set(pid, line.slice(1));
  }
  return cwds;
}

/** `git worktree list --porcelain`. */
export function parseWorktrees(out: string): { path: string; branch?: string }[] {
  const trees: { path: string; branch?: string }[] = [];
  for (const block of out.split(/\n\n+/)) {
    const wt = block.match(/^worktree (.+)$/m)?.[1];
    if (wt) trees.push({ path: wt, branch: block.match(/^branch refs\/heads\/(.+)$/m)?.[1] });
  }
  return trees;
}

/** The project a folder belongs to: the deepest root that contains it. */
export function projectOf(cwd: string, roots: string[]): string | undefined {
  let best: string | undefined;
  for (const r of roots) if ((cwd === r || cwd.startsWith(r + path.sep)) && (!best || r.length > best.length)) best = r;
  return best;
}

/** Scripts that start a server, in the order they are offered. */
export function serverScripts(pkg: { scripts?: Record<string, unknown> } | undefined): string[] {
  const s = pkg?.scripts ?? {};
  return ['dev', 'local', 'start', 'serve'].filter((n) => typeof s[n] === 'string');
}

const run = (cmd: string, args: string[], cwd?: string) =>
  new Promise<string>((resolve) => execFile(cmd, args, { cwd, timeout: 5000, maxBuffer: 4 << 20 }, (_e, out) => resolve(out ?? '')));

function readScripts(root: string): string[] {
  try {
    return serverScripts(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')));
  } catch {
    return [];
  }
}

/** Every known folder, its git worktrees, and the servers listening inside each. */
export async function scanServers(folders: string[]): Promise<ProjectServers[]> {
  const roots = new Map<string, ProjectServers>();
  for (const f of folders) {
    const top = (await run('git', ['rev-parse', '--show-toplevel'], f)).trim();
    const trees = top ? parseWorktrees(await run('git', ['worktree', 'list', '--porcelain'], top)) : [{ path: f }];
    for (const t of trees) {
      if (roots.has(t.path) || !fs.existsSync(t.path)) continue;
      roots.set(t.path, { root: t.path, name: path.basename(t.path), branch: t.branch, worktree: !!top && t.path !== top, servers: [], scripts: readScripts(t.path) });
    }
  }
  const listeners = parseListeners(await run('lsof', ['-iTCP', '-sTCP:LISTEN', '-nP', '-F', 'pcn']));
  if (listeners.length) {
    const pids = [...new Set(listeners.map((l) => l.pid))].join(',');
    const cwds = parseCwds(await run('lsof', ['-a', '-d', 'cwd', '-p', pids, '-Fpn']));
    for (const l of listeners) {
      const root = projectOf(cwds.get(l.pid) ?? '', [...roots.keys()]);
      if (root) roots.get(root)!.servers.push(l);
    }
  }
  return [...roots.values()].map((p) => ({ ...p, servers: p.servers.sort((a, b) => a.port - b.port) }));
}
