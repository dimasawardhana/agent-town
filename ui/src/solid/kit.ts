// The modelling kit: the operations every solid form is built from.
//
// **Everything here is a pure function of numbers, and nothing here knows what a
// building is.** The kit takes a footprint and a height and returns triangles.
// Which operations a building uses, in what order, and at which rank, is
// `solid/forms.ts`; turning the triangles into three.js is `solid/scene.ts`.
//
// **Every measurement is a fraction of the footprint.** That rule is the whole
// reason one form can serve all five sizes (ADR-0023 §2): a chamfer given in
// absolute world units distorts as the footprint goes from 44 to 100, and a
// `setBack` given as a fraction does not. It is a standing constraint on the kit —
// an operation that cannot be expressed footprint-relative cannot join it.
//
// Geometry is emitted as **non-indexed triangles**, one vertex per corner and no
// sharing between faces. That is not laziness: sharing vertices would average the
// normals across an edge and give smooth shading, and this town's look is flat —
// one tone per face, which is what the palette's ramps were built for (ADR-0026).

/** Foot is a rectangular plot, in world units, centred on its own position. */
export interface Foot {
  /** Centre, in world units. */
  readonly cx: number;
  readonly cy: number;
  /** Full width and depth, in world units. */
  readonly w: number;
  readonly d: number;
}

/** Triangles, as a flat run of xyz triples. Non-indexed, so 9 numbers per face. */
export interface SolidPart {
  readonly positions: readonly number[];
}

/** Push two triangles for a quad given in counter-clockwise order from outside. */
function quad(out: number[], a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[]): void {
  out.push(...a, ...b, ...c, ...a, ...c, ...d);
}

/** Push one triangle, counter-clockwise from outside. */
function tri(out: number[], a: readonly number[], b: readonly number[], c: readonly number[]): void {
  out.push(...a, ...b, ...c);
}

/**
 * inset shrinks a plot by a fraction of its own size.
 *
 * The fraction is of the **smaller** side, so a narrow plot and a wide one step
 * in by the same amount in world units rather than the wide one stepping in much
 * further. A per-side fraction would make a long thin building nearly vanish at
 * its own set-back.
 */
export function inset(foot: Foot, fraction: number): Foot {
  const step = Math.min(foot.w, foot.d) * fraction;
  return {
    cx: foot.cx,
    cy: foot.cy,
    w: Math.max(1e-3, foot.w - step * 2),
    d: Math.max(1e-3, foot.d - step * 2),
  };
}

/**
 * extrude raises a plot from `z0` to `z1` as a closed rectangular prism.
 *
 * The base operation, and the only one that is not a variation on another: it
 * produces the four walls, the top and the bottom. `z1` above `z0` is the
 * caller's business — this does not reorder them, because a caller that swapped
 * them has a bug worth seeing rather than a prism silently turned inside out.
 */
export function extrude(foot: Foot, z0: number, z1: number): SolidPart {
  const { cx, cy, w, d } = foot;
  const x0 = cx - w / 2, x1 = cx + w / 2;
  const y0 = cy - d / 2, y1 = cy + d / 2;
  const p: number[] = [];

  const A = [x0, y0, z0], B = [x1, y0, z0], C = [x1, y1, z0], D = [x0, y1, z0];
  const E = [x0, y0, z1], F = [x1, y0, z1], G = [x1, y1, z1], H = [x0, y1, z1];

  quad(p, A, D, C, B); // bottom, seen from below
  quad(p, E, F, G, H); // top
  quad(p, A, B, F, E); // -y wall
  quad(p, B, C, G, F); // +x wall
  quad(p, C, D, H, G); // +y wall
  quad(p, D, A, E, H); // -x wall
  return { positions: p };
}

/**
 * setBack extrudes a plot that steps inwards as it rises.
 *
 * The operation that makes a mass read as a building rather than a box: the eye
 * reads the step as a shoulder, and each face of the step catches the sun at a
 * different angle from the wall below it. `fraction` is of the plot's own smaller
 * side, through `inset`.
 *
 * `z0` is the level the step starts at, so a caller can stack them — a tower with
 * two shoulders is two `setBack`s, not a new operation.
 */
export function setBack(foot: Foot, z0: number, z1: number, fraction: number): SolidPart {
  return extrude(inset(foot, fraction), z0, z1);
}

/**
 * band is a thin horizontal course around a plot — a plinth, a cornice, a sill.
 *
 * Not one of the eight named operations; it is `extrude` with a shallow height,
 * and it exists as a name because three callers need it and "a short extrude
 * sticking out slightly" is a shape that reads wrong when the numbers are typed
 * out at each of them.
 */
export function band(foot: Foot, z0: number, z1: number, overhang: number): SolidPart {
  return extrude({ ...foot, w: foot.w + overhang * 2, d: foot.d + overhang * 2 }, z0, z1);
}

/**
 * merge concatenates parts into one.
 *
 * Positions only, because there are no indices to offset — the non-indexed form
 * pays for flat shading by making a merge a plain concatenation.
 */
export function merge(parts: readonly SolidPart[]): SolidPart {
  const positions: number[] = [];
  for (const part of parts) positions.push(...part.positions);
  return { positions };
}

/**
 * lift moves a part vertically, the only axis a part is ever moved on.
 *
 * It does not translate in x or y and does not take a vector: every part is built
 * where it belongs in plan, so the only way one is ever out of place is in height.
 * A general translation would be a way to build geometry in the wrong plot, which
 * is the mistake this signature makes unavailable.
 */
export function lift(part: SolidPart, dz: number): SolidPart {
  const positions = part.positions.slice();
  for (let i = 2; i < positions.length; i += 3) positions[i] += dz;
  return { positions };
}

/**
 * gable is a pitched roof over a plot, ridged along x.
 *
 * The spike's one cap shape. `ridge` is how high the peak sits above the eave, as
 * a fraction of the plot's smaller side — so a wide low roof and a narrow tall one
 * are the same operation with different numbers rather than two shapes.
 *
 * A gable rather than the eight-operation `profile sweep` (ADR-0023 §1): the sweep
 * carries the Chapel, the Stadium and the Library, and it arrives with the kit in
 * Phase 1. A pyramid would have been one operation cheaper and would not have the
 * ridge line that makes a roof read as a roof.
 */
export function gable(foot: Foot, zEave: number, ridge: number): SolidPart {
  const { cx, cy, w, d } = foot;
  const x0 = cx - w / 2, x1 = cx + w / 2;
  const y0 = cy - d / 2, y1 = cy + d / 2;
  const yMid = cy;
  const zTop = zEave + Math.min(w, d) * ridge;
  const p: number[] = [];

  const A = [x0, y0, zEave], B = [x1, y0, zEave], C = [x1, y1, zEave], D = [x0, y1, zEave];
  const R0 = [x0, yMid, zTop], R1 = [x1, yMid, zTop];

  quad(p, A, B, R1, R0); // the near slope
  quad(p, C, D, R0, R1); // the far slope
  tri(p, A, R0, D); // the -x gable end
  tri(p, B, C, R1); // the +x gable end
  quad(p, A, D, C, B); // the underside, so the roof is closed
  return { positions: p };
}
/** A footprint-relative 2D section, ordered around its outside boundary. */
export interface SweepProfilePoint {
  readonly across: number;
  readonly height: number;
}

/**
 * sweep carries a normalized profile across the footprint's depth.
 *
 * `across` is measured from -0.5 to 0.5 of the footprint width and `height`
 * is measured from the eave as a fraction of the footprint's shorter side.
 */
export function sweep(
  foot: Foot,
  zEave: number,
  profile: readonly SweepProfilePoint[],
): SolidPart {
  const short = Math.min(foot.w, foot.d);
  if (profile.length < 3) throw new RangeError("sweep profile needs at least three points");
  for (const point of profile) {
    if (!Number.isFinite(point.across) || !Number.isFinite(point.height)) {
      throw new RangeError("sweep profile must be finite");
    }
    if (point.across < -0.5 || point.across > 0.5 || point.height < 0) {
      throw new RangeError("sweep profile must be footprint-relative");
    }
  }
  const p: number[] = [];
  const near = profile.map(({ across, height }) => [
    foot.cx + across * foot.w,
    foot.cy - foot.d / 2,
    zEave + height * short,
  ]);
  const far = profile.map(({ across, height }) => [
    foot.cx + across * foot.w,
    foot.cy + foot.d / 2,
    zEave + height * short,
  ]);
  for (let i = 0; i < profile.length; i += 1) {
    const next = (i + 1) % profile.length;
    quad(p, near[i], near[next], far[next], far[i]);
  }
  const first = near[0];
  for (let i = 1; i < profile.length - 1; i += 1) tri(p, first, near[i + 1], near[i]);
  const farFirst = far[0];
  for (let i = 1; i < profile.length - 1; i += 1) tri(p, farFirst, far[i], far[i + 1]);
  return { positions: p };
}
/** chamfer clips each corner by a fraction of the shorter footprint side. */
export function chamfer(foot: Foot, z0: number, z1: number, fraction: number): SolidPart {
  const cut = Math.min(foot.w, foot.d) * fraction;
  const x0 = foot.cx - foot.w / 2, x1 = foot.cx + foot.w / 2;
  const y0 = foot.cy - foot.d / 2, y1 = foot.cy + foot.d / 2;
  const outline = [
    [x0 + cut, y0], [x1 - cut, y0], [x1, y0 + cut], [x1, y1 - cut],
    [x1 - cut, y1], [x0 + cut, y1], [x0, y1 - cut], [x0, y0 + cut],
  ];
  const p: number[] = [];
  const bottom = outline.map(([x, y]) => [x, y, z0]);
  const top = outline.map(([x, y]) => [x, y, z1]);
  for (let i = 0; i < outline.length; i += 1) {
    const next = (i + 1) % outline.length;
    quad(p, bottom[i], bottom[next], top[next], top[i]);
  }
  for (let i = 1; i < outline.length - 1; i += 1) {
    tri(p, bottom[0], bottom[i + 1], bottom[i]);
    tri(p, top[0], top[i], top[i + 1]);
  }
  return { positions: p };
}

/** windowReveal is a shallow recessed opening-sized solid on a wall. */
export function windowReveal(foot: Foot, z0: number, z1: number, fraction: number): SolidPart {
  const side = inset(foot, fraction);
  return extrude({ cx: side.cx, cy: side.cy + side.d / 2, w: side.w * 0.2, d: Math.min(side.w, side.d) * fraction, }, z0, z1);
}

/** roofOverhang expands a gabled cap by a footprint-relative rim. */
export function roofOverhang(foot: Foot, zEave: number, ridge: number, fraction: number): SolidPart {
  const overhang = Math.min(foot.w, foot.d) * fraction;
  return gable({ ...foot, w: foot.w + overhang * 2, d: foot.d + overhang * 2 }, zEave, ridge);
}

/** parapet is the low closed rim around a flat roof. */
export function parapet(foot: Foot, z0: number, z1: number, fraction: number): SolidPart {
  return band(foot, z0, z1, Math.min(foot.w, foot.d) * fraction);
}

/** canopy is a projecting closed slab, sized from the footprint. */
export function canopy(foot: Foot, z0: number, z1: number, fraction: number): SolidPart {
  const overhang = Math.min(foot.w, foot.d) * fraction;
  return extrude({ ...foot, w: foot.w + overhang * 2, d: foot.d + overhang * 2 }, z0, z1);
}
