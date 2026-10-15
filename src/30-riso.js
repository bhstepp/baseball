// 30-riso.js — BB.Riso: the risograph print engine. Owned by the render agent.
//
// A Press holds one offscreen canvas per ink drum (slot a / b / c). Everything is drawn straight into those layers
// in the drum's ink colour, as flat shapes or halftone dot screens (no gradients). Each drawing call is a proper
// colour separation: an opaque shape first knocks itself out of all three layers (so it hides what is behind it in
// every ink) and then lays down its own tone in the slots it uses. composite() prints the layers onto cream paper
// with 'multiply' (overprints make the in-between colours) and a per-layer offset (misregistration), then a grain /
// ink-void pass on top.
//
//   var P = BB.Riso.press({ w: 390, h: 844, dpr: 2, margin: 20, inks: BB.INKSETS[0] });
//   P.reset(); P.clear();
//   P.fill(P.circle(100, 100, 40), { a: 1, b: 0.3 });      // solid A + 30 % halftone B; knocks out C
//   P.fill(path, { c: 0.5 }, { over: true });              // add a C tone on top without knocking anything out
//   P.composite(displayCtx, { a: {x: 0, y: 0}, b: {x: 1.5, y: -1}, c: {x: -1, y: 1} });
(function () {
  var U = BB.U;
  var SLOTS = ['a', 'b', 'c'];
  var ANGLE = { a: 45, b: 75, c: 15 };       // screen angles per drum (classic rosette-ish, avoids moire)
  var LEVELS = 24;                            // tone quantisation
  var HAS_DOMMATRIX = typeof DOMMatrix !== 'undefined';

  function mk(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0);
    return c;
  }
  function hexRgb(h) {
    h = String(h || '#000').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function inksOf(set) {
    if (typeof set === 'string') {
      for (var i = 0; i < BB.INKSETS.length; i++) if (BB.INKSETS[i].id === set) { set = BB.INKSETS[i]; break; }
    }
    if (!set || typeof set !== 'object' || !set.a) set = BB.INKSETS[0];
    return { id: set.id || 'custom', a: set.a, b: set.b, c: set.c, paper: set.paper || BB.INKS.paper, name: set.name };
  }

  // ------------------------------------------------------------------ fonts
  // Bungee has a single weight; when it is not loaded we fall back to a heavy system face at weight 900.
  var fontState = { bungee: false, mono: false, at: -1e9 };
  function probe(family, fallback) {
    try {
      var c = probe.c || (probe.c = mk(8, 8).getContext('2d'));
      var s = 'HALFTONE 0123 Wqm';
      c.font = '40px ' + fallback; var a = c.measureText(s).width;
      c.font = '40px "' + family + '", ' + fallback; var b = c.measureText(s).width;
      return Math.abs(a - b) > 0.5;
    } catch (e) { return false; }
  }
  function checkFonts() {
    if (fontState.bungee && fontState.mono) return;
    var now = Date.now();
    if (now - fontState.at < 400) return;
    fontState.at = now;
    if (!fontState.bungee) fontState.bungee = probe('Bungee', 'monospace') || probe('Bungee', 'serif');
    if (!fontState.mono) fontState.mono = probe('Space Mono', 'serif');
  }
  function display(px) {
    checkFonts();
    px = Math.max(1, Math.round(px * 10) / 10);
    return fontState.bungee ? px + 'px "Bungee", sans-serif' : '900 ' + px + 'px "Arial Black", "Helvetica Neue", Impact, sans-serif';
  }
  function mono(px, bold) {
    checkFonts();
    px = Math.max(1, Math.round(px * 10) / 10);
    return (bold ? '700 ' : '400 ') + px + 'px ' + BB.FONTS.body;
  }

  // ------------------------------------------------------------------ halftone tiles (shared across presses)
  var tileCache = {};
  var patCtx = null;
  function q(level) { return Math.max(0, Math.min(LEVELS, Math.round(level * LEVELS))); }
  function dotPattern(ink, cellPx, li) {
    var key = ink + '|' + cellPx + '|' + li;
    var p = tileCache[key];
    if (p) return p;
    var c = mk(cellPx, cellPx), x = c.getContext('2d'), L = li / LEVELS, h = cellPx / 2;
    x.fillStyle = ink;
    if (L <= 0.5) {
      var r = cellPx * Math.sqrt(L / Math.PI);
      x.beginPath(); x.arc(h, h, Math.max(0.35, r), 0, 6.2832); x.fill();
    } else {
      x.fillRect(0, 0, cellPx, cellPx);
      var rh = cellPx * Math.sqrt((1 - L) / Math.PI);
      x.globalCompositeOperation = 'destination-out';
      // hole centred on the cell corners (four quarters) so dark tones read as "ink with paper holes"
      x.beginPath(); x.arc(0, 0, rh, 0, 6.2832); x.arc(cellPx, 0, rh, 0, 6.2832);
      x.moveTo(0, cellPx); x.arc(0, cellPx, rh, 0, 6.2832); x.moveTo(cellPx, cellPx); x.arc(cellPx, cellPx, rh, 0, 6.2832);
      x.fill();
    }
    patCtx = patCtx || mk(2, 2).getContext('2d');
    p = patCtx.createPattern(c, 'repeat');
    tileCache[key] = p;
    return p;
  }
  // straight-line screen (for hatching / speed lines)
  function linePattern(ink, cellPx, li) {
    var key = 'L' + ink + '|' + cellPx + '|' + li;
    var p = tileCache[key];
    if (p) return p;
    var c = mk(cellPx, cellPx), x = c.getContext('2d');
    x.fillStyle = ink;
    x.fillRect(0, 0, cellPx, Math.max(1, cellPx * li / LEVELS));
    patCtx = patCtx || mk(2, 2).getContext('2d');
    p = patCtx.createPattern(c, 'repeat');
    tileCache[key] = p;
    return p;
  }

  // ------------------------------------------------------------------ paper + grain (shared, per size/paper)
  var paperCache = {}, grainCache = {}, starveCache = {};
  function paperCanvas(w, h, paper) {
    var key = w + 'x' + h + paper;
    if (paperCache[key]) return paperCache[key];
    for (var k in paperCache) delete paperCache[k];          // keep only one
    var c = mk(w, h), x = c.getContext('2d');
    x.fillStyle = paper; x.fillRect(0, 0, w, h);
    // low-frequency mottling: a tiny noise canvas scaled up
    var nw = 24, nh = Math.max(8, Math.round(24 * h / w)), n = mk(nw, nh), nx = n.getContext('2d');
    var r = U.rng(7), id = nx.createImageData(nw, nh), rgb = hexRgb(paper);
    for (var i = 0; i < nw * nh; i++) {
      var v = r() - 0.5;
      id.data[i * 4] = rgb[0] + v * 18; id.data[i * 4 + 1] = rgb[1] + v * 16; id.data[i * 4 + 2] = rgb[2] + v * 22;
      id.data[i * 4 + 3] = 90;
    }
    nx.putImageData(id, 0, 0);
    x.imageSmoothingEnabled = true;
    x.globalAlpha = 0.55; x.drawImage(n, 0, 0, w, h); x.globalAlpha = 1;
    paperCache[key] = c;
    return c;
  }
  // grain tile: paper-coloured ink voids + dark fibres + grit. drawn source-over on top of the composite.
  function grainPattern(ctx, paper, dpr) {
    var key = paper + '|' + dpr;
    if (grainCache[key]) return grainCache[key];
    var S = 384, c = mk(S, S), x = c.getContext('2d'), r = U.rng(1234), rgb = hexRgb(paper);
    var pc = 'rgb(' + rgb.join(',') + ')';
    var i, px, py;
    // ink voids: speckles of bare paper (starved ink / dust on the drum)
    x.fillStyle = pc;
    for (i = 0; i < 900; i++) {
      px = r() * S; py = r() * S;
      x.globalAlpha = 0.25 + r() * 0.6;
      x.beginPath(); x.arc(px, py, (0.35 + r() * r() * 1.3) * dpr, 0, 6.2832); x.fill();
    }
    // a few streaky voids (drum starvation runs along the feed direction)
    for (i = 0; i < 26; i++) {
      px = r() * S; py = r() * S;
      x.globalAlpha = 0.12 + r() * 0.2;
      x.fillRect(px, py, (0.5 + r()) * dpr, (6 + r() * 26) * dpr);
    }
    // dark grit and fibres
    x.fillStyle = 'rgb(70,52,36)';
    for (i = 0; i < 260; i++) {
      px = r() * S; py = r() * S;
      x.globalAlpha = 0.05 + r() * 0.16;
      x.beginPath(); x.arc(px, py, (0.3 + r() * 0.7) * dpr, 0, 6.2832); x.fill();
    }
    x.strokeStyle = 'rgb(120,96,70)'; x.lineWidth = 0.6 * dpr;
    for (i = 0; i < 24; i++) {
      px = r() * S; py = r() * S;
      x.globalAlpha = 0.06 + r() * 0.08;
      x.beginPath(); x.moveTo(px, py);
      x.quadraticCurveTo(px + (r() - 0.5) * 30, py + (r() - 0.5) * 30, px + (r() - 0.5) * 40, py + (r() - 0.5) * 40);
      x.stroke();
    }
    x.globalAlpha = 1;
    var p = ctx.createPattern(c, 'repeat');
    grainCache[key] = p;
    return p;
  }
  // starvation tile for static layers: blotchy low-density erosion (applied with destination-out)
  function starvePattern(ctx, dpr) {
    var key = 's' + dpr;
    if (starveCache[key]) return starveCache[key];
    var S = 256, c = mk(S, S), x = c.getContext('2d'), r = U.rng(99);
    x.fillStyle = '#000';
    for (var i = 0; i < 1400; i++) {
      x.globalAlpha = 0.15 + r() * 0.5;
      x.beginPath(); x.arc(r() * S, r() * S, (0.3 + r() * 0.9) * dpr, 0, 6.2832); x.fill();
    }
    for (i = 0; i < 18; i++) {           // soft blotches (uneven ink coverage)
      x.globalAlpha = 0.05 + r() * 0.07;
      x.beginPath(); x.ellipse(r() * S, r() * S, (8 + r() * 30) * dpr, (3 + r() * 12) * dpr, r() * 3, 0, 6.2832); x.fill();
    }
    x.globalAlpha = 1;
    var p = ctx.createPattern(c, 'repeat');
    starveCache[key] = p;
    return p;
  }

  // ------------------------------------------------------------------ Press
  function Press(o) {
    o = o || {};
    this.margin = o.margin || 0;
    this.cell = o.cell || 4.2;               // default halftone cell, css px
    this.c = {}; this.x = {};
    for (var i = 0; i < 3; i++) {
      var s = SLOTS[i];
      this.c[s] = mk(1, 1);
      this.x[s] = this.c[s].getContext('2d');
    }
    this.w = 0; this.h = 0; this.dpr = 1;
    this.setInks(o.inks || BB.INKSETS[0]);
    this.resize(o.w || 100, o.h || 100, o.dpr || 1);
  }
  var PP = Press.prototype;

  PP.setInks = function (set) {
    this.inks = inksOf(set);
    this.ink = { a: this.inks.a, b: this.inks.b, c: this.inks.c };
  };
  PP.resize = function (w, h, dpr) {
    dpr = dpr || 1;
    this.w = w; this.h = h; this.dpr = dpr;
    var pw = Math.ceil((w + 2 * this.margin) * dpr), ph = Math.ceil((h + 2 * this.margin) * dpr);
    for (var i = 0; i < 3; i++) {
      var c = this.c[SLOTS[i]];
      if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
    }
    this.pw = pw; this.ph = ph;
    this.reset();
  };
  // user space = css px of the visible area (origin top-left of the screen, margin outside it)
  PP.reset = function () {
    var d = this.dpr, m = this.margin * d;
    for (var i = 0; i < 3; i++) {
      var x = this.x[SLOTS[i]];
      x.setTransform(d, 0, 0, d, m, m);
      x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
      x.setLineDash([]);
    }
  };
  PP.clear = function () {
    for (var i = 0; i < 3; i++) {
      var x = this.x[SLOTS[i]];
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, this.pw, this.ph); x.restore();
    }
  };
  // ---- transform helpers (applied to all three layers)
  PP.save = function () { for (var i = 0; i < 3; i++) this.x[SLOTS[i]].save(); };
  PP.restore = function () { for (var i = 0; i < 3; i++) this.x[SLOTS[i]].restore(); };
  PP.translate = function (a, b) { for (var i = 0; i < 3; i++) this.x[SLOTS[i]].translate(a, b); };
  PP.rotate = function (a) { for (var i = 0; i < 3; i++) this.x[SLOTS[i]].rotate(a); };
  PP.scale = function (a, b) { for (var i = 0; i < 3; i++) this.x[SLOTS[i]].scale(a, b == null ? a : b); };
  PP.alpha = function (a) { for (var i = 0; i < 3; i++) this.x[SLOTS[i]].globalAlpha = a; };
  PP.clip = function (path, rule) { for (var i = 0; i < 3; i++) this.x[SLOTS[i]].clip(path, rule || 'nonzero'); };

  // ---- fill styles
  // tone for slot s at coverage v (0..1). Solid ink when v ~ 1. The dot screen is locked to device pixels and the
  // drum's screen angle whatever the current transform is (like a real screen on the drum).
  PP.tone = function (s, v, cell) {
    var li = q(v);
    if (li >= LEVELS) return this.ink[s];
    var cpx = Math.max(3, Math.round((cell || this.cell) * this.dpr));
    var p = dotPattern(this.ink[s], cpx, Math.max(1, li));
    this.lockPattern(p, s, ANGLE[s]);
    return p;
  };
  PP.lines = function (s, v, cell, angle) {
    var cpx = Math.max(3, Math.round((cell || this.cell) * this.dpr));
    var p = linePattern(this.ink[s], cpx, Math.max(1, q(v)));
    this.lockPattern(p, s, angle == null ? 30 : angle);
    return p;
  };
  PP.lockPattern = function (p, s, ang) {
    if (!HAS_DOMMATRIX || !p.setTransform) return;
    try {
      var m = this.x[s].getTransform().inverse();
      p.setTransform(m.rotate(ang));
    } catch (e) { /* older engines: unrotated screen */ }
  };
  function style(P, s, v, o) {
    if (typeof v === 'object') { // { v, cell, lines: angle }
      if (v.lines != null) return P.lines(s, v.v, v.cell, v.lines);
      return P.tone(s, v.v, v.cell);
    }
    return P.tone(s, v, o && o.cell);
  }
  function val(v) { return typeof v === 'object' && v ? v.v : v; }

  // ---- separations
  // inks: { a: v, b: v, c: v } with v in 0..1 (or {v, cell} / {v, lines: angle}). Opaque by default: knocks the
  // shape out of every layer first. opts.over = true: only adds ink (shadows, tints, line work over things).
  // opts.ko = ['a'] limits the knockout to those slots.
  PP.fill = function (path, inks, o) {
    var over = o && o.over, rule = (o && o.rule) || 'nonzero', ko = o && o.ko;
    for (var i = 0; i < 3; i++) {
      var s = SLOTS[i], x = this.x[s], v = inks ? inks[s] : 0;
      if (!over && (!ko || ko.indexOf(s) >= 0)) {
        x.globalCompositeOperation = 'destination-out';
        x.fillStyle = '#000'; x.fill(path, rule);
        x.globalCompositeOperation = 'source-over';
      }
      if (val(v) > 0.02) { x.fillStyle = style(this, s, v, o); x.fill(path, rule); }
    }
  };
  PP.knock = function (path, rule) {
    for (var i = 0; i < 3; i++) {
      var x = this.x[SLOTS[i]];
      x.globalCompositeOperation = 'destination-out';
      x.fillStyle = '#000'; x.fill(path, rule || 'nonzero');
      x.globalCompositeOperation = 'source-over';
    }
  };
  // stroke a path. o: { over, dash: [..], cap, join, ko }
  PP.stroke = function (path, inks, width, o) {
    o = o || {};
    for (var i = 0; i < 3; i++) {
      var s = SLOTS[i], x = this.x[s], v = inks ? inks[s] : 0;
      var doKo = !o.over && (!o.ko || o.ko.indexOf(s) >= 0);
      if (!doKo && !(val(v) > 0.02)) continue;
      x.lineWidth = width; x.lineCap = o.cap || 'round'; x.lineJoin = o.join || 'round';
      if (o.dash) x.setLineDash(o.dash);
      if (doKo) {
        x.globalCompositeOperation = 'destination-out';
        x.strokeStyle = '#000'; x.stroke(path);
        x.globalCompositeOperation = 'source-over';
      }
      if (val(v) > 0.02) { x.strokeStyle = style(this, s, v, o); x.stroke(path); }
      if (o.dash) x.setLineDash([]);
    }
  };
  // text. o: { align, baseline, over, outline: px (adds a knocked-out keyline around the text), ko }
  PP.text = function (str, px, py, font, inks, o) {
    o = o || {};
    for (var i = 0; i < 3; i++) {
      var s = SLOTS[i], x = this.x[s], v = inks ? inks[s] : 0;
      x.font = font; x.textAlign = o.align || 'left'; x.textBaseline = o.baseline || 'alphabetic';
      if (!o.over && (!o.ko || o.ko.indexOf(s) >= 0)) {
        x.globalCompositeOperation = 'destination-out';
        x.fillStyle = '#000'; x.fillText(str, px, py);
        if (o.outline) { x.lineWidth = o.outline * 2; x.lineJoin = 'round'; x.strokeStyle = '#000'; x.strokeText(str, px, py); }
        x.globalCompositeOperation = 'source-over';
      }
      if (val(v) > 0.02) { x.fillStyle = style(this, s, v, o); x.fillText(str, px, py); }
    }
  };
  PP.measure = function (str, font) { var x = this.x.a; x.font = font; return x.measureText(str).width; };

  // ---- full-layer tone flood from a cached sheet (a blit instead of a big pattern fill every frame)
  PP.flood = function (s, v) {
    this.sheets = this.sheets || {};
    var key = s + '|' + this.ink[s] + '|' + q(v) + '|' + this.pw + 'x' + this.ph;
    var sh = this.sheets[key];
    if (!sh) {
      sh = mk(this.pw, this.ph);
      var x = sh.getContext('2d');
      var cpx = Math.max(3, Math.round(this.cell * this.dpr));
      var p = dotPattern(this.ink[s], cpx, Math.max(1, q(v)));
      if (HAS_DOMMATRIX && p.setTransform) { try { p.setTransform(new DOMMatrix().rotate(ANGLE[s])); } catch (e) {} }
      x.fillStyle = p; x.fillRect(0, 0, this.pw, this.ph);
      this.sheets[key] = sh;
    }
    var l = this.x[s];
    l.save(); l.setTransform(1, 0, 0, 1, 0, 0); l.drawImage(sh, 0, 0); l.restore();
  };

  // ---- raw layer access (for special effects)
  PP.layer = function (s) { return this.x[s]; };

  // ---- snapshots (static background caches)
  PP.snapshot = function (into) {
    into = into || {};
    for (var i = 0; i < 3; i++) {
      var s = SLOTS[i], src = this.c[s], d = into[s];
      if (!d || d.width !== src.width || d.height !== src.height) d = into[s] = mk(src.width, src.height);
      var dx = d.getContext('2d');
      dx.globalCompositeOperation = 'copy'; dx.drawImage(src, 0, 0); dx.globalCompositeOperation = 'source-over';
    }
    into.w = this.pw; into.h = this.ph;
    return into;
  };
  PP.load = function (snap) {
    for (var i = 0; i < 3; i++) {
      var s = SLOTS[i], x = this.x[s];
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0);
      x.globalCompositeOperation = 'copy'; x.drawImage(snap[s], 0, 0);
      x.restore();
    }
  };
  // copy a horizontal band (css y0..y1) from a snapshot over the current layers
  PP.loadBand = function (snap, y0, y1) {
    var d = this.dpr, m = this.margin;
    var py0 = Math.max(0, Math.floor((y0 + m) * d)), py1 = Math.min(this.ph, Math.ceil((y1 + m) * d));
    if (py1 <= py0) return;
    for (var i = 0; i < 3; i++) {
      var s = SLOTS[i], x = this.x[s];
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0);
      x.clearRect(0, py0, this.pw, py1 - py0);
      x.drawImage(snap[s], 0, py0, this.pw, py1 - py0, 0, py0, this.pw, py1 - py0);
      x.restore();
    }
  };
  // erode the current layers with the starvation texture (cheap: do it once on static caches)
  PP.starve = function (amount) {
    for (var i = 0; i < 3; i++) {
      var s = SLOTS[i], x = this.x[s];
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0);
      var p = starvePattern(x, this.dpr);
      if (p.setTransform && HAS_DOMMATRIX) { try { p.setTransform(new DOMMatrix().translate(i * 97, i * 53)); } catch (e) {} }
      x.globalCompositeOperation = 'destination-out'; x.globalAlpha = amount == null ? 0.6 : amount;
      x.fillStyle = p; x.fillRect(0, 0, this.pw, this.ph);
      x.restore();
    }
  };

  // ---- print: paper, multiply the drums with offsets, grain on top.
  // dst: a 2d context the size of the visible area in device px. offs: {a:{x,y}, b:..., c:...} in css px.
  // o: { paper: false (skip paper fill, e.g. card art over its own bg), grain: 0..1, x, y (dest offset px) }
  PP.composite = function (dst, offs, o) {
    o = o || {};
    var d = this.dpr, m = this.margin, W = Math.round(this.w * d), H = Math.round(this.h * d);
    var ox = o.x || 0, oy = o.y || 0;
    dst.save();
    dst.setTransform(1, 0, 0, 1, 0, 0);
    dst.globalAlpha = 1;
    if (o.paper !== false) {
      dst.globalCompositeOperation = 'source-over';
      if (ox || oy) { dst.fillStyle = this.inks.paper; dst.fillRect(ox, oy, W, H); }
      else dst.drawImage(paperCanvas(W, H, this.inks.paper), 0, 0);
    }
    if (ox || oy || o.clip) { dst.beginPath(); dst.rect(ox, oy, W, H); dst.clip(); }
    dst.globalCompositeOperation = 'multiply';
    var order = o.order || SLOTS;
    for (var i = 0; i < 3; i++) {
      var s = order[i], off = (offs && offs[s]) || { x: 0, y: 0 };
      var px = Math.round((off.x - m) * d) + ox, py = Math.round((off.y - m) * d) + oy;
      if (o.alpha && o.alpha[s] != null) dst.globalAlpha = o.alpha[s];
      dst.drawImage(this.c[s], px, py);
      dst.globalAlpha = 1;
    }
    dst.globalCompositeOperation = 'source-over';
    var g = o.grain == null ? 1 : o.grain;
    if (g > 0) {
      var gp = grainPattern(dst, this.inks.paper, d);
      if (gp.setTransform && HAS_DOMMATRIX && (ox || oy || o.grainShift)) {
        try { gp.setTransform(new DOMMatrix().translate(ox + (o.grainShift || 0), oy)); } catch (e) {}
      }
      dst.globalAlpha = g; dst.fillStyle = gp; dst.fillRect(ox, oy, W, H);
      if (gp.setTransform && HAS_DOMMATRIX && (ox || oy || o.grainShift)) { try { gp.setTransform(new DOMMatrix()); } catch (e) {} }
    }
    dst.restore();
  };

  // ------------------------------------------------------------------ path helpers (Path2D)
  function path() { return new Path2D(); }
  function circle(x, y, r) { var p = new Path2D(); p.arc(x, y, Math.max(0.01, r), 0, 6.283185); return p; }
  function ellipse(x, y, rx, ry, rot) { var p = new Path2D(); p.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot || 0, 0, 6.283185); return p; }
  function rect(x, y, w, h) { var p = new Path2D(); p.rect(x, y, w, h); return p; }
  function rrect(x, y, w, h, r) {
    var p = new Path2D(); r = Math.min(r, w / 2, h / 2);
    p.moveTo(x + r, y); p.lineTo(x + w - r, y); p.arcTo(x + w, y, x + w, y + r, r); p.lineTo(x + w, y + h - r);
    p.arcTo(x + w, y + h, x + w - r, y + h, r); p.lineTo(x + r, y + h); p.arcTo(x, y + h, x, y + h - r, r);
    p.lineTo(x, y + r); p.arcTo(x, y, x + r, y, r); p.closePath();
    return p;
  }
  function poly(pts, closed) { // pts: [x0,y0,x1,y1,...] or [{x,y}]
    var p = new Path2D(), i;
    if (pts.length && typeof pts[0] === 'object') {
      p.moveTo(pts[0].x, pts[0].y); for (i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
    } else {
      p.moveTo(pts[0], pts[1]); for (i = 2; i < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1]);
    }
    if (closed !== false) p.closePath();
    return p;
  }
  function star(x, y, r1, r2, n, rot, jag, rng) { // starburst; jag = random radius jitter 0..1
    var p = new Path2D(); rot = rot || 0;
    for (var i = 0; i < n * 2; i++) {
      var a = rot + i * Math.PI / n, r = i % 2 ? r2 : r1;
      if (jag && rng) r *= 1 - jag * rng();
      var px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (i) p.lineTo(px, py); else p.moveTo(px, py);
    }
    p.closePath();
    return p;
  }
  function rays(x, y, r, n, rot, width) { // sunburst wedges
    var p = new Path2D(); width = width || 0.5;
    for (var i = 0; i < n; i++) {
      var a = rot + i * 2 * Math.PI / n, da = Math.PI / n * width;
      p.moveTo(x, y); p.lineTo(x + Math.cos(a - da) * r, y + Math.sin(a - da) * r);
      p.lineTo(x + Math.cos(a + da) * r, y + Math.sin(a + da) * r); p.closePath();
    }
    return p;
  }
  function blob(x, y, r, n, rng, amt) { // wobbly closed shape (clouds, dust, crowd heads)
    var p = new Path2D(), pts = [];
    for (var i = 0; i < n; i++) {
      var a = i / n * 6.2832, rr = r * (1 - amt + amt * 2 * rng());
      pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
    }
    for (i = 0; i < n; i++) {
      var p0 = pts[i], p1 = pts[(i + 1) % n], mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
      if (i === 0) p.moveTo(mx, my); else p.quadraticCurveTo(p0[0], p0[1], mx, my);
    }
    var f = pts[0], s = pts[1];
    p.quadraticCurveTo(f[0], f[1], (f[0] + s[0]) / 2, (f[1] + s[1]) / 2);
    p.closePath();
    return p;
  }

  // misregistration: base offsets per drum + a slow drift. amp in css px.
  function offsets(time, amp, shake, seed) {
    amp = amp == null ? 1 : amp; shake = shake || 0;
    var r = seed != null ? U.rng(seed) : Math.random;
    var t = time || 0;
    var o = {
      a: { x: 0.0, y: 0.0 },
      b: { x: 1.4 * amp + Math.sin(t * 0.37 + 1) * 0.5 * amp, y: -0.9 * amp + Math.cos(t * 0.29) * 0.45 * amp },
      c: { x: -1.0 * amp + Math.cos(t * 0.31 + 2) * 0.5 * amp, y: 1.2 * amp + Math.sin(t * 0.41 + 0.5) * 0.45 * amp },
    };
    if (shake > 0) {
      var k = shake * 11;
      for (var i = 0; i < 3; i++) {
        var s = SLOTS[i];
        o[s].x += (r() * 2 - 1) * k; o[s].y += (r() * 2 - 1) * k;
      }
    }
    return o;
  }

  BB.Riso = {
    SLOTS: SLOTS, ANGLE: ANGLE,
    press: function (o) { return new Press(o); },
    Press: Press,
    inks: inksOf,
    font: display, display: display, mono: mono, fontsReady: function () { checkFonts(); return fontState.bungee; },
    path: path, circle: circle, ellipse: ellipse, rect: rect, rrect: rrect, poly: poly, star: star, rays: rays, blob: blob,
    offsets: offsets,
    canvas: mk,
    rgb: hexRgb,
    // tone(level) pattern helper for any 2d context (e.g. UI canvases): returns a CanvasPattern in `ink`
    tone: function (ctx, ink, level, cellPx, angle) {
      var p = dotPattern(ink, Math.max(3, Math.round(cellPx || 8)), Math.max(1, q(level)));
      if (HAS_DOMMATRIX && p.setTransform) { try { p.setTransform(ctx.getTransform().inverse().rotate(angle == null ? 45 : angle)); } catch (e) {} }
      return p;
    },
  };
})();
