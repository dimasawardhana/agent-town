# 10 — Workers walk the roads

**What to build:** A figure travelling between buildings follows the road
network instead of crossing the grass in a straight line.

**Blocked by:** 08 — the roads have to exist and turn correctly first.

**Status:** done

- [x] A figure's route bends onto a road and leaves it, rather than ploughing
      through whatever is between two points
- [x] A figure working inside one plot still travels in a straight line
- [x] A journey with no road anywhere near either end is unchanged
- [x] The walk cycle is timed from the distance actually walked
- [x] The route is recomputed against the turned road network
- [x] No zero-length leg, so a figure cannot stall on a degenerate route

## Comments

### A road nobody travels is a road that is only decoration

The roads shipped in ticket 08 and nothing used them, which is the same failure
that got the road kind deleted the first time — art with no geometry behind it.
This is the geometry.

`routeAlongRoads` is a pure function over the network, so it is tested without a
scene and without Phaser, and it lives in `view.ts` beside the projection rather
than in the Phaser layer. That is not tidiness: the test could not import it
from `workers.ts` at all, because that module pulls in Phaser and the test runs
in node.

### Roads are lines to walk, not rectangles to stand on

A road arrives as an axis-aligned rectangle in **world** space, and the
projection is isometric, so it does not project to a rectangle. Taking the
bounding box of its four projected corners would give a parallelogram's box —
larger than the road — and a figure routed onto that box would be standing on
the grass beside the tarmac.

So each road is reduced to its centre line with a width, found by projecting the
corners and averaging. The router then asks "nearest point on this line" rather
than "is this point inside this rectangle", which is both correct under an
isometric projection and cheaper.

### The handoff has to come after the layer is built

The redraw path **rebuilds** the worker layer, so handing it the network first
wipes it before a single figure has moved. That produced a town with 13 roads on
screen and a figure still crossing grass — measured, because the symptom looks
exactly like the routing not existing.

### Measured in a live town

90 of 90 sampled frames put the figure within 14px of a road centre line.
