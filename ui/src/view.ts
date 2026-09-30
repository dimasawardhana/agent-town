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
export function turnLayout<
  S extends WorldRect,
  D extends WorldRect,
  // The constraint, not just the default: a band is optional per road, but the
  // turn has to know the four fields exist to turn them. A default alone lets a
  // caller infer an `R` with no band on it, and then the band cannot be turned.
  R extends WorldRect & { kind?: string; ax?: number; ay?: number; bx?: number; by?: number },
>(
  turn: number,
  layout: { sites: S[]; districts: D[]; roads?: R[]; width: number; height: number },
): { sites: S[]; districts: D[]; roads?: R[]; width: number; height: number } {
  const t = normaliseTurn(turn);
  if (t === 0) return layout;

  const sites = layout.sites.map((s) => ({ ...s, ...turnRect(t, s) }));
  const districts = layout.districts.map((d) => ({ ...d, ...turnRect(t, d) }));
  // Roads are geometry like everything else, and they are rotated and shifted
  // by the same two steps. They were not, and the failure was silent and total:
  // the type did not mention them, so the turned layout came back with no roads
  // at all and the painter — correctly, following the layout it was given —
  // drew nothing. A field the turn does not know about is a field that vanishes
  // rather than one that drifts, which is why this is a named line and not a
  // spread over the return.
  const roads = layout.roads?.map((r) => ({ ...r, ...turnRect(t, r) }));

  // One shift for everything, from the whole town's box — derived from the outline
  // the layout declares rather than from the rects, which would be the same number
  // computed in a way that could disagree with it.
  const whole = turnRect(t, { x: 0, y: 0, w: layout.width, h: layout.height });
  const shift = { x: -whole.x, y: -whole.y };

  // The band is shifted too, and separately from the rect, because a band left
  // behind is a road drawn several hundred pixels from where the layout says
  // it is: visible, plausible, and belonging to no orientation at all.
  const move = <R extends WorldRect & { ax?: number; ay?: number; bx?: number; by?: number }>(r: R): R => ({
    ...r,
    x: r.x + shift.x,
    y: r.y + shift.y,
    ...(typeof r.ax === "number"
      ? { ax: r.ax + shift.x, ay: r.ay! + shift.y, bx: r.bx! + shift.x, by: r.by! + shift.y }
      : {}),
  });

  return {
    sites: sites.map(move),
    districts: districts.map(move),
    roads: roads?.map(move),
    // Width and height swap on an odd turn, which is exactly what `turnRect` of
    // the whole town computes.
    width: whole.w,
    height: whole.h,
  };
}

/**
 * routeAlongRoads is the way a figure walks from one point to another: along
 * the roads where there are roads, and in a straight line where there are not.
 *
 * A straight line between two buildings cuts diagonally across whatever lies
 * between them, and in a town whose roads had only just been given geometry
 * that makes the roads scenery. Routing through them is what makes a road a
 * road — and it is honest, because a figure taking the road is a figure
 * behaving the way the map says the ground is laid out.
 *
 * The route is a short polyline rather than a solved path. Three points — the
 * figure, the point where it joins the road, the point where it leaves — is what
 * this geometry actually needs: the row roads span the town's width, so any two
 * of them are already connected by walking along one of them, and a containment
 * link joins exactly the two buildings it was emitted for.
 *
 * Returns `[from, to]` unchanged when no road is anywhere near either end,
 * which is the common case for a figure working inside one plot, and is the
 * reason an empty network must not bend anything.
 */
export function routeAlongRoads(
  from: { x: number; y: number },
  to: { x: number; y: number },
  roads: readonly RoadLine[],
): { x: number; y: number }[] {
  if (roads.length === 0) return [from, to];

  const enter = nearestOnRoad(from, roads);
  const leave = nearestOnRoad(to, roads);
  if (!enter || !leave) return [from, to];

  // Same road at both ends: meet it, follow it, step off. The two entry points
  // are ordered along the road's long axis so the figure walks the road rather
  // than doubling back over it.
  const road = enter.road;
  const points = [from, enter.point, leave.point, to];

  if (enter.road === leave.road) {
    if (alongRoad(enter.point, leave.point, road) > 0) {
      points[1] = leave.point;
      points[2] = enter.point;
    }
  } else {
    // Different roads. The gap between them is bridged by the pair of points
    // that already come closest together, which for this geometry is the point
    // on each road nearest the other road's centre line.
    const bridge = closestPair(enter.road, leave.road);
    if (bridge) points.splice(2, 1, bridge.a, bridge.b);
  }

  return dedupe(points);
}

/** Where `p` sits relative to a road's own extent, used to order two points. */
function alongRoad(a: { x: number; y: number }, b: { x: number; y: number }, r: RoadLine): number {
  // Signed position along the line's own direction, so two points can be
  // ordered by which the figure reaches first.
  const len = Math.hypot(r.bx - r.ax, r.by - r.ay) || 1;
  const ux = (r.bx - r.ax) / len;
  const uy = (r.by - r.ay) / len;
  return (a.x - b.x) * ux + (a.y - b.y) * uy;
}

/** The point on whichever road is nearest to `p`, and which road that was. */
function nearestOnRoad(
  p: { x: number; y: number },
  roads: readonly RoadLine[],
): { point: { x: number; y: number }; road: RoadLine } | null {
  let best: { point: { x: number; y: number }; road: RoadLine } | null = null;
  let bestD = Infinity;
  for (const r of roads) {
    const q = nearestOnSegment(p, r);
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < bestD) {
      bestD = d;
      best = { point: q, road: r };
    }
  }
  return best;
}

/** The middle of a road's centre line. */
function centre(r: RoadLine): { x: number; y: number } {
  return { x: (r.ax + r.bx) / 2, y: (r.ay + r.by) / 2 };
}

/** The point on a road's centre line nearest to `p`, by projection onto it. */
function nearestOnSegment(p: { x: number; y: number }, r: RoadLine): { x: number; y: number } {
  const dx = r.bx - r.ax;
  const dy = r.by - r.ay;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 0) return { x: r.ax, y: r.ay };
  const t = clamp(((p.x - r.ax) * dx + (p.y - r.ay) * dy) / len2, 0, 1);
  return { x: r.ax + dx * t, y: r.ay + dy * t };
}

/** The closest pair of points, one on each road, for bridging a gap. */
function closestPair(
  a: RoadLine,
  b: RoadLine,
): { a: { x: number; y: number }; b: { x: number; y: number } } {
  // Each road's point nearest the other's middle, which for this geometry is
  // where a figure stepping off one would step onto the other.
  const pa = nearestOnSegment(centre(b), a);
  const pb = nearestOnSegment(centre(a), b);
  return { a: pa, b: pb };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Drops repeated and zero-length points, which a figure cannot walk. */
function dedupe(points: { x: number; y: number }[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.5) out.push(p);
  }
  return out.length >= 2 ? out : [points[0], points[points.length - 1]];
}

/**
 * A road as a line you can walk, in picture pixels.
 *
 * A road arrives from the layout as an axis-aligned rectangle in *world* space,
 * and the projection is isometric, so a rectangle does not project to a
 * rectangle. Taking the bounding box of its four projected corners would give a
 * parallelogram's box — which is larger than the road, and a figure routed onto
 * its corner would be standing on the grass beside the tarmac.
 *
 * So a road is reduced to what it is for: the line down its middle, with a width
 * so "am I on the road" can still be asked. The four corners are still projected
 * and averaged to find the centre, so the line lands where the road actually is
 * rather than where the un-projected rectangle was.
 */
export interface RoadLine {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Half the road's width in picture pixels. */
  halfWidth: number;
  /** The building paths this road runs between, importer first. Empty when the
   *  road is not an import road.
   *
   *  Sent rather than re-derived from the geometry: the two ends of the line
   *  are already ordered by the projection, and which of them is the importer is
   *  a fact only the analyzer knows (ADR-0012). */
}

/** The half-width of a band road, in *picture* pixels.
 *
 *  This is a picture-space constant, not the analyzer's 8 world units, and the
 *  two are deliberately not derived from one another: the world width goes
 *  through the projection to become a picture width, and how much depends on
 *  the road's direction — a band running along x projects shorter than the same
 *  band along y. Deriving it would make a road's width a function of which way
 *  it pointed, and "how wide is this road" is a property of the road.
 *
 *  4px half-width, floored at 3 by the caller: enough that "am I on the road"
 *  is a usable question at map scale, which is what worker routing needs and
 *  the only consumer of this number. */
const BAND_HALF_PX = 4;

/** The half-width of a band road, in *world* units.
 *
 *  The analyzer's `importBand` is 8 world units. This is the same fact on this
 *  side of the wire, written out rather than derived, for the same reason
 *  `BAND_HALF_PX` is: the browser may not re-derive geometry from the layout
 *  (ADR-0012), and a number that looks computed but is really a constant is
 *  one that will be computed differently somewhere else.
 *
 *  Only `paintRoads` uses this, to decide which ground tiles a band covers.
 *  Everything that draws in the picture uses `BAND_HALF_PX`. */
export const BAND_HALF_WORLD = 4;


/**
 * roadsAsLines projects a layout's roads into the picture.
 *
 * `project` is the same function the scene uses for everything else, supplied
 * rather than imported so this module stays free of the scene and the test
 * stays free of Phaser.
 */
export function roadsAsLines(
  // `kind` is accepted because every caller holds it, not because this function
  // reads it: a road kind with nowhere to be read would still be a field the
  // real payload has, and a parameter type that rejected it would push every
  // caller into a cast.
  roads: readonly {
    x: number;
    y: number;
    w: number;
    h: number;
    kind?: string;
  }[],
  project: (x: number, y: number) => { x: number; y: number },
): RoadLine[] {
  const out: RoadLine[] = [];
  for (const r of roads) {
    const x0 = r.x;
    const y0 = r.y;
    const x1 = r.x + r.w;
    const y1 = r.y + r.h;
    // The two ends of the road's long axis — which is the direction it runs.
    //
    // Both ends, not the centre and the far end. `a` has to be the road's
    // *near* end: everything downstream asks "is this point on the road", and a
    // segment covering only the second half of a road answers no about the
    // first half. Routing bent a worker's path onto whichever half happened to
    // be in the segment, which is not a road.
    //
    // The ends rather than the midpoints of the long edges, because the long
    // edges run along the axis and a midpoint of one sits at the road's centre
    // — which made the line's length a function of the road's *thickness*. A
    // hundred-unit street came out two pixels long, and a car placed on it
    // crawled rather than drove.
    const horizontal = r.w >= r.h;
    const start = horizontal ? project(x0, y0 + r.h / 2) : project(x0 + r.w / 2, y0);
    const end = horizontal ? project(x1, y0 + r.h / 2) : project(x0 + r.w / 2, y1);
    // Half the road's *thickness*, which is the short side. The long side is
    // how far the road runs, and dividing that by two gave a 122-unit street a
    // 61-pixel half-width: "am I on the road" was true almost everywhere, which
    // is the same long/short confusion that made the line itself two pixels long.
    out.push({ ax: start.x, ay: start.y, bx: end.x, by: end.y, halfWidth: Math.max(3, (horizontal ? r.h : r.w) / 2) });
  }
  return out;
}





