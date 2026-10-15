#!/usr/bin/env node
// Render QA: screenshots every scene/state of BB.Render + BB.CardArt through tools/render-harness.html and runs a
// quick frame-time test. Output: qa/render/*.png (gitignored).
//   node tools/render-shots.js            all shots + perf
//   node tools/render-shots.js bat        only shots whose name contains "bat"
//   node tools/render-shots.js --perf     perf only
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const path = require('path'), fs = require('fs'), { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'qa', 'render');
fs.mkdirSync(path.join(OUT, 'fonts'), { recursive: true });

// local font copies so the harness renders with the real faces (fetched once; harmless if offline)
const FONTS = {
  'Bungee.ttf': 'https://fonts.gstatic.com/s/bungee/v17/N0bU2SZBIuF2PU_ECg.ttf',
  'SpaceMono-Regular.ttf': 'https://fonts.gstatic.com/s/spacemono/v17/i7dPIFZifjKcF5UAWdDRUEY.ttf',
  'SpaceMono-Bold.ttf': 'https://fonts.gstatic.com/s/spacemono/v17/i7dMIFZifjKcF5UAWdDRaPpZYFI.ttf',
};
for (const [f, url] of Object.entries(FONTS)) {
  const p = path.join(OUT, 'fonts', f);
  if (!fs.existsSync(p)) { try { execSync(`curl -sS -m 20 -o "${p}" "${url}"`); } catch (e) { console.warn('font fetch failed', f); } }
}

const SHOTS = [
  ['title', 'scene=title&time=4.1'],
  ['title-park3', 'scene=title&park=3&time=1.5'],
  ['bat-idle', 'scene=bat&state=idle'],
  ['bat-windup-30', 'scene=bat&state=windup&w=0.3'],
  ['bat-windup-55', 'scene=bat&state=windup&w=0.55'],
  ['bat-windup-85', 'scene=bat&state=windup&w=0.85'],
  ['bat-release', 'scene=bat&state=mid&f=0.04'],
  ['bat-mid', 'scene=bat&state=mid&f=0.5&assist=0'],
  ['bat-assist', 'scene=bat&state=assist&f=0.8'],
  ['bat-curve', 'scene=bat&state=assist&f=0.92&ptype=CB'],
  ['bat-loading', 'scene=bat&state=loading&l=1'],
  ['bat-swing-launch', 'scene=bat&state=swing&st=0.035'],
  ['bat-contact', 'scene=bat&state=contact&st=0.09'],
  ['bat-contact-follow', 'scene=bat&state=contact&st=0.22&shake=0.5'],
  ['bat-whiff', 'scene=bat&state=whiff&st=0.42'],
  ['bat-mitt', 'scene=bat&state=mitt&dt=0.06'],
  ['bat-hitstop', 'scene=bat&state=contact&st=0.075&hitstop=1'],
  ['bat-sidearm', 'scene=bat&state=windup&w=0.97&windstyle=sidearm'],
  ['bat-submarine', 'scene=bat&state=windup&w=0.97&windstyle=submarine'],
  ['bat-highkick', 'scene=bat&state=windup&w=0.5&windstyle=highkick'],
  ['bat-lefty-follow', 'scene=bat&state=mid&f=0.35&hand=L&pitcher=2'],
  ['field-hr-early', 'scene=field&play=hr&f=0.3'],
  ['field-hr', 'scene=field&play=hr&f=0.62'],
  ['field-hr-late', 'scene=field&play=hr&f=0.85&stamp=DINGER!&kind=huge&stt=0.6&sub=412%20ft'],
  ['field-gapper', 'scene=field&play=gap&f=0.55'],
  ['field-gapper-end', 'scene=field&play=gap&f=0.98'],
  ['field-groundout', 'scene=field&play=ground&f=0.5'],
  ['field-wall', 'scene=field&play=wall&f=0.7'],
  ['stamp-dinger', 'scene=bat&state=contact&st=0.3&stamp=DINGER!&kind=huge&stt=0.35&sub=LONG%20GONE%20%C2%B7%20431%20FT'],
  ['stamp-whiff', 'scene=bat&state=whiff&st=0.5&stamp=STEE-RIKE!&kind=bad&stt=0.4&sub=0-2%20count'],
  ['stamp-ball', 'scene=bat&state=mitt&dt=0.3&stamp=BALL&kind=neutral&stt=0.3&sub=2-1'],
  ['stamp-rope', 'scene=field&play=gap&f=0.4&stamp=FROZEN%20ROPE&kind=good&stt=0.5&sub=RBI%20double'],
  ['stamp-thunk', 'scene=bat&state=idle&stamp=WHIFF&kind=bad&stt=0.05'],
  ['fire-bat', 'scene=bat&state=windup&w=0.4&fire=1'],
  ['fire-field', 'scene=field&play=gap&f=0.5&fire=1'],
];
['classic', 'dusk', 'lawn', 'grape', 'harbor', 'ledger'].forEach((ink, i) => SHOTS.push(['ink-' + ink, `scene=bat&state=assist&f=0.75&ink=${ink}&park=${i}`]));
for (let i = 0; i < 6; i++) SHOTS.push(['park-' + i, `scene=bat&state=windup&w=0.2&park=${i}&pitcher=${i * 4}`]);
for (let i = 0; i < 6; i++) SHOTS.push(['fieldpark-' + i, `scene=field&play=gap&f=0.3&park=${i}`]);

(async () => {
  const args = process.argv.slice(2), perfOnly = args.includes('--perf'), filt = args.find(a => !a.startsWith('--'));
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  const url = 'file://' + path.join(ROOT, 'tools', 'render-harness.html');
  const go = async (q) => {
    await page.goto(url + '?' + q);
    await page.waitForFunction(() => window.__done === true, null, { timeout: 15000 });
  };
  if (!perfOnly) {
    await go('scene=title');
    for (const [name, q] of SHOTS) {
      if (filt && !name.includes(filt)) continue;
      await page.evaluate((qq) => { window.__done = false; return window.setup('?' + qq); }, q);
      await page.screenshot({ path: path.join(OUT, name + '.png') });
    }
    if (!filt || 'cards'.includes(filt)) {
      await go('scene=cards');
      await page.screenshot({ path: path.join(OUT, 'cards-grid.png'), fullPage: true });
      console.log('card timing', JSON.stringify(await page.evaluate(() => window.__cardStats)));
      await go('scene=cards&big=1');
      await page.screenshot({ path: path.join(OUT, 'cards-big.png'), fullPage: true });
    }
  }
  if (perfOnly || !filt) {
    const cdp = await ctx.newCDPSession(page);
    for (const rate of [1, 4]) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      for (const scene of ['bat', 'field', 'title']) {
        await go('scene=' + scene + '&play=hr');
        const r = await page.evaluate(async (sc) => {
          // drive frames through a full pitch / play cycle, measuring BB.Render.frame cost only
          const q = new URLSearchParams(location.search), times = [];
          const v = buildView({ scene: sc, play: 'hr', state: 'idle' });
          const pitch = mockPitch(v.pitcher, 7);
          BB.Render.frame(v); // warm caches
          for (let i = 0; i < 180; i++) {
            v.time = i / 60;
            if (sc === 'bat') {
              const c = (i / 60) % 3; v.windup = c < 1.15 ? c / 1.15 : null; v.pitch = c >= 1.15 ? pitch : null; v.pitchT = c >= 1.15 ? c - 1.15 : null;
              v.swing = v.pitchT != null && v.pitchT > pitch.T - 0.07 ? { t: v.pitchT - pitch.T + 0.07, result: { contact: true, quality: 1, ev: 104, la: 25, spray: -10 } } : null;
              v.stamp = i > 120 ? { text: 'DINGER!', kind: 'huge', t: (i - 120) / 60 } : null;
            }
            if (sc === 'field') v.playT = Math.min(v.play.dur, i / 60 * 1.3);
            const t0 = performance.now();
            BB.Render.frame(v);
            // force the GPU work to finish so the number reflects real cost
            BB.Render._S.ctx.getImageData(0, 0, 1, 1);
            times.push(performance.now() - t0);
          }
          times.sort((a, b) => a - b);
          return { median: +times[90].toFixed(2), p95: +times[171].toFixed(2), max: +times[179].toFixed(2), build: +BB.Render.stats().lastBuildMs.toFixed(1) };
        }, scene);
        console.log(`perf cpu x${rate} ${scene}: frame median ${r.median} ms, p95 ${r.p95} ms, max ${r.max} ms (last cache build ${r.build} ms)`);
      }
    }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
  await browser.close();
  const uniq = [...new Set(errors)];
  if (uniq.length) { console.log('console errors/warnings:'); uniq.forEach(e => console.log('  ' + e)); } else console.log('console: clean');
  console.log('shots in', OUT);
})().catch(e => { console.error(e); process.exit(1); });
