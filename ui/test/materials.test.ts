// The body follows the archetype.
//
// A building's walls and ground storey are what make it read as a *place* rather
// than as one block with a different hat. The seam is the frame key and the
// bake: a family must be a real key with real art behind it, and every
// archetype must land on one.

import { strict as assert } from "node:assert";

/** The footprints the bake actually draws, rather than a list that drifts from it. */
const SIDES = SIZES.map((s) => s.side);
import { test } from "node:test";

import { ARCHETYPES, archetypeFor, materialFor, MATERIALS, type MaterialName } from "../src/art/roof";
import { bakedCels, baseFrame, bandFrame, baseDamageFrame, noBaseDamageFrame, SIZES } from "../src/art/bake";
import { buildBase, buildBand } from "../src/art/building";

test("every archetype has a material, and the mapping is total", () => {
  for (const a of ARCHETYPES) {
    const m = materialFor(a);
    assert.ok(m, `${a} has no material; the body would fall back and every building would look the same`);
    assert.ok(
      (MATERIALS as readonly string[]).includes(m),
      `${a} maps to material "${m}", which no family declares`,
    );
  }
});

test("the same path always gets the same material", () => {
  for (let i = 0; i < 500; i++) {
    const a = archetypeFor(undefined, `src/pkg${i}/mod.ts`);
    assert.equal(materialFor(a), materialFor(a), "a material was not a pure function of the archetype");
  }
});

test("base and band agree, so a building is one material throughout", () => {
  // The failure this prevents is the obvious one: a concrete base under
  // plaster upper floors, which reads as two buildings sharing a plot.
  for (const a of ARCHETYPES) {
    const base = buildBase(78, materialFor(a), "completed", false);
    const band = buildBand(78, materialFor(a), "completed");
    assert.ok(!base.empty() && !band.empty(), `${a} drew an empty base or band`);
  }
});

test("every family is visually distinct from the others", () => {
  // Five families that drew the same walls would be four wasted axes' worth of
  // cels and one very expensive nothing.
  const rendered = MATERIALS.map((m: MaterialName) => Buffer.from(buildBand(78, m, "completed").data).toString("base64"));
  assert.equal(new Set(rendered).size, MATERIALS.length, "two materials draw the same band");
});

test("a base damage overlay exists for every family, and a blank beside it", () => {
  const keys = new Set(bakedCels().map((c) => c.key));
  for (const side of SIDES) {
    for (const m of MATERIALS) {
      const k = baseDamageFrame(side, m, 0);
      assert.ok(keys.has(k), `no baked base damage for ${m} at side ${side}`);
      assert.ok(keys.has(noBaseDamageFrame(side, m)), `no blank base damage for ${m} at side ${side}`);
    }
  }
});

test("the body is keyed on the archetype, not the file count", () => {
  // Two buildings of the same size but different archetypes must differ. This is
  // the whole change: before it, the body came from `files` and a path hash.
  //
  // Asserted as the frame each archetype *lands on*, not as a difference between
  // two of them. `assert.notEqual(a1, a2)` only asks that stone and glass
  // disagree, which stays true when `baseFrame` uppercases the material, swaps
  // two fields, or hashes the name instead of writing it — every base in the
  // town would then resolve to a key the bake never cut and draw nothing, and
  // the pair would still be "different". Worse, the side it asked about was 78,
  // and the bake cuts 44, 58, 72, 86 and 100: a frame for a footprint the town
  // has no building on can never be wrong, so the test was asking about nothing
  // at all. So each key is pinned to the string it must be *and* looked up in
  // the frames the bake really holds, at a footprint it really cuts.
  const keys = new Set(bakedCels().map((c) => c.key));
  const a1 = baseFrame(86, materialFor("chapel"), "completed", 0);
  const a2 = baseFrame(86, materialFor("tower"), "completed", 0);
  assert.equal(a1, "base:86:completed:stone", "a chapel's ground storey is not the stone base");
  assert.equal(a2, "base:86:completed:glass", "a tower's ground storey is not the glass base");
  assert.ok(keys.has(a1), `${a1} is not a baked frame, so every chapel draws no ground storey`);
  assert.ok(keys.has(a2), `${a2} is not a baked frame, so every tower draws no ground storey`);

  // And the claim is about every archetype, not the two that happen to differ:
  // all twelve must land on a frame that exists, and on exactly the five
  // families and no more. A key that also carried the archetype's own name
  // would still separate chapel from tower — the pair above would still pass —
  // and would triple every base cel in the atlas to do it.
  const frames = new Set(ARCHETYPES.map((a) => baseFrame(86, materialFor(a), "completed", 0)));
  assert.equal(
    frames.size,
    MATERIALS.length,
    `twelve archetypes resolve to ${frames.size} base frames, want one per family`,
  );
  for (const f of frames) {
    assert.ok(keys.has(f), `${f} is not a baked frame, so an archetype draws no ground storey`);
  }
});
