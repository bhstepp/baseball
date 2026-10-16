// 35-scene.js — BB.Render: the 3D theatrical-cartoon renderer (three.js r149). Owned by the render agent.
// Bat scene (behind the catcher), field scene (a camera that chases the ball), title backdrop, plus a 2D overlay
// canvas for comic FX, the cartoon scoreboard HUD, stamps and the iris wipe. Uses BB.Toon / BB.Cast / BB.Park /
// BB.Anim. API per docs/CONTRACT.md: init, resize, setInks, prepare, frame, title, screenToPlate, plateToScreen.
(function () {
  var T = (typeof THREE !== 'undefined') ? THREE : null;
  var NOOP = function () {};
  if (!T || !BB.Toon || !BB.Cast || !BB.Park || !BB.Anim) {
    BB.Render = { init: NOOP, resize: NOOP, setInks: NOOP, prepare: NOOP, frame: NOOP, title: NOOP, stats: function () { return {}; },
      screenToPlate: function () { return { x: 0, z: 2.5 }; }, plateToScreen: function () { return { x: 0, y: 0 }; }, _S: {} };
    return;
  }
  var TN = BB.Toon, C = BB.Cast, A = BB.Anim, PK = BB.Park, K = BB.K, U = BB.U;
  var PI = Math.PI, clamp = U.clamp, lerp = U.lerp, smooth = U.smooth;
  var INK = '#1B1420', CREAM = '#FFF4DC', MUSTARD = '#F2B632', BRICK = '#D9483B', TEAL = '#7FD1D9';

  // ------------------------------------------------------------------ tunables
  // ?rocco=old shows the game as it was before the Rocco pilot: the procedural Rocco and the old bat-scene staging
  // (add &stage=new to see the procedural Rocco on the new staging, which is what players get if the model fails).
  function flag(re) { try { return re.test(location.search); } catch (e) { return false; } }
  var OLD = flag(/[?&]rocco=(old|0|off|proc)(&|$)/) && !flag(/[?&]stage=new(&|$)/);
  var ROCCO = { x: -2.35, y: 0.9, size: 1.12 };             // render spot of the right-handed hero (physics uses K.BATTER_X)
  var CATCHER = OLD ? { x: 0.4, y: -5.4, size: 0.9 } : { x: 0.75, y: -4.75, size: 0.76, shift: 0.55, mitt: { x: 0.2, y: -3.2, z: 2.1 } };
  var UMP = OLD ? { x: 1.75, y: -3.2, size: 1.08, off: 4.6 } : { x: 2.25, y: -4.5, size: 0.92, off: 5.6 };
  // bat camera. Old: fixed pose and fov. New: further back on a longer lens (bigger pitcher, smaller catcher), centred
  // on the zone (aim), sized so the zone gets ppf px per ft (min of ppfW * width, ppfH * height) and shifted (lens
  // shift, so verticals stay put) to put the aim point at screen fraction `at`. Solved per screen size in layoutBat.
  var BATCAM = OLD ? { pos: [-0.9, -18, 8.0], look: [0.2, 30, -1.6], fov: 38 } : {
    aim: [0, 0, 2.5],
    tall: { a: 0.462, pos: [-0.6, -28, 9.6], ppfW: 0.140, ppfH: 0.072, at: [0.63, 0.655] },     // 390x844, 430x932
    wide: { a: 0.563, pos: [-1.6, -23, 7.3], ppfW: 0.156, ppfH: 0.078, at: [0.62, 0.675] },     // 320x568 (16:9) and wider
  };
  var PITCHER_K = OLD ? 1 : 1.08;                               // pitcher size multiplier
  // the modelled Rocco (BB.Rocco, 36-rocco.js): where his contact frame meets a middle-middle pitch
  var HERO_AIM = { x: 0, y: 0, z: 2.5 };
  var HR_HOLD = { pos: [-7, -34, 12], look: [0, 16, 4.5] };   // field camera while the model Rocco flips his bat on a homer

  var S = {
    canvas: null, renderer: null, scene: null, W: 390, H: 844, dpr: 1, pr: 1, prCap: 2, failed: false,
    ov: null, octx: null, ovScale: 1,
    camBat: null, camBase: null, camField: null, camTitle: null, cam: null,
    parks: {}, set: null, ink: null, inkPick: 'classic', inkKey: '',
    rocco: null, bat: null, batFrame: null, mates: [], pitcher: null, pitcherId: '', catcher: null, ump: null, fielders: [], species: '',
    ball: null, ballG: null, ballShadow: null,
    lastScene: '', sceneT0: 0, prevScene: '', lastTime: 0,
    perf: [], lastNow: 0, warm: 0, noAdapt: false, lastBuildMs: 0, frameMs: 0,
    hud: { key: '', canvas: null }, fontsOk: false, fontCheck: 0,
  };
  var V = new T.Vector3(), V2 = new T.Vector3(), V3 = new T.Vector3();

  // ------------------------------------------------------------------ colour helpers
  function tame(hex) { // riso inks -> warm cartoon paint (never neon)
    var c = new T.Color(hex), h = {}; c.getHSL(h);
    h.s = Math.min(h.s, 0.74); h.l = clamp(h.l, 0.26, 0.6);
    return '#' + new T.Color().setHSL(h.h, h.s, h.l).getHexString();
  }
  function resolveInk(ink) {
    if (!ink) return BB.INKSETS[0];
    if (typeof ink === 'string') { for (var i = 0; i < BB.INKSETS.length; i++) if (BB.INKSETS[i].id === ink) return BB.INKSETS[i]; return BB.INKSETS[0]; }
    return ink;
  }

  // ------------------------------------------------------------------ init / resize
  function init(canvas) {
    S.canvas = canvas;
    S.soft = !window.BB_RENDER_HQ && softwareGL();   // harnesses set BB_RENDER_HQ to keep full quality for screenshots
    if (S.soft) S.prCap = 0.6; // a CPU rasteriser (no GPU): lowest quality so the game stays playable
    try {
      S.renderer = new T.WebGLRenderer({ canvas: canvas, antialias: !S.soft, alpha: false, powerPreference: 'high-performance', stencil: false });
    } catch (e) { console.warn('BB.Render: WebGL unavailable', e); S.failed = true; return; }
    S.renderer.setClearColor(new T.Color(CREAM), 1);
    S.scene = new T.Scene();
    S.amb = new T.AmbientLight(0xffffff, 0.52); S.scene.add(S.amb);
    S.key = new T.DirectionalLight(0xfff0d8, 0.62); S.scene.add(S.key); S.scene.add(S.key.target);
    function cam(fov) { var c = new T.PerspectiveCamera(fov, 1, 1.0, 12000); c.up.set(0, 0, 1); return c; }
    S.camBat = cam(BATCAM.fov); S.camBase = cam(BATCAM.fov); S.camField = cam(46); S.camTitle = cam(38);
    S.cam = S.camTitle;
    // overlay for HUD / stamps / comic FX
    var ov = document.createElement('canvas');
    ov.id = 'bb-overlay';
    ov.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:1;display:block;';
    if (canvas.parentNode) canvas.parentNode.insertBefore(ov, canvas.nextSibling); else document.body.appendChild(ov);
    S.ov = ov; S.octx = ov.getContext('2d');
    buildBall();
    S.batFrame = new T.Group(); S.scene.add(S.batFrame);
    setInks(S.ink || BB.INKSETS[0]);
    resize(window.innerWidth || 390, window.innerHeight || 844, Math.min(window.devicePixelRatio || 1, 2));
    if (BB.Rocco && BB.Rocco.boot) BB.Rocco.boot();   // async: the procedural Rocco stands in until the model is ready
  }
  // the modelled hero is used once BB.Rocco has parsed rocco.glb (never with ?rocco=old)
  function glb() {
    if (S.glbFailed || !BB.Rocco || !BB.Rocco.ready || !BB.Rocco.ready()) return false;
    if (!S.hero) {
      try {
        var root = BB.Rocco.root(), prop = BB.Rocco.prop();
        S.scene.add(root); if (prop) S.scene.add(prop);
        BB.Rocco.setColors(S.col);
        var size = BB.Rocco.autoSize(), pl = BB.Rocco.solvePlacement(HERO_AIM, size);
        S.hero = { x: pl.x, y: pl.y, size: size, homeMatrix: new T.Matrix4().compose(new T.Vector3(pl.x, pl.y, 0), new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), PI / 2), new T.Vector3(1, 1, 1)) };
        BB.Rocco.place(S.hero.x, S.hero.y, 0, PI / 2, size);
        var br = BB.Rocco.batRest();
        if (br) S.hero.batRest = { x: br.p.x, y: br.p.y, dx: br.dir.x, dy: br.dir.y };
        BB.Rocco.poseTitle(0);
        try { S.renderer.compile(S.scene, S.cam); } catch (e) {}
      } catch (e) { console.warn('BB.Render: model Rocco disabled', e); S.glbFailed = true; return false; }
    }
    return true;
  }

  function softwareGL() {
    try {
      var c = document.createElement('canvas'), g = c.getContext('webgl');
      if (!g) return false;
      var ext = g.getExtension('WEBGL_debug_renderer_info'), name = ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER);
      var lose = g.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
      return /swiftshader|llvmpipe|software/i.test(String(name));
    } catch (e) { return false; }
  }
  function resize(w, h, dpr) {
    if (!S.renderer) return;
    S.W = w; S.H = h; S.dpr = dpr || 1;
    S.pr = Math.min(S.soft ? 1 : S.dpr, S.prCap, 2);
    S.renderer.setPixelRatio(S.pr);
    S.renderer.setSize(w, h, false);
    if (BB.Ink && BB.Ink.resize) BB.Ink.resize(S.renderer, w, h, S.pr);
    var od = S.soft ? 1 : Math.min(S.dpr, 2);
    S.ov.width = Math.round(w * od); S.ov.height = Math.round(h * od);
    S.ov.style.width = w + 'px'; S.ov.style.height = h + 'px';
    S.ovScale = od;
    [S.camBat, S.camBase, S.camField, S.camTitle].forEach(function (c) { c.aspect = w / h; c.updateProjectionMatrix(); });
    TN.OU.uRes.value.set(w, h);
    layoutBat();
    S.hud.key = '';
  }
  // the bat camera: fixed per screen size; camBase is never shaken so screenToPlate/plateToScreen stay exact
  function layoutBat() {
    var B = BATCAM, W = S.W, H = S.H, fov, look = batLook();
    if (B.look) { fov = B.fov * (W / H > 0.62 ? 0.9 : 1); S.batPos = B.pos; S.batAt = null; }
    else {
      // tall phones and 16:9 screens get their own framing; anything between is interpolated, wider screens use 'wide'
      var k = clamp((W / H - B.tall.a) / (B.wide.a - B.tall.a), 0, 1), L = function (f) { return lerp(B.tall[f], B.wide[f], k); };
      var pos = [0, 1, 2].map(function (i) { return lerp(B.tall.pos[i], B.wide.pos[i], k); }), at = [L2(B.tall.at[0], B.wide.at[0], k), L2(B.tall.at[1], B.wide.at[1], k)];
      var ppf = Math.min(L('ppfW') * W, L('ppfH') * H), d = Math.hypot(pos[0] - B.aim[0], pos[1] - B.aim[1], pos[2] - B.aim[2]);
      fov = 2 * Math.atan(H / 2 / (ppf * d)) * 180 / PI;
      S.batPos = pos; S.batAt = at;
    }
    [S.camBat, S.camBase].forEach(function (c) {
      c.fov = fov; c.position.set(S.batPos[0], S.batPos[1], S.batPos[2]);
      c.lookAt(look[0], look[1], look[2]);
      if (S.batAt) c.setViewOffset(W, H, (0.5 - S.batAt[0]) * W, (0.5 - S.batAt[1]) * H, W, H); else if (c.view) c.clearViewOffset();
      c.updateProjectionMatrix(); c.updateMatrixWorld(true);
    });
  }
  function L2(a, b, k) { return a + (b - a) * k; }
  function batLook() { return BATCAM.look || BATCAM.aim; }
  function plateToScreen(x, z) {
    V.set(x, 0, z).project(S.camBase || new T.PerspectiveCamera());
    return { x: (V.x + 1) / 2 * S.W, y: (1 - V.y) / 2 * S.H };
  }
  function screenToPlate(sx, sy) {
    var c = S.camBase; if (!c) return { x: 0, z: 2.5 };
    V.set(sx / S.W * 2 - 1, -(sy / S.H * 2 - 1), 0.5).unproject(c);
    V.sub(c.position);
    var t = (0 - c.position.y) / (V.y || 1e-6);
    return { x: c.position.x + V.x * t, z: c.position.z + V.z * t };
  }
  function proj(x, y, z, cam) {
    V.set(x, y, z).project(cam || S.cam);
    return { x: (V.x + 1) / 2 * S.W, y: (1 - V.y) / 2 * S.H, behind: V.z > 1 };
  }
  function pxPerFt(dist, cam) { cam = cam || S.cam; return S.H / 2 / Math.tan(cam.fov * PI / 360) / Math.max(0.1, dist); }

  // ------------------------------------------------------------------ inks / cast
  function setInks(ink) {
    ink = resolveInk(ink);
    S.ink = ink; S.inkPick = ink.id || 'classic';
    if (!S.scene) return;
    var key = [ink.a, ink.b, ink.c].join();
    if (key === S.inkKey) return;
    S.inkKey = key;
    S.col = { a: tame(ink.a), b: tame(ink.b), c: tame(ink.c) };
    buildHero();
    if (BB.Rocco && BB.Rocco.setColors) BB.Rocco.setColors(S.col);
    S.hud.key = '';
  }
  function heroOpts(species, simple) {
    var c = S.col;
    return { species: species, simple: simple, size: ROCCO.size, shirt: '#FFF9EE', pants: '#FFF9EE', trim: c.a, cap: c.a, brim: TN.shade(c.a, 0.8), socks: c.a, shoes: INK, shoeTip: c.b,
      number: simple ? null : 7, letter: simple ? null : 'R', numColor: c.a, numEdge: INK, belt: INK, capPatch: '#FFF9EE' };
  }
  // layer 1 = inked (docs/PILOT-ROCCO.md): characters, their gear, the bat and the ball get BB.Ink's lines
  function inkMark(o, opts) { if (o && BB.Ink && BB.Ink.mark) BB.Ink.mark(o, opts); return o; }
  function buildHero() {
    if (S.rocco) dispose(S.rocco);
    S.rocco = C.make(heroOpts('raccoon', false));
    S.scene.add(S.rocco.root);
    if (S.bat) { S.bat.parent && S.bat.parent.remove(S.bat); disposeObj(S.bat); }
    S.bat = C.makeBat({ wood: '#D9A066', tape: S.col.b, stripe: INK });
    S.rocco.up.add(S.bat);
    inkMark(S.rocco.root); inkMark(S.bat);
    S.mates.forEach(dispose);
    S.mates = ['otter', 'fox', 'beaver'].map(function (sp) { var m = C.make(Object.assign(heroOpts(sp, true), { size: 1.05 })); S.scene.add(m.root); inkMark(m.root); return m; });
  }
  function ensureOpponents(pitcher) {
    var id = (pitcher && pitcher.id) || 'none';
    if (id === S.pitcherId && S.pitcher) return;
    S.pitcherId = id;
    var sp = C.speciesFor(pitcher), team = C.teamColor(pitcher && pitcher.team), look = (pitcher && pitcher.look) || {};
    var road = '#D3CFC6', boss = !!(pitcher && pitcher.boss);
    if (S.pitcher) dispose(S.pitcher);
    if (S.catcher) dispose(S.catcher);
    S.fielders.forEach(dispose);
    var size = (boss ? 2.0 : 1.72) * (look.build === 'tall' ? 1.06 : look.build === 'lanky' ? 1.04 : look.build === 'stout' ? 0.97 : 1);
    S.pitcher = C.make({ species: sp, size: size, build: look.build, shirt: road, pants: road, trim: team, cap: team, brim: TN.shade(team, 0.75), socks: team, shoes: INK,
      number: look.number != null ? look.number : 1, numColor: team, numEdge: INK, glove: 'L', mirror: pitcher && pitcher.hand === 'L', headScale: boss ? 1.08 : 1 });
    S.pitcher.boss = boss; S.pitcher.style = look.windup || 'classic';
    S.scene.add(S.pitcher.root); inkMark(S.pitcher.root);
    S.catcher = C.make({ species: sp, size: CATCHER.size, build: 'stout', shirt: road, pants: road, trim: team, cap: TN.shade(team, 0.8), socks: team, shoes: INK, glove: 'C', mask: true,
      chestPad: TN.shade(team, 0.7), shinPads: TN.shade(team, 0.7), number: 2, numColor: team, numEdge: INK });
    S.catcher.cap && (S.catcher.cap.rotation.y = PI);
    S.scene.add(S.catcher.root); inkMark(S.catcher.root);
    S.fielders = BB.Bat && BB.Bat.ORDER ? BB.Bat.ORDER.map(function (pos, i) {
      var f = C.make({ species: sp, simple: true, size: 1.25, shirt: road, pants: road, trim: team, cap: team, socks: team, shoes: INK, glove: i === 1 ? 'C' : 'L' });
      S.scene.add(f.root); inkMark(f.root); return f;
    }) : [];
    S.species = sp;
    if (!S.ump) { S.ump = C.make({ species: 'mole', size: UMP.size, build: 'stout', shirt: '#2B2F5E', pants: '#7A7684', trim: '#1B1420', cap: '#1B1420', socks: '#1B1420', shoes: INK, mask: true, belt: '#1B1420' }); S.scene.add(S.ump.root); inkMark(S.ump.root); }
  }
  function disposeObj(o) {
    o.traverse(function (n) {
      if (n.geometry && n.geometry !== C.SHADOW_G) n.geometry.dispose();
      if (n.material && n.material.userData && n.material.userData.own) n.material.dispose();
    });
  }
  function dispose(ch) { if (!ch) return; ch.root.parent && ch.root.parent.remove(ch.root); disposeObj(ch.root); }
  function place(ch, x, y, z, yaw) { ch.root.position.set(x, y, z || 0); ch.root.rotation.z = yaw || 0; ch.root.visible = true; }
  function yawToward(fx, fy) { return Math.atan2(fx, -fy); }   // character forward (0,-1) rotated to (fx, fy)

  // ------------------------------------------------------------------ ball
  function buildBall() {
    S.ballG = new T.Group();
    S.ball = C.makeBall();
    S.ballG.add(S.ball);
    S.scene.add(S.ballG); inkMark(S.ballG, { weight: 0.9 });
    S.ballShadow = new T.Mesh(new T.CircleGeometry(1, 16), new T.MeshBasicMaterial({ color: 0x1B1420, transparent: true, opacity: 0.25, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -14, polygonOffsetUnits: -44 }));
    S.scene.add(S.ballShadow);
  }
  var _q = new T.Quaternion(), _up = new T.Vector3(0, 1, 0);
  // place the ball: world pos, velocity (for stretch), spin angle, extra squash
  function setBall(p, vel, spin, squash, cam) {
    S.ballG.visible = true;
    S.ballG.position.set(p.x, p.y, p.z);
    var d = S.ballG.position.distanceTo((cam || S.cam).position);
    var r = Math.max(K.BALL_R * 1.25, d * (cam === S.camField ? 5.5 : 4.2) / pxPerFt(1, cam));
    var sp = vel ? Math.hypot(vel.x, vel.y, vel.z) : 0, st = clamp(sp / 140, 0, 0.7);
    if (sp > 1) { V2.set(vel.x / sp, vel.y / sp, vel.z / sp); _q.setFromUnitVectors(_up, V2); S.ballG.quaternion.copy(_q); } else S.ballG.quaternion.identity();
    var sq = squash || 0;
    S.ballG.scale.set(r * (1 - st * 0.25 + sq * 0.45), r * (1 + st - sq * 0.5), r * (1 - st * 0.25 + sq * 0.45));
    S.ball.rotation.set(spin || 0, (spin || 0) * 0.3, 0);
    S.ballShadow.visible = true;
    S.ballShadow.position.set(p.x, p.y, groundZ(p.x, p.y) + 0.03);
    var ss = r * (1.1 + Math.min(1.5, p.z / 40)) / Math.max(1, 1 + p.z / 60);
    S.ballShadow.scale.set(ss, ss, 1);
    S.ballShadow.material.opacity = clamp(0.32 - p.z / 400, 0.08, 0.32);
    return r;
  }
  function groundZ(x, y) { return PK.mound(x, y); }

  // ------------------------------------------------------------------ parks
  function parkOf(v) { return (v && v.park && v.park.fence) ? v.park : (BB.Content && BB.Content.PARKS && BB.Content.PARKS[0]) || DEFAULT_PARK; }
  var DEFAULT_PARK = { id: 'p_default', name: 'Screwball Field', town: 'Screwball', fence: [[-45, 330, 10], [-22, 372, 10], [0, 404, 10], [22, 372, 10], [45, 330, 10]],
    features: { scoreboard: true, lights: false, billboard: 'PLAY BALL', water: 'none', hill: false, skyline: 'barns' } };
  function ensurePark(park) {
    var id = park.id || 'p_default';
    if (S.set && S.set.id === id) return S.set;
    var set = S.parks[id];
    if (!set) {
      var t0 = performance.now();
      set = PK.build(park);
      S.lastBuildMs = performance.now() - t0;
      S.parks[id] = set;
    }
    if (S.set) S.scene.remove(S.set.group);
    S.set = set; S.scene.add(set.group);
    var L = set.lights;
    S.key.color.set(L.key); S.key.intensity = L.keyI; S.amb.color.set(L.amb); S.amb.intensity = L.ambI;
    S.key.position.set(L.sun[0] * 100, L.sun[1] * 100, L.sun[2] * 100); S.key.target.position.set(0, 0, 0);
    S.renderer.setClearColor(new T.Color(set.pal.skyLow), 1);
    return set;
  }
  function prepare(park, inkset) {
    if (!S.renderer) return;
    if (inkset) setInks(inkset);
    if (park) ensurePark(park);
  }

  // ------------------------------------------------------------------ helpers for poses in world space
  function toUp(ch, x, y, z) { ch.root.updateMatrixWorld(true); V.set(x, y, z); ch.up.worldToLocal(V); return [V.x, V.y, V.z]; }
  function fromUp(ch, p, out) { (out || V).set(p[0], p[1], p[2]); ch.up.localToWorld(out || V); return out || V; }
  function poseBat(ch, bat, info) {
    if (info.free) {
      if (bat.parent !== S.batFrame) S.batFrame.add(bat);
    } else if (bat.parent !== ch.up) ch.up.add(bat);
    bat.position.set(info.pos[0], info.pos[1], info.pos[2]);
    V2.set(info.dir[0], info.dir[1], info.dir[2]).normalize();
    _q.setFromUnitVectors(_up, V2); bat.quaternion.copy(_q);
    if (info.ground && info.pos[1] < 0.15) { bat.position.y = 0.15; }
  }
  function hideAll() {
    if (S.hero) { BB.Rocco.root().visible = false; var pr = BB.Rocco.prop(); if (pr) pr.visible = false; }
    [S.rocco, S.pitcher, S.catcher, S.ump].forEach(function (c) { if (c) c.root.visible = false; });
    S.fielders.forEach(function (f) { f.root.visible = false; });
    S.mates.forEach(function (f) { f.root.visible = false; });
    S.ballG.visible = false; S.ballShadow.visible = false;
  }

  // ------------------------------------------------------------------ BAT SCENE
  function contactInfo(v) {
    var sw = v.swing, p = v.pitch;
    if (!sw || !sw.result || !sw.result.contact || !p || v.pitchT == null) return null;
    var cT = p.T + clamp(sw.result.timingErr || 0, 0, 0.08), tc = v.pitchT - cT;
    // where the bat visibly meets it: on a late swing the pitch is already on its way into the mitt, so the meeting
    // is drawn at most LATE_DEPTH ft behind the plate (the ball waits on the bat for a frame or two)
    var vT = cT;
    if (!OLD && p.T != null) { var k = 0; while (vT > p.T && pitchPos(p, vT).y < -LATE_DEPTH && k++ < 60) vT -= 0.002; }
    return { cT: cT, tc: tc, hit: tc >= 0, sweet: !!sw.result.sweet, q: sw.result.quality || 0.5, vT: vT, vP: pitchPos(p, vT) };
  }
  var LATE_DEPTH = 1.2;
  function pitchPos(p, t) {
    if (BB.Pitch && BB.Pitch.pos && p._b) { try { return BB.Pitch.pos(p, t); } catch (e) {} }
    if (typeof p.pos === 'function') return p.pos(t);
    var r = p.release || { x: -1.75, y: K.RELEASE_Y, z: 6 }, pl = p.plate || { x: 0, z: 2.5 }, s = t / (p.T || 0.75);
    if (s <= 1) return { x: lerp(r.x, pl.x, s), y: r.y * (1 - s), z: lerp(r.z, pl.z, s) };
    return { x: pl.x, y: -3 * Math.min(1, (s - 1) * 4), z: pl.z };
  }
  function releaseOf(v) {
    if (v.pitch && v.pitch.release) return v.pitch.release;
    if (BB.Pitch && BB.Pitch.releasePoint && v.pitcher) return BB.Pitch.releasePoint(v.pitcher);
    return { x: (v.pitcher && v.pitcher.hand === 'L') ? 1.75 : -1.75, y: K.RELEASE_Y, z: 6 };
  }

  function doBat(v, st) {
    var t = v.time || 0, p = v.pitch, ci = contactInfo(v), sw = v.swing;
    st.ci = ci;
    // --- Rocco
    if (glb()) heroBat(v, st, ci);
    else {
      var R = S.rocco;
      place(R, ROCCO.x, ROCCO.y, 0, PI / 2);
      syncBatFrame();
      var tgt = null;
      if (p && p.plate) tgt = toUp(R, p.plate.x, 0.25, p.plate.z);
      var o = { time: t, load: v.loading != null ? v.loading : 0, swingT: sw ? sw.t : null, contact: !!(ci && ci.hit), tgt: tgt, power: sw && sw.power,
        whiff: !!(sw && sw.result && !sw.result.contact), tc: ci ? ci.tc : null, hr: !!(v.play && v.play.type === 'HR'), onFire: v.onFire };
      if (v.windup != null && !v.loading) o.load = 0.18 * smooth((v.windup - 0.6) / 0.4); // a little natural coil as the pitcher strides
      var pose = A.batter(o);
      C.apply(R, pose);
      var bi = A.batterBat(pose, o);
      if (bi.free) { S.bat.parent !== S.batFrame.userData.up && S.batFrame.userData.up.add(S.bat); S.bat.position.set(bi.pos[0], Math.max(0.15, bi.pos[1]), bi.pos[2]); V2.set(bi.dir[0], bi.dir[1], bi.dir[2]).normalize(); _q.setFromUnitVectors(_up, V2); S.bat.quaternion.copy(_q); }
      else poseBat(R, S.bat, bi);
      var smear = sw && sw.t > 0.012 && sw.t < 0.13;
      S.bat.scale.set(1, smear ? 1.22 : 1, 1);
      st.pose = pose; st.o = o;
    }
    // --- pitcher
    var Pm = S.pitcher, rel = releaseOf(v);
    place(Pm, 0, 60.5, 0.83, 0);
    if (PITCHER_K !== 1) Pm.root.scale.setScalar(PITCHER_K);
    var react = null, reactT = 0;
    if (ci && ci.hit && v.play) { react = v.play.type === 'HR' || v.play.type === '3B' || v.play.type === '2B' ? 'jaw' : v.play.type === 'OUT' || v.play.type === 'FOUL' ? null : 'grr'; reactT = ci.tc; }
    else if (p && v.pitchT != null && v.pitchT > p.T + 0.15 && !(ci && ci.hit) && (sw || p.strike)) { react = 'smug'; reactT = v.pitchT - p.T - 0.15; }
    var pp = A.pitcher({ windup: v.windup, pitchT: v.windup != null ? null : (p ? v.pitchT : null), style: (v.pitcher && v.pitcher.look && v.pitcher.look.windup) || Pm.style, rel: toUp(Pm, rel.x, rel.y, rel.z), time: t, react: react, reactT: reactT });
    if (react === 'jaw' && ci) { pp.hy = (pp.hy || 0) + 0.4 * smooth(ci.tc / 0.2); pp.hx = -0.6; }
    C.apply(Pm, pp);
    // --- catcher: reads the pitch late, then sticks it
    var Cc = S.catcher, cxs = CATCHER.x;
    var mitt = CATCHER.mitt ? { x: CATCHER.mitt.x, y: CATCHER.mitt.y, z: CATCHER.mitt.z } : { x: 0.1, y: -2.55, z: 2.3 }, pop = 0;
    if (p && v.pitchT != null) {
      var fin = pitchPos(p, p.T + 0.5), w = smooth((v.pitchT / p.T - 0.35) / 0.55);
      if (CATCHER.shift) cxs = lerp(CATCHER.x, fin.x + 0.5, CATCHER.shift * w);   // shuffles over, glove side to the ball
      mitt = { x: lerp(mitt.x, fin.x, w), y: lerp(mitt.y, fin.y - 0.15, w), z: lerp(mitt.z, fin.z, w) };
      if (!(ci && ci.hit) && v.pitchT > p.T) pop = Math.max(0, 1 - (v.pitchT - p.T - 0.05) / 0.25);
      if (ci && ci.hit) { mitt = { x: 0.6, y: -3.0, z: 3.4 + smooth(ci.tc / 0.15) * 1.2 }; }
    }
    place(Cc, cxs, CATCHER.y, 0, PI);
    var cp = A.catcher({ mitt: toUp(Cc, mitt.x, mitt.y + 0.1, mitt.z - 0.05), pop: pop, time: t });
    if (ci && ci.hit) { cp.hx = 0.7; cp.mouth = 0.7; cp.browY = 1; }
    C.apply(Cc, cp);
    // --- umpire: pops in from the right for called strikes
    var callT = null;
    if (p && !sw && v.pitchT != null && p.strike && v.pitchT > p.T + 0.1) callT = v.pitchT - p.T - 0.12;
    var Um = S.ump, slide = callT == null ? 0 : smooth(callT / 0.14) * (1 - smooth((callT - 1.1) / 0.25));
    if (slide > 0.01) {
      place(Um, lerp(UMP.off, UMP.x, C.backOut(Math.min(1, slide))), UMP.y, 0, yawToward(-0.75, -1));
      C.apply(Um, A.ump({ callT: callT, time: t }));
    }
    // --- fielders that happen to be in shot
    showFieldersIdle(t, S.camBat);
    // --- ball
    if (p && v.pitchT != null) {
      var bp, vel, spin = v.pitchT * (p.type === 'KN' ? 3 : 40), squash = 0;
      if (ci && ci.hit && v.play) {
        var tt = ci.tc;
        bp = v.play.ballAt(Math.max(0, tt)); var b2 = v.play.ballAt(Math.max(0, tt) + 0.02);
        vel = { x: (b2.x - bp.x) / 0.02, y: (b2.y - bp.y) / 0.02, z: (b2.z - bp.z) / 0.02 };
        squash = Math.max(0, 1 - tt / 0.06) * 0.8;
        if (!OLD) { // leave from the bat: start at the meeting point and blend into the physics path
          var b0 = v.play.ballAt(0), wl = 1 - smooth(tt / 0.2);
          bp = { x: bp.x + (ci.vP.x - b0.x) * wl, y: bp.y + (ci.vP.y - b0.y) * wl, z: bp.z + (ci.vP.z - b0.z) * wl };
        }
        if (tt < 0.012) { var pc = OLD ? pitchPos(p, ci.cT) : ci.vP; bp = pc; }
      } else if (ci && v.pitchT > ci.vT) {
        bp = ci.vP; vel = null;
      } else {
        bp = pitchPos(p, v.pitchT); var b3 = pitchPos(p, v.pitchT + 0.01);
        vel = { x: (b3.x - bp.x) / 0.01, y: (b3.y - bp.y) / 0.01, z: (b3.z - bp.z) / 0.01 };
        if (v.pitchT > p.T + 0.04) { vel = null; spin = 0; }
      }
      st.ballR = setBall(bp, vel, spin, squash, S.camBat);
      st.ballPos = bp;
    } else if (v.windup != null) { // in the pitcher's hand (or glove early in the windup)
      var hand = v.windup < 0.36 ? Pm.handL : Pm.handR;
      hand.updateMatrixWorld(true); hand.getWorldPosition(V3);
      setBall({ x: V3.x, y: V3.y - 0.1, z: V3.z }, null, 0, 0, S.camBat);
      S.ballShadow.visible = false;
      if (v.windup < 0.36) S.ballG.visible = false;
    }
    // --- camera: shake + contact punch
    var cam = S.camBat;
    cam.position.set(S.batPos[0], S.batPos[1], S.batPos[2]);
    var shake = (v.shake || 0), look = batLook(), sk = OLD ? 1 : 0.6;   // the longer lens magnifies the shake
    if (shake > 0) cam.position.add(V.set(Math.sin(t * 71) * 0.16 * shake * sk, 0, Math.cos(t * 83) * 0.12 * shake * sk));
    cam.lookAt(look[0], look[1], look[2]);
    var punch = ci && ci.hit ? Math.max(0, 1 - ci.tc / 0.25) * (ci.sweet ? 1 : 0.6) : 0;
    cam.fov = S.camBase.fov * (1 - 0.07 * punch);
    cam.updateProjectionMatrix();
    S.cam = cam;
  }
  // ------------------------------------------------------------------ the modelled Rocco (BB.Rocco, 36-rocco.js)
  var PITCHER_EYE = { x: 0, y: 59, z: 7 };
  function latency() { try { var s = BB.Meta && BB.Meta.settings ? BB.Meta.settings() : null; return s && s.latencyMs != null ? s.latencyMs / 1000 : K.INPUT_LATENCY; } catch (e) { return K.INPUT_LATENCY; } }
  function heroBat(v, st, ci) {
    var p = v.pitch, H = S.hero;
    BB.Rocco.place(H.x, H.y, 0, PI / 2, H.size);
    BB.Rocco.setHot(v.onFire);
    var o = { ci: ci, pitcherHead: PITCHER_EYE, latency: latency(), hr: !!(v.play && v.play.type === 'HR') };
    if (p && v.pitchT != null) {
      if (ci && ci.hit && v.play) { o.ball = ci.vP; o.ballAfter = v.play.ballAt(Math.max(0, ci.tc) + 0.2); }
      else o.ball = pitchPos(p, Math.min(v.pitchT + 0.05, p.T + 0.3));
      o.contactPt = ci ? ci.vP : pitchPos(p, p.T);
    }
    st.hero = BB.Rocco.poseBat(v, o); st.heroO = o; st.glb = true;
    S.bat.visible = false;
  }
  // fx anchors that follow whichever Rocco is on screen
  function heroHead(st, lift) {
    if (st && st.glb) { var h = BB.Rocco.headPoint(V3); return { x: h.x, y: h.y, z: h.z + (lift || 0) }; }
    var hp = worldPt(S.rocco, S.rocco.headC); hp.z += lift || 0; return hp;
  }
  function heroBatTip(st) {
    if (st && st.glb) { var b = BB.Rocco.point('bat_tip', V3); return { x: b.x, y: b.y, z: b.z }; }
    S.bat.updateMatrixWorld(true); V3.set(0, 2.8, 0); S.bat.localToWorld(V3); return { x: V3.x, y: V3.y, z: V3.z };
  }
  function heroFeet(st) { var r = st && st.glb ? BB.Rocco.root().position : S.rocco.root.position; return { x: r.x, y: r.y, z: 0.1 }; }
  function showFieldersIdle(t, cam) {
    if (!S.fielders.length || !BB.Bat) return;
    cam.updateMatrixWorld(true);
    var fr = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    S.fielders.forEach(function (f, i) {
      if (i < 2) return;
      var d = BB.Bat.FIELDERS[BB.Bat.ORDER[i]];
      V.set(d.x, d.y, 2);
      if (!fr.containsPoint(V)) return;
      place(f, d.x, d.y, 0, yawToward(-d.x, -d.y));
      C.apply(f, A.fielder({ speed: 0, time: t, idx: i }));
    });
  }

  // ------------------------------------------------------------------ FIELD SCENE
  var BASES = K.BASES;
  function basePath(from, to, u) { // position along the base path from base `from` to `to` (to may be 4 = home), u 0..1
    var n = Math.max(1, to - from), seg = Math.min(n - 1e-6, u * n), i = Math.floor(seg), k = seg - i;
    var a = BASES[(from + i) % 4], b = BASES[(from + i + 1) % 4];
    return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), dx: b.x - a.x, dy: b.y - a.y };
  }
  function runnerPos(m, tx, dur) {
    var to = m.to === -1 ? m.from + 1 : Math.min(4, m.to), out = m.to === -1;
    var startT = m.from === 0 ? S.batStart || 0.32 : 0.12, runDur = Math.max(0.6, dur + 0.45 - startT);
    var u = clamp((tx - startT) / runDur, 0, 1);
    if (out) u = Math.min(u * 1.25, 0.86);
    var p = basePath(m.from, to, u);
    p.u = u; p.to = to; p.out = out; p.startT = startT; p.runDur = runDur;
    return p;
  }
  function fieldFocus(play, t) {
    var sx = 0, sy = 0, sz = 0, sw = 0;
    for (var k = 0; k < 7; k++) {
      var tt = Math.max(0, t - k * 0.07), b = play.ballAt(tt), w = 1 / (1 + k * 0.6);
      sx += b.x * w; sy += b.y * w; sz += b.z * w; sw += w;
    }
    return { x: sx / sw, y: sy / sw, z: sz / sw };
  }
  function doField(v, st) {
    var play = v.play, t = v.playT || 0, time = v.time || 0;
    if (!play) { doBat(v, st); return; }
    var dur = play.dur || 3, hero = glb();
    // the modelled Rocco flips his bat on a homer before he starts the trot
    S.batStart = hero && play.type === 'HR' && BB.Rocco.has('bat_flip') ? 0.95 : 0.32;
    // main holds the field scene a little after playT reaches dur ('between'): keep the runners and camera going
    if (S.endPlay !== play) { S.endPlay = play; S.endAt = null; }
    if (t >= dur - 1e-3) { if (S.endAt == null) S.endAt = time; } else S.endAt = null;
    var tx = t + (v._extra != null ? v._extra : S.endAt != null ? Math.min(1.2, time - S.endAt) : 0);
    // --- camera
    var F = fieldFocus(play, t), d = Math.hypot(F.x, F.y);
    var dir = d > 1 ? [F.x / d, F.y / d] : [0, 1], k0 = smooth(d / 60);
    dir = [lerp(0, dir[0], k0), lerp(1, dir[1], k0)]; var dl = Math.hypot(dir[0], dir[1]) || 1; dir = [dir[0] / dl, dir[1] / dl];
    var back = 72 + d * 0.16 + F.z * 0.3, hgt = 24 + d * 0.06 + F.z * 0.55;
    var start = 1 - smooth(t / 0.7);
    var cam = S.camField;
    var cx = F.x - dir[0] * back, cy = F.y - dir[1] * back;
    cam.position.set(lerp(cx, -10, start * 0.5), lerp(cy, -34, start * 0.5), lerp(hgt, 14, start * 0.5));
    var lookX = F.x + dir[0] * 30, lookY = F.y + dir[1] * 30, lookZ = F.z * 0.72 + 4;
    if (hero && play.type === 'HR') { // hold on the plate for the bat flip while the ball soars out of the top, then chase it
      var hk = 1 - smooth((t - 0.5) / 0.7);
      if (hk > 0) {
        cam.position.set(lerp(cam.position.x, HR_HOLD.pos[0], hk), lerp(cam.position.y, HR_HOLD.pos[1], hk), lerp(cam.position.z, HR_HOLD.pos[2], hk));
        lookX = lerp(lookX, HR_HOLD.look[0], hk); lookY = lerp(lookY, HR_HOLD.look[1], hk); lookZ = lerp(lookZ, HR_HOLD.look[2], hk);
      }
    }
    if (play.type === 'HR' && play.fenceT > 0 && t > play.fenceT) { var after = smooth((t - play.fenceT) / 1.2); lookZ += after * 25; }
    // closing beat: once the ball is dead, ease back to the diamond so the runners rounding the bases are in shot
    var tDead = play.type === 'HR' ? (play.hang || dur * 0.7) + 0.2 : Math.min(dur - 0.3, play.catchT >= 0 ? play.catchT + 0.9 : (play.hang || 1) + 0.7);
    var bm = null; (v.runners || []).forEach(function (m) { if (m.from === 0 && m.to !== -1) bm = m; });
    if (bm && play.type !== 'FOUL') {
      var kb = smooth((tx - tDead) / 0.8);
      if (kb > 0) {
        var rp = runnerPos(bm, tx, dur);
        var rx = rp.x * 0.75 + (rp.u >= 0.85 && rp.to === 4 ? 30 : 0), ry = rp.y * 0.75 - 46;
        cam.position.set(lerp(cam.position.x, rx, kb), lerp(cam.position.y, ry, kb), lerp(cam.position.z, 24, kb));
        lookX = lerp(lookX, rp.x, kb); lookY = lerp(lookY, rp.y - 4, kb); lookZ = lerp(lookZ, 1, kb);
      }
    }
    var shake = v.shake || 0;
    if (shake > 0) cam.position.add(V.set(Math.sin(time * 61) * 1.2 * shake, Math.cos(time * 53) * 1.2 * shake, Math.sin(time * 47) * 0.8 * shake));
    cam.lookAt(lookX, lookY, lookZ);
    cam.fov = 46; cam.updateProjectionMatrix();
    S.cam = cam;
    // --- fielders
    S.fielders.forEach(function (f, i) {
      if (!play.fielderAt) return;
      var a = play.fielderAt(i, t), b = play.fielderAt(i, Math.max(0, t - 0.08)), vx = (a.x - b.x) / 0.08, vy = (a.y - b.y) / 0.08, spd = Math.hypot(vx, vy);
      var ball = play.ballAt(t), fx = spd > 1.5 ? vx : ball.x - a.x, fy = spd > 1.5 ? vy : ball.y - a.y;
      place(f, a.x, a.y, groundZ(a.x, a.y), yawToward(fx, fy));
      var o = { speed: spd, phase: t * 13 + i, time: time, idx: i };
      if (i === play.catchBy && play.catchT >= 0) { o.catchU = (t - play.catchT) / 0.32; var cb = play.ballAt(play.catchT); o.high = cb.z > 4.5; }
      if (i === play.catchBy && play.throwT) o.throwU = (t - play.throwT[0]) / 0.35;
      C.apply(f, A.fielder(o));
    });
    // --- runners
    var moves = v.runners || [], dests = {}, mi = 0;
    var R = S.rocco, batterMoved = false;
    moves.forEach(function (m) {
      if (m.to >= 1 && m.to <= 3) dests[m.to] = true;
      var rp = runnerPos(m, tx, dur), to = rp.to, outRun = rp.out, startT = rp.startT, runDur = rp.runDur, bases = to - m.from, u = rp.u;
      var pos = rp, arrived = u >= 1;
      var ch;
      if (m.from === 0) { ch = R; batterMoved = true; } else ch = S.mates[(mi++) % S.mates.length];
      if (m.from === 0 && hero) { heroRunner(v, m, rp, tx, t, play, cam, st); return; }
      if (m.from === 0 && t < startT) { batterAtHome(v, t, play); return; }
      place(ch, pos.x, pos.y, 0, arrived && to === 4 ? yawToward(cam.position.x - pos.x, cam.position.y - pos.y) : yawToward(pos.dx, pos.dy));
      var spd = arrived ? 0 : bases * 90 / runDur;
      C.apply(ch, A.runner({ speed: spd, phase: tx * 14 + m.from, time: time, cheer: arrived && to === 4, slide: outRun ? smooth((u - 0.7) / 0.16) : arrived && to < 4 ? 0 : 0 }));
      if (ch === R && play.type !== 'HR') { // the bat gets tossed aside at the plate
        syncBatFrame(); S.batFrame.userData.up.add(S.bat); S.bat.position.set(0.9, 0.16, 1.4); V2.set(1, 0.05, 0.4).normalize(); _q.setFromUnitVectors(_up, V2); S.bat.quaternion.copy(_q);
      }
      if (ch === R && play.type === 'HR') { // the flipped bat keeps tumbling, then lies in the dirt
        syncBatFrame(); S.batFrame.userData.up.add(S.bat);
        var fb = A.batterBat({}, { contact: true, hr: true, tc: Math.min(t + 0.22, 0.9) });
        S.bat.position.set(fb.pos[0], Math.max(0.16, fb.pos[1]), fb.pos[2]); V2.set(fb.dir[0], fb.dir[1], fb.dir[2]).normalize(); _q.setFromUnitVectors(_up, V2); S.bat.quaternion.copy(_q);
      }
    });
    if (!batterMoved) { if (hero) heroHome(v, t, play, st); else batterAtHome(v, t, play); }
    // runners who stayed put
    var bases = (v.hud && v.hud.bases) || [];
    bases.forEach(function (on, k) {
      if (!on || dests[k + 1]) return;
      var ch = S.mates[(mi++) % S.mates.length], B = BASES[k + 1], nx = BASES[(k + 2) % 4];
      place(ch, B.x + (nx.x - B.x) * 0.06, B.y + (nx.y - B.y) * 0.06, 0, yawToward(nx.x - B.x, nx.y - B.y));
      C.apply(ch, A.runner({ speed: 0, time: time }));
    });
    // --- ball
    var bp = play.ballAt(t), b2 = play.ballAt(t + 0.02);
    var held = play.catchBy >= 0 && t >= play.catchT && !(play.throwT && t >= play.throwT[0] && t <= play.throwT[1]);
    st.ballR = setBall(bp, held ? null : { x: (b2.x - bp.x) / 0.02, y: (b2.y - bp.y) / 0.02, z: (b2.z - bp.z) / 0.02 }, t * 30, 0, cam);
    if (held && play.catchBy >= 0) {
      var fh = S.fielders[play.catchBy]; if (fh) { fh.handL.updateMatrixWorld(true); fh.handL.getWorldPosition(V3); S.ballG.position.copy(V3); }
    }
    st.ballPos = bp;
  }
  // batFrame mirrors Rocco's up transform at the plate (a flipped bat lives there while he runs)
  function syncBatFrame() {
    S.batFrame.position.set(ROCCO.x, ROCCO.y, 0); S.batFrame.rotation.set(0, 0, PI / 2);
    if (!S.batFrame.userData.up) { var u = new T.Group(); u.rotation.x = PI / 2; u.scale.setScalar(ROCCO.size); S.batFrame.add(u); S.batFrame.userData.up = u; }
  }
  // the modelled Rocco: at home after contact (follow-through, watch, bat flip), then running / trotting the bases
  var FIELD_DELAY = 0.22;   // main lingers this long on the bat scene after contact (60-main fieldDelay)
  function heroHome(v, t, play, st) {
    var H = S.hero;
    BB.Rocco.place(H.x, H.y, 0, PI / 2, H.size);
    BB.Rocco.setHot(v.onFire);
    BB.Rocco.poseHome(v, { tc: t + FIELD_DELAY, hr: play.type === 'HR', plateZ: v.pitch && v.pitch.plate ? v.pitch.plate.z : 2.5, ball: play.ballAt(Math.min(t + 0.3, play.dur)) });
    st.glb = true; S.bat.visible = false;
  }
  function heroRunner(v, m, rp, tx, t, play, cam, st) {
    if (t < rp.startT) { heroHome(v, t, play, st); return; }
    var H = S.hero, arrived = rp.u >= 1;
    var yaw = arrived && rp.to === 4 ? yawToward(cam.position.x - rp.x, cam.position.y - rp.y) : yawToward(rp.dx, rp.dy);
    BB.Rocco.place(rp.x, rp.y, 0, yaw, H.size);
    BB.Rocco.setHot(v.onFire);
    var bases = rp.to - m.from;
    BB.Rocco.poseRun(v, { dist: rp.u * bases * 90, runT: Math.max(0, tx - rp.startT), speed: bases * 90 / rp.runDur, hr: play.type === 'HR',
      arrived: arrived && !rp.out, arriveT: arrived ? tx - (rp.startT + rp.runDur) : null, out: rp.out, outT: rp.out ? tx - (rp.startT + rp.runDur * 0.86 / 1.25) : null });
    st.glb = true; S.bat.visible = false;
    // the bat: on a homer it keeps tumbling along its flip from the plate, then lies in the dirt; otherwise it was
    // dropped by the plate
    if (play.type === 'HR' && BB.Rocco.has('bat_flip')) BB.Rocco.flipBat(tx + FIELD_DELAY - FLIP_AT, H.homeMatrix);
    else BB.Rocco.dropBat(H.x + 1.5, H.y - 0.5, 0.45, -1);
  }
  var FLIP_AT = 0.18;   // 36-rocco: a homer's bat flip starts this long after contact
  function batterAtHome(v, t, play) {
    var R = S.rocco;
    syncBatFrame();
    place(R, ROCCO.x, ROCCO.y, 0, PI / 2);
    var tc = t + 0.22;
    var o = { time: v.time, swingT: 0.07 + tc, contact: true, tc: tc, hr: play.type === 'HR', onFire: v.onFire };
    var pose = A.batter(o);
    C.apply(R, pose);
    var bi = A.batterBat(pose, o);
    S.bat.visible = true;
    if (bi.free) { if (S.batFrame.userData.up) { if (S.bat.parent !== S.batFrame.userData.up) S.batFrame.userData.up.add(S.bat); S.bat.position.set(bi.pos[0], Math.max(0.15, bi.pos[1]), bi.pos[2]); V2.set(bi.dir[0], bi.dir[1], bi.dir[2]).normalize(); _q.setFromUnitVectors(_up, V2); S.bat.quaternion.copy(_q); } }
    else poseBat(R, S.bat, bi);
  }

  // ------------------------------------------------------------------ TITLE SCENE
  function doTitle(v, st) {
    var t = v.time || 0, R = S.rocco;
    if (glb()) {
      BB.Rocco.place(-3.0, -1.0, 0, 0.42, S.hero.size);
      BB.Rocco.setHot(false);
      BB.Rocco.poseTitle(t);
      st.glb = true; S.bat.visible = false;
    } else if (BB.Rocco && BB.Rocco.status && BB.Rocco.status() === 'loading') {
      S.bat.visible = false;   // the model is a moment away: no flash of the procedural Rocco on the title
    } else {
      place(R, -3.0, -1.0, 0, 0.42);
      var cyc = t % 6.5, o = { time: t, load: 0 };
      if (cyc > 4.6) { o.swingT = (cyc - 4.6) * 0.8; o.contact = false; o.tc = null; }
      var pose = A.batter(o);
      if (o.swingT == null) { pose.hy = 0.45 + Math.sin(t * 0.6) * 0.25; pose.hx = -0.1; pose.lx = -0.5; pose.smile = 1; pose.brow = -0.1; }
      C.apply(R, pose);
      poseBat(R, S.bat, A.batterBat(pose, o));
      S.bat.scale.set(1, 1, 1);
    }
    var cam = S.camTitle, a = Math.sin(t * 0.07) * 0.18, cd = st.glb ? 22 : 26;   // the model is a 5-ft Rocco: come in a little
    cam.position.set(-3.0 + Math.sin(a) * cd, -1.0 - Math.cos(a) * cd, (st.glb ? 3.9 : 4.2) + Math.sin(t * 0.11) * 0.4);
    cam.fov = 40;
    cam.lookAt(-2.0 + Math.sin(a) * 4, 60, 3.0);
    cam.updateProjectionMatrix();
    // nudge the framing so Rocco sits in the top 40%
    cam.setViewOffset(S.W, S.H, 0, S.H * 0.14, S.W, S.H);
    S.cam = cam;
    showFieldersIdle(t, cam);
    st.title = true;
  }

  // ------------------------------------------------------------------ OVERLAY: comic FX, HUD, stamps, iris
  var X; // overlay context
  function oBegin() {
    X = S.octx; X.setTransform(1, 0, 0, 1, 0, 0); X.clearRect(0, 0, S.ov.width, S.ov.height);
    X.setTransform(S.ovScale, 0, 0, S.ovScale, 0, 0);
    X.lineJoin = 'round'; X.lineCap = 'round';
  }
  function F(px, body, weight) { return (weight ? weight + ' ' : '') + px + 'px ' + (body ? BB.FONTS.body : BB.FONTS.display); }
  function burst(cx, cy, r0, r1, n, rot, seed) {
    var r = U.rng(seed || 7); X.beginPath();
    for (var i = 0; i < n * 2; i++) {
      var a = rot + i / (n * 2) * PI * 2, rr = i % 2 ? r0 * (0.85 + r() * 0.3) : r1 * (0.85 + r() * 0.3);
      var x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      if (i) X.lineTo(x, y); else X.moveTo(x, y);
    }
    X.closePath();
  }
  function comic(str, cx, cy, px, fill, o) {
    o = o || {};
    X.save(); X.translate(cx, cy); if (o.rot) X.rotate(o.rot); if (o.scale != null) X.scale(o.scale, o.scale);
    X.font = F(px); X.textAlign = 'center'; X.textBaseline = 'middle';
    var w = X.measureText(str).width, mw = o.maxW || S.W * 0.92;
    if (w > mw) { px = px * mw / w; X.font = F(px); }
    var lw = Math.max(3, px * 0.16);
    if (o.shadow !== false) { X.fillStyle = INK; X.strokeStyle = INK; X.lineWidth = lw; X.strokeText(str, px * 0.07, px * 0.09); X.fillText(str, px * 0.07, px * 0.09); }
    X.lineWidth = lw; X.strokeStyle = o.edge || INK; X.strokeText(str, 0, 0);
    X.fillStyle = fill; X.fillText(str, 0, 0);
    if (o.shine) { X.save(); X.globalAlpha = 0.35; X.fillStyle = '#FFFFFF'; X.beginPath(); X.rect(-w, -px * 0.45, w * 2, px * 0.28); X.clip(); X.fillText(str, 0, 0); X.restore(); }
    X.restore();
  }
  function puff(cx, cy, r, fill, alpha, seed) {
    var rr = U.rng(seed || 3);
    X.save(); X.globalAlpha = alpha == null ? 1 : alpha;
    X.beginPath();
    for (var i = 0; i < 5; i++) { var a = i / 5 * PI * 2 + rr(); X.moveTo(cx + Math.cos(a) * r * 0.55 + r * 0.5, cy + Math.sin(a) * r * 0.45); X.arc(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.45, r * (0.42 + rr() * 0.15), 0, PI * 2); }
    X.fillStyle = fill || CREAM; X.lineWidth = 2.5; X.strokeStyle = INK; X.stroke(); X.fill();
    X.restore();
  }
  function star(cx, cy, r, rot, fill) {
    X.beginPath();
    for (var i = 0; i < 10; i++) { var a = rot + i / 10 * PI * 2 - PI / 2, rr = i % 2 ? r * 0.45 : r; X.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    X.closePath(); X.fillStyle = fill || MUSTARD; X.lineWidth = 2; X.strokeStyle = INK; X.fill(); X.stroke();
  }
  function flame(cx, cy, s, t, seed) {
    var w = Math.sin(t * 13 + seed) * 0.18, h = 1 + Math.sin(t * 9 + seed * 2) * 0.18;
    [[BRICK, 1], ['#F28C38', 0.72], [MUSTARD, 0.44]].forEach(function (c) {
      var k = c[1] * s;
      X.beginPath(); X.moveTo(cx - k * 0.5, cy);
      X.quadraticCurveTo(cx - k * 0.62, cy - k * 0.8 * h, cx + w * k, cy - k * 1.45 * h);
      X.quadraticCurveTo(cx + k * 0.2, cy - k * 0.8 * h, cx + k * 0.5, cy);
      X.closePath(); X.fillStyle = c[0]; X.fill();
      if (c[1] === 1) { X.lineWidth = 2; X.strokeStyle = INK; X.stroke(); }
    });
  }
  function rrect(x, y, w, h, r) { X.beginPath(); X.moveTo(x + r, y); X.arcTo(x + w, y, x + w, y + h, r); X.arcTo(x + w, y + h, x, y + h, r); X.arcTo(x, y + h, x, y, r); X.arcTo(x, y, x + w, y, r); X.closePath(); }
  function card(x, y, w, h, fill, r, sh) {
    rrect(x + (sh == null ? 4 : sh), y + (sh == null ? 5 : sh), w, h, r || 12); X.fillStyle = INK; X.fill();
    rrect(x, y, w, h, r || 12); X.fillStyle = fill || CREAM; X.fill(); X.lineWidth = 3; X.strokeStyle = INK; X.stroke();
  }
  function worldPt(ch, part) { part.updateMatrixWorld(true); part.getWorldPosition(V3); return { x: V3.x, y: V3.y, z: V3.z }; }

  function fxBat(v, st) {
    var p = v.pitch, t = v.time || 0, sw = v.swing, ci = st.ci, cam = S.cam;
    // strike zone (faint) + assist ring
    var z = K.ZONE, a = plateToScreen(-z.xMax, z.zMax), b = plateToScreen(z.xMax, z.zMin);
    X.save(); X.setLineDash([2, 7]); X.lineWidth = 2.5; X.strokeStyle = 'rgba(255,244,220,0.55)';
    rrect(a.x, a.y, b.x - a.x, b.y - a.y, 6); X.stroke();
    X.setLineDash([]); X.lineWidth = 3; X.strokeStyle = 'rgba(255,244,220,0.6)';
    var cl = 12;[[a.x, a.y, 1, 1], [b.x, a.y, -1, 1], [a.x, b.y, 1, -1], [b.x, b.y, -1, -1]].forEach(function (c) { X.beginPath(); X.moveTo(c[0], c[1] + c[3] * cl); X.lineTo(c[0], c[1]); X.lineTo(c[0] + c[2] * cl, c[1]); X.stroke(); });
    X.restore();
    if (p && v.pitchT != null && v.assist && !(ci && ci.hit)) {
      var f = v.pitchT / p.T;
      if (f >= 0.45 && f <= 1.08) {
        var c = plateToScreen(p.plate.x, p.plate.z), k = clamp((f - 0.45) / 0.55, 0, 1), rr = lerp(46, 15, U.easeOut(k)), al = f > 1 ? 1 - (f - 1) / 0.08 : smooth((f - 0.45) / 0.1);
        X.save(); X.globalAlpha = al; X.translate(c.x, c.y); X.rotate(t * 2.2);
        X.lineWidth = 6; X.strokeStyle = INK; X.beginPath(); X.arc(0, 0, rr, 0, PI * 2); X.stroke();
        X.lineWidth = 3.5; X.strokeStyle = MUSTARD; X.setLineDash([rr * 0.5, rr * 0.28]); X.beginPath(); X.arc(0, 0, rr, 0, PI * 2); X.stroke(); X.setLineDash([]);
        for (var i = 0; i < 4; i++) { X.rotate(PI / 2); X.beginPath(); X.moveTo(rr + 3, 0); X.lineTo(rr + 11, 0); X.lineWidth = 5; X.strokeStyle = INK; X.stroke(); X.lineWidth = 2.5; X.strokeStyle = MUSTARD; X.stroke(); }
        X.beginPath(); X.arc(0, 0, 3, 0, PI * 2); X.fillStyle = BRICK; X.fill();
        X.restore();
      }
    }
    // speed lines / smoke for the pitch in flight
    if (p && v.pitchT != null && v.pitchT > 0.02 && v.pitchT < p.T + 0.03 && !(ci && ci.hit)) {
      var fast = p.mph >= 88, pts = [];
      for (var j = 0; j <= 6; j++) { var tt = Math.max(0, v.pitchT - j * 0.022), q = pitchPos(p, tt), s = proj(q.x, q.y, q.z, cam); pts.push(s); }
      var head = pts[0], rB = Math.max(4, st.ballR ? st.ballR * pxPerFt(Math.max(1, cam.position.distanceTo(S.ballG.position)), cam) : 6);
      if (fast) for (j = 6; j >= 2; j--) puff(pts[j].x, pts[j].y, rB * (0.5 + j * 0.12), j % 2 ? '#FFFFFF' : CREAM, 0.55 - j * 0.06, j + p.id * 3);
      var tail = pts[Math.min(pts.length - 1, fast ? 6 : 4)], dx = head.x - tail.x, dy = head.y - tail.y, dl = Math.hypot(dx, dy) || 1, nx = -dy / dl, ny = dx / dl;
      if (dl > 4) for (j = -1; j <= 1; j++) {
        var off = j * rB * 1.1, l0 = rB * 1.6, l1 = Math.min(dl * 0.8, 90) * (1 - Math.abs(j) * 0.3);
        X.beginPath(); X.moveTo(head.x - dx / dl * l0 + nx * off, head.y - dy / dl * l0 + ny * off); X.lineTo(head.x - dx / dl * (l0 + l1) + nx * off, head.y - dy / dl * (l0 + l1) + ny * off);
        X.lineWidth = 5; X.strokeStyle = INK; X.stroke(); X.lineWidth = 2.5; X.strokeStyle = '#FFF9EE'; X.stroke();
      }
    }
    // bat smear during the swing
    var trail = null;
    if (sw && sw.t > 0.008 && sw.t < 0.14 && st.glb) {
      var times = []; for (var m0 = 0; m0 <= 6; m0++) times.push(Math.max(0, sw.t - m0 * 0.011));
      trail = BB.Rocco.batTrail(v, st.heroO, times);
    }
    if (sw && sw.t > 0.008 && sw.t < 0.14 && (trail || (!st.glb && S.rocco && st.o))) {
      var R = S.rocco, tips = [], grips = [], m;
      if (trail) for (m = 0; m <= 6; m++) { tips.push(proj(trail.tips[m].x, trail.tips[m].y, trail.tips[m].z, cam)); grips.push(proj(trail.mids[m].x, trail.mids[m].y, trail.mids[m].z, cam)); }
      else for (m = 0; m <= 6; m++) {
        var ts = Math.max(0, sw.t - m * 0.011), o2 = Object.assign({}, st.o, { swingT: ts }), ps = A.batter(o2), bi = A.batterBat(ps, o2);
        var dd = bi.dir, gl = Math.hypot(dd[0], dd[1], dd[2]) || 1;
        var tip = fromUp(R, [bi.pos[0] + dd[0] / gl * 3.2, bi.pos[1] + dd[1] / gl * 3.2, bi.pos[2] + dd[2] / gl * 3.2], new T.Vector3());
        var mid = fromUp(R, [bi.pos[0] + dd[0] / gl * 1.2, bi.pos[1] + dd[1] / gl * 1.2, bi.pos[2] + dd[2] / gl * 1.2], new T.Vector3());
        tips.push(proj(tip.x, tip.y, tip.z, cam)); grips.push(proj(mid.x, mid.y, mid.z, cam));
      }
      X.save(); X.globalAlpha = 0.85 * (1 - smooth((sw.t - 0.09) / 0.05));
      X.beginPath(); X.moveTo(tips[0].x, tips[0].y);
      for (m = 1; m < tips.length; m++) X.lineTo(tips[m].x, tips[m].y);
      for (m = grips.length - 1; m >= 0; m--) X.lineTo(grips[m].x, grips[m].y);
      X.closePath(); X.fillStyle = '#FFF9EE'; X.fill(); X.lineWidth = 2.5; X.strokeStyle = INK; X.stroke();
      for (m = 1; m < 4; m++) { X.beginPath(); X.moveTo(lerp(tips[0].x, grips[0].x, m / 4), lerp(tips[0].y, grips[0].y, m / 4)); X.lineTo(lerp(tips[5].x, grips[5].x, m / 4), lerp(tips[5].y, grips[5].y, m / 4)); X.lineWidth = 1.5; X.stroke(); }
      X.restore();
    }
    // contact: impact star + comic word
    if (ci && ci.hit && ci.tc < 0.3) {
      var cp = ci.vP, sc = proj(cp.x, cp.y, cp.z, cam), u = ci.tc / 0.3, big = ci.sweet ? 1.35 : 0.9 + ci.q * 0.3;
      var sz = (60 + 50 * U.easeOut(Math.min(1, ci.tc / 0.08))) * big * (1 - smooth((u - 0.6) / 0.4) * 0.6);
      X.save(); X.globalAlpha = 1 - smooth((u - 0.65) / 0.35);
      burst(sc.x, sc.y, sz * 0.45, sz, 12, t * 0.5, 11); X.fillStyle = ci.sweet ? MUSTARD : '#FFF9EE'; X.fill(); X.lineWidth = 4; X.strokeStyle = INK; X.stroke();
      burst(sc.x, sc.y, sz * 0.28, sz * 0.62, 12, t * 0.5 + 0.2, 13); X.fillStyle = ci.sweet ? BRICK : MUSTARD; X.fill();
      var word = v.play && v.play.type === 'FOUL' ? 'TINK!' : ci.sweet ? 'WHAM!' : ci.q > 0.6 ? 'POW!' : 'BONK!';
      comic(word, sc.x + 10, sc.y - sz * 0.95, 40 * big, ci.sweet ? '#FFF9EE' : MUSTARD, { rot: -0.18, scale: C.backOut(Math.min(1, ci.tc / 0.12)) });
      X.restore();
    }
    if (v.hitstop && ci) { X.save(); X.globalAlpha = 0.35; X.fillStyle = '#FFF9EE'; X.fillRect(0, 0, S.W, S.H); X.restore(); }
    // mitt pop
    if (p && v.pitchT != null && !(ci && ci.hit) && v.pitchT > p.T + 0.03 && v.pitchT < p.T + 0.35) {
      var fin = pitchPos(p, p.T + 0.5), mp = proj(fin.x, fin.y, fin.z, cam), uu = (v.pitchT - p.T - 0.03) / 0.32;
      X.save(); X.globalAlpha = 1 - uu;
      for (var r2 = 0; r2 < 7; r2++) { var aa = r2 / 7 * PI * 2 + 0.3, l1 = 26 + uu * 30, l2 = l1 + 14; X.beginPath(); X.moveTo(mp.x + Math.cos(aa) * l1, mp.y + Math.sin(aa) * l1); X.lineTo(mp.x + Math.cos(aa) * l2, mp.y + Math.sin(aa) * l2); X.lineWidth = 4; X.strokeStyle = INK; X.stroke(); }
      if (p.mph >= 85) comic('POP!', mp.x + 46, mp.y - 30, 24, '#FFF9EE', { rot: 0.15, scale: C.backOut(Math.min(1, uu * 4)) });
      X.restore();
    }
    // loading: coiled power, sweat drop
    if (v.loading > 0.05 && S.rocco) {
      var hp = heroHead(st, 0), hs = proj(hp.x, hp.y, hp.z + 0.9, cam), L1 = v.loading;
      X.save(); X.globalAlpha = smooth(L1);
      for (var q2 = 0; q2 < 3; q2++) { var yy = hs.y + 50 + q2 * 26, xx = hs.x - 70 - q2 * 6 + Math.sin(t * 40 + q2) * 2 * L1; X.beginPath(); X.moveTo(xx, yy); X.lineTo(xx - 22 - 8 * L1, yy + 4); X.lineWidth = 4; X.strokeStyle = INK; X.stroke(); }
      if (L1 > 0.6) { var sdx = hs.x + 30, sdy = hs.y + 6 + ((t * 1.5) % 1) * 12; X.beginPath(); X.moveTo(sdx, sdy - 10); X.quadraticCurveTo(sdx + 7, sdy, sdx, sdy + 6); X.quadraticCurveTo(sdx - 7, sdy, sdx, sdy - 10); X.fillStyle = TEAL; X.fill(); X.lineWidth = 2; X.strokeStyle = INK; X.stroke(); }
      if (L1 > 0.98) for (q2 = 0; q2 < 4; q2++) star(hs.x - 40 + Math.cos(t * 9 + q2 * 1.6) * 60, hs.y + 80 + Math.sin(t * 9 + q2 * 1.6) * 30, 7, t * 4 + q2, MUSTARD);
      X.restore();
    }
    // dizzy stars after the corkscrew
    if (sw && sw.result && !sw.result.contact && sw.t > 0.6 && S.rocco) {
      var hp2 = heroHead(st, 0), hc = proj(hp2.x, hp2.y, hp2.z + (st.glb ? 1.25 : 1.0), cam), rx = 34, ry = 11;
      for (var k2 = 0; k2 < 4; k2++) { var an = t * 5 + k2 / 4 * PI * 2; star(hc.x + Math.cos(an) * rx, hc.y + Math.sin(an) * ry, 9 + Math.sin(an) * 2, t * 3 + k2, k2 % 2 ? MUSTARD : '#FFF9EE'); }
    }
    // on fire: the bat smokes and flames lick at Rocco's cleats
    if (v.onFire && S.rocco) {
      var btw = heroBatTip(st), bt = proj(btw.x, btw.y, btw.z, cam);
      for (var sm = 0; sm < 4; sm++) { var ph = (t * 0.9 + sm / 4) % 1; puff(bt.x + Math.sin(ph * 6 + sm) * 8, bt.y - ph * 70, 8 + ph * 14, '#E9E2D6', 0.8 * (1 - ph), sm + 40); }
      var fw = heroFeet(st), ft = proj(fw.x, fw.y, fw.z, cam);
      for (var fl = 0; fl < 5; fl++) flame(ft.x - 50 + fl * 25, ft.y + 6, 26 + (fl % 2) * 10, t, fl);
    }
  }

  function fxField(v, st) {
    var play = v.play, t = v.playT || 0, time = v.time || 0, cam = S.cam;
    if (!play) return;
    // dotted trail behind the ball
    var tStop = play.catchBy >= 0 ? Math.min(t, play.catchT) : t;
    X.save();
    for (var k = 1; k < 26; k++) {
      var tt = tStop - k * 0.06; if (tt < 0) break;
      var b = play.ballAt(tt), s = proj(b.x, b.y, b.z, cam);
      if (s.behind) continue;
      X.globalAlpha = 0.8 * (1 - k / 26);
      X.beginPath(); X.arc(s.x, s.y, 3.2 - k * 0.07, 0, PI * 2); X.fillStyle = '#FFF9EE'; X.fill(); X.lineWidth = 1.6; X.strokeStyle = INK; X.stroke();
    }
    X.restore();
    // the ball itself, inked so it always reads against crowd and sky
    var bnow = play.ballAt(t), bs = proj(bnow.x, bnow.y, bnow.z, cam);
    if (!bs.behind && (play.catchBy < 0 || t < play.catchT)) {
      var br = clamp(st.ballR ? st.ballR * pxPerFt(Math.max(1, cam.position.distanceTo(S.ballG.position)), cam) : 6, 6, 14);
      X.beginPath(); X.arc(bs.x, bs.y, br, 0, PI * 2); X.fillStyle = '#FFFDF6'; X.fill(); X.lineWidth = 2.5; X.strokeStyle = INK; X.stroke();
      X.beginPath(); X.arc(bs.x - br * 1.1, bs.y, br * 0.75, -0.9, 0.9); X.lineWidth = 1.8; X.strokeStyle = BRICK; X.stroke();
      X.beginPath(); X.arc(bs.x + br * 1.1, bs.y, br * 0.75, PI - 0.9, PI + 0.9); X.stroke();
    }
    // landing / wall dust, CLANG
    if (play.wallT > 0 && t > play.wallT && t < play.wallT + 1.0) {
      var wb = play.ballAt(play.wallT), ws = proj(wb.x, wb.y, wb.z, cam), u = (t - play.wallT) / 1.0;
      for (var p2 = 0; p2 < 5; p2++) puff(ws.x + (p2 - 2) * 16 * (1 + u), ws.y + 10 - u * 20 - (p2 % 2) * 10, 12 + u * 16, '#E9D2B0', 1 - u, p2 + 20);
      comic('CLANG!', ws.x, ws.y - 50 - u * 20, 40, MUSTARD, { rot: -0.12, scale: C.backOut(Math.min(1, u * 5)) });
    }
    if (play.type !== 'HR' && play.catchBy < 0 && play.hang > 0 && t > play.hang && t < play.hang + 0.6) {
      var lb = play.ballAt(play.hang), ls = proj(lb.x, lb.y, 0, cam), lu = (t - play.hang) / 0.6;
      for (var p3 = 0; p3 < 3; p3++) puff(ls.x + (p3 - 1) * 12 * (1 + lu), ls.y - lu * 10, 8 + lu * 10, '#E3B47E', 1 - lu, p3 + 30);
    }
    // catch pop
    if (play.catchBy >= 0 && play.catchT >= 0 && t > play.catchT && t < play.catchT + 0.5) {
      var cb = play.ballAt(play.catchT), cs = proj(cb.x, cb.y, cb.z, cam), cu = (t - play.catchT) / 0.5;
      X.save(); X.globalAlpha = 1 - cu;
      burst(cs.x, cs.y, 10 + cu * 10, 26 + cu * 26, 8, 0.2, 5); X.fillStyle = '#FFF9EE'; X.fill(); X.lineWidth = 3; X.strokeStyle = INK; X.stroke();
      if (play.type === 'OUT') comic(play.outKind === 'ground' ? 'SCOOP!' : 'SNAG!', cs.x, cs.y - 42, 26, MUSTARD, { rot: 0.1, scale: C.backOut(Math.min(1, cu * 5)) });
      X.restore();
    }
    // home run: KA-BLAM + fireworks over the fence
    if (play.type === 'HR') {
      var ft = play.fenceT > 0 ? play.fenceT : (play.hang || 2) * 0.8;
      if (t > ft) {
        var hu = t - ft, fb = play.ballAt(ft), r = U.rng(Math.round(play.ev * 10 + play.spray * 7));
        for (var f = 0; f < 6; f++) {
          var t0 = f * 0.28, age = hu - t0; if (age < 0 || age > 1.3) continue;
          var ox = (r() - 0.5) * 220, oz = 60 + r() * 90, cx = fb.x + Math.sin(play.spray * PI / 180 + PI / 2) * ox, cy = fb.y + 40, fs = proj(cx, cy, oz, cam);
          var col = [MUSTARD, BRICK, TEAL, '#F29E8E', '#FFF9EE'][f % 5], rad = 20 + 70 * U.easeOut(age / 0.9);
          X.save(); X.globalAlpha = 1 - smooth((age - 0.8) / 0.5);
          for (var sp2 = 0; sp2 < 12; sp2++) {
            var an = sp2 / 12 * PI * 2 + f, x1 = fs.x + Math.cos(an) * rad * 0.55, y1 = fs.y + Math.sin(an) * rad * 0.55 + age * age * 30, x2 = fs.x + Math.cos(an) * rad, y2 = fs.y + Math.sin(an) * rad + age * age * 40;
            X.beginPath(); X.moveTo(x1, y1); X.lineTo(x2, y2); X.lineWidth = 6; X.strokeStyle = INK; X.stroke(); X.lineWidth = 3.5; X.strokeStyle = col; X.stroke();
          }
          star(fs.x, fs.y + age * age * 30, 9 * (1 - age / 1.3), age * 5, col);
          X.restore();
        }
        if (hu < 1.4 && !v.stamp) {
          var ks = proj(fb.x, fb.y, fb.z + 20, cam), ku = hu / 1.4;
          X.save(); X.globalAlpha = 1 - smooth((ku - 0.75) / 0.25);
          var kx = clamp(ks.x, 110, S.W - 110), ky = clamp(ks.y, 220, S.H * 0.6);
          burst(kx, ky, 46, 96, 14, time * 0.4, 9); X.fillStyle = BRICK; X.fill(); X.lineWidth = 4; X.strokeStyle = INK; X.stroke();
          burst(kx, ky, 30, 64, 14, time * 0.4 + 0.1, 19); X.fillStyle = MUSTARD; X.fill();
          comic('KA-BLAM!', kx, ky, 40, '#FFF9EE', { rot: -0.1, scale: C.backOut(Math.min(1, hu * 5)) });
          X.restore();
        }
      }
    }
  }

  // ---------------- HUD: a cream scoreboard card, cached and blitted
  function hudKey(v) {
    var h = v.hud; if (!h) return '';
    return [S.W, S.H, h.balls, h.strikes, h.outs, h.outsMax, (h.bases || []).join(), h.inning, h.score, h.progress, h.goal, v.last ? v.last.mph + v.last.name : '', v.onFire ? 1 : 0, h.streak, S.inkKey, S.fontsOk].join('|');
  }
  function drawHud(v) {
    var h = v.hud; if (!h) return;
    var key = hudKey(v), hc = S.hud;
    var top = 48, x0 = 10, w = S.W - x0 - 66, hh = 62;
    if (key !== hc.key) {
      hc.key = key;
      if (!hc.canvas) hc.canvas = document.createElement('canvas');
      var od = S.ovScale, cv = hc.canvas; cv.width = Math.round(S.W * od); cv.height = Math.round(170 * od);
      var save = X; X = cv.getContext('2d'); X.setTransform(od, 0, 0, od, 0, 0); X.clearRect(0, 0, S.W, 170); X.lineJoin = 'round'; X.lineCap = 'round';
      var y0 = 4;
      card(x0, y0, w, hh, CREAM, 14, 5);
      // score block
      var sbw = Math.min(104, w * 0.33);
      rrect(x0 + 6, y0 + 6, sbw, hh - 12, 10); X.fillStyle = S.col.a; X.fill(); X.lineWidth = 2.5; X.strokeStyle = INK; X.stroke();
      X.fillStyle = '#FFF9EE'; X.font = F(11, true, '700'); X.textAlign = 'center'; X.textBaseline = 'middle';
      X.fillText(String(h.inning || '').toUpperCase(), x0 + 6 + sbw / 2, y0 + 17);
      var scoreTxt = String(h.score || '');
      X.font = F(28); var sw2 = X.measureText(scoreTxt).width, spx = sw2 > sbw - 12 ? 28 * (sbw - 12) / sw2 : 28;
      X.save(); X.globalAlpha = 1; comicOn(scoreTxt, x0 + 6 + sbw / 2, y0 + 40, spx, '#FFF9EE'); X.restore();
      // B / S / O
      var bx = x0 + sbw + 16, rowY = [y0 + 15, y0 + 31, y0 + 47];
      var cols = ['#6DBB4A', MUSTARD, BRICK], counts = [h.balls || 0, h.strikes || 0, h.outs || 0], maxes = [3, 2, h.outsMax > 5 ? 0 : (h.outsMax || 3) - 0];
      ['B', 'S', 'O'].forEach(function (lbl, i) {
        X.fillStyle = INK; X.font = F(13); X.textAlign = 'left'; X.fillText(lbl, bx, rowY[i] + 1);
        if (i === 2 && h.outsMax > 5) { X.font = F(14); X.fillStyle = BRICK; X.fillText((h.outs || 0) + '/' + h.outsMax, bx + 15, rowY[i] + 1); return; }
        var n = i === 2 ? Math.max(1, (h.outsMax || 3) - 1) : maxes[i];
        if (i === 2) n = Math.min(3, h.outsMax || 3) - (h.outsMax === 3 || !h.outsMax ? 1 : 0);
        if (i === 2 && (!h.outsMax || h.outsMax <= 3)) n = 2;
        for (var d = 0; d < (i === 2 ? n : maxes[i]); d++) {
          X.beginPath(); X.arc(bx + 22 + d * 15, rowY[i], 5.5, 0, PI * 2);
          X.fillStyle = d < counts[i] ? cols[i] : '#FFF9EE'; X.fill(); X.lineWidth = 2; X.strokeStyle = INK; X.stroke();
        }
      });
      // base diamond
      var dx = bx + 78, dcy = y0 + hh / 2 + 2, ds = 10;
      [[1, ds * 1.3, 0], [2, 0, -ds * 1.3], [3, -ds * 1.3, 0]].forEach(function (bb) {
        X.save(); X.translate(dx + 16 + bb[1], dcy + bb[2]); X.rotate(PI / 4);
        X.fillStyle = (h.bases || [])[bb[0] - 1] ? S.col.b : '#FFF9EE'; X.fillRect(-ds / 2, -ds / 2, ds, ds); X.lineWidth = 2; X.strokeStyle = INK; X.strokeRect(-ds / 2, -ds / 2, ds, ds);
        X.restore();
      });
      X.save(); X.translate(dx + 16, dcy + ds * 1.3); X.rotate(PI / 4); X.fillStyle = INK; X.fillRect(-3, -3, 6, 6); X.restore();
      // progress + goal
      var px0 = dx + 44, pw = x0 + w - px0 - 8;
      if (pw > 40) {
        X.textAlign = 'left'; X.fillStyle = INK;
        var prog = String(h.progress || ''); X.font = F(15); var pw2 = X.measureText(prog).width; if (pw2 > pw) X.font = F(15 * pw / pw2);
        X.fillText(prog, px0, y0 + 16);
        X.font = F(9.5, true, '600'); X.fillStyle = '#5A4E5E';
        wrap(String(h.goal || ''), px0, y0 + 30, pw, 10, 3);
      }
      // last pitch ribbon
      if (v.last && v.last.mph) {
        var lt = Math.round(v.last.mph) + ' MPH', ln = String(v.last.name || '').toUpperCase();
        X.font = F(14); var lw1 = X.measureText(lt).width; X.font = F(10, true, '700'); var lw2 = X.measureText(ln).width;
        var rw = lw1 + lw2 + 30, ry = y0 + hh + 10;
        card(x0 + 4, ry, rw, 24, MUSTARD, 8, 3);
        X.textAlign = 'left'; X.fillStyle = INK; X.font = F(14); X.fillText(lt, x0 + 13, ry + 13);
        X.font = F(10, true, '700'); X.fillText(ln, x0 + 21 + lw1, ry + 13);
      }
      if (v.onFire) {
        var fx = x0 + w - 92, fy = y0 + hh + 10;
        card(fx, fy, 88, 24, BRICK, 8, 3);
        X.textAlign = 'center'; comicOn('ON FIRE x' + (h.streak || 3), fx + 44, fy + 13, 13, MUSTARD, true);
      }
      X = save;
    }
    // flames licking the top of the card when on fire
    if (v.onFire) for (var i = 0; i < 9; i++) flame(x0 + 16 + i * (w - 30) / 8, top + 6, 14 + (i % 3) * 5, v.time || 0, i);
    X.drawImage(hc.canvas, 0, top - 4, S.W, 170);
  }
  function comicOn(str, cx, cy, px, fill, small) {
    X.font = F(px); X.textAlign = 'center'; X.textBaseline = 'middle';
    X.lineWidth = Math.max(2.5, px * (small ? 0.18 : 0.14)); X.strokeStyle = INK;
    if (!small) { X.fillStyle = INK; X.strokeText(str, cx + 1.5, cy + 2); X.fillText(str, cx + 1.5, cy + 2); }
    X.strokeText(str, cx, cy); X.fillStyle = fill; X.fillText(str, cx, cy);
  }
  function wrap(str, x, y, w, lh, maxL) {
    var words = str.split(' '), line = '', n = 0;
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (X.measureText(test).width > w && line) {
        if (n === maxL - 1) { X.fillText(line + '…', x, y + n * lh); return; }
        X.fillText(line, x, y + n * lh); n++; line = words[i];
      } else line = test;
    }
    if (line) X.fillText(line, x, y + n * lh);
  }

  // ---------------- stamps
  var MAP = { 'STRIKE!': 'STEE-RIKE!', 'STRIKE': 'STEE-RIKE!', 'CALLED STRIKE': 'STEE-RIKE!', 'WHIFF': 'WHIFF!', 'SWING & MISS': 'WHIFF!', 'FANNED': 'WHIFF!', 'STRUCK OUT': 'YER OUT!', 'SIT DOWN': 'YER OUT!', 'WHIFF! K': 'YER OUT!', 'STRIKE THREE': 'YER OUT!' };
  function drawStamp(v) {
    var st = v.stamp; if (!st || st.t > 2.2) return;
    var raw = String(st.text || '').toUpperCase().trim(), kind = st.kind || 'neutral', word = MAP[raw] || raw, sub = st.sub || '';
    if (MAP[raw] === 'YER OUT!' && raw !== 'YER OUT!') sub = sub || raw;
    if (kind === 'huge' && !word) word = 'KA-BLAM!';
    var t = st.t, inS = C.backOut(clamp(t / 0.28, 0, 1)), out = smooth((t - 1.55) / 0.35), sc = inS * (1 - out * 0.4), al = 1 - out;
    if (al <= 0) return;
    var cx = S.W / 2, cy = (v.scene === 'field' ? 0.44 : OLD ? 0.42 : 0.395) * S.H;   // new staging: clear of Rocco's cap
    X.save(); X.globalAlpha = al;
    if (kind === 'neutral') {
      // a calm ribbon for hints & neutral calls, lower on screen
      cy = v.scene === 'bat' && v.windup != null ? S.H * (OLD ? 0.8 : 0.88) : cy;   // new staging: below Rocco's cleats
      X.font = F(30); var tw = Math.min(S.W - 40, X.measureText(word).width + 40);
      X.save(); X.translate(cx, cy); X.scale(sc, sc); X.rotate(-0.03);
      card(-tw / 2, -26, tw, 50, S.col.a, 14, 5);
      comic(word, 0, 0, 30, '#FFF9EE', { shadow: false, maxW: tw - 24 });
      X.restore();
    } else {
      var col = kind === 'good' ? MUSTARD : kind === 'bad' ? BRICK : MUSTARD;
      X.save(); X.translate(cx, cy); X.scale(sc, sc);
      if (kind === 'huge' || kind === 'good') {
        burst(0, 0, kind === 'huge' ? 80 : 58, kind === 'huge' ? 150 : 106, 16, (v.time || 0) * 0.3, 21);
        X.fillStyle = kind === 'huge' ? BRICK : '#FFF9EE'; X.fill(); X.lineWidth = 4; X.strokeStyle = INK; X.stroke();
        if (kind === 'huge') { burst(0, 0, 54, 104, 16, (v.time || 0) * 0.3 + 0.1, 22); X.fillStyle = MUSTARD; X.fill(); }
      }
      if (kind === 'huge' && word !== 'KA-BLAM!') comic('KA-BLAM!', 0, -58, 30, '#FFF9EE', { rot: -0.06 });
      comic(word, 0, kind === 'huge' ? 6 : 0, kind === 'huge' ? 58 : 54, kind === 'huge' ? '#FFF9EE' : col, { rot: -0.07, maxW: S.W * 0.86, shine: true });
      X.restore();
    }
    if (sub) {
      var sy = cy + (kind === 'neutral' ? 44 : kind === 'huge' ? 92 : 58);
      X.font = F(15, true, '700'); var sw = Math.min(S.W - 30, X.measureText(sub).width + 26);
      X.save(); X.translate(cx, sy); X.scale(Math.min(1, sc), Math.min(1, sc));
      card(-sw / 2, -15, sw, 30, CREAM, 10, 3);
      X.fillStyle = INK; X.textAlign = 'center'; X.textBaseline = 'middle'; X.font = F(15, true, '700');
      var tw2 = X.measureText(sub).width; if (tw2 > sw - 20) X.font = F(15 * (sw - 20) / tw2, true, '700');
      X.fillText(sub, 0, 1);
      X.restore();
    }
    X.restore();
  }

  // ---------------- iris wipe
  function iris(cx, cy, r) {
    X.save(); X.beginPath(); X.rect(0, 0, S.W, S.H); X.arc(cx, cy, Math.max(0, r), 0, PI * 2, true);
    X.fillStyle = INK; X.fill('evenodd');
    X.beginPath(); X.arc(cx, cy, Math.max(0, r), 0, PI * 2); X.lineWidth = 6; X.strokeStyle = MUSTARD; X.stroke();
    X.restore();
  }
  function drawIris(v, st) {
    var full = Math.hypot(S.W, S.H);
    // closing on the ball after contact (bat scene), then opening on the field
    if (v.scene === 'bat' && st.ci && st.ci.hit && v.play) {
      var u = clamp((st.ci.tc - 0.08) / 0.12, 0, 1) * (1 - clamp((st.ci.tc - 0.34) / 0.2, 0, 1));
      if (u > 0) { var bp = st.ballPos, s = proj(bp.x, bp.y, bp.z, S.cam); iris(clamp(s.x, 40, S.W - 40), clamp(s.y, 60, S.H - 60), full * (1 - U.easeIn(u)) + 18 * u); }
      return;
    }
    var since = (v.time || 0) - S.sceneT0;
    if (since >= 0 && since < 0.45 && S.prevScene && S.prevScene !== v.scene) {
      var k = U.easeOut(since / 0.45), c = { x: S.W / 2, y: S.H / 2 };
      if (v.scene === 'field' && st.ballPos) { var b = proj(st.ballPos.x, st.ballPos.y, st.ballPos.z, S.cam); c = { x: clamp(b.x, 40, S.W - 40), y: clamp(b.y, 60, S.H - 60) }; }
      if (v.scene === 'bat' && S.rocco) { var hp = heroHead(st, 0), hs = proj(hp.x, hp.y, hp.z, S.cam); c = { x: hs.x, y: hs.y }; }
      iris(c.x, c.y, 18 + full * k);
    }
  }

  // ------------------------------------------------------------------ frame
  function frame(v) {
    if (!S.renderer) return;
    v = v || {};
    var now = performance.now();
    perf(now);
    if (!S.fontsOk && now - S.fontCheck > 500) { S.fontCheck = now; try { S.fontsOk = document.fonts && document.fonts.check('20px "Luckiest Guy"'); } catch (e) {} if (S.fontsOk) S.hud.key = ''; }
    var park = parkOf(v), set = ensurePark(park);
    ensureOpponents(v.pitcher || (BB.Content && BB.Content.PITCHERS && BB.Content.PITCHERS[0]));
    var scene = v.scene === 'bat' || v.scene === 'field' ? v.scene : 'title';
    if (scene !== S.lastScene) { S.prevScene = S.lastScene; S.lastScene = scene; S.sceneT0 = v.time || 0; }
    if (S.camTitle.view && scene !== 'title') S.camTitle.clearViewOffset();
    hideAll();
    S.bat.visible = true;
    var st = {}, P0 = performance.now(), prof = S.profile ? (S.prof = {}) : null;
    function mark(k) { if (prof) { var n = performance.now(); prof[k] = +(n - P0).toFixed(2); P0 = n; } }
    mark('pre');
    if (scene === 'bat') doBat(v, st); else if (scene === 'field') doField(v, st); else doTitle(v, st);
    // crowd excitement
    var ex = 0;
    if (v.play && (scene === 'field' || (st.ci && st.ci.hit))) ex = v.play.type === 'HR' ? 1 : (v.play.type === 'OUT' || v.play.type === 'FOUL') ? 0.1 : 0.65;
    if (v.onFire) ex = Math.max(ex, 0.35);
    mark('scene');
    set.update(S.cam, v.time || 0, ex, v.hud);
    mark('park');
    // bat glow when on fire
    var hot = !!v.onFire;
    if (S.bat.userData.hot !== hot) { S.bat.userData.hot = hot; S.bat.material = hot ? TN.toon('#F28C38') : TN.VC; }
    var t0 = performance.now();
    // BB.Ink (37-ink.js) draws the frame when active: hand-inked lines on layer-1 objects, paper grain, grade.
    if (BB.Ink && BB.Ink.active()) BB.Ink.render(S.renderer, S.scene, S.cam, { scene: scene, time: v.time || 0, hitstop: !!v.hitstop });
    else S.renderer.render(S.scene, S.cam);
    S.frameMs = performance.now() - t0;
    mark('render');
    // overlay
    oBegin();
    if (scene === 'bat') fxBat(v, st); else if (scene === 'field') fxField(v, st);
    mark('fx');
    if (scene !== 'title') drawHud(v);
    mark('hud');
    drawStamp(v);
    drawIris(v, st);
    mark('stamp');
    S.lastTime = v.time || 0;
  }

  function perf(now) {
    if (S.lastNow) {
      var dt = now - S.lastNow;
      if (dt > 0 && dt < 1000) { S.perf.push(dt); if (S.perf.length > 40) S.perf.shift(); }
      S.warm += dt;
    }
    S.lastNow = now;
    if (S.noAdapt || S.warm < 2500 || S.perf.length < 40) return;
    var a = S.perf.slice().sort(function (x, y) { return x - y; }), med = a[20];
    if (med > 22 && S.prCap > 1.25) {
      S.prCap = S.prCap > 1.5 ? 1.5 : 1.25;
      resize(S.W, S.H, S.dpr);
      S.perf = []; S.warm = 0;
    }
  }

  function stats() {
    var info = S.renderer ? S.renderer.info : null;
    return { calls: info ? info.render.calls : 0, triangles: info ? info.render.triangles : 0, pixelRatio: S.pr, lastBuildMs: S.lastBuildMs, renderMs: S.frameMs,
      textures: info ? info.memory.textures : 0, geometries: info ? info.memory.geometries : 0 };
  }

  BB.Render = {
    init: init, resize: resize, setInks: setInks, prepare: prepare, frame: frame,
    title: function (v) { v = Object.assign({}, v || {}, { scene: 'title' }); frame(v); },
    screenToPlate: screenToPlate, plateToScreen: plateToScreen, stats: stats, _S: S,
  };
})();
