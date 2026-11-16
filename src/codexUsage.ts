// Codex account limits. Codex writes its 5-hour and weekly windows into every session file (`token_count` events),
// so the newest one is the freshest reading. Read-only; nothing is sent anywhere.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AccountUsage, UsageWindow } from './types';

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** One `token_count` line: `payload.rate_limits.{primary,secondary} = {used_percent, window_minutes, resets_at (epoch seconds)}`. */
export function parseCodexLimits(line: string, now = Date.now()): AccountUsage | undefined {
  if (!line.includes('"used_percent"')) return undefined;
  let d: any;
  try {
    d = JSON.parse(line);
  } catch {
    return undefined;
  }
  const limits = d?.payload?.rate_limits;
  if (!limits) return undefined;
  const windows: UsageWindow[] = [];
  for (const w of [limits.primary, limits.secondary]) {
    if (typeof w?.used_percent !== 'number') continue;
    const weekly = Number(w.window_minutes) >= 24 * 60;
    const resetsAt = typeof w.resets_at === 'number' ? w.resets_at * 1000 : undefined;
    // a window that has reset since the reading starts over
    const over = resetsAt !== undefined && resetsAt <= now;
    windows.push({ id: weekly ? 'seven_day' : 'five_hour', label: weekly ? 'Weekly (7 day)' : 'Session (5hr)', pct: over ? 0 : clamp(w.used_percent), resetsAt: over ? undefined : resetsAt });
  }
  if (!windows.length) return undefined;
  const at = Date.parse(d.timestamp);
  return { windows, plan: typeof limits.plan_type === 'string' ? limits.plan_type : undefined, at: at || now };
}

/** The newest reading in the last few Codex session files, or undefined if Codex was never run with a plan login. */
export function latestCodexUsage(root = path.join(os.homedir(), '.codex', 'sessions'), now = Date.now()): AccountUsage | undefined {
  const files: { file: string; mtime: number }[] = [];
  const walk = (dir: string, depth: number) => {
    let names: string[];
    try {
      names = fs.readdirSync(dir).sort().reverse();
    } catch {
      return;
    }
    for (const n of names) {
      const p = path.join(dir, n);
      if (depth < 3) walk(p, depth + 1);
      else if (n.endsWith('.jsonl')) files.push({ file: p, mtime: fs.statSync(p).mtimeMs });
      if (files.length >= 12) return;
    }
  };
  walk(root, 0);
  for (const { file } of files.sort((a, b) => b.mtime - a.mtime).slice(0, 6)) {
    let tail: string;
    try {
      const fd = fs.openSync(file, 'r');
      const size = fs.fstatSync(fd).size;
      const len = Math.min(size, 256 * 1024);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      fs.closeSync(fd);
      tail = buf.toString('utf8');
    } catch {
      continue;
    }
    const lines = tail.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const u = lines[i].includes('"rate_limits"') ? parseCodexLimits(lines[i], now) : undefined;
      if (u) return u;
    }
  }
  return undefined;
}
