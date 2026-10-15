// 50-save.js — persistent progress. Owned by the meta agent.
// One JSON blob in localStorage under 'halftone.v1'. If storage is unavailable or throws (Safari private mode,
// storage disabled, quota), everything keeps working from an in-memory copy for the session.
// Schema is versioned: bump VERSION and add a MIGRATIONS[oldVersion] step that upgrades the blob in place.
(function () {
  var KEY = 'halftone.v1';
  var VERSION = 1;

  function defaults() {
    return {
      v: VERSION,
      created: Date.now(),
      seenHowTo: false,
      settings: { sound: true, music: true, haptics: true, assist: true, latencyMs: 30 },
      coins: 150,                    // enough for one pack on day one
      xp: 0,
      bat: 'b_hickory',
      inkset: 'park',
      bought: {},                    // item id -> true (things bought with coins)
      seenUnlocks: {},               // item id -> true (so "NEW" badges show once)
      cards: {},                     // card id -> copies owned
      misprints: {},                 // card id -> misprint copies owned
      packs: { opened: 0, sinceRare: 0, seed: 0 },
      ach: {},                       // achievement id -> timestamp earned
      stats: {
        games: 0, wins: 0, pitches: 0, swings: 0, contact: 0, whiffs: 0, takes: 0,
        hits: 0, singles: 0, doubles: 0, triples: 0, hr: 0, k: 0, bb: 0, runs: 0, outs: 0, fouls: 0,
        longest: 0, maxEV: 0, perfects: 0, hrDist: 0, bestStreak: 0, onFire: 0,
        coinsEarned: 0, stars: 0, tourGames: 0, dailyGames: 0, derbyGames: 0, playDays: 0, lastPlayDay: '',
      },
      tour: { stars: {}, won: {} },  // game id -> best stars / true
      daily: { results: {}, streak: 0, bestStreak: 0, lastDay: '', best: 0, lastBonusDay: '' },
      derby: { best: 0, bestDist: 0, games: 0 },
      lastFirstWinDay: '',
    };
  }

  // MIGRATIONS[n] upgrades a blob from version n to n + 1 (mutate and return it).
  var MIGRATIONS = {
    // 1: function (d) { d.newThing = 0; return d; },
  };

  // ---- storage backend
  var mem = null, persistent = false, backend = null;
  function probe() {
    try {
      var ls = (typeof window !== 'undefined' && window.localStorage) || (typeof localStorage !== 'undefined' ? localStorage : null);
      if (!ls) return null;
      var t = '__halftone_probe__';
      ls.setItem(t, '1'); ls.removeItem(t);
      return ls;
    } catch (e) { return null; }
  }
  function readRaw() {
    if (backend) { try { return backend.getItem(KEY); } catch (e) { persistent = false; backend = null; } }
    return mem;
  }
  function writeRaw(s) {
    mem = s;
    if (backend) { try { backend.setItem(KEY, s); return true; } catch (e) { persistent = false; backend = null; } }
    return false;
  }

  // fill missing keys from defaults (recursively for plain objects), so new fields appear for old saves
  function fill(dst, def) {
    for (var k in def) {
      if (!Object.prototype.hasOwnProperty.call(def, k)) continue;
      var dv = def[k];
      if (dst[k] === undefined || dst[k] === null && dv !== null) dst[k] = dv;
      else if (dv && typeof dv === 'object' && !Array.isArray(dv) && dst[k] && typeof dst[k] === 'object') fill(dst[k], dv);
    }
    return dst;
  }

  function migrate(d) {
    var v = +d.v || 1;
    while (v < VERSION) {
      if (MIGRATIONS[v]) d = MIGRATIONS[v](d) || d;
      v++;
      d.v = v;
    }
    return fill(d, defaults());
  }

  var data = null;
  function load() {
    var raw = readRaw(), d = null;
    if (raw) { try { d = JSON.parse(raw); } catch (e) { d = null; } }
    if (!d || typeof d !== 'object') d = defaults();
    data = migrate(d);
    return data;
  }

  function init(storage) {
    backend = storage === undefined ? probe() : storage;
    persistent = !!backend;
    mem = null;
    load();
  }

  var timer = 0;
  BB.Save = {
    KEY: KEY,
    VERSION: VERSION,
    MIGRATIONS: MIGRATIONS,
    defaults: defaults,
    get: function () { if (!data) load(); return data; },
    set: function (patch) {
      var d = BB.Save.get();
      for (var k in patch) d[k] = patch[k];
      BB.Save.commit();
      return d;
    },
    commit: function () {
      if (!data) return false;
      if (timer) { clearTimeout(timer); timer = 0; }
      try { return writeRaw(JSON.stringify(data)); } catch (e) { return false; }
    },
    // debounced commit for chatty callers (per-pitch stats)
    soon: function () {
      if (timer) return;
      timer = setTimeout(function () { timer = 0; BB.Save.commit(); }, 400);
    },
    reset: function () { data = defaults(); BB.Save.commit(); return data; },
    persistent: function () { return persistent; },
    exportText: function () { return JSON.stringify(BB.Save.get()); },
    importText: function (s) { var d = JSON.parse(s); data = migrate(d); BB.Save.commit(); return data; },
    // tests: re-initialise against a given storage object (null = memory only)
    _init: init,
  };

  init();
})();
