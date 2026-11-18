// Live-process checks for Runner against scripts/fake-agent.mjs. No agent CLI, no network.
// Usage: npm run test:runner
import * as assert from 'assert';
import * as path from 'path';
import { Runner, type LiveSpec } from '../src/runner';

const agent = path.join(__dirname, '..', 'scripts', 'fake-agent.mjs');
const msg = (text: string | object[]) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
const spec = (sig: string, mode?: string): LiveSpec => ({
  bin: process.execPath,
  args: [agent],
  sig,
  mode,
  setMode: (m) => JSON.stringify({ type: 'control_request', request_id: 'm', request: { subtype: 'set_permission_mode', mode: m } }),
  interrupt: JSON.stringify({ type: 'control_request', request_id: 'x', request: { subtype: 'interrupt' } }),
  isTurnEnd: (l) => JSON.parse(l).type === 'result',
});

/** Sends one message and resolves with the pid that answered and how the turn ended. */
function turn(r: Runner, key: string, sig: string, text: string | object[], onStart?: () => void, mode?: string) {
  return new Promise<{ pid: number; code: number | null; stopped: boolean; lines: string[] }>((resolve) => {
    let pid = 0;
    const lines: string[] = [];
    r.send(key, spec(sig, mode), msg(text), {
      onLine: (l) => (lines.push(l), (pid = JSON.parse(l).pid ?? pid)),
      onExit: (code, _err, stopped) => resolve({ pid, code, stopped, lines }),
    });
    onStart?.();
  });
}

async function main() {
  const r = new Runner();
  const a = await turn(r, 'k', 'v1', 'hello');
  assert.equal(a.code, 0);
  assert.equal(r.isRunning('k'), false, 'idle after the result line');

  const b = await turn(r, 'k', 'v1', 'again');
  assert.equal(b.pid, a.pid, 'same flags reuse the live process');

  const blocks = [{ type: 'text', text: 'with a file' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }];
  const withFile = await turn(r, 'k', 'v1', blocks);
  assert.equal(withFile.code, 0, 'a message with content blocks completes');
  assert.equal(withFile.pid, a.pid, 'blocks go to the same live process');

  const c = await turn(r, 'k', 'v1', 'slow', () => {
    assert.equal(r.isRunning('k'), true, 'busy during a turn');
    setTimeout(() => r.stop('k'), 50);
  });
  assert.equal(c.stopped, true, 'Stop is reported as stopped');
  assert.equal(c.pid, a.pid, 'interrupt keeps the process');

  const d = await turn(r, 'k', 'v2', 'new flags');
  assert.notEqual(d.pid, a.pid, 'changed flags start a new process');

  // a permission-mode change is sent to the running process: no restart, so its sub-agents live on
  const m1 = await turn(r, 'km', 'v1', 'first', undefined, 'auto');
  const m2 = await turn(r, 'km', 'v1', 'same mode', undefined, 'auto');
  assert.equal(m2.pid, m1.pid);
  assert.ok(!m2.lines.some((l) => l.includes('mode:')), 'the same mode sends nothing');
  const m3 = await turn(r, 'km', 'v1', 'new mode', undefined, 'plan');
  assert.equal(m3.pid, m1.pid, 'a new mode keeps the process');
  assert.ok(m3.lines.some((l) => JSON.parse(l).text === 'mode:plan'), 'and tells it the new mode');
  const m4 = await turn(r, 'km', 'v1', 'back', undefined, 'auto');
  assert.ok(m4.pid === m1.pid && m4.lines.some((l) => JSON.parse(l).text === 'mode:auto'), 'switching back works too');
  r.release('km');

  const other = await turn(r, 'k2', 'v2', 'other tile');
  assert.notEqual(other.pid, d.pid, 'each session has its own process');

  r.release('k');
  await new Promise((res) => setTimeout(res, 300));
  assert.throws(() => process.kill(d.pid, 0), 'released process exits');

  r.dispose();
  console.log('runner self-test: ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
