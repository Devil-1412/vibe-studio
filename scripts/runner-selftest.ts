// Live-process checks for Runner against scripts/fake-agent.mjs. No agent CLI, no network.
// Usage: npm run test:runner
import * as assert from 'assert';
import * as path from 'path';
import { Runner, type LiveSpec } from '../src/runner';

const agent = path.join(__dirname, '..', 'scripts', 'fake-agent.mjs');
const msg = (text: string | object[]) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } });
const spec = (sig: string): LiveSpec => ({
  bin: process.execPath,
  args: [agent],
  sig,
  interrupt: JSON.stringify({ type: 'control_request', request_id: 'x', request: { subtype: 'interrupt' } }),
  isTurnEnd: (l) => JSON.parse(l).type === 'result',
});

/** Sends one message and resolves with the pid that answered and how the turn ended. */
function turn(r: Runner, key: string, sig: string, text: string | object[], onStart?: () => void) {
  return new Promise<{ pid: number; code: number | null; stopped: boolean }>((resolve) => {
    let pid = 0;
    r.send(key, spec(sig), msg(text), {
      onLine: (l) => (pid = JSON.parse(l).pid ?? pid),
      onExit: (code, _err, stopped) => resolve({ pid, code, stopped }),
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
