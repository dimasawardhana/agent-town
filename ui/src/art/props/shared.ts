// The shared group: stock that stands on every kind of site.
//
// These are the props that make a place read as *working* before a reader can
// tell what work it is — a barrow, a stack of timber, a lamp. They are drawn
// first because the three special places each start from this set and add their
// own furniture to it, so a Yard and a Workshop already look like two parts of
// one town before either has anything characteristic in it.
//
// Several were the town's original props. They have been kept rather than
// redrawn: they were already the right shapes, and replacing working art to
// look busy is how a set loses its internal consistency.

import { P } from "../palette";
import { type Drawer, type SharedKind } from "./kinds";

/**
 * A wheelbarrow: a shallow tray on one wheel, with the handles up and back.
 *
 * The wheel is an octagon from the shared `disc` part. A true circle is
 * impossible at four pixels of radius, and an octagon is what the hardware
 * actually used; its flat bottom is also what reads as "resting on the ground"
 * rather than "floating above it".
 */
const wheelbarrow: Drawer = (iso) => {
  // Tray: a box with a hollow top, so it reads as a container rather than a
  // block. The inner floor is one step darker than the walls.
  iso.box(0, 0, 18, 12, 0, 6, {
    top: P.wood[0],
    lit: P.wood[2],
    shadow: P.wood[1],
    edge: P.ink,
  });
  // The tray's rim: the lit top edge on the near side, which is what says the
  // thing is open.
  iso.beamY(0, 12, 18, 6, P.wood[3], 1);
  iso.beamX(0, 18, 12, 6, P.wood[2], 1);

  // Wheel: a metal tyre with a wooden hub, drawn at the tray's far end.
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    iso.plot(2 + Math.cos(ang) * 3, 6 + Math.sin(ang) * 2, 1, P.metal[0]);
  }
  iso.plot(2, 6, 2, P.metal[2]);
  iso.plot(2, 6, 0, P.wood[0]);

  // Handles: two lengths of timber running up and away from the tray. A barrow
  // with no handles is a box.
  iso.beamY(-8, 0, 4, 7, P.wood[3], 1);
  iso.beamY(-8, 0, 14, 7, P.wood[2], 1);
  // Legs, so it stands rather than floats.
  iso.post(16, 10, 0, 4, P.wood[1], 1);
  iso.post(8, 10, 0, 4, P.wood[1], 1);
};

/** A stack of bricks in courses, offset by half a brick per row so the pile
 *  interlocks instead of reading as one terracotta lump. */
const bricks: Drawer = (iso, variant) => {
  const rows = 3 + (variant % 2);
  const bw = 14;
  const bd = 8;
  for (let r = 0; r < rows; r++) {
    const z = r * 4;
    const inset = (r % 2) * 2;
    iso.box(inset, 0, bw, bd, z, z + 3, {
      top: P.roof[2],
      lit: P.roof[3],
      shadow: P.roof[1],
      edge: P.ink,
    });
    // Mortar line: the light top edge of the course below, which is what makes
    // a pile of bricks read as bricks and not as one lump.
    iso.beamX(inset, inset + bw, bd, z + 3, P.stone[3], 1);
  }
};

/** Sawn lumber, hand-stacked: alternating planks so the pile has a tooth, and
 *  end grain at the near end so a reader can count the boards. */
const lumber: Drawer = (iso, variant) => {
  const planks = 4 + (variant % 3);
  const len = 22;
  const wide = 9;
  for (let i = 0; i < planks; i++) {
    const z = i * 3;
    const off = i % 2 === 0 ? 0 : 1;
    iso.box(off, 0, len - off, wide, z, z + 2, {
      top: P.wood[3],
      lit: P.wood[2],
      shadow: P.wood[1],
      edge: P.ink,
    });
  }
  for (let i = 0; i < planks; i++) {
    iso.beamY(0, wide, i % 2 === 0 ? 0 : 1, i * 3 + 1, P.wood[0], 1);
  }
};

/** A tool chest: a lidded box banded in metal, with a hammer leaning on it.
 *  The leaning tool is the difference between "a box" and "somebody's chest". */
const toolchest: Drawer = (iso) => {
  iso.box(0, 0, 16, 11, 0, 8, {
    top: P.wood[2],
    lit: P.wood[3],
    shadow: P.wood[1],
    edge: P.ink,
  });
  // The lid: one unit proud of the body, which is what makes it read as a
  // closed chest instead of an open crate.
  iso.box(-1, -1, 18, 13, 8, 10, {
    top: P.wood[3],
    lit: P.wood[2],
    shadow: P.wood[0],
    edge: P.ink,
  });
  // Metal bands and a clasp, so it is a chest and not a box.
  iso.beamY(0, 11, 5, 9, P.metal[1], 1);
  iso.beamY(0, 11, 5, 2, P.metal[1], 1);
  iso.plot(5, 11, 6, P.accent);
  // A hammer leaning against it: the one tool a working site always has.
  iso.post(18, 4, 0, 11, P.wood[2], 1);
  iso.box(17, 3, 4, 3, 11, 13, {
    top: P.metal[3],
    lit: P.metal[2],
    shadow: P.metal[1],
    edge: P.ink,
  });
};

/** An open crate of boards: work in progress rather than stored goods. The
 *  board sticking out of the top is what says so. */
const crate: Drawer = (iso) => {
  iso.box(0, 0, 14, 10, 0, 7, {
    top: P.wood[0],
    lit: P.wood[2],
    shadow: P.wood[1],
    edge: P.ink,
  });
  // Slats, one ramp step up, so the box is visibly made of boards.
  for (let i = 1; i < 4; i++) {
    iso.column(Math.round((14 * i) / 4), 10, 1, 6, P.wood[3]);
    iso.column(14, Math.round((10 * i) / 4), 1, 6, P.wood[2]);
  }
  // A board sticking out of the top: the crate is being packed or unpacked.
  iso.box(3, 2, 3, 12, 7, 9, {
    top: P.wood[3],
    lit: P.wood[2],
    shadow: P.wood[1],
    edge: P.ink,
  });
};

/** A sawhorse: two A-frames and a plank across them. The trestle a board is
 *  laid on to be cut, so it belongs wherever anything is measured. */
const sawhorse: Drawer = (iso) => {
  iso.post(0, 0, 0, 9, P.wood[2], 1);
  iso.post(0, 9, 0, 9, P.wood[1], 1);
  iso.post(18, 0, 0, 9, P.wood[2], 1);
  iso.post(18, 9, 0, 9, P.wood[1], 1);
  // The cross-beam, and the plank resting on it.
  iso.beamY(0, 9, 0, 9, P.wood[2], 1);
  iso.beamY(0, 9, 18, 9, P.wood[1], 1);
  iso.box(-2, -1, 26, 13, 9, 11, {
    top: P.wood[3],
    lit: P.wood[2],
    shadow: P.wood[1],
    edge: P.ink,
  });
};

/** A barrel: staves and two iron hoops, with its belly wider than its ends.
 *  That swell is the whole read — a straight-sided drum is a bin. */
const barrel: Drawer = (iso) => {
  iso.box(1, 1, 12, 12, 1, 3, { top: P.wood[1], lit: P.wood[2], shadow: P.wood[0], edge: P.ink });
  iso.box(0, 0, 14, 14, 3, 10, { top: P.wood[1], lit: P.wood[3], shadow: P.wood[1], edge: P.ink });
  iso.box(1, 1, 12, 12, 10, 12, { top: P.wood[1], lit: P.wood[2], shadow: P.wood[0], edge: P.ink });
  // Hoops, at the two heights a real cask is bound.
  iso.beamY(0, 14, 14, 5, P.metal[1], 1);
  iso.beamY(0, 14, 14, 9, P.metal[1], 1);
  iso.beamY(0, 14, 0, 5, P.metal[0], 1);
  // The lid, a shade lighter so the top reads at 1x.
  iso.box(1, 1, 12, 12, 12, 13, { top: P.wood[3], lit: P.wood[2], shadow: P.wood[1], edge: P.ink });
};

/** A post with a banded cap: the marker that ends a place. A pair of these
 *  reads as a boundary even when the ground either side is the same colour. */
const bollard: Drawer = (iso) => {
  iso.box(0, 0, 5, 5, 0, 12, {
    top: P.wood[2],
    lit: P.wood[3],
    shadow: P.wood[1],
    edge: P.ink,
  });
  iso.beamY(0, 5, 5, 13, P.metal[1], 1);
};

/** A site lamp on a post: the town's one light that is not the sun, which is
 *  why it takes the accent's warm yellow. */
const lamp: Drawer = (iso) => {
  iso.post(2, 2, 0, 16, P.metal[1], 1);
  iso.box(0, 0, 7, 7, 16, 18, {
    top: P.metal[3],
    lit: P.metal[2],
    shadow: P.metal[1],
    edge: P.ink,
  });
  // The glass, in the palette's one warm glow, so a lit place reads as lit.
  iso.box(1, 1, 5, 5, 13, 16, {
    top: P.accent,
    lit: P.helmetChief[3],
    shadow: P.accentDim,
    edge: P.ink,
  });
};

/** A sack of material: a soft body with a tied neck. Cloth rather than timber,
 *  so a site with one on it is a site that handles goods, not just boards. */
const sack: Drawer = (iso) => {
  iso.box(1, 1, 11, 9, 0, 9, { top: P.canvas[2], lit: P.canvas[3], shadow: P.canvas[1], edge: P.ink });
  iso.box(3, 3, 7, 5, 9, 11, { top: P.canvas[3], lit: P.canvas[2], shadow: P.canvas[1], edge: P.ink });
  // The tie at the neck.
  iso.beamY(3, 8, 4, 10, P.leather, 1);
};

/**
 * A signpost: a board on a post, drawn blank.
 *
 * The board is blank on purpose. Every place already letters its own name onto
 * its ground with the scene's typesetter, and a signpost carrying a second copy
 * of that name would be two labels for one thing — but a *post* under the
 * lettering is what turns the lettering from a caption into a sign. The scene
 * draws its placard at this prop's board height.
 */
const signpost: Drawer = (iso) => {
  // The post.
  iso.post(4, 4, 0, 17, P.wood[1], 2);
  // The board: wide, thin, and high enough that a placard fits over it.
  iso.box(-2, 3, 14, 2, 14, 19, {
    top: P.wood[3],
    lit: P.wood[2],
    shadow: P.wood[0],
    edge: P.ink,
  });
  // A batten across the back of the board, so it reads as fixed to the post.
  iso.beamY(3, 5, -2, 15, P.wood[0], 1);
};

/** A three-legged stool. Somebody sits down somewhere all day, and a place with
 *  nowhere to sit reads as a corridor rather than as a place. */
const stool: Drawer = (iso) => {
  // The seat.
  iso.box(0, 0, 9, 9, 7, 9, {
    top: P.wood[3],
    lit: P.wood[2],
    shadow: P.wood[1],
    edge: P.ink,
  });
  // Three splayed legs: one at the far corner, two at the near ones. Three
  // rather than four because at this size the fourth lands on top of the first
  // and the seat gains a leg and loses a shadow.
  iso.post(0, 0, 0, 7, P.wood[1], 1);
  iso.post(8, 1, 0, 7, P.wood[0], 1);
  iso.post(1, 8, 0, 7, P.wood[2], 1);
  // A stretcher between the near legs, which is what stops it looking like a
  // table with two legs missing.
  iso.beamX(1, 8, 8, 3, P.wood[0], 1);
};

/** Every shared prop, as a checked total record: a name in `SHARED_KINDS` with
 *  no entry here is a compile error rather than a prop that draws nothing. */
export const SHARED_DRAWERS: Record<SharedKind, Drawer> = {
  barrel,
  bollard,
  bricks,
  crate,
  lamp,
  lumber,
  sack,
  sawhorse,
  signpost,
  stool,
  toolchest,
  wheelbarrow,
};
