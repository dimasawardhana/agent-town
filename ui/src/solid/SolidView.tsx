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
     * The store's snapshot as of the last time anything was applied, so a frame
     * with nothing to do costs a few reference comparisons.
     *
     * The daemon streams an event every few seconds, so applying the store
     * wholesale would rebuild every building sixty times a second for work no
     * reader ever sees. Reference comparison is enough: the store replaces its
     * state object on every change, so an unchanged `layout` is the same object.
     */
    let applied: Snapshot | null = null;

    const sync = (): void => {
      const st = useTown.getState();
      const was = applied;
      applied = st;

      /** The layout the ground was last laid for, so it is laid once. */
      let grounded: Snapshot["layout"] | null = null;

      if (st.layout) {
        // A new layout re-frames the camera, which is the one thing that must not
        // be skipped: the town may have grown.
        if (was === null || st.layout !== was.layout) s.setLayout(st.layout);
        // **Laid once per layout, not on every live update.** The ground does not
        // move when a building climbs a rank, and rebuilding the field at the
        // event rate would redraw the largest meshes in the town at the highest
        // rate.
        if (grounded !== st.layout) {
          s.setGround(st.layout);
          grounded = st.layout;
        }
        if (was === null || st.layout !== was.layout || st.live !== was.live) {
          s.setTown(st.layout, st.live);
          s.setWorkers(st.live.workers, st.layout);
        }
      }
      // Separate from the town, because a relight moves nothing — rebuilding the
      // buildings to change the light would throw away every journey in progress.
      if (was === null || st.day !== was.day) s.setDay(st.day);
    };

    // Applied before the first frame rather than waiting for one, so a reader who
    // switches renderers on a loaded town does not see an empty frame first.
    sync();

    // The canvas is sized from the host's box, so a window resize, a panel
    // opening or a stylesheet change has to re-fit the camera. `ResizeObserver`
    // rather than a window listener, because the thing that changes is the
    // element's box and the window may not have moved at all.
    const ro = new ResizeObserver(() => {
      const l = useTown.getState().layout;
      s.resize();
      if (l) s.setLayout(l);
      // Forces the next frame to re-apply against the new viewport.
      applied = null;
    });
    ro.observe(host.current);

    let raf = 0;
    const tick = (): void => {
      sync();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

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
      cancelAnimationFrame(raf);
      ro.disconnect();
      delete (window as unknown as { __solid?: SolidScene }).__solid;
      scene.current = null;
      s.dispose();
    };
  }, []);

  return <div id="solid" ref={host} />;
}
