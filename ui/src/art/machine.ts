// The fleet: a machine per agent, a pose per state.
//
// A session used to be a person, and a person is the least legible thing in this
// town: at the fitted zoom a 20px figure is a coloured speck, while the buildings
// beside it have eleven archetypes and five materials. The silhouette is the
// cheapest legibility there is, and a machine has a silhouette — a boom, a jib, a
// blade — where a standing human has a blob.
//
// **What a machine may claim.** Identity, never action. Five kinds, assigned by
// hash from the agent's key, so a session is *an excavator* and stays one. That
// is a statement about which crew it is, and it is true for as long as the session
// lasts. The pose is a statement about *what it is doing right now*, and it is
// kept coarse on purpose — four states, not ten — because a machine that raised
// its boom differently for each of ten verbs would be claiming a specificity the
// map cannot support and the panel does not need. Tests do not dig, and a pose
// that said they did would be the false claim this whole town is built to avoid
// (ADR-0004 §9). So the poses are named for what they *show*: working, parked,
// moving, finished.
//
// **The budget.** The figure cost 76 cels — 7% of the whole atlas — for 38 frames
// across 10 states. This is 40 cels for 5 kinds × 4 poses × 2 tiers. The town
// comes out ahead, and the atlas ceiling is further away than it was.

import { Pix } from "./surface";
import { P } from "./palette";
import { IsoPix } from "./iso";
import type { Turn } from "../view";
import { WorldView, normaliseTurn } from "../view";

/** The four poses. Coarse, and named for the picture rather than the verb. */
export type MachinePose = "work" | "idle" | "travel" | "done";

/**
 * POSE_FOR is the ten worker states folded onto four poses.
 *
 * The folding is the design, not a shortcut. Which states share a pose is the
 * claim the fleet makes about them, so it is written out rather than derived:
 * reading and planning are both "parked and looking", and hammering, building,
 * demolishing and commanding are all "engaged with something on the ground",
 * which is the most a silhouette can honestly say.
 */
export const POSE_FOR: Record<string, MachinePose> = {
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

/** The five kinds, named by silhouette so the roster reads as a fleet. */
export const MACHINE_POSES: readonly MachinePose[] = ["work", "idle", "travel", "done"];

export const MACHINES = ["excavator", "crane", "loader", "driver", "dozer"] as const;
export type MachineKind = (typeof MACHINES)[number];

/**
 * machineFor assigns a kind by hash, deterministically.
 *
 * The same FNV walk `hashPath` uses, over the agent's key, so a session is the
 * same machine on every client and across every reload — a machine that changed
 * between refreshes would make the fleet a lie about continuity.
 */
export function machineFor(key: string): MachineKind {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return MACHINES[(h >>> 0) % MACHINES.length];
}

/**
 * The widest and tallest machine, and the box every machine is cut to.
 *
 * One box for the fleet, not one per kind: a machine's origin is what the scene
 * subtracts to place it, and five origins would mean five places for a placement
 * to go wrong. Derived from the footprint the way a building's box is — corners
 * projected at this turn, margin for the outline — so the cel's own size is the
 * authority on where a machine's anchor is, rather than a constant somebody
 * tuned until it looked right at turn 0.
 */
const FOOT = 8;
const TALL = 16;
const M = 3;

/**
 * machineOrigin is a drawn cel's own anchor.
 *
 * The cel's size is the authority on where its origin is, exactly as it is for
 * a building: derived from what was actually drawn rather than from a constant
 * tuned until it looked right at turn 0. The anchor is the footprint's near
 * corner, because that is the point a machine stands on.
 */
export function machineOrigin(pix: Pix, turn: number): { ox: number; oy: number } {
  const box = machineBox(normaliseTurn(turn));
  const anchor = new WorldView(normaliseTurn(turn)).project(FOOT, FOOT);
  return { ox: anchor.x - box.ox, oy: anchor.y - box.oy };
}

/**
 * REACH is how far a machine's arm can extend past its own footprint.
 *
 * A building is a closed box, so its cel is its footprint plus a margin. A
 * machine is not: the boom, the jib and the blade all stick out past the tracks
 * they are bolted to, and a cel sized to the footprint clips the arm off at the
 * edge — which is how this started, with the excavator's bucket sheared away.
 */
const REACH = 9;

function machineBox(turn: number): { w: number; h: number; ox: number; oy: number } {
  const v = new WorldView(turn);
  const xs: number[] = [];
  const ys: number[] = [];
  const corners: [number, number][] = [
    [0, 0],
    [FOOT, 0],
    [0, FOOT],
    [FOOT, FOOT],
    // The region an arm can swing through, so the cel contains the reach rather
    // than the body alone.
    [FOOT + REACH, 0],
    [FOOT + REACH, FOOT],
  ];
  for (const [x, y] of corners) {
    const p = v.project(x, y);
    xs.push(p.x);
    ys.push(p.y);
  }
  const minX = Math.floor(Math.min(...xs)) - M;
  const maxX = Math.ceil(Math.max(...xs)) + M;
  const minY = Math.floor(Math.min(...ys) - TALL) - M;
  const maxY = Math.ceil(Math.max(...ys)) + M;
  return { w: maxX - minX + 1, h: maxY - minY + 1, ox: -minX, oy: -minY };
}

// One key for the whole fleet, so a colour is named once and the machines read as
// a fleet rather than as five unrelated drawings.
const K: Record<string, string> = {
  o: P.ink,
  y: P.rust[3],
  Y: P.rust[2],
  v: P.metal[3],
  V: P.metal[2],
  d: P.metal[1],
  t: P.rubber[2],
  T: P.rubber[3],
  g: P.glass[1],
  s: P.canvas[2],
  // The beacon, in the helmet yellow the town already uses for "this one is
  // working". Not the accent: the ember and the verified pennant both use it,
  // and a machine carrying the same colour would be claiming one of those.
  a: P.helmetChief[3],
  A: P.helmetChief[1],
};

/** A machine's footprint, in its own cel. Drawn with the iso helper so the
 *  tracks, the deck and the cab are the same shapes a building's are. */
/**
 * buildMachine draws one machine in one pose.
 *
 * Turn-aware throughout, and that is not optional: the flag bug was a mark
 * placed in world space on a picture that rotates, and a machine's boom is a mark
 * on a rotating picture exactly as a flag is on a roof. Everything here goes
 * through `IsoPix`, which knows the turn.
 */
export function buildMachine(kind: MachineKind, pose: MachinePose, tier: "chief" | "sub", turn = 0): Pix {
  const scale = tier === "chief" ? 1.15 : 1;
  const t = normaliseTurn(turn);
  const box = machineBox(t);
  const iso = new IsoPix(box.w, box.h, box.ox, box.oy, t);
  // The footprint, in the world coordinates `IsoPix` projects — from zero, the
  // way a building's does. A machine stands *on* its footprint, so this is the
  // near corner rather than a figure's centre line.
  const base = 0;
  const w = FOOT - 1;
  const d = Math.round(6 * scale);
  const bx = 0;
  const by = 0;

  switch (kind) {
    case "excavator":
      tracks(iso, bx, by, w, d, base, K.t, K.T);
      cab(iso, bx + 1, by + 1, Math.round(4 * scale), Math.round(3 * scale), base + 2, K.y, K.Y, K.g);
      boom(iso, bx, by, w, d, base, scale, pose, 1);
      break;
    case "crane":
      tracks(iso, bx, by, w, d, base, K.t, K.T);
      mast(iso, bx, by, Math.round(1 * scale) + 1, base + 14, K.v, K.V, pose);
      break;
    case "loader":
      wheels(iso, bx, by, w, d, base, K.t, K.T);
      cab(iso, bx + 1, by, Math.round(4 * scale), Math.round(3 * scale), base + 2, K.y, K.Y, K.g);
      // A loader has no boom: the bucket is bolted to the front, so the pose
      // moves the bucket rather than an arm, and "work" is a raised bucket.
      bucket(iso, bx, by, w, d, base, scale, pose);
      break;
    case "driver":
      tracks(iso, bx, by, w, d, base, K.t, K.T);
      frame(iso, bx, by, Math.round(5 * scale), base + 15, K.v, K.V);
      hammer(iso, bx, by, scale, pose);
      break;
    case "dozer":
      tracks(iso, bx, by, w, d, base, K.t, K.T);
      cab(iso, bx + 1, by + 1, Math.round(3 * scale), Math.round(3 * scale), base + 2, K.y, K.Y, K.g);
      blade(iso, bx, by, w, d, base, scale, pose);
      break;
  }

  return iso.outline(K.o);
}

/** tracks is the undercarriage every kind but the loader sits on. */
function tracks(iso: IsoPix, x: number, y: number, w: number, d: number, z: number, dark: string, light: string): void {
  iso.box(x, y, w, d, z, z + 2, { top: light, lit: light, shadow: dark, edge: K.o });
}

/** wheels is the loader's, because rubber and a track are different silhouettes. */
function wheels(iso: IsoPix, x: number, y: number, w: number, d: number, z: number, dark: string, light: string): void {
  iso.box(x, y, w, d, z, z + 2, { top: light, lit: light, shadow: dark, edge: K.o });
  // A hub on the near wheel, so it reads as a wheel rather than a low box.
  iso.footprint(x + Math.round(w / 2) - 1, y + d - 1, 2, 1, z + 2, K.s);
}

/** cab is the operator's box: glass on the two faces the camera can see. */
function cab(iso: IsoPix, x: number, y: number, w: number, d: number, z: number, body: string, lit: string, glass: string): void {
  iso.box(x, y, w, d, z, z + 3, { top: body, lit: body, shadow: body, edge: K.o });
  iso.footprint(x, y, w, d, z + 3, K.Y);
  iso.box(x + 1, y + 1, w - 2, d - 1, z + 1, z + 3, { top: glass, lit: glass, shadow: glass, edge: K.o });
}

/** boom swings from down (working) to up (parked), which is the whole pose. */
function boom(iso: IsoPix, x: number, y: number, w: number, d: number, z: number, scale: number, pose: MachinePose, dir: number): void {
  const lift: Record<MachinePose, number> = { work: 0, travel: 2, idle: 6, done: 10 };
  const top = z + 4;
  const reach = Math.round(5 * scale);
  const height = top + lift[pose];
  iso.box(x + w - 1, y + 1, 1, 1, top, height, { top: K.y, lit: K.Y, shadow: K.y, edge: K.o });
  // The stick reaches out along +x when working and folds back when parked.
  const out = pose === "work" ? reach : pose === "done" ? Math.round(reach * 0.6) : Math.round(reach * 0.3);
  iso.box(x + w - 1, y + 1, out, 1, height - 1, height, { top: K.y, lit: K.Y, shadow: K.y, edge: K.o });
  if (pose === "work") {
    iso.box(x + w - 1 + out, y + 1, 2, 2, z, z + 2, { top: K.A, lit: K.a, shadow: K.A, edge: K.o });
  }
  void dir;
}

/** mast is the crane's: a tower, and a jib that swings the other way. */
function mast(iso: IsoPix, x: number, y: number, w: number, z: number, dark: string, light: string, pose: MachinePose): void {
  const top = z + (pose === "done" ? 4 : 0);
  iso.box(x + 1, y + 1, w - 1, w - 1, z + 2, top, { top: light, lit: light, shadow: dark, edge: K.o });
  // The jib is what makes a crane a crane: long, thin and horizontal.
  const reach = pose === "work" ? 8 : 6;
  iso.box(x + 1, y + 1, reach, 1, top, top + 1, { top: K.a, lit: K.a, shadow: K.A, edge: K.o });
  if (pose === "work") {
    // A load on the hook, because a jib with nothing on it is a flagpole.
    iso.box(x + reach, y + 1, 1, 1, top - 5, top, { top: K.s, lit: K.s, shadow: K.s, edge: K.o });
  }
}

/** bucket is the loader's front scoop, raised when carrying. */
function bucket(iso: IsoPix, x: number, y: number, w: number, d: number, z: number, scale: number, pose: MachinePose): void {
  // Arms first, then the bucket on their end. Without the arms a loader and a
  // pile driver are both a lump on tracks, and the fleet loses the point of
  // having five kinds.
  const lift: Record<MachinePose, number> = { work: 3, travel: 0, idle: 2, done: 6 };
  const h = z + 2 + lift[pose];
  iso.box(x + w - 1, y + 1, Math.round(4 * scale), 1, z + 2, h, { top: K.y, lit: K.Y, shadow: K.y, edge: K.o });
  iso.box(x + w - 1, y + 1, 1, 1, h, h + 3, { top: K.A, lit: K.a, shadow: K.A, edge: K.o });
  iso.box(x + w - 1, y + 1, Math.round(2 * scale), d - 1, h - 1, h + 1, { top: K.A, lit: K.a, shadow: K.A, edge: K.o });
}

/** frame is the driver's mast, and hammer the weight that slides on it. */
function frame(iso: IsoPix, x: number, y: number, w: number, z: number, dark: string, light: string): void {
  // Two uprights and a head, not a slab: a pile driver is a *frame*, and open is
  // the only way to read that at this size. The first version passed zBottom
  // above zTop, which drew nothing at all and left the driver a mound.
  iso.box(x + 1, y + 1, 1, 1, z + 2, z, { top: light, lit: light, shadow: dark, edge: K.o });
  iso.box(x + w, y + 1, 1, 1, z + 2, z, { top: light, lit: light, shadow: dark, edge: K.o });
  iso.box(x + 1, y + 1, w, 1, z, z + 1, { top: light, lit: light, shadow: dark, edge: K.o });
}

function hammer(iso: IsoPix, x: number, y: number, scale: number, pose: MachinePose): void {
  // Up when parked, down when driving: the one motion a pile driver makes.
  const z = pose === "work" ? 2 : 9;
  const w = Math.round(3 * scale);
  iso.box(x + 2, y + 1, w, 2, z + 2, z + 4, { top: K.s, lit: K.s, shadow: K.d, edge: K.o });
}

/** blade is the dozer's, and it is the whole machine: a low wide wedge. */
function blade(iso: IsoPix, x: number, y: number, w: number, d: number, z: number, scale: number, pose: MachinePose): void {
  const lift: Record<MachinePose, number> = { work: 0, travel: 1, idle: 0, done: 2 };
  const h = z + lift[pose];
  // Wide and low, across the full depth: the blade is the dozer, and a stub
  // makes it the smallest machine in the fleet.
  iso.box(x + w, y - 1, Math.round(1 * scale) + 1, d + 2, h - 1, h + 3, { top: K.s, lit: K.s, shadow: K.d, edge: K.o });
  iso.box(x + w, y - 1, Math.round(1 * scale) + 1, d + 2, h + 3, h + 4, { top: K.A, lit: K.a, shadow: K.A, edge: K.o });
}
