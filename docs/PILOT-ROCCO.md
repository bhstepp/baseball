# Pilot: Rocco, rebuilt properly

The user likes the cartoon direction but says the characters "feel AI generated and are missing details like
feet". Diagnosis of the current procedural cast (src/32-cast.js): characters are piles of spheres and capsules, so
shoulders show as balls, there are no necks/wrists/ankles, legs end in points (no shoes), hands are mitten blobs,
Rocco's tail is a stack of beads, his ears stab through the helmet, there is one even outline around the silhouette
and nothing inside it, and the motion is perfectly smooth 60 fps procedural tweening.

The pilot rebuilds **Rocco only**, three ways at once, so the user can judge before we do the rest of the cast:
1. **A real model** built in Blender (scripted, reproducible), rigged, with hand-keyed animation clips, exported as
   `assets/rocco.glb` and inlined into the page by `tools/build.js`.
2. **A hand-inked look**: ink lines inside the silhouette (where the arm crosses the body, the cap brim, fingers,
   shoes), varying line weight, a slight hand-drawn boil, characters animated "on twos", light paper grain and a
   warm old-film grade. Lines only on characters and props, never on the painted backgrounds (docs/STYLE.md).
3. **Better staging**: Rocco fully on screen with his cleats planted, a smaller catcher, a bigger pitcher.

Everything else (pitchers, fielders, parks, menus) stays as it is for the pilot. The procedural Rocco stays in the
code as the fallback when the model is missing or fails to load.

## Who does what

| Part | Owner | Files |
|---|---|---|
| Model, rig, face shapes, animation clips | modeler agent | `tools/blender/rocco.py`, `assets/rocco.glb`, `tools/rocco-viewer.html`, `tools/rocco-shots.js` |
| Loading, toon materials, outlines on skinned meshes, the clip state machine, staging/cameras | integration agent | `src/36-rocco.js` (new, `BB.Rocco`), `src/35-scene.js`, `src/32-cast.js`, `src/34-anim.js`, `tools/render-*` |
| Ink pass, line boil, paper grain, grade, on-twos helper, adaptive quality | ink agent | `src/37-ink.js` (new, `BB.Ink`), `tools/ink-*` |
| Build, vendoring, this doc | lead | `tools/build.js`, `src/00-const.js`, `src/vendor/*` |

Already in place (lead):
- `THREE.GLTFLoader` and `THREE.SkeletonUtils` (three r149 addons) in `src/vendor/three-addons.js`, loaded right
  after `three.min.js`.
- `tools/build.js` inlines every `assets/*.glb` as base64 into `window.BB_ASSETS`; `BB.assetBuffer('rocco')`
  returns its ArrayBuffer (or `null`). Load with `new THREE.GLTFLoader().parse(buffer, '', onLoad, onError)`.
- `src/35-scene.js` calls `BB.Ink.render(renderer, scene, camera, {scene, time, hitstop})` instead of
  `renderer.render` whenever `BB.Ink && BB.Ink.active()`, and `BB.Ink.resize(renderer, w, h, pixelRatio)` on resize.
- Build order: `… 35-scene.js, 36-rocco.js, 37-ink.js, 38-cards.js …`.
- Blender 5.2 as a Python module: `/tmp/claude-0/-home-user-baseball/e086ca28-dde3-50e9-80c9-4a0eb9596465/scratchpad/bpyenv/bin/python`
  (`pip install bpy==5.2.2` on Python 3.13 recreates it). glTF export works. Blender's own renderers do **not** work
  here (no EGL/GPU), so preview models in Chromium with three.js.

## Conventions shared by everyone

- **Layer 1 = inked.** Every mesh that should get hand-inked lines (characters, their clothes and gear, the bat, the
  ball) has `object.layers.enable(1)` (it stays on layer 0 too). Backgrounds, crowd, sky and park sets are layer 0
  only. The ink pass draws lines from a normals/depth pass of layer 1.
- **On twos.** `BB.Ink.twos(t)` returns `t` quantised to 1/12 s (when the ink look is on) so character *acting*
  (idle, dizzy, cheers, trots, pitcher windups) holds each pose for two frames like hand-drawn animation. Fast action
  (the swing itself, the ball, cameras, effects) stays on ones.
- **Units:** feet. Game world is Z-up (+y to the pitcher, +x to first base). Characters are built Y-up facing +Z in
  their own space (see the header of `src/32-cast.js`); glTF is Y-up with the model's front facing +Z, which is what
  Blender's exporter produces for a model that faces Blender's -Y. Keep it that way.

## The Rocco asset contract (`assets/rocco.glb`)

### Design brief (an original character; see docs/STYLE.md legal rules)
Rocco is a scrappy, cocky-but-lovable raccoon slugger from a 1940s–50s theatrical cartoon. Design him like a
studio model sheet, with deliberate shape language, not assembled primitives.
- **Size and proportions:** 5.0 ft from the soles to the top of the cap. The head (with cap) is about a third of
  his height. Pear-shaped body: narrowish chest, rounder belly and seat, short legs with **big feet**, long noodle
  arms that taper to small wrists. Every part flows into the next: a neck under the head, tapered wrists and
  ankles, a waist, no visible ball joints.
- **Head:** a broad, slightly squashed skull with a cream muzzle that juts forward, a small black button nose on
  the tip, a big expressive mouth line, two triangular fur tufts sweeping back from the cheeks. The **bandit mask**
  is a dark domino band across the eyes. Big tall oval eyes (white with large black pupils and a highlight) sit
  inside the mask so they read. Cream eyebrows above the mask carry the emotion.
- **Ears:** rounded triangles with cream inners and dark rims, coming out through **slots in the cap**, not
  through solid cloth.
- **Cap:** a 1940s six-panel ball cap in team colour (`team_a`) with a short brim, a top button and visible panel
  seams. (No batting helmet; the cartoon cap is the look.)
- **Uniform:** baggy 1940s flannels in cream-white (`uniform`). Button-front jersey with team-colour piping down
  the placket and around the collar and sleeve ends (`team_a`), short sleeves over team-colour undersleeves
  (`team_a`), a big chest letter "R" (a separate decal plane, material `decal_chest`) and number 7 on the back (decal
  plane, `decal_back`). A dark belt (`belt`) with a buckle. Blousy knickers that end just below the knee, then
  **stirrup socks** (team-colour stirrups `team_a` over white sanitary socks `sock`).
- **Shoes:** big, bulbous, unmistakably cartoon **cleats**: black uppers (`shoe`), a rounded toe cap, white laces
  (`lace`), a sole (`sole`) with a few small spikes. This is a must-have silhouette element.
- **Hands:** white cartoon **four-finger gloves** (three fingers and a thumb, `glove`) with a rolled cuff. Fingers
  are modelled so they wrap around the bat handle.
- **Tail:** a big, bushy, **ringed** tail (5–6 alternating grey/dark rings) coming out of a slot in the knickers,
  one continuous tapered fluffy shape with an S-curve. Not beads.
- **Bat:** a classic wooden bat, barrel slightly exaggerated, knob at the end, team-colour tape on the handle
  (`bat_wood`, `bat_tape`). It is part of the rig on its own bone so it can be swung, flipped and hidden.
- **Colours (base values; the game recolours team materials from the uniform scheme):** fur `#9A97A6`, light fur
  `#F2EDE3`, mask/dark `#2E2A38`, nose `#1B1420`, eye white `#FFFFFF`, pupil `#1B1420`, uniform `#FFF6E6`,
  team_a `#2E5AAC`, team_b `#D9483B`, belt `#3B2F2A`, shoe `#1E1A22`, sole `#4A3F3A`, lace `#FFFFFF`, glove
  `#FFFFFF`, bat_wood `#D9A066`, bat_tape `#2E5AAC`, mouth `#5A1F2A`, tongue `#E0605A`.

### Technical rules
- One skinned body mesh (or a few skinned meshes sharing the armature) plus the bat. **≤ 15k triangles** total,
  quads/tris only, smooth shading with sharp edges where cartoons would have them, normals outward, closed
  shapes (the outline technique needs them), no tiny interpenetrating slivers.
- **Materials** are flat colour (no textures), named exactly: `fur`, `fur_light`, `mask`, `nose`, `eye_white`,
  `pupil`, `mouth`, `tongue`, `uniform`, `team_a`, `team_b`, `belt`, `sock`, `shoe`, `sole`, `lace`, `glove`,
  `bat_wood`, `bat_tape`, `decal_chest`, `decal_back`. The game swaps each for a toon material by name.
- **Origin** on the ground between the feet; he faces glTF +Z (Blender -Y); his right hand is the top hand on the
  bat (right-handed hitter). Rest pose: A-pose is fine; the clips define the poses.
- **Armature** (≤ 45 bones, ≤ 4 weights per vertex). Required bone names (others allowed):
  `root, hips, spine, chest, neck, head, jaw, ear.L, ear.R, eye.L, eye.R, brow.L, brow.R, tail.1 … tail.5,
  shoulder.L/R, upper_arm.L/R, forearm.L/R, hand.L/R, thigh.L/R, shin.L/R, foot.L/R, toe.L/R, bat`.
  `bat` is the bat's bone (the bat mesh is weighted 100% to it). Add empties/bones `bat_sweet` (barrel sweet spot)
  and `bat_tip` (end of the barrel), children of `bat`, so the game can find the barrel. Pupils are separate small
  meshes weighted to `eye.L` / `eye.R` so rotating those bones moves the gaze.
- **Shape keys (morph targets) on the head**, all 0..1, named exactly: `blink`, `smile`, `grin` (teeth),
  `frown`, `mouth_open` (shouting O), `brows_up`, `brows_angry`, `brows_sad`, `squint`, `cheeks_puff`.
- **Animation clips** (glTF animations, exported with sampling; names exact). Start and end poses must match where
  noted so clips can chain. Times are in seconds.

| Clip | Length | Loop | What |
|---|---|---|---|
| `stance` | ~2.4 | yes | Batting stance at the plate: weight back, bat up, a cocky bat waggle, breathing, tail sway, a glance at the pitcher. Starts and ends in pose **STANCE**. |
| `stride` | 0.35 | no | At pitch release: small timing stride (front foot lifts and plants), hands load back. STANCE → **SET**. |
| `power_load` | 0.35 | no | Held-tap power load: deep coil, front knee lifted high, chin over shoulder, tail bristles. STANCE → **COIL**. |
| `coil_hold` | ~0.5 | yes | Trembling with stored power, starts/ends in COIL. |
| `swing_high`, `swing_mid`, `swing_low` | ~1.0 | no | From SET through contact to a full follow-through, then settle and watch the ball. The barrel crosses the plate at a **high / middle / low** strike-zone height. **The contact frame is exactly t = 0.25 s** in all three (the game time-warps the first 0.25 s to match the real 70 ms swing, then plays the rest at normal speed). Big arc, hips lead, a smear-like stretch of the arms at 0.18–0.25 s, back foot pivots, tail whips. |
| `whiff` | ~1.4 | no | Starts from SET, misses with a huge swing, corkscrews (full spin, legs twisted), wobbles and ends in pose **DIZZY**. |
| `dizzy` | ~1.6 | yes | Wobbling in place, eyes rolling (rotate `eye.*`), bat drooping. DIZZY → DIZZY. |
| `watch` | ~1.2 | yes | After contact: follow-through held, admiring the ball, leaning toward its flight. |
| `bat_flip` | ~1.3 | no | Homer celebration: flips the bat away end over end (the `bat` bone flies up and away), a cocky strut. |
| `run` | ~0.5 | yes | Cartoon sprint for running the bases: forward lean, big strides, arms pumping, tail streaming. No bat (the game hides it). Root stays in place; the game moves him. |
| `trot` | ~0.8 | yes | Home-run trot: chest out, chin up, one hand tipping the cap. In place. |
| `cheer` | ~1.2 | no | Jump with a fist pump, big grin. |
| `take` | ~0.8 | no | Taking a pitch: watches it into the mitt, small lean back, a nod or shrug. From SET back to STANCE. |
| `strike_react` | ~1.4 | no | Called strike three or a K: stomps, glares at the ump, slumps. Ends in STANCE-ish. |

- Animate with real animation principles: key poses first (anticipation, action, overshoot, settle), strong lines of
  action, arcs, overlapping action on the tail, ears and cap brim. Exaggerate: this is a cartoon.
- Shape-key animation inside clips is welcome (blinks, grin on contact) but the game also drives them itself.
- Build script: `<bpy python> tools/blender/rocco.py --out assets/rocco.glb` must rebuild the asset from nothing,
  deterministically. Write to a temp file and rename, so readers never see a half-written file.
- Size: keep `rocco.glb` ≤ 1.5 MB.

## What the game does with it (integration agent)
- `BB.Rocco` (src/36-rocco.js): parse the glb once at boot (async; if missing or failing, everything falls back to
  the procedural Rocco), swap materials for toon materials (team colours from the uniform scheme), add outlines that
  work on skinned meshes, set layer 1, own an `AnimationMixer`, and expose a small driver that `35-scene.js` calls
  each frame with the game state (stance / stride at release / power load / swing with contact time-warp and
  high/mid/low blend by `pitch.plate.z` / whiff / dizzy / watch / bat flip / run / trot / cheer / take /
  strike_react, face shape keys, gaze at the ball, cap flipped backwards and bat smoking when On Fire).
- Bat-scene staging: Rocco fully visible with his cleats on the dirt, the catcher smaller and lower so he doesn't
  wall off the bottom of the screen, the pitcher larger. `screenToPlate` / `plateToScreen` stay exact.
- Field scene: the glb Rocco runs the bases and trots on homers. Title: idles and takes practice swings.

## Ink look (ink agent)
`BB.Ink` (src/37-ink.js): `active()`, `render(renderer, scene, camera, info)`, `resize(renderer, w, h, pr)`,
`twos(t)`, `setEnabled(bool)`, `quality` / auto-downgrade. Render the scene normally to a target, render layer 1
again into a normals+depth target (lower resolution is fine), detect edges (depth and normal discontinuities and
object boundaries) into ink lines with weight that varies (heavier on outer silhouettes, lighter inside, thinner
with distance), add a subtle per-12-fps boil (noise offset that changes on twos), then composite with a light paper
grain and a warm Technicolor-ish grade, and leave backgrounds unlined. Must hold 60 fps on a recent iPhone: measure
cost, and switch itself off (falling back to plain rendering plus the existing inverted-hull outlines) if frames
run slow. Settings toggle later; for now `BB.Ink.setEnabled` and a `?ink=0` URL flag.
