// 00-const.js — shared constants, ink palettes and small utilities. Owned by the lead.
// Everything in the game hangs off one global namespace, BB. Modules are plain scripts concatenated in order
// by tools/build.js (see docs/CONTRACT.md), so a module may use anything defined by a module before it,
// and anything at all once the page has loaded.
var BB = (typeof window !== 'undefined' ? (window.BB = window.BB || {}) : (globalThis.BB = globalThis.BB || {}));

BB.VERSION = '1.0.0';
BB.TITLE = 'Screwball Slugger';

BB.K = {
  // ---- world, in feet. Origin = centre of home plate (the strike-zone plane is y = 0).
  //      +y toward the pitcher / centre field, +x toward the first-base side (catcher's right), +z up.
  ZONE: { xMax: 0.83, zMin: 1.55, zMax: 3.45 },  // rule-book zone; a pitch is a strike if the ball touches it
  BALL_R: 0.121,
  RUBBER_Y: 60.5,
  RELEASE_Y: 54.5,
  BATTER_X: -2.6,          // the hero is a right-handed hitter, standing on the third-base side of the plate
  BASES: [ { x: 0, y: 0 }, { x: 63.64, y: 63.64 }, { x: 0, y: 127.28 }, { x: -63.64, y: 63.64 } ], // home, 1B, 2B, 3B
  FOUL_DEG: 45,            // spray angle of the foul lines; spray is 0 at dead centre, negative toward left field

  // ---- timing (game seconds)
  WINDUP: 1.15,            // from "pitcher starts windup" to release (t = 0)
  SWING_LAG: 0.07,         // pointer event -> bat reaches the hitting zone. timingErr = (swingStart + SWING_LAG) - pitch.T
  INPUT_LATENCY: 0.03,     // default touch-latency compensation subtracted from swingStart (adjustable in settings)
  POST_PITCH: 0.55,        // after the ball reaches the mitt, before the next pitch can be thrown
  FIELD_MIN: 1.6,          // shortest field-view animation
  MAX_DPR: 2,
};

// ---- Risograph inks. Real Riso drum colours, so the palette reads as "printed", not "screen".
BB.INKS = {
  paper:  '#F4EEE1', // uncoated cream stock
  pink:   '#FF48B0', // Fluorescent Pink
  blue:   '#0078BF', // Blue
  yellow: '#FFE800', // Yellow
  teal:   '#00838A',
  orange: '#FF6C2F', // Fluorescent Orange
  green:  '#00A95C',
  purple: '#765BA7',
  red:    '#F15060', // Bright Red
  federal:'#3D5588', // Federal Blue
  black:  '#1A1A1A',
};

// An ink set = the three drums loaded into the press. Rendering never names a colour directly: it draws with
// slot A (main / dark-ish: sky, crowd, uniforms, text), slot B (accent: pitcher, ball seams, big stamps) and
// slot C (highlight: lights, grass tint where it overprints A, sparks). Overprints (A x B, A x C, B x C) are where
// the riso look comes from: layers are composited with 'multiply'.
BB.INKSETS = [ // colour schemes ("Uniforms"): a = primary, b = accent, c = highlight
  { id: 'classic',  name: 'Home Whites',   a: '#2E5AAC', b: '#D9483B', c: '#F2B632', paper: '#FFF4DC' },
  { id: 'dusk',     name: 'Twi-Night',     a: '#2B2F5E', b: '#F28C38', c: '#F2B632', paper: '#FBEBD3' },
  { id: 'lawn',     name: 'Bleacher Lawn', a: '#3E8E3A', b: '#D9483B', c: '#F2B632', paper: '#FFF4DC' },
  { id: 'grape',    name: 'Grape Soda',    a: '#6B4C9A', b: '#F28C38', c: '#F2D74B', paper: '#FBEFE0' },
  { id: 'harbor',   name: 'Harbor Fog',    a: '#1F7A80', b: '#E0604F', c: '#F2C14E', paper: '#F6F0E2' },
  { id: 'ledger',   name: 'Old Timers',    a: '#1B1420', b: '#C0392B', c: '#E8B84A', paper: '#F7EDD8' },
];

BB.FONTS = {
  display: '"Luckiest Guy", "Arial Black", "Helvetica Neue", sans-serif', // bulgy cartoon lettering
  body: '"Fredoka", ui-rounded, "SF Pro Rounded", system-ui, sans-serif', // friendly rounded body text
};

// ---- binary assets inlined by tools/build.js (window.BB_ASSETS = { name: base64 }). Returns an ArrayBuffer or null.
BB.assetBuffer = function (name) {
  var b64 = typeof window !== 'undefined' && window.BB_ASSETS && window.BB_ASSETS[name];
  if (!b64) return null;
  var bin = atob(b64), n = bin.length, bytes = new Uint8Array(n);
  for (var i = 0; i < n; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
};

// ---- utilities
BB.U = (function () {
  function mulberry32(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) { // FNV-1a, 32-bit
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayKey(d) { d = d || new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  var EPOCH = Date.UTC(2026, 9, 15); // Daily Derby #1 = 2026-10-15
  function dayNumber(key) {
    var p = key.split('-');
    return Math.round((Date.UTC(+p[0], +p[1] - 1, +p[2]) - EPOCH) / 86400000) + 1;
  }
  return {
    rng: mulberry32,                         // rng(seed) -> () => [0,1)
    hashStr: hashStr,
    clamp: function (v, a, b) { return v < a ? a : v > b ? b : v; },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    invLerp: function (a, b, v) { return (v - a) / (b - a); },
    smooth: function (t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); },
    easeOut: function (t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return 1 - (1 - t) * (1 - t) * (1 - t); },
    easeIn: function (t) { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * t; },
    pick: function (rng, arr) { return arr[Math.floor(rng() * arr.length) % arr.length]; },
    pickWeighted: function (rng, obj) { // {key: weight} -> key
      var tot = 0, k; for (k in obj) tot += obj[k];
      var r = rng() * tot; for (k in obj) { r -= obj[k]; if (r <= 0) return k; }
      return k;
    },
    gauss: function (rng) { var u = 1 - rng(), v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); },
    dayKey: dayKey,                          // local calendar date 'YYYY-MM-DD'
    dayNumber: dayNumber,                    // 'YYYY-MM-DD' -> Daily Derby number (1 on 2026-10-15)
    deg: function (r) { return r * 180 / Math.PI; },
    rad: function (d) { return d * Math.PI / 180; },
    fmtInt: function (n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); },
  };
})();
