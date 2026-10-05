// The ground the town stands on, and the three places that sit on it.
//
// **Pure, like everything else in this directory**: it takes a layout and returns
// triangle soups with a colour role each. Nothing here knows that three.js exists.
//
// The vocabulary is the flat town's, restated and pinned by test — the seven ground
// kinds, the apron the field reaches past the town, and the reason the three places
// get three *different surfaces* rather than three tints of one. That reason is
// recorded in `art/terrain.ts` and it is worth carrying over whole: two of them
// sharing `earth` produced one continuous brown field with a divider across it, and
// a reader could not tell where one place ended and the next began — which is the
// only question the three places exist to answer.
//
// The field is sized from the **layout's own extent**, never from the sites, because
// the field does not come and go with the detail filter (ADR-0015): a deeper
// directory being hidden must not shrink the world out from under the town.

import { extrude, type Foot, type SolidPart } from "./kit";
import type { Layout, PlacedDistrict, Site } from "../store";

/** The seven surfaces the town is paved with, as `terrain.ts` names them. */
export type GroundKind = "grass" | "grassDark" | "yard" | "earth" | "deck" | "flags" | "road";

/** Every kind, in the order the flat renderer keeps them. */
export const GROUND_KINDS: readonly GroundKind[] = [
  "grass", "grassDark", "yard", "earth", "deck", "flags", "road",
];

/**
 * The colour role a surface is painted from.
 *
 * The scene maps a role to a palette ramp; this module decides only *which* role,
 * which is the part that is a judgement. The reason it is split from the ramp is
 * that `flags` is not the stone most people expect: `terrain.ts` gives it
 * `stone[2]` rather than `stone[1]` because the kerb's rim and lip both come from
 * the ramp's darkest step, so a surface sitting on that same step has an edge that
 * draws nothing. The tile renders and the boundary is invisible — the exact failure
 * the flat renderer's edge test exists to catch. **Raised a step is the minimum that
 * shows**, and the same correction is made here.
 */
export type GroundRole = "field" | "fieldDark" | "yard" | "earth" | "deck" | "flags" | "road";

/** Which colour each kind is drawn in. */
export const GROUND_ROLE: Record<GroundKind, GroundRole> = {
  grass: "field",
  grassDark: "fieldDark",
  // The three places, three surfaces — see the header.
  yard: "yard",
  earth: "earth",
  deck: "deck",
  flags: "flags",
  road: "road",
};

/**
 * How far the field reaches past the town's own ground, in world units.
 *
 * A copy of `visibility.ts`'s `LAND_APRON`, pinned by test rather than imported,
 * because that module belongs to the frozen flat renderer (ADR-0024).
 */
export const LAND_APRON = 900;

/**
 * How far the field reaches *behind* the town's near corner.
 *
 * Forward-only on purpose, and it is the same reasoning `landBox` records: a
 * symmetric apron pushes the far corner up as well as the near corners out, and a
 * far corner above the frame is a picture with no sky in it. It is not zero,
 * because a field whose edge is exactly the town's own corner puts the first
 * building on the boundary of the world.
 */
export const LAND_BACK = 48;

/**
 * How tall a kerb stands above the ground it edges.
 *
 * **Raised geometry rather than a painted line**, and the reason is the whole
 * ticket: a flat plane under good buildings reads as a paper diorama, and the thing
 * that stops it is a lip that catches the light and casts a shadow of its own. A
 * painted kerb would be exactly as invisible as the flat renderer's was once the
 * surface shared its darkest step.
 *
 * A few world units rather than a percentage: a kerb is a real object with a real
 * thickness, and it must survive the town being four times wider than the smallest
 * plot without becoming a wall.
 */
export const KERB_H = 3.5;

/** How far a kerb stands out from the section it edges, in world units. */
export const KERB_T = 2.5;

/** A surface the town is paved with. */
export interface GroundPatch {
  readonly kind: GroundKind;
  readonly geometry: SolidPart;
}

/** A section's kerb, as four raised runs around the section's outline. */
export interface Kerb {
  readonly role: GroundRole;
  readonly geometry: SolidPart;
}

/**
 * The field's own rectangle, from the layout's extent.
 *
 * **Not from the sites**, and this is the ticket's first acceptance criterion: the
 * layout's own `width`/`height` describe the ground the town was laid out on, and a
 * town whose sites are all at depth one still needs the field its layout describes.
 * Sizing from the sites would shrink the world to the buildings currently drawn,
 * which is a different town every time the detail filter moves.
 */
export function fieldRect(l: Layout): Foot {
  return {
    cx: l.width / 2,
    cy: l.height / 2,
    w: Math.max(1, l.width + LAND_APRON * 2),
    d: Math.max(1, l.height + LAND_APRON * 2),
  };
}

/** A district's ground: test districts are darker, because they are not source. */
function districtKind(d: PlacedDistrict): GroundKind {
  return d.kind === "test" ? "grassDark" : "grass";
}

/** A place's own surface — the claim that the three are different materials. */
function placeKind(site: Site): GroundKind {
  switch (site.kind) {
    case "yard":
      return "yard";
    case "workshop":
      return "deck";
    default:
      return "flags";
  }
}

/**
 * kerbFor is the raised lip around one section.
 *
 * Four runs rather than one ring, because a ring of boxes at the corners overlaps
 * and double-draws its own corners — and an overlapping pair of coplanar faces is
 * the z-fighting this ticket's raised kerbs are trying to avoid in the first place.
 */
function kerbFor(foot: Foot): SolidPart {
  const outer: Foot = {
    cx: foot.cx,
    cy: foot.cy,
    w: foot.w + KERB_T * 2,
    d: foot.d + KERB_T * 2,
  };
  const t = KERB_T;
  return {
    positions: [
      // Two runs along x, full width; two along y, shortened so the corners are
      // owned by exactly one run.
      ...extrude({ cx: outer.cx, cy: foot.cy - foot.d / 2, w: outer.w, d: t }, 0, KERB_H).positions,
      ...extrude({ cx: outer.cx, cy: foot.cy + foot.d / 2, w: outer.w, d: t }, 0, KERB_H).positions,
      ...extrude({ cx: outer.cx - foot.w / 2, cy: foot.cy, w: t, d: foot.d }, 0, KERB_H).positions,
      ...extrude({ cx: outer.cx + foot.w / 2, cy: foot.cy, w: t, d: foot.d }, 0, KERB_H).positions,
    ],
  };
}

/**
 * groundFor is everything under the town: the field, the districts, and the three
 * places, each with its own kerb.
 *
 * Returned as separate patches rather than one merged mesh, because each carries a
 * colour and a reader has to be able to tell the Yard's dirt from the Depot's
 * stone. Merging them would merge their colours too.
 *
 * The three places come **last and on top**: a place and a district can overlap in
 * plan, and whichever is drawn last wins. A place must win — an event landing on
 * the Yard has to be visibly on the Yard whatever lies under it.
 */
export function groundFor(l: Layout): { patches: GroundPatch[]; kerbs: Kerb[] } {
  const patches: GroundPatch[] = [];
  const kerbs: Kerb[] = [];

  // The field. Thin, and below everything, so it is the plane rather than a step.
  patches.push({ kind: "grass", geometry: extrude(fieldRect(l), -KERB_H, 0) });

  for (const d of l.districts) {
    const foot: Foot = { cx: d.x + d.w / 2, cy: d.y + d.h / 2, w: d.w, d: d.h };
    const kind = districtKind(d);
    patches.push({ kind, geometry: extrude(foot, 0, 1) });
    kerbs.push({ role: GROUND_ROLE[kind], geometry: kerbFor(foot) });
  }

  for (const s of l.sites) {
    if (s.kind !== "yard" && s.kind !== "workshop" && s.kind !== "depot") continue;
    const foot: Foot = { cx: s.x + s.w / 2, cy: s.y + s.h / 2, w: s.w, d: s.h };
    const kind = placeKind(s);
    // Lifted clear of a district's surface, so a place is visibly *on* the ground
    // rather than z-fighting with it — and a worker standing there is standing on
    // the place, which is what the last acceptance criterion is about.
    patches.push({ kind, geometry: extrude(foot, 1, 2) });
    kerbs.push({ role: GROUND_ROLE[kind], geometry: kerbFor(foot) });
  }

  return { patches, kerbs };
}

/** A thing that stands on a place. */
export interface Prop {
  readonly role: GroundRole;
  readonly geometry: SolidPart;
}

/** Deterministic 0..1 from a string — the same mixer the worker spread uses. */
function unitFrom(key: string): number[] {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const a = (h >>> 0) % 1000 / 1000;
  const b = (Math.imul(h, 2654435761) >>> 0) % 1000 / 1000;
  return [a, b];
}

/**
 * furnitureFor is what stands on a place.
 *
 * **Three kinds, one per place, and never more.** The Yard is scuffed ground with
 * stacked material on it, the Workshop is timber laid down to work on with a bench
 * at the edge, and the Depot is slabs with things stacked in racks. A prop is not
 * what tells a reader where a worker is — the caption is — but a worker on a bare
 * plate is a figure on a field, and the Yard holds roughly half of every session.
 *
 * Positions are hashed from the place's own id, so the same place is furnished the
 * same way every time a reader looks at it.
 */
export function furnitureFor(site: Site): Prop[] {
  if (site.kind !== "yard" && site.kind !== "workshop" && site.kind !== "depot") return [];

  const [a, b] = unitFrom(site.id);
  const foot: Foot = { cx: site.x + site.w / 2, cy: site.y + site.h / 2, w: site.w, d: site.h };
  // A third of the plate's smaller side, so the furniture reads at the fitted zoom
  // without a prop becoming a building.
  const u = Math.min(foot.w, foot.d) * 0.16;
  const out: Prop[] = [];

  if (site.kind === "yard") {
    // Stacked material, in the Yard's own dirt tones — two stacks, placed by the
    // hash so they are never in the same place twice.
    out.push({ role: "earth", geometry: extrude({ cx: foot.cx - foot.w * 0.25 + a * u, cy: foot.cy + foot.d * 0.2, w: u * 1.6, d: u * 1.2 }, 2, 2 + u * 0.5) });
    out.push({ role: "road", geometry: extrude({ cx: foot.cx + foot.w * 0.28 - b * u, cy: foot.cy - foot.d * 0.22, w: u * 1.2, d: u * 1.6 }, 2, 2 + u * 0.7) });
    return out;
  }

  if (site.kind === "workshop") {
    // A bench along the far edge, on the deck's own timber.
    out.push({ role: "deck", geometry: extrude({ cx: foot.cx, cy: foot.cy + foot.d * 0.3, w: foot.w * 0.35, d: u * 0.8 }, 2, 2 + u * 0.9) });
    return out;
  }

  // The Depot: stacked and inventoried, on stone.
  out.push({ role: "flags", geometry: extrude({ cx: foot.cx - foot.w * 0.22 + a * u * 0.5, cy: foot.cy, w: u * 0.7, d: foot.d * 0.4 }, 2, 2 + u * 1.4) });
  out.push({ role: "road", geometry: extrude({ cx: foot.cx + foot.w * 0.24 - b * u * 0.5, cy: foot.cy + foot.d * 0.12, w: u * 1.1, d: u * 1.1 }, 2, 2 + u * 0.8) });
  return out;
}

/** Every place in a layout, in the order the town draws them. */
export function placesOf(l: Layout): Site[] {
  return l.sites.filter(
    (s): s is Site & { kind: "yard" | "workshop" | "depot" } =>
      s.kind === "yard" || s.kind === "workshop" || s.kind === "depot",
  );
}
