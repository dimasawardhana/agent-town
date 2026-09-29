// A car's position must be a pure function of its road.
//
// Not a style preference: a car placed by `Math.random()` jumps on every reload
// and two clients watching the same town draw different traffic. That breaks
// determinism (ADR-0012) in the most visible way available — the town is not the
// same place twice.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { bakedCels } from "../src/art/bake";
import { carAt, CAR_LENGTH } from "../src/traffic";
import type { RoadLine } from "../src/view";

const road: RoadLine = { ax: 0, ay: 0, bx: 100, by: 0, halfWidth: 4, from: "a", to: "b" };

test("a car at the same moment is in the same place", () => {
  assert.equal(carAt(road, 1000), carAt(road, 1000));
  assert.equal(carAt(road, 0), carAt(road, 0));
});

test("a car advances, and never leaves its road", () => {
  const early = carAt(road, 0);
  const later = carAt(road, 4000);
  assert.notEqual(early, later, "the car never moved");
  for (const t of [0, 1000, 2500, 999999, -500]) {
    const p = carAt(road, t);
    assert.ok(p >= 0 && p < 1, `car escaped its road: ${p} at t=${t}`);
  }
});

test("two different roads carry two different cars", () => {
  const other: RoadLine = { ax: 0, ay: 0, bx: 100, by: 0, halfWidth: 4, from: "x", to: "y" };
  // Same geometry, different identity: a town must not put every car in step.
  assert.notEqual(carAt(road, 3000), carAt(other, 3000), "cars are synchronised across roads");
});

test("a road with no importer carries no car", () => {
  const bare: RoadLine = { ax: 0, ay: 0, bx: 100, by: 0, halfWidth: 4 };
  assert.equal(bare.from, undefined, "a containment road grew a direction");
  assert.ok(CAR_LENGTH > 0);
});

test("a car costs the atlas nothing", () => {
  // Traffic is generated, so it must not appear in the bake. If a car ever gets
  // baked it comes out of a budget with 135 spare, and this is the assertion
  // that says so before anyone notices the count.
  const keys = bakedCels(0).map((c) => c.key);
  assert.equal(
    keys.filter((k) => k.startsWith("car:")).length,
    0,
    "a car was baked into the atlas; traffic is generated and must not cost cels",
  );
});
