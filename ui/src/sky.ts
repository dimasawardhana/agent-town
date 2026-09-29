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
export function skyTexture(scene: Phaser.Scene, w: number, h: number): string {
  const key = `${SKY_TEX}:${w}x${h}`;
  if (scene.textures.exists(key)) return key;

  const canvas = scene.textures.createCanvas(key, w, h);
  if (!canvas) return key;
  const g = canvas.getContext();

  // A vignette and nothing else.
  //
  // There was a horizon here: a gradient, a glow, two ridges and a treeline, with
  // the horizon line crossing the middle of the frame so the town stood against
  // haze. It was competent and it was wrong, and the reason is worth recording
  // because it took three attempts to see.
  //
  // A horizon is a *distant view*. Drawing one behind a thing that is meant to be
  // read from above says the map is a diorama on a table — the eye reads the
  // band and the treeline as a backdrop, and the land stops being land and starts
  // being a model of land. Every attempt to fix it by moving the horizon up or
  // down traded one version of the diorama for another, because the diorama was
  // the horizon.
  //
  // So there is no horizon. What is left is the thing the void was always for:
  // the region is bounded by nothing, which is what makes a region a region, and
  // a vignette says "this is where you are looking" without saying "and there is
  // somewhere else".
  const g2 = g;
  const cx = w / 2;
  const cy = h * 0.55;
  const maxR = Math.hypot(cx, cy);
  const vig = g2.createRadialGradient(cx, cy, maxR * 0.32, cx, cy, maxR);
  vig.addColorStop(0, hexA(P.void, 0));
  vig.addColorStop(1, hexA(P.void, 0.82));
  g2.fillStyle = vig;
  g2.fillRect(0, 0, w, h);

  // The plain the island sits on: a clearing in a field, seen from above. It is
  // a *floor*, not a distance, so it is flat and unlit rather than hazed — a
  // gradient here would immediately read as ground receding to a horizon and put
  // the diorama straight back.
  g2.fillStyle = P.skyGround;
  g2.fillRect(0, 0, w, h);
  // And a soft lift under the town, so the land is seated in the field rather
  // than pasted on it. Radial, so it cannot become a line.
  const seat = g2.createRadialGradient(cx, h * 0.6, 0, cx, h * 0.6, maxR * 0.75);
  seat.addColorStop(0, hexA(P.skyMid, 0.22));
  seat.addColorStop(1, hexA(P.skyMid, 0));
  g2.fillStyle = seat;
  g2.fillRect(0, 0, w, h);

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
