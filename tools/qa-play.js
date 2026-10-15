#!/usr/bin/env node
// Integration smoke test: loads dist/halftone.html in iPhone 14 emulation, plays every mode on autopilot,
// screenshots key moments into qa/play/, and fails on any console error or a game that never ends.
// usage: node tools/build.js && node tools/qa-play.js [--fast]
const path = require('path'), fs = require('fs');
let pw; try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'qa', 'play');
fs.mkdirSync(OUT, { recursive: true });
const FAST = process.argv.includes('--fast');

(async () => {
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto('file://' + path.join(ROOT, 'dist', 'halftone.html'));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, '00-title.png') });

  async function playGame(label, mode, cfgExpr, sd) {
    await page.evaluate(([mode, cfgExpr, sd]) => {
      const cfg = new Function('return ' + cfgExpr)();
      window.__bb.auto({ sd, eye: 0.7, power: 0.35 });
      BB.Game.start(mode, cfg);
    }, [mode, cfgExpr, sd]);
    let shots = 0, t0 = Date.now();
    const limit = FAST ? 240e3 : 600e3;
    while (Date.now() - t0 < limit) {
      await page.waitForTimeout(FAST ? 250 : 400);
      const st = await page.evaluate(() => ({ phase: __bb.G.phase, scene: __bb.view().scene, pT: __bb.G.pitchT }));
      if (shots < 4 && ((st.phase === 'pitch' && st.pT > 0.3 && shots < 2) || (st.scene === 'field' && shots >= 2))) {
        await page.screenshot({ path: path.join(OUT, `${label}-${shots}.png`) }); shots++;
      }
      if (st.phase === 'over') break;
    }
    await page.waitForTimeout(1500);
    const res = await page.evaluate(() => __bb.G.results && { result: __bb.G.results.result, rewards: __bb.G.results.rewards });
    await page.screenshot({ path: path.join(OUT, `${label}-results.png`) });
    console.log(label, res ? JSON.stringify({ win: res.result.win, stars: res.result.stars, score: res.result.scoreLabel, coins: res.rewards && res.rewards.coins }) : 'DID NOT FINISH');
    if (!res) errors.push(label + ' did not finish');
    await page.evaluate(() => { __bb.auto(null); BB.Game.quit(); });
    await page.waitForTimeout(300);
  }

  const tourFirst = 'BB.Content.TOUR[0].games[0]';
  await playGame('tour1', 'tour', tourFirst, 0.03);
  await playGame('daily', 'daily', 'BB.Rules.dailyCfg(BB.U.dayKey())', 0.035);
  if (!FAST) {
    await playGame('derby', 'derby', '({})', 0.03);
    await playGame('tourBoss', 'tour', 'BB.Content.TOUR[5].games[4]', 0.025);
  }
  await page.screenshot({ path: path.join(OUT, '99-menu-after.png') });
  await browser.close();
  if (errors.length) { console.error('ERRORS:\n' + [...new Set(errors)].join('\n')); process.exit(1); }
  console.log('qa-play: OK');
})();
