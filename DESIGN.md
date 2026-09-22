# The town: visual system

Files actually read for this document: `ui/src/art/palette.ts`, `ui/src/art/surface.ts`,
`ui/src/art/iso.ts`, `ui/src/art/worker.ts`, `ui/src/art/building.ts`, `ui/src/art/terrain.ts`,
`ui/src/art/props.ts`, `ui/src/art/font.ts`, `ui/src/art/bake.ts`, `ui/src/scene.ts`,
`ui/src/workers.ts`, `ui/src/TownCanvas.tsx`, `ui/index.html`, `ui/src/App.tsx`,
`internal/town/vocabulary_test.go`, `internal/web/web.go`. Every value below is read from those
files, from their exported constants, or measured by running the art modules
(`ui/src/art/*.ts`) directly; none is taken from a design note, a screenshot, or intent. Where
a number is a measurement rather than a literal, the document says so.

Describes the working tree at commit `6c160b1` plus the uncommitted art layer. Declared
dependency ranges (`ui/package.json`): phaser `^4.2.1` (installed 4.2.1), react `^19.3.0`,
typescript `^5.9.3`, vite `^7.1.9`, zustand `^5.0.8`. No build, test, lint or formatter was run
for this document.

## The world

A 16-bit isometric construction site, drawn entirely in code and seen from one fixed camera:
the classic 2:1 dimetric view with the sun up and to the left, and no rotation, no perspective
and no second angle anywhere in the system. The layout arrives from the daemon in top-down
world units and is never recomputed in the browser (`ui/src/scene.ts:1-9`; ADR-0012); the
renderer only projects it. Ground is laid as diamond plates with authored edge pieces; buildings
gain one part per rank as they climb an eight-rank ladder; and figures walk between them and play
the animation for the action the agent is actually performing — a chief 21 art pixels tall
including its outline, a sub worker 19. Every sprite is pixel data in
TypeScript baked at boot into one Phaser texture (`ui/src/art/bake.ts:32,99`), so no sprite
ships as an image file: there is no loader and nothing to fetch at runtime. The daemon binds
loopback, builds offline with zero dependencies, and carries the whole UI inside the Go binary
(`internal/web/web.go:17`). Pan and zoom are local to Phaser and stay local (`ui/src/scene.ts:531-568`); the
camera is never a data source.

## Palette

One authored set, `P` in `ui/src/art/palette.ts:19`, and one allowlist derived from it,
`paletteSet()` at `ui/src/art/palette.ts:126`. A `Ramp` is exactly four steps, dark to light,
index 0 darkest (`ui/src/art/palette.ts:17`).

| Role | Values (dark to light) | Source | Drawn as |
| --- | --- | --- | --- |
| Void | `#0e141c` | `palette.ts:22` | Canvas background (`ui/src/scene.ts:97`), panel `--void` |
| Terrain — grass | `#1d3327` `#274632` `#32583d` `#3e6b49`, lit tip `#4a7d54` | `palette.ts:24,27` | District plates, field, building plots |
| Terrain — earth | `#3a2c1e` `#543f2a` `#6f5436` `#8c6d45` | `palette.ts:26` | Workshop/Depot ground, plots, spoil, sacks |
| Terrain — yard floor | `#61492f` `#96784f` | `palette.ts:31,32` | The Yard only; packed dirt named separately, not a darker earth |
| Wood | `#4a3320` `#6d4c2c` `#94693c` `#c39558` | `palette.ts:38` | Scaffolding, framing, planks, most props |
| Roof — tile | `#5c2b22` `#833d2d` `#a85439` `#c9724a` | `palette.ts:43` | Tiled roofs, bricks |
| Roof — thatch | `#6b5527` `#8e7338` `#b3924c` `#d4b366` | `palette.ts:45` | Hut and low-tier roofs |
| Stone | `#3c4149` `#575e68` `#7c858f` `#a5aeb8` | `palette.ts:48` | Hall walls, chimneys, rubble, mortar |
| Plaster | `#4e4238` `#7d6d5c` `#a89480` `#cfbb9d` | `palette.ts:63` | Daub walls of the lower tiers |
| Glass | `#1e2a33` `#2f4048` `#4a6270` `#7191a4` | `palette.ts:69` | Window openings; the only cool blue in the building set |
| Worker skin | `#7d5236` `#a8724a` `#cd9464` `#e6b688` | `palette.ts:51` | Faces, hands |
| Worker tunic | `#3f2415` `#6b3f22` `#8f5a30` `#b07c45` | `palette.ts:52` | Torso, arms, trousers |
| Worker leather | `#4a3422` | `palette.ts:53` | Belt, boots |
| Worker metal | `#4c545e` `#77828d` `#a3aeb9` `#d2dae2` | `palette.ts:54` | Tools, wheel, hoops, chest bands |
| Helmet — chief | `#8a6414` `#bd8f1d` `#e6bb38` `#f7dc72` | `palette.ts:57` | Chief's hard hat; the tier read (ADR-0007) |
| Helmet — sub | `#5b646e` `#8b959f` `#bcc5cd` `#e6ecf1` | `palette.ts:58` | Sub worker's helmet |
| Ink | `#140f0b` | `palette.ts:73` | The one outline colour, 1px, at every size |
| Paper | `#e8e0cd`, dim `#a89f8c` | `palette.ts:75,76` | In-world labels, documents, plan board |
| Accent | `#e6bb38`, dim `#8a6414` | `palette.ts:80,81` | Chief's helmet top, crew flag, the Yard lamp's glow, panel live marks |
| Crew tags | `#5aa9d9` `#e6bb38` `#a98cd9` `#6fbf7a` `#d97a9a` `#c9d96f` | `palette.ts:97` | Runtime rectangles, by `crewColour(agent)` hash |

Counts, measured: `P` holds 24 named entries and 64 distinct colours; `paletteSet()` returns
69, because the six crew colours are added and only `#e6bb38` overlaps `P`.

The four rules the ramps follow, stated at `ui/src/art/palette.ts:1-15` and true of the table:

- **Shadows shift hue cool, highlights shift warm.** Measured in HSL: roof runs H9 to H19 and
  wood H27 to H34 as it lightens. A ramp that only darkens its own hue is the thing this
  avoids.
- **Every ramp is 3 to 4 steps.** All of `P`'s ramps are exactly 4 (`palette.ts:17`).
- **One ink.** `#140f0b` for every figure and building, 1px, at every size.
- **Light is top-left, always.** Lit faces take the warm step, far faces the cool step.

Deliberately absent, at `ui/src/art/palette.ts:84`: no panel colours (the panel is styled from
its own CSS variables in `ui/index.html`, and copying them here would be a second source of
truth), and no building-status colours (a building's condition is carried by its structure,
not a tint).

## Type

Two faces, used for two different jobs.

**Silkscreen** is the panel's chrome. Self-hosted woff2 at
`ui/src/assets/fonts/silkscreen-regular.woff2` and `silkscreen-bold.woff2`, declared with
`font-display: block` at `ui/index.html:12-25` so nothing renders in a fallback and then
reflows. Licensed under the SIL Open Font License 1.1 (`ui/src/assets/fonts/OFL.txt`,
"Copyright 2001 The Silkscreen Project Authors"). It is carried in the source rather than
fetched, because the daemon binds loopback and must never reach the network at runtime. It is
exposed as `--pixel` with a `"Courier New", monospace` fallback (`ui/index.html:51`) and used
at: panel `h1` 16px (`ui/index.html:138-146`), section headings and the switcher label 8px
uppercase with `.06em` letter-spacing, the crew tier badge 8px, the connection lamp label 8px,
the error glyph, and the detail button 8px. All other panel text is `--mono` at 11-12px on a
1.55 line height (`ui/index.html:52,60`).

**The 3x5 bitmap face** is for everything the town says in its own world: district names,
place names, building labels. `GLYPH_W = 3`, `GLYPH_H = 5`, `GLYPH_GAP = 1`
(`ui/src/art/font.ts:32,34,43`), glyphs as `#`/`.` character grids in `FONT`
(`ui/src/art/font.ts:74`), drawn by `typeset(text, ink)`
(`ui/src/art/font.ts:152`). Three properties are load-bearing: text is uppercased on the way
in; a character with no glyph becomes a blank rather than a dropped column, so a label can
never be silently re-spelled; and empty text is a single blank cell rather than a throw, so a
missing name cannot take a frame down inside the draw loop. Width is
`n * GLYPH_W + (n - 1) * GLYPH_GAP`, never `n * (GLYPH_W + GLYPH_GAP)`. `typeset` takes its ink
as a parameter and writes no colour of its own. `scene.label` (`ui/src/scene.ts:458`) bakes
each string to its own canvas texture on first use and draws it at origin `(0.5, 1)`
(`ui/src/scene.ts:466`) — bottom-centre, so a label hangs from a point on the ground. It is
never a Phaser `Text` object, because a canvas font arrives antialiased and would be the one
soft-edged thing on a screen of hard pixels.

## Projection and scale

The projection, written once in the art layer and once in the scene, is
`sx = (wx - wy) / 2` and `sy = (wx + wy) / 4 - z`
(`ui/src/art/iso.ts:49-51`, `ui/src/scene.ts:164`; the two cannot share code without the art
layer depending on the scene, so a test asserts they agree). One art pixel is one world unit
(`ui/src/art/terrain.ts:21-23`). A square footprint therefore projects to a diamond twice as
wide as it is tall.

| Constant | Value | Source |
| --- | --- | --- |
| Ground tile, world units | `TILE = 16` | `ui/src/art/terrain.ts:23` |
| Ground tile, rendered | `TILE_PX = { w: 17, h: 9, ox: 8, oy: 0 }` | `ui/src/art/terrain.ts:35` |

A 16-unit world square projects across 17 pixels, not 16, because both end corners are
inclusive; the numbers are exported so the bake reads them instead of restating them, because
an origin one row too low silently clips the bottom half of every tile.

Cel boxes and origins — every cel records the pixel its world origin lands on, and the scene
subtracts that to place it:

| Cel | Box | Origin | Source |
| --- | --- | --- | --- |
| Worker | 26 x 26 | `(13, 25)` | `ui/src/art/worker.ts:26,37` |
| Prop | 34 x 34 | `(17, 20)` | `ui/src/art/props.ts:33,37` |
| Building, side 44 (files <= 2) | 53 x 63 | `(26, 36)` | `boxFor`, `ui/src/art/building.ts:117` |
| Building, side 60 (files <= 5) | 69 x 81 | `(34, 46)` | same |
| Building, side 78 (files <= 12) | 87 x 102 | `(43, 58)` | same |
| Building, side 100 (files > 12) | 109 x 123 | `(54, 68)` | same |
| Ground tile | 17 x 9 | `(8, 0)` | `TILE_PX`, above |

The worker's origin is one row below the boots, not on them, because the outline pass adds a
row beneath the lowest boot and an origin on the boot row would sink every figure a pixel into
whatever it stands on (`ui/src/art/worker.ts:28-37`). The building's origin is its footprint
corner, so `boxFor` projects the footprint's own corners rather than using a closed form, and
adds a margin of 6 that covers the roof's 2-unit eaves, the 1px outline, one row of headroom, and
the two things drawn *outside* the footprint — the scaffold's poles at world `-5` and the spoil
pile reaching world `side + 14` (`ui/src/art/building.ts`). At a margin of 4 those last two
reached the cel border and their ink was clipped.

Integer zoom only. The wheel steps the zoom by exactly 1 and clamps to `[1, 4]`
(`ui/src/scene.ts:558-560`); `fit()` takes the largest whole number that fits the town and 1
when not even 1 fits (`ui/src/scene.ts:631-636`). A fractional zoom makes some art pixels two
screen pixels wide and their neighbours one, and zooming below 1 destroys the art rather than
showing more of it. Pixels are preserved at every blit: `imageSmoothingEnabled = false` in
both the bake and the ground painter, `pixelArt: true` in the Phaser config
(`ui/src/TownCanvas.tsx:35`), and `image-rendering: pixelated` on the canvas in CSS.

One texture holds everything: `ATLAS = "town"` (`ui/src/art/bake.ts`), laid out in 16 columns of
a fixed cell size, `max(cel) + 2`, with the canvas rounded up to a power of two. The atlas is not
packed, so the frame table cannot depend on a packing result and the art cannot move between
builds.

The cels, counted from the bake loop: 76 worker (2 tiers x 38 frames), 128 building
(4 footprints x 2 skin variants x 8 stages x 2 damage states), 4 building shadows, 80 ground
(4 kinds x 4 variants x (1 plain + 4 edge pieces)), 12 props — **300 baked cels**, which with
the atlas's `__BASE` frame is the 301 frames the live texture reports. Damage is baked rather
than overlaid because it depends on how far the building got: there is no wall to crack until
there are walls.

## Lighting

One sun, top-left, and it never moves. It is not a light in the scene graph: it is a rule about
which ramp step each face takes.

- **Walls.** Only two of a box's four walls are ever visible: the ones at `x + w` and `y + h`.
  `iso.box` names them by world axis and comments the consequence — the `y + h` wall lies on
  the picture's lower-left flank and is the **lit** one, the `x + w` wall on the lower-right is
  the **shadow** one (`ui/src/art/iso.ts:131-150`). A closed wall reads `lit: wall[3]`,
  `shadow: wall[1]`, `top: wall[2]` (`ui/src/art/building.ts:245-248`). The top face has one
  documented exception: an unfinished wall is an open shell, so its top is drawn as
  `wall[0]` — the dark inside of the building — rather than as wall material, because filling
  it with the wall colour would read as a solid slab sitting on the plot, the opposite of
  "this is going up" (`ui/src/art/building.ts:243-249`).
- **Roofs.** `iso.gable` draws the far slope at `roof[1]`, the near (lit) slope at `roof[2]`,
  the ridge at `roof[3]`, and the gable end at `wall[2]` (`ui/src/art/building.ts:339-345`).
  The ridge is drawn by the near slope's own top row, so the ridge line needs no separate
  stroke.
- **Ground.** Each tile is two facets split on `wy < wx`: the upper-left half takes the lit
  step, the lower-right the dark one, so a field of tiles gains a direction without any tile
  carrying a gradient (`ui/src/art/terrain.ts:116-166`). The steps per kind are `GROUND_RAMP`
  (`ui/src/art/terrain.ts:50-71`) — for example grass `base 2`, lit `grass[3]`, dark `grass[1]`.
- **Windows.** On the lit wall the glass is `glass[2]`, on the shadow wall `glass[1]`, one step
  darker for the same reason the wall is (`ui/src/art/building.ts:288-322`).
- **Props.** Every prop box repeats the same `{ top, lit, shadow, edge }` convention, so there
  is one lighting model across `ui/src/art/props.ts`. Measured over all 12 props in the 34 x 34
  cel, every one of them leaves at least one pixel of outline room on all four sides, so no prop
  clips its ink.
- **Ground shadows.** A building's shadow is a `P.grass[0]` footprint, `footprint(2, 3, side+3,
  side+3)`, baked once per footprint as frame `s<side>` (`ui/src/art/building.ts:467`,
  `ui/src/art/bake.ts:67`). A worker's is a runtime 7 x 3 ellipse at 0.22 alpha
  (`ui/src/workers.ts:48,49,200`), drawn as its own object so it stays on the ground while the
  figure bobs.

`ui/src/art/iso.ts` rasterises by walking integers in world space and plotting pixels, never by
filling a canvas path, because path filling is antialiased and cannot be switched off —
`imageSmoothingEnabled` governs image sampling, not geometry.

## The building ladder

Eight ranks, each adding exactly one part, and the picture for a rank is every part up to it
drawn in order (`ui/src/art/building.ts`). That cumulative structure is the whole stage model:
because the compositor draws `want >= stageRank(...)` for each part in turn, a stage is by
construction the stage below it plus one thing, and a roof cannot appear on a building with no
walls.

| Rank | Part added | Drawn as |
| --- | --- | --- |
| `planned` | `stakes` | cleared plot, four corner stakes, string lines |
| `foundation` | `footings` | trench outline and four stone pads, plus the spoil heap |
| `framed` | `frame` | stud posts and beams at full wall height, open to the sky, scaffold up |
| `walled` | `walls` | the shell closed, painted or timber-framed per skin |
| `roofed` | `roof` | gable roof with eaves; the scaffold is struck and the spoils cleared |
| `glazed` | `windows` | lit openings punched into both visible walls |
| `doored` | `door` | a doorway with a lintel, so the building has an inside |
| `completed` | `trim` | plinth, corner boards, fascia, and the chimney |

Two rules are load-bearing:

- **Structure by change, finish by test.** The first four ranks come from making changes, the
  last three from passing tests. This is a rendering decision as much as a domain one: it is what
  gives a test run a destination on the building it verified.
- **Site furniture is not a part.** The scaffold and the spoil heap are derived from the *rank
  range* (`hasScaffold`, `hasSpoil`), never added by a single rank — a building does not "gain
  scaffolding", it is scaffolded for part of its life.

**Damage** is drawn over whatever the rank has reached, and knows how far that is: rubble appears
only once something is standing, a crack only once there is a wall, a roof hole only once there
is a roof. It is baked per stage for that reason, and it never changes the part list.

`STAGE_ORDER` is asserted rank by rank against `internal/town`'s `AllStatuses()`, and every rank
must appear both in `PART_FOR_STAGE` and as a draw guard in `buildBuilding` — a rank the renderer
cannot draw fails the Go build rather than rendering blank
(`internal/town/vocabulary_test.go`).

## Composition rules

- **Draw order.** Ground is painted into one canvas texture, then everything standing is placed
  as its own sprite. Ground is static and can be a few thousand tiles, so it is one texture and
  one draw call rather than thousands of game objects: `paintGround`, `ui/src/scene.ts:230`.
- **Depth bands.** `DEPTH.ground = -100000`, `DEPTH.label = 90000`
  (`ui/src/scene.ts:67`). Standing objects are ordered among themselves by the screen `y` of the
  point they stand on.
- **Ground regions** are written in order — field, then each district plate, then each place's
  own surface — so later regions cover earlier ones rather than fighting them
  (`ui/src/scene.ts:130-135`).
- **Sites are drawn far-to-near**, sorted by `a.x + a.y` (`ui/src/scene.ts:140`), so a building
  on a nearer row is drawn over one behind it.
- **Anchoring.** `place()` (`ui/src/scene.ts:181`) projects the world point and subtracts the
  cel's own origin to get a top-left draw position, then calls `.setOrigin(0, 0)`
  (`ui/src/scene.ts:184`). This is load-bearing: a Phaser Image defaults to origin 0.5, so
  without it the position is read as the cel's *centre* and every building and prop sits half a
  cel up-and-left of its own plot, with its click zone following. The comment records that this
  is exactly what happened and was caught by checking Phaser's real behaviour rather than by
  reading the arithmetic.
- **Shadow under building, building above it.** The shadow sprite is placed first at
  `depth = near.y - 1`, the building at `depth = near.y`, where `near` is the grounded corner
  nearest the camera, `project(s.x + s.w, s.y + s.h)` (`ui/src/scene.ts:377-387`). A building's
  own far corner is behind its own roof, so depth is measured from the near one.
- **Figures.** A worker's depth is its feet's `y`; its shadow sits at `y - 1` and its crew tag
  at `y + 1`, all three moved together by `syncVisual` (`ui/src/workers.ts:282-287`). That is
  what makes a figure pass in front of a building it stands below rather than behind it.
- **Labels** are drawn at origin `(0.5, 1)` at `DEPTH.label`, above everything
  (`ui/src/scene.ts:466`). A district's name sits above its plate's far corner, where a
  building on the plate cannot cover it; a test district is suffixed `(TESTS)` and lettered in
  `P.paperDim` instead of `P.paper` (`ui/src/scene.ts:344-358`). A place's name is lettered on
  its own ground (`ui/src/scene.ts:419`).
- **Props** are laid out in a stable grid from the place's own origin — `PROP_PITCH = 30`,
  starting at `(s.x + 12, s.y + 16)`, `cols = floor((s.w - 20) / PROP_PITCH)` — so the
  arrangement never depends on iteration order (`ui/src/scene.ts:44,408-413`). A place with
  nothing in it would render the majority of a real session as an empty field.
- **Hit zones** cover the pictured area rather than the plot, so clicking a roof selects the
  building; a drag does not count as a click, gated on the pointer having travelled less than 5
  pixels (`ui/src/scene.ts:433-450`). Selecting a place uses a region sized from its ground, not
  from a sprite.
- **Rebuild vs. patch.** A layout change rebuilds the town; a live update only reconciles
  workers and restages buildings. `restage` swaps a building's frame in place when its status
  advances, keeping the sprite's identity so nothing else in the scene has to know
  (`ui/src/scene.ts:591-607`, `buildingKey` at `ui/src/scene.ts:609`). A layout changes a
  handful of times a session; live updates arrive hundreds of times.
- **The camera is re-fitted when the town is a different town, not merely a new object.** The
  fit is keyed to a signature of the layout (size, site count, district count), because a layout
  *identity* change also happens on the SSE reconnect path — which re-fetches the same project
  and would otherwise discard whatever the developer had panned and zoomed to. An earlier latch
  here had the opposite fault: it never re-fitted at all, leaving a newly chosen project at the
  previous town's zoom and centre (`ui/src/scene.ts`, the `fittedSignature` field).

## Motion

Ten animations, one per action the daemon can emit (`WorkerState`,
`ui/src/art/worker.ts:351`). The names are exactly the daemon's action strings and a test keeps
them equal both ways (`internal/town/vocabulary_test.go`,
`TestActionVocabularyMatchesTheUI`); the naively-hard version of that drift once rendered every
read as the default animation because the daemon said "inspecting" while the renderer only knew
"reading".

Frame timings are **per action and per frame**, not one frame rate per animation
(`FRAME_MS`, `ui/src/art/worker.ts:361-372`):

| Action | Frames | Per-frame ms | Full loop |
| --- | --- | --- | --- |
| `idle` | 2 | 700, 700 | 1400 |
| `walk` | 4 | 120, 120, 120, 120 | 480 |
| `reading` | 4 | 420, 420, 420, 420 | 1680 |
| `hammering` | 4 | 90, 90, 70, 110 | 360 |
| `building` | 4 | 110, 110, 80, 130 | 430 |
| `demolishing` | 4 | 100, 100, 70, 140 | 410 |
| `testing` | 4 | 240, 240, 240, 240 | 960 |
| `commanding` | 4 | 160, 160, 160, 160 | 640 |
| `planning` | 4 | 340, 340, 340, 340 | 1360 |
| `celebrating` | 4 | 130, 130, 200, 200 | 660 |

Why per-frame rather than one rate: Phaser 4's animation config carries a single frame rate for
a whole animation (`ui/src/workers.ts:10-15`). This town's read depends on a hammer blow being
fast and its follow-through slow — 90ms of wind-up against 70ms of strike against 110ms of
recovery — and averaging those into one rate would delete the rhythm that tells a glance what
the agent is doing. So `WorkerLayer.tick` (`ui/src/workers.ts:313`) advances each figure from
`FRAME_MS` itself, one worker at a time, off a single scene update hook rather than a tween per
worker. A test asserts no two actions share a rhythm
(`TestEveryActionHasItsOwnAnimationInTheUI`), because a shared branch would satisfy the
vocabulary test while drawing two actions identically. `setState` resets the frame index and
elapsed time when the animation actually changes, so a switch from a fast action to a slow one
does not inherit the previous action's frame phase (`ui/src/workers.ts:294-306`).

The walk is driven by **distance travelled, not by a clock**. `STRIDE_PX = 14` is the distance
one cycle is authored to cover; a journey's cycle count is
`min(MAX_CYCLES = 7, max(1, round(distance / STRIDE_PX)))` and its duration is
`max(MIN_TRAVEL_MS = 420, cycles * WALK_CYCLE_MS)` (`ui/src/workers.ts:32,37,44,229-262`).
`WALK_CYCLE_MS` is derived from the art's own table, the sum of `FRAME_MS.walk`
(`ui/src/art/worker.ts:600`), so the feet plant at the speed the figure is actually moving and
a walk cannot finish before the figure arrives. The frame index during a journey is
`min(count - 1, floor(progress * count))`, so the walk reaches its last frame exactly as the
figure arrives (`ui/src/workers.ts:313-350`). Capping at 7 cycles is deliberate: beyond that the
legs read as a blur, so a long journey covers more ground per cycle and slides slightly — a
slightly sliding long walk reads better than a blurring one. An in-flight walk is never
restarted by a new event, only retargeted if the destination actually moved by 3 pixels or more
(`ui/src/workers.ts:229-272`).

Direction is a mirror, never a second set of cels: `setFlipX(to.x < sprite.x)`
(`ui/src/workers.ts:263`). At this size an authored left-facing set is indistinguishable and
would double the art for nothing. A figure is never removed while the daemon still reports it
(`ui/src/workers.ts:135-170`). A sub worker is drawn shorter, never scaled: `cropRows(LEG, 2)` removes two
rows from the top of the leg part (`ui/src/art/worker.ts:582`), and `composePose` shifts the
whole upper body — torso, head, both arms and the tool — down by the same two rows while the
leg keeps its boot on the chief's ground line (`ui/src/art/worker.ts:318-337`). Both halves are
required: dropping only the legs leaves the figure's total height identical and merely hides the
missing rows inside the torso, which is the opposite of the smaller worker ADR-0007 asks for.
Measured: a chief's idle cel with its outline is 21 rows (5-25), a sub's is 19 (7-25) — the
shorter figure, with the feet still planted. The tier is then told by the helmet palette swap,
`HEAD.clone().replace(...)` from `helmetChief` to `helmetSub`
(`ui/src/art/worker.ts:557-563`), which is a recolour of one authored head rather than a
second drawing, so the two tiers stay recognisably the same worker.

## Accessibility and floors

Contrast of the panel, measured against its own background `--panel #161d27`
(`ui/index.html:36`), WCAG 2.1 relative-luminance ratio:

| Token | Value | On `--panel` | Note |
| --- | --- | --- | --- |
| `--text` | `#d7e0ea` | 12.7:1 | Body and all primary text |
| `--text-dim` | `#8595a8` | 5.54:1 | Metadata and muted rows; passes AA at any size |
| `--accent` | `#e6bb38` | 9.3:1 | Headings, focus ring, tier badge (`--void` on it is 10.15:1) |
| `--ok` | `#6fbf7a` | 7.59:1 | Live lamp |
| `--testing` | `#5aa9d9` | 6.55:1 | Event type, agent name |
| `--done` | `#57b8a0` | 7.08:1 | Paths, timestamps |
| `--down` | `#cf5a42` | 4.19:1 | Failure, pushed to 8.02:1 as `#f0a08a` on the error block's own `#2a1a18` |

Every informational colour clears 4.5:1 on all three panel grounds (`--panel`, `--raised
#1e2733`, `--sunken #101620`). The one exception is `.crew li.done`, which sets `opacity: .5`
on a crew row and lands at 4.12:1 (`ui/index.html:278`). It is not the only carrier of its
state: the class is applied when `w.action === "celebrating"` (`ui/src/App.tsx:148`), and the
action name is printed in its own right in the same row, so the de-emphasis is redundant
emphasis on a row whose content stays legible. Two further rules make state
legible without relying on hue: the connection lamp is squares, not circles, and it is spelled
out in words beside the colour (`ui/src/App.tsx:97-98`), and a failure in the feed is marked by
the signal colour on the row's own left rule plus a `!` glyph on the type, never a whole-row
wash that would make the feed unreadable after a few failures (`ui/index.html:309-319`).

Themed browser surfaces, because a default blue selection and a grey scrollbar are the cheapest
tell that a page was assembled rather than built (`ui/index.html:64-80`): `::selection` is
`--accent` on `--void`; the scrollbar track is `--sunken` with a `--edge` thumb, a 2px inset
border and `--edge-lit` on hover, plus `scrollbar-color`/`scrollbar-width` for Firefox.

Focus is explicit and themed rather than the browser default: a 2px `--accent` outline at 1px
offset on `:focus-visible` for both the global case and the two interactive controls
(`ui/index.html:77-80,323-326`). The panel's only depth device is the hard 1px bevel (below);
nothing in it is blurred or soft-edged. Two further shadow-like touches are not blurs and are
deliberate: the connection lamp carries a 1px `rgba(255,255,255,.28)` inset so an 8px square
reads as a filled cell rather than a flat patch (`ui/index.html:148-152`), and the bevel is
never re-inlined outside its own definition.

The responsive breakpoint is `max-width: 900px` (`ui/index.html:332-345`): the app switches to a
column, the town keeps its full width at 62% of the height, and the panel drops to full width
below it with a top border instead of a left one, scrolling under the town. The threshold is
measured, not guessed: at 390px the fixed 316px panel left the canvas 74px wide, which is not a
town anyone can read. There is no horizontal squeeze — the layout stacks instead of shrinking
the town to a sliver.

## Tokens and rules a new surface must reuse

**CSS variables**, `ui/index.html:27-52`: `--void #0e141c`, `--panel #161d27`, `--raised
#1e2733`, `--sunken #101620`, `--edge #2c3846`, `--edge-lit #3d4d5e`, `--edge-dark #0a0e14`,
`--text #d7e0ea`, `--text-dim #8595a8`, `--accent #e6bb38`, `--accent-dim #8a6414`, `--ok
#6fbf7a`, `--down #cf5a42`, `--testing #5aa9d9`, `--done #57b8a0`, `--pixel`, `--mono`.
`color-scheme: dark` is declared. Nothing is blurred, and the only `border-radius` is an
explicit `0` on the project `<select>` (`ui/index.html:188`), so a new surface stays square by
default and any rounding is a deliberate departure. The one gradient in the stylesheet is not
decorative: it is the two `linear-gradient` halves that draw the `<select>`'s arrow (`ui
/index.html:193-195`).

**The bevel is the panel's whole depth system**, declared once as a class and never re-inlined
(`ui/index.html:82-99`): a 1px lit edge top-left and a 1px dark edge bottom-right, as
`box-shadow` insets. `.bevel:active` and `.bevel-in` are the same recipe inverted, which is what
makes a press read as the surface moving inward. It is currently applied to the detail panel's
close button (`ui/src/App.tsx:137`); a new raised or sunken surface uses the class, not the
recipe.

**Names the bake and the scene share, from `ui/src/art/bake.ts`:** the texture key `ATLAS =
"town"` (line 32); frames `b<side>:<stage>:<variant>` (`buildingFrame`, 62), `s<side>`
(`shadowFrame`, 67), `w:<tier>:<state>:<i>` (`workerFrame`, 72), `g:<kind>:<variant>`
(`groundFrame`, 77), `ge:<kind>:<edge>:<variant>` (`groundEdgeFrame`, 81), `p:<kind>`
(`propFrame`, 87). A `FrameInfo` carries `x, y, w, h` plus `ox, oy`, the pixel inside the cel
that is the world origin (line 35).

**Determinism is a rule, not a preference** (ADR-0012): the same repo must draw the same town
forever, so every choice is a hash of a stable input and never a counter, an iteration order, or
`Math.random`. `skinVariant(path)` (`ui/src/art/building.ts:67`), `tileVariant(wx, wy)`
(`ui/src/art/terrain.ts:73`, with the mix deliberately folding high bits because a plain
multiply-xor returns 0 for every position the scene samples), `stableOffset(id)`
(`ui/src/workers.ts:392`) and `crewColour(agent)` (`ui/src/art/palette.ts:108`) all follow it.

**A new sprite must follow all of:**

1. **Draw with palette colours only.** Every colour resolves through `P` or `CREW_COLOURS`; the
   allowlist is `paletteSet()` (`ui/src/art/palette.ts:126`), which walks the palette's own
   structure rather than restating it, so a ramp added to `P` is automatically allowed and a hex
   typed by hand is automatically not.
2. **Author it on a `Pix`** (`ui/src/art/surface.ts:44`) — an RGBA buffer with no blend modes,
   no gradients and no filters. A colour is either placed or it is not.
3. **Outline once, at the end, at 1px, in `P.ink`.** `Pix.outline` (`ui/src/art/surface.ts:233`)
   is the only implementation. It runs on the assembled cel, never per part: a per-part pass
   would draw ink at every joint between wall and roof and make the building read as a diagram.
   The outline is on all four sides of every opaque pixel **that has room inside the cel** — the
   pass can only write within the surface it is handed, so a sprite whose art reaches its own
   cel edge loses that side's ink (see deviations 1 and 2). Terrain is exempt in principle, not
   by accident: ground tiles are drawn edge to edge and take no ink at all.
4. **No semi-transparency, ever.** Alpha is 0 or 255 throughout the baked world. A partially
   transparent edge is the antialiasing halo that looks right against grass and wears a fringe
   over the panel; `outline` draws ink instead.
5. **Ordered dither only.** Ground uses a fixed lattice — a 25% dither on the lit facet, a 50%
   checker on the dark one (`ui/src/art/terrain.ts:120-140`) — and an edge band uses a 50% dither
   with a single darker lip run on the very border (`groundEdgeTile`,
   `ui/src/art/terrain.ts:195`). Random dither at this size is noise; a lattice reads as texture.
6. **Write sprite grids as character rows** via `sprite()` (`ui/src/art/surface.ts:371`). One
   character is one pixel. `.` is the *only* character meaning transparent, and every other
   character must have an entry in the key, or `sprite()` throws at bake time naming the
   offending character and listing the key's own characters. All rows must be the same length,
   or it throws. This is enforced rather than aspirational: an unmapped character used to be
   silently skipped, which drew nothing and left a hole that the outline pass then boxed into a
   solid ink blob — opaque, on-palette and type-safe, so neither `tsc` nor the bake could see it.
   The boots on all 76 worker cels and the fill of `PAPER` and `BLUEPRINT` were drawn that way,
   and were found only by re-deriving the grids by hand.
7. **Assemble by composition, not repetition.** Parts are drawn once as character grids and
   blitted into place (`compose`, `ui/src/art/surface.ts:412`). A helmet is drawn once, not
   re-invented for each of a worker's cels. A pose is data (`composePose`,
   `ui/src/art/worker.ts:318-337`), so a walk cycle cannot drift between frames. A variant is
   made by recolouring one authored cel rather than by drawing a second: the tier difference is
   `Pix.replace` on the head (`ui/src/art/worker.ts:560-563`). Two further recolor helpers exist
   on `Pix` — `blitTinted` (`ui/src/art/surface.ts:169`) and `flipX`
   (`ui/src/art/surface.ts:202`) — and both are currently unused by the art layer. Direction is
   mirrored at runtime by Phaser's own `sprite.setFlipX` (`ui/src/workers.ts:263`), not by
   `Pix.flipX`.
8. **Place it with an origin, and set it with `.setOrigin(0, 0)`.** Register the cel's origin
   pixel in the bake, place via the scene's `place()` (`ui/src/scene.ts:181`).
9. **Ramp discipline for any new colour:** 4 steps, hue-shifted shadows, warm highlights, drawn
   from the top-left sun. If a colour is genuinely new, it is added to `P` with a reason, not
   typed into a call site.
10. **The boot assertion is the floor.** `assertPaletteClean` (`ui/src/art/bake.ts:256-292`)
    reads the finished atlas back and throws on any pixel that is off-palette or any alpha that
    is not 0 or 255, naming the frame and the colour. It reads the assembled surface rather than
    the cels so it catches a colour introduced by any route — a typo in a sprite key, a blend in
    a primitive, a drift in a shade computation. An off-palette colour is a failed build, not a
    slow drift nobody notices.

## Defects found and fixed

Recorded because each was invisible to `tsc` and to the boot-time palette assertion, and because
a later reader would otherwise reintroduce them. Every one was found by measuring the real art
modules rather than by reading the code.

1. **Outline clipping on the scaffolded stages** — fixed. Those cels carried non-ink pixels on
   the cel's **left** and **bottom** edges, because the scaffold's poles stand at world `-5` and
   the spoil pile reaches world `side + 14`, both beyond `boxFor`'s margin of 4. The outline had
   nowhere to write, so the left ends of the scaffold walk boards and the lower edge of the spoil
   heap lost their ink line. `boxFor`'s margin is now 6 (`ui/src/art/building.ts`); measured
   across every building cel, none now has non-ink artwork on a cel border, and patching the
   margin back to 4 reproduces the faults. The stages this affected were `framed` and `walled`,
   which are the two that draw a scaffold.
2. **`sprite()` accepted unmapped characters** — fixed at the root. A character absent from a
   `sprite()` key was silently skipped, so it drew *nothing*. Two defects shipped that way: `b`
   was missing from the worker key (`ui/src/art/worker.ts`), leaving every boot body empty so the
   cel outline boxed the bare trouser stem into a solid ink blob on all 76 cels; and `p` was
   missing, hollowing `PAPER` and `BLUEPRINT`. Both keys are restored, and `sprite()` now throws
   on any character that is not `.` and not in the key, naming it — the result was opaque and
   on-palette, so nothing downstream could see it.
3. **The sub worker was not actually shorter** — fixed. Shortened legs were dropped to the
   chief's ground line but the upper body was not dropped with them, so the missing rows simply
   hid inside the torso and a sub came out the same height as a chief. The whole upper body now
   shifts by the same amount: chief 21 rows, sub 19, both with feet on the origin row.
4. **The stale `pad()` claim** — fixed. `ui/src/art/worker.ts` and `Pix.pad` both stated the
   outline runs after padding; `pad()` had no call sites and the cel boxes are sized for the
   headroom instead. The comments now say that, and `pad()` is gone.
5. **Ground edge bands were transposed** — fixed. The scene paired a region's border in **x**
   with the band that hugs **y** and vice versa, drawing the rim across the middle of every plate
   while leaving the real boundary bare. A border in x now takes `west`/`east` and a border in y
   takes `north`/`south`.
6. **A reconnect discarded the viewport** — fixed. Framing the camera on every layout *identity*
   change also fired on the SSE reconnect path, which re-fetches the same town as a new object.
   The fit is now keyed to a signature of the town (size, site count, district count), so a
   project switch re-frames and a reconnect does not. Verified both ways against the live page.
7. **The lifecycle could not express a half-built building, and its top rank was unreachable** —
   fixed. Every building was drawn as `constructing`, which composited framing *plus* walls at
   60% *plus* scaffold, so a building was either a pillar or almost-finished and there was no
   rank for "just the frame". `completed` was declared, ranked highest, and assigned nowhere: no
   test could ever reach a building at all, because `Classify` sent every shell command to the
   Yard. The status field also carried damage, so a failure erased progress. The eight-rank
   cumulative ladder, the separation of `Damaged` from `Status`, and the directory lookup that
   lets a scoped test resolve to its building are the fix (ADR-0018). Reachability is now a test
   rather than a promise.

**Not a deviation, recorded so the rule is not misread:** ground tiles deliberately have no ink
outline. Tiles are drawn edge to edge and a 1px ink border on each would draw a grid over the
field. The "1px ink outline" rule applies to figures, buildings and props, never to terrain; the
ground's edge treatment is the dithered edge piece described above.
