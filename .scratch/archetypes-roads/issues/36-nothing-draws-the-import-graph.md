# 36 — Nothing draws the import graph

**What to build:** Stop drawing it. `Site.Imports` stays because the panel prints
it, but the map carries no mark, no count and no band — not because none of them
could be made to work, but because the one that could was a mess on a town that
was better without it.

**Blocked by:** 35

**Status:** done

- [x] The import mark is gone from the map, and with it the `imports` palette
      entry that existed only to colour it
- [x] The `traffic` colour ramp is gone too — the car removal orphaned it and
      35 left it behind, which is why this is a second removal and not the first
- [x] `BAND_TREATMENT` keeps one entry, and its doc now says the ranking it was
      built for no longer applies rather than arguing for nine absent bands
- [x] `roadsAsLines` no longer takes `from`/`to`; the analyzer stopped emitting
      them and the parameter outlived the field
- [x] `Road.kind`'s doc and `Site.Imports`'s doc no longer claim the map reads
      the import list — it does not, and it does not
- [x] The one test fixture that named `kind: "import"` now names a kind the
      analyzer can emit. A fixture for a kind that cannot be produced is a test
      for a thing that does not exist.

## Why

Three carriers, all built, all removed, and the order matters because the third
one *worked*:

1. **A road band between the two buildings.** True geometry, and it crossed the
   buildings it passed. Removing it was a correctness fix.
2. **A car travelling the road.** Drawn four times, and a 14-pixel car on a
   600-pixel town is a speck. Removing it was a scale fix.
3. **A tint on the importing building's roof.** Three attempts were invisible —
   the plot because the building covers it, the gap because it is too narrow to
   hold anything, and the first roof attempt because the mark sorted tens of
   pixels above the building's own container and the building drew over it. Each
   time the instinct was to make it louder, and brightness was never the problem.

The fourth attempt drew, and the reader who had to see it said it disturbed the
town and that nothing would replace it. That is the correct verdict, and the
reason it is a ticket rather than a tweak: **the carrier was never the problem.**
Plot, roof and the gap are all of the surfaces available, all three are closed,
and the one that survived the engineering was still the wrong idea.

## What it costs

Nothing on the map says *whether* a building imports, or how many. A reader
cannot see that `ui/src` reaches two things rather than one without selecting
it. That was never reliably visible either — with a car it was visible as a
speck.

`Site.Imports` is unchanged and the panel still prints it, so the fact is
reachable; it is just not *glanceable*, and on this map that is the correct
trade rather than a compromise.

The scanner's refusals are untouched and still asserted against `Site.Imports`:
a bare specifier is unresolvable, a relative specifier escapes the repository, a
multi-line import is an import, a commented import is not a road. A fact with no
test defending it does not get to keep its test, so `TestImportsOnlyNameRealBuildings`,
`TestCommentedImportDoesNotCount` and `TestExportStarCounts` all still hold — on
a field that now only the panel reads.

## Amendment — the one this replaced

The liveliness spec was rewritten around these three removals rather than
amended again, because three amendment blocks had already left it contradicting
itself. It now records the mark's removal as its own section and keeps the
conclusion: **a map mark has to earn its place against the art, not against the
absence of itself.**
