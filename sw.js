/* Screwball Slugger service worker. VERSION is filled in by tools/build.js with a hash of the built page,
   so every release gets a fresh cache. Own files: cache-first. Google Fonts: stale-while-revalidate.
   Character models (assets/*.glb, fetched by BB.Assets when a game needs them) live in their own cache that outlives
   releases: their URLs carry a content hash (?v=...), so an unchanged model is never downloaded twice; the page asks
   for a background pre-cache of the current list after it loads (message 'precache-assets'), so play works offline. */
var VERSION = '39ac39f687';
var APP = 'halftone-app-' + VERSION;
var FONTS = 'halftone-fonts-v1';
var MODELS = 'halftone-assets-v1';
var PRECACHE = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
var ASSETS = ["assets/anim_catcher.glb?v=b57a53f68e","assets/anim_fielder.glb?v=e754fcb6d0","assets/anim_pitcher.glb?v=ba1cb420da","assets/anim_umpire.glb?v=e752d4f7c5","assets/char_c1-04.glb?v=fbaf327daa","assets/char_c1-04_lod1.glb?v=d0773797f0","assets/char_c1-05_lod1.glb?v=3296a07729","assets/char_c1-06_lod1.glb?v=08a2caa48a","assets/char_c1-07_lod1.glb?v=9154f5d66c","assets/char_c1-08_lod1.glb?v=f87c678616","assets/char_c1-09_lod1.glb?v=855b790787","assets/char_c1-10_lod1.glb?v=9b996e1408","assets/char_c1-11_lod1.glb?v=4688b2a92f","assets/char_mate_beaver_lod1.glb?v=4bdbe9bf94","assets/char_mate_fox_lod1.glb?v=dbba7d4f3f","assets/char_mate_otter_lod1.glb?v=dedc56bb4c","assets/char_p_clem.glb?v=c4101b6cc1","assets/char_p_clem_lod1.glb?v=ec1d8668ce","assets/char_p_dottie.glb?v=3cda7c0bec","assets/char_p_dottie_lod1.glb?v=907190c706","assets/char_p_hank.glb?v=622f34d5f4","assets/char_p_hank_lod1.glb?v=f4ea33870f","assets/char_p_ox.glb?v=1c76f77545","assets/char_p_ox_lod1.glb?v=b968ea68d6","assets/char_ump.glb?v=f5cc1b8069","assets/char_ump_lod1.glb?v=40e2483137","assets/rocco_lod1.glb?v=b0286becff"];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(APP).then(function (c) { return c.addAll(PRECACHE); }).then(function () { return self.skipWaiting(); }));
});
// models no longer in this release's list are dropped
function pruneModels() {
  var keep = {}; ASSETS.forEach(function (u) { keep[new URL(u, self.registration.scope).href] = true; });
  return caches.open(MODELS).then(function (c) {
    return c.keys().then(function (reqs) { return Promise.all(reqs.filter(function (r) { return !keep[r.url]; }).map(function (r) { return c.delete(r); })); });
  });
}
// fetch the models this release lists that aren't cached yet, one at a time (a background job)
function precacheModels() {
  return caches.open(MODELS).then(function (c) {
    return ASSETS.reduce(function (p, u) {
      return p.then(function () {
        return c.match(u).then(function (hit) {
          if (hit) return;
          return fetch(u).then(function (res) { if (res && res.ok) return c.put(u, res); }).catch(function () {});
        });
      });
    }, Promise.resolve());
  });
}
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('halftone-app-') === 0 && k !== APP; })
      .map(function (k) { return caches.delete(k); }));
  }).then(pruneModels).then(function () { return self.clients.claim(); }));
});
self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'precache-assets') e.waitUntil(precacheModels());
});
function isFont(url) { return url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'; }
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (isFont(url)) {
    e.respondWith(caches.open(FONTS).then(function (cache) {
      return cache.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) {
          if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
          return res;
        }).catch(function () { return hit; });
        return hit || net;
      });
    }));
    return;
  }
  if (url.origin !== location.origin) return;
  if (/\/assets\/[^/]+\.glb$/.test(url.pathname)) {   // models: exact URL (the ?v= hash is the version)
    e.respondWith(caches.open(MODELS).then(function (cache) {
      return cache.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) { if (res && res.ok) cache.put(req, res.clone()); return res; });
      });
    }));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (hit) {
    return hit || fetch(req).then(function (res) {
      if (res && res.ok) { var copy = res.clone(); caches.open(APP).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () { return caches.match('index.html'); });
  }));
});
