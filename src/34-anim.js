// 34-anim.js — BB.Anim: procedural acting for the cast (pure functions of time -> pose). Owned by the render agent.
// Poses are in a character's "up" space (Y up, +Z = facing, +X = their left; unscaled skeleton units, see 32-cast).
// Everything here is deterministic, so a single harness frame shows exactly what the game shows at that instant.
BB.Anim = (function () {
  var C = BB.Cast; if (!C) return null;
  var U = BB.U, PI = Math.PI, sample = C.sample, lerpPose = C.lerpPose;
  var clamp = U.clamp, smooth = U.smooth;
  function mixIn(a, b) { var o = {}, k; for (k in a) o[k] = a[k]; for (k in b) o[k] = b[k]; return o; }
  function nrm(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function blinkAt(t, seed) { var p = (t + seed * 1.7) % 3.7; return p < 0.12 ? Math.sin(p / 0.12 * PI) : 0; }

  // ------------------------------------------------------------------ batter (right-handed; +X points at the pitcher)
  var STANCE = { hip: 1.2, tx: 0.2, ty: -0.32, tz: 0.04, lf: [0.82, 0.13, 0.16], rf: [-0.78, 0.13, -0.04], lk: [0.6, 0, 1], rk: [-0.5, 0, 1], lfy: 0.55, rfy: 0.25,
    grip: [-0.4, 2.42, 0.42], bat: [-0.3, 0.86, -0.4], hy: 0.62, hx: 0.08, le: [0.2, -1, 0.5], re: [-0.5, -0.4, -0.3], brow: 0.45, smile: 0.7, tail: 0 };
  var LOAD = { hip: 1.08, sq: 0.95, tx: 0.12, ty: -0.8, tz: 0.06, lf: [0.58, 0.48, 0.22], lk: [0.4, 0.5, 1], rf: [-0.78, 0.13, -0.04], lfy: 0.3,
    grip: [-0.78, 2.5, 0.0], bat: [-0.55, 0.78, -0.3], hy: 1.05, brow: 1, smile: -0.4, tail: -0.4 };
  var MID = { hip: 1.1, sq: 1.0, tx: 0.3, ty: 0.15, tz: 0, lf: [1.2, 0.13, 0.3], lk: [0.6, 0, 1], lfy: 0.7, rf: [-0.72, 0.18, -0.02], rft: -0.25,
    grip: [-0.25, 2.1, 0.75], bat: [-0.92, 0.12, 0.38], hy: 0.9, hx: 0.2, brow: 1, mouth: 0.5, tail: 0.6 };
  var CONTACT = { hip: 1.12, tx: 0.32, ty: 0.95, tz: -0.05, lf: [1.22, 0.13, 0.32], lfy: 0.75, rf: [-0.62, 0.26, 0.04], rft: -0.55, rk: [-0.2, 0, 1],
    grip: [0.12, 1.95, 1.0], bat: [0.15, 0.1, 1], hy: -0.35, hx: 0.3, brow: 1, mouth: 0.7, tail: 0.9 };
  var FOLLOW = { hip: 1.24, tx: 0.08, ty: 1.95, tz: -0.08, lf: [1.18, 0.13, 0.32], lfy: 0.8, rf: [-0.42, 0.32, 0.18], rft: -0.95, rfy: 1.0, rk: [0.3, 0, 1],
    grip: [0.62, 2.7, 0.0], bat: [-0.4, -0.3, -0.86], hy: -0.75, hx: -0.15, brow: 0.3, mouth: 0.45, tail: 1.1 };
  // hands from grip + bat direction (bottom hand = left)
  function hands(p) {
    var d = nrm(p.bat), g = p.grip;
    p.lh = [g[0], g[1], g[2]];
    p.rh = [g[0] + d[0] * 0.27, g[1] + d[1] * 0.27, g[2] + d[2] * 0.27];
    p.lhr = [0, 0, 0]; p.rhr = [0, 0, 0];
    return p;
  }
  // o: { time, load (0..1), swingT, contact, tgt [x,y,z] up-space contact point, power, whiff, tc (s since contact), hr, onFire, idle }
  function batter(o) {
    var t = o.time || 0, p;
    var breathe = Math.sin(t * 2.1) * 0.02, waggle = Math.sin(t * 3.3) * 0.08;
    var base = lerpPose(STANCE, LOAD, smooth(o.load || 0));
    if (o.load > 0.98) { base.x = Math.sin(t * 60) * 0.012; base.sq = 0.94 + Math.sin(t * 40) * 0.006; } // quivering with power
    base.hip += breathe; base.bat = [base.bat[0] + waggle * 0.25 * (1 - (o.load || 0)), base.bat[1], base.bat[2] + waggle * 0.4 * (1 - (o.load || 0))];
    base.blink = blinkAt(t, 1); base.lx = 0.7; base.ly = 0.1;
    if (o.swingT == null) { p = base; }
    else {
      var st = o.swingT, ct = mixIn(CONTACT, {});
      if (o.tgt) { // aim the barrel at where the ball actually crosses
        var g = ct.grip, d = [o.tgt[0] - g[0], (o.tgt[1] - g[1]) * 0.85, o.tgt[2] - g[2]];
        ct.bat = nrm(d); ct.hx = 0.2 + clamp((2.0 - o.tgt[1]) * 0.25, -0.2, 0.4);
      }
      var keys = [[0, base], [0.035, MID, 'lin'], [0.07, ct, 'lin'], [0.22, FOLLOW, 'out'], [0.6, mixIn(FOLLOW, { mouth: 0.2, smile: 1 })]];
      p = sample(keys, st);
      p.blink = 0;
      if (o.whiff && st > 0.18) { // corkscrew into the dirt, then dizzy
        var u = clamp((st - 0.18) / 0.5, 0, 1);
        p.spin = U.easeOut(u) * PI * 1.5;
        p.sq = 1 - 0.18 * Math.sin(u * PI);
        p.hip = p.hip - 0.15 * Math.sin(u * PI);
        p.mouth = 0.8; p.brow = -0.6; p.browY = 1;
        if (u >= 1) {
          var w = (o.time || 0);
          p = mixIn(p, { rz: Math.sin(w * 5.2) * 0.09, rx: Math.cos(w * 4.1) * 0.05, hz: Math.sin(w * 5.2 + 1) * 0.22, blink: 0.45, mouth: 0.5 + 0.2 * Math.sin(w * 7), brow: -0.8, browY: 0.6, lx: Math.sin(w * 9) * 0.8, ly: Math.cos(w * 9) * 0.6, hip: 1.18, sq: 1, spin: PI * 1.5 });
          p.grip = [0.35, 1.2 + Math.sin(w * 5.2) * 0.1, 0.6]; p.bat = [0.25, -0.95, 0.2];
        }
      }
      if (o.contact && o.tc != null && o.tc > 0.06) { // admire it / trot
        var a = clamp((o.tc - 0.06) / 0.18, 0, 1);
        if (o.hr) {
          var pose = mixIn(FOLLOW, { ty: 1.3, tx: -0.15, hy: -0.2, hx: -0.35, mouth: 0.9, smile: 1, brow: -0.2, browY: 1, rh: [0.6, 3.6, 0.6], lh: [0.7, 1.4, 0.6], re: [0.5, 0.3, 0], tail: 1.5 });
          p = lerpPose(p, pose, smooth(a));
          p._free = true;
        } else {
          p = lerpPose(p, mixIn(FOLLOW, { grip: [0.7, 1.6, 0.6], bat: [0.5, -0.6, 0.6], hy: -0.6, mouth: 0.5 }), smooth(a));
        }
      }
    }
    if (!p._free) hands(p);
    if (o.onFire) p.cap = 1;
    return p;
  }
  // the bat in hand (grip + dir) or flipped away (HR): returns { pos, dir, spin, free }
  function batterBat(p, o) {
    if (o.contact && o.hr && o.tc != null && o.tc > 0.1) {
      var ft = o.tc - 0.1;
      var y = 2.9 + ft * 9 - ft * ft * 16, landed = y <= 0.16;
      if (landed) ft = (9 + Math.sqrt(81 + 64 * 2.74)) / 32;   // where it came down
      return { free: true, pos: [0.4 + ft * 2.5, Math.max(0.16, y), 0.6 + ft * 1.5], dir: landed ? [1, 0.05, 0.45] : [Math.cos(ft * 14), Math.sin(ft * 14), 0.3], ground: true };
    }
    return { free: false, pos: p.grip, dir: nrm(p.bat) };
  }

  // ------------------------------------------------------------------ pitcher (right-handed; mirrored for lefties)
  var P_SET = { hip: 1.36, lf: [0.32, 0.13, 0.05], rf: [-0.32, 0.13, -0.05], lh: [0.14, 2.1, 0.55], rh: [-0.1, 2.06, 0.52], le: [0.9, -0.5, 0], re: [-0.9, -0.5, 0], tx: 0.08, hx: 0.08, brow: 0.8, smile: 0.4 };
  var P_ROCK = { hip: 1.42, tx: -0.2, rf: [-0.3, 0.13, -0.8], rfy: 0, lh: [0.14, 3.45, 0.15], rh: [-0.14, 3.42, 0.12], le: [1, 0.4, 0], re: [-1, 0.4, 0], hx: -0.12, brow: 0.9 };
  var P_PIVOT = { hip: 1.4, ty: -0.85, tx: -0.05, rf: [-0.15, 0.13, -0.08], rfy: -1.3, lf: [0.32, 0.42, 0.0], lk: [-0.2, 0.5, 1], lh: [0.0, 2.25, 0.35], rh: [-0.12, 2.2, 0.32], hy: 0.85, brow: 1 };
  var P_KICK = { hip: 1.44, ty: -1.5, tx: -0.14, tz: 0.04, rf: [-0.12, 0.13, -0.1], rfy: -1.45, lf: [0.12, 0.85, 0.1], lk: [-0.7, 0.7, 0.2], lh: [-0.2, 2.3, 0.15], rh: [-0.28, 2.24, 0.04], le: [0.3, -0.6, 1], re: [-0.3, -0.6, -1], hy: 1.5, brow: 1, smile: -0.3 };
  var P_STRIDE = { z: 0.9, hip: 1.08, ty: -1.25, tx: 0.06, lf: [0.35, 0.13, 2.65], lfy: -0.3, rf: [-0.2, 0.13, -0.25], rfy: -1.3, rk: [-1, 0, 0.4], lk: [0, 0.2, 1],
    lh: [0.6, 2.4, 2.3], le: [0.8, 0, 0], rh: [-1.4, 2.85, -1.1], re: [-0.4, -1, 0.2], hy: 1.25, brow: 1, mouth: 0.15 };
  var P_REL = { z: 2.0, hip: 1.02, ty: 0.38, tx: 0.78, lf: [0.35, 0.13, 2.85], lfy: -0.1, rf: [-0.3, 0.5, -0.45], rft: 0.9, rfy: -0.8, rk: [0, -0.3, -1],
    re: [-1, 0.2, -0.3], lh: [0.7, 1.7, 1.5], le: [1, -0.5, 0], hy: -0.3, hx: -0.75, brow: 1, mouth: 0.75 };
  var P_FOLLOW = { z: 2.3, hip: 0.95, ty: 0.78, tx: 1.05, lf: [0.32, 0.13, 2.9], rf: [-0.5, 1.6, -1.05], rft: 1.2, rk: [0, -1, -0.3], rh: [0.85, 0.9, 2.1], re: [-0.3, -1, 0.5],
    lh: [0.75, 1.45, 1.0], hy: -0.6, hx: -1.0, brow: 1, mouth: 0.4 };
  var P_RECOVER = { z: 2.2, hip: 1.12, ty: 0.0, tx: 0.38, lf: [0.62, 0.13, 2.6], rf: [-0.6, 0.13, 2.0], lh: [0.42, 1.55, 2.85], rh: [-0.42, 1.5, 2.8], lk: [0.5, 0, 1], rk: [-0.5, 0, 1], hx: -0.35, hy: 0, brow: 0.6, mouth: 0 };
  var STYLE = {
    classic: {},
    highkick: { kick: { lf: [0.05, 2.35, 0.75], lk: [-0.4, 1, 0.5], tx: -0.38, hip: 1.48, hx: 0.25 } },
    sidearm: { kick: { lf: [0.22, 0.6, 0.15] }, stride: { rh: [-1.7, 2.1, -0.5], tz: 0.25 }, rel: { tz: -0.45, tx: 0.5 } },
    submarine: { kick: { lf: [0.2, 0.7, 0.2] }, stride: { hip: 0.82, tx: 0.85, rh: [-1.25, 0.9, -1.1], lh: [0.6, 1.4, 2.0], hy: 1.3, hx: -0.6 }, rel: { hip: 0.72, tx: 1.25, tz: -0.2, hx: -1.1 }, follow: { hip: 0.75, tx: 1.3 } },
  };
  // o: { windup 0..1 | null, pitchT | null, style, rel [x,y,z] up-space release target, time, react: 'jaw'|'smug'|'grr'|null, reactT }
  function pitcher(o) {
    var st = STYLE[o.style] || STYLE.classic, t = o.time || 0, p;
    var kick = mixIn(P_KICK, st.kick || {}), stride = mixIn(P_STRIDE, st.stride || {}), rel = mixIn(P_REL, st.rel || {}), follow = mixIn(P_FOLLOW, st.follow || {});
    if (o.rel) rel.rh = o.rel;
    var hold = o.style === 'highkick' ? 0.12 : 0.05;
    if (o.windup != null) {
      var keys = [[0, P_SET], [0.2, P_ROCK], [0.34, P_PIVOT], [0.5, kick, 'out'], [0.5 + hold, mixIn(kick, { hip: kick.hip + 0.04 })], [0.82, stride, 'in'], [1, rel, 'lin']];
      p = sample(keys, o.windup);
      if (o.windup < 0.05) p.blink = blinkAt(t, 3);
    } else if (o.pitchT != null) {
      p = sample([[0, rel], [0.22, follow, 'out'], [0.75, P_RECOVER], [1.5, P_RECOVER]], o.pitchT);
    } else { // standing on the rubber, breathing, glancing in for the sign
      p = mixIn(P_SET, { hip: 1.36 + Math.sin(t * 2) * 0.02, lh: [0.5, 1.2, 0.3], rh: [-0.55, 1.15, 0.25], hy: Math.sin(t * 0.7) * 0.25, blink: blinkAt(t, 3), brow: 0.6 });
    }
    if (o.react) {
      var r = clamp((o.reactT || 0) / 0.25, 0, 1), face;
      if (o.react === 'jaw') face = { mouth: 1, jaw: 1, browY: 1.2, brow: -0.8, blink: 0, ly: 0.8, hx: -0.5 };
      else if (o.react === 'smug') face = { mouth: 0, smile: 1.4, brow: 0.7, blink: 0.45, hz: 0.12, lx: -0.5 };
      else face = { brow: 1, mouth: 0.3 };
      p = lerpPose(p, mixIn(p, face), C.backOut(r));
    }
    return p;
  }

  // ------------------------------------------------------------------ catcher & umpire
  var CROUCH = { hip: 0.78, tx: 0.32, lf: [0.78, 0.13, 0.22], rf: [-0.78, 0.13, 0.22], lfy: 0.45, rfy: -0.45, lk: [0.9, 0.3, 1], rk: [-0.9, 0.3, 1],
    le: [0.9, -0.5, -0.2], rh: [-0.48, 0.95, 0.35], re: [-0.8, -0.3, 0], hx: -0.1, brow: 0.5 };
  function catcher(o) { // o: { mitt [x,y,z] up-space, pop 0..1, time }
    var t = o.time || 0, p = mixIn(CROUCH, { hip: CROUCH.hip + Math.sin(t * 2.3) * 0.015, blink: blinkAt(t, 5) });
    p.lh = o.mitt || [0.4, 1.6, 1.2];
    if (o.pop) { p.sq = 1 - 0.08 * o.pop; p.lh = [p.lh[0], p.lh[1], p.lh[2] - 0.2 * o.pop]; }
    return p;
  }
  var UMP = { hip: 1.05, tx: 0.45, lf: [0.7, 0.13, 0.1], rf: [-0.7, 0.13, 0.1], lk: [0.6, 0, 1], rk: [-0.6, 0, 1], lh: [0.5, 1.0, 0.6], rh: [-0.5, 1.0, 0.6], le: [1, 0, 0], re: [-1, 0, 0], brow: 0.8, hx: -0.15 };
  function ump(o) { // o: { callT seconds since a called strike | null, time }
    var t = o.time || 0, p = mixIn(UMP, { blink: blinkAt(t, 7) });
    if (o.callT != null && o.callT >= 0) {
      var wind = mixIn(UMP, { hip: 1.3, tx: 0.05, ty: 0.3, rh: [-0.6, 3.3, -0.4], re: [-1, 0.5, -0.5], lh: [0.55, 1.5, 0.2], lf: [0.7, 0.75, 0.1], mouth: 0.5, brow: 1, browY: 0.5 });
      var punch = mixIn(UMP, { hip: 1.2, tx: 0.1, ty: -0.55, tz: -0.25, rh: [-2.3, 2.75, 0.5], rhr: [0, 0, -1.2], re: [0, 1, 0], lh: [0.5, 1.4, 0.4], lf: [0.85, 0.13, 0.2], mouth: 1, brow: 1, browY: 0.2, hy: -0.4 });
      p = sample([[0, p], [0.12, wind, 'out'], [0.22, punch, 'back'], [0.85, mixIn(punch, { rh: [-2.25, 2.85, 0.55], mouth: 0.9 })], [1.2, UMP]], o.callT);
    }
    return p;
  }

  // ------------------------------------------------------------------ fielders & runners
  var READY = { hip: 1.12, tx: 0.42, lf: [0.62, 0.13, 0.1], rf: [-0.62, 0.13, 0.1], lfy: 0.3, rfy: -0.3, lk: [0.6, 0, 1], rk: [-0.6, 0, 1], lh: [0.5, 1.05, 0.62], rh: [-0.5, 1.05, 0.62], le: [1, 0, 0], re: [-1, 0, 0], hx: -0.25, brow: 0.4 };
  function run(phase, k, extra) {
    var s = Math.sin(phase), c = Math.cos(phase);
    var p = {
      hip: 1.28 + Math.abs(s) * 0.12 * k, tx: 0.32 * k + 0.05, ty: s * 0.18 * k, sq: 1 + Math.abs(c) * 0.04 * k,
      lf: [0.28, 0.13 + Math.max(0, s) * 0.6 * k, c * 0.85 * k], rf: [-0.28, 0.13 + Math.max(0, -s) * 0.6 * k, -c * 0.85 * k],
      lk: [0, 0.2, 1], rk: [0, 0.2, 1], lft: -c * 0.4 * k, rft: c * 0.4 * k,
      lh: [0.6, 1.55 - s * 0.12, -c * 0.7 * k + 0.15], rh: [-0.6, 1.55 + s * 0.12, c * 0.7 * k + 0.15], le: [1, -0.6, 0], re: [-1, -0.6, 0],
      hx: -0.1 * k, brow: 0.8, mouth: 0.25 * k, tail: s * 0.5,
    };
    return extra ? mixIn(p, extra) : p;
  }
  // o: { moving speed ft/s, phase, catchU (−1..1 around the catch: reach), high (air catch), throwU, time, idx }
  function fielder(o) {
    var t = o.time || 0, k = clamp(o.speed / 18, 0, 1), p;
    p = k > 0.08 ? run(o.phase, k) : mixIn(READY, { hip: READY.hip + Math.sin(t * 2 + o.idx) * 0.02, blink: blinkAt(t, o.idx || 0) });
    if (o.catchU != null && o.catchU > -1 && o.catchU < 1.2) {
      var w = o.catchU < 0 ? smooth(o.catchU + 1) : o.catchU < 0.6 ? 1 : 1 - smooth((o.catchU - 0.6) / 0.6);
      var reach = o.high ? { lh: [0.3, 3.35, 0.7], rh: [-0.3, 3.0, 0.55], hx: 0.6, mouth: 0.6, browY: 1 } : { hip: 0.85, tx: 0.95, lh: [0.25, 0.45, 1.25], rh: [-0.25, 0.6, 1.1], hx: 0.3, mouth: 0.5 };
      p = lerpPose(p, mixIn(p, reach), w);
    }
    if (o.throwU != null && o.throwU > -0.4 && o.throwU < 0.6) {
      var cock = mixIn(p, { ty: -1.0, rh: [-1.3, 2.7, -0.7], lh: [0.6, 2.2, 1.2], brow: 1 }), fire = mixIn(p, { ty: 0.5, tx: 0.6, rh: [0.3, 2.0, 1.8], lh: [0.6, 1.3, 0.5], mouth: 0.6 });
      p = sample([[-0.4, p], [-0.05, cock], [0.08, fire, 'out'], [0.6, p]], o.throwU);
    }
    return p;
  }
  function runner(o) { // o: { speed, phase, slide, cheer, time }
    var k = clamp(o.speed / 20, 0, 1), p;
    if (o.cheer) {
      var j = Math.abs(Math.sin((o.time || 0) * 6));
      return mixIn(READY, { hip: 1.36 + j * 0.25, tx: -0.1, lh: [0.6, 3.3, 0.2], rh: [-0.6, 3.3, 0.2], le: [1, 0, 0], re: [-1, 0, 0], lf: [0.4, 0.13 + j * 0.25, 0], rf: [-0.4, 0.13 + j * 0.25, 0], mouth: 1, browY: 1, smile: 1 });
    }
    p = k > 0.05 ? run(o.phase, Math.max(k, 0.6), { tx: 0.42 }) : mixIn(READY, { hip: 1.25, tx: 0.2, lh: [0.6, 1.2, 0.4], rh: [-0.6, 1.2, 0.4] });
    if (o.slide) p = lerpPose(p, { hip: 0.45, tx: -0.9, lf: [0.3, 0.3, 1.6], rf: [-0.3, 0.6, 1.0], lh: [0.6, 2.6, -0.4], rh: [-0.6, 2.6, -0.4], mouth: 0.8 }, smooth(o.slide));
    return p;
  }

  return { batter: batter, batterBat: batterBat, pitcher: pitcher, catcher: catcher, ump: ump, fielder: fielder, runner: runner, run: run, hands: hands, STANCE: STANCE, mixIn: mixIn, blinkAt: blinkAt };
})();
