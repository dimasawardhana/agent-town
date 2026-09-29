// The sky is the one part of the town that is neither geometry nor a cel, and it
// has broken in two ways worth keeping tests for.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { paintBackdrop, type BackdropContext } from "../src/sky";
import { readFileSync } from "node:fs";

/**
 * A 2D context that models radial gradients well enough to *see* one.
 *
 * The version that stored the fill style verbatim stored the gradient *object*,
 * so the canvas came back empty and the test could not have failed. That is the
 * whole difference: a vignette is a gradient, and a canvas that cannot model one
 * cannot assert that a vignette is on it.
 *
 * Sampling takes the last stop at or before `t`. That is coarse, and coarse in a
 * way that cannot hide the property under test — the corners are darker than the
 * centre — because a two-stop ramp is monotone by construction.
 */
function backdrop(w = 200, h = 200) {
  const px: string[] = new Array(w * h).fill("none");
  let fill: unknown = "none";
  const rgb = (c: string): [number, number, number] => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return [0, 0, 0];
    const p = m[1].split(",").map((n) => Number.parseFloat(n.trim()));
    return [p[0] || 0, p[1] || 0, p[2] || 0];
  };
  const alpha = (c: string): number => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return 0;
    const p = m[1].split(",").map((n) => Number.parseFloat(n.trim()));
    return p.length > 3 ? p[3] : 1;
  };
  const blend = (dst: string, src: string): string => {
    if (dst === "none") return src;
    const d = rgb(dst);
    const s = rgb(src);
    const a = alpha(src);
    const out = [0, 1, 2].map((i) => Math.round(s[i] * a + d[i] * (1 - a)));
    return `rgb(${out.join(",")})`;
  };
  const sample = (t: number, stops: [number, string][]): string => {
    let chosen = stops[0]?.[1] ?? "none";
    for (const [o, c] of stops) if (t >= o) chosen = c;
    return chosen;
  };
  const rect = (x: number, y: number, ww: number, hh: number) => {
    const gr = fill as { x0: number; y0: number; r0: number; r1: number; stops: [number, string][] } | undefined;
    for (let j = y; j < y + hh; j++) {
      for (let i = x; i < x + ww; i++) {
        if (i < 0 || j < 0 || i >= w || j >= h) continue;
        const idx = j * w + i;
        let src: string;
        if (gr && Array.isArray(gr.stops)) {
          const d = Math.hypot(i - gr.x0, j - gr.y0);
          const t = gr.r1 === gr.r0 ? 1 : Math.min(1, Math.max(0, (d - gr.r0) / (gr.r1 - gr.r0)));
          src = sample(t, gr.stops);
        } else {
          src = typeof fill === "string" ? fill : "none";
        }
        if (src !== "none") px[idx] = blend(px[idx], src);
      }
    }
  };
  const grad = (x0: number, y0: number, r0: number, r1: number) => {
    const stops: [number, string][] = [];
    const o = {
      addColorStop: (o2: number, c: string) => { stops.push([o2, c]); },
      __grad: { x0, y0, r0, r1, stops },
    };
    return o;
  };
  // Built to the interface, not cast into it. The cast is exactly what let a
  // canvas that dropped every gradient pass as a canvas that modelled one.
  const ctx: BackdropContext = {
      get fillStyle() { return fill; },
      set fillStyle(v: unknown) { fill = v && typeof v === "object" ? (v as { __grad?: unknown }).__grad ?? v : v; },
      fillRect: rect,
      createRadialGradient: (x0: number, y0: number, r0: number, _a: number, _b: number, r1: number) => grad(x0, y0, r0, r1),
      createLinearGradient: (x0: number, y0: number) => grad(x0, y0, 0, 1),
  };
  return { px, ctx };
}

/** A 2D-context stand-in that records fills, so the backdrop can be drawn
 *  without a browser. Deliberately not a mock of the drawing: it only has to
 *  answer "what colour is this pixel", and the vignette is a property of those
 *  answers, not of the calls that produced them. */
/**
 * A 2D context that models radial gradients well enough to *see* one.
 *
 * The earlier version stored the fill style verbatim, so a gradient was stored
 * as the gradient object and the canvas came back empty. That is the difference
 * between a test that checks the picture and one that checks the code: a
 * vignette is a gradient, and a canvas that cannot model a gradient cannot
 * assert that a vignette is on it.
 *
 * Each pixel takes the colour of the nearest gradient stop, which is coarse but
 * sufficient for the one property being asserted — the corners are darker than
 * the centre — and it is coarse in a way that could not hide that property.
 */
import { P } from "../src/art/palette";

test("there is no horizon, because a horizon is the diorama", () => {
  // Asserted by *absence*, not by a constant exported to be nil. The previous
  // version kept `HORIZON_FRACTION = null` for exactly this test — a number
  // shaped like a value the code no longer computes, exported so a test could
  // say it was absent. The source has no horizon; the test can say so.
  const sky = readFileSync(new URL("./src/sky.ts", import.meta.url), "utf8");
  assert.ok(
    !/HORIZON|horizon\s*=\s*[0-9.]/.test(sky),
    "a horizon is back in the backdrop; the town reads as a diorama on a table again",
  );
  // And the composition it replaced is what is actually painted: a plain, a
  // seat, and a vignette last.
  const lastFill = sky.lastIndexOf("g.fillStyle = vig");
  const plainFill = sky.indexOf("g.fillStyle = P.skyGround");
  assert.ok(
    lastFill > plainFill,
    "the vignette is drawn before the opaque plain, so the plain paints over it",
  );
});

test("the vignette is on the canvas, not merely described", () => {
  // The bug this exists for: the backdrop drew the vignette and *then* filled the
  // frame with opaque `skyGround`, so it survived nowhere — and the previous test
  // asserted a delta between two palette constants and never touched a canvas.
  //
  // A vignette is a property of the *rendered image*: it darkens the corners
  // relative to the centre. There is no way to check that by reading a palette,
  // which is why the check that read a palette passed on a backdrop that painted
  // no vignette at all.
  const { px, ctx } = backdrop();
  paintBackdrop(ctx, 200, 200);
  const lum = (c: string): number => {
    if (c === "none") return -1;
    const [r, g, b] = c.match(/rgba?\(([^)]+)\)/)![1].split(",").map((n) => Number.parseFloat(n));
    return 0.299 * r + 0.587 * g + 0.114 * b;
  };
  const corner = lum(px[4 * 200 + 4]);
  const centre = lum(px[100 * 200 + 100]);
  assert.ok(
    corner >= 0 && centre >= 0,
    `the canvas came back empty (corner ${corner}, centre ${centre}); the fake is not modelling the drawing`,
  );
  assert.ok(
    corner < centre,
    `the corners are not darker than the centre (${corner} vs ${centre}); the vignette is not on the canvas`,
  );
  // And the plain is visible: a backdrop that paints the void is a no-op wearing
  // a filename.
  const plain = 0.299 * 0x46 + 0.587 * 0x52 + 0.114 * 0x4a;
  assert.ok(Math.abs(centre - plain) > 2, `the centre is neither the plain nor anything (${centre} vs ${plain.toFixed(1)})`);
});

test("the backdrop is not the void it replaced", () => {
  // The first attempt kept the zenith at the void colour and eased into the
  // haze, which put the entire *visible* band at almost exactly the void it
  // replaced. A backdrop that cannot be seen is a backdrop that was not built.
  const band = (c: string): [number, number, number] => [
    parseInt(c.slice(1, 3), 16),
    parseInt(c.slice(3, 5), 16),
    parseInt(c.slice(5, 7), 16),
  ];
  // A flat fill at the void colour is the thing this replaces. The vignette and
  // the seat have to be visible or the backdrop is a no-op wearing a filename.
  const [gr, gg, gb] = band(P.skyGround);
  const [pr, pg, pb] = band(P.skyMid);
  assert.ok(
    Math.abs(gr - pr) + Math.abs(gg - pg) + Math.abs(gb - pb) > 20,
    "the seat under the town is the same colour as the plain, so nothing is visible",
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

// The "just worked" chip claims to be the ember's own glow.
//
// It was `var(--accent)`, #e6bb38, while `embers.ts` draws the glow in
// `P.accentDim`, #8a6414 — the panel asserting it mirrors the map while showing
// a different colour. This is the one place the panel and the map can disagree
// about a *fact* rather than about a count, so it is checked rather than trusted.
test("the just-worked chip is the ember's colour, not merely the same family", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const rule = html.match(/\.pulse \.sig\.hot \{ background: ([^;]+); \}/);
  assert.ok(rule, "the .sig.hot rule is gone; the claim cannot be checked");
  const declared = rule[1].trim();
  assert.equal(
    declared.toLowerCase(),
    P.accentDim.toLowerCase(),
    `the chip is ${declared} but the ember is drawn in ${P.accentDim}`,
  );
});
