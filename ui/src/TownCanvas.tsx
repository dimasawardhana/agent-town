// Mounting Phaser inside React.
//
// The game must be constructed only after #town is in the DOM, and React owns
// the DOM. Racing a requestAnimationFrame against React's commit loses that
// race — Phaser silently falls back to document.body when its parent is
// missing, so the canvas ends up outside the layout. An effect runs after the
// commit, which is the guarantee we actually need.

import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { TownScene } from "./scene";

export function TownCanvas() {
  const host = useRef<HTMLDivElement>(null);
  const game = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (!host.current || game.current) return;

    // Phaser CANVAS is required by the overlay decision (ADR-0002): WebGL and
    // a DOM overlay contend for the same pixels.
    game.current = new Phaser.Game({
      type: Phaser.CANVAS,
      parent: host.current,
      backgroundColor: "#11161d",
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.NO_CENTER,
        width: "100%",
        height: "100%",
      },
      scene: [TownScene],
    });

    // StrictMode mounts, unmounts and remounts in development. Without this
    // the first game would keep running, invisible and leaking.
    return () => {
      game.current?.destroy(true);
      game.current = null;
    };
  }, []);

  return <div id="town" ref={host} />;
}
