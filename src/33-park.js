// 33-park.js — BB.Park: builds each ballpark as a painted 3D set (built once per park, cached). Owned by the render
// agent. Everything static is flat colour with 2-tone shading baked into vertices (no lights, no outlines): ground
// layers stacked with polygon offset, the outfield wall from park.fence (distances & heights, incl. a 37-ft wall),
// bleachers and grandstands with an instanced bobbing crowd, a scoreboard and billboard with painted lettering,
// light towers, and a mid-century cartoon backdrop per skyline (barns, city, pines & lake, harbor, desert, cathedral)
// under a sky of painted bands with flat clouds. World = feet, Z up, +y to centre field.
BB.Park = (function () {
  var TN = BB.Toon; if (!TN) return null;
  var T = THREE, U = BB.U, K = BB.K, PI = Math.PI, D2R = PI / 180;
  var INK = TN.INK;

  // ------------------------------------------------------------------ palettes
  var BASE = {
    grass: '#6DBB4A', grass2: '#7FC957', grassF: '#62AE44', dirt: '#D9955B', dirt2: '#E3A86E', track: '#C98A55', chalk: '#FFF9EE',
    wall: '#2F6B4F', wallTop: '#F2B632', pad: '#2F6B4F', eye: '#24543E', seat: '#E9D8B6', seat2: '#D9C49E', stand: '#B8573E', stand2: '#9E4732',
    outside: '#8CC46A', roof: '#5A5F7A', key: '#FFF1D6', keyI: 0.62, amb: '#FFFFFF', ambI: 0.52, sun: [0.35, -0.55, 0.75], night: false, lights: false,
    sky: [[90, '#62BFD3'], [26, '#8ED5D9'], [12, '#C9EBD6'], [5, '#FFE6A8'], [1.5, '#FFD48C']], skyLow: '#FFD48C',
    cloud: '#FFF9EE', cloudSh: '#E6D9C6', fans: ['#C8452F', '#F2B632', '#2B4A8C', '#FFF4DC', '#6DBB4A', '#F29E8E', '#7FD1D9'],
    fur: ['#9A97A6', '#8A5A3C', '#D9B38C', '#F6F1E8', '#7A4E32', '#E07B39', '#C9C6CC', '#5A4A42', '#F2B632'],
  };
  var PAL = {
    barns: { sky: [[90, '#5AB9D2'], [30, '#86CFD8'], [14, '#C2E7D2'], [6, '#FBE3A2'], [2, '#FFCF86']], skyLow: '#FFCF86', outside: '#A9C866',
      wall: '#3E7A3A', pad: '#3E7A3A', eye: '#2F5E34', stand: '#C8452F', stand2: '#A63A28', seat: '#F2E2BC', key: '#FFE8C2', sun: [-0.45, -0.35, 0.6] },
    city: { sky: [[90, '#3B3A78'], [32, '#6A4F92'], [16, '#B9668E'], [7, '#F08C7E'], [2, '#FFB36B']], skyLow: '#FFB36B', outside: '#6E6070',
      wall: '#2E6A4E', pad: '#2E6A4E', eye: '#24543E', stand: '#9A4A5A', stand2: '#7E3A4A', seat: '#E8C9B0', key: '#FFD9B8', keyI: 0.55, amb: '#E8DDF2', ambI: 0.55,
      sun: [0.5, -0.4, 0.55], lights: true, cloud: '#F7C8B8', cloudSh: '#C98AA0', grass: '#64B24A', grass2: '#74BE56' },
    pines: { sky: [[90, '#49AEDB'], [30, '#7FCAE6'], [14, '#BEE6EA'], [6, '#E6F5E2'], [2, '#F4F1D8']], skyLow: '#F4F1D8', outside: '#4E8E52',
      wall: '#2F5A3A', pad: '#2F5A3A', eye: '#28503A', stand: '#7A5236', stand2: '#644228', seat: '#E9D8B6', key: '#FFF4DE' },
    harbor: { sky: [[90, '#52B2C6'], [30, '#86CDCF'], [14, '#C8E8DC'], [6, '#F4E8C8'], [2, '#FFD9A8']], skyLow: '#FFD9A8', outside: '#C9B48C',
      wall: '#1F5266', pad: '#1F5266', eye: '#1B4656', stand: '#2F6E8A', stand2: '#245A72', seat: '#F2E8D2', key: '#FFF0D8', lights: true },
    desert: { sky: [[90, '#15183E'], [40, '#23285A'], [18, '#43407A'], [8, '#8A5A86'], [3, '#E0807E'], [1, '#F29E8E']], skyLow: '#F29E8E', outside: '#C9846E',
      wall: '#6E3A4A', pad: '#6E3A4A', eye: '#3A2E4E', stand: '#B5603E', stand2: '#94492E', seat: '#F2D2B6', grass: '#5DAE4E', grass2: '#6CBB5A', dirt: '#D98E64', dirt2: '#E4A47A',
      key: '#FFE4D0', keyI: 0.6, amb: '#C8C2F0', ambI: 0.5, sun: [0.3, -0.6, 0.7], night: true, lights: true, cloud: '#4E4A86', cloudSh: '#3A3870' },
    cathedral: { sky: [[90, '#3A2A66'], [34, '#6A4486'], [16, '#B4607E'], [7, '#F09A68'], [2, '#FFC870']], skyLow: '#FFC870', outside: '#7A6A5A',
      wall: '#2D4A3A', pad: '#2D4A3A', eye: '#22392E', stand: '#A8553E', stand2: '#8A4230', seat: '#E9D2B0', roof: '#3F9A84', key: '#FFDDB0', keyI: 0.6, amb: '#F0E0F0',
      sun: [-0.4, -0.5, 0.45], lights: true, cloud: '#F6C29A', cloudSh: '#C9849A' },
  };
  PAL.none = PAL.cathedral;
  function palFor(park) {
    var f = (park && park.features) || {}, k = park && park.id === 'p_cathedral' ? 'cathedral' : (f.skyline || 'city');
    var p = Object.assign({}, BASE, PAL[k] || PAL.city);
    p.kind = PAL[k] ? k : 'city';
    if (f.lights) p.lights = true;
    return p;
  }

  // ------------------------------------------------------------------ geometry helpers
  function fenceAt(park, s) {
    if (BB.Bat && BB.Bat.fenceAt) return BB.Bat.fenceAt(park, s);
    var f = park.fence;
    if (s <= f[0][0]) return { dist: f[0][1], height: f[0][2] };
    for (var i = 1; i < f.length; i++) if (s <= f[i][0]) { var k = (s - f[i - 1][0]) / (f[i][0] - f[i - 1][0]); return { dist: U.lerp(f[i - 1][1], f[i][1], k), height: U.lerp(f[i - 1][2], f[i][2], k) }; }
    var l = f[f.length - 1]; return { dist: l[1], height: l[2] };
  }
  function sp(s, d, z) { return [d * Math.sin(s * D2R), d * Math.cos(s * D2R), z || 0]; }
  // polar strip between sprays s0..s1 with radius/height functions of spray
  function strip(P, s0, s1, r0, r1, z0, z1, color, step, shade) {
    step = step || 1.5;
    var n = Math.max(1, Math.ceil((s1 - s0) / step));
    for (var i = 0; i < n; i++) {
      var a = s0 + (s1 - s0) * i / n, b = s0 + (s1 - s0) * (i + 1) / n;
      var A0 = sp(a, r0(a), z0(a)), A1 = sp(a, r1(a), z1(a)), B0 = sp(b, r0(b), z0(b)), B1 = sp(b, r1(b), z1(b));
      var col = typeof color === 'function' ? color(a, i) : color;
      P.quad(A0, B0, B1, A1, col, shade);
    }
  }
  function cst(v) { return function () { return v; }; }
  function mound(x, y) { var d = Math.hypot(x, y - 59); return d < 5 ? 0.83 : d < 9 ? 0.83 * (9 - d) / 4 : 0; }
  function ring(P, R, pts, color, z0) { // backdrop silhouette: pts [[spray, h], ...] (closed polygon)
    P.poly(pts, color, function (s, h) { var p = sp(s, R, h + (z0 || 0)); return p; });
  }
  // a skyline profile [[spray, h], ...] (no closing points) as vertical strips down to below the ground
  function ringProfile(P, R, pts, color, z0) {
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1], A0 = sp(a[0], R, -40), B0 = sp(b[0], R, -40), A1 = sp(a[0], R, a[1] + (z0 || 0)), B1 = sp(b[0], R, b[1] + (z0 || 0));
      P.quad(A0, B0, B1, A1, color);
    }
  }
  function rnd(seed) { return U.rng(seed); }
  function lerpC(a, b, t) { return TN.mix(a, b, t); }

  // ------------------------------------------------------------------ painted canvas helpers
  function toonText(x, str, cx, cy, px, fill, edge, shadow, maxW) {
    x.font = px + 'px ' + BB.FONTS.display;
    if (maxW) { var w = x.measureText(str).width; if (w > maxW) { px = px * maxW / w; x.font = px + 'px ' + BB.FONTS.display; } }
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
    if (shadow) { x.fillStyle = shadow; x.fillText(str, cx + px * 0.07, cy + px * 0.09); x.lineWidth = px * 0.16; x.strokeStyle = shadow; x.strokeText(str, cx + px * 0.07, cy + px * 0.09); }
    if (edge) { x.lineWidth = px * 0.16; x.strokeStyle = edge; x.strokeText(str, cx, cy); }
    x.fillStyle = fill; x.fillText(str, cx, cy);
  }
  function rr(x, X, Y, W, H, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r); x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath(); }

  function skyTex(pal) {
    return TN.canvasTex(4, 512, function (x, w, h) {
      // v = 0 bottom of the sphere (elevation -90) .. 1 top (+90). canvas y = 0 is the top (+90).
      var bands = pal.sky;
      x.fillStyle = pal.skyLow; x.fillRect(0, 0, w, h);
      for (var i = 0; i < bands.length; i++) {
        var top = bands[i][0], bot = i + 1 < bands.length ? bands[i + 1][0] : -90;
        var y0 = (90 - top) / 180 * h, y1 = (90 - bot) / 180 * h;
        x.fillStyle = bands[i][1]; x.fillRect(0, y0, w, y1 - y0 + 1);
      }
      x.fillStyle = pal.skyLow; x.fillRect(0, h / 2, w, h / 2);
    }, { noMip: true });
  }
  var cloudTexCache = {};
  function cloudTex(c1, c2, seed) {
    var k = c1 + c2 + seed;
    if (cloudTexCache[k]) return cloudTexCache[k];
    var r = rnd(seed);
    var t = TN.canvasTex(256, 128, function (x, w, h) {
      var puffs = [], n = 4 + Math.floor(r() * 3);
      for (var i = 0; i < n; i++) puffs.push([w * (0.18 + 0.64 * i / (n - 1)) + (r() - 0.5) * 12, h * 0.62 - (Math.sin(i / (n - 1) * PI) * h * 0.22) - r() * 10, h * (0.18 + 0.14 * Math.sin(i / (n - 1) * PI) + r() * 0.06)]);
      x.fillStyle = c2;
      puffs.forEach(function (p) { x.beginPath(); x.arc(p[0], p[1] + 6, p[2], 0, PI * 2); x.fill(); });
      x.fillRect(w * 0.14, h * 0.6, w * 0.72, h * 0.18);
      x.fillStyle = c1;
      puffs.forEach(function (p) { x.beginPath(); x.arc(p[0], p[1], p[2], 0, PI * 2); x.fill(); });
      x.fillRect(w * 0.14, h * 0.56, w * 0.72, h * 0.12);
      x.clearRect(0, h * 0.78, w, h);
    });
    cloudTexCache[k] = t;
    return t;
  }

  // ------------------------------------------------------------------ crowd (instanced, bobbing in the vertex shader)
  var CROWD_U = { uTime: { value: 0 }, uJump: { value: 0 } };
  function crowdMat() {
    var m = new T.MeshBasicMaterial({ vertexColors: true });
    m.onBeforeCompile = function (sh) {
      sh.uniforms.uTime = CROWD_U.uTime; sh.uniforms.uJump = CROWD_U.uJump;
      sh.vertexShader = 'uniform float uTime; uniform float uJump;\n' + sh.vertexShader.replace('#include <begin_vertex>', [
        '#include <begin_vertex>',
        'float ph = dot(instanceMatrix[3].xy, vec2(0.1373, 0.2911));',
        'float spd = 2.6 + fract(ph * 7.31) * 3.0;',
        'float bb = abs(sin(uTime * spd + ph * 6.2831));',
        'float jumpy = step(0.3, fract(ph * 3.71));',
        'transformed.z += bb * (0.12 + uJump * jumpy * 1.6);',
        'transformed.x *= 1.0 + 0.06 * bb;'].join('\n'));
    };
    return m;
  }
  var CROWD_MAT = null;
  var CROWD_G = null;
  function crowdGeoms() {
    if (CROWD_G) return CROWD_G;
    var lowS = new T.SphereGeometry(1, 7, 5), tinyS = new T.SphereGeometry(1, 5, 3);
    var pb = new TN.Paint([0.4, -0.6, 0.7]);
    pb.geom(lowS, TN.M([0, 0, 0.75], null, [0.62, 0.5, 0.75]), '#FFFFFF');
    var body = pb.build();
    var ph = new TN.Paint([0.4, -0.6, 0.7]);
    ph.geom(lowS, TN.M([0, 0, 1.9], null, [0.58, 0.55, 0.55]), '#FFFFFF');
    ph.geom(tinyS, TN.M([-0.42, 0, 2.38], null, [0.2, 0.12, 0.2]), '#FFFFFF');
    ph.geom(tinyS, TN.M([0.42, 0, 2.38], null, [0.2, 0.12, 0.2]), '#FFFFFF');
    ph.geom(tinyS, TN.M([0, -0.42, 1.78], null, [0.26, 0.2, 0.2]), '#F4EEE6', true);
    var head = ph.build();
    lowS.dispose(); tinyS.dispose();
    CROWD_G = { body: body, head: head };
    return CROWD_G;
  }
  // the crowd is split into 30-degree sectors around home, each with its own bounds, so off-screen fans are culled
  function makeCrowd(list, pal, group) {
    if (!list.length) return;
    if (!CROWD_MAT) CROWD_MAT = crowdMat();
    var g = crowdGeoms(), sectors = {}, r = rnd(list.length * 13 + 7);
    list.forEach(function (p) { var k = Math.floor((Math.atan2(p.x, p.y) + PI) / (PI / 6)); (sectors[k] = sectors[k] || []).push(p); });
    var m = new T.Matrix4(), q = new T.Quaternion(), c = new T.Color(), Z = new T.Vector3(0, 0, 1);
    Object.keys(sectors).forEach(function (k) {
      var L = sectors[k], n = L.length, box = new T.Box3();
      L.forEach(function (p) { box.expandByPoint(new T.Vector3(p.x, p.y, p.z)); });
      box.expandByScalar(5);
      var sph = box.getBoundingSphere(new T.Sphere());
      var gb = new T.BufferGeometry(), gh = new T.BufferGeometry();
      ['position', 'color'].forEach(function (a) { gb.setAttribute(a, g.body.getAttribute(a)); gh.setAttribute(a, g.head.getAttribute(a)); });
      gb.boundingSphere = sph; gh.boundingSphere = sph.clone();
      var bodies = new T.InstancedMesh(gb, CROWD_MAT, n), heads = new T.InstancedMesh(gh, CROWD_MAT, n);
      for (var i = 0; i < n; i++) {
        var p = L[i];
        q.setFromAxisAngle(Z, p.yaw);
        m.compose(new T.Vector3(p.x, p.y, p.z), q, new T.Vector3(p.s, p.s, p.s));
        bodies.setMatrixAt(i, m); heads.setMatrixAt(i, m);
        bodies.setColorAt(i, c.set(pal.fans[Math.floor(r() * pal.fans.length)]));
        heads.setColorAt(i, c.set(pal.fur[Math.floor(r() * pal.fur.length)]));
      }
      bodies.frustumCulled = heads.frustumCulled = true;
      group.add(bodies); group.add(heads);
    });
  }

  // ------------------------------------------------------------------ the build
  function build(park) {
    var pal = palFor(park), f = park.features || {}, seed = U.hashStr(park.id || 'park');
    var R = rnd(seed);
    var group = new T.Group(); group.name = 'park:' + park.id;
    var L = pal.sun;
    var FA = function (s) { return fenceAt(park, U.clamp(s, -45, 45)); };
    var anim = [];   // per-frame updaters

    // ---------------- ground layers
    var layers = [];
    function layer(k) { var P = new TN.Paint(L); layers.push([k, P]); return P; }
    var g0 = layer(0), g1 = layer(1), g2 = layer(2), g3 = layer(3), g4 = layer(4), g5 = layer(5), g6 = layer(6);
    // outside the stands
    var outer = []; for (var i = 0; i < 48; i++) { var a = i / 48 * PI * 2; outer.push([Math.sin(a) * 4200, Math.cos(a) * 4200]); }
    g0.ground(outer, pal.outside, -0.6);
    // playing surface (fair + foul territory) bounded by the stands line
    var WF = 52, poleL = FA(-45).dist, poleR = FA(45).dist;
    var uL = [-Math.SQRT1_2, Math.SQRT1_2], uR = [Math.SQRT1_2, Math.SQRT1_2], nL = [-Math.SQRT1_2, -Math.SQRT1_2], nR = [Math.SQRT1_2, -Math.SQRT1_2];
    var bound = [];
    for (var s = -45; s <= 45; s += 1.5) { var fp = sp(s, FA(s).dist); bound.push([fp[0], fp[1]]); }
    bound.push([uR[0] * poleR + nR[0] * WF, uR[1] * poleR + nR[1] * WF]);
    for (var a2 = 315; a2 >= 225; a2 -= 6) bound.push([Math.cos(a2 * D2R) * WF * 1.0 + 0, Math.sin(a2 * D2R) * WF]);
    bound.push([uL[0] * poleL + nL[0] * WF, uL[1] * poleL + nL[1] * WF]);
    // reorder: fair arc goes -45..45, then RF corner, behind home, LF corner
    var standsLine = [[uL[0] * poleL + nL[0] * WF, uL[1] * poleL + nL[1] * WF]];
    for (a2 = 225; a2 <= 315; a2 += 6) standsLine.push([Math.cos(a2 * D2R) * WF, Math.sin(a2 * D2R) * WF]);
    standsLine.push([uR[0] * poleR + nR[0] * WF, uR[1] * poleR + nR[1] * WF]);
    g1.ground(bound, pal.grassF, 0);
    // fair grass + mowing bands
    var fair = [[0, 0]]; for (s = -45; s <= 45; s += 1.5) { var q = sp(s, FA(s).dist - 13); fair.push([q[0], q[1]]); }
    g2.ground(fair, pal.grass, 0.04);
    for (var rr0 = 150; rr0 < 440; rr0 += 26) {
      (function (r0) {
        strip(g3, -45, 45, function () { return r0; }, function (s2) { return Math.max(r0, Math.min(r0 + 13, FA(s2).dist - 13)); }, cst(0.08), cst(0.08), pal.grass2, 1.5);
      })(rr0);
    }
    // warning track
    strip(g3, -45, 45, function (s2) { return FA(s2).dist - 13; }, function (s2) { return FA(s2).dist + 0.2; }, cst(0.08), cst(0.08), pal.track, 1.5);
    // infield dirt: arc of r 95 around the rubber, between the foul lines
    var dirt = [[0, -6]];
    for (s = -47; s <= 47; s += 2) {
      // solve |t*u - c| = 95 for direction s
      var ux = Math.sin(s * D2R), uy = Math.cos(s * D2R), bq = uy * 60.5, tt = bq + Math.sqrt(bq * bq - (3660.25 - 9025));
      dirt.push([ux * tt, uy * tt]);
    }
    g4.ground(dirt, pal.dirt, 0.12);
    // infield grass (inset diamond)
    var ins = 3 * Math.SQRT2;
    g5.ground([[0, ins + 9], [63.64 - ins - 2, 63.64], [0, 127.28 - ins - 3], [-63.64 + ins + 2, 63.64]], pal.grass, 0.16);
    // dirt circles: home, bases, mound
    function circ(P, cx, cy, r, col, z, n) { var pts = []; n = n || 28; for (var k = 0; k < n; k++) { var aa = k / n * PI * 2; pts.push([cx + Math.cos(aa) * r, cy + Math.sin(aa) * r]); } P.ground(pts, col, z); }
    circ(g6, 0, 0, 13, pal.dirt, 0.2, 36);
    circ(g6, 0, 59, 9.5, pal.dirt, 0.2);
    K.BASES.slice(1).forEach(function (b) { circ(g6, b.x, b.y, 8, pal.dirt, 0.2); });
    // chalk: foul lines, batter's boxes, catcher's box, on-deck circles
    var g7 = layer(7);
    function line(P, x0, y0, x1, y1, w, col, z) {
      var dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy) || 1, nx = -dy / l * w / 2, ny = dx / l * w / 2;
      P.ground([[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]], col, z);
    }
    line(g7, 1.6, 1.6, uR[0] * poleR, uR[1] * poleR, 0.4, pal.chalk, 0.24);
    line(g7, -1.6, 1.6, uL[0] * poleL, uL[1] * poleL, 0.4, pal.chalk, 0.24);
    [-1, 1].forEach(function (sg) {
      var x0 = sg * 1.25, x1 = sg * 5.25, y0 = -3, y1 = 3, w = 0.22;
      line(g7, x0, y0, x0, y1, w, pal.chalk, 0.24); line(g7, x1, y0, x1, y1, w, pal.chalk, 0.24);
      line(g7, x0, y1, x1, y1, w, pal.chalk, 0.24); line(g7, x0, y0, x1, y0, w, pal.chalk, 0.24);
      // on-deck circles
      var ocx = sg * 34, ocy = -22, pts = [];
      for (var k = 0; k < 24; k++) { var aa = k / 24 * PI * 2; pts.push([ocx + Math.cos(aa) * 2.6, ocy + Math.sin(aa) * 2.6]); }
      g7.ground(pts, pal.dirt2, 0.22);
    });
    line(g7, -1.8, -3, -1.8, -11, 0.22, pal.chalk, 0.24); line(g7, 1.8, -3, 1.8, -11, 0.22, pal.chalk, 0.24);
    // home plate with an ink rim
    var plate = [[-0.71, 0.36], [0.71, 0.36], [0.71, -0.35], [0, -1.06], [-0.71, -0.35]];
    var g8 = layer(8);
    g8.ground(plate.map(function (p) { return [p[0] * 1.12, p[1] * 1.12 - 0.02]; }), INK, 0.26);
    var g9 = layer(9);
    g9.ground(plate, '#FFFDF6', 0.28);
    layers.forEach(function (lp) {
      var m = new T.Mesh(lp[1].build(), TN.layerMat(lp[0], { side: T.DoubleSide }));
      m.renderOrder = -lp[0]; group.add(m); // top layer first: early-z rejects the layers beneath
    });

    // ---------------- solids: mound, bases, rubber, wall, poles, stands, backdrop props
    var S3 = new TN.Paint(L);
    var mprof = []; for (var k = 0; k <= 8; k++) { var rr1 = 9.5 - k * 0.6; mprof.push(new T.Vector2(Math.max(0.01, rr1), mound(0, 59 + rr1))); }
    mprof.push(new T.Vector2(0.01, 0.83));
    var mg = new T.LatheGeometry(mprof.reverse(), 28); mg.computeVertexNormals();
    S3.geom(mg, TN.M([0, 59, 0.0], [PI / 2, 0, 0]), pal.dirt); mg.dispose();
    S3.box(0, 60.5, 0.8, 2, 0.5, 0.12, 0, '#FFFDF6');
    K.BASES.slice(1).forEach(function (b, bi) { S3.box(b.x, b.y, 0, 1.4, 1.4, 0.3, PI / 4 * (bi === 1 ? 1 : 1), '#FFFDF6'); });

    // the outfield wall (inner face = padding colour, top = yellow home-run line)
    var WT = 1.6;
    strip(S3, -45, 45, function (s2) { return FA(s2).dist; }, function (s2) { return FA(s2).dist; }, cst(0), function (s2) { return FA(s2).height - 0.7; }, pal.pad, 1);
    strip(S3, -45, 45, function (s2) { return FA(s2).dist - 0.01; }, function (s2) { return FA(s2).dist - 0.01; }, function (s2) { return FA(s2).height - 0.7; }, function (s2) { return FA(s2).height; }, pal.wallTop, 1);
    strip(S3, -45, 45, function (s2) { return FA(s2).dist; }, function (s2) { return FA(s2).dist + WT; }, function (s2) { return FA(s2).height; }, function (s2) { return FA(s2).height; }, TN.shade(pal.wall, 0.8), 1);
    strip(S3, -45, 45, function (s2) { return FA(s2).dist + WT; }, function (s2) { return FA(s2).dist + WT; }, cst(0), function (s2) { return FA(s2).height; }, TN.shade(pal.wall, 0.7), 1);
    // wall panels: thin vertical seams for a painted-wood look
    for (s = -44; s <= 44; s += 4) { var fs = FA(s), pa = sp(s, fs.dist - 0.05, 0), pb2 = sp(s + 0.12, fs.dist - 0.05, 0); S3.quad(pa, pb2, [pb2[0], pb2[1], fs.height - 0.7], [pa[0], pa[1], fs.height - 0.7], TN.shade(pal.pad, 0.82)); }
    // foul poles
    [-45, 45].forEach(function (s2) { var fs = FA(s2), p = sp(s2, fs.dist + 0.8); S3.cyl(p[0], p[1], 0, 0.55, fs.height + 52, pal.wallTop, 8); });

    // batter's eye (dark block behind centre field) unless the lake sits there
    var eyeA = -4.5, eyeB = 4.5, water = f.water || 'none';
    if (water !== 'center') {
      strip(S3, eyeA, eyeB, function (s2) { return FA(s2).dist + WT; }, function (s2) { return FA(s2).dist + WT; }, cst(0), cst(24), pal.eye, 1);
      strip(S3, eyeA, eyeB, function (s2) { return FA(s2).dist + WT; }, function (s2) { return FA(s2).dist + WT + 8; }, cst(24), cst(24), TN.shade(pal.eye, 0.85), 1);
    }

    // ---------------- outfield bleachers (+ crowd)
    var crowd = [], CR = rnd(seed + 99);
    var bleach = [[-45, eyeA]];
    if (water !== 'center') bleach.push([eyeB, 45]); else bleach = [[-45, -22], [22, 45]];
    if (water === 'right') bleach = bleach.map(function (b) { return [b[0], Math.min(b[1], 12)]; }).filter(function (b) { return b[1] > b[0]; });
    var ROWS = 7, RD = 4.6, RH = 2.4;
    function bleachZ0(s2) { return Math.max(4, FA(s2).height * 0.55); }
    bleach.forEach(function (rg) {
      for (var r = 0; r < ROWS; r++) {
        (function (r) {
          var r0 = function (s2) { return FA(s2).dist + WT + 1 + r * RD; }, r1 = function (s2) { return r0(s2) + RD; };
          var zt = function (s2) { return bleachZ0(s2) + (r + 1) * RH; }, zb = function (s2) { return bleachZ0(s2) + r * RH; };
          strip(S3, rg[0], rg[1], r0, r0, zb, zt, r % 2 ? pal.stand : pal.stand2, 2, true);
          strip(S3, rg[0], rg[1], r0, r1, zt, zt, r % 2 ? pal.seat : pal.seat2, 2);
          var arc = (rg[1] - rg[0]) * D2R * (FA((rg[0] + rg[1]) / 2).dist + r * RD), n = Math.floor(arc / 4.8);
          for (var c = 0; c < n; c++) {
            if (CR() < 0.22) continue;
            var s3 = rg[0] + (rg[1] - rg[0]) * (c + 0.5 + (CR() - 0.5) * 0.3) / n, p = sp(s3, r0(s3) + RD * 0.5, zt(s3));
            crowd.push({ x: p[0], y: p[1], z: p[2], yaw: -s3 * D2R + PI, s: 1.25 + CR() * 0.3 });
          }
        })(r);
      }
      // back wall of the bleachers
      strip(S3, rg[0], rg[1], function (s2) { return FA(s2).dist + WT + 1 + ROWS * RD; }, function (s2) { return FA(s2).dist + WT + 1 + ROWS * RD; }, cst(0), function (s2) { return bleachZ0(s2) + ROWS * RH + 5; }, TN.shade(pal.stand, 0.8), 2);
    });

    // ---------------- grandstand along the foul lines and behind home
    var GR = 9, GD = 4.8, GH = 2.5, G0 = 5;
    var gl = standsLine.slice();
    // densify
    function offsetPt(i, d) {
      var p = gl[i], a = gl[Math.max(0, i - 1)], b = gl[Math.min(gl.length - 1, i + 1)];
      var tx = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tx, ty) || 1;
      var nx = ty / l, ny = -tx / l; // outward (away from the field)
      if (nx * p[0] + ny * p[1] < 0 && Math.hypot(p[0], p[1]) < 80) { nx = -nx; ny = -ny; }
      return [p[0] + nx * d, p[1] + ny * d];
    }
    var dense = [];
    for (i = 0; i < gl.length - 1; i++) {
      var A = gl[i], B = gl[i + 1], segs = Math.max(1, Math.ceil(Math.hypot(B[0] - A[0], B[1] - A[1]) / 20));
      for (k = 0; k < segs; k++) dense.push([A[0] + (B[0] - A[0]) * k / segs, A[1] + (B[1] - A[1]) * k / segs]);
    }
    dense.push(gl[gl.length - 1]);
    gl = dense;
    for (var r = 0; r <= GR; r++) {
      for (i = 0; i < gl.length - 1; i++) {
        var a0 = offsetPt(i, r * GD), b0 = offsetPt(i + 1, r * GD), a1 = offsetPt(i, (r + 1) * GD), b1 = offsetPt(i + 1, (r + 1) * GD);
        var z0 = r === 0 ? 0 : G0 + (r - 1) * GH, zt = G0 + r * GH;
        S3.quad([a0[0], a0[1], z0], [b0[0], b0[1], z0], [b0[0], b0[1], zt], [a0[0], a0[1], zt], r === 0 ? pal.pad : (r % 2 ? pal.stand : pal.stand2));
        if (r < GR) {
          S3.quad([a0[0], a0[1], zt], [b0[0], b0[1], zt], [b1[0], b1[1], zt], [a1[0], a1[1], zt], r % 2 ? pal.seat : pal.seat2);
          var segL = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]), nC = Math.floor(segL / 6.5);
          for (var c = 0; c < nC; c++) {
            if (CR() < 0.35 || r === 0) continue;
            var u = (c + 0.5) / nC, x = a0[0] + (b0[0] - a0[0]) * u + (a1[0] - a0[0]) * 0.5, y = a0[1] + (b0[1] - a0[1]) * u + (a1[1] - a0[1]) * 0.5;
            crowd.push({ x: x, y: y, z: zt, yaw: Math.atan2(-x, y) + PI, s: 1.25 + CR() * 0.3 });
          }
        }
      }
    }
    // back wall + roof posts + roof of the grandstand
    var topZ = G0 + GR * GH;
    for (i = 0; i < gl.length - 1; i++) {
      var ab = offsetPt(i, (GR + 1) * GD), bb = offsetPt(i + 1, (GR + 1) * GD);
      S3.quad([ab[0], ab[1], 0], [bb[0], bb[1], 0], [bb[0], bb[1], topZ + 16], [ab[0], ab[1], topZ + 16], TN.shade(pal.stand, 0.75));
      var ra = offsetPt(i, GD * 3), rb = offsetPt(i + 1, GD * 3);
      S3.quad([ra[0], ra[1], topZ + 16], [rb[0], rb[1], topZ + 16], [bb[0], bb[1], topZ + 16], [ab[0], ab[1], topZ + 16], pal.roof);
      if (i % 3 === 0) S3.cyl(ra[0], ra[1], G0 + 2 * GH, 0.6, topZ + 16 - (G0 + 2 * GH), TN.shade(pal.roof, 0.8), 6);
    }
    // roof front fascia
    for (i = 0; i < gl.length - 1; i++) { var fa = offsetPt(i, GD * 3), fb = offsetPt(i + 1, GD * 3); S3.quad([fa[0], fa[1], topZ + 13], [fb[0], fb[1], topZ + 13], [fb[0], fb[1], topZ + 16.5], [fa[0], fa[1], topZ + 16.5], TN.shade(pal.roof, 1.15)); }
    // dugouts
    [-1, 1].forEach(function (sg) { var dx = sg * 70, dy = 22; S3.box(dx + sg * 30, dy - 48 + 18, 0, 34, 8, 4, sg * PI / 4 * -1 + 0, TN.shade(pal.stand, 0.7)); });

    // ---------------- features & backdrop
    var BD = new TN.Paint(L);     // far backdrop (flat silhouettes)
    var kind = pal.kind;
    function hills(P, Rr, col, amp, base, freq, ph, s0, s1, z0) {
      var pts = [];
      for (var s4 = s0; s4 <= s1; s4 += 2) pts.push([s4, base + amp * (0.5 + 0.5 * Math.sin(s4 * freq * D2R + ph)) * (0.7 + 0.3 * Math.sin(s4 * 0.033 + ph * 2))]);
      ringProfile(P, Rr, pts, col, z0);
    }
    function tree(P, x, y, h, col, trunk) { P.cyl(x, y, 0, h * 0.06, h * 0.55, trunk || '#7A5236', 6); P.ball(x, y, h * 0.7, h * 0.32, h * 0.32, h * 0.3, col); }
    function pine(P, x, y, h, col) { P.cyl(x, y, 0, h * 0.05, h * 0.2, '#6A4630', 5); for (var t = 0; t < 3; t++) { var g = new T.ConeGeometry(h * (0.34 - t * 0.07), h * 0.42, 7); P.geom(g, TN.M([x, y, h * (0.32 + t * 0.2)], [PI / 2, 0, 0]), TN.shade(col, 1 + t * 0.06)); g.dispose(); } }
    function barn(P, x, y, w, d, h, rot, col) {
      P.box(x, y, 0, w, d, h, rot, col);
      var g = new T.CylinderGeometry(h * 0.62, h * 0.62, w * 1.04, 3); // triangular prism roof
      P.geom(g, TN.M([x, y, h + h * 0.28], [0, 0, rot + PI / 2, 'ZXY'], [1, 1, 1]), '#5A3A3A'); g.dispose();
      // white trim: a door with a cross brace on the face toward home
      var fa = Math.atan2(-x, -y), nx = Math.sin(fa), ny = Math.cos(fa), tx = -ny, ty = nx, fx = x + nx * (d / 2 + 0.4), fy = y + ny * (d / 2 + 0.4), dw = w * 0.18, dh = h * 0.62;
      P.quad([fx - tx * dw, fy - ty * dw, 0], [fx + tx * dw, fy + ty * dw, 0], [fx + tx * dw, fy + ty * dw, dh], [fx - tx * dw, fy - ty * dw, dh], '#FFF4DC');
      P.quad([fx - tx * dw * 0.8, fy - ty * dw * 0.8, dh * 0.08], [fx + tx * dw * 0.8, fy + ty * dw * 0.8, dh * 0.08], [fx + tx * dw * 0.8, fy + ty * dw * 0.8, dh * 0.92], [fx - tx * dw * 0.8, fy - ty * dw * 0.8, dh * 0.92], TN.shade(col, 0.85));
    }
    function silo(P, x, y, r, h, col) { P.cyl(x, y, 0, r, h, col, 12); P.ball(x, y, h, r, r, r * 0.8, '#B5B8C2', false); }
    function haybale(P, x, y, r, rot) { var g = new T.CylinderGeometry(r, r, r * 1.3, 12); P.geom(g, TN.M([x, y, r], [0, 0, rot]), '#F2B632'); g.dispose(); }
    function building(P, x, y, w, d, h, rot, col, win, lit) {
      P.box(x, y, 0, w, d, h, rot, col);
      // windows on the face toward home
      var nx = -Math.sin(Math.atan2(x, y)), ny = -Math.cos(Math.atan2(x, y));
      var fxp = x + nx * (d / 2 + 0.2), fyp = y + ny * (d / 2 + 0.2), tx = -ny, ty = nx;
      var cols = Math.max(2, Math.floor(w / 9)), rows = Math.max(2, Math.floor(h / 11));
      for (var i2 = 0; i2 < cols; i2++) for (var j = 0; j < rows; j++) {
        var u = (i2 + 0.5) / cols - 0.5, cx2 = fxp + tx * u * w * 0.9, cy2 = fyp + ty * u * w * 0.9, z = h * (0.18 + 0.72 * (j + 0.5) / rows), ww = w / cols * 0.24, hh = h / rows * 0.24;
        var on = lit && ((i2 * 7 + j * 3 + Math.floor(x)) % 3 !== 0);
        P.quad([cx2 - tx * ww, cy2 - ty * ww, z - hh], [cx2 + tx * ww, cy2 + ty * ww, z - hh], [cx2 + tx * ww, cy2 + ty * ww, z + hh], [cx2 - tx * ww, cy2 - ty * ww, z + hh], on ? '#FFD98A' : win);
      }
    }
    function waterTower(P, x, y, z0, col) {
      for (var l = 0; l < 4; l++) { var aa = l / 4 * PI * 2 + PI / 4; P.cyl(x + Math.cos(aa) * 6, y + Math.sin(aa) * 6, z0, 0.6, 26, '#4A3A4A', 5); }
      P.cyl(x, y, z0 + 24, 9, 18, col, 14);
      var g = new T.ConeGeometry(10, 9, 14); P.geom(g, TN.M([x, y, z0 + 46.5], [PI / 2, 0, 0]), TN.shade(col, 0.8)); g.dispose();
    }
    function saguaro(P, x, y, h, col) {
      var g = new T.CapsuleGeometry(h * 0.08, h * 0.84, 3, 8);
      P.geom(g, TN.M([x, y, h * 0.5], [PI / 2, 0, 0]), col);
      [-1, 1].forEach(function (sg, i3) {
        var ah = h * (0.38 + i3 * 0.12);
        var g2 = new T.CapsuleGeometry(h * 0.06, h * 0.22, 3, 8);
        P.geom(g2, TN.M([x + sg * h * 0.17, y, ah], [0, PI / 2, 0]), col);
        var g3 = new T.CapsuleGeometry(h * 0.06, h * 0.26, 3, 8);
        P.geom(g3, TN.M([x + sg * h * 0.28, y, ah + h * 0.15], [PI / 2, 0, 0]), col);
        g2.dispose(); g3.dispose();
      });
      g.dispose();
    }
    function mesas(P, Rr, cols, seed2, s0, s1, hmax) {
      var r2 = rnd(seed2), s5 = s0;
      while (s5 < s1) {
        var w = 8 + r2() * 18, h = hmax * (0.45 + r2() * 0.55), sl = 2 + r2() * 3, base = -20;
        var pts = [[s5, base], [s5 + sl, h], [s5 + w - sl, h], [s5 + w, base]];
        ring(P, Rr, pts, cols[0]);
        // shadow side (painted)
        ring(P, Rr - 2, [[s5 + w * 0.62, base], [s5 + w * 0.62 + sl * 0.4, h * 0.97], [s5 + w - sl, h * 0.97], [s5 + w, base]], cols[1]);
        // stripes
        ring(P, Rr - 3, [[s5 + sl * 0.5, h * 0.62], [s5 + w - sl * 0.5, h * 0.62], [s5 + w - sl * 0.45, h * 0.68], [s5 + sl * 0.45, h * 0.68]], cols[2]);
        s5 += w * (0.6 + r2() * 0.7);
      }
    }

    var moon = null, sunDisc = null, propsP = new TN.Paint(L), lightLamps = [];
    if (kind === 'barns') {
      hills(BD, 2600, '#B9D49A', 120, 20, 3.2, 1.2, -120, 120);
      hills(BD, 2100, '#9CC46A', 90, 0, 4.5, 2.4, -120, 120);
      hills(BD, 1500, '#C8B860', 50, -10, 6.5, 0.4, -120, 120);
      // farm: barns, silos, haybales, lollipop trees, a tractor in deep left
      barn(propsP, -260, 640, 70, 50, 38, 0.3, '#C8452F'); silo(propsP, -205, 660, 14, 70, '#D9D2C2');
      barn(propsP, 330, 720, 60, 46, 32, -0.4, '#D9483B'); silo(propsP, 280, 760, 12, 62, '#C9C2B2');
      for (i = 0; i < 18; i++) { var hs = -70 + R() * 140, hd = 520 + R() * 400; var hp = sp(hs, hd); if (Math.abs(hs) < 12 && hd < 700) continue; haybale(propsP, hp[0], hp[1], 5 + R() * 2, R() * PI); }
      for (i = 0; i < 26; i++) { var ts = -110 + R() * 220, td = 560 + R() * 700, tp = sp(ts, td); tree(propsP, tp[0], tp[1], 40 + R() * 35, R() < 0.5 ? '#4E9A3E' : '#6DB04A'); }
      // tractor parked in deep left
      var tq2 = sp(-34, FA(-34).dist + 26);
      propsP.box(tq2[0], tq2[1], 2.5, 12, 7, 6, 0.6, '#D9483B'); propsP.box(tq2[0] + 2, tq2[1] + 1, 8.5, 5, 5, 5, 0.6, '#D9483B');
      [[-4, 3.5, 4.5], [5, 3, 3]].forEach(function (w) { var g = new T.CylinderGeometry(w[2], w[2], 2, 12); [-1, 1].forEach(function (sd) { propsP.geom(g, TN.M([tq2[0] + w[0], tq2[1] + sd * 4.5, w[2]], [0, 0, 0.6]), '#2F2A38'); }); g.dispose(); });
    } else if (kind === 'city') {
      hills(BD, 2700, '#8A6A9A', 60, 10, 5, 0.3, -130, 130);
      var rC = rnd(seed + 5);
      for (var bsx = -110; bsx < 110; bsx += 7 + rC() * 6) { var bh = 120 + rC() * 260; ring(BD, 2300, [[bsx, -10], [bsx, bh], [bsx + 6, bh], [bsx + 6, -10]], rC() < 0.5 ? '#5A4A82' : '#6A5590'); }
      for (bsx = -110; bsx < 110; bsx += 6 + rC() * 5) { var bh2 = 70 + rC() * 140; ring(BD, 1700, [[bsx, -10], [bsx, bh2], [bsx + 5, bh2], [bsx + 5, -10]], rC() < 0.5 ? '#7A4E78' : '#8A5A80'); }
      // tenements over right field, brick buildings behind left, water tower, el train
      for (i = 0; i < 9; i++) { var bs = 12 + i * 4.2, bd = FA(Math.min(45, bs)).dist + 70 + (i % 2) * 25; var bp = sp(bs, bd); building(propsP, bp[0], bp[1], 40, 30, 60 + (i * 37 % 50), -bs * D2R, i % 2 ? '#B5523B' : '#9E4A3A', '#5A3A4A', true); }
      for (i = 0; i < 8; i++) { var bs2 = -60 + i * 6.5, bd2 = 560 + (i % 3) * 40; var bp2 = sp(bs2, bd2); building(propsP, bp2[0], bp2[1], 46, 34, 70 + (i * 29 % 60), -bs2 * D2R, i % 2 ? '#A8553E' : '#8E4A44', '#4A3A5A', true); }
      var wtp = sp(26, 560); waterTower(propsP, wtp[0], wtp[1], 92, '#A0705A');
      var wtp2 = sp(-24, 640); waterTower(propsP, wtp2[0], wtp2[1], 110, '#8A6A5A');
      // the el: a track on pillars beyond left field + a train that rattles by
      for (s = -60; s <= 10; s += 5) { var ep = sp(s, 480); propsP.cyl(ep[0], ep[1], 0, 1.4, 44, '#4A3E5A', 6); }
      strip(propsP, -60, 10, cst(474), cst(486), cst(44), cst(44), '#3E344E', 2);
      strip(propsP, -60, 10, cst(474), cst(474), cst(40), cst(44), '#4A3E5A', 2);
      var trainG = new TN.Paint(L);
      for (i = 0; i < 4; i++) { var tg = new T.BoxGeometry(44, 9, 11); trainG.geom(tg, TN.M([i * 47, 0, 50], null), i % 2 ? '#D9A23B' : '#C8452F'); tg.dispose(); for (var wi = 0; wi < 4; wi++) { var wg = new T.BoxGeometry(5, 9.4, 4); trainG.geom(wg, TN.M([i * 47 - 15 + wi * 10, 0, 52]), '#FFE7A8', true); wg.dispose(); } }
      var train = new T.Mesh(trainG.build(), new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide }));
      group.add(train);
      anim.push(function (time) {
        var cyc = (time % 26) / 26, s6 = -110 + cyc * 160; // degrees along the track
        var p = sp(s6, 480); train.position.set(p[0], p[1], 0); train.rotation.z = -s6 * D2R - PI / 2 + PI;
        train.visible = s6 > -70 && s6 < 20;
      });
    } else if (kind === 'pines') {
      hills(BD, 2900, '#8DB6C8', 260, 40, 2.4, 0.8, -130, 130);
      hills(BD, 2500, '#6E9AAE', 170, 20, 3.4, 2.1, -130, 130);
      // pine forest ring silhouettes
      [[2100, '#2F6B4A', 70], [1700, '#255A3E', 60]].forEach(function (lay, li) {
        var pts = [], rP = rnd(seed + li);
        for (var s7 = -130; s7 <= 130; s7 += 1.6) { var hh = lay[2] + rP() * lay[2] * 0.8; pts.push([s7, hh * 0.45]); pts.push([s7 + 0.8, hh]); }
        ringProfile(BD, lay[0], pts, lay[1]);
      });
      for (i = 0; i < 46; i++) { var ps = -95 + R() * 190, pd = 520 + R() * 420; if (water === 'center' && Math.abs(ps) < 22 && pd < 900) continue; var pp = sp(ps, pd); pine(propsP, pp[0], pp[1], 45 + R() * 45, R() < 0.5 ? '#2F6B4A' : '#3E7F56'); }
    } else if (kind === 'harbor') {
      hills(BD, 2700, '#8EB9B0', 140, 0, 3.0, 1.6, -130, -10);
      hills(BD, 2400, '#6E9E94', 80, -10, 5, 0.6, -130, 0);
      // lighthouse on a point, boats, piers
      var lp = sp(52, 900);
      propsP.cyl(lp[0], lp[1], 0, 26, 8, '#8A7A6A', 10);
      for (i = 0; i < 6; i++) propsP.cyl(lp[0], lp[1], 8 + i * 12, 9 - i * 0.6, 12, i % 2 ? '#F7F2E6' : '#D9483B', 12, 9 - (i + 1) * 0.6);
      propsP.cyl(lp[0], lp[1], 80, 5.5, 8, '#FFE7A8', 10); propsP.cyl(lp[0], lp[1], 88, 6.5, 6, '#2F2A38', 10, 0.5);
      lightLamps.push({ x: lp[0], y: lp[1], z: 84, r: 30, beam: true });
      for (i = 0; i < 7; i++) { var bp3 = sp(20 + R() * 40, 430 + R() * 380); propsP.box(bp3[0], bp3[1], 0, 14, 5, 2.5, R() * PI, R() < 0.5 ? '#F7F2E6' : '#D9483B'); propsP.cyl(bp3[0], bp3[1], 2, 0.3, 14, '#5A4A3A', 4); var sg2 = new T.ConeGeometry(4, 11, 3); propsP.geom(sg2, TN.M([bp3[0] + 2, bp3[1], 9], [PI / 2, 0, 0]), '#FFF9EE'); sg2.dispose(); }
      for (i = 0; i < 6; i++) { var bp4 = sp(-70 + i * 9, 560 + (i % 2) * 40); building(propsP, bp4[0], bp4[1], 34, 26, 30 + (i * 13 % 25), -(-70 + i * 9) * D2R, ['#7FD1D9', '#F29E8E', '#F2B632', '#FFF4DC'][i % 4], '#2F4A5A', false); }
    } else if (kind === 'desert') {
      mesas(BD, 2600, ['#9A5A7A', '#7E4A6E', '#AE6A86'], seed + 1, -130, 130, 260);
      mesas(BD, 2000, ['#C8605A', '#A24C54', '#DB7A6A'], seed + 2, -120, 120, 190);
      mesas(BD, 1500, ['#E58A72', '#C46A62', '#F0A084'], seed + 3, -110, 110, 110);
      for (i = 0; i < 30; i++) { var ss = -90 + R() * 180, sd = 470 + R() * 520, spp = sp(ss, sd); if (Math.abs(ss) < 8 && sd < 560) continue; saguaro(propsP, spp[0], spp[1], 28 + R() * 26, R() < 0.5 ? '#2F6B4A' : '#3A7A52'); }
      // hill beyond centre
      var hg = new T.SphereGeometry(1, 20, 10, 0, PI * 2, 0, PI / 2);
      var hc = sp(0, FA(0).dist + 90); propsP.geom(hg, TN.M([hc[0], hc[1], -6], [PI / 2, 0, 0], [140, 30, 60]), '#B97A5A'); hg.dispose();
    } else { // cathedral: a grand arched brick facade around the outfield
      hills(BD, 2700, '#6A4A7A', 50, 0, 6, 0.2, -130, 130);
      var rC2 = rnd(seed + 9);
      for (var bsx2 = -120; bsx2 < 120; bsx2 += 5 + rC2() * 4) { var bh3 = 90 + rC2() * 180; ring(BD, 2200, [[bsx2, -10], [bsx2, bh3], [bsx2 + 4, bh3], [bsx2 + 4, -10]], rC2() < 0.5 ? '#5A3E6E' : '#6A4A78'); if (rC2() < 0.15) ring(BD, 2190, [[bsx2 + 1.2, bh3], [bsx2 + 2, bh3 + 60], [bsx2 + 2.8, bh3]], '#5A3E6E'); }
      var FR = function (s8) { return FA(s8).dist + WT + 1 + ROWS * RD + 8; };
      strip(propsP, -50, 50, FR, FR, cst(0), cst(78), '#A8553E', 2);
      strip(propsP, -50, 50, FR, function (s8) { return FR(s8) + 26; }, cst(78), cst(92), pal.roof, 2);
      for (s = -48; s <= 48; s += 4) { // arches
        var a8 = sp(s, FR(s) - 0.4), b8 = sp(s + 2.4, FR(s + 2.4) - 0.4);
        propsP.quad([a8[0], a8[1], 34], [b8[0], b8[1], 34], [b8[0], b8[1], 62], [a8[0], a8[1], 62], '#5A2E3A');
        var m8 = sp(s + 1.2, FR(s + 1.2) - 0.45); propsP.tri([a8[0], a8[1], 62], [b8[0], b8[1], 62], [m8[0], m8[1], 70], '#5A2E3A');
        propsP.quad([a8[0], a8[1], 8], [b8[0], b8[1], 8], [b8[0], b8[1], 26], [a8[0], a8[1], 26], '#6E3640');
      }
      for (s = -48; s <= 48; s += 12) { var fpp = sp(s, FR(s) + 4); propsP.cyl(fpp[0], fpp[1], 92, 0.5, 26, '#4A3A3A', 4); var fl = new T.PlaneGeometry(12, 7); propsP.geom(fl, TN.M([fpp[0] + 6, fpp[1], 114], [PI / 2, 0, 0]), ['#F2B632', '#D9483B', '#FFF4DC'][((s + 48) / 12) % 3], true); fl.dispose(); }
    }
    // water
    if (water !== 'none') {
      var WP = new TN.Paint(L), wc = kind === 'harbor' ? '#2F8C9C' : '#3D8FC4', wc2 = kind === 'harbor' ? '#4FA7B2' : '#5BA6D6';
      var ws0 = water === 'right' ? 14 : water === 'left' ? -80 : -40, ws1 = water === 'right' ? 100 : water === 'left' ? -14 : 40;
      var wr0 = function (s9) { return FA(s9).dist + WT + (water === 'center' ? 60 : 8); };
      strip(WP, ws0, ws1, wr0, cst(2400), cst(-0.2), cst(-0.2), wc, 2);
      for (var wl = 0; wl < 14; wl++) { var wsr = ws0 + R() * (ws1 - ws0), wd = 480 + R() * 900; var wq = function (o) { return function () { return o; }; }; strip(WP, wsr, wsr + 2 + R() * 4, wq(wd), wq(wd + 3), cst(0.1), cst(0.1), wc2, 1); }
      var wm = new T.Mesh(WP.build(), new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide }));
      group.add(wm);
      if (water === 'center') { // a canoe and a loon on the lake
        var cp = sp(-6, FA(0).dist + 150); propsP.ball(cp[0], cp[1], 0.6, 3, 11, 1.4, '#C8452F');
        var lp2 = sp(9, FA(0).dist + 220); propsP.ball(lp2[0], lp2[1], 1.4, 2.4, 4, 1.6, '#2C2C36'); propsP.ball(lp2[0], lp2[1] - 3, 3.2, 1.2, 1.2, 1.2, '#2C2C36');
      }
    }

    // ---------------- light towers
    var towers = [];
    if (pal.lights) {
      [[-62, 1.0], [-28, 1.12], [28, 1.12], [62, 1.0]].forEach(function (t) {
        var d = t[0] < -40 || t[0] > 40 ? 420 : FA(t[0]).dist * t[1] + 60, p = sp(t[0], d);
        propsP.cyl(p[0], p[1], 0, 2.2, 150, '#5A5466', 6, 1.4);
        var face = Math.atan2(-p[0], -p[1]);
        propsP.box(p[0], p[1], 146, 34, 3, 22, -face, '#4A4456');
        towers.push({ x: p[0], y: p[1], z: 157, face: face });
      });
    }

    // ---------------- scoreboard + billboard (painted canvas faces)
    var sbS = -10, sbD = FA(sbS).dist + WT + 1 + ROWS * RD + 14, sbP = sp(sbS, sbD), sbZ = bleachZ0(sbS) + ROWS * RH + 6;
    if (kind === 'cathedral') { sbS = -20; sbD = FA(sbS).dist + 40; sbP = sp(sbS, sbD); sbZ = 22; }
    var sbW = 62, sbH = 30;
    propsP.cyl(sbP[0] - 20, sbP[1], 0, 1.6, sbZ, '#4A3E4A', 6); propsP.cyl(sbP[0] + 20, sbP[1], 0, 1.6, sbZ, '#4A3E4A', 6);
    var sbFace = Math.atan2(-sbP[0], -sbP[1]);
    propsP.box(sbP[0], sbP[1], sbZ - 1, sbW + 6, 4, sbH + 6, -sbFace, '#2F2A38');
    var sbTex = TN.canvasTex(512, 256, function () {}), sbCanvas = sbTex.userData.canvas;
    var sbMesh = new T.Mesh(new T.PlaneGeometry(sbW, sbH), new T.MeshBasicMaterial({ map: sbTex }));
    var fwd = [-sbP[0], -sbP[1]], fl2 = Math.hypot(fwd[0], fwd[1]); fwd = [fwd[0] / fl2, fwd[1] / fl2];
    sbMesh.position.set(sbP[0] + fwd[0] * 2.3, sbP[1] + fwd[1] * 2.3, sbZ + 2 + sbH / 2);
    sbMesh.up.set(0, 0, 1); sbMesh.lookAt(sbMesh.position.x + fwd[0], sbMesh.position.y + fwd[1], sbMesh.position.z);
    group.add(sbMesh);
    function paintScoreboard(hud) {
      var x = sbCanvas.getContext('2d'), w = 512, h = 256;
      x.fillStyle = '#24402F'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#2E5A40'; x.fillRect(10, 10, w - 20, h - 20);
      toonText(x, (park.town || park.name || 'BALLPARK').toUpperCase(), w / 2, 40, 40, '#FFF4DC', null, '#1B1420', w - 40);
      var cells = 9, cw = 36, x0 = 92, y0 = 80;
      x.font = '22px ' + BB.FONTS.display; x.textAlign = 'center'; x.textBaseline = 'middle';
      for (var c2 = 0; c2 < cells; c2++) { x.fillStyle = '#FFF4DC'; x.fillText(String(c2 + 1), x0 + c2 * cw + cw / 2, y0); }
      ['VIS', 'HOME'].forEach(function (t, j) {
        x.fillStyle = '#FFF4DC'; x.textAlign = 'left'; x.fillText(t, 22, y0 + 38 + j * 40); x.textAlign = 'center';
        for (var c3 = 0; c3 < cells; c3++) {
          x.fillStyle = '#1B1420'; x.fillRect(x0 + c3 * cw + 3, y0 + 22 + j * 40, cw - 6, 32);
          var v = (c3 * 7 + j * 3 + seed) % 5 === 0 ? 1 : 0; if (c3 < 7) { x.fillStyle = '#F2B632'; x.fillText(String(v), x0 + c3 * cw + cw / 2, y0 + 39 + j * 40); }
        }
      });
      var sc2 = hud && hud.score ? String(hud.score) : '0–0', inn = hud && hud.inning ? hud.inning : 'INN';
      x.fillStyle = '#1B1420'; x.fillRect(22, 182, 210, 54); toonText(x, sc2, 127, 210, 34, '#F2B632', null, null, 190);
      x.fillStyle = '#1B1420'; x.fillRect(250, 182, 240, 54); toonText(x, inn, 370, 210, 30, '#FFF4DC', null, null, 220);
      sbTex.needsUpdate = true;
    }
    paintScoreboard(null);
    var bbS = 10, bbD = FA(bbS).dist + WT + 1 + ROWS * RD + 10, bbP = sp(bbS, bbD), bbZ = bleachZ0(bbS) + ROWS * RH + 4;
    if (water === 'right') { bbS = -32; bbD = FA(bbS).dist + WT + 1 + ROWS * RD + 10; bbP = sp(bbS, bbD); bbZ = bleachZ0(bbS) + ROWS * RH + 4; }
    var bbW = 60, bbH = 19;
    propsP.cyl(bbP[0] - 22, bbP[1], 0, 1.4, bbZ, '#4A3E4A', 6); propsP.cyl(bbP[0] + 22, bbP[1], 0, 1.4, bbZ, '#4A3E4A', 6);
    var bfwd = [-bbP[0], -bbP[1]], bl = Math.hypot(bfwd[0], bfwd[1]); bfwd = [bfwd[0] / bl, bfwd[1] / bl];
    var bbFace = Math.atan2(-bbP[0], -bbP[1]);
    propsP.box(bbP[0], bbP[1], bbZ - 1, bbW + 4, 3, bbH + 4, -bbFace, '#2F2A38');
    var bTxt = (f.billboard || 'PLAY BALL').split('·').map(function (t2) { return t2.trim(); });
    var adCol = ['#F2B632', '#D9483B', '#7FD1D9', '#FFF4DC', '#F29E8E'][seed % 5], adInk = adCol === '#D9483B' ? '#FFF4DC' : '#1B1420';
    var bbTex = TN.canvasTex(512, 160, function (x, w, h) {
      x.fillStyle = adCol; x.fillRect(0, 0, w, h);
      x.fillStyle = 'rgba(255,255,255,0.25)';
      for (var r3 = 0; r3 < 14; r3++) { x.beginPath(); x.moveTo(w * 0.85, h * 0.5); x.arc(w * 0.85, h * 0.5, w, r3 / 14 * PI * 2, (r3 + 0.5) / 14 * PI * 2); x.fill(); }
      x.lineWidth = 8; x.strokeStyle = '#1B1420'; x.strokeRect(6, 6, w - 12, h - 12);
      toonText(x, bTxt[0], w / 2, bTxt.length > 1 ? h * 0.38 : h * 0.52, bTxt.length > 1 ? 64 : 80, adInk === '#1B1420' ? '#FFF4DC' : '#FFF4DC', '#1B1420', '#1B1420', w - 50);
      if (bTxt[1]) { x.font = '600 30px ' + BB.FONTS.body; x.fillStyle = adInk; x.textAlign = 'center'; x.fillText(bTxt[1], w / 2, h * 0.78); }
    });
    var bbMesh = new T.Mesh(new T.PlaneGeometry(bbW, bbH), new T.MeshBasicMaterial({ map: bbTex }));
    bbMesh.position.set(bbP[0] + bfwd[0] * 1.8, bbP[1] + bfwd[1] * 1.8, bbZ + 1 + bbH / 2);
    bbMesh.up.set(0, 0, 1); bbMesh.lookAt(bbMesh.position.x + bfwd[0], bbMesh.position.y + bfwd[1], bbMesh.position.z);
    group.add(bbMesh);
    // distance markers on the wall
    [-45, 0, 45].forEach(function (s10) {
      var fs2 = FA(s10), d = Math.round(fs2.dist);
      var tx2 = TN.canvasTex(128, 64, function (x, w, h) { toonText(x, String(d), w / 2, h / 2 + 3, 46, '#FFF4DC', null, null); });
      var mm = new T.Mesh(new T.PlaneGeometry(9, 4.5), new T.MeshBasicMaterial({ map: tx2, transparent: true, depthWrite: false }));
      var s11 = s10 === -45 ? -41 : s10 === 45 ? 41 : 0, f3 = FA(s11), p3 = sp(s11, f3.dist - 0.15, Math.min(f3.height - 3, 5));
      mm.position.set(p3[0], p3[1], p3[2]); mm.up.set(0, 0, 1); mm.lookAt(0, 0, p3[2]);
      group.add(mm);
    });

    // ---------------- merge the static paint into meshes
    var paintMat = new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide });
    [S3, propsP, BD].forEach(function (P) { if (P.count()) group.add(new T.Mesh(P.build(), paintMat)); });
    makeCrowd(crowd, pal, group);

    // ---------------- sky, sun / moon, stars, clouds
    var sky = new T.Mesh(new T.SphereGeometry(5000, 24, 32), new T.MeshBasicMaterial({ map: skyTex(pal), side: T.BackSide, depthWrite: false, fog: false }));
    sky.rotation.x = PI / 2; sky.renderOrder = 50; sky.frustumCulled = false; // drawn after the opaque set: only visible sky pixels are shaded
    var skyG = new T.Group(); skyG.add(sky); group.add(skyG);
    if (pal.night) {
      var stars = new TN.Paint(L), rs = rnd(seed + 3);
      for (i = 0; i < 160; i++) {
        var az = (rs() * 300 - 150) * D2R, el = (8 + rs() * 70) * D2R, rr2 = 4600, sz2 = 6 + rs() * 10;
        var cx = Math.sin(az) * Math.cos(el) * rr2, cy = Math.cos(az) * Math.cos(el) * rr2, cz = Math.sin(el) * rr2;
        var ux2 = Math.cos(az), uy2 = -Math.sin(az);
        stars.tri([cx - ux2 * sz2, cy - uy2 * sz2, cz], [cx + ux2 * sz2, cy + uy2 * sz2, cz], [cx, cy, cz + sz2 * 1.6], '#FFF4DC');
        stars.tri([cx - ux2 * sz2, cy - uy2 * sz2, cz + sz2 * 0.9], [cx + ux2 * sz2, cy + uy2 * sz2, cz + sz2 * 0.9], [cx, cy, cz - sz2 * 0.7], '#FFF4DC');
      }
      var stM = new T.Mesh(stars.build(), new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide, depthWrite: false }));
      stM.renderOrder = 51; stM.frustumCulled = false; skyG.add(stM);
      // the big moon
      var mt = TN.canvasTex(256, 256, function (x, w) {
        x.fillStyle = 'rgba(255,240,200,0.18)'; x.beginPath(); x.arc(w / 2, w / 2, w * 0.5, 0, PI * 2); x.fill();
        x.fillStyle = 'rgba(255,240,200,0.22)'; x.beginPath(); x.arc(w / 2, w / 2, w * 0.42, 0, PI * 2); x.fill();
        x.fillStyle = '#FFF1C8'; x.beginPath(); x.arc(w / 2, w / 2, w * 0.34, 0, PI * 2); x.fill();
        x.fillStyle = '#F2DDA8'; [[0.42, 0.44, 0.06], [0.58, 0.58, 0.08], [0.5, 0.36, 0.04], [0.6, 0.42, 0.035], [0.4, 0.6, 0.045]].forEach(function (c4) { x.beginPath(); x.arc(c4[0] * w, c4[1] * w, c4[2] * w, 0, PI * 2); x.fill(); });
      });
      moon = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: mt, transparent: true, depthWrite: false }));
      var mp = sp(-18, 4200 * Math.cos(15 * D2R), 4200 * Math.sin(15 * D2R)); moon.position.set(mp[0], mp[1], mp[2]); moon.scale.set(1200, 1200, 1);
      moon.renderOrder = -98; moon.frustumCulled = false; skyG.add(moon);
    } else {
      var st2 = TN.canvasTex(256, 256, function (x, w) {
        x.fillStyle = 'rgba(255,250,220,0.25)'; x.beginPath(); x.arc(w / 2, w / 2, w * 0.5, 0, PI * 2); x.fill();
        x.fillStyle = 'rgba(255,250,220,0.35)'; x.beginPath(); x.arc(w / 2, w / 2, w * 0.36, 0, PI * 2); x.fill();
        x.fillStyle = '#FFF6D2'; x.beginPath(); x.arc(w / 2, w / 2, w * 0.24, 0, PI * 2); x.fill();
      });
      sunDisc = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: st2, transparent: true, depthWrite: false }));
      var hl = Math.hypot(pal.sun[0], pal.sun[1]) || 1, el2 = 0.2, sd2 = 4300;
      sunDisc.position.set(pal.sun[0] / hl * sd2 * Math.cos(el2), pal.sun[1] / hl * sd2 * Math.cos(el2), Math.sin(el2) * sd2);
      sunDisc.scale.set(900, 900, 1); sunDisc.renderOrder = -98; sunDisc.frustumCulled = false; skyG.add(sunDisc);
    }
    var clouds = [], rcl = rnd(seed + 17);
    var ncl = pal.night ? 4 : 8;
    for (i = 0; i < ncl; i++) {
      var tex = cloudTex(pal.cloud, pal.cloudSh, i % 4);
      var cm = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
      var caz = (-75 + rcl() * 150), cel = 6 + rcl() * 20, cw2 = 900 + rcl() * 900;
      cm.scale.set(cw2, cw2 * 0.5, 1); cm.renderOrder = -97;
      cm.userData = { az: caz, el: cel, d: 4000, sp: 0.15 + rcl() * 0.25 };
      clouds.push(cm); skyG.add(cm);
    }

    // ---------------- birds (gulls over the harbour, pigeons over the city)
    var birds = [];
    if (kind === 'harbor' || kind === 'city' || kind === 'pines') {
      var bg = new TN.Paint(L);
      bg.tri([-5, 0, 0], [0, 0.5, -1.4], [0, -0.4, 0.4], '#FFFFFF'); bg.tri([5, 0, 0], [0, 0.5, -1.4], [0, -0.4, 0.4], '#FFFFFF');
      bg.tri([-5, 0, 0], [0, -0.4, 0.4], [0, 0.4, 1.4], '#FFFFFF'); bg.tri([5, 0, 0], [0, -0.4, 0.4], [0, 0.4, 1.4], '#FFFFFF');
      var bgeom = bg.build();
      var bcol = kind === 'harbor' ? '#FBF8F2' : kind === 'city' ? '#5A5470' : '#2C2C36';
      var bmat = new T.MeshBasicMaterial({ color: bcol, side: T.DoubleSide });
      var rb2 = rnd(seed + 23);
      for (i = 0; i < 7; i++) {
        var bm = new T.Mesh(bgeom, bmat); bm.userData = { s: -40 + rb2() * 80, d: 300 + rb2() * 300, z: 70 + rb2() * 90, ph: rb2() * 10, sp: 0.03 + rb2() * 0.04 };
        bm.scale.setScalar(1.6); birds.push(bm); group.add(bm);
      }
    }

    // ---------------- lamps (glow sprites) for lit parks
    var glowTex = TN.canvasTex(128, 128, function (x, w) {
      var g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      g.addColorStop(0, 'rgba(255,248,220,1)'); g.addColorStop(0.25, 'rgba(255,240,190,0.8)'); g.addColorStop(1, 'rgba(255,230,170,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, w);
    });
    var lampBank = new TN.Paint(L);
    towers.forEach(function (t) {
      var fx2 = Math.sin(t.face), fy2 = Math.cos(t.face), tx3 = -fy2, ty3 = fx2;
      for (var r4 = 0; r4 < 3; r4++) for (var c5 = 0; c5 < 5; c5++) {
        var ox = (c5 - 2) * 6, oz = (r4 - 1) * 6, cx2 = t.x + tx3 * ox + fx2 * 1.8, cy2 = t.y + ty3 * ox + fy2 * 1.8, cz2 = t.z + oz;
        lampBank.quad([cx2 - tx3 * 2.2, cy2 - ty3 * 2.2, cz2 - 2.2], [cx2 + tx3 * 2.2, cy2 + ty3 * 2.2, cz2 - 2.2], [cx2 + tx3 * 2.2, cy2 + ty3 * 2.2, cz2 + 2.2], [cx2 - tx3 * 2.2, cy2 - ty3 * 2.2, cz2 + 2.2], '#FFF6D8');
      }
      if (pal.night || kind === 'city' || kind === 'cathedral') lightLamps.push({ x: t.x + fx2 * 3, y: t.y + fy2 * 3, z: t.z, r: 70 });
    });
    if (lampBank.count()) group.add(new T.Mesh(lampBank.build(), paintMat));
    lightLamps.forEach(function (l) {
      var spr = new T.Sprite(new T.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: l.beam ? 0.9 : 0.75 }));
      spr.position.set(l.x, l.y, l.z); spr.scale.set(l.r, l.r, 1); spr.renderOrder = 5;
      group.add(spr);
      if (l.beam) anim.push(function (time) { spr.material.opacity = 0.55 + 0.4 * Math.abs(Math.sin(time * 0.8)); });
    });

    var lastSB = '';
    function update(cam, time, excite, hud) {
      skyG.position.copy(cam.position);
      clouds.forEach(function (c6) {
        var u = c6.userData, az3 = (u.az + time * u.sp) * D2R, el3 = u.el * D2R;
        c6.position.set(Math.sin(az3) * Math.cos(el3) * u.d, Math.cos(az3) * Math.cos(el3) * u.d, Math.sin(el3) * u.d);
      });
      if (moon) moon.lookAt(cam.position);
      if (sunDisc) sunDisc.lookAt(cam.position);
      birds.forEach(function (b) {
        var u = b.userData, s12 = u.s + Math.sin(time * u.sp * 10 + u.ph) * 30, p = sp(s12, u.d + Math.cos(time * 0.3 + u.ph) * 40, u.z + Math.sin(time * 1.3 + u.ph) * 6);
        b.position.set(p[0], p[1], p[2]); b.rotation.z = -s12 * D2R + Math.cos(time * u.sp * 10 + u.ph) * 0.8;
        b.scale.set(1.6, 1.6, 1.6 * (0.4 + 0.6 * Math.abs(Math.sin(time * 6 + u.ph))));
      });
      CROWD_U.uTime.value = time; CROWD_U.uJump.value = excite || 0;
      anim.forEach(function (fn) { fn(time); });
      var key = hud ? hud.score + '|' + hud.inning : '';
      if (key !== lastSB) { lastSB = key; paintScoreboard(hud); }
    }

    return {
      id: park.id, park: park, pal: pal, group: group, update: update, fenceAt: FA, mound: mound,
      lights: { key: pal.key, keyI: pal.keyI, amb: pal.amb, ambI: pal.ambI, sun: pal.sun },
      scoreboard: sbMesh, crowdCount: crowd.length,
    };
  }

  return { build: build, palFor: palFor, fenceAt: fenceAt, mound: mound, toonText: toonText, rr: rr, CROWD_U: CROWD_U };
})();
