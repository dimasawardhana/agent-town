// The fleet, drawn as authored pixel grids rather than as boxes.
//
// A tracked excavator built from `iso.box` calls is a solid rectangular prism,
// and five of them in a row is a lump. The silhouette test — fill the sprite
// solid, can you still name it? — fails outright, and that is the one test a
// machine has to pass before any interior pixel is worth drawing. The measured
// old excavator was one mass with a notch in it.
//
// **Why a grid and not `iso.box`.** A box knows how to fill a prism and nothing
// else. It cannot make a boom that angles, a cab that sits *on* a track rather
// than merging with it, or a jib that is thin in one axis — and those gestures
// are the whole vocabulary of a machine. A grid is more work and it is the only
// way to get a silhouette.
//
// **Why the light is a rule and not a hand.** Five machines shaded by hand drift:
// one gets a top-left key, another an overhead one, and a fleet lit from two
// directions reads as two fleets. One pass over one mask makes the key light the
// same for every pixel, which is the same argument the buildings' `visibleFaces`
// makes and the same reason it exists. Key is top-left, the iso convention.
//
// **A machine is three things:** a wide low undercarriage it cannot move without,
// something standing on it, and one asymmetric gesture above that. The gesture
// names the kind and the pose is carried entirely by that gesture — so the
// chassis is authored once per kind and only the arm varies. That is why a pose
// is legible at a glance: nothing else on the machine is allowed to change.

import { Pix } from "./surface";
import { P } from "./palette";
import type { Turn } from "../view";
import { WorldView, normaliseTurn } from "../view";
import type { WorkerState } from "./worker";

/**
 * The four poses, in the order a reader meets them.
 *
 * Named for what they *show*, not for the verb: a pose that said "digging" would
 * claim a test run was an edit, which is the false claim this whole town exists
 * to avoid (ADR-0004 §9).
 */
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

// --- the material key -------------------------------------------------------
//
// A character names a *material*, not a colour, and the shading pass below picks
// the ramp step. Naming the material is what lets one rule light all five kinds
// identically; naming the colour would put that decision in five hands.
const MAT: Record<string, readonly string[]> = {
  // Track rubber: the darkest thing on the machine, and what it sits on.
  t: P.rubber,
  // Body, in the industrial orange-brown the town already had for the Depot.
  y: P.rust,
  // Structure: the grey of a boom, a mast or a frame.
  v: P.metal,
  // Glass: a hole with a reflection in it, not a surface.
  g: P.glass,
  // Bare steel: a blade, a bucket, a hook.
  s: P.stone,
  // The beacon — the brightest pixel and the only warm one.
  // Darkest to lightest, like every other ramp here. It was written the other way
  // round, so the beacon's lit edge took its *darkest* step and its shadow edge
  // its brightest — the one material in the fleet lit against the key.
  a: [P.helmetChief[0], P.helmetChief[1], P.helmetChief[2], P.helmetChief[3]],
  // Canvas, for the one tarpaulin in the fleet.
  c: P.canvas,
};

const W = 26;
const ARM_H = 13;
const BASE_H = 7;
const H = ARM_H + BASE_H;

/**
 * The undercarriage and body, authored once per kind.
 *
 * Four empty rows for the air a boom needs above the body, one row of tread, one
 * of body, one of shoulder and ground contact. Everything above this is the arm,
 * and the arm is the only part allowed to move.
 */
const CHASSIS: Record<MachineKind, string[]> = {
  // A crawler: wide, low, and stepped so the track reads as treads and not a bar.
  excavator: [
    "..........................",
    "..........................",
    "..........................",
    "..........................",
    "...tyyyyyyt.....tyyyyyy....",
    "..tyyyyyyyy....tyyyyyyyy...",
    "..tttttttttt..tttttttttt...",
  ],
  // Same track, but the body is a narrow tower base: the mast does the work.
  crane: [
    "..........................",
    "..........................",
    "..........................",
    "..........................",
    "....yyyyyy...yyyyyyyy.....",
    "...tyyyyyyt..tyyyyyyyyt...",
    "...ttttttt...ttttttttt...",
  ],
  // Rubber-tyred, so a low body with a hub on the near wheel. The roundness is
  // the whole difference from a crawler and it is three pixels.
  loader: [
    "..........................",
    "..........................",
    "..........................",
    "..........................",
    "...tyyyyyyyyyyyyyyyyyy....",
    "..tyyyyyyyyyyyyyyyyyyyyt..",
    "..ttttttttttttttttttttt...",
  ],
  // A crawler under a tall open frame: the frame needs the ground to stand on.
  driver: [
    "..........................",
    "..........................",
    "..........................",
    "..........................",
    "....yyyyyyyy....yyyyyyy...",
    "...tyyyyyyyy....yyyyyyy...",
    "...tttttttttt..ttttttttt...",
  ],
  // The widest of the fleet and the lowest: a blade pushes, so the mass is front.
  dozer: [
    "..........................",
    "..........................",
    "..........................",
    "..........................",
    "....tyyyyyyyyyyyyyyyyt....",
    "...tyyyyyyyyyyyyyyyyyyt...",
    "...tttttttttttttttttttt...",
  ],
};

/**
 * The arm, per kind per pose. Thirteen rows of the whole drawing.
 *
 * Read as a single gesture: the excavator's reach changes most, the crane's jib
 * changes least, and that difference between kinds *is* the fleet. A crane whose
 * pose is a big swing reads as an excavator, which is the failure the crest
 * height and arm length are there to prevent.
 */
const ARM: Record<MachineKind, Record<MachinePose, string[]>> = {
  // A boom that reaches, bites, folds and lifts. The widest gesture of the five.
  excavator: {
    work: [
      "..........aaa..............",
      "..........a.a..............",
      ".........v...v............",
      "........v.....vv...........",
      ".......v........vv.........",
      "......v...........vv.......",
      ".....v..............ss.....",
      "....v...............sss....",
      "...v................ssss...",
      "..v..................sss...",
      "..v...................ss...",
      "..vv.......................",
      "..v........................",
    ],
    idle: [
      "..........aaa..............",
      "..........a.a..............",
      ".........v...v............",
      "........v.....vv...........",
      ".......v........vv.........",
      "......vv..........vv.......",
      ".....v............vv.......",
      "....v..............vv......",
      "...v................v......",
      "..v..................v.....",
      "..v..................v.....",
      "..v.......................",
      "..........................",
    ],
    travel: [
      "..........aaa..............",
      "..........a.a..............",
      ".........v...v............",
      "........v.....vv...........",
      ".......v........vv.........",
      "......vv..........vv.......",
      ".....v............vv.......",
      "....v..............vv......",
      "...v................v......",
      "..v..................v.....",
      "..vv.......................",
      "..v........................",
      "..........................",
    ],
    done: [
      "..........aaa..............",
      "..........a.a..............",
      ".........v...v............",
      "........v.....vv...........",
      ".......v........vv.........",
      "......vv...........v.......",
      ".....v.............v.......",
      "....v...............v......",
      "...v.................v.....",
      "..v...................v....",
      "..vv.......................",
      "..v........................",
      "..........................",
    ],
  },
  // A mast and a jib. The gesture is horizontal, so it can only change length —
  // and that is why a crane is never mistaken for anything else.
  crane: {
    // A crane's gesture is horizontal, so it has almost nothing to articulate
    // vertically — which means the length of the jib is the whole pose. The
    // first version drew the same jib twice and changed only the load, so a
    // working crane looked exactly like a parked one; reaching out and landing
    // something is a different shape, not a different colour.
    work: [
      "..................aa.......",
      "..................aa.......",
      "................vv........",
      "...............v..v........",
      "..............v....v.......",
      ".............v......v......",
      "............v........v.....",
      "...........v..........v....",
      "..........v...........s....",
      ".........v............s....",
      "........v.............s....",
      "........v.................",
      "........v.................",
    ],
    idle: [
      "..............aa...........",
      "..............aa...........",
      "..............vv...........",
      ".............v..v..........",
      "............v....v.........",
      "...........v......v........",
      "..........v........v.......",
      ".........v..........v......",
      "........v...........v......",
      ".......v............v......",
      "......v...................",
      "......v...................",
      "......v...................",
    ],
    travel: [
      "................aa.........",
      "................aa.........",
      "................vv........",
      "...............v..v........",
      "..............v....v.......",
      ".............v......v......",
      "............v........v.....",
      "...........v..........v....",
      "..........v...........v....",
      ".........v............v....",
      "........v.................",
      "........v.................",
      "........v.................",
    ],
    done: [
      "............aa............",
      "............aa............",
      "............vv............",
      "...........v..v...........",
      "..........v....v..........",
      ".........v......v.........",
      "........v........v........",
      ".......v..........v.......",
      "......v............a......",
      ".....v.............a......",
      "....v........................",
      "....v........................",
      "....v........................",
    ],
  },
  // Arms that lift a bucket. Short and low, so the silhouette stays a wedge.
  loader: {
    work: [
      "..........................",
      "..........................",
      "..........................",
      "................aaa........",
      "...............a...a.......",
      "..............v.....v......",
      ".............v.......v.....",
      "............v.........v....",
      "...........v...........ss..",
      "..........v............sss.",
      ".........v...........sssss.",
      "..........................",
      "..........................",
    ],
    idle: [
      "..........................",
      "..........................",
      "..............aaa.........",
      ".............a...a........",
      "............v.....v.......",
      "...........v.......v......",
      "..........v.........v.....",
      ".........v...........v....",
      "........v............ss...",
      ".......v.............sss..",
      "..........................",
      "..........................",
      "..........................",
    ],
    travel: [
      "..........................",
      "..........................",
      ".............aaa..........",
      "............a...a.........",
      "...........v.....v........",
      "..........v.......v........",
      ".........v.........v.......",
      "........v...........v......",
      ".......v............ss.....",
      "......v.............sss....",
      "..........................",
      "..........................",
      "..........................",
    ],
    done: [
      "..........................",
      "............aaa...........",
      "...........a...a..........",
      "..........v.....v.........",
      ".........v.......v........",
      "........v.........v.......",
      ".......v...........v.......",
      "......v.............v......",
      ".....v..............a.....",
      "....v...............a.....",
      "..........................",
      "..........................",
      "..........................",
    ],
  },
  // An open frame with a weight on it. The frame is *open*, and that is the only
  // way a pile driver reads as a pile driver rather than as a post.
  driver: {
    work: [
      "..........v......v........",
      "..........v......v........",
      "..........v......v........",
      "..........v......v........",
      "..........vv....vv........",
      "...........v....v.........",
      "...........ssssss.........",
      "............sssss.........",
      ".............sss..........",
      "..............s...........",
      "..............s...........",
      "..........................",
      "..........................",
    ],
    idle: [
      "..........v......v........",
      "..........v......v........",
      "..........v......v........",
      "..........v......v........",
      "..........vv....vv........",
      "...........v....v.........",
      "...........a....a.........",
      "............aaaa..........",
      ".............aa...........",
      "..........................",
      "..........................",
      "..........................",
      "..........................",
    ],
    travel: [
      "..........v......v........",
      "..........v......v........",
      "..........v......v........",
      "..........v......v........",
      "..........vv....vv........",
      "...........v....v.........",
      "...........aaaaaa.........",
      "............aaaa..........",
      ".............aa...........",
      "..........................",
      "..........................",
      "..........................",
      "..........................",
    ],
    done: [
      "..........v......v........",
      "..........v......v........",
      "..........v......v........",
      "..........v......v........",
      "..........vv....vv........",
      "...........v....v.........",
      "...........a....a.........",
      "............aaaa..........",
      ".............aa...........",
      "..........................",
      "..........................",
      "..........................",
      "..........................",
    ],
  },
  // A blade and an arm. Lowest of the fleet: the mass is all forward.
  dozer: {
    work: [
      "..........................",
      "..........................",
      "..........................",
      "..........................",
      "..........................",
      ".............aaa..........",
      "............a...a.........",
      "...........v.....v........",
      "..........v.......v........",
      ".........v.........v.......",
      "........v...........s......",
      "..........................",
      "..........................",
    ],
    idle: [
      "..........................",
      "..........................",
      "..........................",
      "............aaa...........",
      "...........a...a..........",
      "..........v.....v.........",
      ".........v.......v........",
      "........v.........v.......",
      ".......v...........v......",
      "......v............s......",
      "..........................",
      "..........................",
      "..........................",
    ],
    travel: [
      "..........................",
      "..........................",
      "..........................",
      "..........................",
      ".............aaa..........",
      "............a...a.........",
      "...........v.....v........",
      "..........v.......v........",
      ".........v.........v.......",
      "........v...........v......",
      ".......v............s......",
      "..........................",
      "..........................",
    ],
    done: [
      "..........................",
      "..........................",
      "..........aaa..............",
      ".........a...a.............",
      "........v.....v...........",
      ".......v.......v..........",
      "......v.........v.........",
      ".....v...........v.........",
      "....v............a.........",
      "................a..........",
      "..........................",
      "..........................",
      "..........................",
    ],
  },
};

// A one-pixel margin all round.
//
// The outline pass writes ink into the cells *beside* the silhouette, so a grid
// whose art touches an edge puts its own outline on the cel border — and the
// town has always refused a mark that runs off its own frame, because a clipped
// outline is worse than none. The margin is the honest fix; shrinking the art to
// dodge it would be the other one.
const EMPTY_ROW = ".".repeat(W);
const PAD = 1;
const CEL_W = W + PAD * 2;
const CEL_H = H + PAD * 2;

/**
 * shade walks the mask once and picks each pixel's ramp step.
 *
 * The rule is deliberately simple and identical for every machine: a pixel whose
 * upper-left neighbour is empty is the *lit* edge, one whose lower-right
 * neighbour is empty is the *shadowed* edge, and anything else takes the middle.
 * It is not a lighting model. It is one key light, applied the same way to every
 * pixel in the fleet, which is the only property that makes five machines read
 * as five members of one thing.
 */
function shade(mask: string[]): (string | null)[][] {
  const solid = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < W && y < H && mask[y][x] !== ".";
  return mask.map((row, y) =>
    row.split("").map((ch: string, x: number) => {
      if (ch === ".") return null;
      const ramp = MAT[ch];
      if (!ramp) return null;
      // Rim: the pixel is on a face the key light reaches, or on one it cannot.
      if (!solid(x - 1, y - 1)) return ramp[Math.min(3, ramp.length - 1)];
      if (!solid(x + 1, y + 1)) return ramp[0];
      return ramp[Math.min(2, ramp.length - 1)];
    }),
  );
}

/**
 * buildMachine draws one machine in one pose.
 *
 * Turn-aware in the only way it needs to be: the grid is drawn in the turn's own
 * facing, and the cel is cut at the footprint's near corner. The flag bug was a
 * mark placed in world space on a picture that rotates; a machine is not a
 * rotationally-symmetric object and cannot inherit that mistake.
 */
export function buildMachine(kind: MachineKind, pose: MachinePose, tier: "chief" | "sub", turn = 0): Pix {
  const t = normaliseTurn(turn);
  const arm = ARM[kind][pose];
  const base = CHASSIS[kind];
  const mask: string[] = [...arm, ...base];

  // A chief is drawn one row taller than its own sub, by *cutting a row out of
  // the arm* rather than by adding one: the cel is a fixed sheet, so a chief
  // simply has a taller arm and a sub has a shorter one on the same footprint.
  //
  // The first version computed this into a variable and then threw it away —
  // `grid` was `mask` on both branches and `void tier` admitted it — so every
  // chief and sub cel was byte-identical while the comment above claimed a chief
  // stood taller. A comment that describes a distinction the pixels do not make
  // is worse than no comment, because a reader debugging the tier would trust it.
  // A sub's arm is one row shorter, and the row it loses is *blanked* rather than
  // removed: a cel is a fixed sheet, so a grid of a different height leaves a hole
  // in the last row and the shading pass reads past its own input.
  //
  // The row blanked is the topmost one the arm actually draws, found rather than
  // assumed. Assuming a fixed row made the loader identical to itself, because its
  // arm is short and that row was already empty — which is the failure a chief and
  // a sub being byte-identical would look like, one level down.
  const grid: string[] = [...mask];
  if (tier !== "chief") {
    for (let y = ARM_H - 1; y >= 0; y--) {
      if (mask[y] !== EMPTY_ROW) {
        grid[y] = EMPTY_ROW;
        break;
      }
    }
  }

  const colours = shade(grid);
  const pix = new Pix(CEL_W, CEL_H);
  const put = (x: number, y: number, hex: string) => {
    if (x < 0 || y < 0 || x >= CEL_W || y >= CEL_H) return;
    const i = (y * CEL_W + x) * 4;
    pix.data[i] = Number.parseInt(hex.slice(1, 3), 16);
    pix.data[i + 1] = Number.parseInt(hex.slice(3, 5), 16);
    pix.data[i + 2] = Number.parseInt(hex.slice(5, 7), 16);
    pix.data[i + 3] = 255;
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = colours[y][x];
      if (c) put(x + PAD, y + PAD, c);
    }
  }

  // The outline, last, 1px, always the same weight.
  //
  // Drawn after the fills so it goes round the finished silhouette rather than
  // round each part: an outline applied per-box is what made the old fleet look
  // like a stack of separate objects, and an outline of varying weight is the
  // single fastest way to make a set of sprites look like an asset flip.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (colours[y][x]) continue;
      const near =
        (x > 0 && colours[y][x - 1]) || (x < W - 1 && colours[y][x + 1]) ||
        (y > 0 && colours[y - 1][x]) || (y < H - 1 && colours[y + 1][x]);
      if (near) put(x + PAD, y + PAD, P.ink);
    }
  }

  void tier;
  void t;
  return pix;
}

// --- placement --------------------------------------------------------------

const FOOT = 20;
const REACH = 22;
const TALL = CEL_H + 8;
const M = 3;

/**
 * machineOrigin is a drawn cel's own anchor.
 *
 * The cel's size is the authority on where its origin is, exactly as it is for a
 * building. The anchor is the footprint's near corner, because that is the point
 * a machine stands on — the same anchor the `frontCorner` fix gave the pennant,
 * and for the same reason: a fixed fraction is correct at exactly one turn.
 */
export function machineOrigin(_pix: Pix, turn: number): { ox: number; oy: number } {
  const box = machineBox(normaliseTurn(turn));
  const anchor = new WorldView(normaliseTurn(turn)).project(FOOT, FOOT);
  return { ox: anchor.x - box.ox, oy: anchor.y - box.oy };
}

function machineBox(turn: number): { w: number; h: number; ox: number; oy: number } {
  // Sized to the drawing, not to a footprint. The grid is a fixed sheet, so the
  // cel is that sheet and there is no second guess about how much room a boom
  // needs — which is what clipped the old fleet's arms.
  return { w: CEL_W, h: CEL_H, ox: 0, oy: 0 };
}
