// The recent-activity ember: a building says it was worked on, and then stops
// saying so.
//
// The town is otherwise static-rich and dynamic-poor: it knows a great deal
// about a repository and almost nothing about what an agent is doing *now*, so
// a long session and a short one leave the same picture. `BuildingState.updated`
// has been tracked and persisted from the start and never drawn. This draws it.
//
// What it is allowed to claim is narrow on purpose. An ember means **touched in
// the last two minutes** — see `EMBER_MS`, the only place that number is
// written — and it fades to nothing and is removed. It is not a "hot" or "busy"
// badge, because those claim something the town cannot know: a building nobody
// has touched in an hour is not cold, it is simply untouched, and a marker that
// lingered would be asserting otherwise.
//
// The texture is generated rather than baked, so this costs the atlas nothing —
// the same trick the smoke uses, and for the same reason: every cel in the sheet
// is paid for by the whole town.

import Phaser from "phaser";
import { Pix } from "./art/surface";
import { P } from "./art/palette";

/**
 * How long a touch is visible.
 *
 * Long enough to see across a working session, short enough that the ember is
 * never lying. Two minutes: a change made just before a screenshot is in it, and
 * one made five minutes ago is not.
 *
 * This is the only statement of the window. A comment here once said "the last
 * minute or so" and a second said "five minutes ago is not", for a constant set
 * to two — a file whose entire claim is that it asserts nothing it cannot know,
 * asserting two different windows.
 */
export const EMBER_MS = 120_000;

/** The ember's texture key, exported so a test can assert which mark is showing. */
export const EMBER_TEX = "ember";
/** The ring's texture key, exported so a test can assert it is not the ember's. */
export const WORK_TEX = "working";

/**
 * emberTexture is a soft dot, drawn rather than baked.
 *
 * Generated once per session. The town reads this as a glow rather than a mark
 * because a hard-edged sprite at this zoom would read as damage, which is a
 * *condition*; this has to read as something that is simply recent.
 */
/**
 * glow writes a soft dot or a ring into a canvas, and returns its key.
 *
 * One function because there were two, and they were the same function with a
 * different test on the radius: `emberTexture` and `workingTexture` each built a
 * 2N+1 square, each hand-rolled a hex-to-bytes write, and each re-derived the
 * alpha ramp. The second one also forgot to route through whatever the surface
 * already offers, so the knowledge of how a colour becomes a pixel lived in three
 * places.
 *
 * `ring` draws the rim and leaves the middle clear, so the building's own contact
 * shadow stays visible through it — a filled mark would sit on the ground the
 * building stands on.
 */
function glow(scene: Phaser.Scene, key: string, colour: string, radius: number, ring: boolean): string {
  if (scene.textures.exists(key)) return key;
  const size = radius * 2 + 3;
  const canvas = scene.textures.createCanvas(key, size, size);
  if (!canvas) return key;
  const g = canvas.getContext() as CanvasRenderingContext2D;
  const c = Math.floor(size / 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      // A ring, or a disc that falls off toward the rim. Same shape test, two
      // answers, one loop.
      if (d > radius) continue;
      if (ring && d < radius - 1.5) continue;
      // The one place alpha is not 0 or 255, and deliberately: the artifact is
      // generated, never baked, so no palette invariant ever sees it.
      const a = ring ? 255 : Math.round(255 * (1 - d / radius) ** 1.5);
      g.fillStyle = colour;
      g.globalAlpha = a / 255;
      g.fillRect(x, y, 1, 1);
    }
  }
  g.globalAlpha = 1;
  canvas.refresh();
  return key;
}

/** The ember: a soft dot, so a recent touch reads as a glow rather than a mark. */
export function emberTexture(scene: Phaser.Scene): string {
  return glow(scene, EMBER_TEX, P.accentDim, 5, false);
}

/**
 * workingTexture is the ring, where the ember is a dot.
 *
 * A different *shape* on purpose: a brighter dot reads as the same mark pulsing,
 * and a pulse is not a claim. A ring reads as "occupied", which is exactly what
 * the daemon said.
 */
export function workingTexture(scene: Phaser.Scene): string {
  return glow(scene, WORK_TEX, P.accent, 6, true);
}

/** How strongly a building is still glowing, 0..1. */
export function emberStrength(updatedAt: number, now: number): number {
  const age = now - updatedAt;
  if (age <= 0) return 1;
  if (age >= EMBER_MS) return 0;
  // Fades out, and not linearly: the first half of the window is a mark, and
  // the second is a memory of one.
  const t = 1 - age / EMBER_MS;
  return t * t;
}

/**
 * Embers owns one sprite per recently-touched building.
 *
 * A **decoration layer** rather than another child in the building's container,
 * and that is the point: the stack's child count is what restaging depends on,
 * and nothing here may disturb it. Adding an ember to the stack would work until
 * the first time the count moved.
 */
export class Embers {
  private sprites = new Map<string, Phaser.GameObjects.Image>();
  private scene: Phaser.Scene;
  private depth: number;

  constructor(scene: Phaser.Scene, depth: number) {
    this.scene = scene;
    this.depth = depth;
    emberTexture(scene);
  }

  /**
   * reconcile makes the visible set match `touched` and fades the rest out.
   *
   * Called on the scene's own tick rather than on events, because an ember has
   * to *cool*: nothing happens to a building for two minutes, and the fading
   * that is the whole point would otherwise need a timer per building.
   */
  reconcile(touched: { id: string; x: number; y: number; updated: number }[], working: Set<string> = new Set()): void {
    // **Wall clock, not the scene clock.** `BuildingState.updated` is Unix
    // milliseconds from the event; Phaser's `time.now` is the scene's own clock,
    // which starts near zero. Comparing the two made every age hugely negative,
    // so every ember clamped to full strength and nothing ever faded — a glow
    // that never goes out is exactly the claim this exists to avoid.
    const now = Date.now();
    const keep = new Set<string>();
    for (const b of touched) {
      const s = emberStrength(b.updated, now);
      if (s <= 0) continue;
      keep.add(b.id);
      let img = this.sprites.get(b.id);
      if (!img) {
        img = this.scene.add.image(b.x, b.y, EMBER_TEX).setOrigin(0.5, 0.5);
        this.sprites.set(b.id, img);
      }
      // A building someone is working at right now gets the second mark. It is
      // placed on the same anchor and never alongside the ember, because two
      // marks at one point read as one mark flickering.
      const hot = working.has(b.id);
      // Set the texture that was *chosen*, not the one built here. The first
      // version computed `key` and then called `workingTexture` in both
      // branches, so a building that stopped being worked kept its ring for the
      // life of the layer — which is the one sentence this whole feature exists
      // not to say.
      const key = hot ? workingTexture(this.scene) : emberTexture(this.scene);
      if (img.texture.key !== key) img.setTexture(key);
      img.setPosition(b.x, b.y).setAlpha(hot ? 1 : s).setDepth(this.depth);
    }
    for (const [id, img] of this.sprites) {
      if (!keep.has(id)) {
        img.destroy();
        this.sprites.delete(id);
      }
    }
  }

  destroy(): void {
    for (const img of this.sprites.values()) img.destroy();
    this.sprites.clear();
  }
}
