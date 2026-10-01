# 35 — Imports live on the building, not on the ground

**What to build:** Carry the import graph as a property of each building rather
than as geometry drawn between two, so the map says which buildings are coupled
without nine road bands crossing everything they pass.

**Blocked by:** 15

**Status:** done

- [x] `Site.Imports` names the buildings whose source a building imports
- [x] The analyzer emits **no import road at all** — the fact is not a shape
- [x] ~~The map marks a building that imports anything~~ — built here as a roof
      tint, and **removed by 36**: three attempts to place it were invisible and
      the one that finally drew was a mess on a town that was better without it
- [x] The panel lists the names, which is the only place with room for them
- [x] `from`/`to` are off the wire; nothing read them but the cars
- [x] The scanner's refusals are unchanged and now asserted against `Site.Imports`
      (`TestImportsOnlyNameRealBuildings`, `TestCommentedImportDoesNotCount`,
      `TestExportStarCounts`, `TestImportEdgesOnThisRepository`)

## Comments

### Why a connection is the wrong carrier

A road is a shape with width. It needs a surface, a kerb and ends, and once it
has all four it collides with the buildings it passes and the roads it crosses.
That is not a tuning problem — it is the primitive being wrong for the fact.

Measured on this repository while it was tried: the band between two
neighbouring plots is 14 world units against a 16-unit road tile, so **five of
fifteen banded roads were shorter than the tile they were painted with** and
rendered as checkered diamonds spilling under the buildings either side. Widening
the cell gap to 40 fixed that and left the town visibly sparser to carry nine
slabs.

### The mark says *whether*, the panel says *whom*

A hairline on the importing building's own plot, in a cool blue that is
deliberately not `accent` — `accent` is the chief's flag and the panel's
live-state marks, and an import is a static structural fact about code, like
floors, not like work.

The count is what the map reads; the list is what the panel reads, because the
panel has room for exact names and the map does not.

### What this cost

**The shape of the dependency is no longer visible at a glance.** A reader
cannot see that `ui/src` reaches two things rather than one without selecting
it. That was not reliably visible with a car on the road either — the cars went
through four rounds of re-authoring and were still not legible at map scale.

The town is quieter: nothing moves on it but the crew.

### What this means for the liveliness spec

`docs/superpowers/specs/2026-09-29-town-liveliness.md` was rewritten around
this removal rather than amended a fourth time. Three amendment blocks had
accumulated on it and left it contradicting itself — still listing a car as a
mover, still arguing about a removed feature's colour, still saying nothing was
built. It now records feature 1 as done in a different form, re-scopes the four
open features against what the map has become, and carries the evidence.

Two things it says that are worth repeating here:

- **The "spine" feature 1 was going to hang the others off no longer exists.**
  There is nothing on the map that moves with the code's *shape* any more, so
  features 2–5 have to re-found whatever they were going to hang off.
- **A figure is a position, not a tint.** It is ~20 pixels and crosses open
  ground, so it cannot be hidden by the building it leaves. That is why feature 2
  should work where feature 1 did not, and it is written down so nobody tries
  the tint trick twice.

### Two cleanups this made necessary

Both were found by reading the tree after the removal rather than before it, and
both are the repo's own rule about keys nobody reaches:

- **`importGap` lost its reason.** `cellGap` had been widened to 40 so import
  roads would be visible. With no import road emitted, the per-district gap was
  opening districts up for a road that did not exist. It is one constant again.
- **The band cap machinery was dead on arrival.** `paintBandCaps` returned on its
  first line for the only kind that remained, dragging `bandChain`, `bandTiles`,
  `segmentRectDistance` and six tests that guarded code nothing could reach.
