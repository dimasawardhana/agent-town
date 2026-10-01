// The town from directly above.
//
// **This is not a camera, and the difference is the whole design.** The isometric
// art has its 2:1 skew baked into the pixels: every wall face, every window, every
// chimney, the crane's jib, a machine's cab — all of it is drawn as seen from the
// side and above. There is no transform that recovers a top-down view from that,
// because the information a top-down view would show (a roof plan, a footprint's
// true rectangle) is not in the picture. Rendering *this* art from overhead would
// mean re-authoring all 1145 cels.
//
// So the plan view draws the **layout** instead of the **art**: every plot as the
// rectangle it actually is, its name on it, districts outlined, roads as bands,
// the three places as their plates. It costs no atlas, no bake and no cel, and it
// is the picture for the question "what is where", which the isometric town is
// bad at answering because it draws size as height.
//
// **What it cannot show is height, and height is size here.** This town turns a
// directory's file count into floors, so every plot below is a rectangle and the
// single most important signal on the map is gone. Rather than drop it, the plan
// view carries it: the storey count is printed on the plot, and the fill follows
// the construction stage. A plan view that showed only footprints would be lying
// by omission, which is the one thing this project will not do.
//
// The projection is a plain `(x, y)` — no skew, no z — and it is deliberately the
// same `project` seam the isometric uses, so hit zones, labels and the panel all
// read the same coordinates in both modes and a click lands in the same place.

import type { Layout, Site } from "./store";

/** Which way the town is drawn. */
export type ViewMode = "iso" | "plan";

export function isViewMode(v: unknown): v is ViewMode {
  return v === "iso" || v === "plan";
}

/** PLAN_PAD is the world-unit margin left around the plan when it is fitted. */
export const PLAN_PAD = 24;

/**
 * planBox is the world-space box the plan view frames: the layout's own extent
 * plus a small margin.
 *
 * From the layout's corners rather than a guess, for the reason
 * `worldBounds` gives in the isometric path: a town that wraps into a district
 * wider than the analyzer's target would otherwise be framed short.
 */
export function planBox(l: Layout): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const take = (x: number, y: number, w: number, h: number): void => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  };
  take(0, 0, l.width, l.height);
  for (const d of l.districts) take(d.x, d.y, d.w, d.h);
  for (const s of l.sites) take(s.x, s.y, s.w, s.h);
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 1, h: 1 };
  return {
    x: minX - PLAN_PAD,
    y: minY - PLAN_PAD,
    w: maxX - minX + PLAN_PAD * 2,
    h: maxY - minY + PLAN_PAD * 2,
  };
}

/** The storey count a plot should print.
 *
 *  Clamped like the renderer clamps the building's own floors, so the number on a
 *  plot and the height of the building it stands for are the same claim. A plan
 *  saying "9" beside a tower of nine is a fact; a plan saying "11" beside a tower
 *  of nine is two of them. */
export function planFloors(s: Site): number {
  const n = Math.floor(s.floors ?? 1);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 32);
}
/** A plot's box in the plan view, in screen pixels. */
export interface PlanBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A crew's mark on a plot: where, how big, and whether it is the chief. */
export interface CrewMark {
  x: number;
  y: number;
  size: number;
  chief: boolean;
}

/**
 * planCrewMark is where one worker's mark sits on the plot it is standing on.
 *
 * **Pure, and extracted so ADR-0007 is testable.** The brief requires chief and
 * sub workers to be separable "at a glance", and a plan has no helmet to
 * separate them with — so the separation has to be geometry, and a rule nobody
 * can assert is a rule nobody has checked. Two marks of one colour on a plot
 * differ only by size and by the ink edge, and both differences matter: size is
 * what reads first at map zoom, the edge is what separates two chiefs on one
 * plot.
 *
 * The mark sits in the plot's top-right corner, clear of the storey count, which
 * owns the top-left.
 */
export function planCrewMark(
  worker: { tier: "chief" | "sub" },
  box: PlanBox,
): CrewMark {
  const chief = worker.tier !== "sub";
  const size = chief ? 9 : 5;
  return { x: box.x + box.w - size - 2, y: box.y + 2, size, chief };
}

/** planCrewSignature is the whole crew as one string, for the "has anything
 *  changed" test that stops the plan rebuilding its marks every frame. */
export function planCrewSignature(
  workers: readonly { id: string; place: string; tier: string; agent: string }[],
): string {
  return workers.map((w) => `${w.id}:${w.place}:${w.tier}:${w.agent}`).join("|");
}
