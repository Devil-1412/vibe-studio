// Codex limits from a session line. Usage: npm run test:codex
import * as assert from 'assert';
import { parseCodexLimits } from '../src/codexUsage';

const NOW = Date.parse('2026-11-13T10:00:00Z');
const line = (rl: unknown) => JSON.stringify({ timestamp: '2026-11-13T09:30:00Z', type: 'event_msg', payload: { type: 'token_count', rate_limits: rl } });

const u = parseCodexLimits(line({ primary: { used_percent: 49, window_minutes: 300, resets_at: NOW / 1000 + 7200 }, secondary: { used_percent: 50.4, window_minutes: 10080, resets_at: NOW / 1000 + 86400 * 3 }, plan_type: 'plus' }), NOW)!;
assert.deepEqual(u.windows.map((w) => [w.id, w.pct]), [['five_hour', 49], ['seven_day', 50]]);
assert.equal(u.windows[0].resetsAt, NOW + 7200_000);
assert.equal(u.plan, 'plus');
assert.equal(u.at, Date.parse('2026-11-13T09:30:00Z'));

// a window that has reset since the reading starts over at 0%
const old = parseCodexLimits(line({ primary: { used_percent: 90, window_minutes: 300, resets_at: NOW / 1000 - 60 }, secondary: null }), NOW)!;
assert.deepEqual(old.windows.map((w) => [w.id, w.pct, w.resetsAt]), [['five_hour', 0, undefined]]);

// no plan limits (API-key logins), junk, and unrelated lines give nothing
assert.equal(parseCodexLimits(line({ primary: null, secondary: null }), NOW), undefined);
assert.equal(parseCodexLimits('{"used_percent": not json', NOW), undefined);
assert.equal(parseCodexLimits('{"type":"x"}', NOW), undefined);

console.log('codex usage self-test: ok');
