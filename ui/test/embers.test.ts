// The ember's only claim is "touched recently". These tests are about that
// claim: what it must never say, and when it must stop saying it.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { EMBER_MS, emberStrength } from "../src/embers";

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
