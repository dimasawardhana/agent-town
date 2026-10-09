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
import { band, chamfer, extrude, inset, lift, merge, roofOverhang, setBack, sweep, windowReveal, type Foot, type SolidPart, type SweepProfilePoint } from "./kit";
import { DISTRICT_TOP } from "./ground";
import { stableOffset } from "./machine";

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

/**
 * The roof's pitch, as a fraction of the shorter side, so the cap keeps its shape
 * as the footprint changes.
 */
export const ROOF_RIDGE = 0.35;

const GABLE_PROFILE: readonly SweepProfilePoint[] = [
  { across: -0.5, height: 0 },
  { across: 0, height: ROOF_RIDGE },
  { across: 0.5, height: 0 },
];

/**
 * towerReach is an upper bound on how high a building reaches, in world units.
 *
 * **A bound rather than the exact apex, and the direction matters.** This feeds the
 * camera's fit, and a fit that is slightly too tall only adds margin while a fit
 * that is slightly too short crops a roof off the top of the town. The closed form
 * is the top storey plus a full roof on the *un-inset* footprint, which is a little
 * above the real apex because the cap is inset — too tall, which is the safe way to
 * be wrong.
 *
 * It exists because the fit was computed from the ground alone, and a town's
 * footprint says nothing about its height. Measured on this town: the tallest
 * building is 20 storeys, so its roof sits 400 world units up, and the camera —
 * fitted to the ground — put it outside the frustum entirely. The building was
 * `building:ui` at 29 files, and two of its meshes drew **zero** pixels from any
 * camera angle. A reader whose largest project is missing from the view is the
 * exact failure the whole spike exists to avoid.
 */
export function towerReach(site: Site): number {
  return towerTop(site.floors ?? 1) + Math.min(site.w, site.h) * ROOF_RIDGE;
}
/** The role a part plays, which is what picks its colour. */
export type PartRole = "ground" | "stone" | "wall" | "frame" | "roof" | "glass" | "trim";

export interface BuiltPart {
  readonly name: PartName;
  readonly role: PartRole;
  readonly geometry: SolidPart;
  /** One deterministic shade factor per non-indexed vertex, derived from part height and footprint corners. */
  readonly shade?: readonly number[];
}
function cornerShade(geometry: SolidPart, foot: Foot): readonly number[] {
  const x0 = foot.cx - foot.w / 2, x1 = foot.cx + foot.w / 2;
  const y0 = foot.cy - foot.d / 2, y1 = foot.cy + foot.d / 2;
  const shade: number[] = [];
  for (let i = 0; i < geometry.positions.length; i += 3) {
    const x = geometry.positions[i], y = geometry.positions[i + 1], z = geometry.positions[i + 2];
    const cornerX = Math.min(Math.abs(x - x0), Math.abs(x - x1));
    const cornerY = Math.min(Math.abs(y - y0), Math.abs(y - y1));
    const nearCorner = cornerX < foot.w * 0.12 && cornerY < foot.d * 0.12;
    const low = z < STOREY * 1.1;
    shade.push(nearCorner && low ? 0.78 : 1);
  }
  return shade;
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
      case "plot":
        out.push({
          name,
          role: "ground",
          geometry: extrude({ ...foot, w: foot.w + short * 0.08, d: foot.d + short * 0.08 }, 0, 1.5),
        });
        break;

      // A raised low base band makes the wall visibly sit on the plinth.
      case "footings":
        out.push({
          name,
          role: "stone",
          geometry: merge([
            extrude({ ...foot, w: foot.w + short * 0.1, d: foot.d + short * 0.1 }, 0, 2),
            chamfer({ ...foot, w: foot.w + short * 0.1, d: foot.d + short * 0.1 }, 2, 5, 0.025),
          ]),
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

      // The cap, at the top of the topmost storey.
      case "cap":
        out.push({
          name,
          role: "roof",
          geometry: roofOverhang(inset(foot, floors > 1 ? 0.03 : 0.02), top, short * ROOF_RIDGE, 0.045),
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
            panes.push(windowReveal({ cx, cy: side.cy + side.d / 2 - short * 0.025, w: paneW, d: short * 0.04 }, z0, z1, 0.5));
            panes.push(windowReveal({ cx: side.cx + side.w / 2 - short * 0.025, cy: side.cy + side.d / 2 - side.d * t, w: short * 0.04, d: paneW }, z0, z1, 0.5));
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

  return out.map((part) => ({ ...part, shade: cornerShade(part.geometry, foot) }));
}

/**
 * rubbleFor is a damaged building's mark, laid **beside** the ladder, never on
 * it.
 *
 * ADR-0018 makes damage a condition: `solidFor` takes a rank and nothing else
 * (asserted in `solid.test.ts`), so the rubble cannot arrive through the parts
 * list — it is extra geometry laid at the base, the way `buildBaseDamageCel`
 * piles it in the flat town, and it takes no part away. The mark waits for a
 * mass to pile against, as the flat one does: a staked plot draws none.
 *
 * The pile is **a pure function of the site**, hashed through `stableOffset` —
 * the same FNV mixer that keeps a worker on its spot across a rebuild — so the
 * same broken building does not shift its rubble every time the daemon speaks.
 * Every measurement is a fraction of the footprint, per the kit's rule, and the
 * pile never reaches a storey: rubble is what a building lost, and must never
 * read as a part it gained.
 */
export function rubbleFor(site: Site, rank: Rank): SolidPart {
  if (rank === "planned" || !site.path) return { positions: [] };
  const foot = footOf(site);
  const short = Math.min(foot.w, foot.d);
  const at = stableOffset(site.path);
  const cx = foot.cx + at.x * foot.w * 0.28;
  const cy = foot.cy + at.y * foot.d * 0.28;
  const w = short * 0.22;
  const d = short * 0.16;
  return merge([
    extrude({ cx, cy, w, d }, DISTRICT_TOP, DISTRICT_TOP + short * 0.16),
    extrude({ cx: cx + w * 0.4, cy: cy - d * 0.5, w: w * 0.55, d: d * 0.5 }, DISTRICT_TOP, DISTRICT_TOP + short * 0.1),
  ]);
}
