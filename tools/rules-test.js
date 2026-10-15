#!/usr/bin/env node
// rules-test.js — simulates many games per scenario with random timing against BB.Rules / BB.Content.
// Runs once with stub BB.Pitch / BB.Bat, and again with the real src/10-pitch.js + src/15-bat.js when present.
// usage: node tools/rules-test.js [gamesPerScenario]
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');
const N = +process.argv[2] || 100;
let fails = 0;
const fail = (m) => { fails++; if (fails < 30) console.error('FAIL: ' + m); };

const STUB = `
BB.Pitch = { TYPES: {FB:{name:'Fastball'},SI:{name:'Sinker'},CT:{name:'Cutter'},SL:{name:'Slider'},CB:{name:'Curveball'},
  CH:{name:'Changeup'},SP:{name:'Splitter'},KN:{name:'Knuckleball'},EE:{name:'Eephus'},SC:{name:'Screwball'}},
  make: function (p, ctx, rng) { var t = BB.U.pickWeighted(rng, p.arsenal), zp = ctx.derby ? .85 : .35 + .4 * p.control;
    var s = rng() < zp, x = s ? (rng() - .5) * 1.4 : (rng() < .5 ? -1 : 1) * (1 + rng());
    return { id: ctx.id, type: t, name: t, mph: Math.round(p.velo - rng() * 8), T: .7 + rng() * .2, plate: { x: x, z: 2.5 }, strike: s }; },
  isStrike: function (p) { return p.strike; } };
BB.Bat = { swing: function (pitch, err, bat, o) { var a = Math.abs(err), r = o.rng;
    if (a > .1 || (!pitch.strike && r() < .5)) return { contact: false, label: 'WHIFF', ev: 0, la: 0, spray: 0 };
    var q = 1 - a / .1; return { contact: true, label: a < .018 ? 'PERFECT' : 'GOOD', quality: q, ev: 60 + 50 * q + r() * 10,
      la: -10 + r() * 50, spray: err * 400 + (r() - .5) * 20 }; },
  play: function (sw, park, rng, o) { var r = rng(), q = sw.quality;
    var type = Math.abs(sw.spray) > 45 ? 'FOUL' : q > .85 && sw.la > 18 && r < .7 ? 'HR' : r < .25 ? '1B' : r < .32 ? '2B' : r < .34 ? '3B' : 'OUT';
    var kinds = ['fly', 'line', 'ground', 'pop'], ok = type === 'OUT' ? kinds[Math.floor(rng() * 4)] : null;
    return { type: type, outKind: ok, ev: sw.ev, la: sw.la, spray: sw.spray, dist: type === 'HR' ? 360 + rng() * 100 : ok === 'ground' ? 90 + rng() * 60 : 100 + rng() * 280,
      wall: false, desc: 'stub' }; } };`;

function load(real) {
  const ctx = { console, Math, Date }; ctx.globalThis = ctx; vm.createContext(ctx);
  const files = ['00-const.js'].concat(real ? ['10-pitch.js', '15-bat.js'] : []).concat(['20-content.js', '25-rules.js']);
  files.forEach(f => vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f }));
  if (!real) vm.runInContext(STUB, ctx);
  return ctx.BB;
}

// one game; policy(pitch, i) -> null (take) | {err, power}
function play(BB, mode, cfg, policy, trace) {
  const R = BB.Rules, st = R.create(mode, cfg), bat = { timing: 1, power: 1, lift: 0 };
  const inv = st.kind === 'inning' || st.kind === 'onbase', so = st.outs;
  let n = 0;
  while (!R.isOver(st)) {
    if (++n > 600) { fail(mode + ' ' + (cfg.id || '') + ' did not terminate'); break; }
    const p = R.nextPitch(st);
    if (!p) { fail('nextPitch returned null before game over'); break; }
    if (trace) trace.push([p.type, p.mph, +p.T.toFixed(5), +p.plate.x.toFixed(5), +p.plate.z.toFixed(5), p.strike]);
    const before = st.bases.slice(), act = policy(p, n);
    let e;
    if (!act) e = R.take(st, p);
    else {
      const rng = st.swingRng ? st.swingRng(p) : st.rng;
      const sw = BB.Bat.swing(p, act.err, bat, { power: act.power, rng });
      if (!sw.contact) e = R.whiff(st, p, sw);
      else e = R.inPlay(st, p, sw, BB.Bat.play(sw, st.park, rng, { bases: st.bases.slice(), outs: st.outs }));
    }
    // runner move sanity
    const dest = {};
    e.runnerMoves.forEach(m => {
      if (m.from >= 1 && inv && !before[m.from - 1]) fail('move from empty base ' + JSON.stringify(m) + ' ' + e.call);
      if (m.to >= 1 && m.to <= 3) { if (dest[m.to]) fail('two runners to base ' + m.to); dest[m.to] = 1; }
      if (!(m.to === -1 || (m.to > m.from && m.to <= 4))) fail('bad move ' + JSON.stringify(m));
    });
    if (typeof e.text !== 'string' || !e.text) fail('event without text ' + e.call);
    if (inv) { // every person who came to the plate (or started on base) scored, is on base, or made an out
      const entered = st.startRunners + st.pa, acc = st.runs + st.bases.filter(Boolean).length + (st.outs - so);
      if (entered !== acc) fail(`bookkeeping ${cfg.id}: entered ${entered} != runs+onbase+outs ${acc} after ${e.call}`);
    }
    if (st.outsMax && st.outs > st.outsMax + 1) fail('outs overflow');
    if (e.over !== R.isOver(st)) fail('event.over mismatch');
    const h = R.hud(st);
    ['inning', 'score', 'goal', 'progress'].forEach(k => { if (typeof h[k] !== 'string') fail('hud.' + k); });
  }
  return { st, res: R.result(st) };
}
const rnd = Math.random;
const randomPolicy = (skill) => (p) => (!p.strike && rnd() < .7) || rnd() < .12 ? null :
  { err: (rnd() + rnd() + rnd() - 1.5) * skill, power: rnd() < .4 };

function suite(BB, label) {
  const C = BB.Content, R = BB.Rules;
  console.log(`\n== ${label} ==`);
  if (C.PARKS.length !== 6 || C.TOUR.length !== 6) fail('6 parks / 6 chapters');
  C.PARKS.forEach(p => { if (p.fence[0][0] !== -45 || p.fence[p.fence.length - 1][0] !== 45) fail('fence range ' + p.id);
    if (!BB.INKSETS.some(i => i.id === p.inkset)) fail('inkset ' + p.id); });
  C.PITCHERS.forEach(p => Object.keys(p.arsenal).forEach(k => { if (BB.Pitch.TYPES && !BB.Pitch.TYPES[k]) fail('pitch type ' + k); }));
  console.log('game   kind      win%  avg★  avgPitches  (skill .05 / .03)');
  C.allGames().forEach(g => {
    if (!C.getPitcher(g.pitcher)) fail('pitcher ' + g.pitcher); if (C.getGame(g.id) !== g) fail('getGame');
    const out = [.05, .03].map(skill => {
      let w = 0, s = 0, pc = 0;
      for (let i = 0; i < N; i++) {
        const { res } = play(BB, 'tour', Object.assign({}, g, { seed: i * 7919 + 1 }), randomPolicy(skill));
        if (res.win) w++; s += res.stars; pc += res.stats.pitches;
        if (res.win !== (res.stars > 0)) fail('stars/win mismatch');
      }
      return `${(100 * w / N).toFixed(0).padStart(3)}% ${(s / N).toFixed(2)} ${(pc / N).toFixed(1).padStart(5)}`;
    });
    console.log(`${g.id.padEnd(6)} ${g.scenario.kind.padEnd(9)} ${out.join('   |  ')}`);
  });
  // endless derby
  let hrs = 0;
  for (let i = 0; i < N; i++) { const { res } = play(BB, 'derby', {}, randomPolicy(.03)); hrs += res.score; }
  console.log(`endless derby avg HR @skill .03: ${(hrs / N).toFixed(2)}`);
  // daily determinism: pitch i depends only on (seed, i)
  ['2026-10-15', '2026-12-25', '2027-03-01'].forEach(day => {
    const cfg = R.dailyCfg(day), cfg2 = R.dailyCfg(day);
    if (JSON.stringify(cfg) !== JSON.stringify(cfg2)) fail('dailyCfg not deterministic');
    if (cfg.seed !== BB.U.hashStr('daily' + day)) fail('daily seed');
    const traces = [];
    for (let k = 0; k < 6; k++) { const t = []; play(BB, 'daily', R.dailyCfg(day), randomPolicy(k % 2 ? .02 : .08), t); traces.push(t); }
    traces.forEach(t => { const L = Math.min(t.length, traces[0].length);
      for (let i = 0; i < L; i++) if (JSON.stringify(t[i]) !== JSON.stringify(traces[0][i])) { fail(`daily ${day} pitch ${i} differs`); break; } });
    // same timing → same result (swing randomness is per-pitch seeded)
    const fixed = (p, n) => n % 3 === 0 ? null : { err: ((n * 37) % 11 - 5) / 200, power: n % 2 === 0 };
    const a = play(BB, 'daily', R.dailyCfg(day), fixed).res, b = play(BB, 'daily', R.dailyCfg(day), fixed).res;
    if (a.share !== b.share) fail('daily same timing gave different results');
    if (!/^Halftone Hardball · Daily #\d+\n[\s\S]+\n\d+ HR · [\d,]+ ft( · 🔥\d+)?$/u.test(a.share)) fail('share format: ' + a.share);
    if (day === '2026-10-15') console.log(`daily ${day}: ${C.getPitcher(cfg.pitcher).name} @ ${C.getPark(cfg.park).name}\n${a.share}`);
    console.log(`daily ${day} #${cfg.day}: ${traces.map(t => t.length).join('/')} pitches across 6 players, identical prefixes ✓`);
  });
}

suite(load(false), 'stub physics');
if (fs.existsSync(path.join(SRC, '10-pitch.js')) && fs.existsSync(path.join(SRC, '15-bat.js'))) suite(load(true), 'real physics');
console.log(fails ? `\n${fails} failure(s)` : '\nall rules tests passed');
process.exit(fails ? 1 : 0);
