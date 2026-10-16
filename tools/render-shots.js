#!/usr/bin/env node
// Render QA: screenshots every scene/state of BB.Render through tools/render-harness.html (iPhone 14: 390x844 @3x,
// WebGL via SwiftShader) and runs a frame-time / draw-call check. Output: qa/render/*.png (gitignored).
//   node tools/render-shots.js            all shots + perf
//   node tools/render-shots.js bat        only shots whose name contains "bat"
//   node tools/render-shots.js --perf     perf only
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const path = require('path'), fs = require('fs'), { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'qa', 'render');
fs.mkdirSync(path.join(OUT, 'fonts'), { recursive: true });
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--allow-file-access-from-files'];

// local font copies so the harness renders with the real faces (fetched once; harmless if offline)
const FONTS = {
  'LuckiestGuy.woff2': 'https://fonts.gstatic.com/s/luckiestguy/v25/_gP_1RrxsjcxVyin9l9n_j2hTd52.woff2',
  'Fredoka.woff2': 'https://fonts.gstatic.com/s/fredoka/v17/X7n64b87HvSqjb_WIi2yDCRwoQ_k7367_DWu89U.woff2',
};
for (const [f, url] of Object.entries(FONTS)) {
  const p = path.join(OUT, 'fonts', f);
  if (!fs.existsSync(p)) { try { execSync(`curl -sS -m 20 -o "${p}" "${url}"`); } catch (e) { console.warn('font fetch failed', f); } }
}

const SHOTS = [
  ['title', 'scene=title&time=4.1'],
  ['title-swing', 'scene=title&time=5.3&park=4'],
  ['title-park2', 'scene=title&park=2&time=1.5'],
  ['bat-idle', 'scene=bat&state=idle'],
  ['bat-windup-20', 'scene=bat&state=windup&w=0.2'],
  ['bat-windup-50', 'scene=bat&state=windup&w=0.5'],
  ['bat-windup-80', 'scene=bat&state=windup&w=0.8'],
  ['bat-release', 'scene=bat&state=mid&f=0.03'],
  ['bat-mid', 'scene=bat&state=mid&f=0.4&assist=0'],
  ['bat-assist', 'scene=bat&state=assist&f=0.8'],
  ['bat-curve', 'scene=bat&state=assist&f=0.93&ptype=CB'],
  ['bat-loading', 'scene=bat&state=loading&l=1&time=3.31'],
  ['bat-swing-launch', 'scene=bat&state=swing&st=0.035'],
  ['bat-contact', 'scene=bat&state=contact&st=0.075&hitstop=1'],
  ['bat-contact-pow', 'scene=bat&state=contact&st=0.12&shake=0.6'],
  ['bat-contact-iris', 'scene=bat&state=contact&st=0.23'],
  ['bat-whiff-swing', 'scene=bat&state=whiff&st=0.2'],
  ['bat-whiff-spin', 'scene=bat&state=whiff&st=0.42'],
  ['bat-whiff-dizzy', 'scene=bat&state=whiff&st=0.75&stamp=WHIFF&kind=bad&stt=0.3&sub=1-2%20count'],
  ['bat-mitt', 'scene=bat&state=mitt&dt=0.08&strike=0'],
  ['bat-called-strike', 'scene=bat&state=called&dt=0.45&strike=1&stamp=STRIKE!&kind=neutral&stt=0.3&sub=1-2%20count'],
  ['bat-classic', 'scene=bat&state=windup&w=0.97&windstyle=classic'],
  ['bat-sidearm', 'scene=bat&state=windup&w=0.9&windstyle=sidearm'],
  ['bat-submarine', 'scene=bat&state=windup&w=0.9&windstyle=submarine'],
  ['bat-highkick', 'scene=bat&state=windup&w=0.55&windstyle=highkick'],
  ['bat-follow', 'scene=bat&state=mid&f=0.35'],
  ['bat-lefty', 'scene=bat&state=windup&w=0.8&hand=L&pitcher=1'],
  ['bat-boss', 'scene=bat&state=windup&w=0.5&pitcher=23&park=5'],
  ['field-hr-early', 'scene=field&play=hr&f=0.15'],
  ['field-hr', 'scene=field&play=hr&f=0.55'],
  ['field-hr-late', 'scene=field&play=hr&f=0.8&stamp=GONE!&kind=huge&stt=0.6&sub=412%20FT%20%C2%B7%202%20RBI'],
  ['field-gapper', 'scene=field&play=gap&f=0.5'],
  ['field-gapper-end', 'scene=field&play=gap&f=0.98'],
  ['field-hr-trot', 'scene=field&play=hr&f=1&extra=0.9'],
  ['field-gapper-runners', 'scene=field&play=gap&f=1&extra=0.7'],
  ['field-groundout', 'scene=field&play=ground&f=0.45'],
  ['field-flyout', 'scene=field&play=fly&f=0.7'],
  ['field-wall', 'scene=field&play=wall&f=0.6'],
  ['field-foul', 'scene=field&play=foul&f=0.5'],
  ['field-iris', 'scene=field&play=hr&f=0.06&iris=bat&time=3.2'],
  ['stamp-dinger', 'scene=bat&state=contact&st=0.3&stamp=DINGER!&kind=huge&stt=0.35&sub=LONG%20GONE%20%C2%B7%20431%20FT'],
  ['stamp-out', 'scene=field&play=fly&f=0.9&stamp=CAN%20OF%20CORN&kind=bad&stt=0.4&sub=2%20outs'],
  ['stamp-k', 'scene=bat&state=whiff&st=0.9&stamp=STRUCK%20OUT&kind=bad&stt=0.5'],
  ['stamp-good', 'scene=field&play=gap&f=0.6&stamp=FROZEN%20ROPE&kind=good&stt=0.5&sub=RBI%20double'],
  ['stamp-hint', 'scene=bat&state=windup&w=0.3&stamp=TAP%20TO%20SWING&kind=neutral&stt=0.6&sub=when%20the%20ball%20reaches%20the%20plate'],
  ['stamp-pop', 'scene=bat&state=idle&stamp=STEE-RIKE!&kind=bad&stt=0.08'],
  ['fire-bat', 'scene=bat&state=windup&w=0.4&fire=1'],
  ['fire-field', 'scene=field&play=gap&f=0.5&fire=1'],
  ['hud-derby', 'scene=bat&state=windup&w=0.1&outs10=1'],
];
['classic', 'dusk', 'lawn', 'grape', 'harbor', 'ledger'].forEach((ink, i) => SHOTS.push(['ink-' + ink, `scene=bat&state=assist&f=0.75&ink=${ink}&park=${i}`]));
for (let i = 0; i < 6; i++) SHOTS.push(['park-' + i, `scene=bat&state=windup&w=0.25&park=${i}&pitcher=${i * 4 + 1}`]);
for (let i = 0; i < 6; i++) SHOTS.push(['fieldpark-' + i, `scene=field&play=hr&f=0.45&park=${i}`]);
for (let i = 0; i < 6; i++) SHOTS.push(['titlepark-' + i, `scene=title&park=${i}&time=2`]);

const ARG = k => { const a = process.argv.find(x => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
// --glb=<file>  use another hero model (e.g. the integration proxy) instead of assets/rocco.glb
// --old         the game before the Rocco pilot (?rocco=old: procedural Rocco, old staging)
// --size=WxH    viewport (default 390x844)
const EXTRA = (ARG('glb') ? '&glb=' + encodeURIComponent(path.resolve(ARG('glb'))) : '') + (process.argv.includes('--old') ? '&rocco=old' : '') + (ARG('q') ? '&' + ARG('q') : '');
const SIZE = (ARG('size') || '390x844').split('x').map(Number);
// --pilot: matched before/after pairs for the Rocco pilot -> qa/pilot/<name>-old.png, -new.png and <name>.png (side by side)
//   old = ?rocco=old&ink=0 (procedural Rocco, old staging, no ink pass); new = the model, new staging, ink pass on
const PILOT = [
  ['01-bat-idle', 'scene=bat&state=idle&time=3.3'],
  ['02-bat-windup', 'scene=bat&state=windup&w=0.7&time=3.5'],
  ['03-bat-stride', 'scene=bat&state=stride&pt=0.24&pz=2.5&px=0'],
  ['04-bat-power-load', 'scene=bat&state=loading&l=1&time=3.31'],
  ['05-bat-swing-launch', 'scene=bat&state=swing&st=0.035&pz=2.5&px=0'],
  ['06-bat-contact-high', 'scene=bat&state=contact&st=0.07&pz=3.25&hitstop=1'],
  ['07-bat-contact-mid', 'scene=bat&state=contact&st=0.07&pz=2.5&px=0&hitstop=1'],
  ['08-bat-contact-low', 'scene=bat&state=contact&st=0.07&pz=1.75&hitstop=1'],
  ['09-bat-follow-through', 'scene=bat&state=contact&st=0.2&pz=2.5&px=0'],
  ['10-bat-whiff', 'scene=bat&state=whiff&st=0.22&pz=2.5'],
  ['11-bat-whiff-spin', 'scene=bat&state=whiff&st=0.55&pz=2.5'],
  ['12-bat-dizzy', 'scene=bat&state=whiff&st=1.6&pz=2.5&stamp=WHIFF&kind=bad&stt=0.9&sub=1-2%20count'],
  ['13-bat-take', 'scene=bat&state=mitt&dt=0.4&strike=0'],
  ['14-bat-called-k', 'scene=bat&state=called&dt=1.0&strike=1&stamp=STRIKE%20THREE&kind=bad&stt=0.8'],
  ['15-field-hr-flip', 'scene=field&play=hr&pt=0.45'],
  ['16-field-run', 'scene=field&play=gap&f=1&extra=0.35'],
  ['17-field-hr-trot', 'scene=field&play=hr&f=1&extra=0.9'],
  ['18-title', 'scene=title&time=4.1'],
  ['19-title-swing', 'scene=title&time=4.78'],
  ['20-fire', 'scene=bat&state=windup&w=0.4&fire=1'],
];
async function pilot(browser, filt) {
  const OUTP = path.join(ROOT, 'qa', 'pilot');
  fs.mkdirSync(OUTP, { recursive: true });
  const sizes = (ARG('sizes') || (SIZE[0] + 'x' + SIZE[1])).split(',').map(x => x.split('x').map(Number));
  for (const [W, H] of sizes) {
    const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    const suffix = sizes.length > 1 || W !== 390 ? '@' + W + 'x' + H : '';
    for (const [tag, flags] of [['old', '&rocco=old&ink=0'], ['new', '']]) {
      await page.goto('file://' + path.join(ROOT, 'tools', 'render-harness.html') + '?scene=title' + flags + EXTRA);
      await page.waitForFunction(() => window.__done === true, null, { timeout: 60000 });
      if (tag === 'new') console.log('model:', JSON.stringify(await page.evaluate(() => window.__rocco && { status: window.__rocco.status, warnings: window.__rocco.warnings, error: window.__rocco.error })));
      for (const [name, q] of PILOT) {
        if (filt && !name.includes(filt)) continue;
        await page.evaluate((qq) => { window.__done = false; return window.setup('?' + qq); }, q);
        await page.screenshot({ path: path.join(OUTP, name + suffix + '-' + tag + '.png') });
      }
    }
    // side by side: before | after
    const pair = await ctx.newPage();
    for (const [name] of PILOT) {
      if (filt && !name.includes(filt)) continue;
      const a = 'file://' + path.join(OUTP, name + suffix + '-old.png'), b = 'file://' + path.join(OUTP, name + suffix + '-new.png');
      await pair.setViewportSize({ width: W * 2 + 12, height: H + 26 });
      await pair.setContent(`<body style="margin:0;background:#1B1420;font:600 14px sans-serif;color:#FFF4DC"><div style="display:flex;gap:12px">
        <div><div style="height:26px;line-height:26px;padding-left:6px">BEFORE (procedural)</div><img src="${a}" style="width:${W}px;height:${H}px;display:block"></div>
        <div><div style="height:26px;line-height:26px;padding-left:6px">AFTER (model + ink + staging)</div><img src="${b}" style="width:${W}px;height:${H}px;display:block"></div></div></body>`, { waitUntil: 'load' });
      await pair.screenshot({ path: path.join(OUTP, name + suffix + '.png') });
    }
    await ctx.close();
    const uniq = [...new Set(errors)].filter(e => !/GPU stall|GL Driver Message|swiftshader|Automatic fallback|ERR_FILE_NOT_FOUND/i.test(e));
    console.log(`pilot ${W}x${H}: ` + (uniq.length ? 'console:\n  ' + uniq.join('\n  ') : 'console clean'));
  }
  console.log('pilot shots in', OUTP);
}
(async () => {
  const args = process.argv.slice(2), perfOnly = args.includes('--perf'), filt = args.find(a => !a.startsWith('--'));
  if (args.includes('--pilot')) { const br = await pw.chromium.launch({ args: GL_ARGS }); await pilot(br, filt); await br.close(); return; }
  const browser = await pw.chromium.launch({ args: GL_ARGS });
  const ctx = await browser.newContext({ viewport: { width: SIZE[0], height: SIZE[1] }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  const url = 'file://' + path.join(ROOT, 'tools', 'render-harness.html');
  const go = async (q) => {
    await page.goto(url + '?' + q + EXTRA);
    await page.waitForFunction(() => window.__done === true, null, { timeout: 60000 });
  };
  if (!perfOnly) {
    await go('scene=title');
    for (const [name, q] of SHOTS) {
      if (filt && !name.includes(filt)) continue;
      await page.evaluate((qq) => { window.__done = false; return window.setup('?' + qq); }, q);
      await page.screenshot({ path: path.join(OUT, name + '.png') });
    }
  }
  if (perfOnly || !filt) {
    const cdp = await ctx.newCDPSession(page);
    for (const rate of [1, 4]) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      for (const scene of ['bat', 'field', 'title']) {
        await go('scene=' + scene + '&play=hr');
        const r = await page.evaluate(async (sc) => {
          // drive frames through a full pitch / play cycle, measuring BB.Render.frame CPU cost (+ a GPU sync)
          const times = [], calls = [], tris = [];
          const v = buildView({ scene: sc, play: 'hr', state: 'idle' });
          const pitch = mockPitch(v.pitcher, 7);
          BB.Render.frame(v);
          const gl = BB.Render._S.renderer.getContext(), px = new Uint8Array(4);
          for (let i = 0; i < 120; i++) {
            v.time = 3 + i / 60;
            if (sc === 'bat') {
              const c = (i / 60) % 2.2; v.windup = c < 1.15 ? c / 1.15 : null; v.pitch = c >= 1.15 ? pitch : null; v.pitchT = c >= 1.15 ? c - 1.15 : null;
              v.swing = v.pitchT != null && v.pitchT > pitch.T - 0.07 ? { t: v.pitchT - pitch.T + 0.07, result: { contact: false, quality: 1, ev: 104, la: 25, spray: -10, timingErr: 0 } } : null;
              v.stamp = i > 90 ? { text: 'DINGER!', kind: 'huge', t: (i - 90) / 60 } : null;
            }
            if (sc === 'field') v.playT = Math.min(v.play.dur, i / 60 * 1.6);
            const t0 = performance.now();
            BB.Render.frame(v);
            gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
            times.push(performance.now() - t0);
            const s = BB.Render.stats(); calls.push(s.calls); tris.push(s.triangles);
          }
          times.sort((a, b) => a - b);
          const st = BB.Render.stats();
          return { median: +times[60].toFixed(2), p95: +times[114].toFixed(2), calls: Math.max(...calls), tris: Math.max(...tris), build: +st.lastBuildMs.toFixed(1), textures: st.textures, geometries: st.geometries };
        }, scene);
        console.log(`perf cpu x${rate} ${scene}: frame median ${r.median} ms, p95 ${r.p95} ms (swiftshader incl. GPU), max draw calls ${r.calls}, max triangles ${r.tris}, park build ${r.build} ms, textures ${r.textures}, geometries ${r.geometries}`);
      }
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
  await browser.close();
  const uniq = [...new Set(errors)].filter(e => !/GPU stall|GL Driver Message|swiftshader|Automatic fallback/i.test(e));
  if (uniq.length) { console.log('console errors/warnings:'); uniq.forEach(e => console.log('  ' + e)); } else console.log('console: clean');
  console.log('shots in', OUT);
})().catch(e => { console.error(e); process.exit(1); });
