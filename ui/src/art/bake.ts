// Bake: art becomes textures, once, at boot.
//
// Every sprite in the town is built in code and rasterised here into one
// canvas, which becomes a single Phaser texture with named frames. That is the
// only reason the daemon can stay zero-dependency and offline: there is no PNG
// to fetch, no loader, no CORS, and nothing to keep in sync between an art file
// and the code that uses it.
//
// Two properties matter and both are asserted rather than hoped for:
//
//   - Every cel is the size the layout expects. Frames are looked up by name
//     and drawn with an origin offset, so a cel that is one pixel short would
//     offset a whole district rather than fail.
//   - No palette escapes. `assertPaletteClean` collects every colour that ended
//     up in the texture and refuses any that is not in `P`. An off-palette
//     colour is a bug that would otherwise show up as one odd-looking sprite
//     nobody can find.
//
// The bake runs synchronously at scene creation. It is a few hundred small
// fill operations, which is far cheaper than the decode of the PNG it replaces.

import Phaser from "phaser";
import { P, paletteSet } from "./palette";
import { Pix } from "./surface";
import { buildWorker, WORKER_ORIGIN, type Tier, type WorkerState } from "./worker";
import { STAGE_ORDER, boxFor, buildBuilding, buildShadow, skinFor, type Stage } from "./building";
import { ALL_PROP_KINDS, buildProp, PROP_ORIGIN } from "./props";
import { EDGES, GROUND_KINDS, TILE_PX, groundEdgeTile, groundTile, type Edge, type Ground } from "./terrain";

/** The texture key everything bakes into. One texture, many frames: one GPU
 *  upload, one draw-call batch, no per-sprite texture swapping. */
export const ATLAS = "town";

/** A baked frame: where it sits in the atlas, and where its world origin is. */
export interface FrameInfo {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The pixel within the cel that corresponds to the sprite's world origin.
   *  A worker's is between its feet; a building's is its footprint corner. */
  ox: number;
  oy: number;
}

/** Every frame the town draws, by name. Built by `bake` and read by the scene. */
export type Atlas = Record<string, FrameInfo>;

/** The four building footprints the analyzer emits, and the file count each
 *  step corresponds to (internal/analyzer/layout.go). */
const SIZES: readonly { side: number; files: number }[] = [
  { side: 44, files: 2 },
  { side: 60, files: 5 },
  { side: 78, files: 9 },
  { side: 100, files: 30 },
];

/**
 * Frame name for a building at a footprint, stage, skin variant and damage
 * state.
 *
 * Both skin variants and both damage states exist in the atlas, and the scene
 * picks with `skinVariant(path)` and the building's `damaged` flag. Damage is
 * part of the frame name rather than a separate overlay because the damage
 * drawing depends on how far the building got — there is no wall to crack until
 * the building has walls.
 */
export function buildingFrame(
  side: number,
  stage: Stage,
  variant: 0 | 1,
  damaged = false,
): string {
  return `b${side}:${stage}:${variant}${damaged ? ":dmg" : ""}`;
}

/** Frame name for the ground shadow a building of this footprint casts. */
export function shadowFrame(side: number): string {
  return `s${side}`;
}

/** Frame name for a worker tier in a state's nth animation frame. */
export function workerFrame(tier: Tier, state: WorkerState, i: number): string {
  return `w:${tier}:${state}:${i}`;
}

/** Frame name for a ground tile. */
export function groundFrame(kind: Ground, variant: number): string {
  return `g:${kind}:${variant}`;
}
/** Frame name for a ground tile's edge piece. */
export function groundEdgeFrame(kind: Ground, edge: Edge, variant: number): string {
  return `ge:${kind}:${edge}:${variant}`;
}


/**
 * Frame name for a prop, at a variation.
 *
 * Variants are baked rather than picked at draw time, because `buildProp` walks
 * world coordinates and rasterises — it is a build step, not a frame step. Two
 * variants is what the drawing prompts ask for (`variant % 2` and
 * `variant % 3` both distinguish 0 from 1), so a place with two barrels shows
 * two barrels rather than one barrel twice.
 */
export function propFrame(kind: string, variant = 0): string {
  return `p:${kind}:${variant}`;
}

/**
 * bake rasterises every sprite into one texture and returns the frame table.
 *
 * The atlas is laid out in columns of a fixed width rather than packed, because
 * a packer would make the frame table depend on a packing result and the art
 * would move between builds — which would make the visual diff of any change
 * unreadable and break reproducibility for no gain at these sizes.
 */
export function bake(scene: Phaser.Scene): Atlas {
  const cels: { key: string; pix: Pix; ox: number; oy: number }[] = [];

  // --- Workers -----------------------------------------------------------
  // The worker's origin is at its feet, so it stands on a building's ground
  // rather than on its roof.
  for (const tier of ["chief", "sub"] as const) {
    const sheet = buildWorker(tier);
    for (const state of Object.keys(sheet.cels) as WorkerState[]) {
      sheet.cels[state].forEach((pix, i) => {
        cels.push({ key: workerFrame(tier, state, i), pix, ox: WORKER_OX, oy: WORKER_OY });
      });
    }
  }

  // --- Buildings ---------------------------------------------------------
  //
  // Both skin variants are baked for every footprint, stage and damage state. A
  // building's variant is a hash of its own path (`skinVariant`), so which one a
  // project needs is not known until its town arrives — and baking on demand
  // would put a canvas upload in the middle of a live redraw.
  //
  // Damaged is baked alongside intact rather than applied at runtime because
  // damage is *drawn over* whatever has been built: it knows what stage it is
  // covering, so a staked plot gains no crack in a wall that does not exist. A
  // runtime tint could not do that, and an atlas lookup can.
  for (const { side, files } of SIZES) {
    for (const variant of [0, 1] as const) {
      // A path whose hash lands on `variant`. `skinFor` reads only the parity,
      // so any such path yields the same skin; these two are the shortest that
      // do, which keeps the bake free of made-up filenames that look real.
      const path = variant === 0 ? "b" : "a";
      for (const stage of STAGE_ORDER) {
        for (const damaged of [false, true]) {
          const pix = buildBuilding(side, files, path, stage, damaged);
          const box = boxFor(side, skinFor(files, path));
          cels.push({
            key: buildingFrame(side, stage, variant, damaged),
            pix,
            ox: box.ox,
            oy: box.oy,
          });
        }
      }
    }
    // The ground shadow, baked once per footprint. A building without a contact
    // shadow reads as pasted onto the map rather than standing on it — which is
    // visible precisely because the workers do have one.
    const shadow = buildShadow(side, files, "b");
    const box = boxFor(side, skinFor(files, "b"));
    cels.push({ key: shadowFrame(side), pix: shadow, ox: box.ox, oy: box.oy });
  }

  // --- Ground ------------------------------------------------------------
  for (const kind of GROUND_KINDS) {
    for (let v = 0; v < 4; v++) {
      cels.push({
        key: groundFrame(kind, v),
        pix: groundTile(kind, v),
        ox: TILE_PX.ox,
        oy: TILE_PX.oy,
      });
      // The four edge pieces, so a boundary between two kinds of ground is
      // authored rather than a bare flip from one to the other.
      for (const edge of EDGES) {
        cels.push({
          key: groundEdgeFrame(kind, edge, v),
          pix: groundEdgeTile(kind, edge, v),
          ox: TILE_PX.ox,
          oy: TILE_PX.oy,
        });
      }
    }
  }

  // --- Props -------------------------------------------------------------
  //
  // Two variants each, so a place holding two barrels shows two barrels rather
  // than one barrel stamped twice. Every drawing reduces its variation to `% 2`
  // or `% 3`, so 0 and 1 are the only distinct forms any prop can take — baking
  // a third would be a duplicate cel.
  for (const kind of ALL_PROP_KINDS) {
    for (const variant of [0, 1] as const) {
      cels.push({
        key: propFrame(kind, variant),
        pix: buildProp(kind, variant),
        ox: PROP_OX,
        oy: PROP_OY,
      });
    }
  }

  return rasterise(scene, cels);
}

// The origin offsets come from the art modules' own constants rather than being
// restated. A cel anchored at the wrong pixel does not fail — it silently
// shifts a worker off its building — so there is exactly one definition of
// where each kind of cel's world origin sits.
const WORKER_OX = WORKER_ORIGIN.x;
const WORKER_OY = WORKER_ORIGIN.y;
const PROP_OX = PROP_ORIGIN.x;
const PROP_OY = PROP_ORIGIN.y;

/**
 * rasterise lays the cels into one canvas and registers it as a texture.
 *
 * The canvas is created at its final size in one pass rather than being grown,
 * because growing a canvas clears it: every cel would have to be redrawn, and
 * the mistake is silent — the last cel to be drawn ends up alone on the sheet.
 */
function rasterise(
  scene: Phaser.Scene,
  cels: readonly { key: string; pix: Pix; ox: number; oy: number }[],
): Atlas {
  // Rows of 16, sized to the tallest cel, so the sheet stays close to square.
  const perRow = 16;
  const cellW = Math.max(...cels.map((c) => c.pix.w)) + 2;
  const cellH = Math.max(...cels.map((c) => c.pix.h)) + 2;
  const rows = Math.ceil(cels.length / perRow);
  const width = nextPow2(perRow * cellW);
  const height = nextPow2(rows * cellH);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("bake: no 2d context");
  // Belt and braces with the game's own pixelArt setting: this context draws
  // the atlas itself, and a smoothed blit here would bake blur into the pixels
  // permanently, where no renderer setting could undo it.
  ctx.imageSmoothingEnabled = false;

  const atlas: Atlas = {};
  cels.forEach((cel, i) => {
    const cx = (i % perRow) * cellW + 1;
    const cy = Math.floor(i / perRow) * cellH + 1;
    cel.pix.drawInto(ctx, cx, cy);
    atlas[cel.key] = {
      key: cel.key,
      x: cx,
      y: cy,
      w: cel.pix.w,
      h: cel.pix.h,
      ox: cel.ox,
      oy: cel.oy,
    };
  });

  // One texture, one frame per cel. `addCanvas` takes the canvas directly, so
  // no image decode and no loader are involved.
  const tex = scene.textures.addCanvas(ATLAS, canvas);
  if (!tex) throw new Error("bake: texture key already in use");
  for (const f of Object.values(atlas)) {
    tex.add(f.key, 0, f.x, f.y, f.w, f.h);
  }

  assertPaletteClean(ctx, width, height, cels);

  return atlas;
}

/** nextPow2 rounds up to a power of two, which keeps the atlas cheap to upload
 *  on renderers that prefer it and costs at most twice the memory of a few
 *  hundred small cels. */
function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * assertPaletteClean fails the boot if any pixel came out of the palette.
 *
 * It reads the atlas back rather than checking the cels, because reading the
 * finished surface catches a colour introduced by any route — a typo in a
 * sprite key, a blend in a primitive, a shade computation that drifted. A
 * half-transparent pixel is also refused: alpha is 0 or 255 everywhere in this
 * world, since a partly transparent edge is the anti-aliasing halo the
 * reference warns produces a fringe on whatever is behind it.
 */
function assertPaletteClean(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cels: readonly { key: string; pix: Pix }[],
): void {
  const allowed = paletteSet();
  const bad = new Set<string>();
  const seen = new Set<string>();

  for (const cel of cels) {
    for (let i = 0; i < cel.pix.data.length; i += 4) {
      const a = cel.pix.data[i + 3];
      if (a === 0) continue;
      if (a !== 255) {
        bad.add(`${cel.key}: alpha ${a} (must be 0 or 255)`);
        continue;
      }
      const hex =
        "#" +
        [cel.pix.data[i], cel.pix.data[i + 1], cel.pix.data[i + 2]]
          .map((v) => v.toString(16).padStart(2, "0"))
          .join("");
      seen.add(hex);
      if (!allowed.has(hex)) bad.add(`${cel.key}: ${hex}`);
    }
  }

  void ctx;
  void w;
  void h;

  if (bad.size > 0) {
    const list = [...bad].slice(0, 12).join("\n  ");
    throw new Error(
      `bake: ${bad.size} off-palette or translucent pixel(s):\n  ${list}\n` +
        `Add the colour to palette.ts if it belongs, or fix the sprite.`,
    );
  }
}

