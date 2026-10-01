// The vocabulary a machine is built from.
//
// This used to be the figure: a person, drawn in ten animations, and the largest
// single thing in the atlas at 76 cels. The fleet replaced it with a machine per
// agent, and the drawing is gone — a 20-pixel person was the least legible thing
// in a town whose buildings have eleven archetypes and five materials.
//
// What stays is the three things the fleet still needs, and they are vocabulary
// rather than art: **which** work an agent is doing, **how fast** that work reads
// as happening, and whether the machine driving it is the session's chief or
// something it spawned (ADR-0007). `FRAME_MS` in particular is still the
// cadence: a machine holds `work` rather than animating `hammering`, but it
// keeps the strike-and-settle rhythm of the action it stands for.

export type WorkerState = "idle" | "walk" | "reading" | "hammering" | "building" | "demolishing" | "testing" | "commanding" | "planning" | "celebrating";

/**
 * FRAME_MS is each animation's per-frame duration.
 *
 * Walk is 120ms — a 480ms cycle, the reference's range for a walk, fast enough
 * that a worker crossing the town does not look like it is strolling. Hammering
 * is deliberately faster and uneven: 90ms of wind-up against 70ms of strike, so
 * the blow lands hard rather than swinging evenly like a metronome.
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

/**
 * Tier is who is driving: the session's own chief, or something it spawned.
 *
 * Load-bearing and unchanged by the cutover — ADR-0007 makes the helmet
 * distinction the way a glance separates the two, and a machine is no less in
 * need of that than a figure was.
 */
export type Tier = "chief" | "sub";
