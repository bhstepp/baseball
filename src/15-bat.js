// 15-bat.js — BB.Bat: swing -> contact (ev / launch / spray) and the batted-ball play. Owned by the physics agent.
// World coords per docs/CONTRACT.md (feet; +y to centre field, +x to the first-base side). Spray 0 = centre,
// negative = left field. All Play times (hang, catchT, dur, ballAt/fielderAt t) are ANIMATION seconds: the ball
// physics runs in real seconds and is played back TS times faster so long flies don't drag.
(function () {
  var K = BB.K, U = BB.U, D2R = Math.PI / 180;
  var TS = 1.25;                       // physics seconds per animation second
  var DRAG = 0.00175, LIFT = 0.0005, G = 32.17;
  var RUN = [0, 4.25, 7.7, 11.3];       // batter-runner arrival times (physics s) at 1B, 2B, 3B
  var THROW = 120;                     // ft/s

  // ---------------------------------------------------------------- fielders
  var FIELDERS = {
    P: { x: 0, y: 56 }, C: { x: 0, y: -4 }, '1B': { x: 66, y: 86 }, '2B': { x: 34, y: 142 }, SS: { x: -34, y: 142 },
    '3B': { x: -64, y: 86 }, LF: { x: -150, y: 252 }, CF: { x: 0, y: 312 }, RF: { x: 150, y: 252 },
  };
  var ORDER = ['P', 'C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF'];
  var NAMES = ['pitcher', 'catcher', 'first baseman', 'second baseman', 'shortstop', 'third baseman', 'left fielder', 'center fielder', 'right fielder'];
  var SHORT = ['the mound', 'the catcher', 'first', 'second', 'short', 'third', 'left', 'center', 'right'];
  function fSpeed(i) { return i >= 6 ? 27 : i >= 2 ? 24 : i === 0 ? 21 : 18; }
  function fReact(i) { return i >= 6 ? 0.3 : 0.22; }

  // ---------------------------------------------------------------- park
  function fenceAt(park, spray) {
    var f = (park && park.fence) || [[-45, 330, 10], [0, 400, 10], [45, 330, 10]];
    if (spray <= f[0][0]) return { dist: f[0][1], height: f[0][2] };
    for (var i = 1; i < f.length; i++) {
      if (spray <= f[i][0]) {
        var k = (spray - f[i - 1][0]) / (f[i][0] - f[i - 1][0] || 1);
        return { dist: U.lerp(f[i - 1][1], f[i][1], k), height: U.lerp(f[i - 1][2], f[i][2], k) };
      }
    }
    var l = f[f.length - 1]; return { dist: l[1], height: l[2] };
  }
  function angOf(x, y) { return Math.atan2(x, y) / D2R; }

  // ---------------------------------------------------------------- swing
  function swing(pitch, timingErr, bat, opts) {
    bat = bat || {}; opts = opts || {};
    var rng = opts.rng || U.rng(U.hashStr('sw' + timingErr + (pitch.id || 0)));
    var power = !!opts.power, chase = !pitch.strike, e = timingErr;
    var bt = (bat.timing || 1) * (power ? 0.75 : 1), w = bt * (chase ? 0.7 : 1), a = Math.abs(e) / w;
    var px = pitch.plate.x, pz = pitch.plate.z;
    var res = { contact: false, label: 'WHIFF', timingErr: e, quality: 0, sweet: false, ev: 0, la: 0, spray: 0, power: power, chase: chase };
    var early = e < 0;

    // how far outside the zone (ft) — reaching for it means more whiffs and weak contact
    var off = Math.max(0, Math.abs(px) - K.ZONE.xMax, K.ZONE.zMin - pz, pz - K.ZONE.zMax);
    var g1 = U.gauss(rng), g2 = U.gauss(rng), g3 = U.gauss(rng), r1 = rng(), r2 = rng();
    if (chase && r1 < U.clamp(0.2 + off * 0.8, 0, 0.9)) return res;
    if (a > 0.16) return res;
    if (a > 0.10) { // way off: a tick foul or nothing
      res.label = early ? 'WAY EARLY' : 'WAY LATE';
      if (r2 > 0.5 * (1 - (a - 0.10) / 0.06)) return res;
      res.contact = true; res.quality = 0.08;
      res.ev = Math.round(48 + r2 * 30); res.la = Math.round(U.clamp(8 + g1 * 25, -20, 80));
      res.spray = Math.round((early ? -1 : 1) * (52 + Math.abs(g2) * 25));
      return res;
    }
    res.contact = true;
    res.label = a <= 0.018 ? 'PERFECT' : a <= 0.035 ? 'GREAT' : a <= 0.06 ? 'GOOD' : early ? 'EARLY' : 'LATE';
    var q = a <= 0.018 ? 1 - 0.05 * a / 0.018 : a <= 0.035 ? 0.95 - 0.12 * (a - 0.018) / 0.017
      : a <= 0.06 ? 0.83 - 0.2 * (a - 0.035) / 0.025 : 0.63 - 0.35 * (a - 0.06) / 0.04;
    var dz = (pz - 2.55) / 1.0, dx = px / 0.9;
    q *= 1 - 0.1 * U.clamp(dx * dx + dz * dz, 0, 1.5);           // edges are a bit harder to barrel
    if (chase) q = Math.min(q * 0.75, 0.5);
    q = U.clamp(q + g3 * 0.025, 0.05, 1);
    res.quality = Math.round(q * 1000) / 1000;
    res.sweet = res.label === 'PERFECT' && q > 0.9 && !chase;

    var top = 105 * (bat.power || 1) * (power ? 1.08 : 1);
    res.ev = Math.round(U.clamp(48 + (top - 48) * Math.pow(q, 1.6) + g1 * 2.5, 45, 118));
    var la = 9 + 18 * q * q + (pz - 2.5) * 12 + (power ? 5 : 0) + (bat.lift || 0);
    res.la = Math.round(U.clamp(la + g2 * (5 + 20 * (1 - q)), -30, 80));
    res.spray = Math.round(U.clamp(e / bt * 480 + px * 10 + U.gauss(rng) * 6, -80, 80));
    return res;
  }

  // ---------------------------------------------------------------- ball flight
  // returns samples [t, x, y, z] every 1/60 physics second plus key events
  function fly(ev, la, spray, park) {
    var v = ev * 1.4667, a = la * D2R, s = spray * D2R, h = v * Math.cos(a);
    var vx = h * Math.sin(s), vy = h * Math.cos(s), vz = v * Math.sin(a);
    var x = 0, y = 0.5, z = 3, t = 0, dt = 1 / 240, lift = la > 0 ? LIFT : -0.0002;
    var pts = [[0, x, y, z]], out = { pts: pts, land: -1, wallT: -1, hr: false, grd: false, crossT: -1, apex: 3, stop: 0, rest: null };
    var phase = 0, bounces = 0, rPrev = 0, step = 0;
    while (t < 14) {
      var vh = Math.hypot(vx, vy), sp = Math.hypot(vh, vz);
      if (phase === 0 || phase === 2) {        // air (2 = cleared the fence, heading for the seats)
        var ax = -DRAG * sp, lz = lift * sp * vh, lh = -lift * sp * vz;
        var hx = vh > 0 ? vx / vh : 0, hy = vh > 0 ? vy / vh : 0;
        vx += (ax * vx + lh * hx) * dt; vy += (ax * vy + lh * hy) * dt; vz += (ax * vz + lz - G) * dt;
      } else {                                // phase 1 or 3: bouncing / rolling on the grass
        vz -= G * dt;
        if (z <= 0 && vz <= 4) {
          z = 0; vz = 0;
          var dec = (12 + 0.12 * vh) * dt;
          if (vh <= dec) { vx = vy = 0; } else { vx *= 1 - dec / vh; vy *= 1 - dec / vh; }
        }
      }
      x += vx * dt; y += vy * dt; z += vz * dt; t += dt;
      if (z > out.apex) out.apex = z;
      var r = Math.hypot(x, y), ang = angOf(x, y);
      if (Math.abs(ang) <= K.FOUL_DEG && phase !== 2) {
        var f = fenceAt(park, ang);
        if (r >= f.dist && rPrev < f.dist) {
          if (z > f.height) {
            if (out.land < 0) { phase = 2; out.hr = true; out.crossT = t; }
            else { out.grd = true; out.crossT = t; phase = 3; }
          } else {                              // off the wall: carom back
            if (out.wallT < 0) out.wallT = t;
            var nx = x / r, ny = y / r, vr = vx * nx + vy * ny;
            vx -= 1.3 * vr * nx; vy -= 1.3 * vr * ny; vx *= 0.6; vy *= 0.6;
            x = nx * (f.dist - 0.5); y = ny * (f.dist - 0.5); r = f.dist - 0.5;
          }
        }
      }
      rPrev = r;
      if (phase === 2) {                          // into the stands: stop on the bleachers
        var f2 = fenceAt(park, U.clamp(ang, -45, 45));
        if (z <= f2.height + 0.35 * (r - f2.dist) && t > out.crossT + 0.05) { out.rest = t; out.landT = t; break; }
      } else if (z <= 0 && vz < 0) {
        if (out.land < 0) { out.land = t; out.landX = x; out.landY = y; }
        if (phase === 0) phase = 1;
        if (phase === 3) { out.rest = t; break; }
        z = 0;
        if (vz < -4) { vz = -vz * (bounces ? 0.35 : 0.45); var fr = bounces ? 0.85 : 0.72; vx *= fr; vy *= fr; bounces++; }
      }
      if (phase === 1 && vx === 0 && vy === 0) { out.rest = t; break; }
      if (++step % 4 === 0) pts.push([t, x, y, Math.max(0, z)]);
    }
    pts.push([t, x, y, Math.max(0, z)]);
    out.stop = t;
    return out;
  }

  function sampleAt(pts, t) {
    if (t <= pts[0][0]) return pts[0];
    var n = pts.length; if (t >= pts[n - 1][0]) return pts[n - 1];
    var i = Math.min(n - 2, Math.floor(t * 60)); // samples are ~1/60 apart
    while (i > 0 && pts[i][0] > t) i--;
    while (i < n - 2 && pts[i + 1][0] < t) i++;
    var A = pts[i], B = pts[i + 1], k = (t - A[0]) / ((B[0] - A[0]) || 1);
    return [t, A[1] + (B[1] - A[1]) * k, A[2] + (B[2] - A[2]) * k, A[3] + (B[3] - A[3]) * k];
  }

  // can a fielder make a play on the ball at (x, y)? fair and inside the fence, or catchable foul ground
  function playable(park, x, y, air) {
    var r = Math.hypot(x, y), ang = angOf(x, y), aa = Math.abs(ang);
    if (aa <= K.FOUL_DEG) return r <= fenceAt(park, ang).dist - 1.5;
    if (!air) return false;
    if (y < -25) return false;
    var off = aa >= 135 ? r : r * Math.sin(Math.min(aa - 45, 90) * D2R);
    return off <= 30 && r < 260;
  }

  // ---------------------------------------------------------------- keyframed paths
  function track(keys) { // keys [[t, x, y], ...] in physics seconds, sorted
    return function (t) {
      if (t <= keys[0][0]) return { x: keys[0][1], y: keys[0][2] };
      for (var i = 1; i < keys.length; i++) if (t <= keys[i][0]) {
        var A = keys[i - 1], B = keys[i], k = (t - A[0]) / ((B[0] - A[0]) || 1);
        return { x: A[1] + (B[1] - A[1]) * k, y: A[2] + (B[2] - A[2]) * k };
      }
      var L = keys[keys.length - 1]; return { x: L[1], y: L[2] };
    };
  }
  function runTo(i, from, to, tStart, tLatest, stopShort) {
    var dx = to.x - from.x, dy = to.y - from.y, d = Math.hypot(dx, dy), go = Math.max(0, d - (stopShort || 0));
    var ex = from.x + (d ? dx / d * go : 0), ey = from.y + (d ? dy / d * go : 0);
    var tArr = tStart + go / fSpeed(i);
    if (tLatest != null) tArr = Math.min(tArr, Math.max(tStart + 0.05, tLatest));
    return [[0, from.x, from.y], [tStart, from.x, from.y], [tArr, ex, ey]];
  }

  // ---------------------------------------------------------------- calls
  function dirName(sp) {
    return sp < -30 ? 'left' : sp < -11 ? 'left-center' : sp <= 11 ? 'center' : sp <= 30 ? 'right-center' : 'right';
  }
  function fill(rng, list, o) {
    return U.pick(rng, list).replace(/\{(\w+)\}/g, function (m, k) { return o[k]; });
  }
  var CALLS = {
    HR: ['Deep to {dir}... GONE!', 'Way back in {dir}... it\'s OUTTA HERE!', '{dist} feet to {dir}. See ya!',
      'A no-doubter to {dir}!', 'Kiss it goodbye! {dist} feet to {dir}.', 'Launched into the {dir} field seats!'],
    HRjust: ['Back, back, back... it\'s GONE! Just over in {dir}.', 'Wall-scraper in {dir}... it\'s gone!', 'Will it stay up? ... It\'s OUT in {dir}!'],
    HRbomb: ['Absolutely CRUSHED. {dist} feet to {dir}!', 'Moonshot! {dist} feet and still rising!', 'Into the next zip code: {dist} feet!'],
    '1Bline': ['Line drive single to {dir}.', 'Frozen rope into {dir}. Base hit!', 'Stung on a line to {dir} for a single.'],
    '1Bground': ['Grounder through the hole into {dir}!', 'Seeing-eye single into {dir}.', 'Chopped past the infield, base hit.'],
    '1Bbloop': ['Bloop... and it drops in {dir}!', 'Dunker falls in {dir}. Single.', 'Flare to shallow {dir}, nobody gets there.'],
    '1Binf': ['Slow roller to {pos}... beats the throw!', 'Infield single, legged it out!', 'Chopper to {pos}, no play!'],
    '1Bfly': ['Drops in front of the {name}. Single.', 'Lands in {dir}, single.'],
    '2B': ['Into the gap in {dir}! Stand-up double.', 'Split the outfielders in {dir}. Two-bagger!', 'Ripped down the line in {dir}, double!'],
    '2Bwall': ['Off the wall in {dir}! Double!', 'Clangs off the fence in {dir}, in with two.', 'Wall ball in {dir}! Double.'],
    '2Bgrd': ['One hop over the wall. Ground-rule double!', 'Bounces into the seats in {dir}: ground-rule double.'],
    '3B': ['Rolling to the corner in {dir}... he\'s in with a TRIPLE!', 'Into the gap and to the wall! Triple!', 'He\'s digging for third... SAFE! Triple!'],
    OUTfly: ['Fly ball to {dir}, the {name} camps under it.', 'Lazy fly to {dir}. Out.', 'Routine fly, {name} squeezes it.'],
    OUTdeep: ['Deep to {dir}... caught at the track!', 'Hit a ton, but the {name} hauls it in.', 'Back, back... and caught on the warning track.'],
    OUTline: ['Lined right at the {name}.', 'Scorched... but snared by the {name}!', 'Hard liner, right at {pos}. Out.'],
    OUTdive: ['DIVING CATCH by the {name}! Robbed!', 'What a grab by the {name}!', 'He lays out and makes the catch!'],
    OUTground: ['Grounder to {pos}, throw to first. Out.', 'Routine two-hopper to {pos}.', 'Rolled over it, {pos} to first.'],
    OUTpop: ['Pop-up, the {name} has it.', 'Sky-high pop... caught.', 'Got under that one. Infield fly, out.'],
    OUTfoul: ['Foul pop... the {name} squeezes it.', 'Drifting into foul ground... caught by the {name}.'],
    FOUL: ['Fouled back.', 'Foul ball, {side} side.', 'Hooked foul down the line.', 'Spun off foul.', 'Got a piece. Foul.'],
  };

  // ---------------------------------------------------------------- play
  function play(sw, park, rng, opts) {
    opts = opts || {}; rng = rng || U.rng(U.hashStr('pl' + sw.ev + sw.la + sw.spray));
    var fl = fly(sw.ev, sw.la, sw.spray, park), pts = fl.pts;
    var n = pts.length, i, k, F = ORDER.map(function (p) { return FIELDERS[p]; });
    var landT = fl.land >= 0 ? fl.land : fl.stop, landX = fl.land >= 0 ? fl.landX : pts[n - 1][1], landY = fl.land >= 0 ? fl.landY : pts[n - 1][2];
    var landAng = angOf(landX, landY), foulLand = Math.abs(landAng) > K.FOUL_DEG || landY < 0;
    var hardness = sw.ev * 1.4667;

    // ---- who gets to it first: scan the path; air catches need z <= 8.5, ground plays z <= 3.5
    var by = -1, tf = -1, bx = 0, byy = 0, air = false, dive = false;
    for (k = 1; k < n && by < 0; k++) {
      var P = pts[k], t = P[0], isAir = fl.land < 0 || t < fl.land;
      if (fl.hr && t >= fl.crossT) break;
      if (isAir ? P[3] > 8.5 : P[3] > 3.5) continue;
      if (!isAir && foulLand) break;
      if (!playable(park, P[1], P[2], isAir)) continue;
      for (i = 0; i < 9; i++) {
        var d = Math.hypot(P[1] - F[i].x, P[2] - F[i].y);
        var reach = isAir ? (i >= 6 ? 3.5 : 3) : (i >= 6 ? 4 : 5 * U.clamp(1.5 - hardness / 140, 0.45, 1));
        if (t >= fReact(i) + Math.max(0, d - reach) / fSpeed(i)) {
          by = i; tf = t; bx = P[1]; byy = P[2]; air = isAir;
          dive = isAir && d > 25 && t < fReact(i) + d / fSpeed(i) - 0.05;
          break;
        }
      }
    }

    var type, outKind = null, desc, call = 'OUT', throwTo = null, bases = 0, retrieve = by;
    var o = { dir: dirName(landAng), dist: 0, name: '', pos: '', side: sw.spray < 0 ? 'third-base' : 'first-base' };
    var carry = Math.hypot(landX, landY);
    if (fl.hr) {
      type = 'HR'; by = -1;
      carry = Math.hypot(pts[n - 1][1], pts[n - 1][2]);
    } else if (by >= 0 && air) {
      type = 'OUT';
      var deepFly = carry > 250;
      outKind = sw.la >= 48 || (fl.apex > 70 && carry < 180) ? 'pop' : sw.la < 18 ? 'line' : 'fly';
      throwTo = by >= 6 ? 2 : -1;
      call = foulLand ? 'OUTfoul' : dive ? 'OUTdive' : outKind === 'pop' ? 'OUTpop' : outKind === 'line' ? 'OUTline' : deepFly ? 'OUTdeep' : 'OUTfly';
    } else if (foulLand) {
      type = 'FOUL'; by = -1; call = 'FOUL';
    } else {
      if (by < 0) { // ball stopped somewhere nobody reached in the scan: nearest fielder runs it down
        var best = 1e9, end = pts[n - 1];
        for (i = 0; i < 9; i++) {
          var tt = fReact(i) + Math.hypot(end[1] - F[i].x, end[2] - F[i].y) / fSpeed(i);
          if (tt < best) { best = tt; by = i; }
        }
        tf = Math.max(best, end[0]); bx = end[1]; byy = end[2];
      }
      retrieve = by;
      var r0 = Math.hypot(bx, byy), b1 = K.BASES[1];
      if (fl.grd) { type = '2B'; call = '2Bgrd'; throwTo = 2; }
      else if (by < 6 && r0 < 175) { // infield play: throw to first
        var arrive = tf + 0.55 + Math.hypot(bx - b1.x, byy - b1.y) / THROW;
        throwTo = 1;
        if (arrive < RUN[1]) { type = 'OUT'; outKind = 'ground'; call = 'OUTground'; }
        else { type = '1B'; call = '1Binf'; }
      } else { // outfield: take extra bases if the throw can't beat the runner
        bases = 1;
        for (var b = 2; b <= 3; b++) {
          var B = K.BASES[b], dd = Math.hypot(bx - B.x, byy - B.y);
          var thr = tf + 0.9 + dd / 110 + (dd > 220 ? 0.6 : 0);
          if (RUN[b] + 0.3 < thr) bases = b; else break;
        }
        type = bases + 'B';
        throwTo = bases === 3 ? 3 : 2;
        if (bases === 1) call = sw.la < 6 ? '1Bground' : sw.la < 20 ? '1Bline' : carry < 230 ? '1Bbloop' : '1Bfly';
        else if (bases === 2) call = fl.wallT >= 0 ? '2Bwall' : '2B';
        else call = '3B';
      }
    }
    if (by >= 0) { o.name = NAMES[by]; o.pos = SHORT[by]; }
    o.dist = Math.round(carry);
    if (type === 'HR') {
      var fz = fenceAt(park, U.clamp(sw.spray, -45, 45));
      call = carry < fz.dist + 25 ? 'HRjust' : carry > 445 ? 'HRbomb' : 'HR';
    }
    desc = fill(rng, CALLS[call], o);

    // ---- ball path after the play is made: glove, then a throw
    var HOLD = 0.35, thr0 = -1, thr1 = -1, tgt = null, glove = null;
    if (by >= 0) {
      glove = { x: bx, y: byy };
      if (throwTo === -1) tgt = { x: FIELDERS.P.x, y: FIELDERS.P.y };
      else if (throwTo != null) tgt = K.BASES[throwTo];
      if (tgt) {
        thr0 = tf + HOLD;
        var td = Math.hypot(tgt.x - bx, tgt.y - byy);
        thr1 = thr0 + td / (throwTo === -1 ? 60 : THROW) + (td > 230 ? 0.5 : 0);
      }
    }
    var endPhys;
    if (type === 'HR') endPhys = Math.min(Math.max(fl.stop + 0.8 * TS, fl.crossT + 0.7 * TS), 5 * TS);
    else if (type === 'FOUL') endPhys = U.clamp(landT + 0.6 * TS, K.FIELD_MIN * TS, 3.5 * TS);
    else endPhys = U.clamp((thr1 > 0 ? thr1 : tf + HOLD) + 0.35 * TS, K.FIELD_MIN * TS, 7.5 * TS);

    function ballPhys(t) {
      if (by < 0 || t < tf) { var s = sampleAt(pts, t); return { x: s[1], y: s[2], z: s[3] }; }
      if (thr0 < 0 || t < thr0) return { x: glove.x, y: glove.y, z: 4 };
      var u = Math.min(1, (t - thr0) / (thr1 - thr0)), dist = Math.hypot(tgt.x - glove.x, tgt.y - glove.y);
      return { x: U.lerp(glove.x, tgt.x, u), y: U.lerp(glove.y, tgt.y, u), z: 4 + dist * 0.05 * 4 * u * (1 - u) };
    }

    // ---- fielder movement (keyframes in physics seconds)
    var tracks = [], focus = by >= 0 ? { x: bx, y: byy } : { x: landX, y: landY };
    if (type === 'HR') { var fc = fenceAt(park, U.clamp(sw.spray, -45, 45)); focus = { x: Math.sin(sw.spray * D2R) * (fc.dist - 6), y: Math.cos(sw.spray * D2R) * (fc.dist - 6) }; }
    var cover = -1;
    if (throwTo === 1) cover = by === 2 ? 0 : 2;
    else if (throwTo === 2) cover = sw.spray > 0 ? 4 : 3;
    else if (throwTo === 3) cover = 5;
    var nearOF = -1, nd = 1e9;
    for (i = 6; i < 9; i++) if (i !== by) { var q = Math.hypot(focus.x - F[i].x, focus.y - F[i].y); if (q < nd) { nd = q; nearOF = i; } }
    for (i = 0; i < 9; i++) {
      var keys;
      if (i === by) {
        keys = runTo(i, F[i], { x: bx, y: byy }, fReact(i), tf);
      } else if (i === cover) {
        var base = throwTo === -1 ? FIELDERS.P : K.BASES[throwTo];
        keys = runTo(i, F[i], { x: base.x, y: base.y }, fReact(i), null, 1.5);
      } else if ((type === 'HR' || (focus.y > 150 && by >= 6) || (by < 0 && type !== 'FOUL')) && i === nearOF) {
        keys = runTo(i, F[i], focus, fReact(i), null, type === 'HR' ? 0 : 25);
      } else if (i >= 2) { // a couple of steps toward the action
        var dx = focus.x - F[i].x, dy = focus.y - F[i].y, dd2 = Math.hypot(dx, dy) || 1, st = Math.min(i >= 6 ? 30 : 8, dd2 * 0.3);
        keys = [[0, F[i].x, F[i].y], [fReact(i), F[i].x, F[i].y], [fReact(i) + st / fSpeed(i) * 1.6, F[i].x + dx / dd2 * st, F[i].y + dy / dd2 * st]];
      } else keys = [[0, F[i].x, F[i].y]];
      tracks.push(track(keys));
    }

    var hangPhys = type === 'HR' ? fl.stop : by >= 0 && air ? tf : landT;
    var res = {
      type: type, outKind: outKind, ev: sw.ev, la: sw.la, spray: sw.spray,
      dist: Math.round(by >= 0 && !air && type !== 'HR' ? Math.hypot(bx, byy) : carry),
      landing: type === 'HR' ? { x: pts[n - 1][1], y: pts[n - 1][2] } : { x: landX, y: landY },
      apex: Math.round(fl.apex), dur: endPhys / TS, hang: hangPhys / TS,
      ballAt: function (t) { return ballPhys(Math.max(0, t) * TS); },
      fielders: ORDER.slice(),
      fielderAt: function (j, t) { return tracks[j](Math.max(0, t) * TS); },
      catchBy: by, catchT: by >= 0 ? tf / TS : -1,
      desc: desc, wall: fl.wallT >= 0,
      // ---- extras (see report)
      carry: Math.round(carry),                 // ft the ball travelled in the air (HR: to where it lands in the seats)
      wallT: fl.wallT >= 0 ? fl.wallT / TS : -1,
      fenceT: fl.crossT >= 0 ? fl.crossT / TS : -1, // HR / ground-rule double: when it crosses the fence
      foulCaught: type === 'OUT' && foulLand,
      throwTo: throwTo == null ? null : throwTo, // base index the ball is thrown to (1..3), -1 = back to the pitcher
      throwT: thr0 >= 0 ? [thr0 / TS, thr1 / TS] : null,
      deep: carry > 250,
      sacFlyable: type === 'OUT' && outKind === 'fly' && carry > 250 && !foulLand,
      dpable: type === 'OUT' && outKind === 'ground' && by >= 0 && by < 6 && tf < 2.3,
      infieldHit: call === '1Binf',
      groundRule: !!fl.grd,
      timeScale: TS,
    };
    return res;
  }

  BB.Bat = { swing: swing, play: play, fenceAt: fenceAt, FIELDERS: FIELDERS, ORDER: ORDER, _fly: fly, TIME_SCALE: TS };
})();
