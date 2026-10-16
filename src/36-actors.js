// 36-actors.js — BB.Actors: modelled characters from glb files. Owned by the integration agent.
// One runtime for every modelled character (Rocco now; pitchers, catchers, the umpire and fielders in phase B, see
// docs/CAST-PLAN.md). An actor is a character glb (shared 42-bone rig, materials named by part, shape keys, clips)
// turned into a toon character:
//   - cel materials chosen by material name, with per-kind contract colours, team colours from the uniform scheme
//     and per-character overrides; canvas-lettered decals
//   - ink hulls that deform with the skeleton and the shape keys, layer 1 and per-material ink ids for BB.Ink
//   - an AnimationMixer driven deterministically: a pose is a list of layers [{c: clip, t: seconds, w: weight}]
//     evaluated on demand, so a frame shows exactly what the state says (harness == game); a short snapshot
//     crossfade covers discontinuities
//   - face helpers (shape keys, blinks, cartoon eye squash), gaze, world anchors, posed bounds
//   - levels of detail: LOD1 meshes (same rig and materials, from '<asset>_lod1', docs/CAST-CONTRACT.md) bound to the LOD0 skeleton,
//     picked by on-screen size
// Role drivers (BB.Rocco's batter driver in 36-rocco.js; pitcher/catcher/umpire/fielder in phase B) sit on top.
// Assets come from BB.Assets (30-assets.js). Kinds are described with define(kind, cfg) (see the end of this file).
BB.Actors = (function () {
  var T = (typeof THREE !== 'undefined') ? THREE : null;
  if (!T || !T.GLTFLoader || !BB.Toon || !BB.U || !BB.Assets) return { available: false };
  var TN = BB.Toon, U = BB.U, clamp = U.clamp, smooth = U.smooth, PI = Math.PI;
  var KINDS = {}, serial = 0;

  // ------------------------------------------------------------------ the ink hull (skin + shape keys)
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
      '  float px = clamp(uWorld * f / max(clip.w, 0.05), uMin, uMax) * uScale * ow;',   // ow: weight x brush wobble
      '  clip.xy += d * px * 2.0 / uRes * clip.w;',
      '  gl_Position = clip;',
      '}'].join('\n'),
    fragmentShader: 'uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, 1.0); }',
  });
  HULL.userData.actor = true; HULL.userData.rocco = true; HULL.userData.inkHull = true;   // BB.Ink keeps hulls out of its normals pass
  var hullRegistered = false;
  function registerHull() { if (!hullRegistered && BB.Ink && BB.Ink.registerHull) { BB.Ink.registerHull(HULL); hullRegistered = true; } }
  var SHADOW_G = new T.CircleGeometry(1, 20);
  var SHADOW_M = new T.MeshBasicMaterial({ color: 0x1B1420, transparent: true, opacity: 0.22, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -12, polygonOffsetUnits: -40 });

  // ------------------------------------------------------------------ small helpers shared by the drivers
  function sampleCurve(k, t) { // [[t, v], ...] linear
    if (!k || !k.length) return 0;
    if (t <= k[0][0]) return k[0][1];
    for (var i = 1; i < k.length; i++) if (t <= k[i][0]) { var a = k[i - 1], b = k[i], u = (t - a[0]) / Math.max(1e-6, b[0] - a[0]); return a[1] + (b[1] - a[1]) * u; }
    return k[k.length - 1][1];
  }
  function L(c, t, w) { return { c: c, t: t, w: w == null ? 1 : w }; }
  function mixL(a, b, k) { // blend two layer lists
    if (k <= 0) return a; if (k >= 1) return b;
    var o = [], i;
    for (i = 0; i < a.length; i++) o.push({ c: a[i].c, t: a[i].t, w: a[i].w * (1 - k) });
    for (i = 0; i < b.length; i++) o.push({ c: b[i].c, t: b[i].t, w: b[i].w * k });
    return o;
  }
  function twos(t) { return (BB.Ink && BB.Ink.twos) ? BB.Ink.twos(t) : t; }
  // an event-relative time held on twos in step with the global 12 fps grid
  function onTwos(rel, t) { return Math.max(0, rel - (t - twos(t))); }
  // game time -> clip time so that clip time `at` lands on game time `when` (e.g. a swing's contact frame on the
  // moment the bat meets the ball, a pitcher's release frame on the release): squeezed or stretched before, 1:1 after
  function warp(gameT, when, at) { return gameT < when ? at * (gameT / Math.max(1e-4, when)) : at + (gameT - when); }
  var V = new T.Vector3(), V2 = new T.Vector3(), Q = new T.Quaternion(), Q2 = new T.Quaternion(), M4 = new T.Matrix4();
  function nameOf(o) { return (o.userData && o.userData.name) || o.name; }

  // model-space positions of a mesh at the node rest pose (skinned meshes go through the skeleton, which also undoes
  // the vertex quantization of packed files), computed once per geometry
  function restPositions(m) {
    var g = m.geometry;
    if (g.userData.rest) return g.userData.rest;
    var P = g.attributes.position, out = new Float32Array(P.count * 3), v = new T.Vector3();
    m.updateWorldMatrix(true, false);
    if (m.isSkinnedMesh) { m.skeleton.bones.forEach(function (b) { b.updateWorldMatrix(true, false); }); m.updateMatrixWorld(true); }
    for (var i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i);
      if (m.isSkinnedMesh) m.boneTransform(i, v);
      v.applyMatrix4(m.matrixWorld);
      out[3 * i] = v.x; out[3 * i + 1] = v.y; out[3 * i + 2] = v.z;
    }
    g.userData.rest = out;
    return out;
  }
  // smooth hull normals, welded by position across all primitives of one glTF mesh (in the vertices' own space, which
  // is what the skinning transforms; packed files quantize positions with one uniform scale, so directions hold), so
  // creases, seams and material borders never crack the ink line
  function weldGroup(list) {
    var acc = {}, keys = [], a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3(), e2 = new T.Vector3();
    function q(x) { return Math.round(x * 1500); }
    list = list.filter(function (m) { return !m.geometry.attributes.onormal; });
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
  // per-vertex hull weight: the material's weight times a gentle brush wobble along the surface (model space)
  function hullWeights(m, w) {
    var g = m.geometry; if (g.attributes.ow) return;
    var R = restPositions(m), n = R.length / 3, a = new Float32Array(n);
    for (var i = 0; i < n; i++) a[i] = w * (0.84 + 0.28 * Math.sin(R[3 * i] * 5.3 + R[3 * i + 1] * 3.9 + R[3 * i + 2] * 4.7));
    g.setAttribute('ow', new T.BufferAttribute(a, 1));
  }
  function makeHull(src) {
    var h = src.isSkinnedMesh ? new T.SkinnedMesh(src.geometry, HULL) : new T.Mesh(src.geometry, HULL);
    if (src.isSkinnedMesh) { h.bind(src.skeleton, src.bindMatrix); h.bindMode = src.bindMode; }
    if (src.morphTargetInfluences) { h.morphTargetInfluences = src.morphTargetInfluences; h.morphTargetDictionary = src.morphTargetDictionary; }
    h.renderOrder = 1; h.frustumCulled = false; h.userData.isOutline = true; h.name = (src.name || 'mesh') + '_ink';
    src.add(h); src.userData.outline = h;
    return h;
  }
  // which way a decal quad's u and v run in model space (tangent frame from positions + uvs)
  function decalAxes(m) {
    var g = m.geometry, R = restPositions(m), UV = g.attributes.uv, I = g.index;
    if (!UV) return null;
    var du = new T.Vector3(), dv = new T.Vector3(), p0 = new T.Vector3(), p1 = new T.Vector3(), p2 = new T.Vector3(), e1 = new T.Vector3(), e2 = new T.Vector3();
    var cnt = I ? I.count : R.length / 3;
    for (var i = 0; i + 2 < cnt; i += 3) {
      var a = I ? I.getX(i) : i, b = I ? I.getX(i + 1) : i + 1, c = I ? I.getX(i + 2) : i + 2;
      p0.fromArray(R, 3 * a); p1.fromArray(R, 3 * b); p2.fromArray(R, 3 * c);
      e1.subVectors(p1, p0); e2.subVectors(p2, p0);
      var s1 = UV.getX(b) - UV.getX(a), t1 = UV.getY(b) - UV.getY(a), s2 = UV.getX(c) - UV.getX(a), t2 = UV.getY(c) - UV.getY(a), d = s1 * t2 - s2 * t1;
      if (Math.abs(d) < 1e-12) continue;
      du.addScaledVector(e1, t2 / d).addScaledVector(e2, -t1 / d);
      dv.addScaledVector(e2, s1 / d).addScaledVector(e1, -s2 / d);
    }
    return { du: du, dv: dv };
  }
  // a float copy of a (possibly quantized, possibly interleaved) geometry, for props built from parts of the model
  function floatGeometry(src) {
    var g = new T.BufferGeometry();
    if (src.index) g.setIndex(new T.BufferAttribute(new Uint32Array(src.index.array), 1));
    ['position', 'normal', 'uv', 'onormal', 'ow'].forEach(function (n) {
      var a = src.attributes[n]; if (!a) return;
      var out = new Float32Array(a.count * a.itemSize);
      var get = [a.getX, a.getY, a.getZ, a.getW];
      for (var i = 0; i < a.count; i++) for (var k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = get[k].call(a, i);
      g.setAttribute(n, new T.BufferAttribute(out, a.itemSize));
    });
    return g;
  }

  // One armature skins every mesh of a character, but the loader (and SkeletonUtils.clone) give each mesh its own
  // Skeleton: bone matrices computed and a bone texture uploaded per mesh, every frame. Meshes bound to the same bones
  // with the same inverse bind matrices share one Skeleton instead (once per character per frame).
  function shareSkeletons(root) {
    var groups = {};
    root.traverse(function (m) {
      if (!m.isSkinnedMesh || !m.skeleton) return;
      var sk = m.skeleton, key = sk.bones.map(function (b) { return b.uuid; }).join(), g = groups[key];
      if (!g) { groups[key] = [sk]; return; }
      for (var i = 0; i < g.length; i++) if (sameInverses(g[i], sk)) { if (g[i] !== sk) { sk.dispose(); m.skeleton = g[i]; } return; }
      g.push(sk);
    });
  }
  function sameInverses(a, b) {
    if (a.boneInverses.length !== b.boneInverses.length) return false;
    for (var i = 0; i < a.boneInverses.length; i++) {
      var x = a.boneInverses[i].elements, y = b.boneInverses[i].elements;
      for (var j = 0; j < 16; j++) if (Math.abs(x[j] - y[j]) > 1e-6) return false;
    }
    return true;
  }

  // ------------------------------------------------------------------ colours
  var _c1 = new T.Color(), _c2 = new T.Color();
  function near(a, b) { return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b)); }
  // the glb stores linear base colours (Blender converts its sRGB swatches); the game paints with sRGB hex values
  function baseHex(actor, name, json, mat) {
    var def = null, f = null, pal = actor.cfg.palette[name];
    if (json && json.materials) for (var i = 0; i < json.materials.length; i++) if (json.materials[i].name === name) { def = json.materials[i]; break; }
    if (def && def.pbrMetallicRoughness && def.pbrMetallicRoughness.baseColorFactor) f = def.pbrMetallicRoughness.baseColorFactor;
    if (!f) return pal || (mat && mat.color ? '#' + mat.color.getHexString() : '#CCCCCC');
    _c1.setRGB(f[0], f[1], f[2]).convertLinearToSRGB();
    if (!pal || actor.cfg.trustModelColors) return '#' + _c1.getHexString();
    _c2.set(pal);
    if (near(_c1, _c2) < 0.16) return '#' + _c1.getHexString();      // the modeller's tweak of the contract colour
    _c1.setRGB(f[0], f[1], f[2]);
    if (near(_c1, _c2) < 0.16) { actor.warn('material ' + name + ' stores sRGB values in a linear slot'); return '#' + _c1.getHexString(); }
    actor.warn('material ' + name + ' colour is far from the contract (' + pal + '); using the contract colour');
    return pal;
  }

  // ------------------------------------------------------------------ an actor
  function Actor(gltf, cfg, opts) {
    opts = opts || {};
    this.cfg = cfg; this.kind = cfg.kind; this.asset = opts.asset || cfg.kind; this.warnings = [];
    if (opts.inkBase != null) this.inkBase = opts.inkBase;
    else if (cfg.inkBase != null && !cfg.inkUsed) { this.inkBase = cfg.inkBase; cfg.inkUsed = true; }
    else this.inkBase = 8000 + 100 * (serial++);
    var tpl = gltf.scene || (gltf.scenes && gltf.scenes[0]);
    if (!tpl) throw new Error('no scene in ' + this.asset);
    // every actor works on its own copy (bones, meshes, morph weights); geometry and clips stay shared with the
    // parsed file, which BB.Assets keeps until the last user releases it
    var model = T.SkeletonUtils.clone(tpl);
    this.gltf = gltf; this.json = gltf.parser && gltf.parser.json;
    model.updateMatrixWorld(true);
    shareSkeletons(model);
    var self = this, bones = {}, byName = {};
    model.traverse(function (o) { byName[o.name] = o; if (o.isBone || o.type === 'Object3D' || o.isGroup) { var nm = nameOf(o); if (!bones[nm]) bones[nm] = o; } });
    var missing = (cfg.bones || []).filter(function (b) { return !bones[b]; });
    if (missing.length) this.warn('missing bones: ' + missing.join(', '));
    (cfg.need || ['root']).forEach(function (b) { if (!bones[b]) throw new Error(self.asset + ' has no "' + b + '" bone'); });
    this.model = model; this.bones = bones; this.byName = byName;
    var baseLod = this.baseLod = opts.baseLod || 0;   // fielders and runners load only their LOD1 file: its meshes are level 1
    this.colors = {}; this.mats = {}; this.over = {}; this.hidden = {}; this.lodLevel = baseLod; this.lods = {}; this.face = []; this.faceCurves = {};
    this.decalTex = {}; this.decalFlip = {}; this.decalText = opts.decalText || {};
    this.extras = Object.assign({}, tpl.userData || {});   // glTF scene extras: { id, species, role, height, hipHeight, lod, hand }
    var meshes = this.adoptMeshes(model, baseLod);
    if (!meshes.length) throw new Error(this.asset + ' has no meshes');
    this.base = Object.assign({}, this.colors);
    // face shapes
    var have = {};
    this.face.forEach(function (m) { for (var k in m.morphTargetDictionary) have[k] = true; });
    var missingShapes = (cfg.shapes || []).filter(function (s) { return !have[s]; });
    if (missingShapes.length) this.warn('missing shape keys: ' + missingShapes.join(', '));
    // clips: drop tracks that would bind to nothing (PropertyBinding would fall back to the root or log errors)
    var nodeNames = {};
    model.traverse(function (o) { nodeNames[o.name] = true; });
    this.clips = {}; this.actions = {}; this.dropped = 0;
    this.mixer = new T.AnimationMixer(model);
    (gltf.animations || []).forEach(function (clip) {
      if (!clip.userData || !clip.userData.checked) {
        var seen = {}, tracks = [];
        clip.tracks.forEach(function (tr) {
          var pp = T.PropertyBinding.parseTrackName(tr.name), node = pp.nodeName;
          if (!nodeNames[node] || seen[tr.name]) { self.dropped++; return; }
          seen[tr.name] = true; tracks.push(tr);
        });
        clip.tracks = tracks; clip.userData = clip.userData || {}; clip.userData.checked = true;
      }
      self.clips[clip.name] = clip;
      var a = self.mixer.clipAction(clip);
      a.setLoop(T.LoopRepeat, Infinity); a.play(); a.setEffectiveWeight(0);
      self.actions[clip.name] = a;
    });
    var missingClips = (cfg.clips || []).filter(function (c) { return !self.clips[c]; });
    if (missingClips.length) this.warn('missing clips: ' + missingClips.join(', '));
    (cfg.needClips || []).forEach(function (c) { if (!self.clips[c]) throw new Error(self.asset + ' needs a "' + c + '" clip'); });
    // world wrapper: Y-up model -> Z-up world, like BB.Cast's "up" group
    this.up = new T.Group(); this.up.rotation.x = PI / 2; this.up.add(model);
    this.root = new T.Group(); this.root.name = this.asset + '_actor'; this.root.add(this.up);
    var sh = new T.Mesh(SHADOW_G, SHADOW_M); sh.renderOrder = -1; sh.scale.set(cfg.shadow ? cfg.shadow[0] : 1.25, cfg.shadow ? cfg.shadow[1] : 1.0, 1); this.root.add(sh); this.shadow = sh;
    this.allBones = []; model.traverse(function (o) { if (o.isBone) self.allBones.push(o); });
    var tr = function () { return self.allBones.map(function () { return { p: new T.Vector3(), q: new T.Quaternion(), s: new T.Vector3(1, 1, 1) }; }); };
    this.saved = tr(); this.final = tr(); this.fadeFrom = tr();
    this.allBones.forEach(function (b, i) { self.saved[i].p.copy(b.position); self.saved[i].q.copy(b.quaternion); self.saved[i].s.copy(b.scale); });
    this.morphSaved = this.face.map(function (m) { return m.morphTargetInfluences.slice(); });
    this.size = 1; this.yaw = 0; this.mem = { key: '', time: -1 };
    this.measureRest();
    registerHull();
    this.paint();
    if (opts.colors) this.setColors(opts.colors);
  }
  var A = Actor.prototype;
  A.warn = function (msg) { this.warnings.push(msg); };

  // toon materials, hulls, ink ids for every mesh of a model (LOD0) or of a level-of-detail file
  A.adoptMeshes = function (root, lod) {
    var self = this, cfg = this.cfg, meshes = [];
    root.traverse(function (o) { if (o.isMesh && !o.userData.isOutline) meshes.push(o); });
    meshes.forEach(function (m) {
      var mat = Array.isArray(m.material) ? m.material[0] : m.material, nm = (mat && mat.name) || 'unnamed';
      if (!(nm in self.colors)) { self.colors[nm] = baseHex(self, nm, self.json, mat); if (cfg.palette && !cfg.palette[nm] && cfg.strictMaterials) self.warn('unexpected material ' + nm); }
      m.userData.mname = nm; m.userData.lod = lod;
    });
    // hull normals welded per glTF mesh (all its primitives share one parent node and skeleton)
    var groups = {};
    meshes.forEach(function (m) { var key = (m.parent ? m.parent.uuid : '-') + '|' + (m.skeleton ? m.skeleton.uuid : '-'); (groups[key] = groups[key] || []).push(m); });
    Object.keys(groups).forEach(function (k) { weldGroup(groups[k]); });
    // decal lettering must read from outside: seen from the front (+Z) a chest decal runs toward +X (his left),
    // seen from behind a back decal runs toward -X; v runs up (+Y)
    meshes.forEach(function (m) {
      var nm = m.userData.mname, dc = cfg.decals && cfg.decals[nm]; if (!dc || self.decalFlip[nm]) return;
      var ax = decalAxes(m); if (!ax) { self.warn(nm + ' has no uvs'); return; }
      var right = dc.side === 'back' ? -1 : 1;
      self.decalFlip[nm] = { u: ax.du.x * right < 0, v: ax.dv.y < 0 };
    });
    var names = Object.keys(this.colors).sort();
    meshes.forEach(function (m) {
      var nm = m.userData.mname, decal = !!(cfg.decals && cfg.decals[nm]), hw = cfg.hull && cfg.hull[nm] != null ? cfg.hull[nm] : 1;
      m.material = self.matFor(nm);
      hullWeights(m, hw);
      if (hw > 0 && !decal) makeHull(m);
      m.frustumCulled = false;
      m.castShadow = m.receiveShadow = false;
      if (!decal) m.layers.enable(1);
      m.userData.inkId = self.inkBase + names.indexOf(nm);
      if (cfg.ink && cfg.ink[nm] != null) m.userData.inkWeight = cfg.ink[nm];
      m.userData.kind = (cfg.props && cfg.props[nm]) || (decal ? 'decal' : 'body');
      if (m.morphTargetDictionary && m.morphTargetInfluences) self.face.push(m);
    });
    this.meshes = (this.meshes || []).concat(meshes);
    (this.lods[lod] = this.lods[lod] || []).push.apply(this.lods[lod], meshes);
    return meshes;
  };
  A.matFor = function (name) {
    if (this.mats[name]) return this.mats[name];
    var cfg = this.cfg, o = { color: new T.Color(this.colors[name] || '#CCCCCC'), gradientMap: TN.GRAD };
    if (cfg.decals && cfg.decals[name]) {
      var map = this.decalMap(name);
      Object.assign(o, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -8, transparent: true, depthWrite: false, side: T.DoubleSide });
      if (map) Object.assign(o, { map: map, alphaTest: 0.35, color: new T.Color('#FFFFFF') });
    }
    if (cfg.emissive && cfg.emissive[name]) o.emissive = new T.Color(cfg.emissive[name]);   // e.g. eye whites stay white on the shaded side
    var m = new T.MeshToonMaterial(o); m.name = this.kind + '_' + name;
    this.mats[name] = m;
    return m;
  };
  // decal lettering: the same canvas lettering as BB.Cast's uniforms, a private copy flipped to read from outside
  A.decalMap = function (name) {
    var dc = this.cfg.decals[name], fill = this.colors[name] || '#2E5AAC', text = this.decalText[name] || dc.text || '?';
    var base = BB.Cast && BB.Cast.decalTex ? BB.Cast.decalTex(text, fill, TN.INK) : null;
    if (!base) return null;
    var key = name + fill + text;
    if (this.decalTex[key]) return this.decalTex[key];
    var t = base.clone(), f = this.decalFlip[name];
    t.wrapS = t.wrapT = T.ClampToEdgeWrapping;
    if (f && f.u) { t.repeat.x = -1; t.offset.x = 1; }
    if (f && f.v) { t.repeat.y = -1; t.offset.y = 1; }
    t.needsUpdate = true;
    return (this.decalTex[key] = t);
  };
  A.paint = function () {
    for (var name in this.mats) {
      var m = this.mats[name];
      if (this.cfg.decals && this.cfg.decals[name]) { var mp = this.decalMap(name); if (mp && m.map !== mp) { m.map = mp; m.needsUpdate = true; } if (mp) continue; }
      var ov = this.over[name];
      m.color.set(ov ? ov.color : (this.colors[name] || '#CCCCCC'));
      if (m.emissive) m.emissive.set(ov && ov.emissive ? ov.emissive : (this.cfg.emissive && this.cfg.emissive[name]) || '#000000');
    }
  };
  // team colours from the uniform scheme ({a, b, ...}); cfg.team maps material -> slot
  A.setColors = function (c) {
    if (!c) return;
    this.team = c;
    var team = this.cfg.team || {};
    var fb = this.cfg.teamFallback || {};
    for (var name in team) if (name in this.base) { var slot = team[name]; this.colors[name] = c[slot] || (fb[slot] && c[fb[slot]]) || this.base[name]; }
    this.paint();
  };
  A.setColor = function (name, hex) { if (name in this.colors) { this.colors[name] = hex || this.base[name]; this.paint(); } };
  // a temporary look on top (On Fire's hot bat): override(name, {color, emissive}) / override(name, null)
  A.override = function (name, o) {
    var cur = this.over[name];
    if (!o && !cur) return;
    if (o && cur && cur.color === o.color && cur.emissive === o.emissive) return;
    if (o) this.over[name] = o; else delete this.over[name];
    this.paint();
  };

  // ------------------------------------------------------------------ clips and poses
  A.has = function (c) { return !!this.clips[c]; };
  A.dur = function (c) { return this.clips[c] ? this.clips[c].duration : 1; };
  A.first = function () { for (var i = 0; i < arguments.length; i++) if (this.has(arguments[i])) return arguments[i]; return this.cfg.idle || 'stance'; };
  A.looped = function (c, t) { var d = this.dur(c); return ((t % d) + d) % d; };
  A.restore = function () {
    var i, s, a, j;
    for (i = 0; i < this.allBones.length; i++) { var b = this.allBones[i]; s = this.saved[i]; b.position.copy(s.p); b.quaternion.copy(s.q); b.scale.copy(s.s); }
    for (j = 0; j < this.face.length; j++) { a = this.face[j].morphTargetInfluences; s = this.morphSaved[j]; for (var k = 0; k < a.length; k++) a[k] = s[k]; }
  };
  A.save = function () {
    var i, s, a, j;
    for (i = 0; i < this.allBones.length; i++) { var b = this.allBones[i]; s = this.saved[i]; s.p.copy(b.position); s.q.copy(b.quaternion); s.s.copy(b.scale); }
    for (j = 0; j < this.face.length; j++) { a = this.face[j].morphTargetInfluences; s = this.morphSaved[j]; for (var k = 0; k < a.length; k++) s[k] = a[k]; }
  };
  // layers: [{c: clip, t: seconds, w: weight}] -> bones and shape keys (the mixer only writes values that changed
  // since its last update, so everything touched afterwards is put back first)
  A.evaluate = function (layers) {
    this.restore();
    var acts = this.actions, w = {}, tm = {}, tot = 0, i, l;
    for (i = 0; i < layers.length; i++) {
      l = layers[i];
      if (!acts[l.c] || !(l.w > 1e-4)) continue;
      if (w[l.c] == null || l.w > w[l.c]) tm[l.c] = l.t;
      w[l.c] = (w[l.c] || 0) + l.w; tot += l.w;
    }
    if (tot <= 0) { var idle = this.first(this.cfg.idle || 'stance'); w = {}; w[idle] = 1; tm = {}; tm[idle] = 0; tot = 1; }
    for (var n in acts) {
      var a = acts[n];
      if (w[n]) { a.enabled = true; a.time = clamp(tm[n], 0, a.getClip().duration); a.setEffectiveWeight(w[n] / tot); }
      else { a.setEffectiveWeight(0); a.enabled = false; }
    }
    this.mixer.update(0);
    this.save();
  };
  // the frame: evaluate the layers, run the driver's bone edits (spec.post), gaze, face, hide parts, then a snapshot
  // crossfade when the pose key changes between consecutive frames (spec.fade seconds)
  A.commit = function (spec, time) {
    this.evaluate(spec.layers);
    this.root.updateMatrixWorld(true);
    if (spec.post) spec.post(this, spec);
    if (spec.gaze) { this.root.updateMatrixWorld(true); this.gaze(spec.gaze, spec.gazeK == null ? 1 : spec.gazeK, spec.gazeLimit); }
    this.hideKinds(spec.hide || null);
    this.applyFace(this.curveFace(spec.layers, spec.face || {}));
    this.eyeSquash();
    var mem = this.mem, dt = time - mem.time, i;
    if (spec.key !== mem.key && mem.time >= 0 && dt >= 0 && dt < 0.25 && (spec.fade || 0) > 0) {
      for (i = 0; i < this.allBones.length; i++) { this.fadeFrom[i].p.copy(this.final[i].p); this.fadeFrom[i].q.copy(this.final[i].q); this.fadeFrom[i].s.copy(this.final[i].s); }
      mem.fadeT0 = time; mem.fadeDur = spec.fade;
    } else if (spec.key !== mem.key) mem.fadeT0 = null;
    if (mem.fadeT0 != null) {
      var k = smooth((time - mem.fadeT0) / mem.fadeDur);
      if (k >= 1 || time < mem.fadeT0) mem.fadeT0 = null;
      else for (i = 0; i < this.allBones.length; i++) {
        var b = this.allBones[i], f = this.fadeFrom[i];
        b.position.lerpVectors(f.p, b.position, k); Q.copy(b.quaternion); b.quaternion.slerpQuaternions(f.q, Q, k); b.scale.lerpVectors(f.s, b.scale, k);
      }
    }
    this.keepFinal();
    mem.key = spec.key; mem.time = time;
    this.root.updateMatrixWorld(true);
    this.last = spec;
  };
  A.keepFinal = function () { for (var i = 0; i < this.allBones.length; i++) { var bb = this.allBones[i]; this.final[i].p.copy(bb.position); this.final[i].q.copy(bb.quaternion); this.final[i].s.copy(bb.scale); } };
  // put the frame's committed pose back (after sampling other times, e.g. for a smear)
  A.restoreFinal = function () {
    for (var i = 0; i < this.allBones.length; i++) { var bb = this.allBones[i]; bb.position.copy(this.final[i].p); bb.quaternion.copy(this.final[i].q); bb.scale.copy(this.final[i].s); }
    this.root.updateMatrixWorld(true);
  };

  // ------------------------------------------------------------------ faces & gaze
  // shape-key curves that come with a clip library's sidecar ({clip: {shape: [[t, v], ...]}}): shared clips can't key
  // a character's own morph targets, so the library ships them as data; they add to the driver's face (max)
  A.addFaceCurves = function (curves) { for (var c in (curves || {})) this.faceCurves[c] = curves[c]; };
  A.curveFace = function (layers, face) {
    var out = face, any = false;
    for (var i = 0; layers && i < layers.length; i++) {
      var l = layers[i], fc = this.faceCurves[l.c]; if (!fc || !(l.w > 0.05)) continue;
      if (!any) { out = Object.assign({}, face); any = true; }
      for (var sh in fc) { var v = sampleCurve(fc[sh], l.t) * Math.min(1, l.w); if (!(out[sh] >= v)) out[sh] = v; }
    }
    return out;
  };
  A.blinkAt = function (t, seed) { var c = this.cfg.blinkCycle || 3.7, p = (t + seed * 1.7) % c; return p < 0.13 ? Math.sin(p / 0.13 * PI) : 0; };
  A.applyFace = function (face) {
    for (var j = 0; j < this.face.length; j++) {
      var m = this.face[j], d = m.morphTargetDictionary, a = m.morphTargetInfluences;
      for (var s in face) { var i = d[s]; if (i != null) a[i] = clamp(Math.max(a[i], face[s] || 0), 0, 1); }
    }
  };
  // cartoon blink: squash the eyeballs (pupils are weighted to eye.L/R) by the blink / squint weights, so the eyes
  // close even where lid shapes slide behind the eyeballs
  A.eyeSquash = function () {
    var m = this.face[0]; if (!m || !this.cfg.eyeSquash) return;
    var d = m.morphTargetDictionary, a = m.morphTargetInfluences;
    var k = clamp(1 - 0.9 * (d.blink != null ? a[d.blink] : 0) - 0.3 * (d.squint != null ? a[d.squint] : 0), 0.08, 1);
    if (k > 0.999) return;
    var B = this.bones;
    ['eye.L', 'eye.R'].forEach(function (n) { var b = B[n]; if (b) b.scale.y *= k; });
  };
  // turn the eye bones toward a world point (limited, so they never roll back into the head)
  var _want = new T.Vector3(), _pq = new T.Quaternion(), _wq = new T.Quaternion(), _fwd = new T.Vector3();
  A.gaze = function (target, k, limit) {
    if (!target || !(k > 0)) return;
    var self = this, head = this.bones.head; if (!head) return;
    var lim = limit || 0.42;
    ['eye.L', 'eye.R'].forEach(function (n) {
      var b = self.bones[n]; if (!b) return;
      b.updateWorldMatrix(true, false);
      // the eye's look direction now: model +Z carried by the head bone (eyes look straight ahead at rest)
      head.updateWorldMatrix(true, false);
      head.getWorldQuaternion(_wq);
      _fwd.set(0, 0, 1).applyQuaternion(self.headRestInv || (self.headRestInv = self.restInv('head'))).applyQuaternion(_wq);
      V.setFromMatrixPosition(b.matrixWorld);
      _want.set(target.x, target.y, target.z).sub(V).normalize();
      var ang = Math.acos(clamp(_fwd.dot(_want), -1, 1));
      if (ang < 1e-4) return;
      Q.setFromUnitVectors(_fwd, _want);
      if (ang > lim) Q.slerp(Q2.identity(), 1 - lim / ang);
      Q2.identity().slerp(Q, k);                                   // world-space delta
      b.parent.getWorldQuaternion(_pq);
      Q.copy(_pq).invert().multiply(Q2).multiply(_pq);             // local' = P^-1 * delta * P * local
      b.quaternion.premultiply(Q);
    });
  };
  // two-bone reach (analytic IK): move the end of a limb (b1 -> b2 -> b3, e.g. upper_arm.L -> forearm.L -> hand.L)
  // so that the effector bone (a socket under b3, e.g. the mitt pocket) lands on a world point. The bend stays in
  // its current plane (the clip's elbow direction) and the hand keeps its world orientation; w blends it in. Out of
  // reach, the limb straightens toward the point.
  var _s = new T.Vector3(), _e = new T.Vector3(), _h = new T.Vector3(), _p = new T.Vector3(), _t = new T.Vector3(), _d = new T.Vector3(), _n = new T.Vector3();
  var _hq = new T.Quaternion(), _dq = new T.Quaternion(), _pq2 = new T.Quaternion();
  function worldDelta(b, dq) {                                  // rotate bone b by a world-space delta rotation
    b.parent.getWorldQuaternion(_pq2);
    Q2.copy(_pq2).invert().multiply(dq).multiply(_pq2);
    b.quaternion.premultiply(Q2);
    b.updateMatrixWorld(true);
  }
  A.reach = function (b1, b2, b3, eff, target, w) {
    var B1 = this.bones[b1], B2 = this.bones[b2], B3 = this.bones[b3], E = (eff && this.bones[eff]) || B3;
    if (!B1 || !B2 || !B3 || !target || !(w > 0)) return false;
    this.root.updateMatrixWorld(true);
    B1.getWorldPosition(_s); B2.getWorldPosition(_e); B3.getWorldPosition(_h); E.getWorldPosition(_p);
    B3.getWorldQuaternion(_hq);
    // where the wrist must go: the target less the (rigid) wrist -> effector offset, blended by w
    _t.set(target.x, target.y, target.z).sub(_p).multiplyScalar(w).add(_h);
    var a = _e.distanceTo(_s), b = _h.distanceTo(_e);
    _d.subVectors(_t, _s); var dl = _d.length(); if (dl < 1e-5 || a < 1e-5 || b < 1e-5) return false;
    var d = clamp(dl, Math.abs(a - b) + 1e-4, a + b - 1e-4); _d.multiplyScalar(1 / dl);
    // the elbow: in the plane of the reach direction and the current elbow
    _n.subVectors(_e, _s); _n.addScaledVector(_d, -_n.dot(_d));
    if (_n.lengthSq() < 1e-8) _n.set(0, 0, -1).addScaledVector(_d, -_d.z);
    _n.normalize();
    var ca = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1), sa = Math.sqrt(1 - ca * ca);
    var e2 = V.copy(_s).addScaledVector(_d, a * ca).addScaledVector(_n, a * sa);
    // upper limb: old elbow direction -> new; lower limb: wrist direction -> the wrist target
    _dq.setFromUnitVectors(V2.subVectors(_e, _s).normalize(), _p.subVectors(e2, _s).normalize());
    worldDelta(B1, _dq);
    B2.getWorldPosition(_e); B3.getWorldPosition(_h);
    _dq.setFromUnitVectors(V2.subVectors(_h, _e).normalize(), _p.subVectors(_t, _e).normalize());
    worldDelta(B2, _dq);
    // the hand keeps its world orientation (the mitt still faces the ball)
    B3.parent.getWorldQuaternion(_pq2);
    B3.quaternion.copy(_pq2.invert().multiply(_hq));
    B3.updateMatrixWorld(true);
    return true;
  };
  // inverse of a bone's bind-pose rotation relative to the model (from the skin's inverse bind matrices)
  A.restInv = function (bone) {
    var q = new T.Quaternion(), b = this.bones[bone], sk = null;
    var base = this.baseLod || 0;
    this.meshes.some(function (m) { if (m.isSkinnedMesh && m.userData.lod === base) { sk = m.skeleton; return true; } return false; });
    if (sk && b) { var i = sk.bones.indexOf(b); if (i >= 0) { var m = sk.boneInverses[i].clone().invert(), p = new T.Vector3(), s = new T.Vector3(); m.decompose(p, q, s); } }
    return q.invert();
  };

  // ------------------------------------------------------------------ shared clip libraries (phase B)
  // addClips(lib, {scale, only}): the clips of an animation library file (anim_<lib>.glb: the reference skeleton and
  // its clips, docs/CAST-CONTRACT.md) for this character. Clips animate rotations on every bone and translation only
  // on root and hips; those translations are retargeted by scale = hipHeight / refHipHeight. Channels for bones this
  // character lacks (tail, ears...) are dropped. Returns the clip names added.
  A.addClips = function (lib, o) {
    o = o || {};
    var self = this, k = o.scale != null ? o.scale : 1, names = {}, added = [];
    this.model.traverse(function (n) { names[n.name] = true; });
    (lib.animations || []).forEach(function (src) {
      if (o.only && o.only.indexOf(src.name) < 0) return;
      var tracks = [];
      src.tracks.forEach(function (tr) {
        var pp = T.PropertyBinding.parseTrackName(tr.name);
        if (!names[pp.nodeName]) return;
        // shared clips drive bones only: a face keyed on another character's meshes doesn't carry over (libraries
        // bring their face as sidecar curves, see addFaceCurves)
        if (pp.propertyName === 'morphTargetInfluences') return;
        if (pp.propertyName === 'position' && k !== 1) {
          var node = self.byName[pp.nodeName], bn = node ? nameOf(node) : pp.nodeName;
          if (bn === 'root' || bn === 'hips') { tr = tr.clone(); for (var i = 0; i < tr.values.length; i++) tr.values[i] *= k; }
        }
        tracks.push(tr);
      });
      var clip = new T.AnimationClip(src.name, src.duration, tracks); clip.userData = { checked: true, lib: lib.userData && lib.userData.asset };
      if (self.actions[clip.name]) { self.actions[clip.name].stop(); self.mixer.uncacheAction(self.clips[clip.name]); }
      self.clips[clip.name] = clip;
      var a = self.mixer.clipAction(clip); a.setLoop(T.LoopRepeat, Infinity); a.play(); a.setEffectiveWeight(0);
      self.actions[clip.name] = a; added.push(clip.name);
    });
    this.save();
    return added;
  };

  // ------------------------------------------------------------------ parts, levels of detail
  A.ofKind = function (kind) { return this.meshes.filter(function (m) { return m.userData.kind === kind; }); };
  A.hideKinds = function (list) {
    var h = {}; (list || []).forEach(function (k) { h[k] = true; });
    var key = Object.keys(h).sort().join();
    if (key === this.hiddenKey) return;
    this.hidden = h; this.hiddenKey = key; this.updateVisibility();
  };
  A.hasLod = function (level) { return !!(this.lods[level] && this.lods[level].length); };
  A.updateVisibility = function () {
    var lvl = this.hasLod(this.lodLevel) ? this.lodLevel : this.hasLod(0) ? 0 : 1, h = this.hidden, self = this;
    this.meshes.forEach(function (m) {
      m.visible = m.userData.lod === lvl && !h[m.userData.kind] && !(self.decalOff && m.userData.kind === 'decal');
      if (m.userData.outline) m.userData.outline.visible = !self.hullOff;
    });
  };
  // detail by size on screen: a character a few dozen px tall drops its ink hulls (drawn only when BB.Ink is off,
  // i.e. on the slow path: each is a draw call) and its lettering (unreadable at that size)
  var DETAIL = { hull: 40, decal: 36 };
  A.setDetail = function (px) {
    var hullOff = px < DETAIL.hull, decalOff = px < DETAIL.decal;
    if (hullOff === !!this.hullOff && decalOff === !!this.decalOff) return;
    this.hullOff = hullOff; this.decalOff = decalOff; this.updateVisibility();
  };
  A.setLod = function (level) {
    if (!this.hasLod(level)) level = this.hasLod(0) ? 0 : 1;
    if (level === 0 && (this.hullOff || this.decalOff)) { this.hullOff = this.decalOff = false; this.lodLevel = -1; }   // close-ups: full detail
    if (level !== this.lodLevel) { this.lodLevel = level; this.updateVisibility(); }
  };
  // projected height in px (for LOD choice and budgets)
  A.screenHeight = function (cam, viewH) {
    this.root.getWorldPosition(V); V.z += this.height * this.size * 0.5;
    var d = Math.max(0.1, V.distanceTo(cam.position)), f = viewH / (2 * Math.tan(cam.fov * PI / 360));
    return (this.screenPx = this.height * this.size * f / d);
  };
  // LOD1 when small on screen: projected height in px against a threshold (with hysteresis). Returns the level it
  // would like (0 may be wanted while only LOD1 is loaded: the caller can fetch it)
  A.autoLod = function (cam, viewH, px) {
    if (!cam) return this.lodLevel;
    px = px || 120;
    var h = this.screenHeight(cam, viewH), want = this.lodLevel === 1 ? (h > px * 1.15 ? 0 : 1) : (h < px ? 1 : 0);
    this.setLod(want);
    this.setDetail(h);
    return want;
  };
  // whole-actor frustum culling (skinned meshes keep frustumCulled off: their bind-pose bounds are wrong once posed)
  var _sph = new T.Sphere();
  A.inView = function (frustum) {
    this.root.getWorldPosition(_sph.center); _sph.center.z += this.height * this.size * 0.5;
    _sph.radius = this.height * this.size * 0.8;
    return frustum.intersectsSphere(_sph);
  };
  // a level-of-detail file (same rig and material names): its meshes are re-bound to this actor's bones
  A.addLod = function (gltf, level) {
    var self = this, src = [], grp = new T.Group(); grp.name = 'lod' + level;
    var scene = gltf.scene || gltf.scenes[0];
    scene.updateMatrixWorld(true);
    scene.traverse(function (o) { if (o.isMesh) src.push(o); });
    src.forEach(function (m) { restPositions(m); });            // with the file's own skeleton at rest
    var made = [];
    src.forEach(function (m) {
      var mesh;
      if (m.isSkinnedMesh) {
        var bones = m.skeleton.bones.map(function (b) { return self.bones[nameOf(b)]; });
        if (bones.some(function (b) { return !b; })) { self.warn('lod' + level + ': bones do not match'); return; }
        mesh = new T.SkinnedMesh(m.geometry, m.material);
        mesh.bind(new T.Skeleton(bones, m.skeleton.boneInverses.map(function (x) { return x.clone(); })), m.bindMatrix.clone());
      } else mesh = new T.Mesh(m.geometry, m.material);
      if (m.morphTargetInfluences) { mesh.morphTargetInfluences = m.morphTargetInfluences.slice(); mesh.morphTargetDictionary = m.morphTargetDictionary; }
      mesh.name = m.name; grp.add(mesh); made.push(mesh);
    });
    if (!made.length) return false;
    this.model.add(grp);
    shareSkeletons(grp);
    var faceBefore = this.face.length;
    this.adoptMeshes(grp, level);
    for (var j = faceBefore; j < this.face.length; j++) this.morphSaved.push(this.face[j].morphTargetInfluences.slice());
    this.lodAssets = this.lodAssets || {}; this.lodAssets[level] = gltf;
    this.updateVisibility();
    return true;
  };
  // let go of a level of detail (its file is released back to BB.Assets)
  A.dropLod = function (level) {
    var list = this.lods[level]; if (!list || !level) return;
    var self = this, grp = null;
    list.forEach(function (m) {
      self.meshes.splice(self.meshes.indexOf(m), 1);
      var fi = self.face.indexOf(m); if (fi >= 0) { self.face.splice(fi, 1); self.morphSaved.splice(fi, 1); }
      if (m.skeleton) m.skeleton.dispose();
      grp = m.parent;
      if (m.parent) m.parent.remove(m);
    });
    if (grp && grp.parent) grp.parent.remove(grp);
    delete this.lods[level];
    if (this.lodLevel === level) this.lodLevel = 0;
    if (this.lodAssets && this.lodAssets[level]) { BB.Assets.release(this.lodAssets[level].userData.asset); delete this.lodAssets[level]; }
    this.updateVisibility();
  };

  // ------------------------------------------------------------------ placement & anchors
  // left-handers are the right-handed model mirrored (docs/CAST-CONTRACT.md); three.js flips the winding itself
  A.setMirror = function (on) { this.root.scale.x = on ? -1 : 1; this.mirrored = !!on; };
  A.place = function (x, y, z, yaw, size) {
    this.root.position.set(x, y, z || 0); this.root.rotation.set(0, 0, yaw || 0);
    if (size != null && size !== this.size) { this.size = size; this.up.scale.setScalar(size); }
    this.yaw = yaw || 0;
    this.root.visible = true;
    this.root.updateMatrixWorld(true);
  };
  A.point = function (name, out) {
    var b = this.bones[name]; out = out || new T.Vector3();
    if (!b) return out.copy(this.root.position);
    b.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(b.matrixWorld);
  };
  A.modelPoint = function (b, out) { // bone position in model space (glTF, unscaled)
    b.updateWorldMatrix(true, false);
    out.setFromMatrixPosition(b.matrixWorld);
    M4.copy(this.model.matrixWorld).invert(); out.applyMatrix4(M4);
    return out;
  };
  // a bone's model-space position at a clip time (or a layer list), measured once after loading (sockets at markers)
  A.socketAt = function (layers, name, out) {
    var b = this.bones[name]; out = out || new T.Vector3();
    if (!b) return null;
    this.evaluate(Array.isArray(layers) ? layers : [L(layers.c, layers.t)]);
    this.model.updateMatrixWorld(true);
    return this.modelPoint(b, out);
  };
  // the model-space position of a bone at its bind pose (skin inverse bind matrices), e.g. the hips for retargeting
  A.bindPoint = function (name) {
    var b = this.bones[name], base = this.baseLod || 0, out = null;
    if (!b) return null;
    this.meshes.some(function (m) {
      if (!m.isSkinnedMesh || m.userData.lod !== base) return false;
      var i = m.skeleton.bones.indexOf(b); if (i < 0) return false;
      out = new T.Vector3().setFromMatrixPosition(M4.copy(m.skeleton.boneInverses[i]).invert());
      return true;
    });
    return out;
  };
  // a run cycle played in place: how far the planted foot slides back per clip second (its ground speed at 1x) and
  // per cycle (stride), so the legs can be played at the rate that keeps the feet from skating. The contact point is
  // the lower of ankle and toe; it counts as planted within 0.06 ft of its lowest. Model units (unscaled).
  A.gait = function (c) {
    var d = this.dur(c), n = 80, out = { stride: 0, treadmill: 0 }, back = [], self = this;
    if (!this.has(c)) return out;
    ['L', 'R'].forEach(function (side) {
      var f = self.bones['foot.' + side], to = self.bones['toe.' + side]; if (!f) return;
      var p = [];
      for (var i = 0; i <= n; i++) {
        self.evaluate([L(c, d * i / n)]); self.model.updateMatrixWorld(true);
        var a = self.modelPoint(f, new T.Vector3()), b = to ? self.modelPoint(to, new T.Vector3()) : a;
        p.push(b.y < a.y ? b : a);
      }
      var lo = Math.min.apply(null, p.map(function (q) { return q.y; }));
      for (var j = 0; j < n; j++) if (p[j].y < lo + 0.06 && p[j + 1].y < lo + 0.06) back.push(-(p[j + 1].z - p[j].z) / (d / n));
    });
    if (!back.length) return out;
    back.sort(function (a, b) { return a - b; });
    out.treadmill = back[back.length >> 1];
    out.stride = out.treadmill * d;
    return out;
  };
  A.headPoint = function (out) {
    out = out || new T.Vector3();
    var b = this.bones.head; if (!b) return this.point('root', out).setZ(this.height * this.size * 0.8);
    b.updateWorldMatrix(true, false);
    return out.copy(this.headLocal).applyMatrix4(b.matrixWorld);
  };
  // world-space bounds of the posed body (CPU skinning of every `step`th vertex; for framing and QA, not per frame)
  A.posedBox = function (step) {
    var box = new T.Box3(), v = new T.Vector3();
    step = step || 2;
    this.root.updateMatrixWorld(true);
    this.meshes.forEach(function (m) {
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
  };
  // rest bounds and the head centre (in head-bone space, from the vertices skinned mostly to the head)
  A.measureRest = function () {
    var hb = new T.Box3(), self = this;
    this.meshes.forEach(function (m) {
      if (m.userData.kind !== 'body') return;
      var R = restPositions(m);
      for (var i = 0; i < R.length; i += 3) hb.expandByPoint(V.fromArray(R, i));
    });
    this.restBox = hb; this.height = Math.max(1, hb.max.y - hb.min.y);
    var B = this.bones.head, sum = new T.Vector3(), cnt = 0;
    if (B) this.meshes.forEach(function (m) {
      if (!m.isSkinnedMesh || m.userData.kind !== 'body' || m.userData.lod !== (self.baseLod || 0)) return;
      var bi = m.skeleton.bones.indexOf(B); if (bi < 0) return;
      var P = m.geometry.attributes.position, SI = m.geometry.attributes.skinIndex, SW = m.geometry.attributes.skinWeight;
      var toBone = new T.Matrix4().multiplyMatrices(m.skeleton.boneInverses[bi], m.bindMatrix);
      for (var i = 0; i < P.count; i++) {
        var w = (SI.getX(i) === bi ? SW.getX(i) : 0) + (SI.getY(i) === bi ? SW.getY(i) : 0) + (SI.getZ(i) === bi ? SW.getZ(i) : 0) + (SI.getW(i) === bi ? SW.getW(i) : 0);
        if (w < 0.6) continue;
        sum.add(V.fromBufferAttribute(P, i).applyMatrix4(toBone)); cnt++;
      }
    });
    this.headLocal = cnt ? sum.multiplyScalar(1 / cnt) : new T.Vector3(0, 0.6, 0);
  };
  // a static copy of the meshes of one kind (e.g. the bat) in a bone's space, with toon materials and outlines: a prop
  // that can leave the character (a bat lying in the dirt, a flipped bat tumbling on)
  A.makeProp = function (kind, boneName) {
    var list = (this.lods[this.baseLod || 0] || []).filter(function (m) { return m.userData.kind === kind; }), bone = this.bones[boneName];
    if (!list.length || !bone) return null;
    var grp = new T.Group(); grp.name = this.asset + '_' + kind + '_prop';
    list.forEach(function (src) {
      var g = floatGeometry(src.geometry), bi = -1, Mx = new T.Matrix4();
      if (src.isSkinnedMesh) bi = src.skeleton.bones.indexOf(bone);
      if (bi >= 0) Mx.multiplyMatrices(src.skeleton.boneInverses[bi], src.bindMatrix);
      else { src.updateWorldMatrix(true, false); bone.updateWorldMatrix(true, false); Mx.copy(bone.matrixWorld).invert().multiply(src.matrixWorld); }
      g.applyMatrix4(Mx);
      var on = g.attributes.onormal;
      if (on) { var nm = new T.Matrix3().getNormalMatrix(Mx), v = new T.Vector3(); for (var i = 0; i < on.count; i++) { v.fromBufferAttribute(on, i).applyMatrix3(nm).normalize(); on.setXYZ(i, v.x, v.y, v.z); } }
      g.computeBoundingSphere();
      var m = new T.Mesh(g, src.material);
      m.frustumCulled = false; m.layers.enable(1); m.userData.inkId = src.userData.inkId;
      var h = new T.Mesh(g, TN.OUTLINE); h.renderOrder = 1; h.userData.isOutline = true; m.add(h); m.userData.outline = h;
      grp.add(m);
    });
    grp.visible = false;
    return grp;
  };
  A.info = function () {
    var self = this, o = { asset: this.asset, warnings: this.warnings.slice(), clips: Object.keys(this.clips).map(function (c) { return c + ' ' + self.clips[c].duration.toFixed(2) + 's'; }) };
    var lod = function (l) { return (self.lods[l] || []).reduce(function (s, m) { var g = m.geometry; return s + (g.index ? g.index.count : g.attributes.position.count) / 3; }, 0); };
    o.triangles = lod(0); if (this.lods[1]) o.lod1Triangles = lod(1);
    var bl = this.lods[this.baseLod || 0] || [];
    o.drawCalls = bl.length + bl.filter(function (m) { return m.userData.outline; }).length;
    o.materials = Object.keys(this.colors).map(function (n) { return n + ' ' + self.colors[n]; });
    o.droppedTracks = this.dropped; o.bones = this.allBones.length; o.restHeight = +this.height.toFixed(3);
    return o;
  };
  A.dispose = function () {
    if (this.disposed) return;
    this.disposed = true;
    if (this.root.parent) this.root.parent.remove(this.root);
    for (var n in this.mats) this.mats[n].dispose();
    for (var k in this.decalTex) this.decalTex[k].dispose();
    this.mixer.stopAllAction();
    this.meshes.forEach(function (m) { if (m.skeleton) m.skeleton.dispose(); });
    if (this.lodAssets) for (var l in this.lodAssets) BB.Assets.release(this.lodAssets[l].userData.asset);
    BB.Assets.release(this.gltf.userData.asset || this.asset);
  };

  // ------------------------------------------------------------------ kinds & creation
  // define(kind, cfg). cfg: { palette: {material: '#hex'} contract colours, team: {material: 'a'|'b'} uniform slots,
  //   hull: {material: weight} (0 = no hull), ink: {material: BB.Ink weight}, decals: {material: {text, side}},
  //   props: {material: kind} (e.g. 'bat'), emissive: {material: '#hex'}, bones: [...] expected, need: [...] required,
  //   clips: [...] expected, needClips: [...], shapes: [...], idle: clip, eyeSquash: bool, inkBase, shadow: [sx, sy] }
  function define(kind, cfg) { cfg.kind = kind; cfg.palette = cfg.palette || {}; KINDS[kind] = cfg; return cfg; }
  // create(kind, {asset, colors, inkBase}) -> Promise<Actor>; release with actor.dispose()
  function create(kind, opts) {
    opts = opts || {};
    var cfg = KINDS[kind]; if (!cfg) return Promise.reject(new Error('BB.Actors: unknown kind ' + kind));
    var asset = opts.asset || kind;
    return BB.Assets.load(asset).then(function (g) {
      try { return new Actor(g, cfg, Object.assign({ asset: asset }, opts)); }
      catch (e) { BB.Assets.release(asset); throw e; }
    });
  }
  // add a level of detail from '<asset>_lod<level>' (docs/CAST-CONTRACT.md: char_<id>_lod1) if the build has one;
  // loadLevel(actor, file, level) adds any file as a level (e.g. LOD0 for a fielder that came close)
  function loadLod(actor, level) { return loadLevel(actor, actor.asset + '_lod' + level, level); }
  function loadLevel(actor, name, level) {
    if (!BB.Assets.has(name)) return Promise.resolve(false);
    if (actor.lods[level] && actor.lods[level].length) return Promise.resolve(true);
    actor.lodPending = actor.lodPending || {};
    if (actor.lodPending[level]) return actor.lodPending[level];
    return (actor.lodPending[level] = BB.Assets.load(name).then(function (g) {
      var ok = false;
      delete actor.lodPending[level];
      if (actor.disposed) { BB.Assets.release(name); return false; }
      try { ok = actor.addLod(g, level); } catch (e) { actor.warn('lod' + level + ': ' + (e.message || e)); }
      if (!ok) BB.Assets.release(name);
      return ok;
    }, function (e) { delete actor.lodPending[level]; throw e; }));
  }
  // the phase B cast (docs/CAST-CONTRACT.md): one description for every character file; per character: colours from
  // the model (fur, markings), team colours and decal text (team letter, card number) per instance
  define('cast', {
    team: { team_a: 'a', team_b: 'b', cap: 'a', cap_brim: 'brim', decal_chest: 'a', decal_back: 'a' }, teamFallback: { brim: 'a' },
    hull: { pupil: 0, tongue: 0, teeth: 0.5, mouth: 0.4, nose: 0.6, eye_white: 0.55, lace: 0.45, mitt_lace: 0.45, sole: 0.9, decal_chest: 0, decal_back: 0 },
    ink: { pupil: 0.55, eye_white: 0.7, nose: 0.8, mouth: 0.7, tongue: 0.6, teeth: 0.6, lace: 0.6, mitt_lace: 0.6 },
    decals: { decal_chest: { text: '?', side: 'front' }, decal_back: { text: '?', side: 'back' } },
    props: { mitt: 'mitt', mitt_lace: 'mitt' },
    emissive: { eye_white: '#3A3A3A' },
    bones: ['root', 'hips', 'spine', 'chest', 'neck', 'head', 'eye.L', 'eye.R', 'shoulder.L', 'shoulder.R', 'upper_arm.L', 'upper_arm.R', 'forearm.L', 'forearm.R',
      'hand.L', 'hand.R', 'fingers.L', 'fingers.R', 'thigh.L', 'thigh.R', 'shin.L', 'shin.R', 'foot.L', 'foot.R', 'toe.L', 'toe.R'],
    need: ['root', 'head'],
    shapes: ['blink', 'smile', 'grin', 'frown', 'mouth_open', 'brows_up', 'brows_angry', 'brows_sad', 'squint', 'cheeks_puff', 'smirk'],
    eyeSquash: true, trustModelColors: true,
  });
  return { available: true, define: define, create: create, loadLod: loadLod, loadLevel: loadLevel, sampleCurve: sampleCurve, kinds: KINDS, Actor: Actor,
    L: L, mixL: mixL, twos: twos, onTwos: onTwos, warp: warp, HULL: HULL, restPositions: restPositions };
})();
