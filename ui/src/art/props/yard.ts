// The Yard group: plant and bulk material.
//
// The Yard is the site taken as a whole — a test run, a build, an install all
// act on the town rather than on one building — so its furniture is what no
// single building would own: lifting gear, power, spoil, long stock. Nothing
// here is a hand tool; a hand tool is the Workshop's, and holding that line is
// what keeps the two places from reading as one room with two names.
//
// The set is deliberately top-heavy. A crane, a skip, a mixer and a generator
// are the four volumes a reader should be able to name from across the town,
// and the smaller pieces — a cone, a butt, a reel — punctuate them rather than
// dilute them. Each drawer leads with its silhouette, because at this size
// there is very little else to lead with.

import { type IsoPix } from "../iso";
import { P, type Ramp } from "../palette";
import { type Ink } from "../surface";
import { type Drawer, type Shade, type YardKind } from "./kinds";
import { drum, hollowBox, slabStack } from "./parts";

/**
 * mat turns a material ramp into the shading for one volume of it.
 *
 * Every drawer here shades through this rather than picking ramp steps by hand,
 * so that a steel housing and a spoil heap can differ in hue without also
 * differing in which face the sun happens to reach. The steps are the palette's
 * rule: the top catches most light, the lower-left flank — the wall `iso.box`
 * calls `lit` — next, the lower-right least.
 */
function mat(ramp: Ramp): Shade {
  return { top: ramp[2], lit: ramp[3], shadow: ramp[1], edge: P.ink };
}

/**
 * discFaceY fills a disc whose axis runs along world x: a pipe's mouth, a
 * drum's section, the cheek of a cable reel.
 *
 * `disc` in `parts.ts` lays a wheel flat, which is right for a barrow and wrong
 * for anything facing across the picture. Something round on a horizontal axle
 * is only ever legible here if it is *filled*: an outline of eight plotted
 * points is a ring, and a ring around nothing reads as a hole rather than as a
 * face. The fill walks y and gives each row the half-height the circle has at
 * that offset, which is the one way to get a solid disc out of a rasteriser
 * that only draws straight runs.
 */
function discFaceY(iso: IsoPix, wx: number, cy: number, cz: number, radius: number, ink: Ink): void {
  for (let j = -radius; j <= radius; j++) {
    const half = Math.sqrt(Math.max(0, radius * radius - j * j));
    iso.column(wx, cy + j, cz - half, cz + half, ink);
  }
}

/** ringFaceY is that disc's outline: the bright rim a pipe's open end wears. */
function ringFaceY(iso: IsoPix, wx: number, cy: number, cz: number, radius: number, ink: Ink): void {
  for (let a = 0; a < 8; a++) {
    const ang = (a / 8) * Math.PI * 2;
    iso.plot(wx, cy + Math.cos(ang) * radius, cz + Math.sin(ang) * radius, ink);
  }
}

/**
 * discFaceX fills a disc whose axis runs along world y: a wheel seen square-on,
 * the pair under a mixer.
 *
 * It is the same circle as `discFaceY` with the roles of the two horizontal
 * axes swapped, and it is a second function rather than a flag because the
 * projection treats the two directions differently — one unit of x is half a
 * pixel right, one unit of y is half a pixel left — and a shared implementation
 * would have to carry a sign that no reader can check at a call site.
 */
function discFaceX(iso: IsoPix, cx: number, cy: number, cz: number, radius: number, ink: Ink): void {
  for (let k = -radius; k <= radius; k++) {
    const half = Math.sqrt(Math.max(0, radius * radius - k * k));
    iso.column(cx + k, cy, cz - half, cz + half, ink);
  }
}

/**
 * pipeAlongX draws a cylinder lying along world x, its axis at (`cy`, `cz`).
 *
 * Rasterised as a sweep of the circle's own half-height at every offset from
 * the axis, rather than as a box with its corners knocked off. At this size the
 * difference is three pixels of corner, and those three pixels are the whole
 * difference between a pipe and a beam.
 */
function pipeAlongX(
  iso: IsoPix,
  from: number,
  to: number,
  cy: number,
  cz: number,
  radius: number,
  ink: Ink,
): void {
  for (let j = -radius; j <= radius; j++) {
    const half = Math.sqrt(Math.max(0, radius * radius - j * j));
    for (let x = from; x <= to; x++) iso.column(x, cy + j, cz - half, cz + half, ink);
  }
}

/**
 * strut draws a member that runs along neither axis nor straight up: a crane's
 * jib, a tripod's leg, a mixer's handle.
 *
 * `post` can only raise a vertical and `beamX` only a horizontal, and both a
 * jib and a leg are defined by their slope — a crane whose jib is a column is a
 * lamp post. The member is rasterised in world coordinates, so its foot lands
 * on the ground it stands on.
 *
 * The step count is taken in *pixels*, not world units, and that is the whole
 * subtlety. A gap appears where two consecutive samples round to picture points
 * more than a pixel apart, and the projection compresses one unit of x or y into
 * half a pixel while one unit of z is a whole one — so a member that leans along
 * y while falling moves twice as far down the picture as its steepest world span
 * suggests. A step count taken from the world spans leaves a leg with two-pixel
 * holes in it and the limb reads as broken.
 */
function strut(
  iso: IsoPix,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  ink: Ink,
  thick = 1,
): void {
  const a = iso.project(x0, y0, z0);
  const b = iso.project(x1, y1, z1);
  const steps = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const z = z0 + (z1 - z0) * t;
    iso.column(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z - thick + 1, z, ink);
  }
}

/**
 * A cable reel lying on its side: a cheek at each end with the cable wound
 * between them.
 *
 * The reel is tipped where a barrel is upright, and the two cheeks are the
 * reason. A drum standing on its end shows one face; this shows a big disc, a
 * band of cable, and a second disc behind it, and that band is the only thing
 * on the prop that says there is anything wound on it. The cheeks are drawn
 * three units larger in radius than the cable so the band sits in a groove
 * rather than flush.
 */
const cableDrum: Drawer = (iso, variant) => {
  const width = 12 + (variant % 2) * 2;
  const cy = 8;
  const cz = 9;
  // The far cheek, then the cable, then the near cheek: occlusion, not
  // decoration — the near cheek hides the near half of the winding, which is
  // what gives the reel its depth.
  discFaceY(iso, 0, cy, cz, 9, P.wood[1]);
  pipeAlongX(iso, 1, width, cy, cz, 6, P.rubber[1]);
  // Four turns of cable, each a ring at its own station along the reel.
  for (const x of [3, 6, 9, width - 1]) ringFaceY(iso, x, cy, cz, 6, P.rubber[0]);
  // The lit crown of the winding, where the light catches it round the top.
  iso.beamX(1, width, cy - 4, cz + 4, P.rubber[3]);
  discFaceY(iso, width, cy, cz, 9, P.wood[2]);
  // The axle boss, so the cheek is a cheek and not a coin.
  discFaceY(iso, width, cy, cz, 2, P.wood[0]);
  iso.plot(width, cy, cz, P.wood[3]);
};

/**
 * A traffic cone: a square plate under a stepped taper.
 *
 * The taper is a stack of shrinking slabs because `iso.box` has no cone. Three
 * tones carry it — a rust body, a plaster band, the plate — and the band is
 * placed at a fixed fraction of the height rather than at a fixed world height,
 * so it stays at the same point up the cone however tall the cone is.
 *
 * The plate's width and the cone's height move in *opposite* directions across
 * the variants. That is what makes one a tall slim cone and the next a squat
 * wide one, which is a distinction a reader can see from across the ground;
 * varying the height alone moves the silhouette by a handful of pixels, because
 * a taper hides its own length.
 */
const cone: Drawer = (iso, variant) => {
  const base = 9 + (variant % 3) * 2;
  const tall = 13 - (variant % 3) * 2;
  const foot = base - 2;
  iso.box(1, 1, base, base, 0, 1, mat(P.rubber));
  for (let z = 1; z < tall; z++) {
    const w = Math.max(1, Math.round(foot * (1 - (z - 1) / tall)));
    const off = Math.round(1 + (base - w) / 2);
    const band = z === Math.round(tall / 2) || z === Math.round(tall * 0.8);
    iso.box(off, off, w, w, z, z + 1, mat(band ? P.plaster : P.rust));
  }
};

/**
 * A tower crane: tracks, a slewing platform, a mast, and a counterweighted jib
 * with a hook on a short cable. The biggest thing in the town.
 *
 * The jib runs out along −y. Along +x it would also be a jib, but it would hang
 * its hook down in front of the tracks and the cab, where the hook is bisected
 * by everything the machine stands on; out over the back the cable falls
 * against empty ground. The counterweight is at the jib's opposite end for the
 * same reason a real one is: the two are one line through the mast, and a
 * machine with a jib and no counterweight is a machine that would fall over.
 */
const crane: Drawer = (iso, variant) => {
  const mast = 19 + (variant % 2) * 2;
  // Tracks as two long bars rather than wheels. Wheels of a machine this size
  // sit under the chassis and show as four dark nibs; two bars under the deck
  // are what make it look planted.
  iso.box(-2, 1, 20, 3, 0, 3, mat(P.rubber));
  iso.box(-2, 8, 20, 3, 0, 3, mat(P.rubber));
  for (let x = -1; x <= 17; x += 3) {
    iso.plot(x, 1, 3, P.rubber[0]);
    iso.plot(x, 11, 3, P.rubber[0]);
  }

  iso.box(0, 2, 16, 7, 3, 7, mat(P.metal));
  iso.box(1, 3, 14, 5, 7, 9, mat(P.rust));
  // The cab, with its glass, and the counterweight on the far side of the
  // mast: the two ends of the slewing platform, which is what makes the
  // machine read as turning rather than as a box with a pole in it.
  iso.box(1, 3, 5, 5, 9, 15, mat(P.metal));
  iso.beamX(2, 6, 8, 13, P.glass[2], 3);
  iso.box(7, 9, 6, 5, 9, 12, mat(P.rust));

  iso.box(6, 4, 5, 4, 9, mast, mat(P.metal));
  // Three rungs up the mast. Without them a column of twenty units is a post,
  // and a post is the one thing a crane must not look like.
  iso.beamX(6, 11, 8, 12, P.metal[0], 1);
  iso.beamX(6, 11, 8, 16, P.metal[0], 1);
  iso.beamX(6, 11, 8, mast - 2, P.metal[0], 1);

  const tip = mast + 3;
  strut(iso, 9, 6, mast, 9, -8, tip, P.metal[1], 2);
  // The hoist, hanging plumb under the jib's end: the hook is what tells a
  // reader the jib stops there, and a cable is the only thing that can.
  iso.column(9, -8, 13, tip, P.rubber[0]);
  iso.box(8, -9, 3, 2, 13, 15, mat(P.metal));
  iso.box(8, -8, 2, 2, 11, 13, mat(P.metal));
};

/**
 * A generator: a louvred housing on skids with an exhaust stub and a filler
 * cap.
 *
 * Those three details are the machine's whole biography. Take the louvres away
 * and it is a packing case; take the skids away and it is a cabinet; take the
 * exhaust away and nothing says it burns anything.
 */
const generator: Drawer = (iso, variant) => {
  const len = 18 + (variant % 3) * 2;
  iso.box(0, 1, len, 2, 0, 2, mat(P.rust));
  iso.box(0, 9, len, 2, 0, 2, mat(P.rust));
  iso.box(1, 2, len - 2, 8, 2, 11, mat(P.metal));
  // Louvres in the darkest step of the steel, so each slot is a real hole
  // rather than a second highlight on a face that is already the bright one.
  const slots = 2 + (variant % 2);
  for (let i = 0; i < slots; i++) iso.beamX(3, len - 4, 10, 5 + i * 2, P.metal[0], 1);
  // The exhaust, at the end the engine is at, standing clear of the housing.
  iso.post(3, 3, 11, 15, P.metal[1], 1);
  iso.plot(3, 3, 15, P.metal[0]);
  // The cap: the one bright pixel on an otherwise grey machine.
  iso.box(len - 6, 5, 3, 3, 11, 12, {
    top: P.metal[3],
    lit: P.metal[2],
    shadow: P.metal[1],
    edge: P.ink,
  });
};

/**
 * Girders: long rolled sections stacked in courses, each course showing its
 * flanges.
 *
 * The dark groove down the middle of every course is what makes these steel
 * sections and not a stack of sheet. A girder's near face is two flanges with a
 * recessed web between them, and at two or three pixels of course height that
 * groove is the only part of the profile that fits — but it is the part the eye
 * needs, because two bright bands with a dark line between them is an I, and
 * one bright band is a plank.
 */
const girders: Drawer = (iso, variant) => {
  const layers = 3 + (variant % 3);
  slabStack(iso, 1, 0, 22, 7, layers, 2, 1, { ...mat(P.metal), seam: P.metal[3] });
  for (let i = 0; i < layers; i++) iso.beamX(1, 23, 7, i * 3 + 1, P.metal[0], 1);
};

/**
 * A mixer: a cone drum tipped up on a two-wheeled yoke, with a tipping handle.
 *
 * The drum is the whole read, so it is a sweep of discs growing along a rising
 * diagonal — small and far at the axle, large and near at the mouth. The mouth
 * faces the camera deliberately: an opening aimed away is a funnel, and the
 * dark bore inside the bright rim is the only place on this prop where the two
 * tones sit directly against each other.
 */
const mixer: Drawer = (iso, variant) => {
  const rings = 6 + (variant % 2);
  // The variant is spent on the drum, not on the yoke: the drum tip is the
  // silhouette a reader sees from across the ground, and a mixer whose *frame*
  // changed while its drum stayed put would be the same machine twice.
  const span = 9 + (variant % 3);
  const mouthR = 4 + (variant % 2);
  const cy = 5;
  // Two wheels on one axle across the picture: a mixer has exactly two, they
  // are always side by side, and that pairing is what says the machine is
  // pulled rather than carried.
  discFaceX(iso, 5, 1, 4, 4, P.rubber[1]);
  discFaceX(iso, 5, 11, 4, 4, P.rubber[1]);
  iso.beamY(1, 11, 5, 4, P.metal[1], 1);
  iso.box(2, 3, 8, 5, 3, 8, mat(P.rust));
  // The handle, out of the back of the yoke and down to where a hand would be.
  // Without it the machine cannot pour, and a machine that cannot pour is a bin.
  strut(iso, 3, 8, 7, -2, 13, 3, P.metal[1], 1);
  iso.post(-2, 13, 3, 6, P.wood[2], 1);

  const mouthX = 3 + span;
  const mouthZ = 10 + span * 0.62;
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    const radius = 2 + (mouthR - 2) * t;
    const wx = 3 + span * t;
    const cz = 10 + (mouthZ - 10) * t;
    discFaceY(iso, wx, cy, cz, radius, P.rust[1]);
    // The highlight has to be re-plotted at every ring, because each ring is
    // filled after the one behind it and would otherwise bury it.
    iso.plot(wx, cy - radius * 0.7, cz + radius * 0.7, P.rust[3]);
  }
  discFaceY(iso, mouthX, cy, mouthZ, mouthR, P.rust[0]);
  ringFaceY(iso, mouthX, cy, mouthZ, mouthR, P.rust[3]);
};

/**
 * A pallet under a stack of bags.
 *
 * The deck is left bare at one end on purpose. A pallet entirely covered by its
 * load is a stack of bags; the four visible slats over the bearers are what say
 * the bags are *on* something, and something a forklift can get under is what a
 * yard handles goods with.
 */
const pallet: Drawer = (iso, variant) => {
  const bags = 3 + (variant % 3);
  // Three bearers running the full depth, then the deck across them. Bearers
  // first so the deck lands on them rather than floating over the gap.
  for (const bx of [1, 7, 13]) iso.box(bx, 0, 4, 12, 0, 2, mat(P.wood));
  for (const by of [0, 3, 6, 9]) {
    iso.box(0, by, 18, 2, 2, 3, { top: P.wood[3], lit: P.wood[2], shadow: P.wood[1], edge: P.ink });
  }
  for (let i = 0; i < bags; i++) {
    const x = 5 + (i % 2) * 6;
    const z = 3 + Math.floor(i / 2) * 5;
    iso.box(x, 3, 5, 7, z, z + 4, {
      top: P.canvas[2],
      lit: P.canvas[3],
      shadow: P.canvas[1],
      edge: P.ink,
    });
    // The pinch where the neck is folded under: without it a row of canvas
    // boxes is a row of boxes.
    iso.beamY(4, 9, x + 5, z + 3, P.canvas[0], 1);
  }
};

/**
 * Pipes in a triangular pile, three then two then one, seen end-on.
 *
 * Pipes lying along x put their open ends at the near corner, which is the one
 * face of this prop that has to read: a bright wall around a dark bore is what
 * separates a pipe from a log, and a pile of green logs would be the lumber the
 * shared group already has. Each pipe above the ground row is laid into the
 * valley of the two beneath it, so the pile's rise is the circle's own packing
 * height rather than a row of shelves.
 */
const pipeStack: Drawer = (iso, variant) => {
  const len = 18 + (variant % 2) * 3;
  const radius = 3;
  const ground = 2 + (variant % 2);
  const rows = [
    { count: ground, y0: 3, z: radius },
    { count: ground - 1, y0: 6, z: radius + 5 },
  ];
  if (ground > 2) rows.push({ count: 1, y0: 3 + 3 * (ground - 1), z: radius + 10 });

  // Bottom row first and left to right within a row, because a pipe sitting in
  // a valley has to paint over both of the pipes under it.
  for (const row of rows) {
    for (let i = 0; i < row.count; i++) {
      const cy = row.y0 + i * 6;
      pipeAlongX(iso, 0, len, cy, row.z, radius, P.metal[1]);
      // A lit line and a dark one, both just inside the silhouette: at twelve
      // pixels of pipe the top of the wall and its underside are the only two
      // places a reader can be told a round thing from a square one.
      iso.beamX(0, len, cy - 2, row.z + 2, P.metal[3]);
      iso.beamX(0, len, cy + 2, row.z - 2, P.metal[0]);
      // The near end: wall, bore, then the rim over both so the bore is closed.
      discFaceY(iso, len, cy, row.z, radius, P.metal[2]);
      discFaceY(iso, len, cy, row.z, radius - 2, P.metal[0]);
      ringFaceY(iso, len, cy, row.z, radius, P.metal[3]);
    }
  }
};

/**
 * Rubble: a broken heap of stone and spoil, with chips thrown clear of it.
 *
 * Every block's size and height come from its own cell index and nothing else —
 * the same town must draw the same picture on every load (ADR-0012). The chips
 * matter as much as the heap: a heap with nothing lying around it reads as one
 * object that happens to be jagged, and it takes debris at a distance to say
 * that something has been broken here.
 */
const rubble: Drawer = (iso, variant) => {
  // The heap's extent moves with the variant and not only its blocks: the
  // outline a reader has to recognise is the heap's, and spoil varies in length
  // and breadth with what was dug, not only in how lumpy it is.
  const w = 16 + (variant % 3) * 4;
  const d = 16 + ((variant >> 1) % 2) * 4;
  const peak = 4 + (variant % 2) * 2;
  for (let wy = 0; wy < d; wy += 4) {
    for (let wx = 0; wx < w; wx += 4) {
      // The cap falls off with distance from the middle, which is the only
      // thing keeping a grid of boxes from reading as a grid of boxes.
      const dist = Math.abs(wx - (w - 4) / 2) / 2 + Math.abs(wy - (d - 4) / 2) / 2;
      const cap = Math.max(1, peak - Math.round(dist));
      const top = Math.min(cap, 1 + ((wx * 3 + wy * 5 + variant * 7) % 4));
      const s = 3 + ((wx + wy * 3 + variant) % 2);
      iso.box(wx, wy, s, s, 0, top, mat((wx + wy) % 2 ? P.stone : P.earth));
    }
  }
  for (let i = 0; i < 6; i++) {
    const cx = (i * 7 + variant * 3) % (w + 2);
    const cy = (i * 5 + variant * 2) % (d + 2);
    iso.plot(cx, cy, 1, P.stone[2]);
    iso.plot(cx, cy, 0, P.stone[1]);
  }
};

/**
 * A skip: rusted sheet, open at the top, with the load standing over the rim.
 *
 * The spoil inside is one ramp step below the wall so the cavity reads as
 * filled rather than as a void, and a board left across the top is what stops
 * the whole thing being a water tank — an open box seen from above is a dark
 * rectangle, and it takes something breaking the rim to say the box holds
 * anything loose. Steel plate is flat, so the stiffeners down both flanks are
 * not decoration: four unbroken panels of it are a tank.
 */
const skip: Drawer = (iso, variant) => {
  const long = 20 + (variant % 2) * 3;
  const deep = 11 + (variant % 2) * 2;
  hollowBox(iso, 0, 0, long, deep, 0, 10, {
    top: P.rust[1],
    lit: P.rust[2],
    shadow: P.rust[0],
    edge: P.ink,
    inner: P.earth[1],
  });
  for (let i = 1; i < 4; i++) {
    iso.column(Math.round((long * i) / 4), deep, 2, 9, P.rust[0]);
    iso.column(long, Math.round((deep * i) / 4), 2, 9, P.rust[0]);
  }
  // The rim's lit edge, which is what says the top is open and not lidded.
  iso.beamY(0, deep, long, 10, P.rust[3], 1);
  iso.beamX(0, long, deep, 10, P.rust[2], 1);
  // Spoil showing over the near wall, and a board left across the load.
  iso.row(4, 12 + (variant % 4), 4, 11, P.earth[2]);
  iso.box(long - 8, 3, 3, 10, 10, 13, mat(P.wood));
};

/**
 * A tripod: three splayed legs under a surveyor's instrument.
 *
 * It is the only prop in the set whose read is the *gaps* rather than the
 * masses, which is why the legs are the thinnest members anyone draws here and
 * why the instrument on top stays small. Thicken either and it becomes a table.
 */
const tripod: Drawer = (iso, variant) => {
  const h = 14 + (variant % 3);
  strut(iso, 8, 8, h, 0, 4, 0, P.wood[1], 1);
  strut(iso, 8, 8, h, 15, 2, 0, P.wood[2], 1);
  strut(iso, 8, 8, h, 8, 16, 0, P.wood[1], 1);
  // A stretcher between the near legs, which is where a tripod is braced and
  // the only line here that crosses the gaps the read depends on.
  strut(iso, 3, 6, 6, 12, 4, 6, P.metal[1], 1);

  iso.box(5, 5, 7, 7, h, h + 4, mat(P.metal));
  // The lens, aimed at whatever is being set out, in the palette's cool blue.
  iso.box(3, 6, 4, 5, h + 1, h + 3, mat(P.rust));
  iso.beamX(3, 6, 11, h + 2, P.glass[2], 1);
  iso.plot(9, 9, h + 5, P.metal[3]);
};

/**
 * A water butt: a corrugated tank with a lid and a tap low on the near flank.
 *
 * Taller and narrower than the shared barrel and in steel rather than staves.
 * The two stand on the same kind of ground in the same kind of place, and if
 * both were casks the town would look like it had one prop twice. The tap is
 * the rest of the difference — nobody draws a tap on a barrel.
 */
const waterbutt: Drawer = (iso, variant) => {
  const tall = 16 + (variant % 3);
  drum(iso, 0, 0, 12, 12, 0, tall, {
    top: P.rust[1],
    lit: P.rust[2],
    shadow: P.rust[0],
    edge: P.ink,
    hoop: P.metal[1],
    rim: P.metal[2],
  });
  // A lid proud of the rim, so the tank has a top rather than a mouth.
  iso.box(1, 1, 10, 10, tall, tall + 2, mat(P.metal));
  iso.plot(6, 6, tall + 2, P.metal[3]);
  // The tap stands off the lit flank far enough that its own silhouette leaves
  // the tank's: a tap drawn against the wall is a pixel of a different colour.
  iso.box(2, 12, 3, 4, 4, 6, mat(P.metal));
  iso.post(3, 16, 1, 4, P.metal[2], 1);
  iso.plot(4, 16, 7, P.rust[3]);
};

/** Every Yard prop, as a checked total record: a name in `YARD_KINDS` with no
 *  entry here is a compile error rather than a prop that draws nothing. */
export const YARD_DRAWERS: Record<YardKind, Drawer> = {
  cableDrum,
  cone,
  crane,
  generator,
  girders,
  mixer,
  pallet,
  pipeStack,
  rubble,
  skip,
  tripod,
  waterbutt,
};
