// Workers walk the roads rather than crossing grass.
//
// A straight line between two buildings cuts diagonally across whatever is in
// the way, and in a town whose roads were only just given geometry, that makes
// the roads scenery. Routing through them is what makes a road a road.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { roadsAsLines, routeAlongRoads } from "../src/view";
import type { Road } from "../src/store";

const rowSpec: Road = { x: 0, y: 200, w: 1000, h: 24, kind: "row" };
const linkSpec: Road = { x: 300, y: 40, w: 12, h: 180, kind: "containment" };

// The identity projection, so the fixture reads in the same numbers it is
// written in. The real scene supplies the isometric one; going through
// `roadsAsLines` means this test exercises the conversion the scene performs
// rather than a hand-built shape that skips it.
const roads = roadsAsLines([rowSpec, linkSpec], (x, y) => ({ x, y }));
const row = roads[0];
const link = roads[1];

/** Whether a point lies on a road's centre line, within its width. */
const on = (r: { ax: number; ay: number; bx: number; by: number; halfWidth: number }, p: { x: number; y: number }) => {
  const dx = r.bx - r.ax;
  const dy = r.by - r.ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - r.ax) * dx + (p.y - r.ay) * dy) / len2));
  return Math.hypot(p.x - (r.ax + dx * t), p.y - (r.ay + dy * t)) <= r.halfWidth;
};

test("a journey with no roads in the way is still a straight line", () => {
  const from = { x: 10, y: 10 };
  const to = { x: 90, y: 90 };
  const path = routeAlongRoads(from, to, []);
  assert.deepEqual(path, [from, to], "an empty road network must not bend the path");
});

test("a journey whose straight line would cross a road is bent onto it", () => {
  // Two points either side of the row road, whose direct line passes through
  // it. The route must meet the road and follow it rather than ploughing over.
  const from = { x: 100, y: 120 };
  const to = { x: 500, y: 320 };
  const straightCrosses = on(row, { x: 300, y: 220 });
  assert.ok(straightCrosses, "the fixture's straight line must actually cross the road");
  const path = routeAlongRoads(from, to, roads);
  const touches = path.filter((p) => on(row, p)).length;
  assert.ok(touches >= 2, `the route touched the road at ${touches} points; it should meet it and leave it`);
  // And the middle of the route must lie on the road rather than beside it.
  const mid = path[Math.floor(path.length / 2)];
  assert.ok(on(row, mid), `the route's middle ${JSON.stringify(mid)} is not on the road`);
});

test("a containment link is used, because it is the road between two buildings", () => {
  const from = { x: 305, y: 60 };
  const to = { x: 305, y: 200 };
  const path = routeAlongRoads(from, to, roads);
  const onLink = path.filter((p) => on(link, p)).length;
  assert.ok(onLink >= 2, `the route used the containment link at ${onLink} points`);
});

test("the route starts where the figure is and ends where it is going", () => {
  const from = { x: 100, y: 120 };
  const to = { x: 500, y: 320 };
  const path = routeAlongRoads(from, to, roads);
  assert.deepEqual(path[0], from, "the route does not start at the figure");
  const last = path[path.length - 1];
  assert.deepEqual(last, to, "the route does not end at the destination");
});

test("a route never repeats a point, so a figure cannot stall on a zero-length leg", () => {
  const path = routeAlongRoads({ x: 305, y: 200 }, { x: 306, y: 201 }, roads);
  for (let i = 1; i < path.length; i++) {
    assert.notDeepEqual(path[i], path[i - 1], `leg ${i} has zero length`);
  }
});

test("degenerate inputs return a usable path", () => {
  for (const [f, t] of [
    [{ x: 5, y: 5 }, { x: 5, y: 5 }],
    [{ x: 0, y: 0 }, { x: 1000, y: 0 }],
  ]) {
    const path = routeAlongRoads(f, t, roads);
    assert.ok(path.length >= 2, "a route with fewer than two points cannot be walked");
    assert.deepEqual(path[0], f);
    assert.deepEqual(path[path.length - 1], t);
  }
});
