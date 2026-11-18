// Low usage mode: what gets added to the agent's instructions, and when the Continue nudge shows. Usage: npm run test:low
import * as assert from 'assert';
import { LOW_PROMPT, POINTS_PROMPT, extraInstructions } from '../src/adapters/common';
import { claude } from '../src/adapters/claude';
import { codex } from '../src/adapters/codex';
import { offerHandoff } from '../webview/handoff';

assert.equal(extraInstructions({}), '');
assert.equal(extraInstructions({ points: true }), POINTS_PROMPT);
assert.equal(extraInstructions({ low: true }), LOW_PROMPT);
assert.equal(extraInstructions({ points: true, low: true }), `${POINTS_PROMPT} ${LOW_PROMPT}`);

const base = { mode: 'auto', model: '', effort: '', chrome: false };
const claudeArgs = (o: object) => claude.live!.args('id', { ...base, ...o }, true);
assert.ok(!claudeArgs({}).includes('--strict-mcp-config'), 'normal chats keep their MCP servers');
assert.ok(!claudeArgs({}).includes('--append-system-prompt'));
const low = claudeArgs({ low: true });
assert.ok(low.includes('--strict-mcp-config'), 'low usage mode starts no MCP servers');
assert.equal(low[low.indexOf('--append-system-prompt') + 1], LOW_PROMPT);
assert.equal(claudeArgs({ low: true, points: true })[claudeArgs({ low: true, points: true }).indexOf('--append-system-prompt') + 1], `${POINTS_PROMPT} ${LOW_PROMPT}`);

const codexArgs = codex.newPlan('hi', 'id', { ...base, low: true }).args;
assert.ok(codexArgs.some((a) => a.startsWith('developer_instructions=') && a.includes('Be brief')), 'Codex gets the short-answers instruction');
assert.ok(!codex.newPlan('hi', 'id', base).args.some((a) => a.startsWith('developer_instructions=')));

// the Continue nudge comes earlier in low usage mode
assert.equal(offerHandoff(60), false);
assert.equal(offerHandoff(60, true), true);
assert.equal(offerHandoff(49, true), false);
assert.equal(offerHandoff(undefined, true), false);

console.log('low usage self-test: ok');
