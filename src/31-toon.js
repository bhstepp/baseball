// 31-toon.js — BB.Toon: the cartoon pipeline over three.js (r149, global THREE). Owned by the render agent.
// Cel materials with a 3-step gradient map, screen-space inverted-hull ink outlines, a vertex-colour geometry merger
// (so a whole rigid body part is one draw call + one outline call), rubber-hose limbs (dynamic Bezier tubes) and a
// "painted" builder for static scenery (flat colours with 2-tone shading baked into the vertices, no lights, no lines).
// World units are feet. Characters are built Y-up; the world is Z-up (see docs/CONTRACT.md).
BB.Toon = (function () {
  var T = (typeof THREE !== 'undefined') ? THREE : null;
  if (!T) return null;
  var INK = '#1B1420';

  // ------------------------------------------------------------------ gradient map + materials
  function gradTex(levels) {
    var n = levels.length, d = new Uint8Array(4 * n);
    for (var i = 0; i < n; i++) { var v = Math.round(levels[i] * 255); d[4 * i] = d[4 * i + 1] = d[4 * i + 2] = v; d[4 * i + 3] = 255; }
    var t = new T.DataTexture(d, n, 1, T.RGBAFormat);
    t.minFilter = t.magFilter = T.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
    return t;
  }
  var GRAD = gradTex([0.2, 0.62, 1.0]);
  var cache = {};
  function toon(hex, opts) {
    var k = 't' + hex + (opts ? JSON.stringify(opts) : '');
    if (!cache[k]) { cache[k] = new T.MeshToonMaterial(Object.assign({ color: new T.Color(hex), gradientMap: GRAD }, opts || {})); }
    return cache[k];
  }
  var VC = new T.MeshToonMaterial({ vertexColors: true, gradientMap: GRAD });
  var VCB = new T.MeshBasicMaterial({ vertexColors: true });
  function basic(hex, opts) {
    var k = 'b' + hex + (opts ? JSON.stringify(opts) : '');
    if (!cache[k]) cache[k] = new T.MeshBasicMaterial(Object.assign({ color: new T.Color(hex) }, opts || {}));
    return cache[k];
  }
  function layerMat(k, opts) { // painted ground layers stacked with polygon offset
    var key = 'L' + k + (opts ? JSON.stringify(opts) : '');
    if (!cache[key]) cache[key] = new T.MeshBasicMaterial(Object.assign({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -k * 0.2, polygonOffsetUnits: -k * 4 }, opts || {}));
    return cache[key];
  }

  // ------------------------------------------------------------------ ink outlines (inverted hull, screen-space width)
  var OU = {
    uRes: { value: new T.Vector2(390, 844) }, uWorld: { value: 0.085 }, uMin: { value: 1.25 }, uMax: { value: 3.6 },
    uColor: { value: new T.Color(INK) },
  };
  var OUTLINE = new T.ShaderMaterial({
    uniforms: OU, side: T.BackSide,
    vertexShader: [
      'attribute vec3 onormal; attribute float ow;',
      'uniform vec2 uRes; uniform float uWorld; uniform float uMin; uniform float uMax;',
      'void main() {',
      '  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '  vec3 n = normalize(normalMatrix * onormal);',
      '  vec2 d = (projectionMatrix * vec4(n, 0.0)).xy * uRes;',
      '  float L = length(d); d = L > 1e-6 ? d / L : vec2(0.0);',
      '  float f = projectionMatrix[1][1] * uRes.y * 0.5;',
      '  float px = clamp(uWorld * f / max(clip.w, 0.05), uMin, uMax);',
      '  px *= ow * (0.84 + 0.28 * sin(position.x * 5.3 + position.y * 3.9 + position.z * 4.7));',
      '  clip.xy += d * px * 2.0 / uRes * clip.w;',
      '  gl_Position = clip;',
      '}'].join('\n'),
    fragmentShader: 'uniform vec3 uColor; void main() { gl_FragColor = vec4(uColor, 1.0); }',
  });

  // ------------------------------------------------------------------ small math helpers
  var _m = new T.Matrix4(), _q = new T.Quaternion(), _e = new T.Euler(), _v = new T.Vector3(), _s = new T.Vector3();
  // M([x,y,z], [rx,ry,rz], [sx,sy,sz] | s) -> Matrix4
  function M(p, r, s) {
    _e.set(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0, (r && r[3]) || 'XYZ');
    _q.setFromEuler(_e);
    if (s == null) _s.set(1, 1, 1); else if (typeof s === 'number') _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
    return new T.Matrix4().compose(_v.set(p ? p[0] : 0, p ? p[1] : 0, p ? p[2] : 0), _q, _s);
  }

  // shared primitive geometries (unit sized)
  var G = {};
  function geo(key, make) { return G[key] || (G[key] = make()); }
  var P = {
    sph: function (lo) { return geo('s' + (lo ? 1 : 0), function () { return lo ? new T.SphereGeometry(1, 10, 8) : new T.SphereGeometry(1, 18, 14); }); },
    hemi: function () { return geo('hemi', function () { return new T.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2); }); },
    cyl: function (rt, rb, n, open) { var k = 'c' + rt + '_' + rb + '_' + (n || 14) + (open ? 'o' : ''); return geo(k, function () { return new T.CylinderGeometry(rt, rb, 1, n || 14, 1, !!open); }); },
    cone: function (n) { return geo('cone' + (n || 12), function () { return new T.ConeGeometry(1, 1, n || 12); }); },
    box: function () { return geo('box', function () { return new T.BoxGeometry(1, 1, 1); }); },
    torus: function (tube, arc, n) { var k = 'tor' + tube + '_' + (arc || 6.2832) + '_' + (n || 20); return geo(k, function () { return new T.TorusGeometry(1, tube, 8, n || 20, arc || Math.PI * 2); }); },
    capsule: function (r, len) { var k = 'cap' + r + '_' + len; return geo(k, function () { return new T.CapsuleGeometry(r, len, 4, 12); }); },
  };

  // ------------------------------------------------------------------ vertex-colour merger (characters & props)
  function Builder() { this.parts = []; }
  // add(geometry, colour, matrix | [p, r, s], opts { ow: outline weight (0 = none), lo })
  Builder.prototype.add = function (g, color, m, opts) {
    var mat = Array.isArray(m) ? M(m[0], m[1], m[2]) : (m || new T.Matrix4());
    var gg = g.index ? g.toNonIndexed() : g.clone();
    gg.applyMatrix4(mat);
    this.parts.push({ g: gg, c: new T.Color(color), ow: opts && opts.ow != null ? opts.ow : 1, flip: mat.determinant() < 0 });
    return this;
  };
  Builder.prototype.ell = function (color, p, r, rot, opts) { return this.add(P.sph(opts && opts.lo), color, [p, rot, r], opts); };
  Builder.prototype.build = function (opts) {
    opts = opts || {};
    var n = 0, i, j;
    this.parts.forEach(function (p) { n += p.g.attributes.position.count; });
    var pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), onr = new Float32Array(n * 3), ow = new Float32Array(n);
    var o = 0, L = opts.bake;
    this.parts.forEach(function (p) {
      var pa = p.g.attributes.position.array, na = p.g.attributes.normal.array, c = p.g.attributes.position.count;
      // smooth normals for the hull (so boxes / cylinder caps don't crack)
      var map = {}, keys = new Array(c);
      for (i = 0; i < c; i++) {
        var key = Math.round(pa[3 * i] * 500) + ',' + Math.round(pa[3 * i + 1] * 500) + ',' + Math.round(pa[3 * i + 2] * 500);
        keys[i] = key;
        var s = map[key] || (map[key] = [0, 0, 0]);
        s[0] += na[3 * i]; s[1] += na[3 * i + 1]; s[2] += na[3 * i + 2];
      }
      for (i = 0; i < c; i++) {
        for (j = 0; j < 3; j++) { pos[3 * (o + i) + j] = pa[3 * i + j]; nor[3 * (o + i) + j] = na[3 * i + j]; }
        var sm = map[keys[i]], l = Math.hypot(sm[0], sm[1], sm[2]) || 1;
        onr[3 * (o + i)] = sm[0] / l; onr[3 * (o + i) + 1] = sm[1] / l; onr[3 * (o + i) + 2] = sm[2] / l;
        var k = 1;
        if (L) { var d = na[3 * i] * L[0] + na[3 * i + 1] * L[1] + na[3 * i + 2] * L[2]; k = d > 0.3 ? 1 : d > -0.25 ? 0.86 : 0.74; }
        col[3 * (o + i)] = p.c.r * k; col[3 * (o + i) + 1] = p.c.g * k; col[3 * (o + i) + 2] = p.c.b * k;
        ow[o + i] = p.ow;
      }
      if (p.flip) { // mirrored part: fix winding
        for (i = 0; i < c; i += 3) for (j = 0; j < 3; j++) {
          var a = 3 * (o + i + 1) + j, b = 3 * (o + i + 2) + j, t;
          t = pos[a]; pos[a] = pos[b]; pos[b] = t; t = nor[a]; nor[a] = nor[b]; nor[b] = t; t = onr[a]; onr[a] = onr[b]; onr[b] = t;
          t = col[a]; col[a] = col[b]; col[b] = t;
        }
      }
      o += c;
      p.g.dispose();
    });
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(pos, 3));
    g.setAttribute('normal', new T.BufferAttribute(nor, 3));
    g.setAttribute('color', new T.BufferAttribute(col, 3));
    g.setAttribute('onormal', new T.BufferAttribute(onr, 3));
    g.setAttribute('ow', new T.BufferAttribute(ow, 1));
    g.computeBoundingSphere();
    this.parts = [];
    return g;
  };
  // a merged toon mesh with its ink hull as a child
  function inked(g, mat, outline) {
    var m = new T.Mesh(g, mat || VC);
    if (outline !== false) { var o = new T.Mesh(g, OUTLINE); o.renderOrder = 1; m.add(o); m.userData.outline = o; }
    return m;
  }
  // prepare a plain geometry for outlining (adds onormal / ow)
  function prep(g, w) {
    if (!g.attributes.onormal) g.setAttribute('onormal', g.attributes.normal);
    if (!g.attributes.ow) { var a = new Float32Array(g.attributes.position.count); a.fill(w == null ? 1 : w); g.setAttribute('ow', new T.BufferAttribute(a, 1)); }
    return g;
  }

  // ------------------------------------------------------------------ rubber-hose limbs
  // A tube along a quadratic Bezier A -> C -> B with rounded end caps; vertex colour per ring (cols = [[t, hex], ...]).
  var RING = 8, SEG = 9;
  function Hose(r0, r1, cols, opts) {
    opts = opts || {};
    this.r0 = r0; this.r1 = r1; this.ring = opts.ring || RING; this.seg = opts.seg || SEG;
    var rings = this.seg + 1 + 4, n = rings * this.ring + 2; // +2 cap tips
    this.rings = rings;
    var g = new T.BufferGeometry();
    this.pos = new Float32Array(n * 3); this.nor = new Float32Array(n * 3);
    var col = new Float32Array(n * 3), ow = new Float32Array(n), idx = [];
    var cl = cols.map(function (c) { return [c[0], new T.Color(c[1])]; });
    function colAt(t) { var c = cl[0][1]; for (var i = 0; i < cl.length; i++) if (t >= cl[i][0]) c = cl[i][1]; return c; }
    for (var r = 0; r < rings; r++) {
      var t = U.clamp((r - 2) / this.seg, 0, 1), cc = colAt(t);
      for (var k = 0; k < this.ring; k++) {
        var v = r * this.ring + k;
        col[3 * v] = cc.r; col[3 * v + 1] = cc.g; col[3 * v + 2] = cc.b; ow[v] = opts.ow == null ? 1 : opts.ow;
        if (r < rings - 1) {
          var a = v, b = r * this.ring + (k + 1) % this.ring, c2 = a + this.ring, d = b + this.ring;
          idx.push(a, b, c2, b, d, c2);
        }
      }
    }
    var tipA = rings * this.ring, tipB = tipA + 1;
    [[tipA, colAt(0)], [tipB, colAt(1)]].forEach(function (q) { col[3 * q[0]] = q[1].r; col[3 * q[0] + 1] = q[1].g; col[3 * q[0] + 2] = q[1].b; ow[q[0]] = opts.ow == null ? 1 : opts.ow; });
    for (k = 0; k < this.ring; k++) {
      idx.push(tipA, (k + 1) % this.ring, k);
      var base = (rings - 1) * this.ring;
      idx.push(tipB, base + k, base + (k + 1) % this.ring);
    }
    g.setIndex(idx);
    this.pa = new T.BufferAttribute(this.pos, 3); this.na = new T.BufferAttribute(this.nor, 3);
    this.pa.setUsage(T.DynamicDrawUsage); this.na.setUsage(T.DynamicDrawUsage);
    g.setAttribute('position', this.pa); g.setAttribute('normal', this.na); g.setAttribute('onormal', this.na);
    g.setAttribute('color', new T.BufferAttribute(col, 3)); g.setAttribute('ow', new T.BufferAttribute(ow, 1));
    g.boundingSphere = new T.Sphere(new T.Vector3(), 50);
    this.geom = g;
    this.mesh = inked(g, opts.mat || VC, opts.outline);
    this.mesh.frustumCulled = false; if (this.mesh.userData.outline) this.mesh.userData.outline.frustumCulled = false;
    this.ref = new T.Vector3(1, 0, 0);
  }
  var hA = new T.Vector3(), hB = new T.Vector3(), hC = new T.Vector3(), hP = new T.Vector3(), hT = new T.Vector3(), hN = new T.Vector3(), hBn = new T.Vector3(), hTmp = new T.Vector3();
  // set(A, C, B) with plain arrays or Vector3
  Hose.prototype.set = function (A, C, B) {
    hA.set(A[0] != null ? A[0] : A.x, A[1] != null ? A[1] : A.y, A[2] != null ? A[2] : A.z);
    hB.set(B[0] != null ? B[0] : B.x, B[1] != null ? B[1] : B.y, B[2] != null ? B[2] : B.z);
    hC.set(C[0] != null ? C[0] : C.x, C[1] != null ? C[1] : C.y, C[2] != null ? C[2] : C.z);
    var R = this.ring, pos = this.pos, nor = this.nor, seg = this.seg;
    // initial frame
    hT.subVectors(hC, hA).multiplyScalar(2); if (hT.lengthSq() < 1e-8) hT.subVectors(hB, hA); hT.normalize();
    hN.copy(this.ref); if (Math.abs(hN.dot(hT)) > 0.9) hN.set(0, 0, 1);
    hN.sub(hTmp.copy(hT).multiplyScalar(hN.dot(hT))).normalize();
    var self = this;
    function ringAt(ri, P, Tn, rad) {
      hBn.crossVectors(Tn, hN);
      for (var k = 0; k < R; k++) {
        var a = k / R * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        var nx = hN.x * ca + hBn.x * sa, ny = hN.y * ca + hBn.y * sa, nz = hN.z * ca + hBn.z * sa;
        var v = 3 * (ri * R + k);
        pos[v] = P.x + nx * rad; pos[v + 1] = P.y + ny * rad; pos[v + 2] = P.z + nz * rad;
        nor[v] = nx; nor[v + 1] = ny; nor[v + 2] = nz;
      }
    }
    for (var i = 0; i <= seg; i++) {
      var t = i / seg, mt = 1 - t;
      hP.set(mt * mt * hA.x + 2 * mt * t * hC.x + t * t * hB.x, mt * mt * hA.y + 2 * mt * t * hC.y + t * t * hB.y, mt * mt * hA.z + 2 * mt * t * hC.z + t * t * hB.z);
      var tx = 2 * mt * (hC.x - hA.x) + 2 * t * (hB.x - hC.x), ty = 2 * mt * (hC.y - hA.y) + 2 * t * (hB.y - hC.y), tz = 2 * mt * (hC.z - hA.z) + 2 * t * (hB.z - hC.z);
      var nt = new T.Vector3(tx, ty, tz); if (nt.lengthSq() < 1e-10) nt.copy(hT); nt.normalize();
      // parallel transport the normal
      hN.sub(hTmp.copy(nt).multiplyScalar(hN.dot(nt))); if (hN.lengthSq() < 1e-8) hN.set(0, 1, 0); hN.normalize();
      hT.copy(nt);
      var rad = self.r0 + (self.r1 - self.r0) * t;
      ringAt(i + 2, hP, hT, rad);
      if (i === 0) {
        // start cap rings (behind A)
        var sv = hP.clone();
        ringAt(1, sv.clone().addScaledVector(hT, -rad * 0.55), hT, rad * 0.82);
        ringAt(0, sv.clone().addScaledVector(hT, -rad * 0.9), hT, rad * 0.42);
        var tip = 3 * (this.rings * R); var tp = sv.clone().addScaledVector(hT, -rad);
        pos[tip] = tp.x; pos[tip + 1] = tp.y; pos[tip + 2] = tp.z; nor[tip] = -hT.x; nor[tip + 1] = -hT.y; nor[tip + 2] = -hT.z;
      }
      if (i === seg) {
        var ev = hP.clone();
        ringAt(seg + 3, ev.clone().addScaledVector(hT, rad * 0.55), hT, rad * 0.82);
        ringAt(seg + 4, ev.clone().addScaledVector(hT, rad * 0.9), hT, rad * 0.42);
        var tipb = 3 * (this.rings * R + 1), tq = ev.clone().addScaledVector(hT, rad);
        pos[tipb] = tq.x; pos[tipb + 1] = tq.y; pos[tipb + 2] = tq.z; nor[tipb] = hT.x; nor[tipb + 1] = hT.y; nor[tipb + 2] = hT.z;
      }
    }
    this.pa.needsUpdate = true; this.na.needsUpdate = true;
  };
  // limb with a knee/elbow: bend control point keeps roughly the rest length L
  var lA = new T.Vector3(), lB = new T.Vector3(), lD = new T.Vector3(), lM = new T.Vector3(), lN = new T.Vector3();
  Hose.prototype.limb = function (A, B, bend, L) {
    lA.set(A[0], A[1], A[2]); lB.set(B[0], B[1], B[2]);
    lD.subVectors(lB, lA); var d = lD.length() || 1e-4; lD.multiplyScalar(1 / d);
    lM.addVectors(lA, lB).multiplyScalar(0.5);
    lN.set(bend[0], bend[1], bend[2]); lN.addScaledVector(lD, -lN.dot(lD));
    if (lN.lengthSq() < 1e-6) lN.set(0, 0, 1).addScaledVector(lD, -lD.z);
    lN.normalize();
    var h = Math.sqrt(Math.max(0, L * L / 4 - d * d / 4)) * 1.25;
    lM.addScaledVector(lN, h);
    this.set(lA, lM, lB);
    return lM;
  };

  // ------------------------------------------------------------------ painted builder (static scenery)
  // Accumulates flat-coloured triangles; 3D solids get 2-tone shading baked by face normal vs the key light.
  function Paint(light) { this.p = []; this.c = []; this.L = light || [0.4, -0.5, 0.75]; var l = Math.hypot(this.L[0], this.L[1], this.L[2]); this.L = this.L.map(function (x) { return x / l; }); }
  Paint.prototype.tri = function (a, b, c, color, k) {
    var col = color.isColor ? color : new T.Color(color);
    k = k == null ? 1 : k;
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (var i = 0; i < 3; i++) this.c.push(col.r * k, col.g * k, col.b * k);
  };
  Paint.prototype.shadeOf = function (a, b, c) {
    var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    var d = (nx * this.L[0] + ny * this.L[1] + nz * this.L[2]) / l;
    return d > 0.3 ? 1 : d > -0.2 ? 0.86 : 0.74;
  };
  Paint.prototype.stri = function (a, b, c, color) { this.tri(a, b, c, color, this.shadeOf(a, b, c)); };
  Paint.prototype.quad = function (a, b, c, d, color, shade) {
    var k = shade ? this.shadeOf(a, b, c) : 1;
    this.tri(a, b, c, color, k); this.tri(a, c, d, color, k);
  };
  // 2D polygon (counter-clockwise or not) mapped to 3D with fn(u, v) -> [x, y, z]
  Paint.prototype.poly = function (pts, color, fn, holes) {
    var contour = pts.map(function (p) { return new T.Vector2(p[0], p[1]); });
    var hs = (holes || []).map(function (h) { return h.map(function (p) { return new T.Vector2(p[0], p[1]); }); });
    var tris = T.ShapeUtils.triangulateShape(contour, hs);
    var all = pts.concat.apply(pts.slice(), holes || []);
    fn = fn || function (u, v) { return [u, v, 0]; };
    var m = all.map(function (p) { return fn(p[0], p[1]); });
    for (var i = 0; i < tris.length; i++) {
      var a = m[tris[i][0]], b = m[tris[i][1]], c = m[tris[i][2]];
      // keep ground faces facing +z
      var nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (this._facing && nz < 0) this.tri(a, c, b, color); else this.tri(a, b, c, color);
    }
  };
  Paint.prototype.ground = function (pts, color, z, holes) {
    this._facing = true; this.poly(pts, color, function (u, v) { return [u, v, z || 0]; }, holes); this._facing = false;
  };
  // any three geometry, transformed, shade-baked
  Paint.prototype.geom = function (g, m, color, flat) {
    var mat = Array.isArray(m) ? M(m[0], m[1], m[2]) : m;
    var gg = g.index ? g.toNonIndexed() : g.clone();
    if (mat) gg.applyMatrix4(mat);
    var pa = gg.attributes.position.array, na = gg.attributes.normal.array, col = new T.Color(color), L = this.L;
    for (var i = 0; i < pa.length; i += 9) {
      var k = 1;
      if (!flat) {
        var nx = na[i] + na[i + 3] + na[i + 6], ny = na[i + 1] + na[i + 4] + na[i + 7], nz = na[i + 2] + na[i + 5] + na[i + 8], l = Math.hypot(nx, ny, nz) || 1;
        var d = (nx * L[0] + ny * L[1] + nz * L[2]) / l; k = d > 0.3 ? 1 : d > -0.2 ? 0.86 : 0.74;
      }
      this.p.push(pa[i], pa[i + 1], pa[i + 2], pa[i + 3], pa[i + 4], pa[i + 5], pa[i + 6], pa[i + 7], pa[i + 8]);
      for (var j = 0; j < 3; j++) this.c.push(col.r * k, col.g * k, col.b * k);
    }
    gg.dispose();
  };
  Paint.prototype.box = function (x, y, z0, sx, sy, sz, rotZ, color) { this.geom(P.box(), M([x, y, z0 + sz / 2], [0, 0, rotZ || 0], [sx, sy, sz]), color); };
  // Z-up cylinder from z0 with height h
  Paint.prototype.cyl = function (x, y, z0, r, h, color, n, rTop) {
    var g = new T.CylinderGeometry(rTop == null ? r : rTop, r, h, n || 12);
    this.geom(g, M([x, y, z0 + h / 2], [Math.PI / 2, 0, 0]), color); g.dispose();
  };
  Paint.prototype.ball = function (x, y, z, rx, ry, rz, color, lo) { this.geom(P.sph(lo !== false), M([x, y, z], null, [rx, ry, rz]), color); };
  Paint.prototype.build = function () {
    var g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    this.p = []; this.c = [];
    return g;
  };
  Paint.prototype.count = function () { return this.p.length / 9; };

  // ------------------------------------------------------------------ canvas textures
  function canvasTex(w, h, draw, opts) {
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var x = c.getContext('2d'); draw(x, w, h);
    var t = new T.CanvasTexture(c);
    t.anisotropy = 2;
    if (opts && opts.nearest) { t.magFilter = T.NearestFilter; }
    if (opts && opts.noMip) { t.generateMipmaps = false; t.minFilter = T.LinearFilter; }
    t.userData.canvas = c;
    return t;
  }

  var U = BB.U;
  function shade(hex, k) { var c = new T.Color(hex); if (k < 1) c.multiplyScalar(k); else c.lerp(new T.Color(1, 1, 1), k - 1); return '#' + c.getHexString(); }
  function mix(a, b, t) { return '#' + new T.Color(a).lerp(new T.Color(b), t).getHexString(); }

  return {
    INK: INK, GRAD: GRAD, VC: VC, VCB: VCB, OUTLINE: OUTLINE, OU: OU, toon: toon, basic: basic, layerMat: layerMat,
    M: M, P: P, Builder: Builder, inked: inked, prep: prep, Hose: Hose, Paint: Paint, canvasTex: canvasTex, shade: shade, mix: mix,
  };
})();
