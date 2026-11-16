// Host-side files for the @ picker and the paperclip. No vscode import, so scripts/mention-selftest.ts can run it.
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { attachmentType, screenAttachments } from './mentions';
import type { Attachment, FileEntry } from './types';

const MAX_FILES = 20_000;
const MAX_DIRS = 5_000;
const CACHE_MS = 10_000;
const RG_TIMEOUT_MS = 8_000;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', '.cache', '.turbo', '.parcel-cache', '__pycache__', '.pytest_cache', '.mypy_cache', '.gradle']);

/** The ripgrep VS Code ships, if this build has one (older builds: @vscode/ripgrep, newer: @vscode/ripgrep-universal). */
export function rgFrom(appRoot: string): string | undefined {
  const exe = process.platform === 'win32' ? 'rg.exe' : 'rg';
  const candidates = [
    path.join(appRoot, 'node_modules', '@vscode', 'ripgrep', 'bin', exe),
    path.join(appRoot, 'node_modules.asar.unpacked', '@vscode', 'ripgrep', 'bin', exe),
    path.join(appRoot, 'node_modules.asar.unpacked', '@vscode', 'ripgrep-universal', 'bin', `${process.platform}-${process.arch}`, exe),
  ];
  return candidates.find((c) => fs.existsSync(c));
}

/** Lists files with ripgrep (stops at the cap). Undefined when it cannot run, so the caller walks instead. */
function rgFiles(rg: string, cwd: string): Promise<string[] | undefined> {
  return new Promise((resolve) => {
    const out: string[] = [];
    let buf = '';
    let done = false;
    const child = spawn(rg, ['--files', '--follow', '--hidden', '-g', '!.git', '-g', '!node_modules'], { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      resolve(ok ? out : undefined);
    };
    const timer = setTimeout(() => finish(out.length > 0), RG_TIMEOUT_MS);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      if (done) return;
      const lines = (buf + chunk).split('\n');
      buf = lines.pop() ?? '';
      for (const l of lines) if (l) out.push(l);
      if (out.length >= MAX_FILES) finish(true);
    });
    child.on('error', () => finish(false));
    // exit 1 = no files; 2 = some folders unreadable, the rest still listed
    child.on('close', (code) => {
      if (buf) out.push(buf);
      finish(code === 0 || code === 1 || out.length > 0);
    });
  });
}

/** Breadth-first walk with the skip list, for when there is no ripgrep. shortcut: symlinks are not followed, upgrade if needed. */
async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  const queue = [''];
  for (let dirs = 0; queue.length && out.length < MAX_FILES && dirs < MAX_DIRS; dirs++) {
    const rel = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(path.join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) queue.push(p);
      else if (e.isFile() && out.length < MAX_FILES) out.push(p);
    }
  }
  return out;
}

const entry = (p: string, folder?: boolean): FileEntry => {
  const i = p.lastIndexOf('/');
  return { path: p, name: p.slice(i + 1), dir: i < 0 ? '' : p.slice(0, i), ...(folder && { folder }) };
};

/** Relative file paths into entries, folders derived from the paths. Anything absolute or reaching outside the folder is dropped. */
export function withFolders(paths: string[]): FileEntry[] {
  const files = paths.map((p) => p.replace(/\\/g, '/').replace(/^\.\//, '')).filter((p) => p && !p.startsWith('/') && !/^[a-zA-Z]:/.test(p) && !p.split('/').includes('..'));
  const dirs = new Set<string>();
  for (const f of files) for (let i = f.indexOf('/'); i > 0; i = f.indexOf('/', i + 1)) dirs.add(f.slice(0, i));
  return [...[...dirs].sort().map((d) => entry(d, true)), ...files.map((f) => entry(f))];
}

const depth = (p: string) => p.split('/').length;

/** Lowest rank first: name starts with the query, name contains it, then the path matches as a subsequence. A query with "/" matches the path; one ending in "/" only lists inside that folder. */
function rank(e: FileEntry, q: string): number {
  const full = e.path.toLowerCase();
  const hay = q.includes('/') ? full : e.name.toLowerCase();
  if (hay.startsWith(q)) return 0;
  if (q.endsWith('/')) return -1;
  if (hay.includes(q)) return 1;
  let at = 0;
  for (const c of full) if (c === q[at] && ++at === q.length) return 2;
  return -1;
}

export function rankFiles(entries: FileEntry[], query: string, limit = 100): FileEntry[] {
  const q = query.toLowerCase();
  const scored: [number, number, FileEntry][] = [];
  for (const e of entries) {
    const r = q ? rank(e, q) : e.dir ? -1 : 0; // no query: the top level
    if (r >= 0) scored.push([r, depth(e.path), e]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1] || Number(!!b[2].folder) - Number(!!a[2].folder) || (a[2].path < b[2].path ? -1 : a[2].path > b[2].path ? 1 : 0));
  return scored.slice(0, limit).map((s) => s[2]);
}

const cache = new Map<string, { at: number; list: Promise<FileEntry[]> }>();

function listEntries(cwd: string, rg?: string): Promise<FileEntry[]> {
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.at >= CACHE_MS) cache.delete(k);
  const hit = cache.get(cwd);
  if (hit) return hit.list;
  const list = (async () => withFolders((rg && (await rgFiles(rg, cwd))) || (await walk(cwd))))();
  cache.set(cwd, { at: now, list });
  list.catch(() => cache.delete(cwd));
  return list;
}

/** Files and folders under `cwd` matching `query`, best first. [] unless `cwd` is an existing absolute folder. */
export async function findFiles(cwd: string, query: string, rg?: string): Promise<FileEntry[]> {
  const isDir = path.isAbsolute(cwd) && (await fs.promises.stat(cwd).then((s) => s.isDirectory(), () => false));
  return isDir ? rankFiles(await listEntries(cwd, rg), query) : [];
}

/** Reads files the user picked in the paperclip dialog; `message` says which were skipped and why. */
export async function readAttachments(paths: string[]): Promise<{ files: Attachment[]; message: string }> {
  const stats = await Promise.all(
    paths.map(async (p) => {
      const st = await fs.promises.stat(p).catch(() => undefined);
      return { path: p, name: path.basename(p), size: st?.isFile() ? st.size : 0 };
    }),
  );
  const { ok, message } = screenAttachments(stats, 0);
  const read = await Promise.all(
    ok.map(async (f): Promise<Attachment | undefined> => {
      const type = attachmentType(f.name)!;
      const buf = await fs.promises.readFile(f.path).catch(() => undefined);
      return buf && { name: f.name, type, size: f.size, data: buf.toString(type === 'text/plain' ? 'utf8' : 'base64') };
    }),
  );
  return { files: read.filter((a): a is Attachment => !!a), message };
}
