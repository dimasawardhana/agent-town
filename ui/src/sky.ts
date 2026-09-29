// The sky the town sits in.
//
// The land was a diamond on a flat void, which read as *unfinished* rather than
// as bounded. Some of that void is information — a region reads as a region
// partly because nothing surrounds it — so this does not fill it in. It puts a
// horizon *behind* the island and leaves the water-line, or whatever is there,
// still empty. The island keeps its edge.
//
// Nothing here is baked. The whole sheet is a power of two on every axis and
// every cel in it is paid for by the whole town, so a background that spent cels
// would have to be paid for out of archetypes. Generated, it costs nothing —
// the same reason the ember is a texture rather than a cel.
//
// **No `Math.random()`.** Every pixel here is a function of its own position, so
// two clients drawing the same town draw the same sky, and a re-bake cannot
// rearrange the treeline under a reader who is looking at it.

import Phaser from "phaser";
import { P } from "./art/palette";

const SKY_TEX = "sky";
export const SKY_DEPTH = -1_000_000;

/**
 * Horizon as a fraction of the image height.
 *
 * There is deliberately no horizon constant. It was `0.6`, and moving it up and
 * down traded one diorama for another; the answer was that the horizon itself was
 * the problem. Exported as `null` so the test that pinned the composition has
 * something honest to assert about.
 */
export const HORIZON_FRACTION: number | null = null;

/**
 * skyTexture paints the backdrop, once, at a size the camera can pan within.
 *
 * Sized to the view with margin rather than to the world, because the sky has no
 * business knowing where the town is: it is the same sky over every region, and
 * a sky that moved with the camera would be a lie about the world's size.
 */
/**
 * paintBackdrop draws the whole backdrop into any 2D-ish context.
 *
 * Split out of `skyTexture` so a test can render it and *look at the pixels*
 * rather than at the palette. The previous test asserted a delta between two
 * constants and never touched the canvas, which is how a backdrop that painted
 * no vignette at all passed as one that did.
 */
export function paintBackdrop(g: BackdropContext, w: number, h: number): void {
  const cx = w / 2;
  const cy = h * 0.55;
  const maxR = Math.hypot(cx, cy);

  g.fillStyle = P.skyGround;
  g.fillRect(0, 0, w, h);

  // The seat: a soft lift under the town, radial so it can never become a line.
  const seat = g.createRadialGradient(cx, h * 0.6, 0, cx, h * 0.6, maxR * 0.75);
  seat.addColorStop(0, hexA(P.skyMid, 0.22));
  seat.addColorStop(1, hexA(P.skyMid, 0));
  g.fillStyle = seat;
  g.fillRect(0, 0, w, h);

  // And the vignette, last, darkening the corners of the frame. It says *this is
  // where you are looking* without saying *and there is somewhere else*.
  const vig = g.createRadialGradient(cx, cy, maxR * 0.32, cx, cy, maxR);
  vig.addColorStop(0, hexA(P.void, 0));
  vig.addColorStop(1, hexA(P.void, 0.82));
  g.fillStyle = vig;
  g.fillRect(0, 0, w, h);

}

/**
 * A 2D context, narrowed to what the backdrop actually uses.
 *
 * Not a mock: it is the *surface* the painting needs, so a test can supply one
 * and read the result. Anything the backdrop starts using and this does not
 * declare is a type error rather than a runtime surprise.
 */
export interface BackdropContext {
  fillStyle: unknown;
  fillRect(x: number, y: number, w: number, h: number): void;
  createRadialGradient(a: number, b: number, c: number, d: number, e: number, f: number): { addColorStop(o: number, c: string): void };
  createLinearGradient(a: number, b: number, c: number, d: number): { addColorStop(o: number, c: string): void };
}

export function skyTexture(scene: Phaser.Scene, w: number, h: number): string {
  const key = `${SKY_TEX}:${w}x${h}`;
  if (scene.textures.exists(key)) return key;

  const canvas = scene.textures.createCanvas(key, w, h);
  if (!canvas) return key;
  const g = canvas.getContext();

  // A plain, a seat, and a vignette — in that order, because the order is the
  // whole composition.
  //
  // The first version drew the vignette *first* and then filled the frame with
  // opaque `skyGround` over the top of it, so the vignette survived nowhere and
  // the only visible mark was the seat. It read as "a vignette and nothing else"
  // while painting a flat field, and the test asserted a delta between two palette
  // constants and never touched the canvas — so nothing caught it.
  //
  // The vignette is drawn **last**, over everything, because that is the only
  // order in which a vignette is a vignette.
  paintBackdrop(canvas.getContext() as unknown as BackdropContext, w, h);

  canvas.refresh();
  return key;
}

/** mix blends two `#rrggbb` colours, in the browser's arithmetic. */
function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1, 3), 16);
  const ga = parseInt(a.slice(3, 5), 16);
  const ba = parseInt(a.slice(5, 7), 16);
  const pb = parseInt(b.slice(1, 3), 16);
  const gb = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(pa + (pb - pa) * t);
  const g = Math.round(ga + (gb - ga) * t);
  const bl = Math.round(ba + (bb - ba) * t);
  return `rgb(${r},${g},${bl})`;
}

/** hexA is `#rrggbb` at a given alpha — the one place alpha is not 0 or 255,
 *  and deliberately: this is a generated texture, never a baked one, so no
 *  palette invariant ever sees it. */
function hexA(colour: string, alpha: number): string {
  const r = parseInt(colour.slice(1, 3), 16);
  const g = parseInt(colour.slice(3, 5), 16);
  const b = parseInt(colour.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
