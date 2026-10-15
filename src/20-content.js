// 20-content.js — parks, pitchers, the Barnstorm Tour. Owned by the rules agent. Pure data + getters.
BB.Content = (function () {
  // ---------------------------------------------------------------- parks
  // fence: [spray, dist, height] from -45 (LF line) to 45 (RF line); linear interpolation between points.
  var PARKS = [
    { id: 'p_haybale', name: 'Haybale Grounds', town: 'Haybale Junction', team: 'Hayseeds', inkset: 'classic',
      fence: [[-45, 318, 6], [-30, 345, 6], [-15, 368, 6], [0, 384, 8], [15, 366, 6], [30, 340, 6], [45, 312, 6]],
      features: { scoreboard: true, lights: false, billboard: 'FEED & SEED', water: 'none', hill: true, skyline: 'barns' },
      flavor: 'Chicken-wire fences, a tractor parked in deep left, and mud that eats cleats whole.' },
    { id: 'p_bandbox', name: 'Rivet Street Bandbox', town: 'Ironbridge', team: 'Rivets', inkset: 'grape',
      fence: [[-45, 302, 37], [-30, 328, 37], [-20, 365, 37], [-12, 388, 18], [0, 402, 12], [15, 380, 10], [30, 352, 8], [45, 328, 8]],
      features: { scoreboard: true, lights: true, billboard: 'RIVET ST. DELI · HIT ME, FREE PICKLE', water: 'none', hill: false, skyline: 'city' },
      flavor: 'A 37-foot wall in left, tenements over right, and the el train rattling every third pitch.' },
    { id: 'p_loonlake', name: 'Loon Lake Pines', town: 'Loon Lake', team: 'Loons', inkset: 'lawn',
      fence: [[-45, 332, 8], [-30, 374, 8], [-22, 396, 8], [0, 412, 10], [22, 398, 8], [30, 378, 8], [45, 336, 8]],
      features: { scoreboard: true, lights: false, billboard: 'BAIT & TACKLE', water: 'center', hill: false, skyline: 'pines' },
      flavor: 'Deep alleys, tall pines, and a lake past center where the long ones go to swim.' },
    { id: 'p_harbor', name: 'Gull Point Harbor Park', town: 'Gull Point', team: 'Gulls', inkset: 'harbor',
      fence: [[-45, 345, 10], [-30, 372, 10], [-15, 392, 10], [0, 402, 10], [15, 376, 14], [30, 336, 20], [38, 318, 20], [45, 309, 20]],
      features: { scoreboard: true, lights: true, billboard: 'CAPT. MO\'S CHOWDER', water: 'right', hill: false, skyline: 'harbor' },
      flavor: 'A short porch in right with the bay just behind it. Kayaks wait for splash hits.' },
    { id: 'p_desert', name: 'Saguaro Night Field', town: 'Dry Wash', team: 'Coyotes', inkset: 'dusk',
      fence: [[-45, 335, 9], [-30, 366, 9], [-12, 392, 9], [0, 406, 9], [12, 392, 9], [30, 366, 9], [45, 335, 9]],
      features: { scoreboard: true, lights: true, billboard: 'STARLITE MOTOR LODGE', water: 'none', hill: true, skyline: 'desert' },
      flavor: 'Thin air, warm nights, a hill in center field and moths the size of baseballs.' },
    { id: 'p_cathedral', name: 'Old Cathedral Park', town: 'Capitol City', team: 'Copperheads', inkset: 'ledger',
      fence: [[-45, 341, 12], [-30, 385, 12], [-18, 414, 12], [0, 425, 14], [18, 408, 12], [30, 378, 8], [40, 332, 8], [45, 314, 8]],
      features: { scoreboard: true, lights: true, billboard: 'PRESS ON · EST. 1911', water: 'none', hill: false, skyline: 'none' },
      flavor: 'Arched brick, a hand-turned scoreboard and 425 to dead center. The last stop on the barnstorm.' },
  ];

  // ---------------------------------------------------------------- pitchers
  function P(id, name, nick, hand, team, velo, arsenal, control, stuff, look, bio, boss) {
    var l = look.split(' ');
    return { id: id, name: name, nick: nick, hand: hand, team: team, velo: velo, arsenal: arsenal, control: control,
      stuff: stuff, boss: !!boss, look: { build: l[0], hair: l[1], windup: l[2], number: +l[3] }, bio: bio };
  }
  var PITCHERS = [
    // chapter 1 — Haybale Junction: slow, straight, friendly
    P('p_hank', 'Hank Hollister', 'Pops', 'R', 'Hayseeds', 72, { FB: .85, CH: .15 }, .95, .15, 'stout mustache classic 44',
      'Throws strikes, tells long stories, owns the feed store.'),
    P('p_dottie', 'Dottie Fairweather', 'Sunshine', 'L', 'Hayseeds', 75, { FB: .8, CB: .2 }, .92, .22, 'lanky none highkick 9',
      'Learned to pitch by plunking apples off the silo roof.'),
    P('p_clem', 'Clem Bixby', 'The Mailman', 'R', 'Hayseeds', 78, { FB: .7, SI: .2, CH: .1 }, .9, .28, 'tall sideburns classic 21',
      'Always delivers. Usually right down Main Street.'),
    P('p_ox', 'Earl Oxley', 'The Ox', 'R', 'Hayseeds', 82, { FB: .6, SI: .25, CB: .15 }, .86, .4, 'stout beard classic 1',
      'Farm-strong and grumpy about it. Holds the county record for strikeouts and blue ribbons.', true),
    // chapter 2 — Ironbridge: city slickers, first sliders
    P('p_vinnie', 'Vinnie Castellano', 'Two-Bit', 'R', 'Rivets', 81, { FB: .55, SL: .25, CH: .2 }, .82, .45, 'tall mustache sidearm 25',
      'Will flip you a quarter for every swing and miss. Never runs out of quarters.'),
    P('p_rosalind', 'Rosalind Park', 'Rooftop', 'L', 'Rivets', 83, { FB: .5, CB: .3, CH: .2 }, .82, .5, 'lanky none highkick 6',
      'Grew up throwing at a fire escape six floors up. Rarely misses a rung.'),
    P('p_marty', 'Marty Pinwheel', 'Subway', 'R', 'Rivets', 84, { FB: .5, SI: .3, SL: .2 }, .78, .5, 'lanky sideburns submarine 33',
      'Throws from the third rail. The ball rises like a train out of a tunnel.'),
    P('p_landlord', 'Lou Brodsky', 'The Landlord', 'R', 'Rivets', 88, { FB: .45, SL: .3, CH: .15, CT: .1 }, .8, .62, 'stout mustache classic 13',
      'Collects rent on the inside corner, first of every month and every at-bat.', true),
    // chapter 3 — Loon Lake: breaking balls and a knuckler
    P('p_ellis', 'Ellis Thornbury', 'Woodsmoke', 'R', 'Loons', 85, { FB: .45, CB: .35, CH: .2 }, .78, .55, 'tall beard classic 38',
      'Splits his own firewood. Would like to split your bat too.'),
    P('p_june', 'June Larkspur', 'The Loon', 'L', 'Loons', 86, { KN: .5, FB: .3, CH: .2 }, .72, .6, 'lanky none classic 2',
      'Her knuckleball flutters like a moth around a porch light.'),
    P('p_otis', 'Otis Fernsby', 'Canoe', 'R', 'Loons', 88, { FB: .5, SL: .3, SP: .2 }, .76, .6, 'stout sideburns sidearm 17',
      'Paddles to the park every morning. Arm like an outboard motor.'),
    P('p_sasquatch', 'Gus Haldane', 'Sasquatch', 'R', 'Loons', 91, { FB: .45, CB: .25, SL: .2, SP: .1 }, .76, .72, 'tall beard highkick 0',
      'Seven feet of flannel. Nobody has ever gotten a clear look at him, or his curveball.', true),
    // chapter 4 — Gull Point: sinkers, cutters, sea legs
    P('p_pearl', 'Pearl Marlowe', 'Foghorn', 'R', 'Gulls', 88, { FB: .45, SI: .3, CH: .25 }, .78, .62, 'stout none classic 11',
      'You hear her before you see the pitch. Mostly you just hear her.'),
    P('p_nils', 'Nils Brightwater', 'Barnacle', 'L', 'Gulls', 89, { CT: .4, FB: .3, CB: .3 }, .75, .65, 'tall beard classic 47',
      'Sticks to the corners and will not be scraped off.'),
    P('p_sully', 'Sully Tidewell', 'Low Tide', 'R', 'Gulls', 91, { SI: .5, SL: .3, CH: .2 }, .74, .66, 'lanky mustache submarine 29',
      'Knuckles nearly scrape the mound. The sinker goes out with the tide.'),
    P('p_admiral', 'Winifred Gale', 'The Admiral', 'R', 'Gulls', 94, { FB: .4, SL: .3, SP: .2, CB: .1 }, .78, .78, 'tall none highkick 8',
      'Commands the strike zone like a flagship. Salutes after every strikeout.', true),
    // chapter 5 — Dry Wash: heat, screwballs and an eephus under the stars
    P('p_rio', 'Rio Calloway', 'Dust Devil', 'R', 'Coyotes', 91, { FB: .45, SL: .35, CH: .2 }, .72, .7, 'lanky sideburns sidearm 14',
      'Spins like a whirlwind on the mound. So does the slider.'),
    P('p_tess', 'Tess Rattigan', 'Tumbleweed', 'L', 'Coyotes', 90, { SC: .35, FB: .3, CB: .25, EE: .1 }, .74, .72, 'lanky none classic 31',
      'Drifts in from nowhere, throws something weird, drifts back out.'),
    P('p_cosmo', 'Cosmo Starling', 'Night Owl', 'R', 'Coyotes', 94, { FB: .5, SP: .3, CT: .2 }, .7, .74, 'tall mustache highkick 77',
      'Only pitches after sundown. Claims the moon gives him an extra two miles an hour.'),
    P('p_mirage', 'Dez Montoya', 'The Mirage', 'L', 'Coyotes', 96, { FB: .35, SL: .25, CB: .2, CH: .1, EE: .1 }, .74, .84, 'lanky beard sidearm 7',
      'Now you see it. Now you are walking back to the dugout.', true),
    // chapter 6 — Capitol City: the big leagues of the barnstorm
    P('p_organist', 'Augustus Fairchild', 'The Organist', 'R', 'Copperheads', 93, { FB: .4, CB: .3, CH: .3 }, .76, .78, 'tall mustache classic 19',
      'Plays the stadium organ between starts. Changes keys mid-at-bat.'),
    P('p_belle', 'Belle Harrow', 'Gargoyle', 'L', 'Copperheads', 95, { CT: .4, FB: .35, SP: .25 }, .72, .8, 'stout none classic 66',
      'Perches on the mound without blinking. The cutter bites stone.'),
    P('p_thunder', 'Rex Underwood', 'Old Thunder', 'R', 'Copperheads', 97, { FB: .6, SL: .4 }, .66, .82, 'stout beard highkick 52',
      'Two pitches, both loud. Catchers ice their hands for a week.'),
    P('p_halo', 'Cornelius Vane', 'Halo', 'R', 'Copperheads', 99, { FB: .38, SL: .22, CB: .15, CH: .15, SP: .1 }, .8, .95, 'tall none highkick 10',
      'The last ace of the old cathedral. Has never thrown the same pitch twice in a row. Probably.', true),
    // derby / daily throwers
    P('p_bpbob', 'Bobby Lobbs', 'Batting Practice Bob', 'R', 'Barnstormers', 70, { FB: .9, CH: .1 }, .97, .1, 'stout mustache classic 99',
      'Has thrown four million meatballs and loved every one. Gets a little competitive after a few dingers.'),
    P('p_mabel', 'Mabel Quigley', 'Grandma Gas', 'R', 'Barnstormers', 86, { FB: .5, SL: .3, CH: .2 }, .8, .55, 'stout none classic 72',
      'Seventy-two years young. Still brings the cookies and the high cheese.'),
    P('p_ike', 'Ike Penny', 'The Paperboy', 'L', 'Barnstormers', 84, { FB: .5, SI: .3, CB: .2 }, .82, .5, 'lanky none sidearm 5',
      'Delivers to every corner of the zone before breakfast.'),
  ];
  var DERBY_PITCHER = 'p_bpbob';
  var DAILY_POOL = ['p_vinnie', 'p_rosalind', 'p_marty', 'p_ellis', 'p_june', 'p_otis', 'p_pearl', 'p_nils', 'p_rio', 'p_tess',
    'p_mabel', 'p_ike'];

  // ---------------------------------------------------------------- scenarios
  // Scenario = { kind, need, outs, metric, stars:[s1,s2,s3], goal, starText:[3], ...kind fields }
  // stars: game won → 1 star; 2nd/3rd star when the metric reaches stars[1] / stars[2].
  //   metric 'spare' = outs left when the walk-off happens; others count up (runs, hr, hits, onbase, dist ft).
  var BASE_NAMES = ['1st', '2nd', '3rd'];
  function onText(b) {
    var n = b.filter(Boolean).length;
    if (n === 0) return 'Bases empty';
    if (n === 3) return 'Bases loaded';
    if (b[0] && b[2] && !b[1]) return 'Runners on the corners';
    var s = BASE_NAMES.filter(function (x, i) { return b[i]; }).join(' & ');
    return (n === 1 ? 'Runner on ' : 'Runners on ') + s;
  }
  function outText(o) { return o === 0 ? 'nobody out' : o === 1 ? '1 out' : '2 outs'; }
  // walk-off inning: you're home, down `down`; score down+1 to win before 3 outs.
  function walkoff(o) {
    var bases = o.bases || [0, 0, 0], so = o.startOuts || 0, down = o.down, you = o.home != null ? o.home : 2;
    var sc = { kind: 'inning', walkoff: true, half: 'BOT', inning: o.inning || 9, you: you, them: you + down, need: down + 1,
      bases: bases.map(Boolean), startOuts: so, count: o.count || [0, 0], outs: 3, metric: 'spare', stars: [0, 1, 2] };
    sc.goal = 'Bottom ' + ord(sc.inning) + '. ' + (down ? 'Down ' + down : 'Tied') + ', ' + onText(bases).toLowerCase() + ', ' + outText(so) +
      (o.count ? ', ' + o.count.join('-') + ' count' : '') + '. Score ' + sc.need + ' to win.';
    sc.starText = ['Walk it off', 'Win with an out to spare', so ? 'Win without making an out' : 'Win with 2 outs to spare'];
    return sc;
  }
  // rally inning: play a full half inning (top half, visitors), score `need` runs (more = more stars).
  function rally(o) {
    var them = o.them != null ? o.them : 4;
    var sc = { kind: 'inning', walkoff: false, half: 'TOP', inning: o.inning || 8, you: them - o.down, them: them,
      bases: [false, false, false], startOuts: 0, count: [0, 0], outs: 3, need: o.need, metric: 'runs', stars: o.stars };
    sc.goal = 'Down ' + o.down + ' in the ' + ord(sc.inning) + '. Score ' + o.need + '+ runs this inning.';
    sc.starText = ['Score ' + o.stars[0], 'Score ' + o.stars[1], 'Score ' + o.stars[2]];
    return sc;
  }
  function ord(n) { return n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'); }
  function derby(need, outs, stars) {
    return { kind: 'derby', need: need, outs: outs, metric: 'hr', stars: stars,
      goal: 'Hit ' + need + ' home runs before ' + outs + ' outs. Anything but a homer is an out.',
      starText: [stars[0] + ' HR', stars[1] + ' HR', stars[2] + ' HR'] };
  }
  function hits(need, pitches, stars) {
    return { kind: 'hits', need: need, pitches: pitches, outs: 0, metric: 'hits', stars: stars,
      goal: 'Get ' + need + ' hits in ' + pitches + ' pitches.', starText: [stars[0] + ' hits', stars[1] + ' hits', stars[2] + ' hits'] };
  }
  function onbase(need, outs, stars) {
    return { kind: 'onbase', need: need, outs: outs, metric: 'onbase', stars: stars,
      goal: 'Reach base ' + need + ' times before ' + outs + ' outs. Walks count.',
      starText: ['On base ' + stars[0] + 'x', 'On base ' + stars[1] + 'x', 'On base ' + stars[2] + 'x'] };
  }
  function distance(need, outs, stars) {
    var f = BB.U.fmtInt;
    return { kind: 'distance', need: need, outs: outs, metric: 'dist', stars: stars,
      goal: 'Hit ' + f(need) + ' ft of home runs before ' + outs + ' outs. Anything but a homer is an out.',
      starText: [f(stars[0]) + ' ft', f(stars[1]) + ' ft', f(stars[2]) + ' ft'] };
  }

  // ---------------------------------------------------------------- tour
  function G(id, title, pitcher, scenario, blurb) { return { id: id, title: title, pitcher: pitcher, scenario: scenario, blurb: blurb }; }
  var TOUR = [
    { id: 'c1', title: 'County Fair Circuit', park: 'p_haybale', blurb: 'Slow pitches, loud fans, livestock in the bleachers.', games: [
      G('t1g1', 'Opening Day', 'p_hank', hits(3, 18, [3, 4, 6]), 'Pops lobs them in nice and easy. Find the barrel.'),
      G('t1g2', 'Sandlot Rules', 'p_dottie', onbase(2, 3, [2, 3, 4]), 'Lay off the curve in the dirt. A walk is as good as a hit.'),
      G('t1g3', 'Barn Burner', 'p_clem', derby(2, 6, [2, 3, 5]), 'Hold to load a power swing and aim for the hayloft.'),
      G('t1g4', 'Bottom of the Ninth', 'p_dottie', walkoff({ down: 1, home: 3, bases: [0, 1, 0] }), 'Runner in scoring position. Bring him home and then some.'),
      G('t1g5', 'The Ox at Dusk', 'p_ox', walkoff({ down: 1, home: 2, bases: [1, 0, 0] }), 'Boss: The Ox has never lost at home. Never.'),
    ] },
    { id: 'c2', title: 'Ironbridge Nights', park: 'p_bandbox', blurb: 'A tiny park with a giant wall in left. Pull it high.', games: [
      G('t2g1', 'Wall Ball', 'p_vinnie', distance(750, 6, [750, 1100, 1500]), 'Clear the 37-foot wall. It\'s only 302 down the line.'),
      G('t2g2', 'Rush Hour', 'p_marty', hits(3, 15, [3, 4, 6]), 'The sinker dives. Wait on it.'),
      G('t2g3', 'Down Two, Two On', 'p_rosalind', walkoff({ down: 2, home: 3, bases: [1, 1, 0] }), 'Rooftop fans are already chanting. Don\'t let them down.'),
      G('t2g4', 'Rooftop Seats', 'p_vinnie', derby(3, 7, [3, 4, 6]), 'Free pickle for every homer off the deli sign.'),
      G('t2g5', 'Rent Is Due', 'p_landlord', rally({ need: 2, down: 1, inning: 8, stars: [2, 3, 5] }), 'Boss: The Landlord owns the inside corner. Take it back.'),
    ] },
    { id: 'c3', title: 'Up at the Lake', park: 'p_loonlake', blurb: 'Deep alleys and a knuckleballer. Gap power pays here.', games: [
      G('t3g1', 'Campfire Swings', 'p_ellis', onbase(3, 4, [3, 4, 6]), 'The curve drops off a table. Take it and wait for heat.'),
      G('t3g2', 'Knuckleball Lake', 'p_june', hits(3, 15, [3, 4, 6]), 'Nobody knows where the knuckler is going. Including June.'),
      G('t3g3', 'Two-Strike Hole', 'p_otis', walkoff({ down: 1, home: 4, bases: [1, 0, 1], startOuts: 1, count: [0, 2] }), 'You start in an 0-2 hole. Protect the plate.'),
      G('t3g4', 'Splash Hits', 'p_ellis', distance(900, 6, [900, 1300, 1800]), 'Center field is 412 and then the lake.'),
      G('t3g5', 'Sasquatch Sighting', 'p_sasquatch', walkoff({ down: 3, home: 1, bases: [1, 1, 1] }), 'Boss: Bases loaded, nobody out, and a seven-foot legend on the mound.'),
    ] },
    { id: 'c4', title: 'Harbor Lights', park: 'p_harbor', blurb: 'Fog, gulls and a short porch over the water.', games: [
      G('t4g1', 'Fog Rolls In', 'p_pearl', hits(4, 18, [4, 5, 7]), 'Can\'t see the sinker? Listen for the foghorn.'),
      G('t4g2', 'Splash Landing', 'p_nils', derby(3, 6, [3, 4, 6]), 'Go opposite field: it\'s 309 to the bay.'),
      G('t4g3', 'Extra Innings', 'p_sully', walkoff({ down: 0, home: 3, inning: 10, bases: [0, 1, 0] }), 'Tied in the 10th with the ghost runner on second.'),
      G('t4g4', 'Long Ball Tide', 'p_pearl', distance(1100, 6, [1100, 1500, 2000]), 'High tide, high fly balls.'),
      G('t4g5', 'Admiral\'s Inspection', 'p_admiral', walkoff({ down: 2, home: 2, bases: [1, 0, 0] }), 'Boss: The Admiral has a 94 mph flagship. Man on, nobody out.'),
    ] },
    { id: 'c5', title: 'Desert Night Tour', park: 'p_desert', blurb: 'Under the lights in Dry Wash, the ball carries and the junk floats.', games: [
      G('t5g1', 'Night Game', 'p_cosmo', onbase(4, 5, [4, 5, 7]), 'The splitter vanishes in the dark. Don\'t chase.'),
      G('t5g2', 'Dust Devil Derby', 'p_rio', derby(3, 8, [3, 4, 6]), 'Thin air. Lift it.'),
      G('t5g3', 'Eephus Under the Stars', 'p_tess', hits(4, 16, [4, 5, 7]), 'Screwballs, curves and a 50 mph moonball. Patience.'),
      G('t5g4', 'Rally Caps', 'p_rio', rally({ need: 2, down: 1, inning: 7, stars: [2, 3, 5] }), 'Turn your cap inside out and string some hits together.'),
      G('t5g5', 'The Mirage', 'p_mirage', walkoff({ down: 3, home: 3, bases: [1, 1, 1], startOuts: 1, count: [0, 2] }), 'Boss: Bases loaded, one out, 0-2. Now you see it...'),
    ] },
    { id: 'c6', title: 'The Cathedral', park: 'p_cathedral', blurb: 'The grandest old yard in the land. 425 to center. Bring everything.', games: [
      G('t6g1', 'Hymns & Homers', 'p_organist', distance(1200, 6, [1200, 1600, 2100]), 'The organist changes keys. Change your timing.'),
      G('t6g2', 'Gargoyle\'s Gauntlet', 'p_belle', hits(4, 16, [4, 5, 7]), 'The cutter bites late. Stay back.'),
      G('t6g3', 'Thunder Roll', 'p_thunder', derby(3, 7, [3, 4, 6]), 'Ninety-seven and straight. Mostly.'),
      G('t6g4', 'Pennant Race', 'p_belle', rally({ need: 2, down: 1, inning: 9, stars: [2, 3, 5] }), 'Top of the 9th, one run down, the pennant on the line.'),
      G('t6g5', 'The Last Ace', 'p_halo', walkoff({ down: 2, home: 1 }), 'Final boss: Halo at 99. Down two, bases empty. Legends start here.'),
    ] },
  ];
  TOUR.forEach(function (c, ci) {
    c.n = ci + 1;
    c.games.forEach(function (g, gi) { g.park = c.park; g.chapter = c.id; g.n = gi + 1; g.boss = gi === 4; });
  });

  var byId = {};
  PARKS.forEach(function (p) { byId[p.id] = p; });
  PITCHERS.forEach(function (p) { byId[p.id] = p; });
  var games = {};
  TOUR.forEach(function (c) { c.games.forEach(function (g) { games[g.id] = g; }); });

  return {
    PARKS: PARKS, PITCHERS: PITCHERS, TOUR: TOUR, DERBY_PITCHER: DERBY_PITCHER, DAILY_POOL: DAILY_POOL,
    getPitcher: function (id) { return typeof id === 'object' ? id : byId[id] && byId[id].velo ? byId[id] : null; },
    getPark: function (id) { return typeof id === 'object' ? id : byId[id] && byId[id].fence ? byId[id] : null; },
    getGame: function (id) { return games[id] || null; },
    getChapter: function (id) { for (var i = 0; i < TOUR.length; i++) if (TOUR[i].id === id) return TOUR[i]; return null; },
    allGames: function () { var a = []; TOUR.forEach(function (c) { a = a.concat(c.games); }); return a; },
  };
})();
