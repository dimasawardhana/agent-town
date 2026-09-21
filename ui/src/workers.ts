// Workers: the animated figures that move to where the agent is working.
//
// This is the product. Everything else exists so that a worker can stand on
// the right building and visibly do the thing the agent is doing.

import Phaser from "phaser";
import type { Action, BuildingState, Site, Worker } from "./store";

// How long a worker takes to cross the town, in milliseconds. Long enough to
// read as movement, short enough that a fast agent does not leave workers
// trailing far behind what actually happened.
const WALK_MS = 520;

// The radius of the circle a worker is drawn as. A chief is larger, so a
// glance separates the agent driving a session from anything it spawned.
const CHIEF_R = 9;
const SUB_R = 6;

// Colours per agent, so two crews on one repo are tellable apart. Assigned by
// hashing the agent name, which keeps a given agent the same colour across
// sessions and restarts.
const AGENT_COLOURS = [0x6fb3d9, 0xd9a66f, 0x9d7fd9, 0x6fd9a6, 0xd96f8f, 0xc9d96f];

/** Colour a worker by the agent driving it. */
export function agentColour(agent: string): number {
  let h = 0;
  for (let i = 0; i < agent.length; i++) h = (h * 31 + agent.charCodeAt(i)) | 0;
  return AGENT_COLOURS[Math.abs(h) % AGENT_COLOURS.length];
}

// Status tints a building, so damage and completion read at a glance.
const STATUS_TINT: Record<BuildingState["status"], number> = {
  untouched: 0x4a5568,
  constructing: 0x5a7a5f,
  testing: 0x4a6a8a,
  completed: 0x6a8a6a,
  broken: 0x8a4a4a,
};

/**
 * WorkerLayer owns the moving parts of the town: the figures, their labels,
 * and the pulsing rings that show what they are doing.
 *
 * It is a separate object from the scene because the scene's job is the map —
 * districts, buildings, camera — and this is the thing on it. Keeping them
 * apart means a redraw of the map does not have to reason about animation.
 */
export class WorkerLayer {
  private scene: Phaser.Scene;
  private figures = new Map<string, Phaser.GameObjects.Arc>();
  private labels = new Map<string, Phaser.GameObjects.Text>();
  private rings = new Map<string, Phaser.GameObjects.Arc>();
  private tweening = new Set<string>();
  // Tints are redrawn wholesale on every sync, so the previous pass is
  // destroyed first. Leaving them would accumulate a Graphics object per
  // building per event, and each pass re-drew at 0.55 alpha over the last —
  // so touched buildings visibly darkened as a session went on.
  private tints: Phaser.GameObjects.Graphics[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * sync reconciles the drawn figures with the workers the daemon reports.
   *
   * It moves existing figures rather than rebuilding them, so a worker
   * walking from one building to another visibly walks instead of blinking
   * to the destination.
   */
  sync(workers: Worker[], sites: Site[]): void {
    const places = new Map<string, Site>();
    for (const s of sites) places.set(s.id, s);
    // A worker on a building that no longer exists falls back to the Yard,
    // because somewhere real beats a missing figure.
    const fallback = places.get("yard");

    const seen = new Set<string>();

    for (const w of workers) {
      seen.add(w.id);
      const site = places.get(w.place) ?? fallback;
      if (!site) continue;

      const x = site.x + site.w / 2;
      const y = site.y + site.h / 2;
      const colour = agentColour(w.agent);
      const radius = w.tier === "sub" ? SUB_R : CHIEF_R;

      let fig = this.figures.get(w.id);
      if (!fig) {
        fig = this.scene.add.circle(x, y, radius, colour);
        fig.setStrokeStyle(1, 0x11161d, 0.9);
        this.figures.set(w.id, fig);

        const ring = this.scene.add.circle(x, y, radius + 4);
        ring.setFillStyle(colour, 0);
        ring.setStrokeStyle(2, colour, 0.5);
        this.rings.set(w.id, ring);

        const label = this.scene.add.text(x, y + radius + 3, w.label, {
          fontFamily: "ui-monospace, monospace",
          fontSize: "9px",
          color: "#cfe0ef",
        });
        label.setOrigin(0.5, 0);
        this.labels.set(w.id, label);
      } else if (fig.radius !== radius) {
        fig.setRadius(radius);
      }

      this.move(w.id, fig, x, y);

      const ring = this.rings.get(w.id);
      if (ring) {
        ring.setPosition(fig.x, fig.y);
        ring.setStrokeStyle(2, colour, this.ringAlpha(w.action));
      }

      const label = this.labels.get(w.id);
      if (label) {
        label.setPosition(fig.x, fig.y + radius + 3);
        if (label.text !== w.label) label.setText(w.label);
      }
    }

    // Anything the daemon no longer reports is gone: a crew that left has
    // left, and leaving its figures behind would misrepresent the town.
    for (const id of this.figures.keys()) {
      if (seen.has(id)) continue;
      this.figures.get(id)?.destroy();
      this.labels.get(id)?.destroy();
      this.rings.get(id)?.destroy();
      this.figures.delete(id);
      this.labels.delete(id);
      this.rings.delete(id);
    }
  }

  /** move walks a figure to a target, or places it if already there. */
  private move(id: string, fig: Phaser.GameObjects.Arc, x: number, y: number): void {
    if (fig.x === x && fig.y === y) return;

    // Let an in-flight walk finish rather than restarting it, which would
    // leave a fast agent's worker jittering in place.
    if (this.tweening.has(id)) return;
    if (Math.hypot(fig.x - x, fig.y - y) < 2) {
      fig.setPosition(x, y);
      return;
    }

    this.tweening.add(id);
    this.scene.tweens.add({
      targets: fig,
      x,
      y,
      duration: WALK_MS,
      ease: "Sine.easeInOut",
      onComplete: () => this.tweening.delete(id),
    });
  }

  /**
   * ringAlpha makes the ring pulse per action, so a worker that is working
   * looks different from one that is idle without needing new art.
   */
  private ringAlpha(action: Action): number {
    switch (action) {
      case "hammering":
      case "building":
      case "demolishing":
        return 0.85; // loud: something is being changed
      case "testing":
        return 0.6;
      case "reading":
        return 0.3;
      case "planning":
      case "commanding":
        return 0.2;
      case "celebrating":
        return 0.9;
      default:
        return 0.15;
    }
  }

  /** tint paints building states onto their drawn rectangles. */
  tint(sites: Site[], buildings: BuildingState[]): void {
    // Replace the previous pass rather than drawing over it.
    for (const g of this.tints) g.destroy();
    this.tints = [];

    const byPath = new Map<string, BuildingState>();
    for (const b of buildings) byPath.set(b.path, b);

    for (const s of sites) {
      if (s.kind !== "building" || !s.path) continue;
      const b = byPath.get(s.path);
      if (!b || b.status === "untouched") continue;

      const colour = STATUS_TINT[b.status];
      const g = this.scene.add.graphics();
      g.fillStyle(colour, 0.55);
      g.fillRoundedRect(s.x, s.y, s.w, s.h, 4);
      g.lineStyle(2, colour, 0.9);
      g.strokeRoundedRect(s.x, s.y, s.w, s.h, 4);
      this.tints.push(g);
    }
  }

  /** destroy tears down every figure. Used when the map is rebuilt. */
  destroy(): void {
    for (const g of this.tints) g.destroy();
    this.tints = [];
    for (const o of [
      ...this.figures.values(),
      ...this.labels.values(),
      ...this.rings.values(),
    ]) {
      o.destroy();
    }
    this.figures.clear();
    this.labels.clear();
    this.rings.clear();
    this.tweening.clear();
  }
}
