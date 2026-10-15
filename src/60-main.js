// 60-main.js — boot, loop, input and the at-bat state machine. Owned by the lead.
// Wires Rules -> Pitch/Bat -> Meta -> Audio -> Render. See docs/CONTRACT.md for the module APIs.
(function () {
  var K = BB.K, U = BB.U;
  var canvas, cssW = 0, cssH = 0;
  var clock = 0;                 // seconds since boot (real time, frozen while the page is hidden)
  var lastNow = 0;               // performance.now() of the last frame
  var raf = 0;

  // Phases: menu | intro | windup | pitch | field | between | over
  var G = {
    phase: 'menu', paused: false, mode: null, cfg: null, rs: null, park: null, pitcher: null, bat: null, inkset: null,
    pitch: null, pitchT: 0, windupT: 0, swing: null, loading: null, resolved: false, mittDone: false, whooshDone: false,
    play: null, playT: 0, runners: [], event: null, pendingEvent: null, stamp: null, stampAt: 0, shake: 0, hitstopT: 0,
    phaseT: 0, last: null, crowd: 0.25, auto: null, pitchNo: 0, hints: 0, titlePark: 0, results: null,
  };

  function has(mod, fn) { return BB[mod] && typeof BB[mod][fn] === 'function'; }
  function call(mod, fn) {
    if (!has(mod, fn)) return undefined;
    try { return BB[mod][fn].apply(BB[mod], Array.prototype.slice.call(arguments, 2)); }
    catch (e) { console.error('BB.' + mod + '.' + fn, e); return undefined; }
  }
  function settings() { return call('Meta', 'settings') || {}; }
  function sfx(name, opts) { call('Audio', 'sfx', name, opts || {}); }
  function haptic(kind) { if (settings().haptics !== false && BB.Haptics && BB.Haptics[kind]) { try { BB.Haptics[kind](); } catch (e) {} } }

  // ---------------------------------------------------------------- layout
  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    if (w === cssW && h === cssH) return;
    cssW = w; cssH = h;
    var dpr = Math.min(window.devicePixelRatio || 1, K.MAX_DPR);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    call('Render', 'resize', w, h, dpr);
  }

  // ---------------------------------------------------------------- game lifecycle
  function applySettings() {
    var s = settings();
    call('Audio', 'setMuted', s.sound === false);
    call('Audio', 'setMusic', s.music !== false);
    if (BB.Haptics) BB.Haptics.enabled = s.haptics !== false;
  }

  function start(mode, cfg) {
    cfg = cfg || {};
    var rs = call('Rules', 'create', mode, cfg);
    if (!rs) { console.error('Rules.create failed'); return; }
    G.mode = mode; G.cfg = cfg; G.rs = rs;
    G.park = rs.park || (cfg.park && call('Content', 'getPark', cfg.park)) || (BB.Content && BB.Content.PARKS && BB.Content.PARKS[0]);
    G.pitcher = rs.pitcher || (cfg.pitcher && call('Content', 'getPitcher', cfg.pitcher));
    G.bat = call('Meta', 'currentBat') || { id: 'b_default', name: 'Bat', timing: 1, power: 1, lift: 0 };
    G.inkset = call('Meta', 'currentInkset', G.park) || BB.INKSETS[0];
    call('Render', 'setInks', G.inkset);
    G.paused = false; G.pitchNo = 0; G.last = null; G.results = null; G.event = null;
    resetPitch();
    applySettings();
    call('UI', 'hideAll');
    call('UI', 'inGame', true);
    call('Audio', 'organ', 'stop');
    call('Audio', 'organ', 'walkup');
    var hud = call('Rules', 'hud', rs) || {};
    setStamp('PLAY BALL!', hud.goal || '', 'neutral');
    setPhase('intro');
  }

  function quit() {
    G.paused = false;
    call('UI', 'inGame', false);
    call('Audio', 'crowd', 0);
    call('Audio', 'organ', 'menu');
    G.rs = null; G.loading = null;
    setPhase('menu');
    call('UI', 'show', 'title');
  }

  function resetPitch() {
    G.pitch = null; G.pitchT = 0; G.windupT = 0; G.swing = null; G.loading = null; G.resolved = false;
    G.mittDone = false; G.whooshDone = false; G.play = null; G.playT = 0; G.runners = []; G.pendingEvent = null;
  }

  function setPhase(p) { G.phase = p; G.phaseT = 0; }
  function setStamp(text, sub, kind) { G.stamp = { text: text, sub: sub || '', kind: kind || 'neutral', t: 0 }; }

  function nextPitch() {
    resetPitch();
    G.pitch = call('Rules', 'nextPitch', G.rs);
    if (!G.pitch) { finish(); return; }
    G.pitchNo++;
    if (G.hints < 3 && !hintSeen()) {
      setStamp(G.hints === 2 ? 'LAY OFF BALLS' : G.hints === 1 ? 'HOLD = POWER' : 'TAP TO SWING',
        G.hints === 1 ? 'press during the windup, let go to swing' : G.hints === 2 ? 'pitches outside the box are hard to hit' : 'when the ball reaches the plate', 'neutral');
      G.hints++;
      if (G.hints === 3) markHintSeen();
    }
    setPhase('windup');
  }

  function hintSeen() { try { return localStorage.getItem('halftone.hints') === '1'; } catch (e) { return G.hints >= 3; } }
  function markHintSeen() { try { localStorage.setItem('halftone.hints', '1'); } catch (e) {} }

  // ---------------------------------------------------------------- input
  function gameTimeAt(evStamp) {
    // pitchT at the moment of the input event, not the moment of the next frame: precise timing matters.
    var ahead = 0;
    if (typeof evStamp === 'number' && evStamp > 0 && evStamp <= performance.now() + 1) ahead = (evStamp - lastNow) / 1000;
    return G.pitchT + U.clamp(ahead, -0.05, 0.05);
  }

  function doSwing(power, evStamp) {
    if (G.phase !== 'pitch' || G.swing) return;
    var t = gameTimeAt(evStamp);
    var lat = (settings().latencyMs != null ? settings().latencyMs : K.INPUT_LATENCY * 1000) / 1000;
    var timingErr = (t - lat + K.SWING_LAG) - G.pitch.T;
    var rng = swingRng();
    var res = call('Bat', 'swing', G.pitch, timingErr, G.bat, { power: !!power, rng: rng }) ||
      { contact: false, label: 'WHIFF', timingErr: timingErr, quality: 0, ev: 0, la: 0, spray: 0, power: !!power };
    G.swing = { t: 0, start: t, result: res, power: !!power, rng: rng };
    G.loading = null;
    haptic('tap');
  }

  function swingRng() {
    var rs = G.rs;
    if (rs && typeof rs.swingRng === 'function') return rs.swingRng(G.pitch);
    return (rs && rs.rng) || Math.random;
  }

  function onDown(e) {
    call('Audio', 'unlock');
    if (G.paused || !G.rs) return;
    e.preventDefault();
    var ts = e.timeStamp;
    if (G.phase === 'windup' || (G.phase === 'intro' && G.phaseT > 0.6) || G.phase === 'between') {
      if (!G.loading && G.phase === 'windup') G.loading = { since: G.windupT, level: 0, id: e.pointerId };
      return;
    }
    if (G.phase === 'pitch' && !G.swing) {
      if (G.loading) return; // the release will swing
      doSwing(false, ts);
      return;
    }
    if (G.phase === 'field') { G.playT = Math.max(G.playT, G.play ? G.play.dur : 0); }
  }
  function onUp(e) {
    if (!G.loading || G.paused) return;
    if (G.loading.id != null && e.pointerId != null && e.pointerId !== G.loading.id) return;
    if (G.phase === 'pitch' && !G.swing) doSwing(G.loading.level >= 0.35, e.timeStamp);
    G.loading = null;
  }

  // ---------------------------------------------------------------- update
  function update(dt) {
    G.phaseT += dt;
    if (G.stamp) G.stamp.t += dt;
    G.shake = Math.max(0, G.shake - dt * 2.2);
    var rs = G.rs;

    switch (G.phase) {
      case 'intro':
        if (G.phaseT > 1.6) nextPitch();
        break;

      case 'windup':
        G.windupT += dt;
        if (G.loading) G.loading.level = U.clamp((G.windupT - G.loading.since) / 0.35, 0, 1);
        if (G.windupT >= K.WINDUP) { setPhase('pitch'); G.pitchT = 0; }
        break;

      case 'pitch':
        G.pitchT += dt;
        var p = G.pitch;
        if (G.loading) G.loading.level = 1;
        if (G.swing) G.swing.t += dt;
        if (!G.whooshDone && G.pitchT > p.T - 0.25) { G.whooshDone = true; sfx('whoosh', { mph: p.mph }); }
        if (G.auto && !G.swing) autoBat(p);
        if (!G.resolved && G.swing && G.swing.result.contact) {
          // the bat meets the ball when the ball reaches the plate (or a hair after, on a late swing)
          var contactT = p.T + U.clamp(G.swing.result.timingErr, 0, 0.08);
          if (G.pitchT >= contactT) contact();
        } else if (!G.resolved && G.pitchT >= p.T + 0.12) {
          G.resolved = true;
          if (G.swing) resolveWhiff(); else resolveTake();
        }
        if (G.resolved && !G.play) {
          if (!G.mittDone && G.pitchT >= p.T + 0.1) { G.mittDone = true; sfx('mitt', { mph: p.mph }); }
          if (G.pitchT >= p.T + K.POST_PITCH) afterEvent();
        }
        break;

      case 'field':
        G.playT += dt;
        if (G.playT < 0) { G.pitchT += dt; if (G.swing) G.swing.t += dt; }
        var pl = G.play;
        if (G.pendingEvent && G.playT >= stampTimeFor(pl)) showEvent(G.pendingEvent), G.pendingEvent = null;
        if (pl.wall && !G.wallDone && pl.hang && G.playT >= pl.hang) { G.wallDone = true; sfx('wall'); G.shake = 0.4; }
        if (G.playT >= pl.dur + 0.35) {
          if (G.pendingEvent) { showEvent(G.pendingEvent); G.pendingEvent = null; }
          afterEvent();
        }
        break;

      case 'between':
        var wait = G.event && (G.event.call === 'HR') ? 1.1 : G.play ? 0.6 : 0.45;
        if (G.event && G.event.over) wait = 1.5;
        if (G.phaseT >= wait) {
          if (G.event && G.event.over || call('Rules', 'isOver', rs)) finish(); else nextPitch();
        }
        break;
    }

    // crowd bed follows the drama
    var target = 0.22;
    if (rs) {
      if (rs.onFire) target += 0.2;
      if (G.phase === 'windup') target += 0.08 * G.windupT;
      if (G.phase === 'field' && G.play && G.play.type !== 'FOUL' && G.play.type !== 'OUT') target = 0.85;
    } else target = 0;
    G.crowd += (target - G.crowd) * Math.min(1, dt * 2);
    call('Audio', 'crowd', G.crowd);
  }

  function stampTimeFor(pl) {
    if (pl.type === 'HR') return Math.min(pl.dur - 0.9, Math.max(0.6, (pl.hang || pl.dur) * 0.55));
    if (pl.type === 'FOUL') return 0.35;
    if (pl.catchT > 0) return Math.min(pl.catchT, pl.dur - 0.5);
    return Math.min(pl.hang || 1, pl.dur - 0.5);
  }

  function contact() {
    G.resolved = true;
    var s = G.swing.result;
    var play = call('Bat', 'play', s, G.park, G.swing.rng, { bases: G.rs.bases, outs: G.rs.outs }) ||
      { type: 'OUT', outKind: 'ground', dur: K.FIELD_MIN, hang: 1, catchT: 1, catchBy: 5, ballAt: function () { return { x: 0, y: 60, z: 0 }; }, fielderAt: function () { return { x: 0, y: 60 }; }, fielders: [], desc: '' };
    var ev = call('Rules', 'inPlay', G.rs, G.pitch, s, play) || { call: play.type, runs: 0, outs: 0, runnerMoves: [], text: play.type, sub: '' };
    G.play = play; G.playT = 0; G.wallDone = false;
    G.runners = ev.runnerMoves || [];
    G.last = { mph: G.pitch.mph, name: G.pitch.name, ev: s.ev, la: s.la };
    sfx(play.type === 'FOUL' ? 'foul' : 'crack', { quality: s.quality, sweet: s.sweet });
    if (s.sweet) { G.hitstopT = 0.09; G.shake = 1; haptic('thud'); } else { G.shake = 0.35 + 0.4 * s.quality; haptic('tap'); }
    track(ev, s, play);
    if (play.type === 'HR') {
      call('Audio', 'cheer', 1);
      setTimeout(function () { call('Audio', 'organ', 'homer'); }, 700);
    } else if (play.type !== 'FOUL' && play.type !== 'OUT') call('Audio', 'cheer', 0.5 + 0.1 * ['1B', '2B', '3B'].indexOf(play.type));
    G.pendingEvent = ev;
    G.event = ev;
    // fouls and routine outs don't need the full park tour
    if (play.type === 'FOUL') play.dur = Math.min(play.dur, 1.7);
    G.fieldDelay = 0.22;
    setPhase('field');
    G.playT = -G.fieldDelay; // linger a beat on the bat scene with the ball rocketing away
  }

  function resolveWhiff() {
    var ev = call('Rules', 'whiff', G.rs, G.pitch, G.swing.result) || { call: 'STRIKE', text: 'STRIKE', sub: '' };
    G.last = { mph: G.pitch.mph, name: G.pitch.name };
    sfx('whiff');
    track(ev, G.swing.result, null);
    showEvent(ev);
    G.event = ev;
  }

  function resolveTake() {
    var ev = call('Rules', 'take', G.rs, G.pitch) || { call: G.pitch.strike ? 'STRIKE' : 'BALL', text: '', sub: '' };
    G.last = { mph: G.pitch.mph, name: G.pitch.name };
    track(ev, null, null);
    showEvent(ev);
    G.event = ev;
  }

  function showEvent(ev) {
    var c = ev.call, kind = 'neutral';
    if (c === 'HR') kind = 'huge';
    else if (c === '1B' || c === '2B' || c === '3B' || c === 'WALK' || c === 'SF') kind = 'good';
    else if (c === 'K' || c === 'OUT' || c === 'DP') kind = 'bad';
    else if (c === 'STRIKE' && G.swing) kind = 'bad';
    setStamp(ev.text || c, ev.sub || '', kind);
    if (c === 'STRIKE') sfx('strike'); else if (c === 'BALL') sfx('ball');
    if (c === 'K' || c === 'OUT' || c === 'DP') { sfx('out'); if (c !== 'OUT' || ev.over) call('Audio', 'groan'); }
    if (c === 'WALK') call('Audio', 'cheer', 0.3);
    if (kind !== 'neutral') sfx('stamp');
    if (G.rs && G.rs.onFire && (c === '1B' || c === '2B' || c === '3B' || c === 'HR') && G.rs.streak === 3) call('Audio', 'organ', 'rally');
  }

  function afterEvent() { setPhase('between'); }

  function track(ev, swing, play) {
    var got = call('Meta', 'onEvent', { mode: G.mode, event: ev, swing: swing, play: play, pitch: G.pitch });
    if (got && got.length) got.forEach(function (a, i) {
      setTimeout(function () { call('UI', 'toast', 'STAMPED: ' + a.name, 'ach'); sfx('unlock'); }, 900 + i * 700);
    });
  }

  function finish() {
    if (G.phase === 'over') return;
    var result = call('Rules', 'result', G.rs) || { mode: G.mode, win: false, stars: 0, score: 0, stats: {} };
    var rewards = call('Meta', 'endGame', G.mode, G.cfg, result) || {};
    G.results = { mode: G.mode, cfg: G.cfg, result: result, rewards: rewards };
    call('Audio', 'organ', result.win || G.mode !== 'tour' && result.score > 0 ? 'win' : 'lose');
    setPhase('over');
    G.loading = null;
    setTimeout(function () {
      if (G.phase !== 'over') return;
      call('UI', 'inGame', false);
      call('UI', 'show', 'results', G.results);
    }, 900);
  }

  // ---------------------------------------------------------------- test / autoplay hook
  function autoBat(p) {
    // swings with a normal timing error of sd = G.auto.sd; lays off pitches outside the zone G.auto.eye of the time
    if (G.autoPlan !== p) {
      G.autoPlan = p;
      var r = Math.random;
      G.autoSwing = !(!p.strike && r() < (G.auto.eye || 0.6));
      G.autoErr = U.gauss(r) * (G.auto.sd || 0.04);
      G.autoPower = r() < (G.auto.power || 0.3);
    }
    if (!G.autoSwing) return;
    var lat = (settings().latencyMs != null ? settings().latencyMs : K.INPUT_LATENCY * 1000) / 1000;
    var at = p.T + G.autoErr - K.SWING_LAG + lat;
    if (G.pitchT >= at) doSwing(G.autoPower);
  }

  // ---------------------------------------------------------------- render
  function view() {
    var rs = G.rs;
    if (!rs || G.phase === 'menu') {
      return { scene: 'title', time: clock, park: titlePark(), hud: null };
    }
    var v = {
      scene: (G.phase === 'field' && G.playT >= 0) || (G.phase === 'between' && G.play) || (G.phase === 'over' && G.play) ? 'field' : 'bat',
      time: clock, park: G.park, pitcher: G.pitcher, bat: G.bat,
      windup: G.phase === 'windup' ? U.clamp(G.windupT / K.WINDUP, 0, 1) : null,
      pitch: G.pitch && (G.phase === 'pitch' || G.phase === 'field' || G.phase === 'between') ? G.pitch : null,
      pitchT: G.phase === 'windup' ? null : G.pitchT,
      swing: G.swing ? { t: G.swing.t, result: G.swing.result, power: G.swing.power } : null,
      loading: G.loading ? G.loading.level : null,
      assist: settings().assist !== false,
      play: G.play, playT: Math.max(0, G.play ? Math.min(G.playT, G.play.dur) : 0),
      runners: G.runners,
      hud: call('Rules', 'hud', rs) || null,
      stamp: G.stamp && G.stamp.t < 2 ? G.stamp : null,
      onFire: !!rs.onFire, shake: G.shake, hitstop: G.hitstopT > 0,
      last: G.last,
    };
    return v;
  }

  function titlePark() {
    var P = BB.Content && BB.Content.PARKS;
    if (!P || !P.length) return null;
    return P[Math.floor(clock / 20) % P.length];
  }

  var lastInkFor = null;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    var dt = lastNow ? (now - lastNow) / 1000 : 0;
    lastNow = now;
    dt = Math.min(Math.max(dt, 0), 0.05);
    resize();
    clock += dt;
    if (G.hitstopT > 0) { G.hitstopT -= dt; dt = 0; }
    if (!G.paused) update(dt);
    var v = view();
    if (v.scene === 'title') {
      var ink = call('Meta', 'currentInkset', v.park) || BB.INKSETS[0];
      if (ink !== lastInkFor) { lastInkFor = ink; call('Render', 'setInks', ink); }
    } else lastInkFor = null;
    call('Render', 'frame', v);
  }

  // ---------------------------------------------------------------- boot
  function boot() {
    canvas = document.getElementById('game');
    if (!canvas) { canvas = document.createElement('canvas'); canvas.id = 'game'; document.body.prepend(canvas); }
    call('Render', 'init', canvas);
    resize();
    canvas.addEventListener('pointerdown', onDown, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    document.addEventListener('touchmove', function (e) { if (e.target === canvas) e.preventDefault(); }, { passive: false });
    window.addEventListener('keydown', function (e) {
      if (e.repeat) return;
      if (e.code === 'Space') { onDown({ preventDefault: function () {}, timeStamp: e.timeStamp, pointerId: 'key' }); e.preventDefault(); }
      if ((e.code === 'Escape' || e.code === 'KeyP') && G.rs && G.phase !== 'over') { if (G.paused) resume(); else { pause(); call('UI', 'show', 'pause'); } }
    });
    window.addEventListener('keyup', function (e) { if (e.code === 'Space') onUp({ timeStamp: e.timeStamp, pointerId: 'key' }); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (G.rs && G.phase !== 'over' && !G.paused) { pause(); call('UI', 'show', 'pause'); }
        call('Audio', 'crowd', 0);
      }
      lastNow = 0;
    });
    window.addEventListener('resize', resize);
    applySettings();
    call('UI', 'init');
    raf = requestAnimationFrame(frame);
  }

  function pause() { if (G.rs && G.phase !== 'over') { G.paused = true; G.loading = null; call('Audio', 'crowd', 0); } }
  function resume() { if (G.paused) { G.paused = false; applySettings(); call('UI', 'hideAll'); call('UI', 'inGame', true); } }
  function restart() { if (G.mode) { var m = G.mode, c = G.cfg; G.rs = null; start(m, c); } }

  BB.Game = {
    start: start, pause: pause, resume: resume, quit: quit, restart: restart,
    running: function () { return !!G.rs && G.phase !== 'over'; },
    paused: function () { return G.paused; },
    applySettings: applySettings,
  };

  // Test hooks for tools/qa-*.js
  window.__bb = {
    G: G,
    auto: function (opts) { G.auto = opts || null; },     // e.g. __bb.auto({sd: .04, eye: .7, power: .3})
    swing: function (power) { doSwing(!!power); },
    view: view,
    clock: function () { return clock; },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
