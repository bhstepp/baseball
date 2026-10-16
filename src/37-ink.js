// 37-ink.js — BB.Ink: the hand-inked look over the 3D renderer (three.js r149). Owned by the ink agent.
// See docs/PILOT-ROCCO.md ("Ink look", "Conventions shared by everyone").
//
// When BB.Ink.active(), BB.Render (35-scene.js) hands each frame to BB.Ink.render() instead of renderer.render():
//   1. NORMALS  Layer-1 objects (characters, gear, bat, ball: "layer 1 = inked") are drawn into a small target with
//      one override material (skinning and morph targets supported) that writes the view-space normal, an object
//      id and a per-object line weight, plus a depth texture. The painted ground layers (and anything on layer 3,
//      "ink ground") go in first, depth only, so feet sunk in the dirt are cut where the picture cuts them, and get
//      their outline along the ground. Layer-2-only objects ("ink occluders", optional: walls, stands) are drawn
//      there too, as masks: lines behind them are hidden and their edges draw no line.
//   2. EDGES    Silhouettes (inked vs empty), occluding contours (a neighbour off the tangent plane), object and
//      colour boundaries (id changes) and creases (normal Laplacian) become pen widths: heavy silhouettes, lighter
//      interior lines, thinner with distance (interior lines also fade out on far figures), heavier on the side
//      away from the key light, and a slow brush-pressure swell re-rolled 12 times a second.
//   3. NIB      Two separable passes stamp a round nib of that width on every edge texel (max of r^2 - d^2: the
//      exact union of discs in 2 x (2R+1) taps) and store the signed distance to the stroke edge.
//   4. PICTURE  The scene is drawn to the canvas exactly as without ink (MSAA intact), with the inverted-hull
//      outlines hidden: the ink pass draws every line. (Hulls come back when nothing on layer 1 is in view.)
//   5. OVERLAY  Straight after the picture, in the same framebuffer (on tile GPUs it blends in tile memory): one
//      full-screen pass multiplied onto the picture (like ink and paint on paper) draws the strokes anti-aliased from
//      the distance field (smoothed with 4 taps, with a boil: a UV jitter re-rolled on twos), a static paper grain, a
//      gentle warm tint and a soft vignette. Backgrounds (layer 0 only) get no lines.
// Quality: low / medium / high = normals target at 1 / 1.5 / 2 texels per CSS px (never above the canvas). It
// steps down by itself while the median frame interval stays over 20 ms, switches off below 'low', and stays off
// once BB.Render has dropped its pixel ratio. `?ink=0` turns it off, `?ink=1` forces it on, `?ink=low|medium|high`
// pins a level.
//
// API: active(), render(renderer, scene, camera, info), resize(renderer, w, h, pr), twos(t), setEnabled(on),
//      enabled / quality / level (read-only), setQuality(1..3 | name), setAuto(on), stats(), hullsVisible(),
//      registerHull(material), mark(root, opts) (helper: put a character/prop on layer 1),
//      debug(mode) ('normals' | 'edges' | 'nib' | 'lines' | null: show an intermediate target instead of the frame).
(function () {
  var T = (typeof THREE !== 'undefined') ? THREE : null;
  function clock() { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); }
  if (!T) {
    BB.Ink = {
      active: function () { return false; }, render: function (r, s, c) { r.render(s, c); }, resize: function () {},
      twos: function (t) { return t; }, setEnabled: function () {}, enabled: false, quality: 'off', level: 0, setAuto: function () {},
      setQuality: function () {}, stats: function () { return { active: false, reason: 'no three.js' }; }, setHulls: function () {},
      hullsVisible: function () { return true; }, registerHull: function () {}, mark: function (o) { return o; }, debug: function () {},
    };
    return;
  }

  // ------------------------------------------------------------------ tunables
  var CFG = {
    ink: '#1B1420',
    // full stroke widths in CSS px at the reference scale (a 5-ft character ~340 px tall)
    width: { sil: 3.4, contour: 2.5, edge: 1.7, crease: 1.6 },
    // stroke style per edge type: 0 = solid ink, 1 = a darker shade of the colour underneath
    style: { sil: 0, contour: 0, edge: 0.2, crease: 0.25 },
    colorLine: 0.42,          // brightness of a style-1 line relative to the fill under it (ink lines: x ink colour)
    ppfRef: 64, attMin: 0.4, attMax: 1.12,   // thinner with distance: sqrt(px-per-ft / ppfRef), clamped
    fade: [9, 34, 0.6],       // interior lines fade out between these px-per-ft (contours keep at least [2])
    shadowSide: 0.4,          // extra weight on edges facing away from the key light
    pressure: 0.12,           // brush-pressure swell (fraction of the width), re-rolled on twos
    pressureWave: 42,         // its wavelength along the stroke, CSS px
    boil: 0.55,               // UV boil amplitude, CSS px, re-rolled on twos
    boilWave: 48,             // boil wavelength, CSS px
    gap: [1.5, 3.0],          // occluding contour: neighbour off the tangent plane by this many texels (ramp)
    crease: [0.3, 0.65],      // crease: |normal Laplacian| ramp
    minW: 1.0,                // thinnest stroke, texels; thinner strokes fade instead of breaking up
    // the grade multiplies the picture (like transparent ink and paint on paper): blacks stay black, colours stay rich
    tint: [1.0, 0.988, 0.955], // warm: a touch less blue and green
    grain: 0.028, mottle: 0.08, vignette: 0.09,
    slowMs: 20,               // median frame interval that counts as slow
  };
  var LEVELS = [null, { name: 'low', q: 1.0 }, { name: 'medium', q: 1.5 }, { name: 'high', q: 2.0 }];
  var MAX_R_PX = 2.9;         // largest nib radius we can draw, CSS px (sets the dilation kernel size)

  // ------------------------------------------------------------------ state
  var S = {
    enabled: true, forced: false, off: '', level: 2, startLevel: 2, auto: true, hulls: false, ok: null, err: '',
    key: '', nW: 0, nH: 0, dbW: 0, dbH: 0, cssW: 0, cssH: 0, rmax: 2,
    rtN: null, rtE: null, rtH: null, rtD: null,
    samples: [], lastT: 0, warm: 0, med: 0, cpuMs: 0, frames: 0, drawn: 0, occl: 0, calls: {}, seedK: 0, lastTick: -1,
    light: null, lightScan: -1e9, debug: '', hullMats: [], hullVis: [], hullAll: [], inked: false,
    grounds: [], gShown: [], gSig: 0, gScene: null, groundPass: false, grounds_: 0,
    now: clock,   // frame clock (tests swap it to drive the adaptive quality)
  };
  (function urlFlag() {
    var m = /[?&]ink=([^&#]*)/.exec((typeof location !== 'undefined' && location.search) || '');
    if (!m) return;
    var v = decodeURIComponent(m[1]).toLowerCase();
    if (v === '0' || v === 'off' || v === 'false' || v === 'no') S.enabled = false;
    else if (v === '1' || v === 'on' || v === 'true' || v === 'yes') S.forced = true;
    else if (v === 'low' || v === 'medium' || v === 'med' || v === 'high') {
      S.forced = true; S.auto = false; S.level = S.startLevel = v === 'low' ? 1 : v === 'high' ? 3 : 2;
    }
    // anything else (e.g. a colour-scheme id in the render harness) is not ours
  })();

  // ------------------------------------------------------------------ shader bits
  var NOISE = [
    'float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }',
    'float vnoise(vec2 p) {',
    '  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);',
    '}'].join('\n');
  var FS_VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

  // 1. normals / id / weight of layer-1 objects (layer-2-only objects: occluder masks). Skinning + morphs via chunks.
  //    rgba = (normal.xy * 0.5 + 0.5, id, weight * 0.5); empty = 0; occluder = (.5, .5, 1, 0)
  var NMAT = new T.ShaderMaterial({
    uniforms: { uId: { value: 0 }, uW: { value: 0.5 }, uSkip: { value: 0 }, uOcc: { value: 0 } },
    vertexShader: [
      '#include <common>',
      '#include <morphtarget_pars_vertex>',
      '#include <skinning_pars_vertex>',
      'uniform float uSkip;',
      'varying vec3 vN;',
      'void main() {',
      '  #include <beginnormal_vertex>',
      '  #include <morphnormal_vertex>',
      '  #include <skinbase_vertex>',
      '  #include <skinnormal_vertex>',
      '  vec3 nrm = objectNormal;',
      '  #ifdef USE_INSTANCING',
      '    mat3 im = mat3(instanceMatrix); nrm /= vec3(dot(im[0], im[0]), dot(im[1], im[1]), dot(im[2], im[2])); nrm = im * nrm;',
      '  #endif',
      '  vN = normalMatrix * nrm;',
      '  #include <begin_vertex>',
      '  #include <morphtarget_vertex>',
      '  #include <skinning_vertex>',
      '  #include <project_vertex>',
      '  if (uSkip > 0.5) gl_Position = vec4(0.0, 0.0, -2.0, 1.0);', // skipped: outside the clip volume
      '}'].join('\n'),
    fragmentShader: [
      'uniform float uId; uniform float uW; uniform float uOcc;',
      'varying vec3 vN;',
      'void main() {',
      '  vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;',
      '  gl_FragColor = uOcc > 1.5 ? vec4(0.0) : uOcc > 0.5 ? vec4(0.5, 0.5, 1.0, 0.0) : vec4(n.xy * 0.5 + 0.5, uId, uW);',
      '}'].join('\n'),
  });
  var L1 = 2, L2 = 4, L3 = 8; // layer masks: 1 inked, 2 occluder (no lines), 3 ground (lines)
  NMAT.onBeforeRender = function (renderer, scene, camera, geometry, object, group) {
    var u = this.uniforms, m = object.material;
    if (Array.isArray(m)) m = m[(group && group.materialIndex) || 0];
    var skip = !object.isMesh || !m || noInk(object, m);
    var occ = !skip && (object.layers.mask & L1) === 0;
    u.uSkip.value = skip ? 1 : 0;
    u.uOcc.value = S.groundPass ? 2 : occ ? 1 : 0;
    if (!skip) {
      var ud = object.userData || {};
      var id = ud.inkId != null ? ud.inkId : object.id;
      u.uId.value = ((Math.imul((id | 0) + 0x51ED27, 0x9E3779B1) >>> 24) % 251 + 3) / 255;
      u.uW.value = Math.max(1 / 255, Math.min(1, (ud.inkWeight != null ? ud.inkWeight : 1) * 0.5));
      this.side = m.side != null ? m.side : T.FrontSide;
      if (S.groundPass) S.grounds_++; else if (occ) S.occl++; else S.drawn++;
    }
    this.uniformsNeedUpdate = true;
  };
  // never inked: hulls, decals (open quads printed on a surface), see-through FX, depth-only helpers, opt-outs
  function noInk(o, m) {
    return !!((o.userData && o.userData.noInk) || isHull(m) || (m.transparent && m.depthWrite === false) || m.colorWrite === false ||
      (m.name && m.name.indexOf('decal') >= 0) || (o.name && o.name.indexOf('decal') >= 0));
  }
  function isHull(m) {
    if (m.userData && m.userData.inkHull) return true;
    if (BB.Toon && m === BB.Toon.OUTLINE) return true;
    for (var i = 0; i < S.hullMats.length; i++) if (S.hullMats[i] === m) return true;
    return false;
  }

  // 3. edges -> nib per texel: r = nib radius / rmax (radius measured from the texel centre), g = opacity,
  //    b = style, a = 1 on edge texels. Both texels either side of an edge are marked (the stroke is centred on it).
  var EMAT = new T.ShaderMaterial({
    uniforms: {
      tN: { value: null }, tZ: { value: null }, uTexel: { value: new T.Vector2() }, uPj: { value: new T.Vector4() }, uPz: { value: new T.Vector2() },
      uP11: { value: 1 }, uCssH: { value: 844 }, uPx: { value: 1 }, uWid: { value: new T.Vector4() }, uSty: { value: new T.Vector4() },
      uAtt: { value: new T.Vector4() }, uFade: { value: new T.Vector3() }, uLight: { value: new T.Vector3() }, uSeed: { value: new T.Vector2() },
      uPress: { value: 0.2 }, uPressF: { value: 0.04 }, uRmax: { value: 2 }, uMinW: { value: 1 }, uGap: { value: new T.Vector2() }, uCrease: { value: new T.Vector2() },
    },
    vertexShader: FS_VERT,
    fragmentShader: [
      'uniform sampler2D tN; uniform sampler2D tZ;',
      'uniform vec2 uTexel; uniform vec4 uPj; uniform vec2 uPz; uniform float uP11; uniform float uCssH; uniform float uPx;',
      'uniform vec4 uWid; uniform vec4 uSty; uniform vec4 uAtt; uniform vec3 uFade; uniform vec3 uLight; uniform vec2 uSeed;',
      'uniform float uPress; uniform float uPressF; uniform float uRmax; uniform float uMinW; uniform vec2 uGap; uniform vec2 uCrease;',
      'varying vec2 vUv;',
      NOISE,
      'float isInk(vec4 v) { return step(0.002, v.a); }',
      'float isOcc(vec4 v) { return (1.0 - step(0.002, v.a)) * step(0.5, v.b); }',
      'vec3 decN(vec4 v) { vec2 n = v.xy * 2.0 - 1.0; return vec3(n, sqrt(max(0.0, 1.0 - dot(n, n)))); }',
      // view-space position from the depth texture (perspective: P = [P00 0 P20 0; 0 P11 P21 0; 0 0 P22 P32; 0 0 -1 0])
      'vec3 vpos(vec2 uv) { float z = -uPz.y / (texture2D(tZ, uv).x * 2.0 - 1.0 + uPz.x); return vec3(-z * (uv * 2.0 - 1.0 + uPj.zw) / uPj.xy, z); }',
      'float ppf(float dist) { return uCssH * 0.5 * uP11 / max(dist, 0.05); }',          // css px per foot at that depth
      'float att(float dist) { return clamp(sqrt(ppf(dist) / uAtt.x), uAtt.z, uAtt.w); }',
      'float fadeI(float dist) { return smoothstep(uFade.x, uFade.y, ppf(dist)); }',
      'float shade(vec4 v) { vec2 d = v.xy * 2.0 - 1.0; float l = length(d); return 1.0 + uLight.z * (l > 0.05 ? smoothstep(-0.15, 0.8, -dot(d / l, uLight.xy)) : 0.0); }',
      // (width css px, style, opacity) for the edge between this texel (c, at pc) and the neighbour q at uvq
      'vec3 pairEdge(vec4 c, float ic, float oc, vec3 pc, vec4 q, vec2 uvq) {',
      '  float iq = isInk(q), oq = isOcc(q);',
      '  if (ic + iq < 0.5) return vec3(0.0);',
      '  if (ic + iq < 1.5) {',                                     // silhouette: inked next to empty
      '    if (oc + oq > 0.5) return vec3(0.0);',                     // ...unless the other side is an occluder
      '    vec4 m = ic > 0.5 ? c : q; vec3 pm = ic > 0.5 ? pc : vpos(uvq);',
      '    return vec3(uWid.x * att(-pm.z) * shade(m) * m.a * 2.0, uSty.x, 1.0);',
      '  }',
      '  vec3 pq = vpos(uvq), nc = decN(c), nq = decN(q);',
      '  float front = min(-pc.z, -pq.z);',
      '  float tw = 2.0 * front / (uP11 * uCssH * uPx);',              // world size of one texel at that depth
      '  float gap = max(abs(dot(pq - pc, nc)), abs(dot(pc - pq, nq))) / tw;',
      '  float jump = smoothstep(uGap.x, uGap.y, gap);',
      '  float idd = step(0.003, abs(c.b - q.b));',
      '  vec4 fm = -pc.z < -pq.z ? c : q;',
      '  float a = att(front) * fm.a * 2.0, fi = fadeI(front);',
      '  float rc = jump * uWid.y * shade(fm) * a, rb = idd * uWid.z * a;',
      '  return rc >= rb ? vec3(rc, uSty.y, mix(uFade.z, 1.0, fi)) : vec3(rb, uSty.z, fi);',
      '}',
      'void main() {',
      '  vec2 dx = vec2(uTexel.x, 0.0), dy = vec2(0.0, uTexel.y);',
      '  vec4 c = texture2D(tN, vUv), l = texture2D(tN, vUv - dx), r = texture2D(tN, vUv + dx), b = texture2D(tN, vUv - dy), t = texture2D(tN, vUv + dy);',
      '  float ic = isInk(c), il = isInk(l), ir = isInk(r), ib = isInk(b), it = isInk(t);',
      '  if (ic + il + ir + ib + it < 0.5) { gl_FragColor = vec4(0.0); return; }',
      '  float oc = isOcc(c);',
      '  vec3 pc = vpos(vUv);',
      '  vec3 e = pairEdge(c, ic, oc, pc, l, vUv - dx), e2;',
      '  e2 = pairEdge(c, ic, oc, pc, r, vUv + dx); if (e2.x * e2.z > e.x * e.z) e = e2;',
      '  e2 = pairEdge(c, ic, oc, pc, b, vUv - dy); if (e2.x * e2.z > e.x * e.z) e = e2;',
      '  e2 = pairEdge(c, ic, oc, pc, t, vUv + dy); if (e2.x * e2.z > e.x * e.z) e = e2;',
      '  if (ic > 0.5) {',                                          // crease: |Laplacian of the normal| along x / y
      '    float sx = il * ir * step(abs(l.b - c.b) + abs(r.b - c.b), 0.003);',
      '    float sy = ib * it * step(abs(b.b - c.b) + abs(t.b - c.b), 0.003);',
      '    float k = max(length((l.xy + r.xy - 2.0 * c.xy) * 2.0) * sx, length((b.xy + t.xy - 2.0 * c.xy) * 2.0) * sy);',
      '    float wk = smoothstep(uCrease.x, uCrease.y, k) * uWid.w * att(-pc.z) * c.a * 2.0, ok = fadeI(-pc.z);',
      '    if (wk * ok > e.x * e.z) e = vec3(wk, uSty.w, ok);',
      '  }',
      '  if (e.x * e.z <= 0.0) { gl_FragColor = vec4(0.0); return; }',
      '  e.x *= 1.0 + uPress * (vnoise(gl_FragCoord.xy * uPressF + uSeed) * 2.0 - 1.0);',
      '  float w = e.x * uPx;',                                       // stroke width in texels
      '  float op = e.z * clamp(w / uMinW, 0.0, 1.0); w = max(w, uMinW);',
      '  gl_FragColor = vec4(clamp((w * 0.5 - 0.5) / uRmax, 0.0, 1.0), op, e.y, 1.0);', // the marked band is 1 texel wide each side
      '}'].join('\n'),
    depthTest: false, depthWrite: false,
  });

  // 4. nib, separable: H: G(x,y) = max_i (r^2 - i^2) along x;  V: F = max_j (G(x,y+j) - j^2), D = F / 2r (~ signed
  //    distance to the stroke edge, texels). H out: r = sqrt-encoded G, g = winner radius / rmax, b = style, a = opacity.
  //    V out: r = D / rmax * 0.5 + 0.5 (linear, so bilinear filtering stays a distance), g = opacity, b = style.
  var NIBS = {};
  function nibMats(rmax) {
    var R = Math.ceil(rmax), k = rmax.toFixed(3);
    if (NIBS[k]) return NIBS[k];
    var i, h = [], v = [];
    for (i = -R; i <= R; i++) {
      var o = i.toFixed(1), i2 = (i * i).toFixed(1);
      h.push('  e = texture2D(tE, vUv + vec2(' + o + ', 0.0) * uTexel); if (e.a > 0.5) { rr = e.r * uRmax; f = rr * rr - ' + i2 + '; if (f > best) { best = f; w = vec3(e.r, e.b, e.g); } }');
      v.push('  e = texture2D(tE, vUv + vec2(0.0, ' + o + ') * uTexel); if (e.a > 0.0) { s = e.r * 2.0 - 1.0; f = s * abs(s) * uRmax * uRmax - ' + i2 + '; if (f > best) { best = f; w = e.gba; } }');
    }
    function mat(body, out) {
      return new T.ShaderMaterial({
        uniforms: { tE: { value: null }, uTexel: { value: new T.Vector2() }, uRmax: { value: rmax } },
        vertexShader: FS_VERT,
        fragmentShader: ['uniform sampler2D tE; uniform vec2 uTexel; uniform float uRmax; varying vec2 vUv;',
          'void main() {', '  float best = -1e9, f, rr, s; vec3 w = vec3(0.0); vec4 e;'].concat(body, out, ['}']).join('\n'),
        depthTest: false, depthWrite: false,
      });
    }
    NIBS[k] = {
      h: mat(h, ['  if (best < -1e8) { gl_FragColor = vec4(0.0); return; }',
        '  float g = clamp(best / (uRmax * uRmax), -1.0, 1.0);',
        '  gl_FragColor = vec4(sign(g) * sqrt(abs(g)) * 0.5 + 0.5, w);']),
      v: mat(v, ['  if (best < -1e8) { gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0); return; }',
        '  float d = best / (2.0 * max(w.x * uRmax, 0.5));',
        '  gl_FragColor = vec4(clamp(d / uRmax, -1.0, 1.0) * 0.5 + 0.5, w.z, w.y, 1.0);']),
    };
    return NIBS[k];
  }

  // 5. overlay: strokes + paper + grade + vignette, multiplied onto the picture already on the canvas
  var OMAT = new T.ShaderMaterial({
    uniforms: {
      tD: { value: null }, tG: { value: null }, uTexelN: { value: new T.Vector2() }, uRmax: { value: 2 }, uDevPerTex: { value: 2 },
      uBoil: { value: 0.6 }, uBoilF: { value: 0.02 }, uBoilSeed: { value: new T.Vector2() }, uInk: { value: new T.Color(CFG.ink) },
      uTint: { value: new T.Vector3(1, 1, 1) }, uVig: { value: 0.1 }, uGrain: { value: new T.Vector2() }, uColMul: { value: 0.4 },
      uGrainScale: { value: 1 / 256 }, uLines: { value: 1 },
    },
    vertexShader: FS_VERT,
    fragmentShader: [
      'uniform sampler2D tD; uniform sampler2D tG; uniform vec2 uTexelN; uniform float uRmax; uniform float uDevPerTex;',
      'uniform float uBoil; uniform float uBoilF; uniform vec2 uBoilSeed; uniform vec3 uInk; uniform vec3 uTint;',
      'uniform float uVig; uniform vec2 uGrain; uniform float uColMul; uniform float uGrainScale; uniform float uLines;',
      'varying vec2 vUv;',
      NOISE,
      'vec3 nib(vec2 uv) { vec4 e = texture2D(tD, uv); return vec3((e.r * 2.0 - 1.0) * uRmax, e.g, e.b); }', // (distance texels, opacity, style)
      'void main() {',
      '  vec4 g = texture2D(tG, gl_FragCoord.xy * uGrainScale);',
      '  float cov = 0.0, sty = 0.0;',
      '  if (uLines > 0.5) {',
      '    vec2 tc = vUv / uTexelN * uBoilF + uBoilSeed;',
      '    vec2 uv = vUv + (vec2(vnoise(tc), vnoise(tc + vec2(19.7, 41.3))) * 2.0 - 1.0) * uBoil * uTexelN;',
      '    vec2 o = uTexelN * 0.5;',                                    // 4 bilinear taps: a smooth reconstruction
      '    vec3 a = 0.25 * (nib(uv + vec2(-o.x, -o.y)) + nib(uv + vec2(o.x, -o.y)) + nib(uv + vec2(-o.x, o.y)) + nib(uv + o));',
      '    cov = clamp(a.x * uDevPerTex + 0.5, 0.0, 1.0) * min(1.0, a.y * 1.15) * (0.92 + 0.08 * g.b);', // + a touch of dry brush
      '    sty = a.z;',
      '  }',
      '  float paper = 1.0 - uGrain.x * (1.0 - g.r) - uGrain.y * (1.0 - g.g);',      // tooth and mottling only darken
      '  vec2 p = (vUv - 0.5) * 2.0;',
      '  float vig = 1.0 - uVig * smoothstep(0.45, 1.5, length(p * vec2(0.8, 1.0)));',
      '  vec3 grade = uTint * (paper * vig);',
      '  vec3 line = mix(uInk, vec3(uColMul), sty) * vig;',                       // ink, or a darker shade of the fill
      '  gl_FragColor = vec4(mix(grade, line, cov), 1.0);',                        // multiplied onto the picture
      '}'].join('\n'),
    depthTest: false, depthWrite: false, transparent: true,
    blending: T.CustomBlending, blendEquation: T.AddEquation, blendSrc: T.ZeroFactor, blendDst: T.SrcColorFactor,
  });

  // debug views of the intermediate targets (BB.Ink.debug(mode)), drawn opaque over the canvas
  var XMAT = new T.ShaderMaterial({
    uniforms: { tN: { value: null }, tE: { value: null }, tD: { value: null }, uMode: { value: 0 }, uRmax: { value: 2 }, uDevPerTex: { value: 2 }, uInk: { value: new T.Color(CFG.ink) } },
    vertexShader: FS_VERT,
    fragmentShader: [
      'uniform sampler2D tN; uniform sampler2D tE; uniform sampler2D tD; uniform float uMode; uniform float uRmax; uniform float uDevPerTex; uniform vec3 uInk; varying vec2 vUv;',
      'void main() {',
      '  if (uMode < 1.5) { vec4 n = texture2D(tN, vUv); gl_FragColor = n.a > 0.002 ? vec4(n.xy, 1.0, 1.0) * (0.75 + 0.25 * fract(n.b * 7.0)) : (n.b > 0.5 ? vec4(0.3, 0.3, 0.3, 1.0) : vec4(1.0)); return; }',
      '  if (uMode < 2.5) { vec4 e = texture2D(tE, vUv); gl_FragColor = e.a > 0.5 ? vec4(0.25 + e.r * 3.0, e.g, e.b, 1.0) : vec4(0.0, 0.0, 0.0, 1.0); return; }',
      '  vec4 d = texture2D(tD, vUv); float cov = clamp((d.r * 2.0 - 1.0) * uRmax * uDevPerTex + 0.5, 0.0, 1.0) * d.g;',
      '  if (uMode < 3.5) { gl_FragColor = vec4(d.r, d.g, cov, 1.0); return; }',
      '  gl_FragColor = vec4(mix(vec3(1.0, 0.98, 0.94), uInk, cov), 1.0);',
      '}'].join('\n'),
    depthTest: false, depthWrite: false,
  });
  var DEBUG_MODES = { normals: 1, edges: 2, nib: 3, lines: 4 };

  // full-screen triangle
  var FS_GEO = new T.BufferGeometry();
  FS_GEO.setAttribute('position', new T.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  FS_GEO.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  var FS_MESH = new T.Mesh(FS_GEO, OMAT); FS_MESH.frustumCulled = false;
  var FS_SCENE = new T.Scene(); FS_SCENE.add(FS_MESH); FS_SCENE.matrixWorldAutoUpdate = false;
  var FS_CAM = new T.Camera();
  // a stand-in scene that shares the real scene's children (own render lists / light state, no matrix update)
  var PROXY = new T.Scene(); PROXY.matrixWorldAutoUpdate = false; PROXY.overrideMaterial = NMAT;

  // ------------------------------------------------------------------ paper grain (static, tileable, 256^2)
  // r: fine tooth + fibres, g: soft mottling, b: a coarser tooth used to break up the ink a touch. Made on first use.
  var GRAIN = null;
  function grainTex() {
    var N = 256, rnd = BB.U ? BB.U.rng(0x5EED1E) : Math.random;
    function layer(cell) {
      var n = N / cell, lat = new Float32Array(n * n), out = new Float32Array(N * N), i, x, y;
      for (i = 0; i < n * n; i++) lat[i] = rnd();
      for (y = 0; y < N; y++) for (x = 0; x < N; x++) {
        var fx = x / cell, fy = y / cell, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
        tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
        var a = lat[(y0 % n) * n + x0 % n], b = lat[(y0 % n) * n + (x0 + 1) % n], c = lat[((y0 + 1) % n) * n + x0 % n], d = lat[((y0 + 1) % n) * n + (x0 + 1) % n];
        out[y * N + x] = (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
      }
      return out;
    }
    var t1 = layer(2), t2 = layer(4), t3 = layer(8), m1 = layer(64), m2 = layer(32);
    var fib = new Float32Array(N * N), i, k;
    for (k = 0; k < 420; k++) { // short wavy fibres
      var x = rnd() * N, y = rnd() * N, a = rnd() * Math.PI * 2, len = 6 + rnd() * 18, v = rnd() < 0.5 ? 1 : -1;
      for (var s = 0; s < len; s++) {
        a += (rnd() - 0.5) * 0.35; x += Math.cos(a); y += Math.sin(a);
        var ix = ((Math.round(x) % N) + N) % N, iy = ((Math.round(y) % N) + N) % N;
        fib[iy * N + ix] += v * 0.6;
      }
    }
    var d = new Uint8Array(N * N * 4);
    function u8(f) { return Math.max(0, Math.min(255, Math.round(f * 255))); }
    for (i = 0; i < N * N; i++) {
      var tooth = 0.45 * t1[i] + 0.35 * t2[i] + 0.2 * t3[i] + fib[i] * 0.16 + (rnd() - 0.5) * 0.1;
      d[4 * i] = u8((tooth - 0.5) * 1.6 + 0.5);
      d[4 * i + 1] = u8(((0.6 * m1[i] + 0.4 * m2[i]) - 0.5) * 2.0 + 0.5);
      d[4 * i + 2] = u8(0.5 + (t2[i] - 0.5) * 1.4 + fib[i] * 0.3);
      d[4 * i + 3] = 255;
    }
    var tex = new T.DataTexture(d, N, N, T.RGBAFormat);
    tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.magFilter = T.LinearFilter; tex.minFilter = T.LinearFilter; tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  // ------------------------------------------------------------------ targets
  var _v2 = new T.Vector2(), _v3 = new T.Vector3();
  function supported(r) {
    if (S.ok !== null) return S.ok;
    var c = r.capabilities, e = r.extensions;
    S.ok = !!(c && (c.isWebGL2 || (e && e.has('WEBGL_depth_texture'))));
    if (!S.ok) S.off = 'unsupported';
    return S.ok;
  }
  function makeRT(w, h, filter, depth) {
    var rt = new T.WebGLRenderTarget(w, h, { minFilter: filter, magFilter: filter, format: T.RGBAFormat, type: T.UnsignedByteType, depthBuffer: !!depth, stencilBuffer: false, generateMipmaps: false });
    rt.texture.generateMipmaps = false;
    if (depth) { rt.depthTexture = new T.DepthTexture(w, h); rt.depthTexture.type = T.UnsignedIntType; }
    return rt;
  }
  function dropTargets() { ['rtN', 'rtE', 'rtH', 'rtD'].forEach(function (k) { if (S[k]) { if (S[k].depthTexture) S[k].depthTexture.dispose(); S[k].dispose(); S[k] = null; } }); S.key = ''; }
  function ensureTargets(r) {
    r.getDrawingBufferSize(_v2); var dbW = _v2.x, dbH = _v2.y;
    r.getSize(_v2); var cw = _v2.x || dbW, ch = _v2.y || dbH;
    var q = LEVELS[S.level].q, nW = Math.max(8, Math.min(dbW, Math.round(cw * q))), nH = Math.max(8, Math.min(dbH, Math.round(ch * q)));
    var key = nW + 'x' + nH + '/' + dbW + 'x' + dbH + '/' + cw + 'x' + ch;
    if (key === S.key) return;
    dropTargets();
    S.key = key; S.nW = nW; S.nH = nH; S.dbW = dbW; S.dbH = dbH; S.cssW = cw; S.cssH = ch;
    S.rtN = makeRT(nW, nH, T.NearestFilter, true);
    S.rtE = makeRT(nW, nH, T.NearestFilter, false);
    S.rtH = makeRT(nW, nH, T.NearestFilter, false);
    S.rtD = makeRT(nW, nH, T.LinearFilter, false);
    var px = nH / ch;                                   // normals texels per CSS px
    S.rmax = Math.max(1.5, MAX_R_PX * px);
    S.nib = nibMats(S.rmax);
    var E = EMAT.uniforms;
    E.tN.value = S.rtN.texture; E.tZ.value = S.rtN.depthTexture; E.uTexel.value.set(1 / nW, 1 / nH);
    E.uCssH.value = ch; E.uPx.value = px; E.uRmax.value = S.rmax; E.uMinW.value = CFG.minW;
    E.uWid.value.set(CFG.width.sil, CFG.width.contour, CFG.width.edge, CFG.width.crease);
    E.uSty.value.set(CFG.style.sil, CFG.style.contour, CFG.style.edge, CFG.style.crease);
    E.uAtt.value.set(CFG.ppfRef, 0.5, CFG.attMin, CFG.attMax);
    E.uFade.value.set(CFG.fade[0], CFG.fade[1], CFG.fade[2]);
    E.uPress.value = CFG.pressure; E.uPressF.value = 1 / (CFG.pressureWave * px);
    E.uGap.value.set(CFG.gap[0], CFG.gap[1]); E.uCrease.value.set(CFG.crease[0], CFG.crease[1]);
    S.nib.h.uniforms.tE.value = S.rtE.texture; S.nib.h.uniforms.uTexel.value.set(1 / nW, 1 / nH);
    S.nib.v.uniforms.tE.value = S.rtH.texture; S.nib.v.uniforms.uTexel.value.set(1 / nW, 1 / nH);
    var O = OMAT.uniforms;
    O.tD.value = S.rtD.texture; O.tG.value = GRAIN || (GRAIN = grainTex()); O.uTexelN.value.set(1 / nW, 1 / nH); O.uRmax.value = S.rmax;
    O.uDevPerTex.value = dbH / nH; O.uBoil.value = CFG.boil * px; O.uBoilF.value = 1 / (CFG.boilWave * px);
    O.uTint.value.set(CFG.tint[0], CFG.tint[1], CFG.tint[2]); O.uVig.value = CFG.vignette;
    O.uGrain.value.set(CFG.grain, CFG.grain * CFG.mottle); O.uColMul.value = CFG.colorLine; O.uGrainScale.value = 1 / (256 * Math.max(1, dbH / ch));
    var X = XMAT.uniforms; X.tN.value = S.rtN.texture; X.tE.value = S.rtE.texture; X.tD.value = S.rtD.texture; X.uRmax.value = S.rmax; X.uDevPerTex.value = dbH / nH;
    S.warm = 0; S.samples.length = 0;
  }

  // ------------------------------------------------------------------ the frame
  function keyLight(scene) {
    if (S.light && S.light.parent && S.lightScene === scene && S.frames - S.lightScan < 120) return S.light;
    S.light = null; S.lightScene = scene; S.lightScan = S.frames;
    for (var i = 0; i < scene.children.length; i++) { var o = scene.children[i]; if (o.isDirectionalLight) { S.light = o; break; } }
    return S.light;
  }
  // The painted ground (stacked flat layers, 0..0.3 ft up) hides the feet's undersides in the picture, so it is drawn
  // first into the normals target, depth only, reading as empty: lines then close the shoe where it meets the dirt.
  // Found once per scene change: opaque polygon-offset layers drawn before everything (renderOrder < 0), or
  // anything on layer 3 ("ink ground").
  function groundList(scene) {
    var ch = scene.children, sig = ch.length;
    for (var i = 0; i < ch.length; i++) sig = (sig * 31 + ch[i].id) | 0;
    if (sig !== S.gSig || S.gScene !== scene) {
      S.gSig = sig; S.gScene = scene; S.grounds = [];
      scene.traverse(function (o) {
        if (!o.isMesh || (o.layers.mask & L1)) return;
        var m = o.material;
        if (!m || Array.isArray(m)) return;
        if ((o.layers.mask & L3) || (o.renderOrder < 0 && m.polygonOffset && !m.transparent && m.depthWrite !== false && m.colorWrite !== false)) S.grounds.push(o);
      });
    }
    var out = S.gShown; out.length = 0;
    for (var j = 0; j < S.grounds.length; j++) { var o = S.grounds[j], v = true; for (var p = o; p; p = p.parent) if (!p.visible) { v = false; break; } if (v) out.push(o); }
    return out;
  }
  function hulls(on) { for (var i = 0; i < S.hullAll.length; i++) S.hullAll[i].visible = on && S.hullVis[i]; }
  function pass(r, mat, target) { FS_MESH.material = mat; r.setRenderTarget(target); r.render(FS_SCENE, FS_CAM); }
  function tally(r, k) { var i = r.info.render; S.calls[k] = i.calls; S.tot.calls += i.calls; S.tot.tris += i.triangles; if (S.prof) S.prof(k); }

  function frameInk(r, scene, camera, info) {
    ensureTargets(r);
    S.tot = { calls: 0, tris: 0 };
    // world matrices once, for every pass
    if (scene.matrixWorldAutoUpdate) scene.updateMatrixWorld();
    if (camera.parent === null && camera.matrixWorldAutoUpdate) camera.updateMatrixWorld();
    // hull materials: remember their visibility, keep them out of the normals pass
    S.hullAll = (BB.Toon && BB.Toon.OUTLINE ? [BB.Toon.OUTLINE] : []).concat(S.hullMats);
    S.hullVis = S.hullAll.map(function (m) { return m.visible; });
    hulls(false);
    // Order matters on tile-based GPUs: every offscreen pass runs first, then the picture and the overlay go to the
    // canvas back to back, so the overlay blends in tile memory (no store + reload of the multisampled canvas).

    // 1. normals / depth / ids of layer 1 (+ layer-2 occluder masks), over the ground's depth
    var mask = camera.layers.mask;
    S.drawn = 0; S.occl = 0; S.grounds_ = 0;
    r.setRenderTarget(S.rtN);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.autoClear = false;
    var g = groundList(scene);
    if (g.length) {
      PROXY.children = g; camera.layers.mask = 1 | L3; S.groundPass = true;
      r.render(PROXY, camera);
      S.groundPass = false;
      tally(r, 'ground');
    }
    PROXY.children = scene.children;
    camera.layers.mask = L1 | L2;
    r.render(PROXY, camera);
    camera.layers.mask = mask;
    PROXY.children = [];
    tally(r, 'normals');
    var inked = S.drawn > 0;

    // 2 + 3. edges and nib
    if (inked) {
      var E = EMAT.uniforms, pe = camera.projectionMatrix.elements;
      E.uPj.value.set(pe[0], pe[5], pe[8], pe[9]); E.uPz.value.set(pe[10], pe[14]); E.uP11.value = pe[5];
      var L = keyLight(scene), lx = -0.55, ly = 0.83;
      if (L) {
        _v3.copy(L.position); if (L.target) _v3.sub(L.target.position);
        _v3.transformDirection(camera.matrixWorldInverse);
        var ll = Math.hypot(_v3.x, _v3.y); if (ll > 1e-3) { lx = _v3.x / ll; ly = _v3.y / ll; }
      }
      E.uLight.value.set(lx, ly, CFG.shadowSide);
      // boil + brush pressure re-rolled on twos (held during hitstop)
      var tick = Math.floor((info.time || 0) * 12);
      if (tick !== S.lastTick && !info.hitstop) { S.lastTick = tick; S.seedK++; }
      var k = S.seedK % 4096;
      E.uSeed.value.set((k * 37.13) % 251, (k * 71.71) % 241);
      OMAT.uniforms.uBoilSeed.value.set((k * 13.37) % 199, (k * 29.41) % 211);
      r.setClearColor(0x000000, 0);                      // a clear up front is a free "don't load" on tile GPUs
      r.autoClear = true;
      pass(r, EMAT, S.rtE); tally(r, 'edges');
      pass(r, S.nib.h, S.rtH); tally(r, 'nibH');
      pass(r, S.nib.v, S.rtD); tally(r, 'nibV');
    }

    // 4. the picture, as it would be without ink (hulls only when nothing inked is in view, or when asked)
    hulls(S.hulls || !inked);
    r.setRenderTarget(null);
    r.setClearColor(S.saved.cc, S.saved.ca);
    r.autoClear = S.saved.ac;
    var au = scene.matrixWorldAutoUpdate; scene.matrixWorldAutoUpdate = false;
    r.render(scene, camera);
    scene.matrixWorldAutoUpdate = au;
    tally(r, 'scene');
    hulls(true);

    // 5. overlay (or a debug view), same framebuffer, straight after the picture
    r.autoClear = false;
    if (S.debug && DEBUG_MODES[S.debug]) { XMAT.uniforms.uMode.value = DEBUG_MODES[S.debug]; pass(r, XMAT, null); }
    else { OMAT.uniforms.uLines.value = inked ? 1 : 0; pass(r, OMAT, null); }
    tally(r, 'overlay');
    var inf = r.info.render; inf.calls = S.tot.calls; inf.triangles = S.tot.tris; // BB.Render.stats() sees the whole frame
    S.inked = inked;
  }

  function save(r, scene, camera) {
    S.saved = S.saved || { cc: new T.Color() };
    r.getClearColor(S.saved.cc); S.saved.ca = r.getClearAlpha(); S.saved.ac = r.autoClear;
    S.saved.mask = camera.layers.mask; S.saved.mwa = scene.matrixWorldAutoUpdate;
  }
  function restore(r, scene, camera) {
    var s = S.saved;
    r.setRenderTarget(null); r.setClearColor(s.cc, s.ca); r.autoClear = s.ac;
    camera.layers.mask = s.mask; scene.matrixWorldAutoUpdate = s.mwa;
    PROXY.children = []; S.groundPass = false;
    for (var i = 0; i < S.hullAll.length; i++) if (S.hullVis[i] != null) S.hullAll[i].visible = S.hullVis[i];
  }

  function render(renderer, scene, camera, info) {
    var t0 = S.now();
    if (!supported(renderer) || !camera.isPerspectiveCamera) { renderer.render(scene, camera); return; }
    try {
      save(renderer, scene, camera);
      frameInk(renderer, scene, camera, info || {});
      restore(renderer, scene, camera);
    } catch (e) {
      S.off = 'error'; S.err = String((e && e.message) || e);
      try { restore(renderer, scene, camera); renderer.render(scene, camera); } catch (e2) { /* nothing more to do */ }
      if (typeof console !== 'undefined') console.warn('BB.Ink: switched off after an error:', e);
      return;
    }
    S.cpuMs = S.now() - t0;
    adapt(t0);
  }

  // ------------------------------------------------------------------ adaptive quality
  function adapt(t0) {
    var dt = S.lastT ? t0 - S.lastT : 0;
    S.lastT = t0; S.frames++;
    if (!(dt > 0 && dt < 250)) return;
    S.samples.push(dt); if (S.samples.length > 36) S.samples.shift();
    S.warm++;
    if (S.samples.length < 36) return;
    var a = S.samples.slice().sort(function (x, y) { return x - y; }); S.med = a[18];
    if (!S.auto || S.forced || S.warm < 40) return;
    var RS = BB.Render && BB.Render._S; if (RS && RS.noAdapt) return;
    if (S.med > CFG.slowMs) {
      if (S.level > 1) setLevel(S.level - 1); else S.off = 'slow';
      S.samples.length = 0; S.warm = 0;
    }
  }
  function setLevel(n) { n = Math.max(1, Math.min(3, n | 0)); if (n !== S.level) { S.level = n; S.key = ''; } }

  function active() {
    if (!S.enabled || S.ok === false) return false;
    if (S.forced) return true;
    if (S.off) return false;
    var RS = BB.Render && BB.Render._S;
    if (RS && RS.prCap < 2) { S.off = 'pixel-ratio'; return false; } // BB.Render already traded resolution for speed
    return true;
  }

  // ------------------------------------------------------------------ helpers for the cast
  // Put every drawable mesh under root on layer 1 (it stays on layer 0). Skips hulls, decals and see-through FX.
  // opts: { weight: line weight multiplier, id: share one ink id (no boundary lines between the parts) }
  function mark(root, opts) {
    if (!root) return root;
    opts = opts || {};
    root.traverse(function (o) {
      if (!o.isMesh) return;
      var m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!m || noInk(o, m) || (m.side === T.BackSide && m.isShaderMaterial)) return;
      o.layers.enable(1);
      if (opts.weight != null) o.userData.inkWeight = opts.weight;
      if (opts.id != null) o.userData.inkId = opts.id;
    });
    return root;
  }

  var API = {
    active: active,                       // draw this frame with ink? (enabled, supported, not switched off for speed)
    render: render,                       // (renderer, scene, camera, { scene, time, hitstop }): draws the whole frame
    resize: function (renderer, w, h, pr) { S.key = ''; S.samples.length = 0; S.warm = 0; },
    // time quantised to 1/12 s while the ink look is on: character acting held for two frames, like drawn animation
    twos: function (t) { return active() ? Math.floor(t * 12 + 1e-7) / 12 : t; },
    setEnabled: function (on) {           // user switch (?ink=0 starts it off); on also clears an automatic switch-off
      S.enabled = !!on;
      if (on) { S.off = S.ok === false ? 'unsupported' : ''; S.level = S.startLevel; S.key = ''; S.samples.length = 0; S.warm = 0; }
    },
    setQuality: function (q) {            // 1..3 or 'low' | 'medium' | 'high' (also the level it restarts from)
      var n = typeof q === 'string' ? ({ low: 1, medium: 2, med: 2, high: 3 })[q] : q;
      if (n) { setLevel(n); S.startLevel = S.level; }
    },
    setAuto: function (on) { S.auto = !!on; },                  // automatic step-down / switch-off (default on)
    hullsVisible: function () { return !active() || S.hulls || !S.inked; }, // are the inverted hulls drawn this frame?
    setHulls: function (on) { S.hulls = !!on; },                // keep the inverted hulls under the ink (comparison only)
    registerHull: function (mat) { if (mat && S.hullMats.indexOf(mat) < 0) S.hullMats.push(mat); }, // hidden while inking
    mark: mark,
    debug: function (mode) { S.debug = mode || ''; },
    stats: function () {
      return {
        enabled: S.enabled, active: active(), forced: S.forced, reason: S.off || (S.enabled ? '' : 'disabled'), error: S.err,
        level: S.level, quality: LEVELS[S.level].name, auto: S.auto, hulls: S.hulls, inkedDraws: S.drawn, occluders: S.occl, groundDraws: S.grounds_,
        normalsTarget: [S.nW, S.nH], canvas: [S.dbW, S.dbH], cpuMs: +S.cpuMs.toFixed(2), medianFrameMs: +S.med.toFixed(2),
        frames: S.frames, calls: S.calls,
      };
    },
    CFG: CFG, _S: S,
  };
  // read-only flags: BB.Ink.enabled (the user switch), BB.Ink.quality ('low' | 'medium' | 'high'), BB.Ink.level (1..3)
  Object.defineProperty(API, 'enabled', { enumerable: true, get: function () { return S.enabled; } });
  Object.defineProperty(API, 'quality', { enumerable: true, get: function () { return LEVELS[S.level].name; } });
  Object.defineProperty(API, 'level', { enumerable: true, get: function () { return S.level; } });
  BB.Ink = API;
})();
