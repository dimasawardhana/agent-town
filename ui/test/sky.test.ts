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

test("the plain is the same world as the grass, and clearly not our land", () => {
  // A pair of claims that pull against each other, which is why both are tested.
  // Relatedness is a *hue* relation and separateness is a *value and saturation*
  // relation — the same two a distant field is separated by, and testing the
  // hexes instead would have missed the first attempt, which was a blue-grey
  // that belonged to no landscape in the picture at all.
  const rgb = (c: string): [number, number, number] => [
    parseInt(c.slice(1, 3), 16),
    parseInt(c.slice(3, 5), 16),
    parseInt(c.slice(5, 7), 16),
  ];
  const hue = (c: string): number => {
    const [r, g, b] = rgb(c).map((v) => v / 255) as [number, number, number];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (max === min) return 0;
    const d = max - min;
    let h: number;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return ((h * 60) + 360) % 360;
  };
  const sat = (c: string): number => {
    const [r, g, b] = rgb(c);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max === 0 ? 0 : (max - min) / max;
  };
  const dist = (a: string, b: string): number => {
    const [r1, g1, b1] = rgb(a);
    const [r2, g2, b2] = rgb(b);
    return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
  };

  // Related: the plain's hue is within a fifth of the way round the wheel from
  // the grass it stands in for. A blue-grey plain sits 180 degrees away and is
  // a different world, which is what the first attempt was.
  for (const g of P.grass) {
    const d = Math.abs(hue(P.skyGround) - hue(g));
    const around = Math.min(d, 360 - d);
    assert.ok(around < 40, `plain hue ${hue(P.skyGround).toFixed(0)} is ${around.toFixed(0)} from grass ${g}`);
  }
  // Separate: far enough from every step of the ramp that it cannot be read as
  // more of the town's own ground.
  for (const g of P.grass) {
    assert.ok(dist(P.skyGround, g) > 20, `plain is only ${dist(P.skyGround, g).toFixed(0)} from grass ${g}`);
  }
  // And duller, which is the whole mechanism: distance reads as less saturation.
  const grassSat = Math.max(...P.grass.map(sat));
  assert.ok(sat(P.skyGround) < grassSat, "the plain is more saturated than the grass it stands in");
});

test("no backdrop colour is allowed into baked art", () => {
  // The sky is generated; if one of its colours leaked into a cel it would be
  // baked, paid for by the whole town, and the separation would be a convention
  // rather than a fact.
  const skyColours = [P.skyZenith, P.skyMid, P.skyHaze, P.skyGlow, P.skyFar, P.skyNear, P.skyGround];
  // Named from the palette rather than guessed, because a name that does not
  // exist is a colour that is silently not being checked.
  const ramp = (v: string | readonly string[]): string[] =>
    typeof v === "string" ? [v] : [...v];
  const art: string[] = [
    P.ink,
    ...ramp(P.stone),
    ...ramp(P.wood),
    ...ramp(P.grass),
    ...ramp(P.earth),
    ...ramp(P.rust),
    ...ramp(P.metal),
    P.accent,
    P.accentDim,
  ];
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
