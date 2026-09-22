// The view transform: the one place the town's orientation is decided.
//
// The layout arrives from the daemon in top-down world units and is never
// recomputed (ADR-0012). Rotating the *view* therefore means turning a world
// point on its way to the projection, not moving anything in the layout: the
// daemon's coordinates stay the single source of truth, and every consumer —
// building cels, workers, kerbs, hit zones, camera bounds, the land — reads the
// same turned answer because they all pass through this one function.
//
// **Why the turn is about the world origin.** A rotation about any other centre
// is a rotation plus a translation, and a translation is the part that silently
// breaks composition: a building's art is plotted in the building's *local*
// frame, and that frame is offset from the world by the site's position. Turning
// about a centre (the town's, or the footprint's) would mean the art and the
// placement disagreed by a per-building constant, which every call site would
// have to know about. About the origin, the map is purely linear, so
//
//     turn(site + local) = turn(site) + turn(local)
//
// and the art of a turned building, placed at the turned site, is exactly the
// turned picture of that building. The town appears to swing around the origin,
// which is invisible in practice because the camera re-frames the turned town.
//
// **Why quarter turns only.** The projection is the 2:1 dimetric, which is only
// self-consistent at multiples of 90°: a square world footprint projects to a
// 2:1 diamond, and turning it by any other angle gives a shape the baked art
// cannot represent. Four orientations are exactly the set the art can serve.
//
// **The light stays on screen.** `palette.ts` fixes the light at the top-left of
// every cel, so turning the town turns the world under a fixed sun rather than
// moving the sun. That is what lets the same art serve all four orientations —
// a wall that caught the light keeps catching it, because the wall the camera
// now sees on the lower-left flank is a different world wall. Nothing about the
// lighting needs to know the turn.

/** The four quarter turns, as a closed set. */
export const TURNS = [0, 1, 2, 3] as const;
export type Turn = (typeof TURNS)[number];

/** How many turns the four orientations are, for callers stepping through them. */
export const TURN_COUNT = TURNS.length;

/**
 * normaliseTurn folds any integer onto the four turns.
 *
 * Turning is offered as a repeated single step, so the count grows without bound
 * if a reader keeps pressing. Folding here rather than at each call site means a
 * negative or four-times-round value cannot reach the projection, where it would
 * silently draw an unrotated town.
 */
export function normaliseTurn(n: number): Turn {
  return (((n % TURN_COUNT) + TURN_COUNT) % TURN_COUNT) as Turn;
}

/** A point in either world or picture space, whichever the caller is in. */
export interface Point {
  x: number;
  y: number;
}

/**
 * turnPoint applies a turn to a world point, about the world origin.
 *
 * Each case is written out rather than derived from sin/cos. The quarter turns
 * are exact integers, and a trigonometric form would put floating-point error
 * into coordinates that tiles and cels are plotted at integer-pixel precision
 * from — half a pixel of drift in a footprint moves every tile seam.
 *
 * The direction is the one a reader expects from pressing "rotate right": world
 * +x turns toward screen-down-right, which is what makes the town appear to
 * spin clockwise under a camera that does not move.
 */
export function turnPoint(turn: Turn, x: number, y: number): Point {
  switch (turn) {
    case 1:
      return { x: y, y: -x };
    case 2:
      return { x: -x, y: -y };
    case 3:
      return { x: -y, y: x };
    default:
      return { x, y };
  }
}

/**
 * WorldView projects world points through the current orientation.
 *
 * One instance per draw, holding the turn and the projection together so that no
 * call site can apply one without the other. That pairing is the whole safety
 * property: a caller that turned its coordinates but projected them with the
 * unturned formula would put its object at a plausible-looking wrong place,
 * which is the failure this class exists to make unrepresentable.
 */
export class WorldView {
  readonly turn: Turn;

  constructor(turn: number) {
    this.turn = normaliseTurn(turn);
  }

  /** rotate turns a world point about the origin. */
  rotate(x: number, y: number): Point {
    return turnPoint(this.turn, x, y);
  }

  /**
   * project maps a world point to a picture pixel.
   *
   * This is the projection of `art/iso.ts`, `workers.ts` and `scene.ts`, applied
   * after the turn. It is restated here for the same reason those restate it:
   * this module must be testable without a renderer, and `art.test.ts` asserts
   * the copies agree. A copy that disagreed would put the kerb, the workers and
   * the buildings in three different places.
   */
  project(wx: number, wy: number, z = 0): Point {
    const p = this.rotate(wx, wy);
    return { x: (p.x - p.y) / 2, y: (p.x + p.y) / 4 - z };
  }

  /**
   * screenBox is the picture-space bounding box of a world rectangle.
   *
   * All four corners are turned and projected, because a turn changes which
   * corner is leftmost — so deriving the box from two opposite corners
   * under-measures it on one axis at turns 1 and 3. That exact mistake measured
   * 353 pixels of lost land in `landBox`, so both are written the same way
   * deliberately.
   */
  screenBox(
    x: number,
    y: number,
    w: number,
    h: number,
    z = 0,
  ): { minX: number; maxX: number; minY: number; maxY: number } {
    const corners = [
      this.project(x, y, z),
      this.project(x + w, y, z),
      this.project(x, y + h, z),
      this.project(x + w, y + h, z),
    ];
    return {
      minX: Math.min(...corners.map((c) => c.x)),
      maxX: Math.max(...corners.map((c) => c.x)),
      minY: Math.min(...corners.map((c) => c.y)),
      maxY: Math.max(...corners.map((c) => c.y)),
    };
  }

  /**
   * screenDir is the picture-space direction a world direction points.
   *
   * Used where a thing must face where it is going: a worker walking along world
   * +x faces screen right at turn 0 and screen up at turn 1, and the *sign of the
   * screen x component* is what decides the sprite's flip. Returning the turned
   * vector rather than a boolean keeps the decision at the call site where the
   * sprite is, and keeps this module free of renderer concepts.
   */
  screenDir(dx: number, dy: number): Point {
    const d = this.rotate(dx, dy);
    return { x: (d.x - d.y) / 2, y: (d.x + d.y) / 4 };
  }
}

/**
 * A world rectangle, in the shape both the layout and its districts use.
 *
 * Declared structurally so `turnLayout` can serve a site and a district without
 * a cast, and without importing the store into a module the art layer reads.
 */
export interface WorldRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * turnRect turns one world rectangle and normalises it to a positive box.
 *
 * A turned rectangle's corners land on negative coordinates for any turn but 0,
 * so the result is re-based to start at (0, 0) by the caller's shift. Doing it
 * per-rectangle here would lose the shared origin: two rectangles must move by
 * the *same* amount or the town comes apart. So this returns the raw turned box
 * and `turnLayout` applies one shift to all of them.
 */
function turnRect(turn: Turn, r: WorldRect): WorldRect {
  const corners = [
    turnPoint(turn, r.x, r.y),
    turnPoint(turn, r.x + r.w, r.y),
    turnPoint(turn, r.x, r.y + r.h),
    turnPoint(turn, r.x + r.w, r.y + r.h),
  ];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * turnLayout presents a layout as the camera currently sees it.
 *
 * This is the whole of the rotation. Rather than thread a turn through every
 * consumer — the camera bounds, the kerbs, the ground painter, the workers, the
 * hit zones, the labels — the layout is turned once, and everything downstream
 * goes on reading a layout exactly as it always did. That is not a shortcut: a
 * turn threaded through thirty call sites is thirty chances to apply it to the
 * coordinates and forget it in the projection, and each one fails as a
 * plausible-looking wrong picture rather than as an error.
 *
 * **Why the art lines up.** The turn is linear about the world origin
 * (`turnPoint`), so `turn(site + local) = turn(site) + turn(local)`. A cel baked
 * at this turn is plotted in the building's local frame, and its origin is
 * placed at the turned site — the composition is exact, with no per-building
 * correction. The cel's *size* is unchanged too, because every footprint is
 * square and a square projects to the same bounding box at any quarter turn.
 *
 * The result is re-based to start at (0, 0), because the ground painter and the
 * land box assume a layout whose coordinates begin at the origin.
 */
export function turnLayout<S extends WorldRect, D extends WorldRect>(
  turn: number,
  layout: { sites: S[]; districts: D[]; width: number; height: number },
): { sites: S[]; districts: D[]; width: number; height: number } {
  const t = normaliseTurn(turn);
  if (t === 0) return layout;

  const sites = layout.sites.map((s) => ({ ...s, ...turnRect(t, s) }));
  const districts = layout.districts.map((d) => ({ ...d, ...turnRect(t, d) }));

  // One shift for everything, from the whole town's box — derived from the outline
  // the layout declares rather than from the rects, which would be the same number
  // computed in a way that could disagree with it.
  const whole = turnRect(t, { x: 0, y: 0, w: layout.width, h: layout.height });
  const shift = { x: -whole.x, y: -whole.y };

  const move = <R extends WorldRect>(r: R): R => ({ ...r, x: r.x + shift.x, y: r.y + shift.y });

  return {
    sites: sites.map(move),
    districts: districts.map(move),
    // Width and height swap on an odd turn, which is exactly what `turnRect` of
    // the whole town computes.
    width: whole.w,
    height: whole.h,
  };
}
