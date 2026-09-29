// The ember's only claim is "touched recently". These tests are about that
// claim: what it must never say, and when it must stop saying it.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { EMBER_MS, WORK_TEX, emberStrength } from "../src/embers";

const EMBER_TEX = "ember";

const NOW = 1_000_000_000;

test("a building just worked on is at full strength", () => {
  assert.equal(emberStrength(NOW, NOW), 1);
});

test("an ember is gone once its window passes, not merely faint", () => {
  // The distinction that matters: a marker that lingers at 1% is still claiming
  // something. It has to reach zero and be removed.
  assert.equal(emberStrength(NOW - EMBER_MS, NOW), 0);
  assert.equal(emberStrength(NOW - EMBER_MS - 1, NOW), 0);
  assert.equal(emberStrength(NOW - EMBER_MS * 10, NOW), 0);
});

test("an ember fades monotonically, so it never brightens as it ages", () => {
  let prev = Infinity;
  for (let age = 0; age < EMBER_MS; age += EMBER_MS / 20) {
    const s = emberStrength(NOW - age, NOW);
    assert.ok(s <= prev, `strength rose at age ${age}: ${s} > ${prev}`);
    assert.ok(s >= 0 && s <= 1, `strength out of range at age ${age}: ${s}`);
    prev = s;
  }
});

test("a clock that disagrees with the event does not produce a negative ember", () => {
  // An event timestamped in the future — a clock skew, or a machine behind this
  // one — must not yield a negative alpha, which Phaser renders as a hole.
  assert.equal(emberStrength(NOW + 5_000, NOW), 1);
});

test("a timestamp of zero is treated as no information, not as ancient", () => {
  // A building the town has never seen worked on reports nothing. Reading zero
  // as "touched at the epoch" would light every building on load.
  assert.equal(emberStrength(0, NOW), 0);
});

// The decay is measured against **wall-clock** milliseconds, because
// `BuildingState.updated` is Unix time and Phaser's `scene.time.now` is a clock
// that starts near zero. Comparing the two makes every age hugely negative, so
// every ember clamps to full strength and nothing ever fades — a glow that never
// goes out is precisely the claim this feature exists to avoid.
test("strength is measured against wall clock, not the scene clock", () => {
  const now = Date.now();
  assert.equal(emberStrength(now, now), 1);
  assert.ok(emberStrength(now - EMBER_MS / 2, now) < 1, "half a window in should already be fading");
  assert.equal(emberStrength(now - EMBER_MS, now), 0);
});

// The second tier, and the claim it is allowed to make.
//
// The camera finding measured a machine at 2.5% of the frame, so the machine
// cannot be what says "an agent is here". The ember covers "touched recently";
// the working mark covers "being worked at", at the same scale, as a *different
// shape* — because a brighter version of the same mark reads as one mark pulsing,
// and a pulse is not a claim.
test("the working mark is a different mark, not a brighter ember", () => {
  assert.notEqual(WORK_TEX, EMBER_TEX, "the two tiers share a texture key");
});

// A ring that outlived its session would say an agent is still there, and the
// town must not be the thing that says an agent stopped.
//
// **This drives the real layer.** The first version asserted on a local arrow
// that reimplemented `working.has()`, so it passed while the ring never came off
// — it could not have failed on the bug it was written for. The layer needs a
// scene, so it is given the smallest one that will do: a record of what the layer
// asked the engine to do, so the assertion is on *the layer's* decision.
test("a session that leaves stops claiming it is there", async () => {
  const { Embers, EMBER_TEX, WORK_TEX } = await import("../src/embers");
  const engine = fakeEngine();
  const layer = new Embers(engine.scene as never, -1);

  const touched = [{ id: "b", x: 0, y: 0, updated: Date.now() }];
  layer.reconcile(touched, new Set(["b"]));
  assert.equal(engine.shown, WORK_TEX, "a building being worked at is not marked with the ring");

  // The session leaves. The mark must go with it.
  layer.reconcile(touched, new Set());
  assert.equal(
    engine.shown,
    EMBER_TEX,
    "the ring outlived the session that made it — the town is claiming an agent is still there",
  );
  assert.equal(engine.alive, 1, "the mark was destroyed with the session");
});

/**
 * The smallest engine `Embers` will accept.
 *
 * Not a mock of Phaser and not a re-implementation of the layer: a record of
 * what the layer *asked* for. The one question this test has is "which texture
 * is the mark showing", and nothing in here decides that — the layer does, and
 * the record answers.
 */
function fakeEngine() {
  const e = {
    shown: "none",
    alive: 0,
    scene: {} as Record<string, unknown>,
  };
  const noopCtx = {
    get fillStyle() { return ""; },
    set fillStyle(_v: unknown) { /* the canvas is not the subject */ },
    fillRect() { /* not the subject */ },
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
  };
  e.scene = {
    textures: {
      exists: () => true,
      createCanvas: () => ({ getContext: () => noopCtx, refresh() {} }),
      addCanvas: () => undefined,
    },
    add: {
      image: (_x: number, _y: number, key: string) => {
        e.alive++;
        e.shown = key;
        const self = {
          texture: { key },
          setOrigin: () => self,
          setPosition: () => self,
          setAlpha: () => self,
          setDepth: () => self,
          setTexture: (k: string) => { self.texture.key = k; e.shown = k; return self; },
          destroy: () => { e.alive--; },
        };
        return self;
      },
    },
    time: { now: 0 },
  };
  return e;
}
