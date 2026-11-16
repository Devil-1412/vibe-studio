// Comments on report points: what gets sent, and how the list changes. Usage: npm run test:comments
import * as assert from 'assert';
import { excerpt, markSent, setComment, unsent, withComments, type PointComment } from '../webview/comments';

const c = (id: string, point: string, text: string, sent = false): PointComment => ({ id, point, text, sent });

assert.equal(excerpt('  a   b\n c '), 'a b c');
assert.equal(excerpt('x'.repeat(100), 10), `${'x'.repeat(9)}…`);

// nothing to add: the text goes as typed
assert.equal(withComments([], 'hello'), 'hello');
assert.equal(withComments([c('m1:0', 'p', 'no', true)], 'hello'), 'hello', 'sent comments are not added again');
// comments come first, then the message
assert.equal(withComments([c('m1:0', 'Added the cache', 'use Redis'), c('m1:2', 'Skipped migration', 'why?\nnow')], 'go on'), 'My comments on points in your replies:\n- "Added the cache" → use Redis\n- "Skipped migration" → why? now\n\ngo on');
// comments alone make a message
assert.equal(withComments([c('m1:0', 'p', 'q')], '  '), 'My comments on points in your replies:\n- "p" → q');

// editing: replace, remove on empty, and a re-edited sent comment is open again
let list: PointComment[] = [];
list = setComment(list, c('m1:0', 'p', ' first '));
list = setComment(list, c('m1:1', 'p2', 'second'));
list = setComment(list, c('m1:0', 'p', 'changed'));
assert.deepEqual(list.map((x) => [x.id, x.text]), [['m1:1', 'second'], ['m1:0', 'changed']]);
list = setComment(list, c('m1:1', 'p2', '  '));
assert.deepEqual(list.map((x) => x.id), ['m1:0']);
list = markSent(list);
assert.equal(unsent(list).length, 0);
list = setComment(list, c('m1:0', 'p', 'again'));
assert.equal(unsent(list).length, 1);

console.log('comments self-test: ok');
