# ADR-0020: The view turns, the world does not

## Context

The town is drawn in a fixed 2:1 dimetric projection: `sx = (wx - wy) / 2`,
`sy = (wx + wy) / 4 - z`. The camera can pan and zoom (ADR-0002) but not turn, so
a reader always sees the town from the same corner.

That corner is not neutral. The projection puts world `+x` toward the
lower-right and `+y` toward the lower-left, so the town's layout — which the
daemon computes as a grid of districts — is always read with the same axis coming
toward the viewer. On a tall town the districts wrap into rows that recede away
from the camera, and the row a reader cares about may be the one furthest from
them, at the back.

The request was simply "is it possible to rotate the camera?". The interesting
part is that for this renderer the honest answer is not "move the camera".

## Decision

**Turn the town, in quarter turns, and keep the camera fixed. The light stays in
the picture.**

1. **Four orientations, and no more.** The projection is only self-consistent at
   multiples of 90°: a square world footprint projects to a 2:1 diamond, and any
   other angle produces a shape the baked art cannot represent. The art bakes one
   cel per square footprint, so four orientations are exactly the set it can
   serve. `TURNS` is a closed set and `normaliseTurn` folds any count into it.

2. **The turn is linear about the world origin.** `turnPoint` maps
   `(x, y) → (y, -x)` and its powers. About the origin rather than about the
   town's centre, because a rotation about any other centre is a rotation *plus a
   translation*, and the translation is the part that breaks composition: a
   building's art is plotted in the building's *local* frame and placed at its
   site, so only a purely linear map gives
   `turn(site + local) = turn(site) + turn(local)` — the art of a turned building,
   put at the turned site, is exactly the turned picture of that building.

3. **The turn is applied to the layout, not to the camera.** `turnLayout`
   produces a turned copy of the daemon's layout, re-based to the origin, and
   everything downstream — camera bounds, kerbs, the ground painter, workers, hit
   zones, labels — goes on reading a layout exactly as it always did. The daemon's
   own layout is kept untouched so turns compose as "which orientation" rather
   than accumulating.

4. **The light does not turn.** `palette.ts` fixes the light at the picture's
   top-left. So the wall that catches it is whichever world wall is on the
   picture's left flank at that orientation. `IsoPix.box` chooses its two visible
   walls by turned screen position, not by world axis, and decoration that goes on
   a *face* — windows, doors — is placed through `litWall`/`shadowWall` rather
   than on `x = side` / `y = side`.

5. **Each orientation is its own baked atlas.** A turned building is a different
   *picture*, not a moved one: different walls face the camera, so the pixels
   differ. `bake(scene, turn)` produces one, keyed `town` / `town:t1`…, and
   `TownScene.ensureAtlas` bakes each on first use.

6. **Four orientations are offered as a control, not a free angle**, and the
   control resets to upright. Both are view preferences beside the detail filter:
   neither is sent anywhere, and neither can change what the map says.

## Why

**Why not move the camera.** Phaser's camera can be rotated with
`setRotation`, and it would have been a two-line change. It is wrong here for
three reasons that compound:

- **The art is baked, not drawn.** Every cel is a raster at a fixed projection.
  Rotating the camera renders those rasters at an angle, which is the one thing a
  pixel-art screen must never do — the same reason zoom is clamped to whole
  numbers (`controls`). A rotated camera shows a town of soft, misaligned pixels.
- **The tiles would not tile.** The ground is painted by walking world
  coordinates and blitting integer-spaced diamonds. Under a rotated camera the
  diamonds no longer align to the pixel grid, and the seams the art direction
  exists to avoid appear everywhere at once.
- **Text would tilt.** Labels are baked placards. A rotated camera draws them at
  an angle, and a placard that is not horizontal is unreadable at 5-pixel glyphs.

**Why turning the layout rather than threading a turn through the renderer.** A
turn passed to each consumer is a turn that can be applied to a thing's
coordinates and forgotten in its projection, or applied twice, or applied in the
world where the screen was meant. Every such mistake draws a plausible-looking
wrong picture rather than failing. Turning one input at the boundary makes the
rest of the renderer unchanged and unable to be wrong about orientation.

**Why the light stays put.** A reader expects the sun to be a property of the
picture, not of the town's compass. If the light turned with the world, every
building would be lit from the left at one orientation and from the right at the
next, and the town would appear to carry its own sun around — which reads as the
art flickering rather than as the town turning. Fixing it in the picture is also
what makes rotating cheap: the bake for an orientation is the same artwork with
different faces chosen, not a relit scene.

**Why one atlas per orientation, baked on demand.** All four at boot would add
~1.7 s to every session for three pictures most readers never look at (measured:
422 ms per orientation, 628 cels). Baking on the first turn instead costs a
hitch at the moment of a deliberate act, which is a much better place for a
pause than the start of every visit.

## Consequences

- `ui/src/view.ts` is new: `TURNS`, `normaliseTurn`, `turnPoint`, `WorldView`,
  `turnLayout`. It restates the projection, and `art.test.ts` asserts the copies
  agree — a fourth copy that disagreed would put the kerb, the workers and the
  buildings in three different places.
- At the origin, `IsoPix` gained a `turn`, and `box`/`gable` became turn-aware.
  Turn 0 is **byte-identical** to the previous art, asserted by the whole existing
  art suite, which is the guarantee that the unrotated town did not change.
- The cel boxes (`boxFor`, `bandBox`, `capBox`) derive the footprint's screen
  corners from the turn. A square footprint projects to the same *size* box at
  every turn but not the same *box*, because a rotation permutes its corners.
  Padding from the unrotated corners was a real defect: 39 px of origin error for
  a 78-unit footprint at turn 1.
- A baked orientation is **retained** for the session (`TownScene.atlases`), so
  turning back and forth does not re-bake. The frame table cannot be recovered
  from a registered texture without re-deriving every frame's size and origin,
  and re-baking would throw anyway because the texture key would already exist.
  That is how the first version of this failed: it baked twice, the second call
  threw, and the abort left a town with one sprite and no rotation.
- Each atlas is ~16.8 MP of canvas, which is why they are built lazily rather
  than all four at boot.
- The store gained `turn`, `turnBy`, `setTurn`. Nothing is sent to the daemon
  (ADR-0013's transport table is unchanged).
- A worker's facing follows the turn for free: `setFlipX(to.x < sprite.x)`
  compares *screen* x, which the turned layout has already produced.
