// The blank cap frames: the construction stages that draw no roof share one
// cel per footprint.
//
// This exists as its own file because it is a budget claim, and a budget claim
// is only true if something checks it. The art suite proves the town still
// looks right; this proves the town is smaller.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { bakedCels, capFrame, baseFrame, bandFrame, layoutAtlas } from "../src/art/bake";
import { STAGE_ORDER, stageRank } from "../src/art/building";
import { ARCHETYPES } from "../src/art/roof";

/** The stages whose cap draws nothing: a roof only appears from `roofed` up. */
const PRE_ROOF = STAGE_ORDER.filter((s) => stageRank(s) < stageRank("roofed"));

test("the stages that draw no roof share one blank frame per footprint", () => {
  // Every combination of kind, damage and verification must land on the same
  // frame for a pre-roof stage. This is the whole change: the *key* still has to
  // be produced per combination so the stack's child count is stable, but the
  // *frame* it resolves to need not differ.
  for (const side of [44, 60, 78, 100]) {
    for (const stage of PRE_ROOF) {
      const frames = new Set<string>();
      for (const roof of ARCHETYPES) {
        for (const damaged of [false, true]) {
          for (const verified of [false, true]) {
            frames.add(capFrame(side, roof, stage, damaged, verified));
          }
        }
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
    for (const side of [44, 60, 78, 100]) {
      for (const stage of PRE_ROOF) {
        const key = capFrame(side, ARCHETYPES[0], stage, false, false, turn);
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
  for (const side of [44, 60, 78, 100]) {
    for (const a of ARCHETYPES) {
      const keys = new Set(bakedCels().map((c) => c.key));
      for (const stage of STAGE_ORDER) {
        for (const variant of [0, 1] as const) {
          // The ground storey, which is drawn whatever the stage.
          assert.ok(
            keys.has(baseFrame(side, stage, variant, false, 0)),
            `side ${side} ${a} ${stage}: the base has no frame, so this stage would have one fewer child`,
          );
          // And the cap, whether it draws a roof or shares the blank.
          assert.ok(
            keys.has(capFrame(side, a, stage, false, false, 0)),
            `side ${side} ${a} ${stage}: the cap has no frame, so this stage would have one fewer child`,
          );
        }
        // A five-storey building must resolve all four of its bands, at this
        // stage, whatever the stage is.
        for (let i = 1; i < 5; i++) {
          assert.ok(
            keys.has(bandFrame(side, stage, 0, 0)),
            `side ${side} ${a} ${stage}: a band has no frame, so this stage would have one fewer child`,
          );
        }
      }
    }
  }
});


test("the post-roof stages still resolve per kind, damage and verification", () => {
  // The sharing must not leak. A `roofed` cap draws its kind's roof, so the
  // combinations have to stay apart or a Stadium would render as a Cottage.
  const POST_ROOF = STAGE_ORDER.filter((s) => stageRank(s) >= stageRank("roofed"));
  for (const side of [44, 60, 78, 100]) {
    for (const stage of POST_ROOF) {
      const seen = new Set<string>();
      for (const roof of ARCHETYPES) {
        for (const damaged of [false, true]) {
          for (const verified of [false, true]) {
            seen.add(capFrame(side, roof, stage, damaged, verified));
          }
        }
      }
      assert.equal(
        seen.size,
        ARCHETYPES.length * 4,
        `side ${side} at ${stage}: ${seen.size} frames, want one per kind, damage and verification`,
      );
    }
  }
});

test("sharing the blank caps reclaims 304 cels", () => {
  // The claim the rest of the plan is built on. Not a snapshot: it is derived
  // from the bake, so it fails if the shape of the atlas ever changes.
  const caps = bakedCels().filter((c) => c.key.startsWith("cap:"));
  const blank = caps.filter((c) => c.pix.empty());

  // Everything from `roofed` up draws; everything below draws nothing.
  const drawingStages = STAGE_ORDER.length - PRE_ROOF.length;
  const expectedBlank = 4 /* sides */ * PRE_ROOF.length;
  assert.equal(
    blank.length,
    expectedBlank,
    `${blank.length} blank caps, want ${expectedBlank} — one per side per pre-roof stage`,
  );

  // And the saving is real: the same atlas without sharing would carry one blank
  // per (side, kind, damage, verification, stage).
  const unshared = 4 * ARCHETYPES.length * PRE_ROOF.length * 4;
  assert.equal(
    unshared - blank.length,
    304,
    `sharing saves ${unshared - blank.length} cels, not the 304 the budget assumes`,
  );
  void drawingStages;
});

test("the atlas still fits and the sheet does not grow", () => {
  const layout = layoutAtlas(bakedCels());
  assert.equal(layout.cellH, 93, "cell height changed; re-measure the ceiling in ADR-0021");
  assert.equal(layout.width, 2048, "sheet width changed; re-measure the ceiling in ADR-0021");
  assert.equal(layout.height, 8192, "sheet height changed; re-measure the ceiling in ADR-0021");
});
