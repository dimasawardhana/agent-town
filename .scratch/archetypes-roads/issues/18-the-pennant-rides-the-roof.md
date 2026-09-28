# 18 — The pennant rides the roof

**What to build:** The verified flag does not float when the town turns.

**Blocked by:** none

**Status:** done

- [x] The pennant stands on a corner the camera is looking at, at every turn
- [x] The corner is a total order, so re-baking never moves the flag
- [x] The pennant's pixels are attached to the roof's, measured not asserted

## Comments

### The bug

```js
const fx = Math.round(side * 0.6);
const fy = Math.round(side * 0.28);
```

That is a roof corner at turn 0 and empty air at turn 1. The flag was placed in
**world** space on a picture that **rotates**, so it stayed at one world
coordinate while the roof turned out from under it.

The fourth time in this project for one lesson. The damage overlay's origins, the
ember's two clocks, a mark against a coordinate space it does not share, and now
a mark in a space the mark does not turn with. The tell is always the same: the
fault is invisible at the orientation it was drawn in, and correct-looking there.

### Why `frontCorner` and not a turn table

A switch on the turn would work and would be wrong twice. It would need a fifth
branch the first time the art grew a fifth orientation, and it would hard-code a
layout decision — which corner is nearest the camera — at a place that already
knows the answer. `IsoPix` computes depth and screen x for exactly this; the only
thing missing was a way to ask.

Ties break on screen x so the choice is a total order. Without that the flag
could hop corners as the atlas was re-baked, which is a different bug wearing the
same clothes.

### The test that matters is the pixel one

"Is the corner a footprint corner" passes for a flag standing in mid-air on a
correct corner. The real question is whether the pennant is *attached*, so
`flagcorner.test.ts` measures the Chebyshev distance from the flag's pixels to
the roof's, for every archetype and every turn. The pole rises out of the roof,
so the gap must be zero to within the pole's own width.

Restoring the old fixed fraction fails it, and so do the two structural tests
beside it.
