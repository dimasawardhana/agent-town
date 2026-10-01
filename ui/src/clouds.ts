// Cloud, as sprite art, drifting.
//
// **These used to be painted into the backdrop** — clusters of radial gradients,
// posterised into the sky with everything else. That was wrong twice over: a
// gradient has no pixel grid, so a cloud made of gradients could never be the
// same *kind* of picture as the building beside it; and a cloud painted into a
// backdrop is nailed to it, because a texture cannot move.
//
// So the cloud is a sprite now, on the same terms as the bird and the ember:
// generated rather than baked (the atlas pays nothing — every cel in the sheet
// is paid for by the whole town), three tones hard-edged, drifting, wrapping.
//
// **The art is a union of discs with a flat bottom.** That is how a cloud is
// drawn, and it is also the only construction that gets a hard edge and a
// straight base out of the same code: fill a row of overlapping circles, union
// them, and the silhouette is lumpy on top and flat underneath, which is the
// whole of what makes a shape read as cloud rather than as a smudge.
//
// The three tones are the plaster ramp read as light — the top step on the crown,
// the middle across the body, the lower step underneath. A cloud lit from above
// with a shadowed base is the only description of one that is also a description
// of how to draw it.

import Phaser from "phaser";
import { DAYLIGHT, normaliseDay, type DayPhase } from "./daylight";
import { Pix } from "./art/surface";
import { P } from "./art/palette";

/** How many clouds the sky carries at its fullest phase.
 *
 *  Six, and it is the number that fills the upper band without any two clouds
 *  touching at the drift speeds below. Seven reads as overcast at map zoom, and
 *  four reads as a clear sky with something wrong in it. */
export const CLOUD_COUNT = 6;

/** The three cloud widths, in pixels. A size axis of three rather than one,
 *  because one width drifting across the sky is a wallpaper. */
export const CLOUD_SIZES = [26, 38, 52] as const;

export const CLOUD_TEX = "cloud";

/** mix32 is a deterministic 32-bit hash, in [0, 1). Same function as the sky's
 *  and the birds', written out again: three unrelated questions, and a shared
 *  helper would couple a change to one to the others. */
function mix32(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 0x1_0000_0000;
}

/**
 * cloudPix draws one cloud, in `variant` shapes, at width `w`.
 *
 * Three to five discs of varying radius sit along a common base, and the union
 * is the silhouette. The radius sequence is hashed from `(w, variant)` so a given
 * cloud is *always the same cloud* — a sky that reshuffled its own weather on a
 * redraw is a sky a reader cannot look at twice.
 *
 * Exported rather than kept behind the texture so a test can count the tones in
 * the art itself, which is the only way to check a picture that a test cannot
 * see.
 */
export function cloudPix(w: number, variant: number): Pix {
  const h = Math.max(7, Math.round(w * 0.5));
  const base = h - 1;
  const discs = 3 + Math.floor(mix32(w * 31 + variant) * 3); // 3..5
  const pix = new Pix(w, h);

  // Which pixel is inside the silhouette, and how high up it is.
  const solid: number[] = new Array(w * h).fill(0);
  const [tr, tg, tb] = hexBytes(P.plaster[3]);
  const [mr, mg, mb] = hexBytes(P.plaster[2]);
  const [sr, sg, sb] = hexBytes(P.plaster[1]);

  // **Radius is a fraction of the height, not the width.** The first version
  // sized it off the width, which at 38 wide put 6-to-17-pixel discs into a
  // sixteen-pixel-tall box: their union was the whole rectangle and every cloud
  // came out as a flat bar. A cloud's proportions are set by its height — that is
  // what makes the thing wide and shallow — so that is what the discs are sized
  // against.
  for (let d = 0; d < discs; d++) {
    const t = discs === 1 ? 0.5 : d / (discs - 1);
    // Inset from the ends so the outermost disc's bulge lands inside the canvas
    // rather than being clipped flat against it.
    const cx = Math.round((0.22 + t * 0.56) * (w - 1));
    // The middle discs are the tall ones and the ends are small, which is what
    // gives a crown rather than a row of equal bumps.
    const r = Math.max(
      2,
      Math.round(h * (0.24 + Math.sin(t * Math.PI) * 0.26 + mix32(w * 31 + variant * 7 + d) * 0.1)),
    );
    // Sitting the disc half-buried in the base is what gives a flat underside
    // without having to cut one: the bottom of the disc is below the row the
    // cloud ends on, and the flat cut is what is left.
    const cy = base - Math.round(r * 0.5);
    for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r * r) solid[y * w + x] = 1;
      }
    }
  }

  // And the flat bottom: a cloud has a base, and letting the discs round off
  // underneath is the single thing that makes a shape read as a bubble.
  let left = w;
  let right = -1;
  for (let x = 0; x < w; x++) {
    if (solid[base * w + x]) {
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  if (right < 0) return pix; // degenerate; a blank is better than a crash
  for (let x = left; x <= right; x++) solid[base * w + x] = 1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!solid[y * w + x]) continue;
      // Toned by height: crown, body, then the shaded base.
      const t = 1 - y / h;
      const [r, g, b] = t > 0.62 ? [tr, tg, tb] : t > 0.26 ? [mr, mg, mb] : [sr, sg, sb];
      const i = (y * w + x) * 4;
      pix.data[i] = r;
      pix.data[i + 1] = g;
      pix.data[i + 2] = b;
      pix.data[i + 3] = 255;
    }
  }
  return pix;
}

function hexBytes(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** The cloud textures, one per size and variant, registered once. */
export function cloudTexture(scene: Phaser.Scene): string[] {
  const keys: string[] = [];
  for (const w of CLOUD_SIZES) {
    for (let variant = 0; variant < 2; variant++) {
      const key = `${CLOUD_TEX}:${w}:${variant}`;
      keys.push(key);
      if (scene.textures.exists(key)) continue;
      const canvas = scene.textures.createCanvas(key, w, Math.max(7, Math.round(w * 0.5)));
      if (!canvas) continue;
      const pix = cloudPix(w, variant);
      const g = canvas.getContext() as CanvasRenderingContext2D;
      const img = g.createImageData(w, pix.h);
      img.data.set(pix.data.subarray(0, w * pix.h * 4));
      g.putImageData(img, 0, 0);
      canvas.refresh();
    }
  }
  return keys;
}

/**
 * cloudPath is where one cloud is at time `t`, in pixels.
 *
 * Horizontal, slow, and wrapping — a cloud goes from one side of the sky to the
 * other and that is the whole of its vocabulary. It does not bob, does not grow
 * and does not turn, because a reader who has watched one for four seconds
 * starts looking for a meaning in whatever it is doing.
 *
 * A pure function of its index and the clock, for the same reason the birds' is:
 * two clients drawing the same town draw the same weather, and a redraw does not
 * restart the sky.
 */
export function cloudPath(
  i: number,
  t: number,
  w: number,
  h: number,
): { x: number; y: number; size: number; variant: number; speed: number } {
  const size = CLOUD_SIZES[Math.floor(mix32(i * 8 + 9) * CLOUD_SIZES.length) % CLOUD_SIZES.length];
  const variant = Math.floor(mix32(i * 8 + 10) * 2) % 2;
  // Slower than a bird, and inversely so: a wide cloud crossing the same frame
  // takes longer, which is what makes the depth read as depth.
  const speed = (4 + mix32(i * 8 + 11) * 5) * (56 / size);
  const span = w + 120;
  const raw = (mix32(i * 8 + 12) * span + t * speed) % span;
  const x = ((raw + span) % span) - 60;
  // The same upper band the birds use, so nothing in the sky is ever below the
  // island's skyline.
  const y = h * (0.06 + mix32(i * 8 + 13) * 0.24) + size * 0.21;
  return { x, y, size, variant, speed };
}

/** Clouds owns the weather, and the weather is only ever as large as the phase
 *  asks for. */
export class Clouds {
  private readonly scene: Phaser.Scene;
  private readonly depth: number;
  private sprites: Phaser.GameObjects.Image[] = [];

  constructor(scene: Phaser.Scene, depth: number) {
    this.scene = scene;
    this.depth = depth;
  }

  /** reconcile places the clouds for a phase at a time.
   *
   *  **The count comes from the phase and only from the phase**, for the same
   *  reason the flock's does: one table, one claim, and no way for a second
   *  reader of `DAYLIGHT` to disagree with this one. */
  reconcile(phase: DayPhase, t: number, w: number, h: number): void {
    const want = DAYLIGHT[normaliseDay(phase)].clouds;
    cloudTexture(this.scene);
    while (this.sprites.length > want) this.sprites.pop()?.destroy();
    while (this.sprites.length < want) {
      const s = this.scene.add.image(0, 0, `${CLOUD_TEX}:${CLOUD_SIZES[0]}:0`);
      // Fixed to the frame like the sky, and in front of it — see `DEPTH.bird`
      // for why nothing in the sky may ever be in front of the island.
      s.setScrollFactor(0).setDepth(this.depth);
      this.sprites.push(s);
    }
    for (let i = 0; i < this.sprites.length; i++) {
      const p = cloudPath(i, t, w, h);
      // The exact key, variant included. The first version searched the key list
      // for one matching the size and then asked for frame 1 — which matched the
      // variant-0 texture every time and named a frame a canvas texture does not
      // have, so the variant axis existed in the art, in the tests and on disk,
      // and was never once on screen.
      this.sprites[i].setTexture(`${CLOUD_TEX}:${p.size}:${p.variant}`);
      this.sprites[i].setPosition(p.x, p.y);
      // The crown is a highlight, so a distant cloud is dimmer: alpha is the one
      // thing a generated sprite may use, for the same reason the sky does.
      const depthFade = 1 - (p.y / h) * 0.25;
      this.sprites[i].setAlpha(depthFade);
    }
  }

  destroy(): void {
    for (const s of this.sprites) s.destroy();
    this.sprites = [];
  }
}
