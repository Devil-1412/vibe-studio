// What the Settings panel may write. Usage: npm run test:settings
import * as assert from 'assert';
import { readFileSync } from 'fs';
import * as path from 'path';
import { AGENT_DEFAULTS, PANEL_SETTINGS, validSetting } from '../src/settings';

assert.equal(validSetting('claudeModel', 'claude-sonnet-5-5'), true);
assert.equal(validSetting('claudeEffort', ''), true, 'empty = CLI default');
assert.equal(validSetting('claudeChrome', false), true);
assert.equal(validSetting('claudeChrome', 'false'), false, 'wrong type');
assert.equal(validSetting('claudeModel', true), false, 'wrong type');
assert.equal(validSetting('claudeModel', 'x'.repeat(121)), false, 'too long');
assert.equal(validSetting('claudeModel', 'a\nb'), false, 'no new lines');
assert.equal(validSetting('claudePath', '/tmp/evil'), false, 'paths stay in VS Code settings');
assert.equal(validSetting('prompts', []), false);
assert.equal(validSetting('toString', 'x'), false, 'no prototype keys');

// every key the panel writes is declared in package.json, with the same type
const props = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).contributes.configuration.properties;
for (const [k, t] of Object.entries(PANEL_SETTINGS)) assert.equal(props[`vibeStudio.${k}`]?.type, t, `vibeStudio.${k} declared as ${t}`);
assert.ok(AGENT_DEFAULTS.every((k) => k in PANEL_SETTINGS));

console.log('settings self-test: ok');
