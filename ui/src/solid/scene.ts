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

import { CAMERA_BASIS, CAMERA_UP, framingFor, worldExtent } from "./model";
import { solidFor, type PartRole, type Rank } from "./forms";
import { GROUND_ROLE, furnitureFor, groundFor, placesOf, type GroundRole } from "./ground";
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
import { fillFor, sunFor } from "./sun";
import { P } from "../art/palette";
import type { DayPhase } from "../daylight";
import type { Layout, Live, Site, Worker } from "../store";

/** The colour the canvas is cleared to — the palette's `void`. */
const CLEAR = 0x0e141c;

/** `#rrggbb` to the number three.js wants. */
const hex = (s: string): number => parseInt(s.replace("#", ""), 16);

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
  private disposed = false;

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

    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.fill = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.scene.add(this.fill);
    // Dusk, because the palette was built for it and it is the store's default.
    this.setDay("dusk");
  }

  /** The canvas this scene owns, so a caller can attach its own listeners. */
  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** How many frames have been drawn, so a probe can tell the loop is running. */
  get frameCount(): number {
    return this.frames;
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
    this.sun.color.set(hex(sun.colour));
    this.sun.intensity = sun.intensity;
    this.fill.color.set(hex(fill.colour));
    this.fill.intensity = fill.intensity;
    this.placeSun();
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
  setLayout(layout: Layout): void {
    const extent = worldExtent(layout);
    const { width, height } = this.resize();
    const f = framingFor(extent, width, height);

    this.camera.position.set(f.position[0], f.position[1], f.position[2]);
    this.camera.up.set(f.up[0], f.up[1], f.up[2]);
    this.camera.lookAt(f.target[0], f.target[1], f.target[2]);
    this.camera.left = -f.halfWidth;
    this.camera.right = f.halfWidth;
    this.camera.top = f.halfHeight;
    this.camera.bottom = -f.halfHeight;
    this.camera.near = -100_000;
    this.camera.far = 100_000;
    this.camera.updateProjectionMatrix();
    this.placeSun();
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
  setTown(layout: Layout, live: Live): void {
    for (const mesh of this.built) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.built.length = 0;
    this.town.clear();

    const rankByPath = new Map<string, Rank>();
    for (const b of live.buildings) rankByPath.set(b.path, b.status);

    for (const site of layout.sites) {
      if (site.kind !== "building" && site.kind !== "container") continue;
      // The daemon's rank, or PLANNED when it has not mentioned this building —
      // an unmentioned building is one nothing has happened to, and drawing it
      // further along would claim work that did not land.
      const rank: Rank = (site.path && rankByPath.get(site.path)) || "planned";
      for (const part of solidFor(site, rank)) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(part.geometry.positions.slice(), 3));
        // Vertices are unshared, so these normals are per face: one tone per face,
        // which is what the palette's ramps were built for.
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: ROLE_COLOUR[part.role] }));
        this.built.push(mesh);
        this.town.add(mesh);
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

    const { patches, kerbs } = groundFor(layout);
    for (const patch of patches) this.field.add(this.meshFor(GROUND_ROLE_COLOUR[GROUND_ROLE[patch.kind]], patch.geometry.positions));
    for (const kerb of kerbs) this.field.add(this.meshFor(GROUND_ROLE_COLOUR[kerb.role], kerb.geometry.positions));
    for (const place of placesOf(layout)) {
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
    const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color: colour }));
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
    const byId = new Map(layout.sites.map((s) => [s.id, s]));
    const seen = new Set<string>();

    for (const w of workers) {
      seen.add(w.id);
      const site: Site | undefined = byId.get(w.place);
      // A worker whose place is not in this layout has nowhere to stand. Skipping
      // it is honest: the alternative is inventing a position, and a figure at a
      // coordinate the town did not give it is a confident lie.
      if (!site) continue;

      const to = standPoint(site, stableOffset(w.id));
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
        continue;
      }

      const { group, pivot } = machineGroup(w.tier);
      // A new figure appears **already at its place** rather than walking in from
      // the origin. A machine strolling out of the corner on first sight would be
      // the town animating a journey nobody took.
      group.position.set(to.x, to.y, 0);
      this.crew.add(group);
      this.walkers.set(w.id, {
        group,
        pivot,
        from: to,
        to,
        startedAt: this.now(),
        ms: 1,
        action: w.action,
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
      walker.group.position.set(at.x, at.y, 0);

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

  /** resize matches the drawing buffer to the host's box. */
  resize(): { width: number; height: number } {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
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
    if (this.raf !== 0 || this.disposed) return;
    const tick = (): void => {
      if (this.disposed) return;
      this.advance();
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
   *
   * `renderer.dispose()` alone frees the context but not the geometry and material
   * buffers, so a reader switching renderers repeatedly would grow the driver's
   * allocations until the tab died. `forceContextLoss` is the part that actually
   * returns the context; without it the canvas keeps it until the browser
   * garbage-collects, which is long after the limit is hit.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();

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
