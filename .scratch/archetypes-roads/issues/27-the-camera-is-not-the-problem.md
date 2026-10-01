# 27 — The camera is not the problem

**What to build:** A finding, not a change. The machine's on-screen size was
questioned; this records what it is and what it means.

**Blocked by:** 25.

**Status:** done

- [x] Measured: 28x22 cel, scale 1.000, camera zoom 1, canvas 1084x900
- [x] The fit is integer and correct, and the town is meant to be read whole
- [x] No change made, and the reason recorded

## Comments

### The measurement

    cel: 28x22 px · scale 1.000 · camera zoom 1 · canvas 1084x900

No scaling is applied to a machine. It is 2.5% of the canvas width, against
buildings that project to roughly 200px tall.

### Why that is the right size and not a defect

`fit` computes an **integer** zoom — `Math.floor` on both axes, clamped to 1..4 —
which is exactly what the pixel-art rules require, and it fits the *whole* land
deliberately. A 28x22 machine on a map you are reading at a glance is a car on a
map of a city. You do not expect to read the car; you expect to see that
*something* is there.

The town already makes this division everywhere else, and the machine is not an
exception to it:

| at map scale | on demand |
|---|---|
| the building, its stage, its damage, the pennant | the panel's exact numbers |
| **the ember** — a recent touch, readable at 11px | the machine, readable when you zoom |

The ember exists *because* of this. It is a runtime-generated 11px glow, and its
whole job is to be the machine's readable presence on a map that is too zoomed
out for a machine to read. The machine is the detail; the ember is the signal.

### What would actually change it

Nothing here, and that is the point. The alternatives were:

- **Bigger machines** — out of scale with a 44-unit building, and the sprite
  guide puts characters at 16..32px, which 28x22 already satisfies.
- **A closer default fit** — stops showing the town, which is the product.
- **Zooming the camera in** — the detail control already does this, 1..4.

The one thing worth doing is a *user* judgement I cannot make: if a machine is
genuinely hard to see while an agent works, the honest fix is a second ember
brightness tier or a small badge over the building, not a rescale. Both are cheap.
Neither is needed until someone says a machine was hard to spot.
