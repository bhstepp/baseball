#!/usr/bin/env node
// Animation-library QA sheets: plays the shared clips (assets/src/anim_<lib>.glb + assets/anim_<lib>.json) on the
// reference body (assets/src/ref_body.glb) through tools/anim-viewer.html (three.js toon + outlines, SwiftShader) and
// writes contact sheets to qa/anim/*.png (gitignored), plus qa/anim/<lib>-check.json (numeric checks in three.js:
// sockets at the markers, measured exactly as the runtime will see them).
//   node tools/anim-shots.js pitcher              every pitcher sheet
//   node tools/anim-shots.js pitcher windup bat   only sheets whose name contains one of the words
//   node tools/anim-shots.js pitcher --glb other.glb --body other_body.glb --out dir
//   node tools/anim-shots.js pitcher --spec adhoc.json     ad-hoc sheets: JSON [[name, spec], ...] (viewer.sheet specs)
//   node tools/anim-shots.js pitcher check nosheet         loop / chaining pose checks only
let pw;
try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const lib = args[0] && !args[0].startsWith('--') ? args.shift() : 'pitcher';
const LIBS = lib === 'scene' ? ['pitcher', 'catcher', 'umpire', 'fielder'] : [lib];
let glb = path.join(ROOT, 'assets', 'src', 'anim_' + LIBS[0] + '.glb'), side = path.join(ROOT, 'assets', 'anim_' + LIBS[0] + '.json');
let body = path.join(ROOT, 'assets', 'src', 'ref_body.glb'), out = path.join(ROOT, 'qa', 'anim'), adhoc = null;
const words = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--glb') glb = path.resolve(args[++i]);
  else if (args[i] === '--side') side = path.resolve(args[++i]);
  else if (args[i] === '--body') body = path.resolve(args[++i]);
  else if (args[i] === '--out') out = path.resolve(args[++i]);
  else if (args[i] === '--spec') adhoc = JSON.parse(fs.readFileSync(path.resolve(args[++i]), 'utf8'));
  else words.push(args[i]);
}
fs.mkdirSync(out, { recursive: true });
const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--allow-file-access-from-files'];
const PI = Math.PI;
const SC = JSON.parse(fs.readFileSync(side, 'utf8'));
const SIDES = {};
LIBS.forEach((l, i) => { SIDES[l] = i === 0 ? SC : JSON.parse(fs.readFileSync(path.join(ROOT, 'assets', 'anim_' + l + '.json'), 'utf8')); });
const clips = Object.assign({}, ...LIBS.map((l) => SIDES[l].clips));
const range = (a, b, n) => Array.from({ length: n }, (_, i) => +(a + (b - a) * i / (n - 1)).toFixed(3));

// game placements (game coords: feet, Z up, origin = home plate, +y to the mound)
const MOUND = { x: 0, y: 60.5, z: 0.83 };
// the catcher and umpire as the game currently stages them (src/35-scene.js: smaller, offset to the right)
const CATCHER = { x: 0.75, y: -4.75, yaw: PI, size: 0.76 };
const UMP = { x: 0.9, y: -6.6, yaw: PI, size: 0.92 };
const UMP_CALL = { x: 2.25, y: -4.5, yaw: Math.atan2(-0.75, 1), size: 0.92 };
function placeFor(clip) {
  const r = clip.split('_')[0];
  return r === 'p' ? MOUND : r === 'c' ? CATCHER : r === 'u' ? (clip === 'u_stance' || clip === 'u_ball' ? UMP : UMP_CALL) : { x: 0, y: 0 };
}

let HIPS = {};       // clip -> mean hips position (game coords at the placement), for framing
function sceneSheets() {
  // the bat view as the game will show it: pitcher (scaled and shifted so the ball leaves his hand at the physics
  // release point), catcher (game size 0.76, shifted so his mid-zone pocket meets the ball where it comes to rest,
  // ~3.4 ft behind the plate), umpire popping in on the catcher's left (screen-left) for the call so his punch-out (to
  // his right) flies into the open side of the screen; a 0.75 s fastball down the middle
  const rc = clips.p_windup_classic.release, k = rc.scaleToMatchHeight, g = rc['grip.R'];
  const GP = { x: -1.75 - k * g[0], y: 54.5 + k * g[2], z: 6.0 - k * g[1], size: k };
  const cm = clips.c_receive_mid.catch.mitt, cs = 0.76;                   // pocket (glTF model space: x left, y up, z forward)
  const CP = { x: 0 + cm[0] * cs, y: -4.75, yaw: PI, size: cs };           // yaw PI: his +x (left) is world -x
  const rest = { x: CP.x - cm[0] * cs, y: CP.y + cm[2] * cs, z: cm[1] * cs };
  const UM = { x: -1.6, y: -4.0, yaw: Math.atan2(0.45, 1), size: 0.92 };      // pops in on the catcher's left, faces the camera
  const FLIGHT = 0.75, T0 = 1.15, PLATE = T0 + FLIGHT, CATCH = PLATE + 0.05, CALL = CATCH + 0.12;
  const ballAt = (t) => {
    if (t < T0 || t > CATCH + 0.6) return null;
    if (t <= PLATE) { const u = (t - T0) / FLIGHT; return [-1.75 + 1.75 * u, 54.5 * (1 - u), 6.0 + (2.5 - 6.0) * u + 0.55 * 4 * u * (1 - u)]; }
    if (t <= CATCH) { const u = (t - PLATE) / (CATCH - PLATE); return [rest.x * u, rest.y * u, 2.5 + (rest.z - 2.5) * u]; }
    return [rest.x, rest.y, rest.z];
  };
  const cells = [0, 0.55, 0.98, 1.15, 1.55, CATCH, CALL + 0.23, CALL + 0.35, CALL + 0.9].map((t) => {
    const acts = [{ clip: 'p_windup_classic', t: Math.min(t, 2.0), place: GP }];
    const ct = t - (CATCH - 0.30);
    acts.push(ct < 0 ? { clip: 'c_crouch', t, place: CP } : { clip: 'c_receive_mid', t: ct, place: CP });
    if (t >= CALL) acts.push({ clip: 'u_strike', t: t - CALL, place: UM });
    const b = ballAt(t), marks = b ? [{ p: b, r: 0.15, color: 0xffffff }] : [];
    return { actors: acts, marks, view: { bat: true, W: 390, H: 844 }, zone: true, label: 't ' + t.toFixed(2) };
  });
  // the umpire's punch-out under three stagings (columns): popping in from the right as src/35-scene.js stages him
  // now (x 2.25, y -4.5, facing (-0.75, -1), drawn 4.4 ft tall), the same mirrored, and on the catcher's left (UM)
  const UR = { x: 2.25, y: -4.5, yaw: Math.atan2(-0.75, 1), size: 0.88 };
  const stagings = [['right', UR], ['right mirrored', Object.assign({ mirror: true }, UR)], ['left', UM]];
  const ucells = [];
  [0.24, 0.35, 0.6].forEach((ut) => stagings.forEach(([nm, pl]) => {
    ucells.push({ actors: [{ clip: 'p_windup_classic', t: 2.0, place: GP }, { clip: 'c_receive_mid', t: 0.6, place: CP }, { clip: 'u_strike', t: ut, place: pl }],
      marks: [{ p: [rest.x, rest.y, rest.z], r: 0.15, color: 0xffffff }], view: { bat: true, W: 390, H: 844 }, zone: true, label: nm + ' u_strike ' + ut.toFixed(2) });
  }));
  return [['scene-bat', { cols: 3, cellW: 390, cellH: 844, field: true, zone: true, cells }],
    ['scene-ump', { cols: 3, cellW: 390, cellH: 844, field: true, zone: true, cells: ucells }]];
}
function sheets() {
  if (lib === 'scene') return sceneSheets();
  const S = [];
  const names = Object.keys(clips);
  for (const c of names) {
    const L = clips[c].length, m = clips[c].markers || {};
    let ts = clips[c].keys && clips[c].keys.length <= 18 ? clips[c].keys.slice() : range(0, L, L > 1.6 ? 12 : 8);
    const mk = Object.values(m).filter((x) => typeof x === 'number');
    ts = [...new Set(ts.concat(mk).map((x) => +x.toFixed(3)))].sort((a, b) => a - b);
    const pl = placeFor(c), yawDeg = (pl.yaw || 0) * 180 / PI;
    const hm = HIPS[c] || { x: pl.x, y: pl.y, spread: 0 };
    const tgt = [hm.x, hm.y, (pl.z || 0) + 2.4 * (pl.size || 1)];
    const dist0 = 16 * (pl.size || 1) + hm.spread * 2.2;
    const cell = (t, az, el, dist, lab) => ({ actors: [{ clip: c, t, place: pl }], view: { az: az + yawDeg, el, dist, target: tgt, fov: 26 }, label: `${lab || c} ${t.toFixed(3)}` });
    const cols = Math.min(8, ts.length);
    S.push(['clip-' + c, { cols, cellW: 250, cellH: 330, field: true, cells: ts.map((t) => cell(t, 0, 6, dist0, '')) }]);
    S.push(['side-' + c, { cols, cellW: 250, cellH: 330, field: true, cells: ts.map((t) => cell(t, -90, 6, dist0, 'side')) }]);
  }
  // catcher and umpire: the bat camera sees them from behind (magnified around the plate)
  for (const c of names.filter((n) => /^[cu]_/.test(n))) {
    const L = clips[c].length, m = clips[c].markers || {};
    let ts = clips[c].keys && clips[c].keys.length <= 16 ? clips[c].keys.slice() : range(0, L, 10);
    ts = [...new Set(ts.concat(Object.values(m).filter((x) => typeof x === 'number')).map((x) => +x.toFixed(3)))].sort((a, b) => a - b);
    const pl = placeFor(c);
    S.push(['bat-' + c, { cols: Math.min(8, ts.length), cellW: 240, cellH: 300, field: true, zone: true, cells: ts.map((t) => ({ actors: [{ clip: c, t, place: pl }],
      view: { bat: true, W: 390, H: 844, zoom: 2.2, center: [pl.x, pl.y, 2.6] }, label: `${c} ${t.toFixed(2)}` })) }]);
  }
  // fielders at their real size in the field view: camera ~90 ft away and 30 ft up, fov 46 on an 844 px screen
  // (11 px per ft), each cell a crop of that screen around the fielder
  for (const c of names.filter((n) => /^f_/.test(n))) {
    const L = clips[c].length;
    const ts = [...new Set(range(0, L, 8).concat(Object.values(clips[c].markers || {})).map((x) => +x.toFixed(3)))].sort((a, b) => a - b);
    const hm = HIPS[c] || { x: 0, y: 0 };
    const cellH = 200, dist = 90, fov = 2 * Math.atan((cellH / 11.1 / 2) / dist) * 180 / PI;
    const cells = [];
    for (const [cam, lab] of [[[hm.x - 35, hm.y - 82, 30], 'from home'], [[hm.x + 80, hm.y + 25, 30], 'from the side']]) {
      ts.forEach((t) => cells.push({ actors: [{ clip: c, t, place: { x: 0, y: 0 } }], ground: true, view: { cam, look: [hm.x, hm.y, 2.2], fov }, label: `${t.toFixed(2)}` }));
    }
    S.push(['field-' + c, { cols: ts.length, cellW: 150, cellH, field: true, cells }]);
  }
  // pitcher: the game's view (bat camera behind home plate), full frame and magnified on the mound
  const pn = names.filter((c) => c.startsWith('p_'));
  if (pn.length) {
    for (const c of pn) {
      const L = clips[c].length, m = clips[c].markers || {};
      let ts = clips[c].keys && clips[c].keys.length <= 18 ? clips[c].keys.slice() : range(0, L, 10);
      ts = [...new Set(ts.concat(Object.values(m)).map((x) => +x.toFixed(3)))].filter((x) => x <= L + 1e-6).sort((a, b) => a - b);
      // placed like the game will: the classic style's scale and shift (the release lands on the physics point)
      const rc = clips.p_windup_classic && clips.p_windup_classic.release;
      const GP = rc ? { x: -1.75 - rc.scaleToMatchHeight * rc['grip.R'][0], y: 54.5 + rc.scaleToMatchHeight * rc['grip.R'][2], z: 6.0 - rc.scaleToMatchHeight * rc['grip.R'][1], size: rc.scaleToMatchHeight } : MOUND;
      S.push(['bat-' + c, { cols: Math.min(8, ts.length), cellW: 240, cellH: 290, field: true, cells: ts.map((t) => ({ actors: [{ clip: c, t, place: GP }], view: { bat: true, W: 390, H: 844, zoom: 3.6, center: [-0.4, 57.5, 3.8] }, label: `${c.replace('p_windup_', '')} ${t.toFixed(2)}` })) }]);
    }
    const wind = pn.filter((c) => /windup/.test(c));
    // the game: the runtime scales the pitcher so grip.R at 1.15 s is at the physics release height and shifts him
    // so the ball leaves his hand at BB.Pitch.releasePoint (right-handed): x, y = 54.5, z above the plate
    const PHYS = { classic: [-1.75, 6.0], highkick: [-1.55, 6.35], sidearm: [-2.75, 4.7], submarine: [-2.35, 2.6] };
    for (const c of wind) {
      const st = c.replace('p_windup_', ''), r = clips[c].release; if (!r) continue;
      const k = r.scaleToMatchHeight, g = r['grip.R'], ph = PHYS[st];
      const place = { x: ph[0] - k * g[0], y: 54.5 + k * g[2], z: ph[1] - k * g[1], size: k };
      const ts = [0.0, 0.26, 0.54, 0.76, 0.92, 0.98, 1.07, 1.11, 1.15, 1.19, 1.27, 1.44, 2.0];
      S.push(['game-' + st, { cols: 7, cellW: 260, cellH: 300, field: true, zone: true, cells: ts.map((t) => ({ actors: [{ clip: c, t, place }], marks: t >= 1.15 ? [{ p: [ph[0], 54.5, ph[1]], r: 0.16, color: 0xffffff }] : [],
        view: { bat: true, W: 390, H: 844, zoom: 3.2, center: [ph[0] * 0.5, 57, 4.0] }, label: `${st} ${t.toFixed(2)} (x${k.toFixed(2)})` })) }]);
      const tw = Array.from({ length: 25 }, (_, i) => +(i / 12).toFixed(4)).filter((t) => t <= 2.0 + 1e-6);
      S.push(['twos-' + st, { cols: 9, cellW: 210, cellH: 250, field: true, cells: tw.map((t) => ({ actors: [{ clip: c, t, place }], marks: t >= 1.15 ? [{ p: [ph[0], 54.5, ph[1]], r: 0.16, color: 0xffffff }] : [],
        view: { bat: true, W: 390, H: 844, zoom: 3.6, center: [ph[0] * 0.5, 57.5, 3.6] }, label: `${t.toFixed(3)}` })) }]);
      S.push(['phone-' + st, { cols: 3, cellW: 390, cellH: 844, field: true, zone: true, cells: [0.54, 1.15, 1.27].map((t) => ({ actors: [{ clip: c, t, place }], marks: t >= 1.15 ? [{ p: [ph[0], 54.5, ph[1]], r: 0.16, color: 0xffffff }] : [], view: { bat: true, W: 390, H: 844 }, label: `${st} ${t.toFixed(2)}` })) }]);
    }
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
  if (process.env.BALL_COLOR) await page.addInitScript((c) => { window.BALL_COLOR = +c; }, process.env.BALL_COLOR);
  await page.goto('file://' + path.join(ROOT, 'tools', 'anim-viewer.html') + '?harness=1');
  const b64 = (f) => fs.readFileSync(f).toString('base64');
  const libArgs = LIBS.map((l, i) => [l, b64(i === 0 ? glb : path.join(ROOT, 'assets', 'src', 'anim_' + l + '.glb')), SIDES[l]]);
  const names = await page.evaluate(async ([bb, la]) => {
    const dec = (b) => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };
    const libs = {}; la.forEach(([l, g, sj]) => { libs[l] = [dec(g), sj]; });
    return await window.viewer.load(dec(bb), libs);
  }, [b64(body), libArgs]);
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
  // framing: where the hips go in each clip (at its game placement)
  for (const c of names) {
    const pl = placeFor(c), L = clips[c] ? clips[c].length : 1, ts = range(0, L, 9);
    const smp = await page.evaluate(([c, t, p]) => window.viewer.sample(c, ['hips'], t, p), [c, ts, pl]);
    const xs = smp.map((o) => o.hips[0]), ys = smp.map((o) => o.hips[1]);
    const mx = (Math.max(...xs) + Math.min(...xs)) / 2, my = (Math.max(...ys) + Math.min(...ys)) / 2;
    HIPS[c] = { x: mx, y: my, spread: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) };
  }
  if (words.includes('check')) {
    // loops close and clips chain: worst bone angle / position between the two poses (tail, ears and cap carry
    // spring follow-through, so they are listed separately)
    const D = (c) => clips[c] ? clips[c].length : 0;
    const pairs = [];
    for (const c of names) if (clips[c] && clips[c].loop) pairs.push(['loop ' + c, c, 0, c, D(c)]);
    const P = (a, ta, b, tb) => { if (clips[a] && clips[b]) pairs.push([`${a}@${ta === 'end' ? 'end' : ta} -> ${b}@${tb === 'end' ? 'end' : tb}`, a, ta === 'end' ? D(a) : ta, b, tb === 'end' ? D(b) : tb]); };
    const W = ['p_windup_classic', 'p_windup_sidearm', 'p_windup_submarine', 'p_windup_highkick'];
    P('p_idle', 0, 'p_set', 0); W.forEach((w) => { P('p_set', 'end', w, 0); P(w, 'end', 'p_react_hr', 0); P(w, 'end', 'p_get_ball', 0); });
    ['p_react_k', 'p_react_walk', 'p_get_ball'].forEach((c) => P(c, 'end', 'p_idle', 0));
    P('p_windup_classic', 'end', 'p_react_k', 0); P('p_windup_classic', 'end', 'p_react_walk', 0); P('p_windup_classic', 'end', 'p_react_hit', 0);
    P('p_idle', 0, 'p_taunt', 0); P('p_taunt', 'end', 'p_idle', 0);
    ['c_sign', 'c_receive_high', 'c_receive_mid', 'c_receive_low', 'c_stand', 'c_react_hr'].forEach((c) => P('c_crouch', 0, c, 0));
    P('c_sign', 'end', 'c_crouch', 0); P('c_throw_back', 'end', 'c_crouch', 0);
    ['c_receive_high', 'c_receive_mid', 'c_receive_low'].forEach((c) => P(c, 'end', 'c_throw_back', 0));
    ['u_strike', 'u_strike3', 'u_ball', 'u_out', 'u_safe', 'u_hr'].forEach((c) => { P('u_stance', 0, c, 0); P(c, 'end', 'u_stance', 0); });
    ['f_catch_dive', 'f_field_grounder', 'f_tag', 'f_slump'].forEach((c) => P('f_ready', 0, c, 0));
    P('f_field_grounder', 'end', 'f_throw', 0); P('f_idle', 0, 'f_celebrate', 0);
    const res = [];
    for (const [label, a, ta, b, tb] of pairs) {
      const body = await page.evaluate(([a, ta, b, tb]) => window.viewer.compare(a, ta, b, tb, ['tail', 'ear', 'cap']), [a, ta, b, tb]);
      const all = await page.evaluate(([a, ta, b, tb]) => window.viewer.compare(a, ta, b, tb, []), [a, ta, b, tb]);
      res.push([label, body, all]);
      console.log(`${label.padEnd(52)} body ${String(body.deg).padStart(6)} deg (${body.boneDeg}) ${String(body.ft).padStart(7)} ft (${body.bonePos})   with tail/ears/cap ${all.deg} deg (${all.boneDeg})`);
    }
    fs.writeFileSync(path.join(out, lib + '-chain.json'), JSON.stringify(res, null, 1));
  }
  for (const [name, spec] of adhoc || sheets()) {
    if (!adhoc && words.length && !words.some((w) => name.includes(w))) continue;
    await page.evaluate((s) => window.viewer.sheet(s), spec);
    const el = await page.$('#wrap');
    await el.screenshot({ path: path.join(out, lib + '-' + name + '.png') });
    console.log('wrote', path.join(out, lib + '-' + name + '.png'));
  }
  await browser.close();
})();
