# Screwball Slugger

A one-tap baseball batting game for iPhone, drawn as a classic theatrical cartoon in 3D.

You stand in behind the plate. The pitcher winds up and lets go: **tap to swing**. Timing is everything. On time
finds the barrel, early pulls it to left, late slaps it to right, and way off is a whiff or a foul. Lay off the
pitches outside the box. **Press and hold during the windup** to load a power swing, then let go to swing: the
window is tighter, the ball goes further.

You're Rocco, a scrappy raccoon slugger, facing a league of 27 animal pitchers across six parks: Earl "The Ox"
Oxley, a 7-foot bear called Sasquatch, a tortoise who throws nothing but eephus pitches, a chameleon in aviators,
and Halo, a vain peacock whose tail fans out behind him like a halo. Every park's home team takes the field: the
catchers, fielders and pitchers are the same characters as the trading cards in your album.

Everything is cel-shaded 3D (three.js) with hand-inked lines, painted mid-century cartoon backgrounds, POW!, WHIFF!
and KA-BLAM! lettering, iris wipes, dizzy stars and bat flips. The characters are real rigged models built in
Blender by scripts in `tools/blender/`, with hand-keyed animation: Rocco has his own clip set (stance, stride, power
load, three swing heights, whiff into dizzy, bat flip, base running, plate-tap ritual), and the rest of the cast
shares pitcher, catcher, umpire and fielder libraries. The bat crack, crowd, slide whistles and pit-band music are
synthesized live with Web Audio; there are no audio files.

The page itself is one HTML file with Rocco built in. Each park's team (about 1.5 MB, compressed with meshopt) is
fetched while the pre-game briefing is open, and the service worker caches the whole cast in the background so the
game works offline.

## Modes

- **Barnstorm Tour.** Six ballparks (zine "issues"), five games each, from Haybale Grounds to Old Cathedral Park.
  Every game is a situation: a walk-off with the winning run on second, bases loaded down three with an 0-2 count,
  a three-homer derby, a distance challenge, "get four hits in sixteen pitches". Earn up to three stars. The fifth
  game of each issue is a boss pitcher, and beating them opens the next park.
- **Daily Derby.** A new home-run derby every day: the same pitcher, park and pitches for everyone. Ten outs; only
  homers count. Keep your daily streak alive and share a spoiler-free result line:
  ```
  Screwball Slugger · Daily #12
  💥💥⚾✖️💥〰️✖️💥⚾✖️
  4 HR · 1,612 ft · 🔥2
  ```
- **Endless Derby.** Ten outs against a pitcher who gets nastier with every homer. Chase your best.

## Between games

- **Card Shop and Album.** Coins from every game buy bubble-gum packs of three trading cards of 72 animal players
  from the six towns: commons, rares, foils, and the ultra-rare *Misprint* variants. Completing a
  team's set unlocks a bat or an ink set.
- **Locker.** Eleven bats, each with its own feel: wider timing windows, more power, more lift. Uniforms change Rocco's team colours.
- **Scorebook.** Lifetime stats, 40 achievement stamps and your daily calendar.
- **On Fire.** Three hits in a row: Rocco flips his cap backwards, his bat starts smoking and the band starts a rally.

## Play it on an iPhone

1. In the GitHub repository go to **Settings → Pages** and set **Source** to **GitHub Actions** (one time).
2. Every push to `main` builds and deploys the game with `.github/workflows/pages.yml`. It will be live at
   `https://<user>.github.io/<repo>/`.
3. Open that address in Safari, tap **Share → Add to Home Screen**, and launch it from the icon. It runs full
   screen and works offline after the first load.

Progress is saved on the device (`localStorage`, key `halftone.v1`, from the game's first name). Sound follows the ringer switch. If swings feel
consistently early or late on your device, use **Settings → Timing** to calibrate.

## Develop

Node 18+ only for the build and tests; the game has no dependencies.

```sh
node tools/build.js          # src/ + assets/ -> index.html, sw.js, dist/site/ (deployable), dist/halftone.html (tests)
python3 -m http.server 8080  # http://localhost:8080 (the service worker needs http)
```

Edit `src/`, then rebuild. Don't edit `index.html` by hand.

### Characters and animation (Blender)

The models are built by Python scripts with Blender 5.2 as a Python module (`pip install bpy==5.2.2` on Python 3.13);
raw exports go to `assets/src/` (not committed) and `tools/pack-assets.js` compresses them into `assets/*.glb`
(committed, shipped).

```sh
python tools/blender/rocco.py                 # Rocco: model, rig, face shapes and his 18 clips
python tools/blender/cast/cbuild.py --park 3  # a park's team (or ids, or --list); LOD0 + LOD1 per character
python3 tools/blender/anim/build.py pitcher   # a shared clip library: pitcher, catcher, umpire, fielder
node tools/pack-assets.js                     # gltfpack (meshopt) + checks: names, clips, contact frames
node tools/cast-shots.js --park 3             # turnarounds, faces, lineups and game-camera sheets to qa/cast/
```

`docs/CAST-CONTRACT.md` describes the shared skeleton, the head kit for adding species, the character files and the
animation libraries; `docs/CAST-PLAN.md` the decisions behind them.

| File | Job |
|---|---|
| `src/00-const.js` | World coordinates, timing constants, ink sets, utilities |
| `src/10-pitch.js` | Pitch types, pitch selection by count and control, trajectories with late break |
| `src/15-bat.js` | Swing timing windows, exit velocity and launch angle, ball flight, fielders, outcomes |
| `src/20-content.js` | The six parks, 27 pitchers and the 30-game tour |
| `src/25-rules.js` | Count, outs, bases, runner advancement, scenarios, stars, daily derby, share text |
| `src/vendor/three.min.js` | three.js r149 (MIT), vendored so the game works offline |
| `src/31-toon.js` | Cel materials, ink outlines, geometry merging, painted scenery helpers |
| `src/30-assets.js` | Loading models: inline or fetched, meshopt decoding, reference-counted parsing |
| `src/32-cast.js`, `src/34-anim.js` | The procedural fallback cast (used for any model that is missing) |
| `src/33-park.js` | The six 3D ballparks and their set dressing |
| `src/35-scene.js` | Cameras, bat view, field view, title, HUD, comic lettering, iris wipes, per-game cast loading |
| `src/36-actors.js` | Character runtime: toon materials, skinned ink hulls, clip retargeting, crossfades, LODs |
| `src/36-rocco.js` | Rocco's driver: game state to clips, swing contact time-warp, face and gaze |
| `src/36-crew.js` | Pitcher, catcher, umpire, fielder and runner drivers lined up with the game's events |
| `src/37-ink.js` | The hand-inked look: ink lines on characters, line boil on twos, paper grain, grade |
| `src/38-cards.js` | Trading cards, pitcher portraits, bats, uniforms, park postcards |
| `src/40-audio.js` | Synthesized bat, crowd, cartoon effects and pit-band music |
| `src/50-save.js`, `src/55-meta.js` | Save data, coins, XP, cards, packs, bats, achievements, tour and daily progress |
| `src/56-ui.js`, `src/shell.*.html` | Every menu screen and the page shell |
| `src/60-main.js` | Loop, input, the at-bat state machine |

`docs/CONTRACT.md` is the module contract the game was built against, and `docs/STYLE.md` the art direction.

### Tests

```sh
node tools/physics-test.js   # pitch determinism and outcome distributions by skill
node tools/rules-test.js     # every tour game simulated, runner bookkeeping, daily determinism
node tools/meta-test.js      # save fallback, cards, packs, achievements, rewards, unlocks
node tools/audio-test.js     # every sound renders, nothing throws without Web Audio
node tools/qa-play.js        # plays every mode on autopilot in iPhone emulation, screenshots to qa/play/
node tools/render-shots.js   # screenshots of every scene, park, ink set and card rarity to qa/render/
```

## Background

Built with Claude Code from a single prompt and a few rounds of feedback. A lead agent wrote the module contracts
and the game loop; sub-agents built physics, rules and content, rendering, audio, and the menus in parallel. After
the first look (a risograph zine) didn't land, the game was re-skinned as a 3D cartoon, then the procedural characters
were replaced by real Blender models: a Rocco pilot first, then a cast generator, shared animation libraries and
three park teams built in parallel, with the lead integrating and testing everything in iPhone emulation.
