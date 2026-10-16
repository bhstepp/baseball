// 36-crew.js — BB.Crew: the game's modelled cast on the field (docs/CAST-CONTRACT.md "Runtime"). Owned by the
// integration agent. Sits on BB.Actors (36-actors.js) like BB.Rocco; BB.Render (35-scene) asks it, role by role, to
// pose a character and falls back to its procedural cast for any role that isn't ready.
//
// Who plays (per game, resolved in prepare): the game's pitcher (tour, derby and daily alike), the park's home team
// from the trading cards (catcher = the team's C card, fielders = its 1B ... RF cards: their card number on the back,
// the team letter on the chest, the team's colours), the umpire (a mole, every game) and Rocco's three teammates who
// run the bases. Files: char_<id>.glb (LOD0) and char_<id>_lod1.glb (LOD1). The pitcher, catcher and umpire load
// LOD0 (+ LOD1 for the field view), fielders and runners LOD1 (their LOD0 is fetched only if one comes close).
// Clip libraries: anim_pitcher / anim_catcher / anim_umpire / anim_fielder with their sidecars (markers, sockets,
// face curves), retargeted per character (root/hips translation x hipHeight / refHipHeight); the runners borrow
// Rocco's run, trot and cheer. Everything is released after the game. Anything missing (file, clips, a parse error)
// leaves that role to the procedural cast; ?standin=<asset> (or window.BB_CAST_STANDIN) plays every role with one
// stand-in body, for testing before the characters exist.
//
// Drivers map the game's timeline onto clip time with the markers: the pitcher's release frame (1.15 s) on the
// release (pitchT = 0), the catcher's pocket (0.30 s) on the pitch reaching the plate (pitch.T), the fielders' catch
// and throw markers on play.catchT / play.throwT, run cycles on the ground they cover. Poses are a function of the
// view (harness == game); BB.Actors' snapshot crossfade covers the joins, and a clock keeps running once main stops
// advancing pitchT ('between'). Acting (idles, reactions, the umpire's calls) is drawn on twos; throws on ones.
BB.Crew = (function () {
  var T = (typeof THREE !== 'undefined') ? THREE : null;
  var NOOP = function () {};
  var OFF = { available: false, prepare: function () { return Promise.resolve(false); }, release: NOOP, sync: NOOP, setHeroColors: NOOP,
    ready: function () { return false; }, actor: function () { return null; }, status: function () { return { available: false }; }, hideAll: NOOP };
  if (!T || !BB.Actors || !BB.Actors.available || !BB.Assets || !BB.U || !BB.K) return OFF;
  var AC = BB.Actors, U = BB.U, K = BB.K, PI = Math.PI;
  var clamp = U.clamp, smooth = U.smooth, lerp = U.lerp, L = AC.L, mixL = AC.mixL, onTwos = AC.onTwos;
  var ORDER = (BB.Bat && BB.Bat.ORDER) || ['P', 'C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF'];
  var FIELD_POS = ['1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF'];
  var CARD_NO = { C: 4, '1B': 5, '2B': 6, SS: 7, '3B': 8, LF: 9, CF: 10, RF: 11 };   // card k+1 of a team: P P P C 1B 2B SS 3B LF CF RF DH
  var MATES = [{ sp: 'otter', num: 12 }, { sp: 'fox', num: 3 }, { sp: 'beaver', num: 22 }];
  var LIBS = { P: ['anim_pitcher', 'anim_fielder'], C: ['anim_catcher', 'anim_fielder'], U: ['anim_umpire'], F: ['anim_fielder'], M: ['anim_fielder'] };
  // what a role needs to be shown modelled (one clip of each group), else the procedural cast plays it
  var NEED = { P: [['p_idle'], ['p_windup_classic', 'p_windup_highkick', 'p_windup_sidearm', 'p_windup_submarine']],
    C: [['c_crouch'], ['c_receive_mid', 'c_receive_high', 'c_receive_low']], U: [['u_stance'], ['u_strike', 'u_strike3']],
    F: [['f_ready', 'f_idle'], ['f_run']], M: [['run', 'trot']] };
  var STYLES = ['classic', 'highkick', 'sidearm', 'submarine'];
  var RELEASE_AT = 1.15;              // contract: every windup clip releases the ball at 1.15 s (= K.WINDUP)
  var POCKET_AT = 0.30;               // contract: the catcher's receives meet the ball at 0.30 s
  var SIZE = { min: 0.95, max: 1.3 };    // the pitcher's scale is solved from the release height, within these
  // the catcher's throw back to the mound, squeezed into the game's short gap between pitches (mitt -> next windup
  // ~1.0 s): the clip starts TB.delay after the pitch reaches the plate, its release frame lands TB.release later,
  // the ball flies TB.flight (a firm lob, TB.arc ft over the line) into the pitcher's mitt
  var TB = { delay: 0.12, release: 0.3, flight: 0.42, arc: 2.2 };
  function now() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
  function kindOf(role) { return role === 'P' || role === 'C' || role === 'U' ? role : role.charAt(0) === 'M' ? 'M' : 'F'; }

  // ------------------------------------------------------------------ who plays
  function standin() {
    if (typeof window !== 'undefined' && window.BB_CAST_STANDIN) return window.BB_CAST_STANDIN;
    try { var m = /[?&]standin=([^&]*)/.exec(location.search); if (m) return (m[1] && m[1] !== '1') ? decodeURIComponent(m[1]) : 'ref_body'; } catch (e) {}
    return null;
  }
  function parks() { return (BB.Content && BB.Content.PARKS) || []; }
  function teamOfPark(park) {
    var TM = BB.Meta && BB.Meta.TEAMS, P = parks(), i;
    if (!park) return null;
    if (TM) for (i = 0; i < TM.length; i++) if (TM[i].park === park.id) return TM[i];
    for (i = 0; i < P.length; i++) if (P[i].id === park.id) {   // without BB.Meta: the same derivation as 55-meta buildTeams
      var town = park.town || park.name || 'Home';
      return { idx: i, park: park.id, town: town, mascot: park.team, name: town + ' ' + park.team, short: town.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase(),
        inkset: park.inkset || 'classic', colorSlot: ['a', 'b', 'c', 'a', 'b', 'c'][i % 6] };
    }
    return null;
  }
  function teamOfMascot(m) {
    var TM = BB.Meta && BB.Meta.TEAMS, P = parks(), i;
    if (TM) for (i = 0; i < TM.length; i++) if (TM[i].mascot === m) return TM[i];
    for (i = 0; i < P.length; i++) if (P[i].team === m) return teamOfPark(P[i]);
    return null;
  }
  function inkset(id) { var S = BB.INKSETS || []; for (var i = 0; i < S.length; i++) if (S[i].id === id) return S[i]; return S[0] || { a: '#2E5AAC', b: '#D9483B', c: '#F2B632' }; }
  // the album card's colours (38-cards printCard): the team colour is the slot of the team's ink set, the second the
  // other primary; caps are team_a (no team has a separate brim colour yet)
  function colorsOf(team) {
    var sc = BB.CardArt && BB.CardArt.scheme ? BB.CardArt.scheme(team.inkset || 'classic') : inkset(team.inkset);
    var slot = team.colorSlot || 'a', a = sc[slot] || sc.a, b = sc[slot === 'a' ? 'b' : 'a'];
    var c = new T.Color(a);
    if (0.299 * c.r + 0.587 * c.g + 0.114 * c.b > 0.82) a = '#' + c.multiplyScalar(0.8).getHexString();
    return { a: a, b: b, c: sc.c };
  }
  function cardsOf(team) {
    var out = {}, C = BB.Meta && BB.Meta.CARDS;
    if (C) C.forEach(function (c) { if (c.teamIdx === team.idx && CARD_NO[c.pos] && !out[c.pos]) out[c.pos] = c; });
    for (var pos in CARD_NO) if (!out[pos]) out[pos] = { id: 'c' + (team.idx + 1) + '-' + ('0' + CARD_NO[pos]).slice(-2), pos: pos, number: null };
    return out;
  }
  function member(role, id, o) {
    return { role: role, kind: kindOf(role), id: id, files: { 0: 'char_' + id, 1: 'char_' + id + '_lod1' }, base: o.base || 0, want: o.want || [o.base || 0],
      colors: o.colors || null, decals: o.decals || null, hand: o.hand || 'R', card: o.card || null, state: 'idle', actor: null, meta: {}, libs: [] };
  }
  function roster(park, pitcher) {
    var team = teamOfPark(park), list = [], letter = team ? team.short.charAt(0) : null, home = team ? colorsOf(team) : null;
    if (pitcher && pitcher.id) {
      var pt = teamOfMascot(pitcher.team) || null, pc = pt ? colorsOf(pt) : { a: (BB.Cast && BB.Cast.teamColor) ? BB.Cast.teamColor(pitcher.team) : '#2B4A8C', b: '#D9483B' };
      var pl = pt ? pt.short.charAt(0) : String(pitcher.team || pitcher.name || 'X').charAt(0).toUpperCase();
      var num = pitcher.look && pitcher.look.number != null ? String(pitcher.look.number) : null;
      list.push(member('P', pitcher.id, { base: 0, want: [0, 1], colors: pc, decals: { decal_chest: pl, decal_back: num }, hand: pitcher.hand }));
    }
    if (team) {
      var cards = cardsOf(team);
      ['C'].concat(FIELD_POS).forEach(function (pos) {
        var cd = cards[pos], lod = pos === 'C' ? 0 : 1;
        list.push(member(pos, cd.id, { base: lod, want: pos === 'C' ? [0, 1] : [1], colors: home, card: cd,
          decals: { decal_chest: letter, decal_back: cd.number != null ? String(cd.number) : null } }));
      });
    }
    list.push(member('U', 'ump', { base: 0, want: [0, 1] }));
    MATES.forEach(function (m, k) { list.push(member('M' + k, 'mate_' + m.sp, { base: 1, want: [1], colors: heroCol, decals: { decal_chest: 'R', decal_back: String(m.num) } })); });
    var si = standin();
    if (si) list.forEach(function (M) { M.files = { 0: si, 1: si + '_lod1' }; M.standin = true; });
    return { team: team, list: list };
  }

  // ------------------------------------------------------------------ loading and releasing a game's cast
  var CUR = null, OLD = [], heroCol = null;
  function keyOf(park, pitcher) {
    var p = pitcher || {}, look = p.look || {};
    return (park ? park.id : '-') + '|' + (p.id || '-') + ':' + (p.hand || '') + ':' + (look.windup || '') + ':' + (look.build || '') + '|' + (standin() || '');
  }
  // prepare(park, pitcher): fetch and parse what the game needs (the briefing calls it through BB.Render.prepare;
  // BB.Game.start repeats it without the pitcher: same park -> same game). Resolves with status() when every
  // member is in or has fallen back.
  function prepare(park, pitcher) {
    if (CUR && !park) park = CUR.park;
    if (!park && !pitcher) return CUR ? CUR.promise : Promise.resolve(false);
    if (CUR && !pitcher && park && CUR.park && CUR.park.id === park.id) pitcher = CUR.pitcher;
    var key = keyOf(park, pitcher);
    if (CUR && CUR.key === key) return CUR.promise;
    var prev = CUR, R = roster(park, pitcher);
    var game = { key: key, park: park, pitcher: pitcher, team: R.team, list: R.list, members: {}, libs: {}, released: false, t0: now() };
    R.list.forEach(function (M) { game.members[M.role] = M; });
    CUR = game;
    game.promise = Promise.all(R.list.map(function (M) { return loadMember(game, M); })).then(function () {
      game.ms = now() - game.t0; game.done = true;
      if (prev) releaseGame(prev);   // after the new game holds its files: shared ones are not parsed twice
      return status();
    });
    return game.promise;
  }
  function release() { if (CUR) { releaseGame(CUR); CUR = null; } }
  function releaseGame(game) {
    if (game.released) return;
    game.released = true;
    game.list.forEach(function (M) { if (M.actor) { try { M.actor.dispose(); } catch (e) {} M.actor = null; } M.state = 'released'; });
    for (var n in game.libs) if (game.libs[n].gltf) BB.Assets.release(n);
  }
  // the frame's view names the park and pitcher: (re)prepare lazily when a game arrives without a briefing
  function sync(v) {
    if (!v || !v.park || !v.pitcher || v.scene === 'title') return;
    if (CUR && CUR.park && CUR.park.id === v.park.id && CUR.pitcher && CUR.pitcher.id === v.pitcher.id) return;
    prepare(v.park, v.pitcher);
  }
  function loadMember(game, M) {
    var has = function (l) { return BB.Assets.has(M.files[l]); };
    var lv = has(M.base) ? M.base : has(1 - M.base) ? 1 - M.base : -1;
    if (lv < 0) { M.state = 'missing'; return Promise.resolve(false); }
    M.state = 'loading'; M.lod = lv;
    return AC.create('cast', { asset: M.files[lv], baseLod: lv, colors: M.colors, decalText: M.decals || {} }).then(function (A) {
      if (game.released) { A.dispose(); return false; }
      M.actor = A; A.root.visible = false;
      if (M.hand === 'L') A.setMirror(true);                     // left-handers: the right-handed model mirrored
      M.hip = hipOf(A);
      var jobs = [];
      M.want.forEach(function (l) { if (l !== lv && has(l)) jobs.push(AC.loadLevel(A, M.files[l], l).catch(function (e) { A.warn('lod' + l + ': ' + (e.message || e)); })); });
      LIBS[M.kind].forEach(function (n) { jobs.push(library(game, n).then(function (E) { if (E && !A.disposed) addLibrary(M, E); })); });
      if (M.kind === 'M') jobs.push(roccoClips(M));
      return Promise.all(jobs).then(function () { if (!game.released) finish(M); return M.state === 'ready'; });
    }).catch(function (e) {
      M.state = 'failed'; M.error = String((e && e.message) || e);
      console.warn('BB.Crew: ' + M.role + ' (' + M.files[lv] + ') stays procedural: ' + M.error);
      return false;
    });
  }
  function hipOf(A) {
    var h = +(A.extras && A.extras.hipHeight);
    if (h > 0.3) return h;
    var p = A.bindPoint('hips');
    return p && p.y > 0.3 ? p.y : 1.7;
  }
  function library(game, name) {
    var E = game.libs[name];
    if (E) return E.promise;
    E = game.libs[name] = { name: name, meta: BB.Assets.meta(name) || {}, gltf: null };
    if (!BB.Assets.has(name)) { E.missing = true; E.promise = Promise.resolve(null); return E.promise; }
    E.promise = BB.Assets.load(name).then(function (g) {
      if (game.released) { BB.Assets.release(name); return null; }
      E.gltf = g; return E;
    }, function (e) { E.error = String((e && e.message) || e); console.warn('BB.Crew: ' + name + ': ' + E.error); return null; });
    return E.promise;
  }
  function addLibrary(M, E) {
    var A = M.actor, ex = (E.gltf.scene && E.gltf.scene.userData) || {};
    var ref = +(E.meta.refHipHeight || ex.refHipHeight) || 1.7;
    var names = A.addClips(E.gltf, { scale: M.hip / ref });
    if (E.meta.face) A.addFaceCurves(E.meta.face);
    var cm = E.meta.clips || {}, k = M.hip / ref;
    names.forEach(function (n) { M.meta[n] = Object.assign({ _k: k }, cm[n] || {}); });
    if (E.meta.run && E.meta.run.groundSpeed && M.meta.f_run && !M.meta.f_run.groundSpeed) M.meta.f_run.groundSpeed = E.meta.run.groundSpeed;
    M.libs.push(E.name);
  }
  // Rocco's teammates run the bases with his run / trot / cheer (same rig), retargeted from his hips to theirs
  function roccoClips(M) {
    if (!BB.Rocco || !BB.Rocco.whenReady) return Promise.resolve();
    return BB.Rocco.whenReady().then(function (ok) {
      var RA = ok && BB.Rocco.actor && BB.Rocco.actor();
      if (!RA || !M.actor || M.actor.disposed) return;
      var names = M.actor.addClips(RA.gltf, { scale: M.hip / hipOf(RA), only: ['run', 'trot', 'cheer'] });
      names.forEach(function (n) { M.meta[n] = {}; });
      var gs = RA.cfg.gaitSpeed || {}, rh = hipOf(RA);
      M.gaitAuthored = {}; for (var g in gs) M.gaitAuthored[g] = gs[g] * M.hip / rh;   // Rocco's authored ground speeds, scaled
    });
  }
  function finish(M) {
    var A = M.actor;
    var miss = NEED[M.kind].filter(function (g) { return !g.some(function (c) { return A.has(c); }); });
    if (miss.length) { M.state = 'noclips'; M.error = 'no ' + miss.map(function (g) { return g.join('/'); }).join(', '); return; }
    if (M.decals && M.decals.decal_back == null && +A.extras.number > 0) { A.decalText.decal_back = String(A.extras.number); A.paint(); }
    try { measure(M); } catch (e) { M.state = 'failed'; M.error = 'measure: ' + (e.message || e); return; }
    M.state = 'ready';
  }
  function markerOf(M, clip, name, def) {
    var mk = M.meta[clip] && M.meta[clip].markers;
    if (mk && mk[name] != null) return +mk[name];
    if (mk) for (var k in mk) return +mk[k];
    return def;
  }
  // the socket that holds the ball at clip time t, from the sidecar's ball track ([[socket|null, from], ...])
  function ballSocket(M, clip, t) {
    var tr = M.meta[clip] && M.meta[clip].ball, s = null;
    if (!tr) return undefined;
    for (var i = 0; i < tr.length; i++) if (t >= tr[i][1] - 1e-6) s = tr[i][0];
    return s;
  }
  // per-character measurements, made once after loading (retargeted clips on this character's proportions)
  function measure(M) {
    var A = M.actor, v = new T.Vector3();
    if (M.kind === 'P') {
      M.release = {};
      STYLES.forEach(function (st) { var c = 'p_windup_' + st; if (A.has(c) && A.bones['grip.R']) M.release[st] = A.socketAt({ c: c, t: RELEASE_AT }, 'grip.R', new T.Vector3()); });
      if (A.has('p_get_ball')) M.getBall = { t: markerOf(M, 'p_get_ball', 'catch', 0.4) };
    }
    if (M.kind === 'C') {
      M.pockets = [];
      ['c_receive_low', 'c_receive_mid', 'c_receive_high'].forEach(function (c) {
        if (!A.has(c)) return;
        var t = markerOf(M, c, 'catch', POCKET_AT), b = A.bones.mitt ? 'mitt' : 'hand.L', p = A.socketAt({ c: c, t: t }, b, new T.Vector3());
        if (p) M.pockets.push({ c: c, t: t, p: p });
      });
      M.pockets.sort(function (a, b) { return a.p.y - b.p.y; });
      if (A.has('c_throw_back')) M.throwBack = { t: markerOf(M, 'c_throw_back', 'release', 0.58), grip: A.socketAt({ c: 'c_throw_back', t: markerOf(M, 'c_throw_back', 'release', 0.58) }, 'grip.R', new T.Vector3()) };
    }
    if (M.kind === 'F' || M.kind === 'P' || M.kind === 'C' || M.kind === 'M') {
      // run cycles: ground speed at 1x from the sidecar, else Rocco's authored speed (runners), else measured
      M.gaits = {};
      ['f_run', 'run', 'trot'].forEach(function (c) {
        if (!A.has(c)) return;
        var md = M.meta[c] || {}, sp = +(md.groundSpeed || 0) * (md._k || 1);   // the sidecar's speed is the reference build's
        if (!(sp > 0) && M.gaitAuthored && M.gaitAuthored[c]) sp = M.gaitAuthored[c];
        if (!(sp > 0)) sp = A.gait(c).treadmill;
        M.gaits[c] = { speed: sp > 0.5 ? sp : 8, dur: A.dur(c) };
      });
      // where the glove pocket is at each catch clip's marker (model space), to bring it onto the ball
      M.catchAt = {};
      ['f_catch_fly', 'f_catch_dive', 'f_field_grounder'].forEach(function (c) {
        if (!A.has(c)) return;
        var t = markerOf(M, c, 'catch', 0.4), p = A.socketAt({ c: c, t: t }, A.bones.mitt ? 'mitt' : 'hand.L', new T.Vector3());
        M.catchAt[c] = { t: t, p: p };
      });
      if (A.has('f_throw')) { var rt0 = markerOf(M, 'f_throw', 'release', 0.35); M.throwAt = { t: rt0, grip: A.socketAt({ c: 'f_throw', t: rt0 }, 'grip.R', new T.Vector3()) }; }
    }
    void v;
    A.evaluate([L(A.first(idleClip(M)), 0)]);
  }
  function idleClip(M) { return { P: 'p_idle', C: 'c_crouch', U: 'u_stance', F: 'f_ready', M: 'f_ready' }[M.kind]; }

  // ------------------------------------------------------------------ frame helpers
  function get(role) { var M = CUR && CUR.members[role]; return M && M.state === 'ready' && M.actor && !M.actor.disposed ? M : null; }
  function hideAll() {
    [CUR].concat(OLD).forEach(function (g) { if (g) g.list.forEach(function (M) { if (M.actor) M.actor.root.visible = false; }); });
  }
  function setHeroColors(c) {
    heroCol = c;
    if (CUR) CUR.list.forEach(function (M) { if (M.kind === 'M') { M.colors = c; if (M.actor) M.actor.setColors(c); } });
  }
  function looped(A, c, t) { return A.looped(c, t); }
  function dur(A, c) { return A.dur(c); }
  // once main stops advancing pitchT ('between'), keep the clock running for the reactions and the throw back
  var clocks = {};
  function frozen(key, v, sig) {
    var t = v.time || 0, f = clocks[key];
    if (!f || f.sig !== sig || t < f.last || t - f.last > 0.25) { clocks[key] = { sig: sig, t0: t, last: t }; return 0; }
    f.last = t;
    return Math.min(8, t - f.t0);
  }
  // seconds since the release (negative in the windup), or null before the first windup
  function pitchClock(v) {
    if (v.windup != null) return { r: (v.windup - 1) * K.WINDUP, phase: 'windup' };
    var p = v.pitch;
    if (p && v.pitchT != null) return { r: v.pitchT + frozen('pitch', v, p.id + ':' + p.T + '|' + v.pitchT + '|' + (v.swing ? v.swing.t : '')), phase: 'pitch', p: p };
    return { r: null, phase: 'idle' };
  }
  // what the pitch came to: contact | hr | hit | out | foul (in play), k (strike three), walk, strike, ball, whiff
  var counts = {};
  var K_TEXT = /CAUGHT LOOKING|FROZEN|STRIKE THREE|STRUCK OUT|WHIFF! K|SIT DOWN/, WALK_TEXT = /BALL FOUR|TAKE YOUR BASE|WALKED/;
  function outcome(v, c) {
    var p = v.pitch, sw = v.swing; if (!p) return null;
    if (sw && sw.result && sw.result.contact) {
      var pt = v.play && v.play.type;
      return !pt ? 'contact' : pt === 'HR' ? 'hr' : pt === 'FOUL' ? 'foul' : pt === 'OUT' ? 'out' : 'hit';
    }
    var h = v.hud, id = p.id + ':' + p.T;
    if (h && c.r != null && c.r < p.T + 0.1) counts[id] = { b: h.balls || 0, s: h.strikes || 0 };   // the count before this pitch
    var cnt = counts[id], st = v.stamp, txt = st ? String(st.text || '').toUpperCase() : '';
    var since = c.r - (p.T + 0.12), fresh = st && c.r != null && since >= -0.02 && Math.abs((st.t || 0) - since) < 0.35;
    if (fresh && st.kind === 'bad' && K_TEXT.test(txt)) return 'k';
    if (fresh && st.kind === 'good' && WALK_TEXT.test(txt)) return 'walk';
    if (sw) return cnt && cnt.s >= 2 && since >= 0 ? 'k' : 'whiff';
    if (p.strike) return cnt && cnt.s >= 2 && since >= 0 ? 'k' : 'strike';
    return cnt && cnt.b >= 3 && since >= 0 ? 'walk' : 'ball';
  }
  function styleOf(M, pitcher) {
    var s = (pitcher && pitcher.look && pitcher.look.windup) || 'classic';
    if (!M.actor.has('p_windup_' + s)) for (var i = 0; i < STYLES.length; i++) if (M.actor.has('p_windup_' + STYLES[i])) return STYLES[i];
    return s;
  }
  function ground(x, y) { return BB.Park && BB.Park.mound ? BB.Park.mound(x, y) : 0; }

  // ------------------------------------------------------------------ the pitcher (bat scene)
  // He stands so that his throwing hand's grip at the release frame is the physics release point
  // (BB.Pitch.releasePoint): the scale comes from the release height above the mound, the root from the rest.
  function pitcherPlace(M, v) {
    var p = v.pitcher || (CUR && CUR.pitcher) || {}, style = styleOf(M, p);
    var rel = (v.pitch && v.pitch.release) || (BB.Pitch && BB.Pitch.releasePoint ? BB.Pitch.releasePoint(p) : { x: p.hand === 'L' ? 1.75 : -1.75, y: K.RELEASE_Y, z: 6 });
    var m = M.actor.mirrored ? -1 : 1, key = [style, rel.x, rel.y, rel.z, m].join('|');
    if (M.place && M.place.key === key) return M.place;
    var g = M.release[style], s = 1, x = 0, y = K.RUBBER_Y, z = ground(0, K.RUBBER_Y);
    if (g) for (var it = 0; it < 4; it++) {
      z = ground(x, y);
      s = clamp((rel.z - z) / Math.max(0.5, g.y), SIZE.min, SIZE.max);
      x = rel.x - s * g.x * m; y = rel.y + s * g.z;
    }
    var hand = g ? new T.Vector3(x + s * g.x * m, y - s * g.z, z + s * g.y) : new T.Vector3(rel.x, rel.y, rel.z);
    M.place = { key: key, x: x, y: y, z: z, s: s, style: style, clip: 'p_windup_' + style, rel: rel, res: hand.sub(new T.Vector3(rel.x, rel.y, rel.z)) };
    return M.place;
  }
  // the catcher's throw back on the r clock (seconds since the release)
  function throwBackTimes(p) {
    var start = p.T + TB.delay, rel = start + TB.release;
    return { start: start, rel: rel, arrive: rel + TB.flight };
  }
  function posePitcher(v, o) {
    var M = get('P'); if (!M) return null;
    var A = M.actor, pl = pitcherPlace(M, v), t = v.time || 0, c = pitchClock(v), p = v.pitch, wc = pl.clip;
    A.place(pl.x, pl.y, pl.z, 0, pl.s); A.setLod(0);
    var face = { blink: A.blinkAt(t, 3) }, spec = { key: 'idle', fade: 0.18, layers: null, face: face, gaze: o.batter || null, gazeK: 0.6 }, ball = null, own = 'P';
    var idle = [L('p_idle', looped(A, 'p_idle', onTwos(t, t)))];
    if (c.phase === 'windup') {
      var g = c.r + RELEASE_AT;                                  // the windup phase is 1.15 s: clip time == phase time
      spec.layers = [L(wc, Math.max(0, g))]; spec.key = 'windup'; spec.fade = 0.2;
      ball = ballSocket(M, wc, g); if (ball === undefined) ball = g < 0.3 ? 'mitt' : 'grip.R';
      face.brows_angry = 0.5; face.squint = 0.3; spec.gazeK = 0.8 * (1 - smooth((g - 0.4) / 0.3));
    } else if (c.phase === 'pitch') {
      var r = c.r, out = outcome(v, c), ft = Math.min(dur(A, wc), RELEASE_AT + r);
      var layers = [L(wc, ft)], key = 'follow';
      ball = null; own = r < 0.02 ? 'P' : null;
      spec.gaze = o.ball || null; spec.gazeK = 0.8;
      if (out === 'contact' || out === 'hr' || out === 'hit' || out === 'out' || out === 'foul') {
        var ci = o.ci, tc = ci ? ci.tc : 0, rc = out === 'hr' ? 'p_react_hr' : out === 'hit' && A.has('p_react_hit') ? 'p_react_hit' : null;
        if (rc && tc > 0.04 && A.has(rc)) { var rt = onTwos(tc - 0.04, t); layers = mixL(layers, [L(rc, Math.min(rt, dur(A, rc)))], smooth(rt / 0.15)); key = rc; }
        spec.gaze = o.ballAfter || o.ball; spec.gazeK = 1;
      } else if (p) {
        var tb = throwBackTimes(p), re = out === 'k' ? 'p_react_k' : out === 'walk' ? 'p_react_walk' : null, r0 = p.T + 0.25;
        if (re && A.has(re)) {
          var et = onTwos(r - r0, t);
          if (et > 0) { layers = mixL(layers, [L(re, Math.min(et, dur(A, re)))], smooth(et / 0.15)); key = re; }
          if (r >= tb.arrive) own = 'P', ball = 'mitt';
          if (out === 'k') { face.smirk = smooth(et / 0.3) * 0.8; face.brows_up = 0.3; } else { face.frown = smooth(et / 0.3) * 0.8; face.brows_angry = 0.7; }
        } else if (A.has('p_get_ball')) {
          var cm = M.getBall ? M.getBall.t : 0.4, gs = tb.arrive - cm, gt = r - gs;
          if (gt > 0) {
            var gl = [L('p_get_ball', Math.min(gt < cm ? gt : cm + onTwos(gt - cm, t), dur(A, 'p_get_ball')))];
            layers = mixL(layers, gl, smooth(gt / 0.14)); key = 'get_ball';
            // in the set once he has it (the next windup may start first: its crossfade takes over)
            var st = r - (tb.arrive + 0.22);
            if (st > 0 && A.has('p_set')) { layers = mixL(layers, [L('p_set', Math.min(onTwos(st, t), dur(A, 'p_set')))], smooth(st / 0.15)); key = 'set'; }
            if (r >= tb.arrive) { own = 'P'; ball = st > 0 && A.has('p_set') ? (ballSocket(M, 'p_set', st) || 'mitt') : 'mitt'; }
            spec.gaze = o.catcherHead || spec.gaze; spec.gazeK = 0.8;
          }
        }
      }
      spec.layers = layers; spec.key = key; spec.fade = key === 'follow' ? 0.05 : 0.12;
    } else {
      // before the first pitch ('PLAY BALL!'): a cocky gesture, then the idle on the rubber
      var pre = o.intro != null && A.has('p_taunt') ? o.intro : null;
      spec.layers = pre != null && pre < dur(A, 'p_taunt') + 0.1 ? mixL(idle, [L('p_taunt', Math.min(onTwos(pre, t), dur(A, 'p_taunt')))], smooth(pre / 0.15) * (1 - smooth((pre - dur(A, 'p_taunt') + 0.15) / 0.15))) : idle;
      ball = 'mitt'; face.smile = 0.3;
    }
    A.commit(spec, t);
    var hold = own === 'P' && ball ? A.point(ball, new T.Vector3()) : null;
    return { actor: A, place: pl, ballAt: hold, socket: ball, own: own, res: pl.res };
  }

  // ------------------------------------------------------------------ the catcher (bat scene)
  // o: { stage: { x, y, height (ft he is drawn at, standing), shift (share of the sideways move made by his feet) },
  // end: where the pitch ends up (world), ci, intro }. The receives are blended by the ball's height and their pocket
  // marker put on the pitch reaching the plate; his feet shuffle part of the way to the side and his glove arm
  // reaches the rest (two-bone reach on the left arm), so the mitt pocket meets the ball at any scale.
  function sizeFor(A, h) { var nat = +(A.extras && A.extras.height) || A.height || 5; return h ? clamp(h / nat, 0.55, 1.3) : 1; }
  // when the pitch reaches the catcher's mitt: the end of its path, ~3 ft behind the plate (BB.Pitch.pos)
  var mittMemo = {};
  function mittTime(p, pos) {
    var k = p.id + ':' + p.T + ':' + p.plate.x + ':' + p.plate.z;
    if (mittMemo.k === k) return mittMemo.t;
    var t = p.T;
    if (pos) { var e = pos(p, p.T + 0.6), lo = p.T, hi = p.T + 0.6; for (var i = 0; i < 18; i++) { var mid = (lo + hi) / 2; if (pos(p, mid).y > e.y + 0.01) lo = mid; else hi = mid; } t = hi; }
    mittMemo = { k: k, t: t };
    return t;
  }
  var _pk = new T.Vector3(), _mt = new T.Vector3();
  function poseCatcher(v, o) {
    var M = get('C'); if (!M) return null;
    var A = M.actor, st = o.stage, t = v.time || 0, c = pitchClock(v), p = v.pitch, s = sizeFor(A, st.height);
    var mid = M.pockets.length ? M.pockets[Math.min(1, M.pockets.length - 1)].p : null;
    var x = st.x, y = mid ? -3 - s * mid.z : st.y, face = { blink: A.blinkAt(t, 5) }, spec = { key: 'crouch', fade: 0.15, face: face, layers: null }, ball = null, own = null;
    var crouch = [L('c_crouch', looped(A, 'c_crouch', onTwos(t, t)))], layers = crouch, reach = null;
    if (c.phase === 'windup' || c.phase === 'idle') {
      // the sign: early in the windup (the bat camera sees his back, the fingers between his thighs), and during the intro
      var sgT = c.phase === 'windup' ? c.r + RELEASE_AT : o.intro != null ? o.intro - 0.25 : null;
      if (sgT != null && sgT > 0 && A.has('c_sign') && sgT < dur(A, 'c_sign') * 0.62) {
        var sk = Math.min(dur(A, 'c_sign'), onTwos(sgT, t) / 0.62);   // played a little quicker than authored
        layers = mixL(crouch, [L('c_sign', sk)], smooth(sgT / 0.12) * (1 - smooth((sgT - dur(A, 'c_sign') * 0.62 + 0.12) / 0.12)));
        spec.key = 'sign';
      }
    } else if (c.phase === 'pitch' && p && o.end) {
      var r = c.r, out = outcome(v, c), end = o.end, hit = !!(o.ci && o.ci.hit);
      // receive: high / mid / low blended by where the ball ends up, the pocket's marker on the ball reaching the
      // mitt (a hair after it crosses the plate), his root set so that the pocket meets it there
      var rl = blendPockets(M, end.z / s), rs = r - (mittTime(p, o.pitchPos) - POCKET_AT);
      y = end.y - s * rl.pocket.z;
      // shuffles over as he reads the pitch: part of the way (his glove arm reaches the rest) when the ball is on his
      // glove side, all the way when it is on his right, so his head never hides the mitt from the bat camera
      // behind him (facing the mound his glove side, model +X, is world -x)
      var rk = smooth((r / p.T - 0.35) / 0.55), full = end.x + s * rl.pocket.x;
      x = lerp(st.x, Math.max(lerp(st.x, full, st.shift != null ? st.shift : 0.55), full + (st.clear || 0)), rk);
      // and back to his spot once the ball is on its way to the mound (before the next windup)
      if (!hit && A.has('c_throw_back')) { var bk = smooth((r - throwBackTimes(p).rel) / 0.45); x = lerp(x, st.x, bk); y = lerp(y, mid ? -3 - s * mid.z : st.y, bk); }
      if (rs > -0.05) {
        var rcv = rl.layers.map(function (l) { return L(l.c, clamp(rs, 0, dur(A, l.c)), l.w); });
        layers = mixL(crouch, rcv, smooth((rs + 0.05) / 0.1)); spec.key = 'receive'; spec.fade = 0.06;
        if (rs >= POCKET_AT && !hit) { own = 'C'; ball = 'mitt'; }
        if (!hit) reach = { w: smooth(rs / POCKET_AT), pocket: rl.pocket };
      }
      if (hit) {                                                 // pops up on a ball in play (a homer: watches it go)
        var tc = o.ci.tc, rc = out === 'hr' && A.has('c_react_hr') ? 'c_react_hr' : A.has('c_stand') ? 'c_stand' : null;
        if (rc && tc > 0.02) { layers = mixL(layers, [L(rc, Math.min(onTwos(tc - 0.02, t), dur(A, rc)))], smooth((tc - 0.02) / 0.12)); spec.key = rc; }
        face.brows_up = 0.8; face.mouth_open = 0.5; own = null; ball = null;
      } else if (A.has('c_throw_back') && rs >= POCKET_AT) {
        var tb = throwBackTimes(p), tt = r - tb.start;
        if (tt > 0) {
          var rm = M.throwBack ? M.throwBack.t : 0.58, ct = AC.warp(tt, TB.release, rm);
          layers = mixL(layers, [L('c_throw_back', Math.min(ct, dur(A, 'c_throw_back')))], smooth(tt / 0.1)); spec.key = 'throw_back'; spec.fade = 0.08;
          var sock = ballSocket(M, 'c_throw_back', ct); ball = sock === undefined ? (ct < rm ? 'mitt' : null) : sock; own = ball ? 'C' : null;
          if (reach) reach.w *= 1 - smooth(tt / 0.15);
        }
      }
    }
    spec.layers = layers;
    A.place(x, y, 0, PI, s); A.setLod(0);
    if (reach && reach.w > 0.001) {
      // the pocket at the marker for this blend, in the world: the ball's end point minus that is the reach
      var pw = A.model.localToWorld(_pk.copy(reach.pocket)), dx = o.end.x - pw.x, dy = o.end.y - pw.y, dz = o.end.z - pw.z;
      spec.post = function (act) { var m = act.point('mitt', _mt); act.reach('upper_arm.L', 'forearm.L', 'hand.L', 'mitt', { x: m.x + dx, y: m.y + dy, z: m.z + dz }, reach.w); };
    }
    A.commit(spec, t);
    return { actor: A, ballAt: own === 'C' && ball ? A.point(ball, new T.Vector3()) : null, socket: ball, own: own, size: s };
  }
  // the three receives blended so the pocket height (this character, at the marker) meets z (model units)
  function blendPockets(M, z) {
    var P = M.pockets, n = P.length;
    if (!n) return { layers: [L('c_crouch', 0)], pocket: new T.Vector3(0.85, z, 1.8) };
    if (n === 1 || z <= P[0].p.y) return { layers: [L(P[0].c, 0, 1)], pocket: P[0].p };
    for (var i = 1; i < n; i++) if (z <= P[i].p.y) {
      var k = (z - P[i - 1].p.y) / Math.max(1e-3, P[i].p.y - P[i - 1].p.y);
      return { layers: [L(P[i - 1].c, 0, 1 - k), L(P[i].c, 0, k)], pocket: P[i - 1].p.clone().lerp(P[i].p, k) };
    }
    return { layers: [L(P[n - 1].c, 0, 1)], pocket: P[n - 1].p };
  }

  // ------------------------------------------------------------------ the umpire
  // bat scene, popping in from the right for a call. o: { callT (s since the call), kind: 'strike' | 'strike3' | 'ball',
  // x, y, yaw, size }. The punch-out lands just after he slides in.
  var CALL = { strike: { c: 'u_strike', at: 0.24 }, strike3: { c: 'u_strike3', at: 0.42 }, ball: { c: 'u_ball', at: 0.1 }, out: { c: 'u_out', at: 0.1 }, safe: { c: 'u_safe', at: 0.1 }, hr: { c: 'u_hr', at: 0 } };
  function poseUmp(v, o) {
    var M = get('U'); if (!M) return null;
    var A = M.actor, t = v.time || 0, cl = CALL[o.kind] || CALL.strike, c = A.has(cl.c) ? cl.c : A.has('u_strike') ? 'u_strike' : null;
    var stance = [L('u_stance', looped(A, 'u_stance', onTwos(t, t)))], layers = stance, face = { blink: A.blinkAt(t, 7), brows_angry: 0.4 };
    if (c && o.callT != null) {
      var mk = M.meta[c] && M.meta[c].markers && Object.keys(M.meta[c].markers).length ? markerOf(M, c, o.kind === 'out' || o.kind === 'safe' ? 'call' : 'punch', 0.35) : cl.at;
      var ct = onTwos(o.callT + mk - cl.at, t);
      if (ct > 0) layers = mixL(stance, [L(c, Math.min(ct, dur(A, c)))], smooth(ct / 0.08));
      face.mouth_open = clamp(1 - Math.abs(o.callT - cl.at) / 0.35, 0, 1) * 0.9; face.brows_angry = 0.8;
    }
    A.place(o.x, o.y, o.z || 0, o.yaw || 0, o.height ? sizeFor(A, o.height) : (o.size || 1)); A.setLod(o.lod || 0);
    A.commit({ key: 'ump-' + (o.kind || ''), fade: 0.1, layers: layers, face: face }, t);
    return { actor: A };
  }

  // ------------------------------------------------------------------ fielders in the bat scene's background
  function poseFielderIdle(i, x, y, yaw, t, cam, viewH) {
    var M = get(ORDER[i]); if (!M) return null;
    var A = M.actor, c = A.has('f_idle') ? 'f_idle' : 'f_ready';
    A.place(x, y, ground(x, y), yaw, 1);
    if (cam) A.autoLod(cam, viewH, LOD_PX); else A.setLod(1);
    A.commit({ key: 'idle', fade: 0, layers: [L(c, looped(A, c, onTwos(t + i * 0.37, t)))], face: { blink: A.blinkAt(t, i) } }, t);
    return A;
  }
  var LOD_PX = 150;   // a fielder taller than this on screen gets LOD0 (fetched if it isn't in yet)
  function lodFor(M, cam, viewH) {
    var A = M.actor, want = A.autoLod(cam, viewH, LOD_PX);
    if (want === 0 && !A.hasLod(0) && !M.lod0Asked && BB.Assets.has(M.files[0])) { M.lod0Asked = true; AC.loadLevel(A, M.files[0], 0).catch(function () {}); }
  }

  // ------------------------------------------------------------------ fielders in the field scene
  var paths = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  // cumulative ground covered by fielder i over the play (for the run cycle's leg phase), tabulated once per play
  function pathOf(play, i) {
    var all = paths ? paths.get(play) : play.__crewPaths;
    if (!all) { all = {}; if (paths) paths.set(play, all); else play.__crewPaths = all; }
    if (all[i]) return all[i];
    var N = 240, D = (play.dur || 3) + 2, d = new Float32Array(N + 1), last = play.fielderAt(i, 0);
    for (var k = 1; k <= N; k++) { var q = play.fielderAt(i, D * k / N); d[k] = d[k - 1] + Math.hypot(q.x - last.x, q.y - last.y); last = q; }
    return (all[i] = { d: d, N: N, D: D });
  }
  function pathAt(P, t) { var f = clamp(t / P.D, 0, 1) * P.N, i = Math.min(P.N - 1, Math.floor(f)); return lerp(P.d[i], P.d[i + 1], f - i); }
  function fSpeed(i) { return i >= 6 ? 27 : i >= 2 ? 24 : i === 0 ? 21 : 18; }   // as 15-bat.js: top running speed (ft/s, physics)
  function yawToward(fx, fy) { return Math.atan2(fx, -fy); }
  function lerpAngle(a, b, k) { var d = ((b - a + PI) % (2 * PI) + 2 * PI) % (2 * PI) - PI; return a + d * k; }
  // who catches the throw: the fielder nearest the ball where the throw ends
  function receiverOf(play) {
    if (!play.throwT) return -1;
    if (play.__crewRecv != null) return play.__crewRecv;
    var e = play.ballAt(play.throwT[1]), best = -1, bd = 1e9;
    for (var i = 0; i < 9; i++) { if (i === play.catchBy) continue; var a = play.fielderAt(i, play.throwT[1]), d = Math.hypot(a.x - e.x, a.y - e.y); if (d < bd) { bd = d; best = i; } }
    return (play.__crewRecv = bd < 12 ? best : -1);
  }
  function catchClipOf(M, play, i) {
    var A = M.actor, cb = play.ballAt(play.catchT), air = play.type === 'OUT' && play.outKind !== 'ground' && cb.z > 1.2;
    if (!air) return A.has('f_field_grounder') ? 'f_field_grounder' : A.has('f_catch_fly') ? 'f_catch_fly' : null;
    var a = play.fielderAt(i, play.catchT - 0.05), b = play.fielderAt(i, play.catchT - 0.15), sp = Math.hypot(a.x - b.x, a.y - b.y) / 0.1;
    var dive = sp > fSpeed(i) * (BB.Bat && BB.Bat.TIME_SCALE || 1.25) * 1.08;
    return dive && A.has('f_catch_dive') ? 'f_catch_dive' : A.has('f_catch_fly') ? 'f_catch_fly' : null;
  }
  // o: { t: playT, tx: playT carried on past the end, cam, viewH, frustum }. Returns null when the role isn't modelled,
  // else { actor, visible, ballAt (world point of the ball if he holds it) }
  function poseFielder(i, v, o) {
    var role = ORDER[i], M = get(role); if (!M) return null;
    var A = M.actor, play = v.play, t = o.t, tx = o.tx != null ? o.tx : t, time = v.time || 0;
    var a = play.fielderAt(i, t), b = play.fielderAt(i, Math.max(0, t - 0.08)), vx = (a.x - b.x) / 0.08, vy = (a.y - b.y) / 0.08, spd = Math.hypot(vx, vy);
    var x = a.x, y = a.y, ball = play.ballAt(t), size = 1;
    // cull before posing: nothing to do for a fielder outside the camera
    A.place(x, y, ground(x, y), A.yaw || 0, size);
    if (o.frustum && !A.inView(o.frustum)) { A.root.visible = false; return { actor: A, visible: false }; }
    lodFor(M, o.cam, o.viewH);
    var face = { blink: A.blinkAt(time, i), brows_angry: 0.3 }, key = 'ready', own = null, sock = null, toward = null, from = null;
    var rest = A.has('f_ready') ? 'f_ready' : 'f_idle', restL = [L(rest, looped(A, rest, onTwos(time + i * 0.41, time)))];
    // legs: the run cycle at the rate that matches the ground he covers
    var g = M.gaits.f_run, runW = smooth((spd - 1.5) / 5), layers = restL;
    if (g && runW > 0) {
      var cyc = pathAt(pathOf(play, i), t) / (g.speed * g.dur * size);
      var rate = Math.min(spd / (g.speed * size), 3.2);           // past ~3x the legs blur: the rest is a zip
      if (spd / (g.speed * size) > 3.2) cyc *= 3.2 / (spd / (g.speed * size));
      layers = mixL(restL, [L('f_run', looped(A, 'f_run', cyc * g.dur))], runW); key = 'run';
      void rate;
    }
    var yaw = spd > 2 ? yawToward(vx, vy) : yawToward(ball.x - x, ball.y - y);
    // the play: catch (or scoop), hold, throw
    if (i === play.catchBy && play.catchT >= 0) {
      var cc = catchClipOf(M, play, i), ca = cc && M.catchAt[cc], cm = ca ? ca.t : 0.4, ct = t - play.catchT + cm;
      var cb0 = play.ballAt(Math.max(0, play.catchT - 0.12)), cb = play.ballAt(play.catchT);
      if (cc && ct > 0) {
        var catchL = [L(cc, Math.min(ct < cm ? ct : cm + onTwos(ct - cm, time), dur(A, cc)))];
        layers = mixL(layers, catchL, smooth(ct / 0.1)); key = cc;
        yaw = yawToward(cb0.x - cb.x, cb0.y - cb.y);              // square to the ball coming in
        // bring the pocket onto the ball over the last steps (the catch point is where his track ends)
        if (ca && ca.p) {
          var pk = smooth(ct / Math.max(0.05, cm)), m = A.mirrored ? -1 : 1, cs = Math.cos(yaw), sn = Math.sin(yaw);
          var ox = ca.p.x * m * size, oz = ca.p.z * size;          // model +X (left) / +Z (forward) at this yaw, world xy
          var wx = ox * cs + oz * sn, wy = ox * sn - oz * cs;
          x = lerp(x, cb.x - wx, pk); y = lerp(y, cb.y - wy, pk);
        }
        if (t >= play.catchT) { own = 'F' + i; sock = ballSocket(M, cc, Math.min(ct, dur(A, cc))) || 'mitt'; }
        else if (t > play.catchT - 0.1) toward = { k: smooth((t - play.catchT + 0.1) / 0.1) };   // the last frames: into the pocket
        face.brows_angry = 0.8 * (1 - smooth((t - play.catchT) / 0.3)); face.mouth_open = t > play.catchT ? 0.4 : 0;
      }
      if (play.throwT && A.has('f_throw')) {
        var tr0 = play.throwT[0], rm = M.throwAt ? M.throwAt.t : 0.35, ts = Math.max(play.catchT + 0.12, tr0 - rm), tt = t - ts;
        if (tt > 0) {
          var th = AC.warp(tt, tr0 - ts, rm), tgt = play.ballAt(play.throwT[1]);
          layers = mixL(layers, [L('f_throw', Math.min(th, dur(A, 'f_throw')))], smooth(tt / 0.08)); key = 'throw';
          yaw = lerpAngle(yaw, yawToward(tgt.x - x, tgt.y - y), smooth(tt / 0.15));
          var ts2 = ballSocket(M, 'f_throw', th);
          if (t < tr0) { own = 'F' + i; sock = ts2 === undefined ? (th < rm * 0.5 ? 'mitt' : 'grip.R') : ts2 || 'grip.R'; }
          else { own = null; if (t < tr0 + 0.15 && M.throwAt && M.throwAt.grip) from = { t0: tr0, k: 1 - smooth((t - tr0) / 0.15), grip: M.throwAt.grip }; }
        }
      }
    }
    var rc = receiverOf(play);
    if (i === rc && A.has('f_catch_fly')) {                     // takes the throw
      var ra = M.catchAt.f_catch_fly, rmk = ra ? ra.t : 0.4, rt = t - play.throwT[1] + rmk;
      if (rt > 0 && rt < dur(A, 'f_catch_fly') + 0.3) { layers = mixL(layers, [L('f_catch_fly', Math.min(rt < rmk ? rt : rmk + onTwos(rt - rmk, time), dur(A, 'f_catch_fly')))], smooth(rt / 0.1) * (1 - smooth((rt - dur(A, 'f_catch_fly')) / 0.3))); key = 'take_throw'; }
      if (t < play.throwT[1] + 0.05) { var tb0 = play.ballAt(play.throwT[0]); yaw = yawToward(tb0.x - x, tb0.y - y); }
      if (t >= play.throwT[1]) { own = 'F' + i; sock = 'mitt'; }
      else if (t > play.throwT[1] - 0.08) toward = { k: smooth((t - play.throwT[1] + 0.08) / 0.08) };
    }
    // after the play: an out is celebrated, a homer watched over the wall
    var outAt = play.type === 'OUT' ? (play.throwT && play.outKind === 'ground' ? play.throwT[1] : play.catchT) : null;
    if (outAt != null && outAt >= 0 && A.has('f_celebrate') && (i === play.catchBy || i === rc || i >= 2)) {
      var ce = onTwos(tx - outAt - (i === play.catchBy || i === rc ? 0.35 : 0.5), time);
      if (ce > 0) { layers = mixL(layers, [L('f_celebrate', Math.min(ce, dur(A, 'f_celebrate')))], smooth(ce / 0.15)); key = 'celebrate'; face.grin = smooth(ce / 0.2); face.brows_up = 0.6; }
    }
    if (play.type === 'HR' && i >= 2 && A.has('f_slump')) {
      var fe = play.fenceT > 0 ? play.fenceT : (play.hang || 2) * 0.8, sl = onTwos(tx - fe + 0.2, time);
      if (sl > 0) { layers = mixL(layers, [L('f_slump', Math.min(sl, dur(A, 'f_slump')))], smooth(sl / 0.2)); key = 'slump'; face.brows_sad = 0.8; face.frown = 0.6; }
    }
    // the pitcher and catcher: a reaction to the hit while they aren't part of the play
    if ((i === 0 || i === 1) && i !== play.catchBy && i !== rc && spd < 1.5) {
      var rcl = i === 0 ? (play.type === 'HR' ? 'p_react_hr' : play.type !== 'OUT' && play.type !== 'FOUL' ? 'p_react_hit' : null)
        : (play.type === 'HR' ? 'c_react_hr' : 'c_stand');
      if (rcl && A.has(rcl)) { var rx = onTwos(tx + FIELD_DELAY, time); layers = mixL(layers, [L(rcl, Math.min(rx, dur(A, rcl)))], smooth(rx / 0.1) * (key === 'ready' ? 1 : 0.3)); if (key === 'ready') key = rcl; }
    }
    // turn smoothly: the heading eases toward the new one (memory per fielder), snapped when far off (a new play)
    var mem = M.mem || (M.mem = {}), dtf = time - (mem.t || 0);
    var yawNow = mem.yaw != null && dtf > 0 && dtf < 0.25 ? lerpAngle(mem.yaw, yaw, clamp(dtf * 9, 0, 1)) : yaw;
    mem.yaw = yawNow; mem.t = time;
    A.place(x, y, ground(x, y), yawNow, size);
    A.commit({ key: key, fade: 0.1, layers: layers, face: face, gaze: { x: ball.x, y: ball.y, z: ball.z }, gazeK: 0.7 }, time);
    if (toward) toward.p = A.point('mitt', new T.Vector3());
    if (from) from.p = A.model.localToWorld(from.grip.clone());   // his grip at the release frame (he stands still to throw)
    return { actor: A, visible: true, own: own, ballAt: own && sock ? A.point(sock, new T.Vector3()) : null, toward: toward, from: from };
  }
  var FIELD_DELAY = 0.22;

  // ------------------------------------------------------------------ Rocco's teammates on the bases
  // o: { x, y, yaw, dist (ft run), speed, arrived, arriveT, home (scored), out, outT, standing, cam, viewH, frustum }
  function poseRunner(k, v, o) {
    var M = get('M' + (k % 3)); if (!M) return null;
    var A = M.actor, time = v.time || 0, size = 1;
    A.place(o.x, o.y, 0, o.yaw, size);
    if (o.frustum && !A.inView(o.frustum)) { A.root.visible = false; return { actor: A, visible: false }; }
    lodFor(M, o.cam, o.viewH);
    var rest = A.has('f_ready') ? [L('f_ready', looped(A, 'f_ready', onTwos(time + k, time)))] : [L(A.has('run') ? 'run' : 'trot', 0)];
    var layers = rest, face = { blink: A.blinkAt(time, 11 + k), brows_angry: 0.5, mouth_open: 0.3 }, key = 'stand';
    if (!o.standing) {
      var gait = A.has('run') ? 'run' : 'trot', g = M.gaits[gait] || { speed: 8, dur: dur(A, gait) };
      var cap = 3.5, cyc = (o.dist || 0) / (g.speed * size * g.dur), want = (o.speed || 0) / (g.speed * size);
      if (want > cap) cyc *= cap / want;
      layers = [L(gait, looped(A, gait, cyc * g.dur))]; key = 'run';
      if (o.arrived && o.arriveT != null) {
        var at = onTwos(o.arriveT, time), end = o.home && A.has('cheer') ? [L('cheer', Math.min(at, dur(A, 'cheer')))] : rest;
        layers = mixL(layers, end, smooth(at / 0.15)); key = o.home ? 'cheer' : 'stand';
        if (o.home) face = { grin: 1, mouth_open: 0.6, brows_up: 1, blink: 0 };
      }
      if (o.out && o.outT > 0) { layers = mixL(layers, rest, smooth(o.outT / 0.3)); face = { frown: 1, brows_sad: 0.8, blink: A.blinkAt(time, k) }; key = 'out'; }
    }
    A.commit({ key: key, fade: 0.12, layers: layers, face: face }, time);
    return { actor: A, visible: true };
  }

  // ------------------------------------------------------------------ the ball between the crew's hands (bat scene)
  // The ball's draw position when the modelled crew holds it or throws it back, else null (BB.Render draws the
  // physics path). pr / cr: the pitcher's and catcher's results this frame; o.pitchPos(p, t).
  var _a = new T.Vector3(), _b = new T.Vector3();
  function ballBat(v, pr, cr, o) {
    var c = pitchClock(v), p = v.pitch;
    if (c.phase !== 'pitch') return pr && pr.ballAt ? { p: pr.ballAt, held: true } : null;
    var r = c.r;
    if (o.ci && o.ci.hit) return null;
    // just out of the hand: the drawn ball leaves from his grip and joins the physics path within 0.12 s
    if (pr && r < 0.12 && pr.res) {
      var w = 1 - smooth(r / 0.12), q = o.pitchPos(p, r);
      return { p: { x: q.x + pr.res.x * w, y: q.y + pr.res.y * w, z: q.z + pr.res.z * w }, blend: true };
    }
    if (r < p.T) return null;
    // into the mitt: past the plate the drawn ball homes in on the pocket, in it when the pitch gets there
    var mt = mittTime(p, o.pitchPos);
    if (cr && cr.actor && r < mt) {
      var mitt = cr.actor.point('mitt', _a), e = o.pitchPos(p, r), k = smooth((r - p.T) / Math.max(0.01, mt - p.T));
      return { p: { x: lerp(e.x, mitt.x, k), y: lerp(e.y, mitt.y, k), z: lerp(e.z, mitt.z, k) } };
    }
    if (cr && cr.ballAt) return { p: cr.ballAt, held: true };
    // the throw back: from the catcher's release to the pitcher's mitt
    var tb = throwBackTimes(p);
    if (cr && cr.actor && r >= tb.rel && r < tb.arrive) {
      var C = get('C'), P = get('P'), u = (r - tb.rel) / TB.flight;
      var from = C && C.throwBack ? C.actor.model.localToWorld(_a.copy(C.throwBack.grip)) : cr.actor.point('grip.R', _a);
      var to = pr && pr.actor ? pr.actor.point('mitt', _b) : (o.pitcherMitt ? _b.copy(o.pitcherMitt) : _b.set(0, 58, 4.5));
      void P;
      return { p: { x: lerp(from.x, to.x, u), y: lerp(from.y, to.y, u), z: lerp(from.z, to.z, u) + TB.arc * 4 * u * (1 - u) }, vel: { x: (to.x - from.x) / TB.flight, y: (to.y - from.y) / TB.flight, z: (to.z - from.z) / TB.flight } };
    }
    if (pr && pr.ballAt && r >= tb.arrive) return { p: pr.ballAt, held: true };
    if (cr && cr.actor && r >= tb.arrive) return { hidden: true };   // in the procedural pitcher's glove
    return null;
  }

  // ------------------------------------------------------------------ status
  function status() {
    var o = { available: true, game: CUR ? CUR.key : null, standin: standin(), team: CUR && CUR.team ? CUR.team.name : null, ms: CUR && CUR.ms != null ? Math.round(CUR.ms) : null, members: {}, libs: {} };
    if (CUR) {
      CUR.list.forEach(function (M) {
        var e = { state: M.state, file: M.files[M.lod != null ? M.lod : M.base] || null };
        if (M.error) e.error = M.error;
        if (M.actor) { var i = M.actor.info(); e.tris = [i.triangles || 0, i.lod1Triangles || 0]; e.calls = i.drawCalls; e.clips = Object.keys(M.actor.clips).length; if (i.warnings.length) e.warnings = i.warnings; e.hip = +(M.hip || 0).toFixed(3); }
        if (M.place) e.scale = +M.place.s.toFixed(3);
        o.members[M.role] = e;
      });
      for (var n in CUR.libs) o.libs[n] = CUR.libs[n].missing ? 'missing' : CUR.libs[n].error ? 'error: ' + CUR.libs[n].error : CUR.libs[n].gltf ? 'loaded' : 'loading';
    }
    return o;
  }

  return {
    available: true, prepare: prepare, release: release, sync: sync, setHeroColors: setHeroColors, hideAll: hideAll, status: status,
    ready: function (role) { return !!get(role); }, actor: function (role) { var M = get(role); return M ? M.actor : null; }, member: function (role) { return CUR && CUR.members[role]; },
    game: function () { return CUR; }, roster: roster, pitchClock: pitchClock, outcome: outcome,
    posePitcher: posePitcher, poseCatcher: poseCatcher, poseUmp: poseUmp, poseFielderIdle: poseFielderIdle, poseFielder: poseFielder, poseRunner: poseRunner,
    ballBat: ballBat, throwBackTimes: throwBackTimes, ORDER: ORDER, TB: TB, LOD_PX: LOD_PX,
  };
})();
