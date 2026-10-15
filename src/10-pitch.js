// 10-pitch.js — BB.Pitch: pitch selection, location and flight path. Owned by the physics agent.
// Coordinates (feet, see docs/CONTRACT.md): origin = centre of home plate, +y toward the pitcher, +x toward the
// first-base side (catcher's right), +z up. A pitch is fully described by its seeded params; pos() is pure.
(function () {
  var K = BB.K, U = BB.U;

  // spd = mph as a fraction of the pitcher's fastball velo. bx/bz = total break in feet as seen by the catcher for a
  // RIGHT-handed pitcher (negative bx = arm side = catcher's left); mirrored for lefties. p = lateness exponent
  // (break offset grows ~ s^p, s = t/T, so higher p = later, sharper break). arc = extra mid-flight loft (ft).
  var TYPES = {
    FB: { name: 'Fastball',    abbr: 'FB', spd: 1.00, bx: -0.45, bz:  0.35, p: 2.0, arc: 0.0 },
    SI: { name: 'Sinker',      abbr: 'SI', spd: 0.98, bx: -0.85, bz: -0.65, p: 2.3, arc: 0.0 },
    CT: { name: 'Cutter',      abbr: 'CT', spd: 0.94, bx:  0.50, bz: -0.10, p: 2.6, arc: 0.1 },
    SL: { name: 'Slider',      abbr: 'SL', spd: 0.88, bx:  1.25, bz: -0.55, p: 2.8, arc: 0.3 },
    CB: { name: 'Curveball',   abbr: 'CB', spd: 0.82, bx:  0.75, bz: -1.70, p: 2.6, arc: 1.3 },
    CH: { name: 'Changeup',    abbr: 'CH', spd: 0.86, bx: -0.80, bz: -0.85, p: 2.4, arc: 0.4 },
    SP: { name: 'Splitter',    abbr: 'SP', spd: 0.89, bx: -0.20, bz: -1.45, p: 3.2, arc: 0.2 },
    KN: { name: 'Knuckleball', abbr: 'KN', spd: 0.78, bx:  0.00, bz: -0.30, p: 2.0, arc: 0.6, wobble: true },
    EE: { name: 'Eephus',      abbr: 'EE', spd: 0.60, bx:  0.25, bz:  0.00, p: 2.0, arc: 7.5 },
    SC: { name: 'Screwball',   abbr: 'SC', spd: 0.85, bx: -1.30, bz: -1.00, p: 2.7, arc: 0.4 },
  };
  var BREAKERS = { SL: 1, CB: 1, CH: 1, SP: 1, SC: 1, KN: 1, CT: 0 };

  // Slowed-for-playability flight time: 95 mph -> 0.70 s, 80 -> 0.85 s, 55 -> 1.30 s.
  function flightTime(mph) { return 0.70 * Math.pow(95 / Math.max(40, mph), 1.13); }

  // Release point by hand and windup (RH pitcher's arm is on the catcher's LEFT, -x).
  var LOOK = { classic: [1.75, 6.0], highkick: [1.55, 6.35], sidearm: [2.75, 4.7], submarine: [2.35, 2.6] };
  function release(p) {
    var look = (p && p.look) || {}, r = LOOK[look.windup] || LOOK.classic, side = p && p.hand === 'L' ? 1 : -1;
    var z = r[1] + (look.build === 'tall' ? 0.3 : look.build === 'stout' ? -0.2 : look.build === 'lanky' ? 0.15 : 0);
    return { x: side * r[0], y: K.RELEASE_Y, z: z };
  }

  function zoneProb(ctx, control) {
    if (ctx.derby) return 0.85;
    var b = ctx.balls || 0, s = ctx.strikes || 0, p = 0.45 + 0.25 * control;
    if (s > b) p -= 0.08;
    if (s === 2 && b < 3) p -= 0.12;
    if (b > s) p += 0.10;
    if (b === 3) p += 0.15;
    return U.clamp(p, 0.2, 0.92);
  }

  function make(pitcher, ctx, rng) {
    pitcher = pitcher || {}; ctx = ctx || {};
    var control = pitcher.control == null ? 0.5 : pitcher.control, stuff = pitcher.stuff == null ? 0.5 : pitcher.stuff;
    var velo = pitcher.velo || 90, ars = {}, k;
    for (k in (pitcher.arsenal || { FB: 1 })) if (TYPES[k] && pitcher.arsenal[k] > 0) ars[k] = pitcher.arsenal[k];
    if (!Object.keys(ars).length) ars = { FB: 1 };
    // count leans: ahead -> more breaking stuff, behind -> more fastballs
    var ahead = (ctx.strikes || 0) - (ctx.balls || 0);
    if (!ctx.derby && ars.FB && ahead !== 0) ars.FB *= ahead > 0 ? 0.8 : 1.35;
    var type = U.pickWeighted(rng, ars), T0 = TYPES[type];

    var mph = type === 'EE' ? 50 + rng() * 8 : type === 'KN' ? Math.min(velo * T0.spd, 77) - 2 + rng() * 4
      : velo * T0.spd - 1 + rng() * 2;
    mph = Math.round(mph);
    var T = flightTime(mph), rel = release(pitcher), mirror = pitcher.hand === 'L' ? -1 : 1;

    // ---- location
    var inZone = rng() < zoneProb(ctx, control), tx, tz;
    var sd = ctx.derby ? 0.09 : 0.08 + 0.32 * (1 - control);
    var zx = K.ZONE.xMax, zl = K.ZONE.zMin, zh = K.ZONE.zMax, zm = (zl + zh) / 2;
    if (inZone) {
      if (ctx.derby) {
        tx = U.clamp(U.gauss(rng) * 0.28, -0.55, 0.55);
        tz = U.clamp(zm + U.gauss(rng) * 0.32, 2.0, 3.05);
      } else { // better control paints the edges
        var e = 1 / (1 + 1.4 * control), ux = rng() * 2 - 1, uz = rng() * 2 - 1;
        tx = Math.sign(ux) * Math.pow(Math.abs(ux), e) * (zx - 0.1);
        tz = zm + Math.sign(uz) * Math.pow(Math.abs(uz), e) * ((zh - zl) / 2 - 0.1);
      }
    } else {
      var r = rng(), lowBias = BREAKERS[type] ? 0.55 : 0.2;
      if (r < lowBias) { tx = (rng() * 2 - 1) * 0.7; tz = zl - 0.35 - rng() * 0.75; }                    // in the dirt-ish
      else if (r < lowBias + (1 - lowBias) * 0.5) { tx = zx + 0.3 + rng() * 0.6; tz = zm + (rng() * 2 - 1) * 0.8; } // away
      else if (r < lowBias + (1 - lowBias) * 0.75) { tx = -(zx + 0.3 + rng() * 0.45); tz = zm + (rng() * 2 - 1) * 0.8; } // in
      else { tx = (rng() * 2 - 1) * 0.6; tz = zh + 0.3 + rng() * 0.6; }                                   // up
    }
    var px = U.clamp(tx + U.gauss(rng) * sd, -2.6, 2.6), pz = U.clamp(tz + U.gauss(rng) * sd, 0.6, 5.2);

    // ---- movement (seeded, deterministic)
    var amt = (0.55 + 0.9 * stuff) * (0.85 + rng() * 0.3);
    var bx = T0.bx * amt * mirror, bz = T0.bz * amt, wob = null;
    if (T0.wobble) {
      wob = [];
      for (var i = 0; i < 4; i++) wob.push({ a: (0.25 + 0.35 * rng()) * (0.6 + stuff), f: 1.2 + rng() * 2.2, ph: rng() * 6.283 });
      bx = (rng() * 2 - 1) * 0.8; bz = -0.2 - rng() * 0.6;
    }
    var pitch = {
      id: ctx.id || 0, type: type, name: T0.name, mph: mph, T: T,
      release: rel, plate: { x: px, z: pz }, strike: false,
      _b: { x: bx, z: bz }, _p: T0.p, _arc: 0.55 + T0.arc, _wob: wob,
    };
    pitch.strike = isStrike(pitch);
    return pitch;
  }

  function isStrike(p) {
    var r = K.BALL_R, x = p.plate.x, z = p.plate.z;
    return Math.abs(x) <= K.ZONE.xMax + r && z >= K.ZONE.zMin - r && z <= K.ZONE.zMax + r;
  }

  var YD = 0.08; // slight deceleration: y progress f(s) = s(1+YD) - YD s^2
  function pos(p, t) {
    var T = p.T, r = p.release, b = p._b, pl = p.plate;
    if (t <= T) {
      var s = Math.max(0, t / T), sp = Math.pow(s, p._p), x, z;
      x = r.x + (pl.x - b.x - r.x) * s + b.x * sp;
      z = r.z + (pl.z - b.z - r.z) * s + b.z * sp + p._arc * 4 * s * (1 - s);
      if (p._wob) {
        var env = Math.sin(Math.PI * s) * s; // grows toward the plate, zero at both ends
        x += env * (p._wob[0].a * Math.sin(6.283 * p._wob[0].f * s + p._wob[0].ph) + 0.5 * p._wob[1].a * Math.sin(6.283 * p._wob[1].f * 2 * s + p._wob[1].ph));
        z += env * (p._wob[2].a * Math.sin(6.283 * p._wob[2].f * s + p._wob[2].ph) + 0.5 * p._wob[3].a * Math.sin(6.283 * p._wob[3].f * 2 * s + p._wob[3].ph));
      }
      return { x: x, y: K.RELEASE_Y * (1 - (s * (1 + YD) - YD * s * s)), z: z };
    }
    // past the plate: carry on along the final direction to the catcher's mitt (y = -3), then stay there
    var vy = K.RELEASE_Y * (1 - YD) / T;                         // ft/s along -y at the plate
    var dxs = (pl.x - b.x - r.x) + b.x * p._p, dzs = (pl.z - b.z - r.z) + b.z * p._p - 4 * p._arc;
    var d = Math.min(3, vy * (t - T)), k = d / (vy * T);
    return { x: pl.x + dxs * k, y: -d, z: Math.max(0.4, pl.z + dzs * k) };
  }

  BB.Pitch = { TYPES: TYPES, make: make, pos: pos, isStrike: isStrike, flightTime: flightTime, releasePoint: release };
})();
