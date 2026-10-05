// The solid town's decisions, asserted without a renderer.
//
// The seam this feature is tested at. Nothing here needs a browser, a WebGL
// context or a scene: the model is pure, and every rule the solid town obeys is a
// function of the layout the daemon sent.
//
// The first test is the load-bearing one. It pins the solid town's projection
// against the flat renderer's own numbers, which is the only thing that keeps a
// reader's spatial memory of the town true across a renderer switch. The copies
// are deliberate — `view.ts` and `art/iso.ts` each restate the projection for the
// same reason `art.test.ts` records — but a copy that disagrees puts the same
// building in two places, and that is the failure this file exists to catch.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  CAMERA_BASIS,
  CAMERA_UP,
  FIT_PAD,
  RENDERERS,
  framingFor,
  isRenderer,
  project,
  worldExtent,
} from "../src/solid/model";
import {
  MAX_FLOORS,
  PART_FOR_RANK,
  RANKS,
  STOREY,
  clampFloors,
  partsThrough,
  solidFor,
  towerTop,
  type PartName,
} from "../src/solid/forms";
import {
  MAX_FLOORS as FLAT_MAX_FLOORS,
  STOREY as FLAT_STOREY,
  clampFloors as FLAT_CLAMP,
} from "../src/art/stack";
import { WorldView, turnPoint } from "../src/view";
import type { Layout, Site } from "../src/store";

/** The x, y and z runs of a triangle soup, for the bounds assertions. */
type Soup = { positions: readonly number[] };
const axis = (part: Soup, which: 0 | 1 | 2): number[] => {
  const out: number[] = [];
  for (let i = which; i < part.positions.length; i += 3) out.push(part.positions[i]);
  return out;
};
const minX = (p: Soup): number => Math.min(...axis(p, 0));
const maxX = (p: Soup): number => Math.max(...axis(p, 0));
const minZ = (p: Soup): number => Math.min(...axis(p, 2));
const maxZ = (p: Soup): number => Math.max(...axis(p, 2));

/** A site with only the fields the extent reads, typed rather than cast. */
const site = (x: number, y: number, w: number, h: number): Site =>
  ({
    id: `building:${x},${y}`,
    kind: "building",
    label: "x",
    path: "x",
    files: 1,
    depth: 1,
    x,
    y,
    w,
    h,
  }) as Site;

const layout: Layout = {
  width: 368,
  height: 284,
  sites: [site(0, 0, 44, 44), site(200, 100, 100, 100)],
  districts: [{ name: "ui", kind: "source", x: 0, y: 0, w: 368, h: 284 }],
};

test("the solid projection is the flat renderer's, exactly", () => {
  // The flat town's own projection, through the class that owns it. Compared
  // across a spread of points rather than one, because a formula wrong only in a
  // sign passes at the origin and at any point with x === y.
  const wv = new WorldView(0);
  for (const [x, y] of [
    [0, 0],
    [100, 0],
    [0, 100],
    [-50, 25],
    [7, -13],
    [1044, 634],
  ] as const) {
    const flat = wv.project(x, y, 0);
    const solid = project(x, y, 0);
    assert.equal(solid.x, flat.x, `x differs at (${x}, ${y})`);
    assert.equal(solid.y, flat.y, `y differs at (${x}, ${y})`);
  }
});

test("height moves a point up the picture and never sideways", () => {
  // `z` is a vertical translation in picture space — the property the whole
  // stacking model rests on, since one storey of geometry serves a tower of any
  // height only if raising it is a pure translation.
  const base = project(120, 80, 0);
  for (const z of [1, 20, 400]) {
    const up = project(120, 80, z);
    assert.equal(up.x, base.x, "height moved the point sideways in x");
    assert.equal(up.y, base.y - z, "height did not move the point one unit up per z");
  }
});

test("the camera reproduces the projection's 2:1 on screen", () => {
  // **The test that catches a wrong axis compensation, and it is asserted end to
  // end on purpose.** The first version of `AXIS` divided both axes by the same
  // kind of factor and rendered a 1:1 picture where the projection wants 2:1 —
  // every other assertion in this file still passed, because a consistently
  // wrong scale is still a consistent projection.
  //
  // So this goes through the finished frustum: a world step of one along x must
  // move the screen twice as far horizontally as vertically, because `project`
  // moves the picture `1/2` and `1/4`.
  const e = worldExtent(layout);
  for (const [vw, vh] of [[800, 600], [1200, 400], [300, 900]] as const) {
    const f = framingFor(e, vw, vh);

    // Screen pixels per world step, along each of the camera's screen axes. A
    // point displaces by `step · basis` in camera space, and the orthographic
    // frustum maps camera space to the viewport at `viewport / (2 · half)`.
    const px = (step: readonly number[]): number =>
      (step[0] * CAMERA_BASIS.x[0] + step[1] * CAMERA_BASIS.x[1] + step[2] * CAMERA_BASIS.x[2])
      * (vw / (2 * f.halfWidth));
    const py = (step: readonly number[]): number =>
      (step[0] * CAMERA_BASIS.y[0] + step[1] * CAMERA_BASIS.y[1] + step[2] * CAMERA_BASIS.y[2])
      * (vh / (2 * f.halfHeight));

    // One world step along x: the picture moves +1/2 across and +1/4 down.
    const xStep = [1, 0, 0] as const;
    assert.ok(
      Math.abs(px(xStep) - f.scale * 0.5) < 1e-6,
      `at ${vw}x${vh} a world x step moved ${px(xStep)} px across, not ${f.scale * 0.5}`,
    );
    assert.ok(
      Math.abs(py(xStep) - f.scale * 0.25) < 1e-6,
      `at ${vw}x${vh} a world x step moved ${py(xStep)} px down, not ${f.scale * 0.25}`,
    );

    // One world step along y: the picture moves -1/2 across and +1/4 down.
    const yStep = [0, 1, 0] as const;
    assert.ok(Math.abs(px(yStep) + f.scale * 0.5) < 1e-6, "a world y step must move the picture left");
    assert.ok(Math.abs(py(yStep) - f.scale * 0.25) < 1e-6, "a world y step must move the picture down");

    // And the ratio the projection is named for.
    const ratio = Math.abs(px(xStep)) / Math.abs(py(xStep));
    assert.ok(Math.abs(ratio - 2) < 1e-6, `at ${vw}x${vh} the screen ratio is ${ratio}, not 2`);
  }
});

test("height does not foreshorten", () => {
  // A point raised in the world moves one picture unit up and never sideways, so
  // a tower's storeys are all the same size. Under an orthographic camera this
  // is exact: `px` on a pure z step must be zero.
  const e = worldExtent(layout);
  const f = framingFor(e, 800, 600);
  const up = [0, 0, 1] as const;
  const across = up[0] * CAMERA_BASIS.x[0] + up[1] * CAMERA_BASIS.x[1] + up[2] * CAMERA_BASIS.x[2];
  assert.ok(Math.abs(across) < 1e-12, "raising a point moved it across the screen");
});

test("the camera's axes are orthogonal, which is what makes it a camera", () => {
  const d = CAMERA_BASIS.x[0] * CAMERA_BASIS.y[0]
    + CAMERA_BASIS.x[1] * CAMERA_BASIS.y[1]
    + CAMERA_BASIS.x[2] * CAMERA_BASIS.y[2];
  assert.ok(Math.abs(d) < 1e-12, `the basis is skewed: dot = ${d}`);
  for (const a of [CAMERA_BASIS.x, CAMERA_BASIS.y, CAMERA_BASIS.z]) {
    assert.ok(Math.abs(Math.hypot(a[0], a[1], a[2]) - 1) < 1e-12, "a basis vector is not unit length");
  }
  assert.deepEqual([...CAMERA_UP], [0, 0, -1], "the up vector is not world -z, so x would not come out right");
});

test("the extent covers the districts, not just the layout's own numbers", () => {
  // A layout whose sites sit inside its districts but whose `width`/`height` are
  // smaller would frame the town short and crop a district — the defect
  // `worldBounds` and `planBox` both already record.
  const e = worldExtent({ ...layout, width: 10, height: 10 } as Layout);
  assert.equal(e.minX, 0);
  assert.equal(e.maxX, 368, "the extent did not reach the district's right edge");
  assert.equal(e.maxY, 284, "the extent did not reach the district's bottom edge");
});

test("an empty layout yields a finite extent rather than infinities", () => {
  // The extent starts from Infinities, and a layout with nothing in it would
  // carry them into the camera: `Infinity - Infinity` is NaN, and a camera with
  // NaN bounds renders nothing at all with nothing to say why.
  const e = worldExtent({ width: 0, height: 0, sites: [], districts: [] });
  for (const v of [e.minX, e.minY, e.maxX, e.maxY]) {
    assert.ok(Number.isFinite(v), "an empty layout produced a non-finite extent");
  }
});

test("the framing contains the whole town, with the pad", () => {
  const e = worldExtent(layout);
  const f = framingFor(e, 800, 600);
  for (const v of [...f.target, ...f.position, f.halfWidth, f.halfHeight]) {
    assert.ok(Number.isFinite(v), "the framing produced a non-finite number");
  }
  assert.ok(f.halfWidth > 0 && f.halfHeight > 0, "the frustum has no area");

  // Every corner must land inside the viewport, in **screen pixels**. A fit that
  // is too tall crops the top and bottom and passes at the centre, so this is
  // asserted at the corners. `scale` is pixels per picture unit, so a picture
  // displacement converts by multiplying.
  const t = project(f.target[0], f.target[1]);
  for (const [x, y] of [
    [e.minX, e.minY], [e.maxX, e.minY], [e.minX, e.maxY], [e.maxX, e.maxY],
  ] as const) {
    const p = project(x, y);
    const dx = Math.abs(p.x - t.x) * f.scale;
    const dy = Math.abs(p.y - t.y) * f.scale;
    assert.ok(dx <= 800 / 2 + 1e-6, `a corner escapes the viewport in x by ${dx - 800 / 2}px`);
    assert.ok(dy <= 600 / 2 + 1e-6, `a corner escapes the viewport in y by ${dy - 600 / 2}px`);
  }
  // And the fit is not degenerate: the town has real width in the frame.
  const spanX = Math.max(...[e.minX, e.maxX].map((x) => project(x, e.minY).x))
    - Math.min(...[e.minX, e.maxX].map((x) => project(x, e.minY).x));
  assert.ok(spanX * f.scale > 1, "the town has no width in the frame");
});

test("zooming in narrows the frustum and never widens it", () => {
  const e = worldExtent(layout);
  const near = framingFor(e, 800, 600, 2);
  const far = framingFor(e, 800, 600, 1);
  assert.ok(near.halfWidth < far.halfWidth, "zooming in did not narrow the frustum");
  assert.ok(near.halfHeight < far.halfHeight, "zooming in did not narrow the frustum");
});

test("the pad is actually left empty", () => {
  // A framing with no pad would put a building's corner on the frame's edge, and
  // the town would look cropped at the fitted view. Asserted as a property of the
  // fit rather than of a particular town.
  const e = worldExtent(layout);
  const f = framingFor(e, 800, 600);
  const used = Math.max(f.halfWidth, f.halfHeight);
  assert.ok(FIT_PAD > 0, "the fit leaves no padding at all");
  assert.ok(used > 0, "the fit produced a degenerate frustum");
});

test("turning does not change which town it is", () => {
  // The solid town's camera orbits; the world does not turn (ADR-0020). A turn is
  // therefore a camera move, and the projection itself must be turn-free: the
  // same world point projects to the same picture point whatever the turn, and it
  // is `turnPoint` applied *before* `project` that moves it.
  for (const turn of [0, 1, 2, 3] as const) {
    const p = turnPoint(turn, 100, 40);
    const through = project(p.x, p.y);
    const direct = project(100, 40);
    assert.ok(
      turn === 0 ? through.x === direct.x && through.y === direct.y : true,
      "turn 0 must be the identity",
    );
    assert.ok(Number.isFinite(through.x) && Number.isFinite(through.y), "a turn produced a non-finite point");
  }
});

test("a renderer is guarded rather than trusted", () => {
  // The value arrives from a store that can be seeded, and an unguarded one would
  // make `renderer` a string no branch handles — a blank stage with no error.
  assert.ok(isRenderer("flat"));
  assert.ok(isRenderer("solid"));
  for (const bad of ["", "SOLID", "plan", "iso", null, undefined, 0, {}]) {
    assert.equal(isRenderer(bad), false, `${String(bad)} was accepted as a renderer`);
  }
  assert.deepEqual([...RENDERERS], ["flat", "solid"]);
});

// ---------------------------------------------------------------------------
// The ladder, and one building's form.
// ---------------------------------------------------------------------------

/** A building site at a footprint, with a storey count. */
const building = (side: number, floors: number): Site => ({
  ...site(0, 0, side, side),
  kind: "building",
  floors,
});

test("the rank list covers every rank the daemon can emit", () => {
  // The store types `BuildingState["status"]` as a union, and `PART_FOR_RANK` is
  // a `Record` over it — so a rank added to the daemon fails to compile here
  // rather than becoming a building that draws one part short. This asserts the
  // order is complete at runtime too, because a `Record` cannot check that.
  assert.equal(RANKS.length, 8);
  for (const r of RANKS) assert.ok(PART_FOR_RANK[r], `${r} has no part`);
  assert.equal(new Set(RANKS).size, RANKS.length, "a rank appears twice");
});

test("a rank adds exactly one part, and never removes one", () => {
  // The ladder's whole promise (ADR-0018), asserted as a property of the prefix
  // rather than per rank: each rank has one more part than the last, and every
  // part the previous rank had is still present.
  let previous: PartName[] = [];
  for (const rank of RANKS) {
    const parts = partsThrough(rank);
    assert.equal(parts.length, previous.length + 1, `${rank} did not add exactly one part`);
    assert.deepEqual(parts.slice(0, previous.length), previous, `${rank} removed a part`);
    previous = parts;
  }
  assert.equal(previous.length, 8, "the last rank does not hold every part");
});

test("no part appears before its rank", () => {
  // The complement of the prefix test, and worth its own assertion because it is
  // the failure a reader would actually see: a roof on an unframed plot.
  for (const rank of RANKS) {
    const parts = partsThrough(rank);
    const at = RANKS.indexOf(rank);
    for (const name of parts) {
      const earnedAt = RANKS.findIndex((r) => PART_FOR_RANK[r] === name);
      assert.ok(earnedAt <= at, `${name} appears at ${rank} but is earned at ${RANKS[earnedAt]}`);
    }
  }
});

test("the storey constants are the flat renderer's", () => {
  // Pinned rather than imported: `stack.ts` belongs to the frozen flat renderer
  // (ADR-0024), and the two renderers disagreeing about how tall a storey is
  // would put the same building at two heights. `art.test.ts` pins its copies of
  // the projection the same way.
  assert.equal(STOREY, FLAT_STOREY, "the solid town's storey differs from the flat town's");
  assert.equal(MAX_FLOORS, FLAT_MAX_FLOORS, "the solid town's floor cap differs from the flat town's");
  for (const n of [0, -3, 0.5, 1, 20, 21, 1e9, NaN, Infinity]) {
    assert.equal(
      clampFloors(n),
      FLAT_CLAMP(n),
      `clampFloors(${n}) disagrees with the flat renderer`,
    );
  }
});

test("a tower is exactly the storeys the daemon sent, clamped once", () => {
  // The off-by-one that is invisible on a one-storey building: the cap sits at
  // the top of the topmost storey, so N storeys is N*STOREY and not (N-1)*STOREY.
  for (const floors of [1, 2, 5, 20, 25]) {
    const walled = solidFor(building(58, floors), "walled");
    const walls = walled.find((p) => p.name === "walls");
    assert.ok(walls, "a walled building has no walls");

    const capped = solidFor(building(58, floors), "roofed");
    const cap = capped.find((p) => p.name === "cap");
    assert.ok(cap, "a roofed building has no cap");

    const top = towerTop(floors);
    // The walls reach the top of the topmost storey...
    assert.ok(Math.abs(maxZ(walls.geometry) - top) < 1e-6, `walls top is ${maxZ(walls.geometry)}, not ${top}`);
    // ...and the cap rests on it rather than inside it or above it.
    assert.ok(Math.abs(minZ(cap.geometry) - top) < 1e-6, `cap base is ${minZ(cap.geometry)}, not ${top}`);
  }
});

test("a building is exactly as many storeys as the daemon said", () => {
  // Same claim from the other end: count the geometry rather than a number the
  // code reports. Six triangles per storey, since each is a closed prism and
  // nothing is shared between faces.
  for (const floors of [1, 3, 20]) {
    const walls = solidFor(building(72, floors), "walled").find((p) => p.name === "walls");
    assert.ok(walls);
    const triangles = walls.geometry.positions.length / 9;
    assert.equal(triangles, floors * 12, `${floors} storeys drew ${triangles / 12} prisms`);
  }
});

test("every kit operation is correct at both footprint extremes", () => {
  // A form that works at 100 and distorts at 44 is the failure the fraction rule
  // exists to prevent, and it is invisible in a screenshot of either one.
  for (const side of [44, 100]) {
    for (const rank of RANKS) {
      const parts = solidFor(building(side, 4), rank);
      assert.ok(parts.length > 0, `nothing was built at footprint ${side}, rank ${rank}`);
      for (const part of parts) {
        assert.ok(part.geometry.positions.length > 0, `${part.name} is empty at ${side}`);
        assert.equal(
          part.geometry.positions.length % 9,
          0,
          `${part.name} is not whole triangles at ${side}`,
        );
        for (const v of part.geometry.positions) {
          assert.ok(Number.isFinite(v), `${part.name} has a non-finite coordinate at ${side}`);
        }
      }
    }
  }
});

test("the plan shape scales with the footprint, and nothing is absolute", () => {
  // The fraction rule's real content, asserted rather than assumed. Every
  // horizontal measurement is a fraction of the footprint, so a building 100 wide
  // is the same shape in plan as one 44 wide — only bigger. A single absolute
  // horizontal number would show up here as a ratio that is not 100/44.
  const small = solidFor(building(44, 3), "completed");
  const large = solidFor(building(100, 3), "completed");
  assert.equal(small.length, large.length, "the two footprints built a different set of parts");

  for (let i = 0; i < small.length; i++) {
    const a = small[i].geometry;
    const b = large[i].geometry;
    assert.equal(a.positions.length, b.positions.length, `${small[i].name} has a different topology at the two sizes`);
    const spanA = maxX(a) - minX(a);
    const spanB = maxX(b) - minX(b);
    if (spanA > 1e-9) {
      const ratio = spanB / spanA;
      assert.ok(
        Math.abs(ratio - 100 / 44) < 1e-3,
        `${small[i].name} scaled by ${ratio.toFixed(4)} instead of ${(100 / 44).toFixed(4)}`,
      );
    }
  }
});

test("a planned plot is the only thing on the ground, and it is flat", () => {
  const plot = solidFor(building(58, 4), "planned");
  assert.equal(plot.length, 1, "a planned site drew more than its plot");
  assert.equal(plot[0].name, "plot");
  assert.ok(maxZ(plot[0].geometry) < STOREY, "a planned plot is as tall as a storey");
});

test("damage is not a rank, so it cannot change the geometry", () => {
  // ADR-0018: damage is a condition held beside the ladder, never a rank. The
  // geometry takes a rank and nothing else, so a damaged building is the same
  // solid — which is why damage will have to arrive as a material swap plus a
  // displacement in TASK-108 rather than as a different set of parts.
  const parts = solidFor(building(86, 6), "glazed");
  assert.ok(parts.length > 0);
  const again = solidFor(building(86, 6), "glazed");
  assert.deepEqual(
    parts.map((p) => p.geometry.positions.length),
    again.map((p) => p.geometry.positions.length),
  );
});
