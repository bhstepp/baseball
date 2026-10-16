#!/usr/bin/env node
// Plays the built game (dist/halftone.html) on autopilot with the modelled Rocco and checks the integration:
// BB.Rocco becomes ready, no console errors, every bat-scene state is reached, frame cost. Screenshots of the moments
// that matter go to qa/pilot/play/.  --glb=<file> injects another model (e.g. the integration proxy) instead of the
// one inlined from assets/; --old runs ?rocco=old.
//   node tools/build.js && node tools/rocco-integration-play.js [--glb=<file>] [--secs=90] [--old]
let pw; try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'qa', 'pilot', 'play');
const ARG = k => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [], warns = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'warning') warns.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  if (ARG('glb')) {
    const b64 = fs.readFileSync(path.resolve(ARG('glb'))).toString('base64');
    // the page assigns window.BB_ASSETS itself; keep ours
    await page.addInitScript(b => { const mine = { rocco: b }; Object.defineProperty(window, 'BB_ASSETS', { get: () => mine, set: () => {}, configurable: false }); }, b64);
  }
  await page.goto('file://' + path.join(ROOT, 'dist', 'halftone.html') + (process.argv.includes('--old') ? '?rocco=old' : ''));
  await page.waitForTimeout(1500);
  const st0 = await page.evaluate(() => ({ status: BB.Rocco && BB.Rocco.status(), info: BB.Rocco && BB.Rocco.info ? BB.Rocco.info() : null, ink: BB.Ink && BB.Ink.stats ? BB.Ink.stats() : null }));
  console.log('rocco:', st0.status, st0.info ? JSON.stringify({ warnings: st0.info.warnings, tris: st0.info.triangles, draws: st0.info.drawCalls, loadMs: st0.info.loadMs && +st0.info.loadMs.toFixed(0) }) : '');
  await page.screenshot({ path: path.join(OUT, '00-title.png') });
  // play: power swings and contact swings, with a poor eye so we see takes, whiffs and called strikes too
  await page.evaluate(() => { window.__bb.auto({ sd: 0.05, eye: 0.5, power: 0.4 }); BB.Game.start('derby', {}); });
  const seen = {}, shots = {}, t0 = Date.now(), secs = +(ARG('secs') || 90);
  const want = { windup: 1, pitch: 1, swing: 1, contact: 1, whiff: 1, take: 1, field: 1, between: 1 };
  while (Date.now() - t0 < secs * 1000) {
    await page.waitForTimeout(110);
    const s = await page.evaluate(() => {
      const G = __bb.G, v = __bb.view(), last = BB.Rocco && BB.Rocco.R && BB.Rocco.R.last;
      return { phase: G.phase, scene: v.scene, pt: G.pitchT, sw: !!G.swing, contact: !!(G.swing && G.swing.result.contact), key: last ? last.key : null, layers: last ? last.layers.filter(l => l.w > 0.05).map(l => l.c + '@' + l.t.toFixed(2)).join(' ') : '' };
    });
    let tag = s.phase;
    if (s.phase === 'pitch' && s.sw) tag = s.contact ? 'contact' : 'whiff';
    else if (s.phase === 'pitch' && s.pt > 0.75) tag = 'take';
    else if (s.phase === 'pitch') tag = 'pitch';
    seen[tag] = (seen[tag] || 0) + 1;
    if (want[tag] && !shots[tag]) { shots[tag] = 1; await page.screenshot({ path: path.join(OUT, tag + '.png') }); console.log('shot', tag, s.key || '', s.layers); }
    if (s.phase === 'over') break;
  }
  const perf = await page.evaluate(() => { const st = BB.Render.stats(); return { calls: st.calls, tris: st.triangles, pr: st.pixelRatio, renderMs: +(st.renderMs || 0).toFixed(2), ink: BB.Ink && BB.Ink.stats ? BB.Ink.stats() : null }; });
  console.log('seen', JSON.stringify(seen));
  console.log('perf', JSON.stringify({ calls: perf.calls, tris: perf.tris, pr: perf.pr, renderMs: perf.renderMs, ink: perf.ink && { active: perf.ink.active, reason: perf.ink.reason, level: perf.ink.quality } }));
  await page.evaluate(() => { __bb.auto(null); BB.Game.quit(); });
  await browser.close();
  if (warns.length) console.log('warnings:', [...new Set(warns)].slice(0, 8).join(' | '));
  if (errors.length) { console.error('ERRORS:\n' + [...new Set(errors)].join('\n')); process.exit(1); }
  console.log('rocco-integration-play: OK');
})().catch(e => { console.error(e); process.exit(1); });
