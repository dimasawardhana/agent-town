# Roads Are Pieces, Not Lines

> A plan, written after looking at what we draw and comparing it against how a road
> is actually drawn. Not for execution yet — the tiers are costed and the call on
> which to build is the reader's.

**Problem:** an import or containment band renders as an independent stroked bar
with butt ends. Two bands leaving the same building are two parallel rectangles,
not a junction. The reader sees *lines*, and the town reads as messier than the
17 roads and 14 buildings it contains.

**Evidence, from the rendered town at 9×:**

- Bands leaving `ui/src` are two disconnected grey bars with square ends.
- The kerb appears on the **top edge only** — a light strip along one side and a
  hard flip to grass on the other. It reads as accidental, not authored.
- The surface is a flat fill. There is no texture, so at map zoom a 10-unit band
  is a value, not a surface.

---

## What a road usually is

Every convention I can point at — oblique cartography, and the auto-tiling in
`references/patterns.md` — agrees on the same short list.

**1. A road is a set of pieces, not a line.** A tile's piece is chosen by *which of
its sides touch more road* — a bitmask over the four neighbours. That yields
straight, corner, T, cross and dead-end, and nothing else is needed. The diamond
lattice is the same idea in isometric.

**2. The kerb is drawn only where the road ends.** Facing non-road. A kerb that
runs continuously down a straight is not a kerb, it is a stripe.

**3. Road value is darker than the ground; the kerb is lighter than the road.**
Three values, always in that order. This is what makes a road legible at any zoom
without it needing texture.

**4. Width encodes class.** A footpath is narrower than a street. Roads of
different widths may cross without merging.

**5. Roads connect.** You can trace them. A bar that dead-ends in grass with a
square cap is not a road, it is a mark.

## Where we are against each

| | convention | ours today |
|---|---|---|
| pieces by neighbour mask | straight/corner/T/cross | **none for bands**; `onEdge` for district roads only |
| kerb on non-road edges | per-edge | **top edge only**, and the same for every kind |
| three values (ground < road < kerb) | yes | two (road, kerb), both derived from one averaged tile colour |
| width encodes class | yes | **one width for all bands** — `BAND_HALF_WORLD = 4` draws import and containment identically, while the layout says 10 for containment |
| roads connect | yes | bands are independent quads; crossings overlap as two crossing outlines |

Two of the five are already correct **for district roads** — `onEdge` is exactly a
four-way edge mask, and `groundEdgeFrame` is exactly the kerb piece. We wrote the
right model once and then didn't apply it to the bands.

**The enabling change already happened.** The quad renderer exists because a band
was 14 units and a tile is 16, so a 14-unit band rendered as one checkered diamond.
`ccde953` widened the gap to 40, so the shortest band is now **40 units = 2.5
tiles**. The tile model is viable for bands again — and it carries texture and
edge pieces for free.

---

## Three tiers

### Tier 1 — hierarchy between kinds (small)

Give each kind its own width, value and kerb. Nothing structural; one table where
the three kinds are given their treatment instead of sharing one call.

- **district** — loudest: checkered tile surface, kerb, widest.
- **import** — kerbed band, medium value. It is the new claim, so it takes the
  second-most attention.
- **containment** — no kerb, value close to the ground. Drawn, true, and quiet.
  Nesting is the most predictable fact on the map.

Fixes the 17-roads-for-14-buildings complaint by *de-emphasising* six of them
rather than deleting any.

Also fixes a live bug: containment is drawn 8 units wide against a layout that
declares 10.

**Cost:** an afternoon. **Risk:** low. **Reversible:** yes.

### Tier 2 — bands on the tile grid (medium)

Go back to painting bands with `groundFrame`/`groundEdgeFrame` on the world grid,
with an edge mask derived from the band's own direction, exactly as district
roads already do. A band gets shaped ends and the road tile's texture instead of
a flat fill.

- **Cost:** roughly a day. The `onEdge` logic already exists; it needs to work
  from a band rather than a rect.
- **Limitation, stated plainly:** the mask is per-road. Two *different* bands
  still will not know they meet, so a T between an import and a containment road
  is still two bars.

### Tier 3 — network-aware pieces (large)

Compute the mask **across the whole network**: for each road tile, look at its
four neighbours on the grid and ask whether either is road, then pick a piece.
This is what actually produces junctions, and it is the difference between "17
bars" and "roads".

- **Cost:** days, and it is the piece most likely to reveal that the band's
  geometry is wrong at junctions rather than the renderer.
- **Benefit:** the town becomes traceable, which is the thing a road is *for*.

---

## Recommendation

**Tier 1 now, Tier 3 planned.**

Tier 1 is the whole of "too messy" and it is cheap. Tier 2 is worth doing but it
buys texture and shaped ends, not junctions — the thing that actually makes roads
read as roads is Tier 3, and it should be planned rather than improvised.

I would **not** do Tier 2 on its own: it is the expensive middle that does not
deliver the thing Tier 3 delivers, and doing both means writing the tile walk
twice.

## What would change visually, and how to check it

- Tier 1: containment bands stop competing with import bands. Verified by
  screenshotting a junction and confirming the two no longer look identical.
- Tier 3: a reader can trace a road from one building to another without it
  stopping. Verified by eye at fitted zoom, because it is a legibility property
  and no assertion states it.

## Open questions for the reader

1. **Is containment a road at all?** It says "this sits inside that", which the
   eye can already read from nesting. Drawing it quietly assumes it is still
   worth drawing. That is a claim about what this map is for, not a rendering
   question, and I would rather it be answered than assumed.
2. **Should an import band reach the building's door?** Right now it stops at
   the plot edge, which leaves a visible gap between road and wall. Real roads
   meet buildings; whether this one should is the same kind of question.
