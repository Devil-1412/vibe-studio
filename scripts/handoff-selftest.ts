// Continue in a new chat: when it is offered, and which reply counts as the summary. Usage: npm run test:handoff
import * as assert from 'assert';
import { continuationText, newestReply, offerHandoff } from '../webview/handoff';

assert.equal(offerHandoff(undefined), false);
assert.equal(offerHandoff(79), false);
assert.equal(offerHandoff(80), true);
assert.equal(offerHandoff(100), true);

const a = { id: 'a1', kind: 'assistant', text: 'old answer' };
const user = { id: 'u2', kind: 'user', text: 'summarize' };
const tool = { id: 't3', kind: 'tool' };
// before the summary arrives the newest reply is still the old one: not it
assert.equal(newestReply([a, user], 'a1'), undefined);
assert.equal(newestReply([a, user, tool], 'a1'), undefined);
// once it is there, it is the one after the old reply
assert.equal(newestReply([a, user, { id: 'a4', kind: 'assistant', text: ' the summary ' }], 'a1'), ' the summary ');
// a chat with no reply yet, and an empty reply
assert.equal(newestReply([user], undefined), undefined);
assert.equal(newestReply([{ id: 'a1', kind: 'assistant', text: '  ' }], undefined), undefined);

assert.equal(continuationText('  Goal: x\nDone: y '), 'Context from my previous chat (it ran out of room), summarized:\n\nGoal: x\nDone: y\n\n---\nContinue from here: ');

console.log('handoff self-test: ok');
