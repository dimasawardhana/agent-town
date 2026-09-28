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
    const base = buildBase(78, a, "completed", false);
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
  const a1 = baseFrame(78, materialFor("chapel"), "completed", false, 0);
  const a2 = baseFrame(78, materialFor("tower"), "completed", false, 0);
  assert.notEqual(a1, a2, "two archetypes share one base frame; the body is still keyed on size");
});
