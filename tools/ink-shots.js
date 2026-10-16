#!/usr/bin/env node
// Ink QA: before/after screenshots of BB.Ink (src/37-ink.js) through tools/ink-harness.html (iPhone 14: 390x844 @3x,
// WebGL via SwiftShader), close-ups, debug views of the intermediate targets, a skinned + morph-target check, and a
// relative cost measurement (ink off vs on per quality level). Output: qa/ink/*.png (gitignored).
//   node tools/ink-shots.js             everything
//   node tools/ink-shots.js bat         only shots whose name contains "bat"
//   node tools/ink-shots.js --perf      cost measurement only
//   node tools/ink-shots.js --noperf    shots only
//   node tools/ink-shots.js --game      also play dist/halftone.html for a few seconds with ?ink=1 (run tools/build.js first)
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'qa', 'ink');
fs.mkdirSync(OUT, { recursive: true });
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--allow-file-access-from-files'];

// [name, harness query]; each becomes <name>-off.png, <name>-on.png and <name>-pair.png (side by side)
const PAIRS = [
  ['bat-idle', 'scene=bat&state=idle'],
  ['bat-windup', 'scene=bat&state=windup&w=0.5'],
  ['bat-loading', 'scene=bat&state=loading&l=1&time=3.31'],
  ['bat-swing', 'scene=bat&state=swing&st=0.035'],
  ['bat-contact', 'scene=bat&state=contact&st=0.12&shake=0.6'],
  ['bat-whiff-dizzy', 'scene=bat&state=whiff&st=0.75'],
  ['bat-called', 'scene=bat&state=called&dt=0.45&strike=1'],
  ['bat-boss', 'scene=bat&state=windup&w=0.5&pitcher=23&park=5'],
  ['field-hr', 'scene=field&play=hr&f=0.55'],
  ['field-hr-trot', 'scene=field&play=hr&f=1&extra=0.9'],
  ['field-gapper-runners', 'scene=field&play=gap&f=1&extra=0.7'],
  ['field-groundout', 'scene=field&play=ground&f=0.45'],
  ['title', 'scene=title&time=4.1'],
  ['title-park2', 'scene=title&park=2&time=1.5'],
  ['title-swing', 'scene=title&time=5.3&park=4'],
];
// close-ups: [name, query, which] -> native-resolution crop around a character in the game framing (ink off / on)
const ZOOMS = [
  ['zoom-rocco-bat', 'scene=bat&state=windup&w=0.5', 'rocco'],
  ['zoom-rocco-swing', 'scene=bat&state=swing&st=0.035', 'rocco'],
  ['zoom-catcher', 'scene=bat&state=windup&w=0.5', 'catcher'],
  ['zoom-pitcher', 'scene=bat&state=windup&w=0.8', 'pitcher'],
  ['zoom-rocco-title', 'scene=title&time=4.1', 'rocco'],
];
// close-up camera renders (ink on): character detail
const CLOSE = [
  ['close-rocco', 'scene=bat&state=windup&w=0.5&cam=rocco&nohud=1&fx=1'],
  ['close-rocco-side', 'scene=bat&state=windup&w=0.5&cam=rocco&yaw=70&nohud=1&fx=1'],
  ['close-pitcher', 'scene=bat&state=windup&w=0.8&cam=pitcher&nohud=1&fx=1'],
  ['close-catcher', 'scene=bat&state=windup&w=0.5&cam=catcher&nohud=1&fx=1'],
];
// intermediate targets
const DEBUG = [
  ['dbg-normals', 'scene=bat&state=windup&w=0.5&dbg=normals&nohud=1&fx=1'],
  ['dbg-edges', 'scene=bat&state=windup&w=0.5&dbg=edges&nohud=1&fx=1'],
  ['dbg-lines', 'scene=bat&state=windup&w=0.5&dbg=lines&nohud=1&fx=1'],
  ['dbg-lines-field', 'scene=field&play=gap&f=1&extra=0.7&dbg=lines&nohud=1&fx=1'],
];
// hulls kept under the ink (comparison), quality levels
const VARIANTS = [
  ['var-hulls-on', 'scene=bat&state=windup&w=0.5&hulls=1&fx=1'],
  ['var-q1', 'scene=bat&state=windup&w=0.5&q=1&fx=1'],
  ['var-q2', 'scene=bat&state=windup&w=0.5&q=2&fx=1'],
  ['var-q3', 'scene=bat&state=windup&w=0.5&q=3&fx=1'],
];

(async () => {
  const args = process.argv.slice(2), perfOnly = args.includes('--perf'), game = args.includes('--game'), filt = args.find(a => !a.startsWith('--'));
  const browser = await pw.chromium.launch({ args: GL_ARGS });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  const harness = 'file://' + path.join(ROOT, 'tools', 'ink-harness.html');
  const glb = fs.existsSync(path.join(ROOT, 'assets', 'rocco.glb'));
  await page.goto(harness + '?scene=title' + (glb ? '&glb=1' : ''));
  await page.waitForFunction(() => window.__done === true, null, { timeout: 90000 });
  const setup = async (q) => page.evaluate((qq) => { window.__done = false; return window.setup('?' + qq); }, /(^|[?&])q=/.test(q) ? q : q + '&q=2');
  const shot = async (name, q, clip) => { const st = await setup(q); await page.screenshot({ path: path.join(OUT, name + '.png'), clip }); return st; };
  const want = (n) => !filt || n.includes(filt);
  const pairPage = await ctx.newPage();
  async function pair(name, a, b, la, lb, w, h) {
    const html = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width, initial-scale=1"><style>body{margin:0;background:#222;display:flex;gap:0}figure{margin:0;position:relative}
      img{display:block;width:${w}px;height:${h}px}figcaption{position:absolute;left:6px;top:6px;font:700 13px system-ui;color:#fff;background:#0008;padding:2px 6px;border-radius:4px}</style>
      <figure><img src="${a}.png"><figcaption>${la}</figcaption></figure><figure><img src="${b}.png"><figcaption>${lb}</figcaption></figure>`;
    fs.writeFileSync(path.join(OUT, '_pair.html'), html);
    await pairPage.setViewportSize({ width: w * 2, height: h });
    await pairPage.goto('file://' + path.join(OUT, '_pair.html'));
    await pairPage.waitForFunction(() => [...document.images].every(i => i.complete));
    await pairPage.screenshot({ path: path.join(OUT, name + '.png') });
  }

  if (!perfOnly) {
    for (const [name, q] of PAIRS) {
      if (!want(name)) continue;
      await shot(name + '-off', q + '&fx=0');
      const st = await shot(name + '-on', q + '&fx=1');
      await pair(name + '-pair', name + '-off', name + '-on', 'ink off (hulls)', 'ink on', 390, 844);
      if (!st.active) console.log('  ! ink not active for', name, JSON.stringify(st));
    }
    for (const [name, q, which] of ZOOMS) {
      if (!want(name)) continue;
      await setup(q + '&fx=1');
      const box = await page.evaluate((w) => {
        const S = BB.Render._S, ch = S[w]; if (!ch) return null;
        const glb = w === 'rocco' && BB.Rocco && BB.Rocco.ready && BB.Rocco.ready() && BB.Rocco.R.root && BB.Rocco.R.root.visible;
        const b = new THREE.Box3().setFromObject(glb ? BB.Rocco.R.root : ch.root), c = [], V = new THREE.Vector3();
        for (let i = 0; i < 8; i++) { V.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(S.cam); c.push([(V.x + 1) / 2 * S.W, (1 - V.y) / 2 * S.H]); }
        const xs = c.map(p => p[0]), ys = c.map(p => p[1]);
        return { x: Math.min(...xs), y: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
      }, which);
      if (!box) continue;
      const pad = 10, cx = (box.x + box.x2) / 2, cy = (box.y + box.y2) / 2;
      let w = Math.max(box.x2 - box.x, (box.y2 - box.y) * 0.75) + pad * 2; let h = w / 0.75;
      w = Math.min(w, 390); h = Math.min(h, 844);
      const clip = { x: Math.max(0, Math.min(390 - w, cx - w / 2)), y: Math.max(0, Math.min(844 - h, cy - h / 2)), width: w, height: h };
      await shot(name + '-on', q + '&fx=1', clip);
      await shot(name + '-off', q + '&fx=0', clip);
      await pair(name + '-pair', name + '-off', name + '-on', 'ink off', 'ink on', 380, Math.round(380 / 0.75));
    }
    for (const [name, q] of CLOSE.concat(DEBUG, VARIANTS)) if (want(name)) await shot(name, q);
    if (want('close')) {
      await shot('close-rocco-off', CLOSE[0][1] + '&fx=0');
      await pair('close-rocco-pair', 'close-rocco-off', 'close-rocco', 'ink off', 'ink on', 390, 844);
    }
    if (want('skin')) {
      // skinned + morph test limb: the normals pass must follow the bones and the bulge
      const q = 'scene=bat&state=windup&w=0.5&skin=1&nohud=1';
      await shot('skin-on', q + '&fx=1');
      await shot('skin-normals', q + '&fx=1&dbg=normals');
      const s = await shot('skin-close', q + '&cam=test&fx=1');
      await shot('skin-close-normals', q + '&cam=test&fx=1&dbg=normals');
      await pair('skin-pair', 'skin-close', 'skin-close-normals', 'ink on', 'normals pass', 390, 844);
      console.log('skin test:', JSON.stringify({ inkedDraws: s.inkedDraws, active: s.active }));
      if (glb) {
        for (const [clip, ct] of [['stance', 0.4], ['swing_mid', 0.25], ['whiff', 0.7], ['run', 0.2]]) {
          const qq = `scene=bat&state=windup&w=0.5&nohud=1&glb=1&clip=${clip}&ct=${ct}`;
          await shot(`glb-${clip}`, qq + '&cam=test&fx=1');
          await shot(`glb-${clip}-off`, qq + '&cam=test&fx=0');
          await pair(`glb-${clip}-pair`, `glb-${clip}-off`, `glb-${clip}`, 'ink off', 'ink on', 390, 844);
        }
        await shot('glb-normals', 'scene=bat&state=windup&w=0.5&nohud=1&glb=1&clip=swing_mid&ct=0.25&cam=test&fx=1&dbg=normals');
        const face = 'scene=bat&state=windup&w=0.5&nohud=1&glb=1&clip=stance&ct=0.4&cam=test&front=1&zoom=10';
        await shot('glb-face', face + '&fx=1');
        await shot('glb-face-normals', face + '&fx=1&dbg=normals');
        await shot('glb-face-open', face + '&fx=1&face=mouth_open');
        await shot('glb-face-open-normals', face + '&fx=1&dbg=normals&face=mouth_open');
        await pair('glb-face-morph-pair', 'glb-face-normals', 'glb-face-open-normals', 'normals: rest', 'normals: mouth_open morph', 390, 844);
        // the glb where the game will stand him (procedural Rocco hidden), ink off / on
        for (const [nm, st] of [['glb-bat-stance', 'state=windup&w=0.5&clip=stance&ct=0.4'], ['glb-bat-swing', 'state=swing&st=0.035&clip=swing_mid&ct=0.25']]) {
          const g = `scene=bat&${st}&glb=1&glbspot=game`;
          await shot(nm + '-off', g + '&fx=0');
          await shot(nm + '-on', g + '&fx=1');
          await pair(nm + '-pair', nm + '-off', nm + '-on', 'ink off', 'ink on', 390, 844);
        }
      }
    }
  }

  if ((perfOnly || !filt) && !args.includes('--noperf')) {
    // relative cost in SwiftShader (CPU rasteriser: only the ratios mean anything): frame = BB.Render.frame + a GPU sync
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    for (const scene of ['bat', 'field', 'title']) {
      const res = {};
      for (const mode of ['off', 'q1', 'q2', 'q3']) {
        await setup(`scene=${scene}&play=hr&state=windup&w=0.3&fx=${mode === 'off' ? 0 : 1}&q=${mode === 'off' ? 2 : mode[1]}`);
        res[mode] = await page.evaluate(async (sc) => {
          const times = [], v = buildView(Object.assign(qs(location.search), { scene: sc, play: 'hr', state: 'idle' }));
          const pitch = mockPitch(v.pitcher, 7), gl = BB.Render._S.renderer.getContext(), px = new Uint8Array(4);
          for (let i = 0; i < 50; i++) {
            v.time = 3 + i / 60;
            if (sc === 'bat') { const c = (i / 60) % 2.2; v.windup = c < 1.15 ? c / 1.15 : null; v.pitch = c >= 1.15 ? pitch : null; v.pitchT = c >= 1.15 ? c - 1.15 : null; }
            if (sc === 'field') v.playT = Math.min(v.play.dur, i / 60 * 1.6);
            const t0 = performance.now();
            BB.Render.frame(v);
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
            if (i >= 10) times.push(performance.now() - t0);
          }
          times.sort((a, b) => a - b);
          const st = BB.Ink.stats(), rs = BB.Render.stats();
          return { med: +times[20].toFixed(1), calls: rs.calls, tris: rs.triangles, inked: st.inkedDraws, target: st.normalsTarget.join('x'), passCalls: st.calls };
        }, scene);
      }
      const base = res.off.med;
      console.log(`perf ${scene}: off ${base} ms (${res.off.calls} calls)` + ['q1', 'q2', 'q3'].map(k => ` | ${k} ${res[k].med} ms (+${(res[k].med - base).toFixed(1)}, x${(res[k].med / base).toFixed(2)}, ${res[k].calls} calls, ${res[k].inked} inked draws, target ${res[k].target})`).join(''));
    }
    // per-pass split (each pass synced): which part of the ink pass costs what
    for (const scene of ['bat', 'field']) {
      await setup(`scene=${scene}&play=hr&state=windup&w=0.3&fx=1&q=2`);
      const split = await page.evaluate(() => {
        const S = BB.Ink._S, R = BB.Render._S, gl = R.renderer.getContext(), px = new Uint8Array(4), acc = {};
        S.prof = function (k) { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const n = performance.now(); acc[k] = (acc[k] || 0) + (n - S.profT); S.profT = n; };
        for (let i = 0; i < 20; i++) { S.profT = performance.now(); BB.Ink.render(R.renderer, R.scene, R.cam, { time: 3 + i / 60 }); }
        S.prof = null;
        Object.keys(acc).forEach(k => { acc[k] = +(acc[k] / 20).toFixed(2); });
        return acc;
      });
      console.log(`perf split ${scene} (ms, swiftshader):`, JSON.stringify(split));
    }
  }

  if (args.includes('--adapt') || !filt) {
    // adaptive quality: slow frames step the level down, then switch the ink off; a dropped pixel ratio switches it off
    await setup('scene=bat&state=windup&w=0.5&fx=1&q=3');
    const log = await page.evaluate(async () => {
      const R = BB.Render._S, S = BB.Ink._S, out = [], real = S.now;
      R.noAdapt = false; BB.Ink.setAuto(true); BB.Ink.setQuality(3); BB.Ink.setEnabled(true);
      let fake = 1000; S.now = () => (fake += 15);  // each render() sees two clock reads 15 ms apart: a 30 ms frame
      const cam = R.cam, empty = new THREE.Scene();
      for (let i = 0; i < 400 && BB.Ink.active(); i++) {
        BB.Ink.render(R.renderer, empty, cam, { time: i / 60 });
        const s = BB.Ink.stats();
        if (!out.length || out[out.length - 1].q !== s.quality || out[out.length - 1].active !== s.active) out.push({ frame: i, q: s.quality, active: s.active, reason: s.reason, med: s.medianFrameMs });
      }
      const s = BB.Ink.stats();
      out.push({ end: true, q: s.quality, active: s.active, reason: s.reason, med: s.medianFrameMs });
      // fast frames: no change
      BB.Ink.setEnabled(true); BB.Ink.setQuality(2); fake = 1000; S.now = () => (fake += 6);
      for (let i = 0; i < 120; i++) BB.Ink.render(R.renderer, empty, cam, { time: i / 60 });
      out.push({ fast: { q: BB.Ink.stats().quality, active: BB.Ink.active() } });
      S.now = real;
      // a dropped pixel ratio switches it off
      BB.Ink.setEnabled(true); const before = BB.Ink.active(); R.prCap = 1.5; const after = BB.Ink.active(); R.prCap = 2; BB.Ink.setEnabled(true);
      out.push({ prDrop: { before, after } });
      R.noAdapt = true; BB.Ink.setAuto(false);
      return out;
    });
    log.forEach(l => console.log('adapt:', JSON.stringify(l)));
    const ok = log.some(l => l.q === 'medium') && log.some(l => l.q === 'low') && log.some(l => l.end && !l.active && l.reason === 'slow') &&
      log.some(l => l.fast && l.fast.active && l.fast.q === 'medium') && log.some(l => l.prDrop && l.prDrop.before && !l.prDrop.after);
    console.log('adapt test:', ok ? 'OK' : 'FAILED');
    if (!ok) errors.push('adapt test failed');
    // URL flags
    for (const [flag, want] of [['0', false], ['1', true]]) {
      const p2 = await ctx.newPage();
      await p2.goto(harness + '?scene=title&ink=' + flag);
      await p2.waitForFunction(() => window.__done === true, null, { timeout: 90000 });
      const st = await p2.evaluate(() => ({ enabled: BB.Ink.enabled, forced: BB.Ink.stats().forced }));
      const got = flag === '0' ? !st.enabled : st.forced;
      console.log(`url ?ink=${flag}:`, JSON.stringify(st), got ? 'OK' : 'FAILED');
      if (!got) errors.push('url flag ink=' + flag);
      await p2.close();
    }
  }

  if (game) {
    // the real build with the ink forced on: no errors, frames keep coming, BB.Ink reports active
    const gp = await ctx.newPage();
    gp.on('pageerror', e => errors.push('game pageerror: ' + e.message));
    gp.on('console', m => { if (m.type() === 'error') errors.push('game console: ' + m.text()); });
    await gp.goto('file://' + path.join(ROOT, 'dist', 'halftone.html') + '?ink=1');
    await gp.waitForTimeout(1500);
    await gp.evaluate(() => { window.__bb.auto({ sd: 0.03, eye: 0.7, power: 0.3 }); BB.Game.start('tour', BB.Content.TOUR[0].games[0]); });
    for (let i = 0; i < 4; i++) { await gp.waitForTimeout(1600); await gp.screenshot({ path: path.join(OUT, `game-${i}.png`) }); }
    console.log('game:', JSON.stringify(await gp.evaluate(() => BB.Ink.stats())));
    await gp.close();
  }

  await browser.close();
  const uniq = [...new Set(errors)].filter(e => !/GPU stall|GL Driver Message|swiftshader|Automatic fallback|GroupMarkerNotSet|ERR_FILE_NOT_FOUND/i.test(e));
  if (uniq.length) { console.log('console errors/warnings:'); uniq.forEach(e => console.log('  ' + e)); } else console.log('console: clean');
  console.log('shots in', OUT);
})().catch(e => { console.error(e); process.exit(1); });
