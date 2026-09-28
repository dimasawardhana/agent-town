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
 * This is the whole composition, and it is a fight with the camera fit: the sky
 * is screen-space, so the horizon lands at a fixed place in the frame while the
 * island is centred by the camera. Put the horizon *below* the island's centre
 * and the treeline stands in front of the land — a forest the town is standing
 * behind, which is the opposite of a horizon. It has to cross the island, so the
 * skyline is against haze and the land is against sky.
 */
const HORIZON = 0.6;

/** Exported for the test that pins the composition. */
export const HORIZON_FRACTION = HORIZON;

/** A hash for the treeline, so the ridge is irregular but identical every time. */
function ridge(x: number, salt: number): number {
  let h = (x * 374761393 + salt * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

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
  const horizon = Math.floor(h * HORIZON);

  // The gradient, in three bands: deep overhead, a cooler middle, and warm haze
  // at the horizon. Two stops and a curve read as a gradient *in CSS* and as
  // haze in pixel art; three stops read as distance.
  //
  // The first attempt kept the top at the void colour and eased hard into the
  // haze, which put the whole visible band — the town covers the middle — at
  // almost exactly the void it replaced. A backdrop that cannot be seen is a
  // backdrop that was not built, so the ramp now spends its contrast where the
  // town does not.
  for (let y = 0; y < horizon; y++) {
    const t = y / horizon;
    const c = t < 0.58 ? mix(P.skyZenith, P.skyMid, t / 0.58) : mix(P.skyMid, P.skyHaze, (t - 0.58) / 0.42);
    g.fillStyle = c;
    g.fillRect(0, y, w, 1);
  }

  // The glow sitting on the horizon, brightest at the left where the key light
  // in the art comes from — the buildings are lit from one side, and a sky lit
  // from the other would put two suns in one picture.
  const glow = g.createRadialGradient(w * 0.3, horizon, 0, w * 0.3, horizon, h * 0.6);
  glow.addColorStop(0, hexA(P.skyGlow, 0.5));
  glow.addColorStop(1, hexA(P.skyGlow, 0));
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);

  // Two ridges, far and near, the far one hazed toward the sky so distance is
  // carried by *less contrast* rather than by perspective, which a flat ridge
  // has none of.
  for (const [salt, amp, base, colour, alpha] of [
    [11, 0.07, 0.03, P.skyFar, 0.42],
    [29, 0.04, 0.0, P.skyNear, 0.9],
  ] as const) {
    g.fillStyle = hexA(colour, alpha);
    for (let x = 0; x < w; x++) {
      // Two frequencies, so the ridge is not a sine wave. Integer x only: the
      // texture is sampled at whole pixels and anything finer would alias.
      const n = ridge(x, salt) * 0.65 + ridge(Math.floor(x / 7), salt + 3) * 0.35;
      const top = horizon - Math.floor((n - 0.5) * 2 * h * amp) - h * base;
      g.fillRect(x, top, 1, horizon - top);
    }
  }

  // A treeline on the near ridge, at one tree per few pixels. Individual trees
  // rather than a serrated edge, because a serrated edge at this scale reads as
  // noise and a treeline reads as somewhere.
  // Clustered rather than per-pixel: a comb of equal spikes reads as a barcode,
  // and a treeline reads as somewhere only if the heights clump the way real
  // crowns do. The cluster key is a slow function, the height a fast one.
  g.fillStyle = hexA(P.skyNear, 0.9);
  for (let x = 0; x < w; x += 2) {
    const n = ridge(x, 29) * 0.65 + ridge(Math.floor(x / 7), 32) * 0.35;
    const ground = horizon - Math.floor((n - 0.5) * 2 * h * 0.04);
    const cluster = ridge(Math.floor(x / 40), 71);
    const tall = 2 + Math.floor(cluster * cluster * 9 + ridge(x, 97) * 2);
    g.fillRect(x, ground - tall, 1, tall + 1);
  }

  // The plain below the horizon. Without it the region floats over a hard void,
  // which reads as a hole in the picture rather than as land seen from above —
  // and the island is *not* floating, it is a clearing in a field.
  g.fillStyle = P.skyGround;
  g.fillRect(0, horizon, w, h - horizon);
  // A band of haze sitting on the plain's edge, so the join is distance and not
  // a seam.
  const mist = g.createLinearGradient(0, horizon - h * 0.04, 0, horizon + h * 0.1);
  mist.addColorStop(0, hexA(P.skyHaze, 0.55));
  mist.addColorStop(1, hexA(P.skyHaze, 0));
  g.fillStyle = mist;
  g.fillRect(0, horizon - h * 0.04, w, h * 0.14);

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
