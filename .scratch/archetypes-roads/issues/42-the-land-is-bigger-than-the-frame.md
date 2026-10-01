# 42 — The land is bigger than the frame

**What to build:** Grow the field so it reaches past the edges of the picture
instead of ending inside it.

**Status:** done

- [x] `LAND_APRON` — 900 world units of field forward of the town, and
      `LAND_BACK` three tiles behind it
- [x] `landBox` takes a separate back margin, because the field reaches forward
- [x] `contentExtents` — the camera frames the town, not the field
- [x] Four tests and a mutation

## What was wrong

Measured before any of it: land 935×817 picture px on an 884×860 viewport, 83.6%
of the frame green. The **bounding box** nearly covered the frame and it still
read as a diorama, because an isometric rectangle projects to a **diamond** and
the frame's corner at (442, 430) is nowhere near inside a diamond that size.

The axis that was actually wrong is the **height**: with three tiles of pad the
land was 468px tall on an 860px frame, so its far corner sat inside the picture
and there was sky underneath it.

## Why an apron and not a bigger layout

The layout describes *content*. How much field a reader sees beyond it is a
question about the picture, and growing `l.width` would make the analyzer place
districts further apart for no reason — and would still leave the corners open,
because the corners are a projection artefact and not a size.

## Forward, not symmetric

`landBox` gained a `backPad`. The apron reaches forward and the back margin is
three tiles, and the ratio is the whole picture: the land's near corner is the
only point above which there is sky, and it rises with the margin. A symmetric
apron raises it by `apron / 2` instead and pushes the sky clean off the top.

The first version of `scene.ts`'s comment claimed the back margin does *not* move
the near corner. `test:land` is what found that, and the comment is now correct.

## Two reframings, both worse, both reverted

The land grew and two framings were tried against it — centring the land's near
corner on the frame's centre line, and pushing it down by a sky share. Both put
the town in a corner with a field beside it. The composition of an isometric land
is decided by where its near corner falls, and the town has to stay near the
middle to read as a town. **`fit` centres the content and did not change**; the
thing that made the picture better was the field being large.

What did not change: the land's upper-right edge is still inside the frame, so
there is a wedge of sky on that side. Covering it would need the near corner
above the frame, which is a picture with no sky in it.

## Worth recording

**My land/sky pixel probe was wrong for most of this.** It classified a pixel as
land when `green > red`, and the dusk sky is a bluish grey where that is *also*
true — so every "86% land, all four corners are land" number I measured during
this was measuring the sky. The screenshots and the arithmetic in the tests were
right; the probe was not. It is the fourth time in this project that a convenient
proxy has been more confident than the picture, and the cheapest way to have found
it would have been to look at the render *first* and write the probe against it.