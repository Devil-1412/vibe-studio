// Shelf rules: adding, de-duplicating, limits and cleaning stored items. Usage: npm run test:shelf
import * as assert from 'assert';
import { MAX_ITEMS, MAX_ITEM_BYTES, addToShelf, cleanShelf, titleOf } from '../src/shelf';
import type { ShelfItem } from '../src/types';

const text = (id: string, t: string): ShelfItem => ({ id, kind: 'text', title: t, text: t, at: 0 });
const file = (id: string, name: string, size: number, data = 'abc'): ShelfItem => ({ id, kind: 'attachment', title: name, att: { name, type: 'image/png', size, data }, at: 0 });

// newest first; the same text again moves to the front instead of doubling
let list = addToShelf([], text('a', 'one')).list;
list = addToShelf(list, text('b', 'two')).list;
list = addToShelf(list, text('c', ' one ')).list;
assert.deepEqual(list.map((i) => i.id), ['c', 'b']);
// the same file (name and size) too, a different size is a different file
list = addToShelf(list, file('f1', 'a.png', 10)).list;
list = addToShelf(list, file('f2', 'a.png', 10)).list;
list = addToShelf(list, file('f3', 'a.png', 11)).list;
assert.deepEqual(list.map((i) => i.id), ['f3', 'f2', 'c', 'b']);

// too big is refused and the list is untouched
const big = addToShelf(list, text('big', 'x'.repeat(MAX_ITEM_BYTES + 1)));
assert.ok(big.error);
assert.equal(big.list, list);

// the oldest fall off past the count limit, and past the total size limit
let many: ShelfItem[] = [];
for (let i = 0; i < MAX_ITEMS + 5; i++) many = addToShelf(many, text(`t${i}`, `item ${i}`)).list;
assert.equal(many.length, MAX_ITEMS);
assert.equal(many[0].id, `t${MAX_ITEMS + 4}`);
let heavy: ShelfItem[] = [];
for (let i = 0; i < 6; i++) heavy = addToShelf(heavy, file(`h${i}`, `f${i}.png`, i, 'x'.repeat(1.9 * 1024 * 1024))).list;
assert.ok(heavy.length < 6 && heavy[0].id === 'h5', 'the oldest big files made room');

// titles
assert.equal(titleOf('text', '\n\n  Use   Redis  \nmore', undefined), 'Use Redis');
assert.equal(titleOf('code', 'const a = 1;', undefined, 'ts'), 'ts: const a = 1;');
assert.equal(titleOf('attachment', undefined, { name: 'shot.png', type: 'image/png', data: '', size: 1 }), 'shot.png');
assert.equal(titleOf('text', '   ', undefined), 'Untitled');

// storage is untrusted
const clean = cleanShelf([text('a', 'ok'), { id: 7 }, { id: 'x', kind: 'weird', text: 'y' }, { id: 'y', kind: 'text' }, { id: 'z', kind: 'attachment', att: { name: 'n' } }, file('f', 'ok.png', 3), null, 'str']);
assert.deepEqual(clean.map((i) => i.id), ['a', 'f']);
assert.deepEqual(cleanShelf('nope'), []);
assert.equal(cleanShelf([text('t', 'x'.repeat(MAX_ITEM_BYTES + 1))]).length, 0);

console.log('shelf self-test: ok');
