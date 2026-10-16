# Screwball Slugger

A one-tap baseball batting game for iPhone, drawn as a classic theatrical cartoon in 3D.

You stand in behind the plate. The pitcher winds up and lets go: **tap to swing**. Timing is everything. On time
finds the barrel, early pulls it to left, late slaps it to right, and way off is a whiff or a foul. Lay off the
pitches outside the box. **Press and hold during the windup** to load a power swing, then let go to swing: the
window is tighter, the ball goes further.

You're Rocco, a scrappy raccoon slugger, facing a league of animal pitchers: an ox, a loon, a bear called
Sasquatch, a tortoise who throws nothing but eephus pitches. Everything is cel-shaded 3D with ink outlines and
painted mid-century cartoon backgrounds (three.js), with POW!, WHIFF! and KA-BLAM! lettering, iris wipes, dizzy
stars and bat flips. The whole game is one self-contained HTML file with no image or audio files: every park,
character and trading card is built in code, and the bat crack, crowd, slide whistles and pit-band music are
synthesized live with Web Audio.

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
node tools/build.js          # src/ -> index.html, sw.js, dist/halftone.html
python3 -m http.server 8080  # http://localhost:8080 (the service worker needs http)
```

Edit `src/`, then rebuild. Don't edit `index.html` by hand.

| File | Job |
|---|---|
| `src/00-const.js` | World coordinates, timing constants, ink sets, utilities |
| `src/10-pitch.js` | Pitch types, pitch selection by count and control, trajectories with late break |
| `src/15-bat.js` | Swing timing windows, exit velocity and launch angle, ball flight, fielders, outcomes |
| `src/20-content.js` | The six parks, 27 pitchers and the 30-game tour |
| `src/25-rules.js` | Count, outs, bases, runner advancement, scenarios, stars, daily derby, share text |
| `src/vendor/three.min.js` | three.js r149 (MIT), vendored so the game works offline |
| `src/31-toon.js` | Cel materials, ink outlines, geometry merging, painted scenery helpers |
| `src/32-cast.js` | The animal cast: species, faces, uniforms, rigs, bat and ball |
| `src/33-park.js` | The six 3D ballparks and their set dressing |
| `src/34-anim.js` | Character acting: windups, swings, whiffs, reactions |
| `src/35-scene.js` | Cameras, bat view, field view, title, HUD, comic lettering, iris wipes |
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

Built from a single prompt. A lead agent wrote the module contract and the game loop, then physics,
rules & content, render, audio, and meta & UI sub-agents built their modules in parallel against it, and the lead
integrated and tested the result in iPhone emulation.
