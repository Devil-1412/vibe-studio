// @-mention and attachment rules, plus the Claude message blocks. No CLI, no network.
// Usage: npm run test:mentions
import * as assert from 'assert';
import { claude } from '../src/adapters/claude';
import { rankFiles, withFolders } from '../src/files';
import { attachmentType, mentionAt, mentionText, screenAttachments, transcriptText } from '../src/mentions';

const MB = 1024 * 1024;

// where an @ mention starts
assert.deepEqual(mentionAt('look at @src/de'), { start: 8, query: 'src/de' });
assert.deepEqual(mentionAt('@'), { start: 0, query: '' });
assert.deepEqual(mentionAt('see @"my dir/a'), { start: 4, query: 'my dir/a' });
assert.equal(mentionAt('mail me@x.com'), undefined, 'an @ inside a word is not a mention');

// what picking inserts
assert.equal(mentionText({ path: 'src/a.ts' }, 'claude'), '@src/a.ts ');
assert.equal(mentionText({ path: 'my dir/a.ts' }, 'claude'), '@"my dir/a.ts" ');
assert.equal(mentionText({ path: 'src', folder: true }, 'claude'), '@src/ ');
assert.equal(mentionText({ path: 'src', folder: true }, 'claude', true), '@src/', 'drilling keeps the picker open');
assert.equal(mentionText({ path: 'src/a.ts' }, 'codex'), 'src/a.ts ', 'Codex has no @ syntax');

// what can be attached
assert.equal(attachmentType('a.PNG'), 'image/png');
assert.equal(attachmentType('x.pdf'), 'application/pdf');
assert.equal(attachmentType('main.ts'), 'text/plain');
assert.equal(attachmentType('Dockerfile'), 'text/plain');
assert.equal(attachmentType('pasted', 'image/webp'), 'image/webp');
assert.equal(attachmentType('a.exe'), undefined);

const screened = screenAttachments([{ name: 'a.png', size: 6 * MB }, { name: 'b.txt', size: 10 }, { name: 'c.exe', size: 5 }, { name: 'd.md', size: 0 }], 0);
assert.deepEqual(screened.ok.map((f) => f.name), ['b.txt']);
for (const part of ['over 5 MB): a.png', 'unsupported type): c.exe', 'empty): d.md']) assert.ok(screened.message.includes(part), part);
assert.equal(screenAttachments([{ name: 'n.txt', size: 10 }], 20 * MB - 5).ok.length, 0, 'the 20 MB total is enforced');

assert.equal(transcriptText('hi', [{ type: 'image/png' }, { type: 'application/pdf' }]), 'hi\n\n[image]\n\n[document]');
assert.equal(transcriptText('', [{ type: 'image/png' }]), '[image]');

// the folder listing
const entries = withFolders(['src/a.ts', 'src/lib/b.ts', '../x', '/abs']);
assert.deepEqual(entries.map((e) => e.path), ['src', 'src/lib', 'src/a.ts', 'src/lib/b.ts'], 'folders derived; outside paths dropped');
assert.deepEqual(rankFiles(entries, '').map((e) => e.path), ['src'], 'no query lists the top level');
assert.equal(rankFiles(entries, 'b')[0].path, 'src/lib/b.ts');
assert.deepEqual(rankFiles(entries, 'src/').map((e) => e.path), ['src/lib', 'src/a.ts', 'src/lib/b.ts'], 'a trailing slash lists inside that folder');

// Claude's message: a plain string without files, blocks with them
const message = claude.live!.message;
assert.equal(JSON.parse(message('hi')).message.content, 'hi');
const blocks = JSON.parse(message('hi', [{ name: 'a.png', type: 'image/png', data: 'AAAA', size: 4 }, { name: 'n.ts', type: 'text/plain', data: 'x=1', size: 3 }])).message.content;
assert.deepEqual(blocks[0], { type: 'text', text: 'hi' });
assert.deepEqual(blocks[1], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } });
assert.deepEqual(blocks[2], { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'x=1' }, title: 'n.ts' });

console.log('mentions self-test: ok');
