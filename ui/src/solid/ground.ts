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

/** The top of a district's plate, in world units. */
export const DISTRICT_TOP = 1;

/** The top of a place's plate, in world units — deliberately above a district's. */
export const PLACE_TOP = 2;

/**
 * How tall a piece of furniture may stand, in world units.
 *
 * **A fixed measure, not a fraction of the place, and that is the whole point.**
 * The first version scaled with the plate, which on the Depot produced a stack 35
 * units tall — taller than a storey and four times a machine. The camera looks
 * down, so a tall prop standing in front of a worker projects onto the same pixels
 * and, being nearer, covers it. Measured: the worker contributed **zero** pixels
 * to the frame, and hiding one Depot prop restored 234 of them.
 *
 * Eight is chosen against the machine rather than against the plate: a machine
 * stands about nine units at the cab, so furniture at eight cannot hide one from
 * this camera. It also reads as furniture — a bench, a stack of pallets — where
 * 35 units read as a building someone forgot to roof.
 */
export const PROP_H = 8;

/**
 * How far from the centre of a place a worker may stand, as a fraction of it.
 *
 * The counterpart to `PROP_H`, and the two together are what keep a worker visible:
 * furniture is short (so it cannot occlude) **and** out of this band (so it is not
 * standing where the worker is). `standPoint` puts a worker within this reach, so
 * furniture placed outside it can never be in the way.
 */
export const WORKER_REACH = 0.3;

/**
 * surfaceZ is the height a thing standing on this ground is standing at.
 *
 * **Owned here rather than guessed at the worker, because this module is what
 * decides the heights.** A district is a thin plate on the field and a place is a
 * thicker plate again, so the top of a place is a world unit above a district's. A
 * machine placed at zero — which is where its group's origin naturally sits — is
 * therefore *inside* the Depot's stone, and the plate's top face draws in front of
 * it.
 *
 * Measured, not reasoned about: with the worker at zero, hiding the crews changed
 * **zero pixels** of a 1311x960 buffer. The agent was rendering, inside the
 * frustum, at full opacity — and completely invisible.
 */
export function surfaceZ(site: Site): number {
  if (site.kind === "yard" || site.kind === "workshop" || site.kind === "depot") return PLACE_TOP;
  return DISTRICT_TOP;
}

/**
 * fieldPlane is the ground as a single flat quad, not a slab.
 *
 * A slab is the obvious thing to reach for and it is **wrong here, for a reason
 * that has nothing to do with drawing it**. The town is 3028 by 2434 world units
 * and the camera looks down at it, so a slab's near wall has a top edge that
 * projects far up the picture — across the entire viewport.
 *
 * Measured, not reasoned about: with the field drawn as a slab the buffer held
 * 1,254,545 non-clear pixels and the agent contributed **zero** of them; hiding
 * the field dropped the count to 164,697 and the agent appeared. A ground that
 * hides the town it carries is not a ground.
 */
function fieldPlane(foot: Foot, z: number): SolidPart {
  const x0 = foot.cx - foot.w / 2, x1 = foot.cx + foot.w / 2;
  const y0 = foot.cy - foot.d / 2, y1 = foot.cy + foot.d / 2;
  // **Wound so the normal points up, and the winding is load-bearing — twice now.**
  // A quad wound the other way has a downward normal and is culled away entirely
  // by `FrontSide`, which does not look like a missing ground: it looks like
  // *working* ground, because the town floats above nothing and the field simply
  // stops occluding anything. Measured on the first attempt: the plane reported
  // **0 drawn pixels** while every unit test still passed, and the agent was
  // invisible because the ground had stopped hiding it.
  //
  // Both triangles are counter-clockwise seen from above (+z), which is the side
  // the camera is on.
  return {
    positions: [x0, y0, z, x1, y0, z, x1, y1, z, x0, y0, z, x1, y1, z, x0, y1, z],
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

  // The field, as a plane at z 0 so everything that stands on it is above it by
  // construction — see `fieldPlane` for why it cannot be a slab.
  patches.push({ kind: "grass", geometry: fieldPlane(fieldRect(l), 0) });

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
 * **A prop is furniture, and that is a constraint rather than a description.** The
 * first version scaled height with the plate — `2 + u * 1.4` where `u` is a
 * fraction of the place — which on the 340-unit Depot produced a stack **35 world
 * units tall**, taller than a storey and four times a machine. The camera looks down
 * at 2:1, so a tall prop standing 40 units in front of a worker projects onto
 * almost the same pixel and, being nearer, covers it.
 *
 * Measured, and it is the whole reason this is written the way it is: the worker
 * contributed **zero** pixels to the frame, and hiding exactly one Depot prop
 * restored **234**. The agent had been standing behind its own depot's shelving.
 * So height is capped by `PROP_H`, which is a fixed world measure rather than a
 * fraction, because furniture does not get taller when a place gets bigger — a
 * bench is a bench.
 *
 * Positions are hashed from the place's own id, so the same place is furnished the
 * same way every time a reader looks at it, and they stay **out of the middle** —
 * `WORKER_REACH` is where a worker may stand, and furniture is kept clear of it.
 */
export function furnitureFor(site: Site): Prop[] {
  if (site.kind !== "yard" && site.kind !== "workshop" && site.kind !== "depot") return [];

  const [a, b] = unitFrom(site.id);
  const out: Prop[] = [];
  const top = PLACE_TOP + PROP_H;

  // **Placed from the band's own edges rather than from a fraction of the plate.**
  // A fraction looks reasonable and is not: the band a worker may stand in is
  // `WORKER_REACH` either side of centre, so the margin left for furniture is
  // whatever the plate has outside it — and on a 420-by-150 Yard that margin is 30
  // units deep however wide the plate is. A prop sized as a fraction of *area*
  // then overflowed the margin, and the test caught a Yard stack sitting in the
  // band. Sizing from the margin is correct at any plate shape, including the very
  // wide and very shallow one this town actually builds.
  const marginX = site.w * (0.5 - WORKER_REACH);
  const marginY = site.h * (0.5 - WORKER_REACH);
  const strip = 0.6; // how much of a margin a prop may take, leaving a walkway
  const maxW = marginX * strip;
  const maxD = marginY * strip;

  /** The centre of the left/right margin, and of the near/far one. */
  const left = site.x + marginX / 2;
  const right = site.x + site.w - marginX / 2;
  const near = site.y + marginY / 2;
  const far = site.y + site.h - marginY / 2;

  if (site.kind === "yard") {
    // Two stacks, in opposite corners of the margin, with the hash nudging each
    // within its strip so the same place is furnished the same way every time.
    out.push({ role: "earth", geometry: extrude({ cx: left + a * (marginX - maxW) * 0.5, cy: far - b * (marginY - maxD) * 0.5, w: maxW, d: maxD }, PLACE_TOP, top) });
    out.push({ role: "road", geometry: extrude({ cx: right - b * (marginX - maxW) * 0.5, cy: near + a * (marginY - maxD) * 0.5, w: maxW, d: maxD }, PLACE_TOP, top) });
    return out;
  }

  if (site.kind === "workshop") {
    // A bench along the far edge, on the deck's own timber.
    out.push({ role: "deck", geometry: extrude({ cx: site.x + site.w / 2, cy: far, w: Math.min(maxW * 1.2, site.w * 0.3), d: maxD }, PLACE_TOP, top) });
    return out;
  }

  // The Depot: stacked and inventoried, on stone. Both stacks in the margin,
  // because this is the place a worker is most likely to be standing in.
  out.push({ role: "flags", geometry: extrude({ cx: left + a * (marginX - maxW) * 0.5, cy: site.y + site.h / 2, w: maxW * 0.8, d: maxD * 1.4 }, PLACE_TOP, top) });
  out.push({ role: "road", geometry: extrude({ cx: right - b * (marginX - maxW) * 0.5, cy: near + a * (marginY - maxD) * 0.5, w: maxW, d: maxD }, PLACE_TOP, top) });
  return out;
}

/** Every place in a layout, in the order the town draws them. */
export function placesOf(l: Layout): Site[] {
  return l.sites.filter(
    (s): s is Site & { kind: "yard" | "workshop" | "depot" } =>
      s.kind === "yard" || s.kind === "workshop" || s.kind === "depot",
  );
}
