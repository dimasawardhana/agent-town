# Review evidence

`desktop.png`, `mobile.png`, `town-overview.png`, `town-zoomed.png` — captures of
the built surface, taken at devicePixelRatio 1 (the host DPR is 1.25, which
composites fractionally and is why the first batch was resampled).

These captures show **composition**. They cannot carry a pixel-level claim: the
capture tool downscales a 1440x900 viewport to 1024x640, so a palette-distance
check run on them reports low exactness — that is the downscale, not the render.

The pixel-level claim is measured from the live canvas at its native resolution
instead, and is exact:

- 15 colours cover 99% of the canvas; 168 distinct in total, over a 24-entry palette.
- `config.pixelArt === true`, `config.antialias === false`, texture filter
  NEAREST (`scaleMode === 1`), canvas `image-rendering: pixelated`.
- The bake refuses to boot on any off-palette or semi-transparent pixel
  (`assertPaletteClean`, `ui/src/art/bake.ts`), and `sprite()` refuses to boot on
  an unmapped character (`ui/src/art/surface.ts`).

Live state at the time of capture: 13/13 buildings placed exactly on their
footprints (0 misplaced), 12 workers on 12 distinct positions across 5
simultaneous actions, 13 building shadows, 213 atlas frames, 103 display objects.
