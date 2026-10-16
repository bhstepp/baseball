# Cast contract (phase B)

Binding for everyone building or loading the modelled cast. Read with docs/CAST-PLAN.md (decisions),
docs/PILOT-ROCCO.md (Rocco's contract; everything here extends it) and docs/STYLE.md (look and legal rules).

## Who is in the cast
Teams come from the trading cards (`BB.Meta.CARDS`): each park's home team fields its card players by position.

| Park | Team | Pitchers (`pitcher.species`) | Catcher | 1B | 2B | SS | 3B | LF | CF | RF |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 Haybale Grounds | Haybale Junction Hayseeds | hank goat, dottie hen, clem dog, **ox (boss)** | dog | horse | rooster | ox | sheep | goat | cow | goat |
| 2 Rivet Street Bandbox | Ironbridge Rivets | vinnie rat, rosalind pigeon, marty cat, **landlord bulldog** | bulldog | possum | cat | rat | bulldog | possum | possum | possum |
| 3 Loon Lake Pines | Loon Lake Loons | ellis moose, june loon, otis beaver, **sasquatch bear** | deer | squirrel | moose | bear | beaver | squirrel | deer | skunk |
| 4 Gull Point Harbor | Gull Point Gulls | pearl walrus, nils pelican, sully seal, **admiral gull** | otter | gull | walrus | walrus | puffin | otter | seal | gull |
| 5 Saguaro Night Field | Dry Wash Coyotes | rio armadillo, tess tortoise, cosmo possum, **mirage lizard** | fennec | badger | lizard | armadillo | badger | lizard | armadillo | tortoise |
| 6 Old Cathedral Park | Capitol City Copperheads | organist flamingo, belle owl, thunder bison, **halo peacock** | parrot | heron | owl | goose | flamingo | parrot | goose | flamingo |

Plus: derby/daily pitchers bpbob badger, mabel goose, ike squirrel; the umpire (a mole, same for every game);
Rocco's teammates who run the bases (otter, fox, beaver). Fielders and catchers are specific card players: use the
card's `seed` for their individual variation (fur shade, markings, accessories) and its `number` on the jersey, so
the 3D player matches the album card. 40 species in all.

## Skeleton (shared by every biped)
Rocco's rig (`tools/blender/rk_rig.py`) defines the bone names, hierarchy, roll conventions and rest axes. Every cast
member uses the same names so clips are shared. Body builds change bone **lengths and positions**, never names,
parents or rest orientations.
- **Required:** root, hips, spine, chest, neck, head, eye.L/R, shoulder.L/R, upper_arm.L/R, forearm.L/R, hand.L/R,
  fingers.L/R, index/index_2/middle/middle_2/pinky/pinky_2/thumb/thumb_2 .L/.R, thigh.L/R, shin.L/R, foot.L/R, toe.L/R.
- **Optional (species-dependent):** jaw, cap, brow.L/R, ear.L/R, tail.1…tail.5. A clip channel for a missing bone
  is simply ignored at runtime.
- **New sockets (control bones, identity rest rotation):** `grip.R` and `grip.L`, children of hand.R/hand.L at the
  centre of a closed grip (where a ball or bat handle sits). Pitchers hold the ball at `grip.R`; fielders catch at
  the mitt pocket `mitt` (child of hand.L, at the pocket centre). Rocco gains these too.
- Everyone is built **right-handed**: the fielding mitt is on the left hand. Left-handed pitchers are mirrored at
  runtime (negative scale on x of the character's root; three.js flips face winding automatically).
- Root on the ground between the feet, facing glTF +Z (Blender −Y), left is +X, units feet.

## Character files
- `assets/src/char_<id>.glb` (raw) → packed by `tools/pack-assets.js` → `assets/char_<id>.glb`. `<id>` is the
  pitcher id (`p_ox`), card id (`c1-04`), `ump`, or `mate_otter` / `mate_fox` / `mate_beaver`.
- **LOD0** (close views: the pitcher, catcher and umpire in the bat scene, title and briefing): ≤ 18k triangles
  (bosses ≤ 22k). **LOD1** `char_<id>_lod1.glb` (fielders and runners in the field view, ~30–60 px tall): ≤ 3.5k
  triangles, same skeleton, same material names, fingers may be merged into a mitten shape (finger bones still
  present). Fielders and runners only need LOD1; pitchers, catchers and the umpire need both.
- **Meshes:** skinned to the skeleton, ≤ 4 weights per vertex. Heads carry the shape keys
  `blink, smile, grin, frown, mouth_open, brows_up, brows_angry, brows_sad, squint, cheeks_puff, smirk`
  (a species may omit ones it can't do, e.g. beaks have no `grin`; birds' `mouth_open` opens the beak).
- **Materials** (flat colour, no textures, names exact; use the subset you need): `fur, fur_light, fur_dark, mask,
  nose, skin, eye_white, pupil, mouth, tongue, teeth, beak, horn, hoof, shell, feather, feather_accent,
  uniform, team_a, team_b, belt, sock, shoe, sole, lace, glove, mitt, mitt_lace, cap, cap_brim, decal_chest,
  decal_back, accessory_a, accessory_b`. The runtime recolours `team_a/team_b/cap/cap_brim/decal_*` from the
  team's colours and textures the decals (team letter on the chest, the card number on the back).
- **Extras** (glTF scene extras, `export_extras`): `{ id, species, role, height, hipHeight, lod, hand: 'R' }`.
  `hipHeight` drives clip retargeting.

## Animation libraries (shared clips)
- `assets/src/anim_<lib>.glb` → packed `assets/anim_<lib>.glb`, each holding the reference skeleton (a preview
  mesh is fine) and its clips, plus a sidecar `assets/anim_<lib>.json` with markers and metadata. Libraries:
  `pitcher`, `catcher`, `umpire`, `fielder`. Rocco keeps his own batter clips; his teammates reuse his `run`,
  `trot` and `cheer`.
- Clips animate **rotations on every bone**, and **translation only on `root` and `hips`**. They are authored on
  the generator's reference build; the runtime retargets to each character by scaling root/hips translation by
  `hipHeight / refHipHeight` (in the sidecar).
- Sampled at 40 fps (like Rocco). Names are prefixed by library.
- **Pitcher (`p_`):** `p_idle` (on the rubber, loop), `p_set` (into the set position), windups `p_windup_classic`,
  `p_windup_sidearm`, `p_windup_submarine`, `p_windup_highkick`: each starts from SET and **releases the ball at
  exactly t = 1.15 s** (= `BB.K.WINDUP`), with follow-through to about 2.0 s. The sidecar lists the throwing-hand
  `grip.R` position at release (relative to the root, reference build) for each style, so the runtime can place the
  pitcher on the mound so the ball leaves his hand at the physics release point (`BB.Pitch.releasePoint`), the same
  way Rocco's swing contact is solved. Reactions: `p_react_hr` (jaw drop, watches it sail), `p_react_k` (smug
  strut), `p_react_walk` (kicks dirt), `p_react_hit` (wince), `p_get_ball` (takes the throw back from the catcher),
  `p_taunt` (a short cocky gesture between pitches).
- **Catcher (`c_`):** `c_crouch` (loop), `c_sign` (fingers down, pitch sign), `c_receive_high`, `c_receive_mid`,
  `c_receive_low`: the mitt pocket arrives at **t = 0.30 s** at the high / mid / low zone heights (the runtime
  blends by the pitch's plate height and shifts for inside/outside), `c_throw_back`, `c_stand` (pops up on a hit),
  `c_react_hr`.
- **Umpire (`u_`):** `u_stance` (crouched behind the catcher, loop), `u_strike` (big cartoon punch-out, the
  "fist" hits at t = 0.35 s), `u_ball` (stays down, tiny shake of the head), `u_strike3` (bigger, spinning
  punch-out), `u_out`, `u_safe`, `u_hr` (twirling finger).
- **Fielder (`f_`):** `f_ready` (loop), `f_idle` (loop, between pitches: glove punch, cap adjust), `f_run` (loop;
  sidecar gives the ground speed at timeScale 1 where feet stay planted), `f_catch_fly` (glove pocket at
  head-high catch point at the marker), `f_catch_dive`, `f_field_grounder` (glove scoops at ground level at the
  marker), `f_throw` (ball release at the marker), `f_celebrate`, `f_tag`, `f_slump` (watching a homer go over).
  The sidecar lists each marker time and the pocket/hand offset at that time.
- Acting style: the same principles as Rocco's clips (anticipation, overshoot, arcs, overlapping action on tails,
  ears, caps), exaggerated cartoon timing.

## Cast generator (tools/blender/cast)
- **Run:** `<blender-python> tools/blender/cast/cbuild.py <id ...> | --park N [--lod 0,1] [--no-cache]` writes
  `assets/src/char_<id>.glb` (LOD0) and `assets/src/char_<id>_lod1.glb`; `node tools/pack-assets.js` packs them.
  `--park 0` builds the extras (umpire, Rocco's teammates, derby pitchers); `--list` prints every character with its
  park, species, role, LODs and which files exist (and pending / broken spec modules). Several `cbuild.py` processes
  may run at once (other agents, other parks): caches live per character (`dist/cast-cache/<id>/`) and every file is
  written to a process-unique temp name and renamed into place. QA: `node tools/cast-shots.js --park N`
  (turnarounds, face sheets, LOD comparisons, lineups at one scale, the bat camera with the pitchers on the mound and
  the catcher and umpire behind the plate, the field camera with the LOD1 fielders - all posed with the shared clip
  libraries - in `qa/cast/`); `--lineup id,id,...` for an ad-hoc lineup; `--dir` / `--out` to work in a scratch folder.
- **Specs:** one module per park, `tools/blender/cast/specs/park<N>.py` (+ `extras.py`: umpire, Rocco's teammates,
  derby / daily pitchers; `tests.py`: head-kit test characters, never shipped), discovered automatically. Each defines
  `PARK` and `characters() -> {id: spec}` using the helpers in `cspecs.py`: `pitcher_spec(pid, ...)` (from the pitcher
  table: species, number, look.build / look.hair / windup, hand, boss, card face) and `card_spec(card_id, ...)` (from
  `BB.Meta.CARDS`: species, position, number, seed, card face), with overrides. A spec is plain data: species, role,
  name, number (the back decal), seed (individual variation), card face (palette, accessories, cap forwards /
  backwards), colours, `build` (skeleton proportions: leg, foot, torso, neck, hipw, shoulderw, arm, hand, head,
  tail), `body` (chest_w, chest_d, belly, belly_drop, seat, thigh, shoulder, arm_r, forearm, neck_r, cuff, hand /
  tail materials, tail_len, trousers, shell_kind), `head` options for the species module, accessories, tail type,
  hands (R, L), gear, `lods` (default: pitchers / catchers / umpire 0+1, others 1). Named builds (`cspecs.BUILDS`):
  average, stout, lanky, tall, stocky, round, small, athletic, boss_ox. Card data comes from `data/cards.json`
  (`node tools/cast-data.js` re-extracts it from `src/`).
- **Species registry:** each `heads/<species>.py` declares a literal `SPECIES = {'family', 'tail', 'build',
  'build_over', 'body_over', 'colors'}` entry (read with `ast`, no import), so adding a species never touches a
  shared table.
- **Skeleton** (`cskel.py`): the cast bone list = Rocco's minus the bat (56 bones incl. grip.L/R and mitt); joints
  are moved and bone lengths scaled, rest directions never change, so clips transfer by rotation. Head-local joints
  come from the head module; the tail chain is re-seated on the seat of the knickers.
- **Body** (`cbody.py`): one SDF for jersey + knickers (or the umpire's trousers), arms, stirrup socks, cleats,
  hands (`glove` batting glove, `bare` four-finger hand in the species' hand material, `mitt` fielding mitt,
  `catcher` catcher's mitt; LOD1: mittens that still curl with the finger chains), collar / placket / buttons /
  belt / trims, chest letter and back number patches. The mitt's pocket holds a ball centred on the `mitt` socket.
- **Tails** (`ctail.py`): bushy, dog, thin, tufted, stub, hair, flat, thick, lizard, fan (feathers), none - all on
  tail.1-tail.5 (per-type segment lengths).
- **Gear** (`cgear.py`): catcher (mask sized to the snout + straps, chest protector `team_b` with `accessory_b`
  piping, shin guards, cap backwards), umpire (dark shirt `uniform`, trousers `accessory_a`, black cap / chest
  protector / bow tie / ball bag `accessory_b`, bare hands), shells (`shell`).
- **LOD1:** the same spec rebuilt at quality 0.24 (head with all its shape keys, mittens, a coarser torso, no small
  trims), then the unkeyed parts are decimated (materials and weights transferred) until the file is <= 3.5k
  triangles. Same skeleton, materials and shape-key names as LOD0.
- **Cache:** `dist/cast-cache/<id>/` - the head and the body are cached separately, keyed by the spec fields they
  read and the source of the modules they run (a head: the kit, the family modules and its own species module, so
  another agent's species never invalidates it; colours are applied at export, so recolouring never rebuilds
  anything). Builds are deterministic (a no-cache rebuild is byte-identical).

## Head kit (species heads)
How a species head plugs into the cast generator (`tools/blender/cast/`, see "Cast generator" above). A head is a
small module; everything shared lives in the kit.
- **Module:** `tools/blender/cast/heads/<species>.py` defines `FAMILY` (`'mammal' | 'bird' | 'reptile'`) and
  `build(ctx) -> hkit.Head`. Usually it is `params(ctx)` (a dict merged over the family's `DEFAULTS`) plus an optional
  `features(ctx, head, geo)` hook, handed to the family builder: `fam_mammal.build`, `fam_bird.build` or
  `fam_reptile.build`. `ctx` carries the character spec (`ctx.spec`, `ctx.opts` = `spec.head`), the card face
  (`ctx.face`, `ctx.acc` = card accessories + `spec.accessories`), a seeded rng, `ctx.cap_back`, `ctx.cap_mats`.
- **Design space:** Rocco's head space, in feet: Z up, the face looks down -Y, +X is the character's left. The head
  joint (top of the neck) is at `HEAD_PIVOT = (0, 0.06, 3.30)`; a Rocco-sized cranium is centred near
  `(0, 0.08, 4.14)` with radii about 0.6; eyes at z ~ 4.2; the neck stub reaches down to z 2.9 (it tucks into the
  collar). The generator places the head with `world = J['head'] + 1.08 * build.head * (p - HEAD_PIVOT)`.
- **A `Head` provides:** `parts` (skinned `rk_geo.Part`s; the skin and anything with shape keys go to the head mesh,
  the rest to the body mesh), `pupils` (pupil + highlight, rigid to `eye.L/R`), `joints` in design space for
  `eye.L` (eye-sphere centre: rotating the bone slides the pupil over the white), `brow.L`, `ear.L` (ear base),
  `jaw` (hinge) and `cap` (cap centre) - the right side is mirrored -, `keys` (the shape keys it implements),
  `cap_letter` (optional UV'd `decal_chest` patch on the cap front) and `face_y` (its most forward point, used to
  size the catcher's mask).
- **Weights:** `head`, `neck` (the stub below z 3.42 blends into the neck), `jaw` (lower lip / lower beak / tongue
  / lower teeth), `eye.L/R` (pupils only), `brow.L/R`, `ear.L/R` (ear blades, root blended into the head), `cap`
  (the cap and anything riding on it, e.g. combs). At most 4 influences per vertex.
- **Shape keys:** `blink, smile, grin, frown, mouth_open, brows_up, brows_angry, brows_sad, squint, cheeks_puff,
  smirk` with the same meaning and strength as Rocco's. Mammals and reptiles get all of them from
  `hkit.MouthRig` (a carved mouth slit fitted to the face surface: lips, corners, cheeks, jaw hinge, teeth rows kept
  behind the lips, tongue) + `hkit.EyeRig` (eye whites in carved sockets with an inked ring, blink / squint lids) +
  `hkit.brows`. Birds omit `grin`; their `mouth_open` drops the lower beak (jaw) and lifts the upper a little, and
  `smile / frown / smirk / cheeks_puff` move the cheek feathers and the beak's gape. A species may scale a key
  (`mouth.key_scale`, e.g. a gentler `frown` under a muzzle pad). `mouth_open` gives Rocco's lip opening whatever
  the jaw length (the hinge angle scales with it).
- **Materials:** only the contract's names. Families use `fur` (main coat), `fur_light` (muzzle, throat, belly,
  blazes), `fur_dark` (accent: ears, spots, patches, manes, hair), `mask` (brows, the eye rings, eye black,
  markings), `nose`, `skin` (bare skin: inner ears, combs, wattles, bills, reptile scales), `eye_white`, `pupil`,
  `mouth`, `tongue`, `teeth`, `beak`, `horn`, `feather` / `feather_accent` (birds), `accessory_a` / `accessory_b`
  (gum, plasters, straws, shades, glasses, nose rings). Colours come from the spec (the card palette:
  main / secondary / accent -> `fur` / `fur_light` / `fur_dark`).
- **The cap:** every player wears one (`hkit.cap_parts`, crown `cap`, brim `cap_brim`, button `team_b`, letter
  patch `decal_chest`), fitted to the family's cranium with `hkit.cap_fit`. Ears, horns, antlers and combs that go
  through the crown register slots in `geo.slots`; the comb of a bird rides on top of the crown. Caps are worn
  backwards when the card says so (and by the catcher, under his mask). The umpire's cap uses accessory materials
  so the runtime never team-colours it.
- **Families and features (the kit's builders):**
  - mammal snout (`fam_mammal`): skull = cranium + face block + cheeks/jowls + snout (round cone) + optional muzzle
    pad + chin + neck + nape, species additions (`extra`) and carvings (`carve`). Ears `point`, `big`, `cow`,
    `flop`, `tiny`, `round` (`hkit.ear_leaf`, blade shapes `tri` / `leaf` / `round`, inner bowl colour, cup, droop).
    Noses `button`, `big`, `nostrils` (pad + pits, `nostril_pad`), `bulb`, `none`. Horns (`horn_pair`: any control
    polyline, ridges), antlers (`antler_pair`: beam + tines, optional palm), tusks (`tusks`), manes (`mane`), hair
    tufts / forelocks (`hair_tuft`), whiskers, goatees, mustaches, sideburns, freckles, plasters; colour regions
    `region_lower_face`, `region_muzzle`, `region_blaze`, `region_patch`, `region_spots` (seeded).
    Examples: dog, goat, ox (+ the boss), cow, horse, sheep (wool cloud), mole, otter, fox, beaver.
  - bird beak (`fam_bird`): round head with puffy cheeks, a two-part beak (`BeakRig`), combs, wattles, cheek
    tufts. Examples: hen, rooster.
  - reptile (`fam_reptile`): flat wedge head, eyes high on brow bumps, a very wide mouth, nostril pits, no ears,
    crests (`crest`). Example: lizard (`test_lizard`). Shells are body gear (`cgear.shell_part`, tortoise /
    armadillo).
  - accessories for every family from the card: `shades`, `glasses`, `eyeblack`, `gum`, `stalk`, `freckles`,
    `bandaid`, and the pitchers' `look.hair` (`mustache`, `sideburns`, `beard`).
- **Budgets:** a LOD0 head is about 3.5-4.5k triangles (skin 2.7k). LOD1 rebuilds the same head at quality 0.24
  (no teeth, tongue, highlights, cap seams, button or letter patch) - keep species pieces on `hkit.tq()` /
  `hkit.hq()` so they scale too.
- **Adding a species:** write `heads/<species>.py` (its `SPECIES` registry entry: family, tail type, default build,
  fixed colours such as nose / horn / beak / skin, hand and tail materials), then `cbuild.py <id>` and
  `node tools/cast-shots.js <id>` (turn, face and LOD sheets). Check it from the game cameras (`game-bat`,
  `game-field` sheets).
- **How to add a park** (parks 2-6; several agents in parallel, one park each):
  1. Species heads: for every species of the park without a module, write `heads/<species>.py` with its `SPECIES`
     entry, `params(ctx)` and `features(...)` (start from the closest existing module: dog / fox / goat / ox / horse /
     sheep / mole / otter / beaver / hen / rooster / lizard / moose / walrus / tortoise). Don't edit `hkit.py` or
     `heads/fam_*.py` for one species (they are shared and invalidate everyone's cache); add helpers in your species
     module, or ask the generator owner.
  2. Characters: `specs/park<N>.py` with the park's four pitchers (`pitcher_spec`, the boss gets a custom build in
     `cspecs.BUILDS` style via `build_name` / `build` / `body` overrides plus signature head options) and the card
     catcher + seven fielders by position (`card_spec(card_id)`; use the card's palette, accessories and seed; give
     look-alike species different horns / ears / builds / markings). The catcher gets `gear=['catcher']`,
     `cap_back=True`.
  3. Build: `cbuild.py --park N` (LOD0 + LOD1 as the contract says), then `node tools/cast-shots.js --park N`.
  4. Look at: `turn-<id>` (silhouette from five sides), `face-<id>` (all 11 shape keys front and 3/4; nothing pokes
     through, mouth closed at rest, teeth only when the lips part), `lod-<id>`, `lineup-park<N>-close` and
     `lineup-park<N>-team` (one scale with Rocco; everyone readable and different), `game-bat` and
     `game-bat-pitchers` (the pitcher ~100 px tall from the plate: species reads from the silhouette - horns, ears,
     beak, comb, colours), `game-plate`, `game-field` (LOD1 fielders at their spots).
  5. Budgets: LOD0 <= 18k triangles (bosses <= 22k; `cbuild` decimates heavy gear to fit and says OVER BUDGET
     otherwise), LOD1 <= 3.5k (automatic). Then `node tools/pack-assets.js` for the packed sizes.
- **Gotchas we hit** (park 1):
  - Teeth and tongue sit relative to the lips found on the skull surface; a mouth line in a crease between an
    overhanging snout and a recessed chin used to push the lower teeth through the chin - `fit_mouth` now keeps each
    row 0.07 behind the surface at its own height, but always check `face-<id>` at rest and with `frown` / `smirk`.
    Long jaws open by Rocco's lip distance (the hinge angle shrinks); a muzzle pad near the mouth corners needs
    `key_scale=dict(frown=0.6)`.
  - Noses are placed a quarter radius in front of the snout surface; nostril pads (`nostril_pad`) carve pits and
    colour the pad.
  - Light coats need the inked eye ring (`eye.ring='mask'`, default on) or the eye whites vanish; brows default to
    `mask` (a dark ink colour mixed from the coat) - on very dark coats they read weakly (fine for LOD1-only players).
  - Anything that pokes through the cap needs a slot (`geo.slots`, ears and horns register their own); crests and
    spikes must start below the cap band (reptile `crest(z0=...)`), a bird's comb rides on the crown (bone `cap`).
    Backwards caps sit level and higher so the brows stay visible.
  - The head's neck stub ends at design z 3.0 (inside the collar). Very long necks (flamingo, heron, goose, giraffe-
    like builds with `build.neck` > 1.5) need a longer stub (`neck.b` lower) or a gap opens under the head; the nape
    must stay inside thin jerseys (lanky builds).
  - Birds: `fam_bird` has no mouth slit - the beak is two rigid parts (`BeakRig`: upper on the head, lower on the
    jaw), no `grin`; smile / frown / smirk curl the gape and lift the cheek feathers. Long beaks (pelican, heron, gull,
    flamingo) = `beak.len` / `droop`; the catcher's mask sizes its cage to the face's most forward point, so a long
    beak means a deep cage (consider a mask-less catcher helmet for those). Bird hands are bare `feather` four-finger
    hands (`body.hand_mat`), tails `fan` (feather / feather_accent). Owls: put the eyes further apart and flatter
    (`eye.axis` closer to -Y), a short hooked beak.
  - Reptiles: `fam_reptile` reuses the mammal builder with reptile params (wide mouth, `teeth=None`, eyes high on
    brow bumps, nostril pits, no ears); materials `skin` (scales), `fur_light` (throat), `mask` (crest, markings).
    A chameleon's casque or a frill is an `extra` SDF; if it rises through the cap use `cap.cranium` (fit the cap on
    an enlarged ellipsoid, like the sheep's wool) or a cap slot. Shells are body gear: `gear=['shell']`,
    `body.shell_kind='tortoise' | 'armadillo'`.
  - Big furry bosses (bear): round ears through cap slots (`ear.kind='round'`, `slot=True`), a heavy build in
    `cspecs.BUILDS` style (see `boss_ox`: shoulders, Popeye `forearm`, big hands), fur tufts as `hair_tuft` /
    cheek tufts; keep LOD0 <= 22k.
  - The decal patches project onto the jersey; narrow chests are handled, but check the back number in `turn-<id>`.

## Runtime (integration agent)
`BB.Actors` (from `BB.Rocco`): loads a character by id, applies toon materials by name with team colours, skinned
hulls, layer 1 + ink ids, an AnimationMixer bound to the shared clip libraries (retargeted per character), LOD0/LOD1
by on-screen size, and role drivers (pitcher, catcher, umpire, fielder, runner) that line the clips' markers up with
the game's events (release at t = 0, mitt arrival at `pitch.T`, `play.catchT`, `play.throwT`,
`play.fielderAt(i, t)` paths, runner moves). Only Rocco is parsed at boot; a game's cast is fetched and parsed during
the pre-game briefing and released afterwards.
