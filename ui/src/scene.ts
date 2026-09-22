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
  bake,
  shadowFrame,
  buildingFrame,
  groundFrame,
  groundEdgeFrame,
  propFrame,
} from "./art/bake";
import { type Stage, skinVariant } from "./art/building";
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
  private atlas: Atlas = {};
  private layout: Layout | null = null;
  private workers: WorkerLayer | null = null;
  // Each building's sprite, by site id, so a status change can swap its frame
  // in place. Rebuilding the map for one building's new stage would flicker the
  // whole town, and a building visibly rising is the product.
  private buildingSprites = new Map<string, Phaser.GameObjects.Image>();
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

  constructor() {
    super("town");
  }

  create(): void {
    // The void: a cold near-black, so the lit town sits on something that reads
    // as unlit rather than as part of the picture.
    this.cameras.main.setBackgroundColor(P.void);
    this.atlas = bake(this);
    this.controls();
    this.workers = new WorkerLayer(this, ATLAS, this.atlas);

    const { layout } = useTown.getState();
    if (layout) this.draw(layout);

    useTown.subscribe((s, prev) => {
      if (s.layout && s.layout !== prev.layout) {
        this.draw(s.layout);
        return;
      }
      if (s.live !== prev.live && this.layout) this.syncLive();
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
  draw(layout: Layout): void {
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
    const ordered = [...layout.sites].sort((a, b) => a.x + a.y - (b.x + b.y));
    for (const s of ordered) this.drawSite(s);

    this.workers?.destroy();
    this.workers = new WorkerLayer(this, ATLAS, this.atlas);
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
    return this.add.image(p.x - f.ox, p.y - f.oy, ATLAS, key).setOrigin(0, 0);
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
      const src = this.textures.get(ATLAS).getSourceImage() as HTMLCanvasElement;
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
    const top = this.project(d.x, d.y);
    const isTest = d.kind === "test";
    this.label(isTest ? `${d.name.toUpperCase()} (TESTS)` : d.name.toUpperCase(), top.x, top.y - 8, isTest ? "test" : "name");
  }

  /**
   * drawSite draws one place: its ground and furniture, or its building.
   *
   * A building's picture comes from its status and nothing else. There is no
   * progress number to interpolate, because a building's status only ever moves
   * forward (internal/town) and interpolating it would show work that did not
   * happen.
   */
  private drawSite(s: Site): void {
    // The grounded corner nearest the camera, which is what depth and hit zones
    // are measured from: a building's own far corner is behind its own roof.
    const near = this.project(s.x + s.w, s.y + s.h);

    if (s.kind === "building") {
      // The contact shadow first, so the building stands on the map rather than
      // floating over it. It is a separate sprite because it must not move or
      // restage with the building; it is the ground's reaction to it.
      const shadow = this.place(shadowFrame(s.w), s.x, s.y);
      shadow?.setDepth(near.y - 1);

      // The sprite is registered under the site's name so a later status change
      // can swap its frame in place. Rebuilding the map to restage one building
      // would flicker the whole town, and the stages are the product — a
      // building that never visibly rises is the town failing at its one job.
      const img = this.place(this.buildingKey(s), s.x, s.y);
      if (!img) return;
      img.setDepth(near.y);
      img.setName(siteName(s));
      this.buildingSprites.set(s.id, img);
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
      this.label(s.label, labelAt.x, labelAt.y - 6, "name");

      const f = this.atlas[img.frame.name];
      // The hit zone covers the building's pictured area, so clicking the roof
      // selects the building rather than the field behind it.
      const p = this.project(s.x, s.y);
      this.hitZone(p.x - f.ox, p.y - f.oy, f.w, f.h, s, near.y + 2);
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
    const sign = this.place(propFrame("signpost"), signAt.x, signAt.y);
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
      const prop = this.place(propFrame(kind, slot % 2), at.x, at.y);
      prop?.setDepth(this.project(at.x, at.y).y);
    });

    // The place's name, lettered onto the signpost's own board so the two read
    // as one object: a sign, rather than a caption that happens to sit above a
    // post. The lift matches the board height in the signpost's drawing.
    const board = this.project(signAt.x, signAt.y);
    this.label(info.name.toUpperCase(), board.x, board.y - 12, "place");

    // What the place is *for*, under its name. The name alone leaves "what is a
    // Depot" unanswered, and the whole point of the three places is that most of
    // a session happens where the code is not.
    this.label(info.sign.toUpperCase(), board.x, board.y - 2, "doing");

    // Which actions land here, on the far edge where nothing standing can cover
    // it. This is the one label in the town that is a list rather than a name,
    // and the far edge is the only place on a plate with room for one.
    const far = this.project(s.x, s.y);
    this.label(info.takes.toUpperCase(), far.x, far.y - 4, "doing");

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
      if (this.moved < 5) useTown.getState().select(site);
    });
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
  private label(text: string, x: number, y: number, role: PlacardRole): void {
    if (!text) return;
    const style = PLACARD[role];
    const key = `lbl:${role}:${text}`;
    if (!this.textures.exists(key)) {
      this.textures.addCanvas(key, placard(text, style.ink, style.plate, style.border).toCanvas());
    }
    this.add.image(x, y, key).setOrigin(0.5, 1).setDepth(DEPTH.label);
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

  /** extents is the picture-space box of everything drawn. The camera is fitted
   *  to this rather than to the layout's own rectangle, because the projection
   *  means a tall layout projects wider than its world width. */
  private extents(l: Layout): {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    w: number;
    h: number;
  } {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const s of l.sites) {
      const far = this.project(s.x, s.y);
      const right = this.project(s.x + s.w, s.y);
      const bottom = this.project(s.x, s.y + s.h);
      const near = this.project(s.x + s.w, s.y + s.h);
      minX = Math.min(minX, far.x, right.x);
      maxX = Math.max(maxX, bottom.x, near.x);
      // The top leaves room for the tallest thing that can stand on the site: a
      // 100-unit hall is about 130 world units above its own footprint.
      minY = Math.min(minY, far.y - 150);
      maxY = Math.max(maxY, near.y);
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
   * restage swaps a building's picture when its status has moved on.
   *
   * This is what makes the construction metaphor visible rather than decorative:
   * a worker hammers, the event lands, the building's status advances, and the
   * structure on screen gains its next stage. Swapping the frame keeps the
   * sprite's identity, so nothing else in the scene has to know it happened.
   */
  private restage(): void {
    if (!this.layout) return;
    for (const s of this.layout.sites) {
      if (s.kind !== "building") continue;
      const img = this.buildingSprites.get(s.id);
      if (!img) continue;
      const want = this.buildingKey(s);
      if (img.frame.name === want) continue;
      img.setFrame(want);
      // The frame's size changes with the stage — a completed building is taller
      // than its own foundation — so the click zone is resized with it rather
      // than left covering the plot only.
      img.setPosition(...this.celAnchor(s, want));
    }
  }

  /** buildingKey is the atlas frame a site's current status calls for. The one
   *  place that decision is made, so the initial draw and every restage agree —
   *  including about damage, which is why both live here rather than one being
   *  handled at a call site. */
  private buildingKey(s: Site): string {
    return buildingFrame(
      s.w,
      this.statusOf(s.path),
      skinVariant(s.path ?? ""),
      this.damagedOf(s.path),
    );
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
