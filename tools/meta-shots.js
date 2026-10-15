#!/usr/bin/env node
// Screenshots of every menu screen (meta agent). usage: node tools/build.js && node tools/meta-shots.js [--small]
// Writes qa/meta/*.png (iPhone 14, 390x844 @3x; --small also does iPhone SE 1st gen 320x568). Fails on console errors.
const path = require('path'), fs = require('fs');
let pw; try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'qa', 'meta');
fs.mkdirSync(OUT, { recursive: true });
const SMALL = process.argv.includes('--small');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);

async function run(vp, tag) {
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: tag ? 2 : 3, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.addInitScript(() => {
    // stub the game engine if main is absent, so PLAY BALL etc. work
    window.addEventListener('DOMContentLoaded', () => {
      if (!window.BB || window.BB.Game) return;
      window.BB.Game = { start() { BB.UI.inGame(true); }, pause() {}, resume() { BB.UI.hideAll(); BB.UI.inGame(true); }, quit() { BB.UI.inGame(false); BB.UI.show('title'); }, restart() {} };
    });
  });
  const file = 'file://' + path.join(ROOT, 'dist', 'halftone.html');
  await page.goto(file);
  await page.waitForTimeout(900);
  if (!(await page.evaluate(() => !!(window.BB && BB.UI && BB.UI.current())))) {
    await browser.close();
    return ['bundle did not boot (a module failed to parse?): ' + errors.join(' | ')];
  }
  const shot = async (name, wait) => {
    if (ONLY && !name.includes(ONLY)) return;
    await page.waitForTimeout(wait == null ? 700 : wait);
    await page.screenshot({ path: path.join(OUT, (tag || '') + name + '.png') });
  };
  const ui = (name, data) => page.evaluate(([n, d]) => BB.UI.show(n, d), [name, data || null]);
  const click = async (sel) => { await page.locator(sel).first().click(); };

  // first run
  await shot('01-howto-1');
  await click('.howto .foot .btn.primary'); await shot('02-howto-2');
  await click('.howto .foot .btn.primary'); await shot('03-howto-3');
  await click('.howto .foot .btn.primary'); await shot('04-title-fresh', 900);

  // build up a mid-game save
  await page.evaluate(() => {
    const M = BB.Meta, d = BB.Save.get();
    d.coins = 2400;
    const T = BB.Content.TOUR;
    const win = (g, s) => { M.startGame('tour', g); M.endGame('tour', g, { mode: 'tour', win: true, stars: s, score: 1, stats: { hits: 3, hr: 1 } }); };
    T[0].games.forEach((g, i) => win(g, [3, 2, 3, 1, 2][i]));
    win(T[1].games[0], 2); win(T[1].games[1], 1);
    for (let i = 0; i < 14; i++) M.openPack();
    M.onEvent({ mode: 'tour', event: { call: 'HR', runs: 4 }, swing: { contact: true, label: 'PERFECT', sweet: true, ev: 113, la: 29, spray: -10 }, play: { type: 'HR', dist: 463, spray: -10 } });
    M.onEvent({ mode: 'tour', event: { call: 'WALK' } });
    const today = BB.U.dayKey();
    let k = M.prevDay(M.prevDay(M.prevDay(M.prevDay(today))));
    [k, M.prevDay(k), M.prevDay(M.prevDay(M.prevDay(k)))].forEach((day, i) => M.endGame('daily', { dayKey: day }, { mode: 'daily', win: true, score: 3 + i, stars: 1, scoreLabel: (3 + i) + ' HR', stats: {} }));
    M.endGame('derby', {}, { mode: 'derby', score: 7, stats: { hr: 7, longest: 441 } });
    d.coins = 1340;
    BB.Save.commit();
  });
  await ui('title'); await shot('05-title');
  await ui('tour'); await shot('06-tour');
  await page.evaluate(() => { document.querySelector('.tourmap .body').scrollTop = 1500; }); await shot('07-tour-scrolled', 300);
  await page.evaluate(() => BB.UI.show('brief', { mode: 'tour', cfg: BB.Content.getGame('t2g3') }));
  await shot('08-brief-tour');
  await page.evaluate(() => BB.UI.show('brief', { mode: 'tour', cfg: BB.Content.getGame('t1g5') })); await shot('09-brief-boss');
  await page.evaluate(() => BB.UI.show('brief', { mode: 'daily', cfg: BB.Rules ? BB.Rules.dailyCfg(BB.U.dayKey()) : { dayKey: BB.U.dayKey() } })); await shot('10-brief-daily');
  await page.evaluate(() => BB.UI.show('brief', { mode: 'derby', cfg: { park: 'p_harbor' } })); await shot('11-brief-derby');

  // results
  await page.evaluate(() => {
    const g = BB.Content.getGame('t2g3'), M = BB.Meta;
    BB.Save.get().xp += 0;
    M.startGame('tour', g);
    M.onEvent({ mode: 'tour', event: { call: '3B', runs: 2 }, swing: { contact: true, ev: 104, la: 18, spray: 30 }, play: { type: '3B', dist: 380 } });
    const result = { mode: 'tour', win: true, stars: 3, score: 4, scoreLabel: '4–3 · walk-off', headline: 'WALK-OFF TRIPLE!', stats: { pitches: 14, swings: 9, contact: 6, hits: 4, hr: 1, k: 1, bb: 1, runs: 4, longest: 412, maxEV: 108, perfects: 2 } };
    const rewards = M.endGame('tour', g, result);
    BB.UI.show('results', { mode: 'tour', cfg: g, result, rewards });
  });
  await shot('12-results-tour-early', 500);
  await shot('13-results-tour', 4200);
  await page.evaluate(() => { document.querySelector('.results .body').scrollTop = 999; }); await shot('13b-results-tour-scrolled', 300);
  await page.evaluate(() => {
    const g = BB.Content.getGame('t2g4');
    const result = { mode: 'tour', win: false, stars: 0, score: 1, scoreLabel: '1 of 3 HR', headline: 'SO CLOSE', stats: { pitches: 20, swings: 14, hits: 2, hr: 1, k: 3 } };
    BB.UI.show('results', { mode: 'tour', cfg: g, result, rewards: BB.Meta.endGame('tour', g, result) });
  });
  await shot('14-results-loss', 3000);
  await page.evaluate(() => {
    const cfg = BB.Rules ? BB.Rules.dailyCfg(BB.U.dayKey()) : { dayKey: BB.U.dayKey() };
    const result = { mode: 'daily', win: true, stars: 2, score: 5, scoreLabel: '5 HR · 2,011 ft', headline: 'DAILY DERBY #' + BB.U.dayNumber(BB.U.dayKey()), share: 'Halftone Hardball Daily #1\n5 HR', stats: { hits: 5, hr: 5, longest: 451, maxEV: 111 } };
    BB.UI.show('results', { mode: 'daily', cfg, result, rewards: BB.Meta.endGame('daily', cfg, result) });
  });
  await shot('15-results-daily', 3500);
  await page.evaluate(() => {
    const result = { mode: 'derby', win: false, stars: 2, score: 9, scoreLabel: '9 HR · 3,702 ft', headline: 'NEW RECORD', stats: { hits: 9, hr: 9, longest: 470 } };
    BB.UI.show('results', { mode: 'derby', cfg: {}, result, rewards: BB.Meta.endGame('derby', {}, result) });
  });
  await shot('16-results-derby', 3500);

  // shop & pack opening
  await page.evaluate(() => { BB.Save.get().coins = 1340; });
  await ui('shop'); await shot('17-shop');
  await page.evaluate(() => { BB.Save.get().packs.opened = 2; }); // next pack guaranteed
  await ui('shop'); await shot('17b-shop-guaranteed');
  await click('.shop .btn.primary'); await shot('18-pack-rip', 250);
  await page.waitForTimeout(900); await shot('19-pack-back', 100);
  for (let i = 0; i < 3; i++) {
    await click('.opening .flip'); await shot('20-pack-card' + (i + 1), 900);
    await click('.opening .flip');
  }
  await shot('21-pack-summary', 500);
  // force a misprint reveal for the fanfare shot
  await page.evaluate(() => {
    const orig = BB.Meta.openPack;
    BB.Meta.openPack = function () { const r = orig.call(BB.Meta); r.cards[2].rarity = 'misprint'; r.cards[2].misprint = true; BB.Meta.openPack = orig; return r; };
    BB.UI.show('shop');
  });
  await click('.shop .btn.primary'); await page.waitForTimeout(1000);
  await click('.opening .flip'); await click('.opening .flip'); await page.waitForTimeout(200);
  await click('.opening .flip'); await click('.opening .flip'); await page.waitForTimeout(200);
  await click('.opening .flip'); await shot('22-pack-misprint', 1000);

  // album
  await ui('album', { team: 0 }); await shot('23-album', 1000);
  await click('.cslot canvas'); await shot('24-album-card');
  await ui('album', { team: 4 }); await shot('25-album-team5', 1000);

  // locker
  await page.evaluate(() => { BB.Save.get().xp = 900; });
  await ui('locker'); await shot('26-locker-bats');
  await page.evaluate(() => { document.querySelector('.locker .body').scrollTop = 99999; }); await shot('27-locker-bats-end', 300);
  await click('.locker .tab:nth-child(2)'); await shot('28-locker-inks');

  // scorebook, settings
  await ui('book'); await shot('29-scorebook');
  await page.evaluate(() => { document.querySelector('.book .body').scrollTop = 99999; }); await shot('30-scorebook-stamps', 300);
  await ui('settings'); await shot('31-settings');
  await page.evaluate(() => { document.querySelector('.settings .body').scrollTop = 99999; }); await shot('32-settings-end', 300);

  // toasts
  await ui('title');
  await page.evaluate(() => { BB.UI.toast('STAMPED: Moonshot', 'ach'); BB.UI.toast('Slap Stick bat', 'unlock'); });
  await shot('33-toasts', 500);

  // in game: pause button + pause overlay (real engine if present)
  await page.evaluate(() => BB.UI.show('brief', { mode: 'tour', cfg: BB.Content.getGame('t1g1') }));
  await page.waitForTimeout(300);
  await click('.brief .foot .btn');
  await shot('34-ingame', 2200);
  await click('#pausebtn'); await shot('35-pause', 500);
  await click('.pause .btn.primary'); await page.waitForTimeout(300);
  const st = await page.evaluate(() => ({ cur: BB.UI.current(), ingame: document.body.classList.contains('ingame') }));
  if (st.cur !== null || !st.ingame) errors.push('resume did not return to game: ' + JSON.stringify(st));
  await click('#pausebtn'); await page.waitForTimeout(200);
  await click('.pause .btn:nth-of-type(3)'); await page.waitForTimeout(500);
  const st2 = await page.evaluate(() => ({ cur: BB.UI.current(), ingame: document.body.classList.contains('ingame') }));
  if (st2.cur !== 'title' || st2.ingame) errors.push('quit did not return to title: ' + JSON.stringify(st2));
  await shot('36-after-quit', 600);

  await browser.close();
  return errors;
}

(async () => {
  let errors = await run({ width: 390, height: 844 }, '');
  if (SMALL) errors = errors.concat(await run({ width: 320, height: 568 }, 'se-'));
  if (errors.length) { console.error('ERRORS:\n' + [...new Set(errors)].join('\n')); process.exit(1); }
  console.log('meta-shots: OK -> ' + OUT);
})();
