// The tools: the small objects a Workshop's wall carries and a Yard's clutter
// hides.
//
// They are in the vocabulary for two reasons. A shop with bare walls is a room
// rather than a workshop — and these are the same tools the *workers* hold, so a
// wall and the moving figures agree about what is being used.
//
// The whole group is drawn to one rule: the silhouette *is* the tool. These are
// eight to twenty world units long, which on this 2:1 projection is four to ten
// pixels, and at that size a second volume costs more legibility than it buys.
// Five consequences run through every drawer here, and each was learned from a
// render of the finished cel rather than reasoned about:
//
//   - A joint between two volumes gets no ink. The registry outlines the cel
//     once, so a shape is told from its neighbour by being a different *tone* of
//     its ramp, never by an internal line. Two volumes in one step read as one
//     lump whatever the code calls them.
//   - `edge` is passed only where the wall it inks is three world units tall.
//     `edge` draws along a box's bottom, so on a two-unit course it inks the
//     whole visible wall and a stack of those comes out as a solid black plate.
//   - Depth costs as much screen width as width does: a member `h` units deep
//     projects `h/2` pixels wide, exactly as if it were `h` units wide in x. A
//     jaw drawn narrow in x but deep in y is therefore not narrow on screen.
//   - An opening narrower than three pixels does not survive. The outline inks
//     every empty pixel that touches art, so a one- or two-pixel gap floods and
//     prints as a drawn-on line rather than as a hole. Every deliberate opening
//     here is therefore sized at three pixels or more, or replaced by a
//     silhouette that needs no opening.
//   - A step that changes an extent two volumes share at one height moves by an
//     even number of units, or the volumes overlap instead. The projection
//     halves the difference of x and y, so a one-unit step is half a pixel and
//     rounds into a one-pixel notch the outline then inks. Stacked courses
//     escape the rule by overlapping — which is how the spade's plate tapers by
//     one unit at a time without gaining a seam.
//
// Placement follows what a person does with the object: most of these lie flat,
// because a site's hand tools are put down where they were used, and their long
// axes are spread across both diagonals rather than all pointing the same way.
// The ladder leans, because a ladder is always against something; the spade
// stands, because a spade is left standing on its own blade. That mix is what
// keeps ten small props from reading as ten variations of one horizontal lump.

import { type IsoPix } from "../iso";
import { type Ink } from "../surface";
import { P } from "../palette";
import { type Drawer, type ToolKind } from "./kinds";

/** The cel's "nothing here" pixel, for the one drawer that has to take a shape
 *  away instead of adding one. */
const CLEAR = [0, 0, 0, 0] as const;

/**
 * slant draws a member that leans: it drifts across the ground as it climbs.
 *
 * `post` is vertical-only, and a leaning ladder rail is exactly the shape a
 * vertical primitive cannot make. The run is stepped along its longest axis and
 * each step draws a short column rather than a single pixel, because one plot
 * per world unit leaves the 2:1 stair gaps that read as a dotted line; `thick`
 * is that column's length in z.
 */
function slant(
  iso: IsoPix,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  ink: Ink,
  thick = 2,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const steps = Math.max(1, Math.round(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz))));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    iso.column(x0 + dx * t, y0 + dy * t, z0 + dz * t - (thick - 1), z0 + dz * t, ink);
  }
}

/**
 * toothEdge bites a one-pixel tooth out of the bottom of every other screen
 * column across a span, which is what turns a blade into a saw.
 *
 * Teeth cannot be cut in plan. Alternating a blade's world depth moves its
 * screen edge by half a pixel, which the rounding swallows, so the blade comes
 * back with a straight back — a knife. Taking the pixels the blade already has,
 * in screen columns, is the only way to get an exact zigzag; and two pixels have
 * to go, not one, because the outline then inks the upper of them and the saw
 * keeps a single pixel of genuine background between its teeth.
 */
function toothEdge(iso: IsoPix, x0: number, x1: number): void {
  for (let x = Math.round(x0); x <= Math.round(x1); x++) {
    if (x % 2 !== 0) continue;
    let taken = 0;
    for (let y = iso.pix.h - 1; y >= 0 && taken < 2; y--) {
      if (!iso.pix.isOpaque(x, y)) continue;
      iso.pix.set(x, y, CLEAR);
      taken++;
    }
  }
}

/** An axe: the head on the ground and the haft leaning up out of it, which is
 *  how an axe is actually left. The haft carries the silhouette — a head as long
 *  as its handle reads as a hammer — so it is drawn at full length and the head
 *  only as far as the bit. */
const axe: Drawer = (iso) => {
  // The haft, up and to the left, two runs side by side because one world unit
  // of depth is half a pixel and a single run would be a dotted line.
  slant(iso, 4, 4, 3, 4, 20, 16, P.wood[2], 2);
  slant(iso, 6, 4, 3, 6, 20, 16, P.wood[3], 2);

  // The head, out along world x from the eye, in three steps that flare in depth
  // and brighten toward the bit. One shared top height across the steps: giving
  // each its own height put a one-pixel gap between them, and the outline
  // printed the head as three loose tabs instead of one solid wedge.
  iso.box(2, 4, 4, 4, 0, 4, { top: P.metal[1], lit: P.metal[2], shadow: P.metal[0] });
  iso.box(6, 3, 4, 6, 0, 4, { top: P.metal[2], lit: P.metal[3], shadow: P.metal[0] });
  iso.box(10, 2, 4, 8, 0, 4, { top: P.metal[3], lit: P.metal[3], shadow: P.metal[1] });
};

/** A chisel: a turned handle, a ferrule, a worn shank, and a flat edge that
 *  flares wider than the shank. The tone walks handle-bright-dark-bright, and
 *  that alternation is the read — all one steel and the tool is a rod, and a
 *  single taper instead of a flare is a knife. */
const chisel: Drawer = (iso) => {
  // The handle, four units deep against the shank's two: the whole difference
  // between a chisel's shaft and a screwdriver's is that proportion.
  iso.box(-8, 2, 6, 5, 0, 4, { top: P.wood[2], lit: P.wood[3], shadow: P.wood[1], edge: P.ink });
  iso.box(-2, 2, 2, 5, 0, 4, { top: P.metal[3], lit: P.metal[3], shadow: P.metal[2] });
  // The shank, in the palette's dullest steel, so the two bright ends bracket a
  // dark middle rather than merging into one long highlight.
  iso.box(0, 4, 6, 2, 0, 2, { top: P.metal[0], lit: P.metal[1], shadow: P.metal[0] });
  // The edge: across the shank's line and three times its depth, and bright.
  iso.box(6, 2, 3, 6, 0, 3, { top: P.metal[3], lit: P.metal[3], shadow: P.metal[1] });
};

/** A clamp: a bar, two jaws across it, and a screw out of the sliding jaw. It is
 *  the only tool here with two pieces at right angles, so it is the one that has
 *  to read as a mechanism — hence the bar in dark steel against rust jaws, and
 *  the screw left bright with a wooden tommy bar across it. In one ramp the
 *  whole thing is a brick with a slot in it.
 *
 *  It is the one prop here laid along world y, so it is the only one whose long
 *  axis runs down-left: with the axe, chisel, plane and saw all pointing
 *  down-right, a fifth would have been a fifth diagonal on one line. */
const clamp: Drawer = (iso) => {
  // The bar, the piece everything else clamps onto and the only long run on this
  // axis in the whole group.
  iso.box(4, 0, 3, 18, 0, 2, { top: P.metal[1], lit: P.metal[2], shadow: P.metal[0] });
  // The jaws: the fixed one taller and wider, the sliding one lower and
  // narrower. A matched pair reads as one jaw drawn twice.
  iso.box(1, 0, 8, 3, 2, 8, { top: P.rust[2], lit: P.rust[3], shadow: P.rust[1], edge: P.ink });
  iso.box(2, 13, 6, 3, 2, 7, { top: P.rust[3], lit: P.rust[2], shadow: P.rust[1], edge: P.ink });
  // The screw, out of the sliding jaw along the bar's own axis, with the tommy
  // bar across its end. A rod alone is a pin; a bar at right angles to it is
  // what makes a screw. Both are two units thick so neither breaks into dots.
  iso.beamY(16, 22, 5, 4, P.metal[3], 2);
  iso.beamX(1, 9, 22, 4, P.wood[2], 2);
};

/** A hand plane: a long sole, a low body, a squat knob at the front and a tall
 *  tote at the back. The two handles are deliberately unlike in height — a
 *  matched pair reads as two knobs, and one alone as a plane with a handle
 *  missing. The sole running past the body at both ends is what stops the whole
 *  thing reading as a block on a board. */
const handplane: Drawer = (iso, variant) => {
  const len = 16 + (variant % 3) * 2;

  // Sole and body share a depth on purpose. Giving the sole its own, shallower
  // depth — which is nearer how a plane looks from above — put its near wall one
  // unit in front of the body's and fenced that step off in ink. The tone
  // difference is what separates the parts.
  iso.box(-3, 3, len + 6, 5, 0, 2, { top: P.wood[0], lit: P.wood[1], shadow: P.wood[0] });
  iso.box(0, 3, len, 5, 2, 6, { top: P.wood[3], lit: P.wood[2], shadow: P.wood[1], edge: P.ink });
  iso.box(1, 4, 4, 3, 6, 8, { top: P.wood[3], lit: P.wood[3], shadow: P.wood[1] });
  iso.box(len - 4, 4, 3, 3, 6, 13, { top: P.wood[3], lit: P.wood[2], shadow: P.wood[0] });
  // The iron, standing proud of the body's top just ahead of the tote. One
  // bright block above a flat brown lid is the pixel that says this block cuts.
  iso.box(len - 8, 4, 2, 3, 6, 9, { top: P.metal[3], lit: P.metal[3], shadow: P.metal[1] });
};

/** A handsaw: a long blade toothed along its lower edge, with a stepped grip
 *  rising behind it. The teeth are the whole prop — a blade on a grip without
 *  them is a knife. */
const handsaw: Drawer = (iso, variant) => {
  const len = 17 + (variant % 3);
  const depth = 6;

  iso.box(0, 0, len, depth, 0, 2, { top: P.metal[2], lit: P.metal[3], shadow: P.metal[1] });
  // Teeth along the near edge only: the far edge is hidden behind the blade from
  // this camera, so a saw cut there would put the zigzag where nobody can see it.
  toothEdge(iso, iso.project(0, depth, 0).x + 1, iso.project(len, 0, 0).x);

  // The grip, in two blocks of unlike width so the silhouette steps where a hand
  // goes. It is not a loop: a hole this small floods with ink, and a hole ringed
  // in ink reads as a drawn-on smile rather than as an opening.
  iso.box(-8, 1, 8, 5, 0, 4, { top: P.wood[2], lit: P.wood[3], shadow: P.wood[1], edge: P.ink });
  iso.box(-8, 1, 5, 5, 4, 9, { top: P.wood[3], lit: P.wood[2], shadow: P.wood[0] });
};

/** A ladder: two rails and their rungs, leaning. It is the tallest prop in the
 *  town, which is the point — a scaffolded building reads as being worked on
 *  because something reaches up its face. */
const ladder: Drawer = (iso, variant) => {
  const climb = 11;
  const height = 24;
  const rungs = 4 + (variant % 3);

  // The rails are stepped in whole units of height, and the rungs are placed at
  // whole units too, so that a rung's end pixel *is* a rail's own pixel. Setting
  // the rungs between the rail's steps put them half a pixel off the rail and
  // left a one-pixel hole at every joint, which the outline then ringed in ink.
  //
  // Each rail is two runs two units apart, because one world unit of depth is
  // half a pixel and a single run would be a dotted line. They are told apart by
  // tone, never by an ink line: ink here would be a rung.
  const rail = (yBase: number, ink: Ink): void => {
    for (let z = 0; z <= height; z++) {
      const x = (climb * z) / height;
      iso.column(x, yBase, z, z + 1, ink);
      iso.column(x, yBase + 2, z, z + 1, ink);
    }
  };
  rail(14, P.wood[2]);
  rail(0, P.wood[1]);

  // One unit thick and brighter than the rails: at this projection a two-unit
  // rung closes the gap to the next one and the ladder reads as a plank with a
  // zigzag edge.
  for (let k = 1; k <= rungs; k++) {
    const z = Math.round((height * k) / (rungs + 1));
    iso.beamY(0, 16, (climb * z) / height, z, P.wood[3], 1);
  }
};

/** An oil can: a foot, a squat body, a narrow neck, and a long spout. The spout
 *  and the neck are the tool — a body without them is a tin, and the neck is
 *  what makes the spout a pour rather than a handle sticking out of a drum. */
const oilcan: Drawer = (iso) => {
  // The foot is a unit in from the body on every side, so it reads as a base
  // rather than as a second, smaller drum. It carries no `edge`: it is two units
  // tall, so the bottom row the edge would ink is the whole wall.
  iso.box(1, 1, 12, 12, 0, 2, { top: P.metal[1], lit: P.metal[2], shadow: P.metal[0] });
  iso.box(0, 0, 14, 14, 2, 8, { top: P.metal[2], lit: P.metal[3], shadow: P.metal[1], edge: P.ink });
  // The neck: four units narrower on every side, so the shoulder is a step a
  // reader can see rather than a seam.
  iso.box(4, 4, 6, 6, 8, 12, { top: P.metal[3], lit: P.metal[3], shadow: P.metal[2], edge: P.ink });
  // The spout, off the shoulder and up. It is one pixel across on screen between
  // its two runs, which is right for a spout and is why the pair is drawn: a
  // single run breaks into dots.
  slant(iso, 10, 4, 9, 17, 4, 19, P.metal[3], 2);
  slant(iso, 10, 6, 9, 17, 6, 19, P.metal[2], 2);
};

/** A coil of rope: a thick ring of cable lying flat, with the loose end out. The
 *  opening is the prop — a solid disc of the palette's darkest ramp is a tyre —
 *  so the band is made as thin as the projection allows and the middle is left
 *  as genuine empty cel for the outline to ring.
 *
 *  The ring's own foreshortening is the constraint: a circle in this projection
 *  is an ellipse two to one, so a hole six world units across is only three
 *  pixels of screen height, and the outline takes one of those from each side.
 *  Eight across is what finally leaves a hole a reader can see through. */
const ropeCoil: Drawer = (iso, variant) => {
  const outer = 10 + (variant % 2);
  const inner = 8;
  const cx = 8;
  const cy = 8;
  const top = 3;

  for (let wy = -outer; wy <= outer; wy++) {
    for (let wx = -outer; wx <= outer; wx++) {
      const d = Math.sqrt(wx * wx + wy * wy);
      if (d > outer || d < inner) continue;
      iso.plot(cx + wx, cy + wy, top, P.canvas[3]);
      // The outer wall exists only where the camera can see it: outward faces
      // point toward +x and +y. A wall on the *inner* rim too was the first
      // version, and because a wall hangs downward on screen the near half of it
      // closed the hole the coil is drawn for.
      if (d > outer - 2.5 && wx + wy > 0) {
        iso.column(cx + wx, cy + wy, 0, top - 1, wy > wx ? P.canvas[2] : P.canvas[1]);
      }
    }
  }

  // The loose end, out across the ground. It starts inside the ring's own near
  // wall so the two are continuous; begun at the rim it left a pocket of empty
  // cel between the end and the coil, which the outline inked as a gap. A rope
  // ring with no end at all reads as a gasket.
  slant(iso, cx - 1, cy + outer - 1, 1, cx - 6, cy + outer + 5, 0, P.canvas[2], 1);
};

/** A spade: a broad blade cut off straight at the ground, a shaft, and a T at
 *  the top. It stands, because a spade is left standing on its own blade — and
 *  standing is what separates it from everything else in this group lying down.
 */
const spade: Drawer = (iso) => {
  // The blade climbs in courses that narrow as they go, so it is widest at its
  // cutting edge and tapers to the socket. All four share one shade and carry no
  // `edge`: a spade's plate is a single flat piece, so a seam would read as four
  // slabs stacked rather than as one taper. The straight bottom course is the cut.
  const plate = { top: P.metal[1], lit: P.metal[2], shadow: P.metal[0] };
  iso.box(1, 3, 9, 2, 0, 2, plate);
  iso.box(2, 3, 7, 2, 2, 4, plate);
  iso.box(3, 3, 5, 2, 4, 6, plate);
  iso.box(4, 3, 3, 2, 6, 8, plate);

  // The shaft, in the blade's own plane so the tool reads as one object.
  iso.post(5, 3, 7, 20, P.wood[2], 1);
  iso.post(6, 3, 7, 20, P.wood[3], 1);

  // The grip is a T, not a D. A D-grip's opening is the whole point of it, and
  // at nine units of blade width there is no room for an opening wide enough to
  // survive the outline — a D here came out as a mushroom head over a stem. A
  // crossbar at the top is the shape this size can carry, and it is a real
  // spade's handle besides.
  iso.beamX(1, 10, 3, 21, P.wood[3], 2);
  iso.beamX(1, 10, 3, 19, P.wood[2], 1);
};

/** A trowel: a leaf-shaped blade with a short handle, lying along the opposite
 *  diagonal from the chisel. That axis is deliberate — the two are the group's
 *  thin flat tools, and the way they differ is the growing-then-pointed leaf
 *  against the rod with a squared end. */
const trowel: Drawer = (iso) => {
  // The blade, four courses of one shade, widening from the ferrule to its
  // middle and then coming to a point. The steps are invisible on purpose, so
  // only the outline's width changes and the plate reads as one leaf. Each
  // course starts inside the last in both axes, so consecutive courses overlap
  // and leave no notch to ink.
  const leaf = { top: P.metal[3], lit: P.metal[2], shadow: P.metal[1] };
  iso.box(3, 0, 6, 3, 0, 2, leaf);
  iso.box(2, 2, 8, 4, 0, 2, leaf);
  iso.box(3, 5, 6, 4, 0, 2, leaf);
  iso.box(4, 8, 4, 2, 0, 2, leaf);

  // The handle runs one unit into the blade's own depth. Butted against the
  // blade's far edge instead, its near wall landed on the blade's and the
  // outline printed the joint as a dark bar across the plate.
  iso.box(4, -7, 4, 8, 0, 3, { top: P.wood[2], lit: P.wood[3], shadow: P.wood[1], edge: P.ink });
  // The ferrule, sitting on the blade at the joint, so the handle reads as fixed
  // rather than as a stick lying across a leaf.
  iso.box(3, 0, 5, 2, 3, 4, { top: P.metal[1], lit: P.metal[2], shadow: P.metal[0] });
};

/** Every hand tool, as a checked total record: a name in `TOOL_KINDS` with no
 *  entry here is a compile error rather than a prop that draws nothing. */
export const TOOL_DRAWERS: Record<ToolKind, Drawer> = {
  axe,
  chisel,
  clamp,
  handplane,
  handsaw,
  ladder,
  oilcan,
  ropeCoil,
  spade,
  trowel,
};
