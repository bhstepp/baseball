#!/usr/bin/env node
// Rocco QA screenshots: renders assets/rocco.glb through tools/rocco-viewer.html (three.js toon + outline preview,
// WebGL via SwiftShader) into model sheets. Output: qa/rocco/*.png (gitignored) + qa/rocco/info.json.
//   node tools/rocco-shots.js                 every sheet
//   node tools/rocco-shots.js turn face       only sheets whose name contains one of the words
//   node tools/rocco-shots.js --glb other.glb
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
let glb = path.join(ROOT, 'assets', 'rocco.glb'), out = path.join(ROOT, 'qa', 'rocco');
const words = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--glb') glb = path.resolve(args[++i]);
  else if (args[i] === '--out') out = path.resolve(args[++i]);
  else words.push(args[i]);
}
fs.mkdirSync(out, { recursive: true });
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--allow-file-access-from-files'];
const PI = Math.PI;
const GAME = { x: -2.4, y: 0, yaw: PI / 2 };           // Rocco's spot in game coords (see the report / rocco.py header)
const HEAD = [0, 0, 4.05];

const CLIPS = {
  stance: [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1], stride: [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35],
  power_load: [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35], coil_hold: [0, 0.0625, 0.125, 0.1875, 0.25, 0.3125, 0.375, 0.4375],
  swing_high: [0, 0.07, 0.14, 0.2, 0.25, 0.32, 0.42, 0.56, 0.74, 1.0], swing_mid: [0, 0.07, 0.14, 0.2, 0.25, 0.32, 0.42, 0.56, 0.74, 1.0],
  swing_low: [0, 0.07, 0.14, 0.2, 0.25, 0.32, 0.42, 0.56, 0.74, 1.0], whiff: [0, 0.15, 0.25, 0.35, 0.5, 0.65, 0.78, 0.9, 1.05, 1.4],
  dizzy: [0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4], watch: [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.05],
  bat_flip: [0, 0.18, 0.3, 0.45, 0.6, 0.75, 0.9, 1.05, 1.2, 1.3], run: [0, 0.0625, 0.125, 0.1875, 0.25, 0.3125, 0.375, 0.4375],
  trot: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], cheer: [0, 0.1, 0.2, 0.3, 0.45, 0.6, 0.78, 1.0, 1.2],
  take: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8], strike_react: [0, 0.15, 0.25, 0.36, 0.5, 0.7, 0.9, 1.05, 1.2, 1.4],
};
const SHAPES = ['blink', 'smile', 'grin', 'frown', 'mouth_open', 'brows_up', 'brows_angry', 'brows_sad', 'squint', 'cheeks_puff'];

function sheets() {
  const S = [];
  const turn = (name, clip, t) => S.push([name, { cols: 6, cellW: 300, cellH: 460, cells: ['front', 'q34', 'left', 'back', 'q34back', 'right'].map((v) => ({ clip, t, view: { name: v, dist: 19, target: [0, 0, 2.5] }, label: v })) }]);
  turn('turnaround', null, 0);
  turn('turnaround-stance', 'stance', 0);
  S.push(['face', { cols: 6, cellW: 260, cellH: 260, cells: [{ label: 'neutral' }].concat(SHAPES.map((k) => ({ sk: { [k]: 1 }, label: k }))).concat([{ sk: { smile: 0.6, squint: 0.35, brows_angry: 0.3 }, label: 'cocky' }]).map((c) => Object.assign(c, { view: { name: 'front', dist: 5.2, target: HEAD, fov: 24 } })) }]);
  S.push(['face-34', { cols: 6, cellW: 260, cellH: 260, cells: [{ label: 'neutral' }].concat(SHAPES.map((k) => ({ sk: { [k]: 1 }, label: k }))).concat([{ sk: { grin: 1, brows_angry: 1, squint: 0.5 }, label: 'grit' }]).map((c) => Object.assign(c, { view: { name: 'q34', az: 35, el: 6, dist: 5.2, target: HEAD, fov: 24 } })) }]);
  for (const clip in CLIPS) {
    const ts = CLIPS[clip], cols = ts.length;
    const cells = ts.map((t) => ({ clip, t, label: `${clip} ${t.toFixed(3)}`, view: { name: 'q34', az: 30, el: 8, dist: 20, target: [0, 0, 2.6] } }));
    const cells2 = ts.map((t) => ({ clip, t, label: 'game ' + t.toFixed(3), view: { game: true }, place: GAME, plate: true }));
    S.push(['clip-' + clip, { cols, cellW: 230, cellH: 330, cells: cells.concat(cells2) }]);
  }
  // the bat camera: what the player actually sees (iPhone 390x844 portrait)
  const contact = (clip, z) => ({ clip, t: 0.25, view: { game: true }, place: GAME, plate: true, ball: [0, 0, z], label: clip + ' @0.25' });
  S.push(['game', { cols: 5, cellW: 390, cellH: 844, cells: [
    { clip: 'stance', t: 0, view: { game: true }, place: GAME, plate: true, label: 'stance' },
    { clip: 'stride', t: 0.35, view: { game: true }, place: GAME, plate: true, label: 'set' },
    contact('swing_high', 3.3), contact('swing_mid', 2.5), contact('swing_low', 1.8),
    { clip: 'power_load', t: 0.35, view: { game: true }, place: GAME, plate: true, label: 'coil' },
    { clip: 'swing_mid', t: 0.42, view: { game: true }, place: GAME, plate: true, label: 'follow' },
    { clip: 'whiff', t: 0.6, view: { game: true }, place: GAME, plate: true, label: 'whiff' },
    { clip: 'dizzy', t: 0.4, view: { game: true }, place: GAME, plate: true, label: 'dizzy' },
    { clip: 'bat_flip', t: 0.45, view: { game: true }, place: GAME, plate: true, label: 'bat flip' },
  ] }]);
  // far field camera: the silhouette must read tiny
  const far = (clip, t) => ({ clip, t, view: { cam: [-30, -40, 45], look: [0, 0, 2], fov: 30 }, label: clip });
  S.push(['field', { cols: 6, cellW: 200, cellH: 200, ground: false, cells: [far('run', 0), far('run', 0.125), far('run', 0.25), far('trot', 0), far('trot', 0.2), far('cheer', 0.45)] }]);
  return S;
}

(async () => {
  const browser = await pw.chromium.launch({ args: GL_ARGS });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('file://' + path.join(ROOT, 'tools', 'rocco-viewer.html') + '?harness=1');
  const b64 = fs.readFileSync(glb).toString('base64');
  const clips = await page.evaluate(async (b) => {
    const bin = atob(b), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return await window.viewer.load(u.buffer);
  }, b64);
  const info = await page.evaluate(() => window.viewer.info());
  info.size = fs.statSync(glb).size;
  console.log('clips', clips.join(', '));
  console.log('tris', info.tris, 'bones', info.bones, 'morphs', info.morphs.join(','), 'size', (info.size / 1024).toFixed(1) + ' KB');
  const all = { info, sheets: {} };
  for (const [name, spec] of sheets()) {
    if (words.length && !words.some((w) => name.includes(w))) continue;
    const res = await page.evaluate((s) => window.viewer.sheet(s), spec);
    all.sheets[name] = res;
    const el = await page.$('#wrap');
    await el.screenshot({ path: path.join(out, name + '.png') });
    console.log('wrote', path.join(out, name + '.png'));
  }
  if (all.sheets.game) {
    ['swing_high', 'swing_mid', 'swing_low'].forEach((c, i) => console.log('contact', c, 'bat_sweet world', JSON.stringify(all.sheets.game[2 + i].bat_sweet)));
  }
  fs.writeFileSync(path.join(out, 'info.json'), JSON.stringify(all, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
