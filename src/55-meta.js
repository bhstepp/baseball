// 55-meta.js — the retention layer: bats, ink sets, the 72-card album, packs, coins/XP/levels, the Scorebook
// (achievements + lifetime stats), Barnstorm Tour progress, Daily Derby streaks and the Endless Derby best.
// Owned by the meta agent. Persists through BB.Save. Pure logic: no DOM here (BB.UI draws all of it).
(function () {
  var U = BB.U;
  function S() { return BB.Save.get(); }
  function commit() { BB.Save.commit(); }
  function today() { return U.dayKey(); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function prevDay(key) {
    var p = key.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]) - 86400000);
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function inksetById(id) {
    for (var i = 0; i < BB.INKSETS.length; i++) if (BB.INKSETS[i].id === id) return BB.INKSETS[i];
    return null;
  }

  // ======================================================================= BATS
  // timing multiplies every timing window, power multiplies exit velocity (0.9-1.12), lift adds launch degrees.
  // look: hints for BB.CardArt.drawBat (wood tone, tape ink slot, flourish).
  var BATS = [
    { id: 'b_hickory', name: 'Old Hickory', timing: 1.0, power: 1.0, lift: 0, unlock: { kind: 'free' },
      desc: 'Grandpa\'s bat. Honest wood, honest swings.', look: { wood: 'mid', tape: 'a', mark: 'none' } },
    { id: 'b_slap', name: 'Slap Stick', timing: 1.25, power: 0.92, lift: -2, unlock: { kind: 'level', n: 2 },
      desc: 'Forgiving timing, gentle pop. Singles all day.', look: { wood: 'light', tape: 'c', mark: 'stripes' } },
    { id: 'b_twig', name: 'The Twig', timing: 1.4, power: 0.9, lift: -4, unlock: { kind: 'stat', key: 'hits', n: 40, label: 'lifetime hits' },
      desc: 'Light as a pencil. You can\'t miss — you just can\'t lift it.', look: { wood: 'light', tape: 'b', mark: 'thin' } },
    { id: 'b_lumber', name: 'The Lumberjack', timing: 0.8, power: 1.12, lift: 2, unlock: { kind: 'level', n: 5 },
      desc: 'A felled oak with a handle. Tiny window, enormous thump.', look: { wood: 'dark', tape: 'b', mark: 'plaid' } },
    { id: 'b_moon', name: 'Moon Shot', timing: 0.95, power: 1.03, lift: 7, unlock: { kind: 'tour', chapter: 1 },
      desc: 'Uppercut built in. Everything goes up. Some of it comes down.', look: { wood: 'dark', tape: 'c', mark: 'moon' } },
    { id: 'b_fungo', name: 'The Fungo', timing: 1.15, power: 0.95, lift: 9, unlock: { kind: 'ach', id: 'daily3' },
      desc: 'Borrowed from the coach. Sky-high pop-ups and the odd miracle.', look: { wood: 'light', tape: 'a', mark: 'thin' } },
    { id: 'b_corked', name: 'Corked', timing: 1.05, power: 1.1, lift: 3, unlock: { kind: 'coins', n: 1200 },
      desc: 'Perfectly regulation. Please do not look inside. Or shake it.', look: { wood: 'mid', tape: 'b', mark: 'cork' } },
    { id: 'b_riso', name: 'Riso Roller', timing: 1.15, power: 1.04, lift: 3, unlock: { kind: 'set', team: 1 },
      desc: 'Inked on three drums. Leaves a mark on every ball.', look: { wood: 'ink', tape: 'c', mark: 'dots' } },
    { id: 'b_barber', name: 'Barber Pole', timing: 1.08, power: 1.06, lift: 1, unlock: { kind: 'set', team: 3 },
      desc: 'Candy-striped and smooth. A little of everything.', look: { wood: 'light', tape: 'b', mark: 'stripes' } },
    { id: 'b_smudge', name: 'The Smudge', timing: 1.0, power: 1.09, lift: 5, unlock: { kind: 'ach', id: 'misprint' },
      desc: 'Came off the press crooked. Hits crooked, too — crooked far.', look: { wood: 'ink', tape: 'b', mark: 'smudge' } },
    { id: 'b_golden', name: 'Golden Ash', timing: 1.12, power: 1.08, lift: 2, unlock: { kind: 'set', team: 5 },
      desc: 'Wider sweet spot, real pop. The collector\'s bat.', look: { wood: 'gold', tape: 'a', mark: 'star' } },
  ];
  var BAT_BY = {}; BATS.forEach(function (b) { BAT_BY[b.id] = b; });

  // ======================================================================= INK SETS
  // 'park' = no fixed press: every park prints in its own inks.
  var INK_RULES = {
    park: { kind: 'free' },
    classic: { kind: 'free' },
    lawn: { kind: 'level', n: 3 },
    harbor: { kind: 'level', n: 7 },
    dusk: { kind: 'set', team: 0 },
    grape: { kind: 'set', team: 2 },
    ledger: { kind: 'set', team: 4 },
  };
  var INK_DESC = {
    park: 'Each ballpark prints in its own house inks.',
    classic: 'Blue, fluorescent pink, yellow. The original run.',
    dusk: 'Federal blue and orange for the night game.',
    lawn: 'Green grass, pink seats, summer.',
    grape: 'Purple and orange. Tastes like a doubleheader.',
    harbor: 'Teal and red, salt in the air.',
    ledger: 'Black and red. Strictly box score.',
  };
  function inkRule(id) { return INK_RULES[id] || { kind: 'level', n: 10 }; }

  // ======================================================================= TEAMS & CARDS
  var FALLBACK_TOWNS = ['Mudville', 'Cedar Falls', 'Port Juniper', 'Ironton', 'Dry Gulch', 'Big Prairie'];
  var MASCOT_BY_SKYLINE = { barns: 'Barnstormers', city: 'Pigeons', pines: 'Night Owls', harbor: 'Gulls', desert: 'Jackrabbits', none: 'Comets' };
  var MASCOTS = ['Mudcats', 'Comets', 'Gulls', 'Foundrymen', 'Jackrabbits', 'Prairie Dogs', 'Night Owls', 'Pigeons'];

  function buildTeams() {
    var parks = (BB.Content && BB.Content.PARKS) || [];
    var used = {}, teams = [];
    for (var t = 0; t < 6; t++) {
      var park = parks[t] || null;
      var town = (park && (park.town || park.name)) || FALLBACK_TOWNS[t];
      var mascot = park && park.features && MASCOT_BY_SKYLINE[park.features.skyline];
      if (!mascot || used[mascot]) { mascot = null; for (var m = 0; m < MASCOTS.length; m++) if (!used[MASCOTS[(t + m) % MASCOTS.length]]) { mascot = MASCOTS[(t + m) % MASCOTS.length]; break; } }
      used[mascot] = true;
      var ink = (park && park.inkset && inksetById(park.inkset)) ? park.inkset : BB.INKSETS[t % BB.INKSETS.length].id;
      teams.push({ idx: t, id: park ? park.id : 'team' + (t + 1), park: park ? park.id : null, town: town, mascot: mascot,
        name: town + ' ' + mascot, short: town.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase(), inkset: ink,
        colorSlot: ['a', 'b', 'c', 'a', 'b', 'c'][t] });
    }
    return teams;
  }

  var FIRST = ['Abner', 'Buck', 'Cletus', 'Dutch', 'Eddie', 'Ferris', 'Gus', 'Hap', 'Iggy', 'Jasper', 'Lefty', 'Moose',
    'Nap', 'Ollie', 'Pee Wee', 'Quincy', 'Rube', 'Smoky', 'Tad', 'Virgil', 'Wally', 'Zeke', 'Boots', 'Cotton', 'Dizzy',
    'Spud', 'Doc', 'Pops', 'Skeeter', 'Vern', 'Hoyt', 'Ike', 'Bix', 'Otis', 'Mort', 'Clem', 'Arlo', 'Rollie', 'Sal', 'Hubie',
    'Junior', 'Red', 'Slim', 'Chick', 'Augie', 'Benny', 'Dewey', 'Elmer'];
  var LAST_A = ['Grub', 'Bram', 'Fitz', 'Kettle', 'Dunk', 'Wim', 'Pot', 'Snod', 'Hal', 'Quill', 'Barn', 'Tumble', 'Mar',
    'Pick', 'Wob', 'Crum', 'Dob', 'Fen', 'Gar', 'Hob', 'Lark', 'Mud', 'Nib', 'Pud', 'Rook', 'Sprock', 'Tib', 'Wex', 'Zub',
    'Bunt', 'Cob', 'Dill', 'Plum', 'Ash', 'Thim', 'Gub'];
  var LAST_B = ['bottom', 'worth', 'ley', 'ski', 'son', 'berry', 'field', 'wick', 'ham', 'strom', 'ford', 'man', 'well',
    'ins', 'ner', 'stead', 'by', 'kins', 'hollow', 'smith', 'ows', 'ett'];
  var NICKS = ['Two-Bag', 'The Hatchet', 'Specs', 'Ducky', 'Big Train', 'Noodles', 'Biscuit', 'Hambone', 'Peaches',
    'The Rake', 'Choo-Choo', 'Sugar', 'Pickles', 'Turnip', 'The Count', 'Goose', 'Popcorn', 'Flapjack', 'Tater', 'Mittens',
    'Smudge', 'Hot Corner', 'Lefty Jr.', 'Boom-Boom'];
  var FLAVOR = [
    'Once hit a triple off a bunt.', 'Eats sunflower seeds, shells and all.', 'Led the league in borrowed hot dogs.',
    'Can read a curveball\'s mind.', 'Swears the moon is a changeup.', 'Keeps a lucky pickle in his back pocket.',
    'Batted .400 in his dreams, .260 awake.', 'Has never once worn matching socks.',
    'Signs autographs in pencil, just in case.', 'Struck out the side and the side\'s mascot.',
    'Warms up by arguing with the umpire.', 'Owns a parakeet that calls balls and strikes.',
    'Hit one so far it got its own zip code.', 'Drinks coffee out of his glove.',
    'Throws a pitch the scouts call "the rumor".', 'Ran through a wall. The wall apologized.',
    'Grew up shagging flies in a cornfield.', 'Thinks the infield fly rule is a conspiracy.',
    'Rounds third like he\'s late for supper.', 'Collects ink smudges from old programs.',
    'Got his nickname from a misunderstanding.', 'Hums the organ tune between pitches.',
    'Once caught a fly ball in his cap.', 'Never met a fastball he didn\'t like.', 'Bunts for fun. Nobody knows why.',
    'His glove is older than the ballpark.', 'Taught the bat boy everything he knows.', 'Tips his cap to pigeons.',
    'Has a 12-step plan to steal home.', 'Breakfast: pancakes and pine tar.', 'Printed slightly off-center since birth.',
    'Hit for the cycle. On a unicycle.', 'Spits in his glove for luck, then apologizes to it.',
    'Can hear a slider coming.', 'Measures home runs in hot-dog lengths.', 'Wears the same cap since Little League.',
  ];
  var POSITIONS = ['P', 'P', 'P', 'C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF', 'DH'];
  var POS_NAME = { P: 'Pitcher', C: 'Catcher', '1B': 'First Base', '2B': 'Second Base', SS: 'Shortstop', '3B': 'Third Base',
    LF: 'Left Field', CF: 'Center Field', RF: 'Right Field', DH: 'Designated Hitter' };

  function buildCards(teams) {
    var cards = [], names = {};
    teams.forEach(function (team, t) {
      var rng = U.rng(U.hashStr('halftone-team-' + t));
      // rarity layout: 2 foil, 3 rare, 7 common, shuffled per team
      var rar = ['foil', 'foil', 'rare', 'rare', 'rare', 'common', 'common', 'common', 'common', 'common', 'common', 'common'];
      for (var i = rar.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var tmp = rar[i]; rar[i] = rar[j]; rar[j] = tmp; }
      var numbers = {};
      for (var k = 0; k < 12; k++) {
        var id = 'c' + (t + 1) + '-' + pad2(k + 1);
        var r = U.rng(U.hashStr('halftone-card-' + id));
        var name, guard = 0;
        do {
          var last = U.pick(r, LAST_A) + U.pick(r, LAST_B);
          if (r() < 0.12) last = 'Mc' + last;
          name = U.pick(r, FIRST) + ' ' + last;
        } while (names[name] && ++guard < 50);
        names[name] = true;
        var num; do { num = 1 + Math.floor(r() * 69); } while (numbers[num]); numbers[num] = true;
        var pos = POSITIONS[k];
        var stat;
        if (pos === 'P') {
          var w = 6 + Math.floor(r() * 16), l = 3 + Math.floor(r() * 12);
          stat = w + '-' + l + ' · ' + (2 + r() * 2.6).toFixed(2) + ' ERA · ' + (80 + Math.floor(r() * 180)) + ' K';
        } else {
          var hr = Math.floor(2 + r() * r() * 46), avg = (0.215 + r() * 0.13).toFixed(3).slice(1);
          stat = avg + ' AVG · ' + hr + ' HR · ' + (hr * 2 + 20 + Math.floor(r() * 50)) + ' RBI';
        }
        var nick = r() < 0.3 ? U.pick(r, NICKS) : null;
        cards.push({
          id: id, no: t * 12 + k + 1, name: name, nick: nick, pos: pos, posName: POS_NAME[pos],
          team: team.name, teamIdx: t, teamShort: team.short, teamColorSlot: team.colorSlot, number: num,
          rarity: rar[k], seed: U.hashStr(id), inkset: team.inkset, stat: stat, flavor: U.pick(r, FLAVOR),
        });
      }
    });
    return cards;
  }

  var TEAMS = buildTeams();
  var CARDS = buildCards(TEAMS);
  var CARD_BY = {}; CARDS.forEach(function (c) { CARD_BY[c.id] = c; });
  // Team set completion rewards (index = team)
  var SET_REWARDS = [
    { kind: 'inkset', id: 'dusk' }, { kind: 'bat', id: 'b_riso' }, { kind: 'inkset', id: 'grape' },
    { kind: 'bat', id: 'b_barber' }, { kind: 'inkset', id: 'ledger' }, { kind: 'bat', id: 'b_golden' },
  ];

  // Packs
  var PACK = {
    cost: 100, size: 3, guaranteeEvery: 3,
    odds: { common: 0.72, rare: 0.21, foil: 0.07 }, misprint: 0.025,
    newBias: 0.5,                         // chance a card is drawn from the ones you don't own yet (of that rarity)
    refund: { common: 10, rare: 30, foil: 60, misprint: 120 },
  };

  // ======================================================================= ACHIEVEMENTS (Scorebook stamps)
  var ACH = [
    { id: 'first_hit', name: 'Ink on the Bat', desc: 'Get your first hit.', mark: '1B' },
    { id: 'first_hr', name: 'Dinger Debut', desc: 'Hit your first home run.', mark: 'HR' },
    { id: 'moonshot', name: 'Moonshot', desc: 'Hit a home run 450+ ft.', mark: '450' },
    { id: 'tape', name: 'Tape Measure', desc: 'Hit a home run 500+ ft.', mark: '500' },
    { id: 'rope', name: 'Frozen Rope', desc: 'Smoke a 110+ mph line drive.', mark: '110' },
    { id: 'patient', name: 'Patient Eye', desc: 'Draw a walk.', mark: 'BB' },
    { id: 'fullcount', name: 'Full-Count Hero', desc: 'Get a hit on a 3-2 count.', mark: '3-2' },
    { id: 'cycle', name: 'Hit for the Cycle', desc: 'Single, double, triple and homer in one game.', mark: 'CYC' },
    { id: 'sweet', name: 'Sweet Spot', desc: 'Time a swing PERFECT.', mark: '!' },
    { id: 'sommelier', name: 'Barrel Sommelier', desc: '5 PERFECT swings in one game.', mark: '5!' },
    { id: 'onfire', name: 'On Fire', desc: 'Three hits in a row.', mark: '3H' },
    { id: 'inferno', name: 'Five-Alarm', desc: 'Five hits in a row.', mark: '5H' },
    { id: 'slam', name: 'Grand Slam', desc: 'Homer with the bases loaded.', mark: '4R' },
    { id: 'walkoff', name: 'Walk-Off', desc: 'Win a game with your final swing.', mark: 'W/O' },
    { id: 'b2b', name: 'Back-to-Back Jacks', desc: 'Two home runs in a row.', mark: '2X' },
    { id: 'hattrick', name: 'Hat Trick', desc: 'Three homers in one game.', mark: '3HR' },
    { id: 'chasehr', name: 'Bad-Ball Bandit', desc: 'Homer on a pitch outside the zone.', mark: '?!' },
    { id: 'oppo', name: 'Oppo Taco', desc: 'Homer to the opposite field.', mark: 'OPP' },
    { id: 'sombrero', name: 'Golden Sombrero', desc: 'Strike out four times in one game. Oops.', mark: '4K' },
    { id: 'derby10', name: 'Derby Darling', desc: '10 homers in one Endless Derby.', mark: '10' },
    { id: 'derby20', name: 'Twenty Big Ones', desc: '20 homers in one Endless Derby.', mark: '20' },
    { id: 'daily1', name: 'Morning Edition', desc: 'Play your first Daily Derby.', mark: 'D1' },
    { id: 'daily3', name: 'Three-Day Run', desc: 'Daily Derby streak of 3 days.', mark: 'D3' },
    { id: 'daily7', name: 'Weekly Circulation', desc: 'Daily Derby streak of 7 days.', mark: 'D7' },
    { id: 'daily30', name: 'Monthly Subscriber', desc: 'Daily Derby streak of 30 days.', mark: 'D30' },
    { id: 'gold', name: 'Gold Stars', desc: 'Earn 3 stars on a tour game.', mark: '★★★' },
    { id: 'giant', name: 'Giant Killer', desc: 'Beat a boss pitcher.', mark: 'BOSS' },
    { id: 'sweep', name: 'Back Issue', desc: 'Win all five games of an issue.', mark: '5/5' },
    { id: 'collected', name: 'Collected Edition', desc: 'Beat all six bosses.', mark: '6/6' },
    { id: 'stars45', name: 'Star Chaser', desc: 'Collect 45 tour stars.', mark: '45★' },
    { id: 'firstpack', name: 'Fresh Pack Smell', desc: 'Open your first card pack.', mark: 'PK' },
    { id: 'foil', name: 'Shiny!', desc: 'Pull a foil card.', mark: 'FL' },
    { id: 'misprint', name: 'Misprint!', desc: 'Pull an ultra-rare misprint.', mark: 'ERR' },
    { id: 'set', name: 'Complete Set', desc: 'Complete a team set.', mark: 'SET' },
    { id: 'half', name: 'Halfway Album', desc: 'Own 36 different cards.', mark: '36' },
    { id: 'full', name: 'Full Album', desc: 'Own all 72 cards.', mark: '72' },
    { id: 'century', name: 'Century', desc: '100 lifetime hits.', mark: '100' },
    { id: 'level10', name: 'Double Digits', desc: 'Reach level 10.', mark: 'L10' },
    { id: 'changeup', name: 'Change of Lumber', desc: 'Equip a different bat.', mark: 'BAT' },
    { id: 'freshink', name: 'Fresh Ink', desc: 'Load a different press.', mark: 'INK' },
  ];
  var ACH_BY = {}; ACH.forEach(function (a) { ACH_BY[a.id] = a; });
  var ACH_COINS = 25;

  // ======================================================================= levels
  var MAX_LEVEL = 40, LEVEL_COINS = 60;
  function xpNeed(level) { return 100 + 50 * (level - 1); }      // xp from `level` to `level + 1`
  function levelInfo(xp) {
    if (xp == null) xp = S().xp;
    var L = 1, rest = xp;
    while (L < MAX_LEVEL && rest >= xpNeed(L)) { rest -= xpNeed(L); L++; }
    var need = L >= MAX_LEVEL ? 1 : xpNeed(L);
    return { level: L, into: rest, need: need, frac: L >= MAX_LEVEL ? 1 : rest / need, xp: xp };
  }

  // ======================================================================= tour helpers
  function TOUR() { return (BB.Content && BB.Content.TOUR) || []; }
  function gameWon(id) { return !!S().tour.won[id]; }
  function chapterUnlocked(i) {
    if (i === 0) return true;
    var prev = TOUR()[i - 1];
    if (!prev) return false;
    var boss = prev.games[prev.games.length - 1];
    return !!boss && gameWon(boss.id);
  }
  function locate(game) {
    var T = TOUR(), id = game && (game.id || game);
    for (var i = 0; i < T.length; i++) for (var k = 0; k < T[i].games.length; k++) if (T[i].games[k].id === id) return { ch: i, k: k };
    return null;
  }
  function gameUnlocked(game) {
    var at = locate(game); if (!at) return false;
    if (!chapterUnlocked(at.ch)) return false;
    return at.k === 0 || gameWon(TOUR()[at.ch].games[at.k - 1].id);
  }
  function bossBeaten(ch) {
    var c = TOUR()[ch]; if (!c) return false;
    return gameWon(c.games[c.games.length - 1].id);
  }
  function tourStarsTotal() { var s = S().tour.stars, n = 0; for (var k in s) n += s[k] || 0; return n; }

  // ======================================================================= conditions
  function condMet(c) {
    if (!c) return true;
    var d = S();
    switch (c.kind) {
      case 'free': return true;
      case 'level': return levelInfo().level >= c.n;
      case 'tour': return bossBeaten(c.chapter);
      case 'set': return teamComplete(c.team);
      case 'ach': return !!d.ach[c.id];
      case 'stat': return (d.stats[c.key] || 0) >= c.n;
      case 'coins': return false; // must be bought
    }
    return false;
  }
  function condText(c) {
    if (!c) return '';
    switch (c.kind) {
      case 'free': return 'Free';
      case 'level': return 'Reach level ' + c.n;
      case 'tour': var ch = TOUR()[c.chapter]; return 'Beat the Issue ' + (c.chapter + 1) + ' boss' + (ch && ch.title ? ' (' + ch.title + ')' : '');
      case 'set': return 'Complete the ' + (TEAMS[c.team] ? TEAMS[c.team].name : 'team') + ' card set';
      case 'ach': return 'Earn the "' + (ACH_BY[c.id] ? ACH_BY[c.id].name : c.id) + '" stamp';
      case 'stat': return 'Get ' + c.n + ' ' + (c.label || c.key) + ' (' + Math.min(c.n, S().stats[c.key] || 0) + '/' + c.n + ')';
      case 'coins': return 'Buy for ' + U.fmtInt(c.n) + ' coins';
    }
    return '';
  }
  function batUnlocked(id) { var b = BAT_BY[id]; return !!b && (!!S().bought[id] || condMet(b.unlock)); }
  function inksetUnlocked(id) { return (id === 'park' || !!inksetById(id)) && (!!S().bought[id] || condMet(inkRule(id))); }

  function snapshotUnlocks() {
    var o = {};
    BATS.forEach(function (b) { if (batUnlocked(b.id)) o['bat:' + b.id] = true; });
    BB.INKSETS.forEach(function (s) { if (inksetUnlocked(s.id)) o['inkset:' + s.id] = true; });
    TOUR().forEach(function (c, i) { if (chapterUnlocked(i)) o['chapter:' + i] = true; });
    return o;
  }
  function diffUnlocks(before) {
    var after = snapshotUnlocks(), out = [];
    for (var k in after) if (!before[k]) {
      var p = k.split(':'), kind = p[0], id = p[1], name = id;
      if (kind === 'bat') name = BAT_BY[id].name;
      else if (kind === 'inkset') name = (inksetById(id) || {}).name + ' inks';
      else if (kind === 'chapter') { var ch = TOUR()[+id]; name = 'Issue ' + (+id + 1) + (ch && ch.title ? ': ' + ch.title : ''); }
      out.push({ kind: kind, id: kind === 'chapter' ? +id : id, name: name });
    }
    return out;
  }

  // ======================================================================= album
  function owned(id) { return S().cards[id] || 0; }
  function teamComplete(t) {
    for (var k = 0; k < 12; k++) if (!owned('c' + (t + 1) + '-' + pad2(k + 1))) return false;
    return true;
  }
  function albumStats() {
    var d = S(), n = 0, m = 0, byTeam = TEAMS.map(function () { return 0; });
    CARDS.forEach(function (c) { if (d.cards[c.id]) { n++; byTeam[c.teamIdx]++; } if (d.misprints[c.id]) m++; });
    return { owned: n, total: CARDS.length, misprints: m, byTeam: byTeam, sets: TEAMS.filter(function (t) { return teamComplete(t.idx); }).length };
  }

  // ======================================================================= awarding
  var listeners = [];
  var cur = null;            // the game in progress (per-game counters)
  function newCur(mode, cfg) {
    return { mode: mode || null, cfg: cfg || null, events: 0, hits: 0, hr: 0, k: 0, perfects: 0, streak: 0,
      types: {}, balls: 0, strikes: 0, lastWasHR: false, earned: [], achCoins: 0, longest: 0, maxEV: 0, walkoff: false };
  }
  function award(id, into) {
    var d = S();
    if (d.ach[id] || !ACH_BY[id]) return null;
    d.ach[id] = Date.now();
    d.coins += ACH_COINS; d.stats.coinsEarned += ACH_COINS;
    var a = { id: id, name: ACH_BY[id].name, desc: ACH_BY[id].desc, mark: ACH_BY[id].mark, coins: ACH_COINS };
    if (cur) { cur.earned.push(a); cur.achCoins += ACH_COINS; }
    if (into) into.push(a);
    listeners.forEach(function (fn) { try { fn(a); } catch (e) {} });
    return a;
  }
  function checkCollection(out) {
    var a = albumStats();
    if (a.owned >= 36) award('half', out);
    if (a.owned >= CARDS.length) award('full', out);
    if (a.sets > 0) award('set', out);
    return out;
  }
  function checkLevel(out) { if (levelInfo().level >= 10) award('level10', out); return out; }
  function checkStats(out) { if (S().stats.hits >= 100) award('century', out); return out; }

  // ======================================================================= live tracking
  var HIT = { '1B': 1, '2B': 1, '3B': 1, HR: 1 };
  var TERMINAL = { WALK: 1, K: 1, '1B': 1, '2B': 1, '3B': 1, HR: 1, OUT: 1, DP: 1, SF: 1 };

  function onEvent(o) {
    o = o || {};
    var ev = o.event || {}, sw = o.swing || null, play = o.play || null, c = ev.call;
    if (!cur) cur = newCur(o.mode);
    if (!cur.mode && o.mode) cur.mode = o.mode;
    var d = S(), st = d.stats, out = [];
    cur.events++;
    st.pitches++;
    var balls = cur.balls, strikes = cur.strikes;
    if (sw) {
      st.swings++;
      if (sw.contact) {
        st.contact++;
        if (sw.ev > st.maxEV) st.maxEV = Math.round(sw.ev);
        if (sw.ev > cur.maxEV) cur.maxEV = sw.ev;
        if (sw.label === 'PERFECT' || sw.sweet) {
          st.perfects++; cur.perfects++;
          award('sweet', out);
          if (cur.perfects >= 5) award('sommelier', out);
        }
        if (sw.ev >= 110 && sw.la >= 0 && sw.la <= 22 && c !== 'FOUL') award('rope', out);
      } else st.whiffs++;
    } else st.takes++;

    if (c === 'FOUL') st.fouls++;
    if (c === 'WALK') { st.bb++; award('patient', out); }
    if (c === 'K') { st.k++; cur.k++; if (cur.k >= 4) award('sombrero', out); }
    if (c === 'OUT' || c === 'DP' || c === 'SF') st.outs += (ev.outs || 1);
    st.runs += ev.runs || 0;

    if (HIT[c]) {
      st.hits++; cur.hits++; cur.types[c] = true;
      if (c === '1B') st.singles++; else if (c === '2B') st.doubles++; else if (c === '3B') st.triples++;
      award('first_hit', out);
      cur.streak++;
      if (cur.streak > st.bestStreak) st.bestStreak = cur.streak;
      if (cur.streak === 3) { st.onFire++; award('onfire', out); }
      if (cur.streak >= 5) award('inferno', out);
      if (balls === 3 && strikes === 2) award('fullcount', out);
      if (cur.types['1B'] && cur.types['2B'] && cur.types['3B'] && cur.types.HR) award('cycle', out);
      if (c === 'HR') {
        st.hr++; cur.hr++;
        var dist = (play && play.dist) || 0;
        st.hrDist += Math.round(dist);
        if (dist > st.longest) st.longest = Math.round(dist);
        if (dist > cur.longest) cur.longest = dist;
        award('first_hr', out);
        if (dist >= 450) award('moonshot', out);
        if (dist >= 500) award('tape', out);
        if ((ev.runs || 0) >= 4) award('slam', out);
        if (cur.lastWasHR) award('b2b', out);
        if (cur.hr >= 3) award('hattrick', out);
        if (sw && sw.chase) award('chasehr', out);
        var spray = play && play.spray != null ? play.spray : sw && sw.spray;
        if (spray != null && spray >= 15) award('oppo', out);
      }
      checkStats(out);
    } else if (c === 'OUT' || c === 'DP' || c === 'SF' || c === 'K') cur.streak = 0;

    if (TERMINAL[c]) cur.lastWasHR = c === 'HR';
    if (ev.over && ev.win && HIT[c]) { cur.walkoff = true; award('walkoff', out); }

    // own count tracking (only used for the full-count stamp)
    if (TERMINAL[c]) { cur.balls = 0; cur.strikes = 0; }
    else if (c === 'BALL') cur.balls = Math.min(3, cur.balls + 1);
    else if (c === 'STRIKE') cur.strikes = Math.min(2, cur.strikes + 1);
    else if (c === 'FOUL' && cur.strikes < 2) cur.strikes++;

    BB.Save.soon();
    return out;
  }

  function startGame(mode, cfg) { cur = newCur(mode, cfg); }

  // ======================================================================= end of game -> rewards
  var lastEnd = null;
  function endGame(mode, cfg, result) {
    result = result || {};
    if (lastEnd && lastEnd.result === result) return lastEnd.rewards; // idempotent for the same result object
    mode = mode || result.mode || (cur && cur.mode) || 'tour';
    cfg = cfg || {};
    if (!cur) cur = newCur(mode, cfg);
    var d = S(), st = d.stats, out = [];
    var before = snapshotUnlocks();
    var lvBefore = levelInfo().level;
    var rs = result.stats || {};
    // if main never reported pitches, fold the summary stats in
    if (cur.events === 0 && rs) {
      st.pitches += rs.pitches || 0; st.swings += rs.swings || 0; st.contact += rs.contact || 0;
      st.hits += rs.hits || 0; st.hr += rs.hr || 0; st.k += rs.k || 0; st.bb += rs.bb || 0; st.runs += rs.runs || 0;
      st.perfects += rs.perfects || 0;
      if ((rs.longest || 0) > st.longest) st.longest = Math.round(rs.longest);
      if ((rs.maxEV || 0) > st.maxEV) st.maxEV = Math.round(rs.maxEV);
      cur.hits = rs.hits || 0; cur.hr = rs.hr || 0;
      if (rs.hr) award('first_hr', out);
      if (rs.hits) award('first_hit', out);
    }
    var hits = Math.max(cur.hits, rs.hits || 0), hr = Math.max(cur.hr, rs.hr || 0);
    var win = !!result.win, stars = result.stars || 0;
    var day = today();
    var lines = [];
    function line(label, coins, xp) { if (coins || xp) lines.push({ label: label, coins: coins || 0, xp: xp || 0 }); }

    st.games++;
    if (win) st.wins++;
    if (st.lastPlayDay !== day) { st.playDays++; st.lastPlayDay = day; }

    line('Showed up', 10, 20);
    if (hits) line(hits + (hits === 1 ? ' hit' : ' hits'), 4 * hits, 5 * hits);
    if (hr) line(hr + (hr === 1 ? ' home run' : ' home runs'), 10 * hr, 10 * hr);

    var rewards = { coins: 0, xp: 0, levelBefore: lvBefore, level: lvBefore, newAch: [], unlocks: [], tourStars: 0,
      starsBefore: 0, best: false, daily: null, lines: lines, mode: mode };

    if (mode === 'tour') {
      st.tourGames++;
      var id = cfg.id || (result.cfg && result.cfg.id);
      var prevStars = (id && d.tour.stars[id]) || 0;
      rewards.starsBefore = prevStars;
      if (win) line('Win', 25, 30);
      if (id) {
        if (stars > prevStars) { d.tour.stars[id] = stars; rewards.best = prevStars > 0; line((stars - prevStars) + ' new star' + (stars - prevStars > 1 ? 's' : ''), 20 * (stars - prevStars), 15 * (stars - prevStars)); }
        if (win && !d.tour.won[id]) { d.tour.won[id] = true; }
        rewards.tourStars = d.tour.stars[id] || 0;
      }
      st.stars = tourStarsTotal();
      if (stars >= 3) award('gold', out);
      if (win) {
        var at = locate(id);
        if (at) {
          var ch = TOUR()[at.ch];
          if (at.k === ch.games.length - 1) award('giant', out);
          if (ch.games.every(function (g) { return d.tour.won[g.id]; })) award('sweep', out);
          if (TOUR().length && TOUR().every(function (c, i) { return bossBeaten(i); })) award('collected', out);
        } else if (cfg.boss || (result.boss)) award('giant', out);
      }
      if (st.stars >= 45) award('stars45', out);
    } else if (mode === 'daily') {
      st.dailyGames++;
      var key = cfg.dayKey || cfg.day || day;
      var dd = d.daily, scored = !dd.results[key];
      if (scored) {
        dd.results[key] = { score: result.score || 0, stars: stars, win: win, label: result.scoreLabel || '', share: result.share || null, t: Date.now() };
        if (dd.lastDay === prevDay(key)) dd.streak = (dd.streak || 0) + 1;
        else if (dd.lastDay !== key) dd.streak = 1;
        dd.lastDay = key;
        if (dd.streak > dd.bestStreak) dd.bestStreak = dd.streak;
        if ((result.score || 0) > dd.best) { rewards.best = dd.best > 0; dd.best = result.score || 0; }
        var sb = 40 + 5 * Math.min(dd.streak, 10);
        line('Daily Derby' + (dd.streak > 1 ? ' · ' + dd.streak + '-day streak' : ''), sb, 30);
        if (stars) line(stars + ' daily star' + (stars > 1 ? 's' : ''), 10 * stars, 10 * stars);
        award('daily1', out);
        if (dd.streak >= 3) award('daily3', out);
        if (dd.streak >= 7) award('daily7', out);
        if (dd.streak >= 30) award('daily30', out);
      }
      rewards.daily = { streak: dd.streak, bestStreak: dd.bestStreak, played: true, scored: scored, replay: !scored,
        number: U.dayNumber(key), dayKey: key, result: dd.results[key] };
    } else if (mode === 'derby') {
      st.derbyGames++;
      d.derby.games++;
      var sc = result.score || hr;
      if (sc > d.derby.best) { rewards.best = true; rewards.prevBest = d.derby.best; d.derby.best = sc; line('New derby best', 30, 20); }
      if ((rs.longest || cur.longest) > d.derby.bestDist) d.derby.bestDist = Math.round(rs.longest || cur.longest);
      if (sc >= 10) award('derby10', out);
      if (sc >= 20) award('derby20', out);
    }
    if (win && d.lastFirstWinDay !== day) { d.lastFirstWinDay = day; line('First win today', 50, 25); }

    var coins = 0, xp = 0;
    lines.forEach(function (l) { coins += l.coins; xp += l.xp; });
    d.coins += coins; d.xp += xp; st.coinsEarned += coins;
    var lv = levelInfo().level;
    if (lv > lvBefore) {
      var lc = LEVEL_COINS * (lv - lvBefore);
      d.coins += lc; st.coinsEarned += lc; coins += lc;
      lines.push({ label: 'Level up!', coins: lc, xp: 0 });
    }
    checkLevel(out); checkStats(out);

    rewards.coins = coins + cur.achCoins; // achievement stamps were credited as they happened
    rewards.xp = xp;
    rewards.level = lv;
    rewards.newAch = cur.earned.slice();
    rewards.unlocks = diffUnlocks(before);
    rewards.coinsTotal = d.coins;
    rewards.levelInfo = levelInfo();
    rewards.levelInfoBefore = levelInfo(d.xp - xp);
    commit();
    lastEnd = { result: result, rewards: rewards };
    cur = null;
    return rewards;
  }

  // ======================================================================= packs
  function rollRarity(rng) {
    var r = rng();
    if (r < PACK.odds.foil) return 'foil';
    if (r < PACK.odds.foil + PACK.odds.rare) return 'rare';
    return 'common';
  }
  function packInfo() {
    var p = S().packs, k = PACK.guaranteeEvery;
    var left = k - (p.opened % k);       // packs until (and including) the guaranteed one
    return { cost: PACK.cost, size: PACK.size, opened: p.opened, guaranteedIn: left, guaranteedNext: left === 1, canAfford: S().coins >= PACK.cost };
  }
  function openPack(opts) {
    opts = opts || {};
    var d = S();
    var cost = opts.free ? 0 : PACK.cost;
    if (d.coins < cost) return { error: 'coins', need: cost - d.coins };
    var before = snapshotUnlocks();
    var setsBefore = TEAMS.map(function (t) { return teamComplete(t.idx); });
    d.coins -= cost;
    d.packs.opened++;
    d.packs.seed = (d.packs.seed + 1) >>> 0;
    var rng = opts.rng || U.rng(U.hashStr('pack:' + d.created + ':' + d.packs.seed));
    var guaranteed = d.packs.opened % PACK.guaranteeEvery === 0;
    var rar = [];
    for (var i = 0; i < PACK.size; i++) rar.push(rollRarity(rng));
    if (guaranteed && rar.indexOf('rare') < 0 && rar.indexOf('foil') < 0) rar[PACK.size - 1] = rng() < 0.25 ? 'foil' : 'rare';
    // order: commons first, best card last (for the reveal)
    var order = { common: 0, rare: 1, foil: 2 };
    rar.sort(function (a, b) { return order[a] - order[b]; });
    var pulled = [], refund = 0, out = [], picked = {};
    rar.forEach(function (r) {
      var pool = CARDS.filter(function (c) { return c.rarity === r && !picked[c.id]; });
      var fresh = pool.filter(function (c) { return !d.cards[c.id]; });
      var src = fresh.length && rng() < PACK.newBias ? fresh : pool;
      var card = src[Math.floor(rng() * src.length) % src.length];
      picked[card.id] = true;
      var mis = rng() < PACK.misprint;
      var entry = { card: card, rarity: mis ? 'misprint' : card.rarity, misprint: mis, isNew: false, dupe: false, refund: 0 };
      if (mis) {
        entry.isNew = !d.misprints[card.id];
        d.misprints[card.id] = (d.misprints[card.id] || 0) + 1;
        if (!entry.isNew) { entry.dupe = true; entry.refund = PACK.refund.misprint; }
        if (!d.cards[card.id]) { d.cards[card.id] = 1; entry.isNew = true; } // a misprint also fills the album slot
        award('misprint', out);
      } else {
        entry.isNew = !d.cards[card.id];
        d.cards[card.id] = (d.cards[card.id] || 0) + 1;
        if (!entry.isNew) { entry.dupe = true; entry.refund = PACK.refund[card.rarity]; }
      }
      if (card.rarity === 'foil' && !mis) award('foil', out);
      refund += entry.refund;
      pulled.push(entry);
    });
    d.coins += refund;
    award('firstpack', out);
    checkCollection(out);
    var setsDone = [];
    TEAMS.forEach(function (t, i) { if (!setsBefore[i] && teamComplete(i)) setsDone.push({ team: t, reward: SET_REWARDS[i] }); });
    commit();
    return { cards: pulled, refund: refund, guaranteed: guaranteed, newAch: out, sets: setsDone, unlocks: diffUnlocks(before), coins: d.coins };
  }

  // ======================================================================= equip / buy
  function equipBat(id) {
    if (!batUnlocked(id)) return null;
    var d = S(), out = [];
    if (d.bat !== id) { d.bat = id; if (id !== 'b_hickory') award('changeup', out); }
    commit(); return out;
  }
  function equipInkset(id) {
    if (!inksetUnlocked(id)) return null;
    var d = S(), out = [];
    if (d.inkset !== id) { d.inkset = id; if (id !== 'park') award('freshink', out); }
    commit(); return out;
  }
  function buy(kind, id) {
    var item = kind === 'bat' ? BAT_BY[id] : null, rule = item ? item.unlock : inkRule(id);
    if (!rule || rule.kind !== 'coins') return { error: 'notforsale' };
    var d = S();
    if (d.bought[id]) return { ok: true };
    if (d.coins < rule.n) return { error: 'coins', need: rule.n - d.coins };
    d.coins -= rule.n; d.bought[id] = true; commit();
    return { ok: true };
  }

  // ======================================================================= daily helpers
  function dailyInfo(key) {
    key = key || today();
    var dd = S().daily, played = !!dd.results[key];
    var live = (dd.lastDay === key || dd.lastDay === prevDay(key)) ? dd.streak : 0;
    return { dayKey: key, number: U.dayNumber(key), played: played, result: dd.results[key] || null, streak: live,
      bestStreak: dd.bestStreak, best: dd.best, alive: dd.lastDay === prevDay(key) && !played };
  }
  function dailyHistory(n, key) {
    key = key || today();
    var out = [], k = key, dd = S().daily;
    for (var i = 0; i < (n || 14); i++) { out.unshift({ dayKey: k, number: U.dayNumber(k), result: dd.results[k] || null }); k = prevDay(k); }
    return out;
  }

  // ======================================================================= settings
  function applySetting(k, v) {
    var A = BB.Audio;
    try {
      if (k === 'sound' && A && A.setMuted) A.setMuted(!v);
      if (k === 'music' && A && A.setMusic) A.setMusic(!!v);
      if (k === 'haptics' && BB.Haptics) BB.Haptics.enabled = !!v;
    } catch (e) {}
  }

  BB.Meta = {
    BATS: BATS, CARDS: CARDS, TEAMS: TEAMS, ACH: ACH, PACK: PACK, INK_RULES: INK_RULES, INK_DESC: INK_DESC,
    SET_REWARDS: SET_REWARDS, ACH_COINS: ACH_COINS, MAX_LEVEL: MAX_LEVEL,
    getBat: function (id) { return BAT_BY[id] || null; },
    getCard: function (id) { return CARD_BY[id] || null; },
    getAch: function (id) { return ACH_BY[id] || null; },

    // ---- contract
    currentBat: function () { var id = S().bat; return BAT_BY[id] && batUnlocked(id) ? BAT_BY[id] : BAT_BY.b_hickory; },
    currentInkset: function (park) {
      var choice = S().inkset;
      if (choice && choice !== 'park' && inksetUnlocked(choice)) return inksetById(choice) || BB.INKSETS[0];
      if (typeof park === 'string' && BB.Content && BB.Content.getPark) park = BB.Content.getPark(park);
      return (park && park.inkset && inksetById(park.inkset)) || BB.INKSETS[0];
    },
    inksetChoice: function () { return S().inkset; },
    settings: function () { return S().settings; },
    setSetting: function (k, v) {
      var s = S().settings;
      if (k === 'latencyMs') v = U.clamp(Math.round(+v || 0), 0, 150);
      s[k] = v; commit(); applySetting(k, v);
      if (BB.Game && BB.Game.applySettings) { try { BB.Game.applySettings(); } catch (e) {} }
      return s;
    },
    onEvent: onEvent,
    endGame: endGame,
    startGame: startGame,
    onAchievement: function (fn) { listeners.push(fn); },

    // ---- economy
    coins: function () { return S().coins; },
    xp: function () { return S().xp; },
    levelInfo: levelInfo,
    xpNeed: xpNeed,
    addCoins: function (n) { S().coins += n; commit(); return S().coins; },

    // ---- unlocks
    condMet: condMet, condText: condText,
    batUnlocked: batUnlocked, inksetUnlocked: inksetUnlocked,
    batRule: function (id) { return BAT_BY[id] ? BAT_BY[id].unlock : null; },
    inksetRule: inkRule,
    equipBat: equipBat, equipInkset: equipInkset, buy: buy,
    isSeen: function (key) { return !!S().seenUnlocks[key]; },
    markSeen: function (key) { S().seenUnlocks[key] = true; BB.Save.soon(); },

    // ---- cards
    owned: owned,
    misprints: function (id) { return S().misprints[id] || 0; },
    teamComplete: teamComplete,
    albumStats: albumStats,
    packInfo: packInfo,
    openPack: openPack,

    // ---- scorebook
    achList: function () { var d = S(); return ACH.map(function (a) { return { id: a.id, name: a.name, desc: a.desc, mark: a.mark, earned: d.ach[a.id] || 0 }; }); },
    stats: function () { return S().stats; },

    // ---- tour
    tour: TOUR,
    chapterUnlocked: chapterUnlocked,
    gameUnlocked: gameUnlocked,
    gameWon: gameWon,
    gameStars: function (game) { return S().tour.stars[game && (game.id || game)] || 0; },
    bossBeaten: bossBeaten,
    tourStars: tourStarsTotal,
    chapterStars: function (i) { var c = TOUR()[i], n = 0; if (c) c.games.forEach(function (g) { n += S().tour.stars[g.id] || 0; }); return n; },
    locate: locate,
    nextTourGame: function (game) {
      var at = locate(game); if (!at) return null;
      var T = TOUR(), g = T[at.ch].games[at.k + 1] || (T[at.ch + 1] && T[at.ch + 1].games[0]);
      return g && gameUnlocked(g) ? g : null;
    },
    currentTourGame: function () {
      var T = TOUR(), last = null;
      for (var i = 0; i < T.length; i++) for (var k = 0; k < T[i].games.length; k++) {
        var g = T[i].games[k];
        if (gameUnlocked(g)) { last = g; if (!gameWon(g.id)) return g; }
      }
      return last;
    },

    // ---- daily / derby
    dailyInfo: dailyInfo,
    dailyHistory: dailyHistory,
    derbyBest: function () { return S().derby.best; },
    derby: function () { return S().derby; },
    prevDay: prevDay,

    // ---- misc
    seenHowTo: function () { return !!S().seenHowTo; },
    markHowToSeen: function () { S().seenHowTo = true; commit(); },
    resetProgress: function () {
      var keep = S().settings, seen = S().seenHowTo;
      var d = BB.Save.reset(); d.settings = keep; d.seenHowTo = seen; commit(); cur = null; lastEnd = null;
    },
    _cur: function () { return cur; },
    _rebuildCards: function () {
      TEAMS = buildTeams(); CARDS = buildCards(TEAMS); CARD_BY = {}; CARDS.forEach(function (c) { CARD_BY[c.id] = c; });
      BB.Meta.TEAMS = TEAMS; BB.Meta.CARDS = CARDS;
    },
  };
})();
