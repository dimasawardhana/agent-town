# Solid Town Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second renderer that draws the town as modelled 3D geometry, so a
developer can see their agent working in a solid world — while answering the same
three questions the flat town answers: where the agent is, what it is doing, and
whether the work left the building better or worse.

**Why:** The flat town is finished and verified, and it is not the direction of
the project. The thing the solid renderer actually buys is not prettiness: it is
that the vocabulary stops being rationed by texture memory. `archetypes-roads/spec.md:205`
records 26 archetypes as the hard ceiling, with 24 of those leaving under 100 cels,
and Phase 0 had to find 320 cels that drew nothing before one more archetype could
be afforded. None of that arithmetic applies to a mesh.

**Architecture:** One town, two renderers. They share the layout the daemon sends
(`X, Y, W, H, Floors, Archetype`), the vocabulary, and the camera. They share no
drawing. The solid renderer builds geometry from a modelling kit of eight
operations and instantiates it per (archetype, material, part); it never touches
`IsoPix`, and `IsoPix` never learns about it. See ADR-0023, ADR-0024, ADR-0025.

**Tech Stack:** three.js (vendored, offline — no CDN, no remote asset), TypeScript,
React 19, Zustand 5, `node:test` + `esbuild` for the suite. **Go changes in exactly
one place** — a building's material has to reach the renderer — and nowhere else.

---

## Decisions Taken

Recorded in full in the ADRs. The load-bearing ones, with their numbers:

1. **The solid town is authored geometry, not a port** — ADR-0023. A modelling kit
   of eight operations: extrude, set-back, chamfer, window reveal, roof overhang,
   parapet, profile sweep, canopy.
2. **The flat renderer is frozen** — ADR-0024. `IsoPix`, the atlas, ADR-0021's
   ceiling and the 50 art tests all stand; nothing invests in them further.
3. **Solid is a renderer, not a view preference** — ADR-0025. Turn and Follow
   apply to both (ADR-0020 and ADR-0022 survive verbatim); there is no plan view.
4. **The sun is real and it moves with the day phase** — ADR-0026. This reverses
   an answer given in the same session, and is recorded rather than hidden.
5. **Material owns its own geometry** — 12 archetypes x 5 materials = 60 forms x 3
   parts (base, band, cap) = **180 building meshes**, instanced.
6. **First milestone is a throwaway spike** — one archetype, one material, all
   eight ranks, one worker, the toggle, the sun. Its only job is to answer whether
   this is legible.

## Global Constraints

- **Go changes in one place, and only one.** `Site` already carries `X`, `Y`, `W`,
  `H`, `Floors` and `Archetype` (`internal/analyzer/layout.go:105-108`, `:80`,
  `:103`), so geometry needs nothing. The exception is a building's *material*:
  the renderer cannot invent it, because nothing declares it, so it has to travel
  on the wire. A change to `internal/` anywhere else means something outside this
  plan's scope moved.

- **The layout is never recomputed in the browser** (ADR-0012). Geometry is built
  *at* the positions the daemon sent, never derived. `Floors` is a count and
  `STOREY` is 20 world units (`ui/src/art/stack.ts:23`); a tower is `Floors`
  bands, and the browser may not invent a count.

- **Determinism is the keystone invariant.** Geometry is a pure function of
  (archetype, material, footprint, stage). No `Math.random()`, no clock, no
  map-iteration-order dependence. Damage displacement is a stable hash of the
  site path, for the same reason the archetype is.

- **The fixed 2:1 dimetric angle does not change.** No perspective, no free orbit,
  no rotation beyond the four quarter turns. The turn orbits the camera; the world
  never turns (ADR-0020).

- **The light follows the reader in neither renderer, but the two renderers differ.**
  The flat town pins its key to the picture's top-left, because a cel's shading is
  baked. The solid town fixes its key in the world, because its light is real — so a
  turn re-lights the town (ADR-0026 §3). That divergence is deliberate and the flat
  renderer is not touched to remove it.

- **Offline and loopback-only.** No CDN, no web font host, no remote asset at
  runtime. three.js is vendored into the bundle and travels inside the binary
  (ADR-0017's posture is unchanged by a bigger binary).

- **No binary art assets.** Geometry is authored in TypeScript. No `.glb`, no
  `.png`, no second toolchain. This is why the models are code (ADR-0023).

- **The flat renderer is not modified.** Not for shared helpers, not for
  refactoring, not "while we are here". A change under `ui/src/art/` in this plan
  is a defect in the plan.

- **House style — heavy explanatory comments explaining _why_.** Comments state
  what a reader would otherwise mis-read, and the reasoning behind a number
  belongs next to the number. No comments that restate the line below.

- **Never commit unless the user asks.**

---

## Measured Facts

Read from this repository on 2026-10-02. **Do not re-derive these; do not
contradict them.**

1. **The wire already carries a 3D box.** `Site` sends `X`, `Y`, `W`, `H`
   (world units) and `Floors` (`internal/analyzer/layout.go:105-108`, `:80`).
   `Archetype` travels too (`:103`) so the renderer does not hash a path the
   analyzer already decided. **Material does not travel**, which is the one gap on
   the wire and the reason Task 4a exists.

2. **`STOREY` is 20 world units and `MAX_FLOORS` is 20** (`ui/src/art/stack.ts:23`,
   `:34`), and `clampFloors` is the one place a floor count becomes usable
   (`:51`). A tower of N storeys has bands at `z = 0, STOREY, …, (N-1)*STOREY` and
   its cap at `N*STOREY` — `towerTop`, `:64`. Off-by-one here is invisible on a
   one-storey building, which is why it is a named function.

3. **Five footprints exist: 44, 58, 72, 86, 100 world units** (`ui/src/art/bake.ts:105-111`,
   paired with file counts 2, 5, 9, 12, 30). `PRODUCT.md:73` says "44/60/78/100" —
   that is stale and the code is right.

4. **Twelve archetypes** (`ui/src/art/roof.ts:34-38`): tenement, works, cottage,
   hall, library, stadium, hospital, chapel, tower, market, school, restaurant.

5. **Five materials, and the current mapping is total** (`ui/src/art/roof.ts:1226`,
   `:1237-1250`): stone 3 (library, chapel, school), render 2 (tenement,
   hospital), glass 1 (tower), timber 3 (cottage, market, restaurant), concrete 3
   (works, hall, stadium). The solid town makes this a default and not a fact
   (ADR-0023 §3); the flat town keeps it total.

6. **Eight ranks** (`internal/town/town.go`, ADR-0018): PLANNED, FOUNDATION,
   FRAMED, WALLED, ROOFED, GLAZED, DOORED, COMPLETED. The first four are structure
   and are raised by changes; the last three are finish and are raised by passing
   tests. One event advances at most one rank.

7. **Eight actions, four poses.** Actions: READING, HAMMERING, BUILDING,
   DEMOLISHING, TESTING, COMMANDING, PLANNING, CELEBRATING. Poses: work, idle,
   travel, done (`ui/src/art/machine.ts:38`). Several actions share a pose, and
   README.md:89-90 says "each action has its own rhythm" — so the rhythm lives in
   the motion, not in the mesh.

8. **Five machine kinds** (`ui/src/art/machine.ts:41`). The gesture is what names
   the kind and carries the pose: a boom rises and falls, a jib runs out sideways,
   a bucket drops, a blade stays low.

9. **Three day phases** (`ui/src/daylight.ts:25-28`), and `lit` is true at dusk and
   night and false at day (`:120`, `:132`, `:140`). Windows already gate on
   `DAYLIGHT[day].lit` **and** the `glazed` rank (`ui/src/scene.ts:1948`).

10. **Determinism is a stated convention the flat art already keeps, and the
    solid town must keep it the same way.** Nothing in `ui/src` calls
    `Math.random` — the three mentions are all comments forbidding it
    (`ui/src/art/building.ts:840`, `ui/src/art/roof.ts:73`, `ui/src/sky.ts:14`).
    The two mechanisms in use are the ones damage may choose between for its
    displacement, and they are not equivalent:

    - **A deterministic walk**, `crack` (`ui/src/art/building.ts:842-848`): start
      at `round(side * 0.7)` and step `x` by `±1` every third row. Depends only
      on `side`.
    - **A hash of integer world coordinates**, `groundVariant`
      (`ui/src/art/terrain.ts:104`): the same world position always returns the
      same variant, which is what stops the ground changing between builds.

    A hash keyed on the **site path** is the right one here: it is stable across
    turns and rebuilds, and it survives the building moving to a different plot.
    A walk keyed on `side` would make every 58-footprint building crack
    identically, which is the failure the archetype hash already exists to avoid.

11. **`ui/test` holds 25 test files and `package.json` defines 26 `test:` scripts;
    the `test` chain runs 25 steps.** The chain ends at `test:traffic`, which
    references a file that does not exist — `ui/test/traffic.test.ts` is absent at
    HEAD — so `npm test` fails at its final step today. `test/turndep.test.ts`
    exists with **no script**, so it never runs. Both are pre-existing, and
    neither is this plan's to fix silently.

---

**Ticket map.** This plan's tasks correspond to the seraph board as follows, and the
board is the sequence of record — this document carries the reasoning, the board
carries the state.

| Plan section | Ticket | Blocked by |
|---|---|---|
| (prefactor) | TASK-101 Repair the test chain | — |
| Task 1 | TASK-102 The renderer seam and the second canvas | 101 |
| Task 2 | TASK-103 One building, all eight ranks *(the ground in Task 2 became TASK-109)* | 102 |
| Task 3 | TASK-104 One worker, and the sun *(the verdict in Task 3 became TASK-105)* | 103 |
| Task 3a | TASK-105 The verdict | 104 |
| Task 3c | TASK-115 The detail filter | 103 |
| Task 3d | TASK-113 The look | 104 |
| Task 4 | TASK-106 The kit | 105 |
| Task 4a | TASK-114 Material travels on the wire | 102 |
| Task 5 | TASK-107 Sixty forms | 106, 114 |
| Task 6 | TASK-108 Damage, and the four turns | 107 |
| Task 7 | TASK-109 The ground and the three places | 103 |
| Task 8 | TASK-110 Follow, and picking | 104 |
| Task 9 | TASK-111 Labels | 110 |
| Task 10 | TASK-112 The solid suite | 108, 109, 110, 111 |

Every ticket is a tracer bullet — a complete path through model, scene and view —
and the board is the sequence of record. This document carries the reasoning; the
board carries the state, and where they disagree the board is right.

---

# Phase 0 — The spike

**Throwaway, and that is the point.** Its only deliverable is an answer: is a
solid town legible at a glance? It builds the smallest thing that can answer
PRODUCT.md's three questions and none of the other 179 meshes. If the answer is
no, this phase is the whole cost of finding out.

## Task 1: Vendor three.js and open a second renderer

**Files:**
- Create: `ui/src/solid/scene.ts` — the three.js scene, camera, renderer, frame
  loop. Owns its own `<canvas>`.
- Create: `ui/src/solid/SolidView.tsx` — the React component that mounts it.
- Modify: `ui/src/store.ts` — add `renderer: "flat" | "solid"` and `setRenderer`,
  beside `view`, `turn` and `day`. Display state; it never reaches the daemon.
- Modify: `ui/src/Hud.tsx` — the renderer control, beside the turn and day
  controls.
- Modify: `ui/package.json`, `ui/package-lock.json` — three.js.

**Do not** import anything from `ui/src/art/`. The palette `P` from
`ui/src/art/palette.ts` is the one permitted import (ADR-0023: the two renderers
share the palette and nothing else).

- [ ] **Step 1: Add three.js.**

```bash
cd ui && npm install three
```

Vendored into the bundle by Vite; nothing is fetched at runtime.

- [ ] **Step 2: `ui/src/solid/scene.ts`.**

A fixed 2:1 dimetric camera, not a perspective one. The flat town's projection is
`(wx - wy) / 2, (wx + wy) / 4 - z`; the solid camera must reproduce that framing
under an orthographic camera so a reader flipping between renderers does not have
the town change shape. State the projection in a comment next to the camera
setup, with the reason: an isometric camera that did *not* match would make every
spatial memory the reader has from the flat town wrong.

- [ ] **Step 3: `ui/src/solid/SolidView.tsx`.**

Mount the canvas, start the loop, tear it down on unmount. The scene must not
leak: a renderer that is not disposed leaves a WebGL context alive, and a reader
toggling back and forth would exhaust the browser's context limit.

- [ ] **Step 4: The store and the control.**

`renderer` sits beside `view`, `turn` and `day`. It is display state like the
others (ADR-0025 §1: not a `ViewMode`).

**The plan drawing does not carry across.** Switching to solid while the plan
drawing is showing drops the plan and puts the reader in the isometric town: the
solid renderer has one drawing, so there is no plan to carry. The plan control is
offered only in the flat renderer, where it can do what it says. Remembering a plan
state across a renderer round trip was declined — a reader toggling to solid and
back would find the flat town in a drawing they did not choose, with nothing on
screen having said so.
- [ ] **Step 5: Verify.**

Toggle to solid and back ten times. The flat town must be pixel-identical to
before the toggle, and the browser console must show no context-lost warning.

## Task 2: Ground, one building, eight ranks

**Files:**
- Create: `ui/src/solid/kit.ts` — the eight operations. Only `extrude` and
  `set-back` are needed for this task; the rest arrive in Phase 1.
- Create: `ui/src/solid/forms.ts` — one form: a single archetype in a single
  material, as base, band and cap.
- Create: `ui/src/solid/build.ts` — a site to a `THREE.Group`.

- [ ] **Step 1: The kit, and its unit rule.**

Every operation takes its measurements as a **fraction of the footprint**, never
in absolute world units (ADR-0023 §2). A chamfer in absolute units distorts across
a 44-to-100-unit range and is the reason one form cannot serve five sizes.

- [ ] **Step 2: One form, three parts.**

Base, band, cap — three parts, because the ladder reveals parts. The band is the
storey that repeats; a tower is the band instanced `Floors` times at `z =
i * STOREY`, with the cap at `towerTop(floors)`.

- [ ] **Step 3: The ladder reveals.**

Each rank adds its part and nothing else: framing at FRAMED, walls at WALLED, the
cap at ROOFED, glazing at GLAZED, the door at DOORED, the trim at COMPLETED. The
first four are structure, the last three are finish (ADR-0018). **The building
must never be seen to skip a part.**

- [ ] **Step 4: The sun.**

One directional light, its direction fixed per day phase, its direction
**independent of the turn** (ADR-0026 §3). Materials take their base colour from
`P` and the light supplies the shading.

- [ ] **Step 5: Verify.**

Drive a site through all eight ranks one event at a time and watch each. No rank
may be skipped, no part may appear early, and the cap must sit at
`towerTop(floors)` — check a one-storey building and a twenty-storey one, because
that error is invisible on the first.

## Task 3: One worker, the toggle, and the verdict

**Files:**
- Create: `ui/src/solid/machine.ts` — one machine kind, four poses.
- Modify: `ui/src/solid/build.ts` — workers as groups.

- [ ] **Step 1: One machine, four poses, and a procedural gesture.**

Per-pose meshes, and the gesture animated procedurally rather than by a rig — the
boom swings, the bucket drops. `CONTEXT.md` says the gesture is what names the
kind and carries the pose, so animating exactly that part is well targeted at what
the vocabulary needs. The *rhythm* differs per action even where the pose does
not: a hammer blow is fast with a slow follow-through, and README.md states "each
action has its own rhythm" as a property the reader relies on.

- [ ] **Step 2: Walking.**

A transform along the path the layout already gives. The flat town's walk is
arc-length parameterised with a bob and a lift; the solid one should read as the
same walk, because "a worker walks before it works" is one of the five things
README.md promises the reader sees.

- [ ] **Step 3: The verdict.**

Answer these, with a screenshot each, and write the answers into the plan:

1. **Where is the agent?** Can you find the worker without hunting?
2. **What is it doing?** Can you read the action off the pose and the caption?
3. **Did the building get better or worse?** Can you tell a rank advance from a
   damage state?

If any answer is no, **stop and report**. The rest of this plan is not worth
building, and PRODUCT.md principle 4 is "gaps stated, not hidden".

- [ ] **Step 4: Record the outcome and report instead of committing.**

```bash
git add -A && git diff --cached --stat
```

Report the file list, the three answers, and every check that could not be run.


# Phase 1 — The kit and the wire

**The verdict gates the kit and everything after it, and it does not gate the
parallel work below** — a reader losing control of a large town is not a question
the verdict decides.

## Parallel work: the look, and the detail filter

**These two are not part of the spike and must not be built into it.** The spike is
throwaway and exists to answer one question; these are kept work that starts around
it. They are here rather than in Phase 0 for that reason — an executor reading top
to bottom would otherwise build them, then discard them with the spike.

## Task 3c: The detail filter

**Blocked by Task 2 — does not wait for the verdict**, because a reader losing
control of a large town is not a question the verdict decides.

- [ ] **Step 1: A building is drawn while its own depth is within the filter.**
- [ ] **Step 2: A container is drawn exactly while the buildings it summarises are
  hidden** — never both at once, which would show the same bytes twice. This is the
  correction of a real defect in the flat town, not a refinement.
- [ ] **Step 3: The three special places cannot be hidden by any filter**, because
  an event must always have somewhere to land (ADR-0012).
- [ ] **Step 4: Hiding a deep directory does not change the size of the ground.**

This matters more in the solid town than in the flat one: a flat town simply does
not draw a hidden building, while a solid one occludes what is behind it whether or
not the reader wants it seen. Hiding is the only simplification available.

## Task 3d: The look

**Blocked by Task 3 — needs a worker and a sun to light.** The look needs the longest
wall-clock of anything here because it is tuned by eye rather than reasoned to.

- [ ] **Step 1: A warm low key, a cool sky fill, and both move with the hour.** Each
  phase supplies its own key and ambient from the palette's own sky keys, so a
  shadow goes blue-violet by the palette's stated rule arriving by physics rather
  than by drawing. **The key is not one fixed colour** — a single gold for day, dusk
  and night would flatten the hour into decoration and waste the shadows. Dusk stays
  the default: it is the light the palette was built for, and day is the least
  flattering hour for low-poly geometry.
- [ ] **Step 2: Shadows tinted by the sky, not blackened.**
- [ ] **Step 3: Distance fog toward the palette's haze tones.** The backdrop's own
  description of a distant field — duller, hazier, lighter, separated by value and
  saturation rather than hue — is a description of aerial perspective.
- [ ] **Step 4: Corner occlusion derived from the kit, not post-processed.** A
  set-back shades the surface below it and an overhang darkens the wall beneath; the
  kit already knows, so this is baked per vertex at build time and is deterministic.
- [ ] **Step 5: The four details that carry the look** — a real roof overhang,
  recessed windows, a plinth at the base, chamfered vertical corners.
- [ ] **Step 6: Contact shadows and kerbs as raised geometry.** A flat plane under
  good buildings reads as a paper diorama.
- [ ] **Step 7: Bloom on lit windows only.** No vignette, no depth of field, no
  screen-space occlusion.
- [ ] **Step 8: Expose the sun and the fog as knobs and tune by looking.** This is
  the one part of the plan that cannot be specified, only judged.


## Task 4: The eight operations

**Files:**
- Modify: `ui/src/solid/kit.ts`.

Extrude, set-back, chamfer, window reveal, roof overhang, parapet, profile sweep,
canopy. The sweep is one operation covering three archetypes — a 2D profile
carried across the footprint gives the Chapel's spire, the Stadium's dome and the
Library's gable. The canopy exists because the Restaurant's flat roof cannot be a
sweep: a gable's ridge is a *line* and nothing can be placed on one.

- [ ] **Step 1: Each operation, footprint-relative, with its own test.** A defect
  in `chamfer` is a defect in every form that uses it, so the kit's tests are the
  load-bearing ones.
- [ ] **Step 2: Verify the extremes.** Every operation at footprint 44 and at 100,
  in all four turns. A chamfer that is correct at 100 and inverted at 44 is the
  failure this step exists to catch.

## Task 4a: Material travels on the wire

**Files:**
- Modify: `internal/analyzer/analyzer.go` — read a declared material from the
  manifest beside the declared archetype.
- Modify: `internal/analyzer/layout.go` — carry it on the `Site` payload.
- Modify: `ui/src/solid/forms.ts` — select a form by (archetype, material).

**This is the only Go change in the plan.** It exists because a decision taken in
this session — any archetype may take any material, giving sixty forms — cannot be
built otherwise: nothing on the wire carries a material, so twelve archetypes each
render in their one default material and forty-eight forms have no selector.
**Blocked by Task 1; Task 5 is blocked by this.**

- [ ] **Step 1: The declaration travels unvalidated**, exactly as an archetype name
  already does (`analyzer.go:715-719`: the analyzer has no vocabulary, the renderer
  owns the set, an unknown name travels and is ignored). Do **not** validate the
  name in Go: validating it would duplicate the list in two languages and let them
  drift, which is the failure the whole archetype axis was built to avoid.
- [ ] **Step 2: A building with nothing declared falls back to its archetype's
  default material** — the mapping the flat town already keeps.
- [ ] **Step 3: Go tests** for a declared material travelling, and for an unknown
  one being ignored rather than rejected.
- [ ] **Step 4: Verify.** Every one of the sixty forms is reachable, and a town with
  no declarations renders exactly as it did before.

---

# Phase 2 — The building

## Task 5: Sixty forms

**Files:**
- Modify: `ui/src/solid/forms.ts`.

12 archetypes x 5 materials. Material owns its geometry (ADR-0023 §3): a glass
building is a curtain wall, a stone one is masonry. **A material must be
selectable before these forms mean anything** — see Task 4a.

- [ ] **Step 1: The twelve archetypes, each in its default material.**
- [ ] **Step 2: The remaining 48 forms**, each reachable by a declared material.
- [ ] **Step 3: Instancing.** One geometry per (archetype, material, part); a site
  is a matrix. Draw calls must stay flat as the town grows.
- [ ] **Step 4: Verify.** A town of 30 sites renders at 60fps, and the same town
  rendered twice is identical.

## Task 6: Damage, and the four turns

**Files:**
- Modify: `ui/src/solid/forms.ts` — the damaged variant of each form.
- Modify: `ui/src/solid/build.ts` — the damage state, and the camera orbit.

- [ ] **Step 1: Damage is a material swap plus deterministic displacement.** The
  displacement is a stable hash of the site path. Damage never moves the ladder
  (ADR-0018) and must never be mistakable for an unfinished rank — that confusion
  is the one failure this step is for.
- [ ] **Step 2: The four turns.** Turn orbits the camera; the world does not move.
  **The light does move relative to every face**, because it is fixed in the world
  rather than in the picture — so a building is lit from a different side at each
  quarter turn, and that is intended rather than a defect (ADR-0020, ADR-0026 §3).
- [ ] **Step 3: Verify.** At each rank, damaged and undamaged must be
  distinguishable at the fitted zoom, and the same from all four turns.

# Phase 3 — The places, the camera, the labels

## Task 7: Yard, Workshop, Depot, and the ground

- [ ] **Step 1: The ground.** Flat, sized from the layout's own extent and never
  from the sites — the field does not come and go with the detail filter.
- [ ] **Step 2: The seven ground kinds, as regions; the kerb as a line.** A kerb
  must stay legible at the fitted zoom, where a whole district is ninety pixels
  across.
- [ ] **Step 3: A little furniture.** The Yard is roughly half of every session
  and a worker on a bare plate is a figure on a field.
- [ ] **Step 4: Verify.** A worker is never on a surface that could be mistaken
  for another place.

## Task 8: Follow, and picking

- [ ] **Step 1: Follow as a camera distance and aim** (ADR-0025 §2). The reason
  the flat town floors its zoom at three is that a machine too far away cannot be
  read; distance expresses the same thing.
- [ ] **Step 2: A target that disappears releases the follow.** A camera holding a
  remembered coordinate sits over empty ground with full confidence, which is the
  one thing this town is not allowed to do.
- [ ] **Step 3: Raycasting.** A worker behind a building is not pickable, because
  it is not visible. The overlay must keep `pointer-events: none` on the map so a
  label never eats a drag.
- [ ] **Step 4: Verify.** Follow a worker through a turn, a view toggle and a
  session end.

## Task 9: Labels

- [ ] **Step 1: 2D DOM, projected from a world point.** Type in 3D space
  foreshortens and aliases; DOM type stays crisp at any zoom.
- [ ] **Step 2: The 3×5 font as a DOM webfont**, so both renderers typeset alike.
  `ui/src/art/font.ts` is the only hand-authored pixel art in the project and this
  is the last thing it buys.
- [ ] **Step 3: Verify.** A label tracks its building through a turn without
  drifting, and one label is pinned at a time (ADR-0019).

# Phase 4 — Verification

## Task 10: The solid suite

**Files:**
- Create: `ui/test/solid*.test.ts`.
- Modify: `ui/package.json` — add the scripts to the chain.

- [ ] **Step 1: Determinism as the keystone.** The same layout produces the same
  world, every time. This is the invariant the flat renderer already promises and
  the solid one could silently break.
- [ ] **Step 2: What transfers from the flat suite.** Stage distinctness, stage
  climbing, parts disjoint, footprint matching the layout.
- [ ] **Step 3: What geometry breaks on that cels could not.** Closed meshes;
  storey count equal to `Floors`; every operation correct at both footprint
  extremes.
- [ ] **Step 4: Run the flat suite unchanged.** It must still pass — the flat
  renderer was not touched.

---

## Self-Review

**The plan's own open items, stated rather than hidden:**

- The spike may fail. If it does, Phase 0 was still worth its cost and Phases 1-4
  are not built. That is the plan working, not the plan failing.
- `npm test` is red at `test:traffic` today, independently of this plan, and
  `test/turndep.test.ts` never runs. Phase 4 adds scripts to a chain that is
  already broken at its last step; that defect should be fixed before the chain is
  extended, not after.
- `PRODUCT.md:73` records footprints as "44/60/78/100" against the code's
  "44/58/72/86/100". Stale, and out of scope here, but it is the kind of number
  this project normally pins down.
- 180 meshes is the largest single cost in this plan and the number most likely to
  move once Phase 2 starts. It is an estimate derived from a decision, not a
  measurement.
- The subagent question is still open (`CONTEXT.md`, Open Questions): Go hardcodes
  `Tier: "chief"`, so an omp subagent's work folds into its chief's machine. The
  solid renderer inherits this rather than settling it.
