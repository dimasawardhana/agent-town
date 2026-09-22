// The Depot group: work *about* the work.
//
// Planning, dispatch, notes and evaluation build nothing, so nothing here is
// site material. A Depot furnished like a building site would say the wrong
// thing about the third of a session spent here — which is why this set holds no
// timber, no brick and no barrow, and why the props are the things *thinking*
// needs: a surface to spread a plan on, a record to write in, a way to send and
// a way to measure.
//
// The shapes follow from that. The Depot's furniture is nearly all *horizontal
// surfaces with things on them* and *upright boards with things pinned to them*,
// where the Yard is volumes and the Workshop is machines. That is what makes the
// three plates tell apart at a glance even before a reader has learnt which is
// which: one place is heaps, one is mechanisms, this one is planes.
//
// `anvil` and `planboard` are the town's two oldest Depot props, kept rather
// than redrawn. They were already the right shapes, and replacing working art to
// look busy is how a set loses its internal consistency.

import { type IsoPix } from "../iso";
import { P } from "../palette";
import { type Drawer, type DepotKind } from "./kinds";
import { bracedBoard, disc, hollowBox } from "./parts";

/**
 * face paints a rectangle on the wall plane at `wy`, seen edge-on.
 *
 * It is a run of columns rather than a `box`, because a box needs a depth and a
 * panel on a wall has none — its thickness is one pixel of ink that the outline
 * pass supplies. Drawing it this way also puts the rectangle exactly where its
 * world coordinates say, which is what lets a drawer place a paper or a slot by
 * the same arithmetic as the body it sits on rather than by eye.
 */
function face(
  iso: IsoPix,
  wx0: number,
  wx1: number,
  wy: number,
  z0: number,
  z1: number,
  ink: string,
): void {
  for (let wx = wx0; wx <= wx1; wx++) iso.column(wx, wy, z0, z1, ink);
}

/**
 * paper is a pinned sheet: a pale panel with one ruled line across it.
 *
 * The line is the whole difference between a sheet of paper and a pale
 * rectangle. At four pixels wide the eye reads a mark *on* something, not the
 * something — and a Depot whose notices are blank cards says nothing was
 * written down, which is the opposite of what this place is for.
 */
function paper(
  iso: IsoPix,
  wx: number,
  wy: number,
  z0: number,
  z1: number,
  wide = 6,
): void {
  face(iso, wx, wx + wide - 1, wy, z0, z1, P.paper);
  // Two ruled lines, in the ink a record is kept in: blue, not black, so a
  // written sheet is not mistaken for the dark board behind it.
  const mid = Math.round((z0 + z1) / 2);
  iso.beamX(wx, wx + wide - 1, wy, mid + 1, P.glass[2], 1);
  iso.beamX(wx, wx + Math.max(0, wide - 3), wy, mid, P.glass[1], 1);
}

/** A drafting table: a large surface tilted toward the viewer.
 *
 * The tilt is the whole read. A level table is a desk, and at this size a desk
 * with nothing on it is a brown rectangle; raising the far edge turns the same
 * four legs into the one piece of furniture that says *drawing*. The T-square
 * along the near edge is the second thing a reader's eye finds, and it is what
 * stops the tilted top reading as a lid. */
const drafting: Drawer = (iso, variant) => {
  const zTop = 12;
  // Legs first, so the table lands on them.
  iso.post(1, 1, 0, 9, P.wood[1], 1);
  iso.post(17, 1, 0, 11, P.wood[2], 1);
  iso.post(1, 11, 0, 11, P.wood[2], 1);
  iso.post(17, 11, 0, 9, P.wood[1], 1);

  // The top, drawn as three overlapping slabs at increasing heights: a single
  // flat box cannot be tilted, and three steps across its depth is the smallest
  // number that reads as a slope rather than as a staircase.
  for (let i = 0; i < 3; i++) {
    const wy = i * 4;
    const z = zTop + i * 2;
    iso.box(0, wy, 20, 4, z - 1, z, {
      top: P.wood[3],
      lit: P.wood[2],
      shadow: P.wood[1],
      edge: P.ink,
    });
  }

  // The plan on it, and the T-square along the near edge.
  const sheets = 2 + (variant % 2);
  for (let i = 0; i < sheets; i++) {
    paper(iso, 4 + i * 5, 2 + i, zTop + 1 + i, zTop + 5 + i, 6);
  }
  iso.beamX(-1, 21, 12, zTop - 1, P.metal[3], 1);
  iso.beamY(11, 13, -1, zTop, P.metal[2], 1);
};

/** A noticeboard on two posts, with pinned sheets at different angles.
 *
 * The differing heights and widths are the point: a board of identical cards
 * reads as a pattern printed on the board, and the whole claim of a noticeboard
 * is that people put things on it one at a time. */
const noticeboard: Drawer = (iso, variant) => {
  bracedBoard(iso, 0, 0, 22, 0, 22, {
    top: P.wood[2],
    lit: P.canvas[1],
    shadow: P.canvas[0],
    face: P.canvas[2],
    edge: P.ink,
  });
  // Pinned sheets. Their z and width both vary, and the last one hangs low
  // enough to break the board's own top line — which is what makes the board
  // read as *full* rather than as decorated.
  const sheets: [number, number, number, number][] = [
    [2, 6, 12, 15],
    [9, 5, 13, 18],
    [15, 7, 10, 14],
  ];
  sheets.slice(0, 2 + (variant % 2)).forEach(([wx, wide, z0, z1]) => {
    paper(iso, wx, 0, z0, z1, wide);
  });
  // A pin rail across the board's face, so the board is a board and not a wall.
  iso.beamX(0, 21, 0, 20, P.wood[0], 1);
};

/** Shelving: three bays holding visibly different things.
 *
 * The difference between a stacked box and a shelf is the *gap* — you see the
 * underside of the board above. And the difference between a shelf and a grid is
 * that its bays hold different objects, so each one is drawn as itself rather
 * than as a repeat. */
const shelving: Drawer = (iso) => {
  // The carcass: four boards on uprights, at a pitch low enough that the unit
  // plus whatever stands on its top board fits the cel.
  //
  // The cel's ceiling is the far corner's own projection — the topmost pixel a
  // point can use is `PROP_ORIGIN.y - (z - (wx + wy) / 4)` — so headroom grows
  // as a point moves toward the far corner and shrinks toward the near one. That
  // is why the taller items on the top board are set back toward the origin
  // rather than spread across it. Overflow is silent: the drawing simply stops
  // at the cel edge and the outline pass clips, which is how this was caught.
  const top = 23;
  const shelves = [0, 7, 14, top];
  iso.post(0, 0, 0, top + 2, P.wood[1], 1);
  iso.post(18, 0, 0, top + 2, P.wood[1], 1);
  iso.post(0, 9, 0, top + 2, P.wood[0], 1);
  iso.post(18, 9, 0, top + 2, P.wood[0], 1);
  for (const z of shelves) {
    iso.box(0, 0, 18, 9, z, z + 2, {
      top: P.wood[3],
      lit: P.wood[2],
      shadow: P.wood[1],
      edge: P.ink,
    });
  }
  // Bay one: a stack of boxed files, banded in glass blue.
  iso.box(2, 1, 13, 6, 9, 14, { top: P.paperDim, lit: P.paper, shadow: P.paperDim, edge: P.ink });
  iso.beamY(1, 7, 8, 12, P.glass[0], 1);
  // Bay two: a coiled cable, the one circle in the Depot.
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    iso.plot(9 + Math.cos(ang) * 5, 4 + Math.sin(ang) * 3, 16, a % 2 === 0 ? P.rubber[3] : P.rubber[2]);
  }
  // Bay three: a crate and a jar on the top board.
  //
  // Their heights are set by arithmetic rather than by eye. The topmost row a
  // point may use is `PROP_ORIGIN.y - (z - (wx+wy)/4)`, so the *far* corner of a
  // box is its highest-drawn pixel and the ceiling gets tighter with `z` faster
  // than the corner's projection loosens it. A crate at z=29 lands on row 0 and
  // clips; at z=26 its far corner lands on row 3, which leaves the outline its
  // row. Keeping the stack two units lower is what buys that margin.
  iso.box(3, 2, 8, 6, top + 2, top + 3, {
    top: P.canvas[2],
    lit: P.canvas[3],
    shadow: P.canvas[1],
    edge: P.ink,
  });
  iso.box(12, 3, 5, 5, top + 2, top + 4, {
    top: P.glass[3],
    lit: P.glass[2],
    shadow: P.glass[1],
    edge: P.ink,
  });
};

/** A filing cabinet with one drawer open.
 *
 * The pulled drawer is the read: three flush drawer fronts are just a box with
 * lines on it, and the moment one slides out the object becomes unambiguously a
 * cabinet. It also gives the near flank a second silhouette to break up. */
const cabinet: Drawer = (iso) => {
  iso.box(0, 0, 15, 10, 0, 20, {
    top: P.metal[2],
    lit: P.metal[3],
    shadow: P.metal[1],
    edge: P.ink,
  });
  // Three drawer fronts, with a gap between each pair.
  for (let i = 0; i < 3; i++) {
    const z = 2 + i * 6;
    face(iso, 1, 14, 10, z, z + 4, P.metal[2]);
    // The label plate and the handle on each.
    face(iso, 3, 8, 10, z + 2, z + 3, P.paperDim);
    iso.beamX(11, 13, 10, z + 3, P.metal[0], 1);
  }
  // The middle drawer, pulled out toward the camera: it projects along y and
  // down, which is the direction this projection sends "toward the viewer".
  iso.box(1, 10, 13, 5, 8, 12, {
    top: P.metal[2],
    lit: P.metal[3],
    shadow: P.metal[1],
    edge: P.ink,
  });
  // What is visible inside it: folders standing on edge.
  for (let i = 0; i < 4; i++) {
    face(iso, 2 + i * 3, 2 + i * 3, 14, 12, 15, P.paperDim);
  }
};

/** A desk ledger: an open book on a stand, with ruled pages.
 *
 * The ruling is what makes it a record rather than a slab, and the spine — the
 * dark V down the middle — is what makes it a book rather than two cards. */
const ledger: Drawer = (iso) => {
  // The stand: a low slanted lectern.
  iso.box(0, 3, 14, 8, 0, 3, { top: P.wood[2], lit: P.wood[3], shadow: P.wood[1], edge: P.ink });
  iso.post(1, 4, 0, 2, P.wood[1], 1);
  iso.post(12, 10, 0, 2, P.wood[1], 1);

  // The two pages, tilted away from the spine. Each is a pair of steps, so the
  // spread lifts at the outer edges the way an open book does.
  iso.box(0, 2, 7, 5, 3, 5, { top: P.paper, lit: P.paper, shadow: P.paperDim, edge: P.ink });
  iso.box(8, 2, 7, 5, 3, 5, { top: P.paper, lit: P.paper, shadow: P.paperDim, edge: P.ink });
  // Ruled lines, four a side, in the ink of handwriting rather than of ink
  // outlines — the same blue a plan is drawn in.
  for (let i = 0; i < 4; i++) {
    const wy = 3 + i;
    iso.beamX(1, 6, wy, 5, P.glass[2], 1);
    iso.beamX(9, 14, wy, 5, P.glass[2], 1);
  }
  // The spine, and the stack of closed ledgers under the near corner.
  iso.beamY(2, 6, 7, 5, P.leather, 1);
  iso.box(0, 9, 9, 5, 0, 2, { top: P.leather, lit: P.roof[1], shadow: P.roof[0], edge: P.ink });
};

/** A balance: a column, a beam, and two pans hanging below it. */
const scales: Drawer = (iso) => {
  // The base and column.
  iso.box(3, 3, 9, 9, 0, 3, { top: P.metal[2], lit: P.metal[3], shadow: P.metal[1], edge: P.ink });
  iso.post(7, 7, 3, 20, P.metal[2], 2);
  // The beam across the top, and the pointer hanging from its centre.
  iso.beamX(0, 15, 7, 20, P.metal[3], 1);
  iso.column(7, 7, 10, 19, P.accentDim);
  iso.plot(7, 7, 10, P.accent);
  // Two pans, one hanging from each end, on their cords. The pans must be
  // clearly *below* the beam and clearly separate from it, or the whole thing
  // reads as a gallows.
  for (const wx of [0, 15]) {
    iso.column(wx, 7, 12, 19, P.metal[1]);
    iso.box(wx - 2, 5, 5, 5, 10, 12, {
      top: P.metal[1],
      lit: P.metal[2],
      shadow: P.metal[0],
      edge: P.ink,
    });
  }
  // One pan loaded, one empty, so the beam reads as *measuring* something.
  iso.box(-1, 6, 3, 3, 12, 14, { top: P.earth[3], lit: P.earth[2], shadow: P.earth[1], edge: P.ink });
};

/** A set: a boxy body, a speaker grille, dials, and an antenna.
 *
 * The antenna is the whole difference between a radio and a toaster, which is
 * why it is the tallest part of the prop and drawn in the accent so a reader's
 * eye finds it. */
const radio: Drawer = (iso) => {
  iso.box(0, 0, 16, 9, 0, 11, {
    top: P.wood[1],
    lit: P.wood[2],
    shadow: P.wood[0],
    edge: P.ink,
  });
  // The speaker grille: four slots, which is what says sound rather than a
  // panel of buttons.
  for (let i = 0; i < 4; i++) {
    face(iso, 1, 8, 9, 3 + i * 2, 3 + i * 2, P.ink);
  }
  // Two dials, one with a pointer, and the tuning window between them.
  iso.column(11, 9, 3, 8, P.metal[3]);
  iso.column(14, 9, 3, 8, P.metal[3]);
  iso.plot(11, 9, 6, P.ink);
  face(iso, 12, 13, 9, 6, 8, P.glass[2]);
  // The antenna, up and back from the far corner, in the live accent.
  for (let i = 0; i < 9; i++) iso.plot(15 - i * 0.5, 1 + i * 0.4, 11 + i, P.accentDim);
  iso.plot(15, 1, 11, P.accent);
};

/** Tied parcels: wrapped boxes with visible string and a knot. */
const parcel: Drawer = (iso, variant) => {
  const boxes: [number, number, number, number, number, number][] = [
    [0, 0, 14, 9, 0, 8],
    [3, 2, 10, 7, 8, 15],
  ];
  boxes.slice(0, 1 + (variant % 2)).forEach(([wx, wy, w, d, z0, z1]) => {
    iso.box(wx, wy, w, d, z0, z1, {
      top: P.canvas[2],
      lit: P.canvas[3],
      shadow: P.canvas[1],
      edge: P.ink,
    });
    // The string: two bands crossing over the top and down the near flanks.
    // This is the entire read — the same box without it is a crate.
    const mx = Math.round(wx + w / 2);
    const my = Math.round(wy + d / 2);
    iso.beamY(wy, wy + d, mx, z1, P.leather, 1);
    iso.beamX(wx, wx + w, my, z1, P.leather, 1);
    iso.column(mx, wy + d, z0, z1, P.leather);
    // And the knot, on the top where the two bands cross.
    iso.plot(mx, my, z1 + 1, P.leather);
    iso.plot(mx + 1, my, z1 + 1, P.canvas[0]);
  });
};

/** A clock: a round face, two hands, on a bracket.
 *
 * The hands must be different lengths and not aligned, or the face reads as a
 * target. The bracket is what says it is hung rather than propped. */
const clock: Drawer = (iso) => {
  // The post and its bracket.
  iso.post(1, 1, 0, 14, P.wood[1], 2);
  iso.beamY(1, 6, 1, 14, P.wood[0], 1);
  // The case, then the face inset into it.
  iso.box(-1, -1, 12, 12, 12, 22, {
    top: P.wood[2],
    lit: P.wood[3],
    shadow: P.wood[0],
    edge: P.ink,
  });
  // The dial: an octagon of paper on the case's own near face.
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    const px = Math.round(5 + Math.cos(ang) * 4.5);
    const pz = Math.round(17 + Math.sin(ang) * 4.5);
    iso.plot(px, 11, pz, P.paperDim);
  }
  // The hands: short hour pointing one way, long minute another. Deliberately
  // not overlapping, so the dial reads as a time rather than as a cross.
  iso.plot(3, 11, 18, P.ink);
  iso.plot(4, 11, 17, P.ink);
  iso.plot(7, 11, 19, P.ink);
  iso.plot(8, 11, 20, P.ink);
  iso.plot(5, 11, 17, P.accentDim);
};

/** A pot-bellied stove: a rounded body, a firedoor, and a flue. */
const stove: Drawer = (iso) => {
  // The belly: three courses, widest in the middle, which is the same shape a
  // barrel takes and reads as a casting rather than a crate.
  iso.box(1, 1, 13, 13, 1, 4, { top: P.rust[1], lit: P.rust[2], shadow: P.rust[0], edge: P.ink });
  iso.box(0, 0, 15, 15, 4, 13, { top: P.rust[2], lit: P.rust[3], shadow: P.rust[1], edge: P.ink });
  iso.box(1, 1, 13, 13, 13, 16, { top: P.rust[2], lit: P.rust[1], shadow: P.rust[0], edge: P.ink });
  // The firedoor, with its latch, and the glow behind it.
  face(iso, 3, 10, 15, 5, 11, P.rust[0]);
  iso.plot(9, 15, 8, P.accent);
  iso.beamX(4, 5, 15, 10, P.metal[1], 1);
  // The flue: up from the far shoulder, then elbowing back.
  iso.post(12, 12, 16, 26, P.rust[1], 2);
  iso.beamX(6, 12, 12, 26, P.rust[1], 2);
  iso.post(6, 12, 24, 26, P.rust[0], 2);
};

/** An anvil on a stump: the Depot's oldest prop, kept as it was drawn. */
const anvil: Drawer = (iso) => {
  // Stump.
  iso.box(0, 4, 12, 8, 0, 8, { top: P.wood[1], lit: P.wood[2], shadow: P.wood[0], edge: P.ink });
  // Body and horn.
  iso.box(1, 5, 10, 6, 8, 12, { top: P.metal[2], lit: P.metal[3], shadow: P.metal[1], edge: P.ink });
  iso.box(11, 6, 4, 4, 9, 12, { top: P.metal[3], lit: P.metal[2], shadow: P.metal[1], edge: P.ink });
  iso.beamY(5, 11, 1, 12, P.metal[3], 1);
};

/** A plan board: pinned sheets with a drawn line, the Depot's other old prop.
 *
 * The drawn line on the front sheet is what makes them plans rather than blank
 * card, which is why it is drawn in the glass blue every other drawing uses. */
const planboard: Drawer = (iso) => {
  iso.box(0, 2, 3, 12, 0, 20, {
    top: P.wood[1],
    lit: P.wood[2],
    shadow: P.wood[0],
    edge: P.ink,
  });
  // The board face, standing proud of its post.
  iso.box(-3, 1, 2, 14, 8, 19, { top: P.paperDim, lit: P.paper, shadow: P.paperDim, edge: P.ink });
  // A drawn line on the front sheet: a plan, not a blank card.
  iso.beamY(3, 11, -1, 15, P.glass[2], 1);
  iso.beamY(3, 8, -1, 12, P.glass[1], 1);
};

/** Every Depot prop, as a checked total record: a name in `DEPOT_KINDS` with no
 *  entry here is a compile error rather than a prop that draws nothing. */
export const DEPOT_DRAWERS: Record<DepotKind, Drawer> = {
  anvil,
  cabinet,
  clock,
  drafting,
  ledger,
  noticeboard,
  parcel,
  planboard,
  radio,
  scales,
  shelving,
  stove,
};
