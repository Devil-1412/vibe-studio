// Shortcut mapping, and moving around the tile grid. Usage: npm run test:shortcuts
import * as assert from 'assert';
import { actionOf, neighbour } from '../webview/shortcuts';
import { quoteText } from '../webview/quote';

const key = (code: string, extra: object = {}) => ({ ctrlKey: true, altKey: true, metaKey: false, shiftKey: false, code, key: '', ...extra });

assert.deepEqual(actionOf(key('Enter')), { action: 'max', shift: false });
assert.deepEqual(actionOf(key('Enter', { shiftKey: true })), { action: 'zen', shift: true });
assert.deepEqual(actionOf(key('Digit3')), { action: 'tile', shift: false, n: 3 });
assert.equal(actionOf(key('Digit0')), undefined);
assert.deepEqual(actionOf(key('ArrowLeft', { shiftKey: true })), { action: 'left', shift: true });
assert.equal(actionOf(key('KeyN'))?.action, 'new');
assert.equal(actionOf(key('KeyS'))?.action, 'sidebar');
assert.equal(actionOf(key('KeyH'))?.action, 'shelf');
assert.equal(actionOf(key('KeyB')), undefined, 'Ctrl+Alt+B belongs to VS Code');
assert.equal(actionOf(key('KeyN', { shiftKey: true })), undefined);
assert.equal(actionOf(key('Slash'))?.action, 'help');
assert.equal(actionOf(key('Period', { key: '/' }))?.action, 'help', 'a layout with / elsewhere');

// needs Ctrl and Alt, nothing else; AltGr (which reports Ctrl+Alt) must not trigger
assert.equal(actionOf(key('KeyN', { ctrlKey: false })), undefined);
assert.equal(actionOf(key('KeyN', { altKey: false })), undefined);
assert.equal(actionOf(key('KeyN', { metaKey: true })), undefined);
assert.equal(actionOf(key('KeyN'), true), undefined);

// 2 columns, 5 tiles:  0 1 / 2 3 / 4
assert.equal(neighbour(0, 5, 2, 'right'), 1);
assert.equal(neighbour(1, 5, 2, 'right'), 1, 'no wrap to the next row');
assert.equal(neighbour(2, 5, 2, 'left'), 2);
assert.equal(neighbour(1, 5, 2, 'down'), 3);
assert.equal(neighbour(3, 5, 2, 'down'), 3, 'nothing below tile 3');
assert.equal(neighbour(4, 5, 2, 'up'), 2);
assert.equal(neighbour(0, 5, 2, 'up'), 0);
assert.equal(neighbour(0, 3, 1, 'down'), 1, 'one column');

// dropped messages become a quote
assert.equal(quoteText('hello\n\nworld'), '> hello\n>\n> world');
assert.equal(quoteText('x'.repeat(2000), 10), `> ${'x'.repeat(10)}…`);

console.log('shortcuts self-test: ok');
