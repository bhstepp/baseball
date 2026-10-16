// 36-rocco.js — BB.Rocco: the modelled hero (assets/rocco.glb, built by tools/blender/rocco.py; the asset contract is
// docs/PILOT-ROCCO.md). Owned by the integration agent.
// Parses the glb once at boot (async), turns it into a toon character (cel materials chosen by material name, team
// colours from the uniform scheme, ink hulls that deform with the skeleton and the face shapes, layer 1 for the ink
// pass), owns an AnimationMixer and maps game state to clips, shape keys and gaze. BB.Render (35-scene) places him and
// calls poseBat / poseHome / poseRun / poseTitle once per frame.
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
  var API = { ready: no, status: function () { return R.status; }, boot: function () {}, loadBuffer: function (b, cb) { if (cb) cb('unavailable'); }, R: R };
  if (!T || !T.GLTFLoader || !BB.Toon || !BB.U) { R.status = 'unavailable'; return API; }
  var TN = BB.Toon, U = BB.U, K = BB.K, PI = Math.PI;
  var clamp = U.clamp, lerp = U.lerp, smooth = U.smooth;

  // ------------------------------------------------------------------ contract tables
  var PALETTE = { fur: '#9A97A6', fur_light: '#F2EDE3', mask: '#2E2A38', nose: '#1B1420', eye_white: '#FFFFFF', pupil: '#1B1420', mouth: '#5A1F2A', tongue: '#E0605A',
    uniform: '#FFF6E6', team_a: '#2E5AAC', team_b: '#D9483B', belt: '#3B2F2A', sock: '#FFFFFF', shoe: '#1E1A22', sole: '#4A3F3A', lace: '#FFFFFF', glove: '#FFFFFF',
    bat_wood: '#D9A066', bat_tape: '#2E5AAC', decal_chest: '#2E5AAC', decal_back: '#2E5AAC' };
  var TEAM = { team_a: 'a', team_b: 'b', bat_tape: 'a' };            // recoloured from the uniform scheme
  var OW = { pupil: 0, tongue: 0, mouth: 0.4, nose: 0.6, eye_white: 0.55, lace: 0.45, sole: 0.9, glove: 0.95, decal_chest: 0, decal_back: 0 }; // hull weight (1 = full)
  var DECAL = { decal_chest: 1, decal_back: 1 };
  var INKW = { pupil: 0.55, eye_white: 0.7, nose: 0.8, mouth: 0.7, tongue: 0.6, lace: 0.6 };   // BB.Ink line weight per material
  var BAT = { bat_wood: 1, bat_tape: 1 };
  var CLIPS = ['stance', 'stride', 'power_load', 'coil_hold', 'swing_high', 'swing_mid', 'swing_low', 'whiff', 'dizzy', 'watch', 'bat_flip', 'run', 'trot', 'cheer', 'take', 'strike_react'];
  var BONES = ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'jaw', 'ear.L', 'ear.R', 'eye.L', 'eye.R', 'brow.L', 'brow.R', 'tail.1', 'tail.2', 'tail.3', 'tail.4', 'tail.5',
    'shoulder.L', 'shoulder.R', 'upper_arm.L', 'upper_arm.R', 'forearm.L', 'forearm.R', 'hand.L', 'hand.R', 'thigh.L', 'thigh.R', 'shin.L', 'shin.R', 'foot.L', 'foot.R',
    'toe.L', 'toe.R', 'bat', 'bat_sweet', 'bat_tip'];
  var SHAPES = ['blink', 'smile', 'grin', 'frown', 'mouth_open', 'brows_up', 'brows_angry', 'brows_sad', 'squint', 'cheeks_puff'];
  var CONTACT_T = 0.25;   // contract: the contact frame of every swing clip
  var HOT = '#F28C38';

  function warn(msg) { R.warnings.push(msg); }

  // ------------------------------------------------------------------ boot / load
  function wanted() {
    try { if (/[?&]rocco=(old|0|off|proc)(&|$)/.test(location.search)) return false; } catch (e) {}
    return !(typeof window !== 'undefined' && window.BB_ROCCO === 'old');
  }
  function boot(cb) {
    if (R.status !== 'idle') { if (cb) cb(R.status); return; }
    if (!wanted()) { R.status = 'off'; if (cb) cb(R.status); return; }
    var buf = null;
    try { buf = BB.assetBuffer && BB.assetBuffer('rocco'); } catch (e) { buf = null; }
    if (!buf) { R.status = 'missing'; if (cb) cb(R.status); return; }
    loadBuffer(buf, cb);
  }
  function loadBuffer(buf, cb) {
    R.status = 'loading'; R.error = null; R.warnings = [];
    var t0 = (typeof performance !== 'undefined') ? performance.now() : 0;
    function done() { if (cb) { try { cb(R.status); } catch (e) { console.warn(e); } } }
    try {
      new T.GLTFLoader().parse(buf, '', function (gltf) {
        try { build(gltf); R.status = 'ready'; R.loadMs = ((typeof performance !== 'undefined') ? performance.now() : 0) - t0; }
        catch (e) { fail(e); }
        done();
      }, function (e) { fail(e); done(); });
    } catch (e) { fail(e); done(); }
  }
  function fail(e) {
    R.status = 'failed'; R.error = String((e && e.message) || e);
    console.warn('BB.Rocco: keeping the procedural Rocco (' + R.error + ')');
  }

  // ------------------------------------------------------------------ materials & colours
  var _c1 = new T.Color(), _c2 = new T.Color();
  function near(a, b) { return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b)); }
  // the glb stores linear base colours (Blender converts its sRGB swatches); the game paints with sRGB hex values
  function baseHex(name, json, mat) {
    var def = null, f = null;
    if (json && json.materials) for (var i = 0; i < json.materials.length; i++) if (json.materials[i].name === name) { def = json.materials[i]; break; }
    if (def && def.pbrMetallicRoughness && def.pbrMetallicRoughness.baseColorFactor) f = def.pbrMetallicRoughness.baseColorFactor;
    var pal = PALETTE[name];
    if (!f) return pal || (mat && mat.color ? '#' + mat.color.getHexString() : '#CCCCCC');
    _c1.setRGB(f[0], f[1], f[2]).convertLinearToSRGB();
    if (!pal) return '#' + _c1.getHexString();
    _c2.set(pal);
    if (near(_c1, _c2) < 0.16) return '#' + _c1.getHexString();      // the modeller's tweak of the contract colour
    _c1.setRGB(f[0], f[1], f[2]);
    if (near(_c1, _c2) < 0.16) { warn('material ' + name + ' stores sRGB values in a linear slot'); return '#' + _c1.getHexString(); }
    warn('material ' + name + ' colour is far from the contract (' + pal + '); using the contract colour');
    return pal;
  }

  // ------------------------------------------------------------------ ink hull that deforms with skin + morphs
  var HU = { uRes: TN.OU.uRes, uWorld: TN.OU.uWorld, uMin: TN.OU.uMin, uMax: TN.OU.uMax, uColor: TN.OU.uColor, uScale: { value: 1.12 } };
  var HULL = new T.ShaderMaterial({
    uniforms: HU, side: T.BackSide,
    vertexShader: [
      '#include <common>',
      '#include <morphtarget_pars_vertex>',
      '#include <skinning_pars_vertex>',
      'attribute vec3 onormal; attribute float ow;',
      'uniform vec2 uRes; uniform float uWorld; uniform float uMin; uniform float uMax; uniform float uScale;',
      'void main() {',
      '  vec3 objectNormal = onormal;',
      '  #include <morphnormal_vertex>',
      '  #include <skinbase_vertex>',
      '  #include <skinnormal_vertex>',
      '  #include <begin_vertex>',
      '  #include <morphtarget_vertex>',
      '  #include <skinning_vertex>',
      '  vec4 clip = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);',
      '  vec3 n = normalize(normalMatrix * objectNormal);',
      '  vec2 d = (projectionMatrix * vec4(n, 0.0)).xy * uRes;',
      '  float L = length(d); d = L > 1e-6 ? d / L : vec2(0.0);',
      '  float f = projectionMatrix[1][1] * uRes.y * 0.5;',
      '  float px = clamp(uWorld * f / max(clip.w, 0.05), uMin, uMax) * uScale;',
      '  px *= ow * (0.84 + 0.28 * sin(position.x * 5.3 + position.y * 3.9 + position.z * 4.7));',
      '  clip.xy += d * px * 2.0 / uRes * clip.w;',
      '  gl_Position = clip;',
      '}'].join('\n'),
    fragmentShader: 'uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, 1.0); }',
  });
  HULL.userData.rocco = true; HULL.userData.inkHull = true;   // BB.Ink keeps hulls out of its normals pass and hides them under its lines

  // ------------------------------------------------------------------ geometry helpers
  // smooth hull normals, welded by position across all primitives of one glTF mesh (same bind space), so creases,
  // seams and material borders never crack the ink line
  function weldGroup(list) {
    var acc = {}, keys = [], a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), e2 = new T.Vector3();
    function q(x) { return Math.round(x * 1500); }
    list.forEach(function (m) {
      var g = m.geometry, P = g.attributes.position, n = P.count, I = g.index, key = new Array(n), i;
      for (i = 0; i < n; i++) key[i] = q(P.getX(i)) + ',' + q(P.getY(i)) + ',' + q(P.getZ(i));
      keys.push(key);
      var cnt = I ? I.count : n;
      for (i = 0; i + 2 < cnt; i += 3) {
        var ia = I ? I.getX(i) : i, ib = I ? I.getX(i + 1) : i + 1, ic = I ? I.getX(i + 2) : i + 2;
        a.fromBufferAttribute(P, ia); b.fromBufferAttribute(P, ib); c.fromBufferAttribute(P, ic);
        b.sub(a); e2.subVectors(c, a); b.cross(e2);                  // area-weighted face normal
        [ia, ib, ic].forEach(function (v) { var s = acc[key[v]] || (acc[key[v]] = [0, 0, 0]); s[0] += b.x; s[1] += b.y; s[2] += b.z; });
      }
    });
    list.forEach(function (m, gi) {
      var key = keys[gi], n = key.length, out = new Float32Array(n * 3);
      for (var i = 0; i < n; i++) {
        var s = acc[key[i]] || [0, 1, 0], l = Math.hypot(s[0], s[1], s[2]) || 1;
        out[3 * i] = s[0] / l; out[3 * i + 1] = s[1] / l; out[3 * i + 2] = s[2] / l;
      }
      m.geometry.setAttribute('onormal', new T.BufferAttribute(out, 3));
    });
  }
  function constAttr(g, name, v) { var a = new Float32Array(g.attributes.position.count); a.fill(v); g.setAttribute(name, new T.BufferAttribute(a, 1)); }
  function makeHull(src, scale) {
    var h = src.isSkinnedMesh ? new T.SkinnedMesh(src.geometry, HULL) : new T.Mesh(src.geometry, HULL);
    if (src.isSkinnedMesh) { h.bind(src.skeleton, src.bindMatrix); h.bindMode = src.bindMode; }
    if (src.morphTargetInfluences) { h.morphTargetInfluences = src.morphTargetInfluences; h.morphTargetDictionary = src.morphTargetDictionary; }
    h.renderOrder = 1; h.frustumCulled = false; h.userData.isOutline = true; h.name = src.name + '_ink';
    src.add(h); src.userData.outline = h;
    return h;
  }

  // ------------------------------------------------------------------ build the character from the parsed glTF
  function build(gltf) {
    var model = gltf.scene || (gltf.scenes && gltf.scenes[0]);
    if (!model) throw new Error('no scene in rocco.glb');
    var json = gltf.parser && gltf.parser.json;
    model.updateMatrixWorld(true);
    // bones by contract name (GLTFLoader sanitises node names: 'eye.L' -> 'eyeL'; the original is in userData.name)
    var bones = {}, byName = {};
    model.traverse(function (o) { byName[o.name] = o; if (o.isBone || o.type === 'Object3D' || o.isGroup) { var nm = (o.userData && o.userData.name) || o.name; if (!bones[nm]) bones[nm] = o; } });
    var missingBones = BONES.filter(function (b) { return !bones[b]; });
    if (missingBones.length) warn('missing bones: ' + missingBones.join(', '));
    ['root', 'head', 'bat'].forEach(function (b) { if (!bones[b]) throw new Error('rocco.glb has no "' + b + '" bone'); });
    // materials -> one shared cel material per material name; primitives stay separate meshes so the ink pass sees
    // every paint region as its own object (BB.Ink draws lines where object ids change; same material = same id)
    var meshes = [];
    model.traverse(function (o) { if (o.isMesh) meshes.push(o); });
    if (!meshes.length) throw new Error('rocco.glb has no meshes');
    var colors = {};
    meshes.forEach(function (m) {
      var mat = Array.isArray(m.material) ? m.material[0] : m.material, nm = (mat && mat.name) || 'unnamed';
      if (!(nm in colors)) { colors[nm] = baseHex(nm, json, mat); if (!PALETTE[nm]) warn('unexpected material ' + nm); }
      if (mat && mat.dispose) mat.dispose();
      m.userData.mname = nm;
    });
    R.colors = colors; R.base = Object.assign({}, colors); R.mats = {};
    var groups = {};
    meshes.forEach(function (m) { var key = (m.parent ? m.parent.uuid : '-') + '|' + (m.skeleton ? m.skeleton.uuid : '-'); (groups[key] = groups[key] || []).push(m); });
    Object.keys(groups).forEach(function (k) { weldGroup(groups[k]); });
    var names = Object.keys(colors).sort();
    meshes.forEach(function (m) {
      var nm = m.userData.mname, decal = !!DECAL[nm], w = OW[nm] != null ? OW[nm] : 1;
      m.material = matFor(nm);
      constAttr(m.geometry, 'ow', w);
      if (w > 0 && !decal) makeHull(m);
      m.frustumCulled = false;
      m.castShadow = m.receiveShadow = false;
      if (!decal) m.layers.enable(1);
      m.userData.inkId = 7000 + names.indexOf(nm);
      if (INKW[nm] != null) m.userData.inkWeight = INKW[nm];
      m.userData.kind = BAT[nm] ? 'bat' : decal ? 'decal' : 'body';
    });
    R.meshes = meshes;
    R.bat = meshes.filter(function (m) { return m.userData.kind === 'bat'; });
    if (!R.bat.length) warn('no bat_wood / bat_tape meshes');
    if (BB.Ink && BB.Ink.registerHull) BB.Ink.registerHull(HULL);
    paintAll();
    // face shapes
    R.face = meshes.filter(function (m) { return m.morphTargetDictionary && m.morphTargetInfluences; });
    var haveShapes = {};
    R.face.forEach(function (m) { for (var k in m.morphTargetDictionary) haveShapes[k] = true; });
    var missingShapes = SHAPES.filter(function (s) { return !haveShapes[s]; });
    if (missingShapes.length) warn('missing shape keys: ' + missingShapes.join(', '));
    // clips: drop tracks that would bind to nothing (PropertyBinding would fall back to the root or log errors)
    var nodeNames = {};
    model.traverse(function (o) { nodeNames[o.name] = true; });
    R.clips = {}; R.actions = {}; R.mixer = new T.AnimationMixer(model);
    (gltf.animations || []).forEach(function (clip) {
      var seen = {}, tracks = [];
      clip.tracks.forEach(function (tr) {
        var pp = T.PropertyBinding.parseTrackName(tr.name), node = pp.nodeName;
        if (!nodeNames[node] || seen[tr.name]) { R.dropped = (R.dropped || 0) + 1; return; }
        seen[tr.name] = true; tracks.push(tr);
      });
      clip.tracks = tracks;
      R.clips[clip.name] = clip;
      var a = R.mixer.clipAction(clip);
      a.setLoop(T.LoopRepeat, Infinity); a.play(); a.setEffectiveWeight(0);
      R.actions[clip.name] = a;
    });
    var missingClips = CLIPS.filter(function (c) { return !R.clips[c]; });
    if (missingClips.length) warn('missing clips: ' + missingClips.join(', '));
    if (!R.clips.stance || !(R.clips.swing_mid || R.clips.swing_high || R.clips.swing_low)) throw new Error('rocco.glb needs at least "stance" and one swing clip');
    // world wrapper: Y-up model -> Z-up world, like BB.Cast's "up" group
    R.model = model;
    R.up = new T.Group(); R.up.rotation.x = PI / 2; R.up.add(model);
    R.root = new T.Group(); R.root.name = 'rocco_glb'; R.root.add(R.up);
    var sh = new T.Mesh(SHADOW_G, SHADOW_M); sh.renderOrder = -1; sh.scale.set(1.25, 1.0, 1); R.root.add(sh); R.shadow = sh;
    R.bones = bones; R.byName = byName;
    R.allBones = []; model.traverse(function (o) { if (o.isBone) R.allBones.push(o); });
    R.saved = R.allBones.map(function () { return { p: new T.Vector3(), q: new T.Quaternion(), s: new T.Vector3(1, 1, 1) }; });
    R.final = R.allBones.map(function () { return { p: new T.Vector3(), q: new T.Quaternion(), s: new T.Vector3(1, 1, 1) }; });
    R.fadeFrom = R.allBones.map(function () { return { p: new T.Vector3(), q: new T.Quaternion(), s: new T.Vector3(1, 1, 1) }; });
    R.allBones.forEach(function (b, i) { R.saved[i].p.copy(b.position); R.saved[i].q.copy(b.quaternion); R.saved[i].s.copy(b.scale); });
    R.restQ = {}; ['eye.L', 'eye.R', 'chest', 'bat'].forEach(function (b) { if (bones[b]) R.restQ[b] = bones[b].quaternion.clone(); });
    R.morphSaved = R.face.map(function (m) { return m.morphTargetInfluences.slice(); });
    R.batProp = makeBatProp();
    R.size = 1; R.yaw = 0;
    measure();
  }
  var SHADOW_G = new T.CircleGeometry(1, 20);
  var SHADOW_M = new T.MeshBasicMaterial({ color: 0x1B1420, transparent: true, opacity: 0.22, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -12, polygonOffsetUnits: -40 });

  // ------------------------------------------------------------------ colours
  function matFor(name) {
    if (R.mats[name]) return R.mats[name];
    var o = { color: new T.Color(R.colors[name] || '#CCCCCC'), gradientMap: TN.GRAD };
    if (DECAL[name]) Object.assign(o, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8, transparent: true, depthWrite: false, side: T.DoubleSide });
    if (name === 'eye_white') o.emissive = new T.Color('#3A3A3A');          // whites stay white on the shaded side
    var m = new T.MeshToonMaterial(o); m.name = 'rocco_' + name;
    R.mats[name] = m;
    return m;
  }
  function paintAll() {
    for (var name in R.mats) {
      var hex = R.colors[name] || '#CCCCCC';
      if (name === 'bat_wood' && R.hot) hex = HOT;
      R.mats[name].color.set(hex);
      if (name === 'bat_wood' && R.mats[name].emissive) R.mats[name].emissive.set(R.hot ? '#6A2200' : '#000000');
    }
  }
  function setColors(c) {
    if (!c) return;
    R.team = c;
    if (R.status !== 'ready') return;
    for (var name in TEAM) if (name in R.base) R.colors[name] = c[TEAM[name]] || R.base[name];
    paintAll();
  }
  function setHot(on) {
    on = !!on;
    if (R.hot === on || R.status !== 'ready') return;
    R.hot = on; paintAll();
  }

  // a static copy of the bat in bat-bone space (it lies in the dirt while Rocco runs the bases)
  function makeBatProp() {
    if (!R.bat.length || !R.bones.bat) return null;
    var grp = new T.Group(); grp.name = 'rocco_bat_prop';
    R.bat.forEach(function (src) {
      var g = src.geometry.clone(), bi = -1, M = new T.Matrix4();
      if (src.isSkinnedMesh) bi = src.skeleton.bones.indexOf(R.bones.bat);
      if (bi >= 0) M.multiplyMatrices(src.skeleton.boneInverses[bi], src.bindMatrix);
      else { src.updateWorldMatrix(true, false); R.bones.bat.updateWorldMatrix(true, false); M.copy(R.bones.bat.matrixWorld).invert().multiply(src.matrixWorld); }
      ['skinIndex', 'skinWeight'].forEach(function (a) { if (g.attributes[a]) g.deleteAttribute(a); });
      g.morphAttributes = {};
      g.applyMatrix4(M);
      var on = g.attributes.onormal;
      if (on) { var nm = new T.Matrix3().getNormalMatrix(M), v = new T.Vector3(); for (var i = 0; i < on.count; i++) { v.fromBufferAttribute(on, i).applyMatrix3(nm).normalize(); on.setXYZ(i, v.x, v.y, v.z); } }
      var m = new T.Mesh(g, src.material);
      m.frustumCulled = false; m.layers.enable(1); m.userData.inkId = src.userData.inkId;
      var h = new T.Mesh(g, TN.OUTLINE); h.renderOrder = 1; h.userData.isOutline = true; m.add(h); m.userData.outline = h;
      grp.add(m);
    });
    // its axis: bat bone -> bat_tip, in bat space
    grp.userData.len = 2.8; grp.userData.axis = new T.Vector3(0, 1, 0);
    if (R.bones.bat_tip && R.bones.bat_tip.parent === R.bones.bat) { grp.userData.axis.copy(R.bones.bat_tip.position).normalize(); grp.userData.len = R.bones.bat_tip.position.length(); }
    grp.visible = false;
    return grp;
  }

  // ------------------------------------------------------------------ evaluating poses
  function has(c) { return !!R.clips[c]; }
  function dur(c) { return R.clips[c] ? R.clips[c].duration : 1; }
  function first() { for (var i = 0; i < arguments.length; i++) if (has(arguments[i])) return arguments[i]; return 'stance'; }
  function twos(t) { return (BB.Ink && BB.Ink.twos) ? BB.Ink.twos(t) : t; }
  // an event-relative time held on twos in step with the global 12 fps grid
  function onTwos(rel, t) { return Math.max(0, rel - (t - twos(t))); }
  function restore() {
    for (var i = 0; i < R.allBones.length; i++) { var b = R.allBones[i], s = R.saved[i]; b.position.copy(s.p); b.quaternion.copy(s.q); b.scale.copy(s.s); }
    R.face.forEach(function (m, j) { var a = m.morphTargetInfluences, s = R.morphSaved[j]; for (var k = 0; k < a.length; k++) a[k] = s[k]; });
  }
  function save() {
    for (var i = 0; i < R.allBones.length; i++) { var b = R.allBones[i], s = R.saved[i]; s.p.copy(b.position); s.q.copy(b.quaternion); s.s.copy(b.scale); }
    R.face.forEach(function (m, j) { var a = m.morphTargetInfluences, s = R.morphSaved[j]; for (var k = 0; k < a.length; k++) s[k] = a[k]; });
  }
  // layers: [{c: clip, t: seconds, w: weight}] -> bones (the mixer only writes values that changed since its last
  // update, so everything we touch afterwards is put back first)
  function evaluate(layers) {
    restore();
    var acts = R.actions, w = {}, tm = {}, tot = 0, i, l;
    for (i = 0; i < layers.length; i++) {
      l = layers[i];
      if (!acts[l.c] || !(l.w > 1e-4)) continue;
      if (w[l.c] == null || l.w > w[l.c]) { tm[l.c] = l.t; }
      w[l.c] = (w[l.c] || 0) + l.w; tot += l.w;
    }
    if (tot <= 0) { w = { stance: 1 }; tm = { stance: 0 }; tot = 1; }
    for (var n in acts) {
      var a = acts[n];
      if (w[n]) { a.enabled = true; a.time = clamp(tm[n], 0, a.getClip().duration); a.setEffectiveWeight(w[n] / tot); }
      else { a.setEffectiveWeight(0); a.enabled = false; }
    }
    R.mixer.update(0);
    save();
  }
  function looped(c, t) { var d = dur(c); return ((t % d) + d) % d; }
  function mixL(a, b, k) { // blend two layer lists
    if (k <= 0) return a; if (k >= 1) return b;
    var o = [], i;
    for (i = 0; i < a.length; i++) o.push({ c: a[i].c, t: a[i].t, w: a[i].w * (1 - k) });
    for (i = 0; i < b.length; i++) o.push({ c: b[i].c, t: b[i].t, w: b[i].w * k });
    return o;
  }
  function L(c, t, w) { return { c: c, t: t, w: w == null ? 1 : w }; }

  // ------------------------------------------------------------------ measurements made once after loading
  var V = new T.Vector3(), V2 = new T.Vector3(), V3 = new T.Vector3(), Q = new T.Quaternion(), Q2 = new T.Quaternion(), M4 = new T.Matrix4();
  function modelPoint(b, out) { // bone position in model space (glTF, unscaled)
    b.updateWorldMatrix(true, false);
    out.setFromMatrixPosition(b.matrixWorld);
    M4.copy(R.model.matrixWorld).invert(); out.applyMatrix4(M4);
    return out;
  }
  function measure() {
    var B = R.bones, info = { swings: {} };
    R.model.updateMatrixWorld(true);
    ['swing_high', 'swing_mid', 'swing_low'].forEach(function (c) {
      if (!has(c)) return;
      evaluate([L(c, CONTACT_T)]); R.model.updateMatrixWorld(true);
      var sweet = B.bat_sweet ? modelPoint(B.bat_sweet, new T.Vector3()) : null, tip = B.bat_tip ? modelPoint(B.bat_tip, new T.Vector3()) : null, grip = modelPoint(B.bat, new T.Vector3());
      info.swings[c] = { sweet: sweet || tip || grip, tip: tip, grip: grip };
    });
    if (!B.bat_sweet) warn('no bat_sweet bone: aiming with ' + (B.bat_tip ? 'bat_tip' : 'the bat bone'));
    // stance: height, feet, head
    evaluate([L('stance', 0)]); R.model.updateMatrixWorld(true);
    var box = new T.Box3();
    R.meshes.forEach(function (m) { if (m.userData.kind === 'body') box.expandByObject(m); });
    info.stanceBox = box;
    info.head = modelPoint(B.head, new T.Vector3());
    info.feet = [B['foot.L'], B['foot.R']].filter(Boolean).map(function (b) { return modelPoint(b, new T.Vector3()); });
    // rest height (bind pose of the skinned body), for the report
    var hb = new T.Box3();
    R.meshes.forEach(function (m) { if (m.userData.kind === 'body') { m.geometry.computeBoundingBox(); hb.union(m.geometry.boundingBox); } });
    info.restBox = hb;
    // head centre and crown in head-bone space, from the vertices skinned (mostly) to the head
    var sum = new T.Vector3(), cnt = 0, top = null;
    R.meshes.forEach(function (m) {
      if (!m.isSkinnedMesh || m.userData.kind !== 'body') return;
      var bi = m.skeleton.bones.indexOf(B.head); if (bi < 0) return;
      var P = m.geometry.attributes.position, SI = m.geometry.attributes.skinIndex, SW = m.geometry.attributes.skinWeight;
      var toBone = new T.Matrix4().multiplyMatrices(m.skeleton.boneInverses[bi], m.bindMatrix);
      for (var i = 0; i < P.count; i++) {
        var w = (SI.getX(i) === bi ? SW.getX(i) : 0) + (SI.getY(i) === bi ? SW.getY(i) : 0) + (SI.getZ(i) === bi ? SW.getZ(i) : 0) + (SI.getW(i) === bi ? SW.getW(i) : 0);
        if (w < 0.6) continue;
        V.fromBufferAttribute(P, i).applyMatrix4(toBone);
        sum.add(V); cnt++;
      }
    });
    R.headLocal = cnt ? sum.multiplyScalar(1 / cnt) : new T.Vector3(0, 0.6, 0);
    R.info = info;
    evaluate([L('stance', 0)]);
  }

  // where to put the root so the contact frame of the middle swing meets a point in the world (yaw = PI/2: model
  // +Z -> world +x, model +X -> world +y, model +Y -> world +z)
  function solvePlacement(target, size) {
    var sw = R.info.swings.swing_mid || R.info.swings.swing_high || R.info.swings.swing_low, s = sweetOf(sw);
    return { x: target.x - size * s.z, y: target.y - size * s.x, z: 0, size: size, sweet: s.clone() };
  }
  function sweetOf(sw) { return sw.sweet; }
  // a sensible scale: the middle swing meets the middle of the zone (clamped so he stays roughly 5-6 ft tall)
  function autoSize() {
    var sw = R.info.swings.swing_mid; if (!sw) return 1;
    var mid = (K.ZONE.zMin + K.ZONE.zMax) / 2;
    return clamp(mid / Math.max(0.5, sw.sweet.y), 0.92, 1.3);
  }

  // ------------------------------------------------------------------ placement in the world
  function place(x, y, z, yaw, size) {
    if (!R.root) return;
    R.root.position.set(x, y, z || 0); R.root.rotation.set(0, 0, yaw || 0);
    if (size != null && size !== R.size) { R.size = size; R.up.scale.setScalar(size); }
    R.yaw = yaw || 0;
    R.root.visible = true;
    R.root.updateMatrixWorld(true);
  }
  function headPoint(out) {
    out = out || new T.Vector3();
    var b = R.bones.head; b.updateWorldMatrix(true, false);
    return out.copy(R.headLocal).applyMatrix4(b.matrixWorld);
  }
  function worldOf(name, out) {
    var b = R.bones[name]; out = out || new T.Vector3();
    if (!b) return out.copy(R.root.position);
    b.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(b.matrixWorld);
  }

  // ------------------------------------------------------------------ faces & gaze
  function blinkAt(t, seed) { var p = (t + seed * 1.7) % 3.7; return p < 0.13 ? Math.sin(p / 0.13 * PI) : 0; }
  var FACE0 = {};
  SHAPES.forEach(function (s) { FACE0[s] = 0; });
  function applyFace(face) {
    R.face.forEach(function (m) {
      var d = m.morphTargetDictionary, a = m.morphTargetInfluences;
      for (var s in face) { var i = d[s]; if (i != null) a[i] = clamp(Math.max(a[i], face[s] || 0), 0, 1); }
    });
  }
  // turn both eyes toward a world point (limited, so they never roll back into the head)
  var _eyeDir = new T.Vector3(), _want = new T.Vector3(), _pq = new T.Quaternion(), _wq = new T.Quaternion(), _fwd = new T.Vector3();
  function gaze(target, k) {
    if (!target || !(k > 0)) return;
    ['eye.L', 'eye.R'].forEach(function (n) {
      var b = R.bones[n]; if (!b) return;
      b.updateWorldMatrix(true, false);
      // the eye's look direction now: model +Z carried by the head bone (eyes look straight ahead at rest)
      var head = R.bones.head; head.updateWorldMatrix(true, false);
      head.getWorldQuaternion(_wq);
      _fwd.set(0, 0, 1).applyQuaternion(R.headRestInv || (R.headRestInv = headRestInv())).applyQuaternion(_wq);
      V.setFromMatrixPosition(b.matrixWorld);
      _want.set(target.x, target.y, target.z).sub(V).normalize();
      var ang = Math.acos(clamp(_fwd.dot(_want), -1, 1)), lim = 0.42;
      if (ang < 1e-4) return;
      Q.setFromUnitVectors(_fwd, _want);
      if (ang > lim) Q.slerp(Q2.identity(), 1 - lim / ang);
      Q2.identity().slerp(Q, k);                                   // world-space delta
      b.parent.getWorldQuaternion(_pq);
      // local' = P^-1 * delta * P * local
      Q.copy(_pq).invert().multiply(Q2).multiply(_pq);
      b.quaternion.premultiply(Q);
    });
  }
  function headRestInv() { // inverse of the head bone's bind-pose world rotation (relative to the model)
    var q = new T.Quaternion(), sk = null, head = R.bones.head;
    R.meshes.some(function (m) { if (m.isSkinnedMesh) { sk = m.skeleton; return true; } return false; });
    if (sk) { var i = sk.bones.indexOf(head); if (i >= 0) { var m = sk.boneInverses[i].clone().invert(); var p = new T.Vector3(), s = new T.Vector3(); m.decompose(p, q, s); } }
    return q.invert();
  }

  // aim correction: rotate the chest so the barrel at the contact frame meets the ball (computed once per swing)
  function aimFor(layersAtContact, target) {
    var key = layersAtContact.map(function (l) { return l.c + l.w.toFixed(3); }).join() + [target.x, target.y, target.z].map(function (x) { return x.toFixed(3); }).join() + R.root.position.toArray().join() + R.size;
    if (R.aimKey === key) return R.aimQ;
    evaluate(layersAtContact);
    R.root.updateMatrixWorld(true);
    var chest = R.bones.chest || R.bones.spine || R.bones.hips, tipB = R.bones.bat_sweet || R.bones.bat_tip || R.bones.bat;
    var C = worldOf(chest === R.bones.chest ? 'chest' : chest === R.bones.spine ? 'spine' : 'hips', new T.Vector3()), S = new T.Vector3().setFromMatrixPosition(tipB.matrixWorld);
    var a = S.clone().sub(C), b = new T.Vector3(target.x, target.y, target.z).sub(C);
    var q = new T.Quaternion().setFromUnitVectors(a.clone().normalize(), b.clone().normalize());
    var ang = 2 * Math.acos(clamp(q.w, -1, 1)), lim = 0.36;
    q.slerp(new T.Quaternion(), 1 - Math.min(1, lim / Math.max(ang, 1e-6)) * 0.9);   // ~90% of the way, at most ~20 degrees
    R.aimKey = key; R.aimQ = q; R.aimErr = a.length() && S.distanceTo(new T.Vector3(target.x, target.y, target.z));
    return q;
  }
  function applyAim(q, k) {
    if (!q || !(k > 0)) return;
    var b = R.bones.chest || R.bones.spine; if (!b) return;
    Q2.identity().slerp(q, k);
    b.parent.getWorldQuaternion(_pq);
    Q.copy(_pq).invert().multiply(Q2).multiply(_pq);
    b.quaternion.premultiply(Q);
  }

  // ------------------------------------------------------------------ the frame driver
  // finish(): post effects, snapshot crossfade on discontinuities, matrices
  var mem = { key: '', time: -1, frozen: null };
  function finish(spec, time) {
    evaluate(spec.layers);
    R.root.updateMatrixWorld(true);
    if (spec.aim) applyAim(spec.aim.q, spec.aim.k);
    if (spec.gaze) { R.root.updateMatrixWorld(true); gaze(spec.gaze, spec.gazeK == null ? 1 : spec.gazeK); }
    if (spec.hideBat) R.bat.forEach(function (m) { m.visible = false; }); else R.bat.forEach(function (m) { m.visible = true; });
    if (spec.capBack && R.bones.cap) R.bones.cap.rotateY(PI);
    applyFace(spec.face || FACE0);
    // crossfade over discontinuities between consecutive frames
    var dt = time - mem.time, i;
    if (spec.key !== mem.key && mem.time >= 0 && dt >= 0 && dt < 0.25 && (spec.fade || 0) > 0) {
      for (i = 0; i < R.allBones.length; i++) { R.fadeFrom[i].p.copy(R.final[i].p); R.fadeFrom[i].q.copy(R.final[i].q); R.fadeFrom[i].s.copy(R.final[i].s); }
      mem.fadeT0 = time; mem.fadeDur = spec.fade;
    } else if (spec.key !== mem.key) mem.fadeT0 = null;
    if (mem.fadeT0 != null) {
      var k = smooth((time - mem.fadeT0) / mem.fadeDur);
      if (k >= 1 || time < mem.fadeT0) mem.fadeT0 = null;
      else for (i = 0; i < R.allBones.length; i++) {
        var b = R.allBones[i], f = R.fadeFrom[i];
        b.position.lerpVectors(f.p, b.position, k); b.quaternion.slerpQuaternions(f.q, b.quaternion.clone(), k); b.scale.lerpVectors(f.s, b.scale, k);
      }
    }
    for (i = 0; i < R.allBones.length; i++) { var bb = R.allBones[i]; R.final[i].p.copy(bb.position); R.final[i].q.copy(bb.quaternion); R.final[i].s.copy(bb.scale); }
    mem.key = spec.key; mem.time = time;
    R.root.updateMatrixWorld(true);
    R.last = spec;
  }
  // once main stops advancing pitchT ('between' after a resolved pitch) keep the reaction playing on the clock
  function frozenExtra(v, resolved) {
    var t = v.time || 0, f = mem.frozen, sig = (v.pitch ? v.pitch.id + ':' + v.pitch.T : '') + '|' + v.pitchT + '|' + (v.swing ? v.swing.t : '');
    if (!f || f.sig !== sig || !resolved || v.hitstop || t - f.last > 0.1 || t < f.last) { mem.frozen = { sig: sig, t0: t, last: t }; return 0; }
    f.last = t;
    return Math.min(4, t - f.t0);
  }

  // swing clip selection: blend high / mid / low so the barrel height follows the pitch height
  function swingBlend(z) {
    var S = R.info.swings, cand = [];
    ['swing_low', 'swing_mid', 'swing_high'].forEach(function (c) { if (S[c]) cand.push({ c: c, h: S[c].sweet.y * R.size }); });
    cand.sort(function (a, b) { return a.h - b.h; });
    if (cand.length === 1 || z <= cand[0].h) return [L(cand[0].c, 0, 1)];
    for (var i = 1; i < cand.length; i++) {
      if (z <= cand[i].h) { var k = (z - cand[i - 1].h) / Math.max(1e-3, cand[i].h - cand[i - 1].h); return [L(cand[i - 1].c, 0, 1 - k), L(cand[i].c, 0, k)]; }
    }
    return [L(cand[cand.length - 1].c, 0, 1)];
  }
  function atTime(layers, t) { return layers.map(function (l) { return { c: l.c, t: t, w: l.w }; }); }
  // game swing time -> clip time: the first 0.25 s of the clip squeezed into the real swing up to contact
  function warp(st, tcs) { return st < tcs ? CONTACT_T * (st / tcs) : CONTACT_T + (st - tcs); }
  function stanceL(t) { return [L('stance', looped('stance', twos(t)))]; }

  // ---- bat scene. o = { ci: contact info from BB.Render, ball: world point for the gaze, contactPt: world point the
  // barrel should meet, pitcherHead: world point, latency }
  function poseBat(v, o) {
    o = o || {};
    var t = v.time || 0, p = v.pitch, sw = v.swing, ci = o.ci, load = v.loading != null ? v.loading : 0;
    var resolved = !!(p && v.pitchT != null && (v.pitchT > p.T + 0.12 || (ci && ci.hit)));
    var extra = frozenExtra(v, resolved && !(ci && ci.hit));
    var pt = (p && v.pitchT != null) ? v.pitchT + extra : null;
    var face = { blink: blinkAt(t, 1), smile: 0.4, brows_angry: 0.25 }, gz = o.pitcherHead || null, gk = 0.8;
    var spec = { key: 'idle', fade: 0.14, layers: null, face: face, capBack: !!v.onFire };
    // power load / coil (held tap)
    var base;
    if (load > 0) {
      var lt = load * 0.35;
      var coil = load >= 1 ? [L(first('coil_hold', 'power_load'), has('coil_hold') ? looped('coil_hold', t) : dur('power_load'))] : [L(first('power_load', 'stance'), lt * dur(first('power_load', 'stance')) / 0.35)];
      base = load >= 1 ? coil : mixL(stanceL(t), coil, smooth(lt / 0.08));
      face.brows_angry = 0.3 + 0.7 * smooth(load); face.squint = 0.55 * load; face.cheeks_puff = 0.55 * smooth((load - 0.3) / 0.7); face.smile = 0; face.blink = 0;
      spec.key = 'load';
    } else if (pt != null) {
      var s1 = first('stride', 'stance');
      base = mixL(stanceL(t), [L(s1, s1 === 'stride' ? Math.min(pt, dur('stride')) : looped('stance', twos(t)))], smooth(pt / 0.06));
      spec.key = 'pitch'; spec.fade = 0.06;
    } else base = stanceL(t);
    if (p && pt != null && o.ball) { gz = o.ball; gk = 1; }
    if (!sw) {
      spec.layers = base;
      if (p && pt != null && pt > p.T + 0.02) {          // the pitch went by: take it (and argue a called strike three)
        var tk = onTwos(pt - p.T - 0.02, t), calledK = p.strike && v.stamp && v.stamp.kind === 'bad';
        var take = has('take') ? [L('take', Math.min(tk, dur('take')))] : stanceL(t);
        spec.layers = mixL(base, take, smooth(tk / 0.1));
        face.brows_up = 0.4 * smooth(tk / 0.2); face.smile = 0.2;
        if (calledK) {
          var kt = onTwos(pt - p.T - 0.2, t);
          if (kt > 0) {
            var sr = has('strike_react') ? [L('strike_react', Math.min(kt, dur('strike_react')))] : take;
            spec.layers = mixL(spec.layers, sr, smooth(kt / 0.12));
            face.brows_up = 0; face.brows_angry = kt < 0.5 ? 1 : 1 - smooth((kt - 0.5) / 0.3); face.brows_sad = smooth((kt - 0.5) / 0.3) * 0.9; face.frown = smooth(kt / 0.2); face.smile = 0;
          }
        }
        gk = smooth(1 - (pt - p.T - 0.3) / 0.3) * 0.8;
      }
      spec.gaze = gz; spec.gazeK = gk;
      finish(spec, t);
      return spec;
    }
    // ---- swing
    var swt = sw.t + extra;
    var lat = o.latency != null ? o.latency : K.INPUT_LATENCY;
    var tcs = ci ? Math.max(0.025, ci.cT - (v.pitchT - sw.t)) : Math.max(0.03, K.SWING_LAG - lat);
    var whiff = !!(sw.result && !sw.result.contact), plateZ = p && p.plate ? p.plate.z : 2.5;
    var ct = warp(swt, tcs);
    var blend = swingBlend(plateZ);
    var swingL, contactL = atTime(blend, CONTACT_T);
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
        if (ct > sd - 0.15 && has('watch')) swingL = mixL(swingL, [L('watch', looped('watch', onTwos(ct - sd + 0.15, t)))], smooth((ct - sd + 0.15) / 0.15));
        spec.gaze = o.ballAfter || o.ball; spec.gazeK = 1;
      } else spec.gaze = o.ball;
    }
    // swing off the base pose (stride / coil) in a frame or two
    spec.layers = mixL(base, swingL, smooth(swt / 0.02));
    // aim the barrel at the ball around the contact frame
    if (o.contactPt && !whiff) {
      var q = aimFor(contactL, o.contactPt);
      var env = ct < CONTACT_T ? smooth((ct - 0.05) / (CONTACT_T - 0.05)) : 1 - smooth((ct - CONTACT_T) / 0.3);
      spec.aim = { q: q, k: env };
    }
    finish(spec, t);
    return spec;
  }

  // ---- field scene: the batter at home before he runs (swing follow-through, watch, bat flip on a homer)
  function poseHome(v, o) {
    var t = v.time || 0, tc = o.tc, hr = !!o.hr, plateZ = o.plateZ != null ? o.plateZ : 2.5;
    var blend = swingBlend(plateZ), ct = CONTACT_T + tc, sd = dur(blend[0].c);
    var layers = atTime(blend, Math.min(ct, sd));
    var face = { grin: 1, brows_up: 0.8, mouth_open: hr ? 0.8 : 0.2, blink: blinkAt(t, 1) * 0.6 };
    if (hr && has('bat_flip')) {
      var ft = onTwos(tc - 0.18, t);
      layers = mixL(layers, [L('bat_flip', Math.min(ft, dur('bat_flip')))], smooth(ft / 0.14));
    } else if (has('watch') && ct > sd - 0.15) layers = mixL(layers, [L('watch', looped('watch', onTwos(ct - sd + 0.15, t)))], smooth((ct - sd + 0.15) / 0.15));
    var spec = { key: 'home', fade: 0.05, layers: layers, face: face, capBack: !!v.onFire, gaze: o.ball, gazeK: 0.7 };
    finish(spec, t);
    return spec;
  }
  // ---- field scene: running the bases. o = { dist: ft along the path, moving, hr, arrived, arriveT, out, outT, scored }
  function poseRun(v, o) {
    var t = v.time || 0, layers, face = { brows_angry: 0.5, mouth_open: 0.35, blink: blinkAt(t, 1) * 0.5 };
    var gait = o.hr ? first('trot', 'run') : first('run', 'trot');
    var stride = gait === 'trot' ? 6.5 : 10;          // feet per cycle (cartoon-fast legs)
    var ph = looped(gait, (o.dist / stride) * dur(gait));
    if (gait === 'trot') ph = looped(gait, onTwos(ph, t));
    layers = [L(gait, ph)];
    if (o.hr) { face = { grin: 0.9, smile: 1, brows_up: 0.6, blink: blinkAt(t, 1) }; }
    var key = 'run';
    if (o.arrived && o.arriveT != null) {
      var at = onTwos(o.arriveT, t);
      var end = has('cheer') ? [L('cheer', Math.min(at, dur('cheer')))] : stanceL(t);
      layers = mixL(layers, end, smooth(at / 0.12));
      face = { grin: 1, mouth_open: 0.7 * (1 - smooth((at - 0.9) / 0.3)), brows_up: 1, blink: at > 1 ? blinkAt(t, 1) : 0 };
    }
    if (o.out && o.outT != null && o.outT > 0) {
      var ot = onTwos(o.outT, t);
      var slump = has('strike_react') ? [L('strike_react', Math.min(ot, dur('strike_react')))] : stanceL(t);
      layers = mixL(layers, slump, smooth(ot / 0.15));
      face = { brows_angry: ot < 0.5 ? 1 : 0.2, brows_sad: smooth((ot - 0.5) / 0.3), frown: 1, blink: blinkAt(t, 1) };
    }
    var spec = { key: key, fade: 0.1, layers: layers, face: face, hideBat: true, capBack: !!v.onFire };
    finish(spec, t);
    return spec;
  }
  // ---- title: idle in the stance with a practice swing every few seconds
  function poseTitle(t) {
    var cyc = t % 6.5, layers = stanceL(t), face = { smile: 0.6, brows_up: 0.15, blink: blinkAt(t, 1) };
    if (cyc > 4.5) {
      var c = first('swing_mid', 'swing_high', 'swing_low'), st = cyc - 4.5;
      var w = smooth(st / 0.12) * (1 - smooth((st - 1.35) / 0.4));
      layers = mixL(layers, [L(c, Math.min(st, dur(c)))], w);
      face = { brows_angry: 0.8 * w, squint: 0.3 * w, smile: 0.6 * (1 - w), mouth_open: 0.2 * w, blink: 0 };
    }
    var spec = { key: 'title', fade: 0.2, layers: layers, face: face };
    finish(spec, t);
    return spec;
  }

  // bat positions at other swing times (for the smear): evaluates the pose without touching the frame memory
  function batTrail(v, o, times) {
    var tips = [], mids = [], keep = R.last;
    var sw = v.swing; if (!sw || !keep) return null;
    var lat = o.latency != null ? o.latency : K.INPUT_LATENCY, ci = o.ci;
    var tcs = ci ? Math.max(0.025, ci.cT - (v.pitchT - sw.t)) : Math.max(0.03, K.SWING_LAG - lat);
    var whiff = !!(sw.result && !sw.result.contact);
    var blend = whiff ? [L(first('whiff', 'swing_mid'), 0)] : swingBlend(v.pitch && v.pitch.plate ? v.pitch.plate.z : 2.5);
    var tipB = R.bones.bat_tip || R.bones.bat_sweet, midB = R.bones.bat_sweet || R.bones.bat, grip = R.bones.bat;
    times.forEach(function (st) {
      var ct = warp(Math.max(0, st), tcs);
      evaluate(atTime(blend, ct));
      if (keep.aim && !whiff) { var env = ct < CONTACT_T ? smooth((ct - 0.05) / (CONTACT_T - 0.05)) : 1 - smooth((ct - CONTACT_T) / 0.3); R.root.updateMatrixWorld(true); applyAim(keep.aim.q, env); }
      R.root.updateMatrixWorld(true);
      tips.push(new T.Vector3().setFromMatrixPosition(tipB.matrixWorld));
      var a = new T.Vector3().setFromMatrixPosition(grip.matrixWorld), b = new T.Vector3().setFromMatrixPosition(midB.matrixWorld);
      mids.push(a.lerp(b, 0.45));
    });
    // put the frame's pose back
    for (var i = 0; i < R.allBones.length; i++) { var bb = R.allBones[i]; bb.position.copy(R.final[i].p); bb.quaternion.copy(R.final[i].q); bb.scale.copy(R.final[i].s); }
    R.root.updateMatrixWorld(true);
    return { tips: tips, mids: mids };
  }
  // where the flipped bat comes to rest (world, Z-up), for the prop lying in the dirt
  function batRest(out) {
    out = out || {};
    if (!has('bat_flip')) return null;
    if (!R.batRestCache || R.batRestCache.key !== R.root.matrixWorld.elements.join()) {
      evaluate([L('bat_flip', dur('bat_flip'))]);
      R.root.updateMatrixWorld(true);
      var p = worldOf('bat', new T.Vector3()), tip = R.bones.bat_tip ? worldOf('bat_tip', new T.Vector3()) : p.clone().add(new T.Vector3(1, 0, 0));
      R.batRestCache = { key: R.root.matrixWorld.elements.join(), p: p, dir: tip.sub(p).setZ(0).normalize() };
      for (var i = 0; i < R.allBones.length; i++) { var bb = R.allBones[i]; bb.position.copy(R.final[i].p); bb.quaternion.copy(R.final[i].q); bb.scale.copy(R.final[i].s); }
      R.root.updateMatrixWorld(true);
    }
    return R.batRestCache;
  }
  // lay the bat prop on the ground at (x, y) pointing along (dx, dy)
  var _bq = new T.Quaternion(), _bz = new T.Vector3(), _bx = new T.Vector3(), _by = new T.Vector3(), _bm = new T.Matrix4();
  function dropBat(x, y, dx, dy) {
    var m = R.batProp; if (!m) return null;
    var ax = m.userData.axis, len = m.userData.len;
    _by.set(dx, dy, 0.06).normalize();                       // world direction of the bat axis (handle -> tip)
    // rotation taking the bat-space axis to _by, with the barrel's roll arbitrary
    _bq.setFromUnitVectors(ax, _by);
    m.quaternion.copy(_bq);
    m.position.set(x, y, 0.17);
    m.scale.setScalar(R.size);
    m.visible = true;
    return m;
  }

  // world-space bounds of the posed body (CPU skinning of every 2nd vertex; for framing and QA, not per frame)
  function posedBox(step) {
    var box = new T.Box3(), v = new T.Vector3();
    step = step || 2;
    R.root.updateMatrixWorld(true);
    R.meshes.forEach(function (m) {
      if (!m.visible) return;
      var P = m.geometry.attributes.position;
      for (var i = 0; i < P.count; i += step) {
        v.fromBufferAttribute(P, i);
        if (m.isSkinnedMesh) m.boneTransform(i, v);
        v.applyMatrix4(m.matrixWorld);
        box.expandByPoint(v);
      }
    });
    return box;
  }
  function info() {
    var o = { status: R.status, error: R.error, warnings: R.warnings.slice(), clips: R.clips ? Object.keys(R.clips).map(function (c) { return c + ' ' + R.clips[c].duration.toFixed(2) + 's'; }) : [] };
    if (R.info) {
      o.contact = {}; for (var c in R.info.swings) { var s = R.info.swings[c].sweet; o.contact[c] = [s.x, s.y, s.z].map(function (x) { return +x.toFixed(3); }); }
      var b = R.info.restBox; o.restHeight = +(b.max.y - b.min.y).toFixed(3); o.restMinY = +b.min.y.toFixed(3);
      var sb = R.info.stanceBox; o.stanceBox = { min: sb.min.toArray().map(function (x) { return +x.toFixed(2); }), max: sb.max.toArray().map(function (x) { return +x.toFixed(2); }) };
      o.triangles = 0; R.meshes.forEach(function (m) { var g = m.geometry; o.triangles += (g.index ? g.index.count : g.attributes.position.count) / 3; });
      o.materials = Object.keys(R.colors).map(function (n) { return n + ' ' + R.colors[n]; }); o.droppedTracks = R.dropped || 0;
      o.drawCalls = R.meshes.length + R.meshes.filter(function (m) { return m.userData.outline; }).length;
    }
    o.loadMs = R.loadMs;
    return o;
  }

  API.ready = function () { return R.status === 'ready'; };
  API.boot = boot; API.loadBuffer = loadBuffer; API.R = R;
  API.setColors = setColors; API.setHot = setHot; API.place = place; API.point = function (n, out) { return worldOf(n, out); };
  API.poseBat = poseBat; API.poseHome = poseHome; API.poseRun = poseRun; API.poseTitle = poseTitle; API.batTrail = batTrail;
  API.solvePlacement = solvePlacement; API.autoSize = autoSize; API.batRest = batRest; API.dropBat = dropBat; API.info = info;
  API.root = function () { return R.root; }; API.prop = function () { return R.batProp; };
  API.headPoint = headPoint; API.has = has; API.dur = dur; API.posedBox = posedBox; API.CONTACT_T = CONTACT_T;
  return API;
})();
