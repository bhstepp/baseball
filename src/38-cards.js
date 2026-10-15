// 38-cards.js — BB.CardArt: riso trading cards, pitcher portraits, bat / ink set / park badges. Owned by the render agent.
//
// Every piece is printed through BB.Riso (three drums, halftones, multiply, misregistration) at the canvas's own
// pixel size. Static results are cached per (card, size, rarity, inks), so redrawing an album grid is a blit; foil
// cards add a cheap animated shimmer over the cached print when opts.time is passed.
//
//   BB.CardArt.draw(canvas, card, { time, misprint })   // canvas any size, 5:7 recommended (e.g. 200x280 px)
//   BB.CardArt.drawPitcher(canvas, pitcher, { inkset })
//   BB.CardArt.drawBat(canvas, bat) / drawInkset(canvas, inkset) / drawPark(canvas, park)
(function () {
  var U = BB.U, R = BB.Riso, PI = Math.PI, TAU = PI * 2;
  var P = null, press = null;
  var cache = {}, cacheKeys = [];
  var A1 = { a: 1 }, B1 = { b: 1 }, C1 = { c: 1 }, PAPER = {};
  var GLOVE = { a: 0.45, b: 0.6, c: 0.9 };
  var SKINS = [{ b: 0.16, c: 0.32 }, { b: 0.26, c: 0.5 }, { b: 0.34, c: 0.62, a: 0.06 }, { a: 0.16, b: 0.46, c: 0.78 }, { a: 0.32, b: 0.55, c: 0.8 }, { a: 0.5, b: 0.6, c: 0.75 }];
  var HAIRS = [{ a: 0.92 }, { a: 0.55, b: 0.45, c: 0.5 }, { b: 0.65, c: 1 }, { c: 0.85, b: 0.12 }, { a: 0.35 }];

  function getPress(w, h, inks, cell) {
    if (!press) press = R.press({ w: w, h: h, dpr: 1, margin: 0, inks: inks, cell: cell });
    press.cell = cell;
    press.setInks(inks);
    if (press.w !== w || press.h !== h) press.resize(w, h, 1); else press.reset();
    press.clear();
    P = press;
    return press;
  }
  function slotInk(slot, v) { var o = {}; o[slot || 'a'] = v == null ? 1 : v; return o; }
  function other(slot) { return slot === 'a' ? 'c' : slot === 'b' ? 'a' : 'b'; }
  function fill(p, i, o) { P.fill(p, i, o); }
  function stroke(p, i, w, o) { P.stroke(p, i, w, o); }
  function fit(str, maxW, px, fn) { fn = fn || R.display; var f = fn(px), w = P.measure(str, f); if (w > maxW) { px *= maxW / w; f = fn(px); } return { font: f, px: px }; }
  function remember(key, canvas) {
    var c = R.canvas(canvas.width, canvas.height); c.getContext('2d').drawImage(canvas, 0, 0);
    cache[key] = c; cacheKeys.push(key);
    while (cacheKeys.length > 90) delete cache[cacheKeys.shift()];
  }
  function blit(canvas, key) {
    var c = cache[key]; if (!c) return false;
    var x = canvas.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'copy'; x.drawImage(c, 0, 0); x.globalCompositeOperation = 'source-over';
    return true;
  }

  // ------------------------------------------------------------------ face + bust (drawn in 100 x 140 card units)
  function faceParams(seed, look) {
    var r = U.rng(seed ^ 0x5bd1e995);
    var hairOpts = ['none', 'none', 'mustache', 'beard', 'sideburns', 'stubble', 'handlebar'];
    var p = {
      skin: SKINS[Math.floor(r() * SKINS.length)],
      hairInk: HAIRS[Math.floor(r() * HAIRS.length)],
      shape: Math.floor(r() * 3), hair: hairOpts[Math.floor(r() * hairOpts.length)],
      eyes: Math.floor(r() * 3), brows: Math.floor(r() * 3), nose: Math.floor(r() * 3), mouth: Math.floor(r() * 5),
      cheeks: r() < 0.55, freckles: r() < 0.25, ears: 0.8 + r() * 0.4, tilt: (r() - 0.5) * 0.12, bg: Math.floor(r() * 5),
      wide: 0.95 + r() * 0.15, capHigh: r() < 0.3, sleeve: r() < 0.5,
    };
    if (look) {
      p.hair = look.hair || p.hair;
      p.wide = look.build === 'stout' ? 1.14 : look.build === 'lanky' ? 0.9 : 1.0;
      p.shape = look.build === 'lanky' ? 1 : look.build === 'stout' ? 0 : 2;
    }
    return p;
  }
  function bust(f, o) {
    // o: { team: slot, num, letter, pos, cap: slot ink for crown }
    var team = o.team || 'a', tI = slotInk(team), cx = 50, i;
    var dark = {}; dark[team] = 1; if (team !== 'a') dark.a = 0.45;
    var hitter = o.pos !== 'P' && o.pos !== 'C';
    // bat over the shoulder (behind the head) for hitters
    if (hitter && o.pos !== '1B' && o.pos !== 'SS') {
      var bp = new Path2D();
      bp.moveTo(78, 108); bp.lineTo(82, 104); bp.lineTo(36, 18); bp.quadraticCurveTo(31, 12, 26, 15); bp.quadraticCurveTo(24, 19, 29, 26); bp.closePath();
      stroke(bp, A1, 1.6); fill(bp, { c: 0.95, b: 0.4 });
      stroke(new Path2D('M33 22 L60 70'), PAPER, 1.2, { ko: ['a', 'b', 'c'] });
    }
    // shoulders / jersey
    var sw = 40 * f.wide, j = new Path2D();
    j.moveTo(cx - sw, 141); j.lineTo(cx - sw, 96); j.quadraticCurveTo(cx - sw + 2, 79, cx - 14, 76); j.lineTo(cx + 14, 76);
    j.quadraticCurveTo(cx + sw - 2, 79, cx + sw, 96); j.lineTo(cx + sw, 141); j.closePath();
    stroke(j, A1, 2.2); fill(j, tI);
    // shading + piping
    fill(R.poly([cx + 6, 78, cx + sw, 92, cx + sw, 141, cx + 12, 141]), slotInk(other(team), 0.28), { over: true });
    if (f.sleeve) stroke(new Path2D('M' + (cx - sw + 6) + ' 141 L' + (cx - sw + 4) + ' 92'), PAPER, 1.4, { ko: ['a', 'b', 'c'] });
    // collar
    var col = R.poly([cx - 12, 76, cx, 90, cx + 12, 76, cx + 8, 75, cx, 84, cx - 8, 75]);
    fill(col, PAPER);
    // neck
    fill(R.poly([cx - 8.5, 62, cx + 8.5, 62, cx + 8, 79, cx, 87, cx - 8, 79]), f.skin);
    fill(R.poly([cx - 8.5, 70, cx + 8.5, 70, cx + 8.4, 76, cx - 8.4, 76]), { a: 0.18 }, { over: true });
    // number on chest
    if (o.num != null) P.text(String(o.num), cx + 22, 116, R.display(15), PAPER, { align: 'center', ko: ['a', 'b', 'c'] });
    // glove / ball by position
    if (o.pos === 'P') {
      var gp = R.blob(cx - 22, 92, 13, 8, U.rng(3), 0.12);
      stroke(gp, A1, 1.6); fill(gp, GLOVE);
      stroke(new Path2D('M' + (cx - 30) + ' 90 Q' + (cx - 22) + ' 84 ' + (cx - 14) + ' 90'), PAPER, 1, { ko: ['a', 'b', 'c'] });
    } else if (!hitter || o.pos === '1B' || o.pos === 'SS') {
      var g2 = R.blob(cx + 26, 104, 12, 8, U.rng(4), 0.12);
      stroke(g2, A1, 1.6); fill(g2, GLOVE);
    }
    // head
    P.save(); P.translate(cx, 47); P.rotate(f.tilt);
    var rx = 17.5 * f.wide * (f.shape === 1 ? 0.9 : 1), ry = 21 * (f.shape === 1 ? 1.06 : 1);
    var head = new Path2D();
    if (f.shape === 2) { var rr = R.rrect(-rx, -ry, rx * 2, ry * 2, rx * 0.75); head.addPath(rr); } else head.ellipse(0, 0, rx, ry, 0, 0, TAU);
    // ears
    var er = 4.6 * f.ears;
    [-1, 1].forEach(function (sd) { var e = R.ellipse(sd * rx * 0.98, 3, er, er * 1.3); stroke(e, A1, 1.4); fill(e, f.skin); });
    stroke(head, A1, 2.2); fill(head, f.skin);
    // hair peeking under the cap
    fill(R.poly([-rx - 1, -6, -rx + 5, -12, -rx + 5, 2, -rx - 1, 4]), f.hairInk);
    fill(R.poly([rx + 1, -6, rx - 5, -12, rx - 5, 2, rx + 1, 4]), f.hairInk);
    // facial hair
    var hairI = f.hairInk;
    if (f.hair === 'beard') {
      var bd = new Path2D(); bd.moveTo(-rx, 0); bd.quadraticCurveTo(-rx, ry * 1.25, 0, ry * 1.08); bd.quadraticCurveTo(rx, ry * 1.25, rx, 0);
      bd.lineTo(rx * 0.7, 2); bd.quadraticCurveTo(rx * 0.6, ry * 0.55, 0, ry * 0.55); bd.quadraticCurveTo(-rx * 0.6, ry * 0.55, -rx * 0.7, 2); bd.closePath();
      fill(bd, hairI);
    } else if (f.hair === 'sideburns') {
      fill(R.rect(-rx + 0.5, -6, 5, 16), hairI); fill(R.rect(rx - 5.5, -6, 5, 16), hairI);
    } else if (f.hair === 'stubble') {
      var sb = new Path2D(); sb.moveTo(-rx * 0.85, 4); sb.quadraticCurveTo(-rx * 0.8, ry * 1.05, 0, ry); sb.quadraticCurveTo(rx * 0.8, ry * 1.05, rx * 0.85, 4); sb.lineTo(rx * 0.5, 10); sb.lineTo(-rx * 0.5, 10); sb.closePath();
      fill(sb, { a: 0.3 }, { over: true });
    }
    // cheeks + freckles
    if (f.cheeks) { fill(R.circle(-rx * 0.55, 8, 4.2), { b: 0.4 }, { over: true }); fill(R.circle(rx * 0.55, 8, 4.2), { b: 0.4 }, { over: true }); }
    if (f.freckles) { var fr = new Path2D(), rf = U.rng(9); for (i = 0; i < 9; i++) { var fx = (rf() - 0.5) * rx * 1.1, fy = 3 + rf() * 6; fr.moveTo(fx + 0.6, fy); fr.arc(fx, fy, 0.6, 0, TAU); } fill(fr, { b: 0.7, c: 0.8 }, { over: true }); }
    // eyes + brows
    [-1, 1].forEach(function (sd) {
      var ex = sd * rx * 0.38, ey = -2;
      if (f.eyes === 2) { fill(R.ellipse(ex, ey, 3.6, 3), PAPER); stroke(R.ellipse(ex, ey, 3.6, 3), A1, 0.9, { over: true }); fill(R.circle(ex + 0.8, ey + 0.4, 1.6), A1); }
      else if (f.eyes === 1) stroke(new Path2D('M' + (ex - 3) + ' ' + ey + ' Q' + ex + ' ' + (ey - 1.8) + ' ' + (ex + 3) + ' ' + ey), A1, 1.6);
      else fill(R.circle(ex, ey, 1.9), A1);
      var bw = f.brows === 0 ? 2.6 : f.brows === 1 ? 1.2 : 1.8, by = ey - 6, tilt = f.brows === 2 ? sd * 1.5 : 0;
      stroke(new Path2D('M' + (ex - 3.6) + ' ' + (by - tilt) + ' L' + (ex + 3.6) + ' ' + (by + tilt)), f.hair === 'none' && f.hairInk.c ? f.hairInk : A1, bw);
    });
    // nose
    if (f.nose === 0) fill(R.circle(0, 6, 3.2), { b: 0.45, c: 0.5 }, { over: true });
    else if (f.nose === 1) stroke(new Path2D('M0 -1 L-2.4 8 L1.6 8.6'), A1, 1.2, { over: true });
    else fill(R.ellipse(0, 6.5, 2.2, 1.6), { b: 0.5, c: 0.4 }, { over: true });
    // moustache
    if (f.hair === 'mustache' || f.hair === 'handlebar' || f.hair === 'beard') {
      var ms = new Path2D();
      if (f.hair === 'handlebar') { ms.moveTo(-11, 9); ms.quadraticCurveTo(-12, 14, -7, 13); ms.quadraticCurveTo(-3, 11, 0, 12); ms.quadraticCurveTo(3, 11, 7, 13); ms.quadraticCurveTo(12, 14, 11, 9); }
      else { ms.moveTo(-8, 13); ms.quadraticCurveTo(-4, 9, 0, 11); ms.quadraticCurveTo(4, 9, 8, 13); }
      stroke(ms, hairI, f.hair === 'handlebar' ? 2.6 : 3.4);
    }
    // mouth
    var my = 15.5;
    if (f.mouth === 0) stroke(new Path2D('M-5 ' + my + ' Q0 ' + (my + 4) + ' 5 ' + my), A1, 1.4);
    else if (f.mouth === 1) { var gr = new Path2D('M-6 ' + (my - 1) + ' Q0 ' + (my + 6) + ' 6 ' + (my - 1) + ' Z'); fill(gr, PAPER); stroke(gr, A1, 1.2, { over: true }); }
    else if (f.mouth === 2) { fill(R.ellipse(0, my + 0.5, 2.2, 2.6), A1); }
    else if (f.mouth === 3) stroke(new Path2D('M-4.5 ' + my + ' L4.5 ' + (my - 0.6)), A1, 1.4);
    else { stroke(new Path2D('M-4 ' + my + ' L1 ' + my), A1, 1.3); var gum = R.circle(6.5, my + 1, 5.2); fill(gum, { b: 0.65 }); stroke(gum, { b: 1 }, 0.8, { over: true }); fill(R.circle(5, my - 1, 1.2), PAPER); }
    // cap
    var capI = o.cap ? slotInk(o.cap) : tI, ch = f.capHigh ? 3 : 0;
    var crown = new Path2D(); crown.moveTo(-rx - 2, -8 - ch); crown.quadraticCurveTo(-rx - 1, -ry - 12 - ch, 0, -ry - 13 - ch); crown.quadraticCurveTo(rx + 1, -ry - 12 - ch, rx + 2, -8 - ch); crown.closePath();
    if (o.pos === 'C') { // catcher: cap on backwards, button up front
      stroke(crown, A1, 2); fill(crown, capI);
      fill(R.rect(-rx - 3, -10 - ch, rx * 2 + 6, 3.5), dark);
    } else {
      stroke(crown, A1, 2); fill(crown, capI);
      var bill = new Path2D(); bill.moveTo(-rx - 4, -8 - ch); bill.quadraticCurveTo(0, -15 - ch, rx + 4, -8 - ch); bill.quadraticCurveTo(rx + 8, -2 - ch, rx + 3, -1 - ch); bill.quadraticCurveTo(0, -6 - ch, -rx - 3, -1 - ch); bill.quadraticCurveTo(-rx - 8, -2 - ch, -rx - 4, -8 - ch); bill.closePath();
      stroke(bill, A1, 1.8); fill(bill, dark);
      fill(R.rect(-rx * 0.85, -2 - ch, rx * 1.7, 3), { a: 0.25 }, { over: true });
      if (o.letter) P.text(o.letter, 0, -ry * 0.62 - ch, R.display(11), team === 'c' ? A1 : PAPER, { align: 'center', ko: ['a', 'b', 'c'] });
    }
    fill(R.circle(0, -ry - 12.5 - ch, 1.8), dark);
    fill(R.ellipse(-rx * 0.45, -ry * 0.75 - ch, 4, 2.2, -0.5), { a: 0, b: 0, c: 0.6 }, { over: true });
    P.restore();
  }

  function windowBg(style, team, seed, x, y, w, h, rare) {
    var cx = x + w / 2, cy = y + h * 0.45, sec = other(team), i;
    if (rare) {
      fill(R.rect(x, y, w, h), { c: 0.35 });
      fill(R.rays(cx, cy, w * 1.2, 22, seed % 7, 0.5), { c: 1 }, { over: true });
      fill(R.star(cx, cy, w * 0.5, w * 0.3, 14, 0.1, 0.15, U.rng(seed)), { b: 0.35 }, { over: true });
      return;
    }
    if (style === 0) {
      fill(R.rect(x, y, w, h), slotInk(sec, 0.18));
      fill(R.rays(cx, cy, w * 1.2, 18, seed % 5, 0.5), slotInk(sec, 0.42), { over: true });
    } else if (style === 1) {
      fill(R.rect(x, y, w, h), { c: 0.45 });
      var d = new Path2D();
      for (var yy = y + 6; yy < y + h; yy += 13) for (var xx = x + ((yy / 13) % 2 ? 6 : 12); xx < x + w; xx += 13) { d.moveTo(xx + 3.4, yy); d.arc(xx, yy, 3.4, 0, TAU); }
      fill(d, slotInk(sec === 'c' ? 'b' : sec, 0.55), { over: true });
    } else if (style === 2) {
      fill(R.rect(x, y, w, h), PAPER);
      var st = new Path2D();
      for (i = -10; i < 20; i++) { st.moveTo(x + i * 12, y); st.lineTo(x + i * 12 + 6, y); st.lineTo(x + i * 12 + 6 - h * 0.6, y + h); st.lineTo(x + i * 12 - h * 0.6, y + h); st.closePath(); }
      fill(st, slotInk(sec, 0.3), { over: true });
    } else if (style === 3) {
      fill(R.rect(x, y, w, h), slotInk(sec, 0.12));
      for (i = 5; i > 0; i--) fill(R.circle(cx, cy, i * w * 0.16), i % 2 ? slotInk(sec, 0.4) : PAPER, { over: i % 2 === 1 });
    } else {
      // tiny ballpark: sky, stands, grass
      fill(R.rect(x, y, w, h * 0.6), { a: 0.22 });
      fill(R.rect(x, y + h * 0.42, w, h * 0.2), { a: 0.85, b: 0.25 });
      var cr = new Path2D(), rr = U.rng(seed);
      for (i = 0; i < 70; i++) { var px = x + rr() * w, py = y + h * 0.44 + rr() * h * 0.16; cr.moveTo(px + 1.4, py); cr.arc(px, py, 1.4, 0, TAU); }
      fill(cr, { c: 1 }, { over: false });
      fill(R.rect(x, y + h * 0.62, w, h * 0.38), { a: 0.42, c: 1 });
      fill(R.circle(x + w * 0.8, y + h * 0.16, w * 0.09), { c: 1, b: 0.2 });
    }
  }

  // ------------------------------------------------------------------ CARD
  function cardInks(card, mis) {
    var ink = R.inks(card.inkset || 'classic');
    if (mis) { // wrong ink in the drum
      var r = U.rng((card.seed || U.hashStr(card.id || 'x')) + 7)();
      ink = r < 0.5 ? { id: ink.id + '~ab', a: ink.b, b: ink.a, c: ink.c, paper: ink.paper } : { id: ink.id + '~bc', a: ink.a, b: ink.c, c: ink.b, paper: ink.paper };
    }
    return ink;
  }
  function draw(canvas, card, opts) {
    opts = opts || {};
    if (!canvas || !card) return;
    var w = canvas.width, h = canvas.height;
    var rarity = opts.misprint ? 'misprint' : card.rarity || 'common', mis = rarity === 'misprint';
    var seed = card.seed != null ? card.seed : U.hashStr(card.id || card.name || 'card');
    var inks = cardInks(card, mis);
    var key = 'card|' + card.id + '|' + w + 'x' + h + '|' + rarity + '|' + inks.id + '|' + (R.fontsReady() ? 1 : 0);
    if (!blit(canvas, key)) {
      printCard(canvas, card, rarity, seed, inks);
      remember(key, canvas);
    }
    if (rarity === 'foil' || (rarity === 'rare' && opts.time != null)) shimmer(canvas, rarity, seed, opts.time || 0, inks);
  }
  function printCard(canvas, card, rarity, seed, inks) {
    var w = canvas.width, h = canvas.height, u = Math.min(w / 100, h / 140);
    getPress(w, h, inks, Math.max(2.4, Math.min(7, w / 52)));
    var team = card.teamColorSlot || 'a', tI = slotInk(team), sec = other(team);
    var f = faceParams(seed);
    P.save(); P.translate((w - 100 * u) / 2, (h - 140 * u) / 2); P.scale(u, u);
    // frame
    var frame = R.rrect(1, 1, 98, 138, 5);
    fill(frame, rarity === 'foil' ? { a: 0.55, b: 0.35, c: 0.5 } : tI);
    if (rarity !== 'foil') fill(frame, slotInk(sec, 0.22), { over: true });
    stroke(R.rrect(3.2, 3.2, 93.6, 133.6, 3.6), PAPER, 0.9, { ko: ['a', 'b', 'c'] });
    // window
    var win = R.rrect(7, 7, 86, 92, 3);
    fill(win, PAPER);
    P.save(); P.clip(win);
    windowBg(f.bg, team, seed, 7, 7, 86, 92, rarity === 'rare' || rarity === 'misprint' && f.bg === 0);
    bust(f, { team: team, num: card.number, letter: (card.teamShort || card.team || 'H').charAt(0), pos: card.pos });
    P.restore();
    stroke(win, A1, 1.4, { over: true });
    // bottom panel
    var panel = R.rrect(7, 102, 86, 31, 2.5);
    fill(panel, PAPER);
    // name ribbon
    P.save(); P.translate(50, 99.5); P.rotate(-0.045);
    var name = String(card.name || '').toUpperCase(), nf = fit(name, 78, 9.5);
    var rib = R.poly([-46, -7.5, 46, -7.5, 43, 0, 46, 7.5, -46, 7.5, -43, 0]);
    fill(R.poly([-44, -5.5, 48, -5.5, 45, 2, 48, 9.5, -44, 9.5, -41, 2]), rarity === 'foil' ? C1 : slotInk(team === 'b' ? 'c' : 'b'));
    fill(rib, A1);
    P.text(name, 0, nf.px * 0.36, nf.font, PAPER, { align: 'center' });
    P.restore();
    // nick + team + stat
    var ty = 113.5;
    if (card.nick) { var kf = fit('"' + card.nick + '"', 80, 5.6, function (p) { return R.mono(p, true); }); P.text('"' + card.nick + '"', 50, ty, kf.font, slotInk(team === 'c' ? 'b' : team), { align: 'center', over: true }); ty += 6.5; }
    var tm = String(card.team || '').toUpperCase(), tf = fit(tm, 80, 5.2, function (p) { return R.mono(p, true); });
    P.text(tm, 50, ty + (card.nick ? 0 : 1.5), tf.font, A1, { align: 'center', over: true });
    if (card.stat && h >= 150) { var sf = fit(String(card.stat), 80, 5, function (p) { return R.mono(p, false); }); P.text(String(card.stat), 50, 129.5, sf.font, A1, { align: 'center', over: true }); }
    // position badge + number
    var badge = R.circle(16, 16, 8.4);
    stroke(badge, A1, 2.2); fill(badge, C1);
    var pf = fit(String(card.pos || ''), 12.5, 7.5);
    P.text(String(card.pos || ''), 16, 16 + pf.px * 0.37, pf.font, A1, { align: 'center', over: true });
    var nb = '#' + (card.number != null ? card.number : '');
    P.text(nb, 89.5, 17.5, R.display(9), slotInk(team === 'b' ? 'c' : 'b'), { align: 'right', outline: 1.4 });
    P.text(nb, 88.8, 16.8, R.display(9), A1, { align: 'right', over: true });
    // rarity marks
    if (rarity === 'rare') {
      [[10, 132], [90, 132]].forEach(function (q) { fill(R.star(q[0], q[1], 4.2, 1.8, 5, -PI / 2), C1); stroke(R.star(q[0], q[1], 4.2, 1.8, 5, -PI / 2), A1, 0.6, { over: true }); });
    }
    if (rarity === 'foil') {
      P.text('FOIL', 91, 136.5, R.display(5.2), PAPER, { align: 'right' });
    }
    if (card.no != null) P.text('No.' + (card.no < 10 ? '0' : '') + card.no, 9, 136.5, R.mono(4.2, true), PAPER);
    if (rarity === 'misprint') {
      P.save(); P.translate(62, 84); P.rotate(-0.22);
      P.text('MISPRINT', 0, 0, R.display(11), { b: 1 }, { align: 'center', outline: 1.2 });
      stroke(R.rrect(-30, -11, 60, 15, 2), { b: 1 }, 1.4, { over: true });
      P.restore();
    }
    P.restore();
    // print it
    var x = canvas.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, w, h);
    var offs = rarity === 'misprint'
      ? { a: { x: 0, y: 0 }, b: { x: 5.5 * u, y: -3.2 * u }, c: { x: -4 * u, y: 4.5 * u } }
      : { a: { x: 0, y: 0 }, b: { x: 0.45 * u, y: -0.3 * u }, c: { x: -0.35 * u, y: 0.4 * u } };
    // print onto a rounded card shape (transparent corners)
    x.save();
    roundClip(x, w, h, u);
    P.composite(x, offs, { grain: 0.9, grainShift: (U.hashStr(card.id || '') % 97) });
    if (rarity === 'misprint') { // double hit of the B drum
      x.globalCompositeOperation = 'multiply'; x.globalAlpha = 0.55;
      x.drawImage(P.c.b, Math.round(-2.5 * u), Math.round(2.2 * u));
      x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
    }
    x.restore();
  }
  function roundClip(x, w, h, u) {
    var ox = (w - 100 * u) / 2, oy = (h - 140 * u) / 2, r = 5 * u;
    x.beginPath(); x.moveTo(ox + r + u, oy + u); x.arcTo(ox + 99 * u, oy + u, ox + 99 * u, oy + 139 * u, r); x.arcTo(ox + 99 * u, oy + 139 * u, ox + u, oy + 139 * u, r);
    x.arcTo(ox + u, oy + 139 * u, ox + u, oy + u, r); x.arcTo(ox + u, oy + u, ox + 99 * u, oy + u, r); x.closePath(); x.clip();
  }
  function shimmer(canvas, rarity, seed, time, inks) {
    var x = canvas.getContext('2d'), w = canvas.width, h = canvas.height, u = Math.min(w / 100, h / 140);
    var ox = (w - 100 * u) / 2, oy = (h - 140 * u) / 2;
    x.save();
    x.setTransform(1, 0, 0, 1, 0, 0);
    // clip to the frame ring + window background area (not the bottom text panel)
    x.beginPath();
    x.rect(ox + u, oy + u, 98 * u, 138 * u);
    x.rect(ox + 6.5 * u, oy + 6.5 * u, 87 * u, 127 * u);
    x.clip('evenodd');
    if (rarity === 'foil') {
      x.globalCompositeOperation = 'multiply';
      var cols = [inks.a, inks.b, inks.c], band = 26 * u, sh = (time * 38 * u) % (band * 3);
      for (var i = -4; i < 10; i++) {
        var bx = ox + i * band + sh - band * 2;
        x.fillStyle = R.tone(x, cols[(i + 30) % 3], 0.32, Math.max(3, 2.4 * u), 30 + i * 20);
        x.beginPath(); x.moveTo(bx, oy); x.lineTo(bx + band, oy); x.lineTo(bx + band - 140 * u * 0.45, oy + 140 * u); x.lineTo(bx - 140 * u * 0.45, oy + 140 * u); x.closePath(); x.fill();
      }
      x.globalCompositeOperation = 'source-over';
    }
    // sparkles: 4-point paper glints that twinkle
    var r = U.rng(seed + 11), n = rarity === 'foil' ? 9 : 4;
    x.fillStyle = inks.paper;
    for (var k = 0; k < n; k++) {
      var sx = ox + (6 + r() * 88) * u, sy = oy + (6 + r() * 128) * u, ph = r() * 6, tw = Math.max(0, Math.sin(time * 3.2 + ph));
      if (tw < 0.05) continue;
      var s = (2 + 3 * tw) * u;
      x.beginPath(); x.moveTo(sx, sy - s); x.lineTo(sx + s * 0.22, sy - s * 0.22); x.lineTo(sx + s, sy); x.lineTo(sx + s * 0.22, sy + s * 0.22);
      x.lineTo(sx, sy + s); x.lineTo(sx - s * 0.22, sy + s * 0.22); x.lineTo(sx - s, sy); x.lineTo(sx - s * 0.22, sy - s * 0.22); x.closePath(); x.fill();
    }
    x.restore();
  }

  // ------------------------------------------------------------------ PITCHER portrait (pre-game screen)
  function drawPitcher(canvas, pitcher, opts) {
    opts = opts || {};
    if (!canvas || !pitcher) return;
    var w = canvas.width, h = canvas.height, look = pitcher.look || {};
    var inkSrc = opts.inkset || (BB.Render && BB.Render._S && BB.Render._S.inkPick) || 'classic';
    var inks = R.inks(inkSrc), seed = U.hashStr(pitcher.id || pitcher.name || 'p');
    var key = 'pit|' + pitcher.id + '|' + w + 'x' + h + '|' + inks.id + '|' + (R.fontsReady() ? 1 : 0);
    if (blit(canvas, key)) return;
    var u = Math.min(w / 100, h / 140), sx = w / 100, sy = h / 140;
    getPress(w, h, inks, Math.max(2.4, Math.min(7, w / 52)));
    var f = faceParams(seed, look);
    var boss = !!pitcher.boss;
    P.save(); P.scale(sx, sy);
    // full-bleed background
    if (boss) {
      fill(R.rect(0, 0, 100, 140), { c: 0.4 });
      fill(R.rays(50, 52, 140, 22, 0.1, 0.5), { c: 1, b: 0.2 }, { over: true });
      fill(R.star(50, 52, 46, 30, 16, 0, 0.12, U.rng(seed)), { b: 0.4 }, { over: true });
    } else {
      fill(R.rect(0, 0, 100, 140), { a: 0.16 });
      fill(R.rays(50, 52, 140, 16, seed % 5, 0.5), { a: 0.3 }, { over: true });
    }
    P.restore();
    P.save(); P.translate((w - 100 * u) / 2, (h - 140 * u) / 2); P.scale(u, u);
    bust(f, { team: 'a', num: look.number, letter: (pitcher.team || pitcher.name || 'P').charAt(0), pos: 'P', cap: boss ? 'b' : 'a' });
    P.restore();
    if (boss) {
      P.save(); P.scale(sx, sy);
      P.text('BOSS', 50, 133, R.display(12), A1, { align: 'center', outline: 1.6 });
      P.restore();
    }
    var x = canvas.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, w, h);
    P.composite(x, { a: { x: 0, y: 0 }, b: { x: 0.5 * u, y: -0.35 * u }, c: { x: -0.4 * u, y: 0.45 * u } }, { grain: 0.9 });
    remember(key, canvas);
  }

  // ------------------------------------------------------------------ BAT badge
  function drawBat(canvas, bat, opts) {
    if (!canvas || !bat) return;
    var w = canvas.width, h = canvas.height, inks = R.inks((opts && opts.inkset) || (BB.Render && BB.Render._S && BB.Render._S.inkPick) || 'classic');
    var key = 'bat|' + bat.id + '|' + w + 'x' + h + '|' + inks.id;
    if (blit(canvas, key)) return;
    getPress(w, h, inks, Math.max(2.4, Math.min(6, Math.min(w, h) / 30)));
    var lk = bat.look || {}, wood = lk.wood || 'mid';
    var wI = wood === 'light' ? { c: 0.8, b: 0.15 } : wood === 'dark' ? { c: 1, b: 0.62, a: 0.35 } : wood === 'ink' ? { a: 1, b: 0.2 } : wood === 'gold' ? { c: 1, b: 0.28 } : { c: 1, b: 0.36 };
    var tI = slotInk(lk.tape || 'a'); if (lk.tape === 'c') tI.a = 0.25;
    var L = Math.hypot(w, h) * 0.92, cx = w / 2, cy = h / 2, ang = -Math.atan2(h, w) * 0.85, s = L / 100;
    var seed = U.hashStr(bat.id);
    fill(R.rect(0, 0, w, h), { c: 0.12 });
    fill(R.rays(cx, cy, L, 14, seed % 5, 0.5), { c: 0.32 }, { over: true });
    P.save(); P.translate(cx, cy); P.rotate(ang); P.scale(s, s);
    var shape = function (dx, dy) {
      var p = new Path2D();
      p.moveTo(-50 + dx, -1.6 + dy); p.lineTo(-12 + dx, -2.2 + dy); p.quadraticCurveTo(14 + dx, -5.6 + dy, 44 + dx, -5.4 + dy);
      p.arc(44 + dx, 0 + dy, 5.4, -PI / 2, PI / 2); p.quadraticCurveTo(14 + dx, 5.6 + dy, -12 + dx, 2.2 + dy); p.lineTo(-50 + dx, 1.6 + dy); p.closePath();
      return p;
    };
    fill(shape(2.5, 3.5), { a: 0.35 }, { over: true });
    var b = shape(0, 0);
    stroke(b, A1, 1.8); fill(b, wI);
    stroke(new Path2D('M0 -2.2 Q22 -4 42 -3.2'), PAPER, 1.1, { ko: ['a', 'b', 'c'] });
    var mk = lk.mark || 'none', i;
    if (mk === 'stripes' || mk === 'plaid') for (i = 0; i < 6; i++) stroke(new Path2D('M' + (8 + i * 6) + ' -6 L' + (4 + i * 6) + ' 6'), mk === 'plaid' ? { a: 0.8 } : B1, 1.6, { over: true });
    if (mk === 'plaid') stroke(new Path2D('M2 -1 L48 -1 M2 2 L48 2'), { b: 0.8 }, 1, { over: true });
    if (mk === 'thin') stroke(new Path2D('M10 0 L40 0'), { a: 0.7 }, 0.8, { over: true });
    if (mk === 'dots') { var dp = new Path2D(); for (i = 0; i < 9; i++) { dp.moveTo(12 + i * 4 + 1.4, (i % 2 ? -2 : 2)); dp.arc(12 + i * 4, (i % 2 ? -2 : 2), 1.4, 0, TAU); } fill(dp, { b: 1 }, { over: true }); }
    if (mk === 'star') { fill(R.star(28, 0, 4.4, 1.9, 5, -PI / 2), PAPER); fill(R.star(28, 0, 3.6, 1.5, 5, -PI / 2), { c: 1, b: 0.3 }); }
    if (mk === 'moon') { fill(R.circle(30, 0, 3.6), PAPER); fill(R.circle(31.5, -1, 3), wI); }
    if (mk === 'cork') { fill(R.circle(48.5, 0, 2.6), { b: 0.5, c: 0.9, a: 0.2 }); var cp = new Path2D(); for (i = 0; i < 6; i++) { cp.moveTo(47.5 + (i % 3), -1.2 + Math.floor(i / 3) * 1.8); cp.arc(47 + (i % 3), -1.2 + Math.floor(i / 3) * 1.8, 0.4, 0, TAU); } fill(cp, A1, { over: true }); }
    if (mk === 'smudge') { fill(R.blob(20, 0, 7, 8, U.rng(seed), 0.35), { a: 0.6 }, { over: true }); }
    // tape + knob + brand
    stroke(new Path2D('M-46 0 L-22 0'), tI, 4.2, { cap: 'butt' });
    var tp = new Path2D(); for (i = 0; i < 6; i++) { tp.moveTo(-45 + i * 4, -2.1); tp.lineTo(-43 + i * 4, 2.1); }
    stroke(tp, PAPER, 0.5);
    fill(R.ellipse(-50.5, 0, 2, 3.4), A1);
    P.text((bat.name || '').toUpperCase().slice(0, 14), 20, 1.6, R.display(4.2), { a: 0.85 }, { align: 'center', over: true });
    P.restore();
    var x = canvas.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, w, h);
    var k = Math.max(1, Math.min(w, h) / 120);
    P.composite(x, { a: { x: 0, y: 0 }, b: { x: 0.8 * k, y: -0.6 * k }, c: { x: -0.6 * k, y: 0.7 * k } }, { grain: 0.8 });
    remember(key, canvas);
  }

  // ------------------------------------------------------------------ INK SET swatch: three overprinting discs + screens
  function drawInkset(canvas, inkset) {
    if (!canvas) return;
    var w = canvas.width, h = canvas.height, inks = R.inks(inkset);
    var key = 'ink|' + inks.id + '|' + inks.a + inks.b + inks.c + '|' + w + 'x' + h;
    if (blit(canvas, key)) return;
    getPress(w, h, inks, Math.max(2.4, Math.min(6, Math.min(w, h) / 24)));
    var wide = w / h > 1.5, d = wide ? h : Math.min(w, h), r = d * 0.26, cx = wide ? h * 0.55 : w / 2, cy = wide ? h / 2 : h / 2;
    fill(R.circle(cx - r * 0.55, cy - r * 0.32, r), A1, { over: true });
    fill(R.circle(cx + r * 0.55, cy - r * 0.32, r), B1, { over: true });
    fill(R.circle(cx, cy + r * 0.62, r), C1, { over: true });
    if (wide) { // tone ramps for each drum
      var x0 = h * 1.15, rw = w - x0 - h * 0.12, rh = h * 0.18;
      ['a', 'b', 'c'].forEach(function (s, k) {
        for (var i = 0; i < 6; i++) fill(R.rect(x0 + i * rw / 6, h * 0.17 + k * rh * 1.45, rw / 6 - 1, rh), slotInk(s, (i + 1) / 6), { over: true });
      });
    }
    var x = canvas.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, w, h);
    var k = Math.max(1, d / 80);
    P.composite(x, { a: { x: 0, y: 0 }, b: { x: 1 * k, y: -0.7 * k }, c: { x: -0.8 * k, y: 0.9 * k } }, { grain: 0.8 });
    remember(key, canvas);
  }

  // ------------------------------------------------------------------ PARK badge: a little riso stadium map
  function drawPark(canvas, park, opts) {
    if (!canvas || !park) return;
    var w = canvas.width, h = canvas.height, inks = R.inks((opts && opts.inkset) || park.inkset || 'classic');
    var key = 'park|' + park.id + '|' + w + 'x' + h + '|' + inks.id + '|' + (R.fontsReady() ? 1 : 0);
    if (blit(canvas, key)) return;
    getPress(w, h, inks, Math.max(2.4, Math.min(6, Math.min(w, h) / 30)));
    var ft = park.features || {}, seed = U.hashStr(park.id || 'park');
    var fence = park.fence || [[-45, 330, 10], [0, 400, 10], [45, 330, 10]];
    function fd(sp) {
      if (sp <= fence[0][0]) return fence[0][1];
      for (var i = 1; i < fence.length; i++) if (sp <= fence[i][0]) return U.lerp(fence[i - 1][1], fence[i][1], (sp - fence[i - 1][0]) / (fence[i][0] - fence[i - 1][0]));
      return fence[fence.length - 1][1];
    }
    var maxD = 0, sp; for (sp = -45; sp <= 45; sp += 5) maxD = Math.max(maxD, fd(sp));
    var sc = Math.min(w * 0.44 / (maxD * Math.sin(PI / 4) + 70), h * 0.7 / (maxD + 70)), hx = w / 2, hy = h * 0.9;
    function pt(sp, d) { var r = U.rad(sp); return { x: hx + d * Math.sin(r) * sc, y: hy - d * Math.cos(r) * sc }; }
    // sky band + skyline
    fill(R.rect(0, 0, w, h), ft.water && ft.water !== 'none' ? { a: 0.12 } : { a: 0.08, c: 0.15 });
    // stands ring
    var ring = []; for (sp = -60; sp <= 60; sp += 3) ring.push(pt(sp, fd(Math.max(-45, Math.min(45, sp))) + 10));
    for (sp = 60; sp >= -60; sp -= 3) ring.push(pt(sp, fd(Math.max(-45, Math.min(45, sp))) + 62));
    fill(R.poly(ring), { a: 0.9, b: 0.25 });
    var cr = new Path2D(), rr = U.rng(seed), dots = [{ c: 1 }, { b: 1 }, {}];
    var crs = [new Path2D(), new Path2D(), new Path2D()];
    for (var i = 0; i < 160; i++) { var s2 = -58 + rr() * 116, d2 = fd(Math.max(-45, Math.min(45, s2))) + 16 + rr() * 42, q = pt(s2, d2), k = Math.floor(rr() * 3); crs[k].moveTo(q.x + 1.1, q.y); crs[k].arc(q.x, q.y, Math.max(0.8, 1.1 * w / 160), 0, TAU); }
    crs.forEach(function (p, k) { fill(p, dots[k]); });
    if (ft.water && ft.water !== 'none') {
      var wc = ft.water === 'left' ? -50 : ft.water === 'right' ? 30 : -15, wpts = [];
      for (sp = wc - 18; sp <= wc + 18; sp += 3) wpts.push(pt(sp, fd(Math.max(-45, Math.min(45, sp))) + 8));
      for (sp = wc + 18; sp >= wc - 18; sp -= 3) wpts.push(pt(sp, fd(Math.max(-45, Math.min(45, sp))) + 120));
      fill(R.poly(wpts), { a: 0.6, c: 0.1 });
    }
    // field
    var fair = [pt(0, 0)]; for (sp = -45; sp <= 45; sp += 3) fair.push(pt(sp, fd(sp)));
    fill(R.poly(fair), { a: 0.42, c: 1 });
    var stripes = new Path2D(); for (var dd = 40; dd < maxD; dd += 40) { var a = [], b = []; for (sp = -45; sp <= 45; sp += 5) { a.push(pt(sp, dd)); b.push(pt(sp, dd + 20)); } stripes.addPath(R.poly(a.concat(b.reverse()))); }
    P.save(); P.clip(R.poly(fair)); fill(stripes, { a: 0.6, c: 1 }, { over: true }); P.restore();
    var wl = new Path2D(); for (sp = -45; sp <= 45; sp += 3) { var q2 = pt(sp, fd(sp)); if (sp === -45) wl.moveTo(q2.x, q2.y); else wl.lineTo(q2.x, q2.y); }
    stroke(wl, A1, Math.max(2, w / 70)); stroke(wl, C1, Math.max(0.7, w / 220), { over: true });
    var dirt = []; for (sp = -48; sp <= 48; sp += 6) dirt.push(pt(sp, 95 + 30 * Math.cos(U.rad(sp)) * 0));
    var inf = R.poly([pt(0, 0), pt(45, 125), pt(0, 160), pt(-45, 125)]);
    fill(inf, { a: 0.05, b: 0.36, c: 0.78 });
    fill(R.poly([pt(0, 12), pt(45, 98), pt(0, 128), pt(-45, 98)]), { a: 0.5, c: 1 });
    var bp = new Path2D(); [pt(45, 90), pt(0, 127), pt(-45, 90), pt(0, 0)].forEach(function (q) { bp.addPath(R.rect(q.x - 1.6, q.y - 1.6, 3.2, 3.2)); });
    fill(bp, PAPER);
    if (ft.hill) fill(R.ellipse(pt(0, fd(0) - 30).x, pt(0, fd(0) - 30).y, 14 * sc * 4, 5 * sc * 4), { a: 0.75, c: 1 });
    var x = canvas.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, w, h);
    var kk = Math.max(1, Math.min(w, h) / 100);
    P.composite(x, { a: { x: 0, y: 0 }, b: { x: 0.8 * kk, y: -0.6 * kk }, c: { x: -0.6 * kk, y: 0.8 * kk } }, { grain: 0.8 });
    remember(key, canvas);
  }

  BB.CardArt = {
    draw: draw, drawPitcher: drawPitcher, drawBat: drawBat, drawInkset: drawInkset, drawPark: drawPark,
    clearCache: function () { cache = {}; cacheKeys = []; },
  };
})();
