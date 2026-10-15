# Art direction v2: classic theatrical cartoon (3D)

The risograph look is retired. The game is now a **golden-age theatrical cartoon** (1940s–50s studio shorts) rendered
as **stylized 3D with three.js**, plus 2D canvas/CSS for cards and menus in the same style.

Working title: **Screwball Slugger** (`BB.TITLE`). Everything that prints the name must read `BB.TITLE`.

## Hard rules (legal)
- All characters, names and designs are **original**. No existing cartoon characters or lookalikes (no rabbit in
  gloves with a carrot, no black duck, no coyote + roadrunner pairing, no pig in a bow tie, no tasmanian devil),
  no studio names or logos, no "That's all folks", no shield logo, no famous concentric-ring end card. Use a
  sunburst or an iris wipe instead. Never write "Looney Tunes" in the game or repo.

## Characters
- **Anthropomorphic animals.** Big heads (about a third of body height), small torsos, rubber-hose limbs with
  elbows that bend like noodles, big feet in sneakers or cleats, white four-finger gloves.
- Big oval eyes with black pupils and a highlight, eyebrows that carry the emotion, a wide expressive mouth.
- **Hero batter:** "Rocco", a scrappy raccoon (the mask!) in a home-white uniform with the team colour, cap on
  backwards when On Fire. Right-handed.
- **Pitchers:** one species per pitcher, chosen to match their name or nickname (ox, loon, bear for
  "Sasquatch", gull, owl, goat, walrus, badger, rooster, armadillo, flamingo, moose, possum, pelican, bulldog,
  tortoise for the eephus guy, and so on). Bosses are bigger and meaner looking.
- Fielders: simpler versions of the pitcher's team species, so the opposing team has one look.
- **Acting:** exaggerated anticipation before every action, smear or stretch on fast motion, squash on impact,
  overshoot and settle. Idle breathing, blinks, glances. The pitcher reacts: shock or a jaw drop on a homer, a
  smug grin on a strikeout. The batter: dizzy stars and a corkscrew spin on a big whiff; a bat flip and strut on a homer.

## Rendering
- `MeshToonMaterial` with a 3-step gradient map (hard cel bands), or a custom toon shader. No PBR look, no textures
  except tiny generated ones (gradient maps, a cloud sprite).
- **Bold black ink outlines** on characters, ball, bat and foreground props (inverted-hull back faces, slightly
  wobbly and thicker on silhouettes). Backgrounds have **no** outlines.
- **Backgrounds are painted, graphic and flat**, in the mid-century modern cartoon-background tradition: simplified
  geometric mesas, lollipop trees, stylized clouds as flat shapes, sky in 2–3 painterly bands, limited palette per
  park. Use camera-facing planes and canvas-painted textures for the far background.
- Light: one warm key light plus ambient; cel bands do the shading. A single soft blob shadow under each figure.
- Performance: iPhone Safari at 60 fps. Low-poly (spheres 16–24 segments), a few hundred draw calls at most,
  merge static geometry, pixel ratio capped at 2 (drop to 1.5 automatically if frames are slow), antialias on.

## Palette (warm, saturated, never neon)
| Role | Hex |
|---|---|
| Cream (paper, UI cards) | `#FFF4DC` |
| Ink (outlines, text) | `#1B1420` |
| Sky teal | `#7FD1D9` |
| Sky sunset | `#FFB36B` |
| Mustard | `#F2B632` |
| Brick red | `#D9483B` |
| Desert pink | `#F29E8E` |
| Grass | `#6DBB4A` (light) / `#3E8E3A` (dark) |
| Dirt | `#D9955B` |
| Night navy | `#2B2F5E` |

Each park has its own background palette (Haybale = golden afternoon, Rivet Street = brick and pigeons at dusk,
Loon Lake = pine greens and blue water, Gull Point = sea teal and gulls, Saguaro = desert pinks under a big moon,
Old Cathedral = grand evening gold and purple).

`BB.INKSETS` are now **colour schemes**: slot `a` = hero uniform/UI primary, `b` = accent, `c` = highlight. UI
calls them "Colour schemes" or "Uniforms".

## Effects and lettering
- Impact star bursts, speed lines, puffy dust clouds, sweat drops, dizzy stars, motion smears.
- Comic lettering for stamps: **POW!**, **WHAM!**, **KA-BLAM!** (homer), **WHIFF!**, **STEE-RIKE!**, **YER OUT!**,
  in bulgy letters with a thick ink outline and a hard offset shadow, popping in with overshoot.
- Scene changes use an **iris wipe** (a circle closing on the ball or the batter, then opening on the next scene).

## Type
- Display: **Luckiest Guy** (Google Fonts), falls back to Arial Black.
- Body: **Fredoka** (Google Fonts, 400–700), falls back to system rounded/sans.
- Set `BB.FONTS.display` and `BB.FONTS.body` to these.

## UI
Cream cards with thick ink outlines (3 px), rounded corners, a hard offset shadow (4–6 px, ink) instead of blur.
Buttons squash on press and bounce back. Headers sit on a sunburst. Screens open with an iris or a bouncy slide.
