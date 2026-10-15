// 38-cards.js — BB.CardArt: classic-cartoon bubble-gum trading cards, animal pitcher portraits, bats, uniform
// swatches, park postcards and Rocco the raccoon (title mascot + how-to illustrations). Plain Canvas 2D: bold ink
// outlines, two-tone cel shading, warm palette. Nothing here depends on the 3D renderer.
//
//   BB.CardArt.draw(canvas, card, { time, misprint })   // any size, 5:7 recommended; foil animates with opts.time
//   BB.CardArt.drawPitcher(canvas, pitcher, { inkset })
//   BB.CardArt.drawBat(canvas, bat) / drawInkset(canvas, inkset) / drawPark(canvas, park)
//   BB.CardArt.drawRocco(canvas, { pose: 'idle'|'tap'|'hold'|'take'|'cheer', props: bool, inkset })
//   BB.CardArt.SPECIES_BY_PITCHER = { p_ox: 'ox', ... }   // shared with the 3D renderer
//   BB.CardArt.speciesFor(pitcher) -> species id;  BB.CardArt.SPECIES = { id: { fam, name, ... } }
//   BB.CardArt.scheme(inkset) -> { a, b, c, paper, ink }   // the inkset tamed to the cartoon palette (UI uses it too)
//
// Static drawings are cached per (thing, size, variant, fonts-loaded), so an album grid redraw is a blit.
(function () {
  var U = BB.U, PI = Math.PI, TAU = PI * 2;
  var INK = '#1B1420', CREAM = '#FFF4DC', WHITE = '#FFFDF6', SHADOW = '#3A2244';
  var PAL = { teal: '#7FD1D9', sunset: '#FFB36B', mustard: '#F2B632', brick: '#D9483B', pink: '#F29E8E',
    grass: '#6DBB4A', grassD: '#3E8E3A', dirt: '#D9955B', navy: '#2B2F5E', gum: '#F59AB8', mitt: '#B8692E' };
  var LW = 2.2;

  // ------------------------------------------------------------------ colour
  function rgb(h) {
    h = String(h || '#000').replace('#', '');
    if (h.length === 3) h = h.replace(/./g, '$&$&');
    var n = parseInt(h.slice(0, 6), 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function ci(v) { v = Math.round(v); return v < 0 ? 0 : v > 255 ? 255 : v; }
  function hex(r, g, b) { return '#' + ((1 << 24) + (ci(r) << 16) + (ci(g) << 8) + ci(b)).toString(16).slice(1).toUpperCase(); }
  function mix(a, b, t) { var A = rgb(a), B = rgb(b); return hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); }
  function dark(c, k) { return mix(c, SHADOW, k == null ? 0.3 : k); }
  function light(c, k) { return mix(c, '#FFF8E8', k == null ? 0.4 : k); }
  function lum(c) { var A = rgb(c); return (0.299 * A[0] + 0.587 * A[1] + 0.114 * A[2]) / 255; }
  function alpha(c, a) { var A = rgb(c); return 'rgba(' + A[0] + ',' + A[1] + ',' + A[2] + ',' + a + ')'; }

  // The ink sets in 00-const were mixed for a risograph press (fluorescent drums). Map the known drums onto the
  // warm cartoon palette; any other colour passes through unchanged (so a re-tuned BB.INKS just works).
  var TAME = {
    '#0078BF': '#2F6DB5', '#FF48B0': '#E0567F', '#FFE800': '#F2B632', '#00838A': '#24918F', '#FF6C2F': '#EE7A35',
    '#00A95C': '#3E9A4A', '#765BA7': '#74509F', '#F15060': '#D9483B', '#3D5588': '#33427A', '#1A1A1A': '#2A2232',
  };
  function tame(c) { var k = String(c || '').toUpperCase(); return TAME[k] || c || INK; }
  function inkObj(s) {
    if (s && typeof s === 'object') return s;
    for (var i = 0; i < BB.INKSETS.length; i++) if (BB.INKSETS[i].id === s) return BB.INKSETS[i];
    return BB.INKSETS[0];
  }
  var schemes = {};
  function scheme(s) {
    s = inkObj(s);
    var key = s.id + '|' + s.a + s.b + s.c;
    if (!schemes[key]) schemes[key] = { id: s.id, name: s.name, a: tame(s.a), b: tame(s.b), c: tame(s.c), paper: CREAM, ink: INK };
    return schemes[key];
  }

  // ------------------------------------------------------------------ paths & drawing helpers
  function ell(cx, cy, rx, ry, rot) { var p = new Path2D(); p.ellipse(cx, cy, Math.abs(rx), Math.abs(ry), rot || 0, 0, TAU); return p; }
  function circ(cx, cy, r) { return ell(cx, cy, r, r); }
  function rr(x0, y0, w, h, r) {
    var p = new Path2D(); r = Math.min(r, w / 2, h / 2);
    p.moveTo(x0 + r, y0); p.lineTo(x0 + w - r, y0); p.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
    p.lineTo(x0 + w, y0 + h - r); p.quadraticCurveTo(x0 + w, y0 + h, x0 + w - r, y0 + h);
    p.lineTo(x0 + r, y0 + h); p.quadraticCurveTo(x0, y0 + h, x0, y0 + h - r);
    p.lineTo(x0, y0 + r); p.quadraticCurveTo(x0, y0, x0 + r, y0); p.closePath();
    return p;
  }
  function poly(pts) { var p = new Path2D(); for (var i = 0; i < pts.length; i += 2) { if (i) p.lineTo(pts[i], pts[i + 1]); else p.moveTo(pts[i], pts[i + 1]); } p.closePath(); return p; }
  function path(d) { return new Path2D(d); }
  function starPath(cx, cy, ro, ri, n, rot) {
    var p = new Path2D();
    for (var i = 0; i < n * 2; i++) { var a = (rot || -PI / 2) + i * PI / n, r = i % 2 ? ri : ro; if (i) p.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); else p.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    p.closePath(); return p;
  }
  function blobPath(cx, cy, r, rng, n, j) {
    var p = new Path2D(), pts = [];
    n = n || 9;
    for (var i = 0; i < n; i++) { var a = i / n * TAU, rr2 = r * (1 - (j || 0.3) / 2 + rng() * (j || 0.3)); pts.push([cx + Math.cos(a) * rr2, cy + Math.sin(a) * rr2]); }
    for (i = 0; i < n; i++) {
      var p0 = pts[i], p1 = pts[(i + 1) % n], mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2;
      if (!i) p.moveTo(mx, my); else p.quadraticCurveTo(p0[0], p0[1], mx, my);
    }
    var f = pts[0], s = pts[1 % n]; p.quadraticCurveTo(f[0], f[1], (f[0] + s[0]) / 2, (f[1] + s[1]) / 2);
    p.closePath(); return p;
  }
  // fill + cel shade crescent (light from upper-left) + ink outline
  function cel(x, p, col, o) {
    o = o || {};
    if (o.shade === false) { x.fillStyle = col; x.fill(p); }
    else {
      x.fillStyle = o.dark || dark(col, 0.28); x.fill(p);
      x.save(); x.clip(p); x.translate(-(o.sh == null ? 2.4 : o.sh), -(o.sh == null ? 2.4 : o.sh) * (o.shy == null ? 1 : o.shy));
      x.fillStyle = col; x.fill(p); x.restore();
    }
    if (o.lw !== 0) { x.lineWidth = o.lw || LW; x.strokeStyle = INK; x.lineJoin = 'round'; x.lineCap = 'round'; x.stroke(p); }
  }
  function flat(x, p, col, lw) { x.fillStyle = col; x.fill(p); if (lw) { x.lineWidth = lw; x.strokeStyle = INK; x.lineJoin = 'round'; x.stroke(p); } }
  function line(x, d, col, w, cap) { x.strokeStyle = col || INK; x.lineWidth = w || LW; x.lineCap = cap || 'round'; x.lineJoin = 'round'; x.stroke(typeof d === 'string' ? path(d) : d); }
  function sunburst(x, cx, cy, R, n, c1, c2, rot) {
    x.fillStyle = c2; x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.fill();
    x.fillStyle = c1; x.beginPath();
    for (var i = 0; i < n; i++) { var a0 = (rot || 0) + i * TAU / n, a1 = a0 + TAU / n / 2; x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R); x.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R); x.closePath(); }
    x.fill();
  }
  function fD(px) { return Math.max(1, px).toFixed(2) + 'px ' + BB.FONTS.display; }
  function fB(px, wt) { return (wt || 600) + ' ' + Math.max(1, px).toFixed(2) + 'px ' + BB.FONTS.body; }
  function fit(x, s, maxW, px, f) { x.font = f(px); var w = x.measureText(s).width; if (w > maxW) { px *= maxW / w; x.font = f(px); } return px; }
  function inkText(x, s, cx, cy, px, fill, o) {
    o = o || {};
    x.save();
    x.font = (o.font || fD)(px); x.textAlign = o.align || 'center'; x.textBaseline = 'alphabetic';
    x.lineJoin = 'round'; x.miterLimit = 2;
    if (o.shadow) { x.fillStyle = INK; x.strokeStyle = INK; x.lineWidth = o.lw || px * 0.22; x.strokeText(s, cx + o.shadow, cy + o.shadow); x.fillText(s, cx + o.shadow, cy + o.shadow); }
    if (o.lw !== 0) { x.strokeStyle = INK; x.lineWidth = o.lw || px * 0.22; x.strokeText(s, cx, cy); }
    x.fillStyle = fill; x.fillText(s, cx, cy);
    x.restore();
  }
  function fontsReady() {
    try { return !document.fonts || (document.fonts.check('10px "Luckiest Guy"') && document.fonts.check('600 10px "Fredoka"')) ? 1 : 0; } catch (e) { return 1; }
  }
  function mk(w, h) { var c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; }

  // ------------------------------------------------------------------ cache
  var cache = {}, cacheKeys = [];
  function remember(key, canvas) {
    var c = mk(canvas.width, canvas.height); c.getContext('2d').drawImage(canvas, 0, 0);
    if (!cache[key]) cacheKeys.push(key);
    cache[key] = c;
    while (cacheKeys.length > 140) delete cache[cacheKeys.shift()];
  }
  function blit(canvas, key) {
    var c = cache[key]; if (!c) return false;
    var x = canvas.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, canvas.width, canvas.height); x.drawImage(c, 0, 0);
    return true;
  }
  function begin(canvas) { var x = canvas.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, canvas.width, canvas.height); x.lineJoin = 'round'; x.lineCap = 'round'; return x; }

  // ================================================================== SPECIES
  // fam: m mammal / b bird / r reptile. pal: [[main, second (muzzle / face / neck), accent (ears / beak / nose)]]
  function S(o) { return o; }
  var SPECIES = {
    raccoon: S({ fam: 'm', name: 'Raccoon', ear: 'point', earH: 8, earIn: 1, snout: 'muzzle', nose: 'ink', mark: 'mask', whisk: 1, w: 1.06, pal: [['#8F8B9E', '#F4EEE2', '#4A4256']] }),
    ox: S({ fam: 'm', name: 'Ox', ear: 'cow', horn: 'ox', snout: 'wide', nose: 'nostrils', tuft: 'hair', w: 1.18, pal: [['#8A5A3C', '#E9B99A', '#5A3826'], ['#B8763E', '#F0CDA6', '#7A4A22'], ['#5E4A44', '#D9A99A', '#3A2C28']] }),
    bison: S({ fam: 'm', name: 'Bison', ear: 'cow', horn: 'ox', snout: 'wide', nose: 'nostrils', tuft: 'mane', beard: 1, w: 1.2, pal: [['#6A4632', '#A87A5A', '#3A2618']] }),
    goat: S({ fam: 'm', name: 'Goat', ear: 'cow', horn: 'goat', snout: 'muzzle', nose: 'nostrils', beard: 1, w: 0.92, h: 1.06, pal: [['#F2EAD8', '#FFF8EC', '#C9A88A'], ['#A9927A', '#E8DCCB', '#6E5A48'], ['#6A5E58', '#BFB2A6', '#3E3632']] }),
    bighorn: S({ fam: 'm', name: 'Bighorn', ear: 'cow', horn: 'curl', snout: 'muzzle', nose: 'nostrils', w: 0.95, pal: [['#B8946A', '#F2E2C8', '#7A5A3A']] }),
    sheep: S({ fam: 'm', name: 'Sheep', ear: 'cow', snout: 'muzzle', nose: 'nostrils', tuft: 'wool', pal: [['#4A3E48', '#F7F1E6', '#E8A9A0'], ['#F2E6D4', '#FFFDF6', '#E8A9A0']] }),
    cow: S({ fam: 'm', name: 'Cow', ear: 'cow', horn: 'nub', snout: 'wide', nose: 'nostrils', mark: 'spots', w: 1.1, pal: [['#F6F1E8', '#F2B4B0', '#2E2730'], ['#B8763E', '#F2C4AE', '#F6F1E8']] }),
    horse: S({ fam: 'm', name: 'Horse', ear: 'point', snout: 'wide', nose: 'nostrils', mark: 'blaze', tuft: 'mane', w: 0.92, h: 1.1, pal: [['#9A5B34', '#D9A07A', '#3A2620'], ['#5C3E30', '#B08870', '#22181A'], ['#E2D2B8', '#F2E6D2', '#8A6A4E']] }),
    dog: S({ fam: 'm', name: 'Hound', ear: 'flop', snout: 'long', nose: 'big', mark: 'patch', pal: [['#C98E52', '#F5E3C8', '#7A4E2A'], ['#F2EADC', '#FFFFFF', '#8A5A36'], ['#6E5A4A', '#D9C6AE', '#2E2420']] }),
    bulldog: S({ fam: 'm', name: 'Bulldog', ear: 'rose', snout: 'wide', nose: 'big', tooth: 'under', w: 1.22, h: 0.94, pal: [['#C9A27A', '#F2E3CC', '#6A4A34'], ['#E8DCCB', '#FFFFFF', '#9A7A5E']] }),
    rat: S({ fam: 'm', name: 'Rat', ear: 'mouse', earIn: 1, snout: 'long', nose: 'pink', tooth: 'buck', whisk: 1, w: 0.95, pal: [['#8E8A92', '#C8C2C6', '#F29E9E'], ['#7A6A5E', '#B8A898', '#F29E9E']] }),
    mouse: S({ fam: 'm', name: 'Mouse', ear: 'mouse', earIn: 1, earBig: 1, snout: 'long', nose: 'pink', tooth: 'buck', whisk: 1, w: 0.9, pal: [['#B8946A', '#F2E2C8', '#F29E9E'], ['#A8A2AA', '#E8E2E6', '#F29E9E']] }),
    cat: S({ fam: 'm', name: 'Alley Cat', ear: 'point', earIn: 1, snout: 'flat', nose: 'pink', whisk: 1, mark: 'tabby', pal: [['#E89B4A', '#FBE6CC', '#B8622A'], ['#3A3340', '#F2EEE8', '#6A5E70'], ['#9A9AA8', '#F2EEE8', '#5E5E6E']] }),
    possum: S({ fam: 'm', name: 'Possum', ear: 'round', earDark: 1, snout: 'long', nose: 'pink', whisk: 1, mark: 'face', pal: [['#9A96A0', '#F6F2EC', '#2E2A34']] }),
    moose: S({ fam: 'm', name: 'Moose', ear: 'cow', horn: 'antler', snout: 'wide', nose: 'nostrils', w: 1.08, h: 1.12, pal: [['#6A4A36', '#9A7458', '#3A2A20']] }),
    beaver: S({ fam: 'm', name: 'Beaver', ear: 'tiny', snout: 'muzzle', nose: 'ink', tooth: 'buck', whisk: 1, w: 1.08, pal: [['#9A6440', '#D9A578', '#5A3A24']] }),
    bear: S({ fam: 'm', name: 'Bear', ear: 'round', earIn: 1, snout: 'muzzle', nose: 'big', w: 1.12, pal: [['#7A5034', '#D9A97A', '#4A2E1E'], ['#4A3A34', '#B89A80', '#2A2020'], ['#D98A4A', '#F6D8B0', '#8A4A22']] }),
    fox: S({ fam: 'm', name: 'Fox', ear: 'big', earIn: 1, snout: 'long', nose: 'ink', mark: 'cheeks', pal: [['#E07A36', '#FFF4E4', '#3A2A2A']] }),
    fennec: S({ fam: 'm', name: 'Fennec', ear: 'huge', earIn: 1, snout: 'long', nose: 'ink', mark: 'cheeks', w: 0.92, pal: [['#E8C48A', '#FFF4E4', '#3A2A2A']] }),
    deer: S({ fam: 'm', name: 'Deer', ear: 'side', earIn: 1, horn: 'nub', snout: 'muzzle', nose: 'ink', mark: 'freck', w: 0.94, h: 1.06, pal: [['#C08050', '#F6E2C8', '#6A3E22']] }),
    squirrel: S({ fam: 'm', name: 'Squirrel', ear: 'tuft', snout: 'muzzle', nose: 'ink', tooth: 'buck', tail: 1, pal: [['#C8693A', '#F6DCC0', '#8A3E1E'], ['#8A8A96', '#EDE8E2', '#5A5A66']] }),
    skunk: S({ fam: 'm', name: 'Skunk', ear: 'round', snout: 'muzzle', nose: 'pink', mark: 'stripe', pal: [['#2E2A36', '#F6F2EC', '#F29E9E']] }),
    otter: S({ fam: 'm', name: 'Otter', ear: 'tiny', snout: 'flat', nose: 'ink', whisk: 1, w: 1.06, pal: [['#8A5A3A', '#E2C2A0', '#4A2E20']] }),
    seal: S({ fam: 'm', name: 'Seal', ear: 'none', snout: 'flat', nose: 'ink', whisk: 1, w: 1.04, pal: [['#8E96A6', '#C8D0DA', '#3A3A48'], ['#B8A898', '#E8DCCF', '#4A3E36']] }),
    walrus: S({ fam: 'm', name: 'Walrus', ear: 'none', snout: 'flat', nose: 'ink', stache: 1, tooth: 'tusk', whisk: 1, w: 1.22, pal: [['#B98A6E', '#D9B49A', '#6A4A3A']] }),
    badger: S({ fam: 'm', name: 'Badger', ear: 'round', snout: 'long', nose: 'ink', mark: 'badger', w: 1.08, pal: [['#8E8A92', '#F6F2EC', '#2E2A34']] }),
    armadillo: S({ fam: 'm', name: 'Armadillo', ear: 'point', earIn: 1, snout: 'long', nose: 'pink', mark: 'plates', pal: [['#C9A88E', '#E8D2BE', '#8A6A56']] }),
    tortoise: S({ fam: 'r', name: 'Tortoise', ear: 'none', snout: 'none', nose: 'holes', shell: 1, w: 1.02, h: 0.96, pal: [['#8DAA5E', '#C9D89A', '#5E6E3A']] }),
    lizard: S({ fam: 'r', name: 'Gila Lizard', ear: 'none', snout: 'none', nose: 'holes', mark: 'blotch', slit: 1, w: 1.14, h: 0.9, pal: [['#E07A3A', '#F6C89A', '#3A2A2A'], ['#6DBB4A', '#C9E89A', '#2E5E2A']] }),
    hen: S({ fam: 'b', name: 'Hen', beak: 'cone', tuft: 'comb', wattle: 1, pal: [['#F6F1E6', '#FFFFFF', '#F2B632'], ['#C8783E', '#E8B488', '#F2B632']] }),
    rooster: S({ fam: 'b', name: 'Rooster', beak: 'cone', tuft: 'bigcomb', wattle: 1, pal: [['#D9603A', '#F2B632', '#F2B632'], ['#F6F1E6', '#F2B632', '#F2B632']] }),
    pigeon: S({ fam: 'b', name: 'Pigeon', beak: 'small', mark: 'neck', pal: [['#9AA2B4', '#7FBFA0', '#5A5466']] }),
    crow: S({ fam: 'b', name: 'Crow', beak: 'cone', w: 0.98, pal: [['#3A3646', '#5A566A', '#4A4656']] }),
    loon: S({ fam: 'b', name: 'Loon', beak: 'long', mark: 'band', red: 1, pal: [['#2E3440', '#F6F2EC', '#3A3E4A']] }),
    gull: S({ fam: 'b', name: 'Gull', beak: 'long', beakDot: 1, pal: [['#FFFDF6', '#B8C2CE', '#F2B632']] }),
    pelican: S({ fam: 'b', name: 'Pelican', beak: 'pouch', tuft: 'crest', pal: [['#F6F2EC', '#F2E2C8', '#F2A23A']] }),
    puffin: S({ fam: 'b', name: 'Puffin', beak: 'big', mark: 'face', pal: [['#2E2A36', '#FFFDF6', '#EE7A35']] }),
    owl: S({ fam: 'b', name: 'Owl', ear: 'tufts', beak: 'hook', mark: 'disc', bigEye: 1, w: 1.1, pal: [['#9A6A44', '#E8CFA8', '#F2B632'], ['#B8B2AA', '#F2EEE6', '#F2B632'], ['#6A4A36', '#D9B48A', '#E8A23A']] }),
    peacock: S({ fam: 'b', name: 'Peacock', beak: 'cone', tuft: 'fan', mark: 'eyepatch', pal: [['#2E6FB8', '#FFFDF6', '#C9A86A']] }),
    flamingo: S({ fam: 'b', name: 'Flamingo', beak: 'bent', pal: [['#F29EA0', '#FFD6D0', '#2E2A36']] }),
    swan: S({ fam: 'b', name: 'Swan', beak: 'knob', pal: [['#FFFDF6', '#F2EEE6', '#EE7A35']] }),
    parrot: S({ fam: 'b', name: 'Parrot', beak: 'hookbig', mark: 'face', pal: [['#4AAA4A', '#FFFDF6', '#F2B632'], ['#D9483B', '#FFFDF6', '#F2B632'], ['#2E8FD0', '#F6F2EC', '#3A3A48']] }),
    heron: S({ fam: 'b', name: 'Heron', beak: 'long', tuft: 'plume', pal: [['#9AA6B8', '#FFFDF6', '#F2B632']] }),
    goose: S({ fam: 'b', name: 'Goose', beak: 'cone', beakCol: '#EE7A35', pal: [['#F6F2EC', '#FFFFFF', '#EE7A35'], ['#9A9690', '#F6F2EC', '#3A3640']] }),
    vulture: S({ fam: 'b', name: 'Vulture', beak: 'hook', mark: 'bald', ruff: 1, pal: [['#F2A4A0', '#3A3440', '#E8D8B8']] }),
  };
  var SPECIES_IDS = Object.keys(SPECIES);

  // Pitcher species, matched to name / nickname (see src/20-content.js). The 3D renderer reads the same table.
  var SPECIES_BY_PITCHER = {
    p_hank: 'goat', p_dottie: 'hen', p_clem: 'dog', p_ox: 'ox',
    p_vinnie: 'rat', p_rosalind: 'pigeon', p_marty: 'cat', p_landlord: 'bulldog',
    p_ellis: 'moose', p_june: 'loon', p_otis: 'beaver', p_sasquatch: 'bear',
    p_pearl: 'walrus', p_nils: 'pelican', p_sully: 'seal', p_admiral: 'gull',
    p_rio: 'armadillo', p_tess: 'tortoise', p_cosmo: 'possum', p_mirage: 'lizard',
    p_organist: 'flamingo', p_belle: 'owl', p_thunder: 'bison', p_halo: 'peacock',
    p_bpbob: 'badger', p_mabel: 'goose', p_ike: 'squirrel',
  };
  var KEYWORDS = [['ox', 'ox'], ['loon', 'loon'], ['sasquatch', 'bear'], ['bear', 'bear'], ['gull', 'gull'], ['owl', 'owl'],
    ['goat', 'goat'], ['walrus', 'walrus'], ['badger', 'badger'], ['rooster', 'rooster'], ['hen', 'hen'], ['moose', 'moose'],
    ['possum', 'possum'], ['pelican', 'pelican'], ['bulldog', 'bulldog'], ['dog', 'dog'], ['tortoise', 'tortoise'], ['turtle', 'tortoise'],
    ['eephus', 'tortoise'], ['flamingo', 'flamingo'], ['armadillo', 'armadillo'], ['rat', 'rat'], ['cat', 'cat'], ['fox', 'fox'],
    ['seal', 'seal'], ['crow', 'crow'], ['pigeon', 'pigeon'], ['goose', 'goose'], ['bison', 'bison'], ['buffalo', 'bison']];
  function speciesFor(p) {
    if (!p) return 'bear';
    if (p.species && SPECIES[p.species]) return p.species;
    if (SPECIES_BY_PITCHER[p.id]) return SPECIES_BY_PITCHER[p.id];
    var words = ((p.nick || '') + ' ' + (p.name || '')).toLowerCase().split(/[^a-z]+/);
    for (var i = 0; i < KEYWORDS.length; i++) if (words.indexOf(KEYWORDS[i][0]) >= 0) return KEYWORDS[i][1];
    var pool = ['goat', 'dog', 'rat', 'cat', 'bear', 'beaver', 'seal', 'walrus', 'pelican', 'armadillo', 'possum', 'badger', 'owl', 'goose', 'squirrel', 'bulldog'];
    return pool[U.hashStr(p.id || p.name || 'x') % pool.length];
  }
  var TEAM_SPECIES = [
    ['goat', 'hen', 'rooster', 'sheep', 'cow', 'horse', 'dog', 'ox'],
    ['pigeon', 'rat', 'cat', 'bulldog', 'mouse', 'possum', 'crow'],
    ['moose', 'loon', 'beaver', 'bear', 'fox', 'deer', 'squirrel', 'skunk'],
    ['gull', 'seal', 'walrus', 'pelican', 'puffin', 'otter'],
    ['armadillo', 'tortoise', 'lizard', 'fennec', 'bighorn', 'vulture', 'badger'],
    ['owl', 'peacock', 'flamingo', 'swan', 'parrot', 'heron', 'goose'],
  ];

  // ================================================================== FACE PARAMETERS (seeded)
  function face(spId, seed, o) {
    o = o || {};
    var sp = SPECIES[spId] || SPECIES.bear, r = U.rng((seed >>> 0) ^ 0x9e3779b9);
    function pick(a) { return a[Math.floor(r() * a.length) % a.length]; }
    var pal = sp.pal[Math.floor(r() * sp.pal.length) % sp.pal.length];
    var f = {
      id: spId, sp: sp, main: pal[0], sec: pal[1], ac: pal[2],
      eyes: pick(['wide', 'wide', 'wide', 'half', 'happy', 'wink', 'wide']),
      brow: pick(['up', 'flat', 'angry', 'worry', 'up', 'cocky']),
      mouth: pick(['grin', 'smile', 'smirk', 'grin', 'tongue', 'open', 'grin']),
      gx: (r() - 0.5) * 1.8, gy: (r() - 0.3) * 0.8, cap: r() < 0.1 ? 'back' : 'fwd', tilt: (r() - 0.5) * 0.18,
      blush: r() < 0.45, acc: {}, scale: 1, hair: null, boss: false,
    };
    if (f.eyes === 'happy' && f.mouth === 'open') f.mouth = 'grin';
    var a = r();
    if (a < 0.09) f.acc.gum = 1;
    else if (a < 0.17) f.acc.shades = 1;
    else if (a < 0.33 && f.mouth === 'grin' && sp.fam === 'm') f.acc.gap = 1;
    else if (a < 0.40) f.acc.bandaid = 1;
    else if (a < 0.47 && sp.fam === 'm') f.acc.stalk = 1;
    else if (a < 0.55) f.acc.eyeblack = 1;
    if (r() < 0.22) f.acc.freckles = 1;
    if (f.acc.gum) f.mouth = 'gum';
    if (o.misfur) { f.main = o.misfur[0]; f.sec = o.misfur[1]; }
    return f;
  }

  // ================================================================== HEAD (origin = head centre; ~20 units radius)
  function head(x, f, o) {
    o = o || {};
    var sp = f.sp, rx = 20 * (sp.w || 1), ry = 19.5 * (sp.h || 1), bird = sp.fam === 'b', rep = sp.fam === 'r';
    var main = f.main, sec = f.sec, acc = f.ac, capC = o.cap || PAL.brick, capOn = o.capOn !== false;
    var capTop = -ry * 0.56;     // y of the cap's lower edge
    var i;

    // ---- behind the head
    if (sp.tuft === 'fan') {
      for (i = 0; i < 9; i++) {
        var a = -PI / 2 + (i - 4) * 0.33, fx = Math.cos(a) * 34, fy = Math.sin(a) * 34 - 4;
        var fp = new Path2D(); fp.moveTo(0, -6); fp.quadraticCurveTo(fx * 0.6 - 4 * Math.sin(a), fy * 0.6, fx, fy); fp.quadraticCurveTo(fx * 0.6 + 4 * Math.sin(a), fy * 0.6, 0, -6);
        line(x, fp, INK, 1.6); x.fillStyle = '#3E9A5A'; x.fill(fp);
        cel(x, ell(fx, fy, 5.4, 6, a + PI / 2), '#3E9A5A', { sh: 1, lw: 1.6 });
        flat(x, ell(fx, fy, 3.3, 3.8, a + PI / 2), '#F2B632', 0); flat(x, circ(fx, fy + 0.3, 1.9), '#2E6FB8', 0);
      }
    }
    if (sp.tuft === 'mane') {
      cel(x, path('M' + (-rx * 0.3) + ' ' + (-ry * 0.9) + ' Q' + (rx * 0.9) + ' ' + (-ry * 1.3) + ' ' + (rx * 1.25) + ' ' + (-ry * 0.1) + ' Q' + (rx * 1.3) + ' ' + (ry * 0.6) + ' ' + (rx * 0.9) + ' ' + (ry * 0.9) + ' L' + (rx * 0.5) + ' 0 Z'), dark(main, 0.45), { sh: 2 });
    }
    if (sp.ruff) cel(x, blobPath(0, ry * 0.9, rx * 1.2, U.rng(5), 14, 0.35), '#E8D8B8', { sh: 2 });
    // ears behind
    var ear = sp.ear, inC = sp.earIn ? mix(PAL.pink, main, 0.25) : null;
    function pairEars(fn) { [-1, 1].forEach(function (s) { x.save(); x.scale(s, 1); fn(s); x.restore(); }); }
    if (ear === 'point' || ear === 'big' || ear === 'huge') {
      var eh = sp.earH || (ear === 'huge' ? 30 : ear === 'big' ? 22 : 15), ew = ear === 'huge' ? 12 : ear === 'big' ? 10 : sp.earH ? 10 : 8.5;
      pairEars(function () {
        var p = path('M' + (rx * 0.35) + ' ' + (-ry * 0.7) + ' Q' + (rx * 0.6) + ' ' + (-ry * 0.95 - eh) + ' ' + (rx * 0.75 + ew * 0.4) + ' ' + (-ry * 0.8 - eh) + ' Q' + (rx * 1.05 + ew * 0.3) + ' ' + (-ry * 0.6) + ' ' + (rx * 0.95) + ' ' + (-ry * 0.25) + ' Z');
        cel(x, p, sp.earDark ? dark(main, 0.5) : main, { sh: 1.6 });
        if (inC) flat(x, path('M' + (rx * 0.55) + ' ' + (-ry * 0.7) + ' Q' + (rx * 0.66) + ' ' + (-ry * 0.9 - eh * 0.75) + ' ' + (rx * 0.76 + ew * 0.3) + ' ' + (-ry * 0.82 - eh * 0.7) + ' Q' + (rx * 0.92) + ' ' + (-ry * 0.6) + ' ' + (rx * 0.85) + ' ' + (-ry * 0.42) + ' Z'), inC, 0);
      });
    } else if (ear === 'side') {
      pairEars(function () {
        var p = ell(rx * 1.12, -ry * 0.45, 11, 6, -0.45);
        cel(x, p, main, { sh: 1.4 }); flat(x, ell(rx * 1.15, -ry * 0.46, 7, 3.3, -0.45), inC || sec, 0);
      });
    } else if (ear === 'round' || ear === 'mouse') {
      var er = ear === 'mouse' ? (sp.earBig ? 12.5 : 10.5) : 7.5;
      pairEars(function () {
        var cx = rx * (ear === 'mouse' ? 0.78 : 0.72), cy = -ry * (ear === 'mouse' ? 0.78 : 0.82);
        cel(x, circ(cx, cy, er), sp.earDark ? dark(main, 0.55) : main, { sh: 1.5 });
        flat(x, circ(cx + 0.6, cy + 0.8, er * 0.58), sp.earDark ? mix(PAL.pink, '#E8E0E0', 0.4) : (inC || light(main, 0.35)), 0);
      });
    } else if (ear === 'cow' || ear === 'flop' || ear === 'rose') {
      pairEars(function () {
        var p;
        if (ear === 'cow') p = ell(rx * 1.08, -ry * 0.32, 10, 5, 0.32);
        else if (ear === 'rose') p = ell(rx * 0.9, -ry * 0.62, 6.5, 5, 0.6);
        else p = path('M' + (rx * 0.62) + ' ' + (-ry * 0.68) + ' Q' + (rx * 1.45) + ' ' + (-ry * 0.7) + ' ' + (rx * 1.2) + ' ' + (ry * 0.55) + ' Q' + (rx * 1.02) + ' ' + (ry * 0.8) + ' ' + (rx * 0.86) + ' ' + (ry * 0.2) + ' Z');
        cel(x, p, ear === 'flop' ? dark(main, 0.22) : main, { sh: 1.4 });
        if (ear === 'cow') flat(x, ell(rx * 1.12, -ry * 0.32, 6, 2.6, 0.32), mix(PAL.pink, main, 0.3), 0);
      });
    } else if (ear === 'tiny') {
      pairEars(function () { cel(x, circ(rx * 0.8, -ry * 0.72, 4.2), main, { sh: 1 }); });
    } else if (ear === 'tuft') {
      pairEars(function () {
        var p = path('M' + (rx * 0.42) + ' ' + (-ry * 0.75) + ' Q' + (rx * 0.6) + ' ' + (-ry * 1.65) + ' ' + (rx * 0.95) + ' ' + (-ry * 1.55) + ' Q' + (rx * 0.85) + ' ' + (-ry * 1.1) + ' ' + (rx * 0.95) + ' ' + (-ry * 0.45) + ' Z');
        cel(x, p, main, { sh: 1.4 });
      });
    }
    if (sp.tuft === 'wool') { // the fleece around the face
      cel(x, blobPath(0, -2, rx * 1.28, U.rng(11), 13, 0.28), sec, { sh: 2.2 });
    }

    // ---- head
    var hp;
    if (rep) hp = path('M' + (-rx) + ' 2 C' + (-rx) + ' ' + (-ry * 1.25) + ' ' + rx + ' ' + (-ry * 1.25) + ' ' + rx + ' 2 C' + rx + ' ' + (ry * 1.1) + ' ' + (-rx) + ' ' + (ry * 1.1) + ' ' + (-rx) + ' 2 Z');
    else if (bird) hp = ell(0, 0, rx * 0.98, ry);
    else hp = path('M0 ' + (-ry) + ' C' + (rx * 0.62) + ' ' + (-ry) + ' ' + (rx * 1.04) + ' ' + (-ry * 0.6) + ' ' + rx + ' ' + (ry * 0.08) +
      ' C' + (rx * 0.97) + ' ' + (ry * 0.72) + ' ' + (rx * 0.6) + ' ' + (ry * 1.04) + ' 0 ' + (ry * 1.04) +
      ' C' + (-rx * 0.6) + ' ' + (ry * 1.04) + ' ' + (-rx * 0.97) + ' ' + (ry * 0.72) + ' ' + (-rx) + ' ' + (ry * 0.08) +
      ' C' + (-rx * 1.04) + ' ' + (-ry * 0.6) + ' ' + (-rx * 0.62) + ' ' + (-ry) + ' 0 ' + (-ry) + ' Z');
    cel(x, hp, main, { sh: 3.2, lw: 0 });
    // markings (clipped to the head)
    x.save(); x.clip(hp);
    var m = sp.mark;
    if (m === 'mask') {
      flat(x, path('M' + (-rx * 1.1) + ' ' + (-ry * 0.05) + ' Q' + (-rx * 0.6) + ' ' + (-ry * 0.42) + ' 0 ' + (-ry * 0.18) + ' Q' + (rx * 0.6) + ' ' + (-ry * 0.42) + ' ' + (rx * 1.1) + ' ' + (-ry * 0.05) +
        ' Q' + (rx * 0.75) + ' ' + (ry * 0.42) + ' ' + (rx * 0.28) + ' ' + (ry * 0.2) + ' Q0 ' + (ry * 0.1) + ' ' + (-rx * 0.28) + ' ' + (ry * 0.2) + ' Q' + (-rx * 0.75) + ' ' + (ry * 0.42) + ' ' + (-rx * 1.1) + ' ' + (-ry * 0.05) + ' Z'), '#3A3242', 0);
      flat(x, path('M' + (-rx * 0.85) + ' ' + (-ry * 0.42) + ' Q0 ' + (-ry * 0.7) + ' ' + (rx * 0.85) + ' ' + (-ry * 0.42) + ' Q0 ' + (-ry * 0.5) + ' ' + (-rx * 0.85) + ' ' + (-ry * 0.42) + ' Z'), WHITE, 0);
      flat(x, ell(0, ry * 0.55, rx * 0.62, ry * 0.5), sec, 0);
    } else if (m === 'spots') {
      flat(x, blobPath(-rx * 0.7, -ry * 0.5, 8, U.rng(3), 7, 0.5), acc, 0);
      flat(x, blobPath(rx * 0.75, ry * 0.1, 6, U.rng(4), 7, 0.5), acc, 0);
    } else if (m === 'blaze') {
      flat(x, path('M-3 ' + (-ry) + ' L3 ' + (-ry) + ' L5 ' + (ry * 0.3) + ' L-5 ' + (ry * 0.3) + ' Z'), WHITE, 0);
    } else if (m === 'patch') {
      flat(x, blobPath(rx * 0.42, -ry * 0.12, 9, U.rng(8), 8, 0.35), dark(main, 0.5), 0);
    } else if (m === 'stripe' || m === 'badger') {
      if (m === 'badger') { flat(x, ell(-rx * 0.55, -ry * 0.25, rx * 0.32, ry * 0.95, 0.2), acc, 0); flat(x, ell(rx * 0.55, -ry * 0.25, rx * 0.32, ry * 0.95, -0.2), acc, 0); }
      flat(x, path('M-4 ' + (-ry * 1.1) + ' L4 ' + (-ry * 1.1) + ' Q3 ' + (-ry * 0.2) + ' 2 ' + (ry * 0.2) + ' L-2 ' + (ry * 0.2) + ' Q-3 ' + (-ry * 0.2) + ' -4 ' + (-ry * 1.1) + ' Z'), sec, 0);
    } else if (m === 'tabby') {
      line(x, 'M-4 ' + (-ry * 0.95) + ' L-3 ' + (-ry * 0.55) + ' M0 ' + (-ry) + ' L0 ' + (-ry * 0.5) + ' M4 ' + (-ry * 0.95) + ' L3 ' + (-ry * 0.55), acc, 2.2);
      line(x, 'M' + (-rx) + ' 2 L' + (-rx * 0.7) + ' 3 M' + (-rx) + ' 7 L' + (-rx * 0.72) + ' 6 M' + rx + ' 2 L' + (rx * 0.7) + ' 3 M' + rx + ' 7 L' + (rx * 0.72) + ' 6', acc, 2);
    } else if (m === 'face') {
      flat(x, ell(0, ry * 0.12, rx * 0.86, ry * 0.86), sec, 0);
    } else if (m === 'cheeks') {
      flat(x, path('M' + (-rx * 1.1) + ' ' + (ry * 0.05) + ' Q' + (-rx * 0.5) + ' ' + (-ry * 0.1) + ' 0 ' + (ry * 0.3) + ' Q' + (rx * 0.5) + ' ' + (-ry * 0.1) + ' ' + (rx * 1.1) + ' ' + (ry * 0.05) + ' L' + rx + ' ' + (ry * 1.2) + ' L' + (-rx) + ' ' + (ry * 1.2) + ' Z'), sec, 0);
    } else if (m === 'disc') {
      flat(x, path('M0 ' + (-ry * 0.25) + ' Q' + (-rx * 0.5) + ' ' + (-ry * 0.95) + ' ' + (-rx * 0.88) + ' ' + (-ry * 0.2) + ' Q' + (-rx * 0.95) + ' ' + (ry * 0.75) + ' 0 ' + (ry * 0.72) + ' Q' + (rx * 0.95) + ' ' + (ry * 0.75) + ' ' + (rx * 0.88) + ' ' + (-ry * 0.2) + ' Q' + (rx * 0.5) + ' ' + (-ry * 0.95) + ' 0 ' + (-ry * 0.25) + ' Z'), sec, 0);
    } else if (m === 'band') {
      flat(x, rr(-rx, ry * 0.55, rx * 2, 5, 1), sec, 0);
      for (i = -3; i <= 3; i++) flat(x, rr(i * 4.2 - 1, ry * 0.55, 2, 5, 0.8), main, 0);
    } else if (m === 'neck') {
      flat(x, ell(0, ry * 1.05, rx * 1.1, ry * 0.42), sec, 0);
      flat(x, ell(0, ry * 1.2, rx * 1.1, ry * 0.32), '#8A6AAE', 0);
    } else if (m === 'hackle') {
      for (i = -3; i <= 3; i++) flat(x, poly([i * 6 - 4, ry * 1.2, i * 6 + 4, ry * 1.2, i * 6 + 1, ry * 0.45]), sec, 0);
    } else if (m === 'eyepatch') {
      flat(x, ell(-rx * 0.4, -1, 7.5, 5.5, -0.2), sec, 0); flat(x, ell(rx * 0.4, -1, 7.5, 5.5, 0.2), sec, 0);
    } else if (m === 'bald') {
      flat(x, ell(0, ry * 1.2, rx * 1.2, ry * 0.45), sec, 0);
    } else if (m === 'plates') {
      for (i = 0; i < 4; i++) line(x, 'M' + (-rx) + ' ' + (-ry * (0.95 - i * 0.2)) + ' Q0 ' + (-ry * (1.2 - i * 0.2)) + ' ' + rx + ' ' + (-ry * (0.95 - i * 0.2)), dark(main, 0.35), 1.6);
    } else if (m === 'blotch') {
      var br = U.rng(21); for (i = 0; i < 7; i++) flat(x, blobPath((br() - 0.5) * rx * 1.8, (br() - 0.65) * ry * 1.6, 3 + br() * 3, br, 6, 0.4), acc, 0);
    } else if (m === 'freck') {
      var dr = U.rng(4); for (i = 0; i < 6; i++) flat(x, circ((dr() - 0.5) * rx * 1.4, -ry * 0.6 + dr() * 6, 1.2), WHITE, 0);
    }
    if (sp.tuft === 'hair') flat(x, blobPath(0, -ry * 0.95, 9, U.rng(6), 9, 0.5), dark(main, 0.3), 0);
    x.restore();
    // re-shade (crescent over markings) + outline
    x.save(); x.clip(hp); x.globalAlpha = 0.22; x.fillStyle = SHADOW; x.fill(path('M' + (rx * 1.2) + ' ' + (-ry * 1.2) + ' L' + (rx * 1.2) + ' ' + (ry * 1.3) + ' L' + (-rx * 1.2) + ' ' + (ry * 1.3) + ' C' + (rx * 0.2) + ' ' + (ry * 1.3) + ' ' + (rx * 1.3) + ' ' + (ry * 0.2) + ' ' + (rx * 0.5) + ' ' + (-ry * 1.2) + ' Z')); x.restore();
    line(x, hp, INK, LW);
    if (sp.tuft === 'wool') { // a curly fringe on the forehead under the cap
      cel(x, blobPath(0, -ry * 0.62, rx * 0.62, U.rng(13), 9, 0.4), sec, { sh: 1.2, lw: 1.6 });
    }

    // ---- snout / muzzle
    var my = 11.5;              // mouth line y
    var snout = sp.snout, ny = 4.2;
    if (snout === 'muzzle') { cel(x, ell(0, 8.2, rx * 0.46, 7.4), sec, { sh: 1.5, lw: 1.8 }); my = 12; ny = 4.5; }
    else if (snout === 'long') { cel(x, path('M' + (-rx * 0.42) + ' 2 Q0 -4 ' + (rx * 0.42) + ' 2 Q' + (rx * 0.5) + ' 15 0 16 Q' + (-rx * 0.5) + ' 15 ' + (-rx * 0.42) + ' 2 Z'), sec, { sh: 1.5, lw: 1.8 }); my = 12.5; ny = 3.2; }
    else if (snout === 'wide') { cel(x, ell(0, 10, rx * 0.64, 8.6), sec, { sh: 1.8, lw: 1.9 }); my = 15; ny = 7.4; }
    else if (snout === 'flat') {
      cel(x, ell(-5, 9, 6.4, 5), sec, { sh: 1.1, lw: 1.7 }); cel(x, ell(5, 9, 6.4, 5), sec, { sh: 1.1, lw: 1.7 });
      x.fillStyle = sec; x.fill(rr(-4, 5.4, 8, 6, 2));
      my = 13; ny = 5;
    }
    // nose
    if (!bird) {
      var nose = sp.nose;
      if (nose === 'ink' || nose === 'big') { var nr = nose === 'big' ? 4.8 : 3.4; cel(x, path('M' + (-nr) + ' ' + (ny - 1) + ' Q0 ' + (ny - nr * 0.9) + ' ' + nr + ' ' + (ny - 1) + ' Q' + (nr * 0.6) + ' ' + (ny + nr * 0.8) + ' 0 ' + (ny + nr * 0.8) + ' Q' + (-nr * 0.6) + ' ' + (ny + nr * 0.8) + ' ' + (-nr) + ' ' + (ny - 1) + ' Z'), '#2E2434', { sh: 1, lw: 1.6 }); flat(x, ell(-nr * 0.35, ny - nr * 0.25, nr * 0.32, nr * 0.2, -0.3), 'rgba(255,255,255,.7)', 0); }
      else if (nose === 'pink') { cel(x, ell(0, ny, 3.4, 2.6), '#F07D98', { sh: 0.8, lw: 1.5 }); flat(x, ell(-1, ny - 0.8, 1.1, 0.6), 'rgba(255,255,255,.7)', 0); }
      else if (nose === 'nostrils') { flat(x, ell(-4.2, ny, 1.6, 2.2, 0.3), dark(sec, 0.6), 0); flat(x, ell(4.2, ny, 1.6, 2.2, -0.3), dark(sec, 0.6), 0); }
      else if (nose === 'holes') { flat(x, circ(-2.2, 2, 0.9), INK, 0); flat(x, circ(2.2, 2, 0.9), INK, 0); my = 9.5; }
    }

    // ---- cap (front pieces after eyes? no: cap first, eyes / brows overlap the brim edge)
    if (capOn) drawCap(x, rx, ry, capTop, capC, f, o);
    // crests / horns / tufts poke through the cap
    if (sp.horn) horns(x, sp.horn, rx, ry, f);
    if (sp.tuft === 'comb' || sp.tuft === 'bigcomb') {
      var big = sp.tuft === 'bigcomb';
      cel(x, path('M' + (-7) + ' ' + (capTop - ry * 0.55) + ' Q-9 ' + (-ry * (big ? 1.75 : 1.5)) + ' -3 ' + (-ry * (big ? 1.6 : 1.42)) + ' Q0 ' + (-ry * (big ? 1.95 : 1.65)) + ' 3 ' + (-ry * (big ? 1.62 : 1.42)) + ' Q9 ' + (-ry * (big ? 1.8 : 1.5)) + ' 8 ' + (capTop - ry * 0.55) + ' Z'), PAL.brick, { sh: 1.4 });
    } else if (sp.tuft === 'crest' || sp.tuft === 'plume') {
      var cp = sp.tuft === 'plume' ? 'M-2 ' + (-ry * 1.05) + ' Q-14 ' + (-ry * 1.9) + ' -26 ' + (-ry * 1.7) + ' Q-12 ' + (-ry * 1.55) + ' 2 ' + (-ry * 1.0) + ' Z'
        : 'M-3 ' + (-ry * 1.05) + ' Q-6 ' + (-ry * 1.7) + ' 2 ' + (-ry * 1.75) + ' Q0 ' + (-ry * 1.4) + ' 4 ' + (-ry * 1.0) + ' Z';
      cel(x, path(cp), sp.tuft === 'plume' ? dark(main, 0.35) : light(PAL.mustard, 0.3), { sh: 1, lw: 1.6 });
    }
    if (sp.ear === 'tufts') {
      pairEars(function () { cel(x, path('M' + (rx * 0.5) + ' ' + (capTop - 3) + ' L' + (rx * 1.02) + ' ' + (-ry * 1.25) + ' L' + (rx * 0.95) + ' ' + (capTop + 3) + ' Z'), dark(main, 0.15), { sh: 1, lw: 1.7 }); });
    }

    // ---- eyes
    eyes(x, f, rx, ry, bird, rep);

    // ---- mouth / beak
    if (bird) beak(x, f, sp, ry);
    else mouth(x, f, sp, my, rx);

    // ---- facial extras
    if (sp.whisk) {
      line(x, 'M' + (-rx * 0.38) + ' ' + (my - 3.5) + ' L' + (-rx * 1.05) + ' ' + (my - 6) + ' M' + (-rx * 0.38) + ' ' + (my - 2) + ' L' + (-rx * 1.08) + ' ' + (my - 1.5) +
        ' M' + (rx * 0.38) + ' ' + (my - 3.5) + ' L' + (rx * 1.05) + ' ' + (my - 6) + ' M' + (rx * 0.38) + ' ' + (my - 2) + ' L' + (rx * 1.08) + ' ' + (my - 1.5), INK, 0.9);
    }
    if (sp.stache || f.hair === 'mustache') {
      var sc = sp.stache ? dark(sec, 0.25) : dark(main, 0.45), sw = sp.stache ? 1.25 : 1;
      cel(x, path('M0 ' + (my - 5) + ' Q' + (-6 * sw) + ' ' + (my - 8) + ' ' + (-12 * sw) + ' ' + (my - 3) + ' Q' + (-15 * sw) + ' ' + (my + 3) + ' ' + (-9 * sw) + ' ' + (my + 1) + ' Q-4 ' + (my) + ' 0 ' + (my - 1.5) +
        ' Q4 ' + my + ' ' + (9 * sw) + ' ' + (my + 1) + ' Q' + (15 * sw) + ' ' + (my + 3) + ' ' + (12 * sw) + ' ' + (my - 3) + ' Q' + (6 * sw) + ' ' + (my - 8) + ' 0 ' + (my - 5) + ' Z'), sc, { sh: 1, lw: 1.7 });
    }
    if (sp.tooth === 'tusk') {
      cel(x, path('M-6 ' + (my + 1) + ' Q-7 ' + (my + 12) + ' -4 ' + (my + 16) + ' Q-3.5 ' + (my + 8) + ' -3 ' + (my + 1) + ' Z'), WHITE, { sh: 0.8, lw: 1.5 });
      cel(x, path('M6 ' + (my + 1) + ' Q7 ' + (my + 12) + ' 4 ' + (my + 16) + ' Q3.5 ' + (my + 8) + ' 3 ' + (my + 1) + ' Z'), WHITE, { sh: 0.8, lw: 1.5 });
    }
    if (sp.beard || f.hair === 'beard') {
      var bc = sp.beard ? light(main, 0.15) : dark(main, 0.4);
      cel(x, path('M-5 ' + (ry * 0.92) + ' Q-3 ' + (ry * 1.5) + ' 0 ' + (ry * 1.62) + ' Q3 ' + (ry * 1.5) + ' 5 ' + (ry * 0.92) + ' Z'), bc, { sh: 1, lw: 1.7 });
    }
    if (f.hair === 'sideburns') {
      flat(x, path('M' + (-rx) + ' ' + (-ry * 0.2) + ' L' + (-rx * 0.75) + ' ' + (ry * 0.4) + ' L' + (-rx * 0.96) + ' ' + (ry * 0.35) + ' Z'), dark(main, 0.45), 1.4);
      flat(x, path('M' + rx + ' ' + (-ry * 0.2) + ' L' + (rx * 0.75) + ' ' + (ry * 0.4) + ' L' + (rx * 0.96) + ' ' + (ry * 0.35) + ' Z'), dark(main, 0.45), 1.4);
    }
    if (sp.wattle) cel(x, path('M-1 ' + (ry * 0.6) + ' Q-5 ' + (ry * 1.15) + ' -1 ' + (ry * 1.2) + ' Q3 ' + (ry * 1.1) + ' 2 ' + (ry * 0.6) + ' Z'), PAL.brick, { sh: 0.8, lw: 1.5 });
    // accessories
    var A = f.acc || {};
    if (A.freckles) { var fr = U.rng(17); x.fillStyle = dark(main, 0.45); for (i = 0; i < 6; i++) { x.beginPath(); x.arc((i < 3 ? -1 : 1) * (rx * 0.5 + fr() * 3), 6 + fr() * 3, 0.75, 0, TAU); x.fill(); } }
    if (f.blush && !rep) { x.fillStyle = 'rgba(242,120,140,.38)'; x.fill(ell(-rx * 0.62, 6.5, 4, 2.6)); x.fill(ell(rx * 0.62, 6.5, 4, 2.6)); }
    if (A.eyeblack) { flat(x, rr(-rx * 0.62, 6.2, 7, 2.4, 1), INK, 0); flat(x, rr(rx * 0.62 - 7, 6.2, 7, 2.4, 1), INK, 0); }
    if (A.bandaid) { x.save(); x.translate(rx * 0.55, -ry * 0.55); x.rotate(-0.6); cel(x, rr(-5, -2, 10, 4, 1.6), '#F2C49A', { sh: 0.6, lw: 1.3 }); line(x, 'M-1.5 -1 L-1.5 1 M1.5 -1 L1.5 1', dark('#F2C49A', 0.4), 0.6); x.restore(); }
    if (A.stalk) { line(x, 'M' + (rx * 0.25) + ' ' + (my + 1) + ' L' + (rx * 0.95) + ' ' + (my - 6), INK, 2.6); line(x, 'M' + (rx * 0.25) + ' ' + (my + 1) + ' L' + (rx * 0.95) + ' ' + (my - 6), '#E8C46A', 1.2); }
    if (A.gum) {
      var gy = bird ? 12 : my + 2;
      cel(x, circ(1.5, gy + 4, 7.8), PAL.gum, { sh: 1.6, lw: 1.8 });
      flat(x, ell(-1.8, gy + 1, 2.2, 1.4, -0.5), 'rgba(255,255,255,.8)', 0);
    }
  }

  function drawCap(x, rx, ry, capTop, capC, f, o) {
    x.save();
    x.rotate(f.tilt || 0);
    var back = f.cap === 'back';
    var crown = path('M' + (-rx * 1.04) + ' ' + capTop + ' C' + (-rx * 1.08) + ' ' + (-ry * 1.25) + ' ' + (rx * 1.08) + ' ' + (-ry * 1.25) + ' ' + (rx * 1.04) + ' ' + capTop + ' Q0 ' + (capTop + 3.2) + ' ' + (-rx * 1.04) + ' ' + capTop + ' Z');
    if (back) cel(x, path('M' + (-rx * 0.5) + ' ' + (-ry * 0.95) + ' Q' + (-rx * 1.5) + ' ' + (-ry * 1.25) + ' ' + (-rx * 1.7) + ' ' + (-ry * 0.9) + ' Q' + (-rx * 1.2) + ' ' + (-ry * 0.6) + ' ' + (-rx * 0.6) + ' ' + (-ry * 0.6) + ' Z'), dark(capC, 0.25), { sh: 1 });
    cel(x, crown, capC, { sh: 3, lw: LW });
    line(x, 'M0 ' + (-ry * 1.0) + ' Q-3 ' + (-ry * 0.7) + ' -2 ' + (capTop + 1.5), dark(capC, 0.35), 1.1);
    line(x, 'M0 ' + (-ry * 1.0) + ' Q3 ' + (-ry * 0.7) + ' 2 ' + (capTop + 1.5), dark(capC, 0.35), 1.1);
    cel(x, ell(0, -ry * 1.0, 2.6, 1.6), dark(capC, 0.2), { sh: 0.6, lw: 1.3 });
    if (back) {
      flat(x, path('M-5 ' + (capTop + 1.2) + ' Q0 ' + (capTop - 6) + ' 5 ' + (capTop + 1.2) + ' Z'), dark(capC, 0.5), 1.2);
    } else {
      var brim = path('M' + (-rx * 1.0) + ' ' + (capTop - 0.5) + ' Q' + (rx * 0.1) + ' ' + (capTop - 2.5) + ' ' + (rx * 1.12) + ' ' + (capTop - 0.5) + ' Q' + (rx * 1.3) + ' ' + (capTop + 3.5) + ' ' + (rx * 0.9) + ' ' + (capTop + 5) + ' Q0 ' + (capTop + 6.5) + ' ' + (-rx * 0.85) + ' ' + (capTop + 4.5) + ' Q' + (-rx * 1.15) + ' ' + (capTop + 3.5) + ' ' + (-rx * 1.0) + ' ' + (capTop - 0.5) + ' Z');
      cel(x, brim, dark(capC, 0.18), { sh: -1.6, shy: -1.2, lw: LW });
      // team letter on the front panel
      if (o && o.letter) inkText(x, o.letter, 0, capTop - ry * 0.12, ry * 0.42, o.letterCol || CREAM, { lw: 1.4 });
    }
    x.restore();
  }
  function horns(x, h, rx, ry, f) {
    var col = h === 'antler' ? '#E8D2A8' : h === 'curl' ? '#D9B98A' : '#F2E6CC';
    [-1, 1].forEach(function (s) {
      x.save(); x.scale(s, 1);
      var p;
      if (h === 'ox') p = path('M' + (rx * 0.7) + ' ' + (-ry * 0.55) + ' Q' + (rx * 1.5) + ' ' + (-ry * 0.5) + ' ' + (rx * 1.55) + ' ' + (-ry * 1.25) + ' Q' + (rx * 1.3) + ' ' + (-ry * 0.8) + ' ' + (rx * 0.8) + ' ' + (-ry * 0.82) + ' Z');
      else if (h === 'goat') p = path('M' + (rx * 0.3) + ' ' + (-ry * 0.95) + ' Q' + (rx * 0.6) + ' ' + (-ry * 1.9) + ' ' + (rx * 1.25) + ' ' + (-ry * 1.75) + ' Q' + (rx * 0.75) + ' ' + (-ry * 1.6) + ' ' + (rx * 0.62) + ' ' + (-ry * 0.95) + ' Z');
      else if (h === 'curl') p = path('M' + (rx * 0.5) + ' ' + (-ry * 0.95) + ' C' + (rx * 1.6) + ' ' + (-ry * 1.6) + ' ' + (rx * 1.9) + ' ' + (ry * 0.2) + ' ' + (rx * 1.15) + ' ' + (ry * 0.15) + ' C' + (rx * 1.45) + ' ' + (-ry * 0.2) + ' ' + (rx * 1.3) + ' ' + (-ry * 0.8) + ' ' + (rx * 0.75) + ' ' + (-ry * 0.5) + ' Z');
      else if (h === 'nub') p = path('M' + (rx * 0.42) + ' ' + (-ry * 0.95) + ' L' + (rx * 0.5) + ' ' + (-ry * 1.35) + ' Q' + (rx * 0.62) + ' ' + (-ry * 1.42) + ' ' + (rx * 0.7) + ' ' + (-ry * 1.3) + ' L' + (rx * 0.68) + ' ' + (-ry * 0.88) + ' Z');
      else if (h === 'antler') p = path('M' + (rx * 0.55) + ' ' + (-ry * 0.85) + ' L' + (rx * 0.95) + ' ' + (-ry * 1.15) + ' Q' + (rx * 1.15) + ' ' + (-ry * 1.9) + ' ' + (rx * 1.05) + ' ' + (-ry * 2.1) + ' L' + (rx * 1.3) + ' ' + (-ry * 1.6) + ' L' + (rx * 1.5) + ' ' + (-ry * 2.0) + ' L' + (rx * 1.65) + ' ' + (-ry * 1.45) + ' L' + (rx * 1.95) + ' ' + (-ry * 1.7) + ' Q' + (rx * 2.0) + ' ' + (-ry * 1.0) + ' ' + (rx * 1.15) + ' ' + (-ry * 0.95) + ' L' + (rx * 0.7) + ' ' + (-ry * 0.6) + ' Z');
      cel(x, p, col, { sh: 1.4, lw: 1.9 });
      if (h === 'curl') line(x, 'M' + (rx * 0.9) + ' ' + (-ry * 0.95) + ' L' + (rx * 1.15) + ' ' + (-ry * 0.75) + ' M' + (rx * 1.2) + ' ' + (-ry * 0.7) + ' L' + (rx * 1.42) + ' ' + (-ry * 0.5), dark(col, 0.35), 1);
      x.restore();
    });
  }
  function eyes(x, f, rx, ry, bird, rep) {
    var sp = f.sp, ex = (bird ? 7.4 : 7.6) * Math.min(1.1, sp.w || 1), ey = bird ? 0.5 : 1;
    var erx = sp.bigEye ? 6.2 : 4.7, ery = sp.bigEye ? 6.6 : 6, gx = f.gx || 0, gy = f.gy || 0;
    if (f.acc && f.acc.shades) {
      var sh = path('M' + (-ex - 7) + ' ' + (ey - 4) + ' L' + (ex + 7) + ' ' + (ey - 4) + ' Q' + (ex + 7.5) + ' ' + (ey + 5.5) + ' ' + (ex + 0.5) + ' ' + (ey + 5) + ' Q' + (ex - 4) + ' ' + (ey + 5) + ' ' + (ex - 4.5) + ' ' + (ey) + ' Q0 ' + (ey - 2) + ' ' + (-ex + 4.5) + ' ' + ey + ' Q' + (-ex + 4) + ' ' + (ey + 5) + ' ' + (-ex - 0.5) + ' ' + (ey + 5) + ' Q' + (-ex - 7.5) + ' ' + (ey + 5.5) + ' ' + (-ex - 7) + ' ' + (ey - 4) + ' Z');
      cel(x, sh, '#2A2232', { sh: -1, lw: 1.8 });
      line(x, 'M' + (-ex - 4) + ' ' + (ey - 1.5) + ' L' + (-ex - 1) + ' ' + (ey + 2.5) + ' M' + (ex - 2) + ' ' + (ey - 1.5) + ' L' + (ex + 1) + ' ' + (ey + 2.5), 'rgba(255,255,255,.75)', 1.2);
      brows(x, f, ex, ey - 8, true);
      return;
    }
    [-1, 1].forEach(function (s, k) {
      var cx = s * ex, style = f.eyes;
      if (style === 'wink') style = k === 0 ? 'happy' : 'wide';
      if (style === 'happy') {
        line(x, 'M' + (cx - 4) + ' ' + (ey + 1.5) + ' Q' + cx + ' ' + (ey - 5) + ' ' + (cx + 4) + ' ' + (ey + 1.5), INK, 2.2);
        return;
      }
      var e = ell(cx, ey, erx, ery);
      cel(x, e, rep && sp.slit ? '#F2D86A' : WHITE, { sh: -0.8, shy: -1, dark: '#E6DCCC', lw: 1.7 });
      var px = cx + gx * 1.4, py = ey + gy * 1.2 + (style === 'half' || style === 'angry' ? 1.2 : 0);
      if (rep && sp.slit) flat(x, ell(px, py, 0.9, 3.6), INK, 0);
      else {
        flat(x, ell(px, py, sp.bigEye ? 3.2 : 2.5, sp.bigEye ? 3.6 : 3.1), sp.red ? '#C8303A' : INK, 0);
        if (sp.red) flat(x, circ(px, py, 1.3), INK, 0);
        flat(x, circ(px - 0.9, py - 1.2, 0.95), WHITE, 0);
      }
      if (style === 'half' || style === 'angry' || rep) {
        x.save(); x.clip(e);
        var lid = style === 'angry'
          ? poly([cx - erx - 1, ey - ery - 1, cx + erx + 1, ey - ery - 1, cx + erx + 1, ey + (s < 0 ? ery * 0.05 : -ery * 0.75), cx - erx - 1, ey + (s < 0 ? -ery * 0.75 : ery * 0.05)])
          : rr(cx - erx - 1, ey - ery - 1, erx * 2 + 2, ery * (rep && style !== 'half' ? 0.75 : 1.05), 0);
        flat(x, lid, rep ? f.main : dark(f.main, 0.08), 0);
        x.restore();
        var ly = style === 'angry' ? null : ey - ery + ery * (rep && style !== 'half' ? 0.75 : 1.05) - 1;
        if (ly != null) line(x, 'M' + (cx - erx) + ' ' + ly + ' Q' + cx + ' ' + (ly + 1.2) + ' ' + (cx + erx) + ' ' + ly, INK, 1.7);
        else line(x, 'M' + (cx - erx) + ' ' + (ey + (s < 0 ? -ery * 0.75 : ery * 0.05)) + ' L' + (cx + erx) + ' ' + (ey + (s < 0 ? ery * 0.05 : -ery * 0.75)), INK, 2.2);
        line(x, e, INK, 1.7);
      }
    });
    brows(x, f, ex, ey - ery - 2.6, false);
  }
  function brows(x, f, ex, by, shades) {
    var b = f.brow;
    [-1, 1].forEach(function (s) {
      var cx = s * ex, d;
      if (b === 'angry') d = 'M' + (cx - s * 5) + ' ' + (by - 2.5) + ' L' + (cx + s * 4) + ' ' + (by + 1.6);
      else if (b === 'worry') d = 'M' + (cx - s * 5) + ' ' + (by + 0.5) + ' L' + (cx + s * 4) + ' ' + (by - 2.2);
      else if (b === 'up') d = 'M' + (cx - 4.5) + ' ' + (by + 0.6) + ' Q' + cx + ' ' + (by - 3.4) + ' ' + (cx + 4.5) + ' ' + (by + 0.6);
      else if (b === 'cocky') d = s < 0 ? 'M' + (cx - 4.5) + ' ' + (by - 1.5) + ' Q' + cx + ' ' + (by - 5) + ' ' + (cx + 4.5) + ' ' + (by - 1) : 'M' + (cx - 4.5) + ' ' + (by + 0.8) + ' L' + (cx + 4.5) + ' ' + (by + 0.2);
      else d = 'M' + (cx - 4.5) + ' ' + by + ' L' + (cx + 4.5) + ' ' + by;
      line(x, d, INK, f.boss ? 3.4 : 2.6);
    });
  }
  function mouth(x, f, sp, my, rx) {
    var t = f.mouth, w = Math.min(9, rx * 0.42);
    if (sp.tooth === 'buck' && (t === 'smile' || t === 'smirk' || t === 'gum')) t = 'buck';
    if (t === 'grin') {
      var g = path('M' + (-w) + ' ' + my + ' Q0 ' + (my + 2) + ' ' + w + ' ' + my + ' Q' + (w * 0.8) + ' ' + (my + 9) + ' 0 ' + (my + 9) + ' Q' + (-w * 0.8) + ' ' + (my + 9) + ' ' + (-w) + ' ' + my + ' Z');
      flat(x, g, '#5A1A2E', 0);
      x.save(); x.clip(g);
      flat(x, ell(0, my + 9.5, w * 0.62, 4), '#E8607A', 0);
      flat(x, rr(-w, my - 1, w * 2, 3.6, 0.5), WHITE, 0);
      if (f.acc && f.acc.gap) flat(x, rr(1.2, my - 1, 2.6, 3.8, 0.4), '#5A1A2E', 0);
      if (sp.tooth === 'buck') { flat(x, rr(-3, my - 1, 6, 5.5, 1), WHITE, 0); line(x, 'M0 ' + my + ' L0 ' + (my + 4.4), INK, 0.8); }
      x.restore();
      line(x, g, INK, 1.8);
      line(x, 'M' + (-w - 1.6) + ' ' + (my - 1.2) + ' Q' + (-w - 0.5) + ' ' + (my + 0.4) + ' ' + (-w + 0.2) + ' ' + (my + 0.3) + ' M' + (w + 1.6) + ' ' + (my - 1.2) + ' Q' + (w + 0.5) + ' ' + (my + 0.4) + ' ' + (w - 0.2) + ' ' + (my + 0.3), INK, 1.4);
    } else if (t === 'grit') {
      var gp = rr(-w, my - 1.5, w * 2, 6.5, 2.2);
      flat(x, gp, WHITE, 0);
      line(x, 'M' + (-w) + ' ' + (my + 1.8) + ' L' + w + ' ' + (my + 1.8) + ' M-3 ' + (my - 1.5) + ' L-3 ' + (my + 5) + ' M2 ' + (my - 1.5) + ' L2 ' + (my + 5) + ' M' + (-w + 1.5) + ' ' + (my - 1.5) + ' L' + (-w + 1.5) + ' ' + (my + 5) + ' M' + (w - 2) + ' ' + (my - 1.5) + ' L' + (w - 2) + ' ' + (my + 5), INK, 0.9);
      line(x, gp, INK, 1.8);
    } else if (t === 'open') {
      cel(x, ell(0, my + 3, 3.4, 4.2), '#5A1A2E', { shade: false, lw: 1.8 });
      flat(x, ell(0, my + 5, 2.2, 1.6), '#E8607A', 0);
    } else if (t === 'smirk') {
      line(x, 'M' + (-w * 0.7) + ' ' + (my + 1.5) + ' Q' + (w * 0.2) + ' ' + (my + 3.5) + ' ' + w + ' ' + (my - 2), INK, 2);
    } else if (t === 'buck') {
      cel(x, rr(-3, my - 0.5, 6, 6, 1.2), WHITE, { shade: false, lw: 1.5 }); line(x, 'M0 ' + (my - 0.5) + ' L0 ' + (my + 5.2), INK, 0.9);
      line(x, 'M' + (-w * 0.9) + ' ' + (my - 0.4) + ' Q0 ' + (my + 2.2) + ' ' + (w * 0.9) + ' ' + (my - 0.4), INK, 1.9);
    } else if (t === 'gum') {
      line(x, 'M' + (-w * 0.6) + ' ' + (my + 0.5) + ' Q0 ' + (my + 3) + ' ' + (w * 0.6) + ' ' + (my + 0.5), INK, 1.8);
    } else { // smile / tongue
      var sm = path('M' + (-w) + ' ' + (my - 0.5) + ' Q0 ' + (my + 7) + ' ' + w + ' ' + (my - 0.5));
      if (t === 'tongue') { cel(x, path('M1 ' + (my + 2.8) + ' Q1 ' + (my + 9) + ' 4.5 ' + (my + 9) + ' Q8 ' + (my + 9) + ' 7 ' + (my + 1.5) + ' Z'), '#E8607A', { sh: 0.8, lw: 1.6 }); line(x, 'M4.3 ' + (my + 4) + ' L4.6 ' + (my + 7), dark('#E8607A', 0.3), 0.8); }
      line(x, sm, INK, 2);
      line(x, 'M' + (-w - 1.4) + ' ' + (my - 2) + ' Q' + (-w - 0.4) + ' ' + (my - 0.2) + ' ' + (-w + 0.6) + ' ' + (my - 0.6) + ' M' + (w + 1.4) + ' ' + (my - 2) + ' Q' + (w + 0.4) + ' ' + (my - 0.2) + ' ' + (w - 0.6) + ' ' + (my - 0.6), INK, 1.4);
    }
    if (sp.tooth === 'under' && t !== 'grit') {
      cel(x, poly([-w + 1, my + 2, -w + 2.5, my - 2.5, -w + 4, my + 2]), WHITE, { shade: false, lw: 1.2 });
      cel(x, poly([w - 4, my + 2, w - 2.5, my - 2.5, w - 1, my + 2]), WHITE, { shade: false, lw: 1.2 });
    }
  }
  function beak(x, f, sp, ry) {
    var b = sp.beak, c = sp.beakCol || f.ac || PAL.mustard;
    var open = f.mouth === 'grin' || f.mouth === 'open' || f.mouth === 'tongue';
    var by = 2.5;
    if (b === 'cone' || b === 'small' || b === 'knob') {
      var s = b === 'small' ? 0.75 : 1;
      if (open) cel(x, poly([-4.5 * s, by + 5, 4.5 * s, by + 5, 0.5, by + 12 * s]), dark(c, 0.15), { sh: 0.8, lw: 1.7 });
      if (open) flat(x, poly([-3 * s, by + 5, 3 * s, by + 5, 0.4, by + 9 * s]), '#5A1A2E', 0);
      cel(x, poly([-6 * s, by + 0.5, 6 * s, by + 0.5, 1, by + (open ? 7 : 11) * s]), c, { sh: 1, lw: 1.8 });
      if (b === 'knob') cel(x, ell(0, by - 0.5, 3, 2.2), INK, { shade: false, lw: 1 });
    } else if (b === 'long') {
      cel(x, path('M-4 ' + (by + 1) + ' Q2 ' + (by - 1) + ' 5 ' + by + ' L24 ' + (by + 9) + ' Q10 ' + (by + 8) + ' -3 ' + (by + 6) + ' Z'), c, { sh: 1, lw: 1.8 });
      line(x, 'M-1 ' + (by + 4.4) + ' L21 ' + (by + 8.6), INK, 1.2);
      if (open) cel(x, path('M-2 ' + (by + 6) + ' L19 ' + (by + 11) + ' Q8 ' + (by + 13) + ' -2 ' + (by + 9) + ' Z'), dark(c, 0.1), { sh: 0.6, lw: 1.6 });
      if (sp.beakDot) flat(x, circ(18, by + 8.6, 1.6), PAL.brick, 0);
    } else if (b === 'hook' || b === 'hookbig') {
      var k = b === 'hookbig' ? 1.5 : 1;
      cel(x, path('M' + (-4 * k) + ' ' + by + ' Q0 ' + (by - 2 * k) + ' ' + (4 * k) + ' ' + by + ' Q' + (4 * k) + ' ' + (by + 8 * k) + ' ' + (0.5 * k) + ' ' + (by + 10 * k) + ' Q' + (-0.5 * k) + ' ' + (by + 7 * k) + ' ' + (-2 * k) + ' ' + (by + 6 * k) + ' Q' + (-4 * k) + ' ' + (by + 4 * k) + ' ' + (-4 * k) + ' ' + by + ' Z'), c, { sh: 1, lw: 1.8 });
      if (b === 'hookbig') flat(x, path('M-5 ' + (by + 6) + ' Q0 ' + (by + 9) + ' 3 ' + (by + 7) + ' Q0 ' + (by + 12) + ' -5 ' + (by + 6) + ' Z'), INK, 0);
    } else if (b === 'pouch') {
      cel(x, path('M-3 ' + (by + 8) + ' Q-7 ' + (by + 26) + ' 2 ' + (by + 30) + ' Q9 ' + (by + 26) + ' 5 ' + (by + 10) + ' Z'), light(c, 0.35), { sh: 1.6, lw: 1.8 });
      cel(x, path('M-4 ' + by + ' Q0 ' + (by - 2) + ' 4 ' + by + ' L3 ' + (by + 25) + ' Q1 ' + (by + 28) + ' -1 ' + (by + 25) + ' Z'), c, { sh: 1, lw: 1.8 });
    } else if (b === 'bent') {
      cel(x, path('M-5 ' + by + ' Q0 ' + (by - 2) + ' 5 ' + by + ' Q6 ' + (by + 8) + ' 3 ' + (by + 14) + ' Q1 ' + (by + 18) + ' -2 ' + (by + 16) + ' Q1 ' + (by + 10) + ' -5 ' + by + ' Z'), '#FFF4E8', { sh: 1, lw: 1.8 });
      x.save(); x.clip(path('M-6 ' + (by + 9) + ' L8 ' + (by + 9) + ' L8 ' + (by + 20) + ' L-6 ' + (by + 20) + ' Z'));
      flat(x, path('M-5 ' + by + ' Q0 ' + (by - 2) + ' 5 ' + by + ' Q6 ' + (by + 8) + ' 3 ' + (by + 14) + ' Q1 ' + (by + 18) + ' -2 ' + (by + 16) + ' Q1 ' + (by + 10) + ' -5 ' + by + ' Z'), INK, 0);
      x.restore();
    } else if (b === 'big') {
      var bp = path('M-6 ' + (by - 1) + ' Q0 ' + (by - 4) + ' 6 ' + (by - 1) + ' Q9 ' + (by + 8) + ' 1 ' + (by + 13) + ' Q-6 ' + (by + 8) + ' -6 ' + (by - 1) + ' Z');
      cel(x, bp, c, { sh: 1.2, lw: 1.8 });
      x.save(); x.clip(bp); flat(x, rr(-8, by - 4, 16, 4, 0), '#4A4E5E', 0); line(x, 'M-6 ' + (by + 5) + ' Q0 ' + (by + 3) + ' 7 ' + (by + 5), '#F2B632', 1.4); x.restore();
      line(x, bp, INK, 1.8);
    }
  }

  // ================================================================== BUST (card / portrait). 100 x 140 units, head at (50, 52)
  function bust(x, f, o) {
    // o: { team (jersey colour), trim, num, pos, letter, capC }
    var sp = f.sp, team = o.team, trim = o.trim || CREAM, cx = 50, hs = f.scale || 1;
    var stout = o.build === 'stout' ? 1.12 : o.build === 'lanky' ? 0.9 : 1;
    var hitter = o.pos && o.pos !== 'P' && o.pos !== 'C';
    // tail / shell behind everything
    if (sp.tail) { cel(x, path('M66 126 C100 122 104 80 94 52 C90 36 76 30 70 42 C66 50 76 54 80 50 C86 64 84 90 64 108 Z'), f.main, { sh: 3 }); line(x, 'M78 60 Q86 80 74 104', dark(f.main, 0.3), 1.4); }
    if (sp.shell) { cel(x, ell(50, 112, 46, 32), '#A86E3A', { sh: 3 }); line(x, 'M14 104 Q50 86 86 104 M30 92 L36 112 M70 92 L64 112 M50 86 L50 108', dark('#A86E3A', 0.4), 1.6); }
    // bat over the shoulder (behind the head)
    if (hitter) {
      x.save(); x.translate(36, 112); x.rotate(-2.15);
      batShape(x, 0, 0, 92, 1.18, '#D9A066', null);
      x.restore();
    }
    // jersey
    var sw = 34 * stout, j = new Path2D();
    j.moveTo(cx - sw - 6, 141); j.lineTo(cx - sw - 4, 104); j.quadraticCurveTo(cx - sw + 2, 84, cx - 13, 80);
    j.lineTo(cx + 13, 80); j.quadraticCurveTo(cx + sw - 2, 84, cx + sw + 4, 104); j.lineTo(cx + sw + 6, 141); j.closePath();
    cel(x, j, team, { sh: 4 });
    x.save(); x.clip(j);
    line(x, 'M' + (cx - sw + 6) + ' 141 Q' + (cx - sw + 4) + ' 110 ' + (cx - sw + 10) + ' 92', trim, 2.2);
    line(x, 'M' + (cx + sw - 6) + ' 141 Q' + (cx + sw - 4) + ' 110 ' + (cx + sw - 10) + ' 92', trim, 2.2);
    line(x, 'M' + (cx + 2) + ' 92 L' + (cx + 2) + ' 141', dark(team, 0.3), 1.2);
    [100, 112, 124, 136].forEach(function (yy) { flat(x, circ(cx + 4.5, yy, 1.1), trim, 0); });
    x.restore();
    line(x, j, INK, LW);
    // collar
    cel(x, path('M' + (cx - 13) + ' 80 Q' + cx + ' 96 ' + (cx + 13) + ' 80 L' + (cx + 9) + ' 79 Q' + cx + ' 90 ' + (cx - 9) + ' 79 Z'), trim, { sh: 0.6, lw: 1.6 });
    if (o.num != null) inkText(x, String(o.num), cx + 20 * stout, o.pos === 'P' ? 106 : 118, o.pos === 'P' ? 12 : 15, trim, { lw: 3 });
    if (o.letter) inkText(x, o.letter, cx - 18 * stout, 108, 11, trim, { lw: 2.6 });
    // glove hand / mitt
    if (hitter) glove(x, 31, 100, 1, -0.4);
    else if (o.pos === 'P') {
      mitt(x, cx - 22, 116, 1.0, 0.2);
      cel(x, circ(cx + 25, 122, 6), WHITE, { sh: 1, lw: 1.7 });
      line(x, 'M' + (cx + 21.5) + ' 118 Q' + (cx + 24) + ' 122 ' + (cx + 21.5) + ' 126 M' + (cx + 28.5) + ' 118 Q' + (cx + 26) + ' 122 ' + (cx + 28.5) + ' 126', PAL.brick, 1.1);
      glove(x, cx + 27, 130, 0.9, 0.3);
    } else mitt(x, cx + 26, 112, 1.05, -0.3);
    // head
    hs *= 1.1;
    x.save(); x.translate(cx, 54 + (1 - hs) * 8); x.scale(hs, hs);
    head(x, f, { cap: o.capC || team, letter: o.capLetter, letterCol: trim });
    x.restore();
  }
  function glove(x, gx, gy, s, rot) {
    x.save(); x.translate(gx, gy); x.rotate(rot || 0); x.scale(s, s);
    var p = new Path2D();
    p.moveTo(-6, 4); p.quadraticCurveTo(-8, -4, -4, -6);
    [-3, 0.5, 4].forEach(function (fx) { p.quadraticCurveTo(fx - 1, -10, fx + 1.4, -7); });
    p.quadraticCurveTo(8, -4, 7, 1); p.quadraticCurveTo(10, 3, 7, 6); p.quadraticCurveTo(0, 9, -6, 4); p.closePath();
    cel(x, p, WHITE, { sh: 1.2, lw: 1.8, dark: '#D9CDBE' });
    line(x, 'M-2 -5 L-1.8 -1 M1.6 -6 L1.8 -1.5', INK, 0.9);
    x.restore();
  }
  function mitt(x, gx, gy, s, rot) {
    x.save(); x.translate(gx, gy); x.rotate(rot || 0); x.scale(s, s);
    var p = path('M-10 6 Q-14 -6 -8 -12 Q-4 -16 0 -13 Q4 -17 8 -12 Q14 -6 11 4 Q6 12 -2 12 Q-8 12 -10 6 Z');
    cel(x, p, PAL.mitt, { sh: 1.6, lw: 1.9 });
    flat(x, ell(0, 1, 6, 6), dark(PAL.mitt, 0.25), 0);
    line(x, 'M-6 -10 L-5 -6 M0 -12 L0 -8 M6 -10 L5 -6', '#F2DDB8', 1);
    x.restore();
  }
  // bat body along +x from (x0,y0), length L, thickness scale k
  function batShape(x, x0, y0, L, k, wood, tape) {
    var t = (k || 1);
    var p = new Path2D();
    p.moveTo(x0 + 2, y0 - 1.6 * t); p.lineTo(x0 + L * 0.42, y0 - 2.1 * t);
    p.quadraticCurveTo(x0 + L * 0.7, y0 - 5.4 * t, x0 + L - 5 * t, y0 - 5.2 * t);
    p.quadraticCurveTo(x0 + L, y0 - 5 * t, x0 + L, y0); p.quadraticCurveTo(x0 + L, y0 + 5 * t, x0 + L - 5 * t, y0 + 5.2 * t);
    p.quadraticCurveTo(x0 + L * 0.7, y0 + 5.4 * t, x0 + L * 0.42, y0 + 2.1 * t); p.lineTo(x0 + 2, y0 + 1.6 * t); p.closePath();
    cel(x, p, wood, { sh: -1.2 * t, shy: -1.3, lw: 1.9 * Math.min(1.3, t) });
    line(x, 'M' + (x0 + L * 0.5) + ' ' + (y0 - 2.6 * t) + ' Q' + (x0 + L * 0.75) + ' ' + (y0 - 4 * t) + ' ' + (x0 + L * 0.93) + ' ' + (y0 - 3.4 * t), 'rgba(255,248,232,.75)', 1.2 * t);
    if (tape) { x.fillStyle = tape; x.fillRect(x0 + 3, y0 - 1.8 * t, L * 0.22, 3.6 * t); }
    cel(x, ell(x0 + 1.5, y0, 2.2 * t, 3.4 * t), dark(wood, 0.15), { shade: false, lw: 1.6 });
    return p;
  }

  // ================================================================== TRADING CARD
  var MISFUR = [['#7BC47F', '#D8F0C8'], ['#7FA8E0', '#D8E6F8'], ['#C88AE0', '#F0DCF8'], ['#F07AB0', '#FCD8E8']];
  function cardSpecies(card) {
    if (card.species && SPECIES[card.species]) return card.species;
    var list = TEAM_SPECIES[(card.teamIdx || 0) % TEAM_SPECIES.length];
    return list[U.hashStr('sp-' + (card.id || card.name || 'x')) % list.length];
  }
  function draw(canvas, card, opts) {
    opts = opts || {};
    if (!canvas || !card) return;
    var w = canvas.width, h = canvas.height;
    var rarity = opts.misprint ? 'misprint' : card.rarity || 'common';
    var seed = card.seed != null ? card.seed : U.hashStr(card.id || card.name || 'card');
    var sc = scheme(card.inkset || 'classic');
    var key = 'card|' + card.id + '|' + w + 'x' + h + '|' + rarity + '|' + sc.a + sc.b + sc.c + '|' + fontsReady();
    if (!blit(canvas, key)) { printCard(canvas, card, rarity, seed, sc); remember(key, canvas); }
    if (rarity === 'foil') sheen(canvas, seed, opts.time == null ? 0.9 : opts.time);
    else if (rarity === 'rare' && opts.time != null) twinkle(canvas, seed, opts.time, 3);
  }
  function cardBox(w, h) { var u = Math.min(w / 100, h / 140); return { u: u, ox: (w - 100 * u) / 2, oy: (h - 140 * u) / 2 }; }
  function printCard(canvas, card, rarity, seed, sc) {
    var w = canvas.width, h = canvas.height, B = cardBox(w, h), x = begin(canvas);
    var r = U.rng(seed ^ 0x51ed27), mis = rarity === 'misprint';
    var gags = { ghost: false, flip: false, wrong: false };
    if (mis) { var g = ['ghost', 'flip', 'wrong'], drop = Math.floor(r() * 3); g.splice(drop, 1); g.forEach(function (k) { gags[k] = true; }); }
    var slot = card.teamColorSlot || 'a';
    if (gags.wrong) slot = slot === 'a' ? 'b' : slot === 'b' ? 'c' : 'a';
    var TC = sc[slot], TC2 = sc[slot === 'a' ? 'b' : 'a'];
    if (lum(TC) > 0.82) TC = dark(TC, 0.2);
    var spId = cardSpecies(card);
    var f = face(spId, seed, { misfur: gags.wrong ? MISFUR[seed % MISFUR.length] : null });
    var big = h >= 150;
    x.save(); x.translate(B.ox, B.oy); x.scale(B.u, B.u);
    // frame
    var frame = rr(1.2, 1.2, 97.6, 137.6, 7);
    if (rarity === 'foil') {
      var gr = x.createLinearGradient(0, 0, 100, 140);
      gr.addColorStop(0, '#FBE7A0'); gr.addColorStop(0.35, '#E0A93A'); gr.addColorStop(0.55, '#FFF0B8'); gr.addColorStop(0.8, '#C98A2A'); gr.addColorStop(1, '#F6D57A');
      x.fillStyle = gr; x.fill(frame);
    } else { x.fillStyle = TC; x.fill(frame); }
    // little polka dots on the frame (bubble-gum card print)
    x.save(); x.clip(frame); x.fillStyle = 'rgba(255,244,220,.18)';
    for (var yy = 4; yy < 140; yy += 6) for (var xx = (yy / 6) % 2 ? 4 : 7; xx < 100; xx += 6) { x.beginPath(); x.arc(xx, yy, 0.9, 0, TAU); x.fill(); }
    x.restore();
    line(x, frame, INK, 2.4);
    // window
    var win = rr(7, 7, 86, 88, 5);
    x.save(); x.clip(win);
    windowBg(x, rarity, seed, TC, TC2, sc, f);
    bust(x, f, { team: TC, trim: CREAM, num: card.number, pos: card.pos, letter: null, capC: TC, capLetter: (card.teamShort || card.team || 'X').charAt(0) });
    x.restore();
    line(x, win, INK, 2.2);
    // position badge
    var pb = circ(16, 16, 8.6);
    cel(x, pb, rarity === 'foil' ? '#FFF0B8' : sc.c === TC ? CREAM : sc.c, { sh: 1.2, lw: 2 });
    var pos = String(card.pos || '');
    var pfs = fit(x, pos, 11.5, 8, fD);
    inkText(x, pos, 16, 16 + pfs * 0.36, pfs, INK, { lw: 0 });
    // number star
    var ns = starPath(84, 16, 11, 7.6, 10, -PI / 2);
    cel(x, ns, CREAM, { sh: 1.2, lw: 1.9 });
    var num = String(card.number != null ? card.number : '');
    var nfs = fit(x, num, 10, 8.5, fD);
    inkText(x, num, 84, 16 + nfs * 0.38, nfs, mis && gags.wrong ? PAL.brick : INK, { lw: 0 });
    // name banner
    x.save(); x.translate(50, 101.5);
    if (gags.flip) x.rotate(PI); else x.rotate(-0.03);
    var tail = dark(rarity === 'foil' ? '#C98A2A' : TC, 0.35);
    flat(x, poly([-50, -2, -42, -2, -42, 8, -50, 8, -46, 3]), tail, 1.6);
    flat(x, poly([50, -2, 42, -2, 42, 8, 50, 8, 46, 3]), tail, 1.6);
    var rib = rr(-44, -7, 88, 14, 3);
    cel(x, rib, CREAM, { sh: 1, lw: 2 });
    var name = String(card.name || '').toUpperCase();
    var nf = fit(x, name, 80, 9, fD);
    inkText(x, name, 0, nf * 0.36, nf, INK, { lw: 0 });
    x.restore();
    // info panel
    var team = String(card.team || ''), nick = card.nick ? '"' + card.nick + '"' : '';
    if (big) {
      var l1 = nick ? nick + ' · ' + (SPECIES[spId].name) : team + ' · ' + SPECIES[spId].name;
      var t1 = fit(x, l1, 84, 5.4, function (p) { return fB(p, 700); });
      inkText(x, l1, 50, 118.5, t1, CREAM, { font: function (p) { return fB(p, 700); }, lw: 1.6 });
      var st = String(card.stat || '');
      cel(x, rr(9, 122.5, 82, 10, 3), CREAM, { shade: false, lw: 1.5 });
      var t2 = fit(x, st, 76, 5, function (p) { return fB(p, 600); });
      x.font = fB(t2, 600); x.fillStyle = INK; x.textAlign = 'center'; x.fillText(st, 50, 129.4);
    } else {
      var l2 = team || SPECIES[spId].name;
      var t3 = fit(x, l2.toUpperCase(), 82, 8, fD);
      inkText(x, l2.toUpperCase(), 50, 124, t3, CREAM, { lw: 1.8 });
    }
    // rarity marks
    if (rarity === 'rare') [[8, 133.5], [92, 133.5]].forEach(function (q) { cel(x, starPath(q[0], q[1], 4.4, 2, 5), PAL.mustard, { sh: 0.6, lw: 1.3 }); });
    if (rarity === 'foil') { cel(x, rr(70, 131, 25, 7.6, 3.8), INK, { shade: false, lw: 0 }); inkText(x, 'FOIL', 82.5, 137, 6, '#FBE7A0', { lw: 0 }); }
    if (card.no != null && big) { x.font = fB(4.2, 700); x.textAlign = 'left'; x.fillStyle = alpha(CREAM, 0.9); x.fillText('No.' + (card.no < 10 ? '0' : '') + card.no, 8, 137.6); }
    // misprint gags
    if (mis) {
      var sr = U.rng(seed + 99), sx = 20 + sr() * 60, sy = 22 + sr() * 50;
      splat(x, sx, sy, 8 + sr() * 4, sr, sr() < 0.5 ? INK : '#3A6AC8');
      x.save(); x.translate(56, 78); x.rotate(-0.24);
      var st2 = rr(-30, -9, 60, 15, 3);
      x.fillStyle = 'rgba(255,244,220,.82)'; x.fill(st2);
      line(x, st2, PAL.brick, 2); line(x, rr(-28, -7, 56, 11, 2), PAL.brick, 0.8);
      inkText(x, 'MISPRINT', 0, 3.4, 10, PAL.brick, { lw: 0 });
      x.restore();
    }
    x.restore();
    // ghost double-print: the whole card again, off register
    if (gags.ghost) {
      var tmp = mk(w, h); tmp.getContext('2d').drawImage(canvas, 0, 0);
      x.save(); roundClip(x, B); x.globalAlpha = 0.33; x.globalCompositeOperation = 'multiply';
      x.drawImage(tmp, Math.round(3.4 * B.u), Math.round(-2.4 * B.u));
      x.restore();
    }
  }
  function roundClip(x, B) { x.beginPath(); x.save(); x.translate(B.ox, B.oy); x.scale(B.u, B.u); var p = rr(1.2, 1.2, 97.6, 137.6, 7); x.restore(); x.setTransform(1, 0, 0, 1, 0, 0); x.clip(transformPath(p, B)); }
  function transformPath(p, B) { var q = new Path2D(); q.addPath(p, typeof DOMMatrix !== 'undefined' ? new DOMMatrix([B.u, 0, 0, B.u, B.ox, B.oy]) : undefined); return q; }
  function splat(x, cx, cy, r, rng, col) {
    flat(x, blobPath(cx, cy, r, rng, 11, 0.7), col, 0);
    for (var i = 0; i < 6; i++) { var a = rng() * TAU, d = r * (1.3 + rng() * 0.9); flat(x, circ(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0.8 + rng() * 1.8), col, 0); }
    x.fillStyle = col; x.fillRect(cx - 1.5 + rng() * 3, cy, 2.2, r + 6 + rng() * 6); flat(x, circ(cx + 0.6, cy + r + 8, 2), col, 0);
  }
  function windowBg(x, rarity, seed, TC, TC2, sc, f) {
    var r = U.rng(seed ^ 0x77), v = Math.floor(r() * 4);
    if (rarity === 'rare' || rarity === 'foil') {
      var c1 = rarity === 'foil' ? '#FFE9A8' : light(sc.c, 0.15), c2 = rarity === 'foil' ? '#FFF6D6' : light(sc.c, 0.55);
      sunburst(x, 50, 50, 110, 22, c1, c2, r() * PI);
      if (rarity === 'foil') { x.globalAlpha = 0.25; sunburst(x, 50, 50, 110, 22, light(TC2, 0.3), 'rgba(0,0,0,0)', 0.07); x.globalAlpha = 1; }
      return;
    }
    var sky = v === 0 ? PAL.teal : v === 1 ? light(TC2, 0.62) : v === 2 ? PAL.sunset : light(sc.c, 0.45);
    x.fillStyle = sky; x.fillRect(0, 0, 100, 100);
    if (v === 0 || v === 2) {
      x.fillStyle = 'rgba(255,253,246,.85)';
      [[22, 26, 1], [76, 18, 0.8]].forEach(function (c) { var cx = c[0] + (r() - 0.5) * 10, cy = c[1], s = c[2]; x.beginPath(); x.ellipse(cx, cy, 10 * s, 4 * s, 0, 0, TAU); x.ellipse(cx - 5 * s, cy - 2.5 * s, 5 * s, 4 * s, 0, 0, TAU); x.ellipse(cx + 4 * s, cy - 3.5 * s, 5.5 * s, 4.5 * s, 0, 0, TAU); x.fill(); });
      x.fillStyle = PAL.grassD; x.fillRect(0, 74, 100, 30);
      x.fillStyle = mix(PAL.grassD, '#FFF4DC', 0.25); x.fillRect(0, 74, 100, 2);
    } else if (v === 1) {
      x.fillStyle = alpha(WHITE, 0.55);
      for (var yy = 6; yy < 100; yy += 9) for (var xx = (yy / 9) % 2 ? 6 : 10.5; xx < 100; xx += 9) { x.beginPath(); x.arc(xx, yy, 2.2, 0, TAU); x.fill(); }
    } else {
      x.fillStyle = alpha(WHITE, 0.4);
      for (var k = -100; k < 120; k += 14) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k + 7, 0); x.lineTo(k + 107, 100); x.lineTo(k + 100, 100); x.closePath(); x.fill(); }
    }
  }
  function sheen(canvas, seed, time) {
    var x = canvas.getContext('2d'), w = canvas.width, h = canvas.height, B = cardBox(w, h);
    x.save(); roundClip(x, B);
    var u = B.u, span = 260 * u, pos = ((time * 0.35) % 1.6 - 0.3) * span;
    var g = x.createLinearGradient(B.ox + pos - 60 * u, B.oy, B.ox + pos + 30 * u, B.oy + 90 * u);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.35, 'rgba(255,180,220,.20)');
    g.addColorStop(0.5, 'rgba(255,255,240,.55)');
    g.addColorStop(0.65, 'rgba(140,220,255,.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.globalCompositeOperation = 'screen'; x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'source-over';
    x.restore();
    twinkle(canvas, seed, time, 7);
  }
  function twinkle(canvas, seed, time, n) {
    var x = canvas.getContext('2d'), B = cardBox(canvas.width, canvas.height), u = B.u, r = U.rng(seed + 11);
    x.save(); x.setTransform(1, 0, 0, 1, 0, 0);
    for (var k = 0; k < n; k++) {
      var sx = B.ox + (8 + r() * 84) * u, sy = B.oy + (8 + r() * 86) * u, ph = r() * 6, tw = Math.max(0, Math.sin(time * 3.1 + ph));
      if (tw < 0.08) continue;
      var s = (2.2 + 3.6 * tw) * u;
      x.fillStyle = '#FFFDF0'; x.strokeStyle = alpha(INK, 0.55); x.lineWidth = Math.max(1, 0.5 * u);
      x.beginPath(); x.moveTo(sx, sy - s); x.quadraticCurveTo(sx, sy, sx + s, sy); x.quadraticCurveTo(sx, sy, sx, sy + s); x.quadraticCurveTo(sx, sy, sx - s, sy); x.quadraticCurveTo(sx, sy, sx, sy - s); x.closePath();
      x.fill(); x.stroke();
    }
    x.restore();
  }

  // ================================================================== PITCHER portrait
  function drawPitcher(canvas, pitcher, opts) {
    opts = opts || {};
    if (!canvas || !pitcher) return;
    var w = canvas.width, h = canvas.height, sc = scheme(opts.inkset || 'classic');
    var spId = speciesFor(pitcher), boss = !!pitcher.boss, look = pitcher.look || {};
    var key = 'pit|' + (pitcher.id || pitcher.name) + '|' + spId + '|' + (opts.border ? 'b' : '') + '|' + w + 'x' + h + '|' + sc.a + sc.b + '|' + fontsReady();
    if (blit(canvas, key)) return;
    var x = begin(canvas);
    var seed = U.hashStr(pitcher.id || pitcher.name || 'p');
    var f = face(spId, seed);
    f.acc = {}; f.blush = !boss && f.blush;
    f.hair = SPECIES[spId].fam === 'm' && look.hair && look.hair !== 'none' ? look.hair : null;
    if (boss) { f.eyes = 'angry'; f.brow = 'angry'; f.mouth = U.hashStr(spId) % 2 ? 'grit' : 'smirk'; f.scale = 1.14; f.boss = true; f.gx = 0; f.gy = 0.3; f.cap = 'fwd'; f.tilt = -0.06; }
    else if (f.eyes === 'happy' || f.eyes === 'wink' || f.eyes === 'half') f.eyes = 'wide';
    if (f.mouth === 'gum') f.mouth = 'smirk';
    var u = Math.min(w / 100, h / 130);
    x.save(); x.scale(w / 100, h / 130);
    if (boss) {
      sunburst(x, 50, 54, 130, 20, '#C8382E', '#E8603A', 0.1);
      x.fillStyle = 'rgba(43,47,94,.35)'; x.fillRect(0, 0, 100, 130);
    } else sunburst(x, 50, 54, 130, 18, light(sc.a, 0.62), light(sc.a, 0.8), (seed % 7) * 0.2);
    x.restore();
    x.save(); x.translate((w - 100 * u) / 2, (h - 130 * u) / 2 - 4 * u); x.scale(u, u);
    var team = boss ? dark(sc.b, 0.15) : sc.b;
    bust(x, f, { team: team, trim: CREAM, num: look.number, pos: 'P', build: look.build, capC: team, capLetter: String(pitcher.team || 'X').charAt(0) });
    x.restore();
    if (boss) {
      x.save(); x.translate(w / 2, h - 13 * u); x.rotate(-0.05);
      cel(x, rr(-26 * u, -9 * u, 52 * u, 16 * u, 4 * u), PAL.mustard, { sh: 1.2 * u, lw: 2.2 * u });
      inkText(x, 'BOSS', 0, 4.4 * u, 12.5 * u, PAL.brick, { lw: 2.6 * u });
      x.restore();
    }
    if (opts.border) { x.lineWidth = Math.max(2, 2.4 * u); x.strokeStyle = INK; x.strokeRect(x.lineWidth / 2, x.lineWidth / 2, w - x.lineWidth, h - x.lineWidth); }
    remember(key, canvas);
  }

  // ================================================================== BAT
  var WOOD = { light: '#EAC88E', mid: '#C98E52', dark: '#8A5634', ink: '#3E3448', gold: '#F2C14A' };
  function drawBat(canvas, bat, opts) {
    if (!canvas || !bat) return;
    var w = canvas.width, h = canvas.height, sc = scheme((opts && opts.inkset) || 'classic');
    var key = 'bat|' + bat.id + '|' + w + 'x' + h + '|' + sc.a + sc.b + sc.c;
    if (blit(canvas, key)) return;
    var x = begin(canvas), lk = bat.look || {}, wood = WOOD[lk.wood] || WOOD.mid, i;
    var tape = lk.tape ? sc[lk.tape] : sc.a;
    var L = w * 0.9, s = Math.min(h / 19, L / 100);
    var cx = w / 2, cy = h / 2;
    x.save(); x.translate(cx, cy); x.rotate(-0.025); x.scale(s, s);
    var len = L / s;
    // speed lines behind
    line(x, 'M' + (-len * 0.45) + ' -7 L' + (-len * 0.3) + ' -7 M' + (-len * 0.48) + ' 7 L' + (-len * 0.36) + ' 7', alpha(INK, 0.35), 1.2);
    x.save(); x.translate(3, 3); x.fillStyle = alpha(INK, 0.18); x.fill(batPath(-len / 2, 0, len, 1.25)); x.restore();
    var bp = batPath(-len / 2, 0, len, 1.25);
    cel(x, bp, wood, { sh: -1.6, shy: -1.4, lw: 2.2 });
    x.save(); x.clip(bp);
    var mkr = lk.mark || 'none', x0 = -len / 2;
    if (mkr === 'stripes' || mkr === 'plaid') for (i = 0; i < 9; i++) { var bx = x0 + len * 0.42 + i * len * 0.06; x.fillStyle = mkr === 'plaid' ? alpha(sc.b, 0.75) : sc.b; x.beginPath(); x.moveTo(bx, -8); x.lineTo(bx + 3, -8); x.lineTo(bx - 1, 8); x.lineTo(bx - 4, 8); x.closePath(); x.fill(); }
    if (mkr === 'plaid') { x.fillStyle = alpha(sc.a, 0.6); x.fillRect(x0 + len * 0.4, -1.2, len * 0.6, 2.4); }
    if (mkr === 'thin') line(x, 'M' + (x0 + len * 0.5) + ' 0 L' + (x0 + len * 0.9) + ' 0', alpha(INK, 0.4), 0.8);
    if (mkr === 'dots') for (i = 0; i < 9; i++) flat(x, circ(x0 + len * 0.5 + i * len * 0.05, i % 2 ? -2.2 : 2.2, 1.5), sc.c, 0);
    if (mkr === 'star') { cel(x, starPath(x0 + len * 0.86, 0, 5, 2.2, 5), CREAM, { shade: false, lw: 1.2 }); }
    if (mkr === 'moon') { flat(x, circ(x0 + len * 0.87, 0, 4), CREAM, 1.2); flat(x, circ(x0 + len * 0.87 + 1.8, -1, 3.4), wood, 0); }
    if (mkr === 'cork') { flat(x, ell(x0 + len - 1.5, 0, 2.6, 3.6), '#D9B07A', 1); for (i = 0; i < 5; i++) flat(x, circ(x0 + len - 2 + (i % 2), -1.6 + i * 0.8, 0.35), INK, 0); }
    if (mkr === 'smudge') splat(x, x0 + len * 0.84, 0, 4.5, U.rng(9), alpha(INK, 0.75));
    x.restore();
    line(x, bp, INK, 2.2);
    // grip tape + knob
    x.save(); x.clip(bp);
    x.fillStyle = tape; x.fillRect(x0 + 2, -4, len * 0.24, 8);
    for (i = 0; i < 7; i++) line(x, 'M' + (x0 + 4 + i * len * 0.032) + ' -3 L' + (x0 + 6 + i * len * 0.032) + ' 3', alpha(CREAM, 0.65), 0.8);
    x.restore();
    line(x, bp, INK, 2.2);
    cel(x, ell(x0 + 1, 0, 2.4, 4), dark(tape, 0.2), { shade: false, lw: 1.8 });
    // brand label
    var nm = String(bat.name || '').toUpperCase();
    x.font = fD(4.6); x.textAlign = 'center'; x.fillStyle = alpha(INK, 0.6); x.fillText(nm.slice(0, 16), x0 + len * 0.6, 1.7);
    x.restore();
    remember(key, canvas);
  }
  function batPath(x0, y0, L, t) {
    var p = new Path2D();
    p.moveTo(x0 + 2, y0 - 2.2 * t); p.lineTo(x0 + L * 0.4, y0 - 2.6 * t);
    p.quadraticCurveTo(x0 + L * 0.7, y0 - 6 * t, x0 + L - 5 * t, y0 - 5.8 * t);
    p.quadraticCurveTo(x0 + L, y0 - 5.6 * t, x0 + L, y0); p.quadraticCurveTo(x0 + L, y0 + 5.6 * t, x0 + L - 5 * t, y0 + 5.8 * t);
    p.quadraticCurveTo(x0 + L * 0.7, y0 + 6 * t, x0 + L * 0.4, y0 + 2.6 * t); p.lineTo(x0 + 2, y0 + 2.2 * t); p.closePath();
    return p;
  }

  // ================================================================== UNIFORM (ink set) swatch: a little jersey + cap
  function drawInkset(canvas, inkset) {
    if (!canvas) return;
    var w = canvas.width, h = canvas.height, sc = scheme(inkset);
    var key = 'ink|' + sc.id + '|' + sc.a + sc.b + sc.c + '|' + w + 'x' + h + '|' + fontsReady();
    if (blit(canvas, key)) return;
    var x = begin(canvas);
    var s = Math.min(w / 160, h / 100);
    x.save(); x.translate(w / 2, h / 2); x.scale(s, s);
    sunburst(x, -12, 4, 120, 16, light(sc.c, 0.55), light(sc.c, 0.78), 0.2);
    // jersey
    x.save(); x.translate(-18, 4);
    var j = path('M-24 -30 L-8 -38 Q0 -32 8 -38 L24 -30 L40 -14 L30 -4 L22 -12 L22 38 L-22 38 L-22 -12 L-30 -4 L-40 -14 Z');
    cel(x, j, sc.a, { sh: 3, lw: 2.6 });
    x.save(); x.clip(j);
    line(x, 'M-36 -18 L-26 -8 M36 -18 L26 -8', sc.b, 4);
    line(x, 'M0 -34 L0 40', dark(sc.a, 0.3), 1.4);
    [-22, -10, 2, 14, 26].forEach(function (yy) { flat(x, circ(3.5, yy, 1.4), CREAM, 0); });
    x.restore();
    line(x, j, INK, 2.6);
    line(x, 'M-8 -38 Q0 -24 8 -38', sc.b, 3);
    inkText(x, '7', 12, 14, 22, sc.c, { lw: 3.6 });
    x.restore();
    // cap
    x.save(); x.translate(44, 2);
    var crown = path('M-17 4 C-18 -24 18 -24 17 4 Q0 7 -17 4 Z');
    cel(x, crown, sc.b, { sh: 2.4, lw: 2.4 });
    cel(x, path('M-17 3 Q2 0 22 4 Q26 10 18 12 Q0 14 -15 10 Q-19 7 -17 3 Z'), dark(sc.b, 0.15), { sh: -1.2, shy: -1, lw: 2.4 });
    cel(x, ell(0, -15.5, 2.6, 1.6), sc.c, { shade: false, lw: 1.4 });
    inkText(x, 'S', 0, -1, 12, sc.c, { lw: 2.4 });
    x.restore();
    x.restore();
    remember(key, canvas);
  }

  // ================================================================== PARK postcard
  var PARK_LOOK = {
    barns: { sky: ['#FFD98A', '#FFC56B', '#FFB36B'], sun: '#FFF1B8', far: '#E8A35A', grass: '#7DBF4E' },
    city: { sky: ['#7A6AA8', '#C88AA8', '#FFB38A'], sun: '#FFE0A0', far: '#B8524A', grass: '#5FAE4A' },
    pines: { sky: ['#9AD8E0', '#BFE6D8', '#E8F2D0'], sun: '#FFF6C8', far: '#3E7A52', grass: '#6DBB4A' },
    harbor: { sky: ['#7FD1D9', '#A8E0D8', '#E0F2E0'], sun: '#FFF6D0', far: '#2A8A96', grass: '#6DBB4A' },
    desert: { sky: ['#3A3A78', '#9A5A9A', '#F29E8E'], sun: '#FFF0C8', far: '#C8706A', grass: '#5E9E4A' },
    none: { sky: ['#4A3A78', '#B86A8A', '#F2B66A'], sun: '#FFE8A8', far: '#8A5A6A', grass: '#5FA84A' },
  };
  function drawPark(canvas, park, opts) {
    if (!canvas || !park) return;
    var w = canvas.width, h = canvas.height;
    var key = 'park|' + park.id + '|' + w + 'x' + h + '|' + fontsReady();
    if (blit(canvas, key)) return;
    var x = begin(canvas), ft = park.features || {}, sk = ft.skyline || 'none', L = PARK_LOOK[sk] || PARK_LOOK.none;
    var r = U.rng(U.hashStr(park.id || 'park')), i;
    var s = h / 100, W = w / s;      // work in units: 100 tall
    x.save(); x.scale(s, s);
    // sky bands
    x.fillStyle = L.sky[0]; x.fillRect(0, 0, W, 100);
    x.fillStyle = L.sky[1]; x.fillRect(0, 22, W, 100);
    x.fillStyle = L.sky[2]; x.fillRect(0, 40, W, 100);
    // sun / moon
    var mx = W * (sk === 'desert' ? 0.78 : 0.82), my = sk === 'desert' ? 22 : 28;
    flat(x, circ(mx, my, sk === 'desert' ? 17 : 12), L.sun, 0);
    if (sk === 'desert') { flat(x, circ(mx - 5, my - 3, 3), alpha('#E8D2A0', 0.7), 0); flat(x, circ(mx + 6, my + 5, 2), alpha('#E8D2A0', 0.7), 0); }
    if (sk === 'none' || sk === 'desert' || sk === 'city') { x.fillStyle = alpha(WHITE, 0.8); for (i = 0; i < 12; i++) { x.beginPath(); x.arc(r() * W, r() * 30, 0.6 + r() * 0.6, 0, TAU); x.fill(); } }
    // clouds
    x.fillStyle = alpha(WHITE, sk === 'desert' || sk === 'none' ? 0.35 : 0.85);
    for (i = 0; i < 3; i++) { var cx = W * (0.1 + i * 0.3 + r() * 0.1), cy = 12 + r() * 16; x.beginPath(); x.ellipse(cx, cy, 14, 4, 0, 0, TAU); x.ellipse(cx - 6, cy - 3, 6, 5, 0, 0, TAU); x.ellipse(cx + 5, cy - 4, 7, 5.5, 0, 0, TAU); x.fill(); }
    // skyline
    var far = L.far, hor = 58;
    if (sk === 'barns') {
      x.fillStyle = mix(L.grass, L.sky[2], 0.35); x.beginPath(); x.moveTo(0, hor); x.quadraticCurveTo(W * 0.3, hor - 14, W * 0.6, hor - 4); x.quadraticCurveTo(W * 0.85, hor - 12, W, hor - 2); x.lineTo(W, 100); x.lineTo(0, 100); x.fill();
      var bx = W * 0.18;
      flat(x, poly([bx, hor, bx, hor - 16, bx + 10, hor - 24, bx + 20, hor - 16, bx + 20, hor]), PAL.brick, 0);
      flat(x, rr(bx + 6, hor - 11, 8, 11, 0.5), CREAM, 0); line(x, 'M' + (bx + 6) + ' ' + (hor - 11) + ' L' + (bx + 14) + ' ' + hor + ' M' + (bx + 14) + ' ' + (hor - 11) + ' L' + (bx + 6) + ' ' + hor, PAL.brick, 1.2);
      flat(x, rr(bx + 23, hor - 26, 7, 26, 3.5), '#C8C2B8', 0); flat(x, ell(bx + 26.5, hor - 26, 3.5, 3), '#8A8A96', 0);
      flat(x, ell(W * 0.62, hor - 4, 6, 4), '#E8C46A', 0); flat(x, ell(W * 0.7, hor - 3, 5, 3.4), '#E8C46A', 0);
    } else if (sk === 'city') {
      for (i = 0; i < 9; i++) {
        var bw = 8 + r() * 10, bh = 14 + r() * 26, bx2 = i * W / 9 + r() * 4;
        flat(x, rr(bx2, hor - bh, bw, bh + 10, 0.6), i % 2 ? far : dark(far, 0.18), 0);
        x.fillStyle = alpha('#FFE08A', 0.85);
        for (var wy = hor - bh + 3; wy < hor - 2; wy += 5) for (var wx = bx2 + 2; wx < bx2 + bw - 2; wx += 4) if (r() < 0.55) x.fillRect(wx, wy, 1.8, 2.4);
      }
      flat(x, rr(W * 0.66, hor - 40, 9, 9, 3), '#9A6A4A', 0); x.fillStyle = '#9A6A4A'; x.fillRect(W * 0.66 + 1.5, hor - 32, 1.2, 10); x.fillRect(W * 0.66 + 6.3, hor - 32, 1.2, 10);
    } else if (sk === 'pines') {
      x.fillStyle = mix(far, L.sky[2], 0.45); x.beginPath(); x.moveTo(0, hor); x.lineTo(W * 0.25, hor - 20); x.lineTo(W * 0.45, hor - 6); x.lineTo(W * 0.7, hor - 24); x.lineTo(W, hor - 4); x.lineTo(W, 100); x.lineTo(0, 100); x.fill();
      for (i = 0; i < 14; i++) { var tx = i * W / 13 + r() * 3, th = 14 + r() * 12; flat(x, poly([tx, hor - th, tx + 5.5, hor + 2, tx - 5.5, hor + 2]), i % 2 ? far : dark(far, 0.2), 0); }
      flat(x, rr(W * 0.35, hor - 1, W * 0.3, 5, 2.5), '#5AA8C8', 0);
    } else if (sk === 'harbor') {
      flat(x, rr(0, hor - 4, W, 12, 0), '#3E9AB0', 0);
      x.strokeStyle = alpha(WHITE, 0.7); x.lineWidth = 0.9; for (i = 0; i < 8; i++) { var wx2 = r() * W, wy2 = hor - 2 + r() * 6; x.beginPath(); x.moveTo(wx2, wy2); x.quadraticCurveTo(wx2 + 2, wy2 - 1.5, wx2 + 4, wy2); x.stroke(); }
      var lx = W * 0.14; flat(x, poly([lx - 3, hor - 2, lx + 3, hor - 2, lx + 2, hor - 26, lx - 2, hor - 26]), CREAM, 0);
      x.fillStyle = PAL.brick; x.fillRect(lx - 2.6, hor - 14, 5.2, 4); x.fillRect(lx - 2.2, hor - 24, 4.4, 3); flat(x, poly([lx - 3, hor - 26, lx + 3, hor - 26, lx, hor - 31]), PAL.brick, 0);
      flat(x, poly([W * 0.55, hor - 3, W * 0.55 + 12, hor - 3, W * 0.55 + 10, hor + 1, W * 0.55 + 2, hor + 1]), PAL.brick, 0); flat(x, poly([W * 0.55 + 6, hor - 4, W * 0.55 + 6, hor - 14, W * 0.55 + 12, hor - 4]), WHITE, 0);
      line(x, 'M' + (W * 0.3) + ' 18 q2 -2 4 0 q2 -2 4 0 M' + (W * 0.4) + ' 12 q1.5 -1.5 3 0 q1.5 -1.5 3 0', alpha(INK, 0.6), 0.9);
    } else if (sk === 'desert') {
      x.fillStyle = far; x.beginPath(); x.moveTo(W * 0.05, hor); x.lineTo(W * 0.1, hor - 16); x.lineTo(W * 0.3, hor - 16); x.lineTo(W * 0.34, hor); x.fill();
      x.fillStyle = dark(far, 0.15); x.beginPath(); x.moveTo(W * 0.5, hor); x.lineTo(W * 0.56, hor - 22); x.lineTo(W * 0.66, hor - 22); x.lineTo(W * 0.72, hor); x.fill();
      x.fillStyle = mix(far, PAL.pink, 0.4); x.fillRect(0, hor - 3, W, 12);
      [[W * 0.42, 18], [W * 0.88, 14]].forEach(function (c) { var cx2 = c[0], ch = c[1]; flat(x, rr(cx2 - 2, hor - ch, 4, ch + 2, 2), '#4E8E4A', 0); flat(x, rr(cx2 - 7, hor - ch * 0.7, 3, ch * 0.4, 1.5), '#4E8E4A', 0); flat(x, rr(cx2 + 4, hor - ch * 0.85, 3, ch * 0.45, 1.5), '#4E8E4A', 0); x.fillStyle = '#4E8E4A'; x.fillRect(cx2 - 6, hor - ch * 0.38, 6, 2); x.fillRect(cx2, hor - ch * 0.5, 6, 2); });
    } else {
      for (i = 0; i < 5; i++) { var ax = W * (0.1 + i * 0.2); flat(x, path('M' + (ax - 8) + ' ' + (hor + 2) + ' L' + (ax - 8) + ' ' + (hor - 16) + ' Q' + ax + ' ' + (hor - 28) + ' ' + (ax + 8) + ' ' + (hor - 16) + ' L' + (ax + 8) + ' ' + (hor + 2) + ' Z'), i % 2 ? far : dark(far, 0.15), 0); flat(x, path('M' + (ax - 4) + ' ' + (hor + 2) + ' L' + (ax - 4) + ' ' + (hor - 10) + ' Q' + ax + ' ' + (hor - 16) + ' ' + (ax + 4) + ' ' + (hor - 10) + ' L' + (ax + 4) + ' ' + (hor + 2) + ' Z'), dark(far, 0.45), 0); }
      flat(x, poly([W * 0.5 - 5, hor - 20, W * 0.5 + 5, hor - 20, W * 0.5, hor - 40]), dark(far, 0.25), 0);
      line(x, 'M' + (W * 0.5) + ' ' + (hor - 40) + ' L' + (W * 0.5) + ' ' + (hor - 47), dark(far, 0.25), 1);
      flat(x, poly([W * 0.5, hor - 47, W * 0.5 + 6, hor - 45, W * 0.5, hor - 43]), PAL.mustard, 0);
    }
    // outfield wall
    var wy0 = hor + 4;
    flat(x, rr(-2, wy0, W + 4, 9, 0), '#2E6E3A', 1.4);
    x.fillStyle = PAL.mustard; x.fillRect(0, wy0, W, 1.4);
    x.font = fD(5); x.textAlign = 'center'; x.fillStyle = CREAM;
    var fn = park.fence || [];
    if (fn.length) { x.fillText(String(fn[0][1]), W * 0.1, wy0 + 7.2); x.fillText(String(fn[Math.floor(fn.length / 2)][1]), W * 0.5, wy0 + 7.2); x.fillText(String(fn[fn.length - 1][1]), W * 0.9, wy0 + 7.2); }
    // grass with mowing stripes
    x.fillStyle = L.grass; x.fillRect(0, wy0 + 9, W, 100);
    x.fillStyle = alpha(PAL.grassD, 0.35);
    for (i = -10; i < W + 20; i += 16) { x.beginPath(); x.moveTo(i, wy0 + 9); x.lineTo(i + 8, wy0 + 9); x.lineTo(i + 2 - 12, 100); x.lineTo(i - 6 - 12, 100); x.closePath(); x.fill(); }
    // infield dirt + diamond
    x.fillStyle = PAL.dirt; x.beginPath(); x.ellipse(W / 2, 112, W * 0.42, 34, 0, PI, TAU); x.fill();
    line(x, 'M' + (W * 0.08) + ' 100 Q' + (W / 2) + ' 66 ' + (W * 0.92) + ' 100', alpha(INK, 0.35), 1);
    x.fillStyle = L.grass; x.beginPath(); x.moveTo(W / 2, 84); x.lineTo(W / 2 + 22, 100); x.lineTo(W / 2 - 22, 100); x.closePath(); x.fill();
    flat(x, ell(W / 2, 92, 4, 1.6), mix(PAL.dirt, '#FFF4DC', 0.2), 0.8);
    [[W / 2, 83], [W / 2 - 23, 98], [W / 2 + 23, 98]].forEach(function (q) { flat(x, poly([q[0] - 2, q[1], q[0], q[1] - 1.2, q[0] + 2, q[1], q[0], q[1] + 1.2]), WHITE, 0.8); });
    x.restore();
    remember(key, canvas);
  }

  // ================================================================== ROCCO (hero mascot, full body)
  // Figure units: feet at y = 0, top of cap near y = -140, centred on x = 0.
  var ROCCO_FACE = null;
  function roccoFace(expr) {
    var f = face('raccoon', 7);
    f.acc = {}; f.blush = true; f.gx = 0.4; f.gy = 0; f.cap = 'fwd'; f.tilt = -0.05;
    var E = {
      idle: { eyes: 'wink', brow: 'cocky', mouth: 'grin' },
      tap: { eyes: 'wide', brow: 'angry', mouth: 'grit', gx: 1.3 },
      hold: { eyes: 'half', brow: 'angry', mouth: 'grit', gx: 1.2 },
      take: { eyes: 'half', brow: 'up', mouth: 'smirk', gx: 1.4, gy: -0.2 },
      cheer: { eyes: 'happy', brow: 'up', mouth: 'grin' },
    }[expr] || {};
    for (var k in E) f[k] = E[k];
    return f;
  }
  function hose(x, pts, col, w) { // rubber-hose limb: ink under, colour over
    var p = new Path2D(); p.moveTo(pts[0], pts[1]); p.quadraticCurveTo(pts[2], pts[3], pts[4], pts[5]);
    line(x, p, INK, w + 3.6); line(x, p, col, w);
  }
  function shoe(x, sx, sy, dir, col) {
    var p = path('M' + (sx - 7 * dir) + ' ' + sy + ' Q' + (sx - 8 * dir) + ' ' + (sy - 7) + ' ' + (sx + 1 * dir) + ' ' + (sy - 7) + ' Q' + (sx + 12 * dir) + ' ' + (sy - 6) + ' ' + (sx + 13 * dir) + ' ' + (sy - 1) + ' Q' + (sx + 13 * dir) + ' ' + (sy + 1.5) + ' ' + (sx + 9 * dir) + ' ' + (sy + 1.5) + ' L' + (sx - 6 * dir) + ' ' + (sy + 1.5) + ' Z');
    cel(x, p, col, { sh: 1.4, lw: 2 });
    flat(x, path('M' + (sx + 6 * dir) + ' ' + (sy - 5.6) + ' Q' + (sx + 12 * dir) + ' ' + (sy - 5) + ' ' + (sx + 13 * dir) + ' ' + (sy - 1) + ' L' + (sx + 6 * dir) + ' ' + (sy - 1) + ' Z'), WHITE, 0);
    line(x, 'M' + (sx - 7 * dir) + ' ' + (sy + 0.4) + ' L' + (sx + 12 * dir) + ' ' + (sy + 0.4), WHITE, 1.2);
    line(x, p, INK, 2);
  }
  function figure(x, pose, sc) {
    var team = sc.a, acc = sc.b, f = roccoFace(pose), fur = f.main;
    var P = {
      idle: { lean: 0, hip: [0, -48], feet: [[-13, 0], [13, 0]], knees: [[-12, -24], [12, -24]], hands: [[-14, -84], [-6, -80]], elbows: [[-26, -68], [8, -64]], bat: [-12, -82, -2.25, 66] },
      tap: { lean: 0.05, hip: [0, -46], feet: [[-18, 0], [16, 0]], knees: [[-20, -22], [16, -22]], hands: [[14, -72], [18, -70]], elbows: [[-6, -60], [26, -62]], bat: [16, -71, -0.12, 70] },
      hold: { lean: -0.08, hip: [0, -44], feet: [[-20, 0], [18, 0]], knees: [[-24, -20], [22, -18]], hands: [[-18, -96], [-12, -92]], elbows: [[-30, -76], [2, -74]], bat: [-15, -94, -2.6, 64] },
      take: { lean: -0.12, hip: [0, -48], feet: [[-12, 0], [14, 0]], knees: [[-12, -24], [14, -24]], hands: [[-16, -86], [26, -96]], elbows: [[-28, -70], [22, -76]], bat: [-14, -84, -2.2, 64] },
      cheer: { lean: 0, hip: [0, -50], feet: [[-14, 0], [14, 0]], knees: [[-16, -26], [16, -26]], hands: [[-30, -134], [30, -130]], elbows: [[-34, -100], [34, -100]], bat: [-34, -136, 0.06, 66] },
    }[pose] || null;
    if (!P) return;
    x.save(); x.rotate(P.lean);
    // tail (ringed) behind
    var tail = path('M6 -54 C34 -60 46 -40 40 -22 C36 -12 28 -18 30 -26 C34 -38 24 -46 4 -46 Z');
    cel(x, tail, fur, { sh: 2 });
    x.save(); x.clip(tail); for (var i = 0; i < 4; i++) line(x, 'M' + (14 + i * 8) + ' -64 L' + (24 + i * 8) + ' -16', '#3A3242', 3.2); x.restore();
    line(x, tail, INK, LW);
    // legs (white pants) + stirrup socks + shoes
    [0, 1].forEach(function (k) {
      var hp = [P.hip[0] + (k ? 7 : -7), P.hip[1]], kn = P.knees[k], ft = P.feet[k];
      hose(x, [hp[0], hp[1], kn[0], kn[1], ft[0], ft[1] - 5], CREAM, 9);
      var sk = new Path2D(); sk.moveTo(U.lerp(kn[0], ft[0], 0.35), U.lerp(kn[1], ft[1], 0.35)); sk.lineTo(ft[0], ft[1] - 5);
      line(x, sk, acc, 9, 'butt');
    });
    shoe(x, P.feet[0][0], P.feet[0][1], -1, INK === team ? '#3A3046' : team);
    shoe(x, P.feet[1][0], P.feet[1][1], 1, INK === team ? '#3A3046' : team);
    // back arm (first hand) under the torso, bat under the front hand
    hose(x, [-12, -80, P.elbows[0][0], P.elbows[0][1], P.hands[0][0], P.hands[0][1]], fur, 6);
    var B = P.bat;
    x.save(); x.translate(B[0], B[1]); x.rotate(B[2]); batShape(x, -8, 0, B[3], 1.15, '#D9A066', null); x.restore();
    // torso (home whites)
    var t = path('M-15 -84 Q0 -88 15 -84 Q19 -66 15 -48 Q0 -44 -15 -48 Q-19 -66 -15 -84 Z');
    cel(x, t, CREAM, { sh: 2.4, dark: '#E2D2B8' });
    x.save(); x.clip(t); line(x, 'M0 -86 L0 -46', team, 1.6); line(x, 'M-16 -55 L16 -55', INK, 4); x.restore();
    line(x, t, INK, LW);
    flat(x, rr(-3, -57, 6, 4, 1), PAL.mustard, 1.2);
    inkText(x, '1', 8, -64, 11, team, { lw: 2.2 });
    // sleeves
    cel(x, ell(-14, -80, 6, 5, -0.5), team, { sh: 1, lw: 1.8 });
    // front arm
    hose(x, [12, -80, P.elbows[1][0], P.elbows[1][1], P.hands[1][0], P.hands[1][1]], fur, 6);
    cel(x, ell(14, -80, 6, 5, 0.5), team, { sh: 1, lw: 1.8 });
    glove(x, P.hands[0][0], P.hands[0][1], 1.05, pose === 'cheer' ? -0.3 : -1.2);
    glove(x, P.hands[1][0], P.hands[1][1], 1.05, pose === 'take' ? 0.2 : pose === 'cheer' ? 0.3 : -1.0);
    // head
    x.save(); x.translate(0, -110); x.scale(1.18, 1.18);
    head(x, f, { cap: team, letter: 'S', letterCol: CREAM });
    x.restore();
    x.restore();
  }
  function drawRocco(canvas, opts) {
    opts = opts || {};
    if (!canvas) return;
    var w = canvas.width, h = canvas.height, pose = opts.pose || 'idle', sc = scheme(opts.inkset || 'classic');
    var key = 'rocco|' + pose + '|' + (opts.props ? 1 : 0) + '|' + w + 'x' + h + '|' + sc.a + sc.b + sc.c + '|' + fontsReady();
    if (blit(canvas, key)) return;
    var x = begin(canvas);
    if (!opts.props) {
      var s = Math.min(w / 110, h / 150);
      x.save(); x.translate(w / 2, h - 4 * s); x.scale(s, s);
      flat(x, ell(0, 1, 24, 4), alpha(INK, 0.22), 0);
      figure(x, pose, sc);
      x.restore();
      remember(key, canvas);
      return;
    }
    // illustrated how-to panel: 200 x 200 units
    var k = Math.min(w, h) / 200;
    x.save(); x.translate((w - 200 * k) / 2, (h - 200 * k) / 2); x.scale(k, k);
    var bg = circ(100, 100, 96);
    x.save(); x.clip(bg); sunburst(x, 100, 100, 140, 20, light(sc.c, 0.35), light(sc.c, 0.65), 0.1);
    flat(x, rr(0, 160, 200, 50, 0), PAL.dirt, 0); flat(x, poly([70, 172, 100, 166, 130, 172, 100, 178]), WHITE, 1.4);
    x.restore();
    line(x, bg, INK, 3);
    if (pose === 'tap') {
      zone(x, 128, 58, 46, 58);
      x.save(); x.translate(62, 170); x.scale(0.82, 0.82); figure(x, 'tap', sc); x.restore();
      cel(x, starPath(144, 92, 22, 11, 9, 0.2), PAL.mustard, { sh: 1.4, lw: 2.2 });
      ball(x, 144, 92, 7.5);
      line(x, 'M100 70 Q130 60 150 72 M96 82 Q126 76 150 86', alpha(INK, 0.55), 2);
      burstText(x, 'TAP!', 150, 44, 22, sc);
      finger(x, 160, 150);
    } else if (pose === 'hold') {
      x.save(); x.translate(92, 170); x.scale(0.82, 0.82); figure(x, 'hold', sc); x.restore();
      line(x, 'M138 64 q6 -4 0 -9 q-6 -4 0 -9 M150 74 q6 -4 0 -9 q-6 -4 0 -9', alpha(INK, 0.6), 2);
      flat(x, path('M128 70 Q132 62 134 70 Q134 75 131 75 Q128 75 128 70 Z'), '#8FD0F0', 1.4);
      cel(x, rr(36, 180, 128, 10, 5), CREAM, { shade: false, lw: 2.2 });
      cel(x, rr(38.5, 182.5, 92, 5, 2.5), sc.b, { shade: false, lw: 0 });
      burstText(x, 'HOLD...', 100, 34, 20, sc);
      finger(x, 160, 150, true);
    } else if (pose === 'take') {
      zone(x, 34, 60, 46, 58);
      x.save(); x.translate(108, 170); x.scale(0.82, 0.82); figure(x, 'take', sc); x.restore();
      ball(x, 30, 140, 7.5);
      line(x, 'M44 132 L84 116 M44 142 L86 132 M42 150 L80 146', alpha(INK, 0.55), 2);
      burstText(x, 'BALL!', 58, 40, 22, sc);
    } else {
      x.save(); x.translate(100, 172); x.scale(0.82, 0.82); figure(x, pose, sc); x.restore();
    }
    x.restore();
    remember(key, canvas);
  }
  function zone(x, zx, zy, zw, zh) {
    x.save(); x.setLineDash([6, 5]); line(x, rr(zx, zy, zw, zh, 3), alpha(INK, 0.75), 2.4); x.setLineDash([]); x.restore();
  }
  function ball(x, bx, by, r) {
    cel(x, circ(bx, by, r), WHITE, { sh: r * 0.2, dark: '#E2D6C4', lw: 2 });
    line(x, 'M' + (bx - r * 0.55) + ' ' + (by - r * 0.75) + ' Q' + (bx - r * 0.1) + ' ' + by + ' ' + (bx - r * 0.55) + ' ' + (by + r * 0.75) + ' M' + (bx + r * 0.55) + ' ' + (by - r * 0.75) + ' Q' + (bx + r * 0.1) + ' ' + by + ' ' + (bx + r * 0.55) + ' ' + (by + r * 0.75), PAL.brick, 1.3);
  }
  function burstText(x, s, cx, cy, px, sc) {
    x.save(); x.translate(cx, cy); x.rotate(-0.08);
    inkText(x, s, 0, px * 0.36, px, sc.c === '#F2B632' ? PAL.mustard : light(sc.c, 0.1), { lw: px * 0.28, shadow: 2.4 });
    x.restore();
  }
  function finger(x, fx, fy, hold) {
    x.save(); x.translate(fx, fy); x.rotate(-0.5);
    glove(x, 0, 0, 1.6, 0);
    x.restore();
    for (var i = 0; i < (hold ? 3 : 2); i++) { x.save(); x.globalAlpha = 0.7 - i * 0.2; line(x, circ(fx - 6, fy - 12, 8 + i * 6), INK, 1.6); x.restore(); }
  }

  BB.CardArt = {
    draw: draw, drawPitcher: drawPitcher, drawBat: drawBat, drawInkset: drawInkset, drawPark: drawPark, drawRocco: drawRocco,
    SPECIES: SPECIES, SPECIES_IDS: SPECIES_IDS, SPECIES_BY_PITCHER: SPECIES_BY_PITCHER, TEAM_SPECIES: TEAM_SPECIES,
    speciesFor: speciesFor, cardSpecies: cardSpecies, scheme: scheme, tame: tame,
    PALETTE: { ink: INK, cream: CREAM, white: WHITE, mustard: PAL.mustard, brick: PAL.brick, teal: PAL.teal, sunset: PAL.sunset, pink: PAL.pink, grass: PAL.grass, grassDark: PAL.grassD, dirt: PAL.dirt, navy: PAL.navy },
    clearCache: function () { cache = {}; cacheKeys = []; },
  };
})();
