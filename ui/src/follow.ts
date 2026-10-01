// The follow camera: what zoom it sits at, as numbers.
//
// A follow camera is the only thing in this renderer that decides how close to
// look, and it has to decide it against a rule that is not negotiable — the
// isometric zoom is whole numbers between 1 and 4, because a fractional zoom
// makes some art pixels two screen pixels wide and their neighbours one
// (`TownScene.controls`). So the follow camera's freedom is not "how close may I
// zoom" but "where inside a fixed range do I sit while following".
//
// It is its own module because `view.ts` is pure geometry and holds no camera
// state at all: turn, projection, road routing, and no zoom, no scroll, no pan.
// A follow target is a camera decision, and this would be the first camera value
// that file had ever held.
//
// No Phaser import, deliberately, for the same reason `workers.ts` imports Phaser
// for its types only: a value import pulls the engine in, and the engine touches
// `window` while it is being imported, so a plain `node --test` process could not
// load this file and none of the rules below could be pinned by a test.

/** The lowest zoom the isometric town is drawn at. Below 1 the art is destroyed
 *  rather than more of it shown, which is why the wheel stops here too. */
export const ZOOM_MIN = 1;

/** The highest. Whole numbers at both ends: see the file comment. */
export const ZOOM_MAX = 4;

/**
 * The zoom a follow camera floors itself at.
 *
 * Three, not four. A machine cel is 32x22 pixels, so 4x is the clearest read of
 * the pose — and 3x is the closest zoom that still leaves a building's whole
 * plot and its district's name in frame. Following at 4 would be watching a
 * machine in an empty field, which is the same problem as following at 1 from
 * the other end: the town is what makes one action legible as work on a place.
 */
export const FOLLOW_ZOOM = 3;

/**
 * clampZoom holds a zoom inside the whole-number range the town is drawn at.
 *
 * The rounding is the point, not a convenience. Every caller used to clamp by
 * hand — the wheel handler and the isometric fit each spelled out
 * `Phaser.Math.Clamp(x, 1, 4)` — and both reached it by a route that happened to
 * be integral: the wheel steps by one, and the fit floors before clamping. A
 * third caller that did not would have put a half-width pixel on screen without
 * any of the three of them looking wrong. Stating the range once, with the
 * rounding attached, is what makes the rule a property of the module rather than
 * a coincidence of the call sites.
 */
export function clampZoom(zoom: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(zoom)));
}

/**
 * followZoom is the zoom to sit at while following: at least `FOLLOW_ZOOM`, and
 * never further out than the reader already was.
 *
 * `max` rather than an assignment, for the reason in the test: a reader who has
 * zoomed in deliberately is not asking to be pulled back out. The floor only
 * ever raises.
 *
 * Inlined at its one call site this would be `clampZoom(Math.max(cam.zoom,
 * FOLLOW_ZOOM))`, which is short enough to look like nothing — and the claim it
 * makes, that a follow can only ever move a reader *closer*, would then be
 * pinned by nothing at all. The scene needs Phaser to instantiate and a
 * `node --test` process cannot load it, so this name is the only place the
 * policy is written down and the only place a test can reach it.
 */
export function followZoom(current: number): number {
  return clampZoom(Math.max(current, FOLLOW_ZOOM));
}
