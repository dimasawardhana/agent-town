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

const EMBER_TEX = "ember";
/** The ring's texture key, exported so a test can assert it is not the ember's. */
export const WORK_TEX = "working";

/**
 * emberTexture is a soft dot, drawn rather than baked.
 *
 * Generated once per session. The town reads this as a glow rather than a mark
 * because a hard-edged sprite at this zoom would read as damage, which is a
 * *condition*; this has to read as something that is simply recent.
 */
export function emberTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(EMBER_TEX)) return EMBER_TEX;
  const r = 5;
  const size = r * 2 + 1;
  const pix = new Pix(size, size);
  const c = Math.floor(size / 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      if (d > r) continue;
      // Falls off toward the rim so it reads as a glow. The one place in this
      // project alpha is not 0 or 255, and deliberately: the artifact is
      // generated, never baked, so no palette invariant sees it.
      const a = Math.round(255 * (1 - d / r) ** 1.5);
      const i = (y * size + x) * 4;
      pix.data[i] = Number.parseInt(P.accentDim.slice(1, 3), 16);
      pix.data[i + 1] = Number.parseInt(P.accentDim.slice(3, 5), 16);
      pix.data[i + 2] = Number.parseInt(P.accentDim.slice(5, 7), 16);
      pix.data[i + 3] = a;
    }
  }
  scene.textures.addCanvas(EMBER_TEX, pix.toCanvas());
  return EMBER_TEX;
}

/**
 * workingMark is whether an agent is working at this building *right now*.
 *
 * A second tier beside the ember, and the reason is the one the camera finding
 * turned up: a machine is 28x22 on a map that shows the whole land, so it is
 * 2.5% of the frame and cannot be the thing that says "here". The ember already
 * covers "touched recently" at 11px. This covers "being worked on" at the same
 * scale, and it is a *different shape* rather than a brighter version of the
 * same one — a second glow at the same place reads as one mark pulsing, which
 * says nothing an ember did not already say.
 *
 * The claim is the narrowest one the town can make: a session is at this
 * building. Not that the session is busy, not that the session is doing
 * something interesting — the daemon reports where a worker is standing, and
 * that is the whole of it.
 */


/**
 * workingTexture is a ring, where the ember is a dot.
 *
 * A different *shape* on purpose: a brighter dot reads as the same mark pulsing,
 * and a pulse is not a claim. A ring reads as "occupied", which is exactly what
 * the daemon said.
 */
function workingTexture(scene: Phaser.Scene): string {
  if (scene.textures.exists(WORK_TEX)) return WORK_TEX;
  const r = 6;
  const size = r * 2 + 3;
  const pix = new Pix(size, size);
  const c = Math.floor(size / 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      // A ring: the rim is drawn, the middle is not, so the building's own
      // contact shadow stays visible through it.
      if (d < r - 1.5 || d > r) continue;
      const i = (y * size + x) * 4;
      pix.data[i] = Number.parseInt(P.accent.slice(1, 3), 16);
      pix.data[i + 1] = Number.parseInt(P.accent.slice(3, 5), 16);
      pix.data[i + 2] = Number.parseInt(P.accent.slice(5, 7), 16);
      pix.data[i + 3] = 255;
    }
  }
  scene.textures.addCanvas(WORK_TEX, pix.toCanvas());
  return WORK_TEX;
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
      const key = hot ? WORK_TEX : EMBER_TEX;
      if (img.texture.key !== key) {
        img.setTexture(workingTexture(this.scene));
      }
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
