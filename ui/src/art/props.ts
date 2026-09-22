// Props: the objects that make the three special places legible.
//
// The Yard, the Workshop and the Depot are where most of a real session happens
// — shell work is roughly half of all tool calls and meta work another third
// (CONTEXT.md). A field with nothing in it would render the majority of the
// work as an absence, so each place is furnished with the props that say what
// happens there.
//
// This file is the registry and nothing else. It joins the five group files,
// checks that between them they cover every name in the vocabulary, and answers
// the two questions the rest of the system asks:
//
//   - *what does this prop look like* — `buildProp`, by name.
//   - *what stands in this place* — `PLACE_PROPS`, by place.
//
// The join is deliberately in one direction only. `kinds.ts` owns the names,
// the group files own the drawings, and this file owns the wiring. A group file
// that forgot a drawing fails to compile against its own `Record`, and a name no
// group claims fails a test. Neither failure can reach the screen, which matters
// because an undrawn prop is invisible: the bake omits it and every sweep passes.

import { IsoPix } from "./iso";
import { type Pix } from "./surface";
import { P } from "./palette";
import {
  ALL_PROP_KINDS,
  CEL,
  PROP_GROUPS,
  PROP_ORIGIN,
  type Drawer,
  type PropKind,
} from "./props/kinds";
import { SHARED_DRAWERS } from "./props/shared";
import { YARD_DRAWERS } from "./props/yard";
import { WORKSHOP_DRAWERS } from "./props/workshop";
import { TOOL_DRAWERS } from "./props/tools";
import { DEPOT_DRAWERS } from "./props/depot";

export { CEL, PROP_ORIGIN, ALL_PROP_KINDS, PROP_GROUPS } from "./props/kinds";
export type { PropKind, Drawer, GroupName } from "./props/kinds";

/**
 * Every prop's drawing, as one table over the whole vocabulary.
 *
 * Spread from the groups rather than restated, so this cannot disagree with
 * them. The annotation `Record<PropKind, Drawer>` is the check that the groups
 * *between them* cover everything: if a group loses an entry its own record
 * stops compiling, and if a name were dropped from a group's list the resulting
 * gap here would be a missing-property error.
 */
const DRAWERS: Record<PropKind, Drawer> = {
  ...SHARED_DRAWERS,
  ...YARD_DRAWERS,
  ...WORKSHOP_DRAWERS,
  ...TOOL_DRAWERS,
  ...DEPOT_DRAWERS,
};

/**
 * The four props the original guide's Row 4 named: wheelbarrow, bricks, lumber
 * and tool chest.
 *
 * Kept as its own export because a doc refers to it, and because it is the set a
 * reader of that guide will look for. It is a *subset* of the shared group, not
 * a sixth group — these four are the minimum a site needs to look worked, and
 * every place has them.
 */
export const CONSTRUCTION_PROPS: readonly PropKind[] = [
  "wheelbarrow",
  "bricks",
  "lumber",
  "toolchest",
];

/**
 * The furniture of each special place.
 *
 * Order matters twice over. It is the order things are laid out in, from the
 * place's own origin, so the arrangement is stable and the scene never places a
 * prop by hand. And it is the order a reader's eye takes across the plate, so
 * the thing that identifies the place comes early rather than being found behind
 * a barrel.
 *
 * Each place draws from the shared group plus its own, which is what makes the
 * three read as one town's three districts rather than as three unrelated
 * drawings. The Yard's list is longest because it is the largest plate and the
 * busiest place by a wide margin.
 */
export const PLACE_PROPS: Record<string, readonly PropKind[]> = {
  // Site-wide work: plant, power, spoil and long stock. The crane leads, because
  // nothing else says "this whole site is being worked" as quickly.
  yard: [
    "crane",
    "skip",
    "mixer",
    "generator",
    "pipeStack",
    "girders",
    "pallet",
    "cableDrum",
    "ladder",
    "wheelbarrow",
    "bricks",
    "lumber",
    "barrel",
    "rubble",
    "cone",
    "spade",
    "tripod",
    "waterbutt",
    "toolchest",
    "sawhorse",
    "crate",
    "bollard",
    "lamp",
    "sack",
  ],

  // One job at a bench: the bench, the machines that hang off it, the rack the
  // stock comes from, and the floor's debris. The bench leads because it is this
  // place's own name in furniture form.
  workshop: [
    "workbench",
    "bandsaw",
    "toolboard",
    "timberRack",
    "grindstone",
    "vise",
    "trestle",
    "handsaw",
    "handplane",
    "clamp",
    "chisel",
    "axe",
    "oilcan",
    "stool",
    "crate",
    "lumber",
    "barrel",
    "toolchest",
    "sack",
    "shavings",
    "lamp",
  ],

  // Work about the work: a surface to spread a plan on, a record to write in, a
  // way to send and a way to measure. Nothing here builds anything, which is the
  // point — the Depot says the third of a session spent thinking is work too.
  depot: [
    "drafting",
    "noticeboard",
    "shelving",
    "cabinet",
    "ledger",
    "scales",
    "radio",
    "parcel",
    "clock",
    "stove",
    "planboard",
    "anvil",
    "stool",
    "crate",
    "lamp",
    "ropeCoil",
    "trowel",
    "sack",
    "barrel",
  ],
};

/**
 * buildProp renders one prop.
 *
 * `variant` nudges the prop's proportions so a yard of five barrels does not
 * look like one barrel stamped five times. It is deterministic, never random:
 * the same town must always draw the same picture (ADR-0012).
 *
 * An unknown kind returns an empty cel rather than throwing. That cannot happen
 * through `PLACE_PROPS` — the table is checked against the vocabulary — but a
 * throw inside the bake would take the whole town down over one misnamed prop,
 * and an empty cel is the failure a test can find.
 */
export function buildProp(kind: PropKind, variant = 0, turn = 0): Pix {
  const iso = new IsoPix(CEL, CEL, PROP_ORIGIN.x, PROP_ORIGIN.y, turn);
  const draw = DRAWERS[kind];
  if (draw) draw(iso, variant);
  // One outline pass over the assembled prop, never per part: per part would put
  // ink at every joint between a barrel's staves and its hoops.
  return iso.outline(P.ink);
}

/**
 * buildAllProps renders every prop the vocabulary names, deduplicated, so the
 * bake holds each one once rather than once per place.
 *
 * It walks `ALL_PROP_KINDS` rather than the places, so a prop drawn nowhere
 * still gets baked and still gets checked — which is how a prop that no place
 * uses is *found* instead of being silently absent from the atlas.
 */
export function buildAllProps(): { kind: PropKind; pix: Pix }[] {
  return ALL_PROP_KINDS.map((kind) => ({ kind, pix: buildProp(kind, 0) }));
}
