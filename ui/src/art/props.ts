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
  CEL_H,
  CEL_W,
  PROP_GROUPS,
  PROP_ORIGIN,
  PROP_SCALE,
  type Drawer,
  type PropKind,
} from "./props/kinds";
import { SHARED_DRAWERS } from "./props/shared";
import { YARD_DRAWERS } from "./props/yard";
import { WORKSHOP_DRAWERS } from "./props/workshop";
import { TOOL_DRAWERS } from "./props/tools";
import { DEPOT_DRAWERS } from "./props/depot";

export { CEL_H, CEL_W, PROP_ORIGIN, PROP_SCALE, ALL_PROP_KINDS, PROP_GROUPS } from "./props/kinds";
export type { PropKind, Drawer, GroupName } from "./props/kinds";

/**
 * Every prop's drawing, as one table over the whole vocabulary.
 *
 * Spread from the groups rather than restated, so this cannot disagree with
 * them. The annotation `Record<PropKind, Drawer>` is the check that the groups
 * *between them* cover everything: if a group loses an entry its own record
 * stops compiling, and if a name were dropped from a group's list the resulting
 * gap here would be a missing-property error.
 *
 * Exported so a test can render one drawer into a cel large enough to *not*
 * clip it and compare — which is the only way to catch a prop that has quietly
 * outgrown the box it is baked into. `Pix.set` drops out-of-range writes without
 * complaint, so the clipped prop looks smaller rather than broken, and the
 * border test cannot see it: a clipped cel has nothing on its border to fail.
 */
export const DRAWERS: Record<PropKind, Drawer> = {
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
 * What stands in each place, in the order it is placed — so the leading entries
 * are the ones the place is named for, and the tail is the stock that makes it
 * read as working.
 *
 * **The lists are sized against the grid, not against the vocabulary.** The
 * scene lays a place's props on a world-space grid (`scene.ts`), and a 2:1
 * projection turns a 37-unit pitch into roughly 19 picture pixels between
 * neighbours — while a prop drawn at `PROP_SCALE` 2 is 30 to 42 pixels across.
 * At the twenty-odd props these lists used to carry, that is a pile: crates
 * inside crates, a lamp post running through a board, and nothing in the place
 * *legible* as a place. Roughly a dozen per plot brings the lattice back to the
 * size of the objects standing on it.
 *
 * Props dropped here are still drawn and still baked — `buildAllProps` walks the
 * vocabulary, not the places, so a prop no place uses is the one case the bake
 * still catches. What a place loses is stock, not art.
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
    "bricks",
    "barrel",
    "rubble",
  ],

  // One job at a bench: the bench, the machines that hang off it, the rack the
  // stock comes from, and the floor's own debris. The bench leads because it is
  // this place's own name in furniture form.
  workshop: [
    "workbench",
    "bandsaw",
    "toolboard",
    "timberRack",
    "grindstone",
    "vise",
    "trestle",
    "handsaw",
    "oilcan",
    "stool",
    "crate",
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
    "clock",
    "planboard",
    "parcel",
    "crate",
    "lamp",
  ],
};

/**
 * The contact shadow a prop throws, as a world rectangle.
 *
 * Two units along x and three along y, which are the two numbers
 * `buildShadow` gives a building: the slab lands down and to the right of the
 * object, which is where a light up and to the left puts it. Grown two on every
 * side, because a prop's own extent is its footprint and a shadow is not the
 * footprint — it is what the footprint does to the light, and a slab cut to the
 * footprint exactly would read as an outline rather than as shade.
 *
 * In world units, unscaled: `footprintOf()` answers in the world the drawer was
 * authored in, and `footprint` scales its own arguments, so multiplying these
 * by `PROP_SCALE` would offset the slab by twice the prop's scale — the shadow
 * would drift away from its object the bigger the prop got, which is the one
 * thing a cast shadow must never do.
 */
const SHADOW_DX = 2;
const SHADOW_DY = 3;
const SHADOW_GROW = 2;

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
  const iso = new IsoPix(CEL_W, CEL_H, PROP_ORIGIN.x, PROP_ORIGIN.y, turn, {
    track: true,
    scale: PROP_SCALE,
  });
  const draw = DRAWERS[kind];
  if (draw) draw(iso, variant);
  // One outline pass over the assembled prop, never per part: per part would put
  // ink at every joint between a barrel's staves and its hoops.
  const prop = iso.outline(P.ink);

  // The contact shadow, and it goes *underneath*.
  //
  // A prop without one is a sticker on the grass: nothing in the cel says the
  // object is standing on the ground rather than printed over it, and that is
  // most of what made the furniture read flatter than the buildings, which have
  // cast one since the first commit. The footprint is measured off the drawing
  // that was just made rather than declared beside it, so it cannot drift the
  // first time a drawer changes shape.
  const foot = iso.footprintOf();
  if (!foot) return prop;
  const shadow = new IsoPix(CEL_W, CEL_H, PROP_ORIGIN.x, PROP_ORIGIN.y, turn, {
    scale: PROP_SCALE,
  });
  shadow.footprint(
    foot.x + SHADOW_DX,
    foot.y + SHADOW_DY,
    foot.w + SHADOW_GROW * 2,
    foot.h + SHADOW_GROW * 2,
    0,
    P.grass[0],
  );
  // The prop is composited on top, so the slab shows only where the object does
  // not cover it. That is the occlusion a separate shadow sprite gets from its
  // depth (scene.ts), reached here by draw order instead — no second sprite to
  // place, no second cel in a sheet that is already at 1125 of its 1296.
  return shadow.pix.blit(prop, 0, 0);
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

/** Cached per list by identity — `PLACE_PROPS` holds three arrays that live for
 *  the life of the module, so the measure below runs three times, not per frame. */
const widestCache = new WeakMap<readonly PropKind[], number>();

/**
 * widestProp is how many picture pixels the widest of a set of props draws,
 * shadow excluded — the number a place's grid has to be spaced against.
 *
 * Measured, not declared, for the same reason the contact shadow's footprint is:
 * a table of per-prop widths would be a second copy of every drawer's geometry,
 * correct on the day it was typed and silently wrong the first time a prop was
 * redrawn larger. It also cannot fall out of step with `PROP_SCALE` the way a
 * typed number would.
 */
export function widestProp(kinds: readonly PropKind[]): number {
  const hit = widestCache.get(kinds);
  if (hit !== undefined) return hit;
  let widest = 1;
  for (const kind of kinds) {
    const pix = buildProp(kind, 0);
    let minX = Infinity;
    let maxX = -Infinity;
    for (let y = 0; y < pix.h; y++)
      for (let x = 0; x < pix.w; x++) {
        const [r, g, b, a] = pix.at(x, y);
        if (!a) continue;
        const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
        if (hex === P.grass[0]) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    if (maxX >= minX) widest = Math.max(widest, maxX - minX + 1);
  }
  widestCache.set(kinds, widest);
  return widest;
}
