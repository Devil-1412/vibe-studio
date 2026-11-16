// The permission / question / plan protocol: parsing, answers, and a round trip through a fake CLI.
// Usage: npm run test:asks
import * as assert from 'assert';
import * as path from 'path';
import { Asks, answerLines, cancelledId, parseAsk } from '../src/asks';
import { claude } from '../src/adapters/claude';
import { Runner, type LiveSpec } from '../src/runner';
import type { PendingAsk } from '../src/types';

const request = (tool: string, input: object, extra: object = {}) => ({ type: 'control_request', request_id: 'q1', request: { subtype: 'can_use_tool', tool_name: tool, input, tool_use_id: 'toolu_1', ...extra } });
const answer = (line: string) => JSON.parse(line).response.response;

// parsing
const bash = parseAsk(request('Bash', { command: 'npm test' }, { permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test *' }], behavior: 'allow', destination: 'localSettings' }] }))!;
assert.equal(bash.kind, 'tool');
assert.equal(bash.id, 'q1');
assert.equal(bash.suggestions.length, 1);
assert.equal(parseAsk(request('AskUserQuestion', { questions: [] }))!.kind, 'question');
assert.equal(parseAsk(request('ExitPlanMode', { plan: '# p' }))!.kind, 'plan');
assert.equal(parseAsk(request('Bash', {}, { agent_id: 'sub1' }))!.agentId, 'sub1');
assert.equal(parseAsk({ type: 'control_request', request_id: 'x', request: { subtype: 'hook_callback' } }), undefined, 'other requests are not asks');
assert.equal(cancelledId({ type: 'control_cancel_request', request_id: 'q1' }), 'q1');

// answers
let [line] = answerLines(bash, { allow: true });
assert.deepEqual(answer(line), { behavior: 'allow', updatedInput: { command: 'npm test' } });
[line] = answerLines(bash, { allow: true, always: true });
assert.equal(answer(line).updatedPermissions[0].destination, 'session', '"always" never writes the project settings');
assert.deepEqual(answer(line).updatedPermissions[0].rules, bash.suggestions[0].rules);
let deny = answer(answerLines(bash, { allow: false })[0]);
assert.equal(deny.behavior, 'deny');
assert.equal(deny.interrupt, true, 'a plain no stops the turn');
assert.match(deny.message, /STOP what you are doing/);
deny = answer(answerLines(bash, { allow: false, message: 'use pnpm' })[0]);
assert.equal(deny.interrupt, false, 'a no with a reason lets the agent carry on');
assert.match(deny.message, /reason for the rejection: use pnpm/);

const question = parseAsk(request('AskUserQuestion', { questions: [{ question: 'Which DB?', options: [{ label: 'Postgres' }] }] }))!;
const answered = answer(answerLines(question, { allow: true, answers: { 'Which DB?': 'Postgres' } })[0]);
assert.deepEqual(answered.updatedInput.answers, { 'Which DB?': 'Postgres' });
assert.equal(answered.updatedInput.questions.length, 1, 'the questions are sent back unchanged');

const plan = parseAsk(request('ExitPlanMode', { plan: '# p' }))!;
const approve = answerLines(plan, { allow: true, mode: 'acceptEdits' });
assert.equal(approve.length, 2, 'approving first switches the permission mode');
assert.deepEqual(JSON.parse(approve[0]).request, { subtype: 'set_permission_mode', mode: 'acceptEdits' });
assert.equal(answer(approve[1]).behavior, 'allow');
assert.deepEqual(answer(answerLines(plan, { allow: true, mode: 'default' })[0]).updatedPermissions, [{ type: 'setMode', mode: 'default', destination: 'session' }]);
assert.equal(answer(answerLines(plan, { allow: false })[0]).message, 'User chose to stay in plan mode and continue planning');

// the list of asks
const asks = new Asks();
asks.add('k', bash);
asks.add('k', { ...bash, id: 'q2' });
assert.equal(asks.pending('k').length, 2);
assert.equal(asks.settle('k', 'answered', 'q1'), true);
assert.equal(asks.settle('k', 'answered', 'q1'), false, 'a second answer changes nothing');
assert.equal(asks.find('k', 'q1')!.state, 'answered');
assert.equal(asks.settle('k', 'expired'), true, 'everything still pending expires together');
assert.equal(asks.pending('k').length, 0);
assert.equal(asks.find('k', 'q1')!.state, 'answered', 'an answered ask is not expired later');

// a round trip through the fake CLI, with the real adapter's control-request handling
const live = claude.live!;
const spec: LiveSpec = { bin: process.execPath, args: [path.join(__dirname, '..', 'scripts', 'fake-agent.mjs')], sig: 's', interrupt: live.interrupt(), isTurnEnd: live.isTurnEnd, controlReply: live.controlReply };
const user = (text: string) => JSON.stringify({ type: 'user', message: { role: 'user', content: text } });

async function main() {
  const r = new Runner();
  const run = (text: string, onAsk: (ask: PendingAsk, lines: string[]) => void) =>
    new Promise<{ lines: string[]; stopped: boolean }>((resolve) => {
      const lines: string[] = [];
      r.send('k', spec, user(text), {
        onLine: (l) => {
          lines.push(l);
          const ask = parseAsk(JSON.parse(l));
          if (ask) onAsk(ask, lines);
        },
        onExit: (_c, _e, stopped) => resolve({ lines, stopped }),
      });
    });

  // the CLI waits for us: nothing answers a can_use_tool by itself, and our answer is what continues the turn
  const ok = await run('ask', (ask) => assert.ok(r.control('k', answerLines(ask, { allow: true })[0])));
  const echoed = ok.lines.map((l) => JSON.parse(l)).find((d) => d.type === 'assistant' && String(d.text).startsWith('answer:'));
  assert.equal(JSON.parse(echoed.text.slice('answer:'.length)).behavior, 'allow');

  const q = await run('askq', (ask) => r.control('k', answerLines(ask, { allow: true, answers: { 'Which?': 'A' } })[0]));
  assert.match(q.lines.join('\n'), /answers/);

  // withdrawing: an interrupt while a question is open makes the CLI cancel it
  const cancelled = await run('ask', () => setTimeout(() => r.stop('k'), 30));
  assert.equal(cancelled.stopped, true);
  const cancel = cancelled.lines.map((l) => JSON.parse(l)).find((d) => cancelledId(d));
  assert.equal(cancelledId(cancel), 'r1', 'the card can expire when the CLI withdraws the request');

  r.dispose();
  console.log('asks self-test: ok');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
