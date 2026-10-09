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
import { towerReach } from "./forms";

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

/** Convert normalized device coordinates into CSS pixels for a DOM overlay. */
export function screenPosition(point: Projected, width: number, height: number): { x: number; y: number } {
  return { x: (point.x + 1) * width / 2, y: (1 - point.y) * height / 2 };
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

/**
 * townReach is the highest a building in this town reaches, in world units.
 *
 * The companion to `worldExtent`, and the number the ground's own footprint cannot
 * supply: a town 1200 units across may hold a 20-storey tower or nothing but
 * sheds, and the camera has to clear whatever is tallest. Read from the sites
 * alone, because a district has no height of its own — the field and the plates
 * are flat, and the buildings are the only thing that rises.
 *
 * Measured on the town this was written against: 20 storeys at 20 units each is
 * 400 units of wall plus a roof, so the tallest building reaches 435 — while the
 * ground-fitted camera's half-height was 362 picture units. The tower's cap and
 * cornice fell outside the frustum and drew **zero** pixels from every angle. It
 * was `building:ui`, the project with the most files in the town, and a reader
 * whose largest project is missing from the view is the failure the spike exists
 * to rule out.
 */
export function townReach(l: Layout): number {
  let tallest = 0;
  for (const s of l.sites) {
    if (s.kind !== "building") continue;
    const reach = towerReach(s);
    if (reach > tallest) tallest = reach;
  }
  return tallest;
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
   * The frustum's `top` and `bottom`, which are **negative and positive** — the
   * one place the camera's handedness is decided.
   *
   * An orthographic camera applies its frustum in *camera* space, where `y` is
   * `up`. `CAMERA_UP` orients the camera so that world `-z` is up, but orientation
   * is not handedness: whether camera `y` runs with or against `top` is a second,
   * independent choice, and making it the conventional way (positive `top`) draws
   * the entire town mirrored — `+x` right and up, `+y` up, and `+z` **down**, so
   * buildings grow downward and a turn reads as a flip.
   *
   * So this is a rule, not a convention, and it is asserted in `solid.test.ts`
   * rather than left to `scene.ts`: a decision that lives in the scene module has
   * escaped its tests, which is that module's whole contract. Measured before the
   * fix: raising a point 100 units moved it 100 units down.
   */
  halfTop: number;
  halfBottom: number;
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
  maxZ = 0,
): Framing {
  // The extent's corners in picture space, through the pinned projection. A
  // dimetric town does not have an axis-aligned picture box, so all four corners
  // are projected rather than two — the same mistake `screenBox` records as
  // having cost 353 pixels of lost land.
  //
  // **Every corner is projected at both the ground and the tallest reach, and that
  // pair is the fix for a real crop.** The town's footprint says nothing about its
  // height, and a 20-storey building is 400 world units of tower — so a fit taken
  // from the ground alone put the tallest building in this town outside the frustum
  // entirely, and its meshes drew **zero** pixels from every camera angle. Adding
  // the raised corners is conservative rather than exact: the top of a corner's
  // tower is scored even where there is no tower, which can only add margin. A fit
  // that is slightly too tall leaves empty frame; one that is slightly too short
  // deletes a roof, and the second is not recoverable by looking at the screen.
  const corners = [
    project(extent.minX, extent.minY),
    project(extent.maxX, extent.minY),
    project(extent.minX, extent.maxY),
    project(extent.maxX, extent.maxY),
  ];
  const raised = maxZ > 0
    ? corners.map((c) => ({ x: c.x, y: c.y - maxZ }))
    : [];
  const all = [...corners, ...raised];
  const picW = Math.max(1e-6, Math.max(...all.map((c) => c.x)) - Math.min(...all.map((c) => c.x)));
  const picH = Math.max(1e-6, Math.max(...all.map((c) => c.y)) - Math.min(...all.map((c) => c.y)));

  // Screen pixels per picture unit, so the town fills the viewport less the pad.
  //
  // **`zoom` multiplies, because more pixels per picture unit *is* zooming in.**
  // Dividing here was the first version's error: it made `zoom = 2` show more of
  // the town rather than less, and the fit tests caught it only because they
  // assert the direction rather than a magnitude.
  //
  // that used to be here contradicted it.** The floor was carried over from the
  // flat fit, where whole-number zoom keeps art pixels square; there are no art
  // pixels here, and the comment claiming the rule was dropped was written over an
  // implementation that still applied it.
  //
  // It stopped being cosmetic the moment height entered the extent. A fit whose
  // picture is a hair taller than the viewport floors to **zero**, and `max(1e-6,
  // 0)` is not a small frustum — it is a frustum ten to the sixth times too large,
  // so the whole town renders as a sub-pixel speck. Measured: `camera.top` went from
  // 362 to 362038672, and every mesh in the scene reported zero drawn pixels. A
  // continuous scale degrades gracefully here instead: slightly over-size content
  // gets a slightly smaller scale, not a collapsed camera.
  const scale = Math.max(
    1e-6,
    Math.min(
      (viewportWidth - FIT_PAD * 2) / picW,
      (viewportHeight - FIT_PAD * 2) / picH,
    ) * zoom,
  );

  // **Aimed by inverting the projection, not by centring the ground.**
  //
  // The camera's target is what the frustum is centred on, so the target must
  // project to the centre of the picture box this function just measured — and
  // that box is not the ground's once height is in it. Centring the *ground*
  // instead is the subtle version of the bug above: it leaves the roof inside the
  // fit's arithmetic and outside the actual viewport, which the test caught as a
  // corner escaping by 202 pixels.
  //
  // So this inverts `project` at `z = 0`: given the picture centre `(pcx, pcy)`,
  // the world point that lands there is `(pcx + 2·pcy, -pcx + 2·pcy)`, because
  // `project` sends `(wx, wy)` to `((wx - wy)/2, (wx + wy)/4)`. The camera's own z
  // is free under an orthographic projection, so leaving the target on the ground
  // costs nothing and keeps this the exact inverse.
  const pcx = (Math.min(...all.map((c) => c.x)) + Math.max(...all.map((c) => c.x))) / 2;
  const pcy = (Math.min(...all.map((c) => c.y)) + Math.max(...all.map((c) => c.y))) / 2;
  const target = [pcx + 2 * pcy, -pcx + 2 * pcy, 0];

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
    // **Negated on purpose** — see `halfTop`. This is the handedness of the
    // picture, and every vertical direction in the town depends on it.
    halfTop: -((viewportHeight * AXIS.y) / scale),
    halfBottom: (viewportHeight * AXIS.y) / scale,
    scale,
  };
}

/** FOLLOW_SCALE is the scale a follow camera insists on, in screen px per picture unit. */
export const FOLLOW_SCALE = 3;

/**
 * followScale is the scale a follow frame uses: never narrower than the fit.
 *
 * **A follow never widens.** The followed machine is a few dozen picture units
 * wide, which is roughly thirty screen pixels at the fitted view — too small to
 * read a cab from a boom from a set of tracks. So a follow insists on
 * `FOLLOW_SCALE`, and where the reader has already zoomed past that, their zoom
 * wins: `Math.max`, not an override.
 *
 * The flat town's follow clamps to whole numbers and a `[1, 4]` range, and that
 * rule is deliberately **not** inherited here. It exists because a fractional
 * scale puts some art pixels on one screen pixel and their neighbours on two —
 * a property of a pixel rasteriser, and there is no art in the solid town, only
 * geometry that antialiases. What is inherited is the rule behind it: the reader's
 * zoom outlives the follow that interrupted it.
 */
export function followScale(current: number): number {
  return Math.max(current, FOLLOW_SCALE);
}

/**
 * followFraming frames one world point, the follow camera's whole fit.
 *
 * The point is a walker's own `group.position` — already carrying its ground
 * height as `z` — and it must land at the **centre** of the screen, because a
 * follow that drifts is a follow lying about what it watches. So the frustum is
 * built backwards from the scale `followScale` chose: half the viewport over the
 * scale on each axis, through the same `AXIS` factors `framingFor` uses, with
 * the same `CAMERA_BASIS` and the same negative `halfTop`. The last is not a
 * detail: `halfTop` negative is the handedness of the picture, recorded in
 * `Framing` and asserted in `solid.test.ts`, and a follow that flipped it would
 * draw the town mirrored around the followed machine.
 *
 * Unlike `framingFor`, there is no pad and no extent: the machine is the frame.
 */
export function followFraming(
  point: readonly [number, number, number],
  viewportWidth: number,
  viewportHeight: number,
  scale: number,
): Framing {
  const target: readonly number[] = [point[0], point[1], point[2]];
  return {
    target,
    position: [
      target[0] + CAMERA_BASIS.z[0] * 1000,
      target[1] + CAMERA_BASIS.z[1] * 1000,
      target[2] + CAMERA_BASIS.z[2] * 1000,
    ],
    up: CAMERA_UP,
    halfWidth: (viewportWidth * AXIS.x) / scale,
    halfHeight: (viewportHeight * AXIS.y) / scale,
    halfTop: -((viewportHeight * AXIS.y) / scale),
    halfBottom: (viewportHeight * AXIS.y) / scale,
    scale,
  };
}

