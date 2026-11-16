// Parser checks against synthetic transcript lines: todo lists, timestamps, compaction, interrupts, tool headers.
// No agent CLI, no network, no real transcripts. Usage: npm run test:parser
import * as assert from 'assert';
import { ClaudeParser } from '../src/adapters/claude';
import { CodexParser } from '../src/adapters/codex';
import type { ChatItem } from '../src/types';

const iso = (s: number) => new Date(Date.UTC(2026, 10, 11, 10, 0, s)).toISOString();
const ms = (s: number) => Date.parse(iso(s));
const line = (o: object) => JSON.stringify(o);

const user = (uuid: string, s: number, content: unknown, extra: object = {}) => line({ type: 'user', timestamp: iso(s), uuid, message: { role: 'user', content }, ...extra });
const call = (uuid: string, s: number, id: string, name: string, input: object) =>
  line({ type: 'assistant', timestamp: iso(s), uuid, message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id, name, input }] } });
const result = (uuid: string, s: number, id: string, content: string, isError = false) =>
  user(uuid, s, [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }]);

function claude(lines: string[]) {
  const p = new ClaudeParser();
  for (const l of lines) p.feed(l);
  const get = <K extends ChatItem['kind']>(id: string, kind: K) => {
    const it = p.items.find((i) => i.id === id);
    assert.ok(it, `item ${id} exists`);
    assert.strictEqual(it.kind, kind, `item ${id} is ${kind}`);
    return it as Extract<ChatItem, { kind: K }>;
  };
  return { p, get };
}

// ---- timestamps ----------------------------------------------------------------------------------
{
  const { p, get } = claude([user('u1', 5, 'hello'), line({ type: 'assistant', timestamp: iso(9), uuid: 'a1', message: { content: [{ type: 'text', text: 'hi' }] } })]);
  assert.strictEqual(get('u1', 'user').ts, ms(5));
  assert.strictEqual(get('a1:0', 'assistant').ts, ms(9));
  assert.ok(p.items.every((i) => typeof i.ts === 'number'));
}

// ---- TodoWrite → todo item -----------------------------------------------------------------------
{
  const todos = [
    { content: 'Write parser', status: 'completed', activeForm: 'Writing parser' },
    { content: 'Render list', status: 'in_progress', activeForm: 'Rendering list' },
    { content: 'Ship', status: 'someday', activeForm: 'Shipping' },
    { content: '  ', status: 'pending', activeForm: '' },
  ];
  const { p, get } = claude([call('a1', 1, 't1', 'TodoWrite', { todos }), result('r1', 2, 't1', 'Todos have been modified successfully')]);
  const todo = get('t1', 'todo');
  assert.deepStrictEqual(todo.items, [
    { text: 'Write parser', status: 'completed' },
    { text: 'Render list', status: 'in_progress' },
    { text: 'Ship', status: 'pending' },
  ]);
  assert.strictEqual(todo.ts, ms(1));
  assert.strictEqual(p.items.length, 1, 'the tool result adds no row');
}

// ---- compaction: boundary + summary become one row ----------------------------------------------
{
  const { p, get } = claude([
    user('u1', 1, 'before'),
    line({ type: 'system', subtype: 'compact_boundary', timestamp: iso(2), uuid: 'b1', content: 'Conversation compacted', compactMetadata: { trigger: 'auto', preTokens: 45123 } }),
    line({ type: 'attachment', timestamp: iso(2), uuid: 'x1', attachment: { type: 'file' } }),
    user('s1', 3, 'This session is being continued from a previous conversation.\n\nSummary:\n1. did things', { isCompactSummary: true }),
    user('u2', 4, 'after'),
  ]);
  const compact = get('b1', 'compact');
  assert.strictEqual(compact.trigger, 'auto');
  assert.strictEqual(compact.preTokens, 45123);
  assert.ok(compact.text.includes('did things'));
  assert.deepStrictEqual(p.items.map((i) => i.kind), ['user', 'compact', 'user'], 'no extra notes');

  // older logs: a summary with no boundary, flagged or not, still gets one row of its own
  const old = claude([user('s2', 1, 'This session is being continued from a previous conversation that ran out of context.')]);
  const row = old.get('s2', 'compact');
  assert.strictEqual(row.trigger, undefined);
  assert.ok(row.text.startsWith('This session'));
  const flagged = claude([user('s3', 1, [{ type: 'text', text: 'summary text' }], { isCompactSummary: true })]);
  assert.strictEqual(flagged.get('s3', 'compact').text, 'summary text');

  // a boundary whose summary never arrives stays an empty compact row (the page shows it as a plain line)
  const lone = claude([line({ type: 'system', subtype: 'compact_boundary', timestamp: iso(1), uuid: 'b2', compactMetadata: { trigger: 'manual' } })]);
  const bare = lone.get('b2', 'compact');
  assert.strictEqual(bare.text, '');
  assert.strictEqual(bare.preTokens, undefined);
}

// ---- interrupts ----------------------------------------------------------------------------------
{
  const { get } = claude([
    user('i1', 1, [{ type: 'text', text: '[Request interrupted by user]' }]),
    user('i2', 2, [{ type: 'text', text: '[Request interrupted by user for tool use]' }]),
  ]);
  assert.strictEqual(get('i1', 'note').text, 'Interrupted');
  assert.strictEqual(get('i2', 'note').text, 'Tool interrupted');
}

// ---- tool headers and result lines ---------------------------------------------------------------
{
  const calls: [string, string, object][] = [
    ['t1', 'Bash', { command: 'npm test', description: 'Run the tests' }],
    ['t2', 'Bash', { command: 'npm test' }],
    ['t3', 'Grep', { pattern: 'foo', path: '/tmp/src', glob: '*.ts', type: 'ts' }],
    ['t4', 'Grep', { pattern: 'bar' }],
    ['t5', 'Glob', { pattern: 'src/**/*.ts' }],
    ['t6', 'WebFetch', { url: 'https://example.com/a', prompt: 'summarise' }],
    ['t7', 'WebSearch', { query: 'vscode webview clipboard' }],
    ['t8', 'Skill', { skill: 'hallmark:hallmark' }],
    ['t9', 'mcp__claude-in-chrome__navigate', { url: 'https://example.com', tabId: 3 }],
    ['t10', 'mcp__claude_ai_Slack__send_message', { channel: '#general', message: 'x'.repeat(60) }],
    ['t11', 'mcp__claude_ai_Slack__list', { limit: 5 }],
    ['t12', 'Read', { file_path: '/tmp/a.ts', offset: 10, limit: 31 }],
  ];
  const { get } = claude(calls.map(([id, name, input], i) => call(`a${i}`, i, id, name, input)));
  const head = (id: string) => {
    const t = get(id, 'tool');
    return `${t.name}|${t.summary}`;
  };
  assert.strictEqual(head('t1'), 'Bash|Run the tests');
  assert.strictEqual(head('t2'), 'Bash|npm test');
  assert.strictEqual(head('t3'), 'Grep|"foo" (in /tmp/src, *.ts, ts)');
  assert.strictEqual(head('t4'), 'Grep|"bar"');
  assert.strictEqual(head('t5'), 'Glob|pattern: "src/**/*.ts"');
  assert.strictEqual(head('t6'), 'Web Fetch|https://example.com/a');
  assert.strictEqual(head('t7'), 'WebSearch|vscode webview clipboard');
  assert.strictEqual(head('t8'), 'Skill|hallmark:hallmark skill');
  assert.strictEqual(head('t9'), 'chrome [navigate]|https://example.com');
  assert.strictEqual(head('t10'), `Slack [send_message]|${'x'.repeat(39)}…`, 'first hint in query/message/channel order, cut at 40');
  assert.strictEqual(head('t11'), 'Slack [list]|', 'no hint field: empty summary');
  assert.strictEqual(head('t12'), 'Read|/tmp/a.ts');
  assert.ok(get('t12', 'tool').input.includes('"offset": 10'), 'Read keeps offset/limit in its input for the merged row');
}

{
  const out = (id: string, text: string, isError = false) => result(`r-${id}`, 50, id, text, isError);
  const { get } = claude([
    call('a1', 1, 'g1', 'Grep', { pattern: 'x' }),
    out('g1', 'a.ts:1:x\nb.ts:2:x\nc.ts:3:x'),
    call('a2', 2, 'g2', 'Grep', { pattern: 'x' }),
    out('g2', 'No matches found'),
    call('a3', 3, 'g3', 'Grep', { pattern: 'x' }),
    out('g3', 'Found 2 files\na.ts\nb.ts'),
    call('a4', 4, 'g4', 'Grep', { pattern: 'x' }),
    out('g4', 'one line'),
    call('a5', 5, 'l1', 'Glob', { pattern: '*.ts' }),
    out('l1', '/x/a.ts\n/x/b.ts\n/x/c.ts\n\n(Results are truncated. Consider using a more specific path or pattern.)'),
    call('a6', 6, 'l2', 'Glob', { pattern: '*.ts' }),
    out('l2', 'No files found'),
    call('a7', 7, 'l3', 'Glob', { pattern: '*.ts' }),
    out('l3', ''),
    call('a8', 8, 'g5', 'Grep', { pattern: 'x' }),
    out('g5', 'boom', true),
    call('a9', 9, 'b1', 'Bash', { command: 'ls' }),
    out('b1', 'file'),
  ]);
  assert.strictEqual(get('g1', 'tool').result, '3 lines of output');
  assert.strictEqual(get('g2', 'tool').result, 'No matches found');
  assert.strictEqual(get('g3', 'tool').result, '2 lines of output', 'the "Found N files" header is not a line');
  assert.strictEqual(get('g4', 'tool').result, '1 line of output');
  assert.strictEqual(get('l1', 'tool').result, 'Found 3 files');
  assert.strictEqual(get('l2', 'tool').result, 'No files found');
  assert.strictEqual(get('l3', 'tool').result, 'No files found');
  assert.strictEqual(get('g5', 'tool').result, undefined, 'errors get no result line');
  assert.strictEqual(get('b1', 'tool').result, undefined, 'only Grep and Glob get one');
  assert.strictEqual(get('g1', 'tool').output, 'a.ts:1:x\nb.ts:2:x\nc.ts:3:x', 'the full output is still kept');
}

// ---- prompt cache estimate -----------------------------------------------------------------------
{
  const reply = (uuid: string, s: number, usage: object, model = 'claude-opus-5-5') =>
    line({ type: 'assistant', timestamp: iso(s), uuid, message: { model, usage: { input_tokens: 10, output_tokens: 5, ...usage }, content: [{ type: 'text', text: 'ok' }] } });
  const wrote = (h1: number, m5: number) => ({ cache_creation: { ephemeral_1h_input_tokens: h1, ephemeral_5m_input_tokens: m5 } });
  const feed = (p: ClaudeParser, ...ls: string[]) => ls.forEach((l) => p.feed(l));
  const p = new ClaudeParser();
  assert.strictEqual(p.usage.cacheUntil, undefined, 'no data before the first call');
  feed(p, reply('c1', 10, {}));
  assert.deepStrictEqual([p.usage.cacheAt, p.usage.cacheUntil], [ms(10), ms(10) + 300_000], 'no cache fields: 5 min by default');
  feed(p, reply('c2', 20, wrote(500, 0)));
  assert.deepStrictEqual([p.usage.cacheAt, p.usage.cacheUntil], [ms(20), ms(20) + 3_600_000], '1 h tokens written: 1 h');
  feed(p, reply('c3', 30, { cache_read_input_tokens: 900, ...wrote(0, 0) }));
  assert.strictEqual(p.usage.cacheUntil, ms(30) + 3_600_000, 'a call that only read the cache keeps the TTL and renews it');
  feed(p, reply('c4', 40, wrote(0, 700)));
  assert.strictEqual(p.usage.cacheUntil, ms(40) + 300_000, 'only 5 min tokens written: 5 min');
  feed(p, reply('c5', 50, wrote(100, 100)));
  assert.strictEqual(p.usage.cacheUntil, ms(50) + 3_600_000, '1 h wins when both were written');
  feed(p, line({ type: 'assistant', timestamp: iso(60), uuid: 'c6', isApiErrorMessage: true, message: { model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0 }, content: [{ type: 'text', text: 'API error' }] } }));
  assert.strictEqual(p.usage.cacheAt, ms(50), 'synthetic error replies are not calls');
  feed(p, line({ type: 'cost-state', timestamp: iso(70), totalCostUSD: 1.5 }));
  assert.strictEqual(p.usage.cacheUntil, ms(50) + 3_600_000, 'the cost line keeps the estimate');
  assert.strictEqual(p.usage.cost, 1.5);
}

// ---- ExitPlanMode → plan card --------------------------------------------------------------------
{
  const use = (id: string, input: object) => call(`a-${id}`, 1, id, 'ExitPlanMode', input);
  const PLAN = '## Plan\n1. one\n2. two';
  const w = claude([use('p1', { plan: PLAN })]);
  const waiting = w.get('p1', 'plan');
  assert.strictEqual(waiting.status, 'waiting');
  assert.strictEqual(waiting.plan, PLAN);
  assert.strictEqual(waiting.ts, ms(1));

  const ok = claude([
    use('p2', { plan: PLAN, planFilePath: '/home/u/.claude/plans/cool-plan.md' }),
    result('r2', 2, 'p2', 'User has approved your plan. You can now start coding.\n\nYour plan has been saved to: /home/u/.claude/plans/other.md\n'),
  ]);
  assert.strictEqual(ok.get('p2', 'plan').status, 'approved');
  assert.strictEqual(ok.get('p2', 'plan').file, 'cool-plan.md', 'the input names the file first');

  const named = claude([use('p3', { plan: PLAN }), result('r3', 2, 'p3', 'User has approved your plan.\n\nYour plan has been saved to: /home/u/Alive Website/plans/my plan.md\nYou can refer back to it')]);
  assert.strictEqual(named.get('p3', 'plan').file, 'my plan.md', 'file name from the result text, spaces kept');
  const viaResult = claude([use('p4', { plan: PLAN }), user('r4', 2, [{ type: 'tool_result', tool_use_id: 'p4', content: 'User has approved your plan.' }], { toolUseResult: { plan: PLAN, filePath: '/x/y/z.md' } })]);
  assert.strictEqual(viaResult.get('p4', 'plan').file, 'z.md', 'file name from toolUseResult.filePath');

  const no = claude([use('p5', { plan: PLAN }), result('r5', 2, 'p5', "The user doesn't want to proceed with this tool use. The tool use was rejected.", true)]);
  assert.strictEqual(no.get('p5', 'plan').status, 'kept');

  // shapes we don't know stay plain tool rows
  const noPlan = claude([use('p6', { allowedPrompts: [] })]);
  assert.strictEqual(noPlan.get('p6', 'tool').name, 'ExitPlanMode', 'no plan text: generic row');
  const odd = claude([use('p7', { plan: PLAN }), result('r7', 3, 'p7', 'Plan submitted to the team lead.')]);
  const row = odd.get('p7', 'tool');
  assert.strictEqual(row.output, 'Plan submitted to the team lead.', 'unknown result: the card becomes its plain row, with the output');
  assert.strictEqual(row.ts, ms(1), 'and keeps its time');
  assert.strictEqual(odd.p.items.length, 1);
}

// ---- AskUserQuestion → question card -------------------------------------------------------------
{
  const qs = [
    { question: 'Which slug?', header: 'Slug', multiSelect: false, options: [{ label: 'Experience, big', description: 'src/a' }, { label: 'City' }] },
    { question: 'Which checks?', header: 'Checks', multiSelect: true, options: [{ label: 'Lint' }, { label: 'Types, strict' }, { label: 'Tests' }] },
  ];
  const ask = (id: string, questions: unknown = qs) => call(`a-${id}`, 1, id, 'AskUserQuestion', { questions });
  const answered = (id: string, s: number, answers: object, text = 'Your questions have been answered: "x"="y". You can now continue.') =>
    user(`r-${id}`, s, [{ type: 'tool_result', tool_use_id: id, content: text }], { toolUseResult: { questions: qs, answers } });

  const w = claude([ask('q1')]);
  const waiting = w.get('q1', 'question');
  assert.strictEqual(waiting.status, 'waiting');
  assert.deepStrictEqual(waiting.questions.map((q) => [q.header, q.multiSelect, q.options.length]), [['Slug', false, 2], ['Checks', true, 3]]);
  assert.strictEqual(waiting.questions[0].options[0].description, 'src/a');

  const done = claude([
    ask('q2'),
    answered('q2', 2, { 'Which slug?': 'Experience, big', 'Which checks?': 'Lint, Types, strict, run it twice' }),
  ]).get('q2', 'question');
  assert.strictEqual(done.status, 'answered');
  assert.deepStrictEqual(done.questions[0].chosen, ['Experience, big'], 'a label with a comma still matches');
  assert.strictEqual(done.questions[0].other, undefined);
  assert.deepStrictEqual(done.questions[1].chosen, ['Lint', 'Types, strict']);
  assert.strictEqual(done.questions[1].other, 'run it twice', 'typed text rides along as Other');
  assert.strictEqual(done.text, undefined);

  const typed = claude([ask('q3'), answered('q3', 2, { 'Which slug?': 'City, but lowercase' })]).get('q3', 'question');
  assert.deepStrictEqual(typed.questions[0].chosen, [], 'single select: a label followed by more text is typed text');
  assert.strictEqual(typed.questions[0].other, 'City, but lowercase');
  assert.strictEqual(typed.questions[1].chosen, undefined, 'unanswered questions stay plain');

  const none = claude([ask('q4'), answered('q4', 2, {})]).get('q4', 'question');
  assert.strictEqual(none.status, 'none');

  const unmatched = claude([ask('q5'), answered('q5', 2, { 'Some other key': 'Lint' })]).get('q5', 'question');
  assert.strictEqual(unmatched.status, 'answered');
  assert.ok(unmatched.text?.startsWith('Your questions have been answered'), 'answers keyed some other way: the result text is shown');

  const plain = claude([ask('q6'), result('r6', 2, 'q6', 'The user answered: "Which slug?"="City".')]).get('q6', 'question');
  assert.strictEqual(plain.status, 'answered');
  assert.strictEqual(plain.text, 'The user answered: "Which slug?"="City".', 'no structured answers: the result text');

  const REJECT = "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";
  const declined = claude([ask('q7'), user('r7', 2, [{ type: 'tool_result', tool_use_id: 'q7', content: REJECT, is_error: true }], { toolUseResult: 'User rejected tool use' })]).get('q7', 'question');
  assert.strictEqual(declined.status, 'declined');
  assert.strictEqual(declined.reason, undefined);
  const why = claude([ask('q8'), result('r8', 2, 'q8', `${REJECT.replace(/ STOP.*/, '')} To tell you how to proceed, the user said:\nuse the city one`, true)]).get('q8', 'question');
  assert.strictEqual(why.status, 'declined');
  assert.strictEqual(why.reason, 'use the city one');

  // not a rejection, or not a question we can read: the plain tool row
  const broken = claude([ask('q9'), result('r9', 2, 'q9', 'Error: No such tool available: AskUserQuestion', true)]);
  assert.strictEqual(broken.get('q9', 'tool').isError, true);
  assert.strictEqual(broken.get('q9', 'tool').name, 'AskUserQuestion');
  assert.strictEqual(claude([ask('q10', 'nope')]).get('q10', 'tool').name, 'AskUserQuestion');
  assert.strictEqual(claude([ask('q11', [{ options: [] }, null])]).get('q11', 'tool').name, 'AskUserQuestion');
  assert.strictEqual(claude([ask('q12', [{ question: 'Only text' }])]).get('q12', 'question').questions[0].options.length, 0, 'a question without options still shows');
}

// ---- Codex: update_plan → todo, compacted → one-line note ----------------------------------------
{
  const p = new CodexParser();
  p.feed(
    line({
      timestamp: iso(1),
      type: 'response_item',
      payload: { type: 'function_call', name: 'update_plan', call_id: 'c1', arguments: JSON.stringify({ plan: [{ step: 'Read code', status: 'completed' }, { step: 'Fix it', status: 'in_progress' }, { step: 'Test', status: 'pending' }] }) },
    }),
  );
  p.feed(line({ timestamp: iso(2), type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: 'Plan updated' } }));
  p.feed(line({ timestamp: iso(3), type: 'compacted', payload: {} }));
  const todo = p.items.find((i) => i.id === 'c1');
  assert.ok(todo && todo.kind === 'todo');
  assert.deepStrictEqual(todo.items.map((t) => `${t.status}:${t.text}`), ['completed:Read code', 'in_progress:Fix it', 'pending:Test']);
  assert.strictEqual(todo.ts, ms(1));
  const note = p.items.find((i) => i.kind === 'note');
  assert.ok(note && note.kind === 'note' && note.text === 'Conversation compacted' && note.ts === ms(3));
  assert.strictEqual(p.items.length, 2);
}

console.log('parser selftest ok');
