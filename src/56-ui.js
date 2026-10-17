// 56-ui.js — every menu: DOM screens over the game canvas, styled as a classic theatrical cartoon (see
// shell.head.html: cream cards, ink outlines, hard shadows, squash-and-bounce buttons, sunbursts, iris wipes).
// Owned by the meta agent. Talks to BB.Meta for data, BB.Game to start/pause/quit, BB.CardArt for drawings
// (with built-in fallbacks), BB.Audio for clicks and fanfares. Main calls show('results', ...), toast(), inGame(),
// hideAll(). Everything is guarded so a missing module never breaks a screen.
(function () {
  var U = BB.U;
  var root, screensEl, ghostEl, pauseBtn, toastsEl;
  var cur = null, curData = null, curEl = null, inGameFlag = false;
  var redraws = [], timers = [], intervals = [], anims = [], animRaf = 0;
  var audioUnlocked = false, menuMusic = false, lastStart = null, artInk = null, backdropInk = null;
  var lastTap = null;

  function M() { return BB.Meta; }
  function C() { return BB.Content || null; }
  function title() { return BB.TITLE || 'Screwball Slugger'; }
  function sfx(n, o) { if (BB.Audio && BB.Audio.sfx) { try { BB.Audio.sfx(n, o || {}); } catch (e) {} } }
  function audio(fn) { if (BB.Audio && BB.Audio[fn]) { try { return BB.Audio[fn].apply(BB.Audio, [].slice.call(arguments, 1)); } catch (e) {} } }
  function haptic(k) { if (BB.Haptics && BB.Haptics[k] && M().settings().haptics !== false) { try { BB.Haptics[k](); } catch (e) {} } }
  function later(fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; }
  function every(fn, ms) { var t = setInterval(fn, ms); intervals.push(t); return t; }
  function clearTimers() { timers.forEach(clearTimeout); intervals.forEach(clearInterval); timers = []; intervals = []; }
  function fmt(n) { return U.fmtInt(n || 0); }
  function inkById(id) { for (var i = 0; i < BB.INKSETS.length; i++) if (BB.INKSETS[i].id === id) return BB.INKSETS[i]; return BB.INKSETS[0]; }
  function getPark(id) { var c = C(); return c && c.getPark ? c.getPark(id) : null; }
  function getPitcher(id) { var c = C(); return c && c.getPitcher ? c.getPitcher(id) : null; }
  function scheme(ink) {
    ink = ink || BB.INKSETS[0];
    if (BB.CardArt && BB.CardArt.scheme) { try { return BB.CardArt.scheme(ink); } catch (e) {} }
    return { a: ink.a, b: ink.b, c: ink.c, paper: '#FFF4DC' };
  }

  // ------------------------------------------------------------------ DOM helpers
  function h(spec, a, kids) {
    var parts = spec.split('.'), e = document.createElement(parts[0] || 'div');
    if (parts.length > 1) e.className = parts.slice(1).join(' ');
    if (a) for (var k in a) {
      var v = a[k];
      if (v == null || v === false) continue;
      if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'on') { for (var ev in v) e.addEventListener(ev, v[ev]); }
      else if (k === 'style') { if (typeof v === 'string') e.style.cssText = v; else for (var s in v) e.style.setProperty(s, v[s]); }
      else if (k === 'cls') e.className += ' ' + v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    add(e, kids);
    return e;
  }
  function add(e, kids) {
    if (kids == null) return e;
    if (!Array.isArray(kids)) kids = [kids];
    kids.forEach(function (c) { if (c == null || c === false) return; e.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c))); });
    return e;
  }
  function tap(fn, quiet) {
    return function (e) { if (!quiet) sfx('tap'); haptic('tap'); fn(e); };
  }
  function btn(label, cls, fn, sub, attrs) {
    var b = h('button.btn' + (cls ? '.' + cls.split(' ').join('.') : ''), attrs || {});
    if (typeof label === 'string') b.appendChild(h('span', { text: label })); else add(b, label);
    if (sub) b.appendChild(h('span.sub', { text: sub }));
    b.addEventListener('click', tap(fn));
    return b;
  }
  var STAR_PATH = 'M12 1.6l3.1 6.6 7.2.9-5.3 5 1.4 7.2L12 17.8l-6.4 3.5 1.4-7.2-5.3-5 7.2-.9z';
  function star(on) { return '<svg class="star' + (on ? ' on' : '') + '" viewBox="-1 -1 26 26"><path d="' + STAR_PATH + '"/></svg>'; }
  function stars(n, max) { var s = ''; for (var i = 0; i < (max || 3); i++) s += star(i < n); return h('span.stars', { html: s }); }
  function coin() { return h('i.coin'); }
  function lockIcon() {
    return h('span', { html: '<svg class="lock" viewBox="0 0 22 26"><path d="M5 11V7a6 6 0 0 1 12 0v4" fill="none" stroke="#1B1420" stroke-width="3"/><rect x="1.5" y="11" width="19" height="13.5" rx="4" fill="#F2B632" stroke="#1B1420" stroke-width="2.5"/><circle cx="11" cy="17.5" r="2.2" fill="#1B1420"/></svg>' });
  }
  var BACK_SVG = '<svg viewBox="0 0 24 24"><path d="M15 4 L7 12 L15 20" fill="none" stroke="#1B1420" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function header(text, backFn, right) {
    return h('div.hdr', null, [
      backFn ? h('button.back', { 'aria-label': 'Back', html: BACK_SVG, on: { click: tap(backFn) } }) : null,
      h('div.ttl' + (text.length > 11 ? '.long' : ''), null, h('span', { text: text })),
      right || null,
    ]);
  }
  function coinPill() { return h('div.pill', null, [coin(), h('span', { text: fmt(M().coins()) })]); }

  // ------------------------------------------------------------------ uniforms (colour schemes)
  function setInks(ink) {
    ink = ink || BB.INKSETS[0];
    artInk = ink;
    var sc = scheme(ink), s = document.documentElement.style;
    s.setProperty('--a', sc.a); s.setProperty('--b', sc.b); s.setProperty('--c', sc.c);
    var meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.setAttribute('content', '#FFF4DC');
  }
  function scopeInks(elm, ink) {
    if (!ink) return elm;
    var sc = scheme(ink);
    elm.style.setProperty('--a', sc.a); elm.style.setProperty('--b', sc.b); elm.style.setProperty('--c', sc.c);
    return elm;
  }
  function menuInk() {
    if (M().inksetChoice() !== 'park') return M().currentInkset(null);
    if (backdropInk) return backdropInk;
    var g = M().currentTourGame && M().currentTourGame();
    return M().currentInkset(g ? getPark(g.park) : null);
  }

  // ------------------------------------------------------------------ canvases & art (with fallbacks)
  function dpr() { return Math.min(window.devicePixelRatio || 1, 2); }
  function cnv(w, hgt, cls) {
    var c = document.createElement('canvas'), d = dpr();
    c.width = Math.round(w * d); c.height = Math.round(hgt * d);
    c.style.width = w + 'px'; c.style.height = hgt + 'px';
    c.className = 'art' + (cls ? ' ' + cls : '');
    return c;
  }
  function art(kind, canvas, obj, opts) {
    var run = function () {
      var ok = false;
      if (BB.CardArt && typeof BB.CardArt[kind] === 'function') {
        try { canvas.getContext('2d').setTransform(1, 0, 0, 1, 0, 0); BB.CardArt[kind](canvas, obj, opts || {}); ok = true; }
        catch (e) { console.error('CardArt.' + kind, e); }
      }
      if (!ok) { try { FB[kind](canvas, obj, opts || {}); } catch (e) { console.error('fallback ' + kind, e); } }
    };
    redraws.push(run);
    run();
    return canvas;
  }
  function cardCanvas(card, w, rarity) {
    var c = cnv(w, Math.round(w * 1.4));
    var obj = card;
    if (rarity && rarity !== card.rarity) { obj = {}; for (var k in card) obj[k] = card[k]; obj.rarity = rarity; }
    art('draw', c, obj);
    if (obj.rarity === 'foil' || obj.rarity === 'rare') animate(c, obj);
    return c;
  }
  // foil sheen + rare twinkles: one shared rAF loop, ~30 fps, only for canvases still on screen
  function animate(canvas, card) {
    if (!BB.CardArt || !BB.CardArt.draw) return;
    anims.push({ c: canvas, card: card });
    if (!animRaf) animRaf = requestAnimationFrame(tickAnims);
  }
  var lastAnim = 0;
  function tickAnims(now) {
    animRaf = 0;
    anims = anims.filter(function (a) { return a.c.isConnected; });
    if (!anims.length) return;
    if (now - lastAnim > 32) {
      lastAnim = now;
      var t = now / 1000;
      anims.forEach(function (a) { try { BB.CardArt.draw(a.c, a.card, { time: t }); } catch (e) {} });
    }
    animRaf = requestAnimationFrame(tickAnims);
  }
  function rocco(w, hgt, pose, props) {
    var o = { pose: pose, props: props, inkset: artInk || M().currentInkset(null) };
    return art('drawRocco', cnv(w, hgt), o, o);
  }

  // Fallback drawings: simple cartoon shapes, used when BB.CardArt is missing or throws.
  var FB = (function () {
    var INK = '#1B1420', CREAM = '#FFF4DC';
    function ctx(c) { var x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height); x.lineJoin = 'round'; return x; }
    function sc(o) { return scheme(o && o.inkset ? (typeof o.inkset === 'string' ? inkById(o.inkset) : o.inkset) : artInk || M().currentInkset(null)); }
    function blob(x, cx, cy, r, fill, lw) { x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fillStyle = fill; x.fill(); x.lineWidth = lw; x.strokeStyle = INK; x.stroke(); }
    return {
      draw: function (c, card) {
        var x = ctx(c), w = c.width, hh = c.height, s = w / 100, k = sc(card), team = k[card.teamColorSlot || 'a'];
        x.fillStyle = team; x.fillRect(0, 0, w, hh); x.lineWidth = 3 * s; x.strokeStyle = INK; x.strokeRect(1.5 * s, 1.5 * s, w - 3 * s, hh - 3 * s);
        x.fillStyle = card.rarity === 'common' ? '#7FD1D9' : '#F2B632'; x.fillRect(7 * s, 7 * s, 86 * s, 88 * s); x.strokeRect(7 * s, 7 * s, 86 * s, 88 * s);
        blob(x, 50 * s, 50 * s, 22 * s, '#C98E52', 2.4 * s);
        blob(x, 42 * s, 46 * s, 5 * s, '#FFFDF6', 1.6 * s); blob(x, 58 * s, 46 * s, 5 * s, '#FFFDF6', 1.6 * s);
        x.fillStyle = CREAM; x.fillRect(5 * s, 98 * s, 90 * s, 14 * s); x.strokeRect(5 * s, 98 * s, 90 * s, 14 * s);
        x.fillStyle = INK; x.font = Math.round(8 * s) + 'px ' + BB.FONTS.display; x.textAlign = 'center';
        x.fillText((card.name || '').toUpperCase().slice(0, 18), w / 2, 108 * s);
        x.fillStyle = CREAM; x.font = '700 ' + Math.round(7 * s) + 'px ' + BB.FONTS.body;
        x.fillText(card.pos + ' · #' + card.number, w / 2, 124 * s);
      },
      drawBat: function (c, bat) {
        var x = ctx(c), w = c.width, hh = c.height;
        x.beginPath(); x.moveTo(w * .06, hh * .45); x.lineTo(w * .5, hh * .42); x.quadraticCurveTo(w * .75, hh * .2, w * .94, hh * .25);
        x.arc(w * .94, hh * .5, hh * .25, -Math.PI / 2, Math.PI / 2); x.quadraticCurveTo(w * .75, hh * .8, w * .5, hh * .58); x.lineTo(w * .06, hh * .55); x.closePath();
        x.fillStyle = '#C98E52'; x.fill(); x.lineWidth = Math.max(2, hh * .05); x.strokeStyle = INK; x.stroke();
      },
      drawInkset: function (c, ink) {
        var x = ctx(c), w = c.width, hh = c.height, k = scheme(ink);
        [[k.a, .3], [k.b, .5], [k.c, .7]].forEach(function (p) { blob(x, w * p[1], hh / 2, Math.min(w, hh) * .26, p[0], 3); });
      },
      drawPitcher: function (c, p) {
        var x = ctx(c), w = c.width, hh = c.height, k = sc(null);
        x.fillStyle = k.c; x.fillRect(0, 0, w, hh);
        blob(x, w / 2, hh * .44, w * .28, '#9A6A44', 3);
        x.fillStyle = k.b; x.fillRect(w * .2, hh * .78, w * .6, hh * .22);
      },
      drawPark: function (c) {
        var x = ctx(c), w = c.width, hh = c.height;
        x.fillStyle = '#7FD1D9'; x.fillRect(0, 0, w, hh); x.fillStyle = '#6DBB4A'; x.fillRect(0, hh * .62, w, hh);
        x.fillStyle = '#D9955B'; x.beginPath(); x.ellipse(w / 2, hh * 1.1, w * .4, hh * .35, 0, Math.PI, 0); x.fill();
      },
      drawRocco: function (c) {
        var x = ctx(c), w = c.width, hh = c.height, r = Math.min(w, hh) * .22;
        blob(x, w / 2, hh * .4, r, '#8F8B9E', 3); x.fillStyle = '#3A3242'; x.fillRect(w / 2 - r * .9, hh * .4 - r * .3, r * 1.8, r * .45);
      },
    };
  })();

  // ------------------------------------------------------------------ confetti / star bursts
  function burst(target, n, big) {
    var box = h('span.confetti');
    var cols = ['var(--mustard)', 'var(--brick)', 'var(--teal)', 'var(--b)', 'var(--cream)', 'var(--grass)'];
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2 + Math.random() * 0.4, d = (big ? 70 : 46) + Math.random() * (big ? 70 : 40);
      box.appendChild(h('i' + (i % 3 === 0 ? '.st' : ''), { style: '--k:' + cols[i % cols.length] + ';--dx:' + Math.round(Math.cos(a) * d) + 'px;--dy:' + Math.round(Math.sin(a) * d - 20) + 'px;--rot:' + Math.round((Math.random() - 0.5) * 720) + 'deg;animation-delay:' + Math.round(Math.random() * 60) + 'ms' }));
    }
    target.appendChild(box);
    setTimeout(function () { if (box.parentNode) box.parentNode.removeChild(box); }, 1300);
  }

  // ------------------------------------------------------------------ toasts
  function toast(text, kind) {
    if (!toastsEl) return;
    kind = kind || 'info';
    var label = { ach: 'STAMPED!', unlock: 'UNLOCKED!', error: 'HOLD IT!', info: 'PSST!', coins: '+COINS', level: 'LEVEL UP!' }[kind] || 'PSST!';
    var t = String(text || '');
    if (kind === 'ach') t = t.replace(/^STAMPED:\s*/i, '');
    var e = h('div.toast.' + kind, null, [h('span.tk', { text: label }), h('span', { text: t })]);
    toastsEl.appendChild(e);
    while (toastsEl.children.length > 3) toastsEl.removeChild(toastsEl.firstChild);
    if (kind !== 'ach') sfx('toast');
    setTimeout(function () { e.classList.add('out'); setTimeout(function () { if (e.parentNode) e.parentNode.removeChild(e); }, 300); }, kind === 'error' ? 2200 : 2800);
  }
  M() && M().onAchievement && M().onAchievement(function (a) {
    // achievements earned outside a game (packs, equips) toast here; in-game ones are toasted by main
    if (!inGameFlag && cur !== 'results') later(function () { toast(a.name, 'ach'); sfx('unlock'); }, 250);
  });

  // ------------------------------------------------------------------ screen management (iris wipe)
  function show(name, data) {
    if (!SCREENS[name]) { console.warn('UI.show: unknown screen ' + name); name = 'title'; }
    clearTimers();
    redraws = [];
    var el;
    try { el = SCREENS[name](data || {}); }
    catch (e) { console.error('UI screen ' + name, e); el = SCREENS.title({}); name = 'title'; }
    // the old screen stays underneath (in #ghost) while the new one irises open over it
    var old = curEl && curEl.parentNode === screensEl ? curEl : null;
    ghostEl.innerHTML = '';
    if (old && name !== 'pause' && cur !== 'pause' && !el.classList.contains('overlay')) {
      ghostEl.appendChild(old);
      var gh = old; setTimeout(function () { if (gh.parentNode === ghostEl) ghostEl.removeChild(gh); }, 560);
    }
    screensEl.innerHTML = '';
    if (lastTap && performance.now() - lastTap.t < 1500) { el.style.setProperty('--ix', lastTap.x + 'px'); el.style.setProperty('--iy', lastTap.y + 'px'); }
    screensEl.appendChild(el);
    cur = name; curData = data || {}; curEl = el;
    document.body.classList.toggle('paused', name === 'pause');
    if (name !== 'pause' && name !== 'results') {
      if (!inGameFlag) setInks(name === 'brief' && data && data.ink ? data.ink : menuInk());
      startMenuMusic();
    }
    if (name === 'brief') prefetchCast(data || {});
    return el;
  }
  // While the briefing is up, fetch and parse the models the game will need (BB.Game.start does it too, as a fallback).
  function prefetchCast(data) {
    try {
      var c = data.cfg || {}, C = BB.Content || {};
      var park = C.getPark ? C.getPark(c.park) : null;
      var pitcher = C.getPitcher ? C.getPitcher(c.pitcher || (data.mode === 'derby' ? C.DERBY_PITCHER : null)) : null;
      var p = BB.Render && BB.Render.prepare && BB.Render.prepare(park, null, { pitcher: pitcher, mode: data.mode });
      if (p && p.catch) p.catch(function () {});
    } catch (e) { /* prefetch is best effort */ }
  }
  function hideAll() {
    clearTimers();
    screensEl.innerHTML = ''; ghostEl.innerHTML = '';
    cur = null; curEl = null;
    document.body.classList.remove('paused');
  }
  function inGame(on) {
    inGameFlag = !!on;
    document.body.classList.toggle('ingame', inGameFlag);
    if (on) { menuMusic = false; document.body.classList.remove('paused'); }
  }
  function startMenuMusic() {
    if (inGameFlag || menuMusic || !audioUnlocked) return;
    if (M().settings().music === false) return;
    menuMusic = true;
    audio('organ', 'menu');
  }
  function refresh() { if (cur && cur !== 'results' && cur !== 'pause') { var lt = lastTap; lastTap = null; show(cur, curData); lastTap = lt; } }

  // ------------------------------------------------------------------ starting games
  function startGame(mode, cfg) {
    if (!BB.Game || typeof BB.Game.start !== 'function') { toast('The projector is still warming up — game engine not loaded.', 'error'); return; }
    menuMusic = false;
    audio('organ', 'stop');
    try { M().startGame(mode, cfg); } catch (e) {}
    lastStart = { mode: mode, cfg: cfg };
    hideAll();
    inGame(true);
    try { BB.Game.start(mode, cfg); } catch (e) { console.error('Game.start', e); inGame(false); show('title'); toast('Could not start that game.', 'error'); }
  }
  function dailyCfg() {
    var key = U.dayKey();
    if (BB.Rules && BB.Rules.dailyCfg) { try { return BB.Rules.dailyCfg(key); } catch (e) {} }
    return { dayKey: key, mode: 'daily' };
  }
  function derbyCfg() {
    var P = (C() && C().PARKS) || [], n = M().derby().games;
    return P.length ? { park: P[n % P.length].id } : {};
  }

  // ================================================================== SCREENS
  var SCREENS = {};

  // ---------------------------------------------------------------- title
  function logo(di) {
    var words = String(title()).toUpperCase().split(/\s+/).filter(Boolean);
    if (words.length > 2) words = [words.slice(0, Math.ceil(words.length / 2)).join(' '), words.slice(Math.ceil(words.length / 2)).join(' ')];
    var r = U.rng(U.hashStr(title())), idx = 0;
    var wordsEl = h('div.words', { role: 'img', 'aria-label': title() });
    words.forEach(function (w) {
      var ln = h('div.line');
      w.split('').forEach(function (ch) {
        if (ch === ' ') { ln.appendChild(h('span', { style: 'width:.3em;display:inline-block' })); return; }
        var rot = Math.round((r() - 0.5) * 12), y = Math.round((r() - 0.5) * 8), s = (0.94 + r() * 0.16).toFixed(2);
        ln.appendChild(h('span.ch', { text: ch, style: '--i:' + (idx++) + ';--r:' + rot + 'deg;--y:' + y + 'px;--s:' + s }));
      });
      wordsEl.appendChild(ln);
    });
    wordsEl.appendChild(h('div.tag', { text: 'A one-tap batting cartoon' }));
    var mascot = h('div.mascot', null, rocco(118, 160, 'idle', false));
    return h('div.logo', null, [h('div.burst'), wordsEl, mascot, di ? h('div.no', { html: 'DAILY<b>#' + di.number + '</b>' }) : null]);
  }
  SCREENS.title = function () {
    var m = M(), lv = m.levelInfo(), di = m.dailyInfo(), g = m.currentTourGame(), at = g && m.locate(g);
    var unseen = BB.Meta.BATS.filter(function (b) { return b.id !== 'b_hickory' && m.batUnlocked(b.id) && !m.isSeen('bat:' + b.id); }).length +
      BB.INKSETS.filter(function (s) { return s.id !== 'classic' && m.inksetUnlocked(s.id) && !m.isSeen('inkset:' + s.id); }).length;
    var album = m.albumStats(), ach = m.achList().filter(function (a) { return a.earned; }).length;

    var tourSub = at ? 'Reel ' + (at.ch + 1) + ' · Game ' + (at.k + 1) + ' — ' + g.title + ' · ' + m.tourStars() + '★' : 'Six parks, thirty games';
    var dailySub = di.played ? 'Played ✓ ' + (di.result && di.result.label ? di.result.label : '') + ' · streak ' + di.streak
      : (di.streak ? 'Keep your ' + di.streak + '-day streak alive!' : 'Same pitches for everyone today');
    var derbyBest = m.derbyBest();

    var tourBtn = btn(h('span.lab', null, [h('span', { text: 'Barnstorm Tour' }), h('span.chev', { text: '▶' })]), 'big primary', function () { show('tour'); }, tourSub);
    var dailyBtn = btn(h('span.lab', null, [h('span', { text: 'Daily Derby #' + di.number }), !di.played ? h('span.dot-live') : null]), 'big', function () { openDaily(); }, dailySub);
    var derbyBtn = btn(h('span.lab', null, [h('span', { text: 'Endless Derby' })]), 'big', function () { openDerby(); }, derbyBest ? 'Best: ' + derbyBest + ' HR' : 'Ten outs. Only homers count.');

    var shopB = btn('Card Shop', '', function () { show('shop'); });
    if (m.packInfo().canAfford) shopB.appendChild(h('span.badge', { text: '!' }));
    var albumB = btn('Album', '', function () { show('album'); }, album.owned + '/' + album.total + ' cards');
    var lockerB = btn('Locker', '', function () { show('locker'); }, 'Bats & uniforms');
    if (unseen) lockerB.appendChild(h('span.badge', { text: String(unseen) }));
    var bookB = btn('Scorebook', '', function () { show('book'); }, ach + '/' + m.ACH.length + ' stamps');

    var el = h('div.scr.clear.title', null, [
      h('div.top', null, [
        h('div.lvl', null, [h('span.num', { text: 'LV ' + lv.level }), h('div.bar', null, h('i', { style: 'width:' + Math.round(lv.frac * 100) + '%' }))]),
        coinPill(),
        h('button.iconbtn', { 'aria-label': 'Settings', on: { click: tap(function () { show('settings'); }) },
          html: '<svg viewBox="0 0 24 24"><path fill="#F2B632" stroke="#1B1420" stroke-width="1.8" stroke-linejoin="round" d="M10.3 2h3.4l.5 2.6 1.9.8 2.2-1.5 2.4 2.4-1.5 2.2.8 1.9 2.6.5v3.4l-2.6.5-.8 1.9 1.5 2.2-2.4 2.4-2.2-1.5-1.9.8-.5 2.6h-3.4l-.5-2.6-1.9-.8-2.2 1.5-2.4-2.4 1.5-2.2-.8-1.9L2 13.7v-3.4l2.6-.5.8-1.9-1.5-2.2 2.4-2.4 2.2 1.5 1.9-.8zM12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z"/></svg>' }),
      ]),
      logo(di),
      h('div.spacer'),
      h('div.menu', null, [
        tourBtn, dailyBtn, derbyBtn,
        h('div.grid2', null, [shopB, albumB, lockerB, bookB]),
        h('div.links', null, [
          h('button', { text: 'How to play', on: { click: tap(function () { show('howto'); }) } }),
          h('button', { text: 'Settings', on: { click: tap(function () { show('settings'); }) } }),
        ]),
      ]),
    ]);
    // follow the colours of the park the title backdrop is showing (main rotates parks on the title)
    var lastPark = null;
    var sync = function () {
      var v = null;
      try { v = window.__bb && window.__bb.view && !inGameFlag ? window.__bb.view() : null; } catch (e) {}
      var p = v && v.scene === 'title' ? v.park : null;
      if (p && p !== lastPark) { lastPark = p; backdropInk = m.currentInkset(p); setInks(backdropInk); }
    };
    sync(); every(sync, 1000);
    return el;
  };

  function openDaily() { show('brief', { mode: 'daily', cfg: dailyCfg() }); }
  function openDerby() { show('brief', { mode: 'derby', cfg: derbyCfg() }); }

  // ---------------------------------------------------------------- tour map (Reels)
  SCREENS.tour = function () {
    var m = M(), T = m.tour();
    var total = 0; T.forEach(function (c) { total += c.games.length * 3; });
    var body = h('div.body');
    var el = h('div.scr.tourmap', null, [
      header('Barnstorm Tour', function () { show('title'); }, h('div.pill', null, [h('span', { html: star(true), style: 'display:flex' }), h('span', { text: m.tourStars() + '/' + total })])),
      body,
    ]);
    if (!T.length) {
      body.appendChild(h('div.card', null, [h('p', { text: 'The tour schedule is still being inked. Check back soon!' })]));
      return el;
    }
    var nextG = m.currentTourGame(), focus = null;
    T.forEach(function (ch, i) {
      var park = getPark(ch.park), unlocked = m.chapterUnlocked(i);
      var reel = h('div.reel' + (unlocked ? '' : '.locked'));
      scopeInks(reel, park ? inkById(park.inkset) : null);
      reel.appendChild(h('div.cover', null, [
        h('div.no', null, [h('small', { text: 'REEL' }), h('b', { text: String(i + 1) })]),
        h('h3', { text: ch.title }),
        h('div.park', { text: park ? park.name + ' · ' + park.town : '' }),
        h('div.blurb', { text: ch.blurb || '' }),
        unlocked ? h('div.tot', { text: m.chapterStars(i) + '/' + ch.games.length * 3 + '★' }) : null,
      ]));
      if (!unlocked) {
        var prev = T[i - 1], boss = prev && prev.games[prev.games.length - 1], bp = boss && getPitcher(boss.pitcher);
        reel.appendChild(h('div.lockmsg', null, [lockIcon(), h('span', { text: 'Beat ' + (bp ? bp.name + (bp.nick ? ' "' + bp.nick + '"' : '') : 'the boss') + ' in Reel ' + i + ' to roll this reel.' })]));
      } else {
        var ul = h('ul.games');
        ch.games.forEach(function (g, k) {
          var won = m.gameWon(g.id), open = m.gameUnlocked(g), isBoss = k === ch.games.length - 1;
          var li = h('li' + (won ? '.won' : '') + (open ? '' : '.locked') + (isBoss ? '.boss' : '') + (g === nextG && !won ? '.next' : ''), { role: 'button' }, [
            h('span.gstamp', { text: isBoss ? 'BOSS' : String(k + 1) }),
            h('span.gt', null, [h('b', { text: g.title }), h('span', { text: open ? (g.scenario && g.scenario.goal) || g.blurb || '' : 'Win the previous game to unlock' })]),
            open ? stars(m.gameStars(g)) : lockIcon(),
          ]);
          li.addEventListener('click', tap(function () {
            if (!open) { toast('Win the previous game to unlock this one.', 'error'); return; }
            show('brief', { mode: 'tour', cfg: g });
          }));
          if (g === nextG) focus = li;
          ul.appendChild(li);
        });
        reel.appendChild(ul);
      }
      body.appendChild(reel);
    });
    if (focus) later(function () { try { var r = focus.getBoundingClientRect(); if (r.top > window.innerHeight * 0.7) body.scrollTop += r.top - window.innerHeight * 0.4; } catch (e) {} }, 30);
    return el;
  };

  // ---------------------------------------------------------------- briefing
  SCREENS.brief = function (d) {
    var m = M(), mode = d.mode || 'tour', cfg = d.cfg || {};
    var sc = cfg.scenario || null;
    var pitcher = getPitcher(cfg.pitcher || (C() && C().DERBY_PITCHER)) || null;
    var park = getPark(cfg.park) || null;
    var ink = m.currentInkset(park);
    d.ink = ink;
    var at = mode === 'tour' ? m.locate(cfg) : null;
    var kicker, ttl, back;
    if (mode === 'tour') { kicker = at ? 'Reel ' + (at.ch + 1) + ' · Game ' + (at.k + 1) + (cfg.boss ? ' · Boss' : '') : 'Barnstorm Tour'; ttl = cfg.title || 'Tour game'; back = function () { show('tour'); }; }
    else if (mode === 'daily') { var di = m.dailyInfo(cfg.dayKey); kicker = 'Daily Derby · ' + di.dayKey; ttl = 'Daily Derby #' + di.number; back = function () { show('title'); }; }
    else { kicker = 'Endless Derby'; ttl = 'Home Run Derby'; back = function () { show('title'); }; }
    if (!sc && mode === 'derby') sc = { goal: 'Ten outs. Takes are free; any swing that isn\'t a home run is an out.', starText: ['3 HR', '6 HR', '10 HR'] };

    var body = h('div.body');
    var el = h('div.scr.brief', null, [header(mode === 'tour' ? 'Briefing' : (mode === 'daily' ? 'Daily Derby' : 'Derby'), back, coinPill()), body]);
    body.appendChild(h('div.kicker', { text: kicker }));
    body.appendChild(h('h2', { text: ttl }));

    // matchup: pitcher portrait + scouting report
    var pw = Math.min(140, Math.round(window.innerWidth * 0.36));
    var portrait = h('div.portrait', null, [art('drawPitcher', cnv(pw, Math.round(pw * 1.3)), pitcher || {}, { inkset: ink })]);
    var chips = h('div.chips');
    if (pitcher && pitcher.arsenal) {
      var arr = Object.keys(pitcher.arsenal).sort(function (a, b) { return pitcher.arsenal[b] - pitcher.arsenal[a]; });
      arr.forEach(function (k, i) {
        var nm = BB.Pitch && BB.Pitch.TYPES && BB.Pitch.TYPES[k] ? BB.Pitch.TYPES[k].name : k;
        chips.appendChild(h('span.chip' + (i === 0 ? '.hot' : ''), { text: nm + ' ' + Math.round(pitcher.arsenal[k] * 100) + '%' }));
      });
    }
    var spName = '';
    if (pitcher && BB.CardArt && BB.CardArt.speciesFor) { var sp = BB.CardArt.SPECIES[BB.CardArt.speciesFor(pitcher)]; spName = sp ? sp.name : ''; }
    body.appendChild(h('div.matchup', null, [
      h('div', { style: 'position:relative;flex:none' }, [portrait, h('span.vs', { text: 'VS' })]),
      h('div.pinfo', null, pitcher ? [
        h('div.nm', { text: pitcher.name }),
        h('div.nick', { text: (pitcher.nick ? '"' + pitcher.nick + '" · ' : '') + (spName ? spName + ' · ' : '') + (pitcher.hand === 'L' ? 'LHP' : 'RHP') + ' · ' + pitcher.velo + ' mph' }),
        chips,
        h('div.bio', { text: pitcher.bio || '' }),
      ] : [h('div.nm', { text: 'Mystery Arm' }), h('div.bio', { text: 'Scouting report unavailable.' })]),
    ]));
    if (park) {
      var sw = Math.min(window.innerWidth - 42, 420);
      body.appendChild(h('div.parkstrip', null, [art('drawPark', cnv(sw, Math.round(sw * 0.36)), park), h('span.lab', null, [h('small', { text: 'Greetings from' }), park.name])]));
    }
    var goal = h('div.goal.card', null, [h('div.sect', { style: 'margin-top:0', text: mode === 'tour' ? 'The Assignment' : 'House Rules' }), h('div.gtxt', { text: (sc && sc.goal) || cfg.blurb || '' })]);
    if (sc && (sc.starText || sc.stars)) {
      var have = mode === 'tour' ? m.gameStars(cfg) : mode === 'daily' ? ((m.dailyInfo(cfg.dayKey).result || {}).stars || 0) : 0;
      var ul = h('ul');
      for (var i = 0; i < 3; i++) {
        var txt = sc.starText ? sc.starText[i] : String(sc.stars[i]);
        ul.appendChild(h('li', null, [h('span', { html: star(i < have), style: 'display:flex' }), h('span', { text: txt })]));
      }
      goal.appendChild(ul);
    }
    if (mode === 'tour' && cfg.blurb) goal.appendChild(h('div.small.muted', { style: 'margin-top:8px;font-style:italic', text: cfg.blurb }));
    body.appendChild(goal);
    if (mode === 'daily') {
      var dI = m.dailyInfo(cfg.dayKey);
      body.appendChild(h('div.note', { text: dI.played
        ? 'Already played today (' + ((dI.result && dI.result.label) || dI.result.score) + '). Replays are just for fun — they don\'t count toward your score or streak.'
        : 'One scored attempt per day. Everyone gets the same pitches.' + (dI.streak ? ' Streak: ' + dI.streak + ' day' + (dI.streak > 1 ? 's' : '') + '.' : '') }));
    }
    if (mode === 'derby' && m.derbyBest()) body.appendChild(h('div.note', { text: 'Your best: ' + m.derbyBest() + ' HR' + (m.derby().bestDist ? ' · longest ' + m.derby().bestDist + ' ft' : '') + '. Beat it.' }));
    body.appendChild(h('div.note.plain', { text: 'Swinging ' + m.currentBat().name + '. Change bats in the Locker.' }));

    el.appendChild(h('div.foot', null, [btn('Play Ball!', 'big hot', function () { startGame(mode, cfg); })]));
    return el;
  };

  // ---------------------------------------------------------------- pause
  SCREENS.pause = function () {
    var s = M().settings();
    function tog(label, key) {
      return btn(label + (s[key] !== false ? ': ON' : ': OFF'), s[key] !== false ? 'on' : '', function () {
        M().setSetting(key, !(M().settings()[key] !== false));
        show('pause');
      });
    }
    return h('div.scr.overlay.pause', null, [
      h('div.center', null, [
        h('div.vwrap', null, h('div.vstamp', { text: 'TIME OUT!' })),
        btn('Resume', 'big primary', function () {
          if (BB.Game && BB.Game.resume) BB.Game.resume(); else { hideAll(); }
        }),
        btn('Restart', '', function () {
          if (lastStart) { try { M().startGame(lastStart.mode, lastStart.cfg); } catch (e) {} }
          if (BB.Game && BB.Game.restart) { hideAll(); BB.Game.restart(); }
          else if (lastStart) startGame(lastStart.mode, lastStart.cfg);
        }),
        btn('Quit to Menu', '', function () {
          if (BB.Game && BB.Game.quit) BB.Game.quit();
          if (cur === 'pause' || !cur) { inGame(false); show('title'); }
        }),
        h('div.toggles', null, [tog('Sound', 'sound'), tog('Music', 'music'), tog('Haptics', 'haptics'), tog('Read ring', 'assist')]),
      ]),
    ]);
  };

  // ---------------------------------------------------------------- results
  SCREENS.results = function (d) {
    var m = M(), mode = d.mode || 'tour', cfg = d.cfg || {}, res = d.result || {}, rw = d.rewards;
    if (!rw) { try { rw = m.endGame(mode, cfg, res); } catch (e) { rw = {}; } }
    rw = rw || {};
    var win = !!res.win;
    var body = h('div.body');
    var el = h('div.scr.results', null, [body]);

    var verdict;
    if (mode === 'tour') verdict = win ? 'WIN!' : 'NUTS!';
    else if (mode === 'daily') verdict = 'FINAL!';
    else verdict = rw.best ? 'RECORD!' : 'FINAL!';
    var good = win || mode !== 'tour' && (res.score > 0);
    var vwrap = h('div.vwrap', null, h('div.vstamp' + (good ? '.win' : '.lose'), { text: verdict }));
    body.appendChild(h('div.verdict', null, [
      vwrap,
      res.headline ? h('div.head', { text: res.headline }) : null,
      h('div.score', { text: res.scoreLabel || (res.score != null ? String(res.score) : '') }),
    ]));
    later(function () { sfx(good ? 'boing' : 'slide', good ? {} : { dir: 'down' }); haptic('thud'); if (good) burst(vwrap, 18, true); }, 260);

    var nStars = res.stars || 0;
    var starRow = h('div.bigstars');
    var starEls = [];
    for (var i = 0; i < 3; i++) { var sp = h('span', { html: star(false) }); starRow.appendChild(sp); starEls.push(sp); }
    body.appendChild(starRow);
    for (var j = 0; j < nStars; j++) (function (j) {
      later(function () { starEls[j].innerHTML = star(true); burst(starEls[j], 12, false); sfx('pop'); haptic('tap'); }, 750 + j * 420);
    })(j);

    var st = res.stats || {};
    var parts = [];
    if (st.hits != null) parts.push(st.hits + ' H');
    if (st.hr) parts.push(st.hr + ' HR');
    if (st.bb) parts.push(st.bb + ' BB');
    if (st.k) parts.push(st.k + ' K');
    if (st.longest) parts.push(Math.round(st.longest) + ' FT');
    if (st.maxEV) parts.push(Math.round(st.maxEV) + ' MPH');
    if (st.perfects) parts.push(st.perfects + ' PERFECT');
    if (parts.length) body.appendChild(h('div.statline', null, parts.map(function (p) { return h('span', { text: p }); })));

    if (mode === 'tour' && rw.starsBefore != null && nStars > rw.starsBefore && rw.starsBefore > 0) body.appendChild(h('div.statline.txt', null, h('span', { text: 'New best! (was ' + rw.starsBefore + '★)' })));
    if (mode === 'daily' && rw.daily) {
      body.appendChild(h('div.note', { style: 'text-align:center', text: rw.daily.replay
        ? 'Replay — today\'s scored attempt stands: ' + ((rw.daily.result && rw.daily.result.label) || '') + '.'
        : 'Daily Derby #' + rw.daily.number + ' logged. Streak: ' + rw.daily.streak + ' day' + (rw.daily.streak === 1 ? '' : 's') + (rw.daily.bestStreak > rw.daily.streak ? ' (best ' + rw.daily.bestStreak + ')' : '') + '.' }));
    }

    // rewards tally
    var tally = h('div.tally.card');
    tally.appendChild(h('div.sect', { style: 'margin-top:0', text: 'Payday' }));
    var lines = (rw.lines || []).slice();
    if (rw.newAch && rw.newAch.length) lines.push({ label: rw.newAch.length + ' stamp' + (rw.newAch.length > 1 ? 's' : ''), coins: rw.newAch.length * (m.ACH_COINS || 25), xp: 0 });
    var lineBox = h('div');
    tally.appendChild(lineBox);
    var ctot = h('span', { text: '0' });
    var lvBefore = rw.levelInfoBefore || m.levelInfo(), lvAfter = rw.levelInfo || m.levelInfo();
    var barI = h('i', { style: 'width:' + Math.round(lvBefore.frac * 100) + '%;transition:width .9s ease-out' });
    var lvLab = h('span.toon', { style: 'font-size:.95rem;padding-top:3px', text: 'LV ' + lvBefore.level });
    tally.appendChild(h('div.totals', null, [h('span.ctot', null, [coin(), ctot]), h('div.lvwrap', null, [lvLab, h('div.bar', null, barI)])]));
    tally.appendChild(h('div.small', { style: 'text-align:right;font-weight:700;margin-top:4px', text: '+' + (rw.xp || 0) + ' XP' }));
    body.appendChild(tally);
    var t0 = 1000 + nStars * 420;
    lines.forEach(function (l, i) {
      later(function () {
        lineBox.appendChild(h('div.ln', null, [h('span', { text: l.label }), h('span', { text: (l.coins ? '+' + l.coins + 'c' : '') + (l.xp ? '  +' + l.xp + 'xp' : '') })]));
        sfx('coin');
      }, t0 + i * 220);
    });
    var tEnd = t0 + lines.length * 220;
    later(function () {
      var target = rw.coins || 0, start = performance.now();
      var iv = every(function () {
        var f = Math.min(1, (performance.now() - start) / 700);
        ctot.textContent = '+' + fmt(target * U.easeOut(f));
        if (f >= 1) clearInterval(iv);
      }, 30);
      if ((rw.level || 0) > (rw.levelBefore || 0)) {
        barI.style.width = '100%';
        later(function () {
          barI.style.transition = 'none'; barI.style.width = '0%';
          lvLab.innerHTML = ''; lvLab.appendChild(h('span.lvup', { text: 'LEVEL ' + rw.level + '!' }));
          burst(lvLab, 10, false);
          sfx('levelUp'); haptic('thud');
          later(function () { barI.style.transition = 'width .7s ease-out'; barI.style.width = Math.round(lvAfter.frac * 100) + '%'; }, 60);
        }, 950);
      } else barI.style.width = Math.round(lvAfter.frac * 100) + '%';
    }, tEnd);

    // stamps + unlocks
    if (rw.newAch && rw.newAch.length) {
      var achBox = h('div.card', { style: 'margin-top:16px' }, [h('div.sect', { style: 'margin-top:0', text: 'New Stamps' })]);
      var list = h('div.achs');
      rw.newAch.forEach(function (a, i) {
        list.appendChild(h('div.achrow', { style: 'animation-delay:' + (tEnd + 300 + i * 250) / 1000 + 's' }, [h('span.astamp.sm', { text: a.mark || '★' }), h('span', null, [h('b', { text: a.name }), a.desc])]));
      });
      achBox.appendChild(list);
      body.appendChild(achBox);
    }
    if (rw.unlocks && rw.unlocks.length) {
      var ub = h('div.card', { style: 'margin-top:16px' }, [h('div.sect', { style: 'margin-top:0', text: 'Unlocked!' })]);
      var row = h('div.unl');
      rw.unlocks.forEach(function (u) { row.appendChild(h('span.chip', { text: (u.kind === 'bat' ? 'Bat: ' : u.kind === 'inkset' ? 'Uniform: ' : '') + u.name })); });
      ub.appendChild(row);
      body.appendChild(ub);
      later(function () { sfx('unlock'); }, tEnd + 400);
    }

    // daily share + countdown
    var foot = h('div.foot');
    if (mode === 'daily') {
      var cd = h('div.countdown');
      body.appendChild(cd);
      var tick = function () {
        var now = new Date(), mid = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        var s = Math.max(0, Math.floor((mid - now) / 1000));
        cd.innerHTML = '';
        add(cd, ['Next Daily Derby in ', h('b', { text: pad(Math.floor(s / 3600)) + ':' + pad(Math.floor(s / 60) % 60) + ':' + pad(s % 60) })]);
      };
      tick(); every(tick, 1000);
      var shareText = res.share || ((rw.daily && rw.daily.result && rw.daily.result.share) || buildShare(res, rw));
      foot.appendChild(btn('Share', 'primary', function () { share(shareText); }));
      foot.appendChild(btn('Menu', '', function () { show('title'); }));
    } else if (mode === 'tour') {
      var next = win ? m.nextTourGame(cfg) : null;
      if (next) foot.appendChild(btn('Next', 'primary', function () { show('brief', { mode: 'tour', cfg: next }); }));
      foot.appendChild(btn('Retry', next ? '' : 'primary', function () { startGame('tour', cfg); }));
      foot.appendChild(btn('Map', '', function () { show('tour'); }));
    } else {
      foot.appendChild(btn('Again', 'primary', function () { startGame('derby', derbyCfg()); }));
      foot.appendChild(btn('Menu', '', function () { show('title'); }));
    }
    el.appendChild(foot);
    return el;
  };
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function buildShare(res, rw) {
    var n = rw && rw.daily ? rw.daily.number : U.dayNumber(U.dayKey());
    var s = title() + ' · Daily Derby #' + n + '\n' + (res.scoreLabel || (res.score + ' HR'));
    var st = ''; for (var i = 0; i < 3; i++) st += i < (res.stars || 0) ? '★' : '☆';
    s += ' ' + st;
    if (rw && rw.daily && rw.daily.streak > 1) s += '\nStreak: ' + rw.daily.streak;
    return s;
  }
  function share(text) {
    var url = location.protocol.indexOf('http') === 0 ? location.href.split('#')[0].split('?')[0] : '';
    var full = text + (url ? '\n' + url : '');
    function copied() { toast('Copied to clipboard — paste it anywhere.', 'info'); }
    function legacy() {
      try {
        var ta = h('textarea', { style: 'position:fixed;top:-100px;opacity:0' }); ta.value = full; document.body.appendChild(ta);
        ta.select(); document.execCommand('copy'); document.body.removeChild(ta); copied();
      } catch (e) { toast('Could not copy. Screenshot it!', 'error'); }
    }
    function clip() {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(full).then(copied, legacy);
      else legacy();
    }
    if (navigator.share) {
      navigator.share({ text: full }).catch(function (e) { if (!e || e.name !== 'AbortError') clip(); });
    } else clip();
  }

  // ---------------------------------------------------------------- card shop
  SCREENS.shop = function () {
    var m = M(), pi = m.packInfo(), P = m.PACK;
    var body = h('div.body');
    var el = h('div.scr.shop', null, [header('Card Shop', function () { show('title'); }, coinPill()), body]);
    var stage = h('div.shopstage');
    stage.appendChild(packEl(pi.guaranteedNext));
    var buy = btn('Buy a Pack', 'big primary', function () { openPack(el); }, P.cost + ' coins · ' + P.size + ' cards + gum');
    if (!pi.canAfford) buy.classList.add('off');
    stage.appendChild(h('div', { style: 'width:100%;max-width:340px;margin-top:8px' }, buy));
    stage.appendChild(h('div.note', { style: 'text-align:center;max-width:320px;margin-top:4px', text: pi.guaranteedNext ? 'This pack is guaranteed RARE or better!' : 'Guaranteed RARE+ in ' + pi.guaranteedIn + ' packs (every ' + P.guaranteeEvery + 'rd pack).' }));
    stage.appendChild(h('div.odds', { html: 'Odds per card: common ' + Math.round(P.odds.common * 100) + '% · rare ' + Math.round(P.odds.rare * 100) + '% · foil ' + Math.round(P.odds.foil * 100) + '%<br>Ultra-rare MISPRINT variant: ' + (P.misprint * 100).toFixed(1) + '% per card<br>Dupes pay back ' + P.refund.common + ' / ' + P.refund.rare + ' / ' + P.refund.foil + ' coins' }));
    var a = m.albumStats();
    stage.appendChild(h('div.small', { style: 'font-weight:700', text: 'Album: ' + a.owned + '/' + a.total + ' · misprints ' + a.misprints + ' · sets ' + a.sets + '/6' }));
    body.appendChild(stage);
    return el;
  };
  function packEl(guaranteed) {
    return h('div.packwrap', null, [h('div.pack', null, [
      h('div.pk1', { text: title().toUpperCase() }),
      h('div.pk2', { text: 'BUBBLE GUM CARDS' }),
      h('div.pk3', { text: 'Series One · 3 cards' }),
      h('div.gum'),
    ]), guaranteed ? h('div.burst', { html: 'RARE+<br>INSIDE!' }) : null]);
  }
  function openPack(shopEl) {
    var m = M(), r = m.openPack();
    if (r.error) { toast('Not enough coins — ' + r.need + ' more. Win some games!', 'error'); audio('sfx', 'error'); return; }
    audio('sfx', 'packRip'); haptic('thud');
    var ov = h('div.opening');
    shopEl.appendChild(ov);
    var top = h('div.rip', { style: 'height:40px;width:196px;background:var(--a);border-top:3px solid var(--ink);clip-path:polygon(0 100%,4% 70%,9% 100%,15% 60%,22% 100%,30% 75%,38% 100%,47% 65%,55% 100%,63% 70%,72% 100%,80% 60%,88% 100%,95% 75%,100% 100%,100% 0,0 0)' });
    var low = h('div.packlow', null, packEl(r.guaranteed));
    ov.appendChild(top); ov.appendChild(low);
    var idx = 0;
    var cw = Math.min(250, Math.round(window.innerWidth * 0.62), Math.round((window.innerHeight - 260) / 1.4));
    var stageBox = h('div', { style: 'position:relative;display:flex;flex-direction:column;align-items:center;gap:12px' });
    var tagBox = h('div.reveal-tag');
    var hint = h('div.small', { style: 'font-weight:700', text: 'Tap the card to flip it' });
    later(function () {
      ov.innerHTML = '';
      ov.appendChild(h('div.stamp', { style: 'font-size:1rem', text: 'Card ' + (idx + 1) + ' of ' + r.cards.length }));
      ov.appendChild(stageBox);
      ov.appendChild(tagBox);
      ov.appendChild(hint);
      showCard();
    }, 900);
    function showCard() {
      var e = r.cards[idx];
      stageBox.innerHTML = ''; tagBox.innerHTML = '';
      ov.firstChild.textContent = 'Card ' + (idx + 1) + ' of ' + r.cards.length;
      var flip = h('div.flip', { style: 'width:' + cw + 'px;height:' + Math.round(cw * 1.4) + 'px' });
      var inner = h('div.in', { style: 'width:100%;height:100%' });
      var back = h('div.face.back', null, h('div.cardback', null, h('span', { html: title().toUpperCase().replace(/\s+/, '<br>') })));
      var front = h('div.face.front');
      inner.appendChild(back); inner.appendChild(front); flip.appendChild(inner);
      stageBox.appendChild(flip);
      var flipped = false;
      flip.addEventListener('click', function () {
        if (flipped) { next(); return; }
        flipped = true;
        front.appendChild(cardCanvas(e.card, cw, e.rarity));
        flip.classList.add('shown');
        sfx('cardFlip'); haptic('tap');
        var special = e.rarity !== 'common';
        if (special) {
          later(function () { sfx(e.misprint ? 'splat' : 'rare'); if (e.rarity === 'foil') sfx('twinkle', { dur: 0.8 }); haptic('buzz'); burst(stageBox, 20, true); }, 280);
          stageBox.insertBefore(h('div.fanfare' + (e.misprint ? '.misprint' : '')), stageBox.firstChild);
        }
        var tags = [];
        if (special) tags.push(h('span.t.' + e.rarity, { text: e.rarity === 'misprint' ? 'MISPRINT!!' : e.rarity === 'foil' ? 'FOIL!' : 'RARE!' }));
        tags.push(e.isNew ? h('span.t.new', { text: 'NEW!' }) : h('span.t.dupe', { text: 'DUPE +' + e.refund + 'c' }));
        add(tagBox, tags.map(function (t, i) { if (i) t.style.marginLeft = '8px'; return t; }));
        hint.textContent = idx < r.cards.length - 1 ? 'Tap for the next card' : 'Tap to finish';
      });
    }
    function next() {
      idx++;
      if (idx < r.cards.length) { showCard(); return; }
      // summary
      ov.innerHTML = '';
      ov.appendChild(h('div.stamp', { style: 'font-size:1.8rem;color:var(--mustard)', text: 'Pack Pulled!' }));
      var minis = h('div.minis');
      var mw = Math.min(104, Math.round((window.innerWidth - 60) / 3));
      r.cards.forEach(function (e) {
        minis.appendChild(h('div.cslot', null, [cardCanvas(e.card, mw, e.rarity), h('span.nm', { text: e.isNew ? 'NEW!' : 'dupe +' + e.refund + 'c' })]));
      });
      ov.appendChild(minis);
      if (r.refund) ov.appendChild(h('div.small', { style: 'font-weight:700', text: 'Duplicates paid back ' + r.refund + ' coins.' }));
      r.sets.forEach(function (s) {
        var rw = s.reward, nm = rw.kind === 'bat' ? (M().getBat(rw.id) || {}).name + ' bat' : inkById(rw.id).name + ' uniform';
        ov.appendChild(h('div.note', { style: 'color:var(--ink)', text: 'SET COMPLETE: ' + s.team.name + '! Unlocked the ' + nm + '.' }));
        sfx('unlock');
      });
      var row = h('div.row', { style: 'width:100%;max-width:360px' }, [
        btn('Another (' + M().PACK.cost + ')', 'primary', function () { ov.remove(); refreshShop(); openPack(curEl); }),
        btn('Album', '', function () { show('album'); }),
      ]);
      if (M().coins() < M().PACK.cost) row.firstChild.classList.add('off');
      ov.appendChild(row);
      var done = btn('Done', '', function () { show('shop'); });
      done.style.maxWidth = '360px';
      ov.appendChild(done);
    }
    function refreshShop() { var pill = shopEl.querySelector('.hdr .pill span'); if (pill) pill.textContent = fmt(M().coins()); }
    refreshShop();
  }

  // ---------------------------------------------------------------- album
  var albumTeam = 0;
  SCREENS.album = function (d) {
    var m = M(), a = m.albumStats();
    if (d && d.team != null) albumTeam = d.team;
    var body = h('div.body');
    var el = h('div.scr.album', null, [header('Album', function () { show('title'); }, h('div.pill', { text: a.owned + '/' + a.total })), body]);
    var tabs = h('div.tabs');
    m.TEAMS.forEach(function (t, i) {
      var b = h('button.tab' + (i === albumTeam ? '.on' : '') + (m.teamComplete(i) ? '.done' : ''), null, [h('span', { text: t.short }), h('small', { text: a.byTeam[i] + '/12' })]);
      b.addEventListener('click', tap(function () { albumTeam = i; show('album'); }));
      tabs.appendChild(b);
    });
    body.appendChild(tabs);
    var team = m.TEAMS[albumTeam];
    var teamBox = h('div');
    scopeInks(teamBox, inkById(team.inkset));
    teamBox.appendChild(h('div.teamhead', null, [h('span.sw'), h('span.tn', { text: team.name })]));
    var rwd = m.SET_REWARDS[albumTeam], rname = rwd.kind === 'bat' ? 'the ' + (m.getBat(rwd.id) || {}).name + ' bat' : 'the ' + inkById(rwd.id).name + ' uniform';
    var done = m.teamComplete(albumTeam);
    teamBox.appendChild(h('div.setnote' + (done ? '.done' : ''), null, [h('span.astamp.sm' + (done ? '' : '.off'), { text: 'SET' }), h('span', { text: (done ? 'Set complete! Unlocked ' : 'Complete the set to unlock ') + rname + '.' })]));
    var grid = h('div.cgrid');
    var cw = Math.floor((Math.min(window.innerWidth, 520) - 32 - 20 - 6) / 3);
    var queue = [];
    m.CARDS.filter(function (c) { return c.teamIdx === albumTeam; }).forEach(function (c) {
      var n = m.owned(c.id), mp = m.misprints(c.id);
      var slot = h('div.cslot');
      if (n) {
        var holder = h('div', { style: 'width:' + cw + 'px;height:' + Math.round(cw * 1.4) + 'px' });
        queue.push(function () { holder.appendChild(cardCanvas(c, cw)); });
        slot.appendChild(holder);
        if (n > 1) slot.appendChild(h('span.cnt', { text: 'x' + n }));
        if (mp) slot.appendChild(h('span.mp', { text: 'ERR' }));
        slot.appendChild(h('span.nm', { text: c.rarity === 'common' ? (c.speciesName || c.posName) : c.rarity.toUpperCase() + ' · ' + (c.speciesName || c.pos) }));
        slot.addEventListener('click', tap(function () { cardModal(el, c); }));
      } else {
        slot.appendChild(h('div.empty', { style: 'width:' + cw + 'px;height:' + Math.round(cw * 1.4) + 'px', text: '#' + ('00' + c.no).slice(-3) }));
        slot.appendChild(h('span.nm.dim', { text: c.posName }));
      }
      grid.appendChild(slot);
    });
    teamBox.appendChild(grid);
    body.appendChild(teamBox);
    // draw a few per frame so the screen appears instantly
    (function pump() { var k = 0; while (queue.length && k++ < 4) queue.shift()(); if (queue.length) requestAnimationFrame(pump); })();
    return el;
  };
  function cardModal(parent, c) {
    var m = M(), mp = m.misprints(c.id), showMis = false;
    var w = Math.min(260, Math.round(window.innerWidth * 0.66), Math.round((window.innerHeight - 320) / 1.4));
    var md = h('div.modal');
    scopeInks(md, inkById(c.inkset));
    var holder = h('div');
    function draw() { holder.innerHTML = ''; holder.appendChild(cardCanvas(c, w, showMis ? 'misprint' : null)); }
    draw();
    md.appendChild(holder);
    md.appendChild(h('div.info', null, [
      h('b', { text: c.name }),
      h('p', { style: 'font-weight:700', text: (c.nick ? '"' + c.nick + '" · ' : '') + (c.speciesName ? c.speciesName + ' · ' : '') + c.posName + ' · #' + c.number }),
      h('p', { style: 'font-weight:600', text: c.team + ' · ' + c.stat }),
      h('p', { style: 'font-style:italic', text: c.flavor }),
      h('p', { style: 'font-size:.72rem', text: c.rarity.toUpperCase() + ' · card ' + ('00' + c.no).slice(-3) + '/072 · owned x' + m.owned(c.id) + (mp ? ' · misprint x' + mp : '') }),
    ]));
    var row = h('div.row', { style: 'width:100%;max-width:340px' });
    if (mp) row.appendChild(btn('Misprint', '', function () { showMis = !showMis; draw(); }));
    row.appendChild(btn('Close', 'primary', function () { md.remove(); }));
    md.appendChild(row);
    md.addEventListener('click', function (e) { if (e.target === md) md.remove(); });
    parent.appendChild(md);
  }

  // ---------------------------------------------------------------- locker (bats + uniforms)
  var lockerTab = 'bats';
  SCREENS.locker = function () {
    var m = M();
    var body = h('div.body');
    var el = h('div.scr.locker', null, [header('Locker', function () { show('title'); }, coinPill()), body]);
    var tabs = h('div.tabs.two', null, [
      h('button.tab' + (lockerTab === 'bats' ? '.on' : ''), { text: 'Bats', on: { click: tap(function () { lockerTab = 'bats'; show('locker'); }) } }),
      h('button.tab' + (lockerTab === 'inks' ? '.on' : ''), { text: 'Uniforms', on: { click: tap(function () { lockerTab = 'inks'; show('locker'); }) } }),
    ]);
    body.appendChild(tabs);
    var bw = Math.min(window.innerWidth - 70, 430);
    if (lockerTab === 'bats') {
      var curBat = m.currentBat().id;
      m.BATS.forEach(function (b) {
        var open = m.batUnlocked(b.id), eq = b.id === curBat, fresh = open && b.id !== 'b_hickory' && !m.isSeen('bat:' + b.id);
        var card = h('div.card.item' + (eq ? '.eq' : '') + (open ? '' : '.locked'));
        card.appendChild(h('div.ihead', null, [h('b', { text: b.name }), eq ? h('span.eqtag', { text: 'IN HAND' }) : null, fresh ? h('span.newtag', { text: 'NEW' }) : null]));
        card.appendChild(art('drawBat', cnv(bw, 52), b, { inkset: artInk }));
        card.appendChild(h('div.desc', { text: b.desc }));
        card.appendChild(meters(b));
        if (open) {
          if (!eq) card.addEventListener('click', tap(function () {
            m.equipBat(b.id); sfx('boing'); toast(b.name + ' is in your hands.', 'info'); show('locker');
          }));
          if (fresh) m.markSeen('bat:' + b.id);
        } else {
          var rule = b.unlock, lr = h('div.lockrow', null, [lockIcon(), h('span', { style: 'flex:1', text: m.condText(rule) })]);
          if (rule.kind === 'coins') lr.appendChild(btn('Buy', 'primary', function () {
            var r = m.buy('bat', b.id);
            if (r.error) toast('Need ' + fmt(r.need) + ' more coins.', 'error');
            else { sfx('unlock'); m.equipBat(b.id); toast('Bought ' + b.name + '!', 'unlock'); show('locker'); }
          }));
          card.appendChild(lr);
        }
        body.appendChild(card);
      });
    } else {
      var choice = m.inksetChoice();
      var grid = h('div.igrid');
      var tiles = [{ id: 'park', name: 'Home Colours', park: true }].concat(BB.INKSETS);
      var tw = Math.floor((Math.min(window.innerWidth, 520) - 32 - 12) / 2) - 22;
      tiles.forEach(function (s) {
        var open = m.inksetUnlocked(s.id), eq = choice === s.id, fresh = open && s.id !== 'park' && s.id !== 'classic' && !m.isSeen('inkset:' + s.id);
        var tile = h('div.card.itile.item' + (eq ? '.eq' : '') + (open ? '' : '.locked'));
        if (s.park) {
          var strip = h('div.pstrip', { style: 'display:grid;grid-template-columns:repeat(6,1fr);overflow:hidden;height:' + Math.round(tw * 0.62) + 'px;width:' + tw + 'px' });
          ((C() && C().PARKS) || BB.INKSETS).slice(0, 6).forEach(function (p) {
            var k = scheme(p.a ? p : inkById(p.inkset));
            strip.appendChild(h('div', { style: 'background:linear-gradient(' + k.a + ' 0 40%,' + k.b + ' 40% 70%,' + k.c + ' 70%)' }));
          });
          tile.appendChild(strip);
        } else tile.appendChild(art('drawInkset', cnv(tw, Math.round(tw * 0.62)), s));
        tile.appendChild(h('div.ihead', null, [h('b', { text: s.name }), eq ? h('span.eqtag', { text: 'ON' }) : null, fresh ? h('span.newtag', { text: 'NEW' }) : null]));
        tile.appendChild(h('div.desc', { text: m.INK_DESC[s.id] || '' }));
        if (open) {
          if (!eq) tile.addEventListener('click', tap(function () { m.equipInkset(s.id); sfx('boing'); setInks(menuInk()); show('locker'); }));
          if (fresh) m.markSeen('inkset:' + s.id);
        } else tile.appendChild(h('div.lockrow', null, [lockIcon(), h('span', { text: m.condText(m.inksetRule(s.id)) })]));
        grid.appendChild(tile);
      });
      body.appendChild(grid);
      body.appendChild(h('div.note', { text: 'Your uniform colours the whole show: menus, cards and Rocco\'s threads. "Home Colours" lets every park dress you in its own colours.' }));
    }
    return el;
  };
  function meters(b) {
    function bar(v, lo, hi, key) {
      var f = U.clamp((v - lo) / (hi - lo), 0.04, 1), base = U.clamp((({ timing: 1, power: 1, lift: 0 })[key] - lo) / (hi - lo), 0, 1);
      return h('div.meter', null, [h('i', { style: 'width:' + Math.round(f * 100) + '%' }), h('span.mid', { style: 'left:' + Math.round(base * 100) + '%' })]);
    }
    return h('div.meters', null, [
      h('span', { text: 'TIMING' }), bar(b.timing, 0.6, 1.5, 'timing'),
      h('span', { text: 'POWER' }), bar(b.power, 0.86, 1.14, 'power'),
      h('span', { text: 'LIFT' }), bar(b.lift, -6, 10, 'lift'),
    ]);
  }

  // ---------------------------------------------------------------- scorebook
  SCREENS.book = function () {
    var m = M(), st = m.stats(), di = m.dailyInfo(), list = m.achList();
    var body = h('div.body');
    var el = h('div.scr.book', null, [header('Scorebook', function () { show('title'); }), body]);
    var avg = st.swings ? (st.hits / Math.max(1, st.swings)).toFixed(3).replace(/^0/, '') : '.000';
    body.appendChild(h('div.bigfig', null, [
      h('div', null, [h('b', { text: fmt(st.hr) }), 'home runs']),
      h('div', null, [h('b', { text: st.longest ? st.longest + '′' : '—' }), 'longest']),
      h('div', null, [h('b', { text: st.maxEV ? st.maxEV : '—' }), 'top mph']),
    ]));
    body.appendChild(h('div.sect', { text: 'Lifetime' }));
    var rows = [
      ['Games played', st.games], ['Wins', st.wins], ['Pitches seen', st.pitches], ['Swings', st.swings],
      ['Hits', st.hits], ['Singles / 2B / 3B', st.singles + ' / ' + st.doubles + ' / ' + st.triples], ['Walks', st.bb], ['Strikeouts', st.k],
      ['Runs driven', st.runs], ['PERFECT swings', st.perfects], ['Hits per swing', avg], ['Best hit streak', st.bestStreak],
      ['Times On Fire', st.onFire], ['Total HR distance', fmt(st.hrDist) + ' ft'], ['Tour stars', m.tourStars()],
      ['Derby best', m.derbyBest() + ' HR'], ['Coins earned', fmt(st.coinsEarned)], ['Level', m.levelInfo().level],
    ];
    var led = h('div.ledger');
    rows.forEach(function (r) { led.appendChild(h('span', { text: r[0] })); led.appendChild(h('span', { text: String(r[1]) })); });
    body.appendChild(led);

    body.appendChild(h('div.sect', { text: 'Daily Derby' }));
    body.appendChild(h('div.small', { style: 'font-weight:600;margin-bottom:10px', text: 'Streak ' + di.streak + ' · best streak ' + (di.bestStreak || 0) + ' · best score ' + (di.best || 0) + ' HR' }));
    var strip = h('div.strip');
    m.dailyHistory(14).forEach(function (d) {
      var isToday = d.dayKey === di.dayKey, p = d.result;
      var dd = d.dayKey.split('-');
      strip.appendChild(h('div.day' + (p ? '.played' : '.miss') + (isToday ? '.today' : ''), null, [
        h('span', { text: (+dd[1]) + '/' + (+dd[2]) }),
        h('b', { text: p ? String(p.score) : d.number > 0 ? '·' : '' }),
      ]));
    });
    body.appendChild(strip);

    var earned = list.filter(function (a) { return a.earned; }).length;
    body.appendChild(h('div.sect', { text: 'Stamps ' + earned + '/' + list.length }));
    var grid = h('div.stampgrid');
    list.forEach(function (a) {
      var cell = h('div.cell', null, [h('span.astamp' + (a.earned ? '' : '.off'), { text: a.earned ? a.mark : '?' }), h('span' + (a.earned ? '' : '.muted'), { text: a.name })]);
      cell.addEventListener('click', tap(function () { toast(a.name + ' — ' + a.desc + (a.earned ? ' ✓' : ''), a.earned ? 'ach' : 'info'); }, true));
      grid.appendChild(cell);
    });
    body.appendChild(grid);
    return el;
  };

  // ---------------------------------------------------------------- settings
  SCREENS.settings = function () {
    var m = M(), s = m.settings();
    var body = h('div.body');
    var el = h('div.scr.settings', null, [header('Settings', function () { show('title'); }), body]);
    function toggle(key, label, sub) {
      var on = s[key] !== false;
      var t = h('button.tog' + (on ? '.on' : ''), { 'aria-label': label }, [h('b', { text: on ? 'ON' : 'OFF' }), h('i')]);
      var row = h('div.set', null, [h('div.lab', null, [h('b', { text: label }), h('span', { text: sub })]), t]);
      row.addEventListener('click', tap(function () { m.setSetting(key, !on); if (key === 'music') { menuMusic = false; if (on) audio('organ', 'stop'); } show('settings'); }));
      return row;
    }
    body.appendChild(toggle('sound', 'Sound', 'Bat cracks, crowd, slide whistles.'));
    body.appendChild(toggle('music', 'Music', 'The pit band in the menus.'));
    body.appendChild(toggle('haptics', 'Haptics', 'Buzz on contact (where supported).'));
    body.appendChild(toggle('assist', 'Pitch-read ring', 'Shows where the pitch will cross the plate. Turn off for hard mode.'));

    body.appendChild(h('div.sect', { text: 'Timing calibration' }));
    var val = h('b.toon', { text: s.latencyMs + ' ms' });
    var slider = h('input.slider', { type: 'range', min: 0, max: 150, step: 5, value: s.latencyMs });
    slider.addEventListener('input', function () { val.textContent = slider.value + ' ms'; });
    slider.addEventListener('change', function () { m.setSetting('latencyMs', +slider.value); sfx('tap'); });
    body.appendChild(h('div.row', null, [h('span.small', { style: 'flex:1;font-weight:600', text: 'Touch latency compensation' }), val]));
    body.appendChild(slider);
    body.appendChild(h('div.small', { text: 'Screens and fingers lag a little. If your on-time swings keep coming up LATE, slide right; if they read EARLY, slide left. Default 30 ms.' }));
    var beat = h('div.beat'), out = h('span.small', { style: 'flex:1;font-weight:600', text: 'Or tap along: 8 beats, tap the big dot each time it flashes.' });
    var testBtn = btn('Tap test', '', function () { runTapTest(beat, out, slider, val); });
    testBtn.style.width = 'auto';
    body.appendChild(h('div.calib', null, [beat, out]));
    body.appendChild(h('div', { style: 'margin-top:12px' }, testBtn));

    body.appendChild(h('div.sect', { text: 'Help' }));
    body.appendChild(btn('How to play', '', function () { show('howto', { from: 'settings' }); }));

    body.appendChild(h('div.sect', { text: 'Danger zone' }));
    var armed = false, reset = btn('Reset progress', 'danger', function () {
      if (!armed) { armed = true; reset.firstChild.textContent = 'Tap again to erase everything'; later(function () { armed = false; reset.firstChild.textContent = 'Reset progress'; }, 3500); return; }
      m.resetProgress(); toast('Fresh scorebook. Good luck out there.', 'info'); show('title');
    });
    body.appendChild(reset);
    body.appendChild(h('div.small', { style: 'margin-top:16px;text-align:center', text: title() + ' · ' + (BB.Save.persistent() ? 'Progress is saved on this device.' : 'Private browsing: progress will not be saved after you close this tab.') + ' · v' + BB.VERSION }));
    return el;
  };
  function runTapTest(beat, out, slider, val) {
    var n = 8, period = 700, t0 = performance.now() + 600, offs = [];
    function flash() { beat.classList.add('on'); sfx('tap'); setTimeout(function () { beat.classList.remove('on'); }, 110); }
    for (var i = 0; i < n; i++) later(flash, 600 + i * period);
    out.textContent = 'Tap the dot on each flash...';
    function onTap(e) {
      e.preventDefault();
      var t = (e.timeStamp && e.timeStamp > 1e3 ? e.timeStamp : performance.now()) - t0;
      var beatIdx = Math.round(t / period);
      if (beatIdx < 0 || beatIdx >= n) return;
      offs.push(t - beatIdx * period);
      beat.style.transform = 'scale(.9)'; setTimeout(function () { beat.style.transform = ''; }, 80);
    }
    beat.addEventListener('pointerdown', onTap);
    later(function () {
      beat.removeEventListener('pointerdown', onTap);
      if (offs.length < 4) { out.textContent = 'Not enough taps — try again.'; return; }
      offs.sort(function (a, b) { return a - b; });
      var med = offs[Math.floor(offs.length / 2)];
      var ms = U.clamp(Math.round(med / 5) * 5, 0, 150);
      M().setSetting('latencyMs', ms); slider.value = ms; val.textContent = ms + ' ms';
      out.textContent = 'You tap ' + Math.round(med) + ' ms after the flash. Set to ' + ms + ' ms.';
      sfx('unlock');
    }, 600 + n * period + 400);
  }

  // ---------------------------------------------------------------- how to play (Rocco shows you)
  var HOWTO = [
    { pose: 'tap', t: 'Tap to swing!', p: 'The pitcher winds up and lets it fly. Tap anywhere the moment the ball reaches the plate. Early pulls it to left, late pushes it to right.' },
    { pose: 'hold', t: 'Hold to load!', p: 'Press and hold during the windup to coil a power swing, then let go to swing. Smaller timing window, a whole lot more pop.' },
    { pose: 'take', t: 'Lay off!', p: 'Pitches outside the box are hard to hit. Let them go by — four balls is a walk. The ring shows where the ball will cross.' },
  ];
  SCREENS.howto = function (d) {
    var i = (d && d.page) || 0, P = HOWTO[i], last = i === HOWTO.length - 1;
    var from = d && d.from;
    function done() { M().markHowToSeen(); show(from === 'settings' ? 'settings' : 'title'); }
    var pips = h('div.pips'); HOWTO.forEach(function (_, k) { pips.appendChild(h('i' + (k === i ? '.on' : ''))); });
    var sz = Math.max(150, Math.min(290, Math.round(window.innerWidth * 0.74), Math.round(window.innerHeight * 0.38)));
    var el = h('div.scr.howto', null, [
      h('div.hdr', null, [h('div.ttl', null, h('span', { text: 'How to Hit' })), h('button.back.skip', { text: 'SKIP', on: { click: tap(done) } })]),
      h('div.panel', null, [
        h('span.num', { text: (i + 1) + ' / ' + HOWTO.length }),
        h('div.ill', null, rocco(sz, sz, P.pose, true)),
        h('h2', { text: P.t }),
        h('p', { text: P.p }),
      ]),
      pips,
      h('div.foot', null, [
        i > 0 ? btn('Back', '', function () { show('howto', { page: i - 1, from: from }); }) : null,
        btn(last ? 'Let\'s go!' : 'Next', 'primary', function () { if (last) done(); else show('howto', { page: i + 1, from: from }); }),
      ]),
    ]);
    // swipe between panels
    var sx = null;
    el.addEventListener('pointerdown', function (e) { sx = e.clientX; });
    el.addEventListener('pointerup', function (e) {
      if (sx == null) return; var dx = e.clientX - sx; sx = null;
      if (dx < -60 && !last) show('howto', { page: i + 1, from: from }); else if (dx > 60 && i > 0) show('howto', { page: i - 1, from: from });
    });
    return el;
  };

  // ------------------------------------------------------------------ init
  function init() {
    root = document.getElementById('ui');
    if (!root) { root = h('div', { id: 'ui' }); document.body.appendChild(root); }
    ghostEl = document.getElementById('ghost');
    screensEl = document.getElementById('screens') || root.appendChild(h('div', { id: 'screens' }));
    if (!ghostEl) { ghostEl = h('div', { id: 'ghost' }); root.insertBefore(ghostEl, screensEl.nextSibling); } // after #screens in the DOM, under it on screen
    toastsEl = document.getElementById('toasts') || root.appendChild(h('div', { id: 'toasts' }));
    pauseBtn = document.getElementById('pausebtn');
    if (!pauseBtn) { pauseBtn = h('button.pausebtn', { id: 'pausebtn', 'aria-label': 'Pause' }, [h('span'), h('span')]); root.appendChild(pauseBtn); }
    pauseBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      sfx('tap');
      if (BB.Game && BB.Game.pause) BB.Game.pause();
      show('pause');
    });
    pauseBtn.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    // remember where the finger went down: the next screen irises open from there
    document.addEventListener('pointerdown', function (e) { lastTap = { x: Math.round(e.clientX), y: Math.round(e.clientY), t: performance.now() }; }, true);
    // first gesture unlocks audio (iOS) and starts the menu music
    var unlock = function () {
      if (audioUnlocked) return;
      audioUnlocked = true;
      audio('unlock');
      if (!inGameFlag && cur && cur !== 'results' && cur !== 'pause') startMenuMusic();
    };
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('touchend', unlock, true);
    // no pinch / double-tap zoom, no rubber-band on the page itself
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
    document.addEventListener('touchmove', function (e) {
      var t = e.target;
      while (t && t !== document.body) { if (t.classList && (t.classList.contains('body') || t.classList.contains('slider'))) return; t = t.parentNode; }
      if (e.cancelable) e.preventDefault();
    }, { passive: false });
    // redraw art once the web fonts arrive (canvas lettering uses Luckiest Guy / Fredoka) and the 3D card portraits load
    var redrawAll = function () { redraws.forEach(function (f) { try { f(); } catch (e) {} }); };
    if (BB.CardArt && BB.CardArt.onPortraits) BB.CardArt.onPortraits(redrawAll);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(redrawAll);
      try { Promise.all([document.fonts.load('20px "Luckiest Guy"'), document.fonts.load('600 20px Fredoka')]).then(redrawAll, function () {}); } catch (e) {}
    }
    window.addEventListener('resize', function () { if (cur && cur !== 'results' && cur !== 'pause' && cur !== 'shop' && !inGameFlag) refresh(); });
    setInks(menuInk());
    if (!M().seenHowTo()) show('howto'); else show('title');
    // without the game engine there is no loop to paint the title backdrop: paint it here if the renderer exists
    if (!BB.Game && BB.Render && BB.Render.init) {
      try {
        var cv = document.getElementById('game'); BB.Render.init(cv);
        var t0 = performance.now();
        var loop = function (now) {
          if (BB.Game) return;
          if (BB.Render.resize) BB.Render.resize(window.innerWidth, window.innerHeight, dpr());
          var P = C() && C().PARKS;
          BB.Render.frame({ scene: 'title', time: (now - t0) / 1000, park: P ? P[0] : null, hud: null });
          requestAnimationFrame(loop);
        };
        if (BB.Render.setInks) BB.Render.setInks(menuInk());
        requestAnimationFrame(loop);
      } catch (e) { console.error('title backdrop', e); }
    }
  }

  BB.UI = {
    init: init,
    show: show,
    hideAll: hideAll,
    toast: toast,
    inGame: inGame,
    setInks: setInks,                 // main may call this when the title backdrop changes colours
    current: function () { return cur; },
    refresh: refresh,
    startGame: startGame,
    _fallbackArt: FB,
  };
})();
