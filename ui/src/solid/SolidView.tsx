// Mounting three.js inside React, beside the Phaser canvas.

import { useEffect, useRef, useState } from "react";

import { SolidScene } from "./scene";
import { useTown } from "../store";

type Label = { id: string; text: string; kind: "worker" | "site"; x: number; y: number; pinned: boolean };
type Snapshot = ReturnType<typeof useTown.getState>;
// Frame-loop synchronization avoids relying on the store's incomplete vanilla notifications.

export function SolidView() {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<SolidScene | null>(null);

  useEffect(() => {
    if (!host.current || scene.current) return;

    const s = new SolidScene(host.current);
    scene.current = s;
    s.start();

    /**
     * What a click landed on, answered by the scene and acted on here.
     *
     * A worker click toggles the follow — the same toggle the flat town's row
     * offers — and a site click selects it and frames it, which is what the
     * flat renderer's site click has always done. The scene reports; the store
     * decides.
     */
    s.onPick = (kind, id): void => {
      const st = useTown.getState();
      if (kind === "worker") {
        if (st.following === id) st.unfollow();
        else st.follow(id);
        return;
      }
      const site = st.layout?.sites.find((candidate) => candidate.path === id);
      if (site) {
        st.select(site);
        st.focus(id);
      }
    };
    s.onHover = (kind, id): void => {
      const st = useTown.getState();
      st.hover(id ? (kind === "worker" ? `worker:${id}` : id) : null);
    };

    /**
     * The store's snapshot as of the last time anything was applied, so a frame
     * with nothing to do costs a few reference comparisons.
     *
     * The daemon streams an event every few seconds, so applying the store
     * wholesale would rebuild every building sixty times a second for work no
     * reader ever sees. Reference comparison is enough: the store replaces its
     * state object on every change, so an unchanged `layout` is the same object.
     */
    let applied: Snapshot | null = null;

    /**
     * The layout the ground was last laid for, so it is laid once.
     *
     * **Declared outside `sync`, and that is not tidiness.** Inside, it was
     * re-created as `null` on every frame, so the "laid once per layout" guard
     * never held at all and the field — the largest meshes in the town, a plane
     * spanning the whole town plus every plate and kerb — was torn down and
     * rebuilt sixty times a second, on a town nothing was happening to.
     */
    let grounded: Snapshot["layout"] | null = null;

    const sync = (): void => {
      const st = useTown.getState();
      const was = applied;
      applied = st;

      // The follow is aimed on the scene, not through React: a worker crossing
      // the town is sixty frames of retargeting, and the frame loop is already
      // the clock for everything the store changed.
      s.setFollowing(st.following);
      // A followed worker the town has stopped reporting — a finished session,
      // a crashed daemon — releases the follow on the frame it disappears, so
      // the reader is never watching an empty patch of ground.
      if (st.following && st.live && !st.live.workers.some((w) => w.id === st.following)) {
        useTown.getState().unfollow();
      }
      if (st.layout) {
        // **A new layout, or a new turn, re-frames the camera.** The turn moves
        // the world rather than the camera, so the fit has to be taken again from
        // the turned extent.
        const refit = was === null || st.layout !== was.layout || st.turn !== was.turn;
        if (refit) s.setLayout(st.layout, st.turn);
        // Laid once per layout *and* per turn, because a turn moves every plate
        // and kerb. The town ahead may have climbed a rank, which the ground does
        // not care about — hence the two conditions rather than one.
        if (refit || grounded !== st.layout) {
          s.setGround(st.layout);
          grounded = st.layout;
        }
        // The detail filter redraws the town and nothing else: it hides buildings,
        // it does not move the ground and it does not change the fit, so re-framing
        // for it would throw away the reader's camera to answer a question about
        // the tree.
        if (refit || st.live !== was.live || st.depth !== was.depth) {
          s.setTown(st.layout, st.live, st.depth);
          s.setWorkers(st.live.workers, st.layout);
        }
      }
      // Separate from the town, because a relight moves nothing — rebuilding the
      // buildings to change the light would throw away every journey in progress.
      if (was === null || st.day !== was.day) s.setDay(st.day);
    };

    sync();

    const ro = new ResizeObserver(() => {
      const { layout, turn } = useTown.getState();
      s.resize();
      if (layout) s.setLayout(layout, turn);
      sync();
    });

    const frame = (): void => {
      if (scene.current !== s) return;
      sync();
      requestAnimationFrame(frame);
    };
    const frameId = requestAnimationFrame(frame);
    ro.observe(host.current);

    // Exposed for verification, the same way `TownCanvas` exposes `__town`: a
    // headless probe can ask the scene how many frames it has drawn, how many
    // meshes it is made of and where its sun is — none of which a screenshot can
    // answer for a light that moves with the hour.
    (window as unknown as { __solid?: SolidScene }).__solid = s;

    // StrictMode mounts, unmounts and remounts in development. Without the
    // teardown the first scene would keep its context, invisible and leaking —
    // and a WebGL context is the one resource here that cannot be reclaimed by
    // dropping a reference.
    return () => {
      cancelAnimationFrame(frameId);
      ro.disconnect();
      delete (window as unknown as { __solid?: SolidScene }).__solid;
      scene.current = null;
      s.dispose();
    };
  }, []);

  const st = useTown();
  const [labels, setLabels] = useState<Label[]>([]);

  useEffect(() => {
    const current = scene.current;
    if (!current) return;
    const makeLabels = (): void => {
      const state = useTown.getState();
      const next: Label[] = [];
      for (const site of state.layout?.sites ?? []) {
        const id = site.path ?? site.id;
        const p = current.labelPosition("site", id);
        if (p && (state.hovered === id || state.focused === id)) next.push({ id, text: site.label, kind: "site", ...p, pinned: state.focused === id });
      }
      for (const worker of state.live.workers) {
        const id = `worker:${worker.id}`;
        const p = current.labelPosition("worker", worker.id);
        if (p && (state.hovered === id || state.focused === id)) next.push({ id, text: `${worker.label} · ${worker.action}`, kind: "worker", ...p, pinned: state.focused === id });
      }
      setLabels(next);
    };
    const timer = window.setInterval(makeLabels, 50);
    makeLabels();
    return () => window.clearInterval(timer);
  }, [st]);

  return <div id="solid" ref={host} style={{ position: "absolute", inset: 0 }} />;
}
