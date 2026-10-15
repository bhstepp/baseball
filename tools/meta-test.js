#!/usr/bin/env node
// Logic tests for BB.Save / BB.Meta (meta agent). usage: node tools/meta-test.js
// Loads 00-const (+ content/rules if present) + 50-save + 55-meta into a fresh VM context per scenario.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const SRC = path.join(__dirname, '..', 'src');

function load(opts) {
  opts = opts || {};
  const ctx = { console, setTimeout, clearTimeout, Date, Math, JSON };
  if (opts.storage !== undefined) ctx.localStorage = opts.storage;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const files = ['00-const.js'].concat(opts.content === false ? [] : ['20-content.js']).concat(['50-save.js', '55-meta.js']);
  for (const f of files) {
    const p = path.join(SRC, f);
    if (!fs.existsSync(p)) continue;
    vm.runInContext('"use strict";\n' + fs.readFileSync(p, 'utf8'), ctx, { filename: f });
  }
  if (opts.tour && !(ctx.BB.Content && ctx.BB.Content.TOUR)) {
    // stub a tour when the content module is absent
    ctx.BB.Content = ctx.BB.Content || {};
    ctx.BB.Content.TOUR = [0, 1, 2, 3, 4, 5].map(i => ({ id: 'ch' + i, title: 'Issue ' + i, park: 'p' + i,
      games: [0, 1, 2, 3, 4].map(k => ({ id: 't' + (i + 1) + 'g' + (k + 1), title: 'G' + k, pitcher: 'x', park: 'p' + i, scenario: { kind: 'hits', stars: [1, 2, 3] } })) }));
  }
  return ctx.BB;
}
function memStorage() {
  const m = {};
  return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; }, _m: m };
}
const throwing = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); }, removeItem() { throw new Error('x'); } };

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e).toString().split('\n').slice(0, 3).join('\n       ')); }
}

console.log('meta-test');

test('save: in-memory fallback when localStorage throws', () => {
  const BB = load({ storage: throwing });
  assert.strictEqual(BB.Save.persistent(), false);
  BB.Save.get().coins = 777; BB.Save.commit();
  assert.strictEqual(BB.Save.get().coins, 777);
  BB.Meta.setSetting('assist', false);
  assert.strictEqual(BB.Meta.settings().assist, false);
});

test('save: no localStorage at all', () => {
  const BB = load({});
  assert.strictEqual(BB.Save.persistent(), false);
  assert.ok(BB.Save.get().settings.assist === true);
  assert.strictEqual(BB.Meta.settings().latencyMs, 30);
});

test('save: persists and reloads, corrupt JSON -> defaults, migrations fill new fields', () => {
  const st = memStorage();
  let BB = load({ storage: st });
  assert.strictEqual(BB.Save.persistent(), true);
  BB.Save.set({ coins: 4321 });
  BB = load({ storage: st });
  assert.strictEqual(BB.Save.get().coins, 4321);
  st.setItem('halftone.v1', '{nope');
  BB = load({ storage: st });
  assert.strictEqual(BB.Save.get().coins, 150);
  st.setItem('halftone.v1', JSON.stringify({ v: 1, coins: 5, stats: { hits: 3 } }));
  BB = load({ storage: st });
  assert.strictEqual(BB.Save.get().coins, 5);
  assert.strictEqual(BB.Save.get().stats.hits, 3);
  assert.strictEqual(BB.Save.get().stats.hr, 0);
  assert.ok(BB.Save.get().daily.results);
});

test('cards: 72, unique ids & names, deterministic, 2 foil/3 rare/7 common per team', () => {
  const A = load({ content: false }), B = load({ content: false });
  assert.strictEqual(A.Meta.CARDS.length, 72);
  assert.strictEqual(new Set(A.Meta.CARDS.map(c => c.id)).size, 72);
  assert.strictEqual(new Set(A.Meta.CARDS.map(c => c.name)).size, 72);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(A.Meta.CARDS)), JSON.parse(JSON.stringify(B.Meta.CARDS)));
  for (let t = 0; t < 6; t++) {
    const team = A.Meta.CARDS.filter(c => c.teamIdx === t);
    assert.strictEqual(team.length, 12);
    const n = r => team.filter(c => c.rarity === r).length;
    assert.strictEqual([n('foil'), n('rare'), n('common')].join(), '2,3,7');
    assert.strictEqual(new Set(team.map(c => c.number)).size, 12);
  }
  assert.strictEqual(A.Meta.TEAMS.length, 6);
  const C = load({}); // with content (if present) names stay the same; only team names may differ
  assert.strictEqual(C.Meta.CARDS.map(c => c.name).join(), A.Meta.CARDS.map(c => c.name).join());
  console.log('       e.g. ' + A.Meta.CARDS.slice(0, 3).map(c => c.name + ' (' + c.pos + ', ' + c.team + ', ' + c.stat + ')').join('; '));
  console.log('       teams: ' + C.Meta.TEAMS.map(t => t.name).join(', '));
});

test('bats: >= 8, stats in range, default Old Hickory', () => {
  const BB = load({});
  assert.ok(BB.Meta.BATS.length >= 8);
  BB.Meta.BATS.forEach(b => { assert.ok(b.power >= 0.9 && b.power <= 1.12, b.id); assert.ok(b.timing > 0.5 && b.timing < 1.6); });
  assert.strictEqual(BB.Meta.currentBat().id, 'b_hickory');
  assert.strictEqual(BB.Meta.equipBat('b_lumber'), null); // locked
});

test('packs: odds, guarantee every 3rd pack, dupes refund, misprints exist', () => {
  const BB = load({});
  const d = BB.Save.get();
  d.coins = 1e9;
  const tally = { common: 0, rare: 0, foil: 0, misprint: 0 };
  let dupRefund = 0;
  for (let i = 0; i < 3000; i++) {
    const p = BB.Meta.openPack();
    assert.ok(!p.error);
    assert.strictEqual(p.cards.length, 3);
    if (p.guaranteed) assert.ok(p.cards.some(c => c.card.rarity !== 'common'), 'guaranteed pack has rare+');
    p.cards.forEach(c => { tally[c.rarity]++; if (c.dupe) assert.ok(c.refund > 0); dupRefund += c.refund; });
    assert.strictEqual(new Set(p.cards.map(c => c.card.id)).size, 3);
  }
  const n = 9000;
  console.log('       9000 cards: ' + JSON.stringify(tally) + ' refunds ' + dupRefund);
  assert.ok(tally.misprint > 100 && tally.misprint < 350);
  assert.ok(tally.foil / n > 0.05 && tally.foil / n < 0.11);
  assert.ok(BB.Meta.albumStats().owned === 72);
  assert.ok(BB.Save.get().ach.full && BB.Save.get().ach.set && BB.Save.get().ach.misprint);
  // set rewards unlocked
  assert.ok(BB.Meta.batUnlocked('b_golden') && BB.Meta.inksetUnlocked('dusk'));
  // no coins
  d.coins = 10;
  assert.strictEqual(BB.Meta.openPack().error, 'coins');
});

test('packs: completion pace (packs to finish the album)', () => {
  const BB = load({});
  BB.Save.get().coins = 1e9;
  let k = 0; while (BB.Meta.albumStats().owned < 72 && k < 2000) { BB.Meta.openPack(); k++; }
  console.log('       album complete after ' + k + ' packs');
  assert.ok(k < 200);
});

test('achievements via onEvent: HR 455ft, rope, walk, cycle, on fire, slam, perfects', () => {
  const BB = load({});
  const M = BB.Meta;
  M.startGame('tour', { id: 't1g1' });
  const hit = (call, extra) => M.onEvent(Object.assign({ mode: 'tour', event: { call, runs: 0, outs: 0 }, swing: { contact: true, label: 'GOOD', ev: 95, la: 20, spray: 0 }, play: { type: call, dist: 300, spray: 0 } }, extra || {}));
  let got = hit('1B');
  assert.strictEqual(got.map(a => a.id).join(), 'first_hit');
  hit('2B'); got = hit('3B');
  assert.ok(got.some(a => a.id === 'onfire'));
  got = M.onEvent({ mode: 'tour', event: { call: 'HR', runs: 4 }, swing: { contact: true, label: 'PERFECT', sweet: true, ev: 112, la: 30, spray: 20 }, play: { type: 'HR', dist: 455, spray: 20 } });
  const ids = got.map(a => a.id);
  ['first_hr', 'moonshot', 'slam', 'cycle', 'sweet', 'oppo'].forEach(id => assert.ok(ids.includes(id), id + ' in ' + ids));
  assert.ok(!ids.includes('tape'));
  got = M.onEvent({ mode: 'tour', event: { call: 'OUT', outs: 1 }, swing: { contact: true, label: 'GREAT', ev: 111, la: 12 }, play: { type: 'OUT' } });
  assert.ok(got.some(a => a.id === 'rope'));
  got = M.onEvent({ mode: 'tour', event: { call: 'WALK' }, swing: null, play: null });
  assert.strictEqual(got.map(a => a.id).join(), 'patient');
  // full count hit
  ['BALL', 'BALL', 'STRIKE', 'BALL', 'FOUL'].forEach(c => M.onEvent({ event: { call: c }, swing: null }));
  got = hit('1B');
  assert.ok(got.some(a => a.id === 'fullcount'));
  // repeated: never twice
  got = hit('1B');
  assert.ok(!got.some(a => a.id === 'first_hit'));
  const st = M.stats();
  assert.strictEqual(st.hr, 1); assert.strictEqual(st.longest, 455); assert.strictEqual(st.bb, 1); assert.strictEqual(st.maxEV, 112);
});

test('endGame rewards: coins/xp/level/stars, unlocks, idempotent', () => {
  const BB = load({ tour: true });
  const M = BB.Meta;
  const T = BB.Content.TOUR;
  const g1 = T[0].games[0], g2 = T[0].games[1];
  assert.ok(M.gameUnlocked(g1) && !M.gameUnlocked(g2));
  const c0 = M.coins();
  M.startGame('tour', g1);
  M.onEvent({ mode: 'tour', event: { call: 'HR', runs: 1 }, swing: { contact: true, ev: 104, la: 28 }, play: { type: 'HR', dist: 400 } });
  const result = { mode: 'tour', win: true, stars: 2, score: 1, stats: { hits: 1, hr: 1 } };
  const r = M.endGame('tour', g1, result);
  console.log('       rewards: ' + JSON.stringify({ coins: r.coins, xp: r.xp, lines: r.lines.map(l => l.label + ' +' + l.coins + 'c +' + l.xp + 'xp'), newAch: r.newAch.map(a => a.id) }));
  assert.ok(r.coins > 0 && r.xp > 0);
  assert.strictEqual(M.coins(), c0 + r.coins);
  assert.strictEqual(r.tourStars, 2);
  assert.ok(M.gameUnlocked(g2));
  assert.ok(r.newAch.some(a => a.id === 'first_hr'));
  assert.strictEqual(M.endGame('tour', g1, result), r); // same object -> same rewards, no double credit
  assert.strictEqual(M.coins(), c0 + r.coins);
  // replay with fewer stars keeps best
  const r2 = M.endGame('tour', g1, { mode: 'tour', win: true, stars: 1, stats: {} });
  assert.strictEqual(M.gameStars(g1), 2); assert.strictEqual(r2.tourStars, 2);
  assert.ok(!r2.lines.some(l => /First win/.test(l.label)), 'first-win bonus only once a day');
  // level up
  BB.Save.get().xp = 95;
  const r3 = M.endGame('derby', {}, { mode: 'derby', score: 3, stats: { hr: 3 } });
  assert.ok(r3.level > r3.levelBefore);
  assert.ok(r3.lines.some(l => l.label === 'Level up!'));
  assert.ok(r3.unlocks.some(u => u.id === 'b_slap'), 'Slap Stick unlocks at level 2: ' + JSON.stringify(r3.unlocks));
  assert.ok(r3.best && M.derbyBest() === 3);
});

test('tour: chapter n+1 unlocks only when chapter n boss is beaten', () => {
  const BB = load({ tour: true });
  const M = BB.Meta, T = BB.Content.TOUR;
  assert.ok(!M.chapterUnlocked(1));
  for (let k = 0; k < 4; k++) M.endGame('tour', T[0].games[k], { win: true, stars: 3, stats: {} });
  assert.ok(!M.chapterUnlocked(1));
  assert.ok(M.gameUnlocked(T[0].games[4]));
  const r = M.endGame('tour', T[0].games[4], { win: true, stars: 1, stats: {} });
  assert.ok(M.chapterUnlocked(1) && M.gameUnlocked(T[1].games[0]) && !M.gameUnlocked(T[1].games[1]));
  assert.ok(r.unlocks.some(u => u.kind === 'chapter' && u.id === 1));
  assert.ok(r.newAch.some(a => a.id === 'giant') && r.newAch.some(a => a.id === 'sweep'));
  assert.strictEqual(M.nextTourGame(T[0].games[4]), T[1].games[0]);
  assert.strictEqual(M.currentTourGame(), T[1].games[0]);
  // losing does not unlock
  M.endGame('tour', T[1].games[0], { win: false, stars: 0, stats: {} });
  assert.ok(!M.gameUnlocked(T[1].games[1]));
});

test('daily: one scored attempt per day, streak across dates, broken streak', () => {
  const BB = load({});
  const M = BB.Meta, d = BB.Save.get();
  const play = (key, score) => M.endGame('daily', { dayKey: key }, { mode: 'daily', win: true, score, stats: {} });
  let r = play('2026-10-15', 5);
  assert.ok(r.daily.scored && r.daily.streak === 1 && r.daily.number === 1);
  r = play('2026-10-15', 9); // replay
  assert.ok(r.daily.replay && !r.daily.scored);
  assert.strictEqual(d.daily.results['2026-10-15'].score, 5);
  play('2026-10-16', 3);
  r = play('2026-10-17', 4);
  assert.strictEqual(r.daily.streak, 3);
  assert.ok(r.newAch.some(a => a.id === 'daily3'));
  assert.ok(M.batUnlocked('b_fungo'));
  // month boundary
  play('2026-10-31', 1); r = play('2026-11-01', 1);
  assert.strictEqual(r.daily.streak, 2);
  assert.strictEqual(d.daily.bestStreak, 3);
  assert.strictEqual(M.dailyInfo('2026-11-02').streak, 2);  // still alive the day after
  assert.strictEqual(M.dailyInfo('2026-11-03').streak, 0);  // broken
  r = play('2026-11-05', 2);
  assert.strictEqual(r.daily.streak, 1);
  assert.strictEqual(M.dailyHistory(14, '2026-11-05').length, 14);
  assert.strictEqual(M.prevDay('2027-01-01'), '2026-12-31');
  assert.strictEqual(M.prevDay('2028-03-01'), '2028-02-29');
});

test('unlock conditions & equip & buy', () => {
  const BB = load({});
  const M = BB.Meta;
  assert.ok(!M.batUnlocked('b_corked'));
  BB.Save.get().coins = 2000;
  assert.ok(M.buy('bat', 'b_corked').ok);
  assert.ok(M.batUnlocked('b_corked'));
  assert.strictEqual(M.coins(), 800);
  const got = M.equipBat('b_corked');
  assert.ok(got.some(a => a.id === 'changeup'));
  assert.strictEqual(M.currentBat().id, 'b_corked');
  assert.ok(/coins/.test(M.condText({ kind: 'coins', n: 1200 })));
  // inksets: park default -> park's inkset
  const park = { id: 'x', inkset: 'harbor' };
  assert.strictEqual(M.currentInkset(park).id, 'harbor');
  assert.strictEqual(M.currentInkset(null).id, 'classic');
  assert.strictEqual(M.equipInkset('ledger'), null);
  M.equipInkset('classic');
  assert.strictEqual(M.currentInkset(park).id, 'classic');
  BB.Save.get().xp = 99999;
  assert.ok(M.inksetUnlocked('harbor'));
  M.resetProgress();
  assert.strictEqual(M.coins(), 150);
});

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
