// Iso: the projection, and the box/roof primitives every building is built
// from.
//
// The layout stays in top-down world units and is never recomputed in the
// browser (ADR-0012). This module only *projects* it:
//
//     sx = (wx - wy) / 2
//     sy = (wx + wy) / 4 - z
//
// which is the classic 2:1 dimetric every 16-bit town-builder used. Moving one
// world unit along x moves the picture half a pixel right and a quarter down;
// moving along y moves it half a pixel left and a quarter down. A square
// footprint therefore projects to a diamond twice as wide as it is tall.
//
// Everything here rasterises by walking integers in world space and plotting
// pixels, never by filling a canvas path. Canvas path filling is antialiased
// and cannot be switched off — `imageSmoothingEnabled` governs image sampling,
// not geometry — so a Graphics-drawn diamond would always arrive with a soft,
// muddy rim. Plotting is also what makes a 2:1 stair-step exact rather than
// approximate.

import { type Ink, Pix, rgba } from "./surface";

/** A point in the picture, in pixels. */
export interface Point {
  x: number;
  y: number;
}

/**
 * IsoPix is a Pix with the projection bound to it.
 *
 * `ox`/`oy` are the picture-space origin: the pixel that world (0, 0, 0) lands
 * on. Each baked asset sets its own origin so the sprite's bounding box starts
 * at (0, 0) without every caller re-deriving the offset.
 */
export class IsoPix {
  readonly pix: Pix;
  private readonly ox: number;
  private readonly oy: number;

  constructor(w: number, h: number, ox: number, oy: number) {
    this.pix = new Pix(w, h);
    this.ox = ox;
    this.oy = oy;
  }

  /** project maps a world point to this surface's pixel coordinates. */
  project(wx: number, wy: number, z = 0): Point {
    return {
      x: (wx - wy) / 2 + this.ox,
      y: (wx + wy) / 4 - z + this.oy,
    };
  }

  /**
   * plot places one world point.
   *
   * Rounding is half-up and monotonic in each axis, so a run of world points
   * that steps by one unit produces a gapless stair rather than a dotted line.
   */
  plot(wx: number, wy: number, z: number, ink: Ink): this {
    const p = this.project(wx, wy, z);
    this.pix.set(Math.round(p.x), Math.round(p.y), ink);
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
  column(wx: number, wy: number, zBottom: number, zTop: number, ink: Ink): this {
    const top = this.project(wx, wy, zTop);
    const bottom = this.project(wx, wy, zBottom);
    const x = Math.round(top.x);
    const y0 = Math.round(top.y);
    const y1 = Math.round(bottom.y);
    this.pix.vline(x, Math.min(y0, y1), Math.max(y0, y1), ink);
    return this;
  }

  /** horizontal steps along world x at a fixed y, used for ground and beams. */
  row(wx0: number, wx1: number, wy: number, z: number, ink: Ink): this {
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
  footprint(x: number, y: number, w: number, h: number, z: number, ink: Ink): this {
    for (let wy = y; wy <= y + h; wy++) {
      for (let wx = x; wx <= x + w; wx++) this.plot(wx, wy, z, ink);
    }
    return this;
  }

  /** footprintRim draws only the outline of a footprint, 1px, in the order the
   *  edges appear on screen so a broken rim can be closed deliberately. */
  footprintRim(x: number, y: number, w: number, h: number, z: number, ink: Ink): this {
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
   * rect3d draws an axis-aligned world box.
   *
   * Of the four walls only two are ever visible from a fixed camera: the ones
   * at x+w and y+h. In the picture the y+h wall lies on the lower-left flank
   * and the x+w wall on the lower-right, so they are named `lit` and `shadow`:
   * the light is up and to the left, so the lower-left wall catches it and the
   * lower-right turns away. Naming them by world axis instead keeps being read
   * backwards at every call site.
   */
  box(
    x: number,
    y: number,
    w: number,
    h: number,
    zBottom: number,
    zTop: number,
    shade: { top: Ink; lit: Ink; shadow: Ink; edge?: Ink },
  ): this {
    for (let wy = y; wy <= y + h; wy++) this.column(x + w, wy, zBottom, zTop, shade.shadow);
    for (let wx = x; wx <= x + w; wx++) this.column(wx, y + h, zBottom, zTop, shade.lit);

    // The top, far rows first. Larger wy projects lower on screen and is
    // therefore nearer the camera, so walking y upward draws back to front and
    // the near rows land last — which is what keeps the seam between the top
    // and the wall below it a single pixel wide.
    for (let wy = y; wy <= y + h; wy++) {
      for (let wx = x; wx <= x + w; wx++) this.plot(wx, wy, zTop, shade.top);
    }

    if (shade.edge) {
      for (let wy = y; wy <= y + h; wy++) this.plot(x + w, wy, zBottom, shade.edge);
      for (let wx = x; wx <= x + w; wx++) this.plot(wx, y + h, zBottom, shade.edge);
    }
    return this;
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
  gable(
    x: number,
    y: number,
    w: number,
    h: number,
    zEave: number,
    height: number,
    shade: { near: Ink; far: Ink; ridge: Ink; gable: Ink; edge?: Ink },
  ): this {
    const mid = y + h / 2;
    const half = Math.max(1, h / 2);
    const ridgeY = Math.round(mid);

    // Far slope: the plane facing away, from the y edge up to the ridge.
    for (let wy = y; wy <= ridgeY; wy++) {
      const z = zEave + height * ((wy - y) / half);
      for (let wx = x; wx <= x + w; wx++) this.plot(wx, wy, z, shade.far);
    }

    // Near slope: the lit plane, walked from the ridge down to the y+h edge and
    // drawn second, so it overlaps the seam rather than leaving a gap at it.
    for (let wy = ridgeY; wy <= y + h; wy++) {
      const z = zEave + height * ((y + h - wy) / half);
      for (let wx = x; wx <= x + w; wx++) {
        this.plot(wx, wy, z, wy === ridgeY ? shade.ridge : shade.near);
      }
    }

    // The gable end: the triangle under the roof at the x+w end. Without it the
    // roof floats, because nothing connects the eave line to the ridge.
    for (let wy = y; wy <= y + h; wy++) {
      const z = zEave + height * (1 - Math.abs(wy - mid) / half);
      this.column(x + w, wy, zEave, z, shade.gable);
      if (shade.edge) this.plot(x + w, wy, zEave, shade.edge);
    }
    return this;
  }

  /** beam draws a horizontal member at height z along world x: scaffolding,
   *  framing, a fence rail. */
  beamX(x0: number, x1: number, wy: number, z: number, ink: Ink, thick = 1): this {
    for (let wx = x0; wx <= x1; wx++) {
      for (let d = 0; d < thick; d++) this.plot(wx, wy, z - d, ink);
    }
    return this;
  }

  /** beamY is the same along world y. */
  beamY(y0: number, y1: number, wx: number, z: number, ink: Ink, thick = 1): this {
    for (let wy = y0; wy <= y1; wy++) {
      for (let d = 0; d < thick; d++) this.plot(wx, wy, z - d, ink);
    }
    return this;
  }

  /** post raises a single member from the ground: stakes, scaffolding poles. */
  post(wx: number, wy: number, zBottom: number, zTop: number, ink: Ink, thick = 1): this {
    for (let d = 0; d < thick; d++) {
      this.column(wx, wy, zBottom, zTop, ink);
      // A post one pixel thick in world terms is one pixel on screen only for
      // the near faces; widening along x keeps it visible against the ground.
      if (thick > 1) this.plot(wx, wy, zTop - d, ink);
    }
    return this;
  }

  /**
   * shadeFace darkens or lightens every opaque pixel inside a screen-space
   * rectangle. It is the cheap way to add a form shadow after the fact — under
   * an eave, beside a doorway — without re-running a fill with another colour.
   */
  tintRect(x0: number, y0: number, x1: number, y1: number, ink: string, amount: number): this {
    const [tr, tg, tb] = rgba(ink);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const [r, g, b, a] = this.pix.at(x, y);
        if (a === 0) continue;
        this.pix.set(x, y, [
          r + (tr - r) * amount,
          g + (tg - g) * amount,
          b + (tb - b) * amount,
          a,
        ]);
      }
    }
    return this;
  }

  /** outline inks the whole surface's outer edge. */
  outline(ink: string): Pix {
    return this.pix.outline(ink);
  }
}

/**
 * IsoBounds is the picture-space box a world rectangle occupies.
 *
 * It is derived by projecting the four corners rather than by formula, so a
 * change to the projection cannot silently desynchronise the sprite sizes from
 * the positions they are drawn at.
 */
export interface IsoBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  w: number;
  h: number;
}

/** boundsOf returns the picture-space box a world box occupies. */
export function boundsOf(
  x: number,
  y: number,
  w: number,
  h: number,
  zTop = 0,
  zBottom = 0,
): IsoBounds {
  const corners: Point[] = [
    { x: (x - y) / 2, y: (x + y) / 4 },
    { x: (x + w - y) / 2, y: (x + w + y) / 4 },
    { x: (x - (y + h)) / 2, y: (x + (y + h)) / 4 },
    { x: (x + w - (y + h)) / 2, y: (x + w + y + h) / 4 },
  ];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.floor(Math.min(...xs));
  const maxX = Math.ceil(Math.max(...xs));
  const minY = Math.floor(Math.min(...ys) - zTop);
  const maxY = Math.ceil(Math.max(...ys) - zBottom);
  return { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** The hand-drawn half-width of a footprint's shadow in world units. Shadow is
 *  what stops a building looking pasted onto the ground. */
export const SHADOW_OFFSET = 0;
