// The three.js side of the solid town, and nowhere a decision lives.
//
// **Every number this file uses comes from `solid/model.ts`, `solid/forms.ts`,
// `solid/machine.ts` or `solid/sun.ts`.** It exists to turn those into three.js
// objects — a camera, a light, a renderer, a frame loop — and to give them all
// back. If a rule appears in this file instead of in the model, that rule has
// escaped the tests, because this file cannot be asserted in `node --test`: it
// needs a WebGL context.
//
// That split is the same one the flat renderer uses between `plan.ts` and
// `scene.ts`, and it is the seam this feature is tested at.

import * as THREE from "three";

import { AXIS, CAMERA_BASIS, CAMERA_UP, followFraming, followScale, framingFor, townReach, worldExtent, type Framing } from "./model";
import { rubbleFor, solidFor, type PartRole, type Rank } from "./forms";
import { GROUND_ROLE, furnitureFor, groundFor, placesOf, surfaceZ, type GroundRole } from "./ground";
import { solidMaterial, litWindowMaterial } from "./material";
import {
  cyclePhase,
  gestureFor,
  pointAlong,
  POSE_FOR,
  stableOffset,
  standPoint,
  walkMs,
  type WorkerState,
} from "./machine";
import { aimBoom, machineGroup } from "./machineArt";
import {
  fillFor,
  fogFor,
  lookKnobs,
  sunFor,
} from "./sun";
import { P } from "../art/palette";
import type { DayPhase } from "../daylight";
import type { Layout, Live, Site, Worker } from "../store";

import { normaliseTurn, turnLayout } from "../view";
import type { Turn } from "../view";
import { visibleAt } from "../visibility";

/** The solid renderer has no postprocessing dependency; emissive windows are the selective channel. */
export const sceneLookPolicy = Object.freeze({
  selectiveBloomSupported: false,
  bloomTarget: "lit-window",
  excludesGlobalBloom: true,
  excludesVignette: true,
  excludesDepthOfField: true,
  excludesAmbientOcclusion: true,
});

/** `#rrggbb` to the number three.js wants. */
const hex = (s: string): number => parseInt(s.replace("#", ""), 16);

/** The colour the canvas is cleared to — the palette's `void`. */
const CLEAR = hex(P.void);

/** Stable, path-derived selection: only a subset of glazing receives emissive material. */
export const litWindowFor = (sitePath: string | undefined): boolean => {
  if (!sitePath) return false;
  let hash = 2166136261;
  for (let i = 0; i < sitePath.length; i += 1) hash = Math.imul(hash ^ sitePath.charCodeAt(i), 16777619);
  return (hash >>> 0) % 3 === 0;
};

export const phaseWindowIntensity = (phase: DayPhase): number => phase === "night" ? 1.5 : phase === "dusk" ? 0.65 : 0;


/**
 * The base colour for each role a part can play.
 *
 * **From the palette, and only from the palette.** The two renderers share `P` and
 * nothing else, which is the single permitted import across the seam (ADR-0023):
 * the flat town's cels and this town's materials are different art, and the colours
 * they are made of are the same colours.
 *
 * The middle step of each ramp, because the light supplies the shading now
 * (ADR-0026 §1) — `P` owns the base tone and the sun owns everything above and
 * below it.
 */
const ROLE_COLOUR: Record<PartRole, number> = {
  ground: hex(P.earth[2]),
  stone: hex(P.stone[1]),
  wall: hex(P.plaster[2]),
  frame: hex(P.wood[2]),
  roof: hex(P.roof[2]),
  glass: hex(P.glass[2]),
  trim: hex(P.stone[3]),
};

/**
 * DAMAGE_COLOUR is the rubble's tone, and it is deliberately **not** a
 * `PartRole`.
 *
 * The palette's darkest earth — the flat renderer's own rubble tone — two steps
 * below the plot it piles on. `PartRole` is the vocabulary of parts a rank
 * earns, and rubble is earned by nothing: putting it in that union would let a
 * future `solidFor` emit damage as a part, which is the one thing ADR-0018
 * forbids. It stays a scene-level constant for the same reason the pile is laid
 * beside the parts rather than among them.
 */
const DAMAGE_COLOUR = hex(P.earth[0]);

/**
 The ground's colours, from the palette ramps `terrain.ts` names for each kind.

 * Restated rather than imported: `art/terrain.ts` is frozen art (ADR-0024) and
 * importing it would make a frozen module load-bearing for the solid path. The
 * *kinds* are pinned by test; these values are pinned the same way.
 *
 * `flags` is `stone[2]` and not `stone[1]`, and that is a correction rather than a
 * taste call: the Depot's kerb rim and lip both come from the stone ramp's darkest
 * step, so a surface on that same step has an edge that draws nothing. The tile
 * renders and the boundary is invisible — the exact failure the flat renderer's edge
 * test exists to catch. One step of separation is the minimum that shows.
 */
const GROUND_ROLE_COLOUR: Record<GroundRole, number> = {
  field: hex(P.grass[2]),
  fieldDark: hex(P.grass[1]),
  yard: hex(P.yardFloorLit),
  earth: hex(P.earth[2]),
  deck: hex(P.wood[1]),
  flags: hex(P.stone[2]),
  road: hex(P.earth[3]),
};

/** One worker's figure, and the journey it is on. */
interface Walker {
  readonly group: THREE.Group;
  readonly pivot: THREE.Object3D;
  /** Where it started this journey, and where it is going. */
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** When the journey began, in the frame loop's own clock. */
  startedAt: number;
  ms: number;
  /** What the daemon says it is doing, for when it is not walking. */
  action: WorkerState;
  /**
   * The height of the ground it stands on, in world units.
   *
   * Carried per walker rather than read at draw time, because a worker changes
   * place over its life: a machine that walked from the Yard to the Depot has to
   * rise onto the Depot's plate on arrival, and a z fixed once at creation would
   * leave it buried in the stone for good.
   */
  ground: number;
}

/**
 * The solid town's canvas, camera and frame loop.
 *
 * Owns one WebGL context for its whole life. `dispose` is **not** optional: a
 * reader toggling renderers would otherwise leave a live context behind on every
 * switch, and a browser stops handing them out after about sixteen — which reads
 * as "the solid town stopped working" with nothing in the console to say why.
 */
export class SolidScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  /** The key and the fill, rebuilt when the hour changes. */
  private sun: THREE.DirectionalLight;
  private fill: THREE.AmbientLight;
  /** Everything built from the layout, so it can be replaced wholesale. */
  private readonly town = new THREE.Group();
  /**
   * The crews, in their own group.
   *
   * **Separate from `town`, and not a detail.** `setTown` clears its group
   * wholesale on every live update, so a worker added to it would be detached from
   * the scene the moment the daemon next spoke — while the `walkers` map still held
   * it, so nothing would add it back. The symptom is a machine that exists,
   * animates and is counted, and cannot be seen. Buildings and crews are rebuilt on
   * different schedules, so they belong in different groups.
   */
  private readonly crew = new THREE.Group();
  /** Workers, keyed by their own id so a rebuild does not restart a walk. */
  private readonly walkers = new Map<string, Walker>();
  private readonly built: THREE.Mesh[] = [];
  /** The ground, in its own group: it is laid once and never rebuilt on an event. */
  private readonly field = new THREE.Group();
  private readonly groundBuilt: THREE.Mesh[] = [];
  private raf = 0;
  private frames = 0;
  private day: DayPhase = "dusk";
  /**
   * Which way round the town is drawn — a quarter turn, 0 to 3.
   *
   * Held here rather than applied as a rotation to the groups, because the turn
   * is **a second derivation of the layout**, not a camera move: `turnLayout`
   * moves the sites and then the pinned projection puts them where they land.
   * Rotating the scene would re-project through the same camera and give a
   * different picture from the flat renderer's at the same turn, which is the
   * disagreement `solid.test.ts` exists to prevent.
   */
  private turn: Turn = 0;
  private disposed = false;
  /**
   * The follow camera's state, mirroring the flat renderer's `followTick`
   * field for field: the scale captured before the follow began, the scale the
   * follow is currently drawing at, the id it is aimed at, and whether
   * `setLayout` has re-framed since the last frame consumed it.
   */
  private followScaleBefore: number | null = null;
  private followScaleActive: number | null = null;
  private followingId: string | null = null;
  private reframed = false;
  /** The viewport in CSS pixels, kept by `resize` for the follow's framing math. */
  private viewport = { width: 0, height: 0 };
  onPick?: (kind: "worker" | "site", id: string) => void;
  onHover?: (kind: "worker" | "site", id: string | null) => void;
  private readonly walkerByObject = new Map<THREE.Object3D, string>();
  private pointerDown: { x: number; y: number } | null = null;
  private hovered: { kind: "worker" | "site"; id: string } | null = null;
  private readonly onPointerDown = (e: PointerEvent): void => {
    this.pointerDown = { x: e.clientX, y: e.clientY };
  };
  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.pointerDown) {
      this.pointerDown = { x: e.clientX, y: e.clientY };
      return;
    }
    this.hoverAt(e.clientX, e.clientY);
  };
  private readonly onPointerLeave = (): void => {
    if (this.hovered) this.onHover?.(this.hovered.kind, null);
    this.hovered = null;
  };
  private readonly onPointerUp = (e: PointerEvent): void => {
    const start = this.pointerDown;
    this.pointerDown = null;
    if (!start) return;
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) >= 5) return;
    this.pickAt(e.clientX, e.clientY);
  };

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setClearColor(CLEAR, 1);
    host.appendChild(this.renderer.domElement);

    this.scene.add(this.town);
    this.scene.add(this.crew);
    this.scene.add(this.field);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100_000, 100_000);
    this.camera.up.set(CAMERA_UP[0], CAMERA_UP[1], CAMERA_UP[2]);
    this.scene.add(this.camera);

    this.sun = new THREE.DirectionalLight(0xffffff, lookKnobs.keyIntensity);
    this.fill = new THREE.AmbientLight(0xffffff, lookKnobs.fillIntensity);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.scene.add(this.fill);
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerleave", this.onPointerLeave);
    // Dusk, because the palette was built for it and it is the store's default.
    this.setDay("dusk");
    // The gate is the scene's own: a click is a press that never travelled,
    // and a drag is everything else — registered here so picking works without
    // the view knowing about pointer coordinates.
    this.canvas.addEventListener("pointerup", this.onPointerUp);
  }

  /** The canvas this scene owns, so a caller can attach its own listeners. */
  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** How many frames have been drawn, so a probe can tell the loop is running. */
  get frameCount(): number {
    return this.frames;
  }

  labelPosition(kind: "worker" | "site", id: string): { x: number; y: number } | null {
    const object = kind === "worker"
      ? this.walkers.get(id)?.group
      : this.built.find((mesh) => mesh.userData.siteId === id);
    if (!object) return null;
    const point = object.getWorldPosition(new THREE.Vector3());
    if (kind === "site") point.z += 20;
    point.project(this.camera);
    return { x: (point.x + 1) * this.viewport.width / 2, y: (1 - point.y) * this.viewport.height / 2 };
  }

  /** How many meshes the town is currently made of, for a verification probe. */
  get meshCount(): number {
    return this.built.length;
  }

  /** How many workers are on screen, for a verification probe. */
  get workerCount(): number {
    return this.walkers.size;
  }

  /** The key light's current direction, so a probe can watch it move with the hour. */
  get sunDirection(): readonly number[] {
    return [this.sun.position.x, this.sun.position.y, this.sun.position.z];
  }

  /**
   * setDay relights the town.
   *
   * **The direction is a world direction and not a camera one**, which is
   * ADR-0026 §3: a turn orbits the reader and leaves the sun where it was, so a
   * turned town is lit from the same quarter as before it turned. The direction is
   * placed from the town each time rather than the light being moved relative to
   * the camera — the two are easy to confuse and only one of them is the decision.
   */
  setDay(phase: DayPhase): void {
    this.day = phase;
    const sun = sunFor(phase);
    const fill = fillFor(phase);
    const fog = fogFor(phase);
    this.sun.color.set(hex(sun.colour));
    this.sun.intensity = sun.intensity;
    this.fill.color.set(hex(fill.colour));
    this.fill.intensity = fill.intensity;
    this.scene.fog = new THREE.Fog(hex(fog.colour), fog.near, fog.far);
    this.renderer.setClearColor(hex(fog.colour), 1);
    this.placeSun();
    for (const mesh of this.built) {
      if (!mesh.userData.litWindow) continue;
      (mesh.material as THREE.MeshLambertMaterial).emissiveIntensity = phaseWindowIntensity(phase);
    }
  }

  /** placeSun aims the key at the town, along the hour's own direction. */
  private placeSun(): void {
    const { toSun } = sunFor(this.day);
    const t = this.town.position;
    this.sun.position.set(t.x + toSun[0] * 1000, t.y + toSun[1] * 1000, toSun[2] * 1000);
    this.sun.target.position.set(t.x, t.y, 0);
  }

  /**
   * setLayout frames the camera on the town.
   *
   * Called when the layout changes rather than per frame: the layout is the
   * daemon's and does not move, so a fit that ran every frame would recompute a
   * constant.
   */
  setLayout(layout: Layout, turn: number = 0): void {
    // **The turn is applied to the layout, not to the camera.** A turned town is
    // the same town seen from another quarter, and the flat renderer draws it by
    // moving the world (`turnLayout`) and then projecting — so a solid town that
    // rotated its camera instead would put every building somewhere the flat town
    // does not, at the very turn a reader is comparing the two renderers by.
    const turned = turnLayout(turn, layout);
    const extent = worldExtent(turned);
    const { width, height } = this.resize();
    // The tallest building's reach, so the fit clears the town's roof and not only
    // its footprint — a ground-only fit crops a 20-storey tower off the top of the
    // frame, which is how the largest project in this town came to draw nothing.
    const f = framingFor(extent, width, height, 1, townReach(turned));
    this.camera.position.set(f.position[0], f.position[1], f.position[2]);
    this.camera.up.set(f.up[0], f.up[1], f.up[2]);
    this.camera.lookAt(f.target[0], f.target[1], f.target[2]);
    this.camera.left = -f.halfWidth;
    this.camera.right = f.halfWidth;
    // **The handedness of the picture, and it comes from the model rather than
    // from here.** `f.halfTop` is negative and `f.halfBottom` positive, which
    // flips the frustum's vertical axis so that world `+z` moves a point *up* the
    // screen. With the conventional positive `top` the whole town is drawn
    // mirrored: buildings grow downward, world `+y` moves up the screen instead of
    // down, and a quarter turn flips left for right while leaving up as up — which
    // is what a reader sees as the town being upside down. See `Framing.halfTop`
    // for the derivation; the value is asserted in `solid.test.ts` so this
    // decision cannot live in a module that has no tests.
    this.camera.top = f.halfTop;
    this.camera.bottom = f.halfBottom;
    this.camera.near = -100_000;
    this.camera.far = 100_000;
    this.camera.updateProjectionMatrix();
    this.placeSun();
    this.turn = normaliseTurn(turn);
    // A re-fit would otherwise paint over the follow's zoom for a frame: the
    // flag makes the next tick re-apply it, which is the flat follow's own
    // re-frame dance.
    this.reframed = true;
  }

  /**
   * setTown rebuilds every building at the rank the daemon reports.
   *
   * **Wholesale rather than incrementally.** A building's geometry changes shape
   * as it climbs — a storey appears, a cap arrives — so a diff would have to
   * compare part lists anyway, and a town is tens of buildings rather than
   * thousands. The geometry is a pure function of (site, rank) and nothing here
   * caches, which is what makes rebuilding affordable on every event.
   *
   * Places are not drawn: the Yard, Workshop and Depot are TASK-109.
   */
  setTown(layout: Layout, live: Live, depth = Number.POSITIVE_INFINITY): void {
    for (const mesh of this.built) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.built.length = 0;
    this.town.clear();

    const rankByPath = new Map<string, Rank>();
    const damagedByPath = new Map<string, boolean>();
    for (const b of live.buildings) {
      rankByPath.set(b.path, b.status);
      damagedByPath.set(b.path, b.damaged);
    }

    // **Turned, then filtered.** Both are the same two steps the flat renderer
    // takes, and in the same order: the depth filter is a statement about the
    // repository's tree and is turn-free, while the turn moves geometry. Applying
    // the filter to the turned layout would be applying it to the same numbers
    // either way, but reading it from the source layout keeps the one thing the
    // filter means — depth below the repo root — visible at the call site.
    // The ground is turned with the town, or a turned town would stand on an
    // unturned field — every place plate and kerb in the wrong quarter.
    const turned = turnLayout(this.turn, layout);
    for (const site of turned.sites) {
      if (site.kind !== "building" && site.kind !== "container") continue;
      // The same rule the flat renderer draws by, taken from the same module
      // rather than restated: a building while `depth <= filter`, a container
      // only until the buildings it stands for appear beside it.
      if (!visibleAt(site, depth)) continue;
      // The daemon's rank, or PLANNED when it has not mentioned this building —
      // an unmentioned building is one nothing has happened to, and drawing it
      // further along would claim work that did not land.
      const rank: Rank = (site.path && rankByPath.get(site.path)) || "planned";
      for (const part of solidFor(site, rank)) {
        const geometry = new THREE.BufferGeometry();
        const positions = part.geometry.positions;
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions.slice(), 3));
        const colour = ROLE_COLOUR[part.role];
        const colors: number[] = [];
        const red = ((colour >> 16) & 0xff) / 255;
        const green = ((colour >> 8) & 0xff) / 255;
        const blue = (colour & 0xff) / 255;
        for (const shade of part.shade ?? Array<number>(positions.length / 3).fill(1)) colors.push(red * shade, green * shade, blue * shade);
        geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        const isLitWindow = part.name === "glazing" && litWindowFor(site.path);
        const material = isLitWindow
          ? litWindowMaterial(colour, phaseWindowIntensity(this.day))
          : solidMaterial(colour, true);
        const mesh = new THREE.Mesh(geometry, material);
        if (isLitWindow) mesh.userData.litWindow = true;
        if (site.path) mesh.userData.siteId = site.path;
        this.built.push(mesh);
        this.town.add(mesh);
      }
      // Rubble is a condition, so it rides **beside** the parts, never among
      // them: `solidFor` still returned exactly the rank's prefix above, and the
      // pile is added — never swapped, never merged into a part — which is what
      // keeps "damage is not a rank" true in the drawn town and not only in the
      // model. `rubbleFor` itself withholds the pile from a staked plot, so the
      // guard here is only about not building empty geometry.
      if (site.path && damagedByPath.get(site.path)) {
        const pile = rubbleFor(site, rank);
        if (pile.positions.length > 0) {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.Float32BufferAttribute(pile.positions.slice(), 3));
          geometry.computeVertexNormals();
          geometry.computeBoundingSphere();
          const rubble = new THREE.Mesh(geometry, solidMaterial(DAMAGE_COLOUR));
          if (site.path) rubble.userData.siteId = site.path;
          this.built.push(rubble);
          this.town.add(rubble);
        }
      }
    }
    this.placeSun();
  }

  /**
   * setGround lays the field, the districts, the three places and their kerbs.
   *
   * **Separate from `setTown`, and separate for a reason.** Buildings are rebuilt
   * on every event; the ground is not, because it does not move when a building
   * climbs a rank. Rebuilding the field on every event would redraw the largest
   * meshes in the town at the highest rate.
   */
  setGround(layout: Layout): void {
    for (const mesh of this.groundBuilt) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.groundBuilt.length = 0;
    this.field.clear();

    const laid = turnLayout(this.turn, layout);
    const { patches, kerbs } = groundFor(laid);
    for (const patch of patches) this.field.add(this.meshFor(GROUND_ROLE_COLOUR[GROUND_ROLE[patch.kind]], patch.geometry.positions));
    for (const kerb of kerbs) this.field.add(this.meshFor(GROUND_ROLE_COLOUR[kerb.role], kerb.geometry.positions));
    for (const place of placesOf(laid)) {
      for (const prop of furnitureFor(place)) {
        this.field.add(this.meshFor(GROUND_ROLE_COLOUR[prop.role], prop.geometry.positions));
      }
    }
    this.placeSun();
  }

  /** How many meshes the ground is made of, for a verification probe. */
  get groundMeshCount(): number {
    return this.groundBuilt.length;
  }

  /**
   * meshFor turns a triangle soup and a colour into one flat-shaded mesh.
   *
   * Shared by the town and the ground so the two cannot drift on how a colour
   * becomes a material — and so both dispose the same way, which is the leak
   * TASK-102 measured.
   */
  private meshFor(colour: number, positions: readonly number[]): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions.slice(), 3));
    // Vertices are unshared, so the computed normals are per face: one tone per
    // face, which is what the palette's ramps were built for.
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, solidMaterial(colour));
    this.groundBuilt.push(mesh);
    return mesh;
  }

  /**
   * setWorkers reconciles the figures with the daemon's crews.
   *
   * **A worker already walking keeps its journey.** Rebuilding a machine on every
   * live update would restart its walk each time the daemon spoke — and the daemon
   * speaks every few seconds while a walk takes under one — so a worker would
   * stutter forward and never arrive, which is worse than not animating at all.
   * A figure starts a new journey only when its destination actually changes.
   *
   * A crew the daemon no longer reports is removed: a crew that left has left, and
   * leaving its machines behind would misrepresent the town.
   */
  setWorkers(workers: readonly Worker[], layout: Layout): void {
    // A crew stands on the town the reader is looking at, so its places are read
    // from the turned layout — otherwise a turned town's machines all walk to
    // where the places used to be.
    const byId = new Map(turnLayout(this.turn, layout).sites.map((s) => [s.id, s]));
    const seen = new Set<string>();

    for (const w of workers) {
      seen.add(w.id);
      const site: Site | undefined = byId.get(w.place);
      // A worker whose place is not in this layout has nowhere to stand. Skipping
      // it is honest: the alternative is inventing a position, and a figure at a
      // coordinate the town did not give it is a confident lie.
      if (!site) continue;

      const to = standPoint(site, stableOffset(w.id));
      const ground = surfaceZ(site);
      const existing = this.walkers.get(w.id);

      if (existing) {
        existing.action = w.action;
        // Only a *changed* destination starts a journey. Compared by value, so a
        // rebuild that produces the same point does not count as a move.
        if (Math.abs(existing.to.x - to.x) > 1e-6 || Math.abs(existing.to.y - to.y) > 1e-6) {
          existing.from = this.currentPoint(existing);
          existing.to = to;
          existing.startedAt = this.now();
          existing.ms = walkMs(existing.from, existing.to);
        }
        // Re-read on every update, not only when the destination moves: a worker
        // can stay in one place while the ground under it is re-laid.
        existing.ground = ground;
        continue;
      }

      const { group, pivot } = machineGroup(w.tier);
      // A new figure appears **already at its place** rather than walking in from
      // the origin. A machine strolling out of the corner on first sight would be
      // the town animating a journey nobody took.
      group.position.set(to.x, to.y, ground);
      this.walkerByObject.set(group, w.id);
      this.crew.add(group);
      this.walkers.set(w.id, {
        group,
        pivot,
        from: to,
        to,
        startedAt: this.now(),
        ms: 1,
        action: w.action,
        ground,
      });
    }

    for (const [id, walker] of this.walkers) {
      if (seen.has(id)) continue;
      this.crew.remove(walker.group);
      walker.group.traverse((o) => {
        const mesh = o as Partial<THREE.Mesh>;
        mesh.geometry?.dispose();
        const material = mesh.material;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      });
      this.walkers.delete(id);
      this.walkerByObject.delete(walker.group);
    }
  }

  /** Where a walker is right now, for starting its next journey from. */
  private currentPoint(walker: Walker): { x: number; y: number } {
    const t = walker.ms <= 0 ? 1 : (this.now() - walker.startedAt) / walker.ms;
    return pointAlong(walker.from, walker.to, t);
  }

  /**
   * now is the loop's own clock.
   *
   * `performance.now` rather than `Date.now`: it is monotonic, so a system clock
   * adjustment mid-session cannot make every journey finish at once — and it is
   * read here rather than in the model, so the model stays a pure function of the
   * elapsed time it is handed.
   */
  private now(): number {
    return performance.now();
  }

  /**
   * advance moves every worker and aims its gesture.
   *
   * Called once per frame. **The state decides the rhythm and the pose decides the
   * motion**, which is the split that lets one `work` gesture serve hammering and
   * testing at their own speeds — `cyclePhase` walks the state's cadence and
   * `gestureFor` shapes the swing, so a test run and a demolition are the same
   * pose at different tempos rather than two gestures that have to be kept in step.
   */
  private advance(): void {
    const t = this.now();
    for (const walker of this.walkers.values()) {
      const along = walker.ms <= 0 ? 1 : (t - walker.startedAt) / walker.ms;
      const at = pointAlong(walker.from, walker.to, along);
      // The one line that makes a worker walk: the group is moved along the
      // journey, and `pointAlong` clamps, so an arrived worker stays put rather
      // than walking through its building.
      walker.group.position.set(at.x, at.y, walker.ground);

      // **Walking overrides the action.** It is a fact about the figure rather
      // than about the work: a worker fetching a file is still doing its action,
      // and the renderer must not show it hammering on the way. This is the same
      // override the flat renderer makes to reach `walk`.
      const travelling = along < 1;
      const state: WorkerState = travelling ? "walk" : walker.action;
      // The cycle is anchored to **the journey's start**, so a walk's stride begins
      // when the walk does. A phase measured from an arbitrary epoch would start
      // mid-stride, which on a strike reads as a machine that was already moving
      // before the reader looked.
      const phase = cyclePhase(state, t - walker.startedAt);
      aimBoom(walker.pivot, gestureFor(POSE_FOR[state], phase));
    }
  }

  /**
   * setFollowing points the camera at one worker, or releases it with `null`.
   *
   * Releasing restores the scale the reader had before the follow captured it —
   * their zoom outlives the follow — but leaves the camera where the last frame
   * put it, because a camera that teleports home on release is a jump cut the
   * reader did not choose. The scale restore is the only thing that changes on
   * release.
   */
  setFollowing(id: string | null): void {
    if (id === null) {
      this.followingId = null;
      if (this.followScaleBefore !== null) {
        this.applyFollowScale(this.followScaleBefore);
      }
      this.followScaleBefore = null;
      this.followScaleActive = null;
      return;
    }
    this.followingId = id;
    this.reframed = false;
  }

  /** The camera's current screen pixels per picture unit, from its own frustum. */
  private effectiveScale(): number {
    return (this.viewport.height * AXIS.y) / this.camera.bottom;
  }

  /** Rewrites the frustum to a scale about the camera's current target. */
  private applyFollowScale(scale: number): void {
    const f = followFraming(this.cameraTarget(), this.viewport.width, this.viewport.height, scale);
    this.applyFraming(f);
  }

  private cameraTarget(): [number, number, number] {
    const p = this.camera.position;
    const z = CAMERA_BASIS.z;
    return [p.x - z[0] * 1000, p.y - z[1] * 1000, p.z - z[2] * 1000];
  }

  /** Writes a framing onto the camera, the same write `setLayout` makes. */
  private applyFraming(f: Framing): void {
    this.camera.position.set(f.position[0], f.position[1], f.position[2]);
    this.camera.up.set(f.up[0], f.up[1], f.up[2]);
    this.camera.lookAt(f.target[0], f.target[1], f.target[2]);
    this.camera.left = -f.halfWidth;
    this.camera.right = f.halfWidth;
    this.camera.top = f.halfTop;
    this.camera.bottom = f.halfBottom;
    this.camera.near = -100_000;
    this.camera.far = 100_000;
    this.camera.updateProjectionMatrix();
  }

  /**
   * followTick aims the camera at its walker, after `advance` has moved them.
   *
   * The scale captured **before** is read off the camera's own frustum on the
   * first follow frame, not from the fit — a reader who zoomed before following
   * deserves their zoom back, and only the frustum knows what they had.
   */
  private followTick(): void {
    const id = this.followingId;
    if (!id) return;
    const walker = this.walkers.get(id);
    if (!walker) return;
    if (this.followScaleBefore === null) {
      this.followScaleBefore = this.effectiveScale();
    }
    this.followScaleActive = followScale(this.effectiveScale());
    const at = walker.group.position;
    this.applyFraming(followFraming([at.x, at.y, at.z], this.viewport.width, this.viewport.height, this.followScaleActive));
    this.reframed = false;
  }

  private hoverAt(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1), this.camera);
    const hit = ray.intersectObjects([this.town, this.crew], true)[0];
    let found: { kind: "worker" | "site"; id: string } | null = null;
    if (hit) {
      let o: THREE.Object3D | null = hit.object;
      while (o) {
        const workerId = this.walkerByObject.get(o);
        if (workerId) { found = { kind: "worker", id: workerId }; break; }
        if ("siteId" in o.userData) { found = { kind: "site", id: o.userData.siteId }; break; }
        o = o.parent === this.crew || o.parent === this.town ? null : o.parent;
      }
    }
    if (found?.kind === this.hovered?.kind && found?.id === this.hovered?.id) return;
    if (this.hovered) this.onHover?.(this.hovered.kind, null);
    this.hovered = found;
    if (found) this.onHover?.(found.kind, found.id);
  }

  private pickAt(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const hits = ray.intersectObjects([this.town, this.crew, this.field], true);
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object;
      while (o) {
        const workerId = this.walkerByObject.get(o);
        if (workerId) { this.onPick?.("worker", workerId); return; }
        if ("siteId" in o.userData) { this.onPick?.("site", o.userData.siteId); return; }
        o = o.parent === this.crew || o.parent === this.town || o.parent === this.field ? null : o.parent;
      }
      return;
    }
  }

  resize(): { width: number; height: number } {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.viewport = { width, height };
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(width, height, false);
    return { width, height };
  }

  /**
   * start begins the frame loop.
   *
   * Its own loop, not the flat renderer's: the two renderers never run at the same
   * time, and sharing one would mean the flat town's `update` had to know about a
   * scene it is not allowed to import (ADR-0024).
   */
  start(): void {
    const tick = (): void => {
      if (this.disposed) return;
      this.advance();
      this.followTick();
      this.renderer.render(this.scene, this.camera);
      this.frames += 1;
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** stop halts the loop without releasing the context. */
  stop(): void {
    if (this.raf !== 0) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /**
   * dispose gives the context back, and gives the GPU's buffers back with it.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();

    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);

    this.scene.traverse((o) => {
      const mesh = o as Partial<THREE.Mesh>;
      mesh.geometry?.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
    this.built.length = 0;
    this.walkers.clear();
    this.town.clear();
    this.crew.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
