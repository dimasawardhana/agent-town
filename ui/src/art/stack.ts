// Floors: how a building's height is built out of storeys.
//
// The projection is `sy = (wx + wy) / 4 - z`, which means raising a point by one
// world unit moves it one *pixel* up — a clean 1:1 in the vertical. That has a
// consequence the whole rendering model rests on: a band of wall can be copied
// upward by an exact integer translation, so one storey of art serves a tower of
// any height and no seam appears between floors. `art.test.ts` asserts it,
// because it is invisible from reading any single drawing function — every floor
// would be individually correct while the tower showed a line at each join.
//
// Height therefore does not need its own art, only its own arithmetic. A
// baked-tower approach was measured and rejected: a 20-storey building on a
// 78-unit footprint needs a 91x478 cel, and the atlas already holds 128 building
// cels; one cel per height is unbounded memory for a picture that is a repeat.
//
// Floors are a property of the building, not of its rank on the construction
// ladder. A building has the same number of storeys whether it is a staked plot
// or a completed tower, which is what keeps the ladder's "one rank, one part"
// promise intact — the roof is a part, a floor is not.

/** World units per storey. A round number: it is added to and divided by in
 *  several places, and 20 divides cleanly by 2, 4, 5 and 10. */
export const STOREY = 20;

/**
 * The most storeys a building may have.
 *
 * Both a rendering and an aesthetic limit, and it mirrors the daemon's own cap
 * so the two cannot disagree about how tall the tallest building is. Twenty
 * storeys is 400 world units of wall — six times the tallest building drawn
 * before floors existed — and past that a tower stops reading as a building and
 * starts reading as a vertical stripe that happens to have a roof on it.
 */
export const MAX_FLOORS = 20;

/**
 * bandHeight is the wall height in world units for a number of storeys.
 *
 * Clamped rather than trusted. The count arrives from the daemon, and a renderer
 * that allocates memory based on a remote number is one bad value away from an
 * unusable tab. Zero and negatives become a single storey, because a building
 * with no wall is not a building — this is the renderer's independent guarantee,
 * not a restatement of the daemon's, and it is deliberately the same clamp the
 * daemon applies so a disagreement is impossible rather than merely unlikely.
 */
export function bandHeight(floors: number): number {
  return clampFloors(floors) * STOREY;
}

/** clampFloors is the one place a floor count becomes a usable number. */
export function clampFloors(floors: number): number {
  if (!Number.isFinite(floors)) return 1;
  return Math.min(MAX_FLOORS, Math.max(1, Math.floor(floors)));
}

/**
 * towerTop is the world z the cap's base sits at: the top of the topmost band.
 *
 * A tower of N storeys has bands at z = 0, STOREY, ..., (N-1)*STOREY, so the cap
 * goes at N*STOREY. Getting this wrong by one is the single most likely defect
 * in any stacking code and is invisible on a one-storey building, which is why
 * it is a named function rather than arithmetic at the call site.
 */
export function towerTop(floors: number): number {
  return clampFloors(floors) * STOREY;
}
