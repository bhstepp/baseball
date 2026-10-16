// 30-assets.js — BB.Assets: the game's binary assets (character models) by name. Owned by the integration agent.
// Where an asset comes from is decided by tools/build.js (docs/CAST-PLAN.md, "Asset pipeline"):
//   inline  window.BB_ASSETS = { name: '<base64 glb>' }: boot assets (Rocco), part of the page itself
//   file    window.BB_ASSET_FILES = { name: { url: 'assets/<name>.glb?v=<hash>', bytes } }: fetched when a game needs
//           it; the service worker pre-caches them in the background after the first launch so play works offline
// get(name) -> Promise<ArrayBuffer>. load(name) -> Promise<glTF>: parsed once (GLTFLoader + MeshoptDecoder for files
// packed by tools/pack-assets.js) and shared; every load() is matched by a release(name), and the last release frees
// the geometry. Nothing here is required: a missing or broken asset rejects, and callers fall back.
BB.Assets = (function () {
  var provided = {}, fetching = {}, parsed = {};
  var now = function () { return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(); };
  function inline64(name) { var a = typeof window !== 'undefined' && window.BB_ASSETS; return (a && a[name]) || null; }
  function fileOf(name) { var f = typeof window !== 'undefined' && window.BB_ASSET_FILES; return (f && f[name]) || null; }
  function where(name) { return provided[name] ? 'provided' : inline64(name) ? 'inline' : fileOf(name) ? 'file' : null; }
  function has(name) { return !!where(name); }
  function decode(b64) {
    var s = atob(b64), n = s.length, u = new Uint8Array(n);
    for (var i = 0; i < n; i++) u[i] = s.charCodeAt(i);
    return u.buffer;
  }
  // the raw bytes (a fresh ArrayBuffer for inline assets; files are fetched once at a time)
  function get(name) {
    if (provided[name]) return Promise.resolve(provided[name].slice(0));
    var b = inline64(name);
    if (b) { try { return Promise.resolve(decode(b)); } catch (e) { return Promise.reject(e); } }
    var f = fileOf(name);
    if (!f) return Promise.reject(new Error('BB.Assets: no asset "' + name + '"'));
    if (!fetching[name]) {
      fetching[name] = fetch(f.url).then(function (r) {
        if (!r.ok) throw new Error('BB.Assets: ' + f.url + ' -> ' + r.status);
        return r.arrayBuffer();
      }).then(function (ab) { delete fetching[name]; return ab; }, function (e) { delete fetching[name]; throw e; });
    }
    return fetching[name];
  }
  // warm the HTTP / service-worker cache without parsing (e.g. the next park's cast while a game is on)
  function prefetch(names) { (names || []).forEach(function (n) { if (where(n) === 'file') get(n).catch(function () {}); }); }

  var decoderOk = null;
  function decoderReady() {
    var D = typeof THREE !== 'undefined' && THREE.MeshoptDecoder;
    if (!D) return Promise.resolve(null);
    if (decoderOk === null) decoderOk = Promise.resolve(D.ready).then(function () { return D; }, function () { return null; });
    return decoderOk;
  }
  function parse(buf) {
    if (typeof THREE === 'undefined' || !THREE.GLTFLoader) return Promise.reject(new Error('BB.Assets: GLTFLoader missing'));
    return decoderReady().then(function (D) {
      return new Promise(function (res, rej) {
        var L = new THREE.GLTFLoader();
        if (D) L.setMeshoptDecoder(D);
        L.parse(buf, '', res, rej);
      });
    });
  }
  // parsed glTF, shared and reference counted
  function load(name) {
    var e = parsed[name];
    if (!e) {
      e = parsed[name] = { refs: 0, t0: now(), gltf: null };
      e.promise = get(name).then(parse).then(function (g) { e.gltf = g; e.ms = now() - e.t0; g.userData = g.userData || {}; g.userData.asset = name; return g; },
        function (err) { if (parsed[name] === e) delete parsed[name]; throw err; });
    }
    e.refs++;
    return e.promise;
  }
  function release(name) {
    var e = parsed[name];
    if (!e) return;
    if (--e.refs > 0) return;
    delete parsed[name];
    e.promise.then(dispose, function () {});
  }
  function dispose(g) {
    if (!g || !g.scene) return;
    g.scene.traverse(function (o) {
      if (o.geometry && o.geometry.dispose) o.geometry.dispose();
      [].concat(o.material || []).forEach(function (m) {
        if (!m || !m.dispose) return;
        for (var k in m) if (m[k] && m[k].isTexture) m[k].dispose();
        m.dispose();
      });
      if (o.skeleton && o.skeleton.dispose) o.skeleton.dispose();
    });
  }
  function provide(name, buf) { if (buf) provided[name] = buf; else delete provided[name]; }
  // sidecar metadata of an asset (assets/<name>.json, inlined by tools/build.js), e.g. a clip library's markers
  function meta(name) { var m = typeof window !== 'undefined' && window.BB_ASSET_META; return (m && m[name]) || null; }
  function stats() {
    var p = {}; for (var n in parsed) p[n] = { refs: parsed[n].refs, ms: parsed[n].ms != null ? Math.round(parsed[n].ms) : null };
    var inl = (typeof window !== 'undefined' && window.BB_ASSETS) || {}, fil = (typeof window !== 'undefined' && window.BB_ASSET_FILES) || {};
    return { inline: Object.keys(inl), files: Object.keys(fil), parsed: p };
  }
  return { has: has, where: where, get: get, prefetch: prefetch, load: load, release: release, parse: parse, provide: provide, meta: meta, stats: stats };
})();
