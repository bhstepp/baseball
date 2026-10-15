// 35-scene.js — BB.Render: the bat scene, the field scene, the title backdrop, HUD and stamps, printed through
// BB.Riso. Owned by the render agent.
//
// Every frame: load the cached static background separations for the scene (built once per park / ink set / size),
// draw the moving pieces into the same three ink layers (each a proper separation that knocks out what is behind it),
// then print the layers onto paper with multiply + misregistration + grain.
(function () {
  var K = BB.K, U = BB.U, R = BB.Riso;
  var PI = Math.PI, TAU = PI * 2;
  var M = 24;                         // layer margin (css px) so misregistration / shake never shows a bare edge
  var clamp = U.clamp, lerp = U.lerp, smooth = U.smooth;

  var S = {
    canvas: null, ctx: null, W: 390, H: 844, dpr: 1, P: null,
    inkPick: null, inks: null, inkKey: '',
    cache: {}, cam: null, fcam: null, fieldKey: '', fbake: null,
    freezeT: 0, lastTime: 0, dprReq: 1, qual: 1, perf: [], lastScene: '', built: 0,
  };
  var P = null;                        // the press currently being drawn into

  var DEFAULT_PARK = {
    id: 'p_default', name: 'Halftone Field', town: 'Halftone', inkset: 'classic',
    fence: [[-45, 330, 10], [-22, 372, 10], [0, 404, 10], [22, 372, 10], [45, 330, 10]],
    features: { scoreboard: true, lights: true, billboard: 'HALFTONE HARDBALL', water: 'none', hill: false, skyline: 'city' },
  };
  var DEFAULT_PITCHER = { id: 'p_default', name: 'Pitcher', hand: 'R', look: { build: 'tall', hair: 'none', windup: 'classic', number: 21 } };

  // ink recipes (slot coverage). Grass = A x C, dirt = B x C, skin = light B + C.
  var SKIN = { b: 0.26, c: 0.5 };
  var GLOVE = { a: 0.45, b: 0.6, c: 0.9 };
  var DIRT = { a: 0.05, b: 0.36, c: 0.78 };
  var DIRT2 = { a: 0.12, b: 0.46, c: 0.9 };
  var PAPER = {};
  var A1 = { a: 1 }, B1 = { b: 1 }, C1 = { c: 1 };

  // ------------------------------------------------------------------ helpers
  function fill(p, inks, o) { P.fill(p, inks, o); }
  function stroke(p, inks, w, o) { P.stroke(p, inks, w, o); }
  function circ(x, y, r) { return R.circle(x, y, r); }
  function ell(x, y, rx, ry, rot) { return R.ellipse(x, y, rx, ry, rot); }
  function rect(x, y, w, h) { return R.rect(x, y, w, h); }
  function seg(x0, y0, x1, y1) { var p = new Path2D(); p.moveTo(x0, y0); p.lineTo(x1, y1); return p; }
  function curve(pts) {           // smooth path through [[x,y],...]
    var p = new Path2D(); p.moveTo(pts[0][0], pts[0][1]);
    if (pts.length === 2) { p.lineTo(pts[1][0], pts[1][1]); return p; }
    for (var i = 1; i < pts.length - 1; i++) {
      var last = i === pts.length - 2;
      var mx = last ? pts[i + 1][0] : (pts[i][0] + pts[i + 1][0]) / 2, my = last ? pts[i + 1][1] : (pts[i][1] + pts[i + 1][1]) / 2;
      p.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    return p;
  }
  // limb with an A keyline
  function limb(pts, w, inks, kl) {
    var p = curve(pts);
    if (kl) stroke(p, A1, w + kl * 2);
    stroke(p, inks, w);
  }
  function hash(s) { return U.hashStr(String(s || '')); }
  function fitFont(str, maxW, px, fontFn) {
    fontFn = fontFn || R.display;
    var f = fontFn(px), w = P.measure(str, f);
    if (w > maxW) { px = px * maxW / w; f = fontFn(px); }
    return { font: f, px: px };
  }
  function ik(ax, az, bx, bz, l1, l2, side) {
    var dx = bx - ax, dz = bz - az, d = Math.sqrt(dx * dx + dz * dz) || 1e-3;
    if (d >= l1 + l2 - 1e-3) return [ax + dx * 0.5, az + dz * 0.5];
    var a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    var mx = ax + dx * a / d, mz = az + dz * a / d;
    return [mx - side * dz * h / d, mz + side * dx * h / d];
  }
  function fenceAt(park, spray) {
    if (BB.Bat && BB.Bat.fenceAt) { try { var r = BB.Bat.fenceAt(park, spray); if (r && r.dist) return r; } catch (e) {} }
    var f = park.fence || DEFAULT_PARK.fence;
    if (spray <= f[0][0]) return { dist: f[0][1], height: f[0][2] };
    for (var i = 1; i < f.length; i++) {
      if (spray <= f[i][0]) {
        var t = (spray - f[i - 1][0]) / (f[i][0] - f[i - 1][0]);
        return { dist: lerp(f[i - 1][1], f[i][1], t), height: lerp(f[i - 1][2], f[i][2], t) };
      }
    }
    var l = f[f.length - 1];
    return { dist: l[1], height: l[2] };
  }
  function feat(park) { return (park && park.features) || DEFAULT_PARK.features; }
  function parkOf(v) { return (v && v.park && v.park.fence) ? v.park : (BB.Content && BB.Content.PARKS && BB.Content.PARKS[0]) || DEFAULT_PARK; }
  function pitchPos(pitch, t) {
    if (BB.Pitch && BB.Pitch.pos && pitch._b) { try { return BB.Pitch.pos(pitch, t); } catch (e) {} }
    if (typeof pitch.pos === 'function') return pitch.pos(t);
    // fallback: straight-ish ballistic interpolation release -> plate, then to the mitt
    var r = pitch.release || { x: -1.7, y: K.RELEASE_Y, z: 6 }, pl = pitch.plate || { x: 0, z: 2.5 }, T = pitch.T || 0.75;
    var s = t / T;
    if (s <= 1) return { x: lerp(r.x, pl.x, s), y: r.y * (1 - s), z: lerp(r.z, pl.z, s) + 1.2 * 4 * s * (1 - s) * 0.4 };
    var k = Math.min(1, (s - 1) * 4);
    return { x: pl.x, y: -3 * k, z: pl.z - 0.2 * k };
  }

  // ------------------------------------------------------------------ bat camera
  // Long-lens camera behind the plate (telephoto keeps the pitcher a readable size on a phone):
  // eye at (-0.35, -16, 5.4) looking straight out along +y; principal point lifted so the zone sits low-middle.
  function layoutBat() {
    var W = S.W, H = S.H;
    S.cam = { x: -0.35, y: -16, z: 5.4, f: Math.min(W * 3.0, H * 1.39), cx: W / 2, cy: H * 0.37 };
  }
  function proj(x, y, z) {
    var c = S.cam, d = Math.max(0.6, y - c.y), s = c.f / d;
    return { x: c.cx + (x - c.x) * s, y: c.cy - (z - c.z) * s, s: s };
  }
  function plateToScreen(x, z) { var p = proj(x, 0, z); return { x: p.x, y: p.y }; }
  function screenToPlate(sx, sy) {
    var c = S.cam, s = c.f / (0 - c.y);
    return { x: c.x + (sx - c.cx) / s, z: c.z - (sy - c.cy) / s };
  }

  // ------------------------------------------------------------------ shared scenery pieces
  // stepped sky bands (no gradients): tones top -> bottom
  function skyBands(y0, y1, tones, warm) {
    var n = tones.length, h = (y1 - y0) / n;
    for (var i = 0; i < n; i++) {
      var inks = { a: tones[i] };
      if (warm && i >= n - warm.length) { var w = warm[i - (n - warm.length)]; inks.b = w[0]; inks.c = w[1]; }
      fill(rect(-M, y0 + i * h - 0.5, S.W + 2 * M, h + 1), inks);
    }
  }
  function cloud(x, y, w, rng) {
    var p = new Path2D(), n = 3 + Math.floor(rng() * 3), h = w * 0.22;
    for (var i = 0; i < n; i++) {
      var cx = x - w / 2 + w * (i + 0.5) / n, r = h * (0.7 + rng() * 0.7);
      p.moveTo(cx + r, y); p.arc(cx, y, r, 0, TAU);
    }
    p.rect(x - w / 2, y - h * 0.1, w, h * 0.65);
    fill(p, PAPER);
    fill(rect(x - w / 2 + 3, y + h * 0.55 - 2, w - 6, 2.2), { c: 0.6 }, { over: true });
  }
  // skyline silhouettes along a baseline (css px). sc = scale (1 at phone size).
  function skyline(kind, x0, x1, base, sc, rng) {
    var i, x, w, h, p;
    var far = { a: 0.55, b: 0.18 }, near = { a: 0.78, b: 0.25 };
    if (kind === 'city' || kind === 'none') {
      x = x0;
      while (x < x1) {
        w = (12 + rng() * 22) * sc; h = (kind === 'none' ? 10 + rng() * 18 : 22 + rng() * 52) * sc;
        p = rect(x, base - h, w, h + 2);
        if (rng() < 0.25) { p.rect(x + w * 0.4, base - h - 8 * sc, w * 0.12, 8 * sc); }
        if (rng() < 0.2) { p.moveTo(x + w * 0.2, base - h); p.lineTo(x + w * 0.5, base - h - 12 * sc); p.lineTo(x + w * 0.8, base - h); }
        fill(p, rng() < 0.5 ? far : near);
        // windows: tiny knocked-out squares, some lit in C
        var win = new Path2D(), lit = new Path2D();
        for (var wy = base - h + 4 * sc; wy < base - 4 * sc; wy += 5 * sc) {
          for (var wx = x + 3 * sc; wx < x + w - 3 * sc; wx += 4.5 * sc) {
            var rr = rng();
            if (rr < 0.35) win.rect(wx, wy, 1.6 * sc, 2 * sc); else if (rr < 0.45) lit.rect(wx, wy, 1.6 * sc, 2 * sc);
          }
        }
        fill(win, PAPER); fill(lit, C1);
        x += w + rng() * 4 * sc;
      }
      if (kind === 'none') { // a blimp
        var bx = x0 + (x1 - x0) * 0.72, by = base - 52 * sc;
        fill(ell(bx, by, 22 * sc, 7.5 * sc), { a: 0.35, b: 0.15 });
        fill(rect(bx - 4 * sc, by + 6 * sc, 8 * sc, 3 * sc), A1);
        P.text('INK', bx, by + 2.6 * sc, R.display(7 * sc), PAPER, { align: 'center' });
      } else { // water tower
        var tx = x0 + (x1 - x0) * (0.2 + rng() * 0.6);
        fill(R.rrect(tx - 7 * sc, base - 70 * sc, 14 * sc, 11 * sc, 3 * sc), near);
        stroke(seg(tx - 5 * sc, base - 59 * sc, tx - 7 * sc, base - 40 * sc), near, 1.2 * sc);
        stroke(seg(tx + 5 * sc, base - 59 * sc, tx + 7 * sc, base - 40 * sc), near, 1.2 * sc);
      }
    } else if (kind === 'barns') {
      // rolling hills + barns + silo + windmill
      p = new Path2D(); p.moveTo(x0 - 10, base + 2);
      for (x = x0 - 10; x <= x1 + 10; x += 8) p.lineTo(x, base - 10 * sc - Math.sin(x * 0.018 + 1) * 8 * sc);
      p.lineTo(x1 + 10, base + 2); p.closePath();
      fill(p, { a: 0.4, c: 0.7 });
      x = x0 + 10 * sc;
      while (x < x1) {
        w = (20 + rng() * 14) * sc; h = w * 0.62;
        var bb = base - 6 * sc - Math.sin(x * 0.018 + 1) * 8 * sc;
        p = new Path2D(); p.moveTo(x, bb); p.lineTo(x, bb - h); p.lineTo(x + w * 0.5, bb - h - w * 0.35); p.lineTo(x + w, bb - h); p.lineTo(x + w, bb); p.closePath();
        fill(p, { b: 0.9, a: 0.15 });
        stroke(seg(x + w * 0.3, bb, x + w * 0.7, bb - h * 0.62), PAPER, 1.2 * sc);
        stroke(seg(x + w * 0.7, bb, x + w * 0.3, bb - h * 0.62), PAPER, 1.2 * sc);
        if (rng() < 0.6) {
          fill(R.rrect(x + w + 3 * sc, bb - h * 1.5, 7 * sc, h * 1.5, 3.5 * sc), { a: 0.5 });
        }
        x += w + (30 + rng() * 50) * sc;
      }
      var mx = x0 + (x1 - x0) * 0.82, my = base - 46 * sc;
      stroke(seg(mx, my, mx - 3 * sc, base - 8 * sc), near, 1.6 * sc); stroke(seg(mx, my, mx + 3 * sc, base - 8 * sc), near, 1.6 * sc);
      fill(R.rays(mx, my, 12 * sc, 8, 0.3, 0.45), near);
    } else if (kind === 'pines') {
      for (var layer = 0; layer < 2; layer++) {
        x = x0 - 6;
        while (x < x1 + 6) {
          h = (layer ? 26 : 36) * sc * (0.6 + rng() * 0.6); w = h * 0.5;
          var bb2 = base + (layer ? 2 : -4) * sc;
          p = new Path2D(); p.moveTo(x, bb2 - h);
          for (var k = 1; k <= 3; k++) { p.lineTo(x + w * 0.5 * k / 3 + w * 0.12, bb2 - h + h * k / 3); p.lineTo(x + w * 0.18 * k / 3, bb2 - h + h * k / 3); }
          for (k = 3; k >= 1; k--) { p.lineTo(x - w * 0.18 * k / 3, bb2 - h + h * k / 3); p.lineTo(x - w * 0.5 * k / 3 - w * 0.12, bb2 - h + h * k / 3); }
          p.closePath();
          fill(p, layer ? { a: 0.85, c: 0.5 } : { a: 0.5, c: 0.35 });
          x += w * (0.5 + rng() * 0.5);
        }
      }
    } else if (kind === 'harbor') {
      // water line, cranes, a lighthouse with a C beam, a freighter
      fill(rect(x0 - 10, base - 8 * sc, x1 - x0 + 20, 10 * sc), { a: 0.45 });
      var wl = new Path2D();
      for (x = x0; x < x1; x += 9 * sc) { wl.moveTo(x, base - 4 * sc); wl.quadraticCurveTo(x + 2.2 * sc, base - 5.8 * sc, x + 4.5 * sc, base - 4 * sc); }
      stroke(wl, PAPER, 0.9 * sc);
      for (i = 0; i < 2; i++) {
        var cx = x0 + (x1 - x0) * (0.18 + i * 0.22), ch = (46 + i * 8) * sc;
        p = new Path2D();
        p.moveTo(cx, base - 8 * sc); p.lineTo(cx, base - ch); p.lineTo(cx + 34 * sc, base - ch); p.moveTo(cx - 10 * sc, base - ch); p.lineTo(cx, base - ch);
        p.moveTo(cx, base - ch * 0.6); p.lineTo(cx + 24 * sc, base - ch);
        stroke(p, near, 2 * sc, { cap: 'butt' });
        stroke(seg(cx + 26 * sc, base - ch, cx + 26 * sc, base - ch * 0.55), near, 0.8 * sc);
      }
      var sx = x0 + (x1 - x0) * 0.55;
      p = R.poly([sx, base - 9 * sc, sx + 70 * sc, base - 9 * sc, sx + 64 * sc, base - 1 * sc, sx + 4 * sc, base - 1 * sc]);
      fill(p, { b: 0.85, a: 0.2 });
      fill(rect(sx + 10 * sc, base - 17 * sc, 40 * sc, 8 * sc), { a: 0.6 });
      var lx = x0 + (x1 - x0) * 0.86;
      fill(R.poly([lx - 5 * sc, base - 6 * sc, lx - 3 * sc, base - 48 * sc, lx + 3 * sc, base - 48 * sc, lx + 5 * sc, base - 6 * sc]), PAPER);
      stroke(R.poly([lx - 5 * sc, base - 6 * sc, lx - 3 * sc, base - 48 * sc, lx + 3 * sc, base - 48 * sc, lx + 5 * sc, base - 6 * sc]), A1, 1);
      fill(rect(lx - 4.4 * sc, base - 30 * sc, 8.8 * sc, 6 * sc), B1);
      fill(rect(lx - 4 * sc, base - 55 * sc, 8 * sc, 7 * sc), C1);
      fill(R.poly([lx, base - 52 * sc, lx - 70 * sc, base - 66 * sc, lx - 70 * sc, base - 40 * sc]), { c: 0.35 }, { over: true });
    } else if (kind === 'desert') {
      x = x0 - 10;
      while (x < x1) {
        w = (40 + rng() * 60) * sc; h = (14 + rng() * 26) * sc;
        p = R.poly([x, base, x + w * 0.18, base - h, x + w * 0.82, base - h, x + w, base]);
        fill(p, rng() < 0.5 ? { b: 0.55, c: 0.8 } : { b: 0.75, c: 0.9, a: 0.12 });
        fill(rect(x + w * 0.18, base - h, w * 0.64, 2.2 * sc), { b: 0.9, c: 1, a: 0.3 }, { over: true });
        x += w * (0.7 + rng() * 0.6);
      }
      for (i = 0; i < 4; i++) {
        var kx = x0 + (x1 - x0) * rng(), kh = (10 + rng() * 10) * sc;
        p = new Path2D();
        p.moveTo(kx, base); p.lineTo(kx, base - kh);
        p.moveTo(kx, base - kh * 0.5); p.lineTo(kx - 4 * sc, base - kh * 0.55); p.lineTo(kx - 4 * sc, base - kh * 0.8);
        p.moveTo(kx, base - kh * 0.4); p.lineTo(kx + 4 * sc, base - kh * 0.45); p.lineTo(kx + 4 * sc, base - kh * 0.75);
        stroke(p, { a: 0.85, c: 0.6 }, 2.4 * sc);
      }
    }
  }

  // crowd: rows of heads + shoulders, batched per ink class per row so front rows hide back rows.
  var CROWD = [{ a: 1 }, { b: 1 }, { c: 1, a: 0.3 }, { b: 0.5, c: 1 }, {}, { a: 0.55, b: 0.35 }, { b: 1, a: 0.35 }];
  function crowd(x0, x1, y0, y1, row, seed, variant, excl, base) {
    var rng = U.rng(seed), vr = U.rng(seed * 31 + variant * 977 + 5), n = CROWD.length;
    if (base) fill(rect(x0, y0 - row * 0.6, x1 - x0, y1 - y0 + row * 0.6), base);
    for (var y = y0; y < y1; y += row) {
      var paths = [], i;
      for (i = 0; i < n; i++) paths.push(null);
      var hr = row * 0.33;
      for (var x = x0 + rng() * row * 0.6; x < x1; x += row * (0.72 + rng() * 0.32)) {
        var ci = Math.floor(rng() * n), jit = rng(), rv = vr();
        if (excl && excl(x, y)) continue;
        if (variant && rv < 0.28) ci = (ci + 1 + Math.floor(rv * 20)) % n;
        var bob = variant && rv > 0.8 ? -row * 0.28 : 0;
        if (jit < 0.06) continue;                       // an empty seat
        var p = paths[ci] || (paths[ci] = new Path2D()), yy = y + bob;
        p.moveTo(x + hr, yy); p.arc(x, yy, hr, 0, TAU);
        p.moveTo(x - hr * 1.65, yy + row * 0.66); p.ellipse(x, yy + row * 0.66, hr * 1.65, hr * 1.1, 0, PI, TAU);
        p.lineTo(x - hr * 1.65, yy + row * 0.66);
        if (variant === 2 && rv > 0.93) { // arms up!
          p.moveTo(x - hr * 1.5, yy + row * 0.3); p.lineTo(x - hr * 2.1, yy - row * 0.5); p.lineTo(x - hr * 1.3, yy - row * 0.5); p.lineTo(x - hr * 0.9, yy + row * 0.3);
        }
      }
      for (i = 0; i < n; i++) if (paths[i]) fill(paths[i], CROWD[i]);
    }
  }
  function lightBank(x, y, w, h, beams) {
    fill(R.rrect(x - w / 2 - 2, y - h / 2 - 2, w + 4, h + 4, 2), A1);
    var p = new Path2D(), cols = Math.max(3, Math.round(w / 6)), rows = Math.max(2, Math.round(h / 6));
    for (var i = 0; i < cols; i++) for (var j = 0; j < rows; j++) {
      var cx = x - w / 2 + (i + 0.5) * w / cols, cy = y - h / 2 + (j + 0.5) * h / rows, r = Math.min(w / cols, h / rows) * 0.36;
      p.moveTo(cx + r, cy); p.arc(cx, cy, r, 0, TAU);
    }
    fill(p, C1);
    if (beams) fill(R.poly([x - w / 2, y + h / 2, x + w / 2, y + h / 2, x + w * 2.6, y + h * 7, x - w * 2.6, y + h * 7]), { c: 0.16 }, { over: true });
  }

  // ------------------------------------------------------------------ BAT background
  function batGeom(park) {
    var W = S.W, H = S.H, c = S.cam, hz = c.cy;
    var f0 = fenceAt(park, 0);
    var g = {
      hz: hz,
      standsTop: hz - H * 0.155,
      eyeX: proj(0, f0.dist, 0).x,
      eyeW: 44 * c.f / (f0.dist - c.y),
      wallTop: proj(0, f0.dist, f0.height).y,
    };
    g.deckY = g.standsTop + (hz - g.standsTop) * 0.44;
    g.bandY0 = g.standsTop - 2; g.bandY1 = hz + 2;
    return g;
  }

  function drawBatBackground(park, variant) {
    var W = S.W, H = S.H, c = S.cam, ft = feat(park), seed = hash(park.id);
    var rng = U.rng(seed), g = batGeom(park), hz = g.hz, i, p, x, y;

    // sky
    skyBands(-M, g.standsTop + 4, [0.42, 0.33, 0.25, 0.18, 0.12], [[0.1, 0.0], [0.16, 0.22]]);
    // sun (or moon) sitting right behind centre field
    var moon = (seed % 3) === 1;
    var sunR = Math.min(W * 0.12, 54), sunX = g.eyeX + (moon ? W * 0.22 : 0), sunY = g.standsTop - (moon ? 46 : 4);
    if (moon) { fill(circ(sunX, sunY, sunR * 0.7), PAPER); fill(circ(sunX - 5, sunY + 3, sunR * 0.18), { a: 0.18 }, { over: true }); fill(circ(sunX + 8, sunY - 7, sunR * 0.1), { a: 0.18 }, { over: true }); }
    else {
      fill(circ(sunX, sunY, sunR * 1.35), { c: 0.3 }, { over: true });
      fill(circ(sunX, sunY, sunR), { c: 1, b: 0.22 });
      for (i = 0; i < 4; i++) fill(rect(sunX - sunR, sunY - sunR * 0.1 + i * sunR * 0.22, sunR * 2, sunR * 0.07 + i * 0.6), { a: 0.25, b: 0.25 }, { over: true });
    }
    // clouds
    var crng = U.rng(seed + 3);
    for (i = 0; i < 3; i++) cloud(W * (0.12 + 0.36 * i + crng() * 0.14), g.standsTop - 50 - crng() * (g.standsTop - 150) * 0.6, 48 + crng() * 50, crng);

    // skyline behind the stands
    skyline(ft.skyline || 'none', -M, W + M, g.standsTop + 2, Math.min(1.2, W / 390), U.rng(seed + 11));

    // light towers (behind the stands roof)
    if (ft.lights) {
      [0.07, 0.93].forEach(function (fx, k) {
        var lx = W * fx, top = g.standsTop - 62;
        stroke(seg(lx, top, lx, g.standsTop + 4), A1, 3);
        var lat = new Path2D();
        for (var yy = top + 6; yy < g.standsTop; yy += 7) { lat.moveTo(lx - 2.5, yy); lat.lineTo(lx + 2.5, yy + 5); }
        stroke(lat, A1, 0.8);
        lightBank(lx, top - 5, 34, 14, false);
      });
    }
    // scoreboard (left) and billboard (right) on top of the stands
    var hasBoard = !!ft.scoreboard;
    if (hasBoard) drawBatScoreboard(park, W * 0.06, g.standsTop - 48, W * 0.36, 52);
    if (ft.billboard) drawBillboard(String(ft.billboard), hasBoard ? W * 0.56 : W * 0.08, g.standsTop - 40, hasBoard ? W * 0.38 : W * 0.5, 30);

    // stands: roof band, upper deck, facade, lower deck. Water replaces a side if the park has it.
    var water = ft.water || 'none';
    var wx0 = water === 'left' ? -M : water === 'right' ? W * 0.62 : water === 'center' ? g.eyeX - g.eyeW * 1.05 : 0;
    var wx1 = water === 'left' ? W * 0.38 : water === 'right' ? W + M : water === 'center' ? g.eyeX + g.eyeW * 1.05 : 0;
    var excl = function (xx, yy) {
      if (water !== 'none' && xx > wx0 && xx < wx1 && (water !== 'center' || yy > g.deckY - 2)) return true;
      return xx > g.eyeX - g.eyeW / 2 - 2 && xx < g.eyeX + g.eyeW / 2 + 2 && yy > g.deckY - 2;
    };
    fill(rect(-M, g.standsTop, W + 2 * M, hz - g.standsTop + 4), { a: 0.85, b: 0.2 });
    crowd(-M, W + M, g.standsTop + 8, g.deckY - 6, 5.2, seed + 21, variant, excl);
    // facade with the park name, knocked out
    fill(rect(-M, g.deckY - 6, W + 2 * M, 10), A1);
    var label = ((park.name || 'BALLPARK') + ' · ').toUpperCase();
    var lf = R.mono(7.2, true), lw = P.measure(label, lf);
    for (x = -M + 4; x < W + M; x += lw) P.text(label, x, g.deckY + 1.6, lf, PAPER);
    // bunting under the roof
    p = new Path2D();
    for (x = -M; x < W + M; x += 18) { p.moveTo(x, g.standsTop); p.arc(x + 9, g.standsTop, 9, 0, PI); }
    fill(rect(-M, g.standsTop - 4, W + 2 * M, 5), A1);
    fill(p, B1);
    var p2 = new Path2D();
    for (x = -M; x < W + M; x += 18) { p2.moveTo(x + 3, g.standsTop + 1); p2.arc(x + 9, g.standsTop + 1, 6, 0, PI); }
    fill(p2, PAPER);
    p2 = new Path2D();
    for (x = -M; x < W + M; x += 18) { p2.moveTo(x + 6, g.standsTop + 1); p2.arc(x + 9, g.standsTop + 1, 3, 0, PI); }
    fill(p2, C1);
    crowd(-M, W + M, g.deckY + 9, hz + 4, 6.6, seed + 22, variant, excl);
    // water
    if (water !== 'none') {
      var wy0 = water === 'center' ? g.deckY + 4 : g.standsTop + 4;
      fill(rect(wx0, wy0, wx1 - wx0, hz - wy0 + 6), { a: 0.5, c: 0.12 });
      var wl = new Path2D(), wr = U.rng(seed + 5);
      for (y = wy0 + 5; y < hz; y += 6) for (x = wx0 + wr() * 8; x < wx1 - 6; x += 12 + wr() * 10) {
        wl.moveTo(x, y); wl.quadraticCurveTo(x + 3, y - 2.2, x + 6, y);
      }
      stroke(wl, PAPER, 1);
      // a little boat
      var bx = (wx0 + wx1) / 2 + 10, by = hz - 12;
      fill(R.poly([bx - 14, by, bx + 14, by, bx + 10, by + 6, bx - 10, by + 6]), { b: 0.9 });
      fill(R.poly([bx - 2, by - 2, bx - 2, by - 22, bx + 12, by - 2]), PAPER);
      stroke(R.poly([bx - 2, by - 2, bx - 2, by - 22, bx + 12, by - 2]), A1, 1);
    }
    // batter's eye: dark slab in centre field (the pitcher reads against it)
    fill(rect(g.eyeX - g.eyeW / 2, g.deckY - 2, g.eyeW, hz - g.deckY + 6), { a: 1, b: 0.25 });
    fill(rect(g.eyeX - g.eyeW / 2, g.deckY - 2, g.eyeW, 2), C1);

    // the outfield wall, projected from the park's fence
    var top = [], bot = [];
    for (var sp = -24; sp <= 24; sp += 1) {
      var fa = fenceAt(park, sp), r = U.rad(sp);
      var X = fa.dist * Math.sin(r), Y = fa.dist * Math.cos(r);
      top.push(proj(X, Y, fa.height)); bot.push(proj(X, Y, -0.5));
    }
    p = new Path2D(); p.moveTo(top[0].x, top[0].y);
    for (i = 1; i < top.length; i++) p.lineTo(top[i].x, top[i].y);
    for (i = bot.length - 1; i >= 0; i--) p.lineTo(bot[i].x, bot[i].y);
    p.closePath();
    // ground (everything below the wall) first: outfield grass all the way down
    fill(rect(-M, hz, W + 2 * M, H - hz + M), { a: 0.42, c: 1 });
    fill(p, { a: 1, c: 0.18 });
    var tl = new Path2D(); tl.moveTo(top[0].x, top[0].y); for (i = 1; i < top.length; i++) tl.lineTo(top[i].x, top[i].y);
    stroke(tl, C1, 1.6);
    // padding seams + distance marker
    var seams = new Path2D();
    for (i = 0; i < top.length; i += 2) { seams.moveTo(top[i].x, top[i].y + 2); seams.lineTo(bot[i].x, bot[i].y - 1); }
    stroke(seams, { a: 0.6, b: 0.25 }, 0.6, { over: true });
    var f0 = fenceAt(park, 0), mk = proj(0, f0.dist, f0.height * 0.5), mkS = Math.max(6, (f0.height * 0.42) * mk.s);
    P.text(String(Math.round(f0.dist)), mk.x, mk.y + mkS * 0.36, R.display(Math.min(13, mkS)), PAPER, { align: 'center' });
    var fl = fenceAt(park, -18), ml = proj(fl.dist * Math.sin(U.rad(-18)), fl.dist * Math.cos(U.rad(-18)), fl.height * 0.5);
    if (ml.x > 10) P.text(String(Math.round(fl.dist)), ml.x, ml.y + 4, R.display(Math.min(10, mkS * 0.8)), PAPER, { align: 'center' });

    // grass: checkerboard mowing, projected
    var gy0 = 24, gy1 = f0.dist - 12;
    var dark = new Path2D();
    for (var yy = gy0, row = 0; yy < gy1; yy += 22, row++) {
      for (var xx = -150, col = 0; xx < 150; xx += 15, col++) {
        if ((row + col) % 2) continue;
        var q0 = proj(xx, yy, 0), q1 = proj(xx + 15, yy, 0), q2 = proj(xx + 15, yy + 22, 0), q3 = proj(xx, yy + 22, 0);
        dark.moveTo(q0.x, q0.y); dark.lineTo(q1.x, q1.y); dark.lineTo(q2.x, q2.y); dark.lineTo(q3.x, q3.y); dark.closePath();
      }
    }
    fill(dark, { a: 0.6, c: 1 });
    // warning track hugging the wall
    var wt = new Path2D(), wtb = [];
    for (sp = -24; sp <= 24; sp += 1) {
      var fb = fenceAt(park, sp), rb = U.rad(sp);
      wtb.push(proj((fb.dist - 14) * Math.sin(rb), (fb.dist - 14) * Math.cos(rb), 0));
    }
    wt.moveTo(bot[0].x, bot[0].y); for (i = 1; i < bot.length; i++) wt.lineTo(bot[i].x, bot[i].y);
    for (i = wtb.length - 1; i >= 0; i--) wt.lineTo(wtb[i].x, wtb[i].y);
    wt.closePath();
    fill(wt, DIRT2);
    if (ft.hill) { // a grassy hill in deep centre
      var hp = new Path2D(), hs = [];
      for (sp = -9; sp <= 9; sp += 1.5) {
        var fh = fenceAt(park, sp), rh = U.rad(sp), k = Math.cos(sp / 9 * PI / 2);
        hs.push(proj((fh.dist - 14) * Math.sin(rh), (fh.dist - 14) * Math.cos(rh), 0));
        hs[hs.length - 1].y -= k * 7;
      }
      hp.moveTo(hs[0].x, hs[0].y + 7); for (i = 0; i < hs.length; i++) hp.lineTo(hs[i].x, hs[i].y);
      hp.lineTo(hs[hs.length - 1].x, hs[hs.length - 1].y + 7); hp.closePath();
      fill(hp, { a: 0.75, c: 1 });
      stroke(curve(hs.map(function (q) { return [q.x, q.y]; })), C1, 1.2);
    }
    // infield dirt ring (radius 95 around the rubber), infield grass diamond, mound, home circle, 2B
    var ring = new Path2D();
    for (i = 0; i <= 64; i++) {
      var a = -1.4 + 2.8 * i / 64; // the far side of the arc (beyond the bases)
      var q = proj(95 * Math.sin(a), 60.5 + 95 * Math.cos(a), 0);
      if (i) ring.lineTo(q.x, q.y); else ring.moveTo(q.x, q.y);
    }
    var qa = proj(-200, 20, 0), qb = proj(200, 20, 0);
    ring.lineTo(qb.x, qb.y); ring.lineTo(qa.x, qa.y); ring.closePath();
    fill(ring, DIRT);
    var dia = R.poly([proj(0, 5, 0), proj(58, 63.6, 0), proj(0, 122, 0), proj(-58, 63.6, 0)]);
    fill(dia, { a: 0.48, c: 1 });
    // mowing stripes on the infield grass
    var ist = new Path2D();
    for (yy = 10; yy < 122; yy += 14) {
      var w0 = Math.min(yy, 122 - yy) * 0.92;
      var s0 = proj(-w0, yy, 0), s1 = proj(w0, yy, 0), s2 = proj(w0, yy + 7, 0), s3 = proj(-w0, yy + 7, 0);
      ist.moveTo(s0.x, s0.y); ist.lineTo(s1.x, s1.y); ist.lineTo(s2.x, s2.y); ist.lineTo(s3.x, s3.y); ist.closePath();
    }
    fill(ist, { a: 0.62, c: 1 }, { over: true });
    // base cut at 2B and the bag
    var b2 = projCircle(0, 127.3, 9);
    fill(b2, DIRT);
    var bag = R.poly([proj(-1.2, 127.3, 0.3), proj(0, 126.1, 0.3), proj(1.2, 127.3, 0.3), proj(0, 128.5, 0.3)]);
    fill(bag, PAPER);
    // mound
    fill(projCircle(0, 59, 9), DIRT2);
    var mt = proj(0, 59, 0), ms = mt.s;
    fill(ell(mt.x, mt.y - 0.4 * ms, 9 * ms, 0.9 * ms), DIRT2);
    fill(rect(mt.x - 1 * ms, proj(0, 60.5, 0.83).y - 0.4, 2 * ms, Math.max(1.2, 0.5 * ms)), PAPER);
    // home plate dirt circle (fills the bottom of the screen)
    var hc = new Path2D();
    for (i = 0; i <= 48; i++) {
      var ah = PI * i / 48, X2 = 13 * Math.cos(ah), Y2 = 13 * Math.sin(ah);
      var qh = proj(X2, Y2, 0);
      if (i) hc.lineTo(qh.x, qh.y); else hc.moveTo(qh.x, qh.y);
    }
    hc.lineTo(-M, H + M); hc.lineTo(W + M, H + M); hc.lineTo(W + M, proj(13, 0, 0).y); hc.closePath();
    fill(hc, DIRT);
    // dirt texture: a few raked lines + pebbles
    var rk = new Path2D(), pr = U.rng(seed + 9);
    for (i = 0; i < 40; i++) {
      var rx = pr() * W, ry = proj(0, 12 * pr(), 0).y + pr() * (H - proj(0, 12, 0).y);
      rk.moveTo(rx, ry); rk.lineTo(rx + 6 + pr() * 14, ry + (pr() - 0.5) * 2);
    }
    stroke(rk, { b: 0.55, c: 0.4 }, 0.8, { over: true });
    // batter's boxes + plate
    var bxp = new Path2D(), l0;
    [[-4.71, -0.71], [0.71, 4.71]].forEach(function (bx) {
      l0 = [proj(bx[0], -2.3, 0), proj(bx[1], -2.3, 0), proj(bx[1], 3.7, 0), proj(bx[0], 3.7, 0)];
      bxp.moveTo(l0[0].x, l0[0].y); for (var j = 1; j < 4; j++) bxp.lineTo(l0[j].x, l0[j].y); bxp.closePath();
    });
    stroke(bxp, PAPER, 2.2, { ko: ['a', 'b', 'c'] });
    var hp2 = R.poly([proj(-0.71, 0.7, 0), proj(0.71, 0.7, 0), proj(0.71, 0, 0), proj(0, -0.71, 0), proj(-0.71, 0, 0)]);
    fill(hp2, PAPER);
    stroke(hp2, { a: 0.5 }, 1, { over: true });
  }
  function projCircle(cx, cy, r) {
    var p = new Path2D();
    for (var i = 0; i <= 40; i++) {
      var a = TAU * i / 40, q = proj(cx + r * Math.cos(a), cy + r * Math.sin(a), 0);
      if (i) p.lineTo(q.x, q.y); else p.moveTo(q.x, q.y);
    }
    p.closePath();
    return p;
  }
  function drawBatScoreboard(park, x, y, w, h) {
    // posts
    stroke(seg(x + w * 0.2, y + h, x + w * 0.2, y + h + 30), A1, 3);
    stroke(seg(x + w * 0.8, y + h, x + w * 0.8, y + h + 30), A1, 3);
    fill(R.rrect(x, y, w, h, 2), { a: 1, c: 0.15 });
    var name = (park.town || park.name || 'HOME').toUpperCase();
    var ff = fitFont(name, w - 12, 9);
    P.text(name, x + w / 2, y + 11, ff.font, PAPER, { align: 'center' });
    // line score: 9 little boxes x 2 rows
    var bw = (w - 12) / 10, rr = U.rng(hash(park.id) + 77), cells = new Path2D(), nums = [];
    for (var r = 0; r < 2; r++) for (var i = 0; i < 9; i++) {
      var cx = x + 6 + i * bw, cy = y + 16 + r * 11;
      cells.rect(cx, cy, bw - 2, 9);
      nums.push([cx + (bw - 2) / 2, cy + 7.5, i < 6 ? String(rr() < 0.7 ? 0 : 1 + Math.floor(rr() * 3)) : '']);
    }
    fill(cells, PAPER);
    var nf = R.mono(7, true);
    nums.forEach(function (n) { if (n[2]) P.text(n[2], n[0], n[1], nf, A1, { align: 'center', over: true }); });
    // bulbs
    var bulbs = new Path2D();
    for (var j = 0; j < 12; j++) { var bx = x + 6 + j * (w - 12) / 11; bulbs.moveTo(bx + 1.6, y + h - 5); bulbs.arc(bx, y + h - 5, 1.6, 0, TAU); }
    fill(bulbs, C1);
    // pennant
    stroke(seg(x + w - 4, y, x + w - 4, y - 16), A1, 1.2);
    fill(R.poly([x + w - 4, y - 16, x + w + 12, y - 12, x + w - 4, y - 8]), B1);
  }
  function drawBillboard(text, x, y, w, h) {
    stroke(seg(x + w * 0.25, y + h, x + w * 0.25, y + h + 36), A1, 2.4);
    stroke(seg(x + w * 0.75, y + h, x + w * 0.75, y + h + 36), A1, 2.4);
    fill(rect(x - 2, y - 2, w + 4, h + 4), A1);
    fill(rect(x, y, w, h), { b: 1 });
    var parts = text.split(/\s*·\s*/);
    if (parts.length > 1) {
      var f1 = fitFont(parts[0], w - 10, 12), f2 = fitFont(parts.slice(1).join(' · '), w - 10, 7.5, function (px) { return R.mono(px, true); });
      P.text(parts[0], x + w / 2, y + h * 0.5, f1.font, PAPER, { align: 'center' });
      P.text(parts.slice(1).join(' · '), x + w / 2, y + h * 0.5 + f2.px + 2, f2.font, { c: 1 }, { align: 'center' });
    } else {
      var f = fitFont(text, w - 10, 14);
      P.text(text, x + w / 2, y + h / 2 + f.px * 0.36, f.font, PAPER, { align: 'center' });
    }
    // lamp hoods
    for (var i = 0; i < 3; i++) fill(R.rrect(x + w * (0.2 + i * 0.3) - 4, y - 6, 8, 4, 1.5), A1);
  }

  // ------------------------------------------------------------------ the pitcher: a flat rubber-hose figure
  var BUILD = {
    tall:  { leg: 3.0, torso: 2.1, sh: 0.74, hip: 0.5, limb: 0.44, belly: 0.05, head: 0.68, arm: 1.2 },
    stout: { leg: 2.55, torso: 2.0, sh: 0.9, hip: 0.68, limb: 0.56, belly: 0.42, head: 0.72, arm: 1.12 },
    lanky: { leg: 3.25, torso: 2.25, sh: 0.66, hip: 0.44, limb: 0.35, belly: 0, head: 0.64, arm: 1.32 },
  };
  var PE = 1.35, PY = 57.5, MOUND_Z = 0.83;

  function lerpPose(a, b, u) {
    var o = {};
    for (var k in a) {
      var va = a[k], vb = b[k];
      o[k] = typeof va === 'number' ? lerp(va, vb, u) : [lerp(va[0], vb[0], u), lerp(va[1], vb[1], u)];
    }
    return o;
  }
  function samplePose(keys, ph) {
    if (ph <= keys[0][0]) return keys[0][1];
    for (var i = 1; i < keys.length; i++) {
      if (ph <= keys[i][0]) return lerpPose(keys[i - 1][1], keys[i][1], smooth((ph - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0])));
    }
    return keys[keys.length - 1][1];
  }
  function pitcherPose(look, ph, rel) {
    var b = BUILD[look.build] || BUILD.tall, L = b.leg, T = b.torso, w = look.windup || 'classic';
    var hi = w === 'classic' || w === 'highkick';
    var K0 = { hx: 0, hz: L, lean: 0, turn: 0.15, bend: 0, fa: [-0.5, 0], fb: [0.5, 0], th: [-0.2, L + T * 0.55], gl: [0.15, L + T * 0.55] };
    var K1 = { hx: 0.05, hz: L, lean: 0, turn: 0.3, bend: 0, fa: [-0.5, 0], fb: [0.45, 0],
      th: hi ? [-0.2, L + T + 0.95] : [-0.2, L + T * 0.62], gl: hi ? [0.15, L + T + 0.95] : [0.15, L + T * 0.62] };
    var K2 = { hx: -0.1, hz: L * 0.99, lean: -0.05, turn: 0.9, bend: 0, fa: [-0.35, 0],
      fb: w === 'highkick' ? [0.75, L * 1.3] : [0.35, L * 0.6], th: [-0.1, L + T * 0.66], gl: [0.15, L + T * 0.66] };
    var K3 = { hx: 0.35, hz: L * 0.86, lean: -0.08, turn: 0.6, bend: 0.1, fa: [-0.55, 0], fb: [1.3, -0.12], th: [-1.75, L + T + 0.55], gl: [1.5, L + T * 0.82] };
    var relP = w === 'sidearm' ? [-2.35, L + T * 0.55] : w === 'submarine' ? [-2.0, L * 0.35] : [-1.25, L + T + 1.0];
    var K4 = { hx: 0.45, hz: L * 0.82, lean: 0.22, turn: 0.1, bend: 0.3, fa: [-0.35, 0.15], fb: [1.3, -0.12], th: relP, gl: [0.7, L + T * 0.45] };
    var K5 = { hx: 0.5, hz: L * 0.76, lean: 0.12, turn: 0.05, bend: 0.7, fa: [-0.7, 0.7], fb: [1.3, -0.12], th: [0.95, L * 0.72], gl: [0.45, L + T * 0.35] };
    var K6 = { hx: 0.35, hz: L * 0.9, lean: 0, turn: 0, bend: 0.25, fa: [-0.35, 0], fb: [1.05, -0.06], th: [-0.65, L + 0.45], gl: [0.8, L + 0.55] };
    if (w === 'sidearm') {
      K3.th = [-2.15, L + T * 0.45]; K3.lean = -0.18;
      K4.lean = -0.28; K4.bend = 0.25;
      K5.th = [1.2, L + T * 0.15]; K5.lean = -0.05;
    } else if (w === 'submarine') {
      K3.hz = L * 0.72; K3.th = [-1.75, L * 0.7]; K3.lean = -0.35; K3.bend = 0.45; K3.fb = [1.5, -0.12];
      K4.hz = L * 0.6; K4.lean = -0.6; K4.bend = 0.7; K4.fb = [1.55, -0.12]; K4.hx = 0.5;
      K5.hz = L * 0.7; K5.th = [1.3, L + T * 0.75]; K5.lean = -0.2; K5.fb = [1.55, -0.12];
    }
    return samplePose([[0, K0], [0.2, K1], [0.5, K2], [0.8, K3], [1.0, K4], [1.3, K5], [2.0, K6]], ph);
  }

  function drawPitcher(pitcher, ph, time, pitch) {
    var look = pitcher.look || {}, b = BUILD[look.build] || BUILD.tall, L = b.leg;
    var mir = pitcher.hand === 'L' ? -1 : 1;
    var base = proj(0, PY, MOUND_Z), s = base.s * PE;
    var rel = pitch && pitch.release ? pitch.release
      : (BB.Pitch && BB.Pitch.releasePoint ? BB.Pitch.releasePoint(pitcher) : { x: -1.75 * mir, z: 6 });
    var pose = pitcherPose(look, ph, null);
    if (ph === 0) { var br = Math.sin(time * 2.1) * 0.035; pose.hz += br; pose.th = [pose.th[0], pose.th[1] + br]; pose.gl = [pose.gl[0], pose.gl[1] + br]; }
    var c = Math.cos(pose.lean), sn = Math.sin(pose.lean);
    function rot(x, z) { return [x * c + z * sn, -x * sn + z * c]; }
    function add(p, q) { return [p[0] + q[0], p[1] + q[1]]; }
    function X(p) { return base.x + mir * p[0] * s; }
    function Y(p) { return base.y - p[1] * s; }
    function pt(p) { return [X(p), Y(p)]; }
    var hip = [pose.hx, pose.hz];
    var chest = add(hip, rot(0, b.torso * (1 - 0.28 * pose.bend)));
    var shw = b.sh * (1 - 0.5 * pose.turn), so = rot(shw, 0);
    var shT = [chest[0] - so[0], chest[1] - so[1]], shG = [chest[0] + so[0], chest[1] + so[1]];
    var head = add(chest, rot(0, 0.22 + b.head));
    head[1] -= pose.bend * 0.3;
    var hw = b.hip * (1 - 0.35 * pose.turn), ho = rot(hw, 0);
    var hipT = [hip[0] - ho[0], hip[1] - ho[1]], hipG = [hip[0] + ho[0], hip[1] + ho[1]];
    var lw = b.limb * s, kl = Math.max(0.8, s * 0.06);
    var boss = !!pitcher.boss;

    fill(ell(base.x + mir * (pose.hx * 0.6) * s, base.y + 1, 1.7 * s, 0.32 * s), { a: 0.45 }, { over: true });

    function leg(hp, foot, side) {
      var th = L * 0.512, knee = ik(hp[0], hp[1], foot[0], foot[1], th, th, side);
      var mid = [lerp(knee[0], foot[0], 0.5), lerp(knee[1], foot[1], 0.5)];
      limb([pt(hp), pt(knee), pt(mid)], lw * 1.12, PAPER, kl);
      limb([pt(mid), pt(foot)], lw * 0.82, boss ? B1 : A1, kl);
      fill(ell(X(foot) + mir * side * 0.14 * s, Y(foot) + 0.04 * s, 0.34 * s, 0.15 * s), A1);
    }
    function arm(sh, hand, side, glove) {
      var el = ik(sh[0], sh[1], hand[0], hand[1], b.arm, b.arm, side);
      limb([pt(sh), pt(el), pt(hand)], lw * 0.78, SKIN, kl);
      limb([pt(sh), [lerp(X(sh), X(el), 0.45), lerp(Y(sh), Y(el), 0.45)]], lw * 1.02, boss ? B1 : A1, 0);
      if (glove) {
        var gp = R.blob(X(hand), Y(hand), 0.36 * s, 7, U.rng(5), 0.15);
        fill(gp, GLOVE); stroke(gp, A1, kl, { over: true });
        stroke(seg(X(hand) - 0.15 * s, Y(hand) - 0.2 * s, X(hand) - 0.15 * s, Y(hand) + 0.15 * s), PAPER, 0.7, { over: false, ko: ['a'] });
      } else {
        fill(circ(X(hand), Y(hand), 0.19 * s), SKIN); stroke(circ(X(hand), Y(hand), 0.19 * s), A1, kl * 0.8, { over: true });
        if (ph < 1) fill(circ(X(hand) - mir * 0.08 * s, Y(hand) - 0.12 * s, 0.13 * s), PAPER);
      }
    }
    var behind = ph > 0.62 && ph < 0.97;
    leg(hipT, pose.fa, -1);
    leg(hipG, pose.fb, 1);
    if (behind) arm(shT, pose.th, 1, false);
    // torso
    var bl = b.belly * s, tp = new Path2D();
    tp.moveTo(X(shT), Y(shT)); tp.lineTo(X(shG), Y(shG));
    tp.quadraticCurveTo(X(shG) + mir * bl, (Y(shG) + Y(hipG)) / 2 + bl * 0.4, X(hipG), Y(hipG));
    tp.lineTo(X(hipT), Y(hipT));
    tp.quadraticCurveTo(X(shT) - mir * bl, (Y(shT) + Y(hipT)) / 2 + bl * 0.4, X(shT), Y(shT));
    tp.closePath();
    fill(tp, PAPER);
    var half = R.poly([pt(chest), pt(shG), pt(hipG), pt(hip)].map(function (q) { return { x: q[0], y: q[1] }; }));
    P.save(); P.clip(tp); fill(half, { b: 0.22 }, { over: true }); P.restore();
    stroke(tp, A1, kl * 1.1, { over: true });
    stroke(seg(X(chest), Y(chest) + 0.15 * s, X(hip), Y(hip) + 0.1 * s), { a: 0.7 }, kl * 0.7, { over: true });
    stroke(seg(X(hipT), Y(hipT), X(hipG), Y(hipG)), boss ? B1 : A1, 0.22 * s, { cap: 'butt' });
    var num = String(look.number != null ? look.number : 1);
    P.save();
    var nc = [lerp(chest[0], hip[0], 0.35) + 0.32 * (1 - pose.turn), lerp(chest[1], hip[1], 0.35)];
    P.translate(X(nc), Y(nc)); P.rotate(mir * pose.lean);
    P.text(num, 0, 0.22 * s, R.display(0.62 * s), boss ? A1 : B1, { align: 'center' });
    P.restore();
    // neck + head
    var nk = add(chest, rot(0, 0.15));
    stroke(seg(X(nk), Y(nk), X(head), Y(head)), SKIN, 0.36 * s, { cap: 'butt' });
    var hr = b.head * s, hx = X(head), hy = Y(head);
    fill(circ(hx - hr * 0.86, hy + hr * 0.05, hr * 0.2), SKIN); fill(circ(hx + hr * 0.86, hy + hr * 0.05, hr * 0.2), SKIN);
    var face = ell(hx, hy, hr * 0.84, hr);
    fill(face, SKIN); stroke(face, A1, kl * 0.9, { over: true });
    var hair = look.hair || 'none', inkH = { a: 0.9 };
    if (hair === 'beard') {
      var bd = new Path2D(); bd.ellipse(hx, hy + hr * 0.15, hr * 0.86, hr * 0.92, 0, 0.05, PI - 0.05); bd.closePath();
      fill(bd, inkH);
      fill(ell(hx, hy + hr * 0.45, hr * 0.22, hr * 0.12), { b: 0.5, c: 0.3 });
    } else if (hair === 'sideburns') {
      fill(rect(hx - hr * 0.84, hy - hr * 0.3, hr * 0.26, hr * 0.75), inkH);
      fill(rect(hx + hr * 0.58, hy - hr * 0.3, hr * 0.26, hr * 0.75), inkH);
    }
    // eyes, nose, mouth
    var eff = ph > 0.75 && ph < 1.35;
    fill(circ(hx - hr * 0.3, hy - hr * 0.08, Math.max(0.9, hr * 0.1)), A1);
    fill(circ(hx + hr * 0.3, hy - hr * 0.08, Math.max(0.9, hr * 0.1)), A1);
    fill(circ(hx, hy + hr * 0.14, hr * 0.13), { b: 0.55, c: 0.6 }, { over: true });
    if (eff) { fill(rect(hx - hr * 0.26, hy + hr * 0.38, hr * 0.52, hr * 0.16), PAPER); stroke(rect(hx - hr * 0.26, hy + hr * 0.38, hr * 0.52, hr * 0.16), A1, 0.7, { over: true }); }
    else if (hair !== 'beard') stroke(seg(hx - hr * 0.2, hy + hr * 0.45, hx + hr * 0.2, hy + hr * 0.45), A1, Math.max(0.8, hr * 0.08));
    if (hair === 'mustache') {
      var ms = new Path2D();
      ms.moveTo(hx - hr * 0.6, hy + hr * 0.25);
      ms.quadraticCurveTo(hx - hr * 0.3, hy + hr * 0.45, hx, hy + hr * 0.28);
      ms.quadraticCurveTo(hx + hr * 0.3, hy + hr * 0.45, hx + hr * 0.6, hy + hr * 0.25);
      stroke(ms, inkH, hr * 0.2);
    }
    // cap: dome + bill (seen from the front)
    var cap = new Path2D(); cap.ellipse(hx, hy - hr * 0.3, hr * 0.92, hr * 0.85, 0, PI, TAU); cap.closePath();
    fill(cap, boss ? B1 : A1);
    fill(ell(hx, hy - hr * 0.3, hr * 1.05, hr * 0.24), boss ? { b: 1, a: 0.4 } : { a: 0.7, b: 0.2 });
    fill(circ(hx, hy - hr * 0.72, hr * 0.17), boss ? C1 : { c: 1 });
    // arms (throwing arm in front unless it is cocked behind the body)
    arm(shG, pose.gl, -1, true);
    if (!behind) arm(shT, pose.th, 1, false);
    S.hand = { x: X(pose.th), y: Y(pose.th) };
    return S.hand;
  }

  // ------------------------------------------------------------------ the batter: big flat figure, seen from behind
  function batterBase() {
    var zl = proj(-K.ZONE.xMax, 0, 0).x, bs = S.cam.f / 16.6 * 0.86;
    return { fx: zl - 1.5 * bs, fy: proj(0, 0.4, 0).y, s: bs };
  }
  var BK = {
    stance: { hip: [0.05, 2.35], nsh: [-0.42, 4.27], fsh: [0.5, 4.49], head: [0.12, 4.97], hands: [0.5, 4.63], th: -122, k: 0.86, ff: [0.6, 0.42], bf: [-0.52, 0.0], turn: 0.1, tilt: 0 },
    load:   { hip: [-0.06, 2.4], nsh: [-0.52, 4.29], fsh: [0.4, 4.53], head: [0.08, 4.95], hands: [0.2, 4.83], th: -142, k: 0.8, ff: [0.48, 0.85], bf: [-0.52, 0.0], turn: 0.0, tilt: 0 },
    launch: { hip: [0.16, 2.3], nsh: [-0.25, 4.17], fsh: [0.5, 4.45], head: [0.15, 4.93], hands: [0.62, 4.1], th: -198, k: 0.45, ff: [0.78, 0.42], bf: [-0.48, 0.02], turn: 0.35, tilt: 0 },
    contact:{ hip: [0.26, 2.25], nsh: [0.05, 4.1], fsh: [0.45, 4.47], head: [0.2, 4.9], hands: [0.6, 3.85], th: -356, k: 1.0, ff: [0.82, 0.42], bf: [-0.4, 0.1], turn: 0.75, tilt: 0 },
    extend: { hip: [0.3, 2.26], nsh: [0.3, 4.15], fsh: [0.22, 4.55], head: [0.2, 4.91], hands: [1.1, 4.15], th: -392, k: 0.62, ff: [0.82, 0.42], bf: [-0.36, 0.22], turn: 0.92, tilt: 0 },
    finish: { hip: [0.26, 2.3], nsh: [0.46, 4.3], fsh: [-0.15, 4.51], head: [0.16, 4.95], hands: [0.55, 4.97], th: -532, k: 0.8, ff: [0.82, 0.42], bf: [-0.32, 0.38], turn: 1.0, tilt: 0 },
    whiff:  { hip: [0.12, 2.18], nsh: [0.52, 4.15], fsh: [-0.38, 4.33], head: [0.02, 4.81], hands: [0.3, 4.4], th: -648, k: 0.95, ff: [1.0, 0.32], bf: [-0.6, 0.3], turn: 1.0, tilt: 0.3 },
  };
  function batterPose(view, bb) {
    var sw = view.swing, ld = view.loading, st = BK.stance;
    var cp = contactScreen(view.pitch);
    var start = ld != null ? lerpPose(st, BK.load, smooth(ld)) : st;
    if (!sw) {
      var p = start;
      var bob = Math.sin((view.time || 0) * 2.3) * 0.04;
      p = lerpPose(p, p, 0); p.hands = [p.hands[0], p.hands[1] + bob]; p.th += Math.sin((view.time || 0) * 1.7) * 2;
      return p;
    }
    if (sw.power && ld == null) start = BK.load;
    // contact hands: put the barrel's sweet spot on the pitch's plate crossing
    var Lb = 2.85 * bb.s, sweet = 0.68 * Lb;
    var thc = clamp(3 + (cp.y - proj(0, 0, 2.5).y) * 0.05, -25, 25);
    var hx = cp.x - Math.cos(U.rad(thc)) * sweet, hy = cp.y - Math.sin(U.rad(thc)) * sweet;
    var hu = clamp((hx - bb.fx) / bb.s, 0.2, 1.7), hv = clamp((bb.fy - hy) / bb.s, 2.2, 5.0);
    var ax = bb.fx + hu * bb.s, ay = bb.fy - hv * bb.s;
    thc = U.deg(Math.atan2(cp.y - ay, cp.x - ax));
    var C = lerpPose(BK.contact, BK.contact, 0); C.hands = [hu, hv]; C.th = thc - 360;
    var E = lerpPose(BK.extend, BK.extend, 0); E.hands = [hu + 0.5, hv + 0.25];
    var whiff = sw.result && !sw.result.contact;
    var lag = K.SWING_LAG || 0.07;
    var keys = [[0, start], [lag * 0.5, BK.launch], [lag, C], [lag + 0.05, E], [lag + 0.17, BK.finish]];
    if (whiff) keys.push([lag + 0.3, BK.whiff]);
    var pz = samplePose(keys, sw.t);
    if (whiff && sw.t > lag + 0.3) { pz = lerpPose(pz, pz, 0); pz.tilt += Math.sin((sw.t - lag - 0.3) * 9) * 0.06 * Math.max(0, 1 - (sw.t - lag - 0.3)); }
    return pz;
  }
  function contactScreen(pitch) {
    var pl = pitch && pitch.plate ? pitch.plate : { x: 0, z: 2.5 };
    var q = proj(pl.x, 0, pl.z);
    return { x: q.x, y: q.y };
  }
  function batInks(bat) {
    var lk = (bat && bat.look) || {}, wood = lk.wood || 'mid';
    var w = wood === 'light' ? { c: 0.8, b: 0.15 } : wood === 'dark' ? { c: 1, b: 0.62, a: 0.35 } : wood === 'ink' ? { a: 1, b: 0.2 }
      : wood === 'gold' ? { c: 1, b: 0.28 } : { c: 1, b: 0.36 };
    var tape = {}; tape[lk.tape || 'a'] = 1;
    if (lk.tape === 'c') tape.a = 0.25;
    return { wood: w, tape: tape, mark: lk.mark || 'none' };
  }
  function drawBat(hx, hy, th, len, wid, bat, kl) {
    var bi = batInks(bat), d = U.rad(th), dx = Math.cos(d), dy = Math.sin(d), nx = -dy, ny = dx;
    var k0 = -0.1 * len, k1 = len;
    var w0 = wid * 0.42, w1 = wid;
    var p = new Path2D();
    p.moveTo(hx + dx * k0 + nx * w0, hy + dy * k0 + ny * w0);
    p.lineTo(hx + dx * len * 0.35 + nx * w0 * 1.1, hy + dy * len * 0.35 + ny * w0 * 1.1);
    p.quadraticCurveTo(hx + dx * len * 0.62 + nx * w1, hy + dy * len * 0.62 + ny * w1, hx + dx * k1 * 0.97 + nx * w1, hy + dy * k1 * 0.97 + ny * w1);
    p.arc(hx + dx * k1 * 0.97, hy + dy * k1 * 0.97, w1, d - PI / 2, d + PI / 2);
    p.lineTo(hx + dx * len * 0.62 - nx * w1 * 0.98, hy + dy * len * 0.62 - ny * w1 * 0.98);
    p.quadraticCurveTo(hx + dx * len * 0.45 - nx * w0 * 1.3, hy + dy * len * 0.45 - ny * w0 * 1.3, hx + dx * len * 0.35 - nx * w0 * 1.1, hy + dy * len * 0.35 - ny * w0 * 1.1);
    p.lineTo(hx + dx * k0 - nx * w0, hy + dy * k0 - ny * w0);
    p.closePath();
    stroke(p, A1, kl * 2);
    fill(p, bi.wood);
    // grain highlight
    stroke(seg(hx + dx * len * 0.45 + nx * w1 * 0.35, hy + dy * len * 0.45 + ny * w1 * 0.35, hx + dx * len * 0.92 + nx * w1 * 0.45, hy + dy * len * 0.92 + ny * w1 * 0.45), PAPER, Math.max(1, w1 * 0.22), { ko: ['a', 'b', 'c'] });
    if (bi.mark === 'stripes' || bi.mark === 'dots' || bi.mark === 'star') {
      for (var i = 0; i < 3; i++) {
        var u = len * (0.55 + i * 0.12);
        if (bi.mark === 'dots' || bi.mark === 'star') fill(circ(hx + dx * u, hy + dy * u, w1 * 0.35), bi.mark === 'star' ? C1 : { b: 1 }, { over: true });
        else stroke(seg(hx + dx * u + nx * w1, hy + dy * u + ny * w1, hx + dx * (u + 6) - nx * w1, hy + dy * (u + 6) - ny * w1), B1, w1 * 0.35, { over: true });
      }
    }
    // tape + knob
    stroke(seg(hx + dx * k0 * 0.2, hy + dy * k0 * 0.2, hx + dx * len * 0.22, hy + dy * len * 0.22), bi.tape, w0 * 2.05, { cap: 'butt' });
    fill(ell(hx + dx * k0, hy + dy * k0, w0 * 1.5, w0 * 1.25, d), A1);
  }
  function drawBatter(view) {
    var bb = batterBase(), s = bb.s, pz = batterPose(view, bb), kl = Math.max(1, s * 0.03);
    function X(p) { return bb.fx + p[0] * s; }
    function Y(p) { return bb.fy - p[1] * s; }
    function pt(p) { return [X(p), Y(p)]; }
    var lw = 0.5 * s;
    fill(ell(bb.fx + 0.2 * s, bb.fy + 0.1 * s, 1.15 * s, 0.26 * s), { a: 0.38 }, { over: true });
    function leg(hp, foot, scale) {
      var th = 1.38, knee = ik(hp[0], hp[1], foot[0], foot[1], th, th, 1);
      var mid = [lerp(knee[0], foot[0], 0.5), lerp(knee[1], foot[1], 0.5)];
      limb([pt(hp), pt(knee), pt(mid)], lw * 1.15 * scale, PAPER, kl);
      stroke(curve([pt(hp), pt(knee), pt(mid)]), { a: 0.35 }, lw * 0.25 * scale, { over: true });
      limb([pt(mid), pt(foot)], lw * 0.85 * scale, B1, kl);
      fill(ell(X(foot) + 0.12 * s, Y(foot), 0.36 * s * scale, 0.15 * s * scale), A1);
    }
    var hipF = [pz.hip[0] + 0.3, pz.hip[1] + 0.05], hipN = [pz.hip[0] - 0.28, pz.hip[1] - 0.04];
    leg(hipF, pz.ff, 0.92);
    // far arm (mostly hidden behind the torso)
    var hands = pz.hands;
    var elF = ik(pz.fsh[0], pz.fsh[1], hands[0], hands[1], 1.05, 1.05, -1);
    limb([pt(pz.fsh), pt(elF), pt(hands)], lw * 0.62, SKIN, kl);
    leg(hipN, pz.bf, 1.0);
    // torso (jersey, hero ink = B)
    var tp = new Path2D(), hr = [pz.hip[0] + 0.45, pz.hip[1] + 0.02], hl = [pz.hip[0] - 0.42, pz.hip[1] - 0.05];
    // shoulders ordered left->right so the torso never twists into a bow-tie when he rotates through
    var midS = [(pz.nsh[0] + pz.fsh[0]) / 2, (pz.nsh[1] + pz.fsh[1]) / 2], half = Math.max(0.42, Math.abs(pz.fsh[0] - pz.nsh[0]) / 2);
    var lS = [midS[0] - half, pz.nsh[0] <= pz.fsh[0] ? pz.nsh[1] : pz.fsh[1]], rS = [midS[0] + half, pz.nsh[0] <= pz.fsh[0] ? pz.fsh[1] : pz.nsh[1]];
    tp.moveTo(X(lS), Y(lS));
    tp.quadraticCurveTo((X(lS) + X(rS)) / 2, Math.min(Y(lS), Y(rS)) - 0.12 * s, X(rS), Y(rS));
    tp.quadraticCurveTo(X(rS) + 0.12 * s, (Y(rS) + Y(hr)) / 2, X(hr), Y(hr));
    tp.lineTo(X(hl), Y(hl));
    tp.quadraticCurveTo(X(lS) - 0.2 * s, (Y(lS) + Y(hl)) / 2, X(lS), Y(lS));
    tp.closePath();
    stroke(tp, A1, kl * 2);
    fill(tp, B1);
    var back = clamp(1 - pz.turn * 1.15, 0, 1);
    if (back > 0.12) {
      P.save();
      var cxn = lerp(X(pz.nsh), X(pz.fsh), 0.5) - (1 - back) * 0.2 * s, cyn = lerp(Y(pz.nsh), Y(hl), 0.42);
      P.translate(cxn, cyn); P.scale(back, 1);
      P.text('7', 0, 0.42 * s, R.display(1.15 * s), PAPER, { align: 'center' });
      P.text('7', 0, 0.42 * s, R.display(1.15 * s), { c: 0.35 }, { align: 'center', over: true });
      P.restore();
    } else {
      stroke(seg(lerp(X(pz.nsh), X(pz.fsh), 0.6), Y(pz.fsh) + 0.2 * s, lerp(X(hl), X(hr), 0.6), Y(hr) - 0.1 * s), PAPER, kl * 1.5);
    }
    stroke(seg(X(hl), Y(hl), X(hr), Y(hr)), A1, 0.2 * s, { cap: 'butt' });
    // head: neck, ear, helmet from behind
    var hd = pz.head, hx = X(hd), hy = Y(hd), r = 0.5 * s;
    stroke(seg(hx - 0.05 * s, hy + 0.2 * s, hx - 0.02 * s, hy + 0.62 * s), SKIN, 0.42 * s, { cap: 'butt' });
    P.save(); P.translate(hx, hy); P.rotate(pz.tilt || 0);
    fill(circ(-0.32 * s, 0.12 * s, 0.16 * s), SKIN);
    var hm = new Path2D(); hm.arc(0, 0, r, PI * 0.92, PI * 2.12); hm.quadraticCurveTo(r * 0.6, r * 0.62, 0, r * 0.55); hm.quadraticCurveTo(-r * 0.7, r * 0.6, -r * 0.98, r * 0.22); hm.closePath();
    stroke(hm, A1, kl * 2);
    fill(hm, A1);
    fill(R.poly([r * 0.55, -r * 0.05, r * 1.35, r * 0.18, r * 1.25, r * 0.36, r * 0.5, r * 0.32]), { a: 1, b: 0.3 });
    var ear = ell(-r * 0.55, r * 0.35, r * 0.42, r * 0.36);
    fill(ear, A1);
    fill(ell(-r * 0.55, r * 0.35, r * 0.18, r * 0.15), { a: 0.6 }, {});
    var sh = new Path2D(); sh.arc(0, 0, r * 0.78, PI * 1.12, PI * 1.55); sh.arc(0, 0, r * 0.6, PI * 1.55, PI * 1.12, true); sh.closePath();
    fill(sh, { b: 0.55 }, { over: true });
    fill(circ(r * 0.05, -r * 0.62, r * 0.12), PAPER);
    P.restore();
    // near arm (right arm)
    var elN = ik(pz.nsh[0], pz.nsh[1], hands[0], hands[1], 1.05, 1.05, -1);
    limb([pt(pz.nsh), pt(elN), pt(hands)], lw * 0.66, SKIN, kl);
    limb([pt(pz.nsh), [lerp(X(pz.nsh), X(elN), 0.5), lerp(Y(pz.nsh), Y(elN), 0.5)]], lw * 0.9, B1, kl);
    // bat + gloves
    var Lb = 2.85 * s * pz.k;
    drawBat(X(hands), Y(hands), pz.th, Lb, 0.11 * s, view.bat, kl);
    var g1 = circ(X(hands) - 0.06 * s, Y(hands), 0.17 * s), g2 = circ(X(hands) + 0.1 * s, Y(hands) + 0.02 * s, 0.16 * s);
    fill(g1, C1); stroke(g1, A1, kl, { over: true }); fill(g2, C1); stroke(g2, A1, kl, { over: true });
    return { hands: pt(hands), th: pz.th };
  }

  // ------------------------------------------------------------------ catcher (foreground, low) + mitt
  function catcherBase() {
    var zb = proj(0, 0, K.ZONE.zMin).y, cs = S.cam.f / 17.5;
    var top = Math.max(zb + 62, S.H * 0.79);
    return { x: proj(0, 0, 0).x - 6, y: top + 2.9 * cs, s: cs };
  }
  function mittTarget(view) {
    var cb = catcherBase(), rest = [cb.x - 0.95 * cb.s, cb.y - 1.25 * cb.s];
    var pitch = view.pitch, t = view.pitchT;
    if (!pitch || t == null || view.windup != null) return { x: rest[0], y: rest[1], k: 0 };
    var T = pitch.T || 0.75, k = smooth((t - (T - 0.1)) / 0.1);
    var q = proj(pitch.plate.x, -2.4, pitch.plate.z - 0.1);
    return { x: lerp(rest[0], q.x, k), y: lerp(rest[1], q.y, k), k: k };
  }
  function drawCatcherBody(view) {
    var cb = catcherBase(), s = cb.s, x = cb.x, y = cb.y, kl = 1.2;
    function X(u) { return x + u * s; }
    function Y(v) { return y - v * s; }
    // back + shoulders (opposing team: paper uniform, A shading, B gear straps)
    var bk = new Path2D();
    bk.moveTo(X(-1.25), Y(-0.4)); bk.lineTo(X(-1.2), Y(1.55));
    bk.quadraticCurveTo(X(-1.1), Y(2.08), X(-0.4), Y(2.12)); bk.lineTo(X(0.4), Y(2.12));
    bk.quadraticCurveTo(X(1.1), Y(2.08), X(1.2), Y(1.55)); bk.lineTo(X(1.25), Y(-0.4)); bk.closePath();
    stroke(bk, A1, kl * 2); fill(bk, PAPER);
    fill(rect(X(0.15), Y(2.1), 1.1 * s, 2.6 * s), { a: 0.22 }, { over: true });
    var st = new Path2D();
    st.moveTo(X(-0.95), Y(1.9)); st.lineTo(X(0.7), Y(0.2)); st.moveTo(X(0.95), Y(1.9)); st.lineTo(X(-0.7), Y(0.2));
    stroke(st, { b: 1 }, 0.2 * s);
    P.text(String(((hash(view.pitcher && view.pitcher.id) % 60) + 2)), X(0), Y(0.75), R.display(0.62 * s), A1, { align: 'center' });
    // helmet (worn backwards) + mask straps
    var hx = X(0.05), hy = Y(2.48), r = 0.44 * s;
    fill(circ(hx, hy, r + kl), A1);
    fill(circ(hx, hy, r), A1);
    fill(rect(hx - r * 0.95, hy - r * 0.05, r * 1.9, r * 0.16), { b: 0.8 });
    fill(circ(hx - r * 0.3, hy - r * 0.45, r * 0.16), { a: 0.6 }, {});
    fill(R.poly([hx - r * 0.5, hy - r * 0.86, hx + r * 0.5, hy - r * 0.86, hx + r * 0.36, hy - r * 1.18, hx - r * 0.36, hy - r * 1.18]), { a: 0.85, b: 0.3 });
    // right arm tucked behind the back
    limb([[X(1.15), Y(1.7)], [X(1.3), Y(1.0)], [X(0.85), Y(0.7)]], 0.36 * s, PAPER, kl);
  }
  function drawMitt(view, front) {
    var cb = catcherBase(), s = cb.s, m = mittTarget(view);
    var sh = [cb.x - 0.95 * s, cb.y - 1.85 * s];
    if (!front) {
      limb([sh, [lerp(sh[0], m.x, 0.5) - 0.3 * s, lerp(sh[1], m.y, 0.5) + 0.25 * s], [m.x, m.y]], 0.34 * s, PAPER, 1.2);
      return;
    }
    var w = 0.5 * s;
    var mp = new Path2D();
    mp.moveTo(m.x - w * 0.95, m.y + w * 0.65);
    mp.quadraticCurveTo(m.x - w * 1.15, m.y - w * 0.5, m.x - w * 0.45, m.y - w * 0.95);
    mp.quadraticCurveTo(m.x + w * 0.2, m.y - w * 1.25, m.x + w * 0.85, m.y - w * 0.7);
    mp.quadraticCurveTo(m.x + w * 1.15, m.y + w * 0.1, m.x + w * 0.7, m.y + w * 0.7);
    mp.closePath();
    stroke(mp, A1, 2.4); fill(mp, GLOVE);
    var lc = new Path2D();
    lc.moveTo(m.x - w * 0.6, m.y - w * 0.55); lc.quadraticCurveTo(m.x, m.y - w * 0.8, m.x + w * 0.55, m.y - w * 0.45);
    lc.moveTo(m.x - w * 0.5, m.y + w * 0.35); lc.lineTo(m.x + w * 0.45, m.y + w * 0.35);
    stroke(lc, PAPER, 1.3, { ko: ['a', 'b', 'c'] });
    fill(circ(m.x - w * 0.1, m.y + w * 0.05, w * 0.18), A1);
  }

  // ------------------------------------------------------------------ ball, zone, assist ring, contact
  function ballR(s) { return Math.max(1.7, K.BALL_R * s * 1.18); }
  function drawBallSprite(x, y, r, spin, inks) {
    fill(circ(x, y, r + Math.max(0.7, r * 0.1)), A1);
    fill(circ(x, y, r), PAPER);
    if (r > 2.2) {
      var c = Math.cos(spin), s = Math.sin(spin), p = new Path2D();
      for (var side = -1; side <= 1; side += 2) {
        for (var i = 0; i <= 10; i++) {
          var a = -0.95 + 1.9 * i / 10, px = side * (r * 1.05 - Math.cos(a) * r * 0.55), py = Math.sin(a) * r * 0.75;
          var rx = x + px * c - py * s, ry = y + px * s + py * c;
          if (i) p.lineTo(rx, ry); else p.moveTo(rx, ry);
        }
      }
      stroke(p, inks || B1, Math.max(0.8, r * 0.16), { over: true });
      P.save(); P.clip(circ(x, y, r)); fill(circ(x + r * 0.45, y + r * 0.45, r * 0.85), { a: 0.22 }, { over: true }); P.restore();
    }
  }
  function drawPitchBall(view) {
    var pitch = view.pitch, t = view.pitchT;
    var p = pitchPos(pitch, t), q = proj(p.x, p.y, p.z), r = ballR(q.s);
    if (S.hand && t < 0.16) { var hb = smooth(t / 0.16); q = { x: lerp(S.hand.x, q.x, hb), y: lerp(S.hand.y, q.y, hb), s: q.s }; }
    // ground shadow helps read height
    var g = proj(p.x, p.y, 0);
    if (p.y > 1) fill(ell(g.x, g.y, r * 1.3, r * 0.38), { a: 0.38 }, { over: true });
    // riso speed trail: C body + B ghost, misregistered by design
    if (t < (pitch.T || 0.8) + 0.02) {
      var pts = [], n = 6;
      for (var i = 0; i <= n; i++) {
        var tt = Math.max(0, t - i * 0.016), pp = pitchPos(pitch, tt), qq = proj(pp.x, pp.y, pp.z);
        pts.push([qq.x, qq.y, ballR(qq.s) * (1 - i / (n + 1))]);
      }
      var tr = new Path2D();
      for (i = 0; i <= n; i++) { tr.moveTo(pts[i][0] + pts[i][2], pts[i][1]); tr.arc(pts[i][0], pts[i][1], pts[i][2], 0, TAU); }
      fill(tr, { c: 0.85 }, { over: true });
      var tr2 = new Path2D();
      for (i = 2; i <= n; i += 2) { tr2.moveTo(pts[i][0] + pts[i][2] * 0.6 + 2, pts[i][1] - 1); tr2.arc(pts[i][0] + 2, pts[i][1] - 1, pts[i][2] * 0.6, 0, TAU); }
      fill(tr2, { b: 0.45 }, { over: true });
    }
    drawBallSprite(q.x, q.y, r, t * 38);
    return { x: q.x, y: q.y, r: r };
  }
  function drawZone(view) {
    var x0 = -K.ZONE.xMax, x1 = K.ZONE.xMax, z0 = K.ZONE.zMin, z1 = K.ZONE.zMax;
    var a = proj(x0, 0, z1), b = proj(x1, 0, z0);
    var p = rect(a.x, a.y, b.x - a.x, b.y - a.y);
    stroke(p, PAPER, 3.2, { dash: [0.1, 5.2] });
    stroke(p, { a: 1 }, 1.7, { over: true, dash: [0.1, 5.2] });
    var L = 9, br = new Path2D();
    br.moveTo(a.x, a.y + L); br.lineTo(a.x, a.y); br.lineTo(a.x + L, a.y);
    br.moveTo(b.x - L, a.y); br.lineTo(b.x, a.y); br.lineTo(b.x, a.y + L);
    br.moveTo(b.x, b.y - L); br.lineTo(b.x, b.y); br.lineTo(b.x - L, b.y);
    br.moveTo(a.x + L, b.y); br.lineTo(a.x, b.y); br.lineTo(a.x, b.y - L);
    stroke(br, PAPER, 4.4, { cap: 'square' });
    stroke(br, { a: 1 }, 2.4, { over: true, cap: 'square' });
    // knee / letters tick marks in C
    stroke(seg(a.x - 6, (a.y + b.y) / 2, a.x - 2, (a.y + b.y) / 2), C1, 2, { over: true });
    stroke(seg(b.x + 2, (a.y + b.y) / 2, b.x + 6, (a.y + b.y) / 2), C1, 2, { over: true });
  }
  function drawAssist(view) {
    var pitch = view.pitch, t = view.pitchT, T = pitch.T || 0.8, f = t / T;
    if (f < 0.45 || f > 1.02) return;
    var u = clamp((f - 0.45) / 0.55, 0, 1);
    var q = proj(pitch.plate.x, 0, pitch.plate.z), rb = ballR(q.s);
    var r = rb * (1.3 + 6 * (1 - u) * (1 - u));
    var dash = Math.max(2.5, r * 0.36), ring = circ(q.x, q.y, r);
    stroke(ring, PAPER, 5, { dash: [dash, dash * 0.6], cap: 'butt' });
    stroke(ring, { a: 1, b: 0.5 }, 2.6, { over: true, dash: [dash, dash * 0.6], cap: 'butt' });
    stroke(circ(q.x, q.y, rb * 1.12), { b: 1 }, 1.8, { over: true });
    if (u > 0.85) fill(circ(q.x, q.y, rb * 0.35), { b: 1 }, { over: true });
  }
  function contactInfo(view) {
    var sw = view.swing, lag = K.SWING_LAG || 0.07;
    if (!sw || !sw.result || !sw.result.contact || sw.t < lag || !view.pitch) return null;
    var since = sw.t - lag, pt0 = Math.max(0, (view.pitchT || 0) - since);
    var o = pitchPos(view.pitch, Math.min(pt0, (view.pitch.T || 0.8) + 0.05));
    return { since: since, origin: o, res: sw.result };
  }
  function drawContact(view, ci) {
    var res = ci.res, since = ci.since, o = ci.origin;
    var q0 = proj(o.x, Math.max(0, o.y), o.z);
    // the ball leaves along its launch direction (slowed down so you see it go)
    var v = Math.max(40, res.ev || 80) * 1.4667 * 0.5, la = U.rad(res.la || 15), sp = U.rad(res.spray || 0);
    var bx = o.x + v * Math.cos(la) * Math.sin(sp) * since, by = Math.max(0, o.y) + v * Math.cos(la) * Math.cos(sp) * since;
    var bz = o.z + v * Math.sin(la) * since - 16 * since * since;
    var big = res.sweet ? 1.45 : 0.75 + 0.5 * (res.quality || 0.5);
    // burst
    var bt = clamp(since / 0.32, 0, 1);
    if (bt < 1) {
      var R0 = (22 + 60 * U.easeOut(bt)) * big, tone = 1 - bt * bt;
      var rr = U.rng(17);
      fill(R.star(q0.x, q0.y, R0, R0 * 0.45, 11, bt * 0.4, 0.35, rr), { c: tone }, { over: true });
      fill(R.star(q0.x + 2, q0.y - 2, R0 * 0.62, R0 * 0.3, 9, -bt * 0.5 + 0.2, 0.3, rr), { b: tone * 0.9 }, { over: true });
      var ln = new Path2D();
      for (var i = 0; i < 12; i++) {
        var a = i / 12 * TAU + 0.13, r1 = R0 * (0.9 + bt * 0.6), r2 = r1 + 14 * big;
        ln.moveTo(q0.x + Math.cos(a) * r1, q0.y + Math.sin(a) * r1); ln.lineTo(q0.x + Math.cos(a) * r2, q0.y + Math.sin(a) * r2);
      }
      stroke(ln, A1, 2.2 * (1 - bt) + 0.5, { over: true });
    }
    if (by > 0.5) {
      var qb = proj(bx, by, Math.max(0.2, bz));
      if (qb.y > -40 && qb.x > -60 && qb.x < S.W + 60) {
        var r = ballR(qb.s);
        var tail = new Path2D(); tail.moveTo(q0.x, q0.y); tail.lineTo(qb.x, qb.y);
        stroke(tail, { c: 0.8 }, Math.max(1.5, r * 1.2), { over: true });
        stroke(tail, { b: 0.5 }, Math.max(0.8, r * 0.5), { over: true, dash: [3, 4] });
        drawBallSprite(qb.x, qb.y, r, since * 30);
      }
    }
  }

  // ------------------------------------------------------------------ FIELD scene: a riso stadium map, high behind home
  function makeCam(px, py, pz, tx, ty, tz) {
    var fx = tx - px, fy = ty - py, fz = tz - pz, fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
    fx /= fl; fy /= fl; fz /= fl;
    var rx = fy, ry = -fx, rl = Math.sqrt(rx * rx + ry * ry); rx /= rl; ry /= rl;
    var ux = ry * fz, uy = -rx * fz, uz = rx * fy - ry * fx;
    return { p: [px, py, pz], f: [fx, fy, fz], r: [rx, ry, 0], u: [ux, uy, uz], k: 1, cx: 0, cy: 0 };
  }
  function cproj(c, x, y, z) {
    var dx = x - c.p[0], dy = y - c.p[1], dz = z - c.p[2];
    var zc = dx * c.f[0] + dy * c.f[1] + dz * c.f[2]; if (zc < 5) zc = 5;
    var xc = dx * c.r[0] + dy * c.r[1], yc = dx * c.u[0] + dy * c.u[1] + dz * c.u[2];
    var s = c.k / zc;
    return { x: c.cx + xc * s, y: c.cy - yc * s, s: s };
  }
  function layoutField(park) {
    var W = S.W, H = S.H, c = makeCam(0, -90, 470, 0, 190, 0);
    var pts = [[0, 0, 0]], i, tops = [];
    for (i = -45; i <= 45; i += 5) { var ff = fenceAt(park, i), rr0 = U.rad(i); tops.push([ff.dist * Math.sin(rr0), ff.dist * Math.cos(rr0), ff.height + 30]); }
    for (i = -30; i <= 30; i += 5) {
      var f = fenceAt(park, i), r = U.rad(i);
      pts.push([f.dist * Math.sin(r), f.dist * Math.cos(r), f.height]);
    }
    var mnx = 1e9, mxx = -1e9, home = cproj(c, 0, 0, 0), mny = 1e9;
    pts.forEach(function (p) { var q = cproj(c, p[0], p[1], p[2]); mnx = Math.min(mnx, q.x); mxx = Math.max(mxx, q.x); });
    tops.forEach(function (p) { var q = cproj(c, p[0], p[1], p[2]); mny = Math.min(mny, q.y); });
    var k = (W * 1.0) / (mxx - mnx);
    var kh = (H * 0.84 - H * 0.2) / (home.y - mny);
    var sbq = cproj(c, 0, fenceAt(park, 0).dist + 90, 130);          // top of the CF scoreboard must clear the HUD
    var ks = (H * 0.84 - Math.max(150, H * 0.18)) / (home.y - sbq.y);
    k = Math.min(k, kh, ks);
    c.k = k; c.cx = W / 2; c.cy = H * 0.84 - k * home.y;
    S.fcam = c;
  }
  function fp(x, y, z) { return cproj(S.fcam, x, y, z || 0); }
  function fpoly(pts) { // world [x,y,z] -> Path2D
    var p = new Path2D();
    for (var i = 0; i < pts.length; i++) { var q = fp(pts[i][0], pts[i][1], pts[i][2] || 0); if (i) p.lineTo(q.x, q.y); else p.moveTo(q.x, q.y); }
    p.closePath();
    return p;
  }
  function sprayPt(sp, d, z) { var r = U.rad(sp); return [d * Math.sin(r), d * Math.cos(r), z || 0]; }

  function drawFieldBackground(park) {
    var W = S.W, H = S.H, ft = feat(park), seed = hash(park.id), rng = U.rng(seed + 40), i, p, sp, q;
    // surroundings: a little town map around the park
    var land = ft.skyline === 'desert' ? { b: 0.32, c: 0.6 } : ft.skyline === 'barns' ? { a: 0.2, c: 0.6 } :
      ft.skyline === 'pines' ? { a: 0.4, c: 0.55 } : { a: 0.2, b: 0.1 };
    fill(rect(-M, -M, W + 2 * M, H + 2 * M), land);
    // street grid / field patches (world coords far beyond the fence)
    var grid = new Path2D(), patches = new Path2D(), trees = new Path2D();
    for (var gx = -960; gx <= 960; gx += 240) { var a1 = fp(gx, 380, 0), a2 = fp(gx, 1400, 0); grid.moveTo(a1.x, a1.y); grid.lineTo(a2.x, a2.y); }
    for (var gy = 460; gy <= 1400; gy += 220) { var b1 = fp(-900, gy, 0), b2 = fp(900, gy, 0); grid.moveTo(b1.x, b1.y); grid.lineTo(b2.x, b2.y); }
    for (i = 0; i < 12; i++) {
      var px = -800 + rng() * 1600, py = 450 + rng() * 900;
      if (ft.skyline === 'barns' || ft.skyline === 'desert') patches.addPath(fpoly([[px, py], [px + 90, py], [px + 90, py + 70], [px, py + 70]]));
      else patches.addPath(fpoly([[px, py], [px + 60, py], [px + 60, py + 40], [px, py + 40]]));
    }
    fill(patches, ft.skyline === 'barns' ? { b: 0.3, c: 0.9 } : ft.skyline === 'desert' ? { b: 0.6, c: 0.9 } : { a: 0.4, b: 0.15 });
    stroke(grid, PAPER, 3);
    for (i = 0; i < 70; i++) {
      var tx = -900 + rng() * 1800, ty = 380 + rng() * 1000, tq = fp(tx, ty, 0), tr = Math.max(1.4, 9 * tq.s);
      trees.moveTo(tq.x + tr, tq.y); trees.arc(tq.x, tq.y, tr, 0, TAU);
    }
    fill(trees, ft.skyline === 'desert' ? { a: 0.6, c: 0.6 } : { a: 0.75, c: 1 });
    // water feature beyond the fence
    var water = ft.water || 'none';
    if (water !== 'none') {
      var c0 = water === 'left' ? -75 : water === 'right' ? 25 : -25, c1 = c0 + 50;
      var wp = [];
      for (sp = c0; sp <= c1; sp += 2) wp.push(sprayPt(sp, fenceAt(park, sp).dist + 85));
      for (sp = c1; sp >= c0; sp -= 2) wp.push(sprayPt(sp, fenceAt(park, sp).dist + 420));
      p = fpoly(wp); fill(p, { a: 0.55, c: 0.12 });
      var wv = new Path2D();
      for (i = 0; i < 60; i++) {
        var s2 = c0 + rng() * (c1 - c0), d2 = fenceAt(park, s2).dist + 100 + rng() * 280, wq = fp.apply(null, sprayPt(s2, d2));
        wv.moveTo(wq.x - 4, wq.y); wv.quadraticCurveTo(wq.x - 2, wq.y - 2, wq.x, wq.y); wv.quadraticCurveTo(wq.x + 2, wq.y + 2, wq.x + 4, wq.y);
      }
      P.save(); P.clip(p); stroke(wv, PAPER, 1); P.restore();
    }
    // grandstands: one continuous seating bowl wrapping the field — down both lines, round the outfield and a
    // backstop arc behind home. bowl(k): k = 0 is the field edge, 1 the top row.
    var poleL = fenceAt(park, -45).dist, poleR = fenceAt(park, 45).dist, S2 = Math.SQRT1_2;
    function bowl(k, zOver) {
      var o = 40 + 75 * k, g = 4 + 72 * k, z = zOver != null ? zOver : 4 + 42 * k, pts = [], t, sp2;
      var n = 22, j;   // fixed point counts per segment so rows line up (aisles join matching points)
      for (j = 0; j <= n; j++) { t = lerp(o, poleL, j / n); pts.push([-S2 * t - S2 * o, S2 * t - S2 * o, z]); }
      for (sp2 = -45; sp2 <= 45; sp2 += 2) { var fa2 = fenceAt(park, sp2); pts.push(sprayPt(sp2, fa2.dist + g, zOver != null ? zOver : z + fa2.height * (1 - k))); }
      for (j = 0; j <= n; j++) { t = lerp(poleR, o, j / n); pts.push([S2 * t + S2 * o, S2 * t - S2 * o, z]); }
      for (sp2 = 90; sp2 <= 270; sp2 += 6) pts.push(sprayPt(sp2, 1.414 * o, z));
      return pts;
    }
    var wa = water === 'left' ? -70 : water === 'right' ? 22 : -24, wb = wa + 48;
    function wet(x, y) { if (water === 'none') return false; var sp3 = U.deg(Math.atan2(x, y)); return sp3 > wa && sp3 < wb && Math.sqrt(x * x + y * y) > fenceAt(park, clamp(sp3, -45, 45)).dist; }
    P.save();
    if (water !== 'none') {
      var cl = new Path2D(); cl.rect(-M, -M, W + 2 * M, H + 2 * M);
      var wcut = [[0, 0, 0]]; for (sp = wa; sp <= wb; sp += 2) wcut.push(sprayPt(sp, 1500));
      cl.addPath(fpoly(wcut)); P.clip(cl, 'evenodd');
    }
    var outer = fpoly(bowl(1));
    fill(outer, { a: 0.9, b: 0.25 });
    // crowd: rows of dots following the bowl, evenly spaced along each row
    var cpaths = CROWD.map(function () { return new Path2D(); }), r2 = U.rng(seed + 50);
    for (var kk = 0.94; kk > 0.05; kk -= 0.085) {
      var row = bowl(kk), acc = 0;
      for (i = 1; i < row.length; i++) {
        var a0 = row[i - 1], a1 = row[i], dx = a1[0] - a0[0], dy = a1[1] - a0[1], L = Math.sqrt(dx * dx + dy * dy);
        for (; acc < L; acc += 6.5) {
          var f = acc / L, wx = a0[0] + dx * f, wy = a0[1] + dy * f;
          var ci = Math.floor(r2() * CROWD.length);
          if (r2() < 0.07 || wet(wx, wy)) continue;
          var cq = fp(wx, wy, lerp(a0[2], a1[2], f)), cr = Math.max(1.3, 2.6 * cq.s);
          cpaths[ci].moveTo(cq.x + cr, cq.y); cpaths[ci].arc(cq.x, cq.y, cr, 0, TAU);
        }
        acc -= L;
      }
    }
    cpaths.forEach(function (pp, k) { fill(pp, CROWD[k]); });
    // aisles (paper stair lines) radiating through the stands + the roof rim
    var aisles = new Path2D(), inR = bowl(0.02), outR = bowl(1);
    for (i = 3; i < inR.length; i += 6) { var qa = fp.apply(null, inR[i]), qb = fp.apply(null, outR[i]); if (wet(inR[i][0] * 1.2, inR[i][1] * 1.2)) continue; aisles.moveTo(qa.x, qa.y); aisles.lineTo(qb.x, qb.y); }
    stroke(aisles, PAPER, 1.4);
    stroke(outer, A1, 3.5);
    P.restore();
    // the field: foul grass inside the bowl, low backstop wall + front rail, dugouts
    var fieldP = fpoly(bowl(0, 0));
    fill(fieldP, { a: 0.3, c: 0.8 });
    stroke(fpoly(bowl(0, 3)), A1, 2.6);
    stroke(fpoly(bowl(0, 3)), C1, 0.9, { over: true });
    [-1, 1].forEach(function (sg) {
      var dg = [], ux = S2 * sg, uy = S2, nx = S2 * sg, ny = -S2;
      [[48, 30], [92, 30], [92, 39], [48, 39]].forEach(function (q) { dg.push([ux * q[0] + nx * q[1], uy * q[0] + ny * q[1], 0]); });
      fill(fpoly(dg), A1);
      var dgf = fp(ux * 70 + nx * 30, uy * 70 + ny * 30, 0);
      fill(R.rect(dgf.x - 6, dgf.y - 1, 12, 2), { b: 1 });
    });
    var fair = [[0, 0, 0]];
    for (sp = -45; sp <= 45; sp += 1.5) fair.push(sprayPt(sp, fenceAt(park, sp).dist));
    var fairP = fpoly(fair);
    fill(fairP, { a: 0.42, c: 1 });
    P.save(); P.clip(fairP);
    var chk = new Path2D();
    for (var cx = -450; cx < 450; cx += 30) for (var cy = 0; cy < 470; cy += 30) {
      if (((cx / 30 + cy / 30) & 1) === 0) continue;
      chk.addPath(fpoly([[cx, cy], [cx + 30, cy], [cx + 30, cy + 30], [cx, cy + 30]]));
    }
    fill(chk, { a: 0.58, c: 1 });
    P.restore();
    // warning track
    var wt = [];
    for (sp = -45; sp <= 45; sp += 1.5) wt.push(sprayPt(sp, fenceAt(park, sp).dist));
    for (sp = 45; sp >= -45; sp -= 1.5) wt.push(sprayPt(sp, fenceAt(park, sp).dist - 14));
    fill(fpoly(wt), DIRT2);
    if (ft.hill) {
      var hl = []; for (sp = -12; sp <= 12; sp += 2) hl.push(sprayPt(sp, fenceAt(park, sp).dist - 14));
      for (sp = 12; sp >= -12; sp -= 2) hl.push(sprayPt(sp, fenceAt(park, sp).dist - 50 + Math.abs(sp) * 2.4));
      fill(fpoly(hl), { a: 0.72, c: 1 });
    }
    // infield
    var dirt = [];
    for (i = 0; i <= 40; i++) { var a = -0.9 + 1.8 * i / 40; dirt.push([95 * Math.sin(a), 60.5 + 95 * Math.cos(a), 0]); }
    dirt.push([63.64 + 8, 63.64 - 4, 0]); dirt.push([8, -8, 0]); dirt.push([-8, -8, 0]); dirt.push([-63.64 - 8, 63.64 - 4, 0]);
    fill(fpoly(dirt), DIRT);
    fill(fpoly([[0, 6], [57, 63.64], [0, 121], [-57, 63.64]]), { a: 0.5, c: 1 });
    fill(fpCircle(0, 59, 9), DIRT2);
    fill(fpoly([[-1, 60.3, 1], [1, 60.3, 1], [1, 60.9, 1], [-1, 60.9, 1]]), PAPER);
    fill(fpCircle(0, 0, 13), DIRT);
    // foul lines + bases
    var lines = new Path2D(), lA = fp(0, 0, 0);
    [-45, 45].forEach(function (sg) { var e = fp.apply(null, sprayPt(sg, fenceAt(park, sg).dist)); lines.moveTo(lA.x, lA.y); lines.lineTo(e.x, e.y); });
    stroke(lines, PAPER, 1.6);
    for (i = 1; i < 4; i++) {
      var B = K.BASES[i]; fill(fpoly([[B.x - 1.8, B.y], [B.x, B.y - 1.8], [B.x + 1.8, B.y], [B.x, B.y + 1.8]]), PAPER);
      stroke(fpoly([[B.x - 1.8, B.y], [B.x, B.y - 1.8], [B.x + 1.8, B.y], [B.x, B.y + 1.8]]), A1, 0.6, { over: true });
    }
    fill(fpoly([[-1, 0.7], [1, 0.7], [1, 0], [0, -1], [-1, 0]]), PAPER);
    // the wall
    var wallTop = [], wallBot = [];
    for (sp = -45; sp <= 45; sp += 1.5) { var fa = fenceAt(park, sp); wallTop.push(sprayPt(sp, fa.dist, fa.height)); wallBot.push(sprayPt(sp, fa.dist, 0)); }
    var wallP = fpoly(wallTop.concat(wallBot.slice().reverse()));
    fill(wallP, { a: 1, c: 0.15 });
    var wtl = new Path2D(); wallTop.forEach(function (w, j) { var wq = fp(w[0], w[1], w[2]); if (j) wtl.lineTo(wq.x, wq.y); else wtl.moveTo(wq.x, wq.y); });
    stroke(wtl, { a: 1 }, 4.5); stroke(wtl, C1, 1.8);
    // foul poles
    [-45, 45].forEach(function (sg) {
      var fa = fenceAt(park, sg), b0 = fp.apply(null, sprayPt(sg, fa.dist, 0)), b1 = fp.apply(null, sprayPt(sg, fa.dist, fa.height + 55));
      stroke(seg(b0.x, b0.y, b1.x, b1.y), C1, 2.4); stroke(seg(b0.x, b0.y, b1.x, b1.y), { a: 0.3 }, 0.6, { over: true });
    });
    // distance stencils on the grass, map style
    [-45, -22, 0, 22, 45].forEach(function (sg) {
      var fa = fenceAt(park, sg), mq = fp.apply(null, sprayPt(sg, fa.dist - 30));
      P.text(String(Math.round(fa.dist)), mq.x, mq.y + 3, R.mono(Math.max(7, 8.5 * S.W / 390), true), PAPER, { align: 'center' });
    });
    // light towers at the corners of the stands
    if (ft.lights) {
      [-52, -18, 18, 52].forEach(function (sg) {
        var fa = fenceAt(park, clamp(sg, -45, 45)), b0 = fp.apply(null, sprayPt(sg, fa.dist + 84, 48)), b1 = fp.apply(null, sprayPt(sg, fa.dist + 84, 130));
        stroke(seg(b0.x, b0.y, b1.x, b1.y), A1, 2);
        lightBank(b1.x, b1.y - 4, 18, 8, false);
      });
    }
    // scoreboard / billboard standing behind the ring
    if (ft.scoreboard) {
      var sb0 = fp.apply(null, sprayPt(-8, fenceAt(park, -8).dist + 90, 52)), sb1 = fp.apply(null, sprayPt(8, fenceAt(park, 8).dist + 90, 52));
      var sbw = sb1.x - sb0.x, sbh = sbw * 0.42, sby = Math.min(sb0.y, sb1.y) - sbh;
      fill(rect(sb0.x, sby, sbw, sbh), { a: 1, c: 0.15 });
      var nm = (park.town || park.name || '').toUpperCase(), ff = fitFont(nm, sbw - 8, sbh * 0.34);
      P.text(nm, sb0.x + sbw / 2, sby + sbh * 0.42, ff.font, PAPER, { align: 'center' });
      var bl = new Path2D(); for (i = 0; i < 9; i++) { var bx = sb0.x + 5 + i * (sbw - 10) / 8; bl.moveTo(bx + 1.4, sby + sbh * 0.72); bl.arc(bx, sby + sbh * 0.72, 1.4, 0, TAU); }
      fill(bl, C1);
    }
    if (ft.billboard) {
      var bb0 = fp.apply(null, sprayPt(24, fenceAt(park, 24).dist + 88, 52)), bb1 = fp.apply(null, sprayPt(40, fenceAt(park, 40).dist + 88, 52));
      var bbw = Math.abs(bb1.x - bb0.x), bbh = Math.max(12, bbw * 0.3), bby = Math.min(bb0.y, bb1.y) - bbh - 2, bbx = Math.min(bb0.x, bb1.x);
      fill(rect(bbx - 1.5, bby - 1.5, bbw + 3, bbh + 3), A1);
      fill(rect(bbx, bby, bbw, bbh), B1);
      var bt = String(ft.billboard).split(/\s*·\s*/)[0], bf = fitFont(bt, bbw - 6, bbh * 0.6);
      P.text(bt, bbx + bbw / 2, bby + bbh / 2 + bf.px * 0.36, bf.font, PAPER, { align: 'center' });
    }
  }
  function fpCircle(cx, cy, r) {
    var p = new Path2D();
    for (var i = 0; i <= 36; i++) { var a = TAU * i / 36, q = fp(cx + r * Math.cos(a), cy + r * Math.sin(a), 0); if (i) p.lineTo(q.x, q.y); else p.moveTo(q.x, q.y); }
    p.closePath(); return p;
  }

  // field camera: follows the ball on deep / high hits (pan + mild zoom over the baked map)
  function fieldView(view) {
    var play = view.play, t = view.playT || 0, W = S.W, H = S.H;
    var z = 1, cx = W / 2, cy = H / 2;
    if (play && play.ballAt) {
      var n = 6, ax = 0, ay = 0, deep = 0;
      for (var i = 0; i < n; i++) {
        var tt = Math.max(0, t - i * 0.08), b = play.ballAt(Math.min(tt, play.dur || tt)), q = fp(b.x, b.y, b.z);
        ax += q.x; ay += q.y;
        deep = Math.max(deep, clamp((Math.sqrt(b.x * b.x + b.y * b.y) - 180) / 170, 0, 1) * 0.7 + clamp(b.z / 110, 0, 1) * 0.5);
      }
      ax /= n; ay /= n;
      var k = smooth(clamp(deep, 0, 1));
      z = 1 + 0.24 * k;
      cx = lerp(W / 2, ax, 0.75 * k); cy = lerp(H / 2, ay + H * 0.08, 0.75 * k);
    }
    var hw = W / 2 / z, hh = H / 2 / z;
    cx = clamp(cx, hw - M * 0.5, W - hw + M * 0.5); cy = clamp(cy, hh - M * 0.5, H - hh + M * 0.5);
    return { z: z, cx: cx, cy: cy };
  }
  function applyFieldView(fv) { P.translate(S.W / 2, S.H / 2); P.scale(fv.z, fv.z); P.translate(-fv.cx, -fv.cy); }
  function loadFieldBake(fv) {
    var bake = S.fbake;
    for (var i = 0; i < 3; i++) {
      var s = R.SLOTS[i], x = P.layer(s);
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, P.pw, P.ph); x.restore();
      x.save();
      x.translate(S.W / 2, S.H / 2); x.scale(fv.z, fv.z); x.translate(-fv.cx, -fv.cy);
      x.imageSmoothingEnabled = true;
      x.drawImage(bake[s], -M, -M, S.W + 2 * M, S.H + 2 * M);
      x.restore();
    }
  }

  function figure(x, y, sc, inks, cap, moving, time, glove) {
    // a little stamped player: shadow, legs, body, head, cap
    var h = sc;
    fill(ell(x, y, h * 0.42, h * 0.13), { a: 0.45 }, { over: true });
    var st = moving ? Math.sin(time * 18) * h * 0.18 : 0;
    var lg = new Path2D(); lg.moveTo(x - h * 0.12, y - h * 0.42); lg.lineTo(x - h * 0.14 - st, y); lg.moveTo(x + h * 0.12, y - h * 0.42); lg.lineTo(x + h * 0.14 + st, y);
    stroke(lg, A1, Math.max(1.2, h * 0.16));
    var body = R.rrect(x - h * 0.26, y - h * 0.86, h * 0.52, h * 0.5, h * 0.18);
    stroke(body, A1, Math.max(1, h * 0.08)); fill(body, inks);
    fill(circ(x, y - h * 1.02, h * 0.19), SKIN);
    stroke(circ(x, y - h * 1.02, h * 0.19), A1, Math.max(0.6, h * 0.05), { over: true });
    var cp = new Path2D(); cp.arc(x, y - h * 1.06, h * 0.2, PI, TAU); cp.lineTo(x + h * 0.3, y - h * 1.06); cp.closePath();
    fill(cp, cap);
    if (glove) fill(circ(x + h * 0.32, y - h * 0.62, h * 0.12), GLOVE);
  }
  var FIELDERS = ['P', 'C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF'];
  var DEF_POS = { P: [0, 59], C: [0, -4], '1B': [52, 82], '2B': [30, 132], SS: [-30, 132], '3B': [-52, 82], LF: [-125, 270], CF: [0, 310], RF: [125, 270] };
  function fielderXY(play, i, t) {
    if (play && play.fielderAt) { try { var r = play.fielderAt(i, t); if (r) return r; } catch (e) {} }
    var d = (BB.Bat && BB.Bat.FIELDERS && BB.Bat.FIELDERS[FIELDERS[i]]) || null;
    if (d) return { x: d.x, y: d.y };
    var q = DEF_POS[FIELDERS[i]]; return { x: q[0], y: q[1] };
  }
  function basePath(from, to, u) {
    // walk the bases from 'from' toward 'to' (4 = home); -1 = thrown out (stops halfway to the next bag)
    var tgt = to < 0 ? from + 0.5 : to, total = tgt - from;
    if (total <= 0) { var b = K.BASES[from % 4]; return { x: b.x, y: b.y, alive: to >= 0 || u < 0.85 }; }
    var d = from + total * clamp(u, 0, 1), i0 = Math.floor(d), f = d - i0;
    var A = K.BASES[i0 % 4], B = K.BASES[(i0 + 1) % 4];
    return { x: lerp(A.x, B.x, f), y: lerp(A.y, B.y, f), alive: to >= 0 || u < 0.9 };
  }
  function crossingT(play, park, pred) {
    var dur = play.dur || 3, n = 80;
    for (var i = 1; i <= n; i++) { var t = dur * i / n, b = play.ballAt(t); if (pred(b, t)) return t; }
    return -1;
  }
  function drawFieldDynamic(view, park, time) {
    var play = view.play, t = view.playT || 0, i;
    var sc = function (q) { return Math.max(14, 6.2 * q.s * 3.2); };
    // runners (hero team, slot B)
    var runners = view.runners || [];
    var u = play ? clamp(t / Math.max(0.6, (play.dur || 2) * 0.92), 0, 1) : 1;
    var drawn = {};
    runners.forEach(function (rm) {
      if (rm == null || rm.from == null) return;
      var p = basePath(rm.from, rm.to, U.easeOut(u) * 0.3 + u * 0.7);
      if (!p.alive) return;
      var q = fp(p.x, p.y, 0);
      figure(q.x, q.y, sc(q), B1, A1, u < 1 && rm.to !== rm.from, time + rm.from, false);
      drawn[rm.from] = true;
    });
    if (!runners.length && view.hud && view.hud.bases) {
      view.hud.bases.forEach(function (on, k) { if (!on) return; var B = K.BASES[k + 1], q = fp(B.x, B.y, 0); figure(q.x, q.y, sc(q), B1, A1, false, 0, false); });
    }
    // fielders (opposing team, slot A caps, paper uniforms)
    var order = [];
    for (i = 0; i < 9; i++) {
      var f0 = fielderXY(play, i, t), f1 = fielderXY(play, i, Math.max(0, t - 0.06));
      order.push({ i: i, x: f0.x, y: f0.y, mv: Math.abs(f0.x - f1.x) + Math.abs(f0.y - f1.y) > 0.3 });
    }
    order.sort(function (a, b) { return b.y - a.y; });
    order.forEach(function (o) { var q = fp(o.x, o.y, 0); figure(q.x, q.y, sc(q), { a: 0.25 }, A1, o.mv, time + o.i, true); });
    if (!play || !play.ballAt) return;
    var dur = play.dur || 3, tt = Math.min(t, dur);
    // HR / wall moments
    if (play.type === 'HR') {
      var tc = crossingT(play, park, function (b) { var sp = U.deg(Math.atan2(b.x, b.y)); return Math.sqrt(b.x * b.x + b.y * b.y) >= fenceAt(park, clamp(sp, -45, 45)).dist; });
      if (tc >= 0 && tt >= tc) {
        var bc = play.ballAt(tc), qc = fp(bc.x, bc.y, bc.z), e = clamp((tt - tc) / 0.7, 0, 1);
        if (e < 1) {
          fill(R.star(qc.x, qc.y, 16 + 50 * U.easeOut(e), 8 + 22 * U.easeOut(e), 12, e, 0.3, U.rng(3)), { c: 1 - e * e }, { over: true });
          fill(R.star(qc.x, qc.y, 10 + 30 * U.easeOut(e), 5 + 12 * U.easeOut(e), 8, -e, 0.2, U.rng(4)), { b: 1 - e }, { over: true });
        }
        // fireworks over the stands
        for (i = 0; i < 4; i++) {
          var ft0 = tc + 0.25 + i * 0.32, fe = (tt - ft0) / 0.9;
          if (fe < 0 || fe > 1) continue;
          var rr = U.rng(90 + i), fx = S.W * (0.18 + 0.64 * rr()), fy = S.H * (0.2 + 0.12 * rr()), R0 = 14 + 34 * U.easeOut(fe);
          var fw = new Path2D();
          for (var k = 0; k < 14; k++) { var a = k / 14 * TAU, r1 = R0 * 0.55, r2 = R0; fw.moveTo(fx + Math.cos(a) * r1, fy + Math.sin(a) * r1); fw.lineTo(fx + Math.cos(a) * r2, fy + Math.sin(a) * r2); }
          P.save(); P.translate(S.W / 2, S.H / 2); P.scale(1 / view._fz, 1 / view._fz); P.translate(-S.W / 2, -S.H / 2);
          stroke(fw, i % 2 ? { b: 1 - fe } : { c: 1 - fe * 0.5, b: 0.3 * (1 - fe) }, 2.2, { over: true });
          fill(circ(fx, fy, 3 * (1 - fe)), { c: 1 }, { over: true });
          P.restore();
        }
      }
    }
    if (play.wall) {
      var tw = crossingT(play, park, function (b) { var sp = U.deg(Math.atan2(b.x, b.y)); return Math.sqrt(b.x * b.x + b.y * b.y) >= fenceAt(park, clamp(sp, -45, 45)).dist - 3; });
      if (tw >= 0 && tt >= tw && tt < tw + 1.1) {
        var bw = play.ballAt(tw), qw = fp(bw.x, bw.y, Math.min(bw.z, 4)), de = (tt - tw) / 1.1, dr = U.rng(8);
        var dust = new Path2D();
        for (i = 0; i < 7; i++) {
          var dx = (dr() - 0.5) * 30 * (0.4 + de), dy = -dr() * 16 * (0.3 + de), drr = (3 + dr() * 5) * (0.6 + de);
          dust.addPath(R.blob(qw.x + dx, qw.y + dy, drr, 7, dr, 0.25));
        }
        fill(dust, { a: 0.3 * (1 - de), b: 0.45 * (1 - de), c: 0.6 * (1 - de) }, { over: true });
        if (de < 0.3) P.text('CLANG!', qw.x, qw.y - 18, R.display(12), { b: 1 }, { align: 'center', outline: 2 });
      }
    }
    // ball: dotted trail, height line, shadow, ball
    var b = play.ballAt(tt), qb = fp(b.x, b.y, b.z), qs = fp(b.x, b.y, 0);
    var trail = new Path2D(), trail2 = new Path2D(), step = 0.055, n = Math.floor(tt / step);
    for (i = Math.max(0, n - 70); i <= n; i++) {
      var bt = play.ballAt(i * step), q = fp(bt.x, bt.y, bt.z), r = 1.8;
      if (i % 4 === 0) { trail2.moveTo(q.x + 2.6, q.y); trail2.arc(q.x, q.y, 2.6, 0, TAU); }
      else { trail.moveTo(q.x + r, q.y); trail.arc(q.x, q.y, r, 0, TAU); }
    }
    fill(trail, { a: 1 }, { over: true }); fill(trail2, { b: 1, c: 0.4 }, { over: true });
    fill(ell(qs.x, qs.y, 5.5, 2.2), { a: 0.65 }, { over: true });
    if (b.z > 4) stroke(seg(qs.x, qs.y, qb.x, qb.y), { a: 0.6 }, 0.8, { over: true, dash: [1.5, 3] });
    var br = clamp(4.2 + b.z * 0.03, 4.2, 8);
    drawBallSprite(qb.x, qb.y, br, tt * 20);
    // catch pop
    if (play.catchBy >= 0 && play.catchT > 0 && tt >= play.catchT && tt < play.catchT + 0.5) {
      var cf = fielderXY(play, play.catchBy, play.catchT), cq = fp(cf.x, cf.y, 5), ce = (tt - play.catchT) / 0.5;
      fill(R.star(cq.x, cq.y - 6, 9 + 10 * ce, 4 + 4 * ce, 8, 0, 0, null), { c: 1 - ce }, { over: true });
    }
  }

  // ------------------------------------------------------------------ TITLE backdrop
  function drawTitleBackground(park) {
    var W = S.W, H = S.H, ft = feat(park), seed = hash(park.id), i;
    var hz = H * 0.4;
    skyBands(-M, hz, [0.78, 0.66, 0.55, 0.45, 0.36, 0.28], [[0.12, 0], [0.25, 0.15], [0.35, 0.35]]);
    // stars knocked out of the night sky
    var stars = new Path2D(), r = U.rng(seed + 1);
    for (i = 0; i < 60; i++) { var sx = r() * W, sy = r() * hz * 0.6, sr = 0.5 + r() * r() * 1.4; stars.moveTo(sx + sr, sy); stars.arc(sx, sy, sr, 0, TAU); }
    fill(stars, PAPER);
    // halo rings around the moon-ball (dynamic ball drawn per frame)
    var mx = W * 0.58, my = H * 0.19, mr = Math.min(W * 0.22, H * 0.12);
    fill(circ(mx, my, mr * 1.5), { c: 0.18 }, { over: true });
    fill(circ(mx, my, mr * 1.25), { c: 0.32 }, { over: true });
    skyline(ft.skyline || 'city', -M, W + M, hz - H * 0.035, Math.min(1.25, W / 360), U.rng(seed + 11));
    // light towers with beams
    [0.1, 0.9].forEach(function (fx) {
      var lx = W * fx, top = hz - H * 0.2;
      stroke(seg(lx, top, lx, hz), A1, 3.4);
      var lat = new Path2D(); for (var yy = top + 6; yy < hz; yy += 8) { lat.moveTo(lx - 3, yy); lat.lineTo(lx + 3, yy + 6); }
      stroke(lat, A1, 0.9);
      fill(R.poly([lx - 18, top + 4, lx + 18, top + 4, W * 0.5 + (fx < 0.5 ? -30 : 30), hz + H * 0.08, W * 0.5 + (fx < 0.5 ? -120 : 120), hz + H * 0.08]), { c: 0.14 }, { over: true });
      lightBank(lx, top - 4, 38, 16, false);
    });
    // stands silhouette with a sprinkle of crowd
    fill(rect(-M, hz - H * 0.03, W + 2 * M, H * 0.06), { a: 0.95, b: 0.25 });
    crowd(-M, W + M, hz - H * 0.024, hz + H * 0.026, 5.2, seed + 3, 0, null, null);
    fill(rect(-M, hz + H * 0.028, W + 2 * M, 4), C1);
    // calm lower field: light grass with broad mowing bands and a faint diamond
    fill(rect(-M, hz + H * 0.03, W + 2 * M, H), { a: 0.14, c: 0.42 });
    var bands = new Path2D();
    for (i = 0; i < 6; i++) { var y0 = hz + H * 0.03 + Math.pow(i / 6, 1.6) * H * 0.6, y1 = hz + H * 0.03 + Math.pow((i + 0.5) / 6, 1.6) * H * 0.6; bands.rect(-M, y0, W + 2 * M, y1 - y0); }
    fill(bands, { a: 0.2, c: 0.5 }, { over: true });
    var dm = new Path2D(), bx = W / 2, by = H * 1.02;
    dm.moveTo(bx, by); dm.lineTo(bx + W * 0.62, by - H * 0.2); dm.lineTo(bx, by - H * 0.36); dm.lineTo(bx - W * 0.62, by - H * 0.2); dm.closePath();
    stroke(dm, PAPER, 2);
  }
  function drawTitleDynamic(view, time) {
    var W = S.W, H = S.H, mx = W * 0.58, my = H * 0.19, mr = Math.min(W * 0.22, H * 0.12), i;
    // the moon is a baseball
    var moon = circ(mx, my, mr);
    fill(moon, PAPER);
    P.save(); P.clip(moon);
    fill(circ(mx + mr * 0.35, my + mr * 0.3, mr * 1.05), { c: 0.45 }, { over: true });
    fill(circ(mx + mr * 0.55, my + mr * 0.5, mr * 0.95), { c: 0.6, b: 0.12 }, { over: true });
    var rot = time * 0.12, seams = new Path2D(), stitches = new Path2D();
    for (var sd = -1; sd <= 1; sd += 2) {
      var pts = [];
      for (i = 0; i <= 28; i++) {
        var a = -1.2 + 2.4 * i / 28, px = sd * (mr * 1.25 - Math.cos(a) * mr * 0.62), py = Math.sin(a) * mr * 0.95;
        var cx = mx + px * Math.cos(rot) - py * Math.sin(rot), cy = my + px * Math.sin(rot) + py * Math.cos(rot);
        pts.push([cx, cy]);
      }
      pts.forEach(function (p, k) { if (k) seams.lineTo(p[0], p[1]); else seams.moveTo(p[0], p[1]); });
      for (i = 1; i < pts.length - 1; i += 2) {
        var dx = pts[i + 1][0] - pts[i - 1][0], dy = pts[i + 1][1] - pts[i - 1][1], dl = Math.sqrt(dx * dx + dy * dy) || 1, nx = -dy / dl, ny = dx / dl, L = mr * 0.07;
        stitches.moveTo(pts[i][0] - nx * L - dx / dl * L * 0.6, pts[i][1] - ny * L - dy / dl * L * 0.6); stitches.lineTo(pts[i][0], pts[i][1]);
        stitches.lineTo(pts[i][0] + nx * L - dx / dl * L * 0.6, pts[i][1] + ny * L - dy / dl * L * 0.6);
      }
    }
    stroke(seams, { b: 1 }, 1.6, { over: true });
    stroke(stitches, { b: 1 }, 1.4, { over: true });
    P.restore();
    stroke(moon, A1, 1.5, { over: true });
    // twinkling light banks
    [0.1, 0.9].forEach(function (fx, k) {
      var lx = W * fx, top = H * 0.4 - H * 0.2 - 4;
      if (Math.sin(time * 3 + k * 2) > 0.6) fill(R.star(lx, top, 26, 8, 6, time, 0, null), { c: 0.5 }, { over: true });
    });
    // every few seconds a fly ball arcs across the sky with a dotted trail
    var cyc = 7, ph = (time % cyc) / 3.2, n = Math.floor(time / cyc);
    if (ph < 1) {
      var rr = U.rng(n * 13 + 1), x0 = W * (0.1 + rr() * 0.2), x1 = W * (0.75 + rr() * 0.2), y0 = H * 0.38, peak = H * (0.05 + rr() * 0.08);
      var tr = new Path2D();
      for (i = 0; i <= 30; i++) {
        var u = ph * i / 30, bx = lerp(x0, x1, u), by = y0 - (y0 - peak) * 4 * u * (1 - u);
        tr.moveTo(bx + 1.2, by); tr.arc(bx, by, 1.2, 0, TAU);
      }
      fill(tr, { c: 1 }, { over: true });
      var ub = ph, bxx = lerp(x0, x1, ub), byy = y0 - (y0 - peak) * 4 * ub * (1 - ub);
      drawBallSprite(bxx, byy, 3.2, time * 10);
    }
  }

  // ------------------------------------------------------------------ HUD
  function drawHud(view) {
    var hud = view.hud;
    if (!hud) return;
    var W = S.W, x0 = 10, y0 = 52, w = Math.min(W - x0 - 64, 340), h = 58;
    // double plate: B "shadow" print + paper plate with an A keyline
    fill(R.rrect(x0 + 3, y0 + 3, w, h, 4), { b: 1 });
    var plate = R.rrect(x0, y0, w, h, 4);
    fill(plate, PAPER); stroke(plate, A1, 2);
    // score block
    var sw = Math.min(96, w * 0.3);
    fill(R.rrect(x0 + 4, y0 + 4, sw, h - 8, 2), A1);
    var score = String(hud.score != null ? hud.score : ''), sf = fitFont(score, sw - 10, 25);
    P.text(score, x0 + 4 + sw / 2, y0 + 7 + sf.px * 0.95, sf.font, PAPER, { align: 'center' });
    var inn = String(hud.inning || '').toUpperCase();
    if (inn) P.text(inn, x0 + 4 + sw / 2, y0 + h - 9, R.mono(9, true), { c: 1 }, { align: 'center' });
    // count dots
    var cx = x0 + sw + 14, rows = [['B', 3, hud.balls || 0, { c: 1, a: 0.12 }], ['S', 2, hud.strikes || 0, { b: 1 }], ['O', hud.outsMax && hud.outsMax <= 5 ? hud.outsMax - (hud.outsMax === 3 ? 1 : 0) : 2, hud.outs || 0, A1]];
    var lf = R.mono(9.5, true);
    rows.forEach(function (rw, k) {
      var yy = y0 + 13 + k * 16;
      P.text(rw[0], cx, yy + 3.5, lf, A1, { align: 'center', over: true });
      var max = rw[1];
      if (rw[0] === 'O' && hud.outsMax > 5) {
        P.text((hud.outs || 0) + '/' + hud.outsMax, cx + 9, yy + 3.5, R.mono(9.5, true), A1, { over: true });
        return;
      }
      for (var i = 0; i < max; i++) {
        var dc = circ(cx + 12 + i * 11, yy, 4.2);
        if (i < rw[2]) { fill(dc, rw[3]); stroke(dc, A1, 1.2, { over: true }); }
        else stroke(dc, { a: 1 }, 1.2, { over: true });
      }
    });
    // mini diamond
    var dx = cx + 58, dy = y0 + h / 2 + 1, ds = 7.5, bases = hud.bases || [];
    [[1, ds * 1.35, 0], [2, 0, -ds * 1.35], [3, -ds * 1.35, 0]].forEach(function (bb) {
      var bp = R.poly([dx + bb[1], dy + bb[2] - ds * 0.62, dx + bb[1] + ds * 0.62, dy + bb[2], dx + bb[1], dy + bb[2] + ds * 0.62, dx + bb[1] - ds * 0.62, dy + bb[2]]);
      if (bases[bb[0] - 1]) { fill(bp, { b: 1, c: 1 }); stroke(bp, A1, 1.2, { over: true }); }
      else stroke(bp, A1, 1.2, { over: true });
    });
    fill(R.poly([dx, dy + ds * 1.35 - 3, dx + 3, dy + ds * 1.35, dx, dy + ds * 1.35 + 3, dx - 3, dy + ds * 1.35]), A1);
    // goal + progress
    var gx = dx + ds * 2.4 + 6, gw = x0 + w - gx - 6;
    if (gw > 40) {
      var goal = String(hud.goal || '').toUpperCase(), prog = hud.progress != null ? String(hud.progress) : '';
      if (prog) {
        var pf = fitFont(prog, gw, 15);
        P.text(prog, gx, y0 + 21, pf.font, { b: 1 }, { over: false });
      }
      var gf = R.mono(8.2, true), words = goal.split(' '), line = '', ly = y0 + (prog ? 34 : 18), lines = 0;
      for (var i = 0; i < words.length && lines < 2; i++) {
        var test = line ? line + ' ' + words[i] : words[i];
        if (P.measure(test, gf) > gw && line) { P.text(line, gx, ly, gf, A1, { over: true }); ly += 10; lines++; line = words[i]; }
        else line = test;
      }
      if (line && lines < 2) P.text(line, gx, ly, gf, A1, { over: true });
    }
    // last pitch readout (tag under the pause button)
    if (view.last && view.last.mph) {
      var tx = W - 12, ty = y0 + h + 14, txt = String(Math.round(view.last.mph)), nm = String(view.last.name || '').toUpperCase();
      var nf = R.display(15), tw = Math.max(P.measure(txt, nf) + 34, P.measure(nm, R.mono(7.5, true)) + 12);
      var tag = R.poly([tx - tw, ty - 12, tx, ty - 12, tx, ty + 15, tx - tw, ty + 15, tx - tw - 6, ty + 1.5]);
      fill(tag, { c: 1 }); stroke(tag, A1, 1.4, { over: true });
      P.text(txt, tx - tw + 4, ty + 3, nf, A1, { over: true });
      P.text('MPH', tx - 5, ty + 2, R.mono(7.5, true), A1, { align: 'right', over: true });
      P.text(nm, tx - tw + 4, ty + 12, R.mono(7, true), { b: 1 }, { over: true });
    }
    // streak / on fire
    var streak = hud.streak || 0;
    if (streak > 0 || view.onFire) {
      var fx = x0 + 4, fy = y0 + h + 16;
      for (var k = 0; k < Math.min(streak, 6); k++) flame(fx + 7 + k * 13, fy + 4, 6.5, view.time + k, view.onFire);
      if (view.onFire) P.text('ON FIRE', fx + Math.min(streak, 6) * 13 + 8, fy + 8, R.display(13), { b: 1, c: 0.6 }, { outline: 1.5 });
    }
  }
  function flame(x, y, s, t, hot) {
    var w = Math.sin(t * 9) * s * 0.12;
    var p = new Path2D();
    p.moveTo(x, y + s * 0.6);
    p.quadraticCurveTo(x - s * 0.9, y + s * 0.3, x - s * 0.4 + w, y - s * 0.6);
    p.quadraticCurveTo(x - s * 0.15, y - s * 0.1, x + w * 2, y - s * 1.4);
    p.quadraticCurveTo(x + s * 0.4, y - s * 0.5, x + s * 0.5 + w, y - s * 0.8);
    p.quadraticCurveTo(x + s * 0.95, y + s * 0.2, x, y + s * 0.6);
    p.closePath();
    fill(p, hot ? { b: 1, c: 1 } : { b: 0.7, c: 0.8 });
    fill(ell(x, y + s * 0.15, s * 0.28, s * 0.4), C1);
  }

  // ------------------------------------------------------------------ ON FIRE flood
  function drawFire(time, yTop, yBot) {
    var W = S.W, H = S.H;
    P.flood('b', 0.2);
    var p = new Path2D(), n = 9;
    for (var i = 0; i < n; i++) {
      var x = -10 + (W + 20) * (i + 0.5) / n, hgt = (36 + 22 * Math.sin(time * 5 + i * 1.7)) * (S.H / 844), w = W / n * 0.75;
      var tip = Math.sin(time * 7 + i) * 8;
      p.moveTo(x - w, yBot);
      p.quadraticCurveTo(x - w * 0.9, yBot - hgt * 0.6, x + tip, yBot - hgt * 1.25);
      p.quadraticCurveTo(x + w * 0.2, yBot - hgt * 0.55, x + w * 0.45, yBot - hgt * 0.75);
      p.quadraticCurveTo(x + w * 1.05, yBot - hgt * 0.3, x + w, yBot);
      p.closePath();
    }
    fill(p, { b: 0.9, c: 1 });
    stroke(p, { b: 1 }, 1.5, { over: true });
    var p2 = new Path2D();
    for (i = 0; i < n; i++) {
      var x2 = -10 + (W + 20) * (i + 0.5) / n, h2 = (16 + 10 * Math.sin(time * 6 + i)) * (S.H / 844);
      p2.moveTo(x2 - 6, yBot); p2.quadraticCurveTo(x2 - 5, yBot - h2 * 0.6, x2, yBot - h2); p2.quadraticCurveTo(x2 + 5, yBot - h2 * 0.6, x2 + 6, yBot); p2.closePath();
    }
    fill(p2, { c: 1, b: 0.15 });
    // rising embers
    var em = new Path2D(), r = U.rng(3);
    for (i = 0; i < 26; i++) {
      var ex = r() * W, sp = 20 + r() * 40, ey = yBot - ((time * sp + r() * 400) % Math.max(60, yBot - yTop)), er = 1 + r() * 2;
      em.moveTo(ex + er, ey); em.arc(ex + Math.sin(time * 3 + i) * 5, ey, er, 0, TAU);
    }
    fill(em, { b: 1, c: 1 }, { over: true });
  }

  // ------------------------------------------------------------------ STAMPS
  function drawStamp(st, scene) {
    if (!st || !st.text) return;
    var t = st.t || 0, W = S.W, H = S.H, kind = st.kind || 'good';
    var dur = kind === 'neutral' ? 1.1 : kind === 'huge' ? 1.8 : 1.4;
    if (t > dur) return;
    var fade = clamp((t - (dur - 0.4)) / 0.4, 0, 1);         // halftone dissolve at the end
    var thunk = clamp(t / 0.13, 0, 1), sc = kind === 'neutral' ? lerp(1.5, 1, U.easeOut(thunk)) : lerp(2.4, 1, U.easeIn(thunk) * 0.3 + U.easeOut(thunk) * 0.7);
    var seed = hash(st.text), rot = ((seed % 100) / 100 - 0.5) * 0.12 - 0.05;
    var cx = W / 2, cy = kind === 'neutral' ? H * 0.3 : scene === 'field' ? H * 0.36 : H * 0.42;
    var txt = String(st.text).toUpperCase(), sub = st.sub ? String(st.sub) : '';
    var maxW = kind === 'neutral' ? W * 0.62 : W * 0.9, base = kind === 'huge' ? 120 : kind === 'neutral' ? 34 : 64;
    var ff = fitFont(txt, maxW, base), px = ff.px;
    var tone = 1 - fade;
    var settle = thunk < 1 ? 0 : Math.exp(-(t - 0.13) * 18) * Math.sin((t - 0.13) * 50) * 0.03;
    P.save(); P.translate(cx, cy); P.rotate(rot + (1 - thunk) * -0.15 + settle); P.scale(sc, sc);
    if (kind === 'huge') {
      fill(R.star(0, -px * 0.3, W * 0.62, W * 0.4, 16, t * 0.4, 0.15, U.rng(seed)), { c: tone }, { over: true });
      fill(R.rays(0, -px * 0.3, W * 0.9, 18, t * 0.25, 0.4), { b: 0.3 * tone }, { over: true });
    }
    var main = kind === 'bad' ? { a: tone } : kind === 'neutral' ? { a: tone } : { b: tone };
    var shadow = kind === 'bad' ? { b: tone } : kind === 'neutral' ? { c: tone } : { a: tone };
    // double hit: the second impression lands offset and converges as the stamp settles
    var dh = (1 - thunk) * 14 + 3.2;
    P.text(txt, dh * 0.7, dh * 0.6, ff.font, shadow, { align: 'center', over: kind === 'neutral', outline: kind === 'neutral' ? 0 : 3 });
    P.text(txt, 0, 0, ff.font, main, { align: 'center', over: kind !== 'neutral', outline: kind === 'neutral' ? 3 : 0 });
    if (kind === 'bad') stroke(seg(-P.measure(txt, ff.font) * 0.55, -px * 0.3, P.measure(txt, ff.font) * 0.55, -px * 0.42), { b: tone }, Math.max(3, px * 0.09), { over: true });
    if (sub) {
      var sf = fitFont(sub, W * 0.84, kind === 'neutral' ? 11 : 13, function (px) { return R.mono(px, true); }).font, sw = P.measure(sub, sf) + 18;
      var sy = px * 0.35 + 8;
      var rib = R.poly([-sw / 2 - 8, sy, sw / 2 + 8, sy, sw / 2, sy + 10, sw / 2 + 8, sy + 20, -sw / 2 - 8, sy + 20, -sw / 2, sy + 10]);
      if (tone > 0.2) { fill(rib, kind === 'bad' ? { b: tone } : { a: tone }); P.text(sub, 0, sy + 14.5, sf, PAPER, { align: 'center', ko: ['a', 'b', 'c'] }); }
    }
    P.restore();
  }

  // ------------------------------------------------------------------ caches
  function inksFor(view) {
    if (S.inkPick) return S.inkPick;
    var park = parkOf(view);
    return R.inks(park.inkset || 'classic');
  }
  function cacheKey(scene, park, inks) { return scene + '|' + park.id + '|' + inks.id + '|' + S.W + 'x' + S.H + '@' + S.dpr; }
  function snapBand(y0, y1) {
    var d = S.dpr, py0 = Math.max(0, Math.floor((y0 + M) * d)), py1 = Math.min(S.P.ph, Math.ceil((y1 + M) * d)), o = { py0: py0, ph: py1 - py0 };
    R.SLOTS.forEach(function (s) {
      var c = R.canvas(S.P.pw, o.ph), x = c.getContext('2d');
      x.drawImage(S.P.c[s], 0, py0, S.P.pw, o.ph, 0, 0, S.P.pw, o.ph);
      o[s] = c;
    });
    return o;
  }
  function loadBand(b) {
    R.SLOTS.forEach(function (s) {
      var x = S.P.layer(s);
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0);
      x.clearRect(0, b.py0, S.P.pw, b.ph);
      x.drawImage(b[s], 0, b.py0);
      x.restore();
    });
  }
  function dropCaches(keep) {
    for (var k in S.cache) if (!keep || keep.indexOf(k) < 0) delete S.cache[k];
  }
  function ensureBat(park, inks) {
    var key = cacheKey('bat', park, inks);
    if (S.cache[key]) return S.cache[key];
    var t0 = now();
    P = S.P; P.setInks(inks);
    var g = batGeom(park), entry = { key: key, bands: [] };
    for (var v = 0; v < 3; v++) {
      P.reset(); P.clear();
      drawBatBackground(park, v);
      P.starve(0.55);
      if (v === 0) entry.snap = P.snapshot();
      entry.bands.push(snapBand(g.bandY0, g.bandY1));
    }
    dropCaches([key, cacheKey('field', park, inks)]);
    S.cache[key] = entry;
    S.built = now() - t0;
    return entry;
  }
  function ensureField(park, inks) {
    var key = cacheKey('field', park, inks);
    if (S.cache[key]) { S.fcam = S.cache[key].cam; return S.cache[key]; }
    var t0 = now();
    layoutField(park);
    var bake = R.press({ w: S.W, h: S.H, dpr: S.dpr * 1.25, margin: M, inks: inks, cell: 4.2 });
    var prevP = P; P = bake; P.reset(); P.clear();
    drawFieldBackground(park);
    P.starve(0.5);
    P = prevP;
    var entry = { key: key, snap: bake.c, cam: S.fcam };
    for (var k in S.cache) if (k.indexOf('field|') === 0) delete S.cache[k];
    S.cache[key] = entry;
    S.built = now() - t0;
    return entry;
  }
  function ensureTitle(park, inks) {
    var key = cacheKey('title', park, inks);
    if (S.cache[key]) return S.cache[key];
    P = S.P; P.setInks(inks); P.reset(); P.clear();
    drawTitleBackground(park);
    P.starve(0.5);
    var entry = { key: key, snap: P.snapshot() };
    for (var k in S.cache) if (k.indexOf('title|') === 0) delete S.cache[k];
    S.cache[key] = entry;
    return entry;
  }
  function now() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()); }

  // ------------------------------------------------------------------ frame
  function frame(view) {
    if (!S.ctx) return;
    view = view || { scene: 'title' };
    var t0 = now();
    adapt(t0, view.scene);
    var scene = view.scene || 'title', park = parkOf(view), inks = inksFor(view), time = view.time || 0;
    P = S.P; P.setInks(inks);
    var fr = R.fontsReady();
    if (fr !== S.fontOK) { S.fontOK = fr; S.cache = {}; }   // baked text must use the real faces once they load
    if (view.hitstop) time = S.freezeT; else S.freezeT = time;
    if (scene !== S.lastScene) {
      if (scene === 'title') { for (var k in S.cache) if (k.indexOf('title|') < 0) delete S.cache[k]; }
      else { for (var k2 in S.cache) if (k2.indexOf('title|') === 0) delete S.cache[k2]; }
      S.lastScene = scene;
    }
    if (scene === 'bat') frameBat(view, park, inks, time);
    else if (scene === 'field') frameField(view, park, inks, time);
    else frameTitle(view, park, inks, time);

    // print
    var amp = scene === 'title' ? 1.5 : 1.1;
    var offs = R.offsets(time, amp, clamp(view.shake || 0, 0, 1));
    if (view.onFire && scene !== 'title') { offs.b.x += Math.sin(time * 13) * 0.8; offs.c.y += Math.cos(time * 11) * 0.8; }
    P.composite(S.ctx, offs, { grainShift: 0 });
    var dt = now() - t0;
    S.perf.push(dt); if (S.perf.length > 120) S.perf.shift();
  }
  function frameTitle(view, park, inks, time) {
    var e = ensureTitle(park, inks);
    P.reset(); P.load(e.snap);
    drawTitleDynamic(view, time);
    P.reset();
  }
  function frameBat(view, park, inks, time) {
    var e = ensureBat(park, inks);
    // bake the field map on a quiet frame so the moment of contact never hitches
    if (!view.pitch && view.windup == null && !S.cache[cacheKey('field', park, inks)]) {
      if (S.quiet = (S.quiet || 0) + 1, S.quiet > 2) { S.quiet = 0; ensureField(park, inks); P = S.P; P.setInks(inks); }
    }
    P.reset(); P.load(e.snap);
    var g = batGeom(park);
    // crowd shimmer: swap pre-printed crowd bands (faster when the crowd is roaring)
    var rate = view.onFire ? 9 : 3.2, vi = Math.floor(time * rate) % 4;
    vi = vi === 3 ? 1 : vi;
    if (vi) loadBand(e.bands[vi]);
    if (view.onFire) drawFire(time, g.standsTop, g.hz + 6);
    // flags on the roof
    flags(time, g);
    var pitcher = view.pitcher || DEFAULT_PITCHER, pitch = view.pitch;
    var ph = 0;
    if (view.windup != null) ph = clamp(view.windup, 0, 1);
    else if (pitch && view.pitchT != null) ph = 1 + clamp(view.pitchT / 0.5, 0, 1);
    drawPitcher(pitcher, ph, time, pitch);
    drawZone(view);
    var ci = contactInfo(view), T = pitch ? (pitch.T || 0.8) : 0;
    var flying = pitch && view.pitchT != null && view.windup == null && !ci;
    var arrived = flying && view.pitchT >= T;
    drawBatter(view);
    drawCatcherBody(view);
    drawMitt(view, false);
    if (!arrived) drawMitt(view, true);
    if (flying && !arrived && view.assist) drawAssist(view);
    if (flying && !arrived) drawPitchBall(view);
    if (arrived) { drawPitchBall(view); drawMitt(view, true); }
    if (arrived && view.pitchT - T < 0.25) {
      var m = mittTarget(view), pe = (view.pitchT - T) / 0.25;
      fill(R.star(m.x, m.y - 6, 26 + 16 * pe, 12, 10, 0.2, 0.2, U.rng(2)), { c: 1 - pe }, { over: true });
    }
    if (ci) drawContact(view, ci);
    drawHud(view);
    drawStamp(view.stamp, 'bat');
    if (view.hitstop) P.flood('c', 0.3);
    P.reset();
  }
  function flags(time, g) {
    var W = S.W, p = new Path2D(), pl = new Path2D();
    [0.24, 0.5, 0.76].forEach(function (fx, i) {
      var x = W * fx + (i === 1 ? W * 0.18 : 0), y = g.standsTop - 4;
      pl.moveTo(x, y); pl.lineTo(x, y - 20);
      var w = Math.sin(time * 4 + i) * 2.5;
      p.moveTo(x, y - 20); p.quadraticCurveTo(x + 6, y - 22 + w, x + 13, y - 17 + w * 0.5); p.quadraticCurveTo(x + 6, y - 14 + w, x, y - 13); p.closePath();
    });
    stroke(pl, A1, 1.1);
    fill(p, { b: 1 });
  }
  function frameField(view, park, inks, time) {
    var e = ensureField(park, inks);
    S.fbake = e.snap; S.fcam = e.cam;
    var fv = fieldView(view);
    view._fz = fv.z;
    P.reset();
    loadFieldBake(fv);
    if (view.onFire) P.flood('b', 0.16);
    P.reset(); P.save(); applyFieldView(fv);
    drawFieldDynamic(view, park, time);
    P.restore();
    if (view.onFire) drawFire(time, S.H * 0.82, S.H + 4);
    drawHud(view);
    drawStamp(view.stamp, 'field');
    P.reset();
  }

  // adaptive resolution: if the real frame interval stays well above 60 fps during play, print at a lower
  // internal resolution (2 -> 1.6 -> 1.3 device px per css px). Never goes back up within a session.
  function adapt(t, scene) {
    var iv = S.lastCall ? t - S.lastCall : 0;
    S.lastCall = t;
    if (S.noAdapt || scene === 'title' || iv <= 0 || iv > 120) return;
    S.iv = S.iv || []; S.iv.push(iv);
    if (S.iv.length < 120) return;
    var a = S.iv.slice().sort(function (x, y) { return x - y; }), med = a[a.length >> 1];
    S.iv = [];
    if (med > 21 && S.qual > 0.66) { S.qual = S.qual > 0.9 ? 0.8 : 0.65; applyRes(); }
  }
  function applyRes() {
    var d = Math.max(1, S.dprReq * S.qual);
    S.dpr = d;
    if (S.canvas) { S.canvas.width = Math.round(S.W * d); S.canvas.height = Math.round(S.H * d); }
    if (S.P) S.P.resize(S.W, S.H, d);
    S.cache = {};
  }

  // ------------------------------------------------------------------ API
  function init(canvas) {
    S.canvas = canvas;
    S.ctx = canvas.getContext('2d');
    S.P = R.press({ w: S.W, h: S.H, dpr: S.dpr, margin: M, cell: 4.2 });
    var w = canvas.clientWidth || window.innerWidth || 390, h = canvas.clientHeight || window.innerHeight || 844;
    resize(w, h, Math.min(window.devicePixelRatio || 1, K.MAX_DPR));
  }
  function resize(w, h, dpr) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    dpr = Math.min(dpr || 1, K.MAX_DPR || 2);
    if (w === S.W && h === S.H && dpr === S.dprReq && S.canvas && S.canvas.width === Math.round(w * S.dpr)) return;
    S.W = w; S.H = h; S.dprReq = dpr; S.qual = S.qual || 1;
    applyRes();
    layoutBat();
  }
  function setInks(set) {
    if (set == null || set === 'park') { S.inkPick = null; return; }
    var r = R.inks(set);
    if (S.inkPick && S.inkPick.id === r.id && S.inkPick.a === r.a && S.inkPick.b === r.b) return;
    S.inkPick = r;
  }
  // build the static caches ahead of time (e.g. during the pre-game screen) so the first pitch / first hit never hitches
  function prepare(park, inkset) {
    park = park && park.fence ? park : DEFAULT_PARK;
    var inks = inkset ? R.inks(inkset) : S.inkPick || R.inks(park.inkset);
    ensureBat(park, inks); ensureField(park, inks);
  }

  layoutBat();
  BB.Render = {
    init: init, resize: resize, setInks: setInks, frame: frame,
    title: function (v) { v = v || {}; var o = {}; for (var k in v) o[k] = v[k]; o.scene = 'title'; return frame(o); },
    screenToPlate: screenToPlate, plateToScreen: plateToScreen,
    prepare: prepare,
    stats: function () {
      var a = S.perf.slice().sort(function (x, y) { return x - y; });
      return { frames: a.length, median: a[a.length >> 1] || 0, p95: a[Math.floor(a.length * 0.95)] || 0, lastBuildMs: S.built, caches: Object.keys(S.cache) };
    },
    _S: S,
    _dbg: { batGeom: function (pk) { return batGeom(pk); }, drawPitcher: function(){return drawPitcher.apply(null, arguments);}, drawBatter: drawBatter, drawCatcherBody: drawCatcherBody, drawMitt: drawMitt, drawHud: drawHud, drawZone: drawZone, drawPitchBall: drawPitchBall, drawAssist: drawAssist, flags: flags, setP: function(){ P = S.P; } },
  };
})();
