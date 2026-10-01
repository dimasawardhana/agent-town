// Birds, in the sky, at dusk.
//
// **This is the first thing in the town that moves and says nothing about the
// code**, and that is exactly why it is here and not more of it.
//
// `docs/superpowers/specs/2026-09-29-town-liveliness.md` opens with: "Not
// animation. A figure moving because it looks nice is decoration wearing a
// claim's clothes, and this town does not do that." A bird is the purest
// decoration available — it reports nothing about the repository, it has no
// verb, and a reader cannot act on one.
//
// So it is given the narrowest claim the town can actually support, which is
// **the hour**. Birds come out at dusk and roost by dark, so `DAYLIGHT.birds`
// is 6 at dusk and 0 at both day and night, and the layer refuses to draw a
// single bird at a phase that does not ask for one. That is the same rule that
// puts no cloud in a night sky, and it is the reason this is a table entry
// rather than a constant in this file: the count is a claim, so the claim lives
// where the other claims are.
//
// **What a bird may never mean is "something is working here."** That belongs to
// the machine, and it is the only mover in the town with that meaning. A flock
// over a busy district would say "something is happening there" and quietly take
// a job that belongs to a signal a reader can act on — which is the whole
// bargain the rest of the map is built on.
//
// The texture is generated rather than baked, so this costs the atlas nothing:
// the same trick the ember and the smoke use, for the same reason. Every cel in
// the sheet is paid for by the whole town, and a bird is not a thing the whole
// town should pay for.

import Phaser from "phaser";
import { DAYLIGHT, normaliseDay, type DayPhase } from "./daylight";
import { Pix } from "./art/surface";
import { P } from "./art/palette";

/** The bird's texture key, exported so a test can assert which mark is showing. */
export const BIRD_TEX = "bird";

/**
 * The bird's own width, in pixels.
 *
 * Seven, and the number is read from the sprite rather than assumed: a bird at
 * map zoom is a silhouette, and the two other silhouettes in this town are a
 * 32-pixel machine and a 20-pixel figure. Anything much over ten and a bird
 * starts competing with a crane arm; much under six and it is a speck the eye
 * cannot separate from a dead pixel.
 */
export const BIRD_W = 7;
export const BIRD_H = 4;

/**
 * birdTexture draws one bird: a shallow M.
 *
 * Two wing tips above a body, which is the shape a reader's eye completes on its
 * own — a filled blob at seven pixels is a smudge, and a single stroke is a dash.
 * The M is the one silhouette that survives being that small.
 *
 * **One frame, not a flap.** A two-frame flap was the first version and it was
 * cut: at seven pixels a bird that changes shape every other frame flickers, and
 * a flicker on a moving mark reads as a defect in the renderer rather than as
 * life. A still silhouette that drifts is a bird.
 *
 * The colour is the darkest value on the glass ramp rather than `P.ink`, which
 * is the outline every other mark in the town is drawn in. A bird has no outline;
 * it is a shape, and the ink is reserved for edges of things that have insides.
 */
export function birdTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(BIRD_TEX)) return BIRD_TEX;
  const pix = new Pix(BIRD_W, BIRD_H);
  const ink = P.glass[0];
  const r = Number.parseInt(ink.slice(1, 3), 16);
  const g = Number.parseInt(ink.slice(3, 5), 16);
  const b = Number.parseInt(ink.slice(5, 7), 16);
  //   #.....#
  //   .#...#.
  //   ..#.#..
  //   ...#...
  const shape = [
    "0,0",
    "6,0",
    "1,1",
    "5,1",
    "2,2",
    "4,2",
    "3,3",
  ];
  for (const cell of shape) {
    const [x, y] = cell.split(",").map(Number);
    const i = (y * BIRD_W + x) * 4;
    pix.data[i] = r;
    pix.data[i + 1] = g;
    pix.data[i + 2] = b;
    pix.data[i + 3] = 255;
  }
  scene.textures.addCanvas(BIRD_TEX, pix.toCanvas());
  return BIRD_TEX;
}

/**
 * mix32 is a deterministic 32-bit hash, in [0, 1).
 *
 * The same function `sky.ts` uses for the cloud field, written out again rather
 * than shared: a bird's path and a cloud's place are different questions, and a
 * shared helper would couple a change to one to the other. It is four lines.
 */
function mix32(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 0x1_0000_0000;
}

/**
 * birdPath is where one bird is at time `t`, in pixels.
 *
 * Exported so a test can check the two properties a moving mark needs and that no
 * pixel test can see: a bird's path is a **pure function of its index and the
 * clock** (so two clients agree, and a redraw does not restart the flock), and it
 * **wraps** (so a bird is never lost off the edge and never piles up at one).
 *
 * The drift is horizontal and slow, and the bob is a small vertical sine on top
 * of it. A bird that climbed, or turned, or changed size would be doing something
 * the reader would try to interpret; this one goes from one side of the sky to
 * the other and that is the whole of its vocabulary.
 */
export function birdPath(
  i: number,
  t: number,
  w: number,
  h: number,
): { x: number; y: number; speed: number } {
  const speed = 6 + mix32(i * 8 + 1) * 10; // px per second
  const dir = mix32(i * 8 + 2) < 0.35 ? -1 : 1;
  const span = w + 80;
  // Wrapped, so a bird leaving one edge is the same bird entering the other.
  const raw = (mix32(i * 8 + 3) * span + t * speed * dir) % span;
  const x = ((raw + span) % span) - 40;
  // The same upper band the clouds live in, so a bird is always against sky and
  // never against a roof — a bird on a building is a mark about the building.
  const base = h * (0.08 + mix32(i * 8 + 4) * 0.26);
  const bob = Math.sin(t * 1.7 + mix32(i * 8 + 5) * 6.28) * 4;
  return { x, y: base + bob, speed };
}

/**
 * FLOCK_PERIOD is how long the cycle is, and FLOCK_VISIBLE how much of it the
 * birds are out for.
 *
 * **"Sometimes" is a number, and these two are it.** The first version had six
 * birds circling the dusk sky for as long as the phase lasted, which is not
 * "sometimes" — it is always, and always reads as furniture. A flock that crosses
 * and is gone for most of a minute is something that happened.
 *
 * Both are whole seconds and the ratio is 1 in 4, chosen so a reader watching
 * for a minute sees a flock twice and does not wonder whether it is broken. A
 * shorter period is a bird that flickers, which at this size reads as a defect in
 * the renderer rather than as life — the same reason the wing does not flap.
 */
export const FLOCK_PERIOD = 48;
export const FLOCK_VISIBLE = 12;

/**
 * flockOut is whether any bird is in the air at time `t`.
 *
 * A pure function of the clock, so two clients watching the same town see the
 * same flock and a redraw does not conjure one — and so a test can ask "is a bird
 * ever out?" without waiting for it.
 */
export function flockOut(t: number): boolean {
  return ((t % FLOCK_PERIOD) + FLOCK_PERIOD) % FLOCK_PERIOD < FLOCK_VISIBLE;
}

/** Birds owns the flock, and the flock is only ever as large as the phase asks for. */
export class Birds {
  private readonly scene: Phaser.Scene;
  private readonly depth: number;
  private sprites: Phaser.GameObjects.Image[] = [];

  constructor(scene: Phaser.Scene, depth: number) {
    this.scene = scene;
    this.depth = depth;
  }

  /**
   * reconcile places the flock for a phase at a time.
   *
   * **The count comes from the phase and only from the phase.** A caller cannot
   * ask for more birds than `DAYLIGHT` allows, because this reads the same field
   * the sky's cloud and the windows' lamp are read from — one table, one claim,
   * and no way for a second one to disagree with it.
   */
  reconcile(phase: DayPhase, t: number, w: number, h: number): void {
    // Both gates, and both from the phase table: dusk or nothing, and even at
    // dusk only sometimes. The sprite is hidden rather than destroyed when the
    // flock is in, because a bird that is created and destroyed every twelve
    // seconds is twelve seconds of allocation a minute for a thing that is not
    // there.
    const want = flockOut(t) ? DAYLIGHT[normaliseDay(phase)].birds : 0;
    while (this.sprites.length > want) this.sprites.pop()?.destroy();
    while (this.sprites.length < want) {
      const s = this.scene.add.image(0, 0, birdTexture(this.scene));
      // Fixed to the frame like the sky, and just in front of it: a bird is in
      // the sky, and behind the town, so a bird can never be half-hidden by a
      // roof — which would read as a mark on the building.
      s.setScrollFactor(0).setDepth(this.depth);
      this.sprites.push(s);
    }
    for (let i = 0; i < this.sprites.length; i++) {
      const p = birdPath(i, t, w, h);
      this.sprites[i].setPosition(p.x, p.y);
    }
    // `want` is above, so nothing else has to know about the window.
  }

  destroy(): void {
    for (const s of this.sprites) s.destroy();
    this.sprites = [];
  }
}
