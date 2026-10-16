// 36-rocco.js — BB.Rocco: the modelled hero, a batter driver on top of BB.Actors (36-actors.js). Owned by the
// integration agent. The asset contract is docs/PILOT-ROCCO.md; the asset is 'rocco' in BB.Assets (inlined in the
// page) plus an optional 'rocco_lod1' file for the field scene.
// The driver maps game state to clips, shape keys and gaze; BB.Render (35-scene) places him and calls poseBat /
// poseHome / poseRun / poseTitle once per frame.
// If the asset is missing, fails to load, breaks the contract, or the page has ?rocco=old, ready() stays false and
// BB.Render keeps the procedural Rocco (BB.Cast / BB.Anim) exactly as before.
//
// Poses are a pure function of the state passed in (like BB.Anim), so a harness frame shows exactly what the game
// shows at that instant. Two small bits of frame-to-frame memory sit on top: a short snapshot crossfade over
// discontinuities (dizzy -> the next windup, swing during the stride ...) and, once a pitch is resolved and main
// stops advancing pitchT ('between'), the reaction keeps playing on the clock.
// Model space: glTF Y-up, facing +Z, his left = +X. World: Z-up; up.rotation.x = PI/2 and root.rotation.z = yaw, the
// same convention as BB.Cast characters (yaw PI/2 = facing +x, i.e. a right-handed hitter facing the plate).
BB.Rocco = (function () {
  var T = (typeof THREE !== 'undefined') ? THREE : null;
  var R = { status: 'idle', error: null, warnings: [] };
  function no() { return false; }
  var API = { ready: no, status: function () { return R.status; }, boot: function (cb) { if (cb) cb(R.status); }, loadBuffer: function (b, cb) { if (cb) cb('unavailable'); }, R: R,
    whenReady: function () { return Promise.resolve(false); }, actor: function () { return null; } };
  if (!T || !BB.Actors || !BB.Actors.available || !BB.U) { R.status = 'unavailable'; return API; }
  var U = BB.U, K = BB.K, PI = Math.PI, AC = BB.Actors;
  var clamp = U.clamp, smooth = U.smooth, L = AC.L, mixL = AC.mixL, twos = AC.twos, onTwos = AC.onTwos;

  // ------------------------------------------------------------------ contract tables
  var PALETTE = { fur: '#9A97A6', fur_light: '#F2EDE3', mask: '#2E2A38', nose: '#1B1420', eye_white: '#FFFFFF', pupil: '#1B1420', mouth: '#5A1F2A', tongue: '#E0605A',
    uniform: '#FFF6E6', team_a: '#2E5AAC', team_b: '#D9483B', belt: '#3B2F2A', sock: '#FFFFFF', shoe: '#1E1A22', sole: '#4A3F3A', lace: '#FFFFFF', glove: '#FFFFFF',
    bat_wood: '#D9A066', bat_tape: '#2E5AAC', decal_chest: '#2E5AAC', decal_back: '#2E5AAC' };
  var CLIPS = ['stance', 'stride', 'power_load', 'coil_hold', 'swing_high', 'swing_mid', 'swing_low', 'whiff', 'dizzy', 'watch', 'bat_flip', 'run', 'trot', 'cheer', 'take', 'strike_react',
    'glance', 'ritual'];
  var BONES = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'jaw', 'ear.L', 'ear.R', 'eye.L', 'eye.R', 'brow.L', 'brow.R', 'tail.1', 'tail.2', 'tail.3', 'tail.4', 'tail.5',
    'shoulder.L', 'shoulder.R', 'upper_arm.L', 'upper_arm.R', 'forearm.L', 'forearm.R', 'hand.L', 'hand.R', 'thigh.L', 'thigh.R', 'shin.L', 'shin.R', 'foot.L', 'foot.R',
    'toe.L', 'toe.R', 'bat', 'bat_sweet', 'bat_tip', 'fingers.L', 'fingers.R', 'thumb.L', 'thumb.R'];
  var SHAPES = ['blink', 'smile', 'grin', 'frown', 'mouth_open', 'brows_up', 'brows_angry', 'brows_sad', 'squint', 'cheeks_puff', 'smirk'];
  AC.define('rocco', {
    palette: PALETTE,
    team: { team_a: 'a', team_b: 'b', bat_tape: 'a', decal_chest: 'a', decal_back: 'a' },     // recoloured from the uniform scheme
    hull: { pupil: 0, tongue: 0, mouth: 0.4, nose: 0.6, eye_white: 0.55, lace: 0.45, sole: 0.9, glove: 0.95, decal_chest: 0, decal_back: 0 },
    ink: { pupil: 0.55, eye_white: 0.7, nose: 0.8, mouth: 0.7, tongue: 0.6, lace: 0.6 },   // BB.Ink line weight per material
    decals: { decal_chest: { text: 'R', side: 'front' }, decal_back: { text: '7', side: 'back' } },
    props: { bat_wood: 'bat', bat_tape: 'bat' },
    emissive: { eye_white: '#3A3A3A' },
    bones: BONES, need: ['root', 'head', 'bat'], clips: CLIPS, needClips: ['stance'], shapes: SHAPES,
    idle: 'stance', eyeSquash: true, inkBase: 7000, strictMaterials: true,
    // ground speed of the in-place run cycles at 1x where the planted feet stay put, as authored (pass 2 notes; the
    // f_run sidecar plays this role for the cast). Without it the speed is measured from the feet at load.
    gaitSpeed: { run: 8.4, trot: 2.4 },
  });
  var CONTACT_T = 0.25;   // contract: the contact frame of every swing clip
  var FLIP_AT = 0.18;     // a homer: the bat flip starts this long after contact (end of the follow-through wrap)
  var HOT = { color: '#F28C38', emissive: '#6A2200' };
  var RITUAL_EVERY = 4;   // the plate-tap ritual: before the first pitch of a game, then about every 4th windup

  function warn(msg) { R.warnings.push(msg); }
  var A = null;           // the actor

  // ------------------------------------------------------------------ boot / load
  function wanted() {
    try { if (/[?&]rocco=(old|0|off|proc)(&|$)/.test(location.search)) return false; } catch (e) {}
    return !(typeof window !== 'undefined' && window.BB_ROCCO === 'old');
  }
  function boot(cb) {
    if (R.status !== 'idle') { if (cb) cb(R.status); return; }
    if (!wanted()) { R.status = 'off'; waiters.splice(0).forEach(function (f) { f(false); }); if (cb) cb(R.status); return; }
    if (!BB.Assets.has('rocco')) {   // an older harness may still hand the buffer over through BB.assetBuffer
      var buf = null;
      try { buf = BB.assetBuffer && BB.assetBuffer('rocco'); } catch (e) { buf = null; }
      if (buf) BB.Assets.provide('rocco', buf);
    }
    if (!BB.Assets.has('rocco')) { R.status = 'missing'; waiters.splice(0).forEach(function (f) { f(false); }); if (cb) cb(R.status); return; }
    load(cb);
  }
  function loadBuffer(buf, cb) {
    if (A) { try { A.dispose(); } catch (e) {} A = null; }
    BB.Assets.provide('rocco', buf);
    R.status = 'idle';
    load(cb);
  }
  var waiters = [];
  // resolves true once the model is in, false if the procedural Rocco stays
  function whenReady() {
    return new Promise(function (res) {
      if (R.status === 'ready') return res(true);
      if (R.status !== 'loading' && R.status !== 'idle') return res(false);
      waiters.push(res);
    });
  }
  function load(cb) {
    R.status = 'loading'; R.error = null; R.warnings = [];
    var t0 = (typeof performance !== 'undefined') ? performance.now() : 0;
    function done() {
      waiters.splice(0).forEach(function (f) { f(R.status === 'ready'); });
      if (cb) { try { cb(R.status); } catch (e) { console.warn(e); } }
    }
    AC.create('rocco').then(function (actor) {
      try { build(actor); R.status = 'ready'; R.loadMs = ((typeof performance !== 'undefined') ? performance.now() : 0) - t0; }
      catch (e) { fail(e); }
      done();
    }, function (e) { fail(e); done(); });
  }
  function fail(e) {
    R.status = 'failed'; R.error = String((e && e.message) || e);
    console.warn('BB.Rocco: keeping the procedural Rocco (' + R.error + ')');
  }
  // the field scene's distant runner: LOD1 if the build ships one (parsed on demand, see BB.Render.prepare)
  function prepareLod() {
    if (!A) return Promise.resolve(false);
    return AC.loadLod(A, 1).then(function (ok) { if (ok) { R.lod1 = true; R.lod1Tris = A.info().lod1Triangles; } return ok; }, function (e) { warn('lod1: ' + (e.message || e)); return false; });
  }
  function releaseLod() { if (A) A.dropLod(1); R.lod1 = false; }

  function build(actor) {
    if (!(actor.clips.swing_mid || actor.clips.swing_high || actor.clips.swing_low)) throw new Error('rocco.glb needs at least one swing clip');
    A = actor;
    R.actor = A; R.root = A.root; R.model = A.model; R.up = A.up; R.bones = A.bones; R.meshes = A.meshes; R.clips = A.clips;
    R.warnings = R.warnings.concat(A.warnings);
    R.bat = A.ofKind('bat');
    if (!R.bat.length) warn('no bat_wood / bat_tape meshes');
    R.batProp = A.makeProp('bat', 'bat');
    if (R.batProp) {   // its axis: bat bone -> bat_tip, in bat space
      R.batProp.userData.len = 2.8; R.batProp.userData.axis = new T.Vector3(0, 1, 0);
      var tipB = A.bones.bat_tip;
      if (tipB && tipB.parent === A.bones.bat) { R.batProp.userData.axis.copy(tipB.position).normalize(); R.batProp.userData.len = tipB.position.length(); }
    }
    R.size = 1;
    if (R.team) A.setColors(R.team);
    measure();
  }
  var has = function (c) { return !!(A && A.clips[c]); };
  var dur = function (c) { return A ? A.dur(c) : 1; };
  var first = function () { return A.first.apply(A, arguments); };
  var looped = function (c, t) { return A.looped(c, t); };

  // ------------------------------------------------------------------ colours
  function setColors(c) { if (!c) return; R.team = c; if (A) A.setColors(c); }
  function setHot(on) { if (A) A.override('bat_wood', on ? HOT : null); }

  // ------------------------------------------------------------------ measurements made once after loading
  var V = new T.Vector3(), V3 = new T.Vector3();
  function modelPoint(b, out) { return A.modelPoint(b, out); }
  function measure() {
    var B = A.bones, info = { swings: {} };
    A.model.updateMatrixWorld(true);
    ['swing_high', 'swing_mid', 'swing_low'].forEach(function (c) {
      if (!has(c)) return;
      A.evaluate([L(c, CONTACT_T)]); A.model.updateMatrixWorld(true);
      var sweet = B.bat_sweet ? modelPoint(B.bat_sweet, new T.Vector3()) : null, tip = B.bat_tip ? modelPoint(B.bat_tip, new T.Vector3()) : null, grip = modelPoint(B.bat, new T.Vector3());
      info.swings[c] = { sweet: sweet || tip || grip, tip: tip, grip: grip };
    });
    if (!B.bat_sweet) warn('no bat_sweet bone: aiming with ' + (B.bat_tip ? 'bat_tip' : 'the bat bone'));
    A.evaluate([L('stance', 0)]); A.model.updateMatrixWorld(true);
    var box = new T.Box3();
    A.lods[0].forEach(function (m) { if (m.userData.kind === 'body') box.expandByObject(m); });
    info.stanceBox = box;
    info.head = modelPoint(B.head, new T.Vector3());
    info.feet = [B['foot.L'], B['foot.R']].filter(Boolean).map(function (b) { return modelPoint(b, new T.Vector3()); });
    info.restBox = A.restBox;
    R.headLocal = A.headLocal;
    R.info = info;
    samplePaths();
    // the bat's flight in bat_flip (bat bone in model space), so the prop can keep flying once Rocco trots off
    R.flipPath = null;
    if (has('bat_flip') && B.bat) {
      R.flipPath = [];
      var inv = new T.Matrix4();
      for (var fi = 0, fn = Math.ceil(dur('bat_flip') / 0.025); fi <= fn; fi++) {
        A.evaluate([L('bat_flip', Math.min(fi * 0.025, dur('bat_flip')))]); A.model.updateMatrixWorld(true);
        inv.copy(A.model.matrixWorld).invert();
        R.flipPath.push(new T.Matrix4().multiplyMatrices(inv, B.bat.matrixWorld));
      }
    }
    R.gaits = {};
    ['run', 'trot'].forEach(function (c) {
      if (!has(c)) return;
      var g = gaitOf(c), authored = A.cfg.gaitSpeed && A.cfg.gaitSpeed[c];
      g.measured = g.treadmill;
      if (authored) { g.treadmill = authored; g.stride = authored * dur(c); }
      R.gaits[c] = g;
    });
    A.evaluate([L('stance', 0)]);
  }
  // a run cycle played in place: how far the planted foot slides back per cycle (the ground it covers), so the legs
  // can be played at the rate that keeps the feet from skating. The contact point is the lower of ankle and toe; it
  // counts as planted within 0.06 ft of its lowest.
  function gaitOf(c) {
    var d = dur(c), n = 80, out = { stride: 0, treadmill: 0 }, back = [];
    ['L', 'R'].forEach(function (side) {
      var f = A.bones['foot.' + side], to = A.bones['toe.' + side]; if (!f) return;
      var p = [];
      for (var i = 0; i <= n; i++) {
        A.evaluate([L(c, d * i / n)]); A.model.updateMatrixWorld(true);
        var a = modelPoint(f, new T.Vector3()), b = to ? modelPoint(to, new T.Vector3()) : a;
        p.push(b.y < a.y ? b : a);
      }
      var lo = Math.min.apply(null, p.map(function (q) { return q.y; }));
      for (var j = 0; j < n; j++) if (p[j].y < lo + 0.06 && p[j + 1].y < lo + 0.06) back.push(-(p[j + 1].z - p[j].z) / (d / n));   // ft per clip-second toward -Z
    });
    if (!back.length) return out;
    back.sort(function (a, b) { return a - b; });
    out.treadmill = back[back.length >> 1];        // ground speed at 1x playback
    out.stride = out.treadmill * d;               // ft of ground per cycle
    return out;
  }
  // where to put the root so the contact frame of the middle swing meets a point in the world (yaw = PI/2: model
  // +Z -> world +x, model +X -> world +y, model +Y -> world +z)
  function solvePlacement(target, size) {
    var sw = R.info.swings.swing_mid || R.info.swings.swing_high || R.info.swings.swing_low, s = sw.sweet;
    return { x: target.x - size * s.z, y: target.y - size * s.x, z: 0, size: size, sweet: s.clone() };
  }
  // a sensible scale: the middle swing meets the middle of the zone (clamped so he stays roughly 5-6 ft tall)
  function autoSize() {
    var sw = R.info.swings.swing_mid; if (!sw) return 1;
    var mid = (K.ZONE.zMin + K.ZONE.zMax) / 2;
    return clamp(mid / Math.max(0.5, sw.sweet.y), 0.92, 1.3);
  }
  function place(x, y, z, yaw, size) { if (!A) return; A.place(x, y, z, yaw, size); R.size = A.size; R.yaw = A.yaw; }
  function headPoint(out) { return A.headPoint(out); }
  function worldOf(name, out) { return A.point(name, out); }

  // ---- meeting the ball. The swing clips put bat_sweet on the plate's centre line at t = 0.25 s. Per swing we plan:
  //  - the height blend of swing_low/mid/high (from the contact point's height),
  //  - the clip time at which the barrel meets the ball: 0.25 s, or earlier in the arc when contact is late and the
  //    ball is already behind the plate (sweet-spot paths sampled at load),
  //  - a small reach toward the ball (in/out over the plate, a touch up/down): spine and bat move together, so the
  //    hands stay on the handle whatever the bat is parented to; the rest is absorbed along the bat (a cartoon can
  //    meet an inside pitch near the hands).
  function sweetBone() { return A.bones.bat_sweet || A.bones.bat_tip || A.bones.bat; }
  function samplePaths() {
    R.paths = {};
    ['swing_high', 'swing_mid', 'swing_low'].forEach(function (c) {
      if (!has(c)) return;
      var arr = [];
      for (var i = 0; i <= 60; i++) { A.evaluate([L(c, i * 0.005)]); A.model.updateMatrixWorld(true); arr.push(modelPoint(sweetBone(), new T.Vector3())); }
      R.paths[c] = arr;
    });
    var b = A.bones.bat, sp = A.bones.spine, under = false;
    for (var o = b && b.parent; o; o = o.parent) if (o === sp) under = true;
    R.batUnderSpine = under;
  }
  function pathAt(blend, t, out) { // blended model-space sweet-spot position at clip time t (0..0.3 s)
    out = out || new T.Vector3();
    out.set(0, 0, 0);
    var f = clamp(t / 0.005, 0, 59.999), i = Math.floor(f), u = f - i;
    blend.forEach(function (l) { var a = R.paths[l.c]; if (a) out.addScaledVector(V3.copy(a[i]).lerp(a[i + 1], u), l.w); });
    return out;
  }
  function plan(v, o, whiff) {
    var sw = v.swing, ci = o.ci, p = v.pitch;
    var lat = o.latency != null ? o.latency : K.INPUT_LATENCY;
    var tcs = ci ? Math.max(0.025, ci.cT - (v.pitchT - sw.t)) : Math.max(0.03, K.SWING_LAG - lat);
    var key = [p ? p.id + ':' + p.T : '', sw.t - v.pitchT, tcs, whiff ? 1 : 0, A.root.position.x, A.root.position.y, A.size, o.contactPt ? o.contactPt.x + ',' + o.contactPt.y + ',' + o.contactPt.z : ''].join('|');
    if (R.plan && R.plan.key === key) return R.plan;
    var P = { key: key, tcs: tcs, ctC: CONTACT_T, reach: null };
    if (whiff) P.blend = [L(first('whiff', 'swing_mid'), 0)];
    else {
      var z = o.contactPt ? o.contactPt.z : (p && p.plate ? p.plate.z : 2.5);
      P.blend = swingBlend(z);
      if (o.contactPt && R.paths) {
        A.root.updateMatrixWorld(true);
        var mt = A.model.worldToLocal(new T.Vector3(o.contactPt.x, o.contactPt.y, o.contactPt.z)), q = pathAt(P.blend, CONTACT_T, new T.Vector3());
        // late: the ball is behind the plate (toward his right, model -X); meet it earlier in the arc
        if (mt.x < q.x - 0.03) for (var t = CONTACT_T - 0.005; t >= 0.12; t -= 0.005) { pathAt(P.blend, t, q); P.ctC = t; if (q.x <= mt.x) break; }
        P.reach = new T.Vector3(0, clamp(mt.y - q.y, -0.25, 0.25), clamp(mt.z - q.z, -0.4, 0.4));
        P.miss = +Math.hypot(mt.x - q.x, mt.y - q.y - P.reach.y, mt.z - q.z - P.reach.z).toFixed(3);
      }
    }
    R.plan = P;
    return P;
  }
  // game swing time -> clip time: the clip up to its contact time squeezed into the real swing up to contact
  function warpP(st, P) { return AC.warp(st, P.tcs, P.ctC); }
  function reachK(ct, P) { return ct < P.ctC ? smooth((ct - 0.06) / Math.max(0.02, P.ctC - 0.06)) : 1 - smooth((ct - P.ctC) / 0.35); }
  var _m3 = new T.Matrix3(), _m4 = new T.Matrix4(), _m5 = new T.Matrix4();
  function applyReach(v, k) {
    if (!v || !(k > 0)) return;
    A.model.updateMatrixWorld(true);
    _m4.copy(A.model.matrixWorld).invert();
    ['spine', 'bat'].forEach(function (n) {
      var b = A.bones[n]; if (!b || (n === 'bat' && R.batUnderSpine)) return;
      // model-space offset -> the bone's parent space
      _m3.setFromMatrix4(_m5.multiplyMatrices(_m4, b.parent.matrixWorld)).invert();
      V.copy(v).multiplyScalar(k).applyMatrix3(_m3);
      b.position.add(V);
    });
  }

  // ------------------------------------------------------------------ the frame driver
  // the batter's bone edits on top of the clips: reach for the ball, cap turned backwards when On Fire
  function post(actor, spec) {
    if (spec.reach) applyReach(spec.reach, spec.reachK);
    if (spec.capBack && actor.bones.cap) actor.bones.cap.rotateY(PI);
  }
  function finish(spec, time) {
    spec.post = post;
    if (spec.hideBat) spec.hide = ['bat'];
    A.commit(spec, time);
    R.last = spec;
  }
  // once main stops advancing pitchT ('between' after a resolved pitch) keep the reaction playing on the clock
  var mem = { frozen: null };
  function frozenExtra(v, resolved) {
    var t = v.time || 0, f = mem.frozen, sig = (v.pitch ? v.pitch.id + ':' + v.pitch.T : '') + '|' + v.pitchT + '|' + (v.swing ? v.swing.t : '');
    if (!f || f.sig !== sig || !resolved || v.hitstop || t - f.last > 0.1 || t < f.last) { mem.frozen = { sig: sig, t0: t, last: t }; return 0; }
    f.last = t;
    return Math.min(4, t - f.t0);
  }

  // swing clip selection: blend high / mid / low so the barrel height follows the pitch height
  function swingBlend(z) {
    var S = R.info.swings, cand = [];
    ['swing_low', 'swing_mid', 'swing_high'].forEach(function (c) { if (S[c]) cand.push({ c: c, h: S[c].sweet.y * A.size }); });
    cand.sort(function (a, b) { return a.h - b.h; });
    if (cand.length === 1 || z <= cand[0].h) return [L(cand[0].c, 0, 1)];
    for (var i = 1; i < cand.length; i++) {
      if (z <= cand[i].h) { var k = (z - cand[i - 1].h) / Math.max(1e-3, cand[i].h - cand[i - 1].h); return [L(cand[i - 1].c, 0, 1 - k), L(cand[i].c, 0, k)]; }
    }
    return [L(cand[cand.length - 1].c, 0, 1)];
  }
  function atTime(layers, t) { return layers.map(function (l) { return { c: l.c, t: t, w: l.w }; }); }
  function stanceL(t) { return [L('stance', looped('stance', twos(t)))]; }
  // pre-pitch acting between pitches: o.pre = { kind: 'ritual' | 'glance', t: seconds since it began } (35-scene
  // decides when; see preActing there). Plays on twos and hands back to the stance before the pitch.
  function preLayers(o, t, base) {
    var pr = o.pre; if (!pr || !has(pr.kind)) return base;
    var d = dur(pr.kind), ct = onTwos(pr.t, t);
    if (ct >= d) return base;
    var w = smooth(ct / 0.12) * (1 - smooth((ct - (d - 0.18)) / 0.18));
    return mixL(base, [L(pr.kind, ct)], w);
  }

  // ---- bat scene. o = { ci: contact info from BB.Render, ball: world point for the gaze, contactPt: world point the
  // barrel should meet, pitcherHead: world point, latency, pre: pre-pitch acting, umpHead: where the ump stands }
  function poseBat(v, o) {
    o = o || {};
    var t = v.time || 0, p = v.pitch, sw = v.swing, ci = o.ci, load = v.loading != null ? v.loading : 0;
    var resolved = !!(p && v.pitchT != null && (v.pitchT > p.T + 0.12 || (ci && ci.hit)));
    var extra = frozenExtra(v, resolved && !(ci && ci.hit));
    var pt = (p && v.pitchT != null) ? v.pitchT + extra : null;
    var face = { blink: A.blinkAt(t, 1), smile: 0.4, brows_angry: 0.25 }, gz = o.pitcherHead || null, gk = 0.8;
    var spec = { key: 'idle', fade: 0.14, layers: null, face: face, capBack: !!v.onFire };
    // power load / coil (held tap)
    var base;
    if (load > 0) {
      var lt = load * 0.35;
      var coil = load >= 1 ? [L(first('coil_hold', 'power_load'), has('coil_hold') ? looped('coil_hold', t) : dur('power_load'))] : [L(first('power_load', 'stance'), lt * dur(first('power_load', 'stance')) / 0.35)];
      base = load >= 1 ? coil : mixL(preLayers(o, t, stanceL(t)), coil, smooth(lt / 0.08));
      face.brows_angry = 0.3 + 0.7 * smooth(load); face.squint = 0.55 * load; face.cheeks_puff = 0.55 * smooth((load - 0.3) / 0.7); face.smile = 0; face.blink = 0;
      spec.key = 'load';
    } else if (pt != null) {
      var s1 = first('stride', 'stance');
      base = mixL(stanceL(t), [L(s1, s1 === 'stride' ? Math.min(pt, dur('stride')) : looped('stance', twos(t)))], smooth(pt / 0.06));
      spec.key = 'pitch'; spec.fade = 0.06;
    } else {
      base = preLayers(o, t, stanceL(t));
      if (o.pre && has(o.pre.kind) && o.pre.t < dur(o.pre.kind)) {
        gk = 0.8 * (1 - smooth(o.pre.t / 0.2) * (1 - smooth((o.pre.t - dur(o.pre.kind) + 0.35) / 0.3)));   // the clip looks where it likes
        if (o.pre.kind === 'ritual') { face.smile = 0.7; face.brows_up = 0.25; face.brows_angry = 0; }
      }
    }
    if (p && pt != null && o.ball) { gz = o.ball; gk = 1; }
    if (!sw) {
      spec.layers = base;
      if (p && pt != null && pt > p.T + 0.02) {          // the pitch went by: take it (and argue a called strike three)
        var tk = onTwos(pt - p.T - 0.02, t), calledK = p.strike && v.stamp && v.stamp.kind === 'bad';
        var take = has('take') ? [L('take', Math.min(tk, dur('take')))] : stanceL(t);
        spec.layers = mixL(base, take, smooth(tk / 0.1));
        face.brows_up = 0.4 * smooth(tk / 0.2); face.smile = 0.2;
        gk = smooth(1 - (pt - p.T - 0.3) / 0.3) * 0.8;
        if (calledK) {
          var kt = onTwos(pt - p.T - 0.2, t);
          if (kt > 0) {
            var sr = has('strike_react') ? [L('strike_react', Math.min(kt, dur('strike_react')))] : take;
            spec.layers = mixL(spec.layers, sr, smooth(kt / 0.12));
            face.brows_up = 0; face.brows_angry = kt < 0.5 ? 1 : 1 - smooth((kt - 0.5) / 0.3); face.brows_sad = smooth((kt - 0.5) / 0.3) * 0.9; face.frown = smooth(kt / 0.2); face.smile = 0;
            // the glare: eyes on the umpire while the clip turns him round, then let the slump look down
            if (o.umpHead) { gz = o.umpHead; gk = 0.9 * smooth((kt - 0.15) / 0.2) * (1 - smooth((kt - 0.9) / 0.3)); }
          }
        }
      }
      spec.gaze = gz; spec.gazeK = gk;
      finish(spec, t);
      return spec;
    }
    // ---- swing
    var swt = sw.t + extra;
    var whiff = !!(sw.result && !sw.result.contact);
    var P = plan(v, o, whiff), ct = warpP(swt, P), blend = P.blend;
    var swingL;
    spec.key = 'swing'; spec.fade = 0.045;
    face.blink = 0; face.smile = 0; face.brows_angry = 0.85; face.squint = 0.35 * (1 - smooth((ct - 0.3) / 0.2)); face.mouth_open = 0.25;
    if (whiff) {
      var wc = first('whiff', 'swing_mid'), wd = dur(wc);
      var wt = ct < 0.5 ? ct : 0.5 + onTwos(ct - 0.5, t);
      swingL = [L(wc, Math.min(wt, wd))];
      if (wc === 'whiff' && wt > wd && has('dizzy')) swingL = mixL(swingL, [L('dizzy', looped('dizzy', wt - wd))], smooth((wt - wd) / 0.1));
      var u = clamp((ct - 0.3) / 0.6, 0, 1);
      face.mouth_open = 0.25 + 0.6 * Math.sin(u * PI); face.brows_angry = 0.85 * (1 - u); face.brows_sad = 0.6 * u; face.brows_up = 0.5 * u; face.squint = 0;
      if (wt > wd) { face.blink = 0.35 + 0.15 * Math.sin(t * 7); face.mouth_open = 0.35 + 0.2 * Math.sin(t * 5.3); face.frown = 0.4; }
      if (v.stamp && v.stamp.kind === 'bad' && /OUT|K|SIT|STRUCK|FANNED|WHIFF/.test(String(v.stamp.text || '').toUpperCase()) && wt > 0.8) face.brows_sad = 0.9;
      spec.gaze = o.ball; spec.gazeK = 0.6 * (1 - u);
    } else {
      swingL = atTime(blend, Math.min(ct, dur(blend[0].c)));
      if (ci && ci.hit) {
        var tc = Math.max(0, ci.tc + extra);
        face.grin = smooth(tc / 0.05) * (ci.sweet ? 1 : 0.75); face.brows_angry = 0.85 * (1 - smooth(tc / 0.15)); face.brows_up = smooth(tc / 0.2) * 0.8; face.squint = 0;
        face.mouth_open = o.hr ? smooth((tc - 0.06) / 0.1) * 0.9 : 0.15;
        var sd = dur(blend[0].c);
        if (o.hr && has('bat_flip') && tc > FLIP_AT) swingL = mixL(swingL, [L('bat_flip', Math.min(onTwos(tc - FLIP_AT, t), dur('bat_flip')))], smooth((tc - FLIP_AT) / 0.14));
        else if (ct > sd - 0.15 && has('watch')) swingL = mixL(swingL, [L('watch', looped('watch', onTwos(ct - sd + 0.15, t)))], smooth((ct - sd + 0.15) / 0.15));
        spec.gaze = o.ballAfter || o.ball; spec.gazeK = 1;
      } else spec.gaze = o.ball;
    }
    // swing off the base pose (stride / coil) in a frame or two
    spec.layers = mixL(base, swingL, smooth(swt / 0.02));
    // reach for the ball around the contact frame
    if (P.reach) { spec.reach = P.reach; spec.reachK = reachK(ct, P); }
    spec.plan = P;
    finish(spec, t);
    return spec;
  }

  // ---- field scene: the batter at home before he runs (swing follow-through, watch, bat flip on a homer)
  function poseHome(v, o) {
    var t = v.time || 0, tc = o.tc, hr = !!o.hr, plateZ = o.plateZ != null ? o.plateZ : 2.5;
    var blend = swingBlend(plateZ), ct = CONTACT_T + tc, sd = dur(blend[0].c);
    var layers = atTime(blend, Math.min(ct, sd));
    var face = { grin: 1, brows_up: 0.8, mouth_open: hr ? 0.8 : 0.2, blink: A.blinkAt(t, 1) * 0.6 };
    if (hr && has('bat_flip')) {
      var ft = onTwos(tc - FLIP_AT, t);
      layers = mixL(layers, [L('bat_flip', Math.min(ft, dur('bat_flip')))], smooth(ft / 0.14));
    } else if (has('watch') && ct > sd - 0.15) layers = mixL(layers, [L('watch', looped('watch', onTwos(ct - sd + 0.15, t)))], smooth((ct - sd + 0.15) / 0.15));
    var spec = { key: 'home', fade: 0.05, layers: layers, face: face, capBack: !!v.onFire, gaze: o.ball, gazeK: 0.7 };
    finish(spec, t);
    return spec;
  }
  // ---- field scene: running the bases. o = { dist: ft along the path, runT, speed, hr, arrived, arriveT, out, outT,
  // legs: { walk, walkCycles, runCycles, runW } from BB.Render's paced run }. The legs cover the ground they move
  // over: the clip's own stride (measured at load) times the cycles BB.Render integrated from the ground speed, each
  // gait capped at a playback speed past which it would read as a blur (the sprint) or rush the acting (the strut).
  var CAP = { run: 3.5, trot: 1.6 };
  function strideOf(gait) { var g = R.gaits && R.gaits[gait]; return g && g.stride > 0.5 ? g.stride : (gait === 'trot' ? 2.3 : 3.6); }
  function cadenceCap(gait) { return (CAP[gait] || 2) / Math.max(0.1, dur(gait)); }        // leg cycles per second
  function poseRun(v, o) {
    var t = v.time || 0, layers, face = { brows_angry: 0.5, mouth_open: 0.35, blink: A.blinkAt(t, 1) * 0.5 };
    if (o.legs && has(o.legs.walk)) {
      var lg = o.legs, wl = [L(lg.walk, looped(lg.walk, lg.walkCycles * dur(lg.walk)))];
      layers = lg.walk !== 'run' && has('run') && lg.runW > 0.01 ? mixL(wl, [L('run', looped('run', lg.runCycles * dur('run')))], lg.runW) : wl;
    } else {
      var gait = o.hr ? first('trot', 'run') : first('run', 'trot');
      var stride = strideOf(gait), cap = cadenceCap(gait);
      var rt = o.runT != null && gait === 'trot' ? onTwos(o.runT, t) : o.runT;     // the strut is acting: held on twos
      var cyc = rt != null && o.speed != null ? rt * Math.min(o.speed / stride, cap) : o.dist / stride;
      layers = [L(gait, looped(gait, cyc * dur(gait)))];
    }
    if (o.hr) { face = { grin: 0.9, smile: 1, brows_up: 0.6, blink: A.blinkAt(t, 1) }; }
    var key = 'run';
    if (o.arrived && o.arriveT != null) {
      var at = onTwos(o.arriveT, t);
      var end = has('cheer') ? [L('cheer', Math.min(at, dur('cheer')))] : stanceL(t);
      layers = mixL(layers, end, smooth(at / 0.12));
      face = { grin: 1, mouth_open: 0.7 * (1 - smooth((at - 0.9) / 0.3)), brows_up: 1, blink: at > 1 ? A.blinkAt(t, 1) : 0 };
    }
    if (o.out && o.outT != null && o.outT > 0) {
      var ot = onTwos(o.outT, t);
      var slump = has('strike_react') ? [L('strike_react', Math.min(ot, dur('strike_react')))] : stanceL(t);
      layers = mixL(layers, slump, smooth(ot / 0.15));
      face = { brows_angry: ot < 0.5 ? 1 : 0.2, brows_sad: smooth((ot - 0.5) / 0.3), frown: 1, blink: A.blinkAt(t, 1) };
    }
    var spec = { key: key, fade: 0.1, layers: layers, face: face, hideBat: true, capBack: !!v.onFire };
    finish(spec, t);
    return spec;
  }
  // ---- title: idle in the stance, a practice swing every few seconds, now and then the plate-tap ritual
  function poseTitle(t) {
    var cyc = t % 13, layers = stanceL(t), face = { smile: 0.6, brows_up: 0.15, blink: A.blinkAt(t, 1) };
    var sw = cyc > 4.5 && cyc < 6.5 ? cyc - 4.5 : cyc > 11 ? cyc - 11 : -1;
    if (sw >= 0) {
      var c = first('swing_mid', 'swing_high', 'swing_low');
      var w = smooth(sw / 0.12) * (1 - smooth((sw - 1.35) / 0.4));
      layers = mixL(layers, [L(c, Math.min(sw, dur(c)))], w);
      face = { brows_angry: 0.8 * w, squint: 0.3 * w, smile: 0.6 * (1 - w), mouth_open: 0.2 * w, blink: 0 };
    } else if (cyc > 7.6 && has('ritual')) {
      layers = preLayers({ pre: { kind: 'ritual', t: cyc - 7.6 } }, t, layers);
      face.smile = 0.75; face.brows_up = 0.3;
    }
    var spec = { key: 'title', fade: 0.15, layers: layers, face: face };
    finish(spec, t);
    return spec;
  }

  // bat positions at other swing times (for the smear): evaluates the pose without touching the frame memory.
  // Returns tips / mids (world points) and the bat bone's world matrices (for ghost bats).
  function batTrail(v, o, times) {
    var tips = [], mids = [], grips = [], mats = [], keep = R.last;
    var sw = v.swing; if (!sw || !keep) return null;
    var whiff = !!(sw.result && !sw.result.contact), P = plan(v, o, whiff), blend = P.blend;
    var tipB = A.bones.bat_tip || A.bones.bat_sweet, midB = A.bones.bat_sweet || A.bones.bat, grip = A.bones.bat;
    times.forEach(function (st) {
      var ct = warpP(Math.max(0, st), P);
      A.evaluate(atTime(blend, ct));
      A.root.updateMatrixWorld(true);
      if (P.reach) applyReach(P.reach, reachK(ct, P));
      A.root.updateMatrixWorld(true);
      tips.push(new T.Vector3().setFromMatrixPosition(tipB.matrixWorld));
      var a = new T.Vector3().setFromMatrixPosition(grip.matrixWorld), b = new T.Vector3().setFromMatrixPosition(midB.matrixWorld);
      grips.push(a.clone()); mids.push(a.lerp(b, 0.6));
      mats.push(grip.matrixWorld.clone());
    });
    A.restoreFinal();                       // put the frame's pose back
    return { tips: tips, mids: mids, grips: grips, mats: mats };
  }
  // where the flipped bat comes to rest (world, Z-up), for the prop lying in the dirt
  function batRest() {
    if (!has('bat_flip')) return null;
    if (!R.batRestCache || R.batRestCache.key !== A.root.matrixWorld.elements.join()) {
      A.evaluate([L('bat_flip', dur('bat_flip'))]);
      A.root.updateMatrixWorld(true);
      var p = worldOf('bat', new T.Vector3()), tip = A.bones.bat_tip ? worldOf('bat_tip', new T.Vector3()) : p.clone().add(new T.Vector3(1, 0, 0));
      R.batRestCache = { key: A.root.matrixWorld.elements.join(), p: p, dir: tip.sub(p).setZ(0).normalize() };
      A.restoreFinal();
    }
    return R.batRestCache;
  }
  // lay the bat prop on the ground at (x, y) pointing along (dx, dy)
  var _bq = new T.Quaternion(), _by = new T.Vector3();
  function dropBat(x, y, dx, dy) {
    var m = R.batProp; if (!m) return null;
    var ax = m.userData.axis;
    _by.set(dx, dy, 0.06).normalize();                       // world direction of the bat axis (handle -> tip)
    _bq.setFromUnitVectors(ax, _by);                          // the barrel's roll is arbitrary
    m.quaternion.copy(_bq);
    m.position.set(x, y, 0.17);
    m.scale.setScalar(A.size);
    m.visible = true;
    return m;
  }
  // the flipped bat as a prop: follows bat_flip's flight from where Rocco stood (rootWorld = his root's world matrix
  // at home), then falls into the dirt and lies there
  var _fm = new T.Matrix4(), _fp = new T.Vector3(), _fq = new T.Quaternion(), _fs = new T.Vector3(), _rq = new T.Quaternion();
  function flipBat(tf, rootWorld) {
    var m = R.batProp; if (!m || !R.flipPath) return null;
    var n = R.flipPath.length - 1, d = dur('bat_flip'), f = clamp(tf / 0.025, 0, n), i = Math.min(n - 1, Math.floor(f)), u = f - i;
    _fm.copy(rootWorld).multiply(A.up.matrix).multiply(A.model.matrix);   // model -> world for that placement
    var a = R.flipPath[i], b = R.flipPath[i + 1];
    var pa = new T.Vector3(), qa = new T.Quaternion(), sa = new T.Vector3(), pb = new T.Vector3(), qb = new T.Quaternion(), sb = new T.Vector3();
    a.decompose(pa, qa, sa); b.decompose(pb, qb, sb);
    pa.lerp(pb, u); qa.slerp(qb, u);
    var local = new T.Matrix4().compose(pa, qa, sa.set(1, 1, 1));
    var world = new T.Matrix4().multiplyMatrices(_fm, local);
    world.decompose(_fp, _fq, _fs);
    if (tf > d) { // after the clip: fall, spinning down flat
      var ft = tf - d, z0 = _fp.z, rest = 0.17;
      var fall = Math.min(1, ft / Math.max(0.05, Math.sqrt(Math.max(0, z0 - rest) / 16)));
      _fp.z = Math.max(rest, z0 - 16 * ft * ft);
      var ax = m.userData.axis, dir = V.copy(ax).applyQuaternion(_fq); dir.z = 0; if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0); dir.normalize();
      _rq.setFromUnitVectors(ax, dir);
      _fq.slerp(_rq, smooth(fall));
    }
    m.position.copy(_fp); m.quaternion.copy(_fq); m.scale.setScalar(A.size);
    m.visible = true;
    return m;
  }
  function info() {
    var o = { status: R.status, error: R.error, warnings: R.warnings.slice(), clips: [] };
    if (A) {
      var ai = A.info();
      o.clips = ai.clips;
      o.contact = {}; for (var c in R.info.swings) { var s = R.info.swings[c].sweet; o.contact[c] = [s.x, s.y, s.z].map(function (x) { return +x.toFixed(3); }); }
      var b = R.info.restBox; o.restHeight = +(b.max.y - b.min.y).toFixed(3); o.restMinY = +b.min.y.toFixed(3);
      var sb = R.info.stanceBox; o.stanceBox = { min: sb.min.toArray().map(function (x) { return +x.toFixed(2); }), max: sb.max.toArray().map(function (x) { return +x.toFixed(2); }) };
      o.triangles = ai.triangles; o.lod1Triangles = ai.lod1Triangles; o.materials = ai.materials; o.droppedTracks = ai.droppedTracks; o.drawCalls = ai.drawCalls; o.bones = ai.bones;
      o.gaits = {}; for (var g in R.gaits) o.gaits[g] = { stride: +R.gaits[g].stride.toFixed(2), treadmill: +(R.gaits[g].treadmill || 0).toFixed(2), measured: +(R.gaits[g].measured || 0).toFixed(2) };
      o.asset = BB.Assets.where('rocco');
    }
    o.loadMs = R.loadMs;
    return o;
  }

  API.ready = function () { return R.status === 'ready'; };
  API.whenReady = whenReady; API.boot = boot; API.loadBuffer = loadBuffer; API.R = R; API.prepareLod = prepareLod; API.releaseLod = releaseLod;
  API.setColors = setColors; API.setHot = setHot; API.place = place; API.point = function (n, out) { return worldOf(n, out); };
  API.poseBat = poseBat; API.poseHome = poseHome; API.poseRun = poseRun; API.poseTitle = poseTitle; API.batTrail = batTrail;
  API.solvePlacement = solvePlacement; API.autoSize = autoSize; API.batRest = batRest; API.dropBat = dropBat; API.info = info;
  API.root = function () { return A && A.root; }; API.prop = function () { return R.batProp; }; API.actor = function () { return A; };
  API.headPoint = headPoint; API.flipBat = flipBat; API.has = has; API.dur = dur; API.posedBox = function (step) { return A.posedBox(step); };
  API.strideOf = strideOf; API.cadenceCap = cadenceCap; API.CONTACT_T = CONTACT_T; API.RITUAL_EVERY = RITUAL_EVERY;
  return API;
})();
