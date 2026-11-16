// Keystroke Coins rules. Usage: npm run test:game
import * as assert from 'assert';
import { WARDROBE, bonus, buy, buyItem, canBuy, cleanCat, compact, cost, earn, loadGame, newGame, offlineGain, owns, perChar, rate, tick } from '../src/game';

const s = newGame(0);
assert.equal(perChar(s, 0), 1);

// costs grow 15% a level
assert.equal(cost('keys', 0), 50);
assert.equal(cost('keys', 1), 58);
assert.equal(cost('keys', 2), 67);

// can't buy without coins; buying spends and levels up
assert.equal(buy(s, 'keys'), false);
earn(s, 120);
assert.equal(buy(s, 'keys'), true);
assert.equal(s.coins, 70);
assert.equal(s.lifetime, 120, 'spending never lowers lifetime');
assert.equal(perChar(s, 0), 2);

// one-time upgrades sell once; coffee doubles only inside a combo
earn(s, 1000);
assert.equal(buy(s, 'coffee'), true);
assert.equal(canBuy(s, 'coffee'), false);
assert.equal(buy(s, 'coffee'), false);
assert.equal(perChar(s, 19), 2);
assert.equal(perChar(s, 20), 4);

// passive income: helpers need running tiles, night shift needs you away
assert.equal(rate(s, 3, false), 0);
buy(s, 'cats');
buy(s, 'night');
assert.equal(rate(s, 3, false), 3);
assert.equal(rate(s, 0, false), 0);
assert.equal(rate(s, 3, true), 5);
const before = s.coins;
assert.equal(tick(s, 10, 2, false), 20);
assert.equal(s.coins, before + 20);

// offline: capped at 8 hours, a quarter of one tile's pace
const g = newGame(0);
g.owned = { cats: 4 };
assert.equal(offlineGain(g, 3600_000), 3600);
assert.equal(offlineGain(g, 100 * 3600_000), 8 * 3600, 'capped');
assert.equal(offlineGain(g, -5), 0, 'a clock set back pays nothing');

// lucky bone: only when owned, only below 2%
const b = newGame(0);
assert.equal(bonus(b, 0), 0);
b.owned = { bone: 1, keys: 2 };
assert.equal(bonus(b, 0.019), 300);
assert.equal(bonus(b, 0.02), 0);

// wardrobe: bought once, with coins, and for good
const w = newGame(0);
assert.equal(buyItem(w, 'party'), false, 'no coins');
earn(w, 2200);
assert.equal(buyItem(w, 'party'), true);
assert.equal(w.coins, 2050);
assert.equal(owns(w, 'party'), true);
assert.equal(buyItem(w, 'party'), false, 'only once');
assert.equal(buyItem(w, 'nope'), false);
assert.equal(buyItem(w, 'crown'), true);
assert.equal(w.coins, 50);
assert.ok(WARDROBE.every((x) => x.cost > 0));

// storage is untrusted
const l = loadGame({ coins: -5, lifetime: 'x', owned: { keys: 2.7, coffee: 9, nope: 4 }, at: NaN }, 42);
assert.deepEqual(l, { coins: 0, lifetime: 0, owned: { keys: 2, coffee: 1 }, wardrobe: [], at: 42 });
assert.deepEqual(loadGame(undefined, 7), newGame(7));
assert.deepEqual(loadGame({ wardrobe: ['bowtie', 'bogus', 7, 'bowtie'] }, 1).wardrobe, ['bowtie'], 'unknown ids and repeats dropped');
assert.deepEqual(loadGame({ owned: { crown: 1 } }, 1).wardrobe, ['crown'], 'the old Crowns upgrade became the crown hat');

assert.deepEqual([compact(0), compact(999), compact(1000), compact(1234), compact(15_600), compact(2_500_000)], ['0', '999', '1K', '1.2K', '15K', '2.5M']);

assert.deepEqual(cleanCat({ name: '  Biscuit  ', coat: 'Tuxedo', hat: 'wizard', neck: 'scarf' }), { name: 'Biscuit', coat: 'Tuxedo', hat: 'wizard', neck: 'scarf' });
assert.deepEqual(cleanCat({ name: 'x'.repeat(50), hat: 'scarf', neck: 'party', coat: 7 }), { name: 'x'.repeat(20) }, 'a hat in the neck slot, and junk, are dropped');
assert.deepEqual(cleanCat(null), {});
assert.deepEqual(cleanCat({ name: '   ' }), {});

console.log('game self-test: ok');
