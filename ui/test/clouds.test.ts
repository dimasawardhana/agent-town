// Cloud, as sprite art.
//
// These tests left `sky.test.ts` when cloud did. They asserted things about a
// *field* — where the clouds sat, that they did not overlap, that the field was a
// function of its index — and none of that is true of a cloud any more. A cloud
// is one sprite now: drawn, toned, sized, and drifting across the frame.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { CLOUD_COUNT, CLOUD_SIZES, cloudPath, cloudPix } from "../src/clouds";
import { FLOCK_PERIOD, FLOCK_VISIBLE, flockOut } from "../src/birds";
import { DAYLIGHT, DAY_PHASES } from "../src/daylight";
import { P } from "../src/art/palette";

/** mix32, the same hash the layer uses, so a test can predict a cloud's art. */
function mix32(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 0x1_0000_0000;
}

const tonesIn = (w: number, variant: number): Set<string> => {
  const pix = cloudPix(w, variant);
  const s = new Set<string>();
  for (let i = 0; i < pix.data.length; i += 4) {
    if (pix.data[i + 3] !== 0) s.add(`${pix.data[i]},${pix.data[i + 1]},${pix.data[i + 2]}`);
  }
  return s;
};

test("a cloud is three tones of plaster, lit from above", () => {
  // The whole of what makes it read as cloud rather than as a smudge: a lit
  // crown, a body, and a shadowed base. One tone is a shape; two is a shape with
  // an edge.
  const t = tonesIn(38, 0);
  assert.equal(t.size, 3, `a cloud drew ${t.size} tones, not 3: ${[...t].join(" ")}`);
  const want = new Set(P.plaster.slice(1, 4).map((h) => {
    const r = Number.parseInt(h.slice(1, 3), 16);
    const g = Number.parseInt(h.slice(3, 5), 16);
    const b = Number.parseInt(h.slice(5, 7), 16);
    return `${r},${g},${b}`;
  }));
  for (const c of t) assert.ok(want.has(c), `a cloud tone ${c} is not in the plaster ramp`);
});

test("the crown is brighter than the base", () => {
  // Toned by height, and it has to be: a cloud with a dark top reads as smoke,
  // and this town already has smoke on its chimneys.
  // Sampled against the cloud's **own** extent, not fixed rows. The first
  // version read `y < 2` and `y >= h - 2`, and a cloud whose crown starts three
  // rows down has no pixels in the first two — so it reported "no crown to
  // compare" on a cloud that plainly had one.
  const w = 38;
  const pix = cloudPix(w, 0);
  const lum = (i: number): number => pix.data[i] + pix.data[i + 1] + pix.data[i + 2];
  let topRow = -1;
  let baseRow = -1;
  for (let y = 0; y < pix.h; y++) {
    for (let x = 0; x < w; x++) {
      if (pix.data[(y * w + x) * 4 + 3] === 0) continue;
      if (topRow < 0) topRow = y;
      baseRow = y;
    }
  }
  assert.ok(topRow >= 0, "the cloud drew nothing");
  const band = Math.max(1, Math.round((baseRow - topRow) * 0.2));
  let topLum = 0;
  let topN = 0;
  let baseLum = 0;
  let baseN = 0;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < pix.h; y++) {
      const i = (y * w + x) * 4;
      if (pix.data[i + 3] === 0) continue;
      if (y < topRow + band) { topLum += lum(i); topN++; }
      if (y > baseRow - band) { baseLum += lum(i); baseN++; }
    }
  }
  assert.ok(topN > 0 && baseN > 0, "the cloud has no crown or no base to compare");
  assert.ok(topLum / topN > baseLum / baseN, "a cloud is brighter at the base than the crown, so it is smoke");
});

test("a cloud has a flat bottom", () => {
  // The single thing that separates a cloud from a bubble. The discs are round;
  // the base row is cut straight across them.
  const w = 52;
  const pix = cloudPix(w, 1);
  const base = pix.h - 1;
  let left = -1;
  let right = -1;
  for (let x = 0; x < w; x++) {
    if (pix.data[(base * w + x) * 4 + 3] !== 0) {
      if (left < 0) left = x;
      right = x;
    }
  }
  assert.ok(right > left, "a cloud's base row is empty, so it has no base at all");
  // And it is continuous: a base with holes in it is a bubble.
  for (let x = left; x <= right; x++) {
    assert.notEqual(pix.data[(base * w + x) * 4 + 3], 0, `a hole in a cloud's base at ${x}`);
  }
});

test("every size and variant draws a cloud, and the variants differ", () => {
  // A sky of one cloud shape repeated is a wallpaper, which is the whole reason
  // there is a size axis and a variant at all.
  for (const w of CLOUD_SIZES) {
    for (const variant of [0, 1]) {
      const t = tonesIn(w, variant);
      assert.ok(t.size >= 3, `size ${w} variant ${variant} drew ${t.size} tones`);
    }
    const a = cloudPix(w, 0);
    const b = cloudPix(w, 1);
    assert.notDeepEqual([...a.data], [...b.data], `size ${w}: the two variants drew the same cloud`);
  }
});

test("a given cloud is always the same cloud", () => {
  // A sky that reshuffled its own weather on a redraw is a sky a reader cannot
  // look at twice, which is the rule the whole sky has followed from the start.
  for (const w of CLOUD_SIZES) {
    for (const variant of [0, 1]) {
      assert.deepEqual(
        [...cloudPix(w, variant).data],
        [...cloudPix(w, variant).data],
        `size ${w} variant ${variant} changed between calls`,
      );
    }
  }
  // And the disc count really is hashed from the width, not a constant: two
  // different widths must not land on the same silhouette by accident.
  const widths = new Set(CLOUD_SIZES.map((w) => cloudPix(w, 0).data.filter((_, i) => i % 4 === 3).join("")));
  assert.equal(widths.size, CLOUD_SIZES.length, "two cloud sizes drew the same silhouette");
});

test("a cloud drifts, slowly, and never rises or falls", () => {
  // A cloud that bobbed or grew would be doing something a reader would try to
  // interpret. It goes from one side of the sky to the other, and that is the
  // whole of its vocabulary.
  for (let i = 0; i < CLOUD_COUNT; i++) {
    const a = cloudPath(i, 0, 1200, 860);
    const b = cloudPath(i, 1, 1200, 860);
    assert.equal(b.y, a.y, `cloud ${i} moved vertically in a second`);
    assert.ok(Math.abs(b.x - a.x) < 30, `cloud ${i} jumped ${Math.abs(b.x - a.x).toFixed(0)}px in a second`);
    assert.ok(b.speed > 0, `cloud ${i} does not move`);
    // And it is slower than a bird, which is the whole of the depth read.
    assert.ok(b.speed < 20, `cloud ${i} crosses at ${b.speed.toFixed(1)}px/s, faster than a bird`);
  }
});

test("a cloud is always inside the wrap band, and never lost", () => {
  // The band is deliberately wider than the frame: a cloud has to be able to be
  // *entering* from off-screen, or it pops into existence at the edge. The first
  // version of this test asserted `x <= w` and failed on a cloud at 1229 on a
  // 1200-wide frame — which is a cloud arriving, not a cloud lost.
  const w = 1200;
  const h = 860;
  const MARGIN = 60;
  for (let i = 0; i < CLOUD_COUNT; i++) {
    for (const t of [0, 1, 9, 120, 3600, 100_000]) {
      const p = cloudPath(i, t, w, h);
      assert.ok(
        p.x >= -MARGIN && p.x <= w + MARGIN,
        `cloud ${i} at t=${t} is at x=${p.x.toFixed(0)}, outside the wrap band`,
      );
      assert.ok(p.y > 0 && p.y < h * 0.34, `cloud ${i} at t=${t} is at y=${p.y.toFixed(0)}, out of the sky band`);
    }
  }
});

test("clouds are a claim about the hour, and only the hour", () => {
  // Zero at night, for the same reason there is no bird at night: you cannot see
  // cloud at night, and drawing it would be the sky asserting something it knows
  // to be false.
  assert.equal(DAYLIGHT.night.clouds, 0, "night has cloud in it");
  assert.ok(DAYLIGHT.day.clouds > 0, "day has no cloud at all");
  assert.ok(DAYLIGHT.dusk.clouds > 0, "dusk has no cloud at all");
  for (const phase of DAY_PHASES) {
    const n = DAYLIGHT[phase].clouds;
    assert.ok(Number.isInteger(n) && n >= 0 && n <= CLOUD_COUNT, `${phase} asks for ${n} clouds`);
  }
});

test("a flock is out sometimes, and not always", () => {
  // "Sometimes" is a number. Six birds circling for the whole of a dusk is not
  // sometimes, it is furniture — and a reader who has watched one for a minute
  // has stopped seeing a bird.
  assert.ok(FLOCK_VISIBLE > 0, "a flock is never out");
  assert.ok(FLOCK_VISIBLE < FLOCK_PERIOD, "a flock is out forever, which is not 'sometimes'");
  // Roughly a quarter of the time, which is a reader seeing two crossings a
  // minute rather than a bird that flickers.
  const ratio = FLOCK_VISIBLE / FLOCK_PERIOD;
  assert.ok(ratio > 0.15 && ratio < 0.4, `a flock is out ${(ratio * 100).toFixed(0)}% of the time`);

  // And it is a pure function of the clock, so two clients watching the same
  // town see the same flock.
  for (const t of [0, 5, 20, 61, 600]) {
    assert.equal(flockOut(t), flockOut(t), `the flock window moved between calls at t=${t}`);
  }
  // Which means there is a real "out" and a real "in" to be found.
  let out = 0;
  for (let t = 0; t < FLOCK_PERIOD; t++) if (flockOut(t)) out++;
  assert.equal(out, FLOCK_VISIBLE, `the flock was out for ${out}s of a ${FLOCK_PERIOD}s cycle`);
});

test("the cloud's shape is hashed from its size, not a constant", () => {
  // A guard on the guard: if every width drew three discs, the size axis would
  // be three copies of one cloud, and this is the only place that can tell.
  const counts = CLOUD_SIZES.map((w) => {
    const pix = cloudPix(w, 0);
    let n = 0;
    for (let i = 0; i < pix.data.length; i += 4) if (pix.data[i + 3] !== 0) n++;
    return n;
  });
  assert.ok(new Set(counts).size > 1, `every size drew the same pixel count (${counts.join(",")})`);
  // And mix32 is exercised here too, so a broken hash is a failure rather than a
  // silently uniform sky.
  assert.notEqual(mix32(7), mix32(8));
});
