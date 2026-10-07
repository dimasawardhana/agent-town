// Mounting three.js inside React, beside the Phaser canvas.
//
// The mirror of `TownCanvas.tsx`, and it exists as its own component for the same
// reason: the scene must be constructed only once the host element is in the DOM,
// and React owns the DOM. An effect runs after the commit, which is the guarantee
// that matters — a `requestAnimationFrame` raced against React's commit loses, and
// a renderer that appends to a missing parent appends to `document.body`.
//
// **The store is read on the frame, not delivered by subscription.** This was
// arrived at by getting it wrong twice, and the measurement is worth recording
// because the reasoning is not obvious from the code.
//
// The first version pushed `day`, `layout` and `live` down through `useTown`
// selectors, so the scene updated only when React chose to re-render this
// component — and it does not re-render on every store field. Measured: clicking a
// day phase moved the control, and the scene's sun stayed where it was until the
// next SSE tick happened to re-render the component.
//
// The second version subscribed with `useTown.subscribe`, the pattern `scene.ts`
// uses. **Measured: it fires for some store changes and not others.** A listener
// registered on the same store object from the page was notified by a direct
// `setState` but not by the day control's own action, while `getState()` reported
// the new value both times. That is left unresolved deliberately rather than
// papered over — it is a reactivity question about the store rather than about
// this renderer, and it is noted on the ticket.
//
// So the scene is synchronised from the frame loop instead. The sync diffs against
// the previous snapshot, so a frame with nothing to do costs a handful of
// reference comparisons — and a renderer that already runs at sixty frames a second
// is the natural clock for "has anything changed", where a notification would be a
// second, competing source of truth about it.

import { useEffect, useRef } from "react";

import { SolidScene } from "./scene";
import { useTown } from "../store";

/**
 * The store's shape, taken from the store rather than by exporting its type.
 *
 * `State` is module-private in `store.ts`, and widening it to `export` for one
 * caller would put the whole shape on the public surface of a module that is
 * otherwise a singleton. This asks the singleton what it holds.
 */
type Snapshot = ReturnType<typeof useTown.getState>;

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

    // Apply the initial snapshot before subscribing so the scene never starts empty.
    sync();
    const unsubscribe = useTown.subscribe(sync);

    // The canvas is sized from the host's box, so a window resize, a panel
    // opening or a stylesheet change has to re-fit the camera. `ResizeObserver`
    // rather than a window listener, because the thing that changes is the
    // element's box and the window may not have moved at all.
    const ro = new ResizeObserver(() => {
      const { layout, turn } = useTown.getState();
      s.resize();
      // The turn is passed here too, because `setLayout` records it — a resize
      // that omitted it would quietly reset the town to upright, and the reader
      // would watch their orientation undo itself when a panel opened.
      if (layout) s.setLayout(layout, turn);
      sync();
    });
    ro.observe(host.current);

    // Store notifications drive synchronization; rendering itself remains in the scene loop.

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
      unsubscribe();
      ro.disconnect();
      delete (window as unknown as { __solid?: SolidScene }).__solid;
      scene.current = null;
      s.dispose();
    };
  }, []);

  return <div id="solid" ref={host} />;
}
