// Roof: the one ornament.
//
// Every other channel on a building says something about the code. Height means
// source bytes, footprint means file count, the construction ladder means how
// much work has landed, and damage means what broke. A roof says **nothing** — it
// is chosen by hashing the path, so it is stable and reproducible (the town stays
// a pure function of the project, ADR-0012) while carrying no reading at all.
//
// That is a deliberate choice, and the obvious reading of the code is the opposite
// one: a data visualisation that adds *meaningless* difference to its output looks
// like vandalism, and a future reader will want to know it was on purpose.
// ADR-0021 records the alternatives that were rejected — reading a building's
// *role* from the code, and adding a fifth `Place` for "airport" — and why neither
// was taken.
//
// Two properties are load-bearing:
//
//   - **The roof is confined to the cap**, so a reader can tell at a glance which
//     channels to trust: base and band are measured, the cap is ornament.
//   - **The roof owns the cap completely** — shape, material, height, rooftop
//     furniture and damage. The skin becomes a wall-material axis for the base and
//     band only. Fusing the two into one axis is what buys ten shapes instead of
//     five in two colours; the measurement is in ADR-0021.

import { P, type Ramp } from "./palette";
import { IsoPix } from "./iso";

/**
 * The closed set of roof shapes.
 *
 * Closed for the same reason `Stage` and `Place` are: a kind has a drawing behind
 * it, and an open set would let one be named with nothing to show for it.
 */
export const ROOF_KINDS = ["pitched", "flat", "sawtooth", "gantried", "domed"] as const;
export type RoofKind = (typeof ROOF_KINDS)[number];

/**
 * hashPath reduces a path to a signed 32-bit integer.
 *
 * The one hash behind every path-chosen appearance on a building, so the skin and
 * the roof cannot drift into two different ideas of "the same path": `skinVariant`
 * reads its low bit and `roofFor` reads the bits above it. It is the FNV-ish walk
 * the skin variant has always used, kept bit-for-bit so that existing towns keep
 * their walls.
 *
 * Shared rather than duplicated because the bit split is the whole point: if the
 * two derived their own hash, "the roof varies independently of the wall" would be
 * true only by luck, and a later edit to one walk would silently make the two
 * agree — the one redundancy this axis exists to remove.
 */
export function hashPath(path: string): number {
  let h = 0;
  for (let i = 0; i < path.length; i++) h = (h * 31 + path.charCodeAt(i)) | 0;
  return h;
}

/**
 * roofFor chooses a roof kind from a path.
 *
 * It reads the hash **one bit above** the skin's `% 2`, and that is not a detail.
 * Both reading the low bit would give every warm-walled building the same roof, so
 * the two ornaments would restate each other instead of varying independently —
 * exactly the redundancy this change exists to remove. Starting at bit 1 makes the
 * roof and the skin independent choices from one path, and keeps them independent
 * as the kind count grows: bits 1-3 cover up to ten kinds, which is the atlas's
 * own ceiling (ADR-0021).
 *
 * Deterministic by construction: no `Math.random`, no map iteration order, no
 * clock. The same repository therefore always yields the same roofs, which is what
 * keeps the town a pure function of the project.
 */
export function roofFor(path: string): RoofKind {
  const bits = Math.abs(hashPath(path)) >>> 0;
  return ROOF_KINDS[(bits >>> 1) % ROOF_KINDS.length];
}

/**
 * A roof kind: what it looks like, how tall it stands, and what it is made of.
 *
 * The drawing takes the footprint rather than being one fixed picture, because a
 * roof has to span the building: the same ridge rise on a 44-unit hut and a
 * 100-unit hall are two different pitches. Every method therefore takes `side`,
 * and `capBox` asks the kind for its height rather than holding one.
 */
interface RoofKit {
  /**
   * The rise above the wall top, in world units, for a footprint of `side`.
   *
   * This is what sizes the cap cel, so it must cover **everything the kind draws
   * above the eave**, rooftop furniture included. A kind that lets its chimney
   * poke out beyond this is relying on the cel's margin to catch it, which works
   * until the margin changes.
   */
  height: (side: number) => number;
  /**
   * The coping along the top of the wall, drawn at the eave.
   *
   * It is a *drawing*, not just a colour, because where a coping goes is a
   * property of the roof's profile rather than of the building. The pitched and
   * flat kinds both have a continuous eave line — a gutter under the eaves — and
   * so take the same beam. A **sawtooth does not**: its teeth descend all the way
   * to the wall, so a beam at the eave would run *inside* the roof's own surface,
   * and the outline pass would then ink around the pocket it left — measured as
   * 218 interior holes on a 100-unit footprint before this was made a drawing.
   * Giving each kind its own coping is what lets a sawtooth have none.
   */
  trim: (iso: IsoPix, side: number) => void;
  /** The roof itself, its eave at `eave`. */
  draw: (iso: IsoPix, side: number, eave: number) => void;
  /** Rooftop furniture, drawn at the roof's top. */
  stack: (iso: IsoPix, side: number, top: number) => void;
  /** The hole damage leaves in this kind of roof, at the roof's top. */
  damage: (iso: IsoPix, side: number, top: number) => void;
}

/**
 * The pitched roof, which is the roof this game always had.
 *
 * Kept deliberately identical in shape and height to the `gable` that used to live
 * in `building.ts`, so this change adds a shape rather than replacing the one every
 * existing town already wears. Two things do move, and neither is optional: the
 * material and the gable end used to come from the *skin* (`skin.roof`,
 * `skin.wall[2]`), and the cap no longer reads the skin at all. That is the
 * trade-off ADR-0021 records — a fixed skyline change, in exchange for ten roof
 * shapes instead of five.
 */
/**
 * The pitched roof's material and its gable end, as module-level functions.
 *
 * They are functions rather than constants because both depend on the footprint:
 * a hut is thatched and plastered, a workshop tiled and stone. Declaring them here
 * rather than as fields on the kit is deliberate — a field that only the kit itself
 * reads is state nothing can reach, and two of the five kits had exactly that.
 */
function pitchedRamp(side: number): Ramp {
  return side <= 44 ? P.thatch : P.roof;
}
function pitchedGable(side: number): string {
  return side <= 60 ? P.plaster[2] : P.stone[2];
}

const pitched: RoofKit = {
  height(side) {
    // Today's numbers per footprint, kept so existing roofs keep their pitch. The
    // chimney tops out 8 units above these, inside the cel's 6px margin plus the
    // one-row outline — checked by the border invariant, not assumed.
    if (side <= 44) return 12;
    if (side <= 60) return 16;
    if (side <= 78) return 20;
    return 22;
  },
  trim(iso, side) {
    // A gutter under the eaves, in the wall's own darker stone so it reads as the
    // top of the wall rather than as part of the roof above it.
    const ink = side <= 60 ? P.plaster[0] : P.stone[0];
    iso.beamX(0, side, side, 0, ink, 1);
    iso.beamY(0, side, side, 0, ink, 1);
  },
  draw(iso, side, eave) {
    const overhang = 2;
    iso.gable(-overhang, -overhang, side + overhang * 2, side + overhang * 2, eave, pitched.height(side), {
      near: pitchedRamp(side)[2],
      far: pitchedRamp(side)[1],
      ridge: pitchedRamp(side)[3],
      gable: pitchedGable(side),
      edge: P.ink,
    });
  },
  stack(iso, side, top) {
    // A hut is too small to carry a chimney, and at that size a stack reads as a
    // mistake rather than as a detail.
    if (side < 60) return;
    const cx = Math.round(side * 0.22);
    iso.box(cx, Math.round(side * 0.42), 7, 7, top - 6, top + 8, {
      top: P.stone[3],
      lit: P.stone[2],
      shadow: P.stone[1],
      edge: P.ink,
    });
  },
  damage(iso, side, top) {
    // A hole punched through the slope, with a broken beam across it — the two
    // marks that say "this was a roof" rather than "this is a dark patch".
    const hx = Math.round(side / 2);
    const hy = Math.round(side / 2);
    iso.footprint(hx, hy, 6, 6, top, pitchedRamp(side)[0]);
    iso.beamX(hx, hx + 6, hy + 3, top, P.wood[1], 1);
  },
};

/**
 * The flat roof: a lid with a parapet.
 *
 * Chosen as the second kind because its **silhouette** is the farthest thing from a
 * pitched ridge at any zoom — a straight horizontal top against a triangle. That is
 * the whole value of ornament here: a look that cannot be told apart from the others
 * at the size the town is actually read is art paid for and worth nothing.
 *
 * The parapet does not grow with the footprint. A lid does not need to be taller
 * because the building is wider, and holding it flat keeps the cap cel short, which
 * keeps the atlas's cell height set by the pitched kind alone. That matters: cell
 * height is paid for by every cel on the sheet, so a kind that grows it charges the
 * whole atlas for one look.
 */
const flat: RoofKit = {
  height: () => 6,
  trim(iso, side) {
    // A parapet edge: the same line as a pitched roof's gutter, but in the roof's
    // own stone, because a flat roof's parapet *is* the top of the wall.
    iso.beamX(0, side, side, 0, P.stone[0], 1);
    iso.beamY(0, side, side, 0, P.stone[0], 1);
  },
  draw(iso, side, eave) {
    // A roof's material is usually darker than its walls, so the underside of the
    // slab (the lit face) takes the ramp's second step rather than its brightest.
    const overhang = 2;
    iso.box(-overhang, -overhang, side + overhang * 2, side + overhang * 2, eave, eave + flat.height(side), {
      top: P.stone[3],
      lit: P.stone[2],
      shadow: P.stone[1],
      edge: P.ink,
    });
  },
  stack(iso, side, top) {
    // Rooftop furniture: what a flat-roofed building actually has up there, and it
    // breaks the parapet's straight line so a run of flat roofs is not a row of
    // identical lids. Two housings, sized to the footprint.
    const w = Math.max(5, Math.round(side / 8));
    const a = Math.round(side * 0.24);
    const b = Math.round(side * 0.58);
    iso.box(a, b, w, w, top, top + 7, {
      top: P.stone[3],
      lit: P.stone[2],
      shadow: P.stone[1],
      edge: P.ink,
    });
  },
  damage(iso, side, top) {
    // A flat roof fails differently from a pitched one: no hole in a slope, but a
    // collapsed bay, drawn as a dark opening with broken edges.
    const d = Math.max(6, Math.round(side / 6));
    const hx = Math.round(side * 0.34);
    const hy = Math.round(side * 0.34);
    iso.footprint(hx, hy, d, d, top, P.ink);
    iso.footprint(hx + 1, hy + 1, d - 2, d - 2, top + 1, P.stone[0]);
  },
};

/**
 * The sawtooth: a run of teeth with glazed flanks, which is what a factory roof
 * actually is.
 *
 * Picked for **silhouette** contrast above all. A pitched roof is a triangle and a
 * flat roof is a line; a sawtooth is a serration, and a serration is unmistakable
 * at any zoom because the eye finds a repeated rhythm faster than it finds a
 * shape. That is the whole value of a roof kind: one that cannot be told apart from
 * the others at the size the town is read is art paid for and worth nothing.
 *
 * Its material is the reason the palette has cool colours in it at all. Convention
 * gives a sawtooth a **glazed** north light, and this roof takes that literally:
 * the teeth are sheet metal and the steep flank between them is glass, which is the
 * only cool blue in the building palette (`P.glass`), so the serration reads as
 * glass-and-metal rather than as a row of grey wedges. The flank is drawn by the
 * same sweep that draws the teeth — it is the *fall* in the profile — so it cannot
 * come adrift from the tooth above it.
 *
 * Its height stays at or below the pitched kind's on every footprint, which is
 * deliberate: cell height is paid for by every cel on the sheet, so a kind that
 * grows it charges the whole atlas for one look. Keeping this one short is what
 * lets the atlas ceiling stay where the pitched kind set it.
 */
const sawtooth: RoofKit = {
  height(side) {
    if (side <= 44) return 10;
    if (side <= 60) return 12;
    if (side <= 78) return 16;
    return 18;
  },
  trim() {
    // Deliberately nothing, and this is the one kind where that is right: a
    // sawtooth's teeth run all the way down to the wall, so there is no eave line
    // for a coping to sit on. A beam here would be drawn inside the roof's own
    // surface — which is what produced 218 interior holes before this was fixed,
    // because `outline` then inked around the pocket between the beam and the
    // teeth above it.
  },
  draw(iso, side, eave) {
    const overhang = 2;
    // One period per tooth, and roughly three teeth per run at every size — the
    // count is what reads as industrial, so it must not fall to two on a hut or
    // rise to eight on a hall. Derived from the footprint rather than fixed so the
    // rhythm looks the same at every scale.
    const teeth = 3;
    const period = (side + overhang * 2) / teeth;
    const rise = sawtooth.height(side);
    // A tooth is a long shallow slope up and a short steep drop. The fraction is
    // the shallow part, and it is what makes the profile read as a saw rather than
    // as a triangle wave: an even split would look like a zigzag.
    const climb = 0.68;
    iso.ridgeProfile(
      -overhang,
      -overhang,
      side + overhang * 2,
      side + overhang * 2,
      eave,
      (along) => {
        // Position within the current tooth, in world units.
        const t = ((along % period) + period) % period;
        const flat = period * climb;
        return t <= flat
          ? (rise * t) / flat
          : rise * (1 - (t - flat) / (period - flat));
      },
      { surface: P.metal[2], face: P.glass[2], edge: P.ink },
    );
  },
  stack(iso, side, top) {
    // A vent: the one piece of rooftage that suits a factory and reads at this
    // size, and it gives the eye a landmark on a roof that is otherwise a pattern.
    const w = Math.max(4, Math.round(side / 12));
    const a = Math.round(side * 0.3);
    const b = Math.round(side * 0.3);
    iso.box(a, b, w, w, top - 4, top + 4, {
      top: P.metal[3],
      lit: P.metal[2],
      shadow: P.metal[1],
      edge: P.ink,
    });
  },
  damage(iso, side, top) {
    // A collapsed tooth: the serration is the roof's whole identity, so damage
    // reads best as losing part of the profile rather than as a hole in it.
    const d = Math.max(5, Math.round(side / 8));
    const hx = Math.round(side * 0.3);
    const hy = Math.round(side * 0.3);
    iso.footprint(hx, hy, d, d, top, P.ink);
    iso.footprint(hx + 1, hy + 1, d - 2, d - 2, top + 1, P.metal[0]);
  },
};

/**
 * The gantried roof's deck height, in world units.
 *
 * Named because two functions need it and they must agree: `draw` raises the deck
 * to it, and `stack` stands the legs on top of it. A magic 5 in both places is the
 * shape of bug where one is changed and the structure detaches from its own deck.
 */
const GANTRY_DECK = 5;

/**
 * The gantried roof: a flat deck with a raised working structure over it.
 *
 * This is the look that answers the original request for "airport / station", and
 * it is deliberately **a roof and not a new `Place`**. `Place` is a closed set of
 * four — Building, Workshop, Yard, Depot — and a fifth member ("station") would
 * need a fifth *kind of event* to route work there, which the action vocabulary
 * does not have. A gantry has no such problem: it is ornament, chosen by the path
 * hash, and it means nothing about the code (ADR-0021).
 *
 * It is the only kind whose **height is set by its own structure** rather than by
 * the roof surface, because a gantry is inherently tall: a deck with legs and a
 * beam over it. That is exactly the cost ADR-0021 flags — a taller kind raises
 * `cellH` for *every* cel on the sheet, so it buys its look with atlas headroom.
 * Ticket 06 required measuring that rather than assuming it, and the measurement
 * is in the ticket's comments: this kind stays within the pitched kind's 22 units,
 * so cell height does not move and the ceiling is unchanged.
 */
const gantried: RoofKit = {
  height(side) {
    if (side <= 44) return 14;
    if (side <= 60) return 17;
    if (side <= 78) return 20;
    return 22;
  },
  trim: (iso, side) => {
    // A loading apron edge: the deck's rim, in the roof's own darker metal. It is
    // a silhouette line rather than a coping, which is why it takes the roof's
    // ramp and not the wall's.
    iso.beamX(0, side, side, 0, P.metal[0], 1);
    iso.beamY(0, side, side, 0, P.metal[0], 1);
  },
  draw(iso, side, eave) {
    // The deck: a low slab the gantry stands on. Low on purpose, so that the
    // structure above is what carries the height and the roof still reads as a
    // roof rather than as a second storey.
    iso.box(0, 0, side, side, eave, eave + GANTRY_DECK, {
      top: P.metal[1],
      lit: P.metal[2],
      shadow: P.metal[0],
      edge: P.ink,
    });
  },
  stack(iso, side, top) {
    // A gantry **crane**: a mast standing at one corner of the deck with a jib
    // cantilevered across it, and a hoist hanging from the jib.
    //
    // A crane rather than a portal frame — four legs with beams — and the reason is
    // structural rather than stylistic. A closed frame standing on a deck encloses
    // a region by construction: the deck bounds it below, the beam above and the
    // legs on both sides. `outline` inks around any boundary it finds, so that
    // pocket acquires a hard rim and reads as a deliberate glazed panel rather than
    // as air — measured as 25 enclosed pixels on a 78-unit footprint, and present
    // on every footprint before it.
    //
    // A mast and a jib is a **T**, which encloses nothing at all. So the shape is
    // safe by geometry rather than by patching the pocket afterwards, and that is
    // worth preferring: the first two attempts at this kind both failed the hole
    // invariant, once with legs and once with a filled mass behind them, and the
    // filled version was safe but read as a solid block rather than as a structure.
    //
    // It also reads better at this size. A frame's legs vanish into the deck's own
    // surface at 1×, while a mast with a jib over a flat roof is unmistakable — it
    // is the silhouette that says "working structure" rather than "taller building".
    const inset = Math.round(side * 0.2);
    // `top` is the top of the kind's whole rise, which is what `roofHeight`
    // promised the box. The mast therefore spans the gap between the deck's own top
    // and `top` — *not* `GANTRY_DECK + height`, which would reach five units past
    // the top of the cel and have the mast's head clipped off by the cel it is
    // drawn in. The same mistake in the other direction was what left the earlier
    // version's frame floating above its own deck.
    const mastTop = top;
    const mastH = mastTop - GANTRY_DECK;
    const mastSide = Math.max(4, Math.round(side / 20));
    iso.box(inset, inset, mastSide, mastSide, GANTRY_DECK, mastTop, {
      top: P.metal[3],
      lit: P.metal[2],
      shadow: P.metal[1],
      edge: P.ink,
    });
    // The jib, as one **solid** box cantilevered from the mast's head rather than
    // as two thin beams.
    //
    // That change is the fix for the third attempt's hole, and it is worth stating
    // because the failure recurs in a different place each time: any pair of thin
    // beams that meet the mast at two different points encloses a rectangle of air
    // between them, and `outline` then inks its rim so the gap reads as a glazed
    // panel. Two overlapping *solid* boxes cannot do that — a union of solids is
    // simply connected, so there is no air to enclose — which removes the whole
    // class of failure instead of the instance.
    //
    // It also draws better: a solid jib has a visible top and side face, so it
    // reads as a structural member carrying a load rather than as a wire.
    const jibW = side - inset * 2;
    const jibD = Math.max(4, Math.round(side / 14));
    // Overlapping the mast's head by a couple of units, so the two solids weld into
    // one silhouette rather than meeting at a seam.
    const jibOverlap = 2;
    iso.box(inset, inset, jibW, jibD, mastTop - 3, mastTop, {
      top: P.metal[3],
      lit: P.metal[2],
      shadow: P.metal[1],
      edge: P.ink,
    });
    // The hoist, hanging from the jib's outer end and overlapping it vertically so
    // the block is attached to the jib rather than floating under it. It hangs free
    // below — open air on both sides — so it encloses nothing either.
    const hx = Math.round(inset + jibW * 0.62);
    const drop = Math.max(6, Math.round(mastH * 0.45));
    iso.box(hx, inset, jibD, jibD, mastTop - jibOverlap - drop, mastTop - jibOverlap, {
      top: P.metal[3],
      lit: P.metal[2],
      shadow: P.metal[1],
      edge: P.ink,
    });
  },
  damage(iso, side, top) {
    // A crane fails by dropping its load and losing its jib. Drawn as the hoist
    // come down onto the deck with the jib snapped off its outer end.
    //
    // Legible in silhouette is the whole requirement here: a puncture in a metal
    // deck would read as nothing at all, because a flat roof has no shape for a
    // hole to interrupt.
    const deck = GANTRY_DECK;
    const mid = Math.round(side / 2);
    // The fallen hoist, sitting on the deck.
    iso.box(mid - 4, Math.round(side * 0.4), 8, 8, deck + 1, deck + 6, {
      top: P.metal[2],
      lit: P.metal[1],
      shadow: P.metal[0],
      edge: P.ink,
    });
    // The jib's broken stub, still standing on the mast.
    const inset = Math.round(side * 0.2);
    const mastSide = Math.max(4, Math.round(side / 20));
    iso.box(inset, inset, mastSide + 4, mastSide + 4, deck, top - 5, {
      top: P.metal[1],
      lit: P.metal[0],
      shadow: P.metal[0],
      edge: P.ink,
    });
  },
};

/**
 * The domed roof: a rounded cap over the footprint, with a lantern on the apex.
 *
 * The only curved silhouette in the set, which is what earns it its place — against
 * three angular kinds (a triangle, a line, a serration) a curve is instantly
 * distinct, and distinctness is the only thing a roof is for.
 *
 * The curve is deliberately **not** a true hemisphere. A circle sampled at these
 * sizes reads as a bead or a mushroom cap, because the pixel grid cannot carry a
 * shallow arc — so `fall` uses a shape with a flatter crown and a steeper skirt,
 * which is the profile that survives rasterisation as a dome.
 *
 * Its apex is a light-coloured lantern rather than the dome surface itself. That is
 * what makes it read as a *roof* instead of as a grey bump: at 1× the dome's own
 * shading is only a few steps apart, and one bright point at the top is what the
 * eye uses to find the shape.
 *
 * Height stays within the pitched kind's on every footprint, so `cellH` does not
 * move — the same constraint the sawtooth and gantried kinds hold to, and the
 * reason four kinds have cost the atlas nothing in height.
 */
const domed: RoofKit = {
  height(side) {
    if (side <= 44) return 11;
    if (side <= 60) return 15;
    if (side <= 78) return 18;
    return 21;
  },
  trim(iso, side) {
    // A plinth where the dome meets the wall, so it sits *on* something rather than
    // growing out of the wall. A dome has no eave line, so this is a base course
    // rather than a coping — the one kind whose trim is at the bottom of its shape.
    iso.beamX(0, side, side, 0, P.stone[0], 1);
    iso.beamY(0, side, side, 0, P.stone[0], 1);
  },
  draw(iso, side, eave) {
    const rise = domed.height(side);
    iso.dome(-2, -2, side + 4, side + 4, eave, (t) => {
      // Flattened crown, steep skirt: `1 - t²` kept above a floor so the perimeter
      // still meets the eave. A true `cos` would leave the rim a pixel above the
      // wall and show a gap on every side.
      const curve = 1 - t * t;
      return t >= 1 ? 0 : rise * curve;
    }, {
      top: P.stone[3],
      near: P.stone[2],
      far: P.stone[1],
      eave: P.stone[0],
      edge: P.ink,
    });
  },
  stack(iso, side, top) {
    // The lantern at the apex: a small lit drum, which is both what a dome of this
    // size would have and what gives the curve a bright point to read against.
    const w = Math.max(4, Math.round(side / 16));
    const cx = Math.round(side / 2) - Math.round(w / 2);
    iso.box(cx, cx, w, w, top - 4, top + 3, {
      top: P.glass[3],
      lit: P.glass[2],
      shadow: P.glass[1],
      edge: P.ink,
    });
  },
  damage(iso, side, top) {
    // A dome fails by losing a wedge of its shell: the curve is the roof's whole
    // identity, so the damage has to break the curve rather than mark it.
    const d = Math.max(6, Math.round(side / 6));
    const hx = Math.round(side * 0.3);
    const hy = Math.round(side * 0.3);
    iso.footprint(hx, hy, d, d, top - 2, P.ink);
    iso.beamX(hx, hx + d, hy + Math.round(d / 2), top - 2, P.wood[1], 1);
  },
};

const KITS: Record<RoofKind, RoofKit> = { pitched, flat, sawtooth, gantried, domed };

/** The rise a kind stands above the wall top, for a footprint. This is what sizes
 *  the cap cel, so every kind must include its own rooftop furniture in it. */
export function roofHeight(kind: RoofKind, side: number): number {
  return KITS[kind].height(side);
}

/**
 * buildRoofTrim draws the kind's coping along the top of the wall.
 *
 * A drawing rather than a colour because whether a kind *has* a coping, and at
 * what height, is a property of its profile — see `RoofKit.trim`.
 */
export function buildRoofTrim(iso: IsoPix, kind: RoofKind, side: number): void {
  KITS[kind].trim(iso, side);
}

/**
 * buildRoof draws a kind's roof over a footprint, with its eave at `eave`.
 *
 * The eave is a parameter because the cap's own local z = 0 is the top of the wall:
 * a roof is drawn at 0 to sit on the wall, and its furniture and damage are drawn
 * at the roof's own top, which is a different z.
 */
export function buildRoof(iso: IsoPix, kind: RoofKind, side: number, eave: number): void {
  KITS[kind].draw(iso, side, eave);
}

/**
 * buildRoofStack draws the kind's rooftop furniture, at the roof's top rather
 * than at the eave.
 *
 * The z is added here rather than inside each kit so that a kind states only
 * *what* its furniture is and never *where* it belongs. A chimney, a rooftop
 * housing and a vent all sit on the roof's own surface, and letting a kit pick
 * its z is how one of them ends up floating above a roof it is drawn to belong
 * to.
 */
export function buildRoofStack(iso: IsoPix, kind: RoofKind, side: number, eave: number): void {
  KITS[kind].stack(iso, side, eave + roofHeight(kind, side));
}

/**
 * buildRoofDamage draws the kind's own kind of roof damage, at the same z as the
 * furniture.
 *
 * Per-kind because damage is a property of the roof, not of the building: a hole
 * belongs in a slope and a collapsed bay belongs in a slab, and one shared damage
 * mark would put a puncture in a flat roof — which reads as nothing at all,
 * because a flat roof has no slope to interrupt.
 *
 * It is drawn *over* the roof rather than replacing it, which is what lets damage
 * be additive on any stage: a half-built building that breaks stays half-built and
 * gains damage, rather than swapping one picture for another and losing its
 * history (ADR-0004).
 */
export function buildRoofDamage(iso: IsoPix, kind: RoofKind, side: number, eave: number): void {
  KITS[kind].damage(iso, side, eave + roofHeight(kind, side));
}
