// 56-ui.js — every menu: DOM screens over the game canvas, riso-zine styled with CSS (see shell.head.html).
// Owned by the meta agent. Talks to BB.Meta for data, BB.Game to start/pause/quit, BB.CardArt for drawings
// (with built-in fallbacks), BB.Audio for clicks and fanfares. Main calls show('results', ...), toast(), inGame(),
// hideAll(). Everything is guarded so a missing module never breaks a screen.
(function () {
  var U = BB.U;
  var root, screensEl, pauseBtn, toastsEl;
  var cur = null, curData = null, curEl = null, inGameFlag = false;
  var redraws = [], timers = [], intervals = [];
  var audioUnlocked = false, menuMusic = false, lastStart = null, artInk = null;

  function M() { return BB.Meta; }
  function C() { return BB.Content || null; }
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
  function mis(text, cls, tag) { return h((tag || 'span') + '.mis' + (cls ? '.' + cls : ''), { 'data-t': text, text: text }); }
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
  var STAR_PATH = 'M12 2.2l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8L12 17.4l-6.1 3.4 1.4-6.8L2.2 9.3l6.9-.8z';
  function star(on, extra) { return '<svg class="star' + (on ? ' on' : '') + (extra || '') + '" viewBox="0 0 24 24"><path d="' + STAR_PATH + '"/></svg>'; }
  function stars(n, max) { var s = ''; for (var i = 0; i < (max || 3); i++) s += star(i < n); return h('span.stars', { html: s }); }
  function coin() { return h('i.coin'); }
  function lockIcon() {
    return h('span', { html: '<svg class="lock" viewBox="0 0 22 26"><path d="M5 11V7a6 6 0 0 1 12 0v4" fill="none" stroke="currentColor" stroke-width="2.6"/><rect x="1.5" y="11" width="19" height="13.5" rx="2" fill="currentColor"/><circle cx="11" cy="17.5" r="2.2" fill="var(--paper)"/></svg>' });
  }
  function header(title, backFn, right) {
    return h('div.hdr', null, [
      backFn ? h('button.back', { 'aria-label': 'Back', text: '←', on: { click: tap(backFn) } }) : null,
      h('div.ttl' + (title.length > 11 ? '.long' : ''), null, mis(title)),
      right || null,
    ]);
  }
  function coinPill() { return h('div.pill', null, [coin(), h('span', { text: fmt(M().coins()) })]); }

  // ------------------------------------------------------------------ inks
  function setInks(ink) {
    ink = ink || BB.INKSETS[0];
    artInk = ink;
    var s = document.documentElement.style;
    s.setProperty('--ink-a', ink.a); s.setProperty('--ink-b', ink.b); s.setProperty('--ink-c', ink.c); s.setProperty('--paper', ink.paper || BB.INKS.paper);
    var meta = document.querySelector('meta[name=theme-color]'); if (meta) meta.setAttribute('content', ink.paper || BB.INKS.paper);
  }
  function scopeInks(elm, ink) {
    if (!ink) return elm;
    elm.style.setProperty('--ink-a', ink.a); elm.style.setProperty('--ink-b', ink.b); elm.style.setProperty('--ink-c', ink.c);
    elm.style.setProperty('--paper', ink.paper || BB.INKS.paper);
    return elm;
  }
  function menuInk() {
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
    return art('draw', c, obj);
  }

  // Fallback drawings: simple, riso-flavoured, used when BB.CardArt is missing or throws.
  var FB = (function () {
    function ctx(c) { var x = c.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); return x; }
    function dots(x, w, hgt, col, step, r) {
      x.fillStyle = col;
      for (var yy = step / 2; yy < hgt; yy += step) for (var xx = ((yy / step) % 2 ? step / 2 : 0) + step / 2; xx < w; xx += step) { x.beginPath(); x.arc(xx, yy, r, 0, 7); x.fill(); }
    }
    function inks(o) { return o && o.inkset ? (typeof o.inkset === 'string' ? inkById(o.inkset) : o.inkset) : artInk || M().currentInkset(null); }
    return {
      draw: function (c, card) {
        var x = ctx(c), w = c.width, hh = c.height, ink = inks(card), s = w / 100;
        var mp = card.rarity === 'misprint';
        x.fillStyle = ink.paper; x.fillRect(0, 0, w, hh);
        x.globalCompositeOperation = 'multiply';
        var slot = ink[card.teamColorSlot || 'a'] || ink.a;
        dots(x, w, hh * 0.72, ink.c, 5 * s, 1.6 * s);
        var off = mp ? 6 * s : 1.2 * s;
        // figure
        [[mp ? ink.a : ink.b, 0], [mp ? ink.b : ink.a, off]].forEach(function (p, i) {
          x.fillStyle = p[0];
          x.beginPath(); x.arc(50 * s + p[1], 42 * s + p[1] * .5, 13 * s, 0, 7); if (i) x.fill(); else { x.fillRect(28 * s, 60 * s, 44 * s, 40 * s); }
          if (i) { x.fillRect(36 * s + p[1], 25 * s, 28 * s, 8 * s); }
        });
        x.fillStyle = slot; x.fillRect(0, hh - 30 * s, w, 30 * s);
        x.strokeStyle = ink.a; x.lineWidth = 3 * s; x.strokeRect(4 * s, 4 * s, w - 8 * s, hh - 8 * s);
        x.globalCompositeOperation = 'source-over';
        x.fillStyle = ink.paper; x.font = 'bold ' + Math.round(8.5 * s) + 'px ' + BB.FONTS.display; x.textAlign = 'center';
        x.fillText((card.name || '').toUpperCase().slice(0, 18), w / 2, hh - 17 * s);
        x.font = 'bold ' + Math.round(7 * s) + 'px ' + BB.FONTS.body;
        x.fillText(card.pos + ' · #' + card.number, w / 2, hh - 8 * s);
        if (card.rarity !== 'common') { x.fillStyle = ink.a; x.font = Math.round(9 * s) + 'px ' + BB.FONTS.display; x.textAlign = 'left'; x.fillText(card.rarity === 'misprint' ? 'ERR' : card.rarity === 'foil' ? 'FOIL' : 'RARE', 9 * s, 17 * s); }
      },
      drawBat: function (c, bat) {
        var x = ctx(c), w = c.width, hh = c.height, ink = inks(null), look = bat.look || {};
        x.clearRect(0, 0, w, hh);
        var wood = look.wood === 'dark' ? ink.a : look.wood === 'gold' ? ink.c : look.wood === 'ink' ? ink.b : ink.c;
        function shape(dx, dy) {
          x.beginPath(); var m = hh / 2 + dy;
          x.moveTo(w * .06 + dx, m - hh * .1); x.lineTo(w * .45 + dx, m - hh * .09);
          x.quadraticCurveTo(w * .7 + dx, m - hh * .3, w * .94 + dx, m - hh * .28);
          x.arc(w * .94 + dx, m, hh * .28, -Math.PI / 2, Math.PI / 2);
          x.quadraticCurveTo(w * .7 + dx, m + hh * .3, w * .45 + dx, m + hh * .09);
          x.lineTo(w * .06 + dx, m + hh * .1); x.closePath();
        }
        x.globalCompositeOperation = 'multiply';
        shape(0, 0); x.fillStyle = wood; x.fill();
        x.fillStyle = ink[look.tape || 'a']; x.fillRect(w * .07, hh / 2 - hh * .11, w * .16, hh * .22);
        x.beginPath(); x.arc(w * .05, hh / 2, hh * .16, 0, 7); x.fillStyle = ink.a; x.fill();
        shape(2, 2); x.strokeStyle = ink.a; x.lineWidth = Math.max(2, hh * .04); x.stroke();
        x.globalCompositeOperation = 'source-over';
      },
      drawInkset: function (c, ink) {
        var x = ctx(c), w = c.width, hh = c.height;
        x.fillStyle = ink.paper || BB.INKS.paper; x.fillRect(0, 0, w, hh);
        x.globalCompositeOperation = 'multiply';
        var r = Math.min(w, hh) * .3;
        [[ink.a, .36, .42], [ink.b, .54, .58], [ink.c, .66, .4]].forEach(function (p) { x.fillStyle = p[0]; x.beginPath(); x.arc(w * p[1], hh * p[2], r, 0, 7); x.fill(); });
        x.globalCompositeOperation = 'source-over';
      },
      drawPitcher: function (c, p) {
        var x = ctx(c), w = c.width, hh = c.height, ink = inks(null), s = w / 100;
        x.fillStyle = ink.paper; x.fillRect(0, 0, w, hh);
        x.globalCompositeOperation = 'multiply';
        dots(x, w, hh, ink.c, 6 * s, 2.2 * s);
        x.fillStyle = ink.a; x.beginPath(); x.moveTo(12 * s, hh); x.quadraticCurveTo(50 * s, hh * .5, 88 * s, hh); x.fill();
        x.beginPath(); x.arc(50 * s, hh * .42, 20 * s, 0, 7); x.fillStyle = ink.b; x.fill();
        x.fillStyle = ink.a; x.fillRect(28 * s, hh * .26, 44 * s, 10 * s); x.fillRect(50 * s, hh * .3, 30 * s, 5 * s);
        x.globalCompositeOperation = 'source-over';
        x.fillStyle = ink.paper; x.font = Math.round(18 * s) + 'px ' + BB.FONTS.display; x.textAlign = 'center';
        x.fillText(String((p && p.look && p.look.number) || ''), 50 * s, hh * .9);
      },
      drawPark: function (c, park) {
        var x = ctx(c), w = c.width, hh = c.height, ink = park && park.inkset ? inkById(park.inkset) : inks(null);
        x.fillStyle = ink.paper; x.fillRect(0, 0, w, hh);
        x.globalCompositeOperation = 'multiply';
        dots(x, w, hh * .55, ink.c, 6 * dpr(), 2 * dpr());
        x.fillStyle = ink.a; x.beginPath(); x.moveTo(w * .5, hh * 1.05); x.lineTo(-w * .1, hh * .45); x.quadraticCurveTo(w * .5, hh * .1, w * 1.1, hh * .45); x.closePath(); x.fill();
        x.fillStyle = ink.b; x.beginPath(); x.moveTo(w * .5, hh * .98); x.lineTo(w * .38, hh * .78); x.lineTo(w * .5, hh * .6); x.lineTo(w * .62, hh * .78); x.closePath(); x.fill();
        x.globalCompositeOperation = 'source-over';
      },
    };
  })();

  // ------------------------------------------------------------------ toasts
  function toast(text, kind) {
    if (!toastsEl) return;
    kind = kind || 'info';
    var label = { ach: 'STAMPED', unlock: 'UNLOCKED', error: 'HOLD UP', info: 'NOTE', coins: '+COINS', level: 'LEVEL UP' }[kind] || 'NOTE';
    var t = String(text || '');
    if (kind === 'ach') t = t.replace(/^STAMPED:\s*/i, '');
    var e = h('div.toast.' + kind, null, [h('span.tk', { text: label }), h('span', { text: t })]);
    toastsEl.appendChild(e);
    while (toastsEl.children.length > 3) toastsEl.removeChild(toastsEl.firstChild);
    if (kind !== 'ach') sfx('toast');
    setTimeout(function () { e.classList.add('out'); setTimeout(function () { if (e.parentNode) e.parentNode.removeChild(e); }, 320); }, kind === 'error' ? 2200 : 2800);
  }
  M() && M().onAchievement && M().onAchievement(function (a) {
    // achievements earned outside a game (packs, equips) toast here; in-game ones are toasted by main
    if (!inGameFlag && cur !== 'results') later(function () { toast(a.name, 'ach'); sfx('unlock'); }, 250);
  });

  // ------------------------------------------------------------------ screen management
  function show(name, data) {
    if (!SCREENS[name]) { console.warn('UI.show: unknown screen ' + name); name = 'title'; }
    clearTimers();
    redraws = [];
    var el;
    try { el = SCREENS[name](data || {}); }
    catch (e) { console.error('UI screen ' + name, e); el = SCREENS.title({}); name = 'title'; }
    screensEl.innerHTML = '';
    screensEl.appendChild(el);
    cur = name; curData = data || {}; curEl = el;
    document.body.classList.toggle('paused', name === 'pause');
    if (name !== 'pause' && name !== 'results') {
      if (!inGameFlag) setInks(name === 'brief' && data && data.ink ? data.ink : menuInk());
      startMenuMusic();
    }
    return el;
  }
  function hideAll() {
    clearTimers();
    screensEl.innerHTML = '';
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
  function refresh() { if (cur && cur !== 'results' && cur !== 'pause') show(cur, curData); }

  // ------------------------------------------------------------------ starting games
  function startGame(mode, cfg) {
    if (!BB.Game || typeof BB.Game.start !== 'function') { toast('The press is still warming up — game engine not loaded.', 'error'); return; }
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
  SCREENS.title = function () {
    var m = M(), lv = m.levelInfo(), di = m.dailyInfo(), g = m.currentTourGame(), at = g && m.locate(g);
    var unseen = BB.Meta.BATS.filter(function (b) { return b.id !== 'b_hickory' && m.batUnlocked(b.id) && !m.isSeen('bat:' + b.id); }).length +
      BB.INKSETS.filter(function (s) { return s.id !== 'classic' && m.inksetUnlocked(s.id) && !m.isSeen('inkset:' + s.id); }).length;
    var album = m.albumStats(), ach = m.achList().filter(function (a) { return a.earned; }).length;

    var tourSub = at ? 'Issue ' + (at.ch + 1) + ' · Game ' + (at.k + 1) + ' — ' + g.title + ' · ' + m.tourStars() + '★' : 'Six parks, thirty games';
    var dailySub = di.played ? 'Played ✓ ' + (di.result && di.result.label ? di.result.label : '') + ' · streak ' + di.streak
      : (di.streak ? 'Keep your ' + di.streak + '-day streak alive!' : 'Same pitches for everyone today');
    var derbyBest = m.derbyBest();

    var tourBtn = btn(h('span.lab', null, [h('span', { text: 'Barnstorm Tour' }), h('span.chev', { text: '▶' })]), 'big primary', function () { show('tour'); }, tourSub);
    var dailyBtn = btn(h('span.lab', null, [h('span', { text: 'Daily Derby #' + di.number }), !di.played ? h('span.dot-live') : null]), 'big', function () { openDaily(); }, dailySub);
    var derbyBtn = btn(h('span.lab', null, [h('span', { text: 'Endless Derby' })]), 'big', function () { openDerby(); }, derbyBest ? 'Best: ' + derbyBest + ' HR' : 'Ten outs. Only homers count.');

    var shopB = btn('Card Shop', '', function () { show('shop'); });
    if (m.packInfo().canAfford) shopB.appendChild(h('span.badge', { text: '!' }));
    var albumB = btn('Album', '', function () { show('album'); }, album.owned + '/' + album.total);
    var lockerB = btn('Locker', '', function () { show('locker'); });
    if (unseen) lockerB.appendChild(h('span.badge', { text: String(unseen) }));
    var bookB = btn('Scorebook', '', function () { show('book'); }, ach + '/' + m.ACH.length + ' stamps');

    var el = h('div.scr.clear.title', null, [
      h('div.top', null, [
        h('div.lvl', null, [h('span.num', { text: 'LV ' + lv.level }), h('div.bar', null, h('i', { style: 'width:' + Math.round(lv.frac * 100) + '%' }))]),
        coinPill(),
        h('button.iconbtn', { 'aria-label': 'Settings', on: { click: tap(function () { show('settings'); }) },
          html: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M10.3 2h3.4l.5 2.6 1.9.8 2.2-1.5 2.4 2.4-1.5 2.2.8 1.9 2.6.5v3.4l-2.6.5-.8 1.9 1.5 2.2-2.4 2.4-2.2-1.5-1.9.8-.5 2.6h-3.4l-.5-2.6-1.9-.8-2.2 1.5-2.4-2.4 1.5-2.2-.8-1.9L2 13.7v-3.4l2.6-.5.8-1.9-1.5-2.2 2.4-2.4 2.2 1.5 1.9-.8zM12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2z"/></svg>' }),
      ]),
      h('div.mast', null, [
        h('span.l1', { text: 'HALFTONE' }),
        mis('HARDBALL', 'l2 flip'),
        h('span.tag', { text: 'A one-tap batting zine' }),
        h('span.no', { html: 'NO.<br>' + di.number }),
      ]),
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
    return el;
  };

  function openDaily() {
    var cfg = dailyCfg();
    show('brief', { mode: 'daily', cfg: cfg });
  }
  function openDerby() { show('brief', { mode: 'derby', cfg: derbyCfg() }); }

  // ---------------------------------------------------------------- tour map
  SCREENS.tour = function () {
    var m = M(), T = m.tour();
    var total = 0; T.forEach(function (c) { total += c.games.length * 3; });
    var body = h('div.body');
    var el = h('div.scr.tourmap', null, [
      header('Barnstorm Tour', function () { show('title'); }, h('div.pill', null, [h('span', { html: star(true) }), h('span', { text: m.tourStars() + '/' + total })])),
      body,
    ]);
    if (!T.length) {
      body.appendChild(h('div.card', null, [h('p', { text: 'The tour schedule is still at the printer. Check back soon!' })]));
      return el;
    }
    var nextG = m.currentTourGame(), focus = null;
    T.forEach(function (ch, i) {
      var park = getPark(ch.park), unlocked = m.chapterUnlocked(i);
      var ink = park ? inkById(park.inkset) : null;
      var issue = h('div.issue' + (unlocked ? '' : '.locked'));
      scopeInks(issue, ink);
      issue.appendChild(h('div.cover', null, [
        h('div.no', null, [h('small', { text: 'ISSUE' }), h('b', { text: String(i + 1) })]),
        h('h3', null, mis(ch.title)),
        h('div.park', { text: park ? park.name + ' · ' + park.town : '' }),
        h('div.blurb', { text: ch.blurb || '' }),
        unlocked ? h('div.tot', { text: m.chapterStars(i) + '/' + ch.games.length * 3 + '★' }) : null,
      ]));
      if (!unlocked) {
        var prev = T[i - 1], boss = prev && prev.games[prev.games.length - 1], bp = boss && getPitcher(boss.pitcher);
        issue.appendChild(h('div.lockmsg', null, [lockIcon(), h('span', { text: 'Beat ' + (bp ? bp.name + (bp.nick ? ' "' + bp.nick + '"' : '') : 'the boss') + ' in Issue ' + i + ' to open this issue.' })]));
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
        issue.appendChild(ul);
      }
      body.appendChild(issue);
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
    var kicker, title, back;
    if (mode === 'tour') { kicker = at ? 'Issue ' + (at.ch + 1) + ' · Game ' + (at.k + 1) + (cfg.boss ? ' · Boss' : '') : 'Barnstorm Tour'; title = cfg.title || 'Tour game'; back = function () { show('tour'); }; }
    else if (mode === 'daily') { var di = m.dailyInfo(cfg.dayKey); kicker = 'Daily Derby · ' + di.dayKey; title = 'Daily Derby #' + di.number; back = function () { show('title'); }; }
    else { kicker = 'Endless Derby'; title = 'Home Run Derby'; back = function () { show('title'); }; }
    if (!sc && mode === 'derby') sc = { goal: 'Ten outs. Takes are free; any swing that isn\'t a home run is an out.', starText: ['3 HR', '6 HR', '10 HR'] };

    var body = h('div.body');
    var el = h('div.scr.brief', null, [header(mode === 'tour' ? 'Briefing' : title, back, coinPill()), body]);
    body.appendChild(h('div.kicker', { text: kicker }));
    body.appendChild(h('h2', null, mis(title)));

    // matchup: pitcher portrait + scouting report
    var pw = Math.min(140, Math.round(window.innerWidth * 0.36));
    var portrait = h('div.portrait', null, [art('drawPitcher', cnv(pw, Math.round(pw * 1.3)), pitcher || {}), pitcher && pitcher.boss ? h('span.bossmark', { text: 'BOSS' }) : null]);
    var chips = h('div.chips');
    if (pitcher && pitcher.arsenal) {
      var arr = Object.keys(pitcher.arsenal).sort(function (a, b) { return pitcher.arsenal[b] - pitcher.arsenal[a]; });
      arr.forEach(function (k, i) {
        var nm = BB.Pitch && BB.Pitch.TYPES && BB.Pitch.TYPES[k] ? BB.Pitch.TYPES[k].name : k;
        chips.appendChild(h('span.chip' + (i === 0 ? '.hot' : ''), { text: nm + ' ' + Math.round(pitcher.arsenal[k] * 100) + '%' }));
      });
    }
    body.appendChild(h('div.matchup', null, [
      portrait,
      h('div.pinfo', null, pitcher ? [
        h('div.nm', { text: pitcher.name }),
        h('div.nick', { text: (pitcher.nick ? '"' + pitcher.nick + '" · ' : '') + (pitcher.hand === 'L' ? 'LHP' : 'RHP') + ' · ' + pitcher.velo + ' mph' }),
        chips,
        h('div.bio', { text: pitcher.bio || '' }),
      ] : [h('div.nm', { text: 'Mystery Arm' }), h('div.bio', { text: 'Scouting report unavailable.' })]),
    ]));
    if (park) {
      var sw = Math.min(window.innerWidth - 40, 420);
      body.appendChild(h('div.parkstrip', null, [art('drawPark', cnv(sw, Math.round(sw * 0.34)), park), h('span.lab', { text: park.name })]));
    }
    var goal = h('div.goal.card', null, [h('div.sect', { style: 'margin-top:0', text: mode === 'tour' ? 'The Assignment' : 'Rules' }), h('div.gtxt', { text: (sc && sc.goal) || cfg.blurb || '' })]);
    if (sc && (sc.starText || sc.stars)) {
      var have = mode === 'tour' ? m.gameStars(cfg) : mode === 'daily' ? ((m.dailyInfo(cfg.dayKey).result || {}).stars || 0) : 0;
      var ul = h('ul');
      for (var i = 0; i < 3; i++) {
        var txt = sc.starText ? sc.starText[i] : String(sc.stars[i]);
        ul.appendChild(h('li', null, [h('span', { html: star(i < have) }), h('span', { text: txt })]));
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
    body.appendChild(h('div.note', { style: 'border-color:var(--ink-a);border-style:dotted', text: 'Swinging ' + m.currentBat().name + '. Change bats in the Locker.' }));

    el.appendChild(h('div.foot', null, [btn('Play Ball!', 'big hot', function () { startGame(mode, cfg); })]));
    return el;
  };

  // ---------------------------------------------------------------- pause
  SCREENS.pause = function () {
    var s = M().settings();
    function tog(label, key) {
      var b = btn(label + (s[key] !== false ? ': ON' : ': OFF'), s[key] !== false ? 'on' : '', function () {
        M().setSetting(key, !(M().settings()[key] !== false));
        show('pause');
      });
      return b;
    }
    return h('div.scr.overlay.pause', null, [
      h('div.center', null, [
        h('div.vstamp.worn', { text: 'TIME OUT' }),
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
    if (mode === 'tour') verdict = win ? 'WIN!' : 'LOSS';
    else if (mode === 'daily') verdict = 'FINAL';
    else verdict = rw.best ? 'RECORD!' : 'FINAL';
    var good = win || mode !== 'tour' && (res.score > 0);
    body.appendChild(h('div.verdict', null, [
      h('div.vstamp.worn.' + (good ? 'win' : 'lose'), { text: verdict }),
      res.headline ? h('div.head', null, mis(res.headline)) : null,
      h('div.score', { text: res.scoreLabel || (res.score != null ? String(res.score) : '') }),
    ]));
    later(function () { sfx('stamp'); haptic('thud'); }, 180);

    var nStars = res.stars || 0;
    var starRow = h('div.bigstars');
    var starEls = [];
    for (var i = 0; i < 3; i++) { var sp = h('span', { html: star(false) }); starRow.appendChild(sp); starEls.push(sp); }
    body.appendChild(starRow);
    for (var j = 0; j < nStars; j++) (function (j) {
      later(function () { starEls[j].innerHTML = star(true); sfx('stamp'); haptic('tap'); }, 650 + j * 420);
    })(j);

    var st = res.stats || {};
    var parts = [];
    if (st.hits != null) parts.push(st.hits + ' H');
    if (st.hr) parts.push(st.hr + ' HR');
    if (st.bb) parts.push(st.bb + ' BB');
    if (st.k) parts.push(st.k + ' K');
    if (st.longest) parts.push('long ' + Math.round(st.longest) + ' ft');
    if (st.maxEV) parts.push('max ' + Math.round(st.maxEV) + ' mph');
    if (st.perfects) parts.push(st.perfects + ' perfect');
    if (parts.length) body.appendChild(h('div.statline', null, parts.map(function (p) { return h('span', { text: p }); })));

    if (mode === 'tour' && rw.starsBefore != null && nStars > rw.starsBefore && rw.starsBefore > 0) body.appendChild(h('div.statline', { text: 'New best! (was ' + rw.starsBefore + '★)' }));
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
    var lvLab = h('span.stamp', { style: 'font-size:.9rem', text: 'LV ' + lvBefore.level });
    tally.appendChild(h('div.totals', null, [h('span.ctot', null, [coin(), ctot]), h('div.lvwrap', null, [lvLab, h('div.bar', null, barI)])]));
    var xpLab = h('div.small', { style: 'text-align:right;font-weight:700;margin-top:4px', text: '+' + (rw.xp || 0) + ' XP' });
    tally.appendChild(xpLab);
    body.appendChild(tally);
    var t0 = 900 + nStars * 420;
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
          sfx('levelUp'); haptic('thud');
          later(function () { barI.style.transition = 'width .7s ease-out'; barI.style.width = Math.round(lvAfter.frac * 100) + '%'; }, 60);
        }, 950);
      } else barI.style.width = Math.round(lvAfter.frac * 100) + '%';
    }, tEnd);

    // stamps + unlocks
    if (rw.newAch && rw.newAch.length) {
      var achBox = h('div.card', { style: 'margin-top:14px' }, [h('div.sect', { style: 'margin-top:0', text: 'New Stamps' })]);
      var list = h('div.achs');
      rw.newAch.forEach(function (a, i) {
        list.appendChild(h('div.achrow', { style: 'animation-delay:' + (tEnd + 300 + i * 250) / 1000 + 's' }, [h('span.astamp.sm.worn', { text: a.mark || '★' }), h('span', null, [h('b', { text: a.name }), a.desc])]));
      });
      achBox.appendChild(list);
      body.appendChild(achBox);
    }
    if (rw.unlocks && rw.unlocks.length) {
      var ub = h('div.card', { style: 'margin-top:14px' }, [h('div.sect', { style: 'margin-top:0', text: 'Unlocked' })]);
      var row = h('div.unl');
      rw.unlocks.forEach(function (u) { row.appendChild(h('span.chip', { text: (u.kind === 'bat' ? 'Bat: ' : u.kind === 'inkset' ? 'Inks: ' : '') + u.name })); });
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
    var s = 'Halftone Hardball · Daily Derby #' + n + '\n' + (res.scoreLabel || (res.score + ' HR'));
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
    var pack = packEl(pi.guaranteedNext);
    stage.appendChild(pack);
    var buy = btn('Buy Pack', 'big primary', function () { openPack(el); }, P.cost + ' coins · ' + P.size + ' cards');
    if (!pi.canAfford) buy.classList.add('off');
    stage.appendChild(h('div', { style: 'width:100%;max-width:340px;margin-top:6px' }, buy));
    stage.appendChild(h('div.note', { style: 'text-align:center;max-width:320px', text: pi.guaranteedNext ? 'This pack is guaranteed RARE or better!' : 'Guaranteed RARE+ in ' + pi.guaranteedIn + ' packs (every ' + P.guaranteeEvery + 'rd pack).' }));
    stage.appendChild(h('div.odds', { html: 'Odds per card: common ' + Math.round(P.odds.common * 100) + '% · rare ' + Math.round(P.odds.rare * 100) + '% · foil ' + Math.round(P.odds.foil * 100) + '%<br>Ultra-rare MISPRINT variant: ' + (P.misprint * 100).toFixed(1) + '% per card<br>Dupes pay back ' + P.refund.common + ' / ' + P.refund.rare + ' / ' + P.refund.foil + ' coins' }));
    var a = m.albumStats();
    stage.appendChild(h('div.small', { style: 'font-weight:700', text: 'Album: ' + a.owned + '/' + a.total + ' · misprints ' + a.misprints + ' · sets ' + a.sets + '/6' }));
    body.appendChild(stage);
    return el;
  };
  function packEl(guaranteed) {
    return h('div.packwrap', null, h('div.pack', null, [
      h('div.pk1', { html: 'HALFTONE<br>HARDBALL' }),
      h('div.pk2', { text: 'SERIES ONE' }),
      h('div.pk3', { text: '3 riso-printed cards' }),
      guaranteed ? h('div.burst', { html: 'RARE+<br>INSIDE' }) : null,
    ]));
  }
  function openPack(shopEl) {
    var m = M(), r = m.openPack();
    if (r.error) { toast('Not enough coins — ' + r.need + ' more. Win some games!', 'error'); audio('sfx', 'error'); return; }
    audio('sfx', 'packRip'); haptic('thud');
    var ov = h('div.opening');
    shopEl.appendChild(ov);
    var top = h('div.rip', { style: 'height:40px;width:190px;background:var(--ink-a);clip-path:polygon(0 100%,4% 70%,9% 100%,15% 60%,22% 100%,30% 75%,38% 100%,47% 65%,55% 100%,63% 70%,72% 100%,80% 60%,88% 100%,95% 75%,100% 100%,100% 0,0 0)' });
    var low = h('div.packlow', null, packEl(r.guaranteed));
    ov.appendChild(top); ov.appendChild(low);
    var idx = 0;
    var cw = Math.min(250, Math.round(window.innerWidth * 0.62), Math.round((window.innerHeight - 260) / 1.4));
    var stageBox = h('div', { style: 'position:relative;display:flex;flex-direction:column;align-items:center;gap:12px' });
    var tagBox = h('div.reveal-tag');
    var hint = h('div.small', { style: 'font-weight:700', text: 'Tap the card to flip' });
    later(function () {
      ov.innerHTML = '';
      ov.appendChild(h('div.stamp', { style: 'font-size:.9rem', text: 'Card ' + (idx + 1) + ' of ' + r.cards.length }));
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
      var back = h('div.face.back', null, h('div.cardback', null, h('span', { html: 'HALFTONE<br>HARDBALL' })));
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
          later(function () { sfx('rare'); haptic('buzz'); }, 260);
          stageBox.insertBefore(h('div.fanfare' + (e.misprint ? '.misprint' : '')), stageBox.firstChild);
        }
        var tags = [];
        if (special) tags.push(h('span.t.' + e.rarity, { text: e.rarity === 'misprint' ? 'MISPRINT!!' : e.rarity === 'foil' ? 'FOIL!' : 'RARE' }));
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
      ov.appendChild(h('div.stamp', { style: 'font-size:1.3rem' }, mis('Pack Pulled!')));
      var minis = h('div.minis');
      var mw = Math.min(104, Math.round((window.innerWidth - 60) / 3));
      r.cards.forEach(function (e) {
        minis.appendChild(h('div.cslot', null, [cardCanvas(e.card, mw, e.rarity), h('span.nm', { text: e.isNew ? 'NEW' : 'dupe +' + e.refund + 'c' })]));
      });
      ov.appendChild(minis);
      if (r.refund) ov.appendChild(h('div.small', { style: 'font-weight:700', text: 'Duplicates paid back ' + r.refund + ' coins.' }));
      r.sets.forEach(function (s) {
        var rw = s.reward, nm = rw.kind === 'bat' ? (M().getBat(rw.id) || {}).name + ' bat' : inkById(rw.id).name + ' inks';
        ov.appendChild(h('div.note', { text: 'SET COMPLETE: ' + s.team.name + '! Unlocked ' + nm + '.' }));
        sfx('unlock');
      });
      var row = h('div.row', { style: 'width:100%;max-width:360px' }, [
        btn('Another (' + M().PACK.cost + ')', 'primary', function () { ov.remove(); refreshShop(); openPack(curEl); }),
        btn('Album', '', function () { show('album'); }),
      ]);
      if (M().coins() < M().PACK.cost) row.firstChild.classList.add('off');
      ov.appendChild(row);
      ov.appendChild(btn('Done', 'ghost', function () { show('shop'); }));
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
    teamBox.appendChild(h('div.sect', { style: 'margin-top:4px' }, mis(team.name)));
    var rwd = m.SET_REWARDS[albumTeam], rname = rwd.kind === 'bat' ? (m.getBat(rwd.id) || {}).name + ' (bat)' : inkById(rwd.id).name + ' (inks)';
    var done = m.teamComplete(albumTeam);
    teamBox.appendChild(h('div.setnote' + (done ? '.done' : ''), null, [h('span.astamp.sm' + (done ? '' : '.off'), { text: 'SET' }), h('span', { text: (done ? 'Set complete! Unlocked ' : 'Complete the set to unlock ') + rname + '.' })]));
    var grid = h('div.cgrid');
    var cw = Math.floor((Math.min(window.innerWidth, 520) - 28 - 20) / 3);
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
        slot.appendChild(h('span.nm', { text: c.name }));
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
    var w = Math.min(260, Math.round(window.innerWidth * 0.66), Math.round((window.innerHeight - 300) / 1.4));
    var md = h('div.modal');
    scopeInks(md, inkById(c.inkset));
    var holder = h('div');
    function draw() { holder.innerHTML = ''; holder.appendChild(cardCanvas(c, w, showMis ? 'misprint' : null)); }
    draw();
    md.appendChild(holder);
    md.appendChild(h('div.info', null, [
      h('b', { text: c.name }),
      h('p', { style: 'font-weight:700', text: (c.nick ? '"' + c.nick + '" · ' : '') + c.posName + ' · #' + c.number + ' · ' + c.team }),
      h('p', { style: 'font-weight:700', text: c.stat }),
      h('p', { style: 'font-style:italic', text: c.flavor }),
      h('p', { text: c.rarity.toUpperCase() + ' · card ' + ('00' + c.no).slice(-3) + '/072 · owned x' + m.owned(c.id) + (mp ? ' · misprint x' + mp : '') }),
    ]));
    var row = h('div.row', { style: 'width:100%;max-width:340px' });
    if (mp) row.appendChild(btn('Misprint', '', function () { showMis = !showMis; draw(); }));
    row.appendChild(btn('Close', 'primary', function () { md.remove(); }));
    md.appendChild(row);
    md.addEventListener('click', function (e) { if (e.target === md) md.remove(); });
    parent.appendChild(md);
  }

  // ---------------------------------------------------------------- locker
  var lockerTab = 'bats';
  SCREENS.locker = function () {
    var m = M();
    var body = h('div.body');
    var el = h('div.scr.locker', null, [header('Locker', function () { show('title'); }, coinPill()), body]);
    var tabs = h('div.tabs.two', null, [
      h('button.tab' + (lockerTab === 'bats' ? '.on' : ''), { text: 'Bats', on: { click: tap(function () { lockerTab = 'bats'; show('locker'); }) } }),
      h('button.tab' + (lockerTab === 'inks' ? '.on' : ''), { text: 'Ink Sets', on: { click: tap(function () { lockerTab = 'inks'; show('locker'); }) } }),
    ]);
    body.appendChild(tabs);
    var bw = Math.min(window.innerWidth - 60, 440);
    if (lockerTab === 'bats') {
      var curBat = m.currentBat().id;
      m.BATS.forEach(function (b) {
        var open = m.batUnlocked(b.id), eq = b.id === curBat, fresh = open && b.id !== 'b_hickory' && !m.isSeen('bat:' + b.id);
        var card = h('div.card.item' + (eq ? '.eq' : '') + (open ? '' : '.locked'));
        card.appendChild(h('div.ihead', null, [h('b', { text: b.name }), eq ? h('span.eqtag', { text: 'EQUIPPED' }) : null, fresh ? h('span.newtag', { text: 'NEW' }) : null]));
        card.appendChild(art('drawBat', cnv(bw, 54), b));
        card.appendChild(h('div.desc', { text: b.desc }));
        card.appendChild(meters(b));
        if (open) {
          if (!eq) card.addEventListener('click', tap(function () {
            m.equipBat(b.id); toast(b.name + ' is in your hands.', 'info'); show('locker');
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
      var tiles = [{ id: 'park', name: 'Park Press', park: true }].concat(BB.INKSETS);
      var tw = Math.floor((Math.min(window.innerWidth, 520) - 28 - 12) / 2) - 22;
      tiles.forEach(function (s) {
        var open = m.inksetUnlocked(s.id), eq = choice === s.id, fresh = open && s.id !== 'park' && s.id !== 'classic' && !m.isSeen('inkset:' + s.id);
        var tile = h('div.card.itile.item' + (eq ? '.eq' : '') + (open ? '' : '.locked'));
        if (s.park) {
          var strip = h('div', { style: 'display:grid;grid-template-columns:repeat(6,1fr);height:' + Math.round(tw * 0.62) + 'px;width:' + tw + 'px' });
          ((C() && C().PARKS) || BB.INKSETS).slice(0, 6).forEach(function (p) {
            var ink = p.a ? p : inkById(p.inkset);
            strip.appendChild(h('div', { style: 'background:linear-gradient(' + ink.a + ' 0 34%,' + ink.b + ' 34% 67%,' + ink.c + ' 67%)' }));
          });
          tile.appendChild(strip);
        } else tile.appendChild(art('drawInkset', cnv(tw, Math.round(tw * 0.62)), s));
        tile.appendChild(h('div.ihead', null, [h('b', { text: s.name }), eq ? h('span.eqtag', { text: 'ON' }) : null, fresh ? h('span.newtag', { text: 'NEW' }) : null]));
        tile.appendChild(h('div.desc', { text: m.INK_DESC[s.id] || '' }));
        if (open) {
          if (!eq) tile.addEventListener('click', tap(function () { m.equipInkset(s.id); setInks(menuInk()); show('locker'); }));
          if (fresh) m.markSeen('inkset:' + s.id);
        } else tile.appendChild(h('div.lockrow', null, [lockIcon(), h('span', { text: m.condText(m.inksetRule(s.id)) })]));
        grid.appendChild(tile);
      });
      body.appendChild(grid);
      body.appendChild(h('div.note', { text: 'Your press colours the whole game: menus, ballparks and cards in play. "Park Press" lets each park print in its own house inks.' }));
    }
    return el;
  };
  function meters(b) {
    function bar(v, lo, hi) {
      var f = U.clamp((v - lo) / (hi - lo), 0.04, 1), base = U.clamp((({ timing: 1, power: 1, lift: 0 })[arguments[3]] - lo) / (hi - lo), 0, 1);
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
    body.appendChild(h('div.small', { style: 'font-weight:700;margin-bottom:8px', text: 'Streak ' + di.streak + ' · best streak ' + (di.bestStreak || 0) + ' · best score ' + (di.best || 0) + ' HR' }));
    var strip = h('div.strip');
    m.dailyHistory(14).forEach(function (d) {
      var isToday = d.dayKey === di.dayKey, p = d.result;
      var dd = d.dayKey.split('-');
      strip.appendChild(h('div.day' + (p ? '.played' : '.miss') + (isToday ? '.today' : ''), null, [
        h('span', { style: 'position:relative', text: (+dd[1]) + '/' + (+dd[2]) }),
        h('b', { style: 'position:relative', text: p ? String(p.score) : d.number > 0 ? '·' : '' }),
      ]));
    });
    body.appendChild(strip);

    var earned = list.filter(function (a) { return a.earned; }).length;
    body.appendChild(h('div.sect', { text: 'Stamps ' + earned + '/' + list.length }));
    var grid = h('div.stampgrid');
    list.forEach(function (a) {
      var cell = h('div.cell', null, [h('span.astamp' + (a.earned ? '.worn' : '.off'), { text: a.earned ? a.mark : '?' }), h('span' + (a.earned ? '' : '.muted'), { text: a.name })]);
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
    body.appendChild(toggle('sound', 'Sound', 'Bat cracks, crowd, organ stabs.'));
    body.appendChild(toggle('music', 'Music', 'The ballpark organ in the menus.'));
    body.appendChild(toggle('haptics', 'Haptics', 'Buzz on contact (where supported).'));
    body.appendChild(toggle('assist', 'Pitch-read ring', 'Shows where the pitch will cross the plate. Turn off for hard mode.'));

    body.appendChild(h('div.sect', { text: 'Timing calibration' }));
    var val = h('b.stamp', { text: s.latencyMs + ' ms' });
    var slider = h('input.slider', { type: 'range', min: 0, max: 150, step: 5, value: s.latencyMs });
    slider.addEventListener('input', function () { val.textContent = slider.value + ' ms'; });
    slider.addEventListener('change', function () { m.setSetting('latencyMs', +slider.value); sfx('tap'); });
    body.appendChild(h('div.row', null, [h('span.small', { style: 'flex:1;font-weight:700', text: 'Touch latency compensation' }), val]));
    body.appendChild(slider);
    body.appendChild(h('div.small', { text: 'Screens and fingers lag a little. If your on-time swings keep coming up LATE, slide right; if they read EARLY, slide left. Default 30 ms.' }));
    // tap test
    var beat = h('div.beat'), out = h('span.small', { style: 'flex:1;font-weight:700', text: 'Or tap along: 8 beats, tap the big dot each time it flashes.' });
    var testBtn = btn('Tap test', '', function () { runTapTest(beat, out, slider, val); });
    testBtn.style.width = 'auto';
    body.appendChild(h('div.calib', null, [beat, out]));
    body.appendChild(h('div', { style: 'margin-top:10px' }, testBtn));

    body.appendChild(h('div.sect', { text: 'Help' }));
    body.appendChild(btn('How to play', '', function () { show('howto', { from: 'settings' }); }));

    body.appendChild(h('div.sect', { text: 'Danger zone' }));
    var armed = false, reset = btn('Reset progress', 'danger', function () {
      if (!armed) { armed = true; reset.firstChild.textContent = 'Tap again to erase everything'; later(function () { armed = false; reset.firstChild.textContent = 'Reset progress'; }, 3500); return; }
      m.resetProgress(); toast('Fresh notebook. Good luck out there.', 'info'); show('title');
    });
    body.appendChild(reset);
    body.appendChild(h('div.small', { style: 'margin-top:14px;text-align:center', text: (BB.Save.persistent() ? 'Progress is saved on this device.' : 'Private browsing: progress will not be saved after you close this tab.') + ' · v' + BB.VERSION }));
    return el;
  };
  function runTapTest(beat, out, slider, val) {
    var n = 8, period = 700, t0 = performance.now() + 600, offs = [], k = 0, done = false;
    function flash() { beat.classList.add('on'); sfx('tap'); setTimeout(function () { beat.classList.remove('on'); }, 110); }
    for (var i = 0; i < n; i++) later(flash, 600 + i * period);
    out.textContent = 'Tap the dot on each flash...';
    function onTap(e) {
      e.preventDefault();
      var t = (e.timeStamp && e.timeStamp > 1e3 ? e.timeStamp : performance.now()) - t0;
      var beatIdx = Math.round(t / period);
      if (beatIdx < 0 || beatIdx >= n) return;
      offs.push(t - beatIdx * period);
      k++;
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

  // ---------------------------------------------------------------- how to play
  var HOWTO = [
    { t: 'Tap to swing', p: 'The pitcher winds up and lets go. Tap anywhere the moment the ball reaches the plate. Early pulls it to left, late pushes it to right.',
      svg: '<rect x="70" y="40" width="120" height="140" fill="none" stroke="var(--ink-a)" stroke-width="4" stroke-dasharray="8 7"/>' +
        '<circle cx="130" cy="110" r="26" fill="var(--ink-c)" style="mix-blend-mode:multiply"/><circle cx="134" cy="113" r="26" fill="none" stroke="var(--ink-b)" stroke-width="4"/>' +
        '<path d="M115 98q15 12 0 26M150 98q-15 12 0 26" stroke="var(--ink-b)" stroke-width="3" fill="none"/>' +
        '<circle cx="200" cy="200" r="16" fill="var(--ink-b)"/><circle cx="200" cy="200" r="30" fill="none" stroke="var(--ink-b)" stroke-width="3"/><circle cx="200" cy="200" r="44" fill="none" stroke="var(--ink-b)" stroke-width="2" stroke-dasharray="4 6"/>' +
        '<text x="200" y="262" text-anchor="middle" font-family="Bungee, sans-serif" font-size="22" fill="var(--ink-a)">TAP!</text>' },
    { t: 'Hold to load', p: 'Press and hold during the windup to coil a power swing, then let go to swing. Smaller timing window, a lot more pop.',
      svg: '<path d="M40 210 L200 60" stroke="var(--ink-a)" stroke-width="22" stroke-linecap="round"/><path d="M44 214 L204 64" stroke="var(--ink-b)" stroke-width="22" stroke-linecap="round" opacity=".55" style="mix-blend-mode:multiply"/>' +
        '<path d="M40 210 L80 173" stroke="var(--ink-c)" stroke-width="22" stroke-linecap="round" style="mix-blend-mode:multiply"/>' +
        '<path d="M150 200 A80 80 0 0 0 220 120" fill="none" stroke="var(--ink-b)" stroke-width="5" stroke-dasharray="10 8"/><path d="M212 108l12 14-17 4z" fill="var(--ink-b)"/>' +
        '<rect x="30" y="240" width="200" height="18" fill="none" stroke="var(--ink-a)" stroke-width="3"/><rect x="33" y="243" width="150" height="12" fill="var(--ink-b)"/>' +
        '<text x="130" y="40" text-anchor="middle" font-family="Bungee, sans-serif" font-size="22" fill="var(--ink-a)">HOLD...</text>' },
    { t: 'Lay off balls', p: 'Pitches outside the box are hard to hit. Let them go by — four balls is a walk. The ring shows where the ball will cross.',
      svg: '<rect x="70" y="50" width="120" height="140" fill="none" stroke="var(--ink-a)" stroke-width="4" stroke-dasharray="8 7"/>' +
        '<circle cx="222" cy="210" r="22" fill="var(--ink-c)" style="mix-blend-mode:multiply"/><circle cx="225" cy="212" r="22" fill="none" stroke="var(--ink-a)" stroke-width="4"/>' +
        '<circle cx="222" cy="210" r="34" fill="none" stroke="var(--ink-b)" stroke-width="3" stroke-dasharray="5 5"/>' +
        '<path d="M60 230l50 30M110 230l-50 30" stroke="var(--ink-b)" stroke-width="7" stroke-linecap="round"/>' +
        '<text x="130" y="30" text-anchor="middle" font-family="Bungee, sans-serif" font-size="22" fill="var(--ink-a)">BALL ONE</text>' },
  ];
  SCREENS.howto = function (d) {
    var i = (d && d.page) || 0, P = HOWTO[i], last = i === HOWTO.length - 1;
    var from = d && d.from;
    function done() { M().markHowToSeen(); show(from === 'settings' ? 'settings' : 'title'); }
    var pips = h('div.pips'); HOWTO.forEach(function (_, k) { pips.appendChild(h('i' + (k === i ? '.on' : ''))); });
    var el = h('div.scr.howto', null, [
      h('div.hdr', null, [h('div.ttl', null, mis('How to Hit')), h('button.back', { style: 'width:auto;padding:0 12px;font-size:.8rem', text: 'SKIP', on: { click: tap(done) } })]),
      h('div.panel', null, [
        h('span.num', { text: (i + 1) + ' / ' + HOWTO.length }),
        h('div', { html: '<svg class="ill" viewBox="0 0 260 280">' + P.svg + '</svg>' }),
        h('h2', null, mis(P.t)),
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
    screensEl = document.getElementById('screens') || root.appendChild(h('div', { id: 'screens' }));
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
    // first gesture unlocks audio (iOS) and starts the menu organ
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
    // redraw art once the web fonts arrive (canvas text uses Bungee / Space Mono)
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { redraws.forEach(function (f) { try { f(); } catch (e) {} }); });
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
    setInks: setInks,                 // main may call this when the title backdrop changes ink
    current: function () { return cur; },
    refresh: refresh,
    startGame: startGame,
    _fallbackArt: FB,
  };
})();
