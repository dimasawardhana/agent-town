// The town, drawn as a 16-bit isometric diorama.
//
// The layout still arrives from the daemon in top-down world units and is never
// recomputed here (ADR-0012). This file's whole job is to *project* it:
// districts become diamond ground plates, buildings become staged structures
// standing on their plots, and the three special places get their own ground and
// furniture so that the majority of a real session is somewhere visible.
//
// Phaser owns the camera (ADR-0002). Pan and zoom stay entirely local, which is
// what lets the transport stay one-way.

import Phaser from "phaser";
import { P } from "./art/palette";
import {
  ATLAS,
  type Atlas,
  atlasKey,
  bake,
  shadowFrame,
  baseFrame,
  bandFrame,
  capFrame,
  groundFrame,
  groundEdgeFrame,
  propFrame,
} from "./art/bake";
import { TURN_COUNT, type Turn, normaliseTurn, turnLayout } from "./view";
import { type Stage, skinVariant } from "./art/building";
import { roofFor, type RoofKind } from "./art/roof";
import { STOREY, clampFloors, towerTop } from "./art/stack";
import { boxContains, labelVisible, landBox, visibleAt } from "./visibility";
import { type Ground, tileVariant } from "./art/terrain";
import { PLACE_PROPS } from "./art/props";
import { PLACARD, type PlacardRole, placard } from "./art/placard";
import { KERB, kerbRuns } from "./art/kerb";
import { PLACE_INFO, type PlaceInfo, isPlaceKind, placeInfoFor } from "./place";
import { actionInfo, targetOf } from "./actions";
import { SITE_ID_BUILDING_PREFIX, type Layout, type Site, useTown } from "./store";
import { WorkerLayer } from "./workers";

/** The world-space edge of one ground tile, in world units. Mirrors the terrain
 *  module's own constant; the tile *pixels* and origin come from the atlas
 *  rather than from here, so only the tiling pitch is restated. */
const TILE = 16;

/** The id prefix a district's plate label is registered under. A district is not
 *  a site, so it needs its own namespace; the prefix is what keeps it from ever
 *  colliding with a building path that happens to read the same. */
const DISTRICT_PREFIX = "district:";

/** How the three special places are surfaced and furnished. */
const PLACES: Record<string, { ground: Ground; props: readonly string[] }> = {
  yard: { ground: "yard", props: PLACE_PROPS.yard },
  workshop: { ground: "deck", props: PLACE_PROPS.workshop },
  depot: { ground: "flags", props: PLACE_PROPS.depot },
};

/**
 * One rectangle of ground to paint, and an optional region of a different kind
 * inside it. The field-and-town pair is the only nesting the layout needs: a
 * colder grass everywhere, the town's own grass inside it.
 */
interface GroundRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: Ground | "grassOutside";
  inner?: { x: number; y: number; w: number; h: number; kind: string };
}

/**
 * Depth bands.
 *
 * Ground is one texture and must sit under everything. Everything standing is
 * ordered among itself by screen position, so its depth is the y of the point
 * it stands on; labels are above all of it.
 */
const DEPTH = {
  ground: -100000,
  label: 90000,
} as const;

export class TownScene extends Phaser.Scene {
  /**
   * The atlas for the orientation currently drawn.
   *
   * One texture per orientation rather than one holding all four, because the
   * art genuinely differs — a wall is only visible when the camera faces it, so
   * a turned building is a different picture and not a moved one. It is swapped
   * in `ensureAtlas`, which bakes an orientation the first time it is asked for.
   */
  private atlas: Atlas = {};
  /** The orientation `atlas` holds, so `ensureAtlas` knows when to swap. */
  private atlasTurn: number = 0;
  /**
   * Every orientation baked so far, by turn.
   *
   * Kept because `bake` registers a texture and the frame table cannot be
   * recovered from a registered texture without re-deriving every frame's size
   * and origin. Re-baking to learn the table again would also throw, since the
   * texture key would already exist — which is exactly how the first version of
   * this failed: it baked twice, the second call threw, and the abort left a town
   * with one sprite and no rotation.
   */
  private atlases = new Map<number, Atlas>();
  private layout: Layout | null = null;
  /**
   * The layout as the daemon sent it.
   *
   * Kept separately from `this.layout`, which holds the *turned* view of it.
   * Redrawing after a turn would otherwise turn an already-turned layout, so
   * every draw starts from this untouched copy.
   */
  private sourceLayout: Layout | null = null;
  private workers: WorkerLayer | null = null;
  // Each building's sprite stack, by site id. A tower is a Container holding one
  // base, N identical bands and a cap, so a status change swaps frames inside
  // the container rather than rebuilding the map — rebuilding would flicker the
  // whole town, and a building visibly rising is the product.
  private buildingSprites = new Map<string, Phaser.GameObjects.Container>();
  // The ground regions to paint, in the order they are written: the field first,
  // then each district's plate, then each place's surface, so later regions
  // cover earlier ones rather than fighting them.
  private groundPlan: GroundRegion[] = [];
  private groundImage: Phaser.GameObjects.Image | null = null;
  private tileCanvases = new Map<string, HTMLCanvasElement>();
  // The signature of the town the camera was last framed to. It is what tells a
  // genuine project switch from a reconnect handing back an equivalent layout.
  private fittedSignature = "";
  private dragging = false;
  private dragStart = { x: 0, y: 0, sx: 0, sy: 0 };
  private moved = 0;

  /**
   * Every label on screen, by the id of the thing it names.
   *
   * A list rather than one image, because a thing can wear more than one board:
   * a place carries its name, what it is for, and which actions land there, and
   * all three belong to one id so that pointing at the place reveals them
   * together rather than leaving a reader to find each one.
   *
   * It exists so a change of focus is a visibility sweep rather than a redraw.
   * Focus changes on every click, and rebuilding the town to hide one board and
   * show another would flicker the map — the same reason a status change restages
   * a building in place rather than redrawing it.
   */
  private labels = new Map<string, Phaser.GameObjects.Image[]>();

  /**
   * How deep a site may be and still be drawn.
   *
   * Set by the panel's detail control and applied in `draw`. It is a display
   * filter only: the layout is always computed in full, so lowering this cannot
   * move anything and raising it back restores exactly what was there.
   *
   * Infinity rather than a magic maximum, so a town with a building nested
   * deeper than any number chosen here is shown in full by default. The
   * failure of a too-low default would be silently hiding work.
   */
  private depth = Number.POSITIVE_INFINITY;

  /**
   * The orientation the town is drawn at, mirrored from the store.
   *
   * A view preference like `depth`, and applied the same way: the layout is
   * always the daemon's, and this decides how it is *shown*.
   */
  private turn: Turn = 0;

  constructor() {
    super("town");
  }

  create(): void {
    // The void: a cold near-black, so the lit town sits on something that reads
    // as unlit rather than as part of the picture.
    this.cameras.main.setBackgroundColor(P.void);
    this.turn = normaliseTurn(useTown.getState().turn);
    this.ensureAtlas();
    this.controls();
    this.workers = new WorkerLayer(this, ATLAS, this.atlas, () => this.moved >= 5);

    const { layout } = useTown.getState();
    if (layout) this.draw(layout);

    useTown.subscribe((s, prev) => {
      if (s.layout && s.layout !== prev.layout) {
        this.draw(s.layout);
        return;
      }
      // A depth change redraws. It has to be a full draw rather than a
      // visibility toggle: the camera bounds and the fit are both derived from
      // what is drawn, so revealing deep buildings has to re-run that framing
      // or the new buildings would be outside the reachable area.
      if (s.depth !== prev.depth && this.sourceLayout) {
        this.depth = s.depth;
        this.draw(this.sourceLayout);
        return;
      }
      // A turn redraws for the same reason a depth change does: the artwork and
      // the geometry both change, and the camera's framing is derived from what
      // is drawn. It redraws from the daemon's layout rather than the turned one,
      // so turns compose as "which orientation" rather than accumulating.
      if (s.turn !== prev.turn && this.sourceLayout) {
        this.turn = normaliseTurn(s.turn);
        this.draw(this.sourceLayout);
        return;
      }
      if (s.live !== prev.live && this.layout) this.syncLive();
      // A label's visibility is the only thing left that moves without a
      // redraw, so the sweep runs whenever either half of the rule changes.
      if (s.focused !== prev.focused || s.hovered !== prev.hovered) this.refreshLabels();
    });
  }


  /**
   * draw renders a layout, replacing anything already on screen.
   *
   * The whole town is rebuilt rather than patched. A layout only changes when
   * the viewed project changes or the daemon re-analysed it — a handful of times
   * a session — while live updates arrive hundreds of times and only move
   * workers. Rebuilding on those is what would flicker the town.
   */
  draw(source: Layout): void {
    // The registry holds the very objects `removeAll` just destroyed, so it is
    // cleared here rather than left to be overwritten: a stale entry would keep
    // a destroyed Image alive and the sweep would then call `setVisible` on it,
    // which is the kind of bug that only shows up as a label that stops
    // responding on the *second* town of a session.
    this.labels.clear();
    // The daemon's own layout is kept, and everything below works on its turned
    // view. Turning the *layout* rather than threading a turn through the camera,
    // the kerbs, the ground, the workers and the hit zones means every one of
    // those goes on reading a layout exactly as it always did — one transformed
    // input instead of a dozen places that could each apply it in the projection
    // and forget it in the coordinates.
    this.sourceLayout = source;
    this.ensureAtlas();
    const layout = turnLayout(this.turn, source);
    this.layout = layout;
    this.children.removeAll(true);
    this.buildingSprites.clear();
    this.workers?.destroy();

    // Ground is baked into a single texture first, then everything that stands
    // on it is placed as its own sprite. The order matters and is the whole
    // point: ground is static, so one texture costs one draw call instead of
    // thousands, and it cannot z-fight with anything drawn after it.
    this.drawGround(layout);
    for (const d of layout.districts) this.drawDistrict(d);
    for (const s of layout.sites) if (s.kind !== "building") this.drawPlaceGround(s);
    this.paintGround(layout);

    // Sites in far-to-near order, so a building on a nearer row is drawn over
    // one behind it. Depth is set per object as well, but drawing in order keeps
    // the two consistent.
    //
    // The filter runs HERE, on the way out of a layout computed in full, and
    // never on the way in. That distinction is the whole safety property of the
    // feature: `placeDistrict` positions a building by its index into a
    // district's sorted slice, so re-running the layout over a subset renumbers
    // those slices and moves buildings that were already on screen — measured
    // at 12 of 18 in this repository. Dropping sites from the draw loop cannot
    // move anything: every site still drawn keeps the coordinates it was given.
    const shown = layout.sites.filter((s) => visibleAt(s, this.depth));
    const ordered = [...shown].sort((a, b) => a.x + a.y - (b.x + b.y));
    for (const s of ordered) this.drawSite(s);

    // The labels were created hidden, so the rule is applied once here rather
    // than trusted to have been applied at each call site. Without this a
    // focused label would go dark on any redraw — and a redraw happens on a
    // depth change, so the reader who clicked a building and then moved the
    // detail control would watch the name they pinned open disappear.
    this.refreshLabels();

    this.workers?.destroy();
    this.workers = new WorkerLayer(this, ATLAS, this.atlas, () => this.moved >= 5);
    this.syncLive();

    const b = this.worldBounds(layout);
    this.cameras.main.setBounds(b.x, b.y, b.w, b.h);
    // Frame the town when it is a *different* town, not merely a new object.
    //
    // A draw happens on any change of layout identity, and that includes a
    // reconnect: `subscribe`'s onReconnect re-fetches the town and installs a
    // freshly parsed layout from the same project. Fitting on identity alone
    // therefore threw away whatever the developer had panned and zoomed to
    // every time the stream blipped. The signature is what actually
    // distinguishes one town from another, so it is what the fit is keyed to.
    const signature = `${layout.width}x${layout.height}:${layout.sites.length}:${layout.districts.length}`;
    if (signature !== this.fittedSignature) {
      this.fittedSignature = signature;
      this.fit(layout);
    }
  }

  /**
   * ensureAtlas loads the current orientation's art, baking it if it is new.
   *
   * Baked on demand rather than all four at boot, because the bake is not free:
   * measured at 422 ms for one orientation and 628 cels, so four would add
   * 1.7 s to every session's start for three pictures most readers never look
   * at. A reader who never turns pays for exactly the one they use.
   *
   * The cost is a hitch on the first turn to a new orientation. That is the
   * right trade: a turn is a deliberate act with a moment of anticipation around
   * it, where a slow boot is a cost every visit pays.
   */
  private ensureAtlas(): void {
    // The map of baked orientations is the authority on what exists, not a
    // comparison against `atlasTurn`. Guarding on `atlasTurn === turn` looked
    // right and was wrong at boot, where both are 0: it returned before ever
    // baking, leaving an empty atlas, a town of invisible buildings and the
    // single stray sprite that drew from a missing frame.
    const cached = this.atlases.get(this.turn);
    if (cached) {
      this.atlas = cached;
      this.atlasTurn = this.turn;
      return;
    }
    this.atlas = bake(this, this.turn);
    this.atlases.set(this.turn, this.atlas);
    this.atlasTurn = this.turn;
  }

  /**
   * project maps a world unit to a picture pixel.
   *
   * This is the projection, written once per layer. The art layer's
   * `IsoPix.project` is the same formula; they cannot share code without the art
   * layer depending on the scene, so a test asserts the two agree — a
   * discrepancy would put every worker off its building rather than fail.
   */
  private project(wx: number, wy: number, z = 0): { x: number; y: number } {
    return { x: (wx - wy) / 2, y: (wx + wy) / 4 - z };
  }

  /**
   * place puts a baked cel on the map with its own origin on a world point.
   *
   * Every cel records where its world origin sits inside it (a worker's is
   * between its feet, a building's is its footprint's corner, a tile's is its
   * top corner). The arithmetic below converts that into a top-left draw
   * position — and then `setOrigin(0, 0)` is what makes it true. A Phaser Image
   * defaults to origin 0.5, so without it the position would be read as the
   * cel's *centre* and every building and prop would sit half a cel up-and-left
   * of its own plot, with the click zone following it. That is exactly what
   * happened here: it was caught by a reviewer checking the real Phaser dist
   * rather than by reading this code, because the arithmetic looks correct.
   */
  private place(key: string, wx: number, wy: number, z = 0): Phaser.GameObjects.Image | null {
    const f = this.atlas[key];
    if (!f) return null;
    const p = this.project(wx, wy, z);
    return this.add.image(p.x - f.ox, p.y - f.oy, atlasKey(this.atlasTurn), key).setOrigin(0, 0);
  }

  /**
   * drawGround writes the field the town sits in.
   *
   * The tiles are not drawn to the scene; they are painted into one texture by
   * `paintGround`. A town of a few hundred world units needs several thousand
   * tiles, and several thousand Game Objects that never move is a frame budget
   * spent on nothing — the ground is static, so it is one draw.
   *
   * Only the ground the layout covers is written. Tiling the camera bounds
   * instead would paint land nobody can reach.
   */
  private drawGround(l: Layout): void {
    const pad = TILE * 3;
    this.groundPlan.length = 0;
    this.groundPlan.push({
      x: -pad,
      y: -pad,
      w: l.width + pad * 2,
      h: l.height + pad * 2,
      kind: "grassOutside",
      // The inner band is the town's own cleared grass; the outer field is a
      // colder grass, so the site reads as land inside a field.
      inner: { x: 0, y: 0, w: l.width, h: l.height, kind: "grass" },
    });
  }

  /** drawPlaceGround is the ground the three special places stand on. */
  private drawPlaceGround(s: Site): void {
    const place = PLACES[s.kind];
    if (!place) return;
    this.groundPlan.push({ x: s.x, y: s.y, w: s.w, h: s.h, kind: place.ground });
  }

  /**
   * paintGround rasterises the planned tiles into one texture.
   *
   * The canvas is created at the size the town needs, its origin is placed so
   * world (0, 0) lands where the projection puts it, and then each tile is
   * blitted at its own projected corner. Blitting integer-spaced pixel data is
   * what keeps this on-grid: a scaled `drawImage` call would resample the tiles
   * and reintroduce exactly the smoothing the whole art direction avoids.
   */
  private paintGround(l: Layout): void {
    const e = this.extents(l);
    const pad = 64;
    const w = Math.ceil(e.maxX - e.minX) + pad * 2;
    const h = Math.ceil(e.maxY - e.minY) + pad * 2;
    // A canvas this large already fails on most GPUs, and the failure is a blank
    // texture rather than an exception — so the size is refused up front and the
    // ground falls back to a single flat fill. A monorepo whose districts wrap
    // into a very tall town is the case this exists for (ADR-0004's monorepo
    // density failure mode); losing the tile texture is far better than losing
    // the town.
    const MAX_SIDE = 8192;
    const tooBig = w > MAX_SIDE || h > MAX_SIDE || w * h > 16_777_216;
    if (w <= 0 || h <= 0) return;

    if (tooBig) {
      // One flat field: no districts, no places, but the town still stands on
      // something and every sprite is still drawn.
      const flat = this.add
        .rectangle(e.minX - pad, e.minY - pad, w, h, Number.parseInt(P.grass[1].slice(1), 16))
        .setOrigin(0, 0)
        .setDepth(DEPTH.ground);
      this.groundImage = null;
      void flat;
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    // The map from a world point to this canvas: the projection, shifted so the
    // town's own bounding box starts at the canvas's padding.
    const toCanvas = (wx: number, wy: number): [number, number] => {
      const p = this.project(wx, wy);
      return [p.x - e.minX + pad, p.y - e.minY + pad];
    };

    for (const region of this.groundPlan) {
      for (let wy = region.y; wy < region.y + region.h; wy += TILE) {
        for (let wx = region.x; wx < region.x + region.w; wx += TILE) {
          const inner = region.inner;
          const inside =
            inner !== undefined &&
            wx >= inner.x &&
            wy >= inner.y &&
            wx < inner.x + inner.w &&
            wy < inner.y + inner.h;
          const kind: Ground = inside ? (inner.kind as Ground) : (region.kind === "grassOutside" ? "grassDark" : region.kind);
          const v = tileVariant(wx, wy);
          // At the region's own border, an edge piece is drawn instead of the
          // plain tile. That is what turns the boundary from a bare flip
          // between two materials into an authored edge, the way a real path
          // edge interlocks with the grass around it.
          //
          // The band names are deliberately paired across the two axes, not
          // along them: `terrain.ts` defines `west` as the band at the tile's
          // *low wx* edge and `north` as the low *wy* edge, so a border in x
          // takes `west`/`east` and a border in y takes `north`/`south`.
          // Pairing them the other way draws the band on a perpendicular
          // interior flank, leaving the real boundary a bare flip while a dark
          // streak runs through the middle of every plate.
          const onEdge =
            wx === region.x ? "west" : wy === region.y ? "north" : wx + TILE >= region.x + region.w ? "east" : wy + TILE >= region.y + region.h ? "south" : null;
          // The edge piece only where this region meets another: inside a
          // nested region the tile is that region's own, and has no boundary.
          const edgeKey = onEdge && !inside ? groundEdgeFrame(kind, onEdge, v) : null;
          const key = edgeKey && this.atlas[edgeKey] ? edgeKey : groundFrame(kind, v);
          const f = this.atlas[key];
          if (!f) continue;
          const [cx, cy] = toCanvas(wx, wy);
          ctx.drawImage(this.tileCanvas(key), Math.round(cx - f.ox), Math.round(cy - f.oy));
        }
      }
    }

    // Kerbs last, over the tiles: a section's hard edge has to sit on top of
    // the ground it bounds, and painting it before the tiles would let a
    // neighbouring region's tiles cover it.
    //
    // They go into the same texture as the ground rather than being sprites, for
    // the reason the ground does: a section's edge never moves, and two thousand
    // pixels per section as Game Objects would be a frame budget spent on
    // something static. It also guarantees the kerb and its ground cannot
    // z-fight, because they are the same pixels.
    this.paintKerb(ctx, toCanvas, l);

    const textureKey = "ground";
    if (this.textures.exists(textureKey)) this.textures.remove(textureKey);
    const added = this.textures.addCanvas(textureKey, canvas);
    if (added) added.add("all", 0, 0, 0, w, h);
    const img = this.add.image(e.minX - pad, e.minY - pad, textureKey, "all");
    img.setOrigin(0, 0).setDepth(DEPTH.ground);
    this.groundImage = img;
  }

  /**
   * paintKerb draws the hard edge of every section into the ground texture.
   *
   * A section is any rectangle the layout gave its own ground: a district's
   * plate, or one of the three special places. They are walked in the order
   * `groundPlan` holds them — the field, then districts, then places — so a
   * place's kerb is written after the district it sits inside, which is what
   * lets a place's warm ring read on top of a district's stone one.
   *
   * The rings are *not* inset for nested sections, deliberately. A district
   * that contains a place gets its kerb along its whole outline, including the
   * stretch where the place covers it; the place's own kerb is then drawn over
   * that stretch and is a pixel or two inside it. The result reads as a place
   * inside a district — which is the truth — rather than as two shapes that
   * had a bite taken out of one.
   */
  private paintKerb(
    ctx: CanvasRenderingContext2D,
    toCanvas: (wx: number, wy: number) => [number, number],
    l: Layout,
  ): void {
    const sections: { x: number; y: number; w: number; h: number; style: typeof KERB.district }[] = [];
    for (const d of l.districts) {
      sections.push({ x: d.x, y: d.y, w: d.w, h: d.h, style: KERB.district });
    }
    for (const s of l.sites) {
      if (!isPlaceKind(s.kind)) continue;
      sections.push({ x: s.x, y: s.y, w: s.w, h: s.h, style: KERB.place });
    }

    const [cx, cy] = toCanvas(0, 0);
    for (const { run, colour } of sections.flatMap((s) => kerbRuns(s.x, s.y, s.w, s.h, s.style))) {
      ctx.fillStyle = colour;
      ctx.fillRect(run.x + cx, run.y + cy, run.w, 1);
    }
  }

  /**
   * tileCanvas renders one baked tile frame to its own small canvas, cached.
   *
   * The atlas is one big texture and `drawImage` on it would need source
   * rectangles the browser then resamples; going through a per-tile canvas of
   * exactly the frame's size keeps every blit 1:1 and pixel-exact.
   */
  private tileCanvas(key: string): HTMLCanvasElement {
    const cached = this.tileCanvases.get(key);
    if (cached) return cached;
    const f = this.atlas[key];
    const c = document.createElement("canvas");
    c.width = f.w;
    c.height = f.h;
    const cx = c.getContext("2d");
    if (cx) {
      cx.imageSmoothingEnabled = false;
      const src = this.textures.get(atlasKey(this.atlasTurn)).getSourceImage() as HTMLCanvasElement;
      cx.drawImage(src, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
    }
    this.tileCanvases.set(key, c);
    return c;
  }

  /**
   * drawDistrict lays a district's plate.
   *
   * A district is ground of packed earth or grey grass with a rim, not a
   * rectangle: the plate is the neighbourhood's floor, and its shape is what
   * makes two adjacent districts read as two places rather than as one field
   * with a line ruled across it.
   */
  private drawDistrict(d: Layout["districts"][number]): void {
    // A test district's ground is browner, so tests are distinguishable from
    // code without a legend.
    const kind: Ground = d.kind === "test" ? "earth" : "grass";
    this.groundPlan.push({ x: d.x, y: d.y, w: d.w, h: d.h, kind });

    // The label sits above the plate's far corner: where a name belongs on a
    // diamond, and where a building standing on the plate cannot cover it. A
    // test district is marked in its words rather than by colour alone, so the
    // distinction survives a reader who cannot separate the two greens.
    //
    // It is hidden until asked for, like every other name on the map, and the
    // plate itself is what is asked: the zone below covers the ground the label
    // describes. A reader who wants to know what a neighbourhood is called points
    // at it, and one who wants to read the skyline does not have to look through
    // its name to do it.
    const top = this.project(d.x, d.y);
    const isTest = d.kind === "test";
    const id = `${DISTRICT_PREFIX}${d.name}`;
    this.register(
      id,
      this.label(isTest ? `${d.name.toUpperCase()} (TESTS)` : d.name.toUpperCase(), top.x, top.y - 8, isTest ? "test" : "name"),
    );

    // Beneath every site standing on it, so a building's own zone wins the
    // pointer and a reader pointing at a building gets that building's name
    // rather than the whole district's. `input.topOnly` is what makes the
    // topmost zone the only one that answers, which is why the ordering is
    // enough and no explicit exclusion is needed.
    const near = this.project(d.x + d.w, d.y + d.h);
    this.hoverable(
      this.add.zone(d.x, d.y, d.w, d.h).setOrigin(0, 0).setInteractive({ useHandCursor: true }),
      id,
      near.y - 1,
    );
  }


  private drawSite(s: Site): void {
    // The grounded corner nearest the camera, which is what depth and hit zones
    // are measured from: a building's own far corner is behind its own roof.
    const near = this.project(s.x + s.w, s.y + s.h);

    if (s.kind === "building") {
      // The contact shadow first, so the building stands on the map rather than
      // floating over it. It is a separate sprite because it must not move or
      // restage with the building; it is the ground's reaction to it.
      const shadow = this.place(shadowFrame(s.w, this.atlasTurn), s.x, s.y);
      shadow?.setDepth(near.y - 1);

      // The stack is registered under the site's name so a later status change
      // can swap the frames inside it. Rebuilding the map to restage one building
      // would flicker the whole town, and the stages are the product — a building
      // that never visibly rises is the town failing at its one job.
      const box = this.placeBuilding(s, near.y);
      this.buildingSprites.set(s.id, box);
      // The building's own name, above its plot's far corner.
      //
      // A building is a directory, and a directory name is the one word a
      // developer already uses for that part of the project. Without it the map
      // is a set of anonymous huts and the only way to learn which is which is
      // to click each one — which is exactly the work a map is supposed to save.
      //
      // It sits above the *plot*, not above the building's own cel, because the
      // cel grows with the stage: a label anchored to the cel would rise as the
      // building did, and the map would drift under a reader who was watching it.
      const labelAt = this.project(s.x, s.y);
      // Nothing is named until it is asked for. Pointing at the building reveals
      // its name; clicking it pins the name open for as long as the reader is
      // reading. Measured on one real eighteen-site town, labelling the top level
      // outright left thirteen boards on screen at once, which is the wall of
      // type the reader complained about — the skyline they were looking at was
      // the thing obscured by its own names.
      this.register(s.id, this.label(s.label, labelAt.x, labelAt.y - 6, "name"));

      // The hit zone must cover the whole tower, not just the plot. A building
      // that answered a click only at its base would read as broken from the
      // moment it had more than a couple of storeys, because the part a reader
      // aims at is the wall.
      const base = this.atlas[this.baseKey(s)];
      const cap = this.atlas[this.capKey(s)];
      const p = this.project(s.x, s.y);
      const top = p.y - towerTop(clampFloors(s.floors)) - cap.oy;
      this.hitZone(p.x - base.ox, top, base.w, p.y + base.h - base.oy - top, s, near.y + 2);
      return;
    }

    if (s.kind === "container") {
      // A container is drawn with the building pipeline — the same parts, the
      // same height rule — because what a reader needs from it is exactly what a
      // building gives: how much is here, at a glance. What it does *not* get is
      // a lifecycle: no stage, no damage, no restage. It is an aggregate of what
      // is below rather than something anyone worked on, and drawing it as a
      // building mid-construction would claim work that never happened.
      const box = this.placeContainer(s, near.y);
      this.buildingSprites.set(s.id, box);

      // The label sits on the plate's far corner. A container's footprint *is*
      // the plate, so the label goes below its top edge rather than above it,
      // where the district's own name already is.
      const labelAt = this.project(s.x, s.y);
      this.register(s.id, this.label(s.label, labelAt.x + s.w / 2, labelAt.y + 22, "name"));

      const keys = this.containerKeys(s);
      const base = this.atlas[keys[0]];
      const cap = this.atlas[keys[keys.length - 1]];
      const p = this.project(s.x, s.y);
      const top = p.y - towerTop(clampFloors(s.floors)) - cap.oy;
      this.hitZone(p.x - base.ox, top, base.w, p.y + base.h - base.oy - top, s, near.y + 2);
      return;
    }

    const place = PLACES[s.kind];
    const info = placeInfoFor(s);
    if (!place || !info) return;

    // The place's own ground was already painted, kerb included; only its
    // furniture and its signage are placed here.


    // The grid is sized from the prop count and the plate together, and that is
    // the correction of a real bug rather than a refinement. The first version
    // used a fixed pitch and dropped whatever ran past the plate's near edge:
    // the Yard's two dozen props in a thirteen-column grid filled two rows, and
    // the rest were silently `return`ed — so the busiest place in the town
    // rendered at half its stock with nothing to say it had. Sizing the cell
    // from both numbers means a longer list packs tighter rather than
    // disappearing, and `rows` is solved from `cells`, so every prop has a cell
    // by construction instead of by luck.
    const cells = place.props.length + 1;
    const aspect = Math.max(0.5, s.w / s.h);
    const cols = Math.max(1, Math.min(cells, Math.round(Math.sqrt(cells * aspect))));
    const rows = Math.ceil(cells / cols);
    const pitchX = (s.w - 12) / cols;
    const pitchY = (s.h - 12) / rows;
    const cellAt = (slot: number): { x: number; y: number } => {
      const col = slot % cols;
      const row = Math.floor(slot / cols);
      return { x: s.x + 6 + (col + 0.5) * pitchX, y: s.y + 6 + (row + 0.5) * pitchY };
    };

    // The signpost takes the near-left cell — the last row's first column,
    // which is the corner a reader arrives from — and the props take every other
    // cell in the grid.
    //
    // "Every other cell" is the correction of a second, subtler version of the
    // dropping bug above. Sizing the grid for `props + 1` and then skipping the
    // prop *whose index equalled* the sign's slot dropped that prop outright:
    // the Yard's thirty-two-cell grid put the sign at slot 24 and a prop already
    // lived there, so one of the two dozen silently vanished. The fix is to
    // enumerate the cells once, remove the sign's, and hand the remainder to the
    // props in order — which cannot disagree, because there is exactly one slot
    // per prop by construction.
    const signSlot = (rows - 1) * cols;
    const slots: number[] = [];
    for (let i = 0; i < rows * cols; i++) if (i !== signSlot) slots.push(i);

    const signAt = cellAt(signSlot);
    const sign = this.place(propFrame("signpost", 0, this.atlasTurn), signAt.x, signAt.y);
    sign?.setDepth(this.project(signAt.x, signAt.y).y);

    place.props.forEach((kind, i) => {
      const slot = slots[i];
      if (slot === undefined) return; // unreachable by construction; a town is not worth a crash
      const at = cellAt(slot);
      // The variant alternates by cell, so two of the same prop in one place —
      // barrels in the Yard, crates in the Workshop — come out as two objects
      // rather than as one object printed twice. It is keyed to the cell rather
      // than to the prop's index so the alternation follows the layout a reader
      // sees, rather than the order of a list they never see.
      const prop = this.place(propFrame(kind, slot % 2, this.atlasTurn), at.x, at.y);
      prop?.setDepth(this.project(at.x, at.y).y);
    });

    // The place's name, lettered onto the signpost's own board so the two read
    // as one object: a sign, rather than a caption that happens to sit above a
    // post. The lift matches the board height in the signpost's drawing.
    //
    // All three of a place's boards are registered under the place's own id, so
    // pointing at the Depot lights its name, what it is for, and which actions
    // land there together. They are one answer to one question — "what is this
    // place" — and revealing them separately would be three answers to it.
    const board = this.project(signAt.x, signAt.y);
    this.register(s.id, this.label(info.name.toUpperCase(), board.x, board.y - 12, "place"));

    // What the place is *for*, under its name. The name alone leaves "what is a
    // Depot" unanswered, and the whole point of the three places is that most of
    // a session happens where the code is not.
    this.register(s.id, this.label(info.sign.toUpperCase(), board.x, board.y - 2, "doing"));

    // Which actions land here, on the far edge where nothing standing can cover
    // it. This is the one label in the town that is a list rather than a name,
    // and the far edge is the only place on a plate with room for one.
    const far = this.project(s.x, s.y);
    this.register(s.id, this.label(info.takes.toUpperCase(), far.x, far.y - 4, "doing"));

    this.hitZone(
      this.project(s.x, s.y).x,
      this.project(s.x, s.y).y - 30,
      s.w / 2 + 30,
      s.h / 4 + 50,
      s,
      near.y + 2,
    );
  }

  /** hitZone is a clickable region. A drag must not count as a click, hence the
   *  distance check against the pointer's total travel. */
  private hitZone(
    x: number,
    y: number,
    w: number,
    h: number,
    site: Site,
    depth: number,
  ): void {
    const zone = this.add
      .zone(x, y, w, h)
      .setOrigin(0, 0)
      .setInteractive({ useHandCursor: true });
    zone.setDepth(depth);
    zone.on("pointerup", () => {
      if (this.moved < 5) this.focusSite(site.id, site);
    });
    // The zone is what is pointed at rather than the sprite, because a tower's
    // zone covers the whole stack while its sprites are several objects — and
    // because a container's zone does the same. Pointing at either end of a
    // building lights its name.
    this.hoverable(zone, site.id);
  }

  /**
   * hoverable lights an object's labels while the pointer is over a zone.
   *
   * `pointerover`/`pointerout` rather than polling the pointer, so a hidden
   * label costs nothing per frame — which is the whole reason the labels can be
   * hidden by default without a frame budget.
   *
   * `depth` is for the district plates, which are given their zone before the
   * sites are drawn so that a site's zone sits above it and wins the pointer.
   */
  private hoverable(zone: Phaser.GameObjects.Zone, id: string, depth?: number): void {
    if (depth !== undefined) zone.setDepth(depth);
    // The hover goes into the store rather than into a field here, so that the
    // worker captions — which `WorkerLayer` owns — resolve against the same
    // pointer as these names. The store subscription runs the sweep, which is
    // why nothing is refreshed at these call sites.
    zone.on("pointerover", () => useTown.getState().hover(id));
    zone.on("pointerout", () => {
      // Guarded rather than assumed: moving from a building straight onto a
      // worker fires the building's out event *after* the worker's over event in
      // some pointer orderings, and an unguarded clear would then drop the
      // hover the reader has already moved to.
      if (useTown.getState().hovered === id) useTown.getState().hover(null);
    });
  }

  /**
   * focusSite selects a site and pins its labels open.
   *
   * Selection and focus travel together for a click on the map, because they are
   * the same act: a reader who clicks a building is asking what it is, and the
   * panel is where that is answered in full. They are still two pieces of state —
   * `store.ts` explains why — because focusing a *worker* pins a caption without
   * emptying the panel.
   */
  private focusSite(id: string, site: Site): void {
    const { select, focus } = useTown.getState();
    select(site);
    focus(id);
  }

  /**
   * refreshLabels shows exactly the labels the rule allows and hides the rest.
   *
   * A sweep over the registry rather than a redraw, because focus changes on
   * every click: rebuilding the town to move one board would flicker the map,
   * the same reason a status change restages a building in place.
   *
   * It is idempotent, which is what makes it safe to call from every hover event
   * and from the store subscription without tracking what changed.
   */
  private refreshLabels(): void {
    const { focused, hovered } = useTown.getState();
    for (const [id, images] of this.labels) {
      const show = labelVisible(id, hovered, focused);
      for (const img of images) img.setVisible(show);
    }
    // The figures' captions are the other half of the same rule, and they are
    // swept here rather than in a store subscription of their own so that one
    // pointer move resolves one rule. Two sweeps would each have to know about
    // the other's objects to avoid disagreeing.
    this.workers?.applyLabels(focused, hovered);
  }

  /**
   * register files a label under the id of the thing it names.
   *
   * Every label goes through here so that one sweep can find them all. A label
   * registered under a different key than the id its zone reports would be
   * unreachable by both hover and focus — visible or invisible forever, with
   * nothing to show why.
   */
  private register(id: string, img: Phaser.GameObjects.Image | null): void {
    if (!img) return;
    const list = this.labels.get(id);
    if (list) list.push(img);
    else this.labels.set(id, [img]);
  }

  /**
   * label letterers a string in the town's own bitmap font, on a board.
   *
   * It is drawn as a baked texture rather than as a Phaser Text object, because
   * a canvas font would arrive antialiased and would be the one soft-edged thing
   * on a screen made of hard pixels.
   *
   * The board behind the letters is not decoration — `art/placard.ts` explains
   * why a bare run of type on this map is genuinely hard to find. What is
   * decided here rather than there is the *cache key*, which is the whole
   * reason this method exists rather than the scene calling `placard` inline:
   * every district name, every place name and every worker's caption goes
   * through this one cache, so a screen with two dozen labels pays for two
   * dozen textures rather than one per label per frame.
   */
  private label(text: string, x: number, y: number, role: PlacardRole): Phaser.GameObjects.Image | null {
    if (!text) return null;
    const style = PLACARD[role];
    const key = `lbl:${role}:${text}`;
    if (!this.textures.exists(key)) {
      this.textures.addCanvas(key, placard(text, style.ink, style.plate, style.border).toCanvas());
    }
    // It starts hidden and the visibility sweep lights the ones the rule allows.
    // Which labels are lit is therefore decided in exactly one place, rather than
    // by an argument at each of the eight call sites that would each have to agree
    // about whether a name is part of the legend.
    //
    // The texture is cached either way — the cost being avoided is rasterising
    // the same string twice, not drawing it — so a hidden label is one
    // `setVisible(false)` rather than an absence from the cache.
    return this.add.image(x, y, key).setOrigin(0.5, 1).setDepth(DEPTH.label).setVisible(false);
  }

  /**
   * statusOf reads a building's reported status: the only input to which stage
   * is drawn.
   *
   * A building the town has not reported yet draws as `planned`, which is
   * correct rather than a fallback: it exists in the map the moment the project
   * is analyzed, and a building nobody has worked on is a staked plot.
   */
  private statusOf(path: string | undefined): Stage {
    if (!path) return "planned";
    const { live } = useTown.getState();
    for (const b of live.buildings) if (b.path === path) return b.status;
    return "planned";
  }

  /** damagedOf says whether a building is currently damaged. Damage is drawn
   *  over the building's stage rather than replacing it. */
  private damagedOf(path: string | undefined): boolean {
    if (!path) return false;
    const { live } = useTown.getState();
    for (const b of live.buildings) if (b.path === path) return b.damaged;
    return false;
  }

  /** worldBounds is the picture-space box the town occupies, from the layout's
   *  own corners rather than from a guess, so the camera can always reach every
   *  building even on a project whose widest district exceeds the analyzer's
   *  target row width. */
  private worldBounds(l: Layout): { x: number; y: number; w: number; h: number } {
    const e = this.extents(l);
    const pad = 160;
    return {
      x: e.minX - pad,
      y: e.minY - pad,
      w: e.maxX - e.minX + pad * 2,
      h: e.maxY - e.minY + pad * 2,
    };
  }

  /**
   * extents is the picture-space box of everything the town needs room for.
   *
   * It includes two different things, and they are sized by different rules:
   *
   *   - The **land**, which is the layout's own box. It is always in the picture,
   *     because the ground does not come and go with the detail filter — the
   *     field a town stands in is there whether or not a deep directory inside it
   *     is being drawn.
   *   - The **sites that are drawn**, filtered by the display depth, so a hidden
   *     building does not hold the camera open. Revealing detail must grow the
   *     bounds, which is why this is recomputed rather than fixed at the first
   *     draw.
   *
   * The land half is the correction of a real defect. `paintGround` sizes its
   * canvas from this box while `drawGround` paints the layout's own box, so
   * leaving the land out meant the texture was smaller than the land it painted:
   * measured on this repository, the ground canvas reached picture-x 308 where
   * the land reached 522 — 213 pixels of land with no ground drawn under it at
   * all, which a reader sees as the town's own fields being cut off mid-tile.
   */
  private extents(l: Layout): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    w: number;
    h: number;
  } {
    // The land, from the layout's box plus the pad `drawGround` tiles. The pad
    // is restated here rather than shared, because this function must be able to
    // measure the land *before* the ground plan exists — it is what sizes the
    // canvas that plan is painted into.
    //
    // All four corners are projected and the extremes taken, in both halves of
    // this function. That is not belt-and-braces: the leftmost point of a
    // projected rectangle is the `(x, y+h)` corner, not the `(x, y)` one, so
    // taking the extremes of a hand-picked pair silently under-measures one
    // whole axis. The previous version did exactly that and lost `h/2` on the
    // left of every rectangle, which is the same class of error as the land
    // being left out entirely, and it hid behind it.
    const land = landBox(l.width, l.height, TILE * 3, (x, y) => this.project(x, y));
    let minX = land.minX;
    let maxX = land.maxX;
    let minY = land.minY;
    let maxY = land.maxY;

    for (const s of l.sites) {
      if (!visibleAt(s, this.depth)) continue;
      const corners = [
        this.project(s.x, s.y),
        this.project(s.x + s.w, s.y),
        this.project(s.x, s.y + s.h),
        this.project(s.x + s.w, s.y + s.h),
      ];
      minX = Math.min(minX, ...corners.map((p) => p.x));
      maxX = Math.max(maxX, ...corners.map((p) => p.x));
      // The top must leave room for the tallest thing that can stand on the
      // site, and that is the site's own tower: floors arrive from the daemon, so
      // this is a per-site reservation rather than the fixed allowance for a
      // single-storey hall it used to be. 150 was measured for the old tallest
      // building and is kept as the floor, because the place buildings are not
      // towers and still need their roof and chimney.
      //
      // Undersizing this is not a cosmetic bug: the camera would crop the top
      // of the tallest building in the town, which is the one building the view
      // exists to show.
      const floors = s.kind === "building" ? clampFloors(s.floors) : 1;
      minY = Math.min(minY, this.project(s.x, s.y).y - Math.max(150, floors * STOREY + 60));
      maxY = Math.max(maxY, ...corners.map((p) => p.y));
    }
    return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
  }

  /**
   * controls wires pan and zoom.
   *
   * Registered once from create, never from draw. Phaser clears input handlers
   * only on scene shutdown, not between draws, so registering per-draw would
   * stack a new wheel handler on every SSE reconnect and make one notch zoom N
   * times.
   */
  private controls(): void {
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      this.dragging = true;
      this.moved = 0;
      this.dragStart = {
        x: p.x,
        y: p.y,
        sx: this.cameras.main.scrollX,
        sy: this.cameras.main.scrollY,
      };
    });

    this.input.on("pointerup", () => (this.dragging = false));

    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!this.dragging) return;
      const dx = p.x - this.dragStart.x;
      const dy = p.y - this.dragStart.y;
      this.moved = Math.abs(dx) + Math.abs(dy);
      this.cameras.main.scrollX = this.dragStart.sx - dx / this.cameras.main.zoom;
      this.cameras.main.scrollY = this.dragStart.sy - dy / this.cameras.main.zoom;
    });

    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      // Zoom steps by whole numbers, and never below 1. A fractional zoom makes
      // some art pixels two screen pixels wide and their neighbours one, which is
      // the single most recognisable way a pixel-art screen looks broken — and
      // zooming out below 1 destroys the art rather than showing more of it.
      const next = dy > 0 ? cam.zoom - 1 : cam.zoom + 1;
      cam.setZoom(Phaser.Math.Clamp(next, 1, 4));
    });

    // Trackpads and mice with a middle button otherwise scroll or open a menu
    // over the canvas mid-drag.
    this.input.mouse?.disableContextMenu();
  }

  /**
   * syncLive reconciles everything that changes with a live update: the figures,
   * and each building's construction stage.
   *
   * It reads the store rather than taking arguments, because it is called both
   * on a map redraw and on every live update — and on a redraw the caller has
   * the map but not the live state.
   */
  private syncLive(): void {
    if (!this.workers || !this.layout) return;
    this.restage();
    this.workers.sync(this.layout);
  }

  /**
   * restage swaps the frames inside each building's container.
   *
   * In place rather than by rebuilding the map, and that is the whole reason a
   * building is a container: rebuilding would flicker the entire town on any
   * status change, and the stages are the product — a building that never
   * visibly rises is the town failing at its one job.
   *
   * The floor count does not change with the stage, so the number of children
   * never changes either; only the keys do. A tower stays the same height from
   * the moment it is measured, which is what keeps the skyline stable while the
   * buildings under it are being finished.
   */
  private restage(): void {
    if (!this.layout) return;
    for (const s of this.layout.sites) {
      if (s.kind !== "building") continue;
      const box = this.buildingSprites.get(s.id);
      if (!box) continue;
      const keys = this.stackKeys(s);
      box.list.forEach((child, i) => {
        const img = child as Phaser.GameObjects.Image;
        if (img.frame.name !== keys[i]) img.setFrame(keys[i]);
      });
    }
  }

  /**
   * stackKeys is the atlas frame of every child of a building's container, in
   * draw order: one base, one band per storey above the first, then the cap.
   *
   * The floor count comes from the daemon's measurement, not from anything the
   * renderer derives, and it is clamped here as well as in the daemon — the
   * clamp is the renderer's own guarantee, so a daemon that sent nonsense cannot
   * ask for a hundred thousand sprites.
   *
   * Bands are `floors - 1` because the base already carries the ground storey's
   * wall: base + (floors - 1) bands + cap is exactly `floors` storeys of wall.
   * An off-by-one here is invisible at one floor and wrong at every other.
   */
  private stackKeys(s: Site): string[] {
    const floors = clampFloors(s.floors);
    const keys = [this.baseKey(s)];
    for (let i = 1; i < floors; i++) keys.push(this.bandKey(s));
    keys.push(this.capKey(s));
    return keys;
  }

  /**
   * placeBuilding builds a site's container: the base at the site, a band per
   * storey above it, and the cap on top.
   *
   * Every part is placed by the same rule — `i * STOREY` above the base — because
   * each part draws its own base at local z = 0 (see `art/building.ts`). One rule
   * for all three parts means there is no per-part special case to get wrong, and
   * the parts are proven to land on exact storey boundaries in `art.test.ts`.
   *
   * The band's screen anchor steps up a storey at a time, which is what makes
   * the wall continuous: the projection moves a point up by exactly one pixel per
   * world unit of z, so a storey's worth of z is a storey's worth of pixels and
   * the join between two floors is seamless.
   */
  private placeBuilding(s: Site, depth: number): Phaser.GameObjects.Container {
    return this.stackContainer(this.stackKeys(s), s, depth);
  }

  /**
   * placeContainer stacks a container's storeys on its plate.
   *
   * It shares `placeBuilding`'s geometry — every part at `i * STOREY`, because
   * each part draws its own base at local z = 0 — so a container and a building
   * of the same height line up exactly, which is what lets a reader compare
   * them.
   *
   * What a container does *not* share is the lifecycle. It has no status, so it
   * is drawn from the completed picture; that is the honest reading, because an
   * aggregate of what is below it is by definition finished, and showing it
   * half-built would invent a construction history for something nobody built.
   * It has no damage for the same reason: damage is what happened *to* a
   * building.
   */
  private placeContainer(s: Site, depth: number): Phaser.GameObjects.Container {
    return this.stackContainer(this.containerKeys(s), s, depth);
  }

  /**
   * stackContainer places one cel per storey at `i * STOREY`.
   *
   * The single place the stacking arithmetic lives, so a building and a
   * container cannot disagree about how tall a storey is or where the roof goes.
   * The caller supplies the keys; this decides only where each one lands.
   */
  private stackContainer(keys: string[], s: Site, depth: number): Phaser.GameObjects.Container {
    const box = this.add.container(0, 0);
    const p = this.project(s.x, s.y);
    const floors = clampFloors(s.floors);
    for (let i = 0; i < keys.length; i++) {
      const f = this.atlas[keys[i]];
      if (!f) continue;
      // The cap is the last child and sits above the topmost band, not at
      // `i * STOREY` — at one floor those coincide, which is exactly why a
      // tower's roof would float one storey too high if this were spelled that
      // way.
      const z = i < floors ? i * STOREY : towerTop(floors);
      // `setOrigin(0, 0)` is load-bearing and was missing here, which put every
      // building and every container half a cel up-and-left of its own plot —
      // measured at 36 pixels left and 48 up on a 73x85 cel, and 56/54 on a
      // 113x111 one, so the displacement scaled with the footprint. That is the
      // "building is out of its section" a reader sees: a Phaser Image defaults
      // to origin 0.5, so the cel's *centre* lands where its top-left was meant
      // to go. `place()` has the same call and the same comment, because this
      // bites in every code path that forgets it — the two must agree.
      box.add(this.add.image(p.x - f.ox, p.y - z - f.oy, atlasKey(this.atlasTurn), keys[i]).setOrigin(0, 0));
    }
    box.setDepth(depth);
    box.setName(siteName(s));
    return box;
  }

  /**
   * containerKeys are the atlas frames a container is drawn from.
   *
   * A container has no status, so it takes the *completed* picture: an aggregate
   * is by definition finished, and showing it half-built would invent a
   * construction history for something nobody built. It has no damaged variant
   * for the same reason — damage is what happened *to* a building.
   *
   * The variant comes from the container's own path, so two containers side by
   * side can differ in material the way two buildings do. The roof does too, which
   * is deliberate rather than incidental (ADR-0021 rule 5): containers are most of
   * the shallowest, most-read view, so that view is the one that gains the variety.
   */
  private containerKeys(s: Site): string[] {
    const floors = clampFloors(s.floors);
    const v = skinVariant(s.path ?? "");
    // `s.w` is a baked footprint — the daemon sends one of the atlas's own four
    // sizes and centres the site itself, so the renderer never has to guess
    // which art a site wants.
    const size = s.w;
    const keys = [baseFrame(size, "completed", v, false, this.atlasTurn)];
    for (let i = 1; i < floors; i++) keys.push(bandFrame(size, "completed", v, this.atlasTurn));
    keys.push(capFrame(size, this.roofKey(s), "completed", false, this.atlasTurn));
    return keys;
  }

  /**
   * roofKey is which roof a site wears.
   *
   * Chosen here, in the browser, from the site's own path — the same place and the
   * same way the skin variant is chosen. The daemon sends geometry (footprint,
   * floors) and knows nothing about appearance, so there is no wire change and no
   * daemon change behind the roof axis; the roof is a pure function of the path,
   * which the browser already has.
   *
   * A site with no path hashes as the empty string, which yields one fixed kind
   * rather than a random one — the same "no path, no variety" rule the skin uses.
   */
  private roofKey(s: Site): RoofKind {
    return roofFor(s.path ?? "");
  }

  private baseKey(s: Site): string {
    return baseFrame(s.w, this.statusOf(s.path), skinVariant(s.path ?? ""), this.damagedOf(s.path), this.atlasTurn);
  }

  private bandKey(s: Site): string {
    return bandFrame(s.w, this.statusOf(s.path), skinVariant(s.path ?? ""), this.atlasTurn);
  }

  private capKey(s: Site): string {
    return capFrame(s.w, this.roofKey(s), this.statusOf(s.path), this.damagedOf(s.path), this.atlasTurn);
  }

  /** celAnchor is where a cel's top-left goes so its own origin lands on the
   *  site's footprint corner. */
  private celAnchor(s: Site, key: string): [number, number] {
    const f = this.atlas[key];
    const p = this.project(s.x, s.y);
    return [p.x - f.ox, p.y - f.oy];
  }

  /**
   * fit frames the whole town.
   *
   * Called from every draw, because a draw is what a project switch triggers.
   *
   * The zoom is the largest whole number that fits, and 1 when not even 1 fits.
   * At zoom 1 a town wider than the viewport is panned rather than shrunk: there
   * is no honest way to show a 1400-unit town in a 1100-pixel canvas without
   * either breaking the pixels or lying about the size.
   */
  private fit(l: Layout): void {
    const e = this.extents(l);
    const cam = this.cameras.main;
    const byWidth = Math.floor((this.scale.width - 60) / e.w);
    const byHeight = Math.floor((this.scale.height - 100) / e.h);
    cam.setZoom(Phaser.Math.Clamp(Math.min(byWidth, byHeight), 1, 4));
    cam.centerOn((e.minX + e.maxX) / 2, (e.minY + e.maxY) / 2);
  }
}

/** The name a site's picture is registered under, so a probe or a test can find
 *  the sprite a building was drawn as. */
export function siteName(s: Site): string {
  return `site:${s.id}`;
}
