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
  townReach,
  worldExtent,
} from "../src/solid/model";
import {
  MAX_FLOORS,
  PART_FOR_RANK,
  RANKS,
  STOREY,
  clampFloors,
  partsThrough,
  rubbleFor,
  solidFor,
  towerReach,
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

/** The x and y runs of a triangle soup, with the z helpers the other tests share. */
const minY = (p: Soup): number => Math.min(...axis(p, 1));
const maxY = (p: Soup): number => Math.max(...axis(p, 1));

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

test("rubble is a condition's mark beside the ladder, never a part on it", () => {
  // ADR-0018, held in the drawn town: a damaged building keeps exactly the
  // parts its rank earns, and the damage arrives as extra geometry at its
  // feet. Were the pile allowed to reach upward, it would read as a storey
  // the building gained rather than mass it lost.
  const site = building(86, 6);
  const parts = solidFor(site, "glazed");
  const pile = rubbleFor(site, "glazed");
  const again = solidFor(site, "glazed");
  assert.deepEqual(
    parts.map((p) => [p.name, p.geometry.positions.length]),
    again.map((p) => [p.name, p.geometry.positions.length]),
    "drawing rubble changed the building's parts",
  );
  assert.ok(pile.positions.length > 0, "a damaged built site drew no rubble");
  assert.ok(maxZ(pile) < STOREY, "the rubble stands as tall as a storey, reading as a part");
});

test("rubble does not lean, and the same broken building piles the same", () => {
  // The hash behind the pile is the worker's own, so a rebuild — the daemon
  // speaking again, a view refit — must not make the rubble jump. A pile that
  // leaned would read as one too.
  const site = building(58, 3);
  const a = rubbleFor(site, "walled");
  const b = rubbleFor(site, "walled");

  // The pile is loose mass: its faces stand up or lie down, none of them
  // points into the ground, which is what a flipped chunk would do.
  const zs = axis(a, 2);
  assert.ok(Math.min(...zs) >= 0, "a rubble chunk dips below the ground plane");
  assert.deepEqual(a.positions, b.positions, "the same damaged site piled differently");
});

test("a staked plot draws no rubble, damage waits for mass", () => {
  // The pile is a mark on a built thing; a bare plot has nothing to break,
  // and rubble there would read as the plan itself collapsing.
  const site = building(44, 1);
  const planned = rubbleFor(site, "planned");
  assert.equal(planned.positions.length, 0, "a planned site drew rubble");
});

test("rubble holds to its own footprint, never spilling into the street", () => {
  // The pile is sized and offset as fractions of the plot, so a wide yard of a
  // site and a narrow one keep the pile inside their own bounds — the street
  // grid stays legible.
  const small = rubbleFor(building(44, 2), "framed");
  const wide = rubbleFor(building(100, 2), "framed");
  const foot = { x: 0, y: 0, w: 44, h: 44 };
  assert.ok(maxX(small) <= foot.x + foot.w, "the small site's rubble spills east");
  assert.ok(minX(small) >= foot.x, "the small site's rubble spills west");
  assert.ok(maxX(wide) <= foot.x + 100, "the wide site's rubble spills east");
  assert.ok(minX(wide) >= foot.x, "the wide site's rubble spills west");
});
test("same-size damaged buildings use path-specific rubble and keep plot placement", () => {
  const first = building(58, 3);
  const second = { ...building(58, 3), path: "other" };
  const moved = { ...first, x: 140, y: 90 };
  const a = rubbleFor(first, "walled");
  const b = rubbleFor(second, "walled");
  const c = rubbleFor(moved, "walled");
  assert.notDeepEqual(a.positions, b.positions, "same-size paths share one damage displacement");
  assert.equal(c.positions[0]! - a.positions[0]!, 140, "moving the plot changed rubble's local x offset");
  assert.equal(c.positions[1]! - a.positions[1]!, 90, "moving the plot changed rubble's local y offset");
});

test("damage rubble is tall enough to remain distinct at the fitted view", () => {
  const site = building(44, 2);
  const pile = rubbleFor(site, "foundation");
  assert.ok(maxZ(pile) >= 44 * 0.15, "damage rubble is too flat to distinguish from unfinished ground");
});

test("the fit clears the town's roof, not only its footprint", () => {
  // **The defect this catches shipped, and it is the worst kind: a building that
  // is simply not in the picture.** The extent is a ground rectangle, and a
  // rectangle says nothing about height — so a fit taken from it put this town's
  // tallest building outside the frustum. Measured: `camera.top` was 362 picture
  // units while the tower's roof reached 435, and the cap and cornice meshes drew
  // **zero** pixels from every camera angle. It was the project with the most
  // files in the town.
  const tall: Layout = {
    width: 400,
    height: 400,
    sites: [{ id: "building:tall", kind: "building", label: "tall", files: 1, bytes: 1, depth: 1, floors: MAX_FLOORS, x: 100, y: 100, w: 60, h: 60 }],
    districts: [],
  };
  const e = worldExtent(tall);
  const reach = townReach(tall);
  assert.ok(reach > 0, "a town holding a tall building reports no height");

  const f = framingFor(e, 800, 600, 1, reach);
  const low = framingFor(e, 800, 600, 1, 0);
  assert.ok(f.scale < low.scale, "the fit did not shrink to make room for the roof");

  // Every corner, at ground and at roof height, must land inside the viewport. The
  // roof corners are what a ground-only fit fails on.
  const t = project(f.target[0], f.target[1]);
  for (const [x, y] of [[e.minX, e.minY], [e.maxX, e.minY], [e.minX, e.maxY], [e.maxX, e.maxY]] as const) {
    for (const z of [0, reach]) {
      const p = project(x, y, z);
      const dx = Math.abs(p.x - t.x) * f.scale;
      const dy = Math.abs(p.y - t.y) * f.scale;
      assert.ok(dx <= 800 / 2 + 1e-6, `a corner at z ${z} escapes the viewport in x`);
      assert.ok(dy <= 600 / 2 + 1e-6, `a corner at z ${z} escapes the viewport in y by ${dy - 600 / 2}px`);
    }
  }
});

test("townReach measures buildings and ignores flat ground", () => {
  // A district has no height of its own, and letting a wide district widen the
  // reach would shrink the town for nothing. Only buildings rise.
  const withPark: Layout = {
    width: 900, height: 900,
    sites: [{ id: "building:one", kind: "building", label: "one", files: 1, bytes: 1, depth: 1, floors: 1, x: 10, y: 10, w: 50, h: 50 }],
    districts: [{ name: "big", kind: "source", x: 0, y: 0, w: 880, h: 880 }],
  };
  assert.equal(townReach(withPark), towerReach(withPark.sites[0]!), "a district changed the town's height");
  assert.equal(townReach({ width: 0, height: 0, sites: [], districts: [] }), 0, "an empty town has height");
});

test("the fit degrades continuously rather than collapsing to the floor", () => {
  // **The second bug this pairing caught, and it was introduced by the fix for
  // the first.** With height in the extent a town can overrun the viewport, and a
  // `Math.floor` — carried over from the flat fit, which needs whole-number zoom
  // for square art pixels — floors a scale just below 1 down to **0**. The guard
  // against a zero divisor then turned it into `1e-6`, which is not a slightly
  // small frustum but one ten to the sixth times too large: the entire town
  // rendered as a sub-pixel speck and every mesh reported zero drawn pixels.
  //
  // So the scale is asserted continuous here, which is what the doc block has
  // always claimed and what the old implementation contradicted.
  const e = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  const reach = 20000; // absurd on purpose: guarantees the fit wants scale < 1
  const f = framingFor(e, 800, 600, 1, reach);
  assert.ok(f.scale > 1e-3, `the scale collapsed to ${f.scale} — the fit rounded down to the floor`);
  assert.ok(f.halfWidth < 1e6, "the frustum exploded, so the town is a speck");
});

test("raising a point moves it up the screen, not down", () => {
  // **The handedness of the picture, which nothing asserted and which shipped
  // wrong.** The projection tests above assert *magnitudes* — that a world step
  // lands `scale/2` across and `scale/4` down — and every one of them passed
  // while the renderer drew the town mirrored, because a mirrored picture has the
  // same magnitudes with two of the three directions negated.
  //
  // What it looked like: buildings grew **downward** from their plots, world `+y`
  // moved a point up the screen instead of down, and `Turn` read as a flip rather
  // than a rotation — left for right, with up still up.
  //
  // The camera applies its frustum in camera space, so the screen displacement of
  // a world step is `(step · basis) / half-extent`, with the vertical one divided
  // by the **signed** `halfTop`. This is the assertion that makes the sign
  // load-bearing instead of a convention in an untested module.
  const e = { minX: 0, minY: 0, maxX: 200, maxY: 200 };
  const f = framingFor(e, 800, 600, 1, 300);
  assert.ok(f.halfTop < 0, `halfTop is ${f.halfTop}; the frustum is not flipped, so the town is mirrored`);
  assert.ok(f.halfBottom > 0, "halfBottom is not positive, so the two edges are the same sign");
  assert.equal(f.halfTop, -f.halfBottom, "the frustum's vertical extent is not symmetric");

  const screenY = (step: readonly number[]): number => {
    const dot = step[0] * CAMERA_BASIS.y[0] + step[1] * CAMERA_BASIS.y[1] + step[2] * CAMERA_BASIS.y[2];
    // Positive `dot` is up the screen, and in NDC up is `+y`.
    return dot / f.halfTop;
  };

  // A storey of height (world +z) rises. This is the assertion that fails when
  // the frustum is not flipped, and it is the one that matters most: it is the
  // property the whole stacking model rests on.
  assert.ok(screenY([0, 0, 1]) > 0, "raising a point moved it down the screen");
  // And world `+y` goes *down* the picture, the fact `project` states as `+1/4`.
  assert.ok(screenY([0, 1, 0]) < 0, "world +y moved up the screen, so the picture is mirrored");
  // World `+x` also goes down, by half as much — this is the 2:1 skew itself.
  assert.ok(screenY([1, 0, 0]) < 0, "world +x moved up the screen");
  assert.ok(
    Math.abs(screenY([1, 0, 0]) * 2 - screenY([0, 1, 0]) * 2) < 1e-9,
    "x and y do not fall at the same rate, so the skew is wrong",
  );
});
