# 41 — Cloud in the sky, and birds at dusk

**What to build:** A cloud field in the generated backdrop, and a small flock that
crosses the sky.

**Status:** done

- [x] `paintClouds` — a cloud is a cluster of radial gradients, deterministic and
      per phase
- [x] `clouds` is a per-phase field: a palette key at day and dusk, `null` at night
- [x] `birds.ts` — a generated seven-pixel silhouette and a drifting flock
- [x] `birds` is a per-phase **count**, and the layer refuses to draw more
- [x] A depth just in front of the sky, so a bird is never on a roof
- [x] 4 cloud tests, 8 bird tests, 2 mutations

## The one decision that was not mine to make quietly

**A bird is the first thing in this town that moves and says nothing about the
code.** The liveliness spec opens with "Not animation. A figure moving because it
looks nice is decoration wearing a claim's clothes, and this town does not do
that." A bird is the purest decoration available — no verb, no repository in it,
nothing a reader can act on.

So it was given the narrowest claim the town can actually support, which is
**the hour**. Birds come out at dusk and roost by dark: `DAYLIGHT.birds` is 6 at
dusk and 0 at both day and night, and `Birds.reconcile` reads that same field the
cloud and the lamp are read from — one table, one claim, no way for a second one
to disagree. The count is in the phase table rather than in `birds.ts` precisely
so that it cannot be overridden.

**What a bird may never mean is "something is working here."** That belongs to the
machine, and it is the only mover in the town with that meaning. A flock over a
busy district would say "something is happening there" and quietly take a job
that belongs to a signal a reader can act on.

Night is zero for the same reason the night sky has no cloud: you cannot see
either one, and drawing them would be the sky asserting something it knows to be
false.

## Cloud

Drawn into the backdrop rather than baked, so the atlas pays nothing — the same
reason the ember and the smoke are generated. `BackdropContext` declares exactly
two primitives, a fill and a gradient, so a cloud is a **cluster of radial
gradients** rather than a shape: widening that surface would mean a backdrop
growing an unmodelled primitive, which is how a test stops being able to see the
picture.

`CLOUD_COUNT` is 7 and the count is pinned by a test, because every loop over it
is vacuous at zero — which is the mechanism by which a cloud silently stops
existing. Two mutations cover both halves.

## Two things this nearly got wrong

**Clouds that were on the canvas and invisible.** The first alpha was a sixth of
what it is now. The vignette is drawn *over* all of this and takes up to 82% at
the corners, and every cloud is in the top third, so each one lost a third of its
contrast before a reader saw it. Drawn-but-unseen costs more than not drawn and
says nothing.

**A cloud test that could not fail.** The first version rendered a day sky and a
night sky and required them to differ — which they do, because their *ground
colours* differ, so it passed with `CLOUD_COUNT = 0`. It is replaced by a
measurement: inside the band the clouds are placed in, is there light genuinely
brighter than the sky behind it? Zeroing the count now fails three tests.

The unclamped fill rects are the third: a real canvas clips silently, so they
worked, and the sky's test harness — which writes into a flat array and does not
clip — is what caught it. Depending on the caller to clip is how a backdrop ends
up drawing outside the frame on a surface that does not.

## Amendment — the sky became pixel art too

The clouds shipped into a smooth gradient sky, which is the one part of this town
that was never pixel art, and it read as blur rather than as atmosphere.

Measured before changing anything: the sky texture was 884x860 on an 884x860
canvas — **1:1, nothing scaled**. So it was never a resolution problem. The town
is crisp because it is drawn from a baked atlas with NEAREST filtering, and the
sky is a set of radial gradients, which have no pixel grid to be crisp on.

The backdrop is now **posterised to an ordered ladder with Bayer dithering**:

- `skyLadder(phase)` — nine steps without cloud, eleven with, every one a blend
  of the phase's own void / ground / mid / cloud. No invented colour, so the
  harmony `sky.test.ts` checks between those keys still holds.
- `posterise` finds the two nearest steps per pixel and picks one by an 8x8 Bayer
  threshold, which is where the texture comes from rather than the rings.

Measured after: **9 distinct colours in the day sky, was 1004.**

## The mutation that found a real gap

A mutation deleting the posterise call from `skyTexture` **passed the whole
suite.** Every sky test exercised `paintBackdrop` or `posterise`; none exercised
the place they are combined. Two things individually right and an unchecked seam
— the same shape as issue 37 and the light-pattern bug, and the third time this
project has paid it.

So the combination is now one exported `renderSky`, which `skyTexture` calls and
the suite renders through. That widened `BackdropContext` by exactly two methods
— `getImageData` and `putImageData` — and widening it was worth it, because a
context that can paint a sky no test can read back is the failure the harness
exists to prevent.

## Four harness bugs the widening exposed

All four were latent and all four were invisible while the posterise did not run:

- `alpha()` returned 0 for anything it could not parse, so a **`#rrggbb` fill
  read as fully transparent** and the sky's plain stopped painting.
- `rgb()` could not parse hex at all, so the plain — which the backdrop fills
  from the palette, not from `rgb()` — read as black whenever anything blended
  onto it. The vignette blends onto the plain, so this is the vignette's test.
- `getImageData` allocated **one byte per pixel** instead of four, so
  `putImageData` rewrote a quarter of the frame and left raw gradient behind it.
- `putImageData` stepped over `px` rather than over the byte array.

The first fix made the second appear, which is what a harness is for: each was
masked by the one before it.

## Worth recording

**I raced the daemon against the build and spent a turn looking at a stale
bundle.** The restart and `go install` were issued in the same turn and the
restart won by three seconds, so the page was served the previous embed while the
source and the suite were both correct. That is the third time in this session a
stale bundle has cost time — twice by rebuilding and once by not ordering the
restart after the install — and the tell is always the same: `git status` clean,
`tsc` clean, tests green, and the browser disagreeing with all three.

## Amendment 2 — cloud became sprite art, and the birds became occasional

Asked for: sprite art, clouds that move, birds that *sometimes* appear. Two of
those three were not what had shipped.

**Cloud was painted into the backdrop.** A cluster of radial gradients,
posterised along with the sky. That was wrong twice: a gradient has no pixel grid,
so a cloud made of gradients could never be the same kind of picture as the
building beside it, and a cloud painted into a backdrop is nailed to it, because
a texture cannot move.

Cloud is a sprite now, on the same terms as the bird and the ember — generated,
so the atlas pays nothing:

- **a union of discs with a flat base.** That is how a cloud is drawn, and it is
  also the only construction that gets a hard edge and a straight underside out of
  the same code. Three tones of plaster read as light: crown, body, shadowed base.
- **three sizes and two variants**, six textures, hashed from `(width, variant)`
  so a given cloud is always the same cloud.
- `DAYLIGHT.cloud` — a *colour* — became `DAYLIGHT.clouds`, a **count**, because
  a backdrop cannot be asked how many things are in it.

**Birds were always out.** Six circling for the whole of a dusk is not
"sometimes", it is furniture — a reader who has watched one for a minute has
stopped seeing a bird. `FLOCK_PERIOD = 48`, `FLOCK_VISIBLE = 12`: a flock
crosses and is gone for most of a minute, about two sightings a minute, and the
window is a pure function of the clock so two clients see the same flock.

## Two things this got wrong on the way

**The clouds came out as flat bars.** The disc radii were sized as a fraction of
the *width*, which at 38 wide put 6-to-17-pixel discs into a sixteen-pixel-tall
box. Their union was the whole rectangle and every cloud was a slab. A cloud's
proportions are set by its height — that is what makes the thing wide and shallow
— so that is what the discs are sized against.

**The variant axis was never on screen.** `setTexture` was handed the first key
matching a size, which is always variant 0, and then asked for frame 1 — a frame
a canvas texture does not have. The variant existed in the art, in the tests and
on disk, and had never once been drawn. The suite passed the whole time, because
every test looked at the pixels rather than at the key the layer asked for.
