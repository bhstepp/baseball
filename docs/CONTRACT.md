# Halftone Hardball — module contract

**The game in one line:** a one-tap batting game for iPhone (portrait), printed in risograph ink. You stand in
behind the plate. The pitcher winds up; tap to swing. Timing decides everything: on time = barrel, early = pull,
late = opposite field, way off = whiff or foul. Take pitches outside the zone. Hold during the windup to *load a
power swing* (let go to swing: smaller timing window, more pop).

**Look:** a risograph zine. Cream paper, three ink drums (slot A dark/main, slot B accent, slot C highlight),
flat shapes with halftone-dot shading instead of gradients, layers composited with `multiply` and slightly
misregistered (each ink layer offset 1–3 px), visible paper grain, chunky stamp lettering (Bungee) and
typewriter scorebook text (Space Mono). No glow, no drop shadows, no photographic gradients. Everything is drawn
in code; there are no image or audio files.

**Hooks:** Barnstorm Tour (6 parks × 5 games, scenarios + 3 stars each, boss pitcher per park), Daily Derby (same
seeded pitches for everyone, a streak, a Wordle-style share line), Endless Derby (high score), coins → card packs
→ a 72-card album of fictional riso-printed players (with ultra-rare *Misprint* variants), bats and ink sets to
unlock, XP levels, a Scorebook of achievements and lifetime stats, an *On Fire* hit streak.

## Files and owners

Modules are plain scripts (no ES modules) concatenated in this order by `tools/build.js` into `index.html`.
Everything lives on the global `BB`. A module may reference earlier modules at load time and any module at
call time. Do not edit files you do not own; if you need something from another module, code against this
contract and note the assumption in your report.

| File | Global | Owner |
|---|---|---|
| `src/00-const.js` | `BB.K`, `BB.INKS`, `BB.INKSETS`, `BB.FONTS`, `BB.U` | lead (read it!) |
| `src/10-pitch.js` | `BB.Pitch` | physics agent |
| `src/15-bat.js` | `BB.Bat` | physics agent |
| `src/20-content.js` | `BB.Content` | rules agent |
| `src/25-rules.js` | `BB.Rules` | rules agent |
| `src/30-riso.js` | `BB.Riso` | render agent |
| `src/35-scene.js` | `BB.Render` | render agent |
| `src/38-cards.js` | `BB.CardArt` | render agent |
| `src/40-audio.js` | `BB.Audio`, `BB.Haptics` | audio agent |
| `src/50-save.js` | `BB.Save` | meta agent |
| `src/55-meta.js` | `BB.Meta` | meta agent |
| `src/56-ui.js` | `BB.UI` | meta agent |
| `src/shell.head.html`, `src/shell.body.html` | CSS + DOM | meta agent |
| `src/60-main.js` | `BB.Game` | lead |
| `tools/build.js`, `sw.template.js`, manifest, icons, workflow | | lead |

Each agent may add its own test/harness files under `tools/` (prefix them with the module name, e.g.
`tools/test-physics.js`, `tools/harness-render.html`) and must not touch others'.

`node tools/build.js` builds whatever modules exist (missing ones are skipped with a warning).
Code style: ES5-ish plain functions are fine, ES2017 is fine (Safari 16+). `"use strict"` is applied to the whole
bundle. No external libraries. No `import`/`export`. Wrap each module in an IIFE that assigns its global.

## World coordinates (feet) — shared by physics, rules, render

- Origin: centre of home plate; the strike-zone plane is `y = 0`.
- `+y` toward the pitcher and centre field; `+x` toward the first-base side (catcher's right); `+z` up.
- Strike zone: `|x| <= K.ZONE.xMax`, `K.ZONE.zMin <= z <= K.ZONE.zMax`; a pitch is a strike if the ball
  (radius `K.BALL_R`) touches that box when it crosses `y = 0`.
- Bases: `K.BASES[0..3]` = home, 1B, 2B, 3B in field coords (x, y).
- **Spray angle** (degrees): 0 = straight to centre field, negative = toward left field (third-base side),
  positive = toward right field. Foul lines at ±`K.FOUL_DEG` (45). Point at distance d: `x = d·sin φ`, `y = d·cos φ`.
- The hero is a **right-handed** hitter standing at `x ≈ K.BATTER_X` (third-base side). Pull side = left field
  = negative spray. Early swing → pull (negative spray); late swing → opposite field (positive spray).

## Time

- Game time is in seconds and runs at 1×. Pitch time `t = 0` is the ball leaving the pitcher's hand.
  The windup lasts `K.WINDUP` seconds before that (main tracks it; render receives windup progress).
- Pitch flight times are **slowed for playability**: a 95 mph fastball takes about 0.70 s to the plate, an
  80 mph changeup about 0.85 s, a 55 mph eephus about 1.3 s. Displayed mph stays realistic.
- `timingErr = (swingStart - latencyComp + K.SWING_LAG) - pitch.T`. Negative = early. Main computes it.

## Data shapes

```js
Pitcher = {
  id: 'p_knuckles', name: 'Knuckles McGee', nick: 'The Butterfly', hand: 'R'|'L', team: 'string',
  velo: 88,                       // fastball mph; other pitches scale from it
  arsenal: { FB: .5, SL: .3, CH: .2 },   // weights; keys from BB.Pitch.TYPES
  control: 0..1,                  // higher = more strikes, better edges
  stuff: 0..1,                    // break multiplier
  boss: bool,
  look: { build: 'tall'|'stout'|'lanky', hair: 'none'|'beard'|'mustache'|'sideburns', windup: 'classic'|'sidearm'|'submarine'|'highkick', number: 27 },
  bio: 'one line of flavour',
}

Park = {
  id: 'p_mudville', name: 'Mudville Grounds', town: 'Mudville', inkset: 'classic' (BB.INKSETS id, the park's default press),
  fence: [ [spray, dist, height], ... ],   // sorted by spray from -45 to 45; render & physics interpolate linearly
  features: { scoreboard: bool, lights: bool, billboard: 'text', water: 'none'|'left'|'right'|'center', hill: bool, skyline: 'barns'|'city'|'pines'|'harbor'|'desert'|'none' },
  flavor: 'one line',
}

Pitch = {                         // returned by BB.Pitch.make
  id: 0,                          // index within the game
  type: 'FB'|'SI'|'CT'|'SL'|'CB'|'CH'|'SP'|'KN'|'EE'|'SC',
  name: 'Slider', mph: 86,
  T: 0.78,                        // seconds from release (t = 0) to crossing y = 0
  release: {x, y, z},
  plate: {x, z},                  // where it crosses y = 0
  strike: true,                   // in the zone (with ball radius)
  // any private fields you need, prefixed with _
}

Bat = { id: 'b_hickory', name: 'Old Hickory', timing: 1.0, power: 1.0, lift: 0, desc: '...' }
  // timing = multiplier on every timing window; power = multiplier on exit velocity (keep within 0.9–1.12);
  // lift = degrees added to launch angle.

SwingResult = {                   // returned by BB.Bat.swing
  contact: bool,
  label: 'PERFECT'|'GREAT'|'GOOD'|'EARLY'|'LATE'|'WAY EARLY'|'WAY LATE'|'WHIFF',
  timingErr: -0.03,               // echo
  quality: 0..1,                  // 1 = barrel
  sweet: bool,                    // perfect barrel (triggers hit-stop and the big crack)
  ev: 104,                        // exit velocity mph (0 when no contact)
  la: 27,                         // launch angle deg
  spray: -12,                     // deg
  power: bool,                    // was a power swing
  chase: bool,                    // swung at a ball out of the zone
}

Play = {                          // returned by BB.Bat.play — a batted ball, fully pre-computed and animatable
  type: 'HR'|'1B'|'2B'|'3B'|'OUT'|'FOUL',
  outKind: 'fly'|'line'|'ground'|'pop'|null,
  ev, la, spray,
  dist: 412,                      // ft: carry distance (HR / fly) or where a grounder was fielded
  landing: {x, y},
  apex: 98,                       // ft
  dur: 3.2,                       // seconds the field-view animation should run (>= K.FIELD_MIN)
  hang: 4.1,                      // seconds until the ball lands / is caught
  ballAt(t) -> {x, y, z},         // t in [0, dur]; ball position (keep returning a sensible point after it is fielded:
                                  //  the ball is in the fielder's glove, then thrown toward a base)
  fielders: ['P','C','1B','2B','SS','3B','LF','CF','RF'],
  fielderAt(i, t) -> {x, y},      // field position of fielder i at time t
  catchBy: i|-1, catchT: s|-1,    // who fields/catches it and when
  desc: 'Deep fly to left-center... GONE!',  // short radio-call line
  wall: bool,                     // ball hit the wall (for a clang + dust effect)
}

Event = {                         // returned by every BB.Rules step
  call: 'BALL'|'STRIKE'|'FOUL'|'WALK'|'K'|'HR'|'1B'|'2B'|'3B'|'OUT'|'DP'|'SF',   // SF = sacrifice fly
  runs: 0, outs: 0,               // added by this event
  runnerMoves: [ {from: 0..3, to: 1..4}, ... ],   // 0 = batter at home, 4 = scored; also include runners thrown out as {from, to: -1}
  text: 'STEE-RIKE!',             // headline (stamp)
  sub: '0-2 count',               // subline
  over: bool,                     // the game just ended
  win: bool|undefined,            // when over
}

GameResult = {                    // BB.Rules.result(state)
  mode: 'tour'|'daily'|'derby', win: bool, stars: 0..3, score: number, scoreLabel: '7 HR · 2,904 ft',
  headline: 'WALK-OFF!', stats: { pitches, swings, contact, hits, hr, k, bb, runs, longest, maxEV, perfects },
  share: 'string or null',        // daily only: text to copy
  log: [ ... ]                    // per-swing summary used for the share grid
}
```

## Module APIs

### `BB.Pitch` (10-pitch.js — physics agent)
- `TYPES`: `{ FB: {name:'Fastball', abbr:'FB', ...}, ... }` for all ten type keys.
- `make(pitcher, ctx, rng) -> Pitch` where `ctx = { balls, strikes, derby: bool, id }`. Chooses type from the
  arsenal, a target from control and count (more chase pitches when ahead, more strikes when behind; in derby
  mode ~85% of pitches are in the zone and most are hittable), adds break by type × stuff, and returns a pitch
  whose trajectory crosses `plate`. Must only consume `rng` (never `Math.random`), so a seeded rng gives a
  reproducible sequence.
- `pos(pitch, t) -> {x,y,z}` valid for `t` in `[0, T + 0.5]`. Breaking balls should *look* like they break
  late. After crossing the plate the ball continues to the catcher's mitt (about y = -3) and stays there.
- `isStrike(pitch)`.

### `BB.Bat` (15-bat.js — physics agent)
- `swing(pitch, timingErr, bat, opts) -> SwingResult`; `opts = { power: bool, rng }`. Timing windows (before the
  bat multiplier): perfect ±0.018 s, great ±0.035, good ±0.06, contact ±0.10; power swing scales windows by 0.75
  and gives +8% EV, +5° LA. Out-of-zone pitches: windows × 0.7 and quality capped (chasing is weak). Low pitches
  tend to grounders, high pitches to flies/pop-ups. Breaking/off-speed type affects nothing here except via the
  pitch's real location and `T` (the player must time it).
  Tuning target: an average-skill player with a PERFECT power swing on a middle-middle fastball hits a home run
  in a normal park about 80% of the time; a GOOD contact swing gives mostly line drives and grounders;
  EARLY/LATE give pulled/opposite-field balls and fouls.
- `play(swing, park, rng, opts) -> Play` with `opts = { bases: [bool,bool,bool], outs }`. Ball flight with
  drag and gravity (reasonable carry: 105 mph @ 28° ≈ 400 ft). Foul if it lands (or is fielded) outside ±45°.
  Fielders start at standard depth and run at ~27 ft/s with a short reaction delay; a fly is caught if a fielder
  can reach the landing spot before it lands; grounders are fielded unless hit hard through a hole; doubles and
  triples go to gaps and the corners and over outfielders' heads. Home run if it clears the fence height at the
  fence distance for its spray. Infield fly/pop-ups are caught.
- `fenceAt(park, spray) -> {dist, height}`.
- `FIELDERS`: default positions `{ P:{x,y}, C:..., ... }`.

### `BB.Content` (20-content.js — rules agent)
- `PARKS` (6), `PITCHERS` (~24 incl. 6 bosses + a few derby/daily throwers), `TOUR` = array of 6 chapters
  `{ id, title, park, blurb, games: [Game × 5] }` where the 5th game of each chapter is the boss.
- `Game = { id: 't1g1', title: 'Opening Day', pitcher: id, park: id, scenario: Scenario, blurb }`
- `Scenario` kinds (rules agent defines the full set and the star thresholds), at least:
  - `inning`: score `need` runs before `outs` outs, optional `bases` start and `count` start. "Bottom of the 9th, down 2."
  - `derby`: hit `need` home runs before `outs` outs.
  - `hits`: get `need` hits from `pitches` pitches.
  - `onbase`: reach base `need` times before `outs` outs (walks count).
  - `distance`: total home-run distance ≥ `need` ft before `outs` outs.
  Each scenario has `stars: [s1, s2, s3]` thresholds on some measure and a one-line `goal` text.
- `getPitcher(id)`, `getPark(id)`, `getGame(id)`.

### `BB.Rules` (25-rules.js — rules agent)
- `create(mode, cfg) -> state`. `mode` = `'tour'` (cfg = Game), `'daily'` (cfg = `dailyCfg(dayKey)`),
  `'derby'` (cfg = `{}` → endless home-run derby: 10 outs; any swing that is not a home run is an out, takes are
  free; score = HRs, tiebreak distance).
- `dailyCfg(dayKey) -> cfg` deterministic from the date: pitcher, park, 10 outs, seed. Daily pitches must be the
  same for everyone: pitch `i` of the day depends only on (seed, i), not on what the player did.
- `nextPitch(state) -> Pitch` (calls `BB.Pitch.make` with the state's rng / pitcher / count).
- `take(state, pitch) -> Event` (ball / called strike / walk / strikeout).
- `whiff(state, pitch, swing) -> Event` (swinging strike / strikeout; in derby modes, an out).
- `inPlay(state, pitch, swing, play) -> Event` (foul, hit, out, double play, sac fly, home run; runner
  advancement; game end). Foul with 2 strikes = no change (except derby: out).
- `hud(state) -> { balls, strikes, outs, outsMax, bases:[b,b,b], inning: 'BOT 9', score: '2–4', goal: 'Score 3 to win',
  progress: '1 / 3', streak: n }` — whatever render needs to draw the scoreboard.
- `result(state) -> GameResult`. `isOver(state)`.
- `state.streak`: consecutive hits (resets on an out / K); 3+ = **On Fire** (render floods ink, crowd roars).
- `state.rng`: the seeded rng the game uses (main also passes it to `BB.Bat`).

### `BB.Riso`, `BB.Render`, `BB.CardArt` (30/35/38 — render agent)
- `BB.Riso`: the print engine. Offscreen layer per ink slot, halftone pattern helpers (`tone(level)` patterns
  per slot), misregistration offsets, grain texture, `multiply` compositing onto paper. Reusable by card art.
- `BB.Render.init(canvas)`; `BB.Render.resize(cssW, cssH, dpr)`; `BB.Render.setInks(inkset)`.
- `BB.Render.frame(view)` draws one frame. `view`:
  ```js
  { scene: 'bat'|'field'|'title',
    time,                 // seconds since load (for idle animation, crowd shimmer, flag wave)
    park, pitcher, bat,   // objects above
    windup: 0..1|null,    // windup progress (bat scene), null when not winding
    pitch, pitchT,        // current Pitch and seconds since release (or null)
    swing: { t, result, power } | null,   // t = seconds since swing started
    loading: 0..1|null,   // power swing being held (bat coils back)
    assist: bool,         // draw the "read" ring where the pitch will cross (shown from ~45% of the flight)
    play, playT,          // field scene: Play and seconds since contact
    runners: [ {from, to}, ... ],  // field scene: runner moves to animate across play.dur; bases scene shows hud.bases
    hud,                  // BB.Rules.hud(state)
    stamp: { text, sub, t, kind: 'good'|'bad'|'neutral'|'huge' } | null,  // t = seconds since shown
    onFire: bool, shake: 0..1, hitstop: bool,
    last: { mph, name } | null,   // last pitch speed & type (tiny scoreboard readout)
  }
  ```
  Bat scene: camera behind the plate, a little above the catcher's head, looking out at the mound; pitcher in
  the middle distance with the park's fence, scoreboard and skyline behind; the right-handed batter on the left;
  faint dotted strike zone; ball grows as it approaches with a short riso motion trail; swing animation; on
  contact the ball leaves the frame and main switches to the field scene. Field scene: a high three-quarter
  view of the whole park (riso map-like), ball arc with dotted trail and shadow, fielders as little stamped
  figures, runners, fence; camera follows the ball for long hits. HUD (canvas, riso-styled): count dots, outs,
  base diamond, score / goal / progress, last pitch mph. Stamps: giant misregistered word (`DINGER!`,
  `STEE-RIKE!`, `FROZEN ROPE`, `WHIFF`) that thunks in and fades. On Fire: the background gets a flood of slot-B
  halftone and flame-ish shapes. Keep the HUD clear of `env(safe-area-inset-*)`: top ~50 px and bottom ~34 px.
  Leave the top-right 56×56 px free for the DOM pause button.
- `BB.Render.screenToPlate(sx, sy) -> {x, z}` and `plateToScreen(x, z) -> {x, y}` (CSS px; bat scene camera).
- `BB.Render.title(view)` is just `frame({scene:'title', ...})`: an animated title backdrop drawn behind the DOM
  menus (a park at dusk, slowly drifting misregistration).
- `BB.CardArt.draw(canvas, card, opts)` draws a trading card (portrait 5:7) for the album / pack opening;
  `card = { id, name, pos, team, teamColorSlot, number, rarity: 'common'|'rare'|'foil'|'misprint', seed, inkset,
  stat: 'string' }`. Same seed → same art (pose, face, cap, background pattern). Misprint = huge
  misregistration, wrong-ink-drum swap, double-hit. `BB.CardArt.drawBat(canvas, bat)`, `BB.CardArt.drawInkset(canvas,
  inkset)`, `BB.CardArt.drawPitcher(canvas, pitcher)` (portrait for the pre-game screen), `BB.CardArt.drawPark(canvas, park)`.
  These may draw at any canvas size and must be cheap enough to draw ~20 in a frame for the album grid.

### `BB.Audio`, `BB.Haptics` (40-audio.js — audio agent)
All synthesized with Web Audio; no files. Must never throw if audio is unavailable.
- `unlock()` (call from the first user gesture), `setMuted(bool)`, `isMuted()`, `setMusic(bool)`.
- `sfx(name, opts)`: `crack` (`{quality 0..1, sweet}`), `foul`, `whiff`, `mitt` (`{mph}`), `whoosh` (`{mph}`),
  `strike`, `ball`, `out`, `wall`, `stamp`, `tap`, `coin`, `packRip`, `cardFlip`, `rare`, `unlock`, `levelUp`,
  `error`, `toast`, and the cartoon set `boing` (`{f}`), `slide` (`{dir:'up'|'down', dur}`), `bonk`, `zip` (`{mph}`), `xylo`, `honk` (`{n}`), `pop`, `twinkle` (`{dur}`), `kablam`, `splat`. Every sfx accepts `{when}` (delay in seconds).
- `crowd(level 0..1)` continuous crowd bed (call every frame or on change; smooth internally);
  `cheer(size 0..1)`, `groan()`, `organ(name)` with names `charge`, `homer`, `walkup`, `win`, `lose`, `rally`,
  `sneak` (full-count tiptoe cue), `iris` (scene-end sting), `menu` (a short looping ballpark-organ menu tune; `organ('stop')` stops it).
- `BB.Haptics.tap()`, `.thud()`, `.buzz()` (navigator.vibrate where available; no-ops otherwise).

### `BB.Save`, `BB.Meta`, `BB.UI` (50/55/56 + shell — meta agent)
- `BB.Save`: `localStorage` key `halftone.v1`, in-memory fallback when storage throws; `get()`, `set(patch)`,
  `commit()`.
- `BB.Meta`:
  - `BATS` (≥ 8: e.g. Old Hickory default, a contact bat with wider windows / less power, a power bat with
    narrow windows, a lift bat, a corked joke bat...), `INKSETS` unlock rules over `BB.INKSETS`, `CARDS` (72,
    generated deterministically: 6 teams = one per park × 12 players; names generated from syllable lists),
    rarities and packs.
  - `currentBat()`, `currentInkset()` (the player's chosen press; `'park'` default means use the park's inkset),
    `settings()` (`sound`, `music`, `haptics`, `assist`, `latencyMs`).
  - `onEvent(ev)` live stat/achievement tracking, called by main after every pitch event with
    `{ mode, event: Event, swing: SwingResult|null, play: Play|null, pitch }`. Returns newly earned
    achievements `[{id, name, desc}]` (main toasts them via `BB.UI.toast`).
  - `endGame(mode, cfg, result) -> Rewards = { coins, xp, levelBefore, level, newAch: [], unlocks: [{kind, id,
    name}], tourStars, best: bool, daily: { streak, played } }`, saves.
  - Tour progress (stars per game, chapter unlocks: chapter n+1 opens with 8 stars in chapter n... rules for
    meta agent to decide), daily record (results by dayKey, streak, best), derby best.
- `BB.UI`: DOM screens over the canvas (riso-styled CSS: offset double-printed text, halftone backgrounds via
  CSS gradients, multiply blending). Screens: title (Play Tour / Daily Derby / Endless Derby / Cards / Locker /
  Scorebook / Settings), tour map, pre-game briefing (pitcher portrait card, park, goal, stars), pause menu,
  results (stars, score, rewards, share button for daily, next / retry), card shop & pack opening, album,
  locker (bats, ink sets), scorebook (stats, achievements, daily calendar strip), settings, first-run how-to.
  Toasts. A DOM pause button (top right, safe-area aware) during play.
  - `BB.UI.init()`, `BB.UI.show(name, data)`, `BB.UI.hideAll()`, `BB.UI.toast(text, kind)`, `BB.UI.inGame(bool)`.
  - UI starts games by calling `BB.Game.start(mode, cfg)` and pauses with `BB.Game.pause()` /
    `BB.Game.resume()` / `BB.Game.quit()`.
  - Main calls `BB.UI.show('results', { mode, cfg, result, rewards })` at game end.

### `BB.Game` (60-main.js — lead)
Boot, resize, fixed loop, input (pointer events on the canvas), state machine
(`menu → pregame → windup → pitch → field → between → … → results`), stamps / hit-stop / shake, wiring
of Rules → Bat → Meta → Audio → Render. `start(mode, cfg)`, `pause()`, `resume()`, `quit()`, `running()`.
Test hooks on `window.__bb`.

## Input (main)
- Tap during the pitch's flight → contact swing at that instant.
- Press during the windup and hold → loading a power swing (`view.loading` rises 0→1 over 0.35 s); release
  during the flight → power swing at the moment of release; release before the pitch is out → cancel.
- One swing per pitch. Taps during the field view skip ahead.

## Done means
Your module loads in the concatenated bundle without errors, implements the API above, has a self-test or
harness you ran, and you report: what you built, any deviations from this contract, and anything other modules
need to know.
