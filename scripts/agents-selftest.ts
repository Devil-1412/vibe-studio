// Agent map checks against a synthetic session on disk. No agent CLI, no network.
// Usage: npm run test:agents
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildAgentMap, claudeAgentFile } from '../src/agents';
import { claude } from '../src/adapters/claude';
import { TailReader } from '../src/tail';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-studio-'));
const session = path.join(dir, 'sess.jsonl');
const subs = path.join(dir, 'sess', 'subagents');
fs.mkdirSync(subs, { recursive: true });

const iso = (s: number) => new Date(Date.UTC(2026, 10, 11, 10, 0, s)).toISOString();
const line = (o: object) => JSON.stringify(o);
const spawn = (id: string, description: string, s: number, extra: object = {}) =>
  line({ type: 'assistant', timestamp: iso(s), uuid: `u-${id}`, message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name: 'Agent', input: { description, prompt: `do ${description}`, subagent_type: 'general-purpose', ...extra } }] } });
const result = (id: string, s: number, r: object) =>
  line({ type: 'user', timestamp: iso(s), uuid: `r-${id}`, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] }, toolUseResult: r });
const tool = (id: string, name: string, s: number, usage = { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 5 }) =>
  line({ type: 'assistant', timestamp: iso(s), uuid: `a-${id}`, isSidechain: true, message: { model: 'claude-sonnet-5-5', usage, content: [{ type: 'tool_use', id, name, input: { file_path: '/x/y.ts' } }] } });
const meta = (agentId: string, toolUseId: string, finished = false) => fs.writeFileSync(path.join(subs, `agent-${agentId}.meta.json`), JSON.stringify({ toolUseId, finished }));

// main chat: A (finished, reported usage), B (background, still running), C (no transcript, asked 10 minutes ago)
fs.writeFileSync(
  session,
  [
    spawn('tA', 'agent A', 0),
    result('tA', 60, { agentId: 'aa', status: 'completed', totalDurationMs: 60000, totalTokens: 1234, totalToolUseCount: 2 }),
    spawn('tB', 'agent B', 70, { run_in_background: true }),
    spawn('tC', 'agent C', 80),
  ].join('\n') + '\n',
);
// A spawned a nested agent N, which is still running (its transcript is fresh); B has run for a while
fs.writeFileSync(path.join(subs, 'agent-aa.jsonl'), [tool('t1', 'Read', 5), spawn('tN', 'nested N', 10), tool('t2', 'Bash', 20)].join('\n') + '\n');
meta('aa', 'tA', true);
fs.writeFileSync(path.join(subs, 'agent-nn.jsonl'), [tool('t3', 'Grep', 15), tool('t4', 'Edit', 30, { input_tokens: 40, cache_read_input_tokens: 160, output_tokens: 20 })].join('\n') + '\n');
meta('nn', 'tN');
fs.writeFileSync(path.join(subs, 'agent-bb.jsonl'), [tool('t5', 'Read', 75)].join('\n') + '\n');
meta('bb', 'tB');

async function main() {
  const parser = claude.createParser();
  await new TailReader(session).read((l) => parser.feed(l));
  const now = Date.now();
  const touch = (f: string, ageMs: number) => fs.utimesSync(path.join(subs, f), new Date(now - ageMs), new Date(now - ageMs));
  touch('agent-aa.jsonl', 600_000);
  touch('agent-nn.jsonl', 5_000); // nested agent is writing right now
  touch('agent-bb.jsonl', 300_000); // background agent has been quiet for 5 minutes

  const map = await buildAgentMap({
    agent: 'claude',
    items: parser.items,
    main: { title: 't', busy: false },
    canStop: false, // not our process: only the transcript can tell
    resolve: (it) => claudeAgentFile(session, it),
    now,
  });
  const by = Object.fromEntries(map.agents.map((a) => [a.description, a]));

  assert.deepEqual(map.agents.map((a) => a.description), ['agent A', 'nested N', 'agent B', 'agent C'], 'depth-first order');
  assert.equal(by['nested N'].parentId, by['agent A'].id, 'nested agent points at the agent that started it');
  assert.equal(by['agent A'].parentId, undefined);

  assert.equal(by['agent A'].status, 'finished');
  assert.equal(by['agent A'].tokens, 1234, 'reported total wins');
  assert.equal(by['agent A'].durationMs, 60000);
  assert.equal(by['nested N'].status, 'working', 'fresh transcript means working');
  assert.equal(by['nested N'].tokens, 200 + 20, 'running agent: last call context + output');
  assert.equal(by['nested N'].toolUses, 2);
  assert.match(by['nested N'].activity ?? '', /^Edit/, 'activity is the latest tool call');
  assert.equal(by['agent B'].status, 'stopped', 'background agent quiet for minutes ended without a result');
  assert.equal(by['agent B'].background, true);
  assert.equal(by['agent C'].status, 'stopped', 'no transcript and asked long ago');
  assert.equal(by['agent A'].tools.map((t) => t.name).join(','), 'Read,Agent,Bash', 'tool calls include the nested spawn');
  assert.equal(map.canStop, false);

  // our process: it reports every agent it ends, so the transcript going quiet means nothing
  const mapWith = async (since: number, busy: boolean) => {
    const m = await buildAgentMap({ agent: 'claude', items: parser.items, main: { title: 't', busy }, canStop: true, live: { since, busy }, resolve: (it) => claudeAgentFile(session, it), now });
    return Object.fromEntries(m.agents.map((a) => [a.description, a.status]));
  };
  const beforeSpawns = Date.UTC(2026, 10, 11, 9, 59, 0); // this process started the agents
  const afterSpawns = Date.UTC(2026, 10, 11, 11, 0, 0); // started after them: they belonged to an earlier process
  let st = await mapWith(beforeSpawns, false);
  assert.equal(st['agent B'], 'working', 'a background agent of this process works on after the turn, however quiet');
  assert.equal(st['agent C'], 'stopped', 'a foreground agent cannot outlive its turn');
  assert.equal(st['agent A'], 'finished', 'a finished agent stays finished');
  st = await mapWith(beforeSpawns, true);
  assert.equal(st['agent C'], 'working', 'while the turn runs, its foreground agent works');
  st = await mapWith(afterSpawns, true);
  assert.equal(st['agent B'], 'stopped', 'an agent from an earlier process died with it, even if the transcript says running');
  assert.equal(st['agent C'], 'stopped');

  console.log('agents self-test: ok');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(dir, { recursive: true, force: true }));
