// One machine, drawn from the kit, with a gesture that moves.
//
// The chassis is static and the boom is its own object, so the gesture is a
// rotation rather than a rebuild: a machine that re-cut its own geometry sixty
// times a second would spend the frame budget on work a transform does for
// nothing, and would churn GPU buffers while a live stream is also rebuilding the
// town.
//
// **The gesture is the whole animation.** CONTEXT.md is explicit that on a machine
// the gesture "names the kind and carries the pose entirely", so nothing else here
// moves: the undercarriage and the cab are fixed, and every difference a reader
// sees between two poses or two actions is the boom and its speed.

import * as THREE from "three";

import { extrude, type Foot, type SolidPart } from "./kit";
import { P } from "../art/palette";
import type { Gesture } from "./machine";

/** `#rrggbb` to the number three.js wants. */
const hex = (s: string): number => parseInt(s.replace("#", ""), 16);

/** The machine's own size, in world units — small against a building on purpose. */
const CHASSIS_W = 18;
const CHASSIS_D = 12;
const CHASSIS_H = 7;
/** Where the boom pivots, as a height above the ground. */
const PIVOT_Z = CHASSIS_H;
/** How long the boom is, which is what makes the gesture read at map scale. */
const BOOM_LEN = 22;

/** The colours a machine is painted, from the palette. */
const TRACK_COLOUR = hex(P.tunic[0]);
/** Twin colours that are load-bearing: ADR-0007 makes the tier a glance's job. */
const TIER_COLOUR = { chief: hex(P.helmetChief[2]), sub: hex(P.helmetSub[2]) };
const BOOM_COLOUR = hex(P.metal[2]);

/** A machine's parts, as plain triangle soups. */
export interface MachineParts {
  /** What it cannot move without. */
  readonly undercarriage: SolidPart;
  /** What stands on it, and what carries the tier. */
  readonly cab: SolidPart;
  /** The gesture. */
  readonly boom: SolidPart;
}

/**
 * machineParts builds the three parts of one machine.
 *
 * Three, and the division is the machine's own description: something it cannot
 * move without, something standing on it, and a gesture. Plain triangle soups
 * rather than meshes so this stays callable from a test with no WebGL — the same
 * reason the kit does.
 *
 * One kind for the spike. The five-kind roster is TASK-107, and it arrives here as
 * a table of gestures rather than as five copies of this function.
 */
export function machineParts(at: { x: number; y: number }): MachineParts {
  const foot: Foot = { cx: at.x, cy: at.y, w: CHASSIS_W, d: CHASSIS_D };
  return {
    undercarriage: extrude(foot, 0, CHASSIS_H * 0.55),
    cab: extrude(
      { cx: at.x, cy: at.y, w: CHASSIS_W * 0.62, d: CHASSIS_D * 0.72 },
      CHASSIS_H * 0.55,
      CHASSIS_H,
    ),
    // Built pointing along +y **in the machine's own frame** and centred on the
    // pivot, so the gesture is a rotation about the shoulder rather than about the
    // world origin. Built once, never re-cut.
    boom: extrude({ cx: 0, cy: BOOM_LEN / 2, w: 3.2, d: 2.6 }, 0, 3),
  };
}

/** soupGeometry turns a triangle soup into a flat-shaded buffer geometry. */
function soupGeometry(soup: SolidPart): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(soup.positions.slice(), 3));
  // Vertices are not shared, so the computed normals are per face — which is what
  // gives one tone per face rather than a rounded corner (ADR-0026 §1).
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * machineGroup builds one machine as a group whose boom can be aimed.
 *
 * The group is placed at the machine's **world** position and not a projected one:
 * the camera applies the projection, and a group placed at a projected coordinate
 * would be projected twice — the failure `solid.test.ts` exists to catch.
 *
 * The parts are built in the machine's own frame and the group is moved to where
 * it stands, which is what lets a walking worker reuse one geometry all the way
 * across the town instead of re-cutting it at every step.
 */
export function machineGroup(tier: "chief" | "sub"): { group: THREE.Group; pivot: THREE.Object3D } {
  const parts = machineParts({ x: 0, y: 0 });
  const group = new THREE.Group();

  // **The tier is carried by the cab's colour.** ADR-0007 makes the distinction a
  // glance's job, and colour is the fastest channel a reader has; the flat town
  // draws the same fact as a different helmet, so this is a translation rather
  // than a new idea.
  for (const [soup, colour] of [
    [parts.undercarriage, TRACK_COLOUR],
    [parts.cab, TIER_COLOUR[tier]],
    [parts.boom, BOOM_COLOUR],
  ] as const) {
    group.add(new THREE.Mesh(soupGeometry(soup), new THREE.MeshLambertMaterial({ color: colour })));
  }

  // The boom is the third child, held so the gesture can aim it without searching
  // the group for it every frame.
  const pivot = group.children[2];
  pivot.position.set(0, 0, PIVOT_Z);
  return { group, pivot };
}

/**
 * aimBoom points the boom for a gesture.
 *
 * A rotation about the machine's own x axis, so the boom swings in the plane the
 * camera reads. A boom swung about the vertical axis would travel across the
 * picture and read as the machine turning rather than working.
 */
export function aimBoom(pivot: THREE.Object3D, gesture: Gesture): void {
  pivot.rotation.x = gesture.swing;
  // The reach is a small lean rather than a second rotation: the boom's *length*
  // is what says how far it is reaching, and lengthening it per frame would mean
  // rescaling a geometry that is deliberately built once.
  pivot.scale.set(1, 0.65 + gesture.reach * 0.7, 1);
}
