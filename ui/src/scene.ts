// The town, drawn in Phaser.
//
// This ticket renders a static town: districts as blocks, buildings sized by
// source-file count, the three special places pinned across the top. Nothing
// moves — ticket 05 adds workers.
//
// Phaser owns the camera (ADR-0002). Pan and zoom are entirely local, which
// is why the transport can be one-way.

import Phaser from "phaser";
import type { Layout, Site } from "./store";
import { useTown } from "./store";

// Colours by place kind. Deliberately few and flat: the town's meaning comes
// from position and size, not from colour.
const COLOURS = {
  building: 0x4a5568,
  // Test territory reads cooler, so a glance separates the code from the
  // tests without needing a legend.
  buildingTest: 0x3d5a6c,
  workshop: 0x7a6248,
  yard: 0x3f5a43,
  depot: 0x6b4a6b,
};

const STROKE = 0x8fa3b8;
const LABEL = "#dce3ea";
const DISTRICT_LABEL = "#93a4b8";

export class TownScene extends Phaser.Scene {
  private layout: Layout | null = null;
  private dragging = false;
  private dragStart = { x: 0, y: 0, sx: 0, sy: 0 };
  private moved = 0;

  constructor() {
    super("town");
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x11161d);

    // Read whatever the store already holds. If the fetch finished before
    // the scene booted, the town draws immediately rather than waiting.
    const { layout } = useTown.getState();
    if (layout) this.draw(layout);

    // A later fetch or reconnect redraws.
    useTown.subscribe((s, prev) => {
      if (s.layout && s.layout !== prev.layout) this.draw(s.layout);
    });
  }

  /** draw renders a layout, replacing anything already on screen. */
  draw(layout: Layout): void {
    this.layout = layout;
    this.children.removeAll(true);

    // Districts first, so buildings draw on top of their block.
    for (const d of layout.districts) {
      const g = this.add.graphics();
      g.fillStyle(0x1a222c, 1);
      g.fillRoundedRect(d.x, d.y, d.w, d.h, 8);
      g.lineStyle(1, 0x2b3644, 1);
      g.strokeRoundedRect(d.x, d.y, d.w, d.h, 8);

      const label = this.add.text(d.x + 12, d.y + 8, d.name.toUpperCase(), {
        fontFamily: "ui-monospace, monospace",
        fontSize: "12px",
        color: DISTRICT_LABEL,
      });
      label.setAlpha(0.9);

      // A test district says so, so the reader is never guessing whether a
      // cluster is product code.
      if (d.kind === "test") {
        this.add
          .text(d.x + d.w - 12, d.y + 8, "tests", {
            fontFamily: "ui-monospace, monospace",
            fontSize: "10px",
            color: DISTRICT_LABEL,
          })
          .setOrigin(1, 0)
          .setAlpha(0.7);
      }
    }

    // Sites.
    for (const s of layout.sites) {
      const inTest = layout.districts.some(
        (d) =>
          d.kind === "test" &&
          this.overlaps(s, d),
      );
      this.drawSite(s, inTest);
    }

    // A canvas smaller than the viewport would let the camera drift into
    // empty space; pad the world so bounds always contain the town.
    this.cameras.main.setBounds(-200, -200, layout.width + 400, layout.height + 400);
    this.cameras.main.setZoom(this.fitZoom(layout));

    // Pan with drag, zoom with wheel. Entirely local to Phaser.
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      this.dragging = true;
      this.moved = 0;
      this.dragStart = { x: p.x, y: p.y, sx: this.cameras.main.scrollX, sy: this.cameras.main.scrollY };
    });
    this.input.on("pointerup", () => (this.dragging = false));
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!this.dragging) return;
      const dx = p.x - this.dragStart.x;
      const dy = p.y - this.dragStart.y;
      this.moved = Math.abs(dx) + Math.abs(dy);
      this.cameras.main.scrollX = this.dragStart.sx - dx / this.cameras.main.zoom;
      this.cameras.main.scrollY = this.dragStart.sy - dy / this.cameras.main.zoom;
    });
    this.input.on(
      "wheel",
      (_p: unknown, _o: unknown, _dx: number, dy: number) => {
        const cam = this.cameras.main;
        const next = Phaser.Math.Clamp(cam.zoom - dy * 0.001, 0.25, 3);
        cam.setZoom(next);
      },
    );
  }

  private drawSite(s: Site, inTest: boolean): void {
    const colour =
      s.kind === "building"
        ? inTest
          ? COLOURS.buildingTest
          : COLOURS.building
        : (COLOURS[s.kind as keyof typeof COLOURS] ?? COLOURS.building);

    const g = this.add.graphics();
    g.fillStyle(colour, 1);
    g.fillRoundedRect(s.x, s.y, s.w, s.h, s.kind === "building" ? 4 : 10);
    g.lineStyle(1, STROKE, 0.35);
    g.strokeRoundedRect(s.x, s.y, s.w, s.h, s.kind === "building" ? 4 : 10);

    // Labels only when there is room; a 44px building cannot hold a name.
    if (s.w >= 60 && s.kind === "building") {
      this.add
        .text(s.x + s.w / 2, s.y + s.h / 2, s.label, {
          fontFamily: "ui-monospace, monospace",
          fontSize: s.w >= 90 ? "12px" : "10px",
          color: LABEL,
        })
        .setOrigin(0.5);
    } else if (s.kind !== "building") {
      this.add
        .text(s.x + 14, s.y + 12, s.label, {
          fontFamily: "ui-monospace, monospace",
          fontSize: "14px",
          color: LABEL,
        })
        .setAlpha(0.95);
    }

    // Clickable, for the building-details panel. A drag must not count as a
    // click, hence the distance check.
    const zone = this.add
      .zone(s.x, s.y, s.w, s.h)
      .setOrigin(0)
      .setInteractive({ useHandCursor: true });
    zone.on("pointerup", () => {
      if (this.moved < 5) useTown.getState().select(s);
    });
  }

  private overlaps(s: Site, d: { x: number; y: number; w: number; h: number }): boolean {
    return s.x >= d.x && s.y >= d.y && s.x + s.w <= d.x + d.w && s.y + s.h <= d.y + d.h;
  }

  /** fitZoom scales the town to the viewport on first load. */
  private fitZoom(l: Layout): number {
    const w = this.scale.width;
    const h = this.scale.height;
    return Phaser.Math.Clamp(Math.min(w / (l.width + 80), h / (l.height + 80)), 0.25, 1.2);
  }
}
