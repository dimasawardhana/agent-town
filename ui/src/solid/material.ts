// The one material the solid town draws with, and the one rule in it.
//
// Its own module rather than a helper on `scene.ts` because two modules build
// geometry — the scene (buildings, ground, furniture) and `machineArt.ts` (the
// crews) — and `scene.ts` already imports `machineArt.ts`. Putting the rule on
// either one would make the other import its own importer. This file imports
// nothing but three.js, which is what lets both reach it.
//
// It is not part of `model.ts` on purpose: that module is the project's
// framework-free seam, asserted in `node --test` with no renderer, and it
// imports no three.js at all.

import * as THREE from "three";

/**
 * solidMaterial turns a colour into the material every solid surface is drawn
 * with — flat-shaded and **two-sided**.
 *
 * **Two-sided is required by the projection, and getting it wrong is silent.**
 * The camera's vertical frustum axis is negated so that a point raised in the
 * world moves *up* the screen, which is what the flat renderer's projection says
 * and what stops the town being drawn upside down. Negating one axis is a
 * reflection, and a reflection reverses the winding of every triangle as the
 * rasteriser sees it: a face that was counter-clockwise becomes clockwise.
 *
 * Under the front-face culling that `FrontSide` applies, that deleted exactly the
 * geometry with only one side to show. Measured: the field — two triangles, a
 * plane — drew **zero** pixels, and the closed buildings were drawn through their
 * own far faces, inside out. Nothing threw; the ground was simply gone.
 *
 * So the material is `DoubleSide`, which draws a face whichever way the
 * rasteriser sees it and is what a mirrored projection requires. Reversing every
 * triangle's winding instead was the alternative and was declined: it would put
 * the rule in the kit, whose whole contract is that it emits outward-facing
 * surfaces, and it would misdescribe what is happening — a reflection cannot be
 * undone by relabelling faces, only accommodated.
 *
 * The cost is real and accepted: no back-face culling, so roughly twice the
 * fragment work. The town is ~95 meshes and ~5,900 triangles, where that is not
 * the constraint.
 */
export function solidMaterial(colour: number, vertexColors = false): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color: colour, side: THREE.DoubleSide, vertexColors });
}

export function litWindowMaterial(colour: number, intensity: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    color: colour,
    emissive: colour,
    emissiveIntensity: intensity,
    side: THREE.DoubleSide,
  });
}
