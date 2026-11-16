// Limit rules against the real shape of the CLI's replies. No CLI, no network.
// Usage: npm run test:usage
import * as assert from 'assert';
import { formatReset, mergeLimitEvent, parseUsage, timeLeft } from '../src/limits';

const NOW = Date.UTC(2026, 10, 13, 6, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

// `get_usage` reply: percentages 0-100, ISO reset times, plenty of null windows
const reply = {
  subscription_type: 'pro',
  rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: 8, resets_at: iso(NOW + 3 * 3600e3) },
    seven_day: { utilization: 45, resets_at: iso(NOW + 30 * 3600e3) },
    seven_day_opus: null,
    seven_day_sonnet: { utilization: 123, resets_at: null },
    model_scoped: [{ display_name: 'Haiku', utilization: 2.4, resets_at: iso(NOW + 40 * 3600e3) }],
  },
};
const { state, usage } = parseUsage(reply, NOW);
assert.equal(state, 'ok');
assert.deepEqual(usage!.windows.map((w) => [w.label, w.pct]), [['Session (5hr)', 8], ['Weekly (7 day)', 45], ['Weekly Sonnet', 100], ['Weekly Haiku', 2]], 'null windows skipped, percentages clamped');
assert.equal(usage!.windows[0].resetsAt, NOW + 3 * 3600e3);
assert.equal(usage!.windows[2].resetsAt, undefined);
assert.equal(usage!.plan, 'pro');

assert.equal(parseUsage({ rate_limits_available: false, rate_limits: null }).state, 'unavailable', 'API-key logins have no limits');
assert.equal(parseUsage({ rate_limits_available: true, rate_limits: { five_hour: null } }).state, 'unavailable');
assert.equal(parseUsage(undefined).state, 'unavailable');

// `rate_limit_event`: fractions and epoch seconds; it updates what changed and adds what is new
const event = { type: 'rate_limit_event', rate_limit_info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.12, resetsAt: (NOW + 2 * 3600e3) / 1000 }, seven_day: { utilization: 0.45, resetsAt: (NOW + 30 * 3600e3) / 1000 } } } };
const merged = mergeLimitEvent(usage, event, NOW + 1)!;
assert.equal(merged.windows.find((w) => w.id === 'five_hour')!.pct, 12);
assert.equal(merged.windows.find((w) => w.id === 'five_hour')!.resetsAt, NOW + 2 * 3600e3);
assert.equal(merged.windows.length, 4, 'other windows are kept');
assert.equal(mergeLimitEvent(merged, event, NOW + 2), undefined, 'an event that changes nothing is dropped');
assert.equal(mergeLimitEvent(undefined, event, NOW)!.windows.length, 2, 'events alone are enough to start');
assert.equal(mergeLimitEvent(usage, { type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }), undefined);

// reset wording
assert.equal(formatReset(NOW - 1, NOW), '', 'nothing once it has passed');
assert.equal(formatReset(NOW + 30e3, NOW), 'Resets soon');
assert.match(formatReset(NOW + 3 * 3600e3, NOW), /^Resets at \S+/);
assert.match(formatReset(NOW + 30 * 3600e3, NOW), /^Resets \w+ at /);

// time until a reset
const T = Date.parse('2026-01-01T12:00:00Z');
assert.equal(timeLeft(undefined, T), '');
assert.equal(timeLeft(T - 1, T), '');
assert.equal(timeLeft(T + 20_000, T), '1m');
assert.equal(timeLeft(T + 42 * 60_000, T), '42m');
assert.equal(timeLeft(T + 3 * 3600_000, T), '3h');
assert.equal(timeLeft(T + (3 * 60 + 12) * 60_000, T), '3h 12m');
assert.equal(timeLeft(T + (52 * 60) * 60_000, T), '2d 4h');
assert.equal(timeLeft(T + 48 * 3600_000, T), '2d');

console.log('usage self-test: ok');
