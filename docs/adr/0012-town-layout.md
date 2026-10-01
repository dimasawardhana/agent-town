# ADR-0012: Town layout is computed, deterministically, from the directory tree

## Context

Tickets 04 and 05 render a town, but nothing defined where a building goes. ADR-0003 refers to "the town's current visual layout" without saying how it is produced. This blocked the renderer.

Measured on real projects, towns are small: `worklog` 17 buildings, `wedding-invitation` 19, `team-builder` 25, `super-app` 31. Districts number 1–5. A layout algorithm only has to place tens of things, not thousands.

## Decision

Lay out the town deterministically from the directory tree. Districts are blocks; buildings sit on a grid inside their district, with footprint scaled by source-file count. No physics, no force simulation, no stored coordinates.

## Why not the alternatives

**Squarified treemap** — area exactly proportional to file count, so a town's *area* is a truthful measure of the project. Prototyped against `team-builder` and it works, but it renders as a spreadsheet: every building is a rectangle tiled against its neighbours with no space between them. It answers "how big is everything" and fails at "is this a place".

**Force-directed** — the obvious choice for graphs, and wrong here. It is non-deterministic, so a town would rearrange itself between sessions and the developer would lose their spatial memory of it. It also implies dependency-driven clustering, which is a different question from "where does this folder live".

**Stored coordinates** — persisting x/y would let a user rearrange the town, which is a nice future feature, but ADR-0003 already stores a materialised town state, so coordinates can be added to it later without changing this decision.

**Grid inside districts** — chosen. It produces something that reads as a place: districts as distinct neighbourhoods, roads implicit in the gaps between blocks, buildings that visibly differ in size. Prototyped against `team-builder` and legible at 78×30 characters, which means it will be legible at 1600×900 pixels.

## Consequences

- **Deterministic.** The same repo always produces the same town, so a developer builds spatial memory of their own codebase. This is the property that makes the town a *place* rather than a chart.
- **Districts are sized by building count, buildings by file count.** A district with many small buildings gets more land than one with few large ones.

  **Corrected during implementation.** This was backwards for test districts. Measured on `team-builder`, the `e2e` district holds **16 buildings across only 22 files**, while `src` holds **9 buildings across 65 files**. Sizing by building count alone hands the test framework more land than the code it tests, which inverts the town — the tail visibly wagging the dog.

  The analyzer now marks each district `source` or `test`, and the layout tightens a test district's cell pitch to `0.7`. Test territory stays visible, because ignoring it would be its own lie, but it is weighted down relative to a source district of the same shape.

  **Narrowed after measurement.** This originally claimed the layout weighted test districts *by file count*, and that they "cannot dominate the site". Neither is what the code does. It applies a constant pitch, and written as a property over 30 plausible shapes, that property fails 8 times with a worst inversion ratio of 2.58: a 22-building spec suite outranks even a substantial source district. Two further limits, both now tested:

  - **The pitch is invisible below the block floor.** A one-building district is floored to a plate sized for the largest thing that can stand on it, so a test district and a source district of the same shape weigh exactly the same. The pitch is a correction *above* the floor, and most districts in a small town are below it.
  - **A constant cannot express a relationship between two districts.** Weighting by file count — the original mechanism — would; the constant is a tuning that happens to hold in the middle of the range.

  The honest claim is the one the code makes: *a test district of the same shape as a source district takes less land, where the floor does not bind.* Sizing by file count is a real change to the layout and is deliberately not smuggled in under a bugfix.
- **Layout is a pure function of the project analysis.** It can be unit-tested without a renderer — assert that a known tree yields known positions.
- **Roads are not drawn in this decision.** Gaps between district blocks read as space. Explicit road rendering is a later cosmetic concern; the layout does not depend on it.
- **The Depot, Yard and Workshop need positions too.** They are not in the directory tree, so the layout must reserve fixed land for them — plausibly the Yard as the open ground at the town's centre, since it is where the most work happens. Leaving them unplaced would break the guarantee that every event has somewhere to land.

## Not decided here

The visual style of a building — footprint shape, colour, whether high-rise vs bungalow encodes anything. That is art, and metaphor intensity (ADR-0004) governs how much of it exists.
