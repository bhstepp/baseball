#!/usr/bin/env node
// rules-tune.js — tour difficulty curve with the real physics and a bot hitter.
// Bot: takes 70% of balls and 12% of strikes; otherwise swings (40% power) with timing error ~ N(0, sd), where
//   sd = skill × (pitcher.velo / 85)^1.5 × (1 + 0.4·stuff for anything but a fastball)
// i.e. faster arms and nastier secondary stuff make timing harder (a human's real difficulty), so `skill` is the
// timing spread against an 85 mph fastball. --flat drops that scaling.
// usage: node tools/rules-tune.js [games=400] [--only=t3] [--flat]
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = path.join(__dirname, '..', 'src');
const args = process.argv.slice(2), N = +args.find(a => /^\d+$/.test(a)) || 400;
const only = (args.find(a => a.startsWith('--only=')) || '').slice(7), flat = args.includes('--flat');
const ctx = { console, Math, Date }; ctx.globalThis = ctx; vm.createContext(ctx);
['00-const.js', '10-pitch.js', '15-bat.js', '20-content.js', '25-rules.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx));
const BB = ctx.BB, R = BB.Rules, C = BB.Content, U = BB.U;
const bat = { timing: 1, power: 1, lift: 0 };

function sdFor(st, p, skill) {
  if (flat) return skill;
  const pt = st.pitcher;
  return skill * Math.pow(pt.velo / 85, 1.5) * (p.type === 'FB' ? 1 : 1 + 0.4 * pt.stuff);
}
function game(g, skill, seed) {
  const st = R.create('tour', Object.assign({}, g, { seed })), r = U.rng(seed * 31 + 7);
  let n = 0;
  while (!R.isOver(st) && n++ < 600) {
    const p = R.nextPitch(st);
    if ((!p.strike && r() < .7) || r() < .12) { R.take(st, p); continue; }
    const rng = st.swingRng(p), err = U.gauss(r) * sdFor(st, p, skill);
    const sw = BB.Bat.swing(p, err, bat, { power: r() < .4, rng });
    if (!sw.contact) R.whiff(st, p, sw);
    else R.inPlay(st, p, sw, BB.Bat.play(sw, st.park, rng, { bases: st.bases.slice(), outs: st.outs }));
  }
  return R.result(st);
}
function stats(g, skill) {
  let w = 0, s2 = 0, s3 = 0;
  for (let i = 0; i < N; i++) { const res = game(g, skill, i * 7919 + 13); if (res.win) w++; if (res.stars >= 2) s2++; if (res.stars >= 3) s3++; }
  return { w: w / N, s2: w ? s2 / w : 0, s3: w ? s3 / w : 0 };
}
const pct = x => (100 * x).toFixed(0).padStart(3) + '%';
console.log(`games/scenario ${N}${flat ? ' (flat bot)' : ''}`);
console.log('game   kind      pitcher            mph | win@.03 2★/w 3★/w | win@.05');
C.TOUR.forEach(c => {
  if (only && !c.games.some(g => g.id.startsWith(only))) return;
  const reg = [], boss = [];
  c.games.forEach(g => {
    if (only && !g.id.startsWith(only)) return;
    const a = stats(g, .03), b = stats(g, .05), P = C.getPitcher(g.pitcher);
    (g.boss ? boss : reg).push([a.w, b.w]);
    console.log(`${g.id.padEnd(6)} ${g.scenario.kind.padEnd(9)} ${(P.name).padEnd(18)} ${String(P.velo).padStart(3)} | ${pct(a.w)}  ${pct(a.s2)} ${pct(a.s3)} | ${pct(b.w)}${g.boss ? '  BOSS' : ''}`);
  });
  const avg = (l, i) => l.length ? pct(l.reduce((s, x) => s + x[i], 0) / l.length) : '  - ';
  console.log(`  ${c.id} regular avg ${avg(reg, 0)} / ${avg(reg, 1)}   boss ${avg(boss, 0)} / ${avg(boss, 1)}`);
});
