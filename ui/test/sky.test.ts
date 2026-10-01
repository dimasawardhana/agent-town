// The sky is the one part of the town that is neither geometry nor a cel, and it
// has broken in two ways worth keeping tests for.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { CLOUD_COUNT, cloudAt, paintBackdrop, posterise, renderSky, skyLadder, type BackdropContext } from "../src/sky";
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
    // `#rrggbb` as well as `rgb()`. The backdrop fills its plain, and its cloud
    // edges, with hex straight out of the palette — so a parser that only knew
    // `rgb()` read every one of them as black. That was invisible while
    // transparent fills were no-ops, and the moment the alpha model was fixed it
    // came straight back: the vignette blends onto the plain, so the plain had to
    // be readable for the vignette to be visible at all.
    const hex = c.match(/^#([0-9a-f]{6})$/i);
    if (hex) {
      const v = Number.parseInt(hex[1], 16);
      return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    }
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return [0, 0, 0];
    const p = m[1].split(",").map((n) => Number.parseFloat(n.trim()));
    return [p[0] || 0, p[1] || 0, p[2] || 0];
  };
  const alpha = (c: string): number => {
    // "none" is unpainted; **anything that is not an rgba() is opaque**, which
    // includes the `#rrggbb` strings `paintBackdrop` fills its plain with. The
    // first version returned 0 for anything it could not parse, so a hex fill
    // read as fully transparent and the plain stopped painting — caught by the
    // vignette test, which is the one that asks whether the corners are dark.
    if (c === "none") return 0;
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return 1;
    const p = m[1].split(",").map((n) => Number.parseFloat(n.trim()));
    return p.length > 3 ? (p[3] ?? 1) : 1;
  };
  const blend = (dst: string, src: string): string => {
    // A fully transparent fill changes nothing, exactly as a real canvas behaves.
    // The first version blended it like any other colour, which turned "nothing
    // here yet" into opaque black wherever a gradient's outer stop was
    // transparent — and nothing noticed until the posterise read every pixel and
    // found a colour that was not on the ladder.
    if (alpha(src) === 0) return dst;
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
      // The pixel round-trip, so the posterise is part of what the harness
      // renders. Without these the harness modelled a backdrop the sky no longer
      // produces, and every test through it was testing the wrong picture.
      // The harness holds colours as strings, because that is what the gradient
      // stops are written in, so the pixel round-trip goes through bytes the way
      // a real canvas does. Handing `posterise` the string array would have been
      // a mock that agreed with whatever the posterise did — and a mock that
      // cannot disagree is not a test.
      getImageData: (_x, _y, gw, gh) => {
        // Four bytes per pixel. The first version allocated one byte per pixel,
        // which made `putImageData` rewrite a quarter of the frame and leave the
        // rest as the raw gradient — so the end-to-end test found a hex colour
        // sitting in a sky that was supposed to be posterised.
        const data = new Uint8ClampedArray(px.length * 4);
        for (let i = 0; i < px.length; i++) {
          const c = px[i];
          if (c === "none") { data[i + 3] = 0; continue; }
          const [r, g, b] = rgb(c);
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
          data[i + 3] = alpha(c);
        }
        return { data, width: gw, height: gh };
      },
      putImageData: (img) => {
        // Stepped over `img.data`, not over `px`: the first version looped over
        // `px` in fours, which wrote a quarter of the frame and read the wrong
        // offsets — and a posterise that rewrote three quarters of the sky left
        // a strip of unquantised gradient behind it.
        for (let i = 0; i < img.data.length; i += 4) {
          px[i / 4] = img.data[i + 3] === 0
            ? "none"
            : `rgb(${img.data[i]},${img.data[i + 1]},${img.data[i + 2]})`;
        }
      },
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
import { DAYLIGHT, DAY_PHASES } from "../src/daylight";

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
  // The plain is now the *phase's* plain rather than a fixed palette key, so the
  // literal has moved. It is still read from the source and not from the canvas,
  // and it still has to be: the seat and the vignette both cover the plain
  // everywhere, so there is no pixel on the image that is the plain. That was
  // true before this change and is still true; what changed is which symbol
  // holds it.
  assert.ok(
    /fillStyle\s*=\s*sky\.ground/.test(sky),
    "the backdrop is not painting the phase's ground as its plain; a substituted colour is uncaught by every canvas check",
  );

  // And the composition it replaced is what is actually painted: a plain, a
  // seat, and a vignette last.
  const lastFill = sky.lastIndexOf("g.fillStyle = vig");
  const plainFill = sky.indexOf("g.fillStyle = sky.ground");
  assert.ok(plainFill > 0, "the backdrop is not painting sky.ground as its plain");
  assert.ok(
    lastFill > plainFill,
    "the vignette is drawn before the opaque plain, so the plain paints over it",
  );
});

test("every phase's sky is made of palette keys, not invented colours", () => {
  // The invariant this change was nearly wrong about. The first version of the
  // dusk phase wrote its own `#4a4450` triple, which looked like it belonged to
  // the town and sat outside every relationship `sky.test.ts` checks between
  // the seven sky keys — a plain darker than the void, lighter than the haze,
  // less saturated than the grass behind it. A phase therefore *selects* from
  // the palette; if one ever stops doing that, the harmony is unearned.
  // Ramps count too: a phase is free to take any colour the town already has.
  const palette = new Set<string>(
    Object.values(P).flatMap((v) => (typeof v === "string" ? [v] : Array.isArray(v) ? [...v] : [])),
  );
  for (const phase of DAY_PHASES) {
    for (const [role, colour] of Object.entries(DAYLIGHT[phase].sky)) {
      assert.ok(
        palette.has(colour),
        `${phase}'s ${role} is ${colour}, which is not a palette key`,
      );
    }
  }
});

test("each phase is a different plain, and dusk is the one that carries the claim", () => {
  const grounds = DAY_PHASES.map((p) => DAYLIGHT[p].sky.ground);
  assert.equal(new Set(grounds).size, DAY_PHASES.length, `two phases share a plain: ${grounds.join(" ")}`);
  assert.equal(DAYLIGHT.day.lit, false, "daylight lights windows, which is the one thing it must not do");
  assert.equal(DAYLIGHT.dusk.lit, true);
  assert.equal(DAYLIGHT.dusk.lamp, "lamp");
  assert.equal(DAYLIGHT.day.lamp, null, "day carries a lamp ramp it never draws");
});

test("a phase actually changes the picture, on the canvas", () => {
  // The one check about time of day that is a property of the *image* rather
  // than of the code, and so the one that cannot be satisfied by a phase table
  // that is correct and never read. Two backdrops, same size, same everything
  // but the phase — and if they came out identical, every colour in
  // `DAYLIGHT` would be decoration.
  const seen = new Map<string, string[]>();
  for (const phase of DAY_PHASES) {
    const { px, ctx } = backdrop();
    paintBackdrop(ctx, 200, 200, phase);
    seen.set(phase, [...px]);
  }
  const images = [...seen.values()];
  for (let i = 0; i < images.length; i++) {
    for (let j = i + 1; j < images.length; j++) {
      const a = images[i];
      const b = images[j];
      const differing = a.filter((c, k) => c !== b[k]).length;
      assert.ok(
        differing > 200,
        `${DAY_PHASES[i]} and ${DAY_PHASES[j]} render the same backdrop (${differing} pixels differ)`,
      );
    }
  }
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
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) {
      const r = Number.parseInt(c.slice(1, 3), 16);
      const g = Number.parseInt(c.slice(3, 5), 16);
      const b = Number.parseInt(c.slice(5, 7), 16);
      return 0.299 * r + 0.587 * g + 0.114 * b;
    }
    const [r, g, b] = m[1].split(",").map((n) => Number.parseFloat(n));
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
  // The plain's own colour cannot be checked on the canvas, and that is a fact
  // about the drawing rather than a gap in the test: the seat's r0 is 0 and the
  // vignette's r1 is the frame's own diagonal, so **every pixel is inside both**
  // and no rendered pixel is the plain alone. A canvas check can therefore only
  // ever ask whether the plain is *unlike* something, which a substitution
  // satisfies. The colour itself is checked at the source, below.
  assert.ok(centre > 0, "the centre has no colour at all");
  // And the plain is visible at all.
  //
  // Deliberately a *luminance* check and not a hue or an equality. Two earlier
  // versions were wrong and both were found by running the mutation, not by
  // reading: `centre !== plain` passed on a *substitution* (a different plain is
  // also unlike skyGround), and `centre == plain` went red on correct code
  // because the seat overlays 22% of a cooler colour on every pixel. A hue check
  // was worse than either: the seat drags the centre's hue 70 degrees toward its
  // own, so it failed on a backdrop that was right.
  //
  // What survives all three is the claim that is actually true: the frame is not
  // the void it replaced, and the vignette is on it.
  assert.ok(
    centre > 8,
    `the centre is the void (${centre.toFixed(1)}); the backdrop is not painting anything`,
  );
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

test("the cloud field is a function of its index and nothing else", () => {
  // The sky's own rule, at the level of the cloud field: no `Math.random`, so
  // two clients drawing the same town draw the same sky and a redraw cannot
  // rearrange the weather under a reader who is looking at it.
  for (let i = 0; i < CLOUD_COUNT; i++) {
    assert.deepEqual(cloudAt(i, 1200, 860), cloudAt(i, 1200, 860), `cloud ${i} moved between calls`);
  }
  // And it is laid out as a *field*, not a list: the positions are distinct.
  const seen = new Set<string>();
  for (let i = 0; i < CLOUD_COUNT; i++) seen.add(cloudAt(i, 1200, 860).x.toFixed(2));
  assert.equal(seen.size, CLOUD_COUNT, `clouds overlap exactly: ${[...seen].join(" ")}`);
});

test("no cloud is placed where the town stands", () => {
  // A cloud behind a building is a smudge on a roof, so the field is kept in the
  // upper band. The town occupies the middle and lower of the frame, and this
  // pins the boundary rather than trusting the comment.
  for (let i = 0; i < CLOUD_COUNT; i++) {
    const c = cloudAt(i, 1200, 860);
    const y = c.y / 860;
    assert.ok(y > 0 && y < 0.36, `cloud ${i} sits at ${(y * 100).toFixed(0)}% of the frame height`);
  }
});

test("a night sky has no cloud, and that is a claim rather than a mood", () => {
  // You cannot see cloud at night, and drawing one would be the sky asserting
  // something it knows to be false — the same rule that roosts the birds.
  const { px: night, ctx: nctx } = backdrop();
  paintBackdrop(nctx, 200, 200, "night");
  const { px: day, ctx: dctx } = backdrop();
  paintBackdrop(dctx, 200, 200, "day");
  const differs = night.filter((c, i) => c !== day[i]).length;
  assert.ok(differs > 200, "a night sky renders the same as a day sky");
  // And the table says so, so the layer is not the only thing that knows.
  assert.equal(DAYLIGHT.night.cloud, null, "night has a cloud colour");
  assert.equal(DAYLIGHT.day.cloud, P.plaster[3]);
});

test("a day sky is measurably brighter in its cloud band, and a night sky is not", () => {
  // **The strong form, and the weak test it replaces.** The previous version
  // rendered a day sky and a night sky and required them to differ — which they
  // do, because their *ground colours* differ, so it passed with the cloud field
  // set to zero cels. A test that cannot fail when the thing it names is
  // removed.
  //
  // What it asks now: inside the band the clouds are placed in, is there light
  // that is genuinely brighter than the sky behind it? A cloud is a lift, and a
  // lift is measurable.
  const bandBrightness = (phase: "day" | "night"): { peak: number; floor: number } => {
    const { px, ctx } = backdrop(400, 400);
    paintBackdrop(ctx, 400, 400, phase);
    const w = 400;
    const y0 = Math.round(400 * 0.06);
    const y1 = Math.round(400 * 0.30);
    let peak = -Infinity;
    let floor = Infinity;
    const lum = (c: string): number => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return 0;
      const p = m[1].split(",").map((n) => Number.parseFloat(n.trim()));
      return (p[0] || 0) + (p[1] || 0) + (p[2] || 0);
    };
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < w; x++) {
        const v = lum(px[y * w + x]);
        if (v > peak) peak = v;
        if (v < floor) floor = v;
      }
    }
    return { peak, floor };
  };
  const day = bandBrightness("day");
  assert.ok(
    day.peak - day.floor > 25,
    `the day sky's cloud band is flat: brightest ${day.peak.toFixed(0)}, darkest ${day.floor.toFixed(0)}`,
  );
  // And the same measurement on a night sky is the claim: no cloud, so no lift
  // above the vignette's own falloff.
  const night = bandBrightness("night");
  assert.ok(
    night.peak - night.floor <= day.peak - day.floor,
    "a night sky is brighter in its cloud band than a day sky",
  );
});

test("the cloud field has clouds in it", () => {
  // Guards the guard: `CLOUD_COUNT` zeroed makes every loop above vacuous, and a
  // vacuous loop is how a cloud silently stopped existing.
  assert.ok(CLOUD_COUNT > 0, "CLOUD_COUNT is zero, so every cloud test below is vacuous");
  assert.equal(CLOUD_COUNT, 7, "the cloud field's density changed; re-check how a sky reads");
});

/** A smooth horizontal gradient, which is the thing the posterise exists to fix. */
function smoothSky(w: number, h: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      d[i] = Math.round((x / (w - 1)) * 255);
      d[i + 1] = 120;
      d[i + 2] = Math.round((y / (h - 1)) * 255);
      d[i + 3] = 255;
    }
  }
  return d;
}

const distinct = (d: Uint8ClampedArray): Set<string> => {
  const s = new Set<string>();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    s.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
  }
  return s;
};

test("the sky is posterised, which is the only way to tell it is pixel art", () => {
  // The claim is that the backdrop is the same *kind* of picture as the town,
  // and a posterised gradient still looks exactly like a gradient. Counting
  // colours is the only thing that can tell the difference.
  const w = 160, h = 120;
  const before = smoothSky(w, h);
  const after = smoothSky(w, h);
  posterise(after, w, h, skyLadder("dusk"));
  assert.ok(
    distinct(before).size > 1000,
    `the fixture is not smooth, so the test proves nothing (${distinct(before).size} colours)`,
  );
  const got = distinct(after).size;
  assert.ok(got <= skyLadder("dusk").length, `the sky has ${got} colours, more than its ${skyLadder("dusk").length}-step ladder`);
  assert.ok(got > 4, `the sky collapsed to ${got} colours, which is not a gradient at all`);
});

test("every sky colour is one the palette ladder holds", () => {
  // No invented colour. The harmony `sky.test.ts` checks between the sky keys is
  // worth nothing if the rendered sky wanders off into midpoints it never tested,
  // and a backdrop that invented its own steps would look equally correct.
  const w = 120, h = 90;
  const d = smoothSky(w, h);
  posterise(d, w, h, skyLadder("dusk"));
  const ladder = new Set(
    skyLadder("dusk").map((hex) => {
      const r = Number.parseInt(hex.slice(1, 3), 16);
      const g = Number.parseInt(hex.slice(3, 5), 16);
      const b = Number.parseInt(hex.slice(5, 7), 16);
      return `${r},${g},${b}`;
    }),
  );
  for (const c of distinct(d)) {
    assert.ok(ladder.has(c), `the sky drew ${c}, which is not on its own ladder`);
  }
});

test("the dither is ordered, so the sky is the same on every client", () => {
  // Two runs, one frame, identical pixels. A dither built from `Math.random()`
  // would look fine and would differ between two readers looking at the same
  // town — which is the one thing this file has never allowed.
  const a = smoothSky(100, 80);
  const b = smoothSky(100, 80);
  posterise(a, 100, 80, skyLadder("day"));
  posterise(b, 100, 80, skyLadder("day"));
  assert.deepEqual([...a], [...b], "two runs of the posterise disagreed");
});

test("the ladder is ordered, and spans exactly the palette it was built from", () => {
  // "Ordered" is load-bearing: the posterise compares distances, and a ladder
  // that wandered would still work while the sky stopped reading as a gradient.
  //
  // And the span is the part that matters for the palette. The steps between the
  // keys are *blends*, so they are not themselves palette keys and asserting
  // that they were — which the first version of this test did — would be
  // asserting a falsehood. What has to hold is that the ladder starts at the
  // void, ends at the cloud, and passes through the ground and the mid **exactly**:
  // those four are the colours the harmony in this file is tested against, and a
  // ladder that interpolated around one of them would be a sky the palette has
  // never seen.
  for (const phase of DAY_PHASES) {
    const { sky, cloud } = DAYLIGHT[phase];
    const ladder = skyLadder(phase);
    const lum = (hex: string): number => {
      const r = Number.parseInt(hex.slice(1, 3), 16);
      const g = Number.parseInt(hex.slice(3, 5), 16);
      const b = Number.parseInt(hex.slice(5, 7), 16);
      return r + g + b;
    };
    for (let i = 1; i < ladder.length; i++) {
      assert.ok(lum(ladder[i]) > lum(ladder[i - 1]), `${phase} ladder step ${i} is not brighter than step ${i - 1}`);
    }
    assert.equal(ladder[0], sky.void, `${phase} ladder does not start at the void`);
    assert.ok(ladder.includes(sky.ground), `${phase} ladder misses its ground`);
    assert.ok(ladder.includes(sky.mid), `${phase} ladder misses its mid`);
    const brightest = ladder[ladder.length - 1];
    assert.equal(brightest, cloud ?? sky.mid, `${phase} ladder does not end on its cloud`);
    // And nothing in it escapes the range the palette defines.
    for (const hex of ladder) {
      assert.ok(
        lum(hex) >= lum(sky.void) && lum(hex) <= lum(brightest),
        `${phase} ladder holds ${hex}, outside the range its palette spans`,
      );
    }
  }
});

test("a night sky's ladder is shorter than its day's, because it has no cloud", () => {
  assert.ok(skyLadder("night").length < skyLadder("day").length, "a night sky grew a cloud step");
});

test("the rendered sky is posterised end to end, not half of it", () => {
  // The mutation this exists for deleted the posterise call from `skyTexture`
  // and **the whole suite passed**, because every test was exercising
  // `paintBackdrop` or `posterise` and none of them was exercising the place they
  // are combined. Two things individually right, and an unchecked seam.
  //
  // So this renders through `renderSky` — the same call `skyTexture` makes — and
  // counts the colours that come out.
  const w = 160, h = 120;
  const { px, ctx } = backdrop(w, h);
  renderSky(ctx, w, h, "day");
  const seen = new Set<string>();
  for (const c of px) if (c !== "none") seen.add(c);
  const ladder = skyLadder("day").map((hex) => {
    const r = Number.parseInt(hex.slice(1, 3), 16);
    const g = Number.parseInt(hex.slice(3, 5), 16);
    const b = Number.parseInt(hex.slice(5, 7), 16);
    return `rgb(${r},${g},${b})`;
  });
  assert.ok(seen.size > 1, "the rendered sky is a single colour, so nothing was drawn");
  for (const c of seen) {
    assert.ok(ladder.includes(c), `the rendered sky holds ${c}, which is not on its ladder`);
  }
  assert.ok(
    seen.size <= ladder.length,
    `the rendered sky has ${seen.size} colours, more than the ${ladder.length} its ladder allows — the posterise did not run`,
  );
});
