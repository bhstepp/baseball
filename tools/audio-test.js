#!/usr/bin/env node
// Audio self-test: node tools/audio-test.js
// 1. With AudioContext removed from window, every BB.Audio / BB.Haptics call is a silent no-op (no exceptions).
// 2. With a real context: every API before unlock, after unlock, while muted, with music off, across visibility
//    changes and suspend/resume — no page errors, context ends 'running'.
// 3. Offline renders of every sound: non-silent (peak > 0.005) and never clipping (peak < 1.0).
// 4. The built bundle (dist/halftone.html) exposes BB.Audio without load errors, if it exists.
const path = require('path'), fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
// every name the game may call; the cartoon re-skin added the gags and the two new cues
const WANT_SFX = ['crack', 'foul', 'whiff', 'mitt', 'whoosh', 'strike', 'ball', 'out', 'wall', 'stamp', 'tap', 'coin', 'packRip',
  'cardFlip', 'rare', 'unlock', 'levelUp', 'error', 'toast', 'boing', 'slide', 'bonk', 'zip', 'xylo', 'honk', 'pop', 'twinkle', 'kablam', 'splat'];
const WANT_ORGAN = ['charge', 'homer', 'walkup', 'win', 'lose', 'rally', 'menu', 'sneak', 'iris'];
const ROOT = path.join(__dirname, '..');
const HARNESS = 'file://' + path.join(__dirname, 'audio-harness.html');

let failures = 0;
function check(ok, msg) { console.log((ok ? '  ok   ' : '  FAIL ') + msg); if (!ok) failures++; }

function exercise() { // runs in the page
  const A = BB.Audio, H = BB.Haptics, out = [];
  const all = () => {
    A.SFX.forEach(n => A.sfx(n, { quality: Math.random(), sweet: Math.random() < 0.5, mph: 60 + Math.random() * 40 }));
    A.sfx('nope'); A.sfx(); A.sfx('crack', null); A.sfx('mitt', { mph: 'fast' }); A.sfx('toString'); A.sfx('__proto__');
    A.sfx('slide', { dir: 'up' }); A.sfx('slide', { dir: 'down', dur: 9 }); A.sfx('slide', { dir: 'sideways', dur: 'x' });
    A.sfx('zip', { mph: 40 }); A.sfx('zip', { mph: 120 }); A.sfx('honk', { n: 1 }); A.sfx('twinkle', { dur: -1 }); A.sfx('boing', { f: 'big' });
    A.sfx('kablam', { when: 0.05 }); A.sfx('pop', { when: 'soon' }); A.sfx('splat', 'x'); A.organ('toString'); A.organ('_unlock');
    A.ORGAN.forEach(n => A.organ(n)); A.organ('menu'); A.organ('stop'); A.organ('bogus'); A.organ();
    [0, 0.3, 0.8, 1, -1, 5, NaN, undefined].forEach(l => A.crowd(l));
    A.cheer(); A.cheer(1); A.cheer(-3); A.groan();
    H.tap(); H.thud(); H.buzz();
    out.push(A.isMuted(), A.isMusic(), A.state(), A.ready());
  };
  all();                                   // before unlock
  A.unlock(); all();                       // after unlock
  A.setMuted(true); all(); A.setMuted(false);
  A.setMusic(false); A.organ('menu'); all(); A.setMusic(true);
  H.enabled = false; H.buzz(); H.enabled = true;
  A.preview('sfx', 'crack', { quality: 1, sweet: true }); A.preview('crowd', '', { level: 0.5 }); A.preview('x');
  return out;
}

(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    // ---- 1. no Web Audio at all
    console.log('no AudioContext:');
    {
      const page = await browser.newPage(), errs = [];
      page.on('pageerror', e => errs.push(e.message));
      await page.addInitScript(() => {
        delete window.AudioContext; delete window.webkitAudioContext; delete window.OfflineAudioContext; delete window.webkitOfflineAudioContext;
        delete Navigator.prototype.vibrate;
      });
      await page.goto(HARNESS);
      const r = await page.evaluate(exercise);
      const rend = await page.evaluate(() => BB.Audio.render('sfx', 'crack', {}, 1));
      await page.click('#unlock'); await page.click('text=homer');
      check(errs.length === 0, 'no page errors ' + (errs.join('; ') || ''));
      check(await page.evaluate(() => BB.Audio.organ('sneak') === undefined && BB.Audio.sfx('kablam') === undefined), 'new calls are silent no-ops');
      check(r[2] === 'none' && r[3] === false, 'state none / not ready (' + r.slice(2).join(',') + ')');
      check(rend === null, 'render() resolves null without OfflineAudioContext');
      await page.close();
    }

    // ---- 1b. the name lists
    console.log('names:');
    {
      const page = await browser.newPage();
      await page.goto(HARNESS);
      const names = await page.evaluate(() => ({ sfx: BB.Audio.SFX, organ: BB.Audio.ORGAN }));
      for (const n of WANT_SFX) check(names.sfx.includes(n), 'SFX has ' + n);
      for (const n of WANT_ORGAN) check(names.organ.includes(n), 'ORGAN has ' + n);
      check(!names.organ.some(n => n.startsWith('_')), 'private flourishes hidden from ORGAN');
      await page.close();
    }

    // ---- 2. live context
    console.log('live AudioContext:');
    {
      const page = await browser.newPage(), errs = [];
      page.on('pageerror', e => errs.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
      await page.goto(HARNESS);
      const before = await page.evaluate(() => BB.Audio.state());
      check(before === 'none', 'no context is created before unlock (' + before + ')');
      await page.click('#unlock');
      await page.waitForTimeout(200);
      const r = await page.evaluate(exercise);
      check(r.length === 16, 'exercise ran');
      // a real game-ish sequence with the clock running
      await page.evaluate(() => { BB.Audio.organ('menu'); BB.Audio.crowd(0.9); });
      await page.waitForTimeout(1500);
      await page.evaluate(() => { BB.Audio.sfx('whoosh', { mph: 95 }); BB.Audio.sfx('crack', { quality: 1, sweet: true }); BB.Audio.cheer(1); BB.Audio.organ('homer'); });
      await page.waitForTimeout(800);
      // simulate backgrounding (suspend) and return (resume), and an external suspend ('interrupted'-like)
      const vis = await page.evaluate(async () => {
        const s = [];
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
        await new Promise(r => setTimeout(r, 200)); s.push(BB.Audio.state());
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        document.dispatchEvent(new Event('visibilitychange'));
        await new Promise(r => setTimeout(r, 300)); s.push(BB.Audio.state());
        return s;
      });
      check(vis[0] === 'suspended' && vis[1] === 'running', 'hidden -> suspended, visible -> running (' + vis.join(' -> ') + ')');
      await page.click('text=charge'); await page.click('#mute'); await page.click('text=stamp'); await page.click('#mute');
      await page.click('#music'); await page.click('text=menu'); await page.click('#music');
      // cartoon sequence: full-count sneak cue cut by a homer, gags layered, iris sting, then menu
      await page.evaluate(() => { BB.Audio.organ('sneak'); });
      await page.waitForTimeout(400);
      await page.evaluate(() => { BB.Audio.sfx('zip', { mph: 97 }); BB.Audio.sfx('crack', { quality: 1, sweet: true }); BB.Audio.sfx('kablam'); BB.Audio.sfx('slide', { dir: 'up' }); BB.Audio.organ('homer'); });
      await page.waitForTimeout(300);
      await page.evaluate(() => { BB.Audio.sfx('whiff'); BB.Audio.sfx('xylo'); BB.Audio.sfx('twinkle'); BB.Audio.sfx('honk'); BB.Audio.sfx('boing'); BB.Audio.sfx('bonk'); BB.Audio.sfx('splat'); BB.Audio.sfx('pop'); BB.Audio.organ('iris'); });
      await page.waitForTimeout(300);
      await page.evaluate(() => { BB.Audio.setMusic(false); BB.Audio.organ('sneak'); BB.Audio.setMusic(true); BB.Audio.organ('menu'); });
      await page.waitForTimeout(300);
      await page.click('text=slide down'); await page.click('text=K: whiff+xylo+twinkle');
      await page.waitForTimeout(400);
      await page.evaluate(() => { BB.Audio.organ('stop'); BB.Audio.crowd(0); });
      check(await page.evaluate(() => BB.Audio.state()) === 'running', 'context running at end');
      check(errs.length === 0, 'no page/console errors ' + (errs.join('; ') || ''));

      // ---- 3. offline renders
      console.log('offline renders (peak / rms):');
      const rows = await page.evaluate(() => window.audioCheckAll());
      for (const x of rows) {
        const label = (x.kind + ' ' + x.name).padEnd(20) + ' peak ' + String(x.peak).padEnd(7) + ' rms ' + x.rms;
        check(x.peak != null && x.peak > 0.005 && x.peak < 1.0, label);
      }
      await page.close();
    }

    // ---- 4. bundle
    const dist = path.join(ROOT, 'dist', 'halftone.html');
    if (fs.existsSync(dist)) {
      console.log('bundle:');
      const page = await browser.newPage(), errs = [];
      page.on('pageerror', e => errs.push(e.message));
      await page.goto('file://' + dist);
      await page.waitForTimeout(300);
      const ok = await page.evaluate(() => !!(window.BB && BB.Audio && BB.Audio.sfx && BB.Haptics && BB.Haptics.tap));
      check(ok, 'BB.Audio / BB.Haptics present in dist/halftone.html');
      const audioErrs = errs.filter(e => /audio|Audio|organ|Haptic/.test(e));
      check(audioErrs.length === 0, 'no audio-related load errors ' + audioErrs.join('; '));
      await page.close();
    }
  } finally { await browser.close(); }
  console.log(failures ? `\n${failures} FAILED` : '\nall audio checks passed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
