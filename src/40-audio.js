// 40-audio.js — BB.Audio + BB.Haptics. Owned by the audio agent.
// Every sound is synthesized with the Web Audio API at call time: no files. Nothing here may throw: every public
// entry point is wrapped, and with no AudioContext the whole module degrades to silent no-ops.
//
// Graph:  sources -> [sfx bus | crowd bus | organ bus] -> master gain -> compressor -> soft-clip shaper -> out
//         sfx sends -> stadium slap-back echo -> sfx bus;  organ voices -> vibrato/tremolo "leslie" -> organ bus
(function () {
  var W = typeof window !== 'undefined' ? window : globalThis;
  var R = Math.random;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rr(a, b) { return a + (b - a) * R(); }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function safe(fn) { return function () { try { return fn.apply(null, arguments); } catch (e) { return undefined; } }; }
  function later(fn, ms) { try { setTimeout(function () { try { fn(); } catch (e) { /* ignore */ } }, ms); } catch (e) { /* ignore */ } }

  var LEVEL = { master: 0.9, sfx: 1.0, crowd: 0.6, organ: 0.55 };

  // ------------------------------------------------------------------ buffers & waves (per context)
  function makeBuffers(ctx) {
    var sr = ctx.sampleRate, i, j;
    var wn = Math.floor(sr * 2), white = ctx.createBuffer(1, wn, sr), d = white.getChannelData(0);
    for (i = 0; i < wn; i++) d[i] = R() * 2 - 1;
    var pn = Math.floor(sr * 4), pre = 512, tmp = new Float32Array(pn + pre), b0 = 0, b1 = 0, b2 = 0;
    for (i = 0; i < pn + pre; i++) { // Paul Kellet's economy pink filter
      var w = R() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913;
      tmp[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    var pink = ctx.createBuffer(1, pn, sr), p = pink.getChannelData(0);
    for (i = 0; i < pn; i++) p[i] = tmp[i + pre];
    for (i = 0; i < pre; i++) { var x = i / pre; p[pn - pre + i] = p[pn - pre + i] * (1 - x) + tmp[i] * x; } // seamless loop
    // applause: a 3 s stereo loop of ~65 random hand claps per second (wraps around so it loops seamlessly)
    var an = Math.floor(sr * 3), app = ctx.createBuffer(2, an, sr), peak = 0;
    for (var ch = 0; ch < 2; ch++) {
      var a = app.getChannelData(ch);
      for (var k = 0; k < 200; k++) {
        var st = Math.floor(R() * an), len = Math.floor(sr * rr(0.008, 0.025)), amp = rr(0.15, 1), tau = len * 0.25;
        for (j = 0; j < len; j++) a[(st + j) % an] += (R() * 2 - 1) * amp * Math.exp(-j / tau);
      }
      for (j = 0; j < an; j++) peak = Math.max(peak, Math.abs(a[j]));
    }
    for (ch = 0; ch < 2; ch++) { a = app.getChannelData(ch); for (j = 0; j < an; j++) a[j] *= 0.9 / (peak || 1); }
    return { white: white, pink: pink, app: app };
  }
  // Hammond-ish tone wheel: one PeriodicWave on a fundamental of f/2, so harmonic n of the wave = drawbar ratio n/2:
  // n=1 sub 16', 2 = 8' (the note), 3 = 5 1/3', 4 = 4', 6 = 2 2/3', 8 = 2', 12 = 1 1/3', 16 = 1'.
  function organWave(ctx) {
    try {
      var N = 17, re = new Float32Array(N), im = new Float32Array(N);
      var bars = { 1: 0.35, 2: 1, 3: 0.4, 4: 0.7, 6: 0.38, 8: 0.45, 12: 0.18, 16: 0.22 };
      for (var n in bars) im[+n] = bars[n];
      return ctx.createPeriodicWave(re, im);
    } catch (e) { return null; }
  }
  function softCurve() { // linear to 0.6, then a tanh knee that never exceeds ~0.9: the last line of defence vs clipping
    var n = 2048, c = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var x = i / (n - 1) * 2 - 1, ax = Math.abs(x);
      c[i] = (x < 0 ? -1 : 1) * (ax < 0.6 ? ax : 0.6 + 0.38 * Math.tanh((ax - 0.6) / 0.38));
    }
    return c;
  }

  // ------------------------------------------------------------------ graph
  function organChain(g, dest) { // vibrato (modulated delay) + tremolo (leslie-ish) + warm lowpass
    var c = g.ctx, inp = c.createGain(), dry = c.createGain(), vib = c.createDelay(0.05), wet = c.createGain();
    var trem = c.createGain(), lp = c.createBiquadFilter(), l1 = c.createOscillator(), d1 = c.createGain();
    var l2 = c.createOscillator(), d2 = c.createGain();
    dry.gain.value = 0.7; wet.gain.value = 0.55; vib.delayTime.value = 0.0045; trem.gain.value = 0.85;
    lp.type = 'lowpass'; lp.frequency.value = 5200; lp.Q.value = 0.4;
    l1.frequency.value = 6.4; d1.gain.value = 0.0011; l1.connect(d1); d1.connect(vib.delayTime);
    l2.frequency.value = 6.9; d2.gain.value = 0.12; l2.connect(d2); d2.connect(trem.gain);
    inp.connect(dry); inp.connect(vib); vib.connect(wet); dry.connect(trem); wet.connect(trem); trem.connect(lp); lp.connect(dest);
    l1.start(); l2.start();
    return inp;
  }
  function buildGraph(ctx, offline) {
    var g = { ctx: ctx, offline: !!offline };
    g.buf = makeBuffers(ctx);
    g.wave = organWave(ctx);
    g.master = ctx.createGain();
    g.master.gain.value = offline ? LEVEL.master : (S.muted ? 0 : LEVEL.master);
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.knee.value = 10; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.2;
    var shaper = ctx.createWaveShaper(); shaper.curve = softCurve();
    g.master.connect(comp); comp.connect(shaper); shaper.connect(ctx.destination);
    function bus(v) { var b = ctx.createGain(); b.gain.value = v; b.connect(g.master); return b; }
    g.sfx = bus(LEVEL.sfx); g.crowd = bus(LEVEL.crowd); g.organ = bus(offline || S.music ? LEVEL.organ : 0);
    // stadium slap-back: a short dark echo off the grandstand
    g.echoIn = ctx.createGain();
    var dl = ctx.createDelay(1), lp = ctx.createBiquadFilter(), fb = ctx.createGain(), eo = ctx.createGain();
    dl.delayTime.value = 0.17; lp.type = 'lowpass'; lp.frequency.value = 2200; fb.gain.value = 0.3; eo.gain.value = 0.55;
    g.echoIn.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(eo); eo.connect(g.sfx);
    g.organIn = organChain(g, g.organ);     // music cues (obey setMusic)
    g.organSfx = organChain(g, g.sfx);      // unlock / levelUp flourishes are sound effects
    return g;
  }

  // ------------------------------------------------------------------ primitives
  function env(p, t, a, v, d, hold) {
    v = Math.max(v, 0.0002); hold = hold || 0;
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(v, t + a);
    if (hold) p.setValueAtTime(v, t + a + hold);
    p.exponentialRampToValueAtTime(0.0001, t + a + hold + d);
    return t + a + hold + d;
  }
  function route(g, node, o, dest) {
    var c = g.ctx;
    if (o.pan && c.createStereoPanner) { var pn = c.createStereoPanner(); pn.pan.value = clamp(o.pan, -1, 1); node.connect(pn); pn.connect(dest); }
    else node.connect(dest);
    if (o.send) { var s = c.createGain(); s.gain.value = o.send; node.connect(s); s.connect(g.echoIn); }
  }
  // tone: {t, f, f2, glide, gd (glide delay), type|wave, a, hold, d, v, det, pan, send}
  function tone(g, dest, o) {
    var c = g.ctx, t = o.t, osc = c.createOscillator(), gn = c.createGain();
    if (o.wave) osc.setPeriodicWave(o.wave); else osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) { if (o.gd) osc.frequency.setValueAtTime(o.f, t + o.gd); osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.gd || 0) + (o.glide || 0.05)); }
    if (o.det) osc.detune.value = o.det;
    var end = env(gn.gain, t, o.a || 0.002, o.v, o.d || 0.1, o.hold);
    osc.connect(gn); route(g, gn, o, dest);
    osc.start(t); osc.stop(end + 0.03);
    return osc;
  }
  // noise: {t, buf, filt, f, f2, glide, pts:[[dt,f]..], q, a, hold, d, v, pan, send}
  function noise(g, dest, o) {
    var c = g.ctx, t = o.t, src = c.createBufferSource(), bf = c.createBiquadFilter(), gn = c.createGain();
    var buf = g.buf[o.buf || 'white'];
    src.buffer = buf; src.loop = true;
    bf.type = o.filt || 'bandpass'; bf.Q.value = o.q == null ? 1 : o.q;
    bf.frequency.setValueAtTime(o.f || 1000, t);
    if (o.f2) bf.frequency.exponentialRampToValueAtTime(o.f2, t + (o.glide || 0.1));
    if (o.pts) for (var i = 0; i < o.pts.length; i++) bf.frequency.exponentialRampToValueAtTime(o.pts[i][1], t + o.pts[i][0]);
    var end = env(gn.gain, t, o.a || 0.001, o.v, o.d || 0.05, o.hold);
    src.connect(bf); bf.connect(gn); route(g, gn, o, dest);
    src.start(t, R() * (buf.duration - 0.5)); src.stop(end + 0.03);
    return bf;
  }
  function formants(g, dest, fs, qs, gs) { // parallel band-passes = a crude vocal tract
    var c = g.ctx, inp = c.createGain(), fl = [];
    for (var i = 0; i < fs.length; i++) {
      var b = c.createBiquadFilter(), gn = c.createGain();
      b.type = 'bandpass'; b.frequency.value = fs[i]; b.Q.value = qs[i]; gn.gain.value = gs[i];
      inp.connect(b); b.connect(gn); gn.connect(dest); fl.push(b);
    }
    return { input: inp, f: fl };
  }
  function clap(g, dest, t, v, pan) {
    var f = rr(900, 2300);
    noise(g, dest, { t: t, f: f, q: rr(1, 2.2), a: 0.0006, d: rr(0.015, 0.04), v: v, pan: pan });
    noise(g, dest, { t: t + 0.005, f: f * 1.3, q: 1.5, a: 0.0005, d: 0.012, v: v * 0.6, pan: pan });
  }
  function claps(g, dest, t, n, v) { for (var i = 0; i < n; i++) clap(g, dest, t + rr(-0.02, 0.035), v * rr(0.5, 1), rr(-0.8, 0.8)); }
  function whistle(g, dest, t, v) { // two-finger "wheeet-whew"
    var f = rr(1900, 2800), pan = rr(-0.7, 0.7);
    tone(g, dest, { t: t, f: f, f2: f * 1.22, glide: 0.12, a: 0.03, hold: 0.12, d: 0.12, v: v, pan: pan });
    tone(g, dest, { t: t + 0.33, f: f * 1.2, f2: f * 0.78, glide: 0.3, a: 0.02, hold: 0.08, d: 0.22, v: v * 0.85, pan: pan });
  }
  function woodblock(g, dest, t, f, v) {
    noise(g, dest, { t: t, f: f, q: 18, a: 0.0005, d: 0.09, v: v * 2.2 });
    tone(g, dest, { t: t, f: f, a: 0.0008, d: 0.07, v: v * 0.5 });
    tone(g, dest, { t: t, f: f * 2.71, a: 0.0005, d: 0.025, v: v * 0.2 });
  }
  function voice(g, dest, t, f0, f1, fs, v, a, hold, d) { // a short formant-filtered sawtooth "vocal" blip
    var fb = formants(g, dest, fs, [7, 9, 11], [1, 0.55, 0.22]);
    tone(g, fb.input, { t: t, type: 'sawtooth', f: f0, f2: f1, glide: a + hold + d, a: a, hold: hold, d: d, v: v });
  }

  // ------------------------------------------------------------------ the bat
  function crack(g, t, q, sweet, thin) {
    q = clamp(+q || 0, 0, 1);
    var c = g.ctx, vol = 0.5 + 0.5 * q, i;
    var bus = c.createBiquadFilter(); bus.type = 'lowpass'; bus.Q.value = 0.5;
    bus.frequency.value = thin ? 6000 : 1300 + 7000 * q * q;
    var out = bus;
    if (thin) { out = c.createBiquadFilter(); out.type = 'highpass'; out.frequency.value = 650; bus.connect(out); }
    out.connect(g.sfx);
    var snd = c.createGain(); snd.gain.value = sweet ? 0.4 : 0.2; out.connect(snd); snd.connect(g.echoIn);
    // 1. the transient: a few ms of bright noise
    noise(g, bus, { t: t, filt: 'highpass', f: 1500 + 2500 * q, q: 0.7, a: 0.0004, d: 0.01 + 0.01 * q, v: 0.9 * vol });
    noise(g, bus, { t: t, f: 3800, q: 1.2, a: 0.0003, d: 0.006, v: 0.6 * vol });
    // 2. the woody body: inharmonic partials with a fast pitch drop
    var base = (thin ? 780 : 600) + 260 * q + rr(-25, 25), rat = [1, 1.58, 2.31, 3.1], amp = [0.6, 0.38, 0.22, 0.12];
    for (i = 0; i < (thin ? 2 : 4); i++) {
      tone(g, bus, { t: t, type: i ? 'sine' : 'triangle', f: base * rat[i] * 1.35, f2: base * rat[i], glide: 0.014, a: 0.0008,
        v: vol * amp[i] * (thin ? 0.65 : 1), d: (0.11 - 0.02 * i) * (0.5 + 0.7 * q) * (thin ? 0.55 : 1) });
    }
    // 3. sweet spot: deep thock + a brief bright ring off the barrel
    if (sweet) {
      tone(g, bus, { t: t, f: 230, f2: 92, glide: 0.05, a: 0.001, d: 0.16, v: 0.8 });
      noise(g, bus, { t: t, filt: 'lowpass', f: 700, q: 0.8, a: 0.001, d: 0.06, v: 0.6 });
      tone(g, bus, { t: t + 0.002, f: 2730, a: 0.002, d: 0.45, v: 0.07 });
      tone(g, bus, { t: t + 0.002, f: 4090, a: 0.002, d: 0.3, v: 0.045 });
      tone(g, bus, { t: t + 0.002, f: 5470, a: 0.002, d: 0.18, v: 0.02 });
    }
    // 4. jammed / off the end: a dull thud and a little metallic tink
    if (q < 0.45 && !thin) {
      var k = (0.45 - q) / 0.45;
      noise(g, bus, { t: t, filt: 'lowpass', f: 600, q: 0.7, a: 0.001, d: 0.07, v: 0.6 * k });
      tone(g, bus, { t: t, f: 330, f2: 190, glide: 0.04, a: 0.001, d: 0.08, v: 0.45 * k });
      tone(g, g.sfx, { t: t + 0.003, type: 'triangle', f: 2300, a: 0.001, d: 0.035, v: 0.1 * k });
    }
  }

  // ------------------------------------------------------------------ sound effects
  var SFX = {
    crack: function (g, t, o) { crack(g, t, o.quality == null ? 0.8 : o.quality, !!o.sweet, false); },
    foul: function (g, t, o) { crack(g, t, o.quality == null ? 0.4 : Math.min(o.quality, 0.6), false, true); },
    whiff: function (g, t) {
      noise(g, g.sfx, { t: t, f: 300, pts: [[0.11, 1700], [0.26, 450]], q: 1.4, a: 0.07, hold: 0.05, d: 0.15, v: 0.55, pan: -0.15 });
      noise(g, g.sfx, { t: t + 0.02, buf: 'pink', filt: 'lowpass', f: 500, q: 0.7, a: 0.06, d: 0.15, v: 0.35 });
    },
    whoosh: function (g, t, o) {
      var sp = clamp(((o.mph || 88) - 50) / 50, 0, 1);
      noise(g, g.sfx, { t: t, f: 800 + 700 * sp, pts: [[0.16, 2300 + 1400 * sp], [0.3, 800]], q: 2, a: 0.14, d: 0.16, v: 0.25 + 0.2 * sp, pan: 0.25 });
      tone(g, g.sfx, { t: t, f: 1500 + 900 * sp, f2: (1500 + 900 * sp) * 0.72, gd: 0.13, glide: 0.15, a: 0.12, d: 0.17, v: 0.03 + 0.02 * sp });
    },
    mitt: function (g, t, o) {
      var sp = clamp(((o.mph || 88) - 50) / 50, 0, 1);
      noise(g, g.sfx, { t: t, filt: 'highpass', f: 3000, q: 0.7, a: 0.0003, d: 0.005, v: 0.45 });
      noise(g, g.sfx, { t: t, filt: 'lowpass', f: 2600, f2: 350, glide: 0.05, q: 1, a: 0.0008, d: 0.07, v: 0.6 + 0.3 * sp, send: 0.25 });
      tone(g, g.sfx, { t: t, f: 160, f2: 70, glide: 0.06, a: 0.001, d: 0.09, v: 0.55 + 0.2 * sp });
    },
    strike: function (g, t) { // stylized umpire "HUP!"
      noise(g, g.sfx, { t: t, f: 1800, q: 1, a: 0.008, d: 0.03, v: 0.16 });
      var o = g.ctx.createGain(); route(g, o, { send: 0.3 }, g.sfx);
      voice(g, o, t + 0.02, 175, 132, [700, 1220, 2600], 0.95, 0.012, 0.06, 0.09);
    },
    ball: function (g, t) { voice(g, g.sfx, t, 140, 118, [450, 820, 2500], 0.5, 0.02, 0.03, 0.08); },
    out: function (g, t) { woodblock(g, g.sfx, t, 620, 0.5); woodblock(g, g.sfx, t + 0.12, 470, 0.42); },
    wall: function (g, t) {
      tone(g, g.sfx, { t: t, f: 95, f2: 48, glide: 0.12, a: 0.002, d: 0.25, v: 0.8 });
      noise(g, g.sfx, { t: t, filt: 'lowpass', f: 380, q: 0.8, a: 0.001, d: 0.18, v: 0.6, send: 0.3 });
      var p = [410, 627, 1043, 1389, 1820];
      for (var i = 0; i < p.length; i++) tone(g, g.sfx, { t: t + 0.003, type: i % 2 ? 'triangle' : 'sine', f: p[i] * rr(0.98, 1.02), a: 0.001, d: 0.5 - 0.08 * i, v: 0.06, send: 0.2 });
    },
    stamp: function (g, t) { // rubber stamp on paper: thunk + squish + a little rustle
      tone(g, g.sfx, { t: t, f: 150, f2: 58, glide: 0.05, a: 0.001, d: 0.11, v: 0.8 });
      noise(g, g.sfx, { t: t, filt: 'lowpass', f: 900, f2: 250, glide: 0.06, q: 0.8, a: 0.001, d: 0.07, v: 0.55 });
      noise(g, g.sfx, { t: t + 0.004, f: 380, q: 3, a: 0.002, d: 0.05, v: 0.25 });
      for (var i = 0; i < 5; i++) noise(g, g.sfx, { t: t + 0.03 + i * 0.018 + rr(0, 0.01), filt: 'highpass', f: rr(3500, 6000), q: 0.8, a: 0.001, d: rr(0.008, 0.016), v: rr(0.06, 0.14) });
    },
    tap: function (g, t) {
      tone(g, g.sfx, { t: t, f: 1700, f2: 1150, glide: 0.015, a: 0.0005, d: 0.03, v: 0.18 });
      noise(g, g.sfx, { t: t, filt: 'highpass', f: 4000, q: 0.7, a: 0.0003, d: 0.004, v: 0.12 });
    },
    coin: function (g, t) {
      [[988, 0], [1319, 0.075]].forEach(function (n) {
        tone(g, g.sfx, { t: t + n[1], f: n[0], a: 0.001, d: 0.38, v: 0.22 });
        tone(g, g.sfx, { t: t + n[1], f: n[0] * 2, a: 0.001, d: 0.2, v: 0.06 });
        tone(g, g.sfx, { t: t + n[1], f: n[0] * 2.76, a: 0.001, d: 0.08, v: 0.03 });
      });
    },
    packRip: function (g, t) {
      var N = 26;
      noise(g, g.sfx, { t: t, f: 2500, q: 0.8, a: 0.04, hold: 0.25, d: 0.1, v: 0.12 });
      for (var i = 0; i < N; i++) {
        var x = i / N;
        noise(g, g.sfx, { t: t + Math.pow(x, 0.8) * 0.38 + rr(0, 0.01), f: 1600 + x * 2600 + rr(-300, 300), q: 1.5, a: 0.0005, d: rr(0.012, 0.03), v: 0.28 * rr(0.5, 1), pan: rr(-0.3, 0.3) });
      }
      noise(g, g.sfx, { t: t + 0.4, filt: 'lowpass', f: 1500, q: 0.7, a: 0.001, d: 0.04, v: 0.3 });
    },
    cardFlip: function (g, t) {
      noise(g, g.sfx, { t: t, f: 1800, f2: 5200, glide: 0.05, q: 1.4, a: 0.003, d: 0.05, v: 0.35 });
      tone(g, g.sfx, { t: t + 0.035, f: 220, f2: 140, glide: 0.03, a: 0.001, d: 0.04, v: 0.25 });
    },
    rare: function (g, t) { // shimmering maj9 arpeggio with an echo tail
      var m = [72, 76, 79, 83, 86, 88, 91, 95, 98];
      for (var i = 0; i < m.length; i++) {
        var f = mtof(m[i]), tt = t + i * 0.055;
        tone(g, g.sfx, { t: tt, f: f, a: 0.002, d: 0.6, v: 0.11, send: 0.4, pan: (i / m.length - 0.5) });
        tone(g, g.sfx, { t: tt, type: 'triangle', f: f, det: 9, a: 0.002, d: 0.35, v: 0.04 });
        tone(g, g.sfx, { t: tt, f: f * 2, det: -6, a: 0.002, d: 0.25, v: 0.03 });
      }
      noise(g, g.sfx, { t: t, filt: 'highpass', f: 7000, q: 0.7, a: 0.25, d: 0.6, v: 0.06 });
    },
    unlock: function (g, t) { playPiece(g, PIECES._unlock, t, g.organSfx, 1.1); },
    levelUp: function (g, t) { playPiece(g, PIECES._levelUp, t, g.organSfx, 1.1); },
    error: function (g, t) {
      tone(g, g.sfx, { t: t, type: 'square', f: 196, f2: 185, glide: 0.08, a: 0.002, d: 0.09, v: 0.06 });
      tone(g, g.sfx, { t: t + 0.11, type: 'square', f: 165, f2: 150, glide: 0.1, a: 0.002, d: 0.12, v: 0.06 });
    },
    toast: function (g, t) {
      tone(g, g.sfx, { t: t, f: 1320, a: 0.002, d: 0.08, v: 0.1 });
      tone(g, g.sfx, { t: t + 0.06, f: 1760, a: 0.002, d: 0.12, v: 0.09 });
    },
  };

  // ------------------------------------------------------------------ crowd
  function cheer(g, t, size, dest) {
    size = clamp(+size || 0, 0, 1);
    var rise = 0.18 + 0.25 * size, hold = 0.6 + 2.2 * size, dec = 1.4 + 1.2 * size, v = 0.35 + 0.65 * size, i;
    var fb = formants(g, dest, [800, 1150, 2700], [3, 4, 5], [1, 0.55, 0.25]);
    for (i = 0; i < 3; i++) fb.f[i].frequency.setTargetAtTime([900, 1300, 2900][i], t, rise); // "ahh" brightening to "yeahh"
    noise(g, fb.input, { t: t, buf: 'pink', filt: 'lowpass', f: 1500, f2: 3500 + 2000 * size, glide: rise, q: 0.6, a: rise, hold: hold, d: dec, v: v * 1.6 });
    var nv = 4 + Math.round(size * 8);
    for (i = 0; i < nv; i++) {
      var f0 = R() < 0.5 ? rr(150, 260) : rr(260, 420);
      tone(g, fb.input, { t: t + rr(0, 0.15), type: 'sawtooth', f: f0 * 0.85, f2: f0 * 1.12, glide: rise + 0.2, a: rise, hold: hold * rr(0.6, 1), d: dec * rr(0.6, 1), v: v * 0.05 });
    }
    var c = g.ctx, src = c.createBufferSource(), bp = c.createBiquadFilter(), gn = c.createGain();
    src.buffer = g.buf.app; src.loop = true; bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.6;
    var end = env(gn.gain, t + 0.1, 0.3, 0.25 + 0.5 * size, dec + 0.6, hold + 0.4);
    src.connect(bp); bp.connect(gn); gn.connect(dest); src.start(t + 0.1, R() * 2); src.stop(end + 0.05);
    if (size > 0.45) for (i = 0; i < 1 + Math.floor(size * 3); i++) whistle(g, dest, t + rr(0.1, hold), 0.05);
  }
  function groan(g, t, dest) { // descending "awwww"
    var fb = formants(g, dest, [700, 1100, 2500], [4, 5, 6], [1, 0.5, 0.2]), lo = [520, 820, 2300];
    for (var i = 0; i < 3; i++) { fb.f[i].frequency.setValueAtTime(fb.f[i].frequency.value, t + 0.1); fb.f[i].frequency.linearRampToValueAtTime(lo[i], t + 1.3); }
    noise(g, fb.input, { t: t, buf: 'pink', filt: 'lowpass', f: 1200, f2: 700, glide: 1.2, q: 0.6, a: 0.12, hold: 0.3, d: 0.9, v: 0.9 });
    for (i = 0; i < 10; i++) {
      var f0 = rr(130, 300);
      tone(g, fb.input, { t: t + rr(0, 0.1), type: 'sawtooth', f: f0, f2: f0 * 0.72, gd: 0.15, glide: 1.1, a: 0.12, hold: 0.35, d: 0.9, v: 0.06 });
    }
  }
  function bedBuild(g) {
    var c = g.ctx, b = { level: 0, target: 0, applied: -1, nextSwell: 0, nextClap: 0, nextWhistle: 0 };
    b.out = c.createGain(); b.out.gain.value = 0; b.swell = c.createGain(); b.swell.connect(b.out); b.out.connect(g.crowd);
    function layer(f, q, v, buf) {
      var s = c.createBufferSource(), bp = c.createBiquadFilter(), gn = c.createGain();
      s.buffer = g.buf[buf]; s.loop = true; bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q; gn.gain.value = v;
      s.connect(bp); bp.connect(gn); gn.connect(b.swell); s.start(c.currentTime, R() * 1.5);
      return { f: bp, g: gn };
    }
    b.low = layer(380, 0.7, 1.4, 'pink');   // the murmur
    b.mid = layer(1000, 1.8, 1.2, 'pink');  // babble: centre wanders like vowels
    b.hi = layer(2600, 2.5, 0.1, 'white');  // excited hiss, grows with level
    g.bed = b;
    return b;
  }
  function bedTick(g, now) {
    var b = g.bed; if (!b) return;
    var L = b.target;
    if (Math.abs(L - b.applied) > 0.004) {
      b.applied = L;
      b.out.gain.setTargetAtTime(L <= 0.001 ? 0 : 0.06 + 0.5 * Math.pow(L, 1.3), now, 0.45);
      b.hi.g.gain.setTargetAtTime(0.05 + 0.5 * L * L, now, 0.5);
      b.low.f.frequency.setTargetAtTime(330 + 200 * L, now, 0.5);
    }
    if (L <= 0.001) return;
    if (now >= b.nextSwell) { b.swell.gain.setTargetAtTime(rr(0.7, 1.3), now, rr(0.4, 1.2)); b.nextSwell = now + rr(1.2, 3.5); }
    if (R() < 0.3) b.mid.f.frequency.setTargetAtTime(rr(700, 1500), now, 0.2);
    if (L > 0.3) {
      var rate = 2 + (L - 0.3) * 40;
      if (b.nextClap < now) b.nextClap = now + R() / rate;
      while (b.nextClap < now + 0.3) { clap(g, b.swell, b.nextClap, rr(0.25, 0.6), rr(-0.9, 0.9)); b.nextClap += -Math.log(1 - R() * 0.999) / rate; }
    }
    if (L > 0.65) {
      if (b.nextWhistle < now) b.nextWhistle = now + rr(0.5, 4);
      if (b.nextWhistle < now + 0.3) { whistle(g, b.swell, b.nextWhistle, 0.3); b.nextWhistle += rr(1.5, 6) / (0.3 + L); }
    }
  }

  // ------------------------------------------------------------------ the ballpark organ
  var NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function pm(s) { var r = /^([A-G])(#|b)?(-?\d)$/.exec(s); return 12 * (+r[3] + 1) + NOTE[r[1]] + (r[2] === '#' ? 1 : r[2] === 'b' ? -1 : 0); }
  // "C5/.5 E5+G5/1 r/.5 E4/3w": pitch(+pitch)/beats, r = rest, trailing w = sad-trombone wobble
  function seq(str, vel, out) {
    var b = 0;
    str.trim().split(/\s+/).forEach(function (tok) {
      var p = tok.split('/'), l = p[1] != null ? parseFloat(p[1]) : 1;
      if (p[0] !== 'r') out.push({ b: b, m: p[0].split('+').map(pm), l: l, v: vel, w: /w/.test(p[1] || '') });
      b += l;
    });
    return b;
  }
  function piece(bpm, voices, claps, legato) {
    var ev = [], len = 0;
    voices.forEach(function (v) { len = Math.max(len, seq(v[0], v[1], ev)); });
    ev.sort(function (a, b) { return a.b - b.b; });
    return { bpm: bpm, ev: ev, len: len, claps: claps || [], legato: legato || 0.9 };
  }
  var CH = { C: ['C3', 'C4+E4+G4'], F: ['F2', 'C4+F4+A4'], Dm: ['D3', 'D4+F4+A4'], G7: ['G2', 'B3+D4+F4'], G: ['G2', 'B3+D4+G4'], Am: ['A2', 'C4+E4+A4'] };
  function waltz(bars) { // oom-pah-pah accompaniment
    return [bars.map(function (k) { return CH[k][0] + '/1 r/2'; }).join(' '), bars.map(function (k) { return 'r/1 ' + CH[k][1] + '/.8 r/.2 ' + CH[k][1] + '/.8 r/.2'; }).join(' ')];
  }
  var MENU_BARS = ['C', 'C', 'F', 'C', 'F', 'Dm', 'G7', 'G', 'C', 'C', 'F', 'Am', 'F', 'G', 'G7', 'C'], acc = waltz(MENU_BARS);
  var PIECES = {
    charge: piece(132, [['G4/.333 C5/.333 E5/.334 G5/.75 E5/.25 G5/2', 1], ['r/1 E4+G4+C5/.75 r/.25 E4+G4+C5/2', 0.6], ['r/1 C3/.75 r/.25 C3/2', 0.8]]),
    homer: piece(160, [['C4/.25 D4/.25 E4/.25 F4/.25 G4/.25 A4/.25 B4/.25 C5/.25 D5/.25 E5/.25 F5/.25 G5/.25 A5/.25 B5/.25 C6/1 G5/.5 C6/.5 E6/.5 D6/.5 C6/2', 0.95],
      ['r/3.5 C4+E4+G4/2 F4+A4+C5/.5 G4+B4+D5/.5 C4+E4+G4+C5/2', 0.6], ['r/3.5 C3/2 F2/.5 G2/.5 C3/2', 0.8]]),
    walkup: piece(128, [['C4/.5 E4/.5 G4/.5 A4/.5 Bb4/.5 A4/.5 G4/.5 E4/.5 C5+E5+G5/.25 r/.25 C5+E5+G5/1', 0.95], ['C3/1 C3/1 C3/1 C3/1 C2/.25 r/.25 C3/1', 0.75]], null, 0.8),
    win: piece(140, [['G4/.5 C5/.5 E5/.5 G5/1 E5/.5 G5/1.5 r/.5 A5/.5 G5/.5 F5/.5 E5/.5 D5/.5 E5/.5 C5/2', 1],
      ['r/1.5 C4+E4+G4/3 r/.5 F4+A4+C5/1 G4+B4/1 G4+B4+D5/1 C4+E4+G4+C5/2', 0.55], ['r/1.5 C3/3 r/.5 F2/1 G2/1 G2/1 C3/2', 0.8]]),
    lose: piece(76, [['G4/1 Gb4/1 F4/1 E4/3w', 1], ['G3/1 Gb3/1 F3/1 E3/3w', 0.6]], null, 0.95),
    rally: piece(150, [['C4/.5 Db4/.5 D4/.5 Eb4/.5 E4/.5 F4/.5 F#4/.5 G4/.5 G#4/.5 A4/.5 Bb4/.5 B4/.5 C5+E5+G5/.4 r/1.6', 0.9],
      ['C3/1 C3/1 C3/1 C3/1 C3/1 C3/1 C2+C3/.4 r/1.6', 0.7]], [7, 7.5], 0.75),
    menu: piece(168, [['E5/2 D5/1 C5/1 E5/1 G5/1 A5/2 G5/1 E5/3 F5/2 E5/1 D5/1 F5/1 A5/1 G5/2 F5/1 D5/3 ' +
      'E5/2 D5/1 C5/1 E5/1 G5/1 C6/2 B5/1 A5/3 F5/1 A5/1 C6/1 B5/2 G5/1 D5/1.5 E5/.5 D5/1 C5/3', 0.7], [acc[0], 0.55], [acc[1], 0.32]], null, 0.88),
    _unlock: piece(180, [['C5/.25 E5/.25 G5/.25 C6+E5+G5/1.25', 0.9], ['r/.75 C3/1.25', 0.7]]),
    _levelUp: piece(170, [['G4/.25 C5/.25 E5/.25 G5/.5 E5/.25 C5+E5+G5+C6/1.5', 0.9], ['r/1.5 C3+C4/1.5', 0.7]]),
  };
  function organNote(g, dest, t, m, dur, v, wob) {
    var c = g.ctx, f = mtof(m), osc = c.createOscillator(), gn = c.createGain();
    if (g.wave) { osc.setPeriodicWave(g.wave); osc.frequency.setValueAtTime(f / 2, t); }
    else { osc.type = 'triangle'; osc.frequency.setValueAtTime(f, t); }
    gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(v, t + 0.006);
    gn.gain.setValueAtTime(v, t + dur); gn.gain.linearRampToValueAtTime(0, t + dur + 0.05);
    if (wob) { // sad-trombone wah-wah
      var lfo = c.createOscillator(), dep = c.createGain();
      lfo.frequency.value = 5; dep.gain.setValueAtTime(0, t); dep.gain.linearRampToValueAtTime(f * (g.wave ? 0.5 : 1) * 0.035, t + dur * 0.5);
      lfo.connect(dep); dep.connect(osc.frequency); lfo.start(t); lfo.stop(t + dur + 0.1);
      gn.gain.setValueAtTime(v, t + dur * 0.6); gn.gain.linearRampToValueAtTime(v * 0.4, t + dur);
    }
    osc.connect(gn); gn.connect(dest); osc.start(t); osc.stop(t + dur + 0.08);
  }
  function playEvent(g, P, ev, at, dest, gain) {
    var spb = 60 / P.bpm, dur = Math.max(0.05, ev.l * spb * P.legato), v = 0.15 * ev.v * (gain || 1);
    for (var i = 0; i < ev.m.length; i++) organNote(g, dest, at, ev.m[i], dur, v, ev.w);
    noise(g, dest, { t: at, f: 2800, q: 0.8, a: 0.0003, d: 0.006, v: v * 0.6 }); // key click
  }
  function playPiece(g, P, t0, dest, gain) {
    var spb = 60 / P.bpm;
    for (var i = 0; i < P.ev.length; i++) playEvent(g, P, P.ev[i], t0 + P.ev[i].b * spb, dest, gain);
    for (i = 0; i < P.claps.length; i++) claps(g, g.crowd, t0 + P.claps[i] * spb, 14, 0.3);
    return P.len * spb;
  }

  // ------------------------------------------------------------------ live state
  var S = { ctx: null, g: null, muted: false, music: true, menuWanted: false, menu: null, cue: null, timer: 0,
    crowdTarget: 0, last: {}, hidden: false, unlocked: false };

  function live() { // the live graph if it can make sound right now
    var g = S.g;
    return g && g.ctx.state === 'running' ? g : null;
  }
  function menuStart(g) {
    if (S.menu || !S.music) return;
    var c = g.ctx, gn = c.createGain(), now = c.currentTime;
    gn.gain.setValueAtTime(0.0001, now); gn.gain.linearRampToValueAtTime(1, now + 0.4); gn.connect(g.organIn);
    S.menu = { gain: gn, t0: now + 0.12, i: 0, it: 0 };
    menuPump(g);
  }
  function menuPump(g) {
    var m = S.menu; if (!m) return;
    var P = PIECES.menu, spb = 60 / P.bpm, L = P.len * spb, now = g.ctx.currentTime;
    for (var guard = 0; guard < 128; guard++) {
      var ev = P.ev[m.i], at = m.t0 + m.it * L + ev.b * spb;
      if (at > now + 0.5) break;
      if (at > now - 0.02) playEvent(g, P, ev, at, m.gain);
      if (++m.i >= P.ev.length) { m.i = 0; m.it++; }
    }
  }
  function fadeOut(node, g, tc) {
    try { var now = g.ctx.currentTime; node.gain.cancelScheduledValues(now); node.gain.setValueAtTime(node.gain.value, now); node.gain.setTargetAtTime(0, now, tc); } catch (e) { /* ignore */ }
    later(function () { node.disconnect(); }, 1500);
  }
  function menuStop(g, tc) { if (S.menu) { fadeOut(S.menu.gain, g, tc || 0.12); S.menu = null; } }
  function tick() {
    var g = S.g; if (!g || g.ctx.state !== 'running') return;
    var now = g.ctx.currentTime;
    if (g.bed) { g.bed.target = S.crowdTarget; bedTick(g, now); }
    else if (S.crowdTarget > 0) { bedBuild(g); bedTick(g, now); }
    if (S.menu) menuPump(g);
    else if (S.menuWanted && S.music && !S.cue) menuStart(g);
  }
  function create() {
    if (S.g) return S.g;
    var AC = W.AudioContext || W.webkitAudioContext;
    if (!AC) return null;
    try { if (W.navigator && W.navigator.audioSession) W.navigator.audioSession.type = 'ambient'; } catch (e) { /* ignore */ }
    var ctx;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
    S.ctx = ctx; S.g = buildGraph(ctx, false);
    try { ctx.onstatechange = function () { if (ctx.state !== 'running' && !S.hidden && S.unlocked) resume(); }; } catch (e) { /* ignore */ }
    S.timer = setInterval(safe(tick), 60);
    return S.g;
  }
  function resume() {
    var c = S.ctx; if (!c || S.hidden) return;
    if (c.state !== 'running' && c.state !== 'closed') { try { var p = c.resume(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* ignore */ } }
  }
  function unlock() {
    var g = create(); if (!g) return false;
    S.unlocked = true;
    resume();
    try { // the classic iOS kick: play one silent sample inside the gesture
      var b = g.ctx.createBuffer(1, 1, g.ctx.sampleRate), s = g.ctx.createBufferSource();
      s.buffer = b; s.connect(g.ctx.destination); s.start(0);
    } catch (e) { /* ignore */ }
    return true;
  }
  function onVisibility() {
    S.hidden = !!(W.document && W.document.hidden);
    var c = S.ctx; if (!c) return;
    if (S.hidden) { if (c.state === 'running') { try { var p = c.suspend(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* ignore */ } } }
    else if (S.unlocked) resume();
  }
  if (W.document && W.addEventListener) {
    try {
      W.document.addEventListener('visibilitychange', safe(onVisibility));
      W.addEventListener('pagehide', safe(function () { S.hidden = true; onVisibility(); S.hidden = true; }));
      W.addEventListener('pageshow', safe(function () { onVisibility(); }));
      W.addEventListener('focus', safe(function () { if (S.unlocked) resume(); }));
      // any later gesture re-kicks a context iOS has 'interrupted' (calls, Siri, other apps' audio)
      ['pointerdown', 'touchend', 'keydown'].forEach(function (ev) {
        W.addEventListener(ev, safe(function () { if (S.unlocked && S.ctx && S.ctx.state !== 'running') resume(); }), { capture: true, passive: true });
      });
    } catch (e) { /* ignore */ }
  }

  function sfx(name, opts) {
    var fn = SFX[name], g = live(); if (!fn || !g || S.muted) return;
    opts = opts || {};
    var now = g.ctx.currentTime;
    if (S.last[name] != null && now - S.last[name] < 0.025 && name !== 'crack') return; // de-dupe double fires
    S.last[name] = now;
    fn(g, now + 0.004 + (opts.when || 0), opts);
  }
  function organ(name) {
    var g = S.g;
    if (name === 'stop') { S.menuWanted = false; if (g) { menuStop(g, 0.15); if (S.cue) { fadeOut(S.cue, g, 0.08); S.cue = null; } } return; }
    if (name === 'menu') { S.menuWanted = true; if (live() && S.music && !S.cue) menuStart(g); return; }
    var P = PIECES[name]; if (!P || name.charAt(0) === '_') return;
    S.menuWanted = false;
    g = live(); if (!g || !S.music || S.muted) return;
    menuStop(g, 0.08);
    if (S.cue) fadeOut(S.cue, g, 0.05);
    var cue = g.ctx.createGain(); cue.connect(g.organIn); S.cue = cue;
    var len = playPiece(g, P, g.ctx.currentTime + 0.03, cue, 1);
    later(function () { if (S.cue === cue) S.cue = null; }, (len + 0.6) * 1000);
  }
  function setMuted(b) {
    S.muted = !!b; var g = S.g; if (!g) return;
    g.master.gain.setTargetAtTime(S.muted ? 0 : LEVEL.master, g.ctx.currentTime, 0.03);
  }
  function setMusic(b) {
    S.music = !!b; var g = S.g; if (!g) return;
    g.organ.gain.setTargetAtTime(S.music ? LEVEL.organ : 0, g.ctx.currentTime, 0.05);
    if (!S.music) { menuStop(g, 0.1); if (S.cue) { fadeOut(S.cue, g, 0.05); S.cue = null; } }
  }

  // ------------------------------------------------------------------ offline rendering (tests / tuning)
  // render(kind, name, opts, seconds) -> Promise<{peak, rms, seconds}> or null. kind: sfx | organ | cheer | groan | crowd
  function render(kind, name, opts, secs) {
    var OAC = W.OfflineAudioContext || W.webkitOfflineAudioContext;
    if (!OAC) return Promise.resolve(null);
    secs = secs || 2; opts = opts || {};
    var sr = 44100, oc = new OAC(2, Math.ceil(sr * secs), sr), g = buildGraph(oc, true), t = 0.02;
    if (kind === 'sfx') SFX[name](g, t, opts);
    else if (kind === 'organ') playPiece(g, PIECES[name], t, g.organIn, 1);
    else if (kind === 'cheer') cheer(g, t, opts.size == null ? 1 : opts.size, g.crowd);
    else if (kind === 'groan') groan(g, t, g.crowd);
    else if (kind === 'crowd') { var b = bedBuild(g); b.target = opts.level == null ? 0.7 : opts.level; for (var x = 0; x < secs; x += 0.1) bedTick(g, x); }
    return new Promise(function (res, rej) {
      function done(buf) {
        var peak = 0, sum = 0, n = 0;
        for (var ch = 0; ch < buf.numberOfChannels; ch++) {
          var d = buf.getChannelData(ch);
          for (var i = 0; i < d.length; i++) { var a = Math.abs(d[i]); if (a > peak) peak = a; sum += d[i] * d[i]; n++; }
        }
        res({ peak: peak, rms: Math.sqrt(sum / (n || 1)), seconds: secs });
      }
      var p = oc.startRendering();
      if (p && p.then) p.then(done, rej); else oc.oncomplete = function (e) { done(e.renderedBuffer); };
    });
  }

  var SFX_NAMES = Object.keys(SFX), ORGAN_NAMES = Object.keys(PIECES).filter(function (k) { return k.charAt(0) !== '_'; });
  BB.Audio = {
    unlock: safe(unlock),
    setMuted: safe(setMuted),
    isMuted: function () { return S.muted; },
    setMusic: safe(setMusic),
    isMusic: function () { return S.music; },
    sfx: safe(sfx),
    crowd: safe(function (level) { S.crowdTarget = clamp(+level || 0, 0, 1); }),
    cheer: safe(function (size) { var g = live(); if (g && !S.muted) cheer(g, g.ctx.currentTime + 0.01, size == null ? 0.6 : size, g.crowd); }),
    groan: safe(function () { var g = live(); if (g && !S.muted) groan(g, g.ctx.currentTime + 0.01, g.crowd); }),
    organ: safe(organ),
    // extras
    state: function () { try { return S.ctx ? S.ctx.state : 'none'; } catch (e) { return 'none'; } },
    ready: function () { return !!live(); },
    render: function (kind, name, opts, secs) { try { return render(kind, name, opts, secs); } catch (e) { return Promise.resolve(null); } },
    preview: safe(function (kind, name, opts) { // one entry point for harnesses / dev menus
      if (kind === 'sfx') sfx(name, opts); else if (kind === 'organ') organ(name);
      else if (kind === 'cheer') BB.Audio.cheer(opts && opts.size); else if (kind === 'groan') BB.Audio.groan();
      else if (kind === 'crowd') BB.Audio.crowd(opts && opts.level);
    }),
    SFX: SFX_NAMES,
    ORGAN: ORGAN_NAMES,
  };

  // ------------------------------------------------------------------ haptics
  function vib(p) {
    try { if (BB.Haptics.enabled && W.navigator && typeof W.navigator.vibrate === 'function') W.navigator.vibrate(p); } catch (e) { /* ignore */ }
  }
  BB.Haptics = {
    enabled: true,
    tap: function () { vib(8); },
    thud: function () { vib(24); },
    buzz: function () { vib([30, 40, 30]); },
  };
})();
