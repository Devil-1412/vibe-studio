// Skills and commands each agent can run, read from the same places the CLIs load them from.
import * as fs from 'fs';
import * as path from 'path';
import { HOME, oneLine, safeJson } from './adapters/common';
import type { AgentId, SkillInfo } from './types';

const CLAUDE = process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude');
const CODEX = process.env.CODEX_HOME || path.join(HOME, '.codex');
const TTL_MS = 60_000;

async function readHead(file: string, bytes = 8192): Promise<string | undefined> {
  try {
    const fh = await fs.promises.open(file, 'r');
    try {
      const buf = Buffer.alloc(bytes);
      const { bytesRead } = await fh.read(buf, 0, bytes, 0);
      return buf.subarray(0, bytesRead).toString('utf8');
    } finally {
      await fh.close();
    }
  } catch {
    return undefined;
  }
}

async function dirents(dir: string): Promise<fs.Dirent[]> {
  try {
    return await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Minimal YAML frontmatter: `key: value`, plus `key: >`/`|` folded blocks. */
function frontmatter(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!text.startsWith('---')) return out;
  const end = text.indexOf('\n---', 3);
  const lines = text.slice(3, end < 0 ? undefined : end).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z_-]+):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    let v = m[2].trim();
    if (/^[>|][+-]?$/.test(v)) {
      const parts: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) parts.push(lines[++i].trim());
      v = parts.join(' ');
    }
    out[m[1]] = v.replace(/^["']|["']$/g, '');
  }
  return out;
}

/** First prose line after the frontmatter, for commands without a description. */
function firstLine(text: string): string {
  const body = text.startsWith('---') ? text.slice(text.indexOf('\n---', 3) + 4) : text;
  return body.split('\n').find((l) => l.trim() && !l.startsWith('#'))?.trim() ?? '';
}

/** <dir>/<skill>/SKILL.md, or <dir>/SKILL.md when dir is itself a skill. */
async function skillsIn(dir: string, prefix: string, source: string): Promise<SkillInfo[]> {
  const own = await readHead(path.join(dir, 'SKILL.md'));
  const entries = own ? [{ dir, text: own }] : [];
  if (!own) {
    for (const e of await dirents(dir)) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const text = await readHead(path.join(dir, e.name, 'SKILL.md'));
      if (text) entries.push({ dir: path.join(dir, e.name), text });
    }
  }
  return entries.map(({ dir: d, text }) => {
    const fm = frontmatter(text);
    const name = fm.name || path.basename(d);
    return { name: prefix ? `${prefix}:${name}` : name, description: oneLine(fm.description ?? firstLine(text), 220), source };
  });
}

/** Markdown commands; sub-folders namespace them (folder:name). */
async function commandsIn(dir: string, prefix: string, source: string, ns = ''): Promise<SkillInfo[]> {
  const out: SkillInfo[] = [];
  for (const e of await dirents(dir)) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && !e.name.startsWith('.')) {
      out.push(...(await commandsIn(full, prefix, source, ns ? `${ns}:${e.name}` : e.name)));
    } else if (e.isFile() && e.name.endsWith('.md')) {
      const text = (await readHead(full)) ?? '';
      const fm = frontmatter(text);
      const base = [ns, path.basename(e.name, '.md')].filter(Boolean).join(':');
      out.push({ name: prefix ? `${prefix}:${base}` : base, description: oneLine(fm.description ?? firstLine(text), 220), source });
    }
  }
  return out;
}

/** Skill and command folders a plugin declares in its manifest, or the conventional ones. */
async function pluginParts(root: string, plugin: string, source: string): Promise<SkillInfo[]> {
  const manifest = safeJson((await readHead(path.join(root, '.claude-plugin', 'plugin.json'), 65536)) ?? '') ?? {};
  const name: string = typeof manifest.name === 'string' ? manifest.name : plugin;
  const paths = (v: unknown) => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).map((p) => path.resolve(root, String(p)));
  const out: SkillInfo[] = [];
  for (const dir of paths(manifest.skills).length ? paths(manifest.skills) : [path.join(root, 'skills')]) {
    out.push(...(await skillsIn(dir, name, source)));
  }
  if (!out.length) out.push(...(await skillsIn(root, name, source))); // plugin root holds the skill folders
  for (const dir of paths(manifest.commands).length ? paths(manifest.commands) : [path.join(root, 'commands')]) {
    out.push(...(await commandsIn(dir, name, source)));
  }
  return out;
}

async function claudeEnabledPlugins(cwd?: string): Promise<string[]> {
  const enabled: Record<string, boolean> = {};
  const files = [path.join(CLAUDE, 'settings.json')];
  if (cwd) files.push(path.join(cwd, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.local.json'));
  for (const f of files) {
    const s = safeJson((await readHead(f, 262144)) ?? '');
    if (s?.enabledPlugins && typeof s.enabledPlugins === 'object') Object.assign(enabled, s.enabledPlugins);
  }
  return Object.entries(enabled)
    .filter(([, on]) => on)
    .map(([id]) => id);
}

async function claudeSkills(cwd?: string): Promise<SkillInfo[]> {
  const out = [
    ...(await skillsIn(path.join(CLAUDE, 'skills'), '', 'Personal')),
    ...(await commandsIn(path.join(CLAUDE, 'commands'), '', 'Personal')),
  ];
  if (cwd) {
    out.push(...(await skillsIn(path.join(cwd, '.claude', 'skills'), '', 'Project')));
    out.push(...(await commandsIn(path.join(cwd, '.claude', 'commands'), '', 'Project')));
  }
  const installed = safeJson((await readHead(path.join(CLAUDE, 'plugins', 'installed_plugins.json'), 1 << 20)) ?? '')?.plugins ?? {};
  for (const id of await claudeEnabledPlugins(cwd)) {
    const root = installed[id]?.[0]?.installPath;
    const plugin = id.split('@')[0];
    if (typeof root === 'string') out.push(...(await pluginParts(root, plugin, `Plugin · ${plugin}`)));
  }
  return out;
}

async function latestVersionDir(dir: string): Promise<string | undefined> {
  const versions = (await dirents(dir)).filter((e) => e.isDirectory()).map((e) => e.name);
  versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  return versions[0] ? path.join(dir, versions[0]) : undefined;
}

async function codexSkills(cwd?: string): Promise<SkillInfo[]> {
  const out = [
    ...(await skillsIn(path.join(CODEX, 'skills'), '', 'Personal')),
    ...(await skillsIn(path.join(CODEX, 'skills', '.system'), '', 'System')),
  ];
  if (cwd) {
    out.push(...(await skillsIn(path.join(cwd, '.codex', 'skills'), '', 'Project')));
    out.push(...(await skillsIn(path.join(cwd, '.agents', 'skills'), '', 'Project')));
  }
  // [plugins."name@marketplace"] blocks; enabled unless the block says enabled = false
  const config = (await readHead(path.join(CODEX, 'config.toml'), 1 << 20)) ?? '';
  for (const m of config.matchAll(/^\[plugins\."([^"]+)"\]([^[]*)/gm)) {
    if (/^\s*enabled\s*=\s*false/m.test(m[2])) continue;
    const [plugin, marketplace] = m[1].split('@');
    if (!plugin || !marketplace) continue;
    const root = await latestVersionDir(path.join(CODEX, 'plugins', 'cache', marketplace, plugin));
    if (root) out.push(...(await skillsIn(path.join(root, 'skills'), plugin, `Plugin · ${plugin}`)));
  }
  return out;
}

const cache = new Map<string, { at: number; list: Promise<SkillInfo[]> }>();

export function listSkills(agent: AgentId, cwd?: string): Promise<SkillInfo[]> {
  const key = `${agent}|${cwd ?? ''}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.list;
  const list = (agent === 'claude' ? claudeSkills(cwd) : codexSkills(cwd)).then((all) => {
    const seen = new Set<string>();
    return all.filter((s) => !seen.has(s.name) && seen.add(s.name)).sort((a, b) => a.name.localeCompare(b.name));
  });
  cache.set(key, { at: Date.now(), list });
  return list;
}
