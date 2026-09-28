// Damage as a prop rather than as a variant of the roof.
//
// The seam is the frame key and the bake: a damaged roof must still be the same
// cap plus a separate mark, so that adding damage stops doubling the whole cap
// family. These tests are a budget claim as much as a drawing one.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { ARCHETYPES } from "../src/art/roof";
import { STAGE_ORDER, stageRank } from "../src/art/building";
import { bakedCels, capFrame, damageFrame, layoutAtlas, noDamageFrame } from "../src/art/bake";

const DRAWING = STAGE_ORDER.filter((s) => stageRank(s) >= stageRank("roofed"));

test("damage is no longer a variant of the cap", () => {
  // The whole point. `capFrame` has no damage parameter at all, so a damaged
  // roof and an undamaged one cannot be told apart by the cap key.
  assert.equal(capFrame(78, "stadium", "roofed", false, 0), "cap:78:stadium:roofed");
  assert.ok(
    !capFrame(78, "stadium", "roofed", false, 0).includes("dmg"),
    "the cap key still carries a damage marker",
  );
  // And the key is unchanged for an undamaged, unverified cap — every town that
  // renders today finds the frames it found today.
  assert.equal(capFrame(78, "hall", "completed", true, 0), "cap:78:hall:completed:v");
});

test("every archetype has a damage frame, and it is not a cap", () => {
  for (const side of [44, 60, 78, 100]) {
    for (const a of ARCHETYPES) {
      const key = damageFrame(side, a, 0);
      assert.ok(key.startsWith("dmg:"), `${key} is not a damage frame`);
      const keys = new Set(bakedCels().map((c) => c.key));
      assert.ok(keys.has(key), `no baked cel answers to ${key}`);
    }
  }
});

test("a damage mark is per-archetype, not one shared blob", () => {
  // A hole in a slope and a collapsed bay in a slab are different failures, and
  // collapsing them to one mark would be the tier collapse ADR-0004 rejects.
  const keys = bakedCels().map((c) => c.key);
  const damageKeys = new Set(keys.filter((k) => k.startsWith("dmg:") && !k.includes("blank")));
  assert.equal(
    damageKeys.size,
    4 * ARCHETYPES.length,
    `${damageKeys.size} damage marks, want one per footprint and archetype`,
  );
});

test("every damage mark actually draws something", () => {
  for (const c of bakedCels()) {
    if (!c.key.startsWith("dmg:") || c.key.includes("blank")) continue;
    assert.ok(!c.pix.empty(), `${c.key} is a damage frame that draws nothing`);
  }
});

test("the undamaged frame exists and is empty", () => {
  // Every building carries a damage child whether or not it is damaged, because
  // the child count must not change when the condition does — restaging swaps
  // frames by index. So the "no damage" case needs a real, resolvable, blank
  // frame rather than an absent child.
  const found = bakedCels().find((c) => c.key === noDamageFrame(100, "stadium"));
  assert.ok(found, `no cel answers to ${noDamageFrame(100, "stadium")}`);
  assert.ok(found!.pix.empty(), "the undamaged frame is not empty");
});

test("damage overlays cost a fraction of the variants they replace", () => {
  // Measured, not remembered: the saving is what makes this worth doing.
  const caps = bakedCels().filter((c) => c.key.startsWith("cap:"));
  const damage = bakedCels().filter((c) => c.key.startsWith("dmg:"));
  const asVariants = DRAWING.length * 2 * 2 * 4 * ARCHETYPES.length; // damaged x verified
  const asOverlays = 4 * ARCHETYPES.length + 1;
  assert.ok(
    damage.length < asVariants / 2,
    `${damage.length} overlay cels against ${asVariants} as variants; the saving is gone`,
  );
  void caps;
  const layout = layoutAtlas(bakedCels());
  assert.equal(layout.height, 8192, "the sheet grew a power of two; re-measure ADR-0021");
});
