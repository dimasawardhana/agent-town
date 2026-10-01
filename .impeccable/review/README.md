# Review evidence

`desktop.png`, `mobile.png`, `town-overview.png`, `town-zoomed.png` — captures of
the built surface, taken at devicePixelRatio 1 (the host DPR is 1.25, which
composites fractionally and is why the first batch was resampled).

These captures show **composition**. They cannot carry a pixel-level claim: the
capture tool downscales a 1440x900 viewport to 1024x640, so a palette-distance
check run on them reports low exactness — that is the downscale, not the render.

The pixel-level claim is measured from the live canvas at its native resolution
instead, and is exact:

- `config.pixelArt === true`, `config.antialias === false`, texture filter
  NEAREST (`scaleMode === 1`), canvas `image-rendering: pixelated`.
- The bake refuses to boot on any off-palette or semi-transparent pixel
  (`assertPaletteClean`, `ui/src/art/bake.ts`), and `sprite()` refuses to boot on
  an unmapped character (`ui/src/art/surface.ts`).

Live state at the time of capture: 14 buildings placed on their footprints, 5
of them carrying the import mark, 149 display objects, 1125 atlas frames.

**On the palette count, the figure this file used to carry no longer
reproduces.** It read *"15 colours cover 99% of the canvas; 168 distinct in
total"*. Measured the same way today — every opaque pixel of the live canvas
counted by value — it is **299 colours covering 99% and 677 distinct**. The
renderer settings above are unchanged and verified; the count moved because the
sky backdrop is a generated gradient and contributes a colour per pixel step, and
because this town has more archetypes and conditions on screen than the one the
old figure was taken from. The bake's own invariant is the one that matters and
it has not moved: **no off-palette and no semi-transparent pixel in any baked
cel**, enforced at boot.
