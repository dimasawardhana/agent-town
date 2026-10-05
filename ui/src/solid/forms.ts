// What a building is made of, at each rank of the ladder.
//
// **This is where the ladder becomes structural.** ADR-0018 says one rank adds
// exactly one part and a building is never seen to skip one; in the flat renderer
// that is an assertion about cels, and here it is a property of a list — the parts
// present at a rank are a prefix of `PART_FOR_RANK`, so a skipped or out-of-order
// part is not expressible rather than merely tested for.
//
// Pure, like `kit.ts`: it takes a `Site` and a rank and returns triangles. It
// imports the store's `BuildingState["status"]` as a *type*, so a rank the daemon
// can emit but the renderer cannot draw is a compile error — the same guarantee
// the store's own comment describes, now enforced on the solid side too.

import type { BuildingState, Site } from "../store";
import { band, extrude, gable, inset, lift, merge, setBack, type Foot, type SolidPart } from "./kit";

/** A rank of the construction ladder, taken from the wire's own vocabulary. */
export type Rank = BuildingState["status"];

/**
 * Every rank, in the order a building climbs them.
 *
 * Typed as `Record`-complete below, so **a rank added to the daemon is a compile
 * error here** rather than a building that silently draws at the wrong height.
 * That completeness check is the only thing keeping this list honest: the order
 * itself cannot be derived from a union type, so it is written once and every
 * member is required to appear in `PART_FOR_RANK`.
 */
export const RANKS: readonly Rank[] = [
  "planned", "foundation", "framed", "walled", "roofed", "glazed", "doored", "completed",
];

/** The one part each rank adds. */
export type PartName = "plot" | "footings" | "frame" | "walls" | "cap" | "glazing" | "door" | "trim";

/**
 * Which part each rank adds, and the ladder's whole content.
 *
 * `Record<Rank, PartName>` rather than a partial map: a rank with no entry would
 * mean a building that climbs to a rank and gains nothing, which is the "skips a
 * part" failure arriving through the back door.
 */
export const PART_FOR_RANK: Record<Rank, PartName> = {
  planned: "plot",
  foundation: "footings",
  framed: "frame",
  walled: "walls",
  roofed: "cap",
  glazed: "glazing",
  doored: "door",
  completed: "trim",
};

/**
 * The parts a building has earned at a rank.
 *
 * **A prefix, and that is the invariant.** Everything the ladder promises — one
 * part per rank, no skips, nothing removed as work continues — follows from this
 * being a slice rather than a set. A damaged building keeps its prefix; damage is
 * a condition and never a rank (ADR-0018).
 */
export function partsThrough(rank: Rank): PartName[] {
  const upTo = RANKS.indexOf(rank);
  if (upTo < 0) return [];
  return RANKS.slice(0, upTo + 1).map((r) => PART_FOR_RANK[r]);
}

/** World units per storey. Mirrors the flat renderer's `STOREY`. */
export const STOREY = 20;

/**
 * The most storeys a building may have.
 *
 * Mirrors the daemon's own cap and the flat renderer's, so the two renderers and
 * the analyzer cannot disagree about how tall the tallest building is. Pinned by
 * test against `art/stack.ts` rather than imported from it: that module belongs to
 * the frozen flat renderer (ADR-0024), and importing it into the solid path would
 * make a frozen file load-bearing again.
 */
export const MAX_FLOORS = 20;

/**
 * clampFloors is the one place a floor count becomes usable.
 *
 * Clamped rather than trusted. The count arrives from the daemon, and a renderer
 * that allocates geometry from a remote number is one bad value away from an
 * unusable tab — a building claiming 10,000 storeys would be 200,000 world units
 * of wall and a hundred thousand triangles. Zero and negatives become one storey,
 * because a building with no wall is not a building.
 */
export function clampFloors(floors: number): number {
  if (!Number.isFinite(floors)) return 1;
  return Math.min(MAX_FLOORS, Math.max(1, Math.floor(floors)));
}

/**
 * towerTop is the world z the cap's base sits at: the top of the topmost storey.
 *
 * A tower of N storeys has its storeys at z = 0 .. N*STOREY, so the cap goes at
 * N*STOREY. Getting this wrong by one is invisible on a one-storey building, which
 * is why it is a named function rather than arithmetic at the call site — the flat
 * renderer records the same reasoning for the same reason.
 */
export function towerTop(floors: number): number {
  return clampFloors(floors) * STOREY;
}

/** The role a part plays, which is what picks its colour. */
export type PartRole = "ground" | "stone" | "wall" | "frame" | "roof" | "glass" | "trim";

/** A part of a building, ready to become a mesh. */
export interface BuiltPart {
  readonly name: PartName;
  readonly role: PartRole;
  readonly geometry: SolidPart;
}

/** The plot a site occupies, in world units. */
function footOf(site: Site): Foot {
  return { cx: site.x + site.w / 2, cy: site.y + site.h / 2, w: site.w, d: site.h };
}

/**
 * solidFor builds one building's geometry at a rank.
 *
 * **Every measurement is a fraction of the footprint**, never an absolute — the
 * kit's rule (ADR-0023 §2), and the reason one form serves all five sizes. The
 * only absolute numbers are `STOREY`, which is the world's, and the storey count,
 * which is the daemon's.
 *
 * One archetype in one material for the spike: a mass that steps in as it rises,
 * a pitched cap, glazing, a door and a cornice. The twelve archetypes and five
 * materials are TASK-107, and this function is where they will arrive — as a table
 * of forms selected by (archetype, material) rather than as twelve branches here.
 */
export function solidFor(site: Site, rank: Rank): BuiltPart[] {
  const foot = footOf(site);
  const floors = clampFloors(site.floors ?? 1);
  const top = towerTop(floors);
  const short = Math.min(foot.w, foot.d);
  const parts = partsThrough(rank);
  const out: BuiltPart[] = [];

  for (const name of parts) {
    switch (name) {
      // The staked plot: a thin course of ground, slightly larger than the
      // building, so a planned site is visible without pretending to be a wall.
      case "plot":
        out.push({
          name,
          role: "ground",
          geometry: extrude({ ...foot, w: foot.w + short * 0.08, d: foot.d + short * 0.08 }, 0, 1.5),
        });
        break;

      // The plinth. Steps *out* rather than in — the one part that grows, which is
      // what makes the wall above it read as standing on something.
      case "footings":
        out.push({
          name,
          role: "stone",
          geometry: extrude({ ...foot, w: foot.w + short * 0.1, d: foot.d + short * 0.1 }, 0, 5),
        });
        break;

      // The frame: four corner posts and a ring of beams. Visible before the walls
      // arrive, so FRAMED is a building you can see through.
      case "frame": {
        const post = short * 0.06;
        const inner = inset(foot, 0.02);
        const x0 = inner.cx - inner.w / 2 + post / 2;
        const x1 = inner.cx + inner.w / 2 - post / 2;
        const y0 = inner.cy - inner.d / 2 + post / 2;
        const y1 = inner.cy + inner.d / 2 - post / 2;
        const posts = [
          [x0, y0], [x1, y0], [x1, y1], [x0, y1],
        ].map(([cx, cy]) =>
          extrude({ cx, cy, w: post, d: post }, 5, top),
        );
        const beams = [
          extrude({ cx: inner.cx, cy: y0, w: inner.w, d: post }, top - STOREY * 0.35, top - STOREY * 0.15),
          extrude({ cx: inner.cx, cy: y1, w: inner.w, d: post }, top - STOREY * 0.35, top - STOREY * 0.15),
          extrude({ cx: x0, cy: inner.cy, w: post, d: inner.d }, top - STOREY * 0.35, top - STOREY * 0.15),
          extrude({ cx: x1, cy: inner.cy, w: post, d: inner.d }, top - STOREY * 0.35, top - STOREY * 0.15),
        ];
        out.push({ name, role: "frame", geometry: merge([...posts, ...beams]) });
        break;
      }

      // The walls: one prism per storey, so the storey count is not a number the
      // renderer claims but a thing a reader can count. The topmost storey steps
      // in, which is the kit's `setBack` and the whole reason a mass reads as a
      // building rather than as a box.
      case "walls": {
        const courses: SolidPart[] = [];
        for (let i = 0; i < floors; i++) {
          const z0 = i * STOREY;
          const z1 = z0 + STOREY;
          const last = i === floors - 1;
          courses.push(
            last && floors > 1
              ? setBack(foot, z0, z1, 0.03)
              : extrude(inset(foot, 0.02), z0, z1),
          );
        }
        out.push({ name, role: "wall", geometry: merge(courses) });
        break;
      }

      // The cap, at the top of the topmost storey. `ridge` is a fraction of the
      // shorter side, so the roof keeps its pitch as the footprint changes.
      case "cap":
        out.push({
          name,
          role: "roof",
          geometry: gable(inset(foot, floors > 1 ? 0.03 : 0.02), top, 0.35),
        });
        break;

      // Glazing: a shallow course of window openings on two faces, one per storey.
      // Recessed rather than proud, because a window that sits on top of a wall
      // reads as a sticker and this is the whole reason the kit has a reveal.
      case "glazing": {
        const panes: SolidPart[] = [];
        const frames = Math.max(1, Math.round(foot.w / (short * 0.42)));
        const side = inset(foot, 0.02);
        for (let f = 0; f < floors; f++) {
          for (let i = 0; i < frames; i++) {
            const t = (i + 0.5) / frames;
            const cx = side.cx - side.w / 2 + side.w * t;
            const paneW = side.w / frames * 0.55;
            const z0 = f * STOREY + STOREY * 0.25;
            const z1 = z0 + STOREY * 0.45;
            // The two faces a fixed sun lights and shadows: this is the pair the
            // flat renderer calls the lit and shadow walls.
            panes.push(extrude({ cx, cy: side.cy + side.d / 2, w: paneW, d: short * 0.04 }, z0, z1));
            panes.push(extrude({ cx: side.cx + side.w / 2, cy: side.cy + side.d / 2 - side.d * t, w: short * 0.04, d: paneW }, z0, z1));
          }
        }
        out.push({ name, role: "glass", geometry: merge(panes) });
        break;
      }

      // The door: one opening on the wall facing the reader, tall enough to read
      // as an entrance at the fitted zoom rather than as a window on the ground.
      case "door": {
        const side = inset(foot, 0.02);
        const doorW = Math.max(short * 0.16, 4);
        out.push({
          name,
          role: "trim",
          geometry: extrude({ cx: side.cx, cy: side.cy + side.d / 2, w: doorW, d: short * 0.05 }, 1, STOREY * 0.9),
        });
        break;
      }

      // The cornice: a shallow course just under the cap, and the last thing a
      // building gains. Lifted so it clears the step-in the topmost storey makes.
      case "trim":
        out.push({
          name,
          role: "trim",
          geometry: lift(band(inset(foot, floors > 1 ? 0.03 : 0.02), top - 2.5, top, short * 0.05), 0),
        });
        break;
    }
  }

  return out;
}
