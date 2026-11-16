// Cleaning what the rewrite call returns. Usage: npm run test:improve
import * as assert from 'assert';
import { cleanImproved } from '../src/improve';

assert.equal(cleanImproved('  Fix the login redirect.  '), 'Fix the login redirect.');
assert.equal(cleanImproved('```\nFix the login redirect.\n```'), 'Fix the login redirect.');
assert.equal(cleanImproved('```markdown\nGoal: x\n- a\n```'), 'Goal: x\n- a');
assert.equal(cleanImproved('Rewritten prompt: Fix it'), 'Fix it');
assert.equal(cleanImproved('"Fix it"'), 'Fix it');
assert.equal(cleanImproved('"Say "hi" to them"'), '"Say "hi" to them"', 'inner quotes: leave it');
assert.equal(cleanImproved('Goal: x\n\n- a\n- b'), 'Goal: x\n\n- a\n- b');
assert.equal(cleanImproved('  \n '), '');

console.log('improve self-test: ok');
