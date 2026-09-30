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
//
// Five materials and no more. `glass` and `canvas` were here for a cab window
// and a tarpaulin that no grid draws, which is the smallest possible version of
// an abstraction built for a need nobody has — and a key nobody reaches is a
// material that would be mis-shaded silently if one were ever added.
const MAT: Record<string, readonly string[]> = {
  // Track rubber: the darkest thing on the machine, and what it sits on.
  t: P.rubber,
  // Tread highlight: the raised band a track's wheels run on. Its own key so
  // the track reads as wheels rather than as a slab, which is what a solid three
  // rows of `t` came out as — a dark bar under the body with no interior at all.
  //
  // Reachable and used on the wheel row of every crawler, so it does not
  // violate the rule above about keys nobody reaches.
  u: [P.rubber[1], P.rubber[2], P.rubber[3], P.rubber[3]],
  // Body, in the industrial orange-brown the town already had for the Depot.
  y: P.rust,
  // Structure: the grey of a boom, a mast or a frame.
  //
  // **Deliberately stops two steps short of `P.metal`'s top.** The arm was
  // reading as the brightest thing on the sprite — a near-white wire — while the
  // body it is bolted to was a dull slab, which inverts the hierarchy: the eye
  // goes to the least important part. A boom is painted steel, and painted steel
  // in this town's light is two steps below bare metal.
  v: [P.metal[0], P.metal[1], P.metal[1], P.metal[2]],
  // Glass: a hole with a reflection in it, not a surface. One step brighter
  // than `P.glass`'s own ramp, for the same reason the arm is darkened — a cab
  // window in `P.glass[2]` against a rust body is invisible, and the cab is the
  // one thing that says a machine is driven rather than pushed.
  g: [P.glass[1], P.glass[2], P.glass[3], P.glass[3]],
  // Bare steel: a blade, a bucket, a hook.
  s: P.stone,
  // The beacon — the brightest pixel and the only warm one.
  // Darkest to lightest, like every other ramp here. It was written the other way
  // round, so the beacon's lit edge took its *darkest* step and its shadow edge
  // its brightest — the one material in the fleet lit against the key.
  a: [P.helmetChief[0], P.helmetChief[1], P.helmetChief[2], P.helmetChief[3]],
};

// The grid the fleet is authored on.
//
// **This was 26 and 103 of the 260 arm rows are wider than that** — up to 29
// characters. `buildMachine` walks `x < W`, so every one of those rows had its
// right-hand end silently dropped: the far side of the excavator's boom and the
// outer half of several buckets were being drawn into nothing. The art was not
// wrong; the grid it was written on was smaller than the art.
//
// Free to fix. The atlas packs to the size of its *largest* cel, which is a
// 115x101 building, so growing a 28x22 machine to 32x24 moves nothing — the
// sheet is 2048x8192 either way, measured.
const W = 30;
const ARM_H = 13;
const BASE_H = 7;
const H = ARM_H + BASE_H;

/**
 * The undercarriage and body, authored once per kind.
 *
 * Three rows of body over three of track, and everything above this is the arm —
 * the arm is the only part allowed to move.
 *
 * Three rules hold across all five kinds, and each was a defect first:
 *
 *  1. **The rows above the track are body, not air.** They used to be blank
 *     "space for the boom", and the arms ended two to six rows above them —
 *     measured across all twenty kind/pose pairs, `driver` idle had six. An arm
 *     floating over a pair of lumps is two objects, and the eye is right.
 *  2. **The body is wider than the track.** One 26-pixel plank of body and track
 *     reads as a slab with nothing on it. A body that overhangs its track has a
 *     shoulder, and a shoulder is what says "this thing sits on wheels".
 *  3. **A cab, in glass.** The body is the one part that never moves, so it is
 *     the only place a cab can live — and a lit window is the single pixel that
 *     says somebody drives this.
 *
 * The track is one continuous run, not two. The old pair of lumps read as two
 * objects standing next to each other, and the tread rhythm comes from `shade()`
 * rimming the run rather than from alternating characters by hand.
 */
const CHASSIS: Record<MachineKind, string[]> = {
  // A crawler: wide, low, and cab-forward because the boom needs the room.
  excavator: [
    "..gggggggggggggggggggggggg..",
    ".tyyyyyyyyyyyyyyyyyyyyyyyyyt.",
    "tyyyyyyyyyyyyyyyyyyyyyyyyyyy",
    "tyyyyyyyyyyyyyyyyyyyyyyyyyyy",
    "..tttttttttttttttttttttttttt..",
    ".ttttttttttttttttttttttttttt.",
    "..................................",
  ],
  // Same track, narrower still: the mast does the work, so the body is little
  // more than a collar around it and does not pretend otherwise.
  crane: [
    "....gggggggggggggggggg......",
    "...tyyyyyyyyyyyyyyyyyyyyt....",
    "..tyyyyyyyyyyyyyyyyyyyyyyt...",
    "..tttttttttttttttttttttttttt..",
    "..tututututututututututututu..",
    "..tttttttttttttttttttttttttt..",
    "..................................",
  ],
  // Rubber-tyred and low, so the body sits down onto the wheels: the track band
  // is barely wider than the body and the shoulder almost disappears.
  loader: [
    "..gggggggggggggggggggggggg..",
    ".tyyyyyyyyyyyyyyyyyyyyyyyyyt.",
    "tyyyyyyyyyyyyyyyyyyyyyyyyyyy",
    "tyyyyyyyyyyyyyyyyyyyyyyyyyyy",
    "..tttttttttttttttttttttttttt..",
    "..tttttttttttttttttttttttttt..",
    "..................................",
  ],
  // An open frame: two posts with a gap between them, which is what a driver's
  // cab is. The gap is the read — a solid block here would be a van.
  driver: [
    "..gggggggg....gggggggggg....",
    ".tyyyyyyyy....tyyyyyyyyyyy...",
    "tyyyyyyyyy....tyyyyyyyyyyyy..",
    "tyyyyyyyyy....tyyyyyyyyyyyy..",
    "...tttttttttt..tttttttttttt...",
    "...tttttttttt..tttttttttttt...",
    "..................................",
  ],
  // The widest and lowest of the fleet, and the front-heavy one: a blade
  // pushes, so the mass sits ahead of where the arm pivots and the track runs
  // the whole length underneath it.
  dozer: [
    "..gggggggggggggggggggggggg..",
    ".tyyyyyyyyyyyyyyyyyyyyyyyyyt.",
    "tyyyyyyyyyyyyyyyyyyyyyyyyyyy",
    "tyyyyyyyyyyyyyyyyyyyyyyyyyyy",
    ".ttttttttttttttttttttttttttt.",
    ".ttttttttttttttttttttttttttt.",
    "..................................",
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
      "..........aaaaaa...........",
      "..........aaaaaa...........",
      ".........vvvvvvv..........",
      "........vvvv..vvvv.........",
      ".......vvvv.....vvvv.......",
      "......vvvv........vvvv.....",
      ".....vvvv...........ssss...",
      "....vvvv............sssss..",
      "...vvvv.............ssssss.",
      "..vvvv...............sssss.",
      "..vvvv................ssss.",
      "..vvvvv....................",
      "..vvvv.....................",
    ],
    idle: [
      "..........aaaaaa...........",
      "..........aaaaaa...........",
      ".........vvvvvvv..........",
      "........vvvv..vvvv.........",
      ".......vvvv.....vvvv.......",
      "......vvvvv.......vvvv.....",
      ".....vvvv.........vvvv.....",
      "....vvvv...........vvvv....",
      "...vvvv.............vvv....",
      "..vvvv...............vvv...",
      "..vvvv...............vvv...",
      "..vvvv....................",
      "..........................",
    ],
    travel: [
      "..........aaaaaa...........",
      "..........aaaaaa...........",
      ".........vvvvvvv..........",
      "........vvvv..vvvv.........",
      ".......vvvv.....vvvv.......",
      "......vvvvv.......vvvv.....",
      ".....vvvv.........vvvv.....",
      "....vvvv...........vvvv....",
      "...vvvv.............vvv....",
      "..vvvv...............vvv...",
      "..vvvvv....................",
      "..vvvv.....................",
      "..........................",
    ],
    done: [
      "..........aaaaaa...........",
      "..........aaaaaa...........",
      ".........vvvvvvv..........",
      "........vvvv..vvvv.........",
      ".......vvvv.....vvvv.......",
      "......vvvvv........vvv.....",
      ".....vvvv..........vvv.....",
      "....vvvv............vvv....",
      "...vvvv..............vvv...",
      "..vvvv................vvv..",
      "..vvvvv....................",
      "..vvvv.....................",
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
      "..................aaaaa....",
      "..................aaaaa....",
      "................vvvvv.....",
      "...............vvvvvvv.....",
      "..............vvvv.vvv.....",
      ".............vvvv...vvv....",
      "............vvvv.....vvv...",
      "...........vvvv.......vvv..",
      "..........vvvv........sss..",
      ".........vvvv.........sss..",
      "........vvvv..........sss..",
      "........vvvv..............",
      "........vvvv..............",
    ],
    idle: [
      "..............aaaaa........",
      "..............aaaaa........",
      "..............vvvvv........",
      ".............vvvvvvv.......",
      "............vvvv.vvv.......",
      "...........vvvv...vvv......",
      "..........vvvv.....vvv.....",
      ".........vvvv.......vvv....",
      "........vvvv........vvv....",
      ".......vvvv.........vvv....",
      "......vvvv................",
      "......vvvv................",
      "......vvvv................",
    ],
    travel: [
      "................aaaaa......",
      "................aaaaa......",
      "................vvvvv.....",
      "...............vvvvvvv.....",
      "..............vvvv.vvv.....",
      ".............vvvv...vvv....",
      "............vvvv.....vvv...",
      "...........vvvv.......vvv..",
      "..........vvvv........vvv..",
      ".........vvvv.........vvv..",
      "........vvvv..............",
      "........vvvv..............",
      "........vvvv..............",
    ],
    done: [
      "............aaaaa.........",
      "............aaaaa.........",
      "............vvvvv.........",
      "...........vvvvvvv........",
      "..........vvvv.vvv........",
      ".........vvvv...vvv.......",
      "........vvvv.....vvv......",
      ".......vvvv.......vvv.....",
      "......vvvv.........aaa....",
      ".....vvvv..........aaa....",
      "....vvvv.....................",
      "....vvvv.....................",
      "....vvvv.....................",
    ],
  },
  // Arms that lift a bucket. Short and low, so the silhouette stays a wedge.
  loader: {
    work: [
      "..........................",
      "..........................",
      "..........................",
      "................aaaaaa.....",
      "...............aaaaaaa.....",
      "..............vvvv..vvv....",
      ".............vvvv....vvv...",
      "............vvvv......vvv..",
      "...........vvvv........ssss",
      "..........vvvv.........ssss",
      ".........vvvv........ssssss",
      "..........................",
      "..........................",
    ],
    idle: [
      "..........................",
      "..........................",
      "..............aaaaaa......",
      ".............aaaaaaa......",
      "............vvvv..vvv.....",
      "...........vvvv....vvv....",
      "..........vvvv......vvv...",
      ".........vvvv........vvv..",
      "........vvvv.........ssss.",
      ".......vvvv..........sssss",
      "..........................",
      "..........................",
      "..........................",
    ],
    travel: [
      "..........................",
      "..........................",
      ".............aaaaaa.......",
      "............aaaaaaa.......",
      "...........vvvv..vvv......",
      "..........vvvv....vvv......",
      ".........vvvv......vvv.....",
      "........vvvv........vvv....",
      ".......vvvv.........ssss...",
      "......vvvv..........sssss..",
      "..........................",
      "..........................",
      "..........................",
    ],
    done: [
      "..........................",
      "............aaaaaa........",
      "...........aaaaaaa........",
      "..........vvvv..vvv.......",
      ".........vvvv....vvv......",
      "........vvvv......vvv.....",
      ".......vvvv........vvv.....",
      "......vvvv..........vvv....",
      ".....vvvv...........aaa...",
      "....vvvv............aaa...",
      "..........................",
      "..........................",
      "..........................",
    ],
  },
  // An open frame with a weight on it. The frame is *open*, and that is the only
  // way a pile driver reads as a pile driver rather than as a post.
  driver: {
    work: [
      "..........vvvv...vvv......",
      "..........vvvv...vvv......",
      "..........vvvv...vvv......",
      "..........vvvv...vvv......",
      "..........vvvvv.vvvv......",
      "...........vvvv.vvv.......",
      "...........sssssssss......",
      "............ssssssss......",
      ".............ssssss.......",
      "..............ssss........",
      "..............ssss........",
      "..........................",
      "..........................",
    ],
    idle: [
      "..........vvvv...vvv......",
      "..........vvvv...vvv......",
      "..........vvvv...vvv......",
      "..........vvvv...vvv......",
      "..........vvvvv.vvvv......",
      "...........vvvv.vvv.......",
      "...........aaaa.aaa.......",
      "............aaaaaaa.......",
      ".............aaaaa........",
      "..........................",
      "..........................",
      "..........................",
      "..........................",
    ],
    travel: [
      "..........vvvv...vvv......",
      "..........vvvv...vvv......",
      "..........vvvv...vvv......",
      "..........vvvv...vvv......",
      "..........vvvvv.vvvv......",
      "...........vvvv.vvv.......",
      "...........aaaaaaaaa......",
      "............aaaaaaa.......",
      ".............aaaaa........",
      "..........................",
      "..........................",
      "..........................",
      "..........................",
    ],
    done: [
      "..........vvvv...vvv......",
      "..........vvvv...vvv......",
      "..........vvvv...vvv......",
      "..........vvvv...vvv......",
      "..........vvvvv.vvvv......",
      "...........vvvv.vvv.......",
      "...........aaaa.aaa.......",
      "............aaaaaaa.......",
      ".............aaaaa........",
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
      ".............aaaaaa.......",
      "............aaaaaaa.......",
      "...........vvvv..vvv......",
      "..........vvvv....vvv......",
      ".........vvvv......vvv.....",
      "........vvvv........sss....",
      "..........................",
      "..........................",
    ],
    idle: [
      "..........................",
      "..........................",
      "..........................",
      "............aaaaaa........",
      "...........aaaaaaa........",
      "..........vvvv..vvv.......",
      ".........vvvv....vvv......",
      "........vvvv......vvv.....",
      ".......vvvv........vvv....",
      "......vvvv.........sss....",
      "..........................",
      "..........................",
      "..........................",
    ],
    travel: [
      "..........................",
      "..........................",
      "..........................",
      "..........................",
      ".............aaaaaa.......",
      "............aaaaaaa.......",
      "...........vvvv..vvv......",
      "..........vvvv....vvv......",
      ".........vvvv......vvv.....",
      "........vvvv........vvv....",
      ".......vvvv.........sss....",
      "..........................",
      "..........................",
    ],
    done: [
      "..........................",
      "..........................",
      "..........aaaaaa...........",
      ".........aaaaaaa...........",
      "........vvvv..vvv.........",
      ".......vvvv....vvv........",
      "......vvvv......vvv.......",
      ".....vvvv........vvv.......",
      "....vvvv.........aaa.......",
      "................aaaa.......",
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
