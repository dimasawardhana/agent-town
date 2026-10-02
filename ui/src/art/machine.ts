// The fleet, drawn in the same 2:1 dimetric the rest of the town is.
//
// **These used to be character grids** — rows of material letters, shaded by a
// rule that put the brightest step on any pixel whose upper-left neighbour was
// empty and the darkest on any whose lower-right one was. That is a 1px rim
// round a flat field. An excavator's body was twenty-eight pixels wide and four
// rows deep, so 112 of its pixels took one identical step: the fleet was flat
// orange bars with an edge, and it read as two-dimensional standing next to
// buildings that had real faces.
//
// **So there are no grids now.** Every machine is drawn through `IsoPix`, the
// same primitive every building and every prop is drawn through, and it hands
// back a top face, a lit flank and a flank that turns away for each box. The
// key is the town's key — light up and to the left — so a machine belongs to
// the town it is standing in rather than sitting on top of it in another idiom.
//
// **A machine is three things:** a wide low undercarriage it cannot move without,
// something standing on it, and one asymmetric gesture above. The gesture names
// the kind and carries the pose entirely, so the chassis is authored once per
// kind and only the arm varies. The gesture's *direction* is what separates the
// kinds — a boom that rises and falls, a jib that runs out sideways, a bucket
// that drops to the ground, a blade that stays low — because a difference in
// height alone is a difference a silhouette barely shows.
//
// **It turns, because `IsoPix` turns.** The old fleet drew one picture and used
// it at every orientation, which a tracked vehicle cannot survive. Each quarter
// turn re-projects the same boxes rather than mirroring a sprite.

import { IsoPix } from "./iso";
import { P } from "./palette";
import { type Ink, Pix } from "./surface";
import { normaliseTurn, WorldView } from "../view";
import type { WorkerState } from "./worker";

/** The four poses, in the order a reader meets them. */
export type MachinePose = "work" | "idle" | "travel" | "done";

export const MACHINE_POSES: readonly MachinePose[] = ["work", "idle", "travel", "done"];

/** The five kinds, named by silhouette so the roster reads as a fleet. */
export const MACHINES = ["excavator", "crane", "loader", "driver", "dozer"] as const;
export type MachineKind = (typeof MACHINES)[number];

/**
 * POSE_FOR folds the ten worker states onto four poses.
 *
 * Written out rather than derived: which states share a pose *is* the claim the
 * fleet makes about them. Reading and planning are both parked and looking;
 * hammering, building, demolishing, commanding and testing are all "engaged with
 * something", which is the most a silhouette can honestly say.
 */
export const POSE_FOR: Record<WorkerState, MachinePose> = {
  idle: "idle",
  planning: "idle",
  reading: "idle",
  walk: "travel",
  hammering: "work",
  building: "work",
  demolishing: "work",
  commanding: "work",
  testing: "work",
  celebrating: "done",
};

/** machineFor assigns a kind by hash, so a session is the same machine for life. */
export function machineFor(key: string): MachineKind {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return MACHINES[(h >>> 0) % MACHINES.length];
}

// --- the materials ----------------------------------------------------------
//
// A shade, not a ramp: `IsoPix` wants to be told which face it is filling, and
// deciding that from a pixel's neighbours is exactly the guesswork this rewrite
// removed.

const TRACK: Shade = { top: P.rubber[2], lit: P.rubber[1], shadow: P.rubber[0], edge: P.ink };
const TREAD: Shade = { top: P.rubber[3], lit: P.rubber[2], shadow: P.rubber[1], edge: P.ink };
const BODY: Shade = { top: P.rust[2], lit: P.rust[3], shadow: P.rust[1], edge: P.ink };
const DECK: Shade = { top: P.rust[3], lit: P.rust[2], shadow: P.rust[0], edge: P.ink };
// Deliberately two steps short of `P.metal`'s top. A boom reading as the
// brightest thing on the sprite inverts the hierarchy: the eye goes to the
// least important part. Painted steel in this town's light is two below bare.
const ARM: Shade = { top: P.metal[2], lit: P.metal[2], shadow: P.metal[0], edge: P.ink };
const GLASS: Shade = { top: P.glass[3], lit: P.glass[3], shadow: P.glass[1], edge: P.ink };
const STEEL: Shade = { top: P.stone[3], lit: P.stone[2], shadow: P.stone[1], edge: P.ink };
const BEACON: Shade = { top: P.helmetChief[3], lit: P.helmetChief[3], shadow: P.helmetChief[2], edge: P.ink };

interface Shade {
  top: Ink;
  lit: Ink;
  shadow: Ink;
  edge?: Ink;
}

/** A point in a machine's own world, in units where one is one picture pixel. */
interface Pt {
  x: number;
  y: number;
  z: number;
}

/**
 * limb draws a box chain between two world points.
 *
 * A boom is a gesture, not a box: it angles, and a box cannot angle. Walking the
 * span and filling a small box at each step is what lets one rule light every
 * segment the way it lights a wall, so an angled arm gets the same three faces
 * a flat one does.
 */
function limb(iso: IsoPix, a: Pt, b: Pt, thick: number, shade: Shade): void {
  const steps = Math.max(
    1,
    Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), Math.abs(b.z - a.z))),
  );
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(a.x + (b.x - a.x) * t);
    const y = Math.round(a.y + (b.y - a.y) * t);
    const z = Math.round(a.z + (b.z - a.z) * t);
    iso.box(x, y, thick, thick, Math.max(0, z - thick), z, shade);
  }
}

// --- proportions ------------------------------------------------------------
//
// A tracked machine is long and low. `LEN` is its length and `DEP` its depth,
// and they are separate because a box's screen width is (LEN + DEP) / 2 while
// its top face is (LEN + DEP) / 4 tall — typing one number for both is how a
// fleet ends up looking like it is leaning.

const LEN = 44;
const DEP = 9;
const DECK_Z = 13;

// --- the chassis ------------------------------------------------------------

/** Tracks: a low slab, with the raised tread band along each side. */
function undercarriage(iso: IsoPix): void {
  iso.box(0, 0, LEN, DEP, 0, 4, TRACK);
  iso.box(1, 0, LEN - 2, 2, 4, 5, TREAD);
  iso.box(1, DEP - 2, LEN - 2, 2, 4, 5, TREAD);
}

// Body, engine deck and cab. Authored once per kind and drawn in every turn,
// because `IsoPix` re-projects rather than mirrors.
const BODY_STACK: Record<MachineKind, (iso: IsoPix) => void> = {
  // Cab set back at the far end, engine deck forward — the conventional
  // arrangement, and the one that puts the glass where a driver would sit.
  excavator: (iso) => {
    iso.box(1, 1, LEN - 2, DEP - 2, 5, DECK_Z - 2, BODY);
    iso.box(2, 2, LEN - 4, DEP - 4, DECK_Z - 2, DECK_Z, DECK);
    iso.box(LEN - 15, 1, 14, DEP - 2, DECK_Z, DECK_Z + 8, BODY);
    iso.box(LEN - 14, 1, 12, DEP - 3, DECK_Z + 3, DECK_Z + 7, GLASS);
    iso.box(LEN - 11, 3, 3, 3, DECK_Z + 8, DECK_Z + 11, BEACON);
  },
  // A crane's cab sits low and forward, and the mast rises behind it.
  crane: (iso) => {
    iso.box(1, 1, LEN - 2, DEP - 2, 5, DECK_Z - 2, BODY);
    iso.box(2, 2, LEN - 4, DEP - 4, DECK_Z - 2, DECK_Z, DECK);
    iso.box(3, 1, 12, DEP - 2, DECK_Z, DECK_Z + 6, BODY);
    iso.box(4, 1, 10, DEP - 3, DECK_Z + 2, DECK_Z + 5, GLASS);
  },
  loader: (iso) => {
    iso.box(1, 1, LEN - 2, DEP - 2, 5, DECK_Z - 2, BODY);
    iso.box(2, 2, LEN - 4, DEP - 4, DECK_Z - 2, DECK_Z, DECK);
    iso.box(LEN - 17, 1, 16, DEP - 2, DECK_Z, DECK_Z + 7, BODY);
    iso.box(LEN - 16, 1, 14, DEP - 3, DECK_Z + 2, DECK_Z + 6, GLASS);
  },
  // The only kind whose cab is the whole body: it is the machine you watch.
  driver: (iso) => {
    iso.box(1, 1, LEN - 2, DEP - 2, 5, DECK_Z - 2, BODY);
    iso.box(2, 2, LEN - 4, DEP - 4, DECK_Z - 2, DECK_Z, DECK);
    iso.box(14, 1, 18, DEP - 2, DECK_Z, DECK_Z + 9, BODY);
    iso.box(15, 1, 16, DEP - 3, DECK_Z + 3, DECK_Z + 8, GLASS);
    iso.box(20, 3, 3, 3, DECK_Z + 9, DECK_Z + 12, BEACON);
  },
  dozer: (iso) => {
    iso.box(1, 1, LEN - 2, DEP - 2, 5, DECK_Z - 2, BODY);
    iso.box(2, 2, LEN - 4, DEP - 4, DECK_Z - 2, DECK_Z, DECK);
    iso.box(8, 1, 13, DEP - 2, DECK_Z, DECK_Z + 6, BODY);
    iso.box(9, 1, 11, DEP - 3, DECK_Z + 2, DECK_Z + 5, GLASS);
  },
};

// --- the gesture ------------------------------------------------------------
//
// One gesture per kind per pose, and nothing else on the machine moves. The
// pivot is shared so the fleet has one stance, and what separates the kinds is
// *where the tip goes*: up and back for a boom, straight out for a jib, down to
// the ground for a bucket, and barely off the deck for a blade.

const PIVOT: Pt = { x: 5, y: 4, z: DECK_Z };
/** CHIEF_LIFT is how much taller a chief's gesture stands than a sub's. */
const CHIEF_LIFT = 5;

const GESTURE: Record<MachineKind, Record<MachinePose, { elbow: Pt; tip: Pt; bucket: boolean }>> = {
  // Rises, then falls away forward. The widest gesture of the five.
  excavator: {
    work: { elbow: { x: 22, y: 4, z: 32 }, tip: { x: 40, y: 4, z: 20 }, bucket: true },
    idle: { elbow: { x: 21, y: 4, z: 30 }, tip: { x: 36, y: 4, z: 21 }, bucket: true },
    travel: { elbow: { x: 20, y: 4, z: 27 }, tip: { x: 35, y: 4, z: 18 }, bucket: false },
    done: { elbow: { x: 21, y: 4, z: 33 }, tip: { x: 38, y: 4, z: 25 }, bucket: false },
  },
  // Straight up, then straight out. A jib is a horizontal gesture and no amount
  // of swinging turns it into a boom — that is the whole difference between them.
  crane: {
    work: { elbow: { x: 12, y: 4, z: 42 }, tip: { x: 43, y: 4, z: 42 }, bucket: false },
    idle: { elbow: { x: 12, y: 4, z: 40 }, tip: { x: 41, y: 4, z: 40 }, bucket: false },
    travel: { elbow: { x: 12, y: 4, z: 37 }, tip: { x: 40, y: 4, z: 37 }, bucket: false },
    done: { elbow: { x: 12, y: 4, z: 38 }, tip: { x: 42, y: 4, z: 38 }, bucket: false },
  },
  // Down to the ground at the far end. A loader is an excavator that never lifts.
  loader: {
    work: { elbow: { x: 26, y: 4, z: 24 }, tip: { x: 43, y: 4, z: 8 }, bucket: true },
    idle: { elbow: { x: 26, y: 4, z: 23 }, tip: { x: 42, y: 4, z: 10 }, bucket: true },
    travel: { elbow: { x: 25, y: 4, z: 21 }, tip: { x: 40, y: 4, z: 14 }, bucket: false },
    done: { elbow: { x: 25, y: 4, z: 26 }, tip: { x: 41, y: 4, z: 16 }, bucket: false },
  },
  // A small articulated arm over the cab — the machine that watches.
  driver: {
    work: { elbow: { x: 20, y: 4, z: 32 }, tip: { x: 31, y: 4, z: 24 }, bucket: false },
    idle: { elbow: { x: 20, y: 4, z: 30 }, tip: { x: 30, y: 4, z: 23 }, bucket: false },
    travel: { elbow: { x: 19, y: 4, z: 28 }, tip: { x: 30, y: 4, z: 21 }, bucket: false },
    done: { elbow: { x: 19, y: 4, z: 31 }, tip: { x: 31, y: 4, z: 22 }, bucket: false },
  },
  // Barely off the deck: a blade that stays low and wide, the flattest gesture.
  dozer: {
    work: { elbow: { x: 30, y: 4, z: 17 }, tip: { x: 44, y: 4, z: 8 }, bucket: false },
    idle: { elbow: { x: 30, y: 4, z: 16 }, tip: { x: 44, y: 4, z: 7 }, bucket: false },
    travel: { elbow: { x: 29, y: 4, z: 15 }, tip: { x: 43, y: 4, z: 6 }, bucket: false },
    done: { elbow: { x: 30, y: 4, z: 19 }, tip: { x: 44, y: 4, z: 10 }, bucket: false },
  },
};

/** A one-pixel margin all round, so the outline never lands on the cel edge. */
const PAD = 1;

let solved: { w: number; h: number; ox: number; oy: number } | null = null;

/**
 * buildMachine draws one machine in one pose, in one orientation.
 *
 * Turn is handed to `IsoPix`, so the same boxes are re-projected rather than
 * mirrored. The old fleet drew one picture and used it at every orientation,
 * which a tracked vehicle cannot survive.
 */
export function buildMachine(kind: MachineKind, pose: MachinePose, tier: "chief" | "sub", turn = 0): Pix {
  const box = solveMachine();
  const iso = new IsoPix(box.w, box.h, box.ox, box.oy, normaliseTurn(turn));

  undercarriage(iso);
  BODY_STACK[kind](iso);

  const g = GESTURE[kind][pose];
  // A chief stands taller than its own sub by lifting the gesture, not by
  // growing the machine: the undercarriage is the same on both, because a chief
  // and a sub of one kind are one machine doing different work.
  const lift = tier === "chief" ? CHIEF_LIFT : 0;
  const elbow = { x: g.elbow.x, y: g.elbow.y, z: g.elbow.z + lift };
  const tip = { x: g.tip.x, y: g.tip.y, z: g.tip.z + lift };

  limb(iso, PIVOT, elbow, 4, ARM);
  limb(iso, elbow, tip, 3, ARM);
  if (g.bucket) iso.box(tip.x - 2, tip.y, 7, 5, Math.max(0, tip.z - 6), tip.z, STEEL);
  return iso.pix;
}

/**
 * solveMachine measures the drawing instead of asserting a box for it.
 *
 * A typed cel is a promise somebody has to keep by hand, and the promise is
 * checked by clipping: `Pix.set` drops a write outside the surface without
 * complaint, so a machine that outgrows its cel loses an arm at one orientation
 * and nobody can see why. Measuring at boot makes it the same kind of fact the
 * ground shadows and the prop widths are — read off the drawing, so it cannot be
 * wrong the first time a boom is lengthened.
 */
function solveMachine(): { w: number; h: number; ox: number; oy: number } {
  if (solved) return solved;
  const span = 240;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const turn of [0, 1, 2, 3]) {
    for (const kind of MACHINES) {
      const probe = new IsoPix(span, span, span / 2, span * 0.75, turn);
      undercarriage(probe);
      BODY_STACK[kind](probe);
      const g = GESTURE[kind]["work"];
      limb(probe, PIVOT, g.elbow, 4, ARM);
      limb(probe, g.elbow, g.tip, 3, ARM);
      probe.box(g.tip.x - 2, g.tip.y, 7, 5, Math.max(0, g.tip.z - 6), g.tip.z, {
        top: STEEL.top, lit: STEEL.lit, shadow: STEEL.shadow,
      });
      for (let y = 0; y < probe.pix.h; y++)
        for (let x = 0; x < probe.pix.w; x++) {
          if (!probe.pix.isOpaque(x, y)) continue;
          const dx = x - span / 2;
          const dy = y - span * 0.75;
          if (dx < minX) minX = dx;
          if (dx > maxX) maxX = dx;
          if (dy < minY) minY = dy;
          if (dy > maxY) maxY = dy;
        }
    }
  }
  const ox = PAD - minX;
  const oy = PAD - minY;
  solved = { w: ox + maxX + PAD, h: oy + maxY + PAD, ox, oy };
  return solved;
}

// --- placement --------------------------------------------------------------

/** FOOT is the machine's footprint corner: the point it stands on. */
const FOOT = LEN;

/**
 * machineOrigin is a drawn cel's own anchor.
 *
 * The cel's size is the authority on where its origin is, exactly as it is for a
 * building. The anchor is the footprint's near corner, because that is the point
 * a machine stands on — the same anchor the `frontCorner` fix gave the pennant,
 * and for the same reason: a fixed fraction is correct at exactly one turn.
 */
export function machineOrigin(_pix: Pix, turn: number): { ox: number; oy: number } {
  const box = solveMachine();
  const anchor = new WorldView(normaliseTurn(turn)).project(FOOT, 0);
  return { ox: anchor.x - box.ox, oy: anchor.y - box.oy };
}

/** machineBox is the cel the bake should reserve, measured from the drawing. */
export function machineBox(_turn: number): { w: number; h: number; ox: number; oy: number } {
  return solveMachine();
}