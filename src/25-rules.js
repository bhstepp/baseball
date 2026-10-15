// 25-rules.js — count, outs, bases, scenarios, scoring, results and the daily share line. Owned by the rules agent.
// Runner advancement (deterministic except the double-play roll):
//   walk: forced runners only.  1B: R3 scores; R2 scores if the ball went to the outfield (play.dist >= 180) else
//   stops at 3rd; R1 to 2nd (to 3rd on a single to right, spray > 18 and dist >= 200, when 3rd is free).
//   2B: R2, R3 score; R1 scores if play.dist >= 290 else 3rd.  3B / HR: everybody scores.
//   OUT ground, <2 outs: R1 on → double play with chance .7 (ev >= 85) / .4; otherwise every runner moves up one
//   (R3 scores).  OUT fly, <2 outs: R3 tags and scores if dist > 250 (SF), R2 tags to 3rd if dist > 300.
//   line / pop outs: runners hold.  Every run on the final play counts (a walk-off slam is 4 runs).
// Derby rules (tour 'derby'/'distance', daily, endless): takes are free; any swing that is not a HR is an out.
BB.Rules = (function () {
  var U = BB.U;
  var EMO = { HR: '💥', IP: '⚾', F: '〰️', W: '✖️', FIRE: '🔥' };
  function content() { return BB.Content; }

  function dailyCfg(dayKey) {
    dayKey = dayKey || U.dayKey();
    var seed = U.hashStr('daily' + dayKey), r = U.rng(seed), C = content(), n = U.dayNumber(dayKey);
    var pitcher = U.pick(r, C.DAILY_POOL), park = U.pick(r, C.PARKS).id;
    return { mode: 'daily', dayKey: dayKey, day: n, title: 'Daily Derby #' + n, seed: seed, pitcher: pitcher, park: park, outs: 10,
      scenario: { kind: 'derby', need: 1, outs: 10, metric: 'hr', stars: [2, 4, 7], starText: ['2 HR', '4 HR', '7 HR'],
        goal: 'Same pitches for everyone today. 10 outs: anything but a homer is an out.' } };
  }
  function endlessScenario(outs) {
    return { kind: 'derby', need: 1, outs: outs, metric: 'hr', stars: [3, 6, 10], starText: ['3 HR', '6 HR', '10 HR'],
      goal: 'Endless Derby. ' + outs + ' outs: takes are free, anything but a homer is an out.' };
  }

  function create(mode, cfg) {
    cfg = cfg || {};
    var C = content();
    if (mode === 'daily' && !cfg.seed) cfg = dailyCfg(cfg.dayKey);
    var seed = cfg.seed != null ? cfg.seed >>> 0 : ((Date.now() ^ Math.floor(Math.random() * 4294967296)) >>> 0);
    var sc = mode === 'tour' ? cfg.scenario : mode === 'daily' ? cfg.scenario : endlessScenario(cfg.outs || 10);
    var derbyRules = mode !== 'tour' || sc.kind === 'derby' || sc.kind === 'distance';
    var park = C.getPark(cfg.park) || C.PARKS[seed % C.PARKS.length];
    var pitcher = C.getPitcher(cfg.pitcher || C.DERBY_PITCHER);
    var st = {
      mode: mode, cfg: cfg, sc: sc, kind: sc.kind, derbyRules: derbyRules, seed: seed,
      basePitcher: pitcher, pitcher: pitcher, park: park, title: cfg.title || (mode === 'derby' ? 'Endless Derby' : ''),
      day: mode === 'daily' ? (cfg.day || U.dayNumber(cfg.dayKey)) : null,
      balls: 0, strikes: 0, outs: 0, outsMax: sc.kind === 'hits' ? 0 : (sc.outs || 3),
      bases: [false, false, false], runs: 0, thrown: 0, pa: 0, level: 0,
      hr: 0, hrDist: 0, hits: 0, onbase: 0, startRunners: 0,
      streak: 0, bestStreak: 0, onFire: false, over: false, win: false, last: null, log: [], vc: 0,
      stats: { pitches: 0, swings: 0, contact: 0, hits: 0, hr: 0, k: 0, bb: 0, runs: 0, longest: 0, maxEV: 0, perfects: 0 },
    };
    if (sc.kind === 'inning') {
      st.outs = sc.startOuts || 0; st.outsMax = 3; st.bases = sc.bases.slice();
      st.balls = sc.count ? sc.count[0] : 0; st.strikes = sc.count ? sc.count[1] : 0;
      st.startRunners = st.bases.filter(Boolean).length;
    }
    var mainR = U.rng(seed);
    st._r = mainR;
    st.rng = function () { return st._r(); };
    // main uses swingRng(pitch) for BB.Bat.swing/play when present. Daily: depends only on (seed, pitch index).
    st.swingRng = function (pitch) {
      if (mode !== 'daily') return st.rng;
      var i = pitch && pitch.id != null ? pitch.id : st.thrown - 1;
      return U.rng((seed ^ 0x5bd1e995) ^ Math.imul(i + 1, 0x85EBCA6B));
    };
    return st;
  }

  function effPitcher(st) {
    if (st.mode !== 'derby') return st.basePitcher;
    // Batting Practice Bob gets competitive: a little faster and craftier with every homer.
    var b = st.basePitcher, l = Math.min(st.hr, 20), p = {};
    for (var k in b) p[k] = b[k];
    p.velo = Math.round(b.velo + l * 0.9);
    p.stuff = Math.min(0.8, b.stuff + l * 0.035);
    p.control = Math.max(0.78, b.control - l * 0.01);
    p.arsenal = l < 3 ? b.arsenal : l < 6 ? { FB: .7, CH: .15, CB: .15 } : l < 10 ? { FB: .55, CH: .15, CB: .15, SL: .15 } :
      { FB: .45, SL: .2, CB: .15, CH: .1, SP: .1 };
    st.level = l;
    return p;
  }

  function nextPitch(st) {
    if (st.over) return null;
    var i = st.thrown++;
    var ctx = { balls: st.derbyRules ? 0 : st.balls, strikes: st.derbyRules ? 0 : st.strikes, derby: st.derbyRules, id: i };
    var r;
    if (st.mode === 'daily') r = U.rng(st.seed ^ Math.imul(i + 1, 0x9E3779B1));
    else r = st._r;
    st.pitcher = effPitcher(st);
    var p = BB.Pitch.make(st.pitcher, ctx, r);
    p.id = i;
    if (st.mode === 'daily') st._r = st.swingRng(p);
    return p;
  }

  // ---------------------------------------------------------------- helpers
  function pick(st, arr) { return arr[(st.vc++) % arr.length]; }
  function countStr(st) { return st.balls + '-' + st.strikes; }
  function outsStr(st) {
    if (st.outsMax === 0) return pitchesLeft(st) + ' pitches left';
    var l = st.outsMax - st.outs;
    return st.derbyRules ? l + (l === 1 ? ' out left' : ' outs left') : st.outs + (st.outs === 1 ? ' out' : ' outs');
  }
  function pitchesLeft(st) { return st.kind === 'hits' ? Math.max(0, st.sc.pitches - st.stats.pitches) : null; }
  function ev(call, text, sub) { return { call: call, runs: 0, outs: 0, runnerMoves: [], text: text, sub: sub || '', over: false }; }
  function endPA(st) { st.balls = 0; st.strikes = 0; st.pa++; if (st.kind === 'hits') st.bases = [false, false, false]; }
  function hitStreak(st) { st.streak++; if (st.streak > st.bestStreak) st.bestStreak = st.streak; st.onFire = st.streak >= 3; }
  function coldStreak(st) { st.streak = 0; st.onFire = false; }
  function tracksRunners(st) { return st.kind === 'inning' || st.kind === 'onbase'; }

  // apply runner moves: clear origins first, then fill destinations; count runs and outs.
  function apply(st, e, moves) {
    var b = st.bases.slice();
    moves.forEach(function (m) { if (m.from >= 1) b[m.from - 1] = false; });
    moves.forEach(function (m) {
      if (m.to >= 1 && m.to <= 3) b[m.to - 1] = true;
      else if (m.to === 4) e.runs++;
      else if (m.to === -1) e.outs++;
    });
    e.runnerMoves = moves;
    st.lastCall = e.call;
    if (tracksRunners(st)) st.bases = b;
    if (st.kind !== 'hits') st.outs += e.outs;
    st.runs += e.runs; st.stats.runs += e.runs;
  }

  function measure(st) {
    switch (st.sc.metric) {
      case 'spare': return st.outsMax - st.outs;
      case 'runs': return st.runs;
      case 'hr': return st.hr;
      case 'hits': return st.hits;
      case 'onbase': return st.onbase;
      case 'dist': return Math.round(st.hrDist);
    }
    return 0;
  }
  function starsFor(st, win) {
    if (!win) return 0;
    var m = measure(st), s = st.sc.stars;
    // walk-offs with sc.xbh3: the 3rd star also needs the winning hit to go for extra bases
    var x3 = !st.sc.xbh3 || /^(2B|3B|HR)$/.test(st.lastCall || '');
    return 1 + (m >= s[1] ? 1 : 0) + (m >= s[2] && x3 ? 1 : 0);
  }
  function goalMet(st) {
    var sc = st.sc;
    if (sc.kind === 'inning') return st.runs >= sc.need;
    return measure(st) >= (sc.metric === 'hr' || sc.metric === 'dist' ? sc.stars[0] : sc.need);
  }

  // decide whether the game just ended; decorate the event
  function check(st, e) {
    var sc = st.sc, over = false, win = false, met = goalMet(st);
    if (sc.kind === 'inning' && sc.walkoff) {
      if (met) { over = true; win = true; } else if (st.outs >= 3) over = true;
    } else if (sc.kind === 'hits') {
      var left = pitchesLeft(st);
      if (met && measure(st) >= sc.stars[2]) over = true;
      else if (left === 0 || st.hits + left < sc.need) over = true;
      win = met;
    } else {
      if (st.mode === 'tour' && met && measure(st) >= sc.stars[2]) over = true;
      if (st.outs >= st.outsMax) over = true;
      win = met;
    }
    if (over) {
      st.over = true; st.win = win; e.over = true; e.win = win;
      if (win && sc.kind === 'inning' && sc.walkoff) {
        e.text = e.call === 'HR' ? (e.runs === 4 ? 'WALK-OFF SLAM!' : 'WALK-OFF HOMER!') : 'WALK-OFF!';
        e.sub = 'Final: ' + scoreStr(st);
      } else if (st.mode === 'tour') {
        e.sub = win ? 'Goal reached · ' + starsFor(st, true) + '★' : e.sub;
      }
    }
    st.last = e;
    return e;
  }
  function scoreStr(st) { return (st.sc.you + st.runs) + '–' + st.sc.them; }

  // ---------------------------------------------------------------- take / whiff
  function take(st, pitch) {
    st.stats.pitches++;
    var e;
    if (st.derbyRules) {
      e = ev(pitch.strike ? 'STRIKE' : 'BALL', pitch.strike ? 'TAKEN' : 'BALL', 'Takes are free · ' + outsStr(st));
      return check(st, e);
    }
    if (!pitch.strike) {
      st.balls++;
      if (st.balls >= 4) return walk(st);
      e = ev('BALL', pick(st, ['BALL', 'BALL', 'LOW', 'OUTSIDE', 'TOO HIGH']), 'Ball ' + st.balls + ' · ' + countStr(st));
    } else {
      st.strikes++;
      if (st.strikes >= 3) return strikeout(st, true);
      e = ev('STRIKE', pick(st, ['STEE-RIKE!', 'STRIKE!', 'CALLED STRIKE', 'PAINTED']), countStr(st) + ' count');
    }
    if (st.kind === 'hits') e.sub += ' · ' + outsStr(st);
    return check(st, e);
  }
  function walk(st) {
    var b = st.bases, moves = [];
    if (tracksRunners(st)) {
      if (b[0] && b[1] && b[2]) moves.push({ from: 3, to: 4 });
      if (b[0] && b[1]) moves.push({ from: 2, to: 3 });
      if (b[0]) moves.push({ from: 1, to: 2 });
    }
    moves.push({ from: 0, to: 1 });
    var e = ev('WALK', pick(st, ['BALL FOUR', 'TAKE YOUR BASE', 'WALKED']), '');
    apply(st, e, moves);
    e.sub = e.runs ? 'Walked in a run! ' + outsStr(st) : outsStr(st);
    st.onbase++; st.stats.bb++;
    endPA(st);
    return check(st, e);
  }
  function strikeout(st, looking) {
    var e = ev('K', looking ? pick(st, ['CAUGHT LOOKING', 'FROZEN', 'STRIKE THREE']) : pick(st, ['STRUCK OUT', 'WHIFF! K', 'SIT DOWN']), '');
    apply(st, e, [{ from: 0, to: -1 }]);
    e.sub = outsStr(st);
    st.stats.k++; coldStreak(st); endPA(st);
    return check(st, e);
  }
  function swingStats(st, swing, inPlay) {
    st.stats.pitches++; st.stats.swings++;
    if (inPlay) st.stats.contact++;
    if (swing) {
      if (swing.label === 'PERFECT') st.stats.perfects++;
      if (swing.ev > st.stats.maxEV) st.stats.maxEV = Math.round(swing.ev);
    }
  }
  function whiff(st, pitch, swing) {
    swingStats(st, swing, false);
    st.log.push({ k: 'W' });
    if (st.derbyRules) {
      var e = ev('K', pick(st, ['WHIFF', 'SWING & MISS', 'WHIFF']), '');
      apply(st, e, [{ from: 0, to: -1 }]);
      e.sub = 'No dinger · ' + outsStr(st);
      coldStreak(st);
      return check(st, e);
    }
    st.strikes++;
    if (st.strikes >= 3) return strikeout(st, false);
    var w = ev('STRIKE', pick(st, ['WHIFF', 'SWING & MISS', 'WHIFF', 'FANNED']), countStr(st) + ' count');
    if (st.kind === 'hits') w.sub += ' · ' + outsStr(st);
    return check(st, w);
  }

  // ---------------------------------------------------------------- balls in play
  var OUT_TEXT = { fly: ['CAN OF CORN', 'FLIED OUT', 'HAULED IN'], line: ['LINED OUT', 'ROBBED!', 'RIGHT AT HIM'],
    ground: ['GROUNDED OUT', 'ROUTINE GROUNDER', 'BOUNCED OUT'], pop: ['POPPED UP', 'SKY-HIGH POP', 'INFIELD POP'] };

  function inPlay(st, pitch, swing, play) {
    var t = play.type, d = play.dist || 0, e;
    swingStats(st, swing, true);
    st.log.push({ k: t === 'HR' ? 'HR' : t === 'FOUL' ? 'F' : 'IP', type: t, dist: Math.round(d) });
    if (t === 'FOUL') {
      if (st.derbyRules) {
        e = ev('FOUL', 'FOUL — OUT', '');
        apply(st, e, [{ from: 0, to: -1 }]);
        e.sub = 'Need it fair · ' + outsStr(st);
        coldStreak(st);
        return check(st, e);
      }
      if (st.strikes < 2) st.strikes++;
      e = ev('FOUL', pick(st, ['FOUL BALL', 'FOUL', 'STRAIGHT BACK', 'JUST FOUL']), countStr(st) + ' count');
      return check(st, e);
    }
    if (t === 'HR') {
      st.hr++; st.stats.hr++; st.hits++; st.stats.hits++; st.onbase++;
      st.hrDist += d;
      if (d > st.stats.longest) st.stats.longest = Math.round(d);
      var moves = [];
      if (tracksRunners(st)) for (var i = 3; i >= 1; i--) if (st.bases[i - 1]) moves.push({ from: i, to: 4 });
      moves.push({ from: 0, to: 4 });
      e = ev('HR', '', '');
      apply(st, e, moves);
      e.text = e.runs === 4 ? 'GRAND SLAM!' : d >= 450 ? 'MOONSHOT!' : d >= 420 ? pick(st, ['DINGER!', 'GONE!', 'TATER!']) :
        play.wall ? 'OFF THE POLE!' : pick(st, ['DINGER!', 'GONE!', 'OUTTA HERE!', 'SEE YA!']);
      e.sub = U.fmtInt(d) + ' ft' + (st.derbyRules ? ' · ' + st.hr + ' HR' : e.runs > 1 ? ' · ' + e.runs + ' runs score' : '');
      hitStreak(st); endPA(st);
      return check(st, e);
    }
    if (st.derbyRules) { // a non-homer swing is an out
      e = ev('OUT', t === 'OUT' ? pick(st, OUT_TEXT[play.outKind] || OUT_TEXT.fly) : pick(st, ['NOT ENOUGH', 'IN THE PARK', 'NO DICE']), '');
      apply(st, e, [{ from: 0, to: -1 }]);
      e.sub = (t !== 'OUT' && d > 330 ? 'Off the wall! ' : 'Need a homer · ') + outsStr(st);
      coldStreak(st);
      return check(st, e);
    }
    var b = tracksRunners(st) ? st.bases : [false, false, false], m = [], call = t, text, sp = play.spray || 0;
    if (t === '1B') {
      if (b[2]) m.push({ from: 3, to: 4 });
      var r2 = b[1] ? (d >= 180 ? 4 : 3) : 0;
      if (b[1]) m.push({ from: 2, to: r2 });
      if (b[0]) m.push({ from: 1, to: (sp > 18 && d >= 200 && r2 !== 3) ? 3 : 2 });
      m.push({ from: 0, to: 1 });
      text = (play.outKind === 'line' || play.ev >= 100) && d >= 150 ? 'FROZEN ROPE' : d < 140 ? pick(st, ['INFIELD HIT', 'LEGGED IT OUT']) :
        pick(st, ['SINGLE', 'BASE HIT', 'BLOOPER', 'SEEING-EYE SINGLE']);
    } else if (t === '2B') {
      if (b[2]) m.push({ from: 3, to: 4 });
      if (b[1]) m.push({ from: 2, to: 4 });
      if (b[0]) m.push({ from: 1, to: d >= 290 ? 4 : 3 });
      m.push({ from: 0, to: 2 });
      text = play.wall ? 'OFF THE WALL!' : pick(st, ['DOUBLE!', 'TWO-BAGGER', 'IN THE GAP!']);
    } else if (t === '3B') {
      for (var j = 3; j >= 1; j--) if (b[j - 1]) m.push({ from: j, to: 4 });
      m.push({ from: 0, to: 3 });
      text = 'TRIPLE!!';
    } else { // OUT
      var o = st.kind === 'hits' ? 2 : st.outs, k = play.outKind || 'fly';
      text = pick(st, OUT_TEXT[k] || OUT_TEXT.fly);
      if (k === 'ground' && b[0] && o < 2 && st.rng() < ((play.ev || 0) >= 85 ? 0.7 : 0.4)) {
        call = 'DP'; text = pick(st, ['DOUBLE PLAY', 'TWIN KILLING', '6-4-3!']);
        m.push({ from: 1, to: -1 });
        if (o === 0) { if (b[2]) m.push({ from: 3, to: 4 }); if (b[1]) m.push({ from: 2, to: 3 }); }
        m.push({ from: 0, to: -1 });
      } else if (k === 'ground' && o < 2) {
        if (b[2]) m.push({ from: 3, to: 4 });
        if (b[1]) m.push({ from: 2, to: 3 });
        if (b[0]) m.push({ from: 1, to: 2 });
        m.push({ from: 0, to: -1 });
        if (b[2]) text = 'RBI GROUNDOUT';
      } else if (k === 'fly' && o < 2) {
        var sf = b[2] && d > 250;
        if (sf) { m.push({ from: 3, to: 4 }); call = 'SF'; text = 'SAC FLY'; }
        if (b[1] && d > 300 && (!b[2] || sf)) m.push({ from: 2, to: 3 });
        m.push({ from: 0, to: -1 });
      } else m.push({ from: 0, to: -1 });
    }
    e = ev(call, text, '');
    apply(st, e, m);
    if (t === 'OUT') {
      coldStreak(st);
      e.sub = (e.runs ? e.runs + ' run' + (e.runs > 1 ? 's' : '') + ' score · ' : '') + outsStr(st);
    } else {
      st.hits++; st.stats.hits++; st.onbase++; hitStreak(st);
      e.sub = e.runs ? (e.runs === 1 ? 'A run scores!' : e.runs + ' runs score!') : (play.desc || outsStr(st));
    }
    endPA(st);
    return check(st, e);
  }

  // ---------------------------------------------------------------- hud / result
  function hud(st) {
    var sc = st.sc, f = U.fmtInt, k = sc.kind, inning, score, progress;
    if (st.mode === 'daily') { inning = 'DAILY #' + st.day; score = st.hr + ' HR'; progress = f(st.hrDist) + ' ft'; }
    else if (st.mode === 'derby') { inning = 'DERBY'; score = st.hr + ' HR'; progress = f(st.hrDist) + ' ft'; }
    else if (k === 'inning') {
      inning = sc.half + ' ' + sc.inning; score = scoreStr(st);
      progress = sc.walkoff ? st.runs + ' / ' + sc.need + ' R' : st.runs + ' R · need ' + sc.need;
    } else if (k === 'derby') { inning = 'DERBY'; score = st.hr + ' HR'; progress = st.hr + ' / ' + sc.need + ' HR'; }
    else if (k === 'distance') { inning = 'LONG BALL'; score = f(st.hrDist) + ' FT'; progress = f(st.hrDist) + ' / ' + f(sc.need) + ' ft'; }
    else if (k === 'hits') { inning = 'HITS'; score = st.hits + ' H'; progress = st.hits + ' / ' + sc.need + ' H · ' + pitchesLeft(st) + ' left'; }
    else { inning = 'ON BASE'; score = st.onbase + ' OB'; progress = st.onbase + ' / ' + sc.need; }
    return {
      balls: st.balls, strikes: st.strikes, outs: st.outs, outsMax: st.outsMax, bases: st.bases.slice(),
      inning: inning, score: score, goal: sc.goal, progress: progress, streak: st.streak, onFire: st.onFire,
      mode: st.mode, kind: k, derby: st.derbyRules, title: st.title, hr: st.hr, dist: Math.round(st.hrDist),
      pitchesLeft: pitchesLeft(st), outsLeft: st.outsMax ? st.outsMax - st.outs : null,
      stars: starsFor(st, goalMet(st)), level: st.level,
    };
  }

  function headline(st) {
    var sc = st.sc, k = sc.kind, last = st.last || {}, s = starsFor(st, st.win);
    if (st.mode !== 'tour') {
      var h = st.hr;
      return h === 0 ? 'POWER OUTAGE' : h <= 2 ? 'ON THE BOARD' : h <= 5 ? 'LONG BALL' : h <= 9 ? 'DINGER KING' : 'LEGENDARY';
    }
    if (st.win) {
      if (k === 'inning' && sc.walkoff) return last.text || 'WALK-OFF!';
      if (s === 3) return pick(st, ['PERFECT DAY', 'HALL OF FAMER', 'STANDING OVATION']);
      return k === 'derby' || k === 'distance' ? 'DINGER CHAMP' : k === 'inning' ? 'RALLY!' : 'BALLGAME!';
    }
    var close = k === 'inning' ? st.runs >= sc.need - 1 : k === 'distance' ? st.hrDist >= sc.need * 0.75 : measure(st) >= sc.need - 1;
    if (close) return pick(st, ['SO CLOSE', 'JUST MISSED', 'NEXT TIME']);
    return { inning: 'STRANDED', derby: 'POWER OUTAGE', distance: 'WARNING TRACK', hits: 'COLD BATS', onbase: 'SAT DOWN' }[k] || 'GAME OVER';
  }

  function result(st) {
    var sc = st.sc, f = U.fmtInt, k = sc.kind, win = !!st.win, stars = starsFor(st, win), score, label;
    if (st.mode !== 'tour' || k === 'derby') { score = st.hr; label = st.hr + ' HR · ' + f(st.hrDist) + ' ft'; }
    else if (k === 'inning') { score = st.runs; label = (win ? 'WON ' : 'LOST ') + scoreStr(st) + ' · ' + st.runs + ' R'; }
    else if (k === 'distance') { score = Math.round(st.hrDist); label = f(st.hrDist) + ' ft · ' + st.hr + ' HR'; }
    else if (k === 'hits') { score = st.hits; label = st.hits + ' hits in ' + st.stats.pitches + ' pitches'; }
    else { score = st.onbase; label = 'On base ' + st.onbase + 'x'; }
    var stats = {};
    for (var key in st.stats) stats[key] = st.stats[key];
    stats.onbase = st.onbase; stats.hrDist = Math.round(st.hrDist); stats.bestStreak = st.bestStreak;
    stats.lob = st.bases.filter(Boolean).length;
    var r = { mode: st.mode, win: win, stars: stars, score: score, scoreLabel: label, headline: headline(st), stats: stats,
      tiebreak: Math.round(st.hrDist), share: null, log: st.log.slice(), day: st.day, dayKey: st.cfg.dayKey || null,
      gameId: st.cfg.id || null };
    if (st.mode === 'daily') r.share = shareText(st);
    return r;
  }

  function shareText(st) {
    var sy = st.log.map(function (l) { return EMO[l.k]; }), rows = [], MAX = 30;
    var cut = sy.length > MAX;
    if (cut) sy = sy.slice(0, MAX - 1).concat(['…']);
    for (var i = 0; i < sy.length; i += 10) rows.push(sy.slice(i, i + 10).join(''));
    var tail = st.hr + ' HR · ' + U.fmtInt(st.hrDist) + ' ft' + (st.bestStreak >= 2 ? ' · ' + EMO.FIRE + st.bestStreak : '');
    return BB.TITLE + ' · Daily #' + st.day + '\n' + (rows.length ? rows.join('\n') : '—') + '\n' + tail;
  }

  return {
    create: create, dailyCfg: dailyCfg, nextPitch: nextPitch, take: take, whiff: whiff, inPlay: inPlay, hud: hud, result: result,
    isOver: function (st) { return !!st.over; },
    LEGEND: { HR: EMO.HR + ' home run', IP: EMO.IP + ' in play, no homer', F: EMO.F + ' foul', W: EMO.W + ' whiff' },
  };
})();
