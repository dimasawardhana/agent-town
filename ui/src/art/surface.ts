// Pix: the surface every sprite in this town is authored on.
//
// It is deliberately the smallest thing that can hold pixel art: an RGBA
// buffer with the handful of primitives a 16-bit asset needs. No blend modes,
// no gradients, no filters — a colour is either placed or it is not, which is
// what keeps the art honest at 12 pixels tall.
//
// Two rules are enforced here rather than left to discipline:
//
//   - Art is authored by composition. Parts are drawn once as readable
//     character grids and blitted into place, so a helmet is drawn once and
//     not re-invented for each of a worker's sixty cels.
//   - Every pixel is opaque or absent. Anti-aliasing to a background is the
//     trap the reference warns about: it looks right against the grass and
//     wears a halo over the panel. `outline` exists to give an edge instead,
//     and it draws ink rather than half-transparency.

/** A colour resolved to bytes. Alpha is 0-255 throughout, never a fraction. */
export type RGBA = readonly [number, number, number, number];

/** Resolve `#rrggbb` to bytes. */
export function rgba(hex: string, alpha = 255): RGBA {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  const n = parseInt(h, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, alpha];
}

/** An #rrggbb string for bytes, so a sprite's colours can be asserted. */
export function hex(r: number, g: number, b: number): string {
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

/** Anything a pixel can be given: a hex string, or bytes for a tinted pixel. */
export type Ink = string | RGBA;

const TRANSPARENT: RGBA = [0, 0, 0, 0];

/**
 * Pix is a mutable RGBA bitmap.
 *
 * Coordinates are integers with the origin at the top-left, y increasing
 * downward, matching both canvas and every pixel-art tool's convention.
 */
export class Pix {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8ClampedArray;

  constructor(w: number, h: number) {
    if (w <= 0 || h <= 0) throw new Error(`Pix: bad size ${w}x${h}`);
    this.w = w;
    this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }

  /** inBounds reports whether a coordinate is inside the surface. */
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  /** isOpaque reports whether a pixel holds anything. */
  isOpaque(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    return this.data[(y * this.w + x) * 4 + 3] !== 0;
  }

  /** at returns a pixel's bytes, or fully transparent outside the surface. */
  at(x: number, y: number): RGBA {
    if (!this.inBounds(x, y)) return TRANSPARENT;
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  /** set places one pixel. Out-of-bounds writes are dropped, so callers may
   *  draw shapes that overhang the edge without guarding every coordinate. */
  set(x: number, y: number, ink: Ink, alpha = 255): this {
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
  blit(src: Pix, dx: number, dy: number): this {
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
  replace(from: string, to: string): this {
    const [fr, fg, fb] = rgba(from);
    for (let i = 0; i < this.data.length; i += 4) {
      if (
        this.data[i] === fr &&
        this.data[i + 1] === fg &&
        this.data[i + 2] === fb &&
        this.data[i + 3] !== 0
      ) {
        const [r, g, b] = rgba(to);
        this.data[i] = r;
        this.data[i + 1] = g;
        this.data[i + 2] = b;
      }
    }
    return this;
  }



  /**
   * outline draws a 1px ink edge around every opaque pixel.
   *
   * Done as a separate pass, on the assembled cel rather than on each part, so
   * joints between parts do not acquire interior lines. A uniform 1px outline
   * at every size is the consistency rule the reference names, and this is the
   * only place it is implemented.
   */
  outline(ink: string): Pix {
    const out = this.clone();
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.isOpaque(x, y)) continue;
        if (
          this.isOpaque(x - 1, y) ||
          this.isOpaque(x + 1, y) ||
          this.isOpaque(x, y - 1) ||
          this.isOpaque(x, y + 1)
        ) {
          out.set(x, y, ink);
        }
      }
    }
    return out;
  }

  /** vline fills a vertical run. `IsoPix.column` is built on it: a wall face is
   *  a stack of these at one picture x, which is what keeps a wall solid. */
  vline(x: number, y0: number, y1: number, ink: Ink): this {
    for (let y = y0; y <= y1; y++) this.set(x, y, ink);
    return this;
  }

  /** colours lists every distinct colour present. It is how the art
   *  verification asserts that no cel introduced a colour the palette does not
   *  contain, which the boot-time bake cannot check for the whole atlas. */
  colours(): string[] {
    const seen = new Set<string>();
    for (let i = 0; i < this.data.length; i += 4) {
      if (this.data[i + 3] === 0) continue;
      seen.add(hex(this.data[i], this.data[i + 1], this.data[i + 2]));
    }
    return [...seen].sort();
  }

  /** empty reports whether anything was drawn at all. A blank cel is always a
   *  bug rather than a style choice, so the art checks assert against it. */
  empty(): boolean {
    for (let i = 3; i < this.data.length; i += 4) if (this.data[i] !== 0) return false;
    return true;
  }
  clone(): Pix {
    const out = new Pix(this.w, this.h);
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
  drawInto(ctx: CanvasRenderingContext2D, dx: number, dy: number): void {
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
  toCanvas(): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = this.w;
    c.height = this.h;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Pix: no 2d context");
    this.drawInto(ctx, 0, 0);
    return c;
  }
}

/**
 * sprite authors a cel from character rows.
 *
 * One character is one pixel, and the key maps characters to colours. `.` is
 * the only character that means transparent.
 *
 * Every row must be the same length, and every other character must be in the
 * key; either fault throws. Both used to be tolerated, and both hid real
 * defects rather than causing them: a ragged grid silently shifted the art, and
 * an unmapped character silently drew *nothing* — so a mistyped colour key left
 * a hole in the sprite that the outline pass then boxed into a solid ink blob.
 * That is opaque, on-palette and type-safe, so nothing downstream could see it;
 * the boots on every worker were drawn that way, and a sheet of paper lost its
 * fill entirely. A bake-time refusal is the only place this can be caught.
 */
export function sprite(rows: readonly string[], key: Record<string, string>): Pix {
  const h = rows.length;
  if (h === 0) throw new Error("sprite: no rows");
  const w = rows[0].length;
  for (let i = 1; i < h; i++) {
    if (rows[i].length !== w) {
      throw new Error(`sprite: row ${i} is ${rows[i].length} wide, row 0 is ${w}`);
    }
  }
  const out = new Pix(w, h);
  const unknown = new Set<string>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = rows[y][x];
      if (c === ".") continue;
      const ink = key[c];
      if (ink === undefined) {
        unknown.add(c);
        continue;
      }
      out.set(x, y, ink);
    }
  }
  if (unknown.size > 0) {
    throw new Error(
      `sprite: no colour for character(s) ${[...unknown].map((c) => JSON.stringify(c)).join(", ")}; ` +
        `the key has ${Object.keys(key).sort().join("")}. A missing key entry draws nothing, ` +
        `which the outline pass then turns into a solid blob.`,
    );
  }
  return out;
}


/**
 * compose assembles a cel from placed parts.
 *
 * Each part is blitted in order, so later parts occlude earlier ones — which is
 * the draw order of a figure: torso, then the arm in front of it, then the tool
 * in front of that.
 */
export function compose(
  w: number,
  h: number,
  parts: readonly { src: Pix; x: number; y: number }[],
): Pix {
  const out = new Pix(w, h);
  for (const p of parts) out.blit(p.src, p.x, p.y);
  return out;
}
