// The Workshop group: one job at a bench.
//
// The Yard is plant and bulk, the Depot is desks and records, and this place is
// what sits between them — a material worked by hand. So its furniture is the
// bench the job is held on, the machines that hang off it, the rack the stock
// comes out of, and the floor's own debris. Nothing here lifts, digs or carries:
// that vocabulary is the Yard's, and a crane on this plate would make the two
// places one place with two names.
//
// Every prop is built to be told apart by its outline, because at this size the
// outline is nearly all there is. The bench is horizontal and low; the bandsaw
// is the one tall thing, a C carrying two wheels; the grindstone is a wheel
// standing in a trough; the rack is a fan of leaning boards; the toolboard is
// the only flat rectangle on legs; the trestle is two splayed frames with a
// board across; the vise is the only thing here with jaws; and the shavings are
// a heap rather than an object, which nothing else in this group is.

import { type IsoPix } from "../iso";
import { P } from "../palette";
import { type Ink } from "../surface";
import { type Drawer, type Shade, type WorkshopKind } from "./kinds";
import { bracedBoard, hollowBox } from "./parts";

/**
 * member draws a member that is neither vertical nor horizontal: the splayed
 * leg of a trestle, the legs of a grindstone's stand.
 *
 * `post` can only raise a vertical, and a stand built out of verticals reads as
 * a table with a leg missing. The run at each step is what makes the member
 * solid: a chain of single-pixel steps is a dotted line, and the outline pass
 * inflates every dot into its own ink blob, so a thin diagonal comes out as a
 * string of beads rather than as a strut. `thick` is in world units like the
 * endpoints, because the whole point of drawing here is that a member's foot
 * lands where the drawing says it does.
 */
function member(
  iso: IsoPix,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  thick: number,
  ink: Ink,
): void {
  const steps = Math.max(1, Math.round(Math.abs(z1 - z0)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const z = z0 + (z1 - z0) * t;
    const wx = x0 + (x1 - x0) * t;
    const wy = y0 + (y1 - y0) * t;
    for (let d = 0; d < thick; d++) iso.plot(wx + d, wy, z, ink);
  }
}

/**
 * circleAt fills a circle in the cel's own pixels, centred on a picture point.
 *
 * The upright plane is the one plane this projection leaves square: a world
 * unit up is one pixel up and a world unit across is half a pixel, so a wheel's
 * face is round on screen. That is why this takes a pixel radius and a
 * projected centre rather than world coordinates — the same circle walked in
 * world space comes out a lens, half as wide as it is tall, which is a cart
 * wheel seen edge-on and not a wheel on an axle.
 */
function circleAt(iso: IsoPix, px: number, py: number, r: number, ink: Ink): void {
  for (let dx = -r; dx <= r; dx++) {
    const half = Math.sqrt(Math.max(0, r * r - dx * dx));
    iso.pix.vline(px + dx, Math.round(py - half), Math.round(py + half), ink);
  }
}

/**
 * standingWheel draws a wheel on a horizontal axle: the two wheels of a
 * bandsaw, the stone of a grindstone.
 *
 * The slices run far to near, each centred on the picture point its own depth
 * projects to, so the band of them standing behind the near cap is the tyre's
 * thickness — taken from the projection rather than guessed at, because a
 * hand-picked offset stops matching the wheel the moment its radius changes.
 * Only the near cap takes the `face` tone, which is what gives the wheel a
 * bright side and a dull one instead of a flat coin, and the hub is punched
 * into that cap because a ring around a dark centre is the whole difference
 * between a wheel and a porthole.
 */
function standingWheel(
  iso: IsoPix,
  wx: number,
  wy: number,
  z: number,
  radius: number,
  depth: number,
  face: Ink,
  side: Ink,
  hub: Ink,
): void {
  for (let d = 0; d < depth; d++) {
    const p = iso.project(wx, wy + d, z);
    circleAt(iso, Math.round(p.x), Math.round(p.y), radius, d === depth - 1 ? face : side);
  }
  const cap = iso.project(wx, wy + depth - 1, z);
  circleAt(iso, Math.round(cap.x), Math.round(cap.y), Math.max(1, Math.round(radius * 0.4)), hub);
}

/**
 * leaning draws a board stood on edge and leaned back: the whole point of the
 * rack, and the one thing that separates it from a pile of flat lumber.
 *
 * A leaning board shows the camera its face, which is a plane whose depth
 * changes with height — so it is drawn as one cross-section per unit of height,
 * each a run along x at the interpolated y. Drawn as a box instead, it would
 * stand bolt upright, and a row of upright ends is a bookshelf.
 */
function leaning(
  iso: IsoPix,
  x0: number,
  x1: number,
  yBase: number,
  zBase: number,
  yTop: number,
  zTop: number,
  ink: Ink,
): void {
  const steps = Math.max(1, Math.round(zTop - zBase));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const wy = yBase + (yTop - yBase) * t;
    const z = zBase + (zTop - zBase) * t;
    for (let wx = x0; wx <= x1; wx++) iso.plot(wx, wy, z, ink);
  }
}

/**
 * A bandsaw: a C-shaped casting carrying a wheel at each end of its opening,
 * with the blade running down the tangent between them.
 *
 * The C is the read, and the *waist* is what shows it: the machine's silhouette
 * narrows between the two wheels, which is the throat the work is fed through.
 * Wheels drawn any closer merge into one tall cylinder, and a tall cylinder with
 * a bright band down it is a drill press.
 */
const bandsaw: Drawer = (iso, variant) => {
  // The casting and the wheels come from different ramps on purpose: a bandsaw
  // is a rusty frame carrying bright steel, and the hue split is what keeps the
  // two wheels legible against the body they are bolted to.
  const frame = { top: P.rust[2], lit: P.rust[3], shadow: P.rust[1], edge: P.ink };
  const steel = { top: P.metal[2], lit: P.metal[3], shadow: P.metal[1], edge: P.ink };
  const top = 22;
  const bottom = 4;
  // The spine first, then the two arms, each square on its own wheel's axle
  // height, where a real saw's arms are cast. Both stop short of the blade, so
  // the waist between the arms stays open.
  iso.box(0, 0, 3, 9, 3, top + 3, frame);
  iso.beamX(3, 12, 2, top + 1, frame.top, 3);
  iso.beamX(3, 12, 2, 4, frame.top, 3);
  // The blade, down the vertical the two wheels' right rims share, so it wraps
  // their outside the way a blade that goes round them does. Column and ends
  // both come from the wheels' own projection rather than being typed in: a
  // hand-picked number stops touching the rims the moment either wheel moves.
  // Drawn before the wheels, so their rims land over its ends.
  const cap = iso.project(13, 3, 0);
  iso.pix.vline(
    Math.round(cap.x) + 5,
    Math.round(iso.project(13, 3, top).y),
    Math.round(iso.project(13, 3, bottom).y),
    P.metal[3],
  );
  // The two wheels, whose radius is in pixels because the upright plane is the
  // one this projection leaves square. How far apart they sit is world units,
  // like everything else here.
  standingWheel(iso, 13, 1, top, 4, 3, P.metal[2], P.metal[1], P.metal[0]);
  standingWheel(iso, 13, 1, bottom, 4, 3, P.metal[2], P.metal[1], P.metal[0]);
  // The table across the waist, last, so the blade crosses it rather than
  // stopping at it: a table the blade does not reach is a table with a saw
  // painted beside it. It is wide, because the waist alone would be a gap.
  iso.box(3, 2, 10, 5, 13, 14, steel);
  // The whole table one rung lower on one variant. The variant has to be spent
  // on something the machine actually shows — a guard tucked against the casting
  // is hidden inside the spine's own footprint and changes nothing.
  if (variant % 2) iso.box(3, 2, 10, 5, 12, 13, steel);
};

/**
 * A grindstone: a stone on an axle, on a stand, sitting in a trough of water.
 *
 * The trough is not decoration. A stone on a bare axle is a cart wheel, because
 * nothing else distinguishes the two at this size — without the trough the prop
 * belongs to the Yard. The stand's legs cross the stone on the near side, which
 * is what a frame looks like from this camera and what stops the stone reading
 * as a picture painted on the trough.
 */
const grindstone: Drawer = (iso) => {
  hollowBox(iso, 0, 0, 16, 11, 0, 4, {
    top: P.wood[1],
    lit: P.wood[2],
    shadow: P.wood[0],
    edge: P.ink,
    // Water, in the palette's one cool blue: a dry trough with a stone in it is
    // a wheelbarrow of sand.
    inner: P.glass[2],
  });
  // The stand's far pair of legs, drawn before the stone because they are
  // behind it, rising from the trough's rim to the axle.
  member(iso, 2, 3, 4, 6, 3, 13, 4, P.wood[2]);
  member(iso, 14, 3, 4, 10, 3, 13, 4, P.wood[1]);
  // The stone, high enough above the trough that the water between them still
  // shows: a stone on the water line reads as one that has fallen in.
  standingWheel(iso, 8, 4, 13, 4, 3, P.stone[2], P.stone[0], P.stone[3]);
  // The near pair, crossing the stone's lower half the way a real frame's
  // front legs do. Drawn after the stone, so they are visibly in front of it.
  member(iso, 2, 9, 4, 6, 9, 13, 4, P.wood[2]);
  member(iso, 14, 9, 4, 10, 9, 13, 4, P.wood[1]);
  // The axle, and the crank that turns it: without a handle the stone is driven
  // by nothing, and the prop stops being a machine. The crank hangs off the
  // near end of the axle, where a grindstone's handle actually is.
  iso.beamY(3, 12, 8, 13, P.metal[1], 1);
  member(iso, 8, 12, 13, 8, 14, 9, 1, P.metal[2]);
  iso.plot(8, 14, 9, P.wood[2]);
};

/**
 * Bench shavings: a low ragged heap of plane curls and sawdust.
 *
 * This is the one prop here that is not an object. Its edges are deliberately
 * uneven and its top steps, because the one thing floor debris never is, is
 * square — and a square heap at this size would read as a crate lid that fell
 * over. It is kept under five units tall so it stays underfoot rather than
 * becoming furniture.
 */
const shavings: Drawer = (iso, variant) => {
  for (let wy = 0; wy <= 9; wy++) {
    const x0 = 1 + ((wy * 3 + variant) % 3);
    const x1 = 15 - ((wy * 5 + variant * 2) % 4);
    if (x1 <= x0) continue;
    iso.row(x0, x1, wy, 0, P.wood[1]);
    // The lit crown, inset one unit and one unit up, so the heap has a top
    // rather than being a stain on the floor.
    if (wy > 1 && wy < 8) iso.row(x0 + 1, x1 - 1, wy, 1, P.wood[2]);
  }
  // A curl of shaving stands on edge, so it is drawn as an arc in the x-z plane
  // rather than lying in the ground plane: a curl lying flat is two pixels of
  // foreshortening and reads as a crumb.
  const spots: readonly (readonly [number, number])[] = [
    [4, 2],
    [12, 3],
    [8, 6],
    [14, 7],
    [3, 8],
  ];
  const curls = 3 + (variant % 3);
  for (let i = 0; i < curls; i++) {
    const [cx, cy] = spots[(i + variant) % spots.length];
    for (let a = 0; a <= 6; a++) {
      const ang = -0.6 + (a / 6) * Math.PI * 1.6;
      iso.plot(cx + Math.cos(ang) * 2.5, cy, 2 + Math.sin(ang) * 2.5, P.wood[3]);
    }
  }
};

/**
 * A timber rack: boards stood on edge and leaned back into it.
 *
 * The dark panel across the back is load-bearing for the read. Pale boards
 * seen against the ground merge into one pale wedge; against a dark panel each
 * board's front edge is a stripe, and the stripes are what a reader counts. The
 * boards are given staggered heights and alternating tones for the same reason:
 * an even fan of one colour looks like a texture, and stock is never perfectly
 * sorted.
 */
const timberRack: Drawer = (iso, variant) => {
  iso.box(0, 0, 20, 2, 0, 17, {
    top: P.wood[0],
    lit: P.wood[1],
    shadow: P.wood[0],
    edge: P.ink,
  });
  iso.post(0, 1, 0, 18, P.wood[2], 1);
  iso.post(20, 1, 0, 18, P.wood[1], 1);
  // The single rail the boards lean against. There is no second rail: a board
  // leaning into a rack only touches it at one height, and a low rail drawn as
  // well is a second horizontal cutting every stripe in half.
  iso.beamX(0, 20, 2, 15, P.wood[2], 1);
  const boards = 4 + (variant % 2);
  const heights = [15, 12, 16, 13, 15];
  for (let i = 0; i < boards; i++) {
    const x0 = 1 + i * 4;
    leaning(iso, x0, x0 + 3, 14, 0, 3, heights[i], i % 2 === 0 ? P.wood[3] : P.wood[2]);
  }
  // A board pulled out and propped against the near face, clear of the fan so
  // it reads as a separate board: a rack of stock is one thing, and stock
  // somebody is working from is another.
  leaning(iso, 8, 13, 17, 0, 9, 12, P.wood[3]);
};

/**
 * A toolboard: the shop's hand tools hung on a board on two legs.
 *
 * The board's face is the lower-left wall of a one-unit slab, and a world unit
 * across that wall is only half a pixel — so a tool lying flat on it comes out
 * half as long as the same tool would on the ground, and everything here is
 * sized up accordingly. The tools are steel and pale wood against a dark board
 * for the same reason: at one pixel a mid-tone on a mid-tone is invisible, and
 * a highlight on ink is not.
 */
const toolboard: Drawer = (iso, variant) => {
  bracedBoard(iso, -5, 0, 28, 0, 17, {
    top: P.wood[2],
    lit: P.wood[1],
    shadow: P.wood[0],
    edge: P.ink,
    face: P.wood[1],
  });
  // The peg rail, dark and drawn first so every tool hangs over it: a rail the
  // tools sat behind would be a stripe ruled across their faces.
  iso.row(-5, 23, 1, 16, P.wood[0]);
  // A saw by the left post, hung by its handle with the blade tapering away
  // below it — the taper is the whole difference between a saw and a strip of
  // steel, and it is the only diagonal on the board.
  for (let z = 13; z <= 16; z++) iso.row(-5, 3, 1, z, P.wood[3]);
  for (let z = 6; z <= 12; z++) iso.row(-5, 3 - Math.round((12 - z) / 2), 1, z, P.metal[3]);
  // A hammer in the middle, head up: a pale shaft under a steel head whose ends
  // overhang it both ways is the only hammer that reads at three pixels.
  iso.column(11, 1, 7, 13, P.wood[3]);
  for (let z = 13; z <= 15; z++) iso.row(8, 14, 1, z, P.metal[3]);
  // The third bay holds a chisel on one variant and a square on the other.
  // They are not two details on one board but the same bay used two ways, and
  // that is what the variant is for: a wall of tools is never arranged twice
  // the same, and switching one silhouette says so where a nudged plank does
  // not.
  if (variant % 2 === 0) {
    // Chisel: pale handle at the top, bare shank hanging below it.
    for (let z = 13; z <= 15; z++) iso.row(19, 23, 1, z, P.wood[3]);
    iso.column(21, 1, 7, 12, P.metal[3]);
  } else {
    // Square: one long steel blade with its stock across the top, which is the
    // same cross-ways shape as the hammer's head and is told from it by having
    // no wood under it at all.
    iso.column(19, 1, 7, 15, P.metal[3]);
    for (let z = 13; z <= 15; z++) iso.row(19, 23, 1, z, P.metal[2]);
  }
};

/**
 * A trestle: two splayed frames with one board laid across them.
 *
 * The splay is the whole difference between this and the shared sawhorse,
 * which is the same idea built from four uprights at half the height. The deck
 * is one board, five units deep, where the sawhorse carries a thirteen-unit
 * plank: a trestle holds the one thing being worked on, and a wide deck would
 * make it a bench.
 */
const trestle: Drawer = (iso) => {
  const deck = 14;
  for (const fx of [4, 16]) {
    // Each frame's two members lean toward each other and meet under the deck,
    // which is what an A-frame is and what stops the pair reading as four legs
    // of a table. They are drawn far to near so the near member's foot lands
    // last and the crossing stays a crossing rather than a knot.
    member(iso, fx, 0, 0, fx, 5, deck, 4, P.wood[2]);
    member(iso, fx, 11, 0, fx, 6, deck, 4, P.wood[1]);
    // The hinge rail the pair folds about, which also braces the two members
    // against each other.
    iso.beamY(4, 7, fx, 6, P.wood[0], 1);
  }
  iso.box(-4, 3, 26, 5, deck, deck + 2, {
    top: P.wood[3],
    lit: P.wood[2],
    shadow: P.wood[1],
    edge: P.ink,
  });
};

/**
 * A bench vise: two jaws, the screw between them, and the tommy bar.
 *
 * The bar is what makes it a vise rather than a lump of iron with a slot in it,
 * so it is drawn long and across the moving jaw, where a real one lives. The
 * two jaws take different rungs of the same ramp, because the single outline
 * pass runs over the finished cel and never between two touching parts — so
 * inside the silhouette a tone is the only thing that can separate one jaw from
 * the other, and a vise whose jaws are one colour is a grey box.
 */
const vise: Drawer = (iso, variant) => {
  const open = variant % 2;
  const fixed: Shade = { top: P.metal[0], lit: P.metal[2], shadow: P.metal[0], edge: P.ink };
  const moving: Shade = { top: P.metal[2], lit: P.metal[3], shadow: P.metal[1], edge: P.ink };
  iso.box(1, 1, 13, 10, 0, 3, {
    top: P.rust[2],
    lit: P.rust[3],
    shadow: P.rust[1],
    edge: P.ink,
  });
  iso.box(-1, 0, 16, 4, 3, 11, fixed);
  // The screw and the slide below it, which are only ever seen through the gap
  // between the jaws.
  iso.beamY(4, 8 + open, 4, 8, P.metal[1], 1);
  iso.beamY(4, 8 + open, 12, 5, P.metal[0], 1);
  iso.box(-1, 8 + open, 16, 4, 3, 11, moving);
  // The tommy bar, with a knob at each end so it reads as a bar rather than as
  // a stripe of highlight across the jaw.
  iso.beamX(0, 15, 12 + open, 6, P.metal[2], 1);
  iso.plot(-1, 12 + open, 6, P.metal[3]);
  iso.plot(15, 12 + open, 6, P.metal[3]);
};

/**
 * A joiner's bench: legs and a shelf under a thick top, with the job still on
 * it.
 *
 * The tool well along the back is the one piece of carpentry a table never has,
 * and it is why the top's far half is dark. The work left on the top is the
 * other half of the same read: a surface with nothing on it is a sideboard.
 */
const workbench: Drawer = (iso, variant) => {
  const deck = 10;
  // Legs first, so the top's two visible walls land on them instead of floating
  // over them.
  for (const [lx, ly] of [
    [1, 1],
    [19, 1],
    [1, 10],
    [19, 10],
  ] as const) {
    iso.post(lx, ly, 0, deck, P.wood[1], 1);
  }
  // The shelf between the frames. Its shadow line is what says something is
  // stored under here, which is what keeps this a bench and not a table.
  iso.box(1, 1, 18, 9, 3, 4, {
    top: P.wood[1],
    lit: P.wood[2],
    shadow: P.wood[0],
    edge: P.ink,
  });
  iso.box(-1, -1, 22, 13, deck, deck + 2, {
    top: P.wood[3],
    lit: P.wood[2],
    shadow: P.wood[1],
    edge: P.ink,
  });
  hollowBox(iso, -1, -1, 22, 5, deck + 2, deck + 3, {
    top: P.wood[1],
    lit: P.wood[2],
    shadow: P.wood[0],
    edge: P.ink,
    inner: P.wood[0],
  });
  // Sawn boards stacked at one end of the top.
  const stack = 2 + (variant % 2);
  for (let i = 0; i < stack; i++) {
    const z = deck + 2 + i * 2;
    iso.box(1, 5, 9, 4, z, z + 2, {
      top: P.wood[2],
      lit: P.wood[3],
      shadow: P.wood[1],
      edge: P.ink,
    });
  }
  // A saw left lying across the other end, its handle up.
  iso.box(13, 8, 8, 1, deck + 2, deck + 3, {
    top: P.metal[2],
    lit: P.metal[3],
    shadow: P.metal[1],
    edge: P.ink,
  });
  iso.box(18, 7, 3, 3, deck + 2, deck + 5, {
    top: P.wood[1],
    lit: P.wood[2],
    shadow: P.wood[0],
    edge: P.ink,
  });
  // A mallet stood on its head in the middle, which is the one object on the
  // top with any height to it and so the one that tells the top from the well
  // behind it.
  iso.post(14, 6, deck + 2, deck + 6, P.wood[3], 1);
  iso.box(12, 5, 4, 3, deck + 6, deck + 8, {
    top: P.wood[2],
    lit: P.wood[3],
    shadow: P.wood[1],
    edge: P.ink,
  });
};

/** Every workshop prop, as a checked total record: a name in `WORKSHOP_KINDS`
 *  with no entry here is a compile error rather than a prop that draws nothing. */
export const WORKSHOP_DRAWERS: Record<WorkshopKind, Drawer> = {
  bandsaw,
  grindstone,
  shavings,
  timberRack,
  toolboard,
  trestle,
  vise,
  workbench,
};
