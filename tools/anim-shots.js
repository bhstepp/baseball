#!/usr/bin/env node
// Animation-library QA sheets: plays the shared clips (assets/src/anim_<lib>.glb + assets/anim_<lib>.json) on the
// reference body (assets/src/ref_body.glb) through tools/anim-viewer.html (three.js toon + outlines, SwiftShader) and
// writes contact sheets to qa/anim/*.png (gitignored), plus qa/anim/<lib>-check.json (numeric checks in three.js:
// sockets at the markers, measured exactly as the runtime will see them).
//   node tools/anim-shots.js pitcher              every pitcher sheet
//   node tools/anim-shots.js pitcher windup bat   only sheets whose name contains one of the words
//   node tools/anim-shots.js pitcher --glb other.glb --body other_body.glb --out dir
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const lib = args[0] && !args[0].startsWith('--') ? args.shift() : 'pitcher';
let glb = path.join(ROOT, 'assets', 'src', 'anim_' + lib + '.glb'), side = path.join(ROOT, 'assets', 'anim_' + lib + '.json');
let body = path.join(ROOT, 'assets', 'src', 'ref_body.glb'), out = path.join(ROOT, 'qa', 'anim');
const words = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--glb') glb = path.resolve(args[++i]);
  else if (args[i] === '--side') side = path.resolve(args[++i]);
  else if (args[i] === '--body') body = path.resolve(args[++i]);
  else if (args[i] === '--out') out = path.resolve(args[++i]);
  else words.push(args[i]);
}
fs.mkdirSync(out, { recursive: true });
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--allow-file-access-from-files'];
const PI = Math.PI;
const SC = JSON.parse(fs.readFileSync(side, 'utf8'));
const clips = SC.clips;
const range = (a, b, n) => Array.from({ length: n }, (_, i) => +(a + (b - a) * i / (n - 1)).toFixed(3));

// game placements (game coords: feet, Z up, origin = home plate, +y to the mound)
const MOUND = { x: 0, y: 60.5, z: 0.83 };
const CATCHER = { x: 0, y: -2.7, yaw: PI };
const UMP = { x: 0.55, y: -5.6, yaw: PI };
function placeFor(clip) {
  const r = clip.split('_')[0];
  return r === 'p' ? MOUND : r === 'c' ? CATCHER : r === 'u' ? UMP : { x: 0, y: 0 };
}

function sheets() {
  const S = [];
  const names = Object.keys(clips);
  for (const c of names) {
    const L = clips[c].length, m = clips[c].markers || {};
    let ts = range(0, L, L > 1.6 ? 10 : 8);
    const mk = Object.values(m).filter((x) => typeof x === 'number');
    if (mk.length) ts = [...new Set(ts.concat(mk).map((x) => +x.toFixed(3)))].sort((a, b) => a - b);
    const pl = placeFor(c), yawDeg = (pl.yaw || 0) * 180 / PI;
    const tgt = [pl.x, pl.y, (pl.z || 0) + 2.4];
    const cell = (t, az, el, dist, lab) => ({ actors: [{ clip: c, t, place: pl }], view: { az: az + yawDeg, el, dist, target: tgt, fov: 26 }, label: `${lab || c} ${t.toFixed(3)}` });
    const cols = Math.min(8, ts.length);
    S.push(['clip-' + c, { cols, cellW: 250, cellH: 330, field: true, cells: ts.map((t) => cell(t, 0, 6, 15, '')) }]);
    S.push(['side-' + c, { cols, cellW: 250, cellH: 330, field: true, cells: ts.map((t) => cell(t, 90, 6, 15, 'side')) }]);
  }
  // pitcher: the game's view (bat camera behind home plate), full frame and magnified on the mound
  const pn = names.filter((c) => c.startsWith('p_'));
  if (pn.length) {
    for (const c of pn) {
      const L = clips[c].length, m = clips[c].markers || {};
      let ts = range(0, L, 10);
      if (m.release != null) ts = [0, 0.2, 0.4, 0.55, 0.7, 0.85, 0.95, 1.05, 1.15, 1.3, 1.5, 1.75, L];
      ts = [...new Set(ts.map((x) => +x.toFixed(3)))].filter((x) => x <= L + 1e-6);
      S.push(['bat-' + c, { cols: Math.min(7, ts.length), cellW: 260, cellH: 300, field: true, cells: ts.map((t) => ({ actors: [{ clip: c, t, place: MOUND }], view: { bat: true, W: 390, H: 844, zoom: 6, center: [-0.4, 60.0, 3.0] }, label: `${c.replace('p_windup_', '')} ${t.toFixed(2)}` })) }]);
    }
    const wind = pn.filter((c) => /windup/.test(c));
    if (wind.length) {
      // the release frame in the game camera, full phone frame, ball at grip.R
      S.push(['bat-release', { cols: wind.length, cellW: 390, cellH: 844, field: true, zone: true, cells: wind.map((c) => ({ actors: [{ clip: c, t: 1.15, place: MOUND }], view: { bat: true, W: 390, H: 844 }, label: c + ' @1.15' })) }]);
      // trails of the ball hand (grip.R) and the head, front and side
      const tr = (c, az, lab) => ({ actors: [{ clip: c, t: 1.15, place: MOUND, trail: { bones: ['grip.R', 'head', 'toe.L'], from: 0, to: 1.6, n: 64 } }], view: { az, el: 6, dist: 20, target: [0, 58.5, 3.0], fov: 28 }, label: `${c.replace('p_windup_', '')} ${lab}` });
      S.push(['trails', { cols: 3, cellW: 380, cellH: 420, field: true, cells: [].concat(...wind.map((c) => [tr(c, 0, 'front'), tr(c, 90, 'side (his left)'), tr(c, -90, 'side (his right)')])) }]);
    }
  }
  return S;
}

(async () => {
  const browser = await pw.chromium.launch({ args: GL_ARGS });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('file://' + path.join(ROOT, 'tools', 'anim-viewer.html') + '?harness=1');
  const b64 = (f) => fs.readFileSync(f).toString('base64');
  const names = await page.evaluate(async ([bb, lb, sj, ln]) => {
    const dec = (b) => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };
    return await window.viewer.load(dec(bb), { [ln]: [dec(lb), sj] });
  }, [b64(body), b64(glb), SC, lib]);
  console.log('clips', names.join(', '));
  // numeric checks in three.js (what the runtime will see): sockets at markers, relative to the root
  const checks = {};
  for (const c of names) {
    const m = (clips[c] && clips[c].markers) || {};
    const ts = Object.entries(m).filter(([, v]) => typeof v === 'number');
    if (!ts.length) continue;
    const bones = ['grip.R', 'grip.L', 'mitt', 'hand.R', 'hand.L', 'hips', 'toe.L', 'toe.R'];
    const smp = await page.evaluate(([c, b, t]) => window.viewer.sample(c, b, t, {}), [c, bones, ts.map(([, v]) => v)]);
    checks[c] = {};
    ts.forEach(([k, v], i) => { const o = {}; for (const b of bones) if (smp[i][b]) o[b] = smp[i][b].map((x) => +x.toFixed(4)); checks[c][k] = { t: v, world: o }; });
  }
  fs.writeFileSync(path.join(out, lib + '-check.json'), JSON.stringify(checks, null, 1));
  for (const [name, spec] of sheets()) {
    if (words.length && !words.some((w) => name.includes(w))) continue;
    await page.evaluate((s) => window.viewer.sheet(s), spec);
    const el = await page.$('#wrap');
    await el.screenshot({ path: path.join(out, lib + '-' + name + '.png') });
    console.log('wrote', path.join(out, lib + '-' + name + '.png'));
  }
  await browser.close();
})();
