// The sky is the one part of the town that is neither geometry nor a cel, and it
// has broken in two ways worth keeping tests for.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { HORIZON_FRACTION } from "../src/sky";
import { P } from "../src/art/palette";

test("the horizon crosses the island rather than sitting below it", () => {
  // The sky is screen-space and the island is centred by the camera fit, so the
  // horizon is a fight with that fit. Too low and the treeline stands *in front*
  // of the land — a forest the town is behind, which is the opposite of a
  // horizon, and looked like a barcode across the bottom of the frame.
  assert.ok(
    HORIZON_FRACTION > 0.45 && HORIZON_FRACTION < 0.7,
    `horizon at ${HORIZON_FRACTION} puts the treeline in front of the land`,
  );
});

test("the sky spends its contrast where the town does not cover it", () => {
  // The first attempt kept the zenith at the void colour and eased into the
  // haze, which put the entire *visible* band at almost exactly the void it
  // replaced. A backdrop that cannot be seen is a backdrop that was not built.
  const band = (c: string): [number, number, number] => [
    parseInt(c.slice(1, 3), 16),
    parseInt(c.slice(3, 5), 16),
    parseInt(c.slice(5, 7), 16),
  ];
  const [zr, zg, zb] = band(P.skyZenith);
  const [vr, vg, vb] = band(P.void);
  const zenithDelta = Math.abs(zr - vr) + Math.abs(zg - vg) + Math.abs(zb - vb);
  assert.ok(zenithDelta > 60, `the zenith is within ${zenithDelta} of the void`);
  const [mr, mg, mb] = band(P.skyMid);
  assert.ok(
    Math.abs(mr - zr) + Math.abs(mg - zg) + Math.abs(mb - zb) > 40,
    "the zenith and the middle of the sky are the same colour",
  );
});

test("the plain below the horizon is neither the void nor the haze", () => {
  // It has to be darker than the haze and lighter than the void, or the join
  // reads as a hole in the picture rather than as land seen from above.
  const lum = (c: string): number => {
    const r = parseInt(c.slice(1, 3), 16);
    const g = parseInt(c.slice(3, 5), 16);
    const b = parseInt(c.slice(5, 7), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  };
  assert.ok(lum(P.skyGround) > lum(P.void), "the plain is darker than the void");
  assert.ok(lum(P.skyGround) < lum(P.skyHaze), "the plain is lighter than the haze");
});

test("no backdrop colour is allowed into baked art", () => {
  // The sky is generated; if one of its colours leaked into a cel it would be
  // baked, paid for by the whole town, and the separation would be a convention
  // rather than a fact.
  const skyColours = [P.skyZenith, P.skyMid, P.skyHaze, P.skyGlow, P.skyFar, P.skyNear, P.skyGround];
  const art = [P.ink, ...P.stone, ...P.wood, ...(P.brick ?? []), P.done, P.down, P.accent, P.accentDim].filter((c): c is string => typeof c === "string");
  for (const a of art) {
    for (const s of skyColours) {
      assert.notEqual(
        a.toLowerCase(),
        s.toLowerCase(),
        `${a} is a backdrop colour and would be baked`,
      );
    }
  }
});
