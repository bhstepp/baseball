// 40-audio.js — BB.Audio + BB.Haptics. Owned by the audio agent.
// Every sound is synthesized with the Web Audio API at call time: no files. Nothing here may throw: every public
// entry point is wrapped, and with no AudioContext the whole module degrades to silent no-ops.
//
// Graph:  sources -> [sfx bus | crowd bus | organ bus] -> master gain -> compressor -> soft-clip shaper -> out
//         sfx sends -> stadium slap-back echo -> sfx bus;  organ voices -> vibrato/tremolo "leslie" -> organ bus;
//         the cartoon pit band (clarinet / bassoon FM reeds, brass, pizzicato, xylophone, traps) -> organ (music) bus
(function () {
  var W = typeof window !== 'undefined' ? window : globalThis;
  var R = Math.random;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rr(a, b) { return a + (b - a) * R(); }
  function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function own(o, k) { return typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null; }
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

  // ------------------------------------------------------------------ cartoon-orchestra voices
  // An LFO onto one or more frequency params: targets = [[param, depthHz], ...]; depth ramps in after `delay`.
  function lfoTo(g, t, dur, rate, targets, delay) {
    var c = g.ctx, l = c.createOscillator(); l.frequency.value = rate; delay = delay || 0;
    for (var i = 0; i < targets.length; i++) {
      var dg = c.createGain();
      dg.gain.setValueAtTime(0, t + delay); dg.gain.linearRampToValueAtTime(targets[i][1], t + Math.max(delay + 0.01, dur * 0.5));
      l.connect(dg); dg.connect(targets[i][0]);
    }
    l.start(t); l.stop(t + dur + 0.2);
  }
  // held-note envelope; wob = sad-trombone droop over the second half
  function sustainEnv(p, t, a, v, dur, rel, wob) {
    var e = t + Math.max(a + 0.005, dur);
    p.setValueAtTime(0, t); p.linearRampToValueAtTime(v, t + a);
    if (wob) { p.setValueAtTime(v, t + Math.max(a + 0.004, dur * 0.6)); p.linearRampToValueAtTime(v * 0.4, e); }
    else p.setValueAtTime(v, e);
    p.linearRampToValueAtTime(0, e + rel);
    return e + rel;
  }
  // two-operator FM reed. ratio 2 -> odd harmonics (clarinet); ratio 1, dark filter -> bassoon / tuba
  function reedNote(g, dest, t, f, dur, v, wob, ratio, i0, i1, lpf) {
    var c = g.ctx, car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain(), amp = c.createGain(), lp = c.createBiquadFilter();
    car.frequency.setValueAtTime(f, t); mod.frequency.setValueAtTime(f * ratio, t);
    mg.gain.setValueAtTime(f * i0, t); mg.gain.exponentialRampToValueAtTime(f * i1, t + 0.1);
    mod.connect(mg); mg.connect(car.frequency);
    lp.type = 'lowpass'; lp.frequency.value = lpf; lp.Q.value = 0.7;
    var end = sustainEnv(amp.gain, t, 0.016, v, dur, 0.05, wob);
    if (wob) lfoTo(g, t, dur, 5, [[car.frequency, f * 0.035], [mod.frequency, f * ratio * 0.035]]);
    else if (dur > 0.3) lfoTo(g, t, dur, 5.6, [[car.frequency, f * 0.006], [mod.frequency, f * ratio * 0.006]], 0.14);
    car.connect(amp); amp.connect(lp); lp.connect(dest);
    car.start(t); mod.start(t); car.stop(end + 0.05); mod.stop(end + 0.05);
  }
  function brassNote(g, dest, t, f, dur, v, wob) { // two detuned saws, a "blat" filter swell and a little scoop
    var c = g.ctx, lp = c.createBiquadFilter(), amp = c.createGain(), fr = [];
    lp.type = 'lowpass'; lp.Q.value = 1.2;
    lp.frequency.setValueAtTime(f * 1.2, t); lp.frequency.linearRampToValueAtTime(Math.min(f * 7, 15000), t + 0.035);
    lp.frequency.setTargetAtTime(Math.min(f * 3.2, 12000), t + 0.04, 0.08);
    var end = sustainEnv(amp.gain, t, 0.02, v, dur, 0.07, wob);
    for (var i = 0; i < 2; i++) {
      var o = c.createOscillator(); o.type = 'sawtooth'; o.detune.value = i ? 7 : -7;
      o.frequency.setValueAtTime(f * 0.96, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.045);
      o.connect(lp); o.start(t); o.stop(end + 0.05); fr.push([o.frequency, f * (wob ? 0.035 : 0.005)]);
    }
    if (wob || dur > 0.3) lfoTo(g, t, dur, wob ? 5 : 5.4, fr, wob ? 0 : 0.15);
    lp.connect(amp); amp.connect(dest);
  }
  function pizzNote(g, dest, t, f, v) { // plucked string: bright saw+tri, filter snaps shut
    var c = g.ctx, lp = c.createBiquadFilter(), amp = c.createGain(), d = clamp(0.32 * Math.pow(220 / f, 0.25), 0.12, 0.5);
    lp.type = 'lowpass'; lp.Q.value = 2;
    lp.frequency.setValueAtTime(Math.min(f * 12, 14000), t); lp.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.12);
    amp.gain.setValueAtTime(0.0001, t); amp.gain.linearRampToValueAtTime(v, t + 0.003); amp.gain.exponentialRampToValueAtTime(0.0001, t + d);
    for (var i = 0; i < 2; i++) {
      var o = c.createOscillator(); o.type = i ? 'triangle' : 'sawtooth'; o.frequency.value = f; o.detune.value = i ? 4 : -4;
      o.connect(lp); o.start(t); o.stop(t + d + 0.05);
    }
    lp.connect(amp); amp.connect(dest);
  }
  function xyloNote(g, dest, t, f, v, pan) { // struck bar: fundamental + tuned 3rd partial + mallet click
    var d = clamp(0.5 * Math.pow(523 / f, 0.5), 0.12, 0.6);
    tone(g, dest, { t: t, f: f, a: 0.001, d: d, v: v, pan: pan });
    tone(g, dest, { t: t, f: f * 3, a: 0.001, d: d * 0.25, v: v * 0.3, pan: pan });
    noise(g, dest, { t: t, f: Math.min(f * 4, 12000), q: 2, a: 0.0005, d: 0.006, v: v * 0.5, pan: pan });
  }
  function kick(g, dest, t, v) {
    tone(g, dest, { t: t, f: 130, f2: 45, glide: 0.08, a: 0.001, d: 0.3, v: v });
    noise(g, dest, { t: t, filt: 'lowpass', f: 300, q: 0.7, a: 0.001, d: 0.04, v: v * 0.4 });
  }
  function snare(g, dest, t, v) {
    noise(g, dest, { t: t, f: 1900, q: 0.8, a: 0.001, d: 0.11, v: v });
    tone(g, dest, { t: t, type: 'triangle', f: 230, f2: 180, glide: 0.03, a: 0.001, d: 0.05, v: v * 0.4 });
  }
  function cymbal(g, dest, t, v) {
    noise(g, dest, { t: t, filt: 'highpass', f: 5500, q: 0.5, a: 0.002, d: 1.3, v: v });
    noise(g, dest, { t: t, f: 9000, q: 1, a: 0.001, d: 0.5, v: v * 0.6 });
  }
  function chirp(g, dest, t, v, pan) { // one tiny cartoon bird "tweet": fast up-sweep with a warble
    var f = rr(2900, 3700), o = tone(g, dest, { t: t, f: f * 0.75, f2: f * 1.25, glide: 0.04, a: 0.003, d: 0.055, v: v, pan: pan });
    lfoTo(g, t, 0.02, 45, [[o.frequency, 260]]);
  }

  // ------------------------------------------------------------------ sound effects
  var SFX = {
    crack: function (g, t, o) { crack(g, t, o.quality == null ? 0.8 : o.quality, !!o.sweet, false); },
    foul: function (g, t, o) { crack(g, t, o.quality == null ? 0.4 : Math.min(o.quality, 0.6), false, true); },
    whiff: function (g, t) { // comic swoosh (breath + whistled arc) and a tiny bird twitter as the bat comes round
      noise(g, g.sfx, { t: t, f: 350, pts: [[0.1, 2600], [0.25, 500]], q: 2.2, a: 0.05, hold: 0.04, d: 0.15, v: 0.6, pan: -0.2 });
      tone(g, g.sfx, { t: t, f: 520, f2: 1900, glide: 0.1, a: 0.04, d: 0.08, v: 0.06, pan: -0.2 });
      tone(g, g.sfx, { t: t + 0.1, f: 1900, f2: 560, glide: 0.14, a: 0.01, d: 0.14, v: 0.05, pan: 0.1 });
      noise(g, g.sfx, { t: t + 0.02, buf: 'pink', filt: 'lowpass', f: 500, q: 0.7, a: 0.06, d: 0.15, v: 0.35 });
      var p = rr(-0.6, 0.6);
      chirp(g, g.sfx, t + 0.34, 0.07, p); chirp(g, g.sfx, t + 0.43, 0.06, p); chirp(g, g.sfx, t + 0.5, 0.075, p);
    },
    whoosh: function (g, t, o) {
      var sp = clamp(((o.mph || 88) - 50) / 50, 0, 1);
      noise(g, g.sfx, { t: t, f: 800 + 700 * sp, pts: [[0.16, 2300 + 1400 * sp], [0.3, 800]], q: 2, a: 0.14, d: 0.16, v: 0.25 + 0.2 * sp, pan: 0.25 });
      tone(g, g.sfx, { t: t, f: 1500 + 900 * sp, f2: (1500 + 900 * sp) * 0.72, gd: 0.13, glide: 0.15, a: 0.12, d: 0.17, v: 0.03 + 0.02 * sp });
    },
    zip: function (g, t, o) { // fast cartoon zip: the faster the pitch, the shorter and higher
      var sp = clamp(((o.mph || 88) - 50) / 50, 0, 1), d = 0.22 - 0.1 * sp, f0 = 450 + 400 * sp, f1 = 3000 + 2500 * sp;
      noise(g, g.sfx, { t: t, f: f0, f2: f1, glide: d, q: 3, a: d * 0.7, d: 0.05, v: 0.4 + 0.25 * sp, pan: 0.2 });
      tone(g, g.sfx, { t: t, type: 'sawtooth', f: f0 * 0.5, f2: f1 * 0.4, glide: d, a: d * 0.7, d: 0.04, v: 0.035 + 0.02 * sp, pan: 0.2 });
      tone(g, g.sfx, { t: t, f: f0, f2: f1 * 0.8, glide: d, a: d * 0.7, d: 0.05, v: 0.05 });
      noise(g, g.sfx, { t: t + d, buf: 'pink', filt: 'lowpass', f: 2200, f2: 400, glide: 0.15, q: 0.7, a: 0.005, d: 0.15, v: 0.18, pan: -0.2 });
    },
    mitt: function (g, t, o) {
      var sp = clamp(((o.mph || 88) - 50) / 50, 0, 1);
      noise(g, g.sfx, { t: t, filt: 'highpass', f: 3000, q: 0.7, a: 0.0003, d: 0.005, v: 0.45 });
      noise(g, g.sfx, { t: t, filt: 'lowpass', f: 2600, f2: 350, glide: 0.05, q: 1, a: 0.0008, d: 0.07, v: 0.6 + 0.3 * sp, send: 0.25 });
      tone(g, g.sfx, { t: t, f: 160, f2: 70, glide: 0.06, a: 0.001, d: 0.09, v: 0.55 + 0.2 * sp });
    },
    strike: function (g, t) { // stylized comic umpire "HUP!": breath, a barked vowel that drops, a lip-pop button
      noise(g, g.sfx, { t: t, f: 1800, q: 1, a: 0.006, d: 0.03, v: 0.18 });
      var o = g.ctx.createGain(); route(g, o, { send: 0.3 }, g.sfx);
      voice(g, o, t + 0.015, 235, 150, [720, 1240, 2650], 1.0, 0.008, 0.07, 0.08);
      tone(g, g.sfx, { t: t + 0.17, f: 420, f2: 130, glide: 0.025, a: 0.0008, d: 0.035, v: 0.35 });
      woodblock(g, g.sfx, t + 0.17, 1250, 0.12);
    },
    ball: function (g, t) { voice(g, g.sfx, t, 140, 118, [450, 820, 2500], 0.5, 0.02, 0.03, 0.08); },
    out: function (g, t) { woodblock(g, g.sfx, t, 620, 0.5); woodblock(g, g.sfx, t + 0.12, 470, 0.42); },
    wall: function (g, t) {
      tone(g, g.sfx, { t: t, f: 95, f2: 48, glide: 0.12, a: 0.002, d: 0.25, v: 0.8 });
      noise(g, g.sfx, { t: t, filt: 'lowpass', f: 380, q: 0.8, a: 0.001, d: 0.18, v: 0.6, send: 0.3 });
      var p = [410, 627, 1043, 1389, 1820];
      for (var i = 0; i < p.length; i++) tone(g, g.sfx, { t: t + 0.003, type: i % 2 ? 'triangle' : 'sine', f: p[i] * rr(0.98, 1.02), a: 0.001, d: 0.5 - 0.08 * i, v: 0.06, send: 0.2 });
    },
    stamp: function (g, t) { // punchy comic pop: a thump with an up-flicked "pok" and a paper slap
      tone(g, g.sfx, { t: t, f: 170, f2: 60, glide: 0.06, a: 0.001, d: 0.12, v: 0.85 });
      tone(g, g.sfx, { t: t + 0.004, f: 380, f2: 1250, glide: 0.035, a: 0.001, d: 0.06, v: 0.35 });
      noise(g, g.sfx, { t: t, filt: 'lowpass', f: 1600, f2: 300, glide: 0.05, q: 0.8, a: 0.0008, d: 0.05, v: 0.5 });
      noise(g, g.sfx, { t: t, filt: 'highpass', f: 3000, q: 0.7, a: 0.0003, d: 0.006, v: 0.3 });
    },
    tap: function (g, t) {
      tone(g, g.sfx, { t: t, f: 1700, f2: 1150, glide: 0.015, a: 0.0005, d: 0.03, v: 0.18 });
      noise(g, g.sfx, { t: t, filt: 'highpass', f: 4000, q: 0.7, a: 0.0003, d: 0.004, v: 0.12 });
    },
    pop: function (g, t) { // cork pop
      noise(g, g.sfx, { t: t, filt: 'highpass', f: 2000, q: 0.7, a: 0.0002, d: 0.004, v: 0.4 });
      tone(g, g.sfx, { t: t, f: 420, f2: 1300, glide: 0.025, a: 0.0008, d: 0.045, v: 0.45 });
      noise(g, g.sfx, { t: t + 0.003, f: 900, q: 4, a: 0.0005, d: 0.03, v: 0.3 });
    },
    coin: function (g, t) { // cartoon cash register: "cha" (drawer clack + coin rattle) then "CHING!"
      noise(g, g.sfx, { t: t, f: 2600, q: 3, a: 0.0005, d: 0.03, v: 0.45 });
      tone(g, g.sfx, { t: t, f: 320, f2: 180, glide: 0.03, a: 0.0008, d: 0.05, v: 0.3 });
      for (var i = 0; i < 6; i++) noise(g, g.sfx, { t: t + 0.02 + i * 0.015 + rr(0, 0.01), filt: 'highpass', f: rr(5000, 8000), q: 2, a: 0.0005, d: rr(0.008, 0.02), v: rr(0.08, 0.16), pan: rr(-0.4, 0.4) });
      var b = t + 0.12, f0 = 1568, P = [[1, 0.2, 0.9], [2, 0.09, 0.6], [2.76, 0.08, 0.45], [5.4, 0.04, 0.25], [8.93, 0.02, 0.12]];
      for (i = 0; i < P.length; i++) {
        tone(g, g.sfx, { t: b, f: f0 * P[i][0], a: 0.001, d: P[i][2], v: P[i][1], send: 0.15 });
        tone(g, g.sfx, { t: b + 0.06, f: f0 * 1.335 * P[i][0], a: 0.001, d: P[i][2] * 0.8, v: P[i][1] * 0.6, send: 0.15 });
      }
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
    unlock: function (g, t) { playPiece(g, PIECES._unlock, t, { org: g.organSfx, dry: g.sfx }, 1.1); },
    levelUp: function (g, t) { playPiece(g, PIECES._levelUp, t, { org: g.organSfx, dry: g.sfx }, 1.1); },
    error: function (g, t) {
      tone(g, g.sfx, { t: t, type: 'square', f: 196, f2: 185, glide: 0.08, a: 0.002, d: 0.09, v: 0.06 });
      tone(g, g.sfx, { t: t + 0.11, type: 'square', f: 165, f2: 150, glide: 0.1, a: 0.002, d: 0.12, v: 0.06 });
    },
    toast: function (g, t) {
      tone(g, g.sfx, { t: t, f: 1320, a: 0.002, d: 0.08, v: 0.1 });
      tone(g, g.sfx, { t: t + 0.06, f: 1760, a: 0.002, d: 0.12, v: 0.09 });
    },
    // ---- cartoon gags
    boing: function (g, t, o) { // spring doorstop: a twangy saw whose pitch and resonance wobble and settle
      var c = g.ctx, f = clamp(+o.f || 110, 50, 400), osc = c.createOscillator(), lp = c.createBiquadFilter(), amp = c.createGain();
      var l = c.createOscillator(), d1 = c.createGain(), d2 = c.createGain(), D = 0.9;
      osc.type = 'sawtooth'; osc.frequency.setValueAtTime(f * 0.8, t); osc.frequency.exponentialRampToValueAtTime(f, t + 0.05);
      lp.type = 'lowpass'; lp.Q.value = 9; lp.frequency.setValueAtTime(400, t); lp.frequency.exponentialRampToValueAtTime(1900, t + 0.06); lp.frequency.setTargetAtTime(700, t + 0.08, 0.3);
      l.frequency.setValueAtTime(17, t); l.frequency.exponentialRampToValueAtTime(9, t + D);
      d1.gain.setValueAtTime(f * 0.28, t); d1.gain.exponentialRampToValueAtTime(f * 0.01, t + D);
      d2.gain.setValueAtTime(650, t); d2.gain.exponentialRampToValueAtTime(15, t + D);
      l.connect(d1); d1.connect(osc.frequency); l.connect(d2); d2.connect(lp.frequency);
      env(amp.gain, t, 0.004, 0.32, D);
      osc.connect(lp); lp.connect(amp); route(g, amp, { send: 0.15 }, g.sfx);
      osc.start(t); l.start(t); osc.stop(t + D + 0.05); l.stop(t + D + 0.05);
    },
    slide: function (g, t, o) { // slide whistle; o.dir 'up' (default) | 'down', o.dur seconds
      var down = o.dir === 'down', d = clamp(+o.dur || (down ? 0.75 : 0.55), 0.15, 2.5);
      var f0 = down ? 1900 : 480, f1 = down ? 430 : 1900;
      var w = tone(g, g.sfx, { t: t, f: f0, f2: f1, glide: d, a: 0.035, hold: Math.max(0, d - 0.06), d: 0.07, v: 0.14, send: 0.12 });
      lfoTo(g, t, d, 6.5, [[w.frequency, 14]], 0.05);
      tone(g, g.sfx, { t: t, f: f0 * 2, f2: f1 * 2, glide: d, a: 0.035, hold: Math.max(0, d - 0.06), d: 0.07, v: 0.015 });
      noise(g, g.sfx, { t: t, f: f0, f2: f1, glide: d, q: 5, a: 0.03, hold: Math.max(0, d - 0.06), d: 0.07, v: 0.07 });
    },
    bonk: function (g, t) { // wood-block bonk on the noggin
      woodblock(g, g.sfx, t, 540, 0.55);
      tone(g, g.sfx, { t: t, f: 900, f2: 380, glide: 0.06, a: 0.001, d: 0.12, v: 0.35 });
      tone(g, g.sfx, { t: t, type: 'triangle', f: 270, f2: 190, glide: 0.05, a: 0.001, d: 0.1, v: 0.3 });
    },
    xylo: function (g, t) { // descending xylophone run ending in a dopey low plunk (strikeout)
      var m = [96, 93, 91, 88, 86, 84, 81, 79, 76, 74, 72], tt = t;
      for (var i = 0; i < m.length; i++) { xyloNote(g, g.sfx, tt, mtof(m[i]), 0.17, 0.6 - 1.2 * i / m.length); tt += 0.05 + i * 0.004; }
      xyloNote(g, g.sfx, tt + 0.1, mtof(55), 0.3, -0.5);
      woodblock(g, g.sfx, tt + 0.1, 330, 0.25);
    },
    honk: function (g, t, o) { // rubber-bulb bicycle horn, "honk-honk" (o.n = 1 for a single honk)
      var n = o.n === 1 ? 1 : 2;
      for (var k = 0; k < n; k++) {
        var tt = t + k * 0.2, fb = formants(g, g.sfx, [950, 1600, 2800], [5, 6, 8], [1, 0.6, 0.3]), f = k ? 385 : 370;
        tone(g, fb.input, { t: tt, type: 'sawtooth', f: f * 0.9, f2: f, glide: 0.03, a: 0.008, hold: 0.09, d: 0.06, v: 0.9 });
        tone(g, fb.input, { t: tt, type: 'square', f: f * 0.905, f2: f * 1.006, glide: 0.03, a: 0.008, hold: 0.09, d: 0.06, v: 0.5 });
        noise(g, g.sfx, { t: tt, f: 3200, q: 4, a: 0.01, d: 0.05, v: 0.06 });
      }
    },
    twinkle: function (g, t, o) { // dizzy stars circling the head: high bell tinkles panning round
      var dur = clamp(+o.dur || 1.4, 0.4, 4), notes = [88, 91, 93, 96, 98, 100, 103], n = Math.round(dur * 11);
      for (var i = 0; i < n; i++) {
        var tt = t + i * dur / n + rr(0, 0.02), f = mtof(notes[Math.floor(R() * notes.length)]), v = 0.08 * (1 - 0.5 * i / n), pan = Math.sin(i * 0.9) * 0.8;
        tone(g, g.sfx, { t: tt, f: f, a: 0.002, d: 0.18, v: v, pan: pan, send: 0.2 });
        tone(g, g.sfx, { t: tt, f: f * 2.01, a: 0.002, d: 0.08, v: v * 0.3, pan: pan });
      }
      noise(g, g.sfx, { t: t, filt: 'highpass', f: 8000, q: 0.7, a: 0.1, hold: Math.max(0, dur - 0.3), d: 0.3, v: 0.03 });
    },
    kablam: function (g, t) { // big cartoon explosion: boom + blast + crackle + debris raining down
      tone(g, g.sfx, { t: t, f: 90, f2: 32, glide: 0.35, a: 0.002, d: 1.1, v: 0.85 });
      tone(g, g.sfx, { t: t, type: 'triangle', f: 160, f2: 45, glide: 0.12, a: 0.001, d: 0.35, v: 0.45 });
      noise(g, g.sfx, { t: t, filt: 'lowpass', f: 3000, f2: 120, glide: 0.9, q: 0.7, a: 0.002, d: 1.4, v: 0.85, send: 0.35 });
      noise(g, g.sfx, { t: t, filt: 'highpass', f: 1200, q: 0.7, a: 0.001, d: 0.05, v: 0.45 });
      for (var i = 0; i < 18; i++) noise(g, g.sfx, { t: t + 0.05 + Math.pow(R(), 1.5) * 0.6, f: rr(800, 3000), q: 1.5, a: 0.0005, d: rr(0.005, 0.02), v: rr(0.1, 0.3), pan: rr(-0.8, 0.8) });
      for (i = 0; i < 12; i++) {
        var tt = t + 0.35 + i * 0.08 + rr(0, 0.05), k = 1 - i / 12, f = rr(600, 2200), p = rr(-0.8, 0.8);
        tone(g, g.sfx, { t: tt, f: f, f2: f * 0.8, glide: 0.03, a: 0.0008, d: rr(0.03, 0.08), v: 0.03 + 0.1 * k, pan: p });
        noise(g, g.sfx, { t: tt, f: f * 1.7, q: 6, a: 0.0005, d: 0.02, v: 0.05 + 0.15 * k, pan: p });
      }
    },
    splat: function (g, t) { // wet splat with a few gloopy bloops
      noise(g, g.sfx, { t: t, filt: 'lowpass', f: 2500, f2: 250, glide: 0.12, q: 1.5, a: 0.002, d: 0.2, v: 0.9 });
      tone(g, g.sfx, { t: t, f: 260, f2: 70, glide: 0.08, a: 0.001, d: 0.14, v: 0.55 });
      noise(g, g.sfx, { t: t, f: 1200, q: 3, a: 0.001, d: 0.06, v: 0.3 });
      for (var i = 0; i < 7; i++) {
        var f = rr(500, 1300);
        tone(g, g.sfx, { t: t + 0.06 + i * 0.04 + rr(0, 0.05), f: f * 0.6, f2: f, glide: 0.02, a: 0.001, d: 0.04, v: rr(0.08, 0.16), pan: rr(-0.6, 0.6) });
      }
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

  // ------------------------------------------------------------------ the ballpark organ + cartoon pit band
  var NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function pm(s) { var r = /^([A-G])(#|b)?(-?\d)$/.exec(s); return 12 * (+r[3] + 1) + NOTE[r[1]] + (r[2] === '#' ? 1 : r[2] === 'b' ? -1 : 0); }
  // "C5/.5 E5+G5/1 r/.5 E4/3w": pitch(+pitch)/beats, r = rest, trailing w = sad-trombone wobble
  function seq(str, vel, out, inst, lg) {
    var b = 0;
    str.trim().split(/\s+/).forEach(function (tok) {
      var p = tok.split('/'), l = p[1] != null ? parseFloat(p[1]) : 1;
      if (p[0] !== 'r') out.push({ b: b, m: p[0].split('+').map(pm), l: l, v: vel, w: /w/.test(p[1] || ''), inst: inst || 'organ', lg: lg });
      b += l;
    });
    return b;
  }
  // voices: [notes, velocity, instrument (default organ), legato (default the piece's)]
  function piece(bpm, voices, claps, legato) {
    var ev = [], len = 0;
    voices.forEach(function (v) { len = Math.max(len, seq(v[0], v[1], ev, v[2], v[3])); });
    ev.sort(function (a, b) { return a.b - b.b; });
    return { bpm: bpm, ev: ev, len: len, claps: claps || [], legato: legato || 0.9 };
  }
  function rep(s, n) { var o = []; for (var i = 0; i < n; i++) o.push(s); return o.join(' '); }
  // an offbeat "chunk" chord on beats 2 and 4 of each 4/4 bar: bars = [[chordOn2, chordOn4], ...]
  function chunks(bars) { return bars.map(function (b) { return 'r/1 ' + b[0] + '/.5 r/1.5 ' + b[1] + '/.5 r/.5'; }).join(' '); }

  // MENU: an original bouncy 16-bar strut in C (I-VI7-II7-V7 "sunny" changes, a ragtime minor iv, a diminished
  // passing chord and a turnaround that loops straight back to the pickup). Clarinet tune, xylophone joins for the
  // second half, bassoon + pizzicato bass on 1 and 3, organ chunks on 2 and 4, wood blocks clip-clopping.
  var MENU_MEL = [
    'G4/.5 G#4/.5 A4/.5 C5/1 A4/.5 G4/1', 'C#5/.5 r/.5 E5/.5 G5/.5 A5/1 G5/.5 E5/.5', 'F#5/1 D5/.5 A4/.5 C5/.5 B4/.5 A4/1', 'G4/.5 A4/.5 B4/.5 D5/.5 F5/1.5 r/.5',
    'E5/.5 D#5/.5 E5/.5 G5/.5 C6/1 G5/.5 E5/.5', 'Bb5/1 A5/.5 G5/.5 E5/1 C5/1', 'A4/.5 C5/.5 F5/.5 A5/.5 G#5/.5 A5/.5 F5/1', 'Ab5/1 G5/.5 F5/.5 D5/1 B4/1',
    'C5/.5 r/.5 E5/.5 G5/.5 C6/.5 B5/.5 C6/1', 'r/.5 A5/.5 G5/.5 E5/.5 C#5/.5 E5/.5 A4/1', 'D5/.5 E5/.5 F#5/.5 A5/.5 C6/1 A5/1', 'B5/.5 A5/.5 G5/.5 F5/.5 D5/.5 B4/.5 G4/1',
    'E5/1 G5/.5 E5/.5 Eb5/1 F#5/.5 A5/.5', 'D5/.5 F5/.5 A5/.5 C6/.5 B5/.5 G5/.5 F5/.5 D5/.5', 'E5/.5 G5/.5 C6/.5 r/.5 C#6/.5 r/.5 A5/1', 'D6/.5 r/.5 F5/.5 E5/.5 D5/1 B4/1'];
  var MENU_BASS = ['C3 r G2 r', 'A2 r E2 r', 'D3 r A2 r', 'G2 r D3 B2', 'C3 r G2 r', 'C3 r G2 E2', 'F2 r C3 r', 'F2 r Ab2 G2',
    'C3 r G2 r', 'A2 r E2 r', 'D3 r A2 r', 'G2 r D3 r', 'E2 r Eb2 r', 'D2 r G2 r', 'C3 r A2 r', 'D3 r G2 B2'].join(' ').split(' ')
    .map(function (n) { return n + '/1'; }).join(' ');
  var CHD = { C: 'E4+G4+C5', A7: 'E4+G4+C#5', D7: 'F#4+A4+C5', G7: 'F4+G4+B4', C7: 'E4+G4+Bb4', F: 'F4+A4+C5', Fm: 'F4+Ab4+C5',
    Eo: 'Eb4+F#4+A4', Dm7: 'F4+A4+C5' };
  var MENU_CH = chunks([['C', 'C'], ['A7', 'A7'], ['D7', 'D7'], ['G7', 'G7'], ['C', 'C'], ['C7', 'C7'], ['F', 'F'], ['Fm', 'Fm'],
    ['C', 'C'], ['A7', 'A7'], ['D7', 'D7'], ['G7', 'G7'], ['C', 'Eo'], ['Dm7', 'G7'], ['C', 'A7'], ['Dm7', 'G7']]
    .map(function (b) { return [CHD[b[0]], CHD[b[1]]]; }));
  var MENU_PIZZ = MENU_BASS.replace(/([A-G]b?)(\d)/g, function (s, n, o) { return n + (+o + 1); });

  var PIECES = {
    charge: piece(132, [['G4/.333 C5/.333 E5/.334 G5/.75 E5/.25 G5/2', 0.9, 'brass'], ['G4/.333 C5/.333 E5/.334 G5/.75 E5/.25 G5/2', 0.6],
      ['r/1 E4+G4+C5/.75 r/.25 E4+G4+C5/2', 0.5], ['r/1 C3/.75 r/.25 C3/2', 0.8, 'bassoon'],
      ['C4/.333 C4/.333 C4/.334 r/.75 C4/.25 C4/2', 0.45, 'snare'], ['r/1 C4/.75 r/.25 C4/2', 0.5, 'kick'], ['r/2 C4/1', 0.6, 'cym']]),
    homer: piece(160, [['C5/.125 D5/.125 E5/.125 F5/.125 G5/.125 A5/.125 B5/.125 C6/.125 D6/.125 E6/.125 F6/.125 G6/.125 A6/.125 B6/.125 C7/.25 r/7.5 C7+G6/.5', 0.9, 'xylo'],
      ['r/2 C5/.5 E5/.25 G5/.75 C6/.5 r/.25 A5/.25 C6/.5 B5/.25 A5/.25 G5/.5 E5/.5 F5/.5 D5/.5 C5+E5+G5+C6/2.5', 0.85, 'brass'],
      ['r/2 C4+E4+G4/2 F4+A4+C5/2 G4+B4+D5/1 G4+B4+F5/1 C4+E4+G4+C5/2', 0.5],
      ['r/2 C3/.5 r/.5 G2/.5 r/.5 F2/.5 r/.5 C3/.5 r/.5 G2/.5 r/.5 G2/.5 B2/.5 C3/2', 0.9, 'bassoon', 0.7],
      ['r/2 ' + rep('C4/1', 6) + ' C4/2', 0.35, 'kick'], ['r/2 ' + rep('r/1 C4/1', 3) + ' C4/2', 0.4, 'snare'], ['r/2 C4/6 C4/2', 0.55, 'cym']], [2, 6], 0.9),
    walkup: piece(132, [['C3/1 E3/1 G3/1 A3/1 Bb3/1 A3/1 G3/1 E3/1 C3/.25 r/.25 C2/1.5', 0.9, 'bassoon', 0.7],
      ['r/1 G4/.5 A4/.5 C5/1 D#5/.5 E5/.5 G5/1 E5/.5 C5/.5 D5/.5 C5/.5 A4/1 r/2', 0.9, 'reed', 0.85],
      ['r/8 C5+E5+Bb5/.25 r/.25 C5+E5+G5+C6/1.5', 0.8, 'brass'], ['r/8 C4+E4+Bb4/.25 r/.25 C4+E4+G4+C5/1.5', 0.45],
      [rep('r/1 G5/1', 4), 0.5, 'block'], ['r/8 C4/.25 r/.25 C4/1.5', 0.5, 'kick'], ['r/8.5 C4/1.5', 0.5, 'cym']], null, 0.8),
    win: piece(144, [['G4/.5 C5/.5 E5/.5 G5/1 E5/.5 G5/1.5 r/.5 A5/.5 G5/.5 F5/.5 E5/.5 D5/.5 E5/.5 C5/2', 0.85, 'brass'],
      ['G4/.5 C5/.5 E5/.5 G5/1 E5/.5 G5/1.5 r/.5 A5/.5 G5/.5 F5/.5 E5/.5 D5/.5 E5/.5 C5/2', 0.6, 'reed'],
      ['r/5 A6/.5 G6/.5 F6/.5 E6/.5 D6/.5 E6/.5 C6/.5 C7/1.5', 0.8, 'xylo'],
      ['C3/.5 r/.5 G2/.5 r/.5 C3/.5 r/.5 G2/.5 r/.5 F2/.5 r/.5 C3/.5 r/.5 G2/.5 r/.5 G2/.5 B2/.5 C3/2', 0.9, 'bassoon', 0.7],
      ['r/.5 E4+G4+C5/.5 r/.5 E4+G4+C5/.5 r/.5 E4+G4+C5/.5 r/.5 E4+G4+C5/.5 r/.5 F4+A4+C5/.5 r/.5 F4+A4+C5/.5 r/.5 F4+G4+B4/.5 r/.5 F4+G4+B4/.5 C4+E4+G4+C5/2', 0.45, 'organ', 0.6],
      ['r/8 C4/2', 0.5, 'kick'], ['r/8 C4/2', 0.55, 'cym']], [8], 0.9),
    lose: piece(76, [['G4/1 Gb4/1 F4/1 E4/3w', 0.9, 'brass'], ['G3/1 Gb3/1 F3/1 E3/3w', 0.7, 'bassoon'], ['G3/1 Gb3/1 F3/1 E3/3w', 0.35]], null, 0.95),
    rally: piece(150, [['C4/.5 Db4/.5 D4/.5 Eb4/.5 E4/.5 F4/.5 F#4/.5 G4/.5 G#4/.5 A4/.5 Bb4/.5 B4/.5 C5+E5+G5/.4 r/1.6', 0.9],
      ['C4/.5 Db4/.5 D4/.5 Eb4/.5 E4/.5 F4/.5 F#4/.5 G4/.5 G#4/.5 A4/.5 Bb4/.5 B4/.5 C5+E5+G5/.4 r/1.6', 0.5, 'reed', 0.7],
      ['C3/1 C3/1 C3/1 C3/1 C3/1 C3/1 C2+C3/.4 r/1.6', 0.7], [rep('C3/.5', 12) + ' C3/.4 r/1.6', 0.8, 'pizz'],
      [rep('C4/.5', 12) + ' C4/.4 r/1.6', 0.35, 'snare'], ['r/6 C4/2', 0.5, 'cym'], ['r/6 C4/2', 0.5, 'kick']], [7, 7.5], 0.75),
    // SNEAK: an original tiptoe in A minor for full-count tension: pizzicato on the 8ths, bassoon on the floor,
    // a wood-block clock ticking. Plays once (~7 s); organ('stop') or any other cue cuts it.
    sneak: piece(132, [['A3/.5 r/.5 C4/.5 r/.5 E4/.5 r/.5 F4/.5 E4/.5 D#4/.5 r/.5 E4/.5 r/.5 C4/.5 r/.5 A3/1 ' +
      'A3/.5 r/.5 C4/.5 r/.5 E4/.5 r/.5 G#4/.5 A4/.5 B4/.5 r/.5 G#4/.5 r/.5 E4/.5 D4/.5 B3/.5 G#3/.5', 0.9, 'pizz'],
      [rep('A2/.5 r/1.5 E2/.5 r/1.5', 3) + ' E2/.5 r/1.5 E2/.5 r/.5 E2/.5 r/.5', 0.85, 'bassoon', 0.5],
      [rep('E6/1 B5/1', 8), 0.25, 'block'], ['r/12 B4/4', 0.25, 'reed']], null, 0.9),
    // IRIS: a short "ta-DAA!" sting for scene ends / the iris wipe
    iris: piece(150, [['G5/.125 A5/.125 B5/.125 C6/.125 D6/.125 E6/.125 F6/.125 G6/.125 r/.5 C7/1.75', 0.8, 'xylo'],
      ['r/1 G4+B4+D5/.25 r/.25 C5+E5+G5+C6/1.75', 0.85, 'brass'], ['r/1.5 C4+E4+G4+C5/1.75', 0.45],
      ['r/1 G2/.25 r/.25 C2/1.75', 0.9, 'bassoon'], ['r/1 C4/.25 r/2', 0.5, 'snare'], ['r/1.5 C4/1.75', 0.5, 'kick'], ['r/1.5 C4/1.75', 0.6, 'cym']]),
    menu: piece(172, [[MENU_MEL.join(' '), 0.8, 'reed', 0.82], [rep('r/4', 8) + ' ' + MENU_MEL.slice(8).join(' '), 0.55, 'xylo'],
      [MENU_BASS, 0.85, 'bassoon', 0.45], [MENU_PIZZ, 0.5, 'pizz'], [MENU_CH, 0.32, 'organ', 0.8],
      [rep('r/1 G5/1 r/1 C6/1', 8) + ' ' + rep('C6/.5 r/.5 G5/.5 r/.5', 16), 0.3, 'block']], null, 0.88),
    _unlock: piece(180, [['C5/.25 E5/.25 G5/.25 C6+E5+G5/1.25', 0.7], ['C6/.25 E6/.25 G6/.25 C7/1.25', 0.8, 'xylo'], ['r/.75 C3/1.25', 0.7, 'bassoon'], ['r/.75 C4/1', 0.4, 'cym']]),
    _levelUp: piece(170, [['G4/.25 C5/.25 E5/.25 G5/.5 E5/.25 C5+E5+G5+C6/1.5', 0.8, 'brass'], ['G5/.25 C6/.25 E6/.25 G6/.5 E6/.25 C7/1.5', 0.7, 'xylo'],
      ['r/1.5 C4+E4+G4/1.5', 0.45], ['r/1.5 C3/1.5', 0.7, 'bassoon'], ['r/1.5 C4/1.5', 0.3, 'kick'], ['r/1.5 C4/1.5', 0.5, 'cym']]),
  };
  function organNote(g, dest, t, m, dur, v, wob) {
    var c = g.ctx, f = mtof(m), osc = c.createOscillator(), gn = c.createGain();
    if (g.wave) { osc.setPeriodicWave(g.wave); osc.frequency.setValueAtTime(f / 2, t); }
    else { osc.type = 'triangle'; osc.frequency.setValueAtTime(f, t); }
    var end = sustainEnv(gn.gain, t, 0.006, v, dur, 0.05, wob);
    if (wob) lfoTo(g, t, dur, 5, [[osc.frequency, f * (g.wave ? 0.5 : 1) * 0.035]]);
    osc.connect(gn); gn.connect(dest); osc.start(t); osc.stop(end + 0.05);
  }
  // instruments: (g, dest {org, dry}, t, midi, dur, v, wob). Level trims keep the band balanced against the organ.
  var INST = {
    organ: function (g, d, t, m, dur, v, w) { organNote(g, d.org, t, m, dur, v, w); },
    reed: function (g, d, t, m, dur, v, w) { reedNote(g, d.dry, t, mtof(m), dur, v * 1.25, w, 2, 1.6, 0.9, 3800); },
    bassoon: function (g, d, t, m, dur, v, w) { reedNote(g, d.dry, t, mtof(m), dur, v * 1.7, w, 1, 2.2, 1.1, 1300); },
    brass: function (g, d, t, m, dur, v, w) { brassNote(g, d.dry, t, mtof(m), dur, v * 0.7, w); },
    pizz: function (g, d, t, m, dur, v) { pizzNote(g, d.dry, t, mtof(m), v * 1.6); },
    xylo: function (g, d, t, m, dur, v) { xyloNote(g, d.dry, t, mtof(m), v * 1.3); },
    block: function (g, d, t, m, dur, v) { woodblock(g, d.dry, t, mtof(m), v * 0.8); },
    kick: function (g, d, t, m, dur, v) { kick(g, d.dry, t, v * 4); },
    snare: function (g, d, t, m, dur, v) { snare(g, d.dry, t, v * 2); },
    cym: function (g, d, t, m, dur, v) { cymbal(g, d.dry, t, v * 1.2); },
  };
  function playEvent(g, P, ev, at, dest, gain) {
    var spb = 60 / P.bpm, dur = Math.max(0.05, ev.l * spb * (ev.lg || P.legato)), v = 0.15 * ev.v * (gain || 1), fn = INST[ev.inst] || INST.organ;
    for (var i = 0; i < ev.m.length; i++) fn(g, dest, at, ev.m[i], dur, v, ev.w);
    if (fn === INST.organ) noise(g, dest.org, { t: at, f: 2800, q: 0.8, a: 0.0003, d: 0.006, v: v * 0.6 }); // key click
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
    var now = g.ctx.currentTime;
    S.menu = { cue: mkCue(g, 0.4), t0: now + 0.12, i: 0, it: 0 };
    menuPump(g);
  }
  function menuPump(g) {
    var m = S.menu; if (!m) return;
    var P = PIECES.menu, spb = 60 / P.bpm, L = P.len * spb, now = g.ctx.currentTime;
    for (var guard = 0; guard < 128; guard++) {
      var ev = P.ev[m.i], at = m.t0 + m.it * L + ev.b * spb;
      if (at > now + 0.5) break;
      if (at > now - 0.02) playEvent(g, P, ev, at, m.cue);
      if (++m.i >= P.ev.length) { m.i = 0; m.it++; }
    }
  }
  function fadeOut(node, g, tc) {
    try { var now = g.ctx.currentTime; node.gain.cancelScheduledValues(now); node.gain.setValueAtTime(node.gain.value, now); node.gain.setTargetAtTime(0, now, tc); } catch (e) { /* ignore */ }
    later(function () { node.disconnect(); }, 1500);
  }
  // a cue = a pair of fader gains: organ voices go through the leslie chain, the pit band straight to the music bus
  function mkCue(g, fadeIn) {
    var c = g.ctx, now = c.currentTime, cue = { org: c.createGain(), dry: c.createGain() };
    if (fadeIn) [cue.org, cue.dry].forEach(function (n) { n.gain.setValueAtTime(0.0001, now); n.gain.linearRampToValueAtTime(1, now + fadeIn); });
    cue.org.connect(g.organIn); cue.dry.connect(g.organ);
    return cue;
  }
  function fadeCue(cue, g, tc) { fadeOut(cue.org, g, tc); fadeOut(cue.dry, g, tc); }
  function menuStop(g, tc) { if (S.menu) { fadeCue(S.menu.cue, g, tc || 0.12); S.menu = null; } }
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
    var fn = own(SFX, name), g = live(); if (!fn || !g || S.muted) return;
    opts = opts && typeof opts === 'object' ? opts : {};
    var now = g.ctx.currentTime;
    if (S.last[name] != null && now - S.last[name] < 0.025 && name !== 'crack') return; // de-dupe double fires
    S.last[name] = now;
    fn(g, now + 0.004 + clamp(+opts.when || 0, 0, 10), opts);
  }
  function organ(name) {
    var g = S.g;
    if (name === 'stop') { S.menuWanted = false; if (g) { menuStop(g, 0.15); if (S.cue) { fadeCue(S.cue, g, 0.08); S.cue = null; } } return; }
    if (name === 'menu') { S.menuWanted = true; if (live() && S.music && !S.cue) menuStart(g); return; }
    var P = own(PIECES, name); if (!P || name.charAt(0) === '_') return;
    S.menuWanted = false;
    g = live(); if (!g || !S.music || S.muted) return;
    menuStop(g, 0.08);
    if (S.cue) fadeCue(S.cue, g, 0.05);
    var cue = mkCue(g, 0); S.cue = cue;
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
    if (!S.music) { menuStop(g, 0.1); if (S.cue) { fadeCue(S.cue, g, 0.05); S.cue = null; } }
  }

  // ------------------------------------------------------------------ offline rendering (tests / tuning)
  // render(kind, name, opts, seconds) -> Promise<{peak, rms, seconds}> or null. kind: sfx | organ | cheer | groan | crowd
  // (for sfx, 'a+b' renders several layered at once)
  function render(kind, name, opts, secs) {
    var OAC = W.OfflineAudioContext || W.webkitOfflineAudioContext;
    if (!OAC) return Promise.resolve(null);
    secs = secs || 2; opts = opts || {};
    var sr = 44100, oc = new OAC(2, Math.ceil(sr * secs), sr), g = buildGraph(oc, true), t = 0.02;
    if (kind === 'sfx') String(name).split('+').forEach(function (n) { SFX[n](g, t, opts); }); // 'crack+kablam' layers
    else if (kind === 'organ') playPiece(g, PIECES[name], t, { org: g.organIn, dry: g.organ }, 1);
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
