# ADR-0024: The flat renderer is frozen, and the pixel art is its alone

## Context

The solid town was chosen as an addition rather than a replacement (ADR-0025
records what it is), and its geometry is authored rather than ported (ADR-0023
records why). Together those two answers leave the flat renderer holding a
substantial, finished, tested asset that the new renderer cannot use: `IsoPix`,
the atlas bake, the 1296-cel ceiling that ADR-0021 exists to explain, and the 50
art tests that README.md says exist "because every defect that shipped from the
drawing layer was invisible to `tsc` and to the boot-time palette check".

The question is what happens to all of it. Three answers were available: keep
investing in it, delete it once the solid town is good enough, or freeze it.

## Decision

**The flat renderer is frozen. It is not deleted and it is not invested in.**

Nothing in it changes. `IsoPix`, `bake.ts`, the atlas, ADR-0021's budget and the
art suite all stand exactly as they are, and all of them now serve the flat town
and nothing else. The flat town remains the default renderer, so a reader who
never opens the solid town is unaffected by any of this.

## Why

**Why not delete it.** Because the solid town has not earned it yet. The whole
reason the solid town is an addition rather than a cutover is that PRODUCT.md
principle 4 is "gaps stated, not hidden" — and a cutover would make the honest
state of the product "broken until the solid renderer is finished" for as long as
that takes. Deleting a working, verified renderer to make room for one that has
not been proven is the failure that principle names.

**Why not keep investing in it.** Because it is no longer the direction of the
project, and a maintained 2D renderer is a tax paid every week: every new
archetype would need cels as well as meshes, every vocabulary change would need
both art systems updated, and ADR-0021's budget would keep constraining a
vocabulary that the solid town does not constrain at all.

**Why the ceiling stops mattering.** `spec.md` records 26 archetypes as "the hard
ceiling" of the vocabulary, with 24 of those leaving under 100 cels, and 320 of
the 640 cap cels drawing nothing at all. That ceiling is an artefact of texture
memory — `floor(8192 / cellH) x 16`, a `2048x8192` sheet sitting on exactly
`MAX_ATLAS_AREA`. None of that arithmetic applies to a mesh, which is the clearest
single thing the solid town buys. It does not lift the flat town's ceiling; it
makes the ceiling a flat-town problem.

## Consequences

- `IsoPix` is not deprecated in code and carries no comment saying so. It is a
  working rasteriser for a working renderer.
- The flat town's archetype vocabulary stays at twelve. Adding a thirteenth
  archetype is now a decision about the flat renderer specifically, and the
  honest answer for the solid town is that it costs a form and no budget at all.
- The 50 art tests keep running and keep passing. They protect the flat town;
  they say nothing about the solid one, which is why the solid renderer needs its
  own invariants rather than an inheritance.
- `npm test` keeps its 24 suites unchanged, and a solid-town failure can never be
  masked by a flat-town pass.
- The two renderers may drift in vocabulary — an archetype could gain a form in
  the solid town before it gains a cap family in the flat one. That is accepted:
  they are two renderings of one town, not two views of one drawing, and the
  layout they share is what keeps them honest.
