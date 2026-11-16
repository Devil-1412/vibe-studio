// Asks the Claude CLI for the account's limits. The CLI answers `get_usage` with its own login, so no credentials
// pass through here. A throwaway process: no prompt is sent, so nothing is billed and no transcript is written.
import { spawn } from 'child_process';
import * as os from 'os';
import { parseUsage } from './limits';
import type { AccountUsage } from './types';

export function fetchUsage(bin: string, timeoutMs = 20_000): Promise<{ state: 'ok' | 'unavailable' | 'error'; usage?: AccountUsage }> {
  return new Promise((resolve) => {
    const child = spawn(bin, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--no-session-persistence'], {
      cwd: os.homedir(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let done = false;
    let buf = '';
    const finish = (r: Awaited<ReturnType<typeof fetchUsage>>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.stdin?.end();
      setTimeout(() => child.kill(), 3000).unref();
      resolve(r);
    };
    const timer = setTimeout(() => finish({ state: 'error' }), timeoutMs);
    child.on('error', () => finish({ state: 'error' }));
    child.on('close', () => finish({ state: 'error' }));
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      const lines = (buf + chunk).split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.includes('"control_response"')) continue;
        try {
          const d = JSON.parse(line);
          if (d.type !== 'control_response' || d.response?.request_id !== 'usage') continue;
          if (d.response.subtype !== 'success') return finish({ state: 'error' });
          return finish(parseUsage(d.response.response));
        } catch {
          /* not a whole line */
        }
      }
    });
    child.stdin?.on('error', () => undefined);
    child.stdin?.write(`${JSON.stringify({ type: 'control_request', request_id: 'usage', request: { subtype: 'get_usage', skip_behaviors: true } })}\n`);
  });
}
