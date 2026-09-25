# 06 — Gantried roof

**What to build:** A roof kind with a gantry — a raised working structure over a flat top — so a building reads as a station or a depot rather than as a house or a shed.

This is the look that answers the original request for "airport / station". It is deliberately **a roof and not a new Place**: the four places a worker can stand are a closed set, and a fifth would need a fifth kind of event to route work there, which the action vocabulary does not have. The gantry is ornament, chosen by path hash, and means nothing about the code.

Unlike the other shapes, a gantry is *tall*. That is the one way a roof can cost more than its own cels: a taller cel raises the sheet's cell height for every cel on it, so this ticket must confirm the atlas still has room rather than assuming it.

**Blocked by:** 04.

**Status:** done

- [x] A gantried roof kind is baked for every footprint, construction stage and damage state
- [x] Its silhouette is distinguishable from the other roof kinds at the fitted zoom
- [x] It is selected by the same path-hash rule, and existing towns keep their other roofs unchanged
- [x] The cel height it requires is measured, and the atlas still fits within the safe canvas limits after it is added
- [x] The drawing is deterministic, palette-only, fully opaque, and keeps artwork off the cel border
- [x] Verified live: a gantried roof is visible in the running town, and reloading reproduces it exactly
- [x] Measured and recorded in the ticket's comments: the new cel height, total cel count and atlas dimensions

## Comments

### What shipped

A flat deck with a **crane** on it: a mast standing on the deck, a solid jib
cantilevered from its head, and a hoist hanging from the jib. Deck and structure are
both `P.metal`, so the kind reads as plant rather than as a building.

It is a crane rather than a portal frame — four legs with beams over them — and the
switch was forced by measurement, not taste. The reason is in the defect section.

### The cel height does not move, which was the ticket's actual concern

This is the ticket the ADR warned about: **a tall kind raises `cellH` for every cel
on the sheet**, so it buys its look with atlas headroom. Measured, it does not:

| footprint | pitched cel | gantried cel |
|---|---|---|
| 44 | 53 | 55 |
| 60 | 65 | 66 |
| 78 | 78 | 78 |
| 100 | **91** | **91** |

The gantry is 2 px taller than the pitched kind on the two smallest footprints and
exactly equal on the two largest — because 22 units is where the pitched kind
already tops out, and the gantried heights were chosen to meet it rather than
exceed it. So `cellH` is still 93, the tallest cel is still `cap:100:pitched` at 91,
and the atlas ceiling is unchanged at **1408 cels**.

With four kinds the atlas is **756 frames, cell 115x93, sheet 2048x8192, guard
passes**. Headroom is 652 cels = 10 more kinds, which is the ADR's own N=10 figure
arriving on schedule.

### Three failed attempts, all caught by one invariant

`no cap cel has a hole punched in its roof` — added in ticket 05 — failed **three
times** while building this kind, each time for the same underlying reason in a new
place. Worth recording, because the pattern is the useful part:

1. **Four legs + two beams** over the deck. Encloses a rectangle: deck below, beams
   above, legs on both sides. 25 enclosed pixels on a 78-unit footprint, holes at
   every size.
2. **Filling the pocket with a dark mass.** This passed the invariant but read as a
   solid block rather than as a structure — safe, and wrong.
3. **Mast + two thin beams as the jib.** The two beams met the mast at two different
   points and enclosed a new rectangle between them. Holes again, on a 60-unit
   footprint.

Fixed by drawing the jib as **one solid box that overlaps the mast**, and the hoist
as a solid box that overlaps the jib. The generalisation is the point and it is
recorded in the code: *a union of overlapping solids is simply connected, so it
cannot enclose air.* Two thin beams meeting at two points always can. That removes
the class of failure rather than the instance, which is why the fourth attempt
needed no patching.

### A second defect found while measuring: the frame floated

The first version's legs started at `top` — the roof's whole rise — instead of at the
deck's own top, which left the structure hovering five units above its own deck.
Invisible in source, because `top` and `GANTRY_DECK` are each individually correct.
Same shape as the stacking off-by-one-storey bug `stack.ts` warns about. Fixed by
introducing a named `GANTRY_DECK` used by both `draw` and `stack`, so the two cannot
drift.

### Verified live

Port 7824 against this repo: **756 frames, all four kinds on screen together —
5 sawtooth, 5 gantried, 3 flat, 2 pitched**, interleaved across 15 buildings. A full
page reload reproduces all 15 exactly. All four roof materials confirmed present in
the rendered frame (pitched terracotta 1,576 px, flat stone 14,153 px, sawtooth glass
4,604 px and metal 1,480 px, gantry metal 602 px). Thatch is absent, correctly: this
town has no hut-sized building wearing a pitched roof.

### Tests

No new test files — the four roof-kind invariants written in ticket 04 all iterate
`ROOF_KINDS`, so they covered this kind the moment it was added to the set:

- `each roof kind draws a different picture, and the cap answers to the roof not the skin`
- `a roof kind's cel is tall enough for everything it draws` (this is what would have
  caught a clipped mast head)
- `the bake and its invariants enumerate the same cels` — asserts every kind has a
  full complement of cap cels
- `no cap cel has a hole punched in its roof` — the one that failed three times

That they needed no edit is the evidence ticket 02's single enumeration was worth
doing.

Suites green: art 73, visibility 19, light 1, atlas 5. `tsc` clean.
