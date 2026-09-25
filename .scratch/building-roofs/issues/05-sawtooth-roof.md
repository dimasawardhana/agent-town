# 05 — Sawtooth roof

**What to build:** A third roof kind whose silhouette is serrated, so it reads as unmistakably industrial and is distinguishable from the pitched and flat roofs at the fitted zoom.

A sawtooth is chosen for silhouette contrast rather than realism: the whole value of ornament here is recognition, so a look that cannot be told apart from the others at a glance is art paid for and worth nothing. The serration must survive at the sizes the town is actually read at, including on the smallest footprint.

**Blocked by:** 04.

**Status:** done

- [x] A sawtooth roof kind is baked for every footprint, construction stage and damage state
- [x] Its silhouette is distinguishable from the pitched and flat roofs at the fitted zoom, on the smallest footprint as well as the largest
- [x] It is selected by the same path-hash rule, and existing towns keep their other roofs unchanged
- [x] The drawing is deterministic, palette-only, fully opaque, and keeps artwork off the cel border
- [x] Verified live: a serrated roof is visible in the running town, and reloading reproduces it exactly
- [x] Measured and recorded in the ticket's comments: the new total cel count and atlas dimensions

## Comments

### What it is

A run of three teeth across the footprint, each a long shallow climb and a short
steep drop, topped with a vent. The steep drop is drawn as a **glazed flank**
(`P.glass`), which is the convention a real sawtooth follows and the reason this
kind reads as a factory rather than as a zigzag: the teeth are sheet metal and the
flanks between them are glass, so the eye gets a rhythm of light and dark rather
than a row of grey wedges. It is also the only cool blue in the building palette,
which is what makes the serration legible at 1×.

**No coping.** That is the one place the kind departs from the other two, and it is
geometrically forced rather than stylistic: a sawtooth's teeth run all the way down
to the wall, so there is no eave line for a coping to sit on. See the defect below.

### A new primitive, because a sawtooth is not a gable

`IsoPix.gable` varies the roof's height *across* the span: every point at the same
distance from the ridge is at the same height, which is what "pitched" means. A
sawtooth is the opposite — its height depends on where you are *along* the ridge —
so it needed a primitive that sweeps a profile down the ridge's length instead of
out from it. `IsoPix.ridgeProfile` is that primitive: it takes a profile function
of the along-ridge offset and fills a vertical face at every fall, which is what
both makes the surface solid and gives the sawtooth its glazing for free.

### Two defects found by measuring, not by looking

Both were invisible in the source and would have shipped.

**1. The swept surface was a wireframe.** The first version plotted one pixel per
step, which is what `gable` does and which is fine there: a gable's profile varies
across the ridge, so consecutive steps differ by a quarter pixel and plotting
points leaves no gaps. A swept profile can change by several pixels between
consecutive steps, so plotting points alone left the roof as a sparse lattice that
read as a wireframe. Fixed by filling the span between consecutive steps, and the
masked edge pass was removed with it. Found by dumping the cel as ASCII, which is
also how the fix was confirmed.

**2. The coping punched 218 holes in the roof.** `trim` drew a beam at local z = 0
along the wall top. For the pitched and flat kinds that is right — their roof sits
*above* the eave line. For the sawtooth the teeth descend *through* z = 0, so the
beam ran inside the roof's own surface and `outline` then inked around the pocket
between the beam and the teeth above it. Measured:

| footprint | interior holes, before | after |
|---|---|---|
| 44 | 21 | 0 |
| 60 | 60 | 0 |
| 78 | 123 | 0 |
| 100 | **218** | 0 |

This is a nasty failure mode because `outline` makes it *self-reinforcing*: the
pocket acquires a hard ink rim and reads as a deliberate window rather than as a
bug. It also could not have been caught by looking at one kind, since pitched and
flat were unaffected at every size.

The fix makes `trim` a **drawing** on the kit rather than a colour, so a kind can
have none. Verified by first measuring that the coping is not dead weight for the
other two — it recolours 56 (side 44) and 126 (side 100) pixels along the wall top
— so removing it outright would have cost them their gutter.

### The measurement that named the cause

Worth recording because it took the diagnosis from a guess to a fact. Counting
*opaque* pixels showed the trim added exactly **0** for pitched and flat and 24–67
for sawtooth. That looked like the coping being pointless. Diffing colours instead
showed it recolours 56–126 pixels for all three kinds — it overwrites rather than
adds. Two different questions, opposite answers, and only the second one identified
the real asymmetry.

### Verified live

Port 7823 against this repo: 692 frames, all three kinds on screen — **7 pitched,
2 flat, 6 sawtooth**, interleaved (`ui/src/art`, `internal/agent`, `internal/registry`
sawtooth; `ui/src/art/props` and `internal/web/static/assets` flat). Sheet still
**2048x4096**, tallest cel still `cap:100:pitched` at 91 — the sawtooth's 18-unit
rise is below the pitched kind's 22, so cell height did not move and the atlas
ceiling is unchanged. Both new materials confirmed present in the rendered frame:
metal 1,694 + 484 px, glass 6,331 + 1,300 px.

### Tests

`no cap cel has a hole punched in its roof` is new and is the test that caught
defect 2. It flood-fills from the cel's border and requires every transparent pixel
to be reachable, so an enclosed pocket fails. Checked that it bites: restoring the
beam fails it, removing it passes. Runs over every footprint, kind, stage and damage
state — 192 cap cels.

The existing per-kind invariants (`each roof kind draws a different picture`, `the
cap answers to the roof not the skin`, `a roof kind's cel is tall enough`) cover the
new kind without edit, because they iterate `ROOF_KINDS`.

Suites green: art 73, visibility 19, light 1, atlas 5. `tsc` clean.
