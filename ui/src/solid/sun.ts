// The sun: a real light, fixed in the world, whose direction depends on the hour.
//
// **This is the ADR-0026 decision in code, and the two halves of it are the two
// things worth reading here.**
//
// *The sun is fixed in the world and never turns with the town.* Its direction is
// built from `CAMERA_BASIS`, and that basis is derived from the projection rather
// than from the camera's current orientation — so it is a constant, and a turn
// moves the reader without moving the light. That is the deliberate divergence
// from the flat renderer, where the key is pinned to the picture's top-left.
//
// *The light is real.* Materials supply a base tone and the sun supplies
// everything above and below it, which is why the palette's role narrows here to
// base colours (ADR-0026 §1).
//
// TASK-113 owns the final rig — fog, bloom, contact shadows and the exact key and
// fill. What is here is the direction and the hour, because two of TASK-104's
// criteria are about nothing else.

import { P } from "../art/palette";
import type { DayPhase } from "../daylight";
import { CAMERA_BASIS } from "./model";

/** A light: where it sits, how hard it shines, and what colour it is. */
export interface Sun {
  /**
   * A unit vector pointing **from the town toward the sun**.
   *
   * Toward, not from, because that is the direction a light's position is placed
   * along — and holding it this way round means the sign is decided once here
   * rather than at each of the three call sites that place a light.
   */
  readonly toSun: readonly number[];
  /** Relative strength across the day. */
  readonly intensity: number;
  /** The light's colour, from the palette's own sky keys. */
  readonly colour: string;
}

/** Scale a vector to unit length, so an intensity is the only thing that varies. */
function unit(v: readonly number[]): number[] {
  const m = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / m, v[1] / m, v[2] / m];
}

/** Combine basis vectors into a world direction, so "high" and "left" mean something. */
function fromBasis(up: number, left: number, toward: number): number[] {
  return unit([
    CAMERA_BASIS.y[0] * up - CAMERA_BASIS.x[0] * left + CAMERA_BASIS.z[0] * toward,
    CAMERA_BASIS.y[1] * up - CAMERA_BASIS.x[1] * left + CAMERA_BASIS.z[1] * toward,
    CAMERA_BASIS.y[2] * up - CAMERA_BASIS.x[2] * left + CAMERA_BASIS.z[2] * toward,
  ]);
}

/**
 * The sun at each phase, in the camera's own frame: how high it sits, how far to
 * the reader's left, and how much it leans toward the reader.
 *
 * **The three are offset on purpose and the offsets are the point.** A sun that
 * stayed at one bearing and only changed height would lengthen shadows without
 * moving them, and a shadow that never moves is a shadow the flat town already
 * draws — it bakes a `P.grass[0]` footprint under every building. What makes a
 * real light worth its cost is that dusk falls from the west and night comes from
 * somewhere else, so a reader can see the hour in the shade as well as in the sky.
 *
 * `toward` is small in all three: a sun directly behind the reader lights every
 * face it can see equally, which flattens exactly the form the light was bought
 * for. The key stays off-axis.
 */
const BEARING: Record<DayPhase, { up: number; left: number; toward: number }> = {
  // High and well to the left, so lit and shadowed faces are both visible.
  day: { up: 0.78, left: 0.52, toward: 0.14 },
  // Low and hard over from the left — the hour that makes long shadows.
  dusk: { up: 0.2, left: 0.94, toward: 0.1 },
  // Low, and swung round to the other side, so the town is lit from a different
  // quarter than it was at dusk. Dim: this is a town after dark.
  night: { up: 0.26, left: -0.9, toward: 0.12 },
};

/**
 * sunFor is the light at an hour.
 *
 * Direction, strength and colour all move together, because a phase that changed
 * only one of them would read as a filter over the same light rather than as a
 * different hour. Dusk is the default phase (the palette was built for it) and its
 * key is the palette's own horizon gold — the warm light the rest of the town's
 * colours were chosen against.
 */
export function sunFor(phase: DayPhase): Sun {
  const b = BEARING[phase];
  const toSun = fromBasis(b.up, b.left, b.toward);

  switch (phase) {
    case "day":
      // Overhead and near-white: the hour with the least to say, which is why it
      // is not the default.
      return { toSun, intensity: 2.6, colour: "#fff4e2" };
    case "night":
      // Dim and blue. The zenith key as a *light* is almost black, which is what a
      // town after dark is lit by — the windows are doing the work, not the sky.
      return { toSun, intensity: 0.5, colour: P.skyZenith };
    default:
      return { toSun, intensity: 2.2, colour: P.skyGlow };
  }
}

/** The ambient fill, so a shadowed face is lit by the sky rather than black. */
export function fillFor(phase: DayPhase): { intensity: number; colour: string } {
  switch (phase) {
    case "day":
      return { intensity: 0.62, colour: P.skyHaze };
    case "night":
      return { intensity: 0.3, colour: P.skyNear };
    default:
      return { intensity: 0.48, colour: P.skyMid };
  }
}
