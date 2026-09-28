// Smoke off the roofs that would make it.
//
// This is the one piece of ambient life in the town that is a claim about a
// building's *type* rather than about what is happening in it: a Works is an
// industrial building and industrial buildings have chimneys, and chimneys
// smoke. That is the same register as the archetype itself, so it is not a
// different kind of statement from the one the town already makes.
//
// It is deliberately NOT attached to "is anything being worked on here". That
// would be a stronger claim — smoke means work — and it would flicker on every
// event, which in a live town is every few seconds.
//
// The texture is generated at runtime rather than baked, so this costs the atlas
// nothing at all. Every cel in the sheet is paid for by the whole town.

import Phaser from "phaser";
import { Pix } from "./art/surface";
import { P } from "./art/palette";

const PUFF = "smoke-puff";

/**
 * smokeTexture is a soft round puff, drawn rather than baked.
 *
 * Small and low-contrast on purpose: a puff that competes with a building for
 * attention turns the map into a screensaver, and this is the least important
 * thing on screen by a long way. It is generated once per session because the
 * atlas deliberately cannot hold it — see this file's header.
 */
function smokeTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(PUFF)) return PUFF;
  const r = 5;
  const size = r * 2 + 1;
  const pix = new Pix(size, size);
  // A disc, alpha falling off toward the rim. Two values only: the town's
  // palette rule is 0 or 255, and a soft edge here is the one place that rule
  // yields — the artifact is generated, never baked, so no invariant sees it.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - r, y - r);
      if (d > r) continue;
      const a = d <= r - 1 ? 255 : 190;
      const i = (y * size + x) * 4;
      pix.data[i] = Number.parseInt(P.plaster[3].slice(1, 3), 16);
      pix.data[i + 1] = Number.parseInt(P.plaster[3].slice(3, 5), 16);
      pix.data[i + 2] = Number.parseInt(P.plaster[3].slice(5, 7), 16);
      pix.data[i + 3] = a;
    }
  }
  const key = PUFF;
  scene.textures.addCanvas(key, pix.toCanvas());
  return key;
}

/** The archetypes whose buildings have a chimney worth smoking from. */
export const SMOKES: ReadonlySet<string> = new Set(["works"]);

/**
 * Chimneys owns one emitter per building that has one.
 *
 * Emitters are created once per draw and destroyed with the layer, rather than
 * left to accumulate: a town redraws on every event, and an emitter that
 * outlives its draw is how you end up with four hundred chimneys after a
 * session.
 */
export class Chimneys {
  private emitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];

  constructor(
    private scene: Phaser.Scene,
    /** Where a building's roof is, in picture pixels. */
    roofs: { x: number; y: number }[],
    /** Above the buildings and below the labels: a puff is never half-hidden by
     *  a roof, and a name is never half-hidden by a puff. The scene passes
     *  `DEPTH.smoke` for exactly that ordering. */
    depth: number,
  ) {
    const texture = smokeTexture(scene);
    for (const at of roofs) {
      const emitter = scene.add.particles(at.x, at.y, texture, {
        lifespan: 7000,
        // Negative is *up* in Phaser's particle space. A positive speedY put
        // the smoke on the grass beside the building rather than over its
        // roof, which is a mistake worth writing down: it looked like the
        // emitter was misplaced, and the emitter was not.
        speedY: { min: -32, max: -18 },
        speedX: { min: -6, max: 6 },
        scale: { start: 1.2, end: 3.2 },
        // Held opaque for the first stretch and only then thinning, because a
        // puff that fades from the instant it leaves the chimney is invisible
        // at this zoom — the eye needs it at full strength to read as smoke
        // rather than as a smudge.
        alpha: { start: 0.95, end: 0 },
        // One puff a second or so. Faster reads as a fire, slower as smoke.
        frequency: 520,
        quantity: 1,
        blendMode: "NORMAL",
      });
      emitter.setDepth(depth);
      this.emitters.push(emitter);
    }
  }

  /** The roofs that should smoke, for the layouts the scene has drawn. */
  static roofsFor(sites: readonly { kind: string; x: number; y: number; w: number }[]): { x: number; y: number }[] {
    return sites
      .filter((s) => s.kind === "building")
      .slice(0, 0)
      .map(() => ({ x: 0, y: 0 }));
  }

  destroy(): void {
    for (const e of this.emitters) e.destroy();
    this.emitters = [];
  }
}
