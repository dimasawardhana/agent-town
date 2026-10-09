// Every triangle the kit emits faces outward, and every surface is drawn
// two-sided. Asserted without a renderer.

import * as THREE from "three";
import { strict as assert } from "node:assert";
import { test } from "node:test";

// **This is the test that would have caught the bugs that cost the most time
//
// The field was built as a quad and wound so its normal pointed down. Under
// `FrontSide` that does not look like a missing ground — it looks like working
// ground, because the town floats above nothing and the field simply stops
// occluding anything. It reported **0 drawn pixels** while every unit test passed.
//
// A machine standing on the Depot was then invisible for two further reasons, one
// of them a slab whose near wall projected across the whole viewport and one a
// prop 35 world units tall. Neither is a winding bug, but the *first* thing to rule
// out in a 3D renderer is "does this face point the way it should", and there was
// no test that could answer it.
//
// **Signed volume answers it exactly, and it is decidable from the triangles
// alone.** A closed surface with outward-facing windings encloses positive volume;
// wind it the other way and the volume comes out negative; mix the two and it comes
// out meaningless. So this file asserts two things per primitive: the volume is
// **positive**, and it is the volume the shape should actually have.

import { solidMaterial } from "../src/solid/material";
import { band, canopy, chamfer, extrude, gable, inset, lift, merge, parapet, roofOverhang, setBack, sweep, windowReveal, type Foot, type SolidPart, type SweepProfilePoint } from "../src/solid/kit";
import { rubbleFor, solidFor, type Rank } from "../src/solid/forms";
import { fieldRect, groundFor } from "../src/solid/ground";
import type { Layout, Site } from "../src/store";

/**
 * The volume a closed surface encloses, by the divergence theorem.
 *
 * `sum over triangles of a · (b × c) / 6`. **Positive means the windings face
 * outward**; negative means the surface is inside-out and will be culled away by
 * the front-face test. That sign is the whole point of this file.
 */
function signedVolume(p: SolidPart): number {
  const v = p.positions;
  let sum = 0;
  for (let i = 0; i < v.length; i += 9) {
    const ax = v[i], ay = v[i + 1], az = v[i + 2];
    const bx = v[i + 3], by = v[i + 4], bz = v[i + 5];
    const cx = v[i + 6], cy = v[i + 7], cz = v[i + 8];
    sum += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return sum / 6;
}

/** Every triangle's own normal, as a unit vector. */
function faceNormals(p: SolidPart): number[][] {
  const v = p.positions;
  const out: number[][] = [];
  for (let i = 0; i < v.length; i += 9) {
    const ux = v[i + 3] - v[i], uy = v[i + 4] - v[i + 1], uz = v[i + 5] - v[i + 2];
    const wx = v[i + 6] - v[i], wy = v[i + 7] - v[i + 1], wz = v[i + 8] - v[i + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const m = Math.hypot(nx, ny, nz) || 1;
    out.push([nx / m, ny / m, nz / m]);
  }
  return out;
}

const foot: Foot = { cx: 0, cy: 0, w: 40, d: 30 };

test("every primitive encloses positive volume, so nothing is inside-out", () => {
  // The sign test, over every operation the kit has. A negative volume here is a
  // primitive that will be culled on screen while every geometry test passes.
  const profile: readonly SweepProfilePoint[] = [
    { across: -0.5, height: 0 }, { across: 0, height: 0.4 }, { across: 0.5, height: 0 },
  ];
  const primitives: { name: string; part: SolidPart }[] = [
    { name: "extrude", part: extrude(foot, 0, 10) },
    { name: "setBack", part: setBack(foot, 0, 12, 0.1) },
    { name: "chamfer", part: chamfer(foot, 0, 10, 0.1) },
    { name: "windowReveal", part: windowReveal(foot, 2, 5, 0.05) },
    { name: "roofOverhang", part: roofOverhang(foot, 10, 0.4, 0.05) },
    { name: "parapet", part: parapet(foot, 10, 12, 0.05) },
    { name: "sweep", part: sweep(foot, 10, profile) },
    { name: "canopy", part: canopy(foot, 10, 12, 0.05) },
    { name: "band", part: band(foot, 0, 2, 1.5) },
    { name: "merge", part: merge([extrude(foot, 0, 5), extrude(foot, 5, 9)]) },
    { name: "lift", part: lift(extrude(foot, 0, 4), 7) },
  ];
  for (const { name, part } of primitives) {
    const vol = signedVolume(part);
    assert.ok(
      vol > 0,
      `${name} encloses ${vol.toFixed(1)}, which is negative or zero — it is inside-out and will be culled`,
    );
  }
});

test("a box encloses exactly its own volume", () => {
  // The magnitude, not just the sign: a winding that is right in sign but wrong in
  // order would give a plausible-looking number. An `extrude` should give exactly
  // width times depth times height.
  for (const [w, d, z0, z1] of [[40, 30, 0, 10], [44, 44, 0, 20], [100, 86, -3.5, 0]] as const) {
    const vol = signedVolume(extrude({ cx: 7, cy: -4, w, d }, z0, z1));
    // `Math.abs` on the height: `extrude` does not reorder its arguments, so a
    // caller that passes them the other way gets a negative volume and should.
    assert.ok(
      Math.abs(vol - w * d * (z1 - z0)) < 1e-6,
      `a ${w}x${d}x${z1 - z0} box encloses ${vol}, not ${w * d * (z1 - z0)}`,
    );
  }
});

test("extrude's winding is not silently corrected by its argument order", () => {
  // A prism built downward must come out inside-out rather than being quietly
  // fixed, because the sign is the caller's signal that it swapped them.
  assert.ok(signedVolume(extrude(foot, 10, 0)) < 0, "a downward extrude was silently corrected");
  assert.ok(signedVolume(extrude(foot, 0, 10)) > 0, "an upward extrude is not outward-facing");
});

test("the roof is closed and faces outward", () => {
  // A gable is the one primitive whose winding is not obvious by construction: it
  // has two slopes, two gable ends and an underside, and one of the five being
  // inverted is a hole you can see through rather than a face you cannot see.
  const roof = gable(foot, 10, 0.4);
  assert.ok(signedVolume(roof) > 0, "the roof is inside-out");
  // Five quads' worth of triangles at most: two slopes, two ends, one underside.
  assert.equal(roof.positions.length / 9, 8, "the roof is not two slopes, two ends and an underside");

  // And its slopes must face *up* — the sign of the enclosed volume cannot see
  // that, because a roof with both slopes inverted still bounds positive volume if
  // its ends are right.
  const upward = faceNormals(roof).filter((n) => n[2] > 0.2).length;
  assert.ok(upward >= 2, `only ${upward} roof faces point upward — the slopes face the ground`);
});

test("every part of every rank encloses positive volume", () => {
  // The primitives are the ingredients; this is the finished building. A form that
  // inverted a part on the way in would pass the primitive tests and fail here.
  const site: Site = {
    id: "building:x", kind: "building", label: "x", path: "x", files: 1, bytes: 4096,
    depth: 1, floors: 3, x: 0, y: 0, w: 58, h: 58,
  };
  for (const rank of ["planned", "foundation", "framed", "walled", "roofed", "glazed", "doored", "completed"] as Rank[]) {
    for (const part of solidFor(site, rank)) {
      const vol = signedVolume(part.geometry);
      assert.ok(
        vol > 0,
        `${part.name} at ${rank} encloses ${vol.toFixed(1)} — a part of the building is inside-out`,
      );
    }
  }
});

test("the rubble pile encloses positive volume", () => {
  // It is drawn from the same palette of primitives as the building; if its
  // chunks were inside-out, the pile would shade dark and read as a hole.
  const site: Site = {
    id: "building:x", kind: "building", label: "x", path: "x", files: 1, bytes: 4096,
    depth: 1, floors: 3, x: 0, y: 0, w: 58, h: 58,
  };
  for (const rank of ["foundation", "framed", "walled", "roofed", "glazed", "doored", "completed"] as Rank[]) {
    const pile = rubbleFor(site, rank);
    assert.ok(pile.positions.length > 0, `${rank} drew no rubble to test`);
    const vol = signedVolume(pile);
    assert.ok(vol > 0, `the rubble at ${rank} encloses ${vol.toFixed(1)} — the pile is inside-out`);
  }
});

test("profile sweep closes a footprint-relative section", () => {
  const profile: readonly SweepProfilePoint[] = [
    { across: -0.5, height: 0 },
    { across: 0, height: 0.4 },
    { across: 0.5, height: 0 },
  ];
  const roof = sweep({ cx: 0, cy: 0, w: 44, d: 44 }, 10, profile);
  assert.equal(roof.positions.length / 9, 8, "the sweep is not closed");
  assert.ok(signedVolume(roof) > 0, "the sweep is inside-out");
  assert.throws(() => sweep({ cx: 0, cy: 0, w: 44, d: 44 }, 10, [{ across: 1, height: 0 }, { across: 0, height: 0 }, { across: -0.5, height: 0 }]));
});

test("the ground is not inside-out, and the field is not a slab", () => {
  // Both ground defects, asserted together because they were the same afternoon's
  // work and each cost real time to find.
  const layout: Layout = {
    width: 400, height: 300,
    sites: [{ id: "yard", kind: "yard", label: "Yard", files: 0, bytes: 0, depth: 0, floors: 1, x: 10, y: 10, w: 200, h: 100 }],
    districts: [{ name: "ui", kind: "source", x: 0, y: 0, w: 380, h: 280 }],
  };
  const { patches, kerbs } = groundFor(layout);

  // The field: **a plane, so zero volume is correct** and a non-zero one means
  // somebody made it a slab again — which projects its near wall across the view.
  const field = patches[0]!;
  assert.equal(
    signedVolume(field.geometry),
    0,
    "the field has volume, so it is a slab again",
  );

  // Everything else is a closed solid and must face outward.
  for (const p of patches.slice(1)) {
    assert.ok(signedVolume(p.geometry) > 0, `the ${p.kind} patch is inside-out`);
  }
  for (const k of kerbs) {
    assert.ok(signedVolume(k.geometry) > 0, "a kerb is inside-out");
  }
});

test("the field faces the sky", () => {
  // **The sign of a plane's volume cannot answer this** — a plane encloses nothing
  // either way, so `signedVolume` is 0 whichever way it is wound. The face normal
  // is the only thing that can, and getting it wrong is what made the ground
  // report 0 drawn pixels while it looked fine in every assertion.
  const layout: Layout = {
    width: 400, height: 300, sites: [],
    districts: [{ name: "ui", kind: "source", x: 0, y: 0, w: 380, h: 280 }],
  };
  const field = groundFor(layout).patches[0]!;
  for (const n of faceNormals(field.geometry)) {
    assert.ok(
      n[2] > 0.99,
      `a field triangle faces (${n.map((v) => v.toFixed(2)).join(", ")}) — its normal is not straight up, so it is culled`,
    );
  }
  assert.equal(field.geometry.positions.length / 9, 2, "the field is not a quad");
});

test("the field the camera frames is the field that gets drawn", () => {
  // A small check with a real consequence: `fieldRect` is sized from the layout's
  // own extent, so a field drawn from it always covers the town the camera fits.
  const layout: Layout = { width: 1044, height: 634, sites: [], districts: [] };
  const r = fieldRect(layout);
  assert.ok(r.w > layout.width && r.d > layout.height, "the field does not reach past the town");
  assert.equal(r.cx, layout.width / 2);
  assert.equal(r.cy, layout.height / 2);
});

test("the material draws both sides, which the mirrored projection requires", () => {
  // **A one-line rule that the whole town depends on, and nothing asserted it.**
  //
  // The camera's vertical frustum axis is negated so that a point raised in the
  // world moves *up* the screen — without it the town is drawn upside down. That
  // negation is a reflection, and a reflection reverses the winding of every
  // triangle as the rasteriser sees it, so under `FrontSide` a face that was
  // counter-clockwise gets culled.
  //
  // Measured when it was `FrontSide`: the field — two triangles, a plane, with no
  // second side to fall back on — drew **zero** pixels, and every closed building
  // was drawn through its own far faces. Nothing threw and nothing logged.
  const m = solidMaterial(0x123456);
  assert.equal(
    m.side,
    THREE.DoubleSide,
    "the material culls back faces, so a mirrored projection deletes the field and inverts the buildings",
  );
  // And it carries the colour it was asked for, so this cannot pass by returning a
  // blank material.
  assert.equal(m.color.getHex(), 0x123456, "the material lost its colour");
  m.dispose();
});
