// What the cats say, and how often. Usage: npm run test:commentary
import * as assert from 'assert';
import { pace, sayings, type Pace } from '../webview/commentary';

const f = { name: 'Ginger', helpers: 0, changed: 0 };
assert.equal(sayings({ ...f, mood: 'read', file: 'plan-section.tsx' }), 'Ginger is reading plan-section.tsx');
assert.equal(sayings({ ...f, mood: 'read' }), 'Ginger is reading files');
assert.equal(sayings({ ...f, mood: 'edit', file: 'a'.repeat(60) }), `Ginger is editing ${'a'.repeat(33)}…`);
assert.equal(sayings({ ...f, mood: 'think', helpers: 2 }), 'Ginger is thinking… · 2 helpers');
assert.equal(sayings({ ...f, mood: 'juggle', helpers: 1 }), 'Ginger is running tools · 1 helper');
assert.equal(sayings({ ...f, mood: 'dizzy' }), 'Ginger hit an error');
assert.equal(sayings({ ...f, mood: 'dance', changed: 3 }), 'Ginger is done · 3 files changed');
assert.equal(sayings({ ...f, mood: 'dance', changed: 1 }), 'Ginger is done · 1 file changed');
assert.equal(sayings({ ...f, mood: 'idle' }), undefined);
assert.equal(sayings({ ...f, mood: 'sleep' }), undefined);

// pacing: a new line shows at once the first time, hides after 6 s, and the next ordinary line waits for 8 s
let p: Pace = { at: -1e9, visible: false };
p = pace(p, 'Ginger is writing', 'type', 0);
assert.deepEqual([p.shown, p.visible], ['Ginger is writing', true]);
p = pace(p, 'Ginger is writing', 'type', 3000);
assert.equal(p.visible, true);
p = pace(p, 'Ginger is writing', 'type', 6000);
assert.equal(p.visible, false, 'hides after 6 s');
p = pace(p, 'Ginger is writing', 'type', 7000);
assert.equal(p.visible, false, 'the same line does not come back');
p = pace(p, 'Ginger is reading files', 'read', 7500);
assert.equal(p.shown, 'Ginger is writing', 'a new line must wait 8 s since the last one');
p = pace(p, 'Ginger is reading files', 'read', 8000);
assert.deepEqual([p.shown, p.visible], ['Ginger is reading files', true]);
// errors and finishing break the wait
p = pace(p, 'Ginger hit an error', 'dizzy', 8500);
assert.deepEqual([p.shown, p.visible], ['Ginger hit an error', true]);
// nothing to say hides the bubble
p = pace(p, undefined, 'idle', 9000);
assert.equal(p.visible, false);

console.log('commentary self-test: ok');
