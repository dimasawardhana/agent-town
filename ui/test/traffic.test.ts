// A car's position must be a pure function of its road.
//
// Not a style preference: a car placed by `Math.random()` jumps on every reload
// and two clients watching the same town draw different traffic. That breaks
// determinism (ADR-0012) in the most visible way available — the town is not the
// same place twice.
import { strict as assert } from "node:assert";
import { test } from "node:test";

import { bakedCels } from "../src/art/bake";
import { carAt, CAR_HEIGHT, CAR_LENGTH, cycleMs, drivenRoads, roadId } from "../src/traffic";
import type { RoadLine } from "../src/view";
import { P } from "../src/art/palette";

const road: RoadLine = { ax: 0, ay: 0, bx: 100, by: 0, halfWidth: 4, from: "a", to: "b" };

test("a car's position is a function of its road, not of the call", () => {
  // Determinism, asserted so it can fail. `carAt(road, 1000) === carAt(road,
  // 1000)` proved the same thing only if the function were already pure, which
  // is the thing under test.
  assert.equal(carAt(road, 1000), carAt(road, 1000), "two calls on one road disagreed");
});

test("a car crosses a long road in more time than a short one", () => {
  // The liveliness spec: "at a speed tied to the road's length". Constant
  // speed means a constant *cycle*, so this is the requirement stated as
  // something falsifiable rather than as a claim in a comment.
  const short: RoadLine = { ax: 0, ay: 0, bx: 100, by: 0, halfWidth: 4, from: "a", to: "b" };
  const long: RoadLine = { ax: 0, ay: 0, bx: 400, by: 0, halfWidth: 4, from: "a", to: "b" };
  assert.ok(cycleMs(long) > cycleMs(short), "a long road was crossed in the same time as a short one");
  // Four times the length, so four times the cycle — and not the floor.
  assert.ok(cycleMs(long) >= cycleMs(short) * 3, `300 extra pixels bought only ${cycleMs(long) - cycleMs(short)}ms`);
});

test("a very short road still takes long enough to be a journey", () => {
  // The 14-pixel gap between two neighbouring plots is the shortest road the
  // town has. At 55ms a pixel it would take most of a second and read as a
  // blink; the floor is what stops that.
  const gap: RoadLine = { ax: 0, ay: 0, bx: 14, by: 0, halfWidth: 4, from: "a", to: "b" };
  assert.ok(cycleMs(gap) >= 1500, `a 14px road took ${cycleMs(gap)}ms; that is a blink, not a car`);
});

test("two roads with the same ends are the same road, and different ends are not", () => {
  // The key is built by joining from and to. Joined bare, "ab"+"" and "a"+"b"
  // are indistinguishable, two roads would share one car, and whichever was
  // placed second would never be drawn.
  const a: RoadLine = { ax: 0, ay: 0, bx: 10, by: 0, halfWidth: 4, from: "ab", to: "c" };
  const b: RoadLine = { ax: 0, ay: 0, bx: 10, by: 0, halfWidth: 4, from: "a", to: "bc" };
  assert.notEqual(roadId(a), roadId(b), "two different roads share one car key");
  assert.equal(roadId(road), roadId({ ...road }), "the same road got two keys");
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
  // Asserting `bare.from` is undefined asserts a literal this test wrote a
  // line ago. What matters is the consequence: the same road with a direction
  // is kept and without one is dropped.
  const bare: RoadLine = { ax: 0, ay: 0, bx: 100, by: 0, halfWidth: 4 };
  const directed: RoadLine = { ...bare, from: "a", to: "b" };
  assert.deepEqual(
    drivenRoads([bare, directed]).map((r) => r.from),
    ["a"],
    "a road without both ends of a dependency is being given a car",
  );
  assert.ok(CAR_LENGTH > 0 && CAR_HEIGHT > 0, "a car with no area cannot be seen");
});

test("only import roads carry cars, and containment roads carry none", () => {
  const lines: RoadLine[] = [
    { ax: 0, ay: 0, bx: 10, by: 0, halfWidth: 4, from: "a", to: "b" },
    { ax: 20, ay: 0, bx: 30, by: 0, halfWidth: 4 },
    { ax: 40, ay: 0, bx: 50, by: 0, halfWidth: 4, from: "c" },
    { ax: 60, ay: 0, bx: 70, by: 0, halfWidth: 4, from: "d", to: "" },
  ];
  assert.deepEqual(
    drivenRoads(lines).map((r) => `${r.from ?? ""}->${r.to ?? ""}`),
    ["a->b"],
    "a road without both ends of a dependency is being given a car",
  );
});

test("a car is big enough to be seen", () => {
  // The regression this exists for: at 6×2 and in the value of a building's own
  // wall, nine cars on nine roads looked identical to no cars at all. Both
  // halves matter — the body has to be wide enough to clear the building behind
  // it, and it has to be tall enough not to disappear into a kerb.
  assert.ok(CAR_LENGTH >= 10, `a ${CAR_LENGTH}px car is a smudge on a wall, not traffic`);
  assert.ok(CAR_HEIGHT >= 4, `a ${CAR_HEIGHT}px car is a painted stripe, not traffic`);
});

test("a car is not painted in a colour a building is painted in", () => {
  // A car has to separate from the town, and every material ramp here is also
  // what a building's wall, roof or window is drawn in. Taking one of those
  // values is what made the first version invisible.
  const materialValues = new Set(
    [...P.metal, ...P.stone, ...P.plaster, ...P.wood, ...P.roof, ...P.glass].map(
      (c) => c.toLowerCase(),
    ),
  );
  assert.ok(
    !materialValues.has(P.traffic.toLowerCase()),
    "the car is painted in a material colour, so it reads as part of a building",
  );
});

test("a car costs the atlas nothing", () => {
  // Traffic is generated, so it must not appear in the bake. If a car ever got
  // baked it would come out of a budget with 135 spare.
  //
  // Asserted as a *count*, not as `startsWith("car:")`. The bake's prefixes are
  // g, ge, m, p, s44…s100, band, base, cap, bdmg, dmg and vf — a baked car
  // would be `p:car:0` or `c:car:0`, neither of which starts with "car:", so
  // the filter version could never match anything and could never fail. A
  // recorded total is falsifiable in both directions: a new cel of any kind
  // fails here, and that is the point — the atlas is budgeted, and a car
  // sneaking into it is a budget change that has to be argued for.
  const keys = bakedCels(0).map((c) => c.key);
  assert.equal(keys.length, 1125, `the atlas holds ${keys.length} cels; a car has been baked into it`);
  assert.equal(keys.filter((k) => k.includes("car")).length, 0, "a baked key mentions a car");
});
