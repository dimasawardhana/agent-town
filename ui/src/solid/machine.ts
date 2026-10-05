// The worker: what it is doing, how fast that reads, and how its gesture moves.
//
// The solid town's own copy of a vocabulary the flat renderer also holds, and the
// duplication is deliberate rather than careless. `art/worker.ts` and
// `art/machine.ts` belong to the frozen flat renderer (ADR-0024), so importing
// them would make frozen files load-bearing again; the numbers are **pinned by
// test** instead, the same way the projection and `STOREY` are. A copy that
// disagrees fails the suite rather than shipping two rhythms.
//
// **One machine kind for the spike.** Five kinds is TASK-107's roster; this is the
// excavator, chosen because its gesture is the one the flat renderer describes
// most concretely — a boom that rises and falls.

import type { Action, Site } from "../store";

/**
 * What a worker is doing, as the renderer needs it.
 *
 * **Two of these ten states are not on the wire, and that is the interesting
 * part.** The daemon sends eight `Action` values; `walk` and `idle` are derived
 * here, because the daemon knows nothing about a worker being between places or
 * having nothing to do — those are facts about the figure rather than about the
 * work. The flat renderer derives them the same way, by defaulting to `idle` and
 * overriding to `walk` while a journey is in flight, so the two renderers agree
 * about the vocabulary without either owning it.
 */
export type WorkerState = Action | "walk" | "idle";

/** The four silhouettes, in the order a reader meets them. */
export type Pose = "work" | "idle" | "travel" | "done";

/** Every pose, for the tests and the roster. */
export const POSES: readonly Pose[] = ["work", "idle", "travel", "done"];

/**
 * POSE_FOR folds the states onto four poses.
 *
 * **Which states share a pose is the claim the fleet makes about them**, which is
 * why this is written out rather than derived: reading and planning are both
 * parked and looking, and hammering, building, demolishing, commanding and testing
 * are all "engaged with something" — the most a silhouette can honestly say.
 *
 * Several states sharing a pose is exactly why the rhythm below has to carry the
 * difference. A `Record` rather than a partial map, so a state the daemon can emit
 * and the renderer cannot draw is a compile error.
 */
export const POSE_FOR: Record<WorkerState, Pose> = {
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

/** Every state, in the order the roster reads them. */
export const WORKER_STATES: readonly WorkerState[] = [
  "idle", "walk", "reading", "hammering", "building",
  "demolishing", "testing", "commanding", "planning", "celebrating",
];

/**
 * FRAME_MS is each state's cadence: the duration of each frame of its cycle.
 *
 * **This is the rhythm, and it is the whole reason the pose table is allowed to be
 * coarse.** Hammering is `[90, 90, 70, 110]` — a fast wind-up against a slower
 * settle, so the blow lands hard rather than swinging evenly like a metronome —
 * while testing is `[240, 240, 240, 240]`, an even four-beat. Both are the `work`
 * pose. What separates them on screen is the speed, which is what README.md means
 * by "each action has its own rhythm, so the town reads at a glance".
 *
 * Mirrored from the flat renderer's `art/worker.ts` and pinned by test.
 */
export const FRAME_MS: Record<WorkerState, number[]> = {
  idle: [700, 700],
  walk: [120, 120, 120, 120],
  reading: [420, 420, 420, 420],
  hammering: [90, 90, 70, 110],
  building: [110, 110, 80, 130],
  demolishing: [100, 100, 70, 140],
  testing: [240, 240, 240, 240],
  commanding: [160, 160, 160, 160],
  planning: [340, 340, 340, 340],
  celebrating: [130, 130, 200, 200],
};

/** How long one full cycle of a state lasts, in milliseconds. */
export function cycleMs(state: WorkerState): number {
  const frames = FRAME_MS[state];
  if (!frames || frames.length === 0) return 0;
  let total = 0;
  for (const ms of frames) total += ms;
  return total;
}

/**
 * Where a worker is in its cycle, as a fraction from 0 to 1.
 *
 * **Driven by the frame durations rather than by a clock**, so the uneven cadence
 * above survives: `hammering`'s four frames take 90, 90, 70 and 110 ms, so the
 * strike occupies less of the cycle than the wind-up and a glance reads a blow
 * rather than a pendulum. A linear `elapsed % period` would throw exactly that
 * away, which is the thing the cadence exists to say.
 */
export function cyclePhase(state: WorkerState, elapsedMs: number): number {
  const frames = FRAME_MS[state];
  const total = cycleMs(state);
  if (!frames || total <= 0) return 0;
  const into = ((elapsedMs % total) + total) % total;
  let acc = 0;
  for (let i = 0; i < frames.length; i++) {
    const next = acc + frames[i];
    if (into < next) return (i + (into - acc) / frames[i]) / frames.length;
    acc = next;
  }
  return 0;
}

/** The gesture part's pose, in the machine's own local terms. */
export interface Gesture {
  /** Boom angle, in radians, measured from the chassis' forward axis. */
  readonly swing: number;
  /** How far the boom's tip reaches, as the machine's own height. */
  readonly reach: number;
  /**
   * How much of the tracks' motion is showing.
   *
   * Separate from `swing` because a travelling machine moves its *body* and holds
   * its arm still — the arm is what does the work, and an arm swinging while the
   * machine drives is a machine doing two things at once.
   */
  readonly travel: number;
}

/**
 * gestureFor is the pose carried by the one part that can carry it.
 *
 * CONTEXT.md is explicit that the gesture "names the kind and carries the pose
 * entirely", so nothing else on the machine is allowed to change — which makes
 * this the whole of the animation, and makes it worth stating what each pose is
 * doing rather than tuning four magic numbers.
 *
 * `phase` is 0 to 1 through the cycle, from `cyclePhase`, so the *shape* of the
 * motion is here and its *speed* comes from the state. That split is what lets one
 * `work` gesture serve hammering and testing at their own rhythms.
 */
export function gestureFor(pose: Pose, phase: number): Gesture {
  const t = ((phase % 1) + 1) % 1;
  const tau = Math.PI * 2;

  switch (pose) {
    // A strike: the boom falls fast and comes back slowly, so the blow lands and
    // the recovery reads as recovery. The asymmetry is the whole gesture — a
    // sine wave would be a machine waving rather than one working.
    case "work": {
      const strike = t < 0.35 ? t / 0.35 : 1 - (t - 0.35) / 0.65;
      return { swing: -0.95 + strike * 0.85, reach: 0.55 + strike * 0.4, travel: 0 };
    }
    // Parked and looking: the boom settles very slowly, which is what makes an
    // agent that is thinking rather than acting still read as alive.
    case "idle":
      return { swing: -0.25 + Math.sin(t * tau) * 0.05, reach: 0.5, travel: 0 };
    // Stowed and driving. The body bobs rather than the arm, so a machine crossing
    // the town does not look like it is working on the way.
    case "travel":
      return { swing: -1.1, reach: 0.34, travel: Math.abs(Math.sin(t * tau * 2)) };
    // Finished: the boom is up, and the machine sways once per cycle. The only
    // pose that is allowed to look like a celebration, because it is one.
    case "done":
      return { swing: 0.5 + Math.sin(t * tau) * 0.18, reach: 0.85, travel: 0 };
  }
}

/**
 * A stable offset for a worker on a site, so two of them do not stand in one spot.
 *
 * Spread is hashed from the worker's own id rather than from its index, so a
 * worker keeps its place on a site across a rebuild — an index would make it jump
 * whenever a colleague arrived or left, and a figure that moves for no reason is
 * the town saying something false.
 *
 * FNV-1a, the same mixer the flat renderer uses to pick a machine kind: cheap,
 * well-spread on short ids, and already the project's habit for "a stable number
 * from a name".
 */
export function stableOffset(id: string): { x: number; y: number } {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const a = ((h >>> 0) % 1000) / 1000;
  const b = ((Math.imul(h, 2654435761) >>> 0) % 1000) / 1000;
  return { x: a - 0.5, y: b - 0.5 };
}

/**
 * standPoint is where a worker stands on a site.
 *
 * Scaled to the site rather than fixed, because the same spread has to serve a
 * 420-by-150 Yard holding a dozen workers and a 44-unit hut holding one. A fixed
 * spread was measured against a real Yard by the flat renderer and put six figures
 * on top of each other, which read as a single worker — so the scaling is not a
 * refinement, it is what makes multi-agent work legible at all (ADR-0004).
 *
 * The spread reaches just inside the plot, so a worker stands *on* its building
 * rather than beside or inside it.
 */
export function standPoint(site: Site, offset: { x: number; y: number }): { x: number; y: number } {
  const reach = 0.3;
  return {
    x: site.x + site.w * (0.5 + offset.x * reach),
    y: site.y + site.h * (0.5 + offset.y * reach),
  };
}

/** A point in world units. */
export interface WalkPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * walkMs is how long a journey takes.
 *
 * Distance-proportional with a floor: a worker crossing the town should not arrive
 * instantly, because "a worker walks before it works" is one of the things
 * README.md promises a reader sees, and a figure that teleports says the agent
 * acted without having gone anywhere. The floor keeps a short hop readable as a
 * walk rather than as a flicker.
 */
export function walkMs(from: WalkPoint, to: WalkPoint): number {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  return Math.max(320, distance * 9);
}

/**
 * pointAlong is the world position a journey has reached.
 *
 * `t` is clamped, so a caller that runs past the journey's end gets its
 * destination rather than an overshoot — a worker that arrives and keeps going
 * would walk through a building.
 */
export function pointAlong(from: WalkPoint, to: WalkPoint, t: number): WalkPoint {
  const k = Math.min(1, Math.max(0, t));
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
}
