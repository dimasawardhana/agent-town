// The prop vocabulary: every object that furnishes a place, grouped by where
// it belongs.
//
// This is a leaf module on purpose. The registry needs the full list to be a
// total `Record`, and each group's own drawing file needs its own subset to
// type itself against — so the names live here, where both can reach them
// without a cycle and without either restating the other.
//
// The groups are the single source of truth in three directions:
//
//   - `PropKind` is *derived* from the concatenated groups, so a name can never
//     be in the type and missing from the runtime list.
//   - Each group's drawer record is a checked total `Record<GroupKind, Drawer>`,
//     so a group can never be missing a drawing for a name it declares.
//   - A test asserts the groups are disjoint, so a name in two groups is a
//     failure rather than a silent overwrite of one drawing by the other.
//
// All of that matters because an undrawn or duplicated prop is invisible: the
// bake would omit it (or keep the last of two), every sweep would pass, and the
// place would quietly render one object short of what it claims.
//
// Read top to bottom, the groups say what each place is *for*. The same story
// is told in prose by the blurbs in `src/place.ts`, and the two are meant to
// agree — a place advertising work it has no furniture for is the drift this
// structure exists to make impossible.

import type { IsoPix } from "../iso";
import type { Ink } from "../surface";

/** How a prop is drawn. `variant` nudges proportions so a row of five barrels
 *  is not one barrel stamped five times. It is deterministic and never random,
 *  because the same town must always draw the same picture (ADR-0012). */
export type Drawer = (iso: IsoPix, variant: number) => void;

/**
 * The colours one volume of a prop is shaded with.
 *
 * The light is up and to the left (see `iso.ts`), so `lit` is the lower-left
 * face and `shadow` the lower-right. `edge` is the optional ink line where a
 * box meets its ground.
 */
export interface Shade {
  top: Ink;
  lit: Ink;
  shadow: Ink;
  edge?: Ink;
}

/**
 * A prop's cel box, in pixels.
 *
 * Sized for the tallest prop — a ladder and a crane jib both reach about 26
 * world units — rather than per prop, because the scene places every prop with
 * the same subtraction and a per-prop box would need a per-prop origin. The
 * cost is a few hundred unused pixels per cel in a texture uploaded once at
 * boot, against a placement rule with one case instead of fifty-four.
 */
export const CEL = 44;

/**
 * Where the cel's origin sits: the prop's own footprint origin, world (0, 0, 0).
 *
 * Every prop is drawn with its footprint's near corner at the world origin, so
 * placing any of them is the same subtraction — which is why this is one
 * constant and not a table. A prop overhanging its footprint (a barrow's
 * handles, a crane's jib, a sign's board) draws into negative world coordinates
 * instead, and the margins here are what give it room: 24 pixels of reach left,
 * right and upward, 19 downward.
 */
export const PROP_ORIGIN = { x: 22, y: 28 };

// --- The groups ------------------------------------------------------------
//
// `as const` rather than plain arrays so each element is its own literal type
// and the derived unions below are exact.

/** Stock every kind of site needs, so no place is ever a bare field. These are
 *  the props that make a site read as *working* before you can tell what work
 *  it is. */
export const SHARED_KINDS = [
  "barrel",
  "bollard",
  "bricks",
  "crate",
  "lamp",
  "lumber",
  "sack",
  "sawhorse",
  "signpost",
  "stool",
  "toolchest",
  "wheelbarrow",
] as const;

/** The Yard: site-wide work, so the Yard is plant and bulk material.
 *
 *  Tests, builds, git and installs act on the whole town rather than one
 *  building, so the furniture here is what a whole site needs and no single
 *  building would own: lifting gear, power, spoil, long stock. Nothing here is
 *  a hand tool — a hand tool is the Workshop's — and holding that line is what
 *  makes the two places tell apart at a glance. */
export const YARD_KINDS = [
  "cableDrum",
  "cone",
  "crane",
  "generator",
  "girders",
  "mixer",
  "pallet",
  "pipeStack",
  "rubble",
  "skip",
  "tripod",
  "waterbutt",
] as const;

/** The Workshop: one job at a bench, so the Workshop is machines and stock.
 *
 *  Root files are worked here — a manifest, a readme, a config — and they are
 *  worked *by hand*. The set is therefore a shop floor: the bench, the machines
 *  that hang off it, the rack the stock comes from, and the floor's own
 *  debris. */
export const WORKSHOP_KINDS = [
  "bandsaw",
  "grindstone",
  "shavings",
  "timberRack",
  "toolboard",
  "trestle",
  "vise",
  "workbench",
] as const;

/** Hand tools, hung on the Workshop's wall or left in the Yard's clutter.
 *
 *  They exist for two reasons. A shop with nothing on its walls is a room, not
 *  a workshop — and these are the same tools the *workers* carry, so the wall
 *  and the moving figures agree about what is being used. `ladder` is the one
 *  exception to the small size: it is the tallest prop in the town, which is
 *  what makes a scaffolded building read as being worked on. */
export const TOOL_KINDS = [
  "axe",
  "chisel",
  "clamp",
  "handplane",
  "handsaw",
  "ladder",
  "oilcan",
  "ropeCoil",
  "spade",
  "trowel",
] as const;

/** The Depot: work *about* the work, so the Depot is desks and records.
 *
 *  Planning, dispatch, notes and evaluation build nothing, so the furniture is
 *  what thinking needs: a surface to spread a plan on, a record to write in, a
 *  way to send and a way to measure. A Depot furnished with building materials
 *  would say the wrong thing about the third of a session spent here. */
export const DEPOT_KINDS = [
  "anvil",
  "cabinet",
  "clock",
  "drafting",
  "ledger",
  "noticeboard",
  "parcel",
  "planboard",
  "radio",
  "scales",
  "shelving",
  "stove",
] as const;

/** Every group, by name. The registry and the tests walk this rather than
 *  restating the five arrays. */
export const PROP_GROUPS = {
  shared: SHARED_KINDS,
  yard: YARD_KINDS,
  workshop: WORKSHOP_KINDS,
  tool: TOOL_KINDS,
  depot: DEPOT_KINDS,
} as const;

export type GroupName = keyof typeof PROP_GROUPS;

/** Every prop, in group order. */
export const ALL_PROP_KINDS = [
  ...SHARED_KINDS,
  ...YARD_KINDS,
  ...WORKSHOP_KINDS,
  ...TOOL_KINDS,
  ...DEPOT_KINDS,
] as const;

export type PropKind = (typeof ALL_PROP_KINDS)[number];
export type SharedKind = (typeof SHARED_KINDS)[number];
export type YardKind = (typeof YARD_KINDS)[number];
export type WorkshopKind = (typeof WORKSHOP_KINDS)[number];
export type ToolKind = (typeof TOOL_KINDS)[number];
export type DepotKind = (typeof DEPOT_KINDS)[number];
