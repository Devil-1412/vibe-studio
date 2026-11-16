// Account limits (the 5-hour and weekly windows). Pure rules, no node or vscode imports.
import type { AccountUsage, UsageWindow } from './types';

const WINDOWS: Record<string, string> = {
  five_hour: 'Session (5hr)',
  seven_day: 'Weekly (7 day)',
  seven_day_opus: 'Weekly Opus',
  seven_day_sonnet: 'Weekly Sonnet',
};

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** The CLI's answer to `get_usage`: `rate_limits.<window> = {utilization: 0-100, resets_at: ISO}`. */
export function parseUsage(res: any, now = Date.now()): { state: 'ok' | 'unavailable'; usage?: AccountUsage } {
  const limits = res?.rate_limits;
  if (res?.rate_limits_available === false || !limits || typeof limits !== 'object') return { state: 'unavailable' };
  const windows: UsageWindow[] = [];
  const add = (id: string, label: string, w: any) => {
    if (typeof w?.utilization === 'number') windows.push({ id, label, pct: clamp(w.utilization), resetsAt: Date.parse(w.resets_at) || undefined });
  };
  for (const [id, label] of Object.entries(WINDOWS)) add(id, label, limits[id]);
  for (const m of Array.isArray(limits.model_scoped) ? limits.model_scoped : []) add(`model:${m?.display_name}`, `Weekly ${m?.display_name}`, m);
  return windows.length ? { state: 'ok', usage: { windows, plan: typeof res.subscription_type === 'string' ? res.subscription_type : undefined, at: now } } : { state: 'unavailable' };
}

/** A `rate_limit_event` from any run: `unifiedWindows.<window> = {utilization: fraction, resetsAt: epoch seconds}`. */
export function mergeLimitEvent(prev: AccountUsage | undefined, event: any, now = Date.now()): AccountUsage | undefined {
  const unified = event?.rate_limit_info?.unifiedWindows;
  if (!unified || typeof unified !== 'object') return undefined;
  const windows = [...(prev?.windows ?? [])];
  let changed = false;
  for (const [id, label] of Object.entries(WINDOWS)) {
    const w = unified[id];
    if (typeof w?.utilization !== 'number') continue;
    const next: UsageWindow = { id, label, pct: clamp(w.utilization * 100), resetsAt: typeof w.resetsAt === 'number' ? w.resetsAt * 1000 : undefined };
    const at = windows.findIndex((x) => x.id === id);
    if (at < 0) windows.push(next);
    else if (windows[at].pct !== next.pct || windows[at].resetsAt !== next.resetsAt) windows[at] = next;
    else continue;
    changed = true;
  }
  return changed ? { windows, plan: prev?.plan, at: now } : undefined;
}

/** Time until a reset: "<1m", "42m", "3h 12m", "2d 4h"; empty once it has passed. */
export function timeLeft(resetsAt: number | undefined, now = Date.now()): string {
  if (!resetsAt || resetsAt <= now) return '';
  const min = Math.ceil((resetsAt - now) / 60_000);
  if (min < 1) return '<1m';
  if (min < 60) return `${min}m`;
  if (min < 24 * 60) return `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ''}`;
  const h = Math.floor((min % (24 * 60)) / 60);
  return `${Math.floor(min / (24 * 60))}d${h ? ` ${h}h` : ''}`;
}

/** "Resets soon", "Resets at 3:19 PM" (a window under a day away), or "Resets Fri at 4:29 PM"; nothing once it has passed. */
export function formatReset(resetsAt: number | undefined, now = Date.now()): string {
  if (!resetsAt || resetsAt <= now) return '';
  const d = new Date(resetsAt);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (resetsAt - now < 60_000) return 'Resets soon';
  return resetsAt - now < 24 * 3_600_000 ? `Resets at ${time}` : `Resets ${d.toLocaleDateString(undefined, { weekday: 'short' })} at ${time}`;
}
