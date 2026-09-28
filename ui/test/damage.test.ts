// Damage as a prop rather than as a variant of the roof.
//
// The seam is the frame key and the bake: a damaged roof must still be the same
// cap plus a separate mark, so that adding damage stops doubling the whole cap
// family. These tests are a budget claim as much as a drawing one.

import { strict as assert } from "node:assert";

/** The footprints the bake actually draws, rather than a list that drifts from it. */
const SIDES = SIZES.map((s) => s.side);
import { test } from "node:test";

import { ARCHETYPES } from "../src/art/roof";
import { STAGE_ORDER, stageRank } from "../src/art/building";
import { bakedCels, capFrame, damageFrame, verifiedFrame, layoutAtlas, NO_DAMAGE_FRAME, NO_VERIFIED_FRAME, SIZES } from "../src/art/bake";

const DRAWING = STAGE_ORDER.filter((s) => stageRank(s) >= stageRank("roofed"));

test("damage is no longer a variant of the cap", () => {
  // The whole point. `capFrame` has neither a damage nor a verification
  // parameter, so a roof cannot be told from an undamaged, unverified one by
  // the cap key: both are one frame, and the conditions are marks over it.
  const key = capFrame(78, "stadium", "roofed", 0);
  assert.equal(key, "cap:78:stadium:roofed");
  assert.ok(!key.includes("dmg") && !key.includes("v"), `the cap key still carries a condition marker: ${key}`);
  assert.equal(capFrame(78, "hall", "completed", 0), "cap:78:hall:completed");
  // The conditions have their own keys, which is what lets each cost one cel
  // rather than one per stage.
  assert.equal(damageFrame(78, "stadium", 0), "dmg:78:stadium");
  assert.equal(verifiedFrame(78, "stadium", 0), "vf:78:stadium");
});

test("every archetype has a damage frame, and it is not a cap", () => {
  for (const side of SIDES) {
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
    SIZES.length * ARCHETYPES.length,
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
  const found = bakedCels().find((c) => c.key === NO_DAMAGE_FRAME);
  assert.ok(found, `no cel answers to ${NO_DAMAGE_FRAME}`);
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
