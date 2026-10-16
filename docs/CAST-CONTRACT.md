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

## Runtime (integration agent)
`BB.Actors` (from `BB.Rocco`): loads a character by id, applies toon materials by name with team colours, skinned
hulls, layer 1 + ink ids, an AnimationMixer bound to the shared clip libraries (retargeted per character), LOD0/LOD1
by on-screen size, and role drivers (pitcher, catcher, umpire, fielder, runner) that line the clips' markers up with
the game's events (release at t = 0, mitt arrival at `pitch.T`, `play.catchT`, `play.throwT`,
`play.fielderAt(i, t)` paths, runner moves). Only Rocco is parsed at boot; a game's cast is fetched and parsed during
the pre-game briefing and released afterwards.
