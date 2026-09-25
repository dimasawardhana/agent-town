# 07 — Domed roof (optional)

**What to build:** A rounded roof kind, so the set of looks includes one curved silhouette against the angular pitches, sawteeth and gantries.

Kept as its own ticket so it can be dropped without disturbing anything else: four roof kinds already give a town sufficient variety, and this is the fifth. Ship it if the curved silhouette earns its place in the running town; skip it if it does not, and nothing else changes.

A dome is the shape most likely to want vertical room, so like the gantry it must confirm the atlas still fits rather than assuming. It should fit comfortably within the tallest existing kind if drawn to that budget — prefer that over growing the cel height for one look.

**Blocked by:** 03, 04.

**Status:** done

This ticket is optional: four roof kinds is already a complete answer to the request.

- [x] A domed roof kind is baked for every footprint, construction stage and damage state, or the ticket is dropped with the reason recorded
- [x] Its silhouette is distinguishable from the other roof kinds at the fitted zoom
- [x] The cel height it requires is measured, and the atlas still fits within the safe canvas limits
- [x] It is selected by the same path-hash rule, and existing towns keep their other roofs unchanged
- [x] The drawing is deterministic, palette-only, fully opaque, and keeps artwork off the cel border
- [x] Verified live: a domed roof is visible in the running town, and reloading reproduces it exactly
- [x] Measured and recorded in the ticket's comments: the new cel height, total cel count and atlas dimensions

## Comments

**Shipped, not dropped.** It earned its place: against three angular kinds — a
triangle, a line, a serration — a curve is instantly distinct at 1×, and
distinctness is the only job a roof has.

### Why it needed a third primitive

`gable` varies height across the ridge; `ridgeProfile` varies it along the ridge. A
dome varies in **both directions at once**, so neither can express it — both sweep a
one-dimensional profile, and a dome has no profile direction because every radius is
the same fall. `IsoPix.dome` is the third and last way a roof can vary: a radial
height field, far-to-near by world row, with the span between consecutive steps
filled. That fill is not optional, for the same reason it was not in `ridgeProfile`:
a point-only sweep leaves a lattice.

### The curve is deliberately not a hemisphere

A true `cos`/circle sampled at these sizes reads as a bead or a mushroom cap — the
pixel grid cannot carry a shallow arc. The profile used is `1 - t²` with a floor at
the perimeter: a flatter crown and a steeper skirt, which is the shape that survives
rasterisation as a *dome*. A true circle also leaves the rim a pixel above the wall
and shows a gap on every side, which the floor avoids.

### The lantern is load-bearing, not decoration

The dome's own shading spans only a few steps of the stone ramp, so at 1× the
surface alone reads as a grey bump rather than as a roof. The glass drum at the apex
is what the eye uses to find the shape — the same reasoning that put a chimney on a
pitched roof and a hoist on the gantry. Verified in the rendered frame: 27 px of
`P.glass[3]` on screen.

### Height stayed inside the budget

The ticket asked this be measured rather than assumed, and the answer is that it fits
with room to spare:

| footprint | pitched | domed |
|---|---|---|
| 44 | 53 | 52 |
| 60 | 65 | 64 |
| 78 | 78 | 76 |
| 100 | **91** | **90** |

The dome is 1–2 px *shorter* than the pitched kind at every size, so `cellH` is still
93, the tallest cel is still `cap:100:pitched` at 91, and the atlas ceiling is
unchanged.

### Atlas with all five kinds

**820 frames, cell 115x93, sheet 2048x8192, guard passes.** Headroom is 588 cels =
9 more kinds. Every kind since the second has been free in *height* (all five are
within the pitched kind's 22-unit rise) and costs a flat 64 cels in count, which is
what makes the set extensible rather than a two-and-done.

### Verified live

Port 7825 against this repo: 820 frames, all five kinds baked, four visible on the
15 buildings (**8 flat, 3 domed, 3 sawtooth, 1 gantried**). Distributions checked
separately over 20,000 synthetic paths and the repo's own directory tree: every kind
is reachable. The material check confirms the dome's lantern glass and the other
kinds' materials all present in the rendered frame.

### Tests

No new tests and no edits to existing ones. All four roof-kind invariants iterate
`ROOF_KINDS`, so they covered this kind the moment it joined the set — including
`no cap cel has a hole punched in its roof`, which failed three times on the gantry
and passed first time here. The radial fill was written the way `ridgeProfile`'s
final version was, pre-empting the lattice failure rather than rediscovering it.

Suites green: art 73, visibility 19, light 1, atlas 5. `tsc` clean.
