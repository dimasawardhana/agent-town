# ADR-0023: The solid town is authored geometry, not a port of the pixel art

## Context

The request was a 3D version of the town — "like an rpg game where we can see our
agent moving in a 3d world" — rendered with three.js, with the expectation that it
means authoring a great many 3D models.

The first reading of the codebase argues hard against that expectation. Of the 21
modules in `ui/src/art/`, **13 draw through `IsoPix`**, and `IsoPix` is a
projector: it takes world coordinates and plots pixels. It already carries a
vocabulary that looks like modelling — `box`, `gable`, `dome`, `ridgeProfile`,
`beamX`, `beamY`, `post`, `litWall`, `shadowWall`, `footprint`. The entire
hand-authored pixel corpus in the art directory is `font.ts`, 54 glyphs at 3x5.
The grid compiler that once drew workers and machines as character grids is dead
code: `sprite()` and `compose()` (`ui/src/art/surface.ts:247`, `:288`) have no
production callers.

So the tempting conclusion is that the art is *already* 3D and the solid town is a
rasteriser swap — a second `IsoPix` backend emitting triangles, reusing every
existing drawer. That conclusion was put to the user and it is wrong.

It is wrong in terms worth recording. `IsoPix` is a **pixel** rasteriser: it plots
single pixels, its outline is one pixel, and its shading picks a ramp step *per
pixel*. The drawers speak a vocabulary chosen to read at 2:1 pixel scale — a
"dome" here is a dome that fits in *n* picture pixels, not a dome with a profile
and a normal. Re-targeting those drawers would return the town's forms as
extruded prisms with gabled caps: legally 3D, and precisely the outcome the
request was pushing away from.

## Decision

**The solid town's geometry is authored fresh against a solid modelling kit.
`IsoPix` stays the flat town's rasteriser and is not a backend for anything.**

1. **A kit of eight operations.** Extrude, set-back, chamfer, window reveal, roof
   overhang, parapet, profile sweep, canopy. The sweep carries three archetypes
   at once, because a 2D profile carried across the footprint gives the Chapel's
   spire, the Stadium's dome and the Library's gable from one operation — the
   same insight `ridgeProfile` already encodes in pixels. The canopy exists
   because the Restaurant's flat roof cannot be a sweep: a gable's ridge is a
   *line*, and nothing can be placed on one.

2. **Every operation is expressed as a fraction of the footprint.** A chamfer in
   absolute world units distorts across a 44-to-100-unit range; as a fraction it
   does not. This is what lets one form per archetype serve all five sizes
   (`bake.ts:105-111`) instead of five authored variants, and it constrains the
   kit going forward: an operation that cannot be expressed footprint-relative
   cannot join it.

3. **Material owns its own geometry.** A glass building is a curtain wall and a
   stone one is masonry, so they are different *forms*, not one form with a
   different surface. 12 archetypes x 5 materials = 60 forms, each in three parts
   because the ladder reveals parts — base, band, cap. **180 building meshes.**

   This is the largest single cost in the project, and it knowingly reverses a
   deliberate design. `MATERIAL_OF` (`ui/src/art/roof.ts:1237`) is a *total*
   mapping today and its comment argues why: "an archetype with no material would
   fall back to a hash and become indistinguishable from a different archetype
   that happened to land on the same fallback." Any archetype may now take any
   material, and an archetype's material is a default rather than a fact. The
   solid town's material is free; the flat town's stays total, because there it
   is also the axis that decides which ramp a cel draws from.

   **This requires the material to reach the renderer, and today nothing on the
   wire carries it.** So a building's material travels unvalidated beside its
   archetype — the analyzer still has no vocabulary, the renderer still owns the
   set, and an unknown name is ignored rather than rejected. That is the single
   exception to "the daemon needs no change", and without it 48 of these 60 forms
   have no way to be selected.

4. **External models were refused on availability, not on merit.** Blender-authored
   glTF is the standard route to models worth looking at, and this decision gives
   it up. No one can supply those models here, and the route would require retiring
   a stated constraint — "all art is authored in TypeScript as pixel data" — in
   favour of binary assets, a second toolchain, and a version-control story for
   those binaries.

## Why

**Why not reuse the drawers.** Because reuse would be of the *coordinates* and not
of the art. The drawers describe forms in a vocabulary of four primitives and three
shades, and the missing parts are exactly the ones that make a building: a
chamfered corner catching the sun differently per face, a set-back that changes the
silhouette with height, a reveal that makes a window a hole rather than a sticker,
an overhang that makes a roof a roof. None of those exist in the pixel vocabulary
because at 2:1 with 1px ink they cannot be seen.

**Why the kit is eight operations and not a hundred.** Each operation must work at
five footprints, in five materials, across three parts of the ladder, from four
turn orientations. The cost of an operation is therefore not linear, and the
archetype list is twelve entries long — a kit sized to *that list* is done, where a
general architectural kit is open-ended.

**Why the solid town needs one thing from Go, and only one.** `Site` already
carries `X`, `Y`, `W`, `H` in world units and `Floors` for the vertical
(`internal/analyzer/layout.go:105-108`, `:80`), plus `Archetype` (`:103`) so the
renderer does not re-derive a fact the analyzer already decided. That is a box with
a shape on the wire, and the geometry needs nothing else.

Material is the exception, and it is not an accident of implementation: the forms
are authored *per material*, so the renderer cannot build the right one without
knowing which it is. Nothing carries it today.

The shape of that change is already settled by precedent in the analyzer's own
comment: this package has no vocabulary, so a declaration travels and an unknown
name is ignored rather than rejected. Material travels the same way — no validation
in Go, no second copy of the list in two languages. Everything else on this page is
a browser decision.

## Consequences

- `ui/src/solid/` is new and imports nothing from `ui/src/art/`. The two art
  systems share the palette `P`, the vocabulary, and nothing else.
- The 180 meshes are generated from 60 form definitions, not authored one by one,
  which makes the kit's tests the load-bearing ones: a defect in `chamfer` is a
  defect in every form that uses it.
- Determinism is preserved and is now cheaper to guarantee, because geometry is a
  pure function of (archetype, material, footprint, stage).
- `Floors` is a count, not geometry: `STOREY` (`ui/src/art/stack.ts:23`) is 20
  world units and the solid town reads the same number. A tower is *n* bands, and
  the browser can be handed a wrong count with no art to hide it — which is why
  the storey count is asserted against `Floors` rather than trusted.
- Instancing is per (archetype, material, part), so draw calls stay flat as a town
  grows and a site costs a matrix rather than a mesh.
- **The daemon gains one field.** A building's material must reach the renderer,
  because geometry is a pure function of (archetype, material, footprint, rank)
  and a material the renderer cannot learn is a degree of freedom it cannot
  express. It travels unvalidated, exactly as an archetype name already does, so
  the analyzer still has no vocabulary. This is the only Go change the solid town
  requires, and it is the one place this ADR's "the daemon needs no change" is
  qualified rather than true.
