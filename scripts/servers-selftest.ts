// Server discovery: lsof and git parsing, and which project a server belongs to. Usage: npm run test:servers
import * as assert from 'assert';
import { parseCwds, parseListeners, parseWorktrees, projectOf, serverScripts } from '../src/servers';

// the same pid on IPv4 and IPv6 is one server; ports come from the address
const l = parseListeners('p4121\ncnode\nn*:3000\nn[::1]:3000\np4388\ncnext-server\nn127.0.0.1:3001\np9\ncsshd\nn*:22');
assert.deepEqual(l.map((x) => [x.pid, x.port, x.cmd]), [[4121, 3000, 'node'], [4388, 3001, 'next-server'], [9, 22, 'sshd']]);
assert.deepEqual(parseListeners(''), []);

const cwds = parseCwds('p4121\nn/Users/a/My App\np4388\nn/Users/a/My App-event/apps');
assert.equal(cwds.get(4121), '/Users/a/My App');

const wt = parseWorktrees('worktree /Users/a/My App\nHEAD abc\nbranch refs/heads/main\n\nworktree /Users/a/My App-event\nHEAD def\nbranch refs/heads/Event\n\nworktree /Users/a/detached\nHEAD 123\ndetached\n');
assert.deepEqual(wt, [{ path: '/Users/a/My App', branch: 'main' }, { path: '/Users/a/My App-event', branch: 'Event' }, { path: '/Users/a/detached', branch: undefined }]);

// a server started in a subfolder belongs to its project; the deepest root wins; a sibling with the same prefix does not match
const roots = ['/Users/a/My App', '/Users/a/My App/nested', '/Users/a/My App-event'];
assert.equal(projectOf('/Users/a/My App/src', roots), '/Users/a/My App');
assert.equal(projectOf('/Users/a/My App/nested/x', roots), '/Users/a/My App/nested');
assert.equal(projectOf('/Users/a/My App-event/apps', roots), '/Users/a/My App-event');
assert.equal(projectOf('/Users/a/Alive', roots), undefined);
assert.equal(projectOf('', roots), undefined);

assert.deepEqual(serverScripts({ scripts: { build: 'x', start: 'y', dev: 'z', serve: 5 } }), ['dev', 'start']);
assert.deepEqual(serverScripts(undefined), []);

console.log('servers self-test: ok');
