#!/usr/bin/env node
// Physics self-test: node tools/physics-test.js
// Loads 00-const + 10-pitch + 15-bat into a vm context, checks determinism and invariants, prints tuning tables.
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const ctx = vm.createContext({ console, Math });
for (const f of ['00-const.js', '10-pitch.js', '15-bat.js'])
  vm.runInContext('"use strict";\n' + fs.readFileSync(path.join(ROOT, 'src', f), 'utf8'), ctx, { filename: f });
const BB = ctx.BB, U = BB.U, K = BB.K;
let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.log('FAIL: ' + msg); } };

const PITCHER = { id: 't', hand: 'R', velo: 90, arsenal: { FB: .5, SL: .25, CH: .25 }, control: .5, stuff: .5, look: { windup: 'classic', build: 'tall' } };
const PARK = { id: 'gen', fence: [[-45, 330, 10], [-22, 375, 10], [0, 400, 10], [22, 375, 10], [45, 330, 10]] };
const BAT = { timing: 1, power: 1, lift: 0 };

// ---------------- determinism + invariants
function seq(seed) {
  const r = U.rng(seed), out = [];
  for (let i = 0; i < 40; i++) {
    const p = BB.Pitch.make(PITCHER, { balls: i % 4, strikes: i % 3, derby: false, id: i }, r);
    const s = BB.Bat.swing(p, U.gauss(r) * 0.04, BAT, { power: i % 2 === 0, rng: r });
    const pl = s.contact ? BB.Bat.play(s, PARK, r, { bases: [false, false, false], outs: 0 }) : null;
    out.push([p.type, p.mph, p.plate.x.toFixed(4), p.plate.z.toFixed(4), s.label, s.ev, s.la, s.spray, pl && pl.type, pl && pl.desc, pl && pl.ballAt(1.1).x.toFixed(3)].join('|'));
  }
  return out.join('\n');
}
check(seq(7) === seq(7), 'same seed -> same sequence');
check(seq(7) !== seq(8), 'different seed -> different sequence');

{ // every pitch type: path ends at plate, T formula, stays in mitt, wobble deterministic
  const r = U.rng(3);
  for (const t of Object.keys(BB.Pitch.TYPES)) for (const hand of ['R', 'L']) {
    const P = Object.assign({}, PITCHER, { hand, arsenal: { [t]: 1 }, look: { windup: 'submarine' } });
    const p = BB.Pitch.make(P, { balls: 0, strikes: 0 }, r);
    const end = BB.Pitch.pos(p, p.T), s0 = BB.Pitch.pos(p, 0);
    check(Math.abs(end.x - p.plate.x) < 1e-6 && Math.abs(end.z - p.plate.z) < 1e-6 && Math.abs(end.y) < 1e-6, t + ' crosses plate');
    check(Math.abs(s0.y - K.RELEASE_Y) < 1e-6 && Math.sign(s0.x) === (hand === 'R' ? -1 : 1), t + ' release side');
    const m = BB.Pitch.pos(p, p.T + 0.5);
    check(Math.abs(m.y + 3) < 1e-6 && m.z > 0, t + ' in mitt');
    check(BB.Pitch.isStrike(p) === p.strike, t + ' strike flag');
    for (let k = 0; k <= 20; k++) { const q = BB.Pitch.pos(p, p.T * k / 20); check(q.z > -0.5 && q.z < 16, t + ' sane height ' + q.z); }
  }
  const T = m => BB.Pitch.flightTime(m).toFixed(3);
  console.log(`flight T: 95mph ${T(95)}s  90 ${T(90)}  80 ${T(80)}  70 ${T(70)}  55 ${T(55)}`);
}

{ // late break: fraction of total break visible by 50% / 75% of the flight (vs straight line release->plate)
  const r = U.rng(11);
  const rows = [];
  for (const t of ['FB', 'SL', 'CB', 'CH', 'SP']) {
    const p = BB.Pitch.make(Object.assign({}, PITCHER, { arsenal: { [t]: 1 }, stuff: .8 }), {}, r);
    // deviation from the line the ball STARTED on (what the hitter reads out of the hand) — grows ~ s^p
    const h = 1e-3, a = BB.Pitch.pos(p, 0), b = BB.Pitch.pos(p, h * p.T);
    const dev = s => { const q = BB.Pitch.pos(p, p.T * s), lx = a.x + (b.x - a.x) / h * s, lz = a.z + (b.z - a.z) / h * s; return Math.hypot(q.x - lx, q.z - lz).toFixed(2); };
    rows.push(`${t} ${p.mph}mph T=${p.T.toFixed(2)} dev@25%=${dev(.25)} @50%=${dev(.5)} @75%=${dev(.75)} @90%=${dev(.9)}ft`);
  }
  console.log('break vs. the release line (ft):\n  ' + rows.join('\n  '));
}

{ // zone rates by count
  const r = U.rng(5), n = 4000;
  const rate = c => { let s = 0; for (let i = 0; i < n; i++) s += BB.Pitch.make(PITCHER, c, r).strike ? 1 : 0; return (100 * s / n).toFixed(0) + '%'; };
  console.log(`zone%: derby ${rate({ derby: true })}  0-0 ${rate({ balls: 0, strikes: 0 })}  0-2 ${rate({ balls: 0, strikes: 2 })}  3-0 ${rate({ balls: 3, strikes: 0 })}  3-2 ${rate({ balls: 3, strikes: 2 })}`);
}

// ---------------- play invariants over many random swings
{
  const r = U.rng(99);
  for (let i = 0; i < 3000; i++) {
    const p = BB.Pitch.make(PITCHER, { derby: i % 2 === 0, balls: 0, strikes: 0 }, r);
    const s = BB.Bat.swing(p, U.gauss(r) * 0.05, BAT, { power: i % 3 === 0, rng: r });
    if (!s.contact) continue;
    const pl = BB.Bat.play(s, PARK, r, {});
    check(pl.dur >= K.FIELD_MIN - 1e-9 && pl.dur <= 8, 'dur range ' + pl.dur + ' ' + pl.type);
    check(['HR', '1B', '2B', '3B', 'OUT', 'FOUL'].includes(pl.type), 'type ' + pl.type);
    check(typeof pl.desc === 'string' && pl.desc.length > 3 && !/\{/.test(pl.desc), 'desc ' + pl.desc);
    for (let t = 0; t <= pl.dur; t += pl.dur / 12) {
      const b = pl.ballAt(t); check(isFinite(b.x + b.y + b.z) && b.z >= 0, 'ballAt finite');
      for (let j = 0; j < 9; j++) { const f = pl.fielderAt(j, t); check(isFinite(f.x + f.y), 'fielderAt finite'); }
    }
    if (pl.catchBy >= 0) {
      const b = pl.ballAt(pl.catchT), f = pl.fielderAt(pl.catchBy, pl.catchT);
      check(Math.hypot(b.x - f.x, b.y - f.y) < 1.5, 'fielder at ball when fielded ' + pl.type + ' ' + Math.hypot(b.x - f.x, b.y - f.y));
    }
    if (pl.type === 'HR') check(pl.dur <= 5.01, 'HR dur cap');
    if (fails > 20) break;
  }
}

// ---------------- carry grid (ev x la), generic park, straight away (spray 0, fence 400)
{
  const las = [10, 15, 20, 25, 28, 30, 35, 40, 50];
  console.log('\ncarry ft (spray 0)   la: ' + las.map(l => String(l).padStart(5)).join(''));
  for (const ev of [80, 90, 95, 100, 105, 110, 115]) {
    const row = las.map(la => { const f = BB.Bat._fly(ev, la, 0, { fence: [[-45, 999, 10], [45, 999, 10]] }); return String(Math.round(Math.hypot(f.landX, f.landY))).padStart(5); });
    console.log(`  ev ${ev}`.padEnd(22) + row.join(''));
  }
  const f1 = BB.Bat._fly(105, 28, 0, { fence: [[-45, 999, 10], [45, 999, 10]] }), f2 = BB.Bat._fly(110, 30, 0, { fence: [[-45, 999, 10], [45, 999, 10]] });
  console.log(`  105@28: ${Math.round(Math.hypot(f1.landX, f1.landY))} ft hang ${f1.land.toFixed(2)}s (anim ${(f1.land / BB.Bat.TIME_SCALE).toFixed(2)}s) apex ${f1.apex.toFixed(0)}; 110@30: ${Math.round(Math.hypot(f2.landX, f2.landY))} ft`);
}

// ---------------- outcome distributions
function dist(sd, power, derby, n, opts = {}) {
  const r = U.rng(1234 + sd * 1000 + (power ? 7 : 0) + (derby ? 3 : 0)), c = { HR: 0, '1B': 0, '2B': 0, '3B': 0, OUT: 0, FOUL: 0, whiff: 0 };
  let sw = 0;
  for (let i = 0; i < n; i++) {
    const p = BB.Pitch.make(PITCHER, { derby, balls: 1, strikes: 1, id: i }, r);
    if (opts.zone === true && !p.strike) continue;
    if (opts.zone === false && p.strike) continue;
    sw++;
    const s = BB.Bat.swing(p, U.gauss(r) * sd, BAT, { power, rng: r });
    if (!s.contact) { c.whiff++; continue; }
    c[BB.Bat.play(s, PARK, r, {}).type]++;
  }
  const pc = k => (100 * c[k] / sw).toFixed(1).padStart(6);
  const hits = c.HR + c['1B'] + c['2B'] + c['3B'];
  return `${pc('HR')}${pc('1B')}${pc('2B')}${pc('3B')}${pc('OUT')}${pc('FOUL')}${pc('whiff')}  | hits ${(100 * hits / sw).toFixed(1)}%`;
}
const N = 6000;
console.log('\nper-swing outcomes (%)                       HR    1B    2B    3B   OUT  FOUL whiff');
for (const [label, derby, zone] of [['derby pitches', true, undefined], ['in-zone (game)', false, true], ['chase (game)', false, false]])
  for (const [sd, who] of [[0.02, 'skilled'], [0.04, 'average'], [0.07, 'novice']])
    for (const power of [false, true])
      console.log(`${label.padEnd(15)} ${who.padEnd(8)} ${power ? 'power  ' : 'contact'}   ${dist(sd, power, derby, N, { zone })}`);

{ // contract target: PERFECT power swing on a middle-middle fastball
  const r = U.rng(42); let hr = 0, n = 2000;
  for (let i = 0; i < n; i++) {
    const p = BB.Pitch.make(Object.assign({}, PITCHER, { arsenal: { FB: 1 } }), { derby: true }, r);
    p.plate = { x: 0, z: 2.5 }; p.strike = true;
    const s = BB.Bat.swing(p, (r() * 2 - 1) * 0.0135, BAT, { power: true, rng: r });
    if (s.contact && BB.Bat.play(s, PARK, r, {}).type === 'HR') hr++;
  }
  console.log(`\nPERFECT power swing, middle-middle FB: ${(100 * hr / n).toFixed(1)}% HR`);
  const r2 = U.rng(43), c = {}; let lab = {};
  for (let i = 0; i < n; i++) {
    const p = BB.Pitch.make(Object.assign({}, PITCHER, { arsenal: { FB: 1 } }), { derby: true }, r2);
    const e = (0.035 + r2() * 0.025) * (r2() < .5 ? -1 : 1);
    const s = BB.Bat.swing(p, e, BAT, { power: false, rng: r2 }); lab[s.label] = (lab[s.label] || 0) + 1;
    if (!s.contact) continue;
    const pl = BB.Bat.play(s, PARK, r2, {}); const k = pl.type + (pl.outKind ? ':' + pl.outKind : '') + (s.la < 10 ? ' (gb)' : s.la < 25 ? ' (ld)' : ' (fb)');
    c[k] = (c[k] || 0) + 1;
  }
  console.log('GOOD contact swings:', Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k} ${(100 * v / n).toFixed(0)}%`).join(', '));
}

{ // sample calls
  const r = U.rng(2024), seen = {};
  for (let i = 0; i < 400; i++) {
    const p = BB.Pitch.make(PITCHER, { derby: true }, r);
    const s = BB.Bat.swing(p, U.gauss(r) * 0.04, BAT, { power: r() < .5, rng: r });
    if (!s.contact) continue;
    const pl = BB.Bat.play(s, PARK, r, {});
    (seen[pl.type] = seen[pl.type] || []).length < 3 && seen[pl.type].push(`${pl.desc}  [ev ${pl.ev} la ${pl.la} sp ${pl.spray} dist ${pl.dist} dur ${pl.dur.toFixed(2)}${pl.wall ? ' wall' : ''}]`);
  }
  console.log('\nsample calls:'); for (const k in seen) for (const d of seen[k]) console.log(`  ${k.padEnd(4)} ${d}`);
}

console.log(fails ? `\n${fails} FAILURES` : '\nall physics checks passed');
process.exit(fails ? 1 : 0);
