# Spec: the solid town

**Status:** ready-for-agent
**Effort:** `solid-town`
**Depends on:** nothing that blocks a start. It touches the daemon in exactly one
place — a building's material has to reach the renderer — and that is ticket 14.

## Problem Statement

I can watch my agent work in a town, and the town is a flat picture. Buildings
are 2:1 dimetric sprites with their skew baked into the pixels, so there is no
view of them but the one the art was drawn for: I cannot look at a tower from
another side, I cannot see a worker walk *behind* something, and nothing in the
picture has real depth. Height is the only dimension the town has, and it is
doing two jobs already — how big a building *is* and, in the plan view's absence,
what is where.

The flat town is also at the end of its vocabulary. Every building is a cel on a
2048x8192 sheet holding 1145 of a possible 1296 frames, and that ceiling is why
the town has twelve archetypes rather than more: reaching a better list of places
means giving something up, and the thing being given up is texture memory, not
design. The Road work already lost a feature to this budget — import roads became
nine checkered bands on a sheet with no room, and the fact had to move onto the
building instead.

I want to see my agent's work as a place rather than as a picture of a place,
without losing anything the picture already tells me.

## Solution

A second renderer: **the solid town**. The same town — the same districts, the
same buildings, the same ladder, the same damage, the same workers, the same
places — drawn as modelled 3D geometry on a fixed 2:1 dimetric camera, with real
light and real cast shadows.

It is reached by a renderer control beside the turn and day controls, and it is
additive: the flat town stays exactly as it is and stays the default, so nothing
that works today stops working, and switching back is one control.

The solid town answers the same three questions the flat one answers, and it is
held to them: **where the agent is**, **what it is doing**, and **whether the work
left the building better or worse**. It is not a prettier log and it is not a
game. A worker that looks idle while the agent is working is still the one
unforgivable failure, in either renderer.

What it buys, in one line: **the vocabulary stops being rationed by texture
memory.** A mesh has no atlas, so the ceiling that caps the archetype list at
twelve stops applying to the solid town entirely.

## User Stories

### Seeing the work

1. As a developer running an agent, I want to see my agent working in a world with
   real depth, so that I can tell at a glance what it is doing without reading a
   log or a transcript.
2. As a developer, I want the worker to walk to the building it is about to work
   on, so that I can see *where* the work is happening, not just that it is.
3. As a developer, I want each action to have its own rhythm, so that a hammering
   worker reads differently from a testing one without me reading a caption.
4. As a developer, I want the worker's gesture to differ by machine kind, so that
   a boom, a jib, a bucket and a blade are told apart by what they do.
5. As a developer, I want a chief worker and a sub worker to be distinguishable,
   so that I can tell the agent driving the session from what it spawned.
6. As a developer, I want two crews on one repo to be told apart, so that which
   session is which is never a guess.
7. As a developer, I want my agent to be findable without hunting, so that a busy
   town does not turn "where is it" into a search.
8. As a developer, I want the town never to look idle while my agent is working,
   so that I am not misled about whether the agent is doing anything.

### The building ladder

9. As a developer, I want a building to climb the eight ranks one part at a time,
   so that I can see what the work has actually raised.
10. As a developer, I want a building never to skip a rank, so that I can trust
    what its silhouette says about how far the work has got.
11. As a developer, I want the roof to appear only when the roof is earned, so
    that a building's shape is a statement about its code and not decoration.
12. As a developer, I want glazing to appear only when tests have passed, so that
    the finish of a building means what the ladder says it means.
13. As a developer, I want a building's height to mean how much source it holds,
    so that a large module reads as a tall tower.
14. As a developer, I want a building's footprint to mean how many files it holds,
    so that many small files read as a broad low block and a few large ones as a
    narrow tower.
15. As a developer, I want height and footprint to stay independent, so that the
    two readings never collapse into one.
16. As a developer, I want a container to be drawn as a tower while the buildings
    it summarises are hidden, so that the shallowest view still says what the
    project is made of.
17. As a developer, I want a container to step aside the moment its buildings
    appear, so that I am never shown the same bytes twice.

### Damage

18. As a developer, I want a failed tool to mark the building it acted on, so that
    I can see where the work went wrong.
19. As a developer, I want damage never to roll the ladder back, so that a failed
    command does not erase progress it did not cause.
20. As a developer, I want damage to be unmistakable for an unfinished rank, so
    that I never confuse "broke" with "not built yet".
21. As a developer, I want the next success to repair the damage, so that the
    building's condition tracks the most recent work.
22. As a developer, I want a building to be able to be half-built and damaged at
    once, so that the two facts stay separate as they are in the domain.

### The places

23. As a developer, I want the Yard, Workshop and Depot to be distinguishable at a
    glance, so that I can tell site-wide work from file work from planning.
24. As a developer, I want the Yard to look like somewhere work happens, so that
    the place holding roughly half of every session does not read as an idle field.
25. As a developer, I want the Depot to be visibly occupied when my agent is
    planning, so that an agent that is thinking never looks stopped.
26. As a developer, I want a worker in the Workshop to be placed there, so that
    root-level work has somewhere to be rather than inventing a building.

### Watching one worker

27. As a developer, I want to follow one worker, so that I can watch it work
    rather than squinting at the whole town.
28. As a developer, I want the camera to stay close enough to read the pose, so
    that following is not the map view with a lag.
29. As a developer, I want the follow to end when the worker goes, so that the
    camera is never pointed confidently at nothing.
30. As a developer, I want a finished crew to stand down where it is rather than
    vanish, so that "finished" and "gone" stay different things.
31. As a developer, I want to pick a crew from a list of crews, so that following
    one of two identical sessions is not a coin toss.

### Looking around

32. As a developer, I want to turn the town in quarter turns, so that I can see
    what is behind what.
33. As a developer, I want the world never to turn with the view, so that the town
    I have learned is the same town from every seat.
34. As a developer, I want the light never to follow me, so that the town's lighting
    is a fact about the hour rather than about where I happen to be standing.
35. As a developer, I want to set the time of day, so that I can watch the town at
    dusk when its windows are lit.
36. As a developer, I want shadows to move with the time of day, so that the light
    tells me the hour and gives the town real depth.
37. As a developer, I want windows to light up at dusk and night, so that a
    finished building is visibly finished after dark.
38. As a developer, I want the ground to distinguish districts, so that I can tell
    where one ends and the next begins.
39. As a developer, I want a boundary to be legible from the fitted view, so that
    a district ninety pixels across still reads as a district.

### Pointing at things

40. As a developer, I want to hover a building and see its name, so that I can
    identify it without the map being a wall of type.
41. As a developer, I want to hover a worker and see what it is doing and to what,
    so that the map alone answers the question.
42. As a developer, I want to click to pin a label, so that I can read one without
    holding the cursor still.
43. As a developer, I want exactly one label pinned at a time, so that "show it on
    the thing I am focusing on" means one thing.
44. As a developer, I want a worker behind a building not to be clickable, so that
    what I point at is always what I can see.
45. As a developer, I want the map to keep taking drags while a label is on
    screen, so that the panel never eats a pan.
46. As a developer, I want to switch a project without the other town's folding
    stopping, so that a registry of towns behaves like a registry.

### Trusting the town

47. As a developer, I want the same repo to yield the same town every time, so that
    the place I learn is the place I return to.
48. As a developer, I want the town to persist between sessions, so that it is the
    result of the work rather than a recording of it.
49. As a developer, I want the solid town's height to come from the daemon, so that
    the two renderers never disagree about how tall a building is.
50. As a developer, I want a wrong storey count to be caught rather than drawn, so
    that a browser disagreement is a failure and not a mystery.
51. As a developer, I want a large town to stay smooth, so that watching it does
    not cost me the machine the agent is working on.
52. As a developer, I want switching renderers to be instant and complete, so that
    flipping back and forth to compare is cheap.
53. As a developer, I want the flat town unchanged by any of this, so that the view
    I already rely on cannot be broken by the new one.
54. As a developer, I want the new renderer to fetch nothing at runtime, so that the
    daemon keeps its loopback-only, offline posture and nothing is loaded from a
    network.

### Beyond the current ceiling

55. As a developer, I want the archetype vocabulary to be able to grow in the solid
    town without a texture budget, so that "what kind of place is this" stops being
    rationed by cels.
56. As a developer, I want a building's kind and its material to be independent, so
    that a stone Tower and a glass Tower are both ordinary.
57. As a developer, I want a building's material to be visible in its form, so that
    a glass building does not look like a stone one with a different colour.
58. As a developer, I want to declare what a building is made of, so that a tower
    can be glass and a chapel stone, and so that "what is this made of" is a fact
    about my repository rather than a consequence of what kind of place it is.

## Implementation Decisions

- **A second renderer, not a view mode.** The town gains a renderer selection
  beside Turn and Follow, and it is *not* a third `ViewMode` — that field means
  "which drawing of this layout", and a renderer is a different canvas, scene graph,
  frame loop and asset set. See ADR-0025.
- **Plan view belongs to the flat renderer, and the two controls do not overlap.**
  Switching to solid while the plan drawing is showing leaves the plan drawing and
  puts the reader in the isometric town — the solid renderer has one drawing, so
  there is no plan to carry across. The plan control is offered only in the flat
  renderer, where it can do what it says. Remembering a plan state across a renderer
  round trip was declined: a reader toggling to solid and back would find the flat
  town in a drawing they did not choose, with nothing on screen having said so.
- **Additive, and the flat town is frozen.** Nothing in the flat renderer changes —
  not for shared helpers, not for refactoring. The flat town stays the default. See
  ADR-0024.
- **One shared seam, at the top.** All drawing decisions live in a **framework-free
  solid model module** that imports nothing from three.js and nothing from the flat
  renderer's art. It is tested directly, the way the plan view's module is. A thin
  scene module translates model objects into three.js objects and decides nothing.
  This is the single seam the feature is tested at.
- **The daemon gains one field and no vocabulary.** The layout already carries a
  building's position, footprint, storey count and archetype, and geometry is built
  *at* those numbers rather than re-derived (ADR-0012). The one thing it does not
  carry is a building's material, which the renderer cannot invent because nothing
  declares it — so a declaration travels on the wire unvalidated, exactly as an
  archetype name already does. See the material decision below.
- **Determinism is the keystone.** Geometry is a pure function of (archetype,
  material, footprint, rank). No `Math.random`, no clock, no map-iteration-order
  dependence — the flat art already keeps this discipline and the solid town must
  keep it the same way.

### Geometry

- **Authored, not ported.** The solid town's geometry is written fresh against a
  modelling kit. The flat renderer's rasteriser is not a backend for it and never
  becomes one: its vocabulary is four primitives and three shades chosen to read at
  2:1 with one-pixel ink, and re-targeting it would produce extruded boxes with
  gabled caps. See ADR-0023.
- **A kit of eight operations**: extrude, set-back, chamfer, window reveal, roof
  overhang, parapet, profile sweep, canopy. The sweep carries three archetypes at
  once — a 2D profile carried across the footprint gives the Chapel's spire, the
  Stadium's dome and the Library's gable from one operation. The canopy exists
  because the Restaurant's flat roof cannot be a sweep: a gable's ridge is a line
  and nothing can be placed on one.
- **Every operation is expressed as a fraction of the footprint**, never in
  absolute world units. A chamfer in absolute units distorts across a 44-to-100
  unit range; as a fraction it does not. This is what lets one form per archetype
  serve all five sizes, and it is a standing constraint on the kit: an operation
  that cannot be expressed footprint-relative cannot join it.
- **Material owns its geometry.** A glass building is a curtain wall and a stone one
  is masonry, so they are different forms and not one form with a different surface.
  Twelve archetypes by five materials is sixty forms, each in three parts because
  the ladder reveals parts — base, band, cap — for **180 building meshes**.
- **An archetype's material is a default, not a fact.** Any building may take any
  material. This deliberately reverses the flat town's rule that an archetype maps
  to exactly one material; the flat town keeps that rule, because there the material
  also decides which ramp a cel draws from.
- **A declared material travels on the wire, unvalidated.** A repository may declare
  a building's material beside its archetype, and the name is *not* checked by the
  daemon: the analyzer has no vocabulary, the renderer owns the set, and an unknown
  name is ignored rather than rejected. This mirrors how an archetype name already
  travels, and without it 48 of the sixty forms have no way to be selected.
- **Five footprints exist and one form serves all of them**, scaled in plan. Height
  is a separate axis entirely and comes from the storey count.
- **Instancing is per (archetype, material, part)**, so draw calls stay flat as a
  town grows and a site costs a transform rather than a mesh.

### The ladder, in geometry

- **One mesh, parts revealed as ranks are earned.** Framing at FRAMED, walls at
  WALLED, the cap at ROOFED, glazing at GLAZED, the door at DOORED, the trim at
  COMPLETED. The ladder's "one rank adds exactly one part" becomes structurally true
  rather than merely drawn.
- **A tower is the band repeated.** A tower of *n* storeys has bands at
  `0, STOREY, …, (n−1)·STOREY` with its cap at `n·STOREY`. `STOREY` is 20 world
  units and the storey count is clamped the same way the daemon clamps it, so a
  disagreement is impossible rather than merely unlikely. **The cap's position must
  be a named function** — an off-by-one here is invisible on a one-storey building.
- **The browser may not invent a storey count.** It is asserted against the value
  the daemon sent, because in the solid town a wrong count is drawn rather than
  hidden by art.

### Damage

- **A material swap plus a deterministic displacement.** The displacement is a hash
  keyed on the site's path — stable across turns, rebuilds and a change of plot. A
  walk keyed on footprint size would make every building of one size crack
  identically, which is the failure the archetype hash already exists to avoid.
- **Damage never rolls the ladder back** and must be distinguishable from every
  unfinished rank at the fitted view.

### The camera

- **Fixed 2:1 dimetric, orthographic.** The projection is the one the flat town
  already uses, and it is pinned by test against the flat renderer's own numbers so
  the two renderers cannot silently drift apart. The projection constant lives in
  the model module, where it is testable, not in the scene module.
- **No perspective, no free orbit, no pitch.** A bounded change of view is what
  keeps the town recognisable, and recognisability is the whole point.
- **Turn is a camera orbit** in quarter turns around the world origin, and the world
  never turns. ADR-0020 survives verbatim. The light is fixed in the *world*, not
  the picture, so a turn re-lights the town and a building catches the sun
  differently at each quarter — see the look section below. This is one of the two
  places the two renderers deliberately differ in appearance.
- **Follow is a camera distance and aim.** ADR-0022 survives verbatim — it was
  written as "a camera, not a projection", and an orbit and a distance are what that
  sentence describes. The flat town's zoom floor exists because a machine too far
  away cannot be read; distance expresses the same thing.
- **The whole-number zoom rule does not carry over.** It exists because a fractional
  scale puts some world steps on one pixel and their neighbours on two — a property
  of a pixel rasteriser. The solid town does not inherit the rule and does inherit
  the reason for it.
- **The follow yields to a drag**, and a target that disappears releases it.

### The look

The palette is already a lighting rig that was never allowed to light anything, and
the solid town should be lit out of it rather than out of invented colours.

- **A warm low key, a cool sky fill, and both move with the hour.** Each phase
  supplies its own key and ambient from the palette's own sky keys — the warm
  horizon gold at dusk, the cool zenith blue as ambient — so a shadow goes
  blue-violet by the palette's stated rule arriving by physics rather than by
  drawing. The key is **not** one fixed colour: a single gold used for day, dusk
  and night would flatten the hour into decoration and lose the thing cast shadows
  are for.
- **Shadows are tinted by the sky, not blackened.**
- **Dusk is the default and stays the default.** It is the light the palette was
  built for. Day is the least flattering hour for low-poly geometry and should not
  become the default merely because it is the first phase in the list.
- **Distance fog toward the palette's haze tones.** The backdrop's own description
  of a distant field — duller, hazier, lighter, separated by value and saturation
  rather than hue — is a description of aerial perspective. Fog settles the far
  districts back and makes a large town read as a place rather than as objects on a
  plane.
- **Corner occlusion is derived from the kit, not post-processed.** Low-poly flat
  geometry reads as unfolded paper until its corners darken. Because the forms come
  from a kit, the shading is already known: a set-back shades the surface below it,
  a reveal makes the recess darker, an overhang darkens the wall beneath. This is
  baked per vertex at build time, costs nothing at runtime, and is deterministic.
- **Four details carry the look**, and they are worth more than more operations: a
  real roof overhang (a roof flush with the wall reads as a lid), recessed windows
  (painted windows in 3D read as stickers), a plinth at the base (what stops a box
  reading as a box), and chamfered vertical corners (which catch the warm key on one
  face and the cool fill on another).
- **The ground carries three things**: tonal variation across the surface, a contact
  shadow where each building meets it, and **kerbs as raised geometry** rather than
  painted lines. A flat plane under good buildings reads as a paper diorama.
- **Bloom on lit windows only.** A glowing window at dusk is the one unambiguously
  right post-effect here. Vignette, depth of field and screen-space occlusion are
  not defaults.
- **No textures.** The risk with clean low-poly is not "no texture", it is flat
  grey; lighting and occlusion fix that, and a texture map would fight the flat
  shading the palette was built around.

### Labels, picking and the places

- **Labels are 2D DOM, projected from a world point.** Type in 3D space
  foreshortens and aliases; DOM type stays crisp at any zoom.
- **The pixel font ships as a DOM webfont**, so both renderers typeset alike. It is
  the only hand-authored pixel art in the project, and this is the last thing it
  buys.
- **Picking is by raycast against real geometry.** A worker behind a building is not
  pickable, because it is not visible — which also fixes a defect the flat town has,
  where a hidden building's rectangle still catches the pointer.
- **The overlay must not swallow map input.** Labels take no pointer events; the map
  keeps every drag.
- **The ground is flat**, sized from the layout's own extent rather than from the
  sites, so hiding a deep directory never shrinks the world.
- **The seven ground kinds are regions; the kerb is a line** and must stay legible
  at the fitted zoom, where a whole district is ninety pixels across.
- **The Yard, Workshop and Depot carry a little furniture.** The Yard is roughly
  half of every session, and a worker on a bare plate is a figure on a field.

### Not in the solid town

- **No plan view.** A plan is a flat drawing of a flat town, and "from directly
  above" would contradict the fixed angle. This is a real cost: the plan is how a
  large town stays navigable.
- **The plan drawing does not carry across**, so switching to solid while it is
  showing drops it. The rule and its reasoning are in the implementation decisions
  above; it is repeated here because it is the one transition a reader can find
  surprising, and it should not be discovered by a reader rather than decided here.
- **No roads.** Deferred: they are a subsystem with three kinds and their own
  routing rules.
- **No districts-as-plates, no containers-as-anything-new, no sky, no birds, no
  clouds.** The solid town is workers, buildings, damage and places, plus ground.

## Testing Decisions

**What makes a good test here.** One that asserts an invariant the town promises,
through the model's public surface, without a browser and without WebGL. The flat
renderer's suite already states the principle this follows: it asserts the
*invariants the art claims* rather than sampling a sprite, because "every defect
that shipped from the drawing layer was invisible to `tsc` and to the boot-time
palette check". The same is true of geometry, and the solid town's suite exists for
the same reason.

A test must not assert an implementation detail — not a vertex count, not a mesh
name, not a three.js call. It asserts what a reader would notice: that a rank change
does not skip a part, that a tower is exactly as many storeys as the daemon said,
that the same layout produces the same world twice.

**The module under test.** The framework-free solid model module, and only it. It
holds the kit operations, the sixty forms, the ladder-to-parts mapping, the
instancing key, the damage hash, the ground regions, the follow distance, the label
anchors, and the projection constant. Everything decided in this spec is assertable
there.

**What transfers from the flat suite.** Stage distinctness, stage climbing, parts
disjoint, footprint matching the layout. These describe a building, not a cel, and
they are the invariants that survive the change of renderer.

**What geometry breaks on that cels could not.** A rendered cel and its neighbour on
a sheet physically cannot interpenetrate; two meshes can. So the suite adds:
closed meshes, the storey count equal to the storey count the daemon sent, the cap
at the top of the topmost band, and every kit operation correct at **both** footprint
extremes — a chamfer that is correct at 100 and inverted at 44 is the failure that
step exists to catch.

**Determinism is the keystone test.** The same layout must produce the same world,
every time. It is the invariant the flat renderer already promises and the solid one
could silently break, and it is the cheapest to assert.

**Prior art.** The plan view's module and its test are the model to follow: a
framework-free module holding drawing decisions, tested directly, with typed
fixtures built rather than cast — the project forbids `as unknown as T` casts
satisfying an interface, and there is a self-test that enforces it.

**Not tested here.** Lighting, fog, bloom and the overall read are not assertable
and should not be faked into assertions. They are settled by looking, which is why
the milestone is a throwaway spike with the sun and fog exposed as knobs.

## Out of Scope

- **Any change to the daemon except one.** A building's material has to reach the
  renderer, and nothing on the wire carries it today. That one field is in scope and
  is the only Go change in this spec.
- **Any change to the flat renderer**, including the artifact that the projection is
  spelled out in more than one place. Freezing it is worth more than deduplicating it.
- **Retiring the flat renderer.** It stays, unchanged and default.
- **Roads** — row, containment and import — in the solid town.
- **A plan view** in the solid town.
- **Expanding the archetype vocabulary.** The ceiling stops applying to the solid
  town, which is what makes expansion possible later; whether to expand is a
  separate decision and is not this spec.
- **Deriving the phase from the reader's system clock.** The obvious next step is a
  town at 1am being a town at night, and it is deliberately not in this spec: it
  turns the phase control from a selection the reader makes into a default they
  override, and a reader working through the night would never see their town lit.
  Both are product decisions rather than lighting ones. The groundwork is small when
  it is wanted — inject the clock as a source instead of reading it ambiently, so a
  phase stays a pure function of an input.
- **Per-archetype props**, wall material as a separate axis, and metaphor intensity.
- **The subagent question.** The daemon reports every worker as a chief, so a
  subagent's work folds into its chief's machine. The solid town inherits this rather
  than settling it.
- **Keyboard support.** The app is mouse-only today and this spec does not change
  that.

## Further Notes

**The milestone is a throwaway spike, and it is the first thing built.** One
archetype, one material, all eight ranks, one worker, the toggle and the sun. Its
only deliverable is an answer to the three questions, recorded with a screenshot
each. If any answer is no, the rest is not built. This is deliberate: the expensive
part of this feature is geometry, and the riskiest assumption is that a solid town is
legible at all — which is cheap to test and expensive to discover late.

**Two numbers in the repository are stale and were measured for this spec.** The
archetype work's own spec records the atlas ceiling as 1239; the bake's arithmetic
makes it **1296** (`floor(8192 / cellH) x 16` against a cell height of 101), and the
bake's own comment records that an earlier budget of 1408 was the number that made
five footprint buckets look like they fitted. The product document records the five
footprints as 44/60/78/100; they are **44/58/72/86/100**. Both are cited above and
both are worth correcting where they live.

**One defect predates this work and should be fixed before it is extended.** The
test chain's last step references a test file that does not exist, so the suite
fails at its final step today, and one further test file exists with no script and
therefore never runs. Adding the solid town's scripts to that chain before it is
repaired means debugging a new suite inside a broken one.

**180 meshes is an estimate derived from a decision, not a measurement.** It is the
largest single cost in this feature and the number most likely to move once the
forms are being written.

**The lighting is the part that cannot be specified, only tuned.** The palette gives
the rig its two colours and its hue rule, and everything past that — how low the key
sits, how much fog, how far the bloom — is a judgement made by looking at it. The
spike should expose those as knobs rather than commit to numbers in prose.
