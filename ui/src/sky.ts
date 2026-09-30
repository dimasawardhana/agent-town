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
import { DAYLIGHT, normaliseDay, type DayPhase } from "./daylight";

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
export function paintBackdrop(
  g: BackdropContext,
  w: number,
  h: number,
  phase: DayPhase = "dusk",
): void {
  const { sky, cloud } = DAYLIGHT[normaliseDay(phase)];
  const cx = w / 2;
  const cy = h * 0.55;
  const maxR = Math.hypot(cx, cy);

  g.fillStyle = sky.ground;
  g.fillRect(0, 0, w, h);

  // The seat: a soft lift under the town, radial so it can never become a line.
  const seat = g.createRadialGradient(cx, h * 0.6, 0, cx, h * 0.6, maxR * 0.75);
  seat.addColorStop(0, hexA(sky.mid, 0.22));
  seat.addColorStop(1, hexA(sky.mid, 0));
  g.fillStyle = seat;
  g.fillRect(0, 0, w, h);

  // Cloud, over the seat and under the vignette, so it is lit by the same lift
  // the town is and framed by the same corners.
  //
  // **A cloud is a cluster of radial gradients, not a shape**, and that is
  // forced rather than chosen: `BackdropContext` declares exactly two primitives
  // — a fill and a gradient — so anything else would mean widening the surface
  // the sky tests render through, and a backdrop that grew an unmodelled
  // primitive is a backdrop a test can no longer see. The seat above is the same
  // technique at a larger scale, so this is a second use of a shape the file
  // already had.
  if (cloud) paintClouds(g, w, h, cloud);

  // And the vignette, last, darkening the corners of the frame. It says *this is
  // where you are looking* without saying *and there is somewhere else*.
  const vig = g.createRadialGradient(cx, cy, maxR * 0.32, cx, cy, maxR);
  vig.addColorStop(0, hexA(sky.void, 0));
  vig.addColorStop(1, hexA(sky.void, 0.82));
  g.fillStyle = vig;
  g.fillRect(0, 0, w, h);

}

/** CLOUD_COUNT is how many clouds the sky carries when it has any.
 *
 *  Seven, and the number is a *frame* decision rather than a weather one: a sky
 *  is read as a sky from the density of its cloud, and seven is dense enough to
 *  say "this is weather" and sparse enough that two of them never merge into one
 *  shape a reader has to decode. It is also the count the `BackdropContext` test
 *  harness has to model, so it is a number with a cost. */
export const CLOUD_COUNT = 7;

/**
 * mix32 is a deterministic 32-bit hash, in [0, 1).
 *
 * Local to the sky, and the local-ness is the point: the sky has no path to hash
 * and must not borrow the one the art uses, or a cloud would move when a building
 * was renamed. Every cloud is a pure function of its index and the frame, which
 * is the same rule the rest of this file has followed from the start.
 */
function mix32(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 0x1_0000_0000;
}

/** One cloud's placement, in fractions of the frame.
 *
 *  Exported so a test can check the cloud field is a function of its index and
 *  nothing else — which is the property the file's no-`Math.random` rule exists
 *  to protect, and which no pixel test can see. */
export function cloudAt(i: number, w: number, h: number): {
  x: number;
  y: number;
  r: number;
  puffs: number;
} {
  const a = mix32(i * 8 + 1);
  const b = mix32(i * 8 + 2);
  const c = mix32(i * 8 + 3);
  return {
    // Kept in the upper band, above the island: the town occupies the middle and
    // lower of the frame, and a cloud behind a building is a smudge on a roof.
    x: (0.1 + a * 0.8) * w,
    y: (0.04 + b * 0.3) * h,
    r: (0.05 + c * 0.06) * w,
    puffs: 3 + Math.floor(mix32(i * 8 + 4) * 3),
  };
}

/**
 * paintClouds draws the cloud field into the backdrop.
 *
 * Each cloud is a short line of puffs rather than a disc, because a disc reads
 * as a dot and a line of them reads as weather. The puffs are offset by the same
 * `mix32` the placement came from, so a cloud's shape is fixed as well as its
 * position — a sky that rearranged its own cloud on a redraw is a sky no reader
 * can look at twice.
 */
function paintClouds(g: BackdropContext, w: number, h: number, colour: string): void {
  for (let i = 0; i < CLOUD_COUNT; i++) {
    const c = cloudAt(i, w, h);
    for (let p = 0; p < c.puffs; p++) {
      // Puffs march left to right along the cloud, thinning at both ends, which
      // is the shape a cloud actually has and the cheapest way to stop a cluster
      // reading as a smudge.
      const t = c.puffs === 1 ? 0.5 : p / (c.puffs - 1);
      const off = (t - 0.5) * c.r * 1.7;
      const lift = Math.sin(t * Math.PI) * c.r * 0.16;
      const pr = c.r * (0.5 + mix32(i * 8 + 5 + p) * 0.35);
      const px = c.x + off;
      const py = c.y - lift;
      // Alpha falls off toward the ends of the line, so the cluster has no hard
      // left or right edge to read as a boundary.
      //
      // The peak is a third of an alpha rather than the sixth this started at,
      // because the vignette is drawn over the top of all this and takes up to
      // 82% at the corners — the top of the frame, which is where every cloud
      // is, loses a third of its contrast to it. At the first value the clouds
      // were on the canvas and invisible to a reader, which is the same failure
      // as not drawing them and costs more.
      const alpha = 0.14 + Math.sin(t * Math.PI) * 0.32;
      const grad = g.createRadialGradient(px, py, 0, px, py, pr);
      grad.addColorStop(0, hexA(colour, alpha));
      grad.addColorStop(1, hexA(colour, 0));
      g.fillStyle = grad;
      // Clamped to the frame rather than left to the context. A real canvas
      // clips silently, so the unclipped version worked and the test harness —
      // which writes into a flat array and does not clip — is what caught it.
      // Depending on the caller to clip is how a backdrop ends up drawing outside
      // the frame on a surface that does not, and the clamp costs nothing.
      const x0 = Math.max(0, Math.floor(px - pr));
      const y0 = Math.max(0, Math.floor(py - pr));
      const x1 = Math.min(w, Math.ceil(px + pr));
      const y1 = Math.min(h, Math.ceil(py + pr));
      if (x1 <= x0 || y1 <= y0) continue;
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  }
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

export function skyTexture(
  scene: Phaser.Scene,
  w: number,
  h: number,
  phase: DayPhase = "dusk",
): string {
  const key = `${SKY_TEX}:${w}x${h}:${phase}`;
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
  paintBackdrop(canvas.getContext() as unknown as BackdropContext, w, h, phase);

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
