// The solid town's decisions, with no renderer in them.
//
// **This is the seam the whole feature is tested at.** Every decision the solid
// town makes lives here as a pure function of the layout the daemon sent, so it
// can be asserted in `node --test` with no browser, no WebGL and no scene. The
// module above it (`solid/scene.ts`) translates these numbers into three.js
// objects and decides nothing; if a decision appears there instead of here, it
// has escaped its tests.
//
// It imports **nothing** — not three.js, and nothing from `ui/src/art/`. The
// flat renderer is frozen (ADR-0024), and its art pipeline is not reusable here
// for the reason ADR-0023 records: `IsoPix` plots pixels with 1px ink and three
// shades per face, and re-targeting it would return extruded boxes rather than
// modelled buildings.
//
// The one thing this module deliberately *duplicates* is the projection, and
// that is the project's own established pattern rather than an oversight.
// `view.ts` and `art/iso.ts` each restate it, and `art.test.ts` asserts the
// copies agree, because a module that must be testable without a renderer cannot
// import one. This is the third copy and it is pinned the same way.

import type { Layout, Site } from "../store";

/** A projected point, in picture units. */
export interface Projected {
  x: number;
  y: number;
}

/**
 * project maps a world point to a picture point.
 *
 * **The same formula as `WorldView.project` and `IsoPix.project`, restated.**
 * `(wx - wy) / 2` across, `(wx + wy) / 4 - z` down: a 2:1 dimetric projection in
 * which one world step maps to half a picture unit horizontally and a quarter
 * vertically, and `z` moves straight up the picture by one unit per world unit.
 *
 * Getting this wrong is not a cosmetic failure. A reader flipping between the
 * two renderers has spatial memory of one town, and a solid town projected even
 * slightly differently would put the same building somewhere else — which is the
 * failure `solid.test.ts` exists to catch.
 */
export function project(wx: number, wy: number, z = 0): Projected {
  return { x: (wx - wy) / 2, y: (wx + wy) / 4 - z };
}

/** Which renderer draws the town. */
export type Renderer = "flat" | "solid";

/** Every renderer, in the order the control steps through them. */
export const RENDERERS: readonly Renderer[] = ["flat", "solid"];

/** isRenderer guards a value that came from outside the program. */
export function isRenderer(v: unknown): v is Renderer {
  return v === "flat" || v === "solid";
}

/**
 * The camera basis that realises `project` through three.js.
 *
 * **Solved from the projection rather than chosen, and that is the whole point.**
 * An orthographic camera's screen axes are two vectors `x` and `y`; a world point
 * `p` lands at `(p·x, p·y)` before the frustum scales it. So the projection above
 * is realised exactly when `x ∝ (1, -1, 0)` and `y ∝ (1, 1, -4)` — the second
 * because `(wx + wy) / 4 - z` is `(wx + wy - 4z) / 4`.
 *
 * The two are orthogonal (`0.5·0.25 + (-0.5)·0.25 + 0·(-1) = 0`), which is what
 * makes this realisable by a camera at all; they are **not** the same length,
 * which is what makes the projection 2:1 dimetric rather than true isometric.
 * That length difference is not corrected here — it is compensated by the
 * frustum, in `framingFor`, because a camera's two screen axes are scaled
 * independently by its width and height.
 *
 * Returned as plain numbers rather than three.js vectors so this module stays
 * importable by a test with no renderer in it.
 */
export const CAMERA_BASIS: { x: readonly number[]; y: readonly number[]; z: readonly number[] } =
  (() => {
    const norm = (v: number[]): number[] => {
      const m = Math.hypot(v[0], v[1], v[2]);
      return [v[0] / m, v[1] / m, v[2] / m];
    };
    const cross = (a: readonly number[], b: readonly number[]): number[] => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    const run = norm([1 / 2, -1 / 2, 0]);
    const rise = norm([1 / 4, 1 / 4, -1]);
    // `z` is the axis the camera sits *out* along: three.js builds its view from
    // `z = normalize(position - target)`, then `x = up × z` and `y = z × x`.
    const out = norm(cross(run, rise));
    return { x: run, y: rise, z: out };
  })();

/**
 * What each frustum half-extent must be multiplied by, per viewport unit.
 *
 * **Derived from the basis rather than guessed, and the derivation is the
 * comment because the first version of this was wrong in a way that looked
 * right.** A world step of one along x must move the *picture* by `1/2`
 * horizontally and `1/4` vertically — that is what `project` says — and the
 * camera must move the *screen* by one common `scale` times those amounts.
 *
 * Along the camera's x axis, a world x step changes `p · bx` by `bx[0]`, and the
 * screen by `bx[0] · viewportWidth / (2 · halfWidth)`. Setting that equal to
 * `scale / 2` gives `halfWidth = viewportWidth · bx[0] / scale`.
 *
 * Along the camera's y axis the same step changes `p · by` by `by[0]` — the same
 * number, because the basis' two vectors differ only in their z component — but
 * the picture only moves `1/4`, so the factor is `by[0] / (1/4)` rather than
 * `by[0] / (1/2)`. That doubling is the whole content of this constant, and
 * omitting it is what made the first version render a 1:1 picture instead of
 * 2:1 while every other assertion still passed.
 */
export const AXIS: { x: number; y: number } = {
  x: CAMERA_BASIS.x[0],
  y: 2 * CAMERA_BASIS.y[0],
};

/** The camera up vector that yields `CAMERA_BASIS.x`, which is world -z. */
export const CAMERA_UP: readonly number[] = [0, 0, -1];

/** A world-space rectangle, in world units. */
export interface WorldExtent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * worldExtent is the ground the town actually occupies, in world units.
 *
 * Measured over the sites **and** the districts, not over `Layout.width` and
 * `Layout.height`: the same reasoning `worldBounds` and `planBox` already record,
 * which is that a layout narrower than its own districts would frame the town
 * short and cut off the edge of a district. The field that gets drawn is a
 * separate decision (a later ticket sizes the ground from the layout's own
 * extent); this is only what the camera must contain.
 */
export function worldExtent(l: Layout): WorldExtent {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x: number, y: number, w: number, h: number): void => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
  };
  for (const s of l.sites) add(s.x, s.y, s.w, s.h);
  for (const d of l.districts) add(d.x, d.y, d.w, d.h);
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/** Where the camera sits and what it must contain, in three.js terms. */
export interface Framing {
  /** The world point the camera is aimed at. */
  target: readonly number[];
  /** The camera's own position — `target` pushed out along the basis' z axis. */
  position: readonly number[];
  up: readonly number[];
  /** Half the frustum's width and height, in the camera's own units. */
  halfWidth: number;
  halfHeight: number;
  /**
   * Screen pixels per picture unit, after the fit.
   *
   * Returned rather than private because it is the one number that ties the
   * frustum back to `project`, and the tests assert the tie directly: a world
   * step of one must land `scale / 2` pixels away horizontally and
   * `scale / 4` vertically, whatever the viewport.
   */
  scale: number;
}

/** How much empty frame to leave around the town, in picture units. */
export const FIT_PAD = 40;

/**
 * framingFor frames an extent in a viewport, reproducing the flat town's fit.
 *
 * The flat isometric fit floors its zoom to whole numbers and clamps it to
 * `[1, 4]`, and **the solid town does not inherit that rule.** The rule exists
 * because a fractional scale puts some world steps on one pixel and their
 * neighbours on two — a property of a pixel rasteriser, and there is none here.
 * What is inherited is the reason behind it, which is that the whole town must
 * be in the frame; `zoom` stays continuous and only the clamp survives.
 *
 * The padding differs by axis on purpose, mirroring the flat fit's `- 60` and
 * `- 100`: the town is wider than it is deep on screen, so an equal pad would
 * crop the near edge.
 */
export function framingFor(
  extent: WorldExtent,
  viewportWidth: number,
  viewportHeight: number,
  zoom = 1,
): Framing {
  // The extent's corners in picture space, through the pinned projection. A
  // dimetric town does not have an axis-aligned picture box, so all four corners
  // are projected rather than two — the same mistake `screenBox` records as
  // having cost 353 pixels of lost land.
  const corners = [
    project(extent.minX, extent.minY),
    project(extent.maxX, extent.minY),
    project(extent.minX, extent.maxY),
    project(extent.maxX, extent.maxY),
  ];
  const picW = Math.max(1e-6, Math.max(...corners.map((c) => c.x)) - Math.min(...corners.map((c) => c.x)));
  const picH = Math.max(1e-6, Math.max(...corners.map((c) => c.y)) - Math.min(...corners.map((c) => c.y)));

  // Screen pixels per picture unit, so the town fills the viewport less the pad.
  //
  // **`zoom` multiplies, because more pixels per picture unit *is* zooming in.**
  // Dividing here was the first version's error: it made `zoom = 2` show more of
  // the town rather than less, and the fit tests caught it only because they
  // assert the direction rather than a magnitude.
  //
  // **Floored is safe and rounding is not.** A fit that overflows the viewport
  // has cropped the town; a fit that underfills it has only left margin. So the
  // scale steps down rather than to nearest, on the same reasoning as the flat
  // fit's `Math.floor`. The lower bound keeps it off zero for a degenerate
  // extent, where an infinite frustum would render nothing at all.
  const scale = Math.max(
    1e-6,
    Math.floor(
      Math.min(
        (viewportWidth - FIT_PAD * 2) / picW,
        (viewportHeight - FIT_PAD * 2) / picH,
      ) * zoom,
    ),
  );

  const target = [(extent.minX + extent.maxX) / 2, (extent.minY + extent.maxY) / 2, 0];
  return {
    target,
    // Pushed out along the basis' own z axis. The distance is arbitrary under an
    // orthographic camera — nothing foreshortens — so it is a constant chosen to
    // clear the near plane rather than a fit.
    position: [
      target[0] + CAMERA_BASIS.z[0] * 1000,
      target[1] + CAMERA_BASIS.z[1] * 1000,
      target[2] + CAMERA_BASIS.z[2] * 1000,
    ],
    up: CAMERA_UP,
    halfWidth: (viewportWidth * AXIS.x) / scale,
    halfHeight: (viewportHeight * AXIS.y) / scale,
    scale,
  };
}

