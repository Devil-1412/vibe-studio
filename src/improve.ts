// The magic wand: rewrite a rough prompt into a clear one with a one-shot, tool-less call to the Claude CLI (fast model, your login).
// No project settings, hooks or skills are loaded, so it costs only the prompt and the reply.
import { spawn } from 'child_process';
import * as os from 'os';

export const SYSTEM =
  "You rewrite a developer's rough message to a coding agent into a clear, specific prompt. Keep their intent and every detail they gave (file names, errors, numbers, names). Fix typos and unclear wording. State the goal first; add a short bullet list of requirements only when the message has several. Do not invent requirements, do not answer the message, and add no preamble or explanation. Reply with only the rewritten prompt, in the same language as the message.";

/** What the model wrote, without the wrappers it likes to add: code fences, quotes, a "Rewritten prompt:" label. */
export function cleanImproved(out: string): string {
  let t = out.trim();
  const fence = /^```[a-z]*\n([\s\S]*?)\n```$/i.exec(t);
  if (fence) t = fence[1].trim();
  t = t.replace(/^(rewritten|improved|revised)( prompt)?\s*:\s*/i, '');
  if (/^"[\s\S]*"$/.test(t) && !t.slice(1, -1).includes('"')) t = t.slice(1, -1);
  return t.trim();
}

export function improvePrompt(bin: string, text: string, timeoutMs = 45_000): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, ['-p', '--model', 'haiku', '--output-format', 'text', '--tools', '', '--no-session-persistence', '--disable-slash-commands', '--strict-mcp-config', '--setting-sources', 'project', '--system-prompt', SYSTEM], {
      cwd: os.homedir(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    let done = false;
    const finish = (r: Awaited<ReturnType<typeof improvePrompt>>) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      resolve(r);
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'The rewrite took too long.' }), timeoutMs);
    child.stdout.setEncoding('utf8').on('data', (d: string) => (out += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (err += d));
    child.on('error', () => finish({ ok: false, error: 'Could not start the Claude CLI.' }));
    child.on('close', (code) => {
      const text = cleanImproved(out);
      finish(code === 0 && text ? { ok: true, text } : { ok: false, error: err.trim().split('\n').slice(-2).join(' ') || 'The rewrite came back empty.' });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(text);
  });
}
