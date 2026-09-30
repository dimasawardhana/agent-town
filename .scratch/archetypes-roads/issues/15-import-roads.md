# 15 — Import roads: "this calls that"

**What to build:** A road from a building to each building whose source it
imports, so the map shows dependency rather than only containment.

**Blocked by:** 08

**Status:** done — and then the road was removed. Read the amendment below before
assuming the map draws one.

**What this ticket originally asked for, and what shipped instead.** The scanner
half of this ticket shipped exactly as written and is still the guarantee the
feature rests on: an edge exists only when both ends resolve to buildings this
analyzer actually found, and the refusals are asserted as hard as the drawing.
The *carrier* did not survive. A road per edge needs width, a surface, a kerb
and ends, and once it has all four it collides with the buildings it passes and
the roads it crosses; on this repository that was nine checkered bands and, for a
while, a car on each.

The dependency now lives on the building: `Site.Imports` is what a building
imports, the map draws a hairline on the importing building's own plot, and the
panel lists the names. The scanner's guarantees below are unchanged and are
asserted against `Site.Imports` rather than against drawn roads.

- [x] An import between two buildings in this town is recorded
- [x] A specifier that escapes the repository records nothing
- [x] A bare specifier — a package, a module, the standard library — records nothing
- [x] A string that merely looks like an import, in a function body, records nothing
- [x] JavaScript `from "..."` and `require("...")` are recognised, and Go's
      import block
- [x] The scan is order-independent, so the same tree gives the same edges
      (ADR-0012)
- [x] Nothing is drawn between two buildings


## Comments

### The rule that bounds the whole feature

**An edge exists only when both ends resolve to buildings this analyzer
actually found.** Everything else draws nothing.

A scanner that read anything looking like an import and assumed a target would
draw roads to packages, to the standard library, to directories that do not
exist — every one a confident line to a place the map does not contain, on a map
whose entire claim is that it only says true things.

So a bare specifier yields no road. Not because it is unparseable but because it
names something *outside this town*, and a road to it would be a fiction. The
test asserts the refusals as hard as the drawing, because the refusals are the
feature: a repository this cannot read simply has no import roads, and that is a
correct description rather than a failure.

### Relative specifiers resolve to a file; the town draws a directory

A relative specifier names a *file* and the town draws *directories*, so the
resolved path is walked up to its longest ancestor that is a building. That is
the whole of the resolution, and it is why relative imports work at all here.

### Measured

**8 import roads on this repository**, of 14 roads in total. The map now says
which buildings depend on which, which is the thing a reader scanning a town is
usually trying to learn and the one thing containment roads could never say.

### Amendment — the road was removed, the fact was not

**The map no longer draws a road between two buildings that import each other,
and this ticket's ticked boxes above are checked against `Site.Imports` rather
than against drawn geometry.** Everything in "Measured" above was true when it
was written and is now history: 8 import roads on this repository became 9 bands,
then a car on each, then nothing drawn.

**Why the road lost.** A connection is the wrong carrier for this fact. It needs
width, a surface, a kerb and ends, and having all four it collides with the
buildings it passes and the roads it crosses. Concretely, on this repository:

- the band between two neighbouring plots is 14 world units and the road *tile*
  is 16, so five of the fifteen bands were **shorter than the tile they were
  painted with** and rendered as checkered diamonds spilling under the buildings
  either side;
- widening the gap to 40 fixed that and left the town carrying nine slabs;
- the cars — the thing the roads existed for — were not legible at map scale
  after four rounds of re-authoring the sprite, and the liveliness spec's own
  first paragraph says why: *"a figure moving because it looks nice is
  decoration wearing a claim's clothes."*

**What replaced it.** The fact moved onto the building, where it has room and
cannot collide: `Site.Imports` records what a building imports, the map draws a
hairline on the importing building's own plot, and the panel lists the names.
Whether is on the map; whom is in the panel.

**The cost, stated so nobody rediscovers it by wanting the graph back.** The
*shape* of the dependency is no longer visible at a glance. A reader cannot see
that `ui/src` reaches two things rather than one without selecting it. That was
never reliably visible with a car on it either.

**The scanner is untouched.** The refusals — a bare specifier, a specifier
escaping the repository, a string that looks like an import in a function body —
are the guarantee this feature rests on, and they are asserted in
`TestImportsOnlyNameRealBuildings`, `TestCommentedImportDoesNotCount`,
`TestExportStarCounts` and `TestImportEdgesOnThisRepository`.
