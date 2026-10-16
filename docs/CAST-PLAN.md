# The modelled cast: plan and decisions

The Rocco pilot (docs/PILOT-ROCCO.md) was approved. The user's decisions for the build-out:
- **Keep every character's full multi-part, multi-material build.** Do not merge characters into one or two
  draw calls or atlas their materials. Protect frame rate with the other levers below.
- **Yes** to: a shared skeleton and shared animation libraries per role, distinct characters built from parts
  (species heads, body builds, tails/horns/beaks/shells, uniforms, accessories), fully custom bosses, compressed
  models, unpacking only what the next game needs, per-park loading, and simpler versions for distant fielders.
- Order: one more pass on Rocco (phase A), then build out the rest of the cast (phase B).

## Single sources of truth
- **Species:** `pitcher.species` in `src/20-content.js` (same table the trading cards use). Team rosters and
  species come from the cards: `BB.Meta.CARDS` (72 players, 12 per team, with position, species and fur colours)
  and `BB.CardArt.TEAM_SPECIES`. The 3D fielders for a park are that park's card players by position, so the album
  shows the same characters you face. 44 species in total.
- **Skeleton:** Rocco's 42-bone rig (`tools/blender/rk_rig.py`, names in docs/PILOT-ROCCO.md). Every biped in the
  cast uses the same bone names so animation clips are shared; bone lengths may differ per body build. Optional
  bones (tail.*, ear.*, jaw, cap, fingers) may be absent on species that lack them.

## Phase A: Rocco, second pass (in progress)
Modeler: open four-finger cartoon gloves with rolled cuffs (posable fingers; wrap the bat in the grip, open in
reactions), softer cheek tufts (no fins from behind), smoother knee and elbow bends, clearer mouth shapes, and
reactions acted toward the game camera (whiff ending and dizzy facing the catcher side, strike_react glaring back at
the umpire, a `glance` and a `ritual` pre-pitch routine clip). Integration: use the new clips, clean up the swing
smear effect, fix foot sliding, and build the asset pipeline phase B needs (below).

## Asset pipeline (built in phase A, used by everything after)
- **Compression:** `gltfpack -cc` (meshopt) via `tools/pack-assets.js`; `THREE.MeshoptDecoder` is vendored in
  `src/vendor/three-addons.js`. Measured on Rocco: 946 KB → 282 KB file, about 140 KB over the wire.
- **Loading:** `BB.Assets.get(name) -> Promise<ArrayBuffer>`. Rocco and anything needed on the title screen stay
  inlined in the page. Everything else ships as separate files under `assets/` next to `index.html`, fetched when a
  game needs them (the pre-game briefing starts the fetch and parse), and pre-cached in the background by the
  service worker after the first launch so the game still works offline. The Pages workflow publishes `assets/`.
- **Parse on demand:** nothing but Rocco is parsed at boot; a game's pitcher, catcher, umpire and fielding team are
  parsed while the briefing is up, and released after the game.
- **Level of detail:** each character can ship `LOD0` (close-ups: batter, pitcher, catcher, umpire, title) and
  `LOD1` (about 3k triangles for distant fielders and runners). Same rig, same materials, same clips.

## Phase B: the build-out (after phase A)
1. **Cast generator** (Blender, from Rocco's SDF pipeline): parametric body builds (height, stoutness, belly,
   limb length, shoe size, tail type), uniforms by team colour, a head-kit contract so species heads plug in, LOD0
   and LOD1 output, per-character build caching, packing.
2. **Species heads** for all 44 species (in parallel batches by team), each with the shared shape keys, appeal
   checked from the game cameras and as a card-style portrait.
3. **Animation libraries** on the shared skeleton: pitcher (set, the four windup styles with an exact release
   frame, follow-through, reactions), catcher (crouch, receive by location, throw back), umpire (stance, punch-out,
   safe/out), fielder (ready, run, catch fly, field grounder, throw, celebrate). Each pitcher may get one signature
   clip.
4. **Characters:** 27 pitchers (6 bosses fully custom), 6 catchers, the umpire, 54 fielders (LOD1), Rocco's three
   teammates as runners.
5. **Runtime:** a general actor system (from `BB.Rocco`) with role drivers, LOD switching, and per-game loading.
