#!/usr/bin/env node
// Bat-camera search for the Rocco pilot (integration agent). Reads the posed points written by
// tools/rocco-integration-calib.js and searches camera position / lens size (px per ft) / lens shift plus the catcher's
// spot and the pitcher's scale against the staging rules: Rocco fully on screen incl. cleats (the bat may leave briefly
// during the swing), cleats above the bottom safe area, pitcher and release point below the HUD and above the zone,
// catcher's head below the zone, zone large in the lower middle. Reproduces BB.Render's layoutBat (35-scene.js).
//   node tools/rocco-integration-solve.js [calib.json] [iters] [--sizes=390x844,430x932] [--world={...}] [--proc]
//   node tools/rocco-integration-solve.js [calib.json] 1 --sizes=... --fixed '{"pos":[..],"aim":[0,0,2.5],"ppfW":..,"ppfH":..,"at":[..],"catcher":[x,y,size],"pitcherK":k}'
// The search is a guide: the numbers in 35-scene were picked from it and then judged on real renders.
global.self = global; global.window = global;
const path = require('path');
const T = require(path.join(__dirname, '..', 'src', 'vendor', 'three.min.js'));
const fs = require('fs');
const IN = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(__dirname, '..', 'qa', 'pilot', 'calib-points.json');
const D = JSON.parse(fs.readFileSync(IN, 'utf8'));
const ITERS = +(process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : 4000);
const SZ = process.argv.find(a => a.startsWith('--sizes='));
const SIZES = SZ ? SZ.slice(8).split(',').map(x => x.split('x').map(Number)) : [[320, 568], [390, 844], [430, 932]];
const FIXW = process.argv.find(a => a.startsWith('--world='));     // {"catcher":[x,y,size],"pitcherK":k} fixed
const ZONE = { xMax: 0.83, zMin: 1.55, zMax: 3.45 };
const useModel = process.argv.includes('--proc') ? false : D.glb;

// support points (extremes along many directions) per state, for fast screen bboxes
function fib(n) { const o = []; for (let i = 0; i < n; i++) { const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963; o.push([Math.cos(th) * r, y, Math.sin(th) * r]); } return o; }
const DIRS = fib(120);
function support(pts) {
  const keep = new Set();
  DIRS.forEach(d => { let best = -1e9, bi = 0; pts.forEach((p, i) => { const s = p[0] * d[0] + p[1] * d[1] + p[2] * d[2]; if (s > best) { best = s; bi = i; } }); keep.add(bi); });
  return [...keep].map(i => pts[i]);
}
const heroStates = (useModel ? D.model : D.proc).map(s => ({ q: s.q, sup: support(s.pts), idle: /state=(idle|windup|stride|loading)/.test(s.q), all: s.pts.filter((_, i) => i % 3 === 0) }));
const heroAll = heroStates.reduce((a, s) => a.concat(s.sup), []);
const heroCalm = heroStates.filter(s => !/state=(swing|contact|whiff)/.test(s.q)).reduce((a, s) => a.concat(s.sup), []);
const heroAct = heroStates.filter(s => /state=(swing|contact|whiff)/.test(s.q)).reduce((a, s) => a.concat(s.sup), []);
const heroIdle = heroStates.filter(s => s.idle).reduce((a, s) => a.concat(s.all), []);
const catcherAllLocal = D.catcher.reduce((a, s) => a.concat(s.pts), []);
const catcherLocal = support(catcherAllLocal), catcherSize0 = D.catcher[0].size;
const catcherBody = support(catcherAllLocal.filter(p => p[1] > -0.9));   // without the arm reaching forward with the mitt
const pitcherLocal = support(D.pitcher.reduce((a, s) => a.concat(s.pts), [])), pitcherSize0 = D.pitcher[0].size;
const pitcherAt = D.pitcher[0].at;
// the catcher's mitt (up-space target ~ (0.1, -2.55, 2.3) world in the game) -> just use the world point
const MITT = [0.1, -2.55, 2.3];
const RELEASE = [-1.75, 54.5, 6.0];

const cam = new T.PerspectiveCamera(30, 1, 1, 12000); cam.up.set(0, 0, 1);
const v = new T.Vector3();
function layout(P, W, H) {
  const aim = new T.Vector3(P.aim[0], P.aim[1], P.aim[2]), pos = new T.Vector3(P.pos[0], P.pos[1], P.pos[2]);
  const d = pos.distanceTo(aim);
  const ppf = Math.min(P.ppfW * W, P.ppfH * H);
  cam.aspect = W / H;
  cam.fov = 2 * Math.atan(H / 2 / (ppf * d)) * 180 / Math.PI;
  cam.position.copy(pos); cam.lookAt(aim);
  cam.setViewOffset(W, H, (0.5 - P.at[0]) * W, (0.5 - P.at[1]) * H, W, H);
  cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
}
function proj(p, W, H) { v.set(p[0], p[1], p[2]).project(cam); return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H]; }
function bbox(pts, W, H, tf) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p0 of pts) { const p = tf ? tf(p0) : p0; const s = proj(p, W, H); if (s[0] < x0) x0 = s[0]; if (s[0] > x1) x1 = s[0]; if (s[1] < y0) y0 = s[1]; if (s[1] > y1) y1 = s[1]; }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}
function placed(local, at, yaw, k) { const c = Math.cos(yaw), s = Math.sin(yaw); return p => [at[0] + (p[0] * c - p[1] * s) * k, at[1] + (p[0] * s + p[1] * c) * k, at[2] + p[2] * k]; }

function evaluate(P, report) {
  let score = 0, pen = 0; const rep = [];
  for (const [W, H] of SIZES) {
    layout(P, W, H);
    const hud = 150 * (W < 350 ? 1 : 1), m = 8;
    const r = bbox(heroCalm, W, H), ra = bbox(heroAct, W, H);
    const z = { a: proj([-ZONE.xMax, 0, ZONE.zMax], W, H), b: proj([ZONE.xMax, 0, ZONE.zMin], W, H) };
    const zr = { x0: z.a[0], y0: z.a[1], x1: z.b[0], y1: z.b[1] };
    const ctf = placed(catcherLocal, [P.catcher[0], P.catcher[1], 0], Math.PI, P.catcher[2] / catcherSize0);
    const c = bbox(catcherLocal, W, H, ctf), cb = bbox(catcherBody, W, H, ctf);
    const ptf = placed(pitcherLocal, pitcherAt, 0, P.pitcherK);
    const pb = bbox(pitcherLocal, W, H, ptf);
    const mitt = proj(MITT, W, H), rel = proj(RELEASE, W, H);
    // idle Rocco over the zone (pixels of overlap, approx by points inside the zone rect)
    let over = 0; for (const p of heroIdle) { const s = proj(p, W, H); if (s[0] > zr.x0 + 4 && s[0] < zr.x1 - 4 && s[1] > zr.y0 && s[1] < zr.y1) over++; }
    // hard constraints
    pen += Math.max(0, 12 - r.x0) * 10 + Math.max(0, r.x1 - (W - m)) * 10;     // Rocco fully on screen (left/right)
    pen += Math.max(0, -0.12 * W - ra.x0) * 4 + Math.max(0, ra.y1 - (H - 30)) * 6;   // swing: the bat may leave a little
    pen += Math.max(0, (zr.y1 + 6) - cb.y0) * 6;                                // the catcher's head stays below the zone
    pen += Math.max(0, r.y1 - (H - 40)) * 10;                                   // cleats above the bottom safe area + ground
    pen += Math.max(0, 128 - r.y0) * 3;                                         // bat / head clear of the HUD card
    pen += Math.max(0, hud - pb.y0) * 10;                                       // pitcher below the HUD
    pen += Math.max(0, hud - rel[1]) * 10;                                      // release point visible
    pen += Math.max(0, mitt[1] - (H - 30)) * 10;                                // mitt on screen
    pen += over * 0.5;
    pen += Math.max(0, pb.y1 - (zr.y0 - 12)) * 6;                              // pitcher above the zone (the zone reads clean)
    pen += Math.max(0, m - pb.x0) * 10 + Math.max(0, pb.x1 - (W - m)) * 10;     // pitcher fully on screen
    pen += Math.max(0, (W - 56) - c.x1 < 0 ? 0 : 0);
    pen += Math.max(0, zr.y1 - H * 0.8) * 5 + Math.max(0, H * 0.48 - zr.y0) * 5; // zone in the lower middle
    pen += Math.max(0, 0.235 * W - (zr.x1 - zr.x0)) * 6;                        // zone stays large
    // soft goals: big pitcher, small catcher (relative to screen height)
    score += Math.min(pb.h / H, 0.185) * 3 - Math.max(0, pb.h / H - 0.2) * 6 - c.h / H * 1.0 + (zr.x1 - zr.x0) / W * 1.0 + (r.y1 - r.y0) / H * 1.5;
    if (report) rep.push({ W, H, fov: +cam.fov.toFixed(2), rocco: [r.x0, r.y0, r.x1, r.y1].map(Math.round), act: [ra.x0, ra.y0, ra.x1, ra.y1].map(Math.round), zone: [zr.x0, zr.y0, zr.x1, zr.y1].map(Math.round),
      pitcher: [pb.x0, pb.y0, pb.x1, pb.y1].map(Math.round), catcher: [c.x0, c.y0, c.x1, c.y1].map(Math.round), cbody: [cb.x0, cb.y0, cb.x1, cb.y1].map(Math.round), mitt: mitt.map(Math.round), rel: rel.map(Math.round), over });
  }
  return report ? { score, pen, rep } : score - pen;
}

const OLD = { pos: [-0.9, -18, 8.0], aim: [0, 0, 2.5], ppfW: 0.165, ppfH: 1, at: [0.55, 0.64], catcher: [0.4, -5.4, 0.9], pitcherK: 1 };
let rnd = (a, b) => a + Math.random() * (b - a);
function sample() {
  return clampP({ pos: [rnd(-2.5, 0.5), rnd(-46, -18), rnd(5, 14)], aim: [0, 0, 2.5], ppfW: rnd(0.14, 0.18), ppfH: rnd(0.068, 0.09), at: [rnd(0.5, 0.67), rnd(0.56, 0.72)],
    catcher: [rnd(0.3, 1.0), rnd(-6.2, -4.6), rnd(0.72, 0.9)], pitcherK: rnd(1.0, 1.25) });
}
function clampP(q) {
  const cl = (x, a, b) => Math.min(b, Math.max(a, x));
  q.pos = [cl(q.pos[0], -2.5, 1), cl(q.pos[1], -40, -16), cl(q.pos[2], 4.5, 14)];
  q.ppfW = cl(q.ppfW, 0.13, 0.19); q.ppfH = cl(q.ppfH, 0.06, 0.095);
  q.at = [cl(q.at[0], 0.5, 0.62), cl(q.at[1], 0.55, 0.68)];
  q.catcher = [cl(q.catcher[0], 0.2, 1.1), cl(q.catcher[1], -5.6, -4.6), cl(q.catcher[2], 0.72, 0.9)];
  q.pitcherK = cl(q.pitcherK, 1, 1.25);
  if (FIXW) { const w = JSON.parse(FIXW.slice(8)); q.catcher = w.catcher; q.pitcherK = w.pitcherK; }
  return q;
}
function jitter(P, s) {
  const q = JSON.parse(JSON.stringify(P));
  q.pos = q.pos.map((x, i) => x + (Math.random() - 0.5) * [0.4, 2, 0.6][i] * s);
  q.ppfW += (Math.random() - 0.5) * 0.006 * s; q.ppfH += (Math.random() - 0.5) * 0.004 * s;
  q.at = q.at.map(x => x + (Math.random() - 0.5) * 0.02 * s);
  q.catcher = q.catcher.map((x, i) => x + (Math.random() - 0.5) * [0.1, 0.2, 0.03][i] * s);
  q.pitcherK = q.pitcherK + (Math.random() - 0.5) * 0.04 * s;
  return clampP(q);
}
let best = null, bs = -1e9;
for (let i = 0; i < ITERS; i++) { const P = sample(), s = evaluate(P); if (s > bs) { bs = s; best = P; } }
for (let i = 0; i < ITERS; i++) { const P = jitter(best, i < ITERS / 2 ? 1 : 0.4), s = evaluate(P); if (s > bs) { bs = s; best = P; } }
const r = (x, n) => +x.toFixed(n == null ? 3 : n);
console.log('BEST', JSON.stringify({ pos: best.pos.map(x => r(x, 2)), aim: best.aim, ppfW: r(best.ppfW, 4), ppfH: r(best.ppfH, 4), at: best.at.map(x => r(x, 3)), catcher: best.catcher.map(x => r(x, 2)), pitcherK: r(best.pitcherK, 3) }));
const e = evaluate(best, true); console.log('score', r(e.score), 'pen', r(e.pen)); e.rep.forEach(x => console.log(JSON.stringify(x)));
if (process.argv.includes('--fixed')) { const F = JSON.parse(process.argv[process.argv.indexOf('--fixed') + 1]); const ef = evaluate(F, true); console.log('FIXED score', r(ef.score), 'pen', r(ef.pen)); ef.rep.forEach(x => console.log(JSON.stringify(x))); }
