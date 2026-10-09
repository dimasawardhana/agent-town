// test/turn-dependence.test.ts
import { strict as assert } from "node:assert";
import { test } from "node:test";

// src/art/palette.ts
var P = {
  // --- Terrain -----------------------------------------------------------
  // The void behind everything, and the base of the sky the town sits in.
  void: "#0e141c",
  // The sky, which exists only in the generated backdrop and is never baked —
  // so these are the colours the town is seen against, and nothing else in the
  // art is allowed to use them. Keeping them here rather than inline in the sky
  // module is what makes "the backdrop is the only user" a checkable claim
  // rather than a convention, and `sky.test.ts` is what checks it.
  skyZenith: "#1a2740",
  skyMid: "#3d5570",
  skyHaze: "#7d8a80",
  skyGlow: "#c9a86a",
  skyFar: "#4a5f72",
  skyNear: "#2a3a4a",
  // The plain the island sits on: below the horizon and behind the land.
  //
  // A desaturated relative of the grass ramp, not a different material. The
  // region is a clearing in a field, so the field around it should read as the
  // same world — and it is separated from the town by *value and saturation*
  // rather than by hue, which is what a distant field actually looks like: a
  // duller, hazier, lighter version of the same green, because that is what
  // atmosphere does to a field. A colour unrelated to the grass would have said
  // "different world"; a colour too close would say "more of your land", and the
  // ground tiles already draw that edge themselves.
  skyGround: "#46524a",
  // Ground tones, hue-shifted from a cool shadow green to a warm lit green.
  grass: ["#1d3327", "#274632", "#32583d", "#3e6b49"],
  grassLit: "#4a7d54",
  earth: ["#3a2c1e", "#543f2a", "#6f5436", "#8c6d45"],
  // The Yard is packed dirt, warmer and lighter than the grass so half a
  // session's work has somewhere legible to happen. Its two surface steps are
  // named rather than taken from the earth ramp, because packed dirt is a
  // different surface from the bare earth around it, not a darker one.
  yardFloorDark: "#61492f",
  yardFloorLit: "#96784f",
  // --- Wood --------------------------------------------------------------
  // The town's most-used material: scaffolding, framing, planks, props.
  wood: ["#4a3320", "#6d4c2c", "#94693c", "#c39558"],
  // --- Roofs -------------------------------------------------------------
  // Terracotta, hue-shifted rather than desaturated for its shadow side. The
  // ramp's own top step is the ridge highlight, so no separate ridge colour.
  roof: ["#5c2b22", "#833d2d", "#a85439", "#c9724a"],
  // Thatch for the lower-tier buildings, so size reads as wealth.
  thatch: ["#6b5527", "#8e7338", "#b3924c", "#d4b366"],
  // --- Stone -------------------------------------------------------------
  stone: ["#3c4149", "#575e68", "#7c858f", "#a5aeb8"],
  // --- Workers -----------------------------------------------------------
  skin: ["#7d5236", "#a8724a", "#cd9464", "#e6b688"],
  tunic: ["#3f2415", "#6b3f22", "#8f5a30", "#b07c45"],
  leather: "#4a3422",
  metal: ["#4c545e", "#77828d", "#a3aeb9", "#d2dae2"],
  // Chief and sub helmets. These two are load-bearing: they are how a glance
  // separates the agent driving the session from what it spawned (ADR-0007).
  helmetChief: ["#8a6414", "#bd8f1d", "#e6bb38", "#f7dc72"],
  helmetSub: ["#5b646e", "#8b959f", "#bcc5cd", "#e6ecf1"],
  // --- Walls -------------------------------------------------------------
  // Daub-and-plaster with exposed timber, which is the wall of the town's
  // lower tiers. Added deliberately rather than improvised per building: a
  // wall colour invented at a call site is how a palette drifts.
  plaster: ["#4e4238", "#7d6d5c", "#a89480", "#cfbb9d"],
  // Window glass, taking the sky rather than the inside of the room. It reads
  // as a window at four pixels wide only because it is the only cool blue in
  // the building palette. Four steps like every other ramp: a step of pure
  // highlight is what catches the eye at 1x, and a three-step ramp would have
  // had to fake it by reusing the midtone.
  glass: ["#1e2a33", "#2f4048", "#4a6270", "#7191a4"],
  // A lit window, and only a lit window. The one warm emissive in the town, and
  // the reason it is safe: `glass` is the only cool blue on a facade, so warm is
  // unambiguous against it, and nothing else in the palette is allowed to be
  // this bright and this warm at once. `accent` is gold and is the chief's flag
  // and the panel's live marks — a lamp the same gold would read as a session
  // badge, which is the exact confusion the pennant's colour was moved off to
  // avoid. So this is amber where that is yellow, and a step deeper for the
  // night phase, where the sky is dark enough for the warm thing to be the only
  // warm thing.
  lamp: "#e8a94a",
  // --- Plant and equipment -----------------------------------------------
  // The Yard and the Workshop hold things that are neither timber nor bright
  // steel: tarpaulins, hoses, aged iron. One ramp per material, and each is
  // here rather than at a call site because these materials appear on several
  // props — a prop that invented its own brown would be the start of a second
  // palette, which is what this file exists to prevent.
  //
  // `rust` takes a cooler, less saturated shadow than `roof` does, because
  // oxidised iron in shade goes grey-brown where terracotta stays warm. That
  // single difference is what stops a rusted skip reading as a clay pot.
  rust: ["#452a2b", "#6b3d28", "#935231", "#b46c3d"],
  // Canvas: tarpaulins, sackcloth, rope. Slightly olive, because the town's
  // green is spoken for by grass and a second green would compete with it.
  canvas: ["#3f4230", "#5f6244", "#83865f", "#a7ab7e"],
  // Rubber and cable: tyres, hose, sheathing. The darkest ramp in the palette
  // after ink, which is what makes a tyre read as a hole in the ground rather
  // than as a grey box.
  rubber: ["#211e20", "#332f37", "#49444e", "#635d69"],
  // --- Placard plates ----------------------------------------------------
  // The boards behind the map's lettering. They live here rather than as
  // literals in `placard.ts` for the reason the rest of this palette exists:
  // `assertPaletteClean` refuses any colour not in `P`, so a plate invented at
  // a call site fails the boot instead of shipping. Three tones, because a
  // label's role is readable from its board before its text is — a place's name
  // is the loudest thing on the map, and a worker's caption is deliberately the
  // quietest.
  plateWarm: "#2b1f10",
  plateCool: "#1b1a20",
  plateDim: "#241d16",
  // One outline colour for the whole town.
  ink: "#140f0b",
  // Labels are drawn in near-white; pure white would glare at this scale.
  paper: "#e8e0cd",
  paperDim: "#a89f8c",
  /** The accent: the chief's helmet yellow, used for the flag on a finished
   *  session and for the panel's live-state marks. Never decoration. */
  accent: "#e6bb38",
  accentDim: "#8a6414"
};

// src/art/surface.ts
function rgba(hex2, alpha = 255) {
  const h = hex2.startsWith("#") ? hex2.slice(1) : hex2;
  const n = parseInt(h, 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255, alpha];
}
function hex(r, g, b) {
  return "#" + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1);
}
var TRANSPARENT = [0, 0, 0, 0];
var Pix = class _Pix {
  w;
  h;
  data;
  constructor(w, h) {
    if (w <= 0 || h <= 0) throw new Error(`Pix: bad size ${w}x${h}`);
    this.w = w;
    this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }
  /** inBounds reports whether a coordinate is inside the surface. */
  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  /** isOpaque reports whether a pixel holds anything. */
  isOpaque(x, y) {
    if (!this.inBounds(x, y)) return false;
    return this.data[(y * this.w + x) * 4 + 3] !== 0;
  }
  /** at returns a pixel's bytes, or fully transparent outside the surface. */
  at(x, y) {
    if (!this.inBounds(x, y)) return TRANSPARENT;
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }
  /** set places one pixel. Out-of-bounds writes are dropped, so callers may
   *  draw shapes that overhang the edge without guarding every coordinate. */
  set(x, y, ink, alpha = 255) {
    if (typeof x !== "number" || typeof y !== "number") return this;
    x = Math.round(x);
    y = Math.round(y);
    if (!this.inBounds(x, y)) return this;
    const [r, g, b, a] = typeof ink === "string" ? rgba(ink, alpha) : ink;
    const i = (y * this.w + x) * 4;
    this.data[i] = r;
    this.data[i + 1] = g;
    this.data[i + 2] = b;
    this.data[i + 3] = typeof ink === "string" ? a : a;
    return this;
  }
  /** blit copies another surface in, skipping its transparent pixels. The
   *  whole compositor rests on this: draw parts, place them. */
  blit(src, dx, dy) {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const [r, g, b, a] = src.at(x, y);
        if (a === 0) continue;
        this.set(dx + x, dy + y, [r, g, b, a]);
      }
    }
    return this;
  }
  /** replace swaps one colour for another across the surface. The helmet and
   *  crew colours are applied this way: the art is drawn once and recoloured,
   *  never redrawn per variant. */
  replace(from, to) {
    const [fr, fg, fb] = rgba(from);
    for (let i = 0; i < this.data.length; i += 4) {
      if (this.data[i] === fr && this.data[i + 1] === fg && this.data[i + 2] === fb && this.data[i + 3] !== 0) {
        const [r, g, b] = rgba(to);
        this.data[i] = r;
        this.data[i + 1] = g;
        this.data[i + 2] = b;
      }
    }
    return this;
  }
  /**
   * outline returns a copy of the cel with `ink` in every transparent pixel
   * whose left, right, above or below neighbour is opaque.
   *
   * The test is orthogonal, so a pixel that touches the art only at a corner
   * stays empty, and the pass never inks over a pixel that is already opaque. A
   * hole punched through the middle of a shape is outlined exactly like the
   * shape's outer edge — that is the same rule applied twice, not an oversight.
   *
   * Done as a separate pass, on the assembled cel rather than on each part, so
   * joints between parts do not acquire interior lines. A uniform 1px outline
   * at every size is the consistency rule the reference names, and this is the
   * only place it is implemented.
   */
  outline(ink) {
    const out = this.clone();
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.isOpaque(x, y)) continue;
        if (this.isOpaque(x - 1, y) || this.isOpaque(x + 1, y) || this.isOpaque(x, y - 1) || this.isOpaque(x, y + 1)) {
          out.set(x, y, ink);
        }
      }
    }
    return out;
  }
  /** vline fills a vertical run. `IsoPix.column` is built on it: a wall face is
   *  a stack of these at one picture x, which is what keeps a wall solid. */
  vline(x, y0, y1, ink) {
    for (let y = y0; y <= y1; y++) this.set(x, y, ink);
    return this;
  }
  /** colours lists every distinct colour present. It is how the art
   *  verification asserts that no cel introduced a colour the palette does not
   *  contain, which the boot-time bake cannot check for the whole atlas. */
  colours() {
    const seen = /* @__PURE__ */ new Set();
    for (let i = 0; i < this.data.length; i += 4) {
      if (this.data[i + 3] === 0) continue;
      seen.add(hex(this.data[i], this.data[i + 1], this.data[i + 2]));
    }
    return [...seen].sort();
  }
  /** empty reports whether anything was drawn at all. A blank cel is always a
   *  bug rather than a style choice, so the art checks assert against it. */
  empty() {
    for (let i = 3; i < this.data.length; i += 4) if (this.data[i] !== 0) return false;
    return true;
  }
  clone() {
    const out = new _Pix(this.w, this.h);
    out.data.set(this.data);
    return out;
  }
  /**
   * drawInto rasterises onto a 2D context at an integer offset, with smoothing
   * forced off.
   *
   * imageSmoothingEnabled is set here as well as on the game: the bake happens
   * through this method, and a texture built with smoothing on would be
   * permanently soft however Phaser later samples it.
   */
  drawInto(ctx, dx, dy) {
    const img = ctx.createImageData(this.w, this.h);
    img.data.set(this.data);
    const off = document.createElement("canvas");
    off.width = this.w;
    off.height = this.h;
    const octx = off.getContext("2d");
    if (!octx) throw new Error("Pix: no 2d context");
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, dx, dy);
  }
  /** toCanvas makes a standalone canvas, for the contact sheet. */
  toCanvas() {
    const c = document.createElement("canvas");
    c.width = this.w;
    c.height = this.h;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Pix: no 2d context");
    this.drawInto(ctx, 0, 0);
    return c;
  }
};

// src/view.ts
var TURNS = [0, 1, 2, 3];
var TURN_COUNT = TURNS.length;
function normaliseTurn(n) {
  return (n % TURN_COUNT + TURN_COUNT) % TURN_COUNT;
}
function turnPoint(turn, x, y) {
  switch (turn) {
    case 1:
      return { x: y, y: -x };
    case 2:
      return { x: -x, y: -y };
    case 3:
      return { x: -y, y: x };
    default:
      return { x, y };
  }
}

// src/art/iso.ts
var IsoPix = class {
  pix;
  ox;
  oy;
  turn;
  /**
   * The world-space extent of everything plotted, accumulated as it happens.
   *
   * `track` is off by default because the walk is per plotted pixel and almost
   * nothing asks the question: the buildings, the workers and the machines all
   * know their own footprints already, and only a prop needs its own measured.
   */
  track;
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;
  /**
   * How many picture pixels one world unit is worth, on every axis at once.
   *
   * This scales the *world* the drawing is authored in, not the picture after
   * it: a box asked for at `box(0, 0, 14, 14, 0, 12)` under `scale` 2 lands on
   * exactly the pixels a 28-unit box lands on, and a 1px ink line stays 1px
   * either way. Scaling the finished picture instead would double the outline
   * along with everything else, which is the one thing that must not double —
   * at 2 the ink was a third of every prop's picture, and at 4 it would be a
   * grid.
   *
   * Integral for the same reason. A fractional scale makes some world steps two
   * pixels and their neighbours one, which is the defect `follow.ts` clamps zoom
   * to whole numbers to rule out.
   */
  scale;
  constructor(w, h, ox, oy, turn = 0, opts = {}) {
    this.pix = new Pix(w, h);
    this.ox = ox;
    this.oy = oy;
    this.turn = normaliseTurn(turn);
    this.track = opts.track ?? false;
    this.scale = Math.max(1, Math.round(opts.scale ?? 1));
  }
  /**
   * footprintOf returns the world rectangle every plotted point fell inside, or
   * null when the surface is empty or was not built to measure.
   *
   * `z` deliberately does not enter the answer. Height moves a point up its own
   * picture column and never sideways in the world, so a drawing's x/y extent is
   * already the footprint it stands on — and a footprint is what a cast shadow
   * is a picture of.
   *
   * Measured rather than declared because a table of fifty-two footprints would
   * be a second copy of every prop's geometry: correct on the day it was typed
   * and silently wrong the first time a drawer moved. This cannot drift, and it
   * handles the tools that draw off the origin — a chisel starts at world x −8
   * — without anybody having to notice and write the minus sign down.
   */
  footprintOf() {
    if (!this.track || this.minX > this.maxX) return null;
    return { x: this.minX, y: this.minY, w: this.maxX - this.minX, h: this.maxY - this.minY };
  }
  /** project maps a world point to this surface's pixel coordinates. */
  project(wx, wy, z = 0) {
    const k = this.scale;
    const p = turnPoint(this.turn, wx * k, wy * k);
    return {
      x: (p.x - p.y) / 2 + this.ox,
      y: (p.x + p.y) / 4 - z * k + this.oy
    };
  }
  /**
   * plot places one world point.
   *
   * Rounding is half-up and monotonic in each axis, so a run of world points
   * that steps by one unit produces a gapless stair rather than a dotted line.
   */
  plot(wx, wy, z, ink) {
    const p = this.project(wx, wy, z);
    this.pix.set(Math.round(p.x), Math.round(p.y), ink);
    if (this.track) {
      if (wx < this.minX) this.minX = wx;
      if (wx > this.maxX) this.maxX = wx;
      if (wy < this.minY) this.minY = wy;
      if (wy > this.maxY) this.maxY = wy;
    }
    return this;
  }
  /**
   * column fills a vertical pixel run between two heights at one world point.
   *
   * A wall face's screen x depends only on its horizontal world coordinate, so
   * a face is exactly a stack of these. Filling this way instead of plotting
   * every (height, depth) pair is what keeps a wall solid: it cannot leave the
   * single-pixel gaps that a naive 3D loop does when two world steps land on
   * the same pixel.
   */
  column(wx, wy, zBottom, zTop, ink) {
    const top = this.project(wx, wy, zTop);
    const bottom = this.project(wx, wy, zBottom);
    const x = Math.round(top.x);
    const y0 = Math.round(top.y);
    const y1 = Math.round(bottom.y);
    this.pix.vline(x, Math.min(y0, y1), Math.max(y0, y1), ink);
    return this;
  }
  /** horizontal steps along world x at a fixed y, used for ground and beams. */
  row(wx0, wx1, wy, z, ink) {
    for (let wx = wx0; wx <= wx1; wx++) this.plot(wx, wy, z, ink);
    return this;
  }
  /**
   * footprint fills a world rectangle lying flat at height `z`.
   *
   * This is the ground of every plot and the base of every building, so it is
   * also the shape a shadow takes. The two loops walk world coordinates; the
   * overlap they produce is what makes the fill solid.
   */
  footprint(x, y, w, h, z, ink) {
    for (let wy = y; wy <= y + h; wy++) {
      for (let wx = x; wx <= x + w; wx++) this.plot(wx, wy, z, ink);
    }
    return this;
  }
  /** footprintRim draws only the outline of a footprint, 1px, in the order the
   *  edges appear on screen so a broken rim can be closed deliberately. */
  footprintRim(x, y, w, h, z, ink) {
    for (let wx = x; wx <= x + w; wx++) {
      this.plot(wx, y, z, ink);
      this.plot(wx, y + h, z, ink);
    }
    for (let wy = y; wy <= y + h; wy++) {
      this.plot(x, wy, z, ink);
      this.plot(x + w, wy, z, ink);
    }
    return this;
  }
  /**
   * faceMid is the world midpoint of a face.
   *
   * A midpoint rather than a corner, because for a square footprint a corner is
   * shared by two faces and therefore cannot distinguish them.
   */
  faceMid(f) {
    return f.axis === 0 ? { x: f.fixed, y: (f.from + f.to) / 2 } : { x: (f.from + f.to) / 2, y: f.fixed };
  }
  /**
     * frontCorner is the footprint corner nearest the camera, for a square of
     * `side` at the origin.
     *
     * Anything drawn *on* a building rather than *of* it has to ask this, because
     * a fixed world coordinate is only ever on the right corner at one turn. That
     * is not a small error: the verification pennant was anchored at
     * (0.6s, 0.28s), which is a roof corner at turn 0 and empty air at turn 1 — so
     * the flag appeared to float beside the building as soon as the town turned.
     *
     * Ties are broken on screen x, so the choice is the same every time for a
     * given turn rather than depending on sort order — the flag must not hop from
     * one corner to another as the art is re-baked.
     */
  frontCorner(side) {
    const corners = [
      { x: 0, y: 0 },
      { x: side, y: 0 },
      { x: 0, y: side },
      { x: side, y: side }
    ];
    const best = corners.reduce((a, b) => {
      const da = this.depth(a.x, a.y);
      const db = this.depth(b.x, b.y);
      if (db !== da) return db > da ? b : a;
      return this.screenX(b.x, b.y) > this.screenX(a.x, a.y) ? b : a;
    });
    return best;
  }
  /**
   * depth is how near a world point is to the camera, larger being nearer.
   *
   * The projection puts larger `x + y` lower on screen, and lower on screen is
   * nearer the viewer for anything standing on the ground. Derived from the
   * turned point rather than from a table of which axis is near at which turn,
   * so it cannot disagree with the projection it is deciding about.
   */
  depth(wx, wy) {
    const p = turnPoint(this.turn, wx, wy);
    return p.x + p.y;
  }
  /** screenX is the picture-space horizontal position of a world point, which
   *  is what decides which of two visible faces reads as lit. */
  screenX(wx, wy) {
    const p = turnPoint(this.turn, wx, wy);
    return p.x - p.y;
  }
  /**
   * visibleFaces picks the two walls of a box the camera can see, and says which
   * of them catches the light.
   *
   * The old code hard-coded the world faces at `x+w` and `y+h`, which is correct
   * only for an unrotated town: turn the world and those two become the *far*
   * walls, hidden behind the box's own top, and a tower renders with no walls at
   * all. Choosing by turned screen position is the general form of the same
   * rule and reduces to it exactly at turn 0.
   *
   * Light is assigned by screen position, not by world axis, because the light is
   * fixed in the picture (`palette.ts`): the face on the picture's left flank
   * catches it whichever world wall that happens to be.
   */
  visibleFaces(x, y, w, h) {
    const candidates = [
      { axis: 0, fixed: x + w, from: y, to: y + h },
      { axis: 0, fixed: x, from: y, to: y + h },
      { axis: 1, fixed: y + h, from: x, to: x + w },
      { axis: 1, fixed: y, from: x, to: x + w }
    ];
    const ordered = [...candidates].sort((a, b) => {
      const ma = this.faceMid(a);
      const mb = this.faceMid(b);
      return this.depth(mb.x, mb.y) - this.depth(ma.x, ma.y);
    });
    const two = ordered.slice(0, 2);
    two.sort((a, b) => {
      const ma = this.faceMid(a);
      const mb = this.faceMid(b);
      return this.screenX(ma.x, ma.y) - this.screenX(mb.x, mb.y);
    });
    return { lit: two[0], shadow: two[1] };
  }
  /**
   * runFace fills one wall, walking it far-to-near.
   *
   * The order only matters where two faces meet, at the shared vertical corner:
   * whichever is drawn second owns that pixel column. Walking far-to-near is what
   * keeps the nearer face's edge intact, and at turn 0 it is the ascending walk
   * the hard-coded version used, so the unrotated picture is unchanged.
   */
  runFace(f, zBottom, zTop, ink) {
    const near = f.axis === 0 ? this.depth(f.fixed, f.to) > this.depth(f.fixed, f.from) : this.depth(f.to, f.fixed) > this.depth(f.from, f.fixed);
    if (near) {
      for (let v = f.from; v <= f.to; v++) this.columnAt(f, v, zBottom, zTop, ink);
    } else {
      for (let v = f.to; v >= f.from; v--) this.columnAt(f, v, zBottom, zTop, ink);
    }
  }
  /** columnAt raises one column of a wall at the run's offset `v`. */
  columnAt(f, v, zBottom, zTop, ink) {
    if (f.axis === 0) this.column(f.fixed, v, zBottom, zTop, ink);
    else this.column(v, f.fixed, zBottom, zTop, ink);
  }
  /**
   * rect3d draws an axis-aligned world box.
   *
   * Of the four walls only two are ever visible from a fixed camera: the ones
   * at x+w and y+h. In the picture the y+h wall lies on the lower-left flank
   * and the x+w wall on the lower-right, so they are named `lit` and `shadow`:
   * the light is up and to the left, so the lower-left wall catches it and the
   * lower-right turns away. Naming them by world axis instead keeps being read
   * backwards at every call site.
   */
  box(x, y, w, h, zBottom, zTop, shade) {
    const { lit, shadow } = this.visibleFaces(x, y, w, h);
    this.runFace(shadow, zBottom, zTop, shade.shadow);
    this.runFace(lit, zBottom, zTop, shade.lit);
    const rowsNearerWithY = this.depth(x, y + h) > this.depth(x, y);
    for (let i = 0; i <= h; i++) {
      const wy = rowsNearerWithY ? y + i : y + h - i;
      for (let wx = x; wx <= x + w; wx++) this.plot(wx, wy, zTop, shade.top);
    }
    if (shade.edge) {
      for (let v = shadow.from; v <= shadow.to; v++) this.edgeAt(shadow, v, zBottom, shade.edge);
      for (let v = lit.from; v <= lit.to; v++) this.edgeAt(lit, v, zBottom, shade.edge);
    }
    return this;
  }
  /**
   * litWall and shadowWall are the two visible walls of a square footprint.
   *
   * Art that decorates a *face* — windows, a door, the spoil a footing leaves —
   * must go on whichever world walls the camera can currently see, and must put
   * its light-side decoration on whichever of those catches the light. Passing
   * the face rather than a world axis is what makes one drawing routine serve
   * all four orientations: at turn 0 these resolve to the `y = side` and
   * `x = side` faces the art was originally written against, so the unrotated
   * picture is unchanged.
   */
  litWall(side) {
    return this.visibleFaces(0, 0, side, side).lit;
  }
  shadowWall(side) {
    return this.visibleFaces(0, 0, side, side).shadow;
  }
  /**
   * wallAt is the world point at offset `u` along a face's own run.
   *
   * `u` runs 0..side in increasing world coordinate along the face, so a
   * drawing's left-to-right in `u` turns with the wall it is on. Decoration that
   * is asymmetric on purpose — `windows` spaces its lit-wall openings wider than
   * its shadow-wall ones — therefore stays asymmetric the same way round after a
   * turn, rather than mirroring because the underlying axis changed.
   */
  wallAt(f, u) {
    return f.axis === 0 ? { x: f.fixed, y: f.from + u } : { x: f.from + u, y: f.fixed };
  }
  /** wallPlot places one pixel on a face at offset `u`, height `z`. */
  wallPlot(f, u, z, ink) {
    const p = this.wallAt(f, u);
    return this.plot(p.x, p.y, z, ink);
  }
  /** wallColumn raises a pixel run on a face at offset `u`. */
  wallColumn(f, u, zBottom, zTop, ink) {
    const p = this.wallAt(f, u);
    return this.column(p.x, p.y, zBottom, zTop, ink);
  }
  /** edgeAt plots the ground-level pixel of a wall's run. */
  edgeAt(f, v, z, ink) {
    if (f.axis === 0) this.plot(f.fixed, v, z, ink);
    else this.plot(v, f.fixed, z, ink);
  }
  /**
   * gable draws a pitched roof over a footprint.
   *
   * The ridge runs along world x, which from this camera reads as the roof
   * sloping toward and away from the viewer — the silhouette that says "house"
   * at a glance, where a flat roof says "warehouse".
   *
   * Both slopes are walked far-to-near and filled at every world x, so the
   * surface is solid rather than a set of depth lines. The near slope is drawn
   * last and takes the ridge pixel, which is what makes the ridge line itself
   * separate the two planes instead of needing its own stroke.
   */
  gable(x, y, w, h, zEave, height, shade) {
    const alongX = this.ridgeRunsAlongX();
    const ridgeFrom = alongX ? x : y;
    const ridgeTo = alongX ? x + w : y + h;
    const acrossFrom = alongX ? y : x;
    const acrossTo = alongX ? y + h : x + w;
    const acrossHalf = Math.max(1, (acrossTo - acrossFrom) / 2);
    const ridgeMid = Math.round(acrossFrom + acrossHalf);
    const fromIsFar = this.depth(alongX ? x : acrossFrom, alongX ? acrossFrom : y) < this.depth(alongX ? x : acrossTo, alongX ? acrossTo : y);
    const farEnd = fromIsFar ? acrossFrom : acrossTo;
    const nearEnd = fromIsFar ? acrossTo : acrossFrom;
    const dir = nearEnd > farEnd ? 1 : -1;
    const at = (r, a) => alongX ? { wx: r, wy: a } : { wx: a, wy: r };
    for (let a = farEnd; a !== ridgeMid + dir; a += dir) {
      const z = zEave + height * (1 - Math.abs(a - (acrossFrom + acrossHalf)) / acrossHalf);
      for (let r = ridgeFrom; r <= ridgeTo; r++) {
        const p = at(r, a);
        this.plot(p.wx, p.wy, z, shade.far);
      }
    }
    for (let a = ridgeMid; a !== nearEnd + dir; a += dir) {
      const z = zEave + height * (1 - Math.abs(a - (acrossFrom + acrossHalf)) / acrossHalf);
      for (let r = ridgeFrom; r <= ridgeTo; r++) {
        const p = at(r, a);
        this.plot(p.wx, p.wy, z, Math.abs(a - ridgeMid) <= 0 ? shade.ridge : shade.near);
      }
    }
    for (let a = acrossFrom; a <= acrossTo; a++) {
      const z = zEave + height * (1 - Math.abs(a - (acrossFrom + acrossHalf)) / acrossHalf);
      const r = alongX ? x + w : y + h;
      const p = at(r, a);
      this.column(p.wx, p.wy, zEave, z, shade.gable);
      if (shade.edge) this.plot(p.wx, p.wy, zEave, shade.edge);
    }
    return this;
  }
  /**
   * ridgeProfile roofs a footprint with a surface whose height varies along the
   * **ridge axis**, rather than across it the way `gable` does.
   *
   * That one difference is what makes a sawtooth expressible. A gable's profile is
   * a triangle across the span: every point at the same distance from the ridge is
   * at the same height, which is what "pitched roof" means. A sawtooth is the
   * opposite — its height depends on where you are *along* the ridge — so it needs
   * a primitive that sweeps a profile down the ridge's length instead of out from
   * it, and every tooth is one period of that profile.
   *
   * `profile` takes the world offset along the ridge, 0..`w` (or 0..`h` after a
   * turn), and returns the rise above `zEave`. Where the profile **falls** the
   * sweep fills a vertical face from the lower height up to the higher one, which
   * is both what makes the surface solid and what gives a sawtooth its glazed
   * flank — the drop between two teeth is a real plane of the roof, not a gap.
   *
   * The ridge axis is chosen by the same `ridgeRunsAlongX` test `gable` uses, so
   * the serration stays across the viewer's line of sight as the town turns, and
   * both roof shapes turn with the world rather than with the camera.
   */
  ridgeProfile(x, y, w, h, zEave, profile, shade) {
    const alongX = this.ridgeRunsAlongX();
    const from = alongX ? x : y;
    const to = alongX ? x + w : y + h;
    const acrossFrom = alongX ? y : x;
    const acrossTo = alongX ? y + h : x + w;
    const at = (r, a) => alongX ? { wx: r, wy: a } : { wx: a, wy: r };
    const fromIsFar = this.depth(alongX ? x : acrossFrom, alongX ? acrossFrom : y) < this.depth(alongX ? x : acrossTo, alongX ? acrossTo : y);
    const farEnd = fromIsFar ? acrossFrom : acrossTo;
    const nearEnd = fromIsFar ? acrossTo : acrossFrom;
    const step = nearEnd > farEnd ? 1 : -1;
    for (let a = farEnd; step > 0 ? a <= nearEnd : a >= nearEnd; a += step) {
      let prev = 0;
      for (let r = from; r <= to; r++) {
        const rise = profile(r - from);
        const p = at(r, a);
        if (r > from) {
          this.column(
            p.wx,
            p.wy,
            zEave + Math.min(prev, rise),
            zEave + Math.max(prev, rise),
            rise >= prev ? shade.surface : shade.face
          );
        }
        this.plot(p.wx, p.wy, zEave + rise, shade.surface);
        prev = rise;
      }
    }
    return this;
  }
  /**
   * dome roofs a footprint with a surface whose height depends on **distance from
   * the centre**, falling to the eave at the perimeter.
   *
   * The third and last way a roof can vary, after `gable` (height varies across the
   * ridge) and `ridgeProfile` (height varies along it). A dome varies in *both*
   * directions at once, which is exactly why it cannot be expressed with either:
   * both of those sweep a one-dimensional profile, and a dome has no profile
   * direction — every radius is the same fall.
   *
   * `fall` takes the normalised distance from the centre, 0 at the apex and 1 at
   * the perimeter, and returns the rise above `zEave`. Passing it in rather than
   * hardcoding a hemisphere lets a kind choose its own curvature, which matters
   * because a true circle at these sizes reads as a bead rather than as a roof.
   *
   * Rows are walked far-to-near in world y, and within a row the rise is not
   * constant — so like `ridgeProfile` this must fill between consecutive steps or
   * the surface comes out as a lattice. It does both: the span between neighbours
   * inside a row, and nothing between rows, because adjacent rows differ by a
   * quarter pixel once the fall is normalised.
   */
  dome(x, y, w, h, zEave, fall, shade) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    const rx = Math.max(1, w / 2);
    const ry = Math.max(1, h / 2);
    for (let wy = y; wy <= y + h; wy++) {
      let prev = -1;
      for (let wx = x; wx <= x + w; wx++) {
        const dx = (wx - cx) / rx;
        const dy = (wy - cy) / ry;
        const t = Math.min(1, Math.sqrt(dx * dx + dy * dy));
        const rise = fall(t);
        const ink = rise >= fall(0) * 0.66 ? shade.top : wy < cy ? shade.far : shade.near;
        this.plot(wx, wy, zEave + rise, ink);
        if (prev >= 0) {
          this.column(
            wx,
            wy,
            zEave + Math.min(prev, rise),
            zEave + Math.max(prev, rise),
            rise >= prev ? ink : shade.eave
          );
        }
        prev = rise;
      }
    }
    return this;
  }
  /**
   * ridgeRunsAlongX says whether the roof's ridge follows world x at this turn.
   *
   * The ridge reads as a roof because it lies across the viewer's line of sight.
   * In picture space a line's horizontal extent is driven by `(x - y)`, so the
   * axis whose turned endpoints differ most in `x - y` is the one across the
   * view — which at turn 0 is world x, and at turn 1 is world y.
   */
  ridgeRunsAlongX() {
    const xSpan = Math.abs(this.screenX(1, 0) - this.screenX(0, 0));
    const ySpan = Math.abs(this.screenX(0, 1) - this.screenX(0, 0));
    return xSpan >= ySpan;
  }
  /** beam draws a horizontal member at height z along world x: scaffolding,
   *  framing, a fence rail. */
  beamX(x0, x1, wy, z, ink, thick = 1) {
    for (let wx = x0; wx <= x1; wx++) {
      for (let d = 0; d < thick; d++) this.plot(wx, wy, z - d, ink);
    }
    return this;
  }
  /** beamY is the same along world y. */
  beamY(y0, y1, wx, z, ink, thick = 1) {
    for (let wy = y0; wy <= y1; wy++) {
      for (let d = 0; d < thick; d++) this.plot(wx, wy, z - d, ink);
    }
    return this;
  }
  /** post raises a single member from the ground: stakes, scaffolding poles. */
  post(wx, wy, zBottom, zTop, ink, thick = 1) {
    for (let d = 0; d < thick; d++) {
      this.column(wx, wy, zBottom, zTop, ink);
      if (thick > 1) this.plot(wx, wy, zTop - d, ink);
    }
    return this;
  }
  /**
   * tintRect darkens or lightens every opaque pixel inside a screen-space
   * rectangle. It is the cheap way to add a form shadow after the fact — under
   * an eave, beside a doorway — without re-running a fill with another colour.
   */
  tintRect(x0, y0, x1, y1, ink, amount) {
    const [tr, tg, tb] = rgba(ink);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const [r, g, b, a] = this.pix.at(x, y);
        if (a === 0) continue;
        this.pix.set(x, y, [
          r + (tr - r) * amount,
          g + (tg - g) * amount,
          b + (tb - b) * amount,
          a
        ]);
      }
    }
    return this;
  }
  /** outline inks the whole surface's outer edge. */
  outline(ink) {
    return this.pix.outline(ink);
  }
};

// src/art/stack.ts
var STOREY = 20;

// src/art/roof.ts
var ARCHETYPES = [
  "tenement",
  "works",
  "cottage",
  "hall",
  "library",
  "stadium",
  "hospital",
  "chapel",
  "tower",
  "market",
  "school",
  "restaurant"
];
function hashPath(path) {
  let h = 0;
  for (let i = 0; i < path.length; i++) h = h * 31 + path.charCodeAt(i) | 0;
  return h;
}
function pitchedRamp(side) {
  return side <= 44 ? P.thatch : P.roof;
}
function pitchedGable(side) {
  return side <= 60 ? P.plaster[2] : P.stone[2];
}
var pitched = {
  height(side) {
    if (side <= 44) return 12;
    if (side <= 60) return 16;
    if (side <= 78) return 20;
    return 22;
  },
  trim(iso, side) {
    const ink = side <= 60 ? P.plaster[0] : P.stone[0];
    iso.beamX(0, side, side, 0, ink, 1);
    iso.beamY(0, side, side, 0, ink, 1);
  },
  draw(iso, side, eave) {
    const overhang = 2;
    iso.gable(-overhang, -overhang, side + overhang * 2, side + overhang * 2, eave, pitched.height(side), {
      near: pitchedRamp(side)[2],
      far: pitchedRamp(side)[1],
      ridge: pitchedRamp(side)[3],
      gable: pitchedGable(side),
      edge: P.ink
    });
  },
  stack(iso, side, top) {
    if (side < 60) return;
    const cx = Math.round(side * 0.22);
    iso.box(cx, Math.round(side * 0.42), 7, 7, top - 6, top + 8, {
      top: P.stone[3],
      lit: P.stone[2],
      shadow: P.stone[1],
      edge: P.ink
    });
  },
  damage(iso, side, top) {
    const hx = Math.round(side / 2);
    const hy = Math.round(side / 2);
    iso.footprint(hx, hy, 6, 6, top, pitchedRamp(side)[0]);
    iso.beamX(hx, hx + 6, hy + 3, top, P.wood[1], 1);
  }
};
var flat = {
  height: () => 6,
  trim(iso, side) {
    iso.beamX(0, side, side, 0, P.stone[0], 1);
    iso.beamY(0, side, side, 0, P.stone[0], 1);
  },
  draw(iso, side, eave) {
    const overhang = 2;
    iso.box(-overhang, -overhang, side + overhang * 2, side + overhang * 2, eave, eave + flat.height(side), {
      top: P.stone[3],
      lit: P.stone[2],
      shadow: P.stone[1],
      edge: P.ink
    });
  },
  stack(iso, side, top) {
    const w = Math.max(5, Math.round(side / 8));
    const a = Math.round(side * 0.24);
    const b = Math.round(side * 0.58);
    iso.box(a, b, w, w, top, top + 7, {
      top: P.stone[3],
      lit: P.stone[2],
      shadow: P.stone[1],
      edge: P.ink
    });
  },
  damage(iso, side, top) {
    const d = Math.max(6, Math.round(side / 6));
    const hx = Math.round(side * 0.34);
    const hy = Math.round(side * 0.34);
    iso.footprint(hx, hy, d, d, top, P.ink);
    iso.footprint(hx + 1, hy + 1, d - 2, d - 2, top + 1, P.stone[0]);
  }
};
var sawtooth = {
  height(side) {
    if (side <= 44) return 10;
    if (side <= 60) return 12;
    if (side <= 78) return 16;
    return 18;
  },
  trim() {
  },
  draw(iso, side, eave) {
    const overhang = 2;
    const teeth = 3;
    const period = (side + overhang * 2) / teeth;
    const rise = sawtooth.height(side);
    const climb = 0.68;
    iso.ridgeProfile(
      -overhang,
      -overhang,
      side + overhang * 2,
      side + overhang * 2,
      eave,
      (along) => {
        const t = (along % period + period) % period;
        const flat2 = period * climb;
        return t <= flat2 ? rise * t / flat2 : rise * (1 - (t - flat2) / (period - flat2));
      },
      { surface: P.metal[2], face: P.glass[2], edge: P.ink }
    );
  },
  stack(iso, side, top) {
    const w = Math.max(4, Math.round(side / 12));
    const a = Math.round(side * 0.3);
    const b = Math.round(side * 0.3);
    iso.box(a, b, w, w, top - 4, top + 4, {
      top: P.metal[3],
      lit: P.metal[2],
      shadow: P.metal[1],
      edge: P.ink
    });
  },
  damage(iso, side, top) {
    const d = Math.max(5, Math.round(side / 8));
    const hx = Math.round(side * 0.3);
    const hy = Math.round(side * 0.3);
    iso.footprint(hx, hy, d, d, top, P.ink);
    iso.footprint(hx + 1, hy + 1, d - 2, d - 2, top + 1, P.metal[0]);
  }
};
var GANTRY_DECK = 5;
var gantried = {
  height(side) {
    if (side <= 44) return 14;
    if (side <= 60) return 17;
    if (side <= 78) return 20;
    return 22;
  },
  trim: (iso, side) => {
    iso.beamX(0, side, side, 0, P.metal[0], 1);
    iso.beamY(0, side, side, 0, P.metal[0], 1);
  },
  draw(iso, side, eave) {
    iso.box(0, 0, side, side, eave, eave + GANTRY_DECK, {
      top: P.metal[1],
      lit: P.metal[2],
      shadow: P.metal[0],
      edge: P.ink
    });
  },
  stack(iso, side, top) {
    const inset = Math.round(side * 0.2);
    const mastTop = top;
    const mastH = mastTop - GANTRY_DECK;
    const mastSide = Math.max(4, Math.round(side / 20));
    iso.box(inset, inset, mastSide, mastSide, GANTRY_DECK, mastTop, {
      top: P.metal[3],
      lit: P.metal[2],
      shadow: P.metal[1],
      edge: P.ink
    });
    const jibW = side - inset * 2;
    const jibD = Math.max(4, Math.round(side / 14));
    const jibOverlap = 2;
    iso.box(inset, inset, jibW, jibD, mastTop - 3, mastTop, {
      top: P.metal[3],
      lit: P.metal[2],
      shadow: P.metal[1],
      edge: P.ink
    });
    const hx = Math.round(inset + jibW * 0.62);
    const drop = Math.max(6, Math.round(mastH * 0.45));
    iso.box(hx, inset, jibD, jibD, mastTop - jibOverlap - drop, mastTop - jibOverlap, {
      top: P.metal[3],
      lit: P.metal[2],
      shadow: P.metal[1],
      edge: P.ink
    });
  },
  damage(iso, side, top) {
    const deck = GANTRY_DECK;
    const mid = Math.round(side / 2);
    iso.box(mid - 4, Math.round(side * 0.4), 8, 8, deck + 1, deck + 6, {
      top: P.metal[2],
      lit: P.metal[1],
      shadow: P.metal[0],
      edge: P.ink
    });
    const inset = Math.round(side * 0.2);
    const mastSide = Math.max(4, Math.round(side / 20));
    iso.box(inset, inset, mastSide + 4, mastSide + 4, deck, top - 5, {
      top: P.metal[1],
      lit: P.metal[0],
      shadow: P.metal[0],
      edge: P.ink
    });
  }
};
var domed = {
  height(side) {
    if (side <= 44) return 11;
    if (side <= 60) return 15;
    if (side <= 78) return 18;
    return 21;
  },
  trim(iso, side) {
    iso.beamX(0, side, side, 0, P.stone[0], 1);
    iso.beamY(0, side, side, 0, P.stone[0], 1);
  },
  draw(iso, side, eave) {
    const rise = domed.height(side);
    iso.dome(-2, -2, side + 4, side + 4, eave, (t) => {
      const curve = 1 - t * t;
      return t >= 1 ? 0 : rise * curve;
    }, {
      top: P.stone[3],
      near: P.stone[2],
      far: P.stone[1],
      eave: P.stone[0],
      edge: P.ink
    });
  },
  stack(iso, side, top) {
    const w = Math.max(4, Math.round(side / 16));
    const cx = Math.round(side / 2) - Math.round(w / 2);
    iso.box(cx, cx, w, w, top - 4, top + 3, {
      top: P.glass[3],
      lit: P.glass[2],
      shadow: P.glass[1],
      edge: P.ink
    });
  },
  damage(iso, side, top) {
    const d = Math.max(6, Math.round(side / 6));
    const hx = Math.round(side * 0.3);
    const hy = Math.round(side * 0.3);
    iso.footprint(hx, hy, d, d, top - 2, P.ink);
    iso.beamX(hx, hx + d, hy + Math.round(d / 2), top - 2, P.wood[1], 1);
  }
};
var stadium = {
  height(side) {
    if (side <= 44) return 8;
    if (side <= 60) return 9;
    if (side <= 78) return 9;
    return 8;
  },
  trim(iso, side) {
    iso.beamX(0, side, side, 0, P.stone[0], 1);
    iso.beamY(0, side, side, 0, P.stone[0], 1);
  },
  draw(iso, side, eave) {
    const rise = stadium.height(side);
    iso.dome(-3, -3, side + 6, side + 6, eave, (t) => {
      const lip = 1 - t * t * t;
      return t >= 1 ? 0 : rise * (lip * 0.55);
    }, {
      top: P.stone[3],
      near: P.stone[2],
      far: P.stone[1],
      eave: P.stone[0],
      edge: P.ink
    });
    const inner = Math.round(side * 0.5);
    const o = Math.round((side - inner) / 2);
    const z = eave + Math.max(1, Math.round(rise * 0.4));
    iso.beamX(o, o + inner, o, z, P.stone[1], 1);
    iso.beamY(o, o, o, z, P.stone[1], 1);
    iso.beamY(o + inner, o + inner, o, z, P.stone[1], 1);
  },
  stack(iso, side, top) {
    const p = Math.max(4, Math.round(side * 0.12));
    for (const [x, y] of [[p, p], [side - p, p], [p, side - p], [side - p, side - p]]) {
      iso.box(x, y, 1, 1, top - 2, top + 5, {
        top: P.stone[3],
        lit: P.stone[2],
        shadow: P.stone[1],
        edge: P.ink
      });
    }
  },
  damage(iso, side, top) {
    const d = Math.max(6, Math.round(side / 7));
    const z = top - 5;
    const hy = Math.round(side * 0.3);
    iso.footprint(0, hy, d, d, z, P.ink);
    iso.beamX(0, d, hy + Math.round(d / 2), z, P.wood[1], 1);
  }
};
var hospital = {
  height(side) {
    if (side <= 44) return 5;
    if (side <= 60) return 6;
    if (side <= 78) return 7;
    return 8;
  },
  trim(iso, side) {
    iso.beamX(0, side, side, 0, P.stone[0], 1);
    iso.beamY(0, side, side, 0, P.stone[0], 1);
  },
  draw(iso, side, eave) {
    iso.box(-2, -2, side + 4, side + 4, eave, eave + hospital.height(side) - 3, {
      top: P.plaster[3],
      lit: P.plaster[2],
      shadow: P.plaster[1],
      edge: P.ink
    });
    const w = Math.round(side * 0.4);
    const o = Math.round((side - w) / 2);
    iso.box(o, o, w, w, eave + hospital.height(side) - 3, eave + hospital.height(side), {
      top: P.plaster[3],
      lit: P.plaster[2],
      shadow: P.plaster[1],
      edge: P.ink
    });
    const c = Math.round(side * 0.16);
    const m = Math.round(side / 2);
    iso.beamX(m - c, m + c, m, eave + hospital.height(side) + 1, P.accent, 2);
    iso.beamY(m, m, m - c, eave + hospital.height(side) + 1, P.accent, 2);
  },
  stack(iso, side, top) {
    const w = Math.max(4, Math.round(side / 10));
    iso.box(Math.round(side * 0.12), Math.round(side * 0.62), w, w, top, top + 4, {
      top: P.metal[3],
      lit: P.metal[2],
      shadow: P.metal[1],
      edge: P.ink
    });
  },
  damage(iso, side, top) {
    const d = Math.max(5, Math.round(side / 9));
    iso.footprint(Math.round(side * 0.6), Math.round(side * 0.16), d, d, top, P.ink);
    iso.footprint(
      Math.round(side * 0.6) + 1,
      Math.round(side * 0.16) + 1,
      d - 2,
      d - 2,
      top + 1,
      P.stone[0]
    );
  }
};
var chapel = {
  height(side) {
    if (side <= 44) return 16;
    if (side <= 60) return 21;
    if (side <= 78) return 26;
    return 30;
  },
  trim(iso, side) {
    iso.beamX(0, side, side, 0, P.stone[0], 1);
    iso.beamY(0, side, side, 0, P.stone[0], 1);
  },
  draw(iso, side, eave) {
    const w = Math.max(10, Math.round(side * 0.46));
    const o = Math.round((side - w) / 2);
    iso.gable(o, o, w, w, eave, chapel.height(side) - 14, {
      near: P.rust[2],
      far: P.rust[1],
      ridge: P.rust[3],
      gable: P.stone[3],
      edge: P.ink
    });
    const c = Math.round(side / 2);
    let half = Math.max(2, Math.round(w * 0.16));
    let z = eave + chapel.height(side) - 14;
    for (let i = 0; i < 4; i++) {
      iso.box(c - half, c - half, half * 2, half * 2, z, z + 5, {
        top: P.rust[3],
        lit: P.rust[2],
        shadow: P.rust[1],
        edge: P.ink
      });
      z += 5;
      half = Math.max(1, half - 1);
    }
  },
  stack(iso, side, top) {
    const c = Math.round(side / 2);
    iso.box(c, c, 1, 1, top - 2, top + 3, {
      top: P.accent,
      lit: P.accent,
      shadow: P.accent,
      edge: P.ink
    });
  },
  damage(iso, side, top) {
    const d = Math.max(5, Math.round(side / 12));
    const hx = Math.round(side * 0.42);
    const hy = Math.round(side * 0.42);
    iso.footprint(hx, hy, d, d, top - 4, P.ink);
    iso.beamX(hx, hx + d, hy + Math.round(d / 2), top - 4, P.wood[1], 1);
  }
};
var tower = {
  height(side) {
    if (side <= 44) return 14;
    if (side <= 60) return 19;
    if (side <= 78) return 24;
    return 28;
  },
  trim(iso, side) {
    iso.beamX(0, side, side, 0, P.metal[0], 1);
    iso.beamY(0, side, side, 0, P.metal[0], 1);
  },
  draw(iso, side, eave) {
    const rise = tower.height(side);
    iso.box(-1, -1, side + 2, side + 2, eave, eave + rise - 6, {
      top: P.metal[3],
      lit: P.metal[2],
      shadow: P.metal[1],
      edge: P.ink
    });
    const w = Math.round(side * 0.78);
    const o = Math.round((side - w) / 2);
    iso.box(o, o, w, w, eave + rise - 6, eave + rise, {
      top: P.metal[3],
      lit: P.metal[2],
      shadow: P.metal[1],
      edge: P.ink
    });
  },
  stack(iso, side, top) {
    const c = Math.round(side * 0.5);
    const w = Math.max(4, Math.round(side / 12));
    iso.box(c, c, 1, 1, top, top + 6, {
      top: P.metal[3],
      lit: P.metal[2],
      shadow: P.metal[1],
      edge: P.ink
    });
    for (const y of [Math.round(side * 0.22), Math.round(side * 0.74)]) {
      iso.box(c - w, y, w, w, top, top + 3, {
        top: P.metal[3],
        lit: P.metal[2],
        shadow: P.metal[1],
        edge: P.ink
      });
    }
  },
  damage(iso, side, top) {
    const d = Math.max(5, Math.round(side / 10));
    const hx = Math.round(side * 0.28);
    const hy = Math.round(side * 0.3);
    iso.footprint(hx, hy, d, d, top - 6, P.ink);
    iso.footprint(hx + 1, hy + 1, d - 2, d - 2, top - 5, P.glass[1]);
  }
};
var market = {
  height(side) {
    if (side <= 44) return 9;
    if (side <= 60) return 10;
    if (side <= 78) return 11;
    return 12;
  },
  trim(iso, side) {
    iso.beamX(0, side, side, 0, P.wood[0], 1);
    iso.beamY(0, side, side, 0, P.wood[0], 1);
  },
  draw(iso, side, eave) {
    iso.box(-2, -2, side + 4, side + 4, eave, eave + 2, {
      top: P.wood[3],
      lit: P.wood[2],
      shadow: P.wood[1],
      edge: P.ink
    });
    const stalls = 3;
    const w = Math.max(6, Math.round(side / stalls) - 3);
    for (let i = 0; i < stalls; i++) {
      const x = Math.round((side - (w * stalls + 3 * (stalls - 1))) / 2) + i * (w + 3);
      const y = Math.round(side * 0.2) + i % 2 * 2;
      iso.box(x, y, w, Math.round(side * 0.5), eave + 2, eave + market.height(side), {
        // Striped: alternating canvas and accent is the only saturated thing in
        // the town that is not the verification flag, which is exactly the read
        // a market wants — and the reason a Market and a verified Tenement are
        // told apart by the flag's position rather than its colour.
        top: i % 2 === 0 ? P.canvas[3] : P.accent,
        lit: i % 2 === 0 ? P.canvas[2] : P.accent,
        shadow: i % 2 === 0 ? P.canvas[1] : P.accent,
        edge: P.ink
      });
    }
  },
  stack(iso, side, top) {
    const w = Math.max(4, Math.round(side / 12));
    iso.box(Math.round(side * 0.16), Math.round(side * 0.66), w, w, top, top + 3, {
      top: P.wood[3],
      lit: P.wood[2],
      shadow: P.wood[1],
      edge: P.ink
    });
  },
  damage(iso, side, top) {
    const d = Math.max(5, Math.round(side / 10));
    iso.footprint(Math.round(side * 0.44), Math.round(side * 0.24), d, d, top - 3, P.ink);
  }
};
var school = {
  height(side) {
    if (side <= 44) return 20;
    if (side <= 60) return 23;
    if (side <= 78) return 26;
    return 28;
  },
  trim(iso, side) {
    iso.beamX(0, side, side, 0, P.stone[0], 1);
    iso.beamY(0, side, side, 0, P.stone[0], 1);
  },
  draw(iso, side, eave) {
    const w = Math.round(side * 0.9);
    const o = Math.round((side - w) / 2);
    iso.gable(o, o, w, w, eave, school.height(side) - 6, {
      near: P.stone[2],
      far: P.stone[1],
      ridge: P.metal[3],
      gable: P.plaster[3],
      edge: P.ink
    });
    const c = Math.round(side / 2);
    const bw = Math.max(4, Math.round(side * 0.14));
    iso.box(c - bw, c - bw, bw * 2, bw * 2, eave + school.height(side) - 6, eave + school.height(side), {
      top: P.stone[3],
      lit: P.stone[2],
      shadow: P.stone[1],
      edge: P.ink
    });
  },
  stack(iso, side, top) {
    const c = Math.round(side / 2);
    iso.footprint(c - 1, c - 1, 3, 3, top + 1, P.accent);
  },
  damage(iso, side, top) {
    const d = Math.max(5, Math.round(side / 14));
    const c = Math.round(side / 2);
    iso.footprint(c - d, c - d, d * 2, d * 2, top - 8, P.ink);
  }
};
var restaurant = {
  height: () => 8,
  trim(iso, side) {
    iso.beamX(0, side, side, 0, P.rust[0], 1);
    iso.beamY(0, side, side, 0, P.rust[0], 1);
  },
  draw(iso, side, eave) {
    const inset = 5;
    iso.box(inset, inset, side - inset * 2, side - inset * 2, eave, eave + restaurant.height(side), {
      top: P.plaster[3],
      lit: P.plaster[2],
      shadow: P.plaster[1],
      edge: P.ink
    });
    const c = eave + 1;
    iso.footprint(-2, -7, side + 4, 9, c, P.canvas[3]);
    iso.beamX(-2, side + 2, -7, c, P.canvas[0], 1);
    iso.beamY(-2, -7, 2, c, P.canvas[0], 1);
    const t = Math.max(3, Math.round(side / 8));
    for (const x of [Math.round(side * 0.28), Math.round(side * 0.62)]) {
      iso.footprint(x, -5, t, t, c + 1, P.accent);
    }
  },
  stack() {
  },
  damage(iso, side, top) {
    const d = Math.max(5, Math.round(side / 10));
    iso.footprint(Math.round(side * 0.34), -7, d, d, top - 7, P.ink);
    iso.beamX(Math.round(side * 0.34), Math.round(side * 0.34) + d, -5, top - 7, P.wood[1], 1);
  }
};
var KITS = {
  tenement: flat,
  works: sawtooth,
  cottage: pitched,
  hall: gantried,
  library: domed,
  stadium,
  hospital,
  chapel,
  tower,
  market,
  school,
  restaurant
};
function archetypeHeight(kind, side) {
  return KITS[kind].height(side);
}
function buildRoofTrim(iso, kind, side) {
  KITS[kind].trim(iso, side);
}
function buildRoof(iso, kind, side, eave) {
  KITS[kind].draw(iso, side, eave);
}
function buildRoofStack(iso, kind, side, eave) {
  KITS[kind].stack(iso, side, eave + archetypeHeight(kind, side));
}
var MATERIALS_BY_NAME = {
  // Five distinct ramps, and that is load-bearing rather than tidiness: two
  // families sharing a ramp draw identical walls, and a test that catches it
  // is the only reason this table did not ship with stone and concrete both on
  // `P.stone`, which is what it started as.
  stone: { wall: P.stone, framed: false, base: P.stone },
  render: { wall: P.plaster, framed: false, base: P.plaster },
  glass: { wall: P.glass, framed: false, base: P.metal },
  timber: { wall: P.wood, framed: true, base: P.wood },
  // Metal rather than stone: concrete and stone are both grey, and `metal` is
  // the ramp that separates them at a glance — flat and industrial where stone
  // reads as cut blocks.
  concrete: { wall: P.metal, framed: false, base: P.metal }
};
function materialByName(name) {
  return MATERIALS_BY_NAME[name];
}

// src/art/building.ts
var STAGE_ORDER = [
  "planned",
  "foundation",
  "framed",
  "walled",
  "roofed",
  "glazed",
  "doored",
  "completed"
];
function stageRank(s) {
  const i = STAGE_ORDER.indexOf(s);
  return i < 0 ? 0 : i;
}
function hasScaffold(s) {
  const r = stageRank(s);
  return r >= stageRank("framed") && r < stageRank("roofed");
}
function hasSpoil(s) {
  const r = stageRank(s);
  return r >= stageRank("foundation") && r < stageRank("glazed");
}
function skinVariant(path) {
  return Math.abs(hashPath(path)) % 2;
}
function skinFor(files, path) {
  const warm = skinVariant(path) === 0;
  if (files <= 2) {
    return { wall: P.plaster, framed: true };
  }
  if (files <= 5) {
    return { wall: P.plaster, framed: true };
  }
  if (files <= 12) {
    return { wall: warm ? P.stone : P.plaster, framed: !warm };
  }
  return { wall: P.stone, framed: false };
}
function footprintBox(side, zTop, turn = 0) {
  const { xs, ys } = footprintScreen(side, turn);
  const m = 6;
  const minX = Math.floor(Math.min(...xs)) - m;
  const maxX = Math.ceil(Math.max(...xs)) + m;
  const minY = Math.floor(Math.min(...ys) - zTop) - m;
  const maxY = Math.ceil(Math.max(...ys)) + m;
  return { w: maxX - minX + 1, h: maxY - minY + 1, ox: -minX, oy: -minY, zTop };
}
function baseBox(side, turn = 0) {
  return footprintBox(side, STOREY, turn);
}
function shadowBox(side, turn = 0) {
  return footprintBox(side, 0, turn);
}
function footprintScreen(side, turn) {
  const corners = [[0, 0], [side, 0], [0, side], [side, side]];
  const pts = corners.map(([x, y]) => {
    const p = turnPoint(normaliseTurn(turn), x, y);
    return { x: (p.x - p.y) / 2, y: (p.x + p.y) / 4 };
  });
  return { xs: pts.map((p) => p.x), ys: pts.map((p) => p.y) };
}
function bandBox(side, turn = 0) {
  const { xs, ys } = footprintScreen(side, turn);
  const m = 6;
  const minX = Math.floor(Math.min(...xs)) - m;
  const maxX = Math.ceil(Math.max(...xs)) + m;
  const minY = Math.floor(Math.min(...ys) - STOREY) - m;
  const maxY = Math.ceil(Math.max(...ys)) + m;
  return { w: maxX - minX + 1, h: maxY - minY + 1, ox: -minX, oy: -minY, zTop: STOREY };
}
function capTop(side, roof) {
  return archetypeHeight(roof, side) + 6;
}
function capBox(side, roof, turn = 0) {
  return footprintBox(side, capTop(side, roof), turn);
}
function storeyShell(iso, side, skin, stage) {
  const want = stageRank(stage);
  if (want >= stageRank("framed")) framing(iso, side, STOREY);
  if (want >= stageRank("walled")) walls(iso, side, STOREY, skin);
  if (want >= stageRank("glazed")) windows(iso, side, STOREY, windowsPerStorey(side));
  if (want >= stageRank("completed")) cornerBoards(iso, side, skin);
  if (hasScaffold(stage)) scaffold(iso, side, STOREY + 8);
}
function cornerBoards(iso, side, skin) {
  for (let z = 0; z <= STOREY; z++) {
    iso.plot(side, side, z, skin.wall[0]);
    iso.plot(side + 1, side, z, skin.wall[1]);
  }
}
function buildBase(side, materialName, stage, damaged = false, turn = 0) {
  const skin = materialByName(materialName);
  const box = baseBox(side, turn);
  const iso = new IsoPix(box.w, box.h, box.ox, box.oy, turn);
  const want = stageRank(stage);
  plotGround(iso, side);
  if (hasSpoil(stage)) spoil(iso, side);
  if (want >= stageRank("planned")) cornerStakes(iso, side);
  if (want >= stageRank("foundation")) footings(iso, side);
  storeyShell(iso, side, skin, stage);
  if (want >= stageRank("doored")) door(iso, side, STOREY);
  if (want >= stageRank("completed")) plinth(iso, side, skin);
  if (damaged && hasDamage(stage)) {
    rubble(iso, side);
    if (want >= stageRank("walled")) crack(iso, side);
  }
  return iso.outline(P.ink);
}
function buildBand(side, materialName, stage, turn = 0) {
  const skin = materialByName(materialName);
  const box = bandBox(side, turn);
  const iso = new IsoPix(box.w, box.h, box.ox, box.oy, turn);
  storeyShell(iso, side, skin, stage);
  return iso.outline(P.ink);
}
function buildCap(side, roof, stage, turn = 0) {
  const box = capBox(side, roof, turn);
  const iso = new IsoPix(box.w, box.h, box.ox, box.oy, turn);
  const want = stageRank(stage);
  if (want >= stageRank("roofed")) buildRoof(iso, roof, side, 0);
  if (want >= stageRank("completed")) {
    buildRoofTrim(iso, roof, side);
    buildRoofStack(iso, roof, side, 0);
  }
  return iso.outline(P.ink);
}
function plotGround(iso, side) {
  iso.footprint(0, 0, side, side, 0, P.earth[1]);
  iso.footprintRim(0, 0, side, side, 0, P.earth[0]);
}
function cornerStakes(iso, side) {
  const inset = 4;
  const corners = [
    [inset, inset],
    [side - inset, inset],
    [inset, side - inset],
    [side - inset, side - inset]
  ];
  for (const [wx, wy] of corners) {
    iso.post(wx, wy, 0, 7, P.wood[1], 1);
    iso.plot(wx, wy, 8, P.wood[3]);
  }
  iso.beamX(inset, side - inset, side - inset, 1, P.wood[0]);
  iso.beamY(inset, side - inset, side - inset, 1, P.wood[0]);
}
function scaffold(iso, side, top) {
  const out = 5;
  const poles = [
    [-out, side + out],
    [side / 2, side + out],
    [side + out, side + out],
    [side + out, side / 2]
  ];
  for (const [wx, wy] of poles) iso.post(wx, wy, 0, top, P.wood[1], 1);
  for (const z of [top - 3, Math.round(top / 2)]) {
    iso.beamX(-out, side + out, side + out, z, P.wood[3], 1);
    iso.beamY(side + out, side + out, side + out, z, P.wood[2], 1);
  }
  for (let i = 0; i < top; i++) {
    iso.plot(side - 4, side + out, i, P.wood[2]);
    iso.plot(side - 3, side + out, i + 1, P.wood[1]);
  }
}
function framing(iso, side, height) {
  const studs = Math.max(2, Math.round(side / 16));
  for (let i = 0; i <= studs; i++) {
    const wx = Math.round(side * i / studs);
    iso.post(wx, side, 0, height, P.wood[1], 1);
    iso.post(side, wx, 0, height, P.wood[1], 1);
  }
  iso.beamX(0, side, side, height, P.wood[3], 1);
  iso.beamY(0, side, side, height, P.wood[2], 1);
  const mid = Math.round(height / 2);
  iso.beamX(0, side, side, mid, P.wood[0], 1);
  iso.beamY(0, side, side, mid, P.wood[0], 1);
}
function walls(iso, side, height, skin) {
  iso.box(0, 0, side, side, 0, height, {
    top: skin.wall[0],
    lit: skin.wall[3],
    shadow: skin.wall[1],
    edge: P.ink
  });
  if (skin.framed) {
    const studs = Math.max(2, Math.round(side / 18));
    for (let i = 1; i < studs; i++) {
      const wx = Math.round(side * i / studs);
      iso.column(wx, side, 1, height, P.wood[1]);
      iso.column(side, wx, 1, height, P.wood[1]);
    }
    iso.beamX(0, side, side, Math.round(height * 0.55), P.wood[2], 1);
    iso.beamY(0, side, side, Math.round(height * 0.55), P.wood[2], 1);
  }
}
function footings(iso, side) {
  const pad = Math.max(3, Math.round(side / 12));
  iso.footprintRim(3, 3, side - 6, side - 6, 0, P.earth[0]);
  for (const [wx, wy] of [
    [pad, pad],
    [side - pad, pad],
    [pad, side - pad],
    [side - pad, side - pad]
  ]) {
    iso.footprint(wx - 2, wy - 2, 4, 4, 0, P.stone[1]);
    iso.footprint(wx - 2, wy - 2, 4, 4, 1, P.stone[2]);
  }
}
function plinth(iso, side, skin) {
  iso.box(-1, -1, side + 2, side + 2, 0, 2, {
    top: skin.wall[1],
    lit: skin.wall[2],
    shadow: skin.wall[0],
    edge: P.ink
  });
}
function windows(iso, side, height, count) {
  const litWall = iso.litWall(side);
  eachWindow(iso, side, height, count, (wall, at, z, part) => {
    if (part === "frame") {
      iso.wallPlot(wall, at, z, P.wood[0]);
      return;
    }
    iso.wallPlot(wall, at, z, wall === litWall ? P.glass[2] : P.glass[1]);
  });
}
function eachWindow(iso, side, height, count, paint) {
  const h = Math.max(3, Math.round(height / 5));
  const span = Math.max(2, Math.round(side / 16));
  const y = Math.round(height * 0.45);
  const gap = side / (count + 1);
  const lit = iso.litWall(side);
  const shadow = iso.shadowWall(side);
  for (let i = 1; i <= count; i++) {
    const at = Math.round(gap * i);
    for (let dx = -span; dx <= span; dx++) {
      for (let z = 0; z < h; z++) paint(lit, at + dx, y + z, "glass", i);
      paint(lit, at + dx, y - 1, "frame", i);
      paint(lit, at + dx, y + h, "frame", i);
    }
    for (let dy = -span; dy <= span; dy++) {
      for (let z = 0; z < h; z++) paint(shadow, at + dy, y + z, "glass", i);
      paint(shadow, at + dy, y - 1, "frame", i);
      paint(shadow, at + dy, y + h, "frame", i);
    }
  }
}
function door(iso, side, height) {
  const at = Math.round(side / 2);
  const h = Math.min(height - 3, 13);
  const half = Math.max(1, Math.round(side / 20));
  const wall = iso.litWall(side);
  for (let dx = -half; dx <= half; dx++) {
    for (let z = 0; z < h; z++) iso.wallColumn(wall, at + dx, z, z, P.wood[0]);
    iso.wallColumn(wall, at + dx, h, h, P.wood[2]);
    iso.wallColumn(wall, at + dx, h + 1, h + 1, P.wood[1]);
  }
}
function spoil(iso, side) {
  const x = side + 4;
  const y = side - 2;
  iso.footprint(x, y, 10, 8, 0, P.earth[2]);
  iso.footprint(x, y, 10, 8, 1, P.earth[3]);
  iso.footprint(x + 1, y + 1, 8, 5, 2, P.earth[1]);
}
function rubble(iso, side) {
  const rx = Math.round(side * 0.3);
  iso.footprint(rx, side + 2, 9, 6, 0, P.stone[1]);
  iso.footprint(rx + 1, side + 3, 6, 4, 1, P.stone[2]);
  iso.footprint(rx + 2, side + 4, 3, 2, 2, P.stone[3]);
}
function crack(iso, side) {
  let x = Math.round(side * 0.7);
  for (let z = 1; z < STOREY - 1; z++) {
    iso.column(x, side, z, z, P.ink);
    if (z % 3 === 0) x += z % 2 === 0 ? 1 : -1;
  }
}
function windowsPerStorey(side) {
  return side >= 60 ? 3 : 2;
}
function hasDamage(stage) {
  return stageRank(stage) >= stageRank("framed");
}
function buildShadow(side, files, path, turn = 0) {
  const skin = skinFor(files, path);
  const box = shadowBox(side, turn);
  const iso = new IsoPix(box.w, box.h, box.ox, box.oy, turn);
  iso.footprint(2, 3, side + 3, side + 3, 0, P.grass[0]);
  return iso.pix;
}

// src/art/machine.ts
var MACHINES = ["excavator", "crane", "loader", "driver", "dozer"];
var TRACK = { top: P.rubber[2], lit: P.rubber[1], shadow: P.rubber[0], edge: P.ink };
var TREAD = { top: P.rubber[3], lit: P.rubber[2], shadow: P.rubber[1], edge: P.ink };
var BODY = { top: P.rust[2], lit: P.rust[3], shadow: P.rust[1], edge: P.ink };
var DECK = { top: P.rust[3], lit: P.rust[2], shadow: P.rust[0], edge: P.ink };
var ARM = { top: P.metal[2], lit: P.metal[2], shadow: P.metal[0], edge: P.ink };
var GLASS = { top: P.glass[3], lit: P.glass[3], shadow: P.glass[1], edge: P.ink };
var STEEL = { top: P.stone[3], lit: P.stone[2], shadow: P.stone[1], edge: P.ink };
var BEACON = { top: P.helmetChief[3], lit: P.helmetChief[3], shadow: P.helmetChief[2], edge: P.ink };
function limb(iso, a, b, thick, shade) {
  const steps = Math.max(
    1,
    Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), Math.abs(b.z - a.z)))
  );
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(a.x + (b.x - a.x) * t);
    const y = Math.round(a.y + (b.y - a.y) * t);
    const z = Math.round(a.z + (b.z - a.z) * t);
    iso.box(x, y, thick, thick, Math.max(0, z - thick), z, shade);
  }
}
var LEN = 44;
var DEP = 9;
var DECK_Z = 13;
function undercarriage(iso) {
  iso.box(0, 0, LEN, DEP, 0, 4, TRACK);
  iso.box(1, 0, LEN - 2, 2, 4, 5, TREAD);
  iso.box(1, DEP - 2, LEN - 2, 2, 4, 5, TREAD);
}
var BODY_STACK = {
  // Cab set back at the far end, engine deck forward — the conventional
  // arrangement, and the one that puts the glass where a driver would sit.
  excavator: (iso) => {
    iso.box(1, 1, LEN - 2, DEP - 2, 5, DECK_Z - 2, BODY);
    iso.box(2, 2, LEN - 4, DEP - 4, DECK_Z - 2, DECK_Z, DECK);
    iso.box(LEN - 15, 1, 14, DEP - 2, DECK_Z, DECK_Z + 8, BODY);
    iso.box(LEN - 14, 1, 12, DEP - 3, DECK_Z + 3, DECK_Z + 7, GLASS);
    iso.box(LEN - 11, 3, 3, 3, DECK_Z + 8, DECK_Z + 11, BEACON);
  },
  // A crane's cab sits low and forward, and the mast rises behind it.
  crane: (iso) => {
    iso.box(1, 1, LEN - 2, DEP - 2, 5, DECK_Z - 2, BODY);
    iso.box(2, 2, LEN - 4, DEP - 4, DECK_Z - 2, DECK_Z, DECK);
    iso.box(3, 1, 12, DEP - 2, DECK_Z, DECK_Z + 6, BODY);
    iso.box(4, 1, 10, DEP - 3, DECK_Z + 2, DECK_Z + 5, GLASS);
  },
  loader: (iso) => {
    iso.box(1, 1, LEN - 2, DEP - 2, 5, DECK_Z - 2, BODY);
    iso.box(2, 2, LEN - 4, DEP - 4, DECK_Z - 2, DECK_Z, DECK);
    iso.box(LEN - 17, 1, 16, DEP - 2, DECK_Z, DECK_Z + 7, BODY);
    iso.box(LEN - 16, 1, 14, DEP - 3, DECK_Z + 2, DECK_Z + 6, GLASS);
  },
  // The only kind whose cab is the whole body: it is the machine you watch.
  driver: (iso) => {
    iso.box(1, 1, LEN - 2, DEP - 2, 5, DECK_Z - 2, BODY);
    iso.box(2, 2, LEN - 4, DEP - 4, DECK_Z - 2, DECK_Z, DECK);
    iso.box(14, 1, 18, DEP - 2, DECK_Z, DECK_Z + 9, BODY);
    iso.box(15, 1, 16, DEP - 3, DECK_Z + 3, DECK_Z + 8, GLASS);
    iso.box(20, 3, 3, 3, DECK_Z + 9, DECK_Z + 12, BEACON);
  },
  dozer: (iso) => {
    iso.box(1, 1, LEN - 2, DEP - 2, 5, DECK_Z - 2, BODY);
    iso.box(2, 2, LEN - 4, DEP - 4, DECK_Z - 2, DECK_Z, DECK);
    iso.box(8, 1, 13, DEP - 2, DECK_Z, DECK_Z + 6, BODY);
    iso.box(9, 1, 11, DEP - 3, DECK_Z + 2, DECK_Z + 5, GLASS);
  }
};
var PIVOT = { x: 5, y: 4, z: DECK_Z };
var CHIEF_LIFT = 5;
var GESTURE = {
  // Rises, then falls away forward. The widest gesture of the five.
  excavator: {
    work: { elbow: { x: 22, y: 4, z: 32 }, tip: { x: 40, y: 4, z: 20 }, bucket: true },
    idle: { elbow: { x: 21, y: 4, z: 30 }, tip: { x: 36, y: 4, z: 21 }, bucket: true },
    travel: { elbow: { x: 20, y: 4, z: 27 }, tip: { x: 35, y: 4, z: 18 }, bucket: false },
    done: { elbow: { x: 21, y: 4, z: 33 }, tip: { x: 38, y: 4, z: 25 }, bucket: false }
  },
  // Straight up, then straight out. A jib is a horizontal gesture and no amount
  // of swinging turns it into a boom — that is the whole difference between them.
  crane: {
    work: { elbow: { x: 12, y: 4, z: 42 }, tip: { x: 43, y: 4, z: 42 }, bucket: false },
    idle: { elbow: { x: 12, y: 4, z: 40 }, tip: { x: 41, y: 4, z: 40 }, bucket: false },
    travel: { elbow: { x: 12, y: 4, z: 37 }, tip: { x: 40, y: 4, z: 37 }, bucket: false },
    done: { elbow: { x: 12, y: 4, z: 38 }, tip: { x: 42, y: 4, z: 38 }, bucket: false }
  },
  // Down to the ground at the far end. A loader is an excavator that never lifts.
  loader: {
    work: { elbow: { x: 26, y: 4, z: 24 }, tip: { x: 43, y: 4, z: 8 }, bucket: true },
    idle: { elbow: { x: 26, y: 4, z: 23 }, tip: { x: 42, y: 4, z: 10 }, bucket: true },
    travel: { elbow: { x: 25, y: 4, z: 21 }, tip: { x: 40, y: 4, z: 14 }, bucket: false },
    done: { elbow: { x: 25, y: 4, z: 26 }, tip: { x: 41, y: 4, z: 16 }, bucket: false }
  },
  // A small articulated arm over the cab — the machine that watches.
  driver: {
    work: { elbow: { x: 20, y: 4, z: 32 }, tip: { x: 31, y: 4, z: 24 }, bucket: false },
    idle: { elbow: { x: 20, y: 4, z: 30 }, tip: { x: 30, y: 4, z: 23 }, bucket: false },
    travel: { elbow: { x: 19, y: 4, z: 28 }, tip: { x: 30, y: 4, z: 21 }, bucket: false },
    done: { elbow: { x: 19, y: 4, z: 31 }, tip: { x: 31, y: 4, z: 22 }, bucket: false }
  },
  // Barely off the deck: a blade that stays low and wide, the flattest gesture.
  dozer: {
    work: { elbow: { x: 30, y: 4, z: 17 }, tip: { x: 44, y: 4, z: 8 }, bucket: false },
    idle: { elbow: { x: 30, y: 4, z: 16 }, tip: { x: 44, y: 4, z: 7 }, bucket: false },
    travel: { elbow: { x: 29, y: 4, z: 15 }, tip: { x: 43, y: 4, z: 6 }, bucket: false },
    done: { elbow: { x: 30, y: 4, z: 19 }, tip: { x: 44, y: 4, z: 10 }, bucket: false }
  }
};
var PAD = 1;
var solved = null;
function buildMachine(kind, pose, tier, turn = 0) {
  const box = solveMachine();
  const iso = new IsoPix(box.w, box.h, box.ox, box.oy, normaliseTurn(turn));
  undercarriage(iso);
  BODY_STACK[kind](iso);
  const g = GESTURE[kind][pose];
  const lift = tier === "chief" ? CHIEF_LIFT : 0;
  const elbow = { x: g.elbow.x, y: g.elbow.y, z: g.elbow.z + lift };
  const tip = { x: g.tip.x, y: g.tip.y, z: g.tip.z + lift };
  limb(iso, PIVOT, elbow, 4, ARM);
  limb(iso, elbow, tip, 3, ARM);
  if (g.bucket) iso.box(tip.x - 2, tip.y, 7, 5, Math.max(0, tip.z - 6), tip.z, STEEL);
  return iso.pix;
}
function solveMachine() {
  if (solved) return solved;
  const span = 240;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const turn of [0, 1, 2, 3]) {
    for (const kind of MACHINES) {
      const probe = new IsoPix(span, span, span / 2, span * 0.75, turn);
      undercarriage(probe);
      BODY_STACK[kind](probe);
      const g = GESTURE[kind]["work"];
      limb(probe, PIVOT, g.elbow, 4, ARM);
      limb(probe, g.elbow, g.tip, 3, ARM);
      probe.box(g.tip.x - 2, g.tip.y, 7, 5, Math.max(0, g.tip.z - 6), g.tip.z, {
        top: STEEL.top,
        lit: STEEL.lit,
        shadow: STEEL.shadow
      });
      for (let y = 0; y < probe.pix.h; y++)
        for (let x = 0; x < probe.pix.w; x++) {
          if (!probe.pix.isOpaque(x, y)) continue;
          const dx = x - span / 2;
          const dy = y - span * 0.75;
          if (dx < minX) minX = dx;
          if (dx > maxX) maxX = dx;
          if (dy < minY) minY = dy;
          if (dy > maxY) maxY = dy;
        }
    }
  }
  const ox = PAD - minX;
  const oy = PAD - minY;
  solved = { w: ox + maxX + PAD, h: oy + maxY + PAD, ox, oy };
  return solved;
}

// src/art/props/kinds.ts
var PROP_SCALE = 2;
var CEL_W = 107;
var CEL_H = 96;
var PROP_ORIGIN = { x: 53, y: 68 };
var SHARED_KINDS = [
  "barrel",
  "bollard",
  "bricks",
  "crate",
  "lamp",
  "lumber",
  "sack",
  "sawhorse",
  "signpost",
  "stool",
  "toolchest",
  "wheelbarrow"
];
var YARD_KINDS = [
  "cableDrum",
  "cone",
  "crane",
  "generator",
  "girders",
  "mixer",
  "pallet",
  "pipeStack",
  "rubble",
  "skip",
  "tripod",
  "waterbutt"
];
var WORKSHOP_KINDS = [
  "bandsaw",
  "grindstone",
  "shavings",
  "timberRack",
  "toolboard",
  "trestle",
  "vise",
  "workbench"
];
var TOOL_KINDS = [
  "axe",
  "chisel",
  "clamp",
  "handplane",
  "handsaw",
  "ladder",
  "oilcan",
  "ropeCoil",
  "spade",
  "trowel"
];
var DEPOT_KINDS = [
  "anvil",
  "cabinet",
  "clock",
  "drafting",
  "ledger",
  "noticeboard",
  "parcel",
  "planboard",
  "radio",
  "scales",
  "shelving",
  "stove"
];
var ALL_PROP_KINDS = [
  ...SHARED_KINDS,
  ...YARD_KINDS,
  ...WORKSHOP_KINDS,
  ...TOOL_KINDS,
  ...DEPOT_KINDS
];

// src/art/props/shared.ts
var wheelbarrow = (iso) => {
  iso.box(0, 0, 18, 12, 0, 6, {
    top: P.wood[0],
    lit: P.wood[2],
    shadow: P.wood[1],
    edge: P.ink
  });
  iso.beamY(0, 12, 18, 6, P.wood[3], 1);
  iso.beamX(0, 18, 12, 6, P.wood[2], 1);
  for (let a = 0; a < 8; a++) {
    const ang = a / 8 * Math.PI * 2;
    iso.plot(2 + Math.cos(ang) * 3, 6 + Math.sin(ang) * 2, 1, P.metal[0]);
  }
  iso.plot(2, 6, 2, P.metal[2]);
  iso.plot(2, 6, 0, P.wood[0]);
  iso.beamY(-8, 0, 4, 7, P.wood[3], 1);
  iso.beamY(-8, 0, 14, 7, P.wood[2], 1);
  iso.post(16, 10, 0, 4, P.wood[1], 1);
  iso.post(8, 10, 0, 4, P.wood[1], 1);
};
var bricks = (iso, variant) => {
  const rows = 3 + variant % 2;
  const bw = 14;
  const bd = 8;
  for (let r = 0; r < rows; r++) {
    const z = r * 4;
    const inset = r % 2 * 2;
    iso.box(inset, 0, bw, bd, z, z + 3, {
      top: P.roof[2],
      lit: P.roof[3],
      shadow: P.roof[1],
      edge: P.ink
    });
    iso.beamX(inset, inset + bw, bd, z + 3, P.stone[3], 1);
  }
};
var lumber = (iso, variant) => {
  const planks = 4 + variant % 3;
  const len = 22;
  const wide = 9;
  for (let i = 0; i < planks; i++) {
    const z = i * 3;
    const off = i % 2 === 0 ? 0 : 1;
    iso.box(off, 0, len - off, wide, z, z + 2, {
      top: P.wood[3],
      lit: P.wood[2],
      shadow: P.wood[1],
      edge: P.ink
    });
  }
  for (let i = 0; i < planks; i++) {
    iso.beamY(0, wide, i % 2 === 0 ? 0 : 1, i * 3 + 1, P.wood[0], 1);
  }
};
var toolchest = (iso) => {
  iso.box(0, 0, 16, 11, 0, 8, {
    top: P.wood[2],
    lit: P.wood[3],
    shadow: P.wood[1],
    edge: P.ink
  });
  iso.box(-1, -1, 18, 13, 8, 10, {
    top: P.wood[3],
    lit: P.wood[2],
    shadow: P.wood[0],
    edge: P.ink
  });
  iso.beamY(0, 11, 5, 9, P.metal[1], 1);
  iso.beamY(0, 11, 5, 2, P.metal[1], 1);
  iso.plot(5, 11, 6, P.accent);
  iso.post(18, 4, 0, 11, P.wood[2], 1);
  iso.box(17, 3, 4, 3, 11, 13, {
    top: P.metal[3],
    lit: P.metal[2],
    shadow: P.metal[1],
    edge: P.ink
  });
};
var crate = (iso) => {
  iso.box(0, 0, 14, 10, 0, 7, {
    top: P.wood[0],
    lit: P.wood[2],
    shadow: P.wood[1],
    edge: P.ink
  });
  for (let i = 1; i < 4; i++) {
    iso.column(Math.round(14 * i / 4), 10, 1, 6, P.wood[3]);
    iso.column(14, Math.round(10 * i / 4), 1, 6, P.wood[2]);
  }
  iso.box(3, 2, 3, 12, 7, 9, {
    top: P.wood[3],
    lit: P.wood[2],
    shadow: P.wood[1],
    edge: P.ink
  });
};
var sawhorse = (iso) => {
  iso.post(0, 0, 0, 9, P.wood[2], 1);
  iso.post(0, 9, 0, 9, P.wood[1], 1);
  iso.post(18, 0, 0, 9, P.wood[2], 1);
  iso.post(18, 9, 0, 9, P.wood[1], 1);
  iso.beamY(0, 9, 0, 9, P.wood[2], 1);
  iso.beamY(0, 9, 18, 9, P.wood[1], 1);
  iso.box(-2, -1, 26, 13, 9, 11, {
    top: P.wood[3],
    lit: P.wood[2],
    shadow: P.wood[1],
    edge: P.ink
  });
};
var barrel = (iso) => {
  iso.box(1, 1, 12, 12, 1, 3, { top: P.wood[1], lit: P.wood[2], shadow: P.wood[0], edge: P.ink });
  iso.box(0, 0, 14, 14, 3, 10, { top: P.wood[1], lit: P.wood[3], shadow: P.wood[1], edge: P.ink });
  iso.box(1, 1, 12, 12, 10, 12, { top: P.wood[1], lit: P.wood[2], shadow: P.wood[0], edge: P.ink });
  iso.beamY(0, 14, 14, 5, P.metal[1], 1);
  iso.beamY(0, 14, 14, 9, P.metal[1], 1);
  iso.beamY(0, 14, 0, 5, P.metal[0], 1);
  iso.box(1, 1, 12, 12, 12, 13, { top: P.wood[3], lit: P.wood[2], shadow: P.wood[1], edge: P.ink });
};
var bollard = (iso) => {
  iso.box(0, 0, 5, 5, 0, 12, {
    top: P.wood[2],
    lit: P.wood[3],
    shadow: P.wood[1],
    edge: P.ink
  });
  iso.beamY(0, 5, 5, 13, P.metal[1], 1);
};
var lamp = (iso) => {
  iso.post(2, 2, 0, 16, P.metal[1], 1);
  iso.box(0, 0, 7, 7, 16, 18, {
    top: P.metal[3],
    lit: P.metal[2],
    shadow: P.metal[1],
    edge: P.ink
  });
  iso.box(1, 1, 5, 5, 13, 16, {
    top: P.accent,
    lit: P.helmetChief[3],
    shadow: P.accentDim,
    edge: P.ink
  });
};
var sack = (iso) => {
  iso.box(1, 1, 11, 9, 0, 9, { top: P.canvas[2], lit: P.canvas[3], shadow: P.canvas[1], edge: P.ink });
  iso.box(3, 3, 7, 5, 9, 11, { top: P.canvas[3], lit: P.canvas[2], shadow: P.canvas[1], edge: P.ink });
  iso.beamY(3, 8, 4, 10, P.leather, 1);
};
var signpost = (iso) => {
  iso.post(4, 4, 0, 17, P.wood[1], 2);
  iso.box(-2, 3, 14, 2, 14, 19, {
    top: P.wood[3],
    lit: P.wood[2],
    shadow: P.wood[0],
    edge: P.ink
  });
  iso.beamY(3, 5, -2, 15, P.wood[0], 1);
};
var stool = (iso) => {
  iso.box(0, 0, 9, 9, 7, 9, {
    top: P.wood[3],
    lit: P.wood[2],
    shadow: P.wood[1],
    edge: P.ink
  });
  iso.post(0, 0, 0, 7, P.wood[1], 1);
  iso.post(8, 1, 0, 7, P.wood[0], 1);
  iso.post(1, 8, 0, 7, P.wood[2], 1);
  iso.beamX(1, 8, 8, 3, P.wood[0], 1);
};
var SHARED_DRAWERS = {
  barrel,
  bollard,
  bricks,
  crate,
  lamp,
  lumber,
  sack,
  sawhorse,
  signpost,
  stool,
  toolchest,
  wheelbarrow
};

// src/art/props/parts.ts
function hollowBox(iso, x, y, w, h, zBottom, zTop, shade) {
  iso.box(x, y, w, h, zBottom, zTop, shade);
  iso.footprint(x + 1, y + 1, w - 2, h - 2, zTop, shade.inner);
}
function slabStack(iso, x, y, w, h, layers, unit, gap, shade) {
  for (let i = 0; i < layers; i++) {
    const z = i * (unit + gap);
    iso.box(x, y, w, h, z, z + unit, shade);
    if (i > 0) {
      iso.beamX(x, x + w, y + h, z, shade.seam, 1);
      iso.beamY(y, y + h, x + w, z, shade.seam, 1);
    }
  }
}
function bracedBoard(iso, x, y, w, zBottom, zTop, shade) {
  iso.post(x + 1, y, zBottom, zTop, shade.shadow, 1);
  iso.post(x + w - 1, y, zBottom, zTop, shade.shadow, 1);
  iso.box(x, y, w, 1, zTop - 11, zTop, {
    top: shade.top,
    lit: shade.face,
    shadow: shade.shadow,
    edge: shade.edge
  });
}
function drum(iso, x, y, w, h, zBottom, zTop, shade) {
  const belly = Math.round((zTop - zBottom) * 0.4);
  const zm = zBottom + belly;
  iso.box(x + 1, y + 1, w - 2, h - 2, zBottom, zm, shade);
  iso.box(x, y, w, h, zm, zTop - 2, shade);
  iso.box(x + 1, y + 1, w - 2, h - 2, zTop - 2, zTop, shade);
  iso.beamY(y, y + h, x + w, zm + 1, shade.hoop, 1);
  iso.beamY(y, y + h, x, zTop - 4, shade.hoop, 1);
  iso.footprintRim(x + 1, y + 1, w - 2, h - 2, zTop, shade.rim);
}

// src/art/props/yard.ts
function mat(ramp) {
  return { top: ramp[2], lit: ramp[3], shadow: ramp[1], edge: P.ink };
}
function discFaceY(iso, wx, cy, cz, radius, ink) {
  for (let j = -radius; j <= radius; j++) {
    const half = Math.sqrt(Math.max(0, radius * radius - j * j));
    iso.column(wx, cy + j, cz - half, cz + half, ink);
  }
}
function ringFaceY(iso, wx, cy, cz, radius, ink) {
  for (let a = 0; a < 8; a++) {
    const ang = a / 8 * Math.PI * 2;
    iso.plot(wx, cy + Math.cos(ang) * radius, cz + Math.sin(ang) * radius, ink);
  }
}
function discFaceX(iso, cx, cy, cz, radius, ink) {
  for (let k = -radius; k <= radius; k++) {
    const half = Math.sqrt(Math.max(0, radius * radius - k * k));
    iso.column(cx + k, cy, cz - half, cz + half, ink);
  }
}
function pipeAlongX(iso, from, to, cy, cz, radius, ink) {
  for (let j = -radius; j <= radius; j++) {
    const half = Math.sqrt(Math.max(0, radius * radius - j * j));
    for (let x = from; x <= to; x++) iso.column(x, cy + j, cz - half, cz + half, ink);
  }
}
function strut(iso, x0, y0, z0, x1, y1, z1, ink, thick = 1) {
  const a = iso.project(x0, y0, z0);
  const b = iso.project(x1, y1, z1);
  const steps = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const z = z0 + (z1 - z0) * t;
    iso.column(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z - thick + 1, z, ink);
  }
}
var cableDrum = (iso, variant) => {
  const width = 12 + variant % 2 * 2;
  const cy = 8;
  const cz = 9;
  discFaceY(iso, 0, cy, cz, 9, P.wood[1]);
  pipeAlongX(iso, 1, width, cy, cz, 6, P.rubber[1]);
  for (const x of [3, 6, 9, width - 1]) ringFaceY(iso, x, cy, cz, 6, P.rubber[0]);
  iso.beamX(1, width, cy - 4, cz + 4, P.rubber[3]);
  discFaceY(iso, width, cy, cz, 9, P.wood[2]);
  discFaceY(iso, width, cy, cz, 2, P.wood[0]);
  iso.plot(width, cy, cz, P.wood[3]);
};
var cone = (iso, variant) => {
  const base = 9 + variant % 3 * 2;
  const tall = 13 - variant % 3 * 2;
  const foot = base - 2;
  iso.box(1, 1, base, base, 0, 1, mat(P.rubber));
  for (let z = 1; z < tall; z++) {
    const w = Math.max(1, Math.round(foot * (1 - (z - 1) / tall)));
    const off = Math.round(1 + (base - w) / 2);
    const band = z === Math.round(tall / 2) || z === Math.round(tall * 0.8);
    iso.box(off, off, w, w, z, z + 1, mat(band ? P.plaster : P.rust));
  }
};
var crane = (iso, variant) => {
  const mast = 19 + variant % 2 * 2;
  iso.box(-2, 1, 20, 3, 0, 3, mat(P.rubber));
  iso.box(-2, 8, 20, 3, 0, 3, mat(P.rubber));
  for (let x = -1; x <= 17; x += 3) {
    iso.plot(x, 1, 3, P.rubber[0]);
    iso.plot(x, 11, 3, P.rubber[0]);
  }
  iso.box(0, 2, 16, 7, 3, 7, mat(P.metal));
  iso.box(1, 3, 14, 5, 7, 9, mat(P.rust));
  iso.box(1, 3, 5, 5, 9, 15, mat(P.metal));
  iso.beamX(2, 6, 8, 13, P.glass[2], 3);
  iso.box(7, 9, 6, 5, 9, 12, mat(P.rust));
  iso.box(6, 4, 5, 4, 9, mast, mat(P.metal));
  iso.beamX(6, 11, 8, 12, P.metal[0], 1);
  iso.beamX(6, 11, 8, 16, P.metal[0], 1);
  iso.beamX(6, 11, 8, mast - 2, P.metal[0], 1);
  const tip = mast + 3;
  strut(iso, 9, 6, mast, 9, -8, tip, P.metal[1], 2);
  iso.column(9, -8, 13, tip, P.rubber[0]);
  iso.box(8, -9, 3, 2, 13, 15, mat(P.metal));
  iso.box(8, -8, 2, 2, 11, 13, mat(P.metal));
};
var generator = (iso, variant) => {
  const len = 18 + variant % 3 * 2;
  iso.box(0, 1, len, 2, 0, 2, mat(P.rust));
  iso.box(0, 9, len, 2, 0, 2, mat(P.rust));
  iso.box(1, 2, len - 2, 8, 2, 11, mat(P.metal));
  const slots = 2 + variant % 2;
  for (let i = 0; i < slots; i++) iso.beamX(3, len - 4, 10, 5 + i * 2, P.metal[0], 1);
  iso.post(3, 3, 11, 15, P.metal[1], 1);
  iso.plot(3, 3, 15, P.metal[0]);
  iso.box(len - 6, 5, 3, 3, 11, 12, {
    top: P.metal[3],
    lit: P.metal[2],
    shadow: P.metal[1],
    edge: P.ink
  });
};
var girders = (iso, variant) => {
  const layers = 3 + variant % 3;
  slabStack(iso, 1, 0, 22, 7, layers, 2, 1, { ...mat(P.metal), seam: P.metal[3] });
  for (let i = 0; i < layers; i++) iso.beamX(1, 23, 7, i * 3 + 1, P.metal[0], 1);
};
var mixer = (iso, variant) => {
  const rings = 6 + variant % 2;
  const span = 9 + variant % 3;
  const mouthR = 4 + variant % 2;
  const cy = 5;
  discFaceX(iso, 5, 1, 4, 4, P.rubber[1]);
  discFaceX(iso, 5, 11, 4, 4, P.rubber[1]);
  iso.beamY(1, 11, 5, 4, P.metal[1], 1);
  iso.box(2, 3, 8, 5, 3, 8, mat(P.rust));
  strut(iso, 3, 8, 7, -2, 13, 3, P.metal[1], 1);
  iso.post(-2, 13, 3, 6, P.wood[2], 1);
  const mouthX = 3 + span;
  const mouthZ = 10 + span * 0.62;
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    const radius = 2 + (mouthR - 2) * t;
    const wx = 3 + span * t;
    const cz = 10 + (mouthZ - 10) * t;
    discFaceY(iso, wx, cy, cz, radius, P.rust[1]);
    iso.plot(wx, cy - radius * 0.7, cz + radius * 0.7, P.rust[3]);
  }
  discFaceY(iso, mouthX, cy, mouthZ, mouthR, P.rust[0]);
  ringFaceY(iso, mouthX, cy, mouthZ, mouthR, P.rust[3]);
};
var pallet = (iso, variant) => {
  const bags = 3 + variant % 3;
  for (const bx of [1, 7, 13]) iso.box(bx, 0, 4, 12, 0, 2, mat(P.wood));
  for (const by of [0, 3, 6, 9]) {
    iso.box(0, by, 18, 2, 2, 3, { top: P.wood[3], lit: P.wood[2], shadow: P.wood[1], edge: P.ink });
  }
  for (let i = 0; i < bags; i++) {
    const x = 5 + i % 2 * 6;
    const z = 3 + Math.floor(i / 2) * 5;
    iso.box(x, 3, 5, 7, z, z + 4, {
      top: P.canvas[2],
      lit: P.canvas[3],
      shadow: P.canvas[1],
      edge: P.ink
    });
    iso.beamY(4, 9, x + 5, z + 3, P.canvas[0], 1);
  }
};
var pipeStack = (iso, variant) => {
  const len = 18 + variant % 2 * 3;
  const radius = 3;
  const ground = 2 + variant % 2;
  const rows = [
    { count: ground, y0: 3, z: radius },
    { count: ground - 1, y0: 6, z: radius + 5 }
  ];
  if (ground > 2) rows.push({ count: 1, y0: 3 + 3 * (ground - 1), z: radius + 10 });
  for (const row of rows) {
    for (let i = 0; i < row.count; i++) {
      const cy = row.y0 + i * 6;
      pipeAlongX(iso, 0, len, cy, row.z, radius, P.metal[1]);
      iso.beamX(0, len, cy - 2, row.z + 2, P.metal[3]);
      iso.beamX(0, len, cy + 2, row.z - 2, P.metal[0]);
      discFaceY(iso, len, cy, row.z, radius, P.metal[2]);
      discFaceY(iso, len, cy, row.z, radius - 2, P.metal[0]);
      ringFaceY(iso, len, cy, row.z, radius, P.metal[3]);
    }
  }
};
var rubble2 = (iso, variant) => {
  const w = 16 + variant % 3 * 4;
  const d = 16 + (variant >> 1) % 2 * 4;
  const peak = 4 + variant % 2 * 2;
  for (let wy = 0; wy < d; wy += 4) {
    for (let wx = 0; wx < w; wx += 4) {
      const dist = Math.abs(wx - (w - 4) / 2) / 2 + Math.abs(wy - (d - 4) / 2) / 2;
      const cap = Math.max(1, peak - Math.round(dist));
      const top = Math.min(cap, 1 + (wx * 3 + wy * 5 + variant * 7) % 4);
      const s = 3 + (wx + wy * 3 + variant) % 2;
      iso.box(wx, wy, s, s, 0, top, mat((wx + wy) % 2 ? P.stone : P.earth));
    }
  }
  for (let i = 0; i < 6; i++) {
    const cx = (i * 7 + variant * 3) % (w + 2);
    const cy = (i * 5 + variant * 2) % (d + 2);
    iso.plot(cx, cy, 1, P.stone[2]);
    iso.plot(cx, cy, 0, P.stone[1]);
  }
};
var skip = (iso, variant) => {
  const long = 20 + variant % 2 * 3;
  const deep = 11 + variant % 2 * 2;
  hollowBox(iso, 0, 0, long, deep, 0, 10, {
    top: P.rust[1],
    lit: P.rust[2],
    shadow: P.rust[0],
    edge: P.ink,
    inner: P.earth[1]
  });
  for (let i = 1; i < 4; i++) {
    iso.column(Math.round(long * i / 4), deep, 2, 9, P.rust[0]);
    iso.column(long, Math.round(deep * i / 4), 2, 9, P.rust[0]);
  }
  iso.beamY(0, deep, long, 10, P.rust[3], 1);
  iso.beamX(0, long, deep, 10, P.rust[2], 1);
  iso.row(4, 12 + variant % 4, 4, 11, P.earth[2]);
  iso.box(long - 8, 3, 3, 10, 10, 13, mat(P.wood));
};
var tripod = (iso, variant) => {
  const h = 14 + variant % 3;
  strut(iso, 8, 8, h, 0, 4, 0, P.wood[1], 1);
  strut(iso, 8, 8, h, 15, 2, 0, P.wood[2], 1);
  strut(iso, 8, 8, h, 8, 16, 0, P.wood[1], 1);
  strut(iso, 3, 6, 6, 12, 4, 6, P.metal[1], 1);
  iso.box(5, 5, 7, 7, h, h + 4, mat(P.metal));
  iso.box(3, 6, 4, 5, h + 1, h + 3, mat(P.rust));
  iso.beamX(3, 6, 11, h + 2, P.glass[2], 1);
  iso.plot(9, 9, h + 5, P.metal[3]);
};
var waterbutt = (iso, variant) => {
  const tall = 16 + variant % 3;
  drum(iso, 0, 0, 12, 12, 0, tall, {
    top: P.rust[1],
    lit: P.rust[2],
    shadow: P.rust[0],
    edge: P.ink,
    hoop: P.metal[1],
    rim: P.metal[2]
  });
  iso.box(1, 1, 10, 10, tall, tall + 2, mat(P.metal));
  iso.plot(6, 6, tall + 2, P.metal[3]);
  iso.box(2, 12, 3, 4, 4, 6, mat(P.metal));
  iso.post(3, 16, 1, 4, P.metal[2], 1);
  iso.plot(4, 16, 7, P.rust[3]);
};
var YARD_DRAWERS = {
  cableDrum,
  cone,
  crane,
  generator,
  girders,
  mixer,
  pallet,
  pipeStack,
  rubble: rubble2,
  skip,
  tripod,
  waterbutt
};

// src/art/props/workshop.ts
function member(iso, x0, y0, z0, x1, y1, z1, thick, ink) {
  const steps = Math.max(1, Math.round(Math.abs(z1 - z0)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const z = z0 + (z1 - z0) * t;
    const wx = x0 + (x1 - x0) * t;
    const wy = y0 + (y1 - y0) * t;
    for (let d = 0; d < thick; d++) iso.plot(wx + d, wy, z, ink);
  }
}
function circleAt(iso, px, py, r, ink) {
  for (let dx = -r; dx <= r; dx++) {
    const half = Math.sqrt(Math.max(0, r * r - dx * dx));
    iso.pix.vline(px + dx, Math.round(py - half), Math.round(py + half), ink);
  }
}
function standingWheel(iso, wx, wy, z, radius, depth, face2, side, hub) {
  for (let d = 0; d < depth; d++) {
    const p = iso.project(wx, wy + d, z);
    circleAt(iso, Math.round(p.x), Math.round(p.y), radius, d === depth - 1 ? face2 : side);
  }
  const cap = iso.project(wx, wy + depth - 1, z);
  circleAt(iso, Math.round(cap.x), Math.round(cap.y), Math.max(1, Math.round(radius * 0.4)), hub);
}
function leaning(iso, x0, x1, yBase, zBase, yTop, zTop, ink) {
  const steps = Math.max(1, Math.round(zTop - zBase));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const wy = yBase + (yTop - yBase) * t;
    const z = zBase + (zTop - zBase) * t;
    for (let wx = x0; wx <= x1; wx++) iso.plot(wx, wy, z, ink);
  }
}
var bandsaw = (iso, variant) => {
  const frame = { top: P.rust[2], lit: P.rust[3], shadow: P.rust[1], edge: P.ink };
  const steel = { top: P.metal[2], lit: P.metal[3], shadow: P.metal[1], edge: P.ink };
  const top = 22;
  const bottom = 4;
  iso.box(0, 0, 3, 9, 3, top + 3, frame);
  iso.beamX(3, 12, 2, top + 1, frame.top, 3);
  iso.beamX(3, 12, 2, 4, frame.top, 3);
  const cap = iso.project(13, 3, 0);
  iso.pix.vline(
    Math.round(cap.x) + 5,
    Math.round(iso.project(13, 3, top).y),
    Math.round(iso.project(13, 3, bottom).y),
    P.metal[3]
  );
  standingWheel(iso, 13, 1, top, 4, 3, P.metal[2], P.metal[1], P.metal[0]);
  standingWheel(iso, 13, 1, bottom, 4, 3, P.metal[2], P.metal[1], P.metal[0]);
  iso.box(3, 2, 10, 5, 13, 14, steel);
  if (variant % 2) iso.box(3, 2, 10, 5, 12, 13, steel);
};
var grindstone = (iso) => {
  hollowBox(iso, 0, 0, 16, 11, 0, 4, {
    top: P.wood[1],
    lit: P.wood[2],
    shadow: P.wood[0],
    edge: P.ink,
    // Water, in the palette's one cool blue: a dry trough with a stone in it is
    // a wheelbarrow of sand.
    inner: P.glass[2]
  });
  member(iso, 2, 3, 4, 6, 3, 13, 4, P.wood[2]);
  member(iso, 14, 3, 4, 10, 3, 13, 4, P.wood[1]);
  standingWheel(iso, 8, 4, 13, 4, 3, P.stone[2], P.stone[0], P.stone[3]);
  member(iso, 2, 9, 4, 6, 9, 13, 4, P.wood[2]);
  member(iso, 14, 9, 4, 10, 9, 13, 4, P.wood[1]);
  iso.beamY(3, 12, 8, 13, P.metal[1], 1);
  member(iso, 8, 12, 13, 8, 14, 9, 1, P.metal[2]);
  iso.plot(8, 14, 9, P.wood[2]);
};
var shavings = (iso, variant) => {
  for (let wy = 0; wy <= 9; wy++) {
    const x0 = 1 + (wy * 3 + variant) % 3;
    const x1 = 15 - (wy * 5 + variant * 2) % 4;
    if (x1 <= x0) continue;
    iso.row(x0, x1, wy, 0, P.wood[1]);
    if (wy > 1 && wy < 8) iso.row(x0 + 1, x1 - 1, wy, 1, P.wood[2]);
  }
  const spots = [
    [4, 2],
    [12, 3],
    [8, 6],
    [14, 7],
    [3, 8]
  ];
  const curls = 3 + variant % 3;
  for (let i = 0; i < curls; i++) {
    const [cx, cy] = spots[(i + variant) % spots.length];
    for (let a = 0; a <= 6; a++) {
      const ang = -0.6 + a / 6 * Math.PI * 1.6;
      iso.plot(cx + Math.cos(ang) * 2.5, cy, 2 + Math.sin(ang) * 2.5, P.wood[3]);
    }
  }
};
var timberRack = (iso, variant) => {
  iso.box(0, 0, 20, 2, 0, 17, {
    top: P.wood[0],
    lit: P.wood[1],
    shadow: P.wood[0],
    edge: P.ink
  });
  iso.post(0, 1, 0, 18, P.wood[2], 1);
  iso.post(20, 1, 0, 18, P.wood[1], 1);
  iso.beamX(0, 20, 2, 15, P.wood[2], 1);
  const boards = 4 + variant % 2;
  const heights = [15, 12, 16, 13, 15];
  for (let i = 0; i < boards; i++) {
    const x0 = 1 + i * 4;
    leaning(iso, x0, x0 + 3, 14, 0, 3, heights[i], i % 2 === 0 ? P.wood[3] : P.wood[2]);
  }
  leaning(iso, 8, 13, 17, 0, 9, 12, P.wood[3]);
};
var toolboard = (iso, variant) => {
  bracedBoard(iso, -5, 0, 28, 0, 17, {
    top: P.wood[2],
    lit: P.wood[1],
    shadow: P.wood[0],
    edge: P.ink,
    face: P.wood[1]
  });
  iso.row(-5, 23, 1, 16, P.wood[0]);
  for (let z = 13; z <= 16; z++) iso.row(-5, 3, 1, z, P.wood[3]);
  for (let z = 6; z <= 12; z++) iso.row(-5, 3 - Math.round((12 - z) / 2), 1, z, P.metal[3]);
  iso.column(11, 1, 7, 13, P.wood[3]);
  for (let z = 13; z <= 15; z++) iso.row(8, 14, 1, z, P.metal[3]);
  if (variant % 2 === 0) {
    for (let z = 13; z <= 15; z++) iso.row(19, 23, 1, z, P.wood[3]);
    iso.column(21, 1, 7, 12, P.metal[3]);
  } else {
    iso.column(19, 1, 7, 15, P.metal[3]);
    for (let z = 13; z <= 15; z++) iso.row(19, 23, 1, z, P.metal[2]);
  }
};
var trestle = (iso) => {
  const deck = 14;
  for (const fx of [4, 16]) {
    member(iso, fx, 0, 0, fx, 5, deck, 4, P.wood[2]);
    member(iso, fx, 11, 0, fx, 6, deck, 4, P.wood[1]);
    iso.beamY(4, 7, fx, 6, P.wood[0], 1);
  }
  iso.box(-4, 3, 26, 5, deck, deck + 2, {
    top: P.wood[3],
    lit: P.wood[2],
    shadow: P.wood[1],
    edge: P.ink
  });
};
var vise = (iso, variant) => {
  const open = variant % 2;
  const fixed = { top: P.metal[0], lit: P.metal[2], shadow: P.metal[0], edge: P.ink };
  const moving = { top: P.metal[2], lit: P.metal[3], shadow: P.metal[1], edge: P.ink };
  iso.box(1, 1, 13, 10, 0, 3, {
    top: P.rust[2],
    lit: P.rust[3],
    shadow: P.rust[1],
    edge: P.ink
  });
  iso.box(-1, 0, 16, 4, 3, 11, fixed);
  iso.beamY(4, 8 + open, 4, 8, P.metal[1], 1);
  iso.beamY(4, 8 + open, 12, 5, P.metal[0], 1);
  iso.box(-1, 8 + open, 16, 4, 3, 11, moving);
  iso.beamX(0, 15, 12 + open, 6, P.metal[2], 1);
  iso.plot(-1, 12 + open, 6, P.metal[3]);
  iso.plot(15, 12 + open, 6, P.metal[3]);
};
var workbench = (iso, variant) => {
  const deck = 10;
  for (const [lx, ly] of [
    [1, 1],
    [19, 1],
    [1, 10],
    [19, 10]
  ]) {
    iso.post(lx, ly, 0, deck, P.wood[1], 1);
  }
  iso.box(1, 1, 18, 9, 3, 4, {
    top: P.wood[1],
    lit: P.wood[2],
    shadow: P.wood[0],
    edge: P.ink
  });
  iso.box(-1, -1, 22, 13, deck, deck + 2, {
    top: P.wood[3],
    lit: P.wood[2],
    shadow: P.wood[1],
    edge: P.ink
  });
  hollowBox(iso, -1, -1, 22, 5, deck + 2, deck + 3, {
    top: P.wood[1],
    lit: P.wood[2],
    shadow: P.wood[0],
    edge: P.ink,
    inner: P.wood[0]
  });
  const stack = 2 + variant % 2;
  for (let i = 0; i < stack; i++) {
    const z = deck + 2 + i * 2;
    iso.box(1, 5, 9, 4, z, z + 2, {
      top: P.wood[2],
      lit: P.wood[3],
      shadow: P.wood[1],
      edge: P.ink
    });
  }
  iso.box(13, 8, 8, 1, deck + 2, deck + 3, {
    top: P.metal[2],
    lit: P.metal[3],
    shadow: P.metal[1],
    edge: P.ink
  });
  iso.box(18, 7, 3, 3, deck + 2, deck + 5, {
    top: P.wood[1],
    lit: P.wood[2],
    shadow: P.wood[0],
    edge: P.ink
  });
  iso.post(14, 6, deck + 2, deck + 6, P.wood[3], 1);
  iso.box(12, 5, 4, 3, deck + 6, deck + 8, {
    top: P.wood[2],
    lit: P.wood[3],
    shadow: P.wood[1],
    edge: P.ink
  });
};
var WORKSHOP_DRAWERS = {
  bandsaw,
  grindstone,
  shavings,
  timberRack,
  toolboard,
  trestle,
  vise,
  workbench
};

// src/art/props/tools.ts
var CLEAR = [0, 0, 0, 0];
function slant(iso, x0, y0, z0, x1, y1, z1, ink, thick = 2) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const steps = Math.max(1, Math.round(Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz))));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    iso.column(x0 + dx * t, y0 + dy * t, z0 + dz * t - (thick - 1), z0 + dz * t, ink);
  }
}
function toothEdge(iso, x0, x1) {
  for (let x = Math.round(x0); x <= Math.round(x1); x++) {
    if (x % 2 !== 0) continue;
    let taken = 0;
    for (let y = iso.pix.h - 1; y >= 0 && taken < 2; y--) {
      if (!iso.pix.isOpaque(x, y)) continue;
      iso.pix.set(x, y, CLEAR);
      taken++;
    }
  }
}
var axe = (iso) => {
  slant(iso, 4, 4, 3, 4, 20, 16, P.wood[2], 2);
  slant(iso, 6, 4, 3, 6, 20, 16, P.wood[3], 2);
  iso.box(2, 4, 4, 4, 0, 4, { top: P.metal[1], lit: P.metal[2], shadow: P.metal[0] });
  iso.box(6, 3, 4, 6, 0, 4, { top: P.metal[2], lit: P.metal[3], shadow: P.metal[0] });
  iso.box(10, 2, 4, 8, 0, 4, { top: P.metal[3], lit: P.metal[3], shadow: P.metal[1] });
};
var chisel = (iso) => {
  iso.box(-8, 2, 6, 5, 0, 4, { top: P.wood[2], lit: P.wood[3], shadow: P.wood[1], edge: P.ink });
  iso.box(-2, 2, 2, 5, 0, 4, { top: P.metal[3], lit: P.metal[3], shadow: P.metal[2] });
  iso.box(0, 4, 6, 2, 0, 2, { top: P.metal[0], lit: P.metal[1], shadow: P.metal[0] });
  iso.box(6, 2, 3, 6, 0, 3, { top: P.metal[3], lit: P.metal[3], shadow: P.metal[1] });
};
var clamp = (iso) => {
  iso.box(4, 0, 3, 18, 0, 2, { top: P.metal[1], lit: P.metal[2], shadow: P.metal[0] });
  iso.box(1, 0, 8, 3, 2, 8, { top: P.rust[2], lit: P.rust[3], shadow: P.rust[1], edge: P.ink });
  iso.box(2, 13, 6, 3, 2, 7, { top: P.rust[3], lit: P.rust[2], shadow: P.rust[1], edge: P.ink });
  iso.beamY(16, 22, 5, 4, P.metal[3], 2);
  iso.beamX(1, 9, 22, 4, P.wood[2], 2);
};
var handplane = (iso, variant) => {
  const len = 16 + variant % 3 * 2;
  iso.box(-3, 3, len + 6, 5, 0, 2, { top: P.wood[0], lit: P.wood[1], shadow: P.wood[0] });
  iso.box(0, 3, len, 5, 2, 6, { top: P.wood[3], lit: P.wood[2], shadow: P.wood[1], edge: P.ink });
  iso.box(1, 4, 4, 3, 6, 8, { top: P.wood[3], lit: P.wood[3], shadow: P.wood[1] });
  iso.box(len - 4, 4, 3, 3, 6, 13, { top: P.wood[3], lit: P.wood[2], shadow: P.wood[0] });
  iso.box(len - 8, 4, 2, 3, 6, 9, { top: P.metal[3], lit: P.metal[3], shadow: P.metal[1] });
};
var handsaw = (iso, variant) => {
  const len = 17 + variant % 3;
  const depth = 6;
  iso.box(0, 0, len, depth, 0, 2, { top: P.metal[2], lit: P.metal[3], shadow: P.metal[1] });
  toothEdge(iso, iso.project(0, depth, 0).x + 1, iso.project(len, 0, 0).x);
  iso.box(-8, 1, 8, 5, 0, 4, { top: P.wood[2], lit: P.wood[3], shadow: P.wood[1], edge: P.ink });
  iso.box(-8, 1, 5, 5, 4, 9, { top: P.wood[3], lit: P.wood[2], shadow: P.wood[0] });
};
var ladder = (iso, variant) => {
  const climb = 11;
  const height = 24;
  const rungs = 4 + variant % 3;
  const rail = (yBase, ink) => {
    for (let z = 0; z <= height; z++) {
      const x = climb * z / height;
      iso.column(x, yBase, z, z + 1, ink);
      iso.column(x, yBase + 2, z, z + 1, ink);
    }
  };
  rail(14, P.wood[2]);
  rail(0, P.wood[1]);
  for (let k = 1; k <= rungs; k++) {
    const z = Math.round(height * k / (rungs + 1));
    iso.beamY(0, 16, climb * z / height, z, P.wood[3], 1);
  }
};
var oilcan = (iso) => {
  iso.box(1, 1, 12, 12, 0, 2, { top: P.metal[1], lit: P.metal[2], shadow: P.metal[0] });
  iso.box(0, 0, 14, 14, 2, 8, { top: P.metal[2], lit: P.metal[3], shadow: P.metal[1], edge: P.ink });
  iso.box(4, 4, 6, 6, 8, 12, { top: P.metal[3], lit: P.metal[3], shadow: P.metal[2], edge: P.ink });
  slant(iso, 10, 4, 9, 17, 4, 19, P.metal[3], 2);
  slant(iso, 10, 6, 9, 17, 6, 19, P.metal[2], 2);
};
var ropeCoil = (iso, variant) => {
  const outer = 10 + variant % 2;
  const inner = 8;
  const cx = 8;
  const cy = 8;
  const top = 3;
  for (let wy = -outer; wy <= outer; wy++) {
    for (let wx = -outer; wx <= outer; wx++) {
      const d = Math.sqrt(wx * wx + wy * wy);
      if (d > outer || d < inner) continue;
      iso.plot(cx + wx, cy + wy, top, P.canvas[3]);
      if (d > outer - 2.5 && wx + wy > 0) {
        iso.column(cx + wx, cy + wy, 0, top - 1, wy > wx ? P.canvas[2] : P.canvas[1]);
      }
    }
  }
  slant(iso, cx - 1, cy + outer - 1, 1, cx - 6, cy + outer + 5, 0, P.canvas[2], 1);
};
var spade = (iso) => {
  const plate = { top: P.metal[1], lit: P.metal[2], shadow: P.metal[0] };
  iso.box(1, 3, 9, 2, 0, 2, plate);
  iso.box(2, 3, 7, 2, 2, 4, plate);
  iso.box(3, 3, 5, 2, 4, 6, plate);
  iso.box(4, 3, 3, 2, 6, 8, plate);
  iso.post(5, 3, 7, 20, P.wood[2], 1);
  iso.post(6, 3, 7, 20, P.wood[3], 1);
  iso.beamX(1, 10, 3, 21, P.wood[3], 2);
  iso.beamX(1, 10, 3, 19, P.wood[2], 1);
};
var trowel = (iso) => {
  const leaf = { top: P.metal[3], lit: P.metal[2], shadow: P.metal[1] };
  iso.box(3, 0, 6, 3, 0, 2, leaf);
  iso.box(2, 2, 8, 4, 0, 2, leaf);
  iso.box(3, 5, 6, 4, 0, 2, leaf);
  iso.box(4, 8, 4, 2, 0, 2, leaf);
  iso.box(4, -7, 4, 8, 0, 3, { top: P.wood[2], lit: P.wood[3], shadow: P.wood[1], edge: P.ink });
  iso.box(3, 0, 5, 2, 3, 4, { top: P.metal[1], lit: P.metal[2], shadow: P.metal[0] });
};
var TOOL_DRAWERS = {
  axe,
  chisel,
  clamp,
  handplane,
  handsaw,
  ladder,
  oilcan,
  ropeCoil,
  spade,
  trowel
};

// src/art/props/depot.ts
function face(iso, wx0, wx1, wy, z0, z1, ink) {
  for (let wx = wx0; wx <= wx1; wx++) iso.column(wx, wy, z0, z1, ink);
}
function paper(iso, wx, wy, z0, z1, wide = 6) {
  face(iso, wx, wx + wide - 1, wy, z0, z1, P.paper);
  const mid = Math.round((z0 + z1) / 2);
  iso.beamX(wx, wx + wide - 1, wy, mid + 1, P.glass[2], 1);
  iso.beamX(wx, wx + Math.max(0, wide - 3), wy, mid, P.glass[1], 1);
}
var drafting = (iso, variant) => {
  const zTop = 12;
  iso.post(1, 1, 0, 9, P.wood[1], 1);
  iso.post(17, 1, 0, 11, P.wood[2], 1);
  iso.post(1, 11, 0, 11, P.wood[2], 1);
  iso.post(17, 11, 0, 9, P.wood[1], 1);
  for (let i = 0; i < 3; i++) {
    const wy = i * 4;
    const z = zTop + i * 2;
    iso.box(0, wy, 20, 4, z - 1, z, {
      top: P.wood[3],
      lit: P.wood[2],
      shadow: P.wood[1],
      edge: P.ink
    });
  }
  const sheets = 2 + variant % 2;
  for (let i = 0; i < sheets; i++) {
    paper(iso, 4 + i * 5, 2 + i, zTop + 1 + i, zTop + 5 + i, 6);
  }
  iso.beamX(-1, 21, 12, zTop - 1, P.metal[3], 1);
  iso.beamY(11, 13, -1, zTop, P.metal[2], 1);
};
var noticeboard = (iso, variant) => {
  bracedBoard(iso, 0, 0, 22, 0, 22, {
    top: P.wood[2],
    lit: P.canvas[1],
    shadow: P.canvas[0],
    face: P.canvas[2],
    edge: P.ink
  });
  const sheets = [
    [2, 6, 12, 15],
    [9, 5, 13, 18],
    [15, 7, 10, 14]
  ];
  sheets.slice(0, 2 + variant % 2).forEach(([wx, wide, z0, z1]) => {
    paper(iso, wx, 0, z0, z1, wide);
  });
  iso.beamX(0, 21, 0, 20, P.wood[0], 1);
};
var shelving = (iso) => {
  const top = 23;
  const shelves = [0, 7, 14, top];
  iso.post(0, 0, 0, top + 2, P.wood[1], 1);
  iso.post(18, 0, 0, top + 2, P.wood[1], 1);
  iso.post(0, 9, 0, top + 2, P.wood[0], 1);
  iso.post(18, 9, 0, top + 2, P.wood[0], 1);
  for (const z of shelves) {
    iso.box(0, 0, 18, 9, z, z + 2, {
      top: P.wood[3],
      lit: P.wood[2],
      shadow: P.wood[1],
      edge: P.ink
    });
  }
  iso.box(2, 1, 13, 6, 9, 14, { top: P.paperDim, lit: P.paper, shadow: P.paperDim, edge: P.ink });
  iso.beamY(1, 7, 8, 12, P.glass[0], 1);
  for (let a = 0; a < 8; a++) {
    const ang = a / 8 * Math.PI * 2;
    iso.plot(9 + Math.cos(ang) * 5, 4 + Math.sin(ang) * 3, 16, a % 2 === 0 ? P.rubber[3] : P.rubber[2]);
  }
  iso.box(3, 2, 8, 6, top + 2, top + 3, {
    top: P.canvas[2],
    lit: P.canvas[3],
    shadow: P.canvas[1],
    edge: P.ink
  });
  iso.box(12, 3, 5, 5, top + 2, top + 4, {
    top: P.glass[3],
    lit: P.glass[2],
    shadow: P.glass[1],
    edge: P.ink
  });
};
var cabinet = (iso) => {
  iso.box(0, 0, 15, 10, 0, 20, {
    top: P.metal[2],
    lit: P.metal[3],
    shadow: P.metal[1],
    edge: P.ink
  });
  for (let i = 0; i < 3; i++) {
    const z = 2 + i * 6;
    face(iso, 1, 14, 10, z, z + 4, P.metal[2]);
    face(iso, 3, 8, 10, z + 2, z + 3, P.paperDim);
    iso.beamX(11, 13, 10, z + 3, P.metal[0], 1);
  }
  iso.box(1, 10, 13, 5, 8, 12, {
    top: P.metal[2],
    lit: P.metal[3],
    shadow: P.metal[1],
    edge: P.ink
  });
  for (let i = 0; i < 4; i++) {
    face(iso, 2 + i * 3, 2 + i * 3, 14, 12, 15, P.paperDim);
  }
};
var ledger = (iso) => {
  iso.box(0, 3, 14, 8, 0, 3, { top: P.wood[2], lit: P.wood[3], shadow: P.wood[1], edge: P.ink });
  iso.post(1, 4, 0, 2, P.wood[1], 1);
  iso.post(12, 10, 0, 2, P.wood[1], 1);
  iso.box(0, 2, 7, 5, 3, 5, { top: P.paper, lit: P.paper, shadow: P.paperDim, edge: P.ink });
  iso.box(8, 2, 7, 5, 3, 5, { top: P.paper, lit: P.paper, shadow: P.paperDim, edge: P.ink });
  for (let i = 0; i < 4; i++) {
    const wy = 3 + i;
    iso.beamX(1, 6, wy, 5, P.glass[2], 1);
    iso.beamX(9, 14, wy, 5, P.glass[2], 1);
  }
  iso.beamY(2, 6, 7, 5, P.leather, 1);
  iso.box(0, 9, 9, 5, 0, 2, { top: P.leather, lit: P.roof[1], shadow: P.roof[0], edge: P.ink });
};
var scales = (iso) => {
  iso.box(3, 3, 9, 9, 0, 3, { top: P.metal[2], lit: P.metal[3], shadow: P.metal[1], edge: P.ink });
  iso.post(7, 7, 3, 20, P.metal[2], 2);
  iso.beamX(0, 15, 7, 20, P.metal[3], 1);
  iso.column(7, 7, 10, 19, P.accentDim);
  iso.plot(7, 7, 10, P.accent);
  for (const wx of [0, 15]) {
    iso.column(wx, 7, 12, 19, P.metal[1]);
    iso.box(wx - 2, 5, 5, 5, 10, 12, {
      top: P.metal[1],
      lit: P.metal[2],
      shadow: P.metal[0],
      edge: P.ink
    });
  }
  iso.box(-1, 6, 3, 3, 12, 14, { top: P.earth[3], lit: P.earth[2], shadow: P.earth[1], edge: P.ink });
};
var radio = (iso) => {
  iso.box(0, 0, 16, 9, 0, 11, {
    top: P.wood[1],
    lit: P.wood[2],
    shadow: P.wood[0],
    edge: P.ink
  });
  for (let i = 0; i < 4; i++) {
    face(iso, 1, 8, 9, 3 + i * 2, 3 + i * 2, P.ink);
  }
  iso.column(11, 9, 3, 8, P.metal[3]);
  iso.column(14, 9, 3, 8, P.metal[3]);
  iso.plot(11, 9, 6, P.ink);
  face(iso, 12, 13, 9, 6, 8, P.glass[2]);
  for (let i = 0; i < 9; i++) iso.plot(15 - i * 0.5, 1 + i * 0.4, 11 + i, P.accentDim);
  iso.plot(15, 1, 11, P.accent);
};
var parcel = (iso, variant) => {
  const boxes = [
    [0, 0, 14, 9, 0, 8],
    [3, 2, 10, 7, 8, 15]
  ];
  boxes.slice(0, 1 + variant % 2).forEach(([wx, wy, w, d, z0, z1]) => {
    iso.box(wx, wy, w, d, z0, z1, {
      top: P.canvas[2],
      lit: P.canvas[3],
      shadow: P.canvas[1],
      edge: P.ink
    });
    const mx = Math.round(wx + w / 2);
    const my = Math.round(wy + d / 2);
    iso.beamY(wy, wy + d, mx, z1, P.leather, 1);
    iso.beamX(wx, wx + w, my, z1, P.leather, 1);
    iso.column(mx, wy + d, z0, z1, P.leather);
    iso.plot(mx, my, z1 + 1, P.leather);
    iso.plot(mx + 1, my, z1 + 1, P.canvas[0]);
  });
};
var clock = (iso) => {
  iso.post(1, 1, 0, 14, P.wood[1], 2);
  iso.beamY(1, 6, 1, 14, P.wood[0], 1);
  iso.box(-1, -1, 12, 12, 12, 22, {
    top: P.wood[2],
    lit: P.wood[3],
    shadow: P.wood[0],
    edge: P.ink
  });
  for (let a = 0; a < 8; a++) {
    const ang = a / 8 * Math.PI * 2;
    const px = Math.round(5 + Math.cos(ang) * 4.5);
    const pz = Math.round(17 + Math.sin(ang) * 4.5);
    iso.plot(px, 11, pz, P.paperDim);
  }
  iso.plot(3, 11, 18, P.ink);
  iso.plot(4, 11, 17, P.ink);
  iso.plot(7, 11, 19, P.ink);
  iso.plot(8, 11, 20, P.ink);
  iso.plot(5, 11, 17, P.accentDim);
};
var stove = (iso) => {
  iso.box(1, 1, 13, 13, 1, 4, { top: P.rust[1], lit: P.rust[2], shadow: P.rust[0], edge: P.ink });
  iso.box(0, 0, 15, 15, 4, 13, { top: P.rust[2], lit: P.rust[3], shadow: P.rust[1], edge: P.ink });
  iso.box(1, 1, 13, 13, 13, 16, { top: P.rust[2], lit: P.rust[1], shadow: P.rust[0], edge: P.ink });
  face(iso, 3, 10, 15, 5, 11, P.rust[0]);
  iso.plot(9, 15, 8, P.accent);
  iso.beamX(4, 5, 15, 10, P.metal[1], 1);
  iso.post(12, 12, 16, 26, P.rust[1], 2);
  iso.beamX(6, 12, 12, 26, P.rust[1], 2);
  iso.post(6, 12, 24, 26, P.rust[0], 2);
};
var anvil = (iso) => {
  iso.box(0, 4, 12, 8, 0, 8, { top: P.wood[1], lit: P.wood[2], shadow: P.wood[0], edge: P.ink });
  iso.box(1, 5, 10, 6, 8, 12, { top: P.metal[2], lit: P.metal[3], shadow: P.metal[1], edge: P.ink });
  iso.box(11, 6, 4, 4, 9, 12, { top: P.metal[3], lit: P.metal[2], shadow: P.metal[1], edge: P.ink });
  iso.beamY(5, 11, 1, 12, P.metal[3], 1);
};
var planboard = (iso) => {
  iso.box(0, 2, 3, 12, 0, 20, {
    top: P.wood[1],
    lit: P.wood[2],
    shadow: P.wood[0],
    edge: P.ink
  });
  iso.box(-3, 1, 2, 14, 8, 19, { top: P.paperDim, lit: P.paper, shadow: P.paperDim, edge: P.ink });
  iso.beamY(3, 11, -1, 15, P.glass[2], 1);
  iso.beamY(3, 8, -1, 12, P.glass[1], 1);
};
var DEPOT_DRAWERS = {
  anvil,
  cabinet,
  clock,
  drafting,
  ledger,
  noticeboard,
  parcel,
  planboard,
  radio,
  scales,
  shelving,
  stove
};

// src/art/props.ts
var DRAWERS = {
  ...SHARED_DRAWERS,
  ...YARD_DRAWERS,
  ...WORKSHOP_DRAWERS,
  ...TOOL_DRAWERS,
  ...DEPOT_DRAWERS
};
var SHADOW_DX = 2;
var SHADOW_DY = 3;
var SHADOW_GROW = 2;
function buildProp(kind, variant = 0, turn = 0) {
  const iso = new IsoPix(CEL_W, CEL_H, PROP_ORIGIN.x, PROP_ORIGIN.y, turn, {
    track: true,
    scale: PROP_SCALE
  });
  const draw = DRAWERS[kind];
  if (draw) draw(iso, variant);
  const prop = iso.outline(P.ink);
  const foot = iso.footprintOf();
  if (!foot) return prop;
  const shadow = new IsoPix(CEL_W, CEL_H, PROP_ORIGIN.x, PROP_ORIGIN.y, turn, {
    scale: PROP_SCALE
  });
  shadow.footprint(
    foot.x + SHADOW_DX,
    foot.y + SHADOW_DY,
    foot.w + SHADOW_GROW * 2,
    foot.h + SHADOW_GROW * 2,
    0,
    P.grass[0]
  );
  return shadow.pix.blit(prop, 0, 0);
}

// test/turn-dependence.test.ts
var TURNS2 = [0, 1, 2, 3];
function fingerprint(pix) {
  return Buffer.from(pix.data).toString("base64");
}
function assertAnswersToTurn(name, draw) {
  const drawings = TURNS2.map(draw);
  assert.ok(drawings.every((pix) => !pix.empty()), `${name} has an empty turn`);
  assert.ok(new Set(drawings.map(fingerprint)).size > 1, `${name} ignores turn`);
}
test("building base, band, cap, and shadow art answer to turn", () => {
  assertAnswersToTurn("base", (turn) => buildBase(58, "stone", "completed", false, turn));
  assertAnswersToTurn("band", (turn) => buildBand(58, "stone", "completed", turn));
  assertAnswersToTurn("cap", (turn) => buildCap(58, ARCHETYPES[1], "completed", turn));
  assertAnswersToTurn("shadow", (turn) => buildShadow(58, 9, "b", turn));
});
test("an asymmetric cap changes across a half turn", () => {
  const turn0 = buildCap(58, ARCHETYPES[1], "completed", 0);
  const turn2 = buildCap(58, ARCHETYPES[1], "completed", 2);
  assert.notDeepEqual(turn0.data, turn2.data);
});
test("machine art answers to turn for every kind", () => {
  for (const kind of MACHINES) {
    assertAnswersToTurn(`machine ${kind}`, (turn) => buildMachine(kind, "work", "chief", turn));
  }
});
test("prop art answers to turn for representative asymmetric props", () => {
  for (const kind of ["signpost", "wheelbarrow", "crane"]) {
    assertAnswersToTurn(`prop ${kind}`, (turn) => buildProp(kind, 0, turn));
  }
});
