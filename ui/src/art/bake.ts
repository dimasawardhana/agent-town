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
import { MACHINES, machineOrigin, buildMachine, type MachineKind, type MachinePose } from "./machine";
import { P, paletteSet } from "./palette";
import { Pix } from "./surface";
import { buildWorker, WORKER_ORIGIN, type Tier, type WorkerState } from "./worker";
import {
  STAGE_ORDER, bandBox, baseBox, buildBase, buildBand, buildCap, buildShadow, capBox, shadowBox,
  buildBaseDamageCel, buildRoofDamageCel, buildRoofFlagCel, emptyDamageCel, emptyVerifiedCel,
  stageRank, type Stage,
} from "./building";
import {
  ARCHETYPES, archetypeFor, MATERIALS, type Archetype, type MaterialName,
} from "./roof";
import { ALL_PROP_KINDS, buildProp, PROP_ORIGIN } from "./props";
import { EDGES, GROUND_KINDS, TILE_PX, groundEdgeTile, groundTile, type Edge, type Ground } from "./terrain";

/** The texture key the unrotated atlas bakes into. One texture, many frames: one
 *  GPU upload, one draw-call batch, no per-sprite texture swapping. */
export const ATLAS = "town";

/**
 * atlasKey is the texture key for an orientation.
 *
 * Each orientation is its own baked texture rather than a set of frames inside
 * one, because the art genuinely differs: a wall is only visible when the camera
 * faces it, so a turned building is a different picture and not a moved one. The
 * separated keys also mean the atlas for an orientation is built on first use,
 * so a reader who never turns never pays for the other three.
 *
 * Turn 0 keeps the bare `town` key so the unrotated boot — the only path every
 * session takes — is unchanged, and so the tests that reference it keep meaning
 * what they meant.
 */
export function atlasKey(turn: number): string {
  return turn === 0 ? ATLAS : `${ATLAS}:t${turn}`;
}

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
/**
 * The footprints a building can be drawn at.
 *
 * Five, and the number is a budget rather than a preference. Four left eight of
 * this repository's fourteen buildings on the same footprint, which is what made
 * a town of eleven archetypes read as one building repeated — the roofs differed
 * and the mass did not.
 *
 * The fifth was only affordable once the verification pennant became an overlay
 * rather than a cap axis. The sheet holds `floor(8192 / cellH) x 16` cels, and at
 * the cell height the Chapel set (101) that is **1296** — not the 1408 an earlier
 * budget was written against, which is the number that made five buckets look
 * like they fitted. It is recorded here because the arithmetic is easy to redo
 * from a stale ceiling and get wrong twice.
 */
export const SIZES: readonly { side: number; files: number }[] = [
  { side: 44, files: 2 },
  { side: 58, files: 5 },
  { side: 72, files: 9 },
  { side: 86, files: 12 },
  { side: 100, files: 30 },
];

/** Frame name for the ground shadow a building of this footprint casts. */
export function shadowFrame(side: number, turn = 0): string {
  return turn === 0 ? `s${side}` : `s${side}:t${turn}`;
}

/** Frame name for a worker tier in a state's nth animation frame. */
/** machineFrame is one pose of one machine, for one agent's kind. */
export function machineFrame(kind: MachineKind, tier: Tier, pose: MachinePose): string {
  return `m:${kind}:${tier}:${pose}`;
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
 * Frame name for one storey of wall, which is the part that repeats.
 *
 * `stage` is in the key because the band's picture does depend on it — a band
 * drawn before the walls go up shows framing — but it is the same picture at
 * every stage from `framed` upward, so a tower cannot grow new windows as it is
 * finished.
 */
export function bandFrame(side: number, material: MaterialName, stage: Stage, turn = 0): string {
  return turn === 0
    ? `band:${side}:${stage}:${material}`
    : `band:${side}:${stage}:${material}:t${turn}`;
}

/**
 * Frame name for a ground storey's rubble, laid over the base.
 *
 * The same move the roof damage made: a condition is a mark, not a variant of
 * the picture it lands on. A damaged base is the base plus rubble, and the
 * rubble is one thing per material per footprint rather than one per stage.
 */
export function baseDamageFrame(side: number, material: MaterialName, turn = 0): string {
  const base = `bdmg:${side}:${material}`;
  return turn === 0 ? base : `${base}:t${turn}`;
}

/** The blank an undamaged ground storey carries in place of rubble, cut from
 *  the same box so `setFrame` cannot move the rubble when it swaps. */
export function noBaseDamageFrame(side: number, material: MaterialName): string {
  return `bdmg:none:${side}:${material}`;
}

/** Frame name for a building's base: the ground works, the ground storey's
 *  shell, the door and plinth, and the damage visible from the ground. */
export function baseFrame(
  side: number,
  material: MaterialName,
  stage: Stage,
  turn = 0,
): string {
  const base = `base:${side}:${stage}:${material}`;
  return turn === 0 ? base : `${base}:t${turn}`;
}

/**
 * Frame name for a building's cap: the roof, its rooftop furniture and its
 * coping. Damage is **not** an axis here — it is a separate mark laid over the
 * cap, because baking it in doubled the whole cap family to carry one hole.
 *
 * It carries the **archetype** where it used to carry the skin variant, and that
 * is the axis swap stated in the key itself: two buildings whose paths differ only
 * in the skin's bit now share one cap frame, and two whose paths differ in the
 * roof's bit do not. A reader looking at frame names can therefore see which axis
 * the cap answers to.
 *
 * Below `roofed` the kind, the damage and the verification are all dropped from
 * the key, because a cap at that stage draws nothing and every combination
 * would be the same empty image. Measured, 320 of the 640 cap cels were that
 * image, in 18 distinct shapes; they now share sixteen. The arguments are still
 * accepted and still meaningful for the stages that draw, and the caller still
 * passes them for every stage — the stack builds one child per storey and
 * restaging swaps frames by index, so the *number* of keys must not change with
 * the stage even though the frame they resolve to can.
 */
export function capFrame(side: number, roof: Archetype, stage: Stage, turn = 0): string {
  if (stageRank(stage) < stageRank("roofed")) {
    const blank = `cap:${side}:${stage}`;
    return turn === 0 ? blank : `${blank}:t${turn}`;
  }
  const base = `cap:${side}:${roof}:${stage}`;
  return turn === 0 ? base : `${base}:t${turn}`;
}

/**
 * Frame name for a roof's verification pennant, laid over the cap.
 *
 * The same move the roof damage made. Verification used to be a cap axis,
 * which doubled the whole cap family to carry one flag, and the doubling is
 * what stopped a fifth width bucket fitting: the sheet holds
 * `floor(8192 / cellH) × 16` cels, and at the cell height the Chapel set that
 * is 1296. A flag as an overlay costs 11 × sides rather than 11 × sides ×
 * stages, and it is what buys the width.
 *
 * The pennant needs a roof to fly from, so it only appears from `roofed` — a
 * building being verified is not a finished building.
 */
export function verifiedFrame(side: number, roof: Archetype, turn = 0): string {
  const base = `vf:${side}:${roof}`;
  return turn === 0 ? base : `${base}:t${turn}`;
}

/**
 * The blank an unverified building carries in place of the pennant.
 *
 * Cut from the same box as the pennant it replaces, because `setFrame` swaps a
 * texture without moving the sprite and a flag that jumps on restaging reads as
 * the building changing shape.
 */
export const NO_VERIFIED_FRAME = "vf:blank";

/** The blank a building carries in place of a damage mark. See the note at the bake. */
export const NO_DAMAGE_FRAME = "dmg:blank";

/**
 * The frame a building carries when it is **not** damaged.
 *
 * Every building has a damage child whether or not it is damaged, because the
 * child count must not change when a condition does: restaging swaps frames by
 * index, so dropping the child would slide every storey above it onto the wrong
 * frame. An absent child is not available; a blank one is.
 */
/**
 * The blank an *undamaged* building of this footprint and archetype carries.
 *
 * It exists per archetype rather than one blank for the whole town, and the
 * reason is positional rather than aesthetic. `setFrame` swaps a sprite's
 * texture **without moving the sprite**, so a blank swapped in must share the
 * origin of the mark it replaces — otherwise the mark appears forty pixels
 * right and thirty down of the roof it belongs to. A shared blank cannot: its
 * box would have to be eleven roofs at once. Sixteen cels is the price of not
 * having damage land beside the building.
 */
export function noDamageFrame(side: number, roof: Archetype): string {
  return `dmg:blank:${side}:${roof}`;
}

/**
 * Frame name for a roof's damage mark, which is drawn *over* the cap rather
 * than baked into it.
 *
 * One per footprint and archetype, not one per stage, per condition and per
 * archetype. A roof hole is the same hole at `roofed` as at `completed` — the
 * building's stage says how finished it is, and baking the damage into every
 * stage said it again, eleven times over.
 *
 * The cel is baked with the *cap's* box, so its origin is the cap's origin and
 * the scene can lay it at the cap's position with no placement arithmetic of its
 * own. That is the whole trick: the mark rides the roofline because it was cut
 * from the same box the roofline was.
 */
export function damageFrame(side: number, roof: Archetype, turn = 0): string {
  const base = `dmg:${side}:${roof}`;
  return turn === 0 ? base : `${base}:t${turn}`;
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
export function propFrame(kind: string, variant = 0, turn = 0): string {
  return turn === 0 ? `p:${kind}:${variant}` : `p:${kind}:${variant}:t${turn}`;
}

/** A cel as the bake holds it before it is placed on the sheet. */
export interface BakedCel {
  /** The frame name it will be registered under. */
  key: string;
  pix: Pix;
  /** Where its world origin sits inside it, for placement by the scene. */
  ox: number;
  oy: number;
}

/**
 * bakedCels enumerates every cel an orientation's atlas holds.
 *
 * This is the **single** list of what the bake produces, and `bake` itself is
 * built from it rather than from a loop of its own. That matters more than it
 * looks: the art's invariants (every cel is non-empty, on-palette, fully opaque,
 * and keeps ink off its border) were previously checked against a *separate*
 * hand-written enumeration in the test file, and the two had drifted. The test
 * list composited a whole one-storey building rather than the parts that are
 * baked, so its names corresponded to no frame in the atlas, and it never built
 * a band cel at all — the one cel that tiles up every storey of every tower had
 * no coverage. Both gaps were silent: a bad pixel in a band cel passed the
 * entire suite.
 *
 * Two enumerations that must agree is the shape of bug that drifts again the
 * next time an axis is added, so there is now one.
 */
export function bakedCels(turn = 0): BakedCel[] {
  const cels: BakedCel[] = [];

  // --- Workers -----------------------------------------------------------
  // The worker's origin is at its feet, so it stands on a building's ground
  // rather than on its roof.
  // The fleet, not the crew. Five kinds so a session is a machine with a
  // silhouette a glance can separate, four poses so the pose says working /
  // parked / moving / finished without claiming a verb the silhouette cannot
  // support. 40 cels against the figure's 76.
  for (const kind of MACHINES) {
    for (const tier of ["chief", "sub"] as const) {
      for (const pose of ["work", "idle", "travel", "done"] as const) {
        const pix = buildMachine(kind, pose, tier, turn);
        const box = machineOrigin(pix, turn);
        cels.push({ key: machineFrame(kind, tier, pose), pix, ox: box.ox, oy: box.oy });
      }
    }
  }

  // --- Buildings ---------------------------------------------------------
  //
  // Baked as three parts rather than one cel per complete building, because a
  // building's height now varies with its byte size and one cel per height would
  // be unbounded: a 20-storey tower on a 100-unit footprint needs a 113x427 cel,
  // and the atlas already holds well over a hundred building cels. The parts are
  // split by how they *tile* — base and cap occur once, the band repeats — so a
  // tower is three cels plus N-1 stamps of the middle one.
  //
  // Both skin variants are baked for every footprint, stage and damage state. A
  // building's variant is a hash of its own path (`skinVariant`), so which one a
  // project needs is not known until its town arrives — and baking on demand
  // would put a canvas upload in the middle of a live redraw.
  //
  // Damaged is baked alongside intact rather than applied at runtime because
  // damage is *drawn over* whatever has been built: it knows how far the building
  // got, so a staked plot gains no crack in a wall that does not exist.
  //
  // **The roof axis replaces the skin on the cap rather than multiplying with it.**
  // The base and the band are still `2 skins x 8 stages x 2 damage`, but the cap is
  // `N roofs x 8 stages x 2 damage` and does not read the skin at all. That is the
  // trade ADR-0021 measured: multiplying the two axes would need `2 x N` cap cels
  // per footprint and reach the atlas ceiling at six roofs, while replacing needs
  // `N` and has room for ten.
  for (const { side, files } of SIZES) {
    // Each part's cel is sized to what that part draws. The base and the band are
    // both one storey and therefore the same size; neither reserves the roof's
    // headroom any more, which is what lowers the sheet's cell height — and the
    // cell height applies to every cel on the sheet, not just the tall ones.
    const footBox = baseBox(side);
    const storeyBox = bandBox(side);

    // Over the five material families rather than the two skins this used to
    // carry. A band is one storey of wall, so a whole tower is one cel per
    // material — the axis is priced by the families, not by the archetypes,
    // which is what makes eleven archetypes' worth of roofs affordable on top.
    for (const m of MATERIALS) {
      for (const stage of STAGE_ORDER) {
        cels.push({
          key: bandFrame(side, m, stage, turn),
          pix: buildBand(side, m, stage, turn),
          ox: storeyBox.ox,
          oy: storeyBox.oy,
        });
        cels.push({
          key: baseFrame(side, m, stage, turn),
          pix: buildBase(side, m, stage, false, turn),
          ox: footBox.ox,
          oy: footBox.oy,
        });
      }
    }

    // The base's rubble, as an overlay for the same reason the roof's is: a
    // condition is a mark, not a variant of the picture it lands on. Cut from
    // the base's own box so `setFrame` cannot move the rubble when it swaps.
    for (const m of MATERIALS) {
      const rubble = buildBaseDamageCel(side, m, turn);
      cels.push({
        key: baseDamageFrame(side, m, turn),
        pix: rubble,
        ox: footBox.ox,
        oy: footBox.oy,
      });
      cels.push({
        key: noBaseDamageFrame(side, m),
        pix: new Pix(footBox.w, footBox.h),
        ox: footBox.ox,
        oy: footBox.oy,
      });
    }

    // The caps. Outside the skin loop because a cap no longer depends on the
    // skin, and inside the footprint loop because a roof's height and pitch
    // scale with the building.
    //
    // Below `roofed` a cap draws nothing at all — the roof has not been built
    // yet — so those stages are baked once per footprint rather than once per
    // (kind, damage, verification). They still have to *exist*: the stack emits
    // a key per storey and restaging swaps frames by index, so a building's
    // child count must not change when its stage does. That is why the band and
    // cap are deliberately blank before their feature exists, and it is
    // preserved here. What is not load-bearing is baking the same empty image
    // 320 times over — `capFrame` sends every pre-roof stage to one shared key,
    // and this loop bakes that key once.
    //
    // Measured: 320 blank cels become 16, and the saving is 304 of the 1408-cel
    // ceiling. It is the reason a twelve-archetype vocabulary fits at all.
    for (const stage of STAGE_ORDER) {
      if (stageRank(stage) < stageRank("roofed")) {
        const box = capBox(side, ARCHETYPES[0]);
        cels.push({
          key: capFrame(side, ARCHETYPES[0], stage, turn),
          pix: buildCap(side, ARCHETYPES[0], stage, turn),
          ox: box.ox,
          oy: box.oy,
        });
        continue;
      }
      for (const roof of ARCHETYPES) {
        const topBox = capBox(side, roof);
        cels.push({
          key: capFrame(side, roof, stage, turn),
          pix: buildCap(side, roof, stage, turn),
          ox: topBox.ox,
          oy: topBox.oy,
        });
      }
    }

    // The pennant, and the blank it swaps with, baked once per footprint and
    // archetype. It is an overlay rather than a cap axis because an axis costs
    // one cel per *stage* and a flag looks the same on a roofed building and a
    // finished one — the ladder already says which is which.
    for (const roof of ARCHETYPES) {
      const vBox = capBox(side, roof, turn);
      cels.push({
        key: verifiedFrame(side, roof, turn),
        pix: buildRoofFlagCel(side, roof, turn),
        ox: vBox.ox,
        oy: vBox.oy,
      });
    }

    // The damage marks, once per footprint and archetype rather than per
      // stage. A hole in a roof is the same hole whether the building is roofed
      // or completed, and baking it into every stage said so four times over for
      // no picture anyone could tell apart. Each is cut from the cap's own box,
      // so its origin is the cap's origin and the scene lays it at the cap's
      // position with no arithmetic of its own — the mark rides the roofline
      // because it was cut from the same box the roofline was.
      for (const roof of ARCHETYPES) {
        const dmgBox = capBox(side, roof, turn);
        cels.push({
          key: damageFrame(side, roof, turn),
          pix: buildRoofDamageCel(side, roof, turn),
          ox: dmgBox.ox,
          oy: dmgBox.oy,
        });
      }

    // The ground shadow, baked once per footprint. A building without a contact
    // shadow reads as pasted onto the map rather than standing on it — which is
    // visible precisely because the workers do have one.
    const footShadowBox = shadowBox(side);
    cels.push({ key: shadowFrame(side, turn), pix: buildShadow(side, files, "b", turn), ox: footShadowBox.ox, oy: footShadowBox.oy });
  }

  // The two shared blanks — what a building carries in place of a damage mark
  // and a pennant. **One each, for the whole town**, and that is the third time
  // this trick has paid: a blank is a blank, and `setFrame` does not move a
  // sprite, so the blank a mark swaps *from* does not need the mark's box. The
  // per-archetype, per-footprint blanks were 120 cels drawing nothing.
  for (const [key, make] of [
    [NO_DAMAGE_FRAME, () => new Pix(1, 1)],
    [NO_VERIFIED_FRAME, () => new Pix(1, 1)],
  ] as const) {
    cels.push({ key, pix: make(), ox: 0, oy: 0 });
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
        key: propFrame(kind, variant, turn),
        pix: buildProp(kind, variant, turn),
        ox: PROP_OX,
        oy: PROP_OY,
      });
    }
  }

  return cels;
}

/**
 * bake rasterises every sprite into one texture and returns the frame table.
 *
 * The atlas is laid out in columns of a fixed width rather than packed, because
 * a packer would make the frame table depend on a packing result and the art
 * would move between builds — which would make the visual diff of any change
 * unreadable and break reproducibility for no gain at these sizes.
 */
export function bake(scene: Phaser.Scene, turn = 0): Atlas {
  return rasterise(scene, bakedCels(turn), atlasKey(turn));
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
 * The largest canvas the atlas may occupy, in pixels a side.
 *
 * The same limit the ground painter uses, and for the same reason: an oversized
 * canvas does not throw. It fails as a **blank texture**, so the town renders as
 * an empty field with every sprite invisible — a silent visual catastrophe
 * rather than a diagnosable error. The bake had no such guard, which meant the
 * one direction this limit can be crossed from (adding art) failed invisibly.
 *
 * 8192 is not a spec figure: it is the point below which every canvas
 * implementation worth supporting is known to work. `paintGround` carries the
 * same number with the same reasoning.
 */
const MAX_ATLAS_SIDE = 8192;

/** The largest canvas area the atlas may occupy, in pixels. Also from
 *  `paintGround`: some implementations cap total area rather than a side, so a
 *  sheet that is legal in both dimensions can still fail on area alone. */
const MAX_ATLAS_AREA = 16_777_216;

/**
 * AtlasLayout is where the cels go and how big the sheet is.
 *
 * Split out from `rasterise` so the sizing can be computed and checked without a
 * canvas. That matters for the guard: a test can drive it past the limit and
 * assert the refusal, which is the only way to prove the check is real rather
 * than a branch nobody has ever taken.
 */
export interface AtlasLayout {
  perRow: number;
  cellW: number;
  cellH: number;
  rows: number;
  width: number;
  height: number;
}

/**
 * layoutAtlas computes the sheet's geometry from the cels that will fill it.
 *
 * Rows of 16, sized to the tallest and widest cel, so the sheet stays close to
 * square. The dimensions are rounded up to powers of two, which keeps the texture
 * cheap to upload on renderers that prefer it and costs at most twice the memory
 * of a few hundred small cels.
 */
export function layoutAtlas(cels: readonly { pix: Pix }[]): AtlasLayout {
  // An empty bake is not a sheet of zero rows and one column; it is a caller
  // mistake, and `Math.max` of nothing is -Infinity, which would sail through
  // every comparison below as a NaN-sized canvas.
  if (cels.length === 0) throw new Error("bake: no cels to lay out");
  const perRow = 16;
  const cellW = Math.max(...cels.map((c) => c.pix.w)) + 2;
  const cellH = Math.max(...cels.map((c) => c.pix.h)) + 2;
  const rows = Math.ceil(cels.length / perRow);
  return {
    perRow,
    cellW,
    cellH,
    rows,
    width: nextPow2(perRow * cellW),
    height: nextPow2(rows * cellH),
  };
}

/**
 * assertAtlasFits refuses a sheet too large to draw.
 *
 * Called before any canvas is allocated, so the failure is an exception naming
 * what it wanted rather than a blank texture. The cel count and the tallest cel
 * are both reported, because those are the two numbers a caller can act on —
 * one says "bake fewer things", the other "draw something less tall".
 */
export function assertAtlasFits(cels: number, l: AtlasLayout): void {
  const area = l.width * l.height;
  const tooWide = l.width > MAX_ATLAS_SIDE;
  const tooTall = l.height > MAX_ATLAS_SIDE;
  const tooBig = area > MAX_ATLAS_AREA;
  if (!tooWide && !tooTall && !tooBig) return;

  // Which dimension is over, why, and from what — a message that only says "too
  // big" leaves the reader to re-derive every number below by hand.
  const limits: string[] = [];
  if (tooWide) limits.push(`width ${l.width} > ${MAX_ATLAS_SIDE}`);
  if (tooTall) limits.push(`height ${l.height} > ${MAX_ATLAS_SIDE}`);
  if (tooBig) limits.push(`area ${area} > ${MAX_ATLAS_AREA}`);
  throw new Error(
    `bake: atlas would be ${l.width}x${l.height} (${limits.join(", ")}) for ${cels} cels ` +
      `with cell ${l.cellW}x${l.cellH} over ${l.rows} rows. ` +
      `The canvas would fail silently as a blank texture, so the bake refuses instead.`,
  );
}

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
  textureKey: string,
): Atlas {
  const l = layoutAtlas(cels);
  // Checked before the canvas exists, so an oversized bake is an error rather
  // than a town that quietly renders nothing.
  assertAtlasFits(cels.length, l);
  const { perRow, cellW, cellH, width, height } = l;

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
  const tex = scene.textures.addCanvas(textureKey, canvas);
  if (!tex) throw new Error(`bake: texture key ${textureKey} already in use`);
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

