// Kerbs: the hard edge that says where one section ends.
//
// The ground already carries a soft boundary — `terrain.ts` draws a dithered
// band and a lip where one kind of ground meets another. That is the right
// treatment for a *material* change, and it is not enough to say where a
// section is. A dithered band on dark earth is a change of texture a reader has
// to hunt for, and at the fitted zoom, where a whole district is ninety pixels
// across, "hunt for" means "do not see".
//
// So every section also gets a kerb: a hard ring of pixels around its own
// footprint, with a dark outer line and a bright inner one. Two properties make
// it work where the dithered band cannot:
//
//   - It is a *ring*, not a set of per-tile edges. Per-tile pieces have to make
//     a corner decision at every tile, and a corner is exactly where a tiled
//     edge system draws its most visible mistake. Walking the region's own
//     outline has no corners to get wrong.
//   - The bright ring is inside the dark one, so the section reads as a shape
//     even where its ground is the same value as the ground outside it. The dark
//     ring alone would vanish on the void; the bright ring alone would have no
//     edge.
//
// Geometry: a world rectangle projects to a diamond, and its outline is walked
// in *world* units so the 2:1 stair is exact rather than approximated — the same
// reason `IsoPix` plots instead of filling paths. The rings are produced by
// insetting the world rectangle, and one ring of inset is two world units,
// because two units along x move half a picture pixel. That is what makes a
// three-pixel kerb exactly three pixels wide everywhere instead of three on the
// shallow edges and two on the steep ones.

import { P } from "./palette";

/** One horizontal run of kerb pixels, already merged. The scene fills these
 *  with one `fillRect` each rather than one per pixel: a 420-unit Yard's
 *  outline is about two thousand pixels, and two thousand fill calls per
 *  section is a load-time cost for nothing. */
export interface KerbRun {
  x: number;
  y: number;
  w: number;
  /** The ring this run belongs to, outermost first. */
  ring: number;
}

/** A kerb's colour per ring, outermost first. */
export interface KerbStyle {
  /** The dark line that separates the section from the ground outside it. */
  outer: string;
  /** The bright line inside, which is the part that actually reads as an edge
   *  on ground of a similar value. */
  inner: string;
}

/**
 * The two kerbs the town draws.
 *
 * A district gets dressed stone, and a place gets the warm accent. The
 * distinction is deliberate: the three special places are the sections the
 * legend explains and the ones holding most of a session's work, so they take
 * the one warm hue in the palette that is already used for live state — and a
 * reader who has learnt "warm yellow means this is live" reads the places as
 * live without being told twice.
 */
export const KERB = {
  district: { outer: P.ink, inner: P.stone[2] },
  place: { outer: P.ink, inner: P.accentDim },
} as const;

/**
 * The projection, restated.
 *
 * `scene.ts` and `iso.ts` each own a copy of this formula and a test asserts the
 * three agree, because a fourth layer that imported one of them would make the
 * ground painting depend on the art layer or the art layer on Phaser. Restating
 * it here keeps this module a pure function of world coordinates that a test can
 * call without a canvas.
 */
function project(wx: number, wy: number): { x: number; y: number } {
  return { x: (wx - wy) / 2, y: (wx + wy) / 4 };
}

/**
 * ringRuns walks one rectangle's outline and returns its pixels, merged into
 * horizontal runs.
 *
 * The outline is walked in world units along each edge, rounding each projected
 * point. Rounding per unit rather than interpolating between corners is what
 * makes the stair-step exact: two adjacent world points either land on the same
 * pixel (producing a run of length two) or on adjacent ones, and never leave a
 * gap, which is the same guarantee `IsoPix.plot` gives.
 */
function ringRuns(
  x: number,
  y: number,
  w: number,
  h: number,
  ring: number,
  out: Map<number, number[]>,
): void {
  const add = (wx: number, wy: number): void => {
    const p = project(wx, wy);
    const px = Math.round(p.x);
    const py = Math.round(p.y);
    const row = out.get(py);
    if (row) row.push(px);
    else out.set(py, [px]);
  };

  // The four edges, each inclusive of its start and exclusive of its end so the
  // corners are written once rather than four times — which matters only for
  // cost, but a pixel written four times is also four chances to disagree.
  for (let i = 0; i < w; i++) add(x + i, y);
  for (let i = 0; i < h; i++) add(x + w, y + i);
  for (let i = 0; i < w; i++) add(x + w - i, y + h);
  for (let i = 0; i < h; i++) add(x, y + h - i);

  // The ring tag is attached to the runs below rather than to the pixels, so
  // the caller can colour a whole ring at once.
  void ring;
}

/**
 * kerbRuns returns the pixel runs of a section's kerb, in picture coordinates
 * with the origin at the projection of world (0, 0).
 *
 * Rings are produced by insetting the world rectangle by two units per ring,
 * for the reason in the module comment: two world units is one picture pixel
 * perpendicular to the edge, so a ring is exactly as wide as it looks.
 *
 * A rectangle too small to inset as many times as asked is inset as far as it
 * goes and no further. A three-ring kerb on a twelve-unit box would otherwise
 * cross itself in the middle and draw a bright X through the section.
 */
export function kerbRuns(
  x: number,
  y: number,
  w: number,
  h: number,
  style: KerbStyle,
  rings = 2,
): { run: KerbRun; colour: string }[] {
  const out: { run: KerbRun; colour: string }[] = [];
  for (let ring = 0; ring < rings; ring++) {
    const inset = ring * 2;
    const rw = w - inset * 2;
    const rh = h - inset * 2;
    if (rw < 4 || rh < 4) break;

    const rows = new Map<number, number[]>();
    ringRuns(x + inset, y + inset, rw, rh, ring, rows);

    const colour = ring === 0 ? style.outer : style.inner;
    for (const [py, xs] of rows) {
      xs.sort((a, b) => a - b);
      let start = xs[0];
      let prev = xs[0];
      for (let i = 1; i <= xs.length; i++) {
        const v = xs[i];
        if (v === prev + 1) {
          prev = v;
          continue;
        }
        out.push({ run: { x: start, y: py, w: prev - start + 1, ring }, colour });
        start = v;
        prev = v;
      }
    }
  }
  return out;
}
