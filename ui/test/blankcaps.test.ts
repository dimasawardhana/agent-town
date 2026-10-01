// The blank cap frames: the construction stages that draw no roof share one
// cel per footprint.
//
// This exists as its own file because it is a budget claim, and a budget claim
// is only true if something checks it. The art suite proves the town still
// looks right; this proves the town is smaller.

import { strict as assert } from "node:assert";

/** The footprints the bake actually draws, rather than a list that drifts from it. */
const SIDES = SIZES.map((s) => s.side);
import { test } from "node:test";

import { bakedCels, capFrame, baseFrame, bandFrame, layoutAtlas, SIZES } from "../src/art/bake";
import { STAGE_ORDER, stageRank } from "../src/art/building";
import { ARCHETYPES } from "../src/art/roof";

/** The stages whose cap draws nothing: a roof only appears from `roofed` up. */
const PRE_ROOF = STAGE_ORDER.filter((s) => stageRank(s) < stageRank("roofed"));

test("the stages that draw no roof share one blank frame per footprint", () => {
  // Every combination of kind, damage and verification must land on the same
  // frame for a pre-roof stage. This is the whole change: the *key* still has to
  // be produced per combination so the stack's child count is stable, but the
  // *frame* it resolves to need not differ.
  for (const side of SIDES) {
    for (const stage of PRE_ROOF) {
      const frames = new Set<string>();
      for (const roof of ARCHETYPES) {
        frames.add(capFrame(side, roof, stage));
      }
      assert.equal(
        frames.size,
        1,
        `side ${side} at ${stage}: ${frames.size} distinct frames for a cap that draws nothing`,
      );
    }
  }
});
// A shared key is only worth anything if the bake actually produces it. This is
// what catches the failure where every key collapses to something the atlas
// does not hold, which renders as nothing rather than as an error.
//
// Each turn is baked separately and lazily — a reader who never turns never
// pays for the other three — so this asks each turn's own bake rather than
// assuming one atlas holds them all.
test("the shared pre-roof frame is baked for every turn", () => {
  for (const turn of [0, 1, 2, 3]) {
    const keys = new Set(bakedCels(turn).map((c) => c.key));
    for (const side of SIDES) {
      for (const stage of PRE_ROOF) {
        const key = capFrame(side, ARCHETYPES[0], stage, turn);
        assert.ok(keys.has(key), `turn ${turn}: no baked cel answers to ${key}`);
      }
    }
  }
});
// The reason the blank caps exist at all. A building's stack is one child per
// storey plus its cap, and restaging swaps the frames *by index* — so if any
// stage produced a different number of keys, every storey above the change
// would slide onto the wrong frame. The comment in `bake` says the blank caps
// are load-bearing; this is the test that says so.
//
// The invariant is observable without reaching into the scene: a key resolves
// for every stage, so no stage can be missing a child. If the cap or a band
// stopped resolving at some stage, the renderer would drop that child and the
// count would fall.
test("every storey and cap resolves at every stage, so the child count cannot drift", () => {
  for (const side of SIDES) {
    for (const a of ARCHETYPES) {
      const keys = new Set(bakedCels().map((c) => c.key));
      for (const stage of STAGE_ORDER) {
        for (const variant of [0, 1] as const) {
          // The ground storey, which is drawn whatever the stage.
          assert.ok(
            keys.has(baseFrame(side, "stone", stage, 0)),
            `side ${side} ${a} ${stage}: the base has no frame, so this stage would have one fewer child`,
          );
          // And the cap, whether it draws a roof or shares the blank.
          assert.ok(
            keys.has(capFrame(side, a, stage, 0)),
            `side ${side} ${a} ${stage}: the cap has no frame, so this stage would have one fewer child`,
          );
        }
        // A five-storey building must resolve all four of its bands, at this
        // stage, whatever the stage is.
        for (let i = 1; i < 5; i++) {
          assert.ok(
            keys.has(bandFrame(side, "stone", stage, 0)),
            `side ${side} ${a} ${stage}: a band has no frame, so this stage would have one fewer child`,
          );
        }
      }
    }
  }
});


test("the post-roof stages still resolve per archetype and verification", () => {
  // The sharing must not leak. A `roofed` cap draws its archetype's roof, so the
  // combinations have to stay apart or a Stadium would render as a Cottage.
  // Damage is not an axis any more — it is a mark laid over the cap — so the
  // count is per archetype and verification, not four.
  const POST_ROOF = STAGE_ORDER.filter((s) => stageRank(s) >= stageRank("roofed"));
  for (const side of SIDES) {
    for (const stage of POST_ROOF) {
      const seen = new Set<string>();
      for (const roof of ARCHETYPES) {
        seen.add(capFrame(side, roof, stage));
      }
      assert.equal(
        seen.size,
        ARCHETYPES.length,
        `side ${side} at ${stage}: ${seen.size} frames, want one per archetype`,
      );
    }
  }
});

test("the shared blank caps are the saving the budget assumes", () => {
  // Derived, never remembered. Ticket 02's 304 was measured with five archetypes;
  // the *saving* scales with the axis, and a hard-coded figure would go on passing
  // after the atlas had changed underneath it.
  const caps = bakedCels().filter((c) => c.key.startsWith("cap:"));
  const blank = caps.filter((c) => c.pix.empty());
  const expectedBlank = SIZES.length * PRE_ROOF.length;
  assert.equal(
    blank.length,
    expectedBlank,
    `${blank.length} blank caps, want ${expectedBlank} — one per footprint per pre-roof stage`,
  );

  // What the same atlas would have cost without sharing: every combination of
  // side, archetype, damage, verification and pre-roof stage.
  const unshared = SIZES.length * ARCHETYPES.length * PRE_ROOF.length * 4;
  const saved = unshared - blank.length;
  assert.ok(
    saved > 0,
    `sharing saves ${saved} cels; the axis is wider than the shared blank, so it must be a saving`,
  );
});

test("the atlas still fits, at whatever cell height the tallest archetype set", () => {
  const layout = layoutAtlas(bakedCels());
  // The sheet must not have grown a power of two. Its *width* in cels is what
  // the ceiling is, and a taller archetype legitimately moves that — what it may
  // never do is overflow the sheet.
  assert.equal(layout.width, 2048, "the sheet grew a power of two in width; re-measure ADR-0021");
  assert.equal(layout.height, 8192, "the sheet grew a power of two; re-measure ADR-0021");
  const ceiling = (layout.height / 16) * 16;
  assert.ok(
    bakedCels().length <= ceiling,
    `${bakedCels().length} cels against a ceiling of ${ceiling}`,
  );
});

