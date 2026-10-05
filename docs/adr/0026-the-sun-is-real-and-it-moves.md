# ADR-0026: The sun is real, and it moves with the time of day

## Context

The flat town's light is a rasteriser fact. Every cel is shaded by picking a ramp
step per pixel: `litWall` and `shadowWall` return an index, and the key is fixed at
the picture's top-left. `CONTEXT.md` states the rule the whole town obeys — "the
light does not turn with the town: it is fixed at the picture's top-left, so the
wall that catches it changes as the world turns under a fixed sun."

The solid town has no ramps to step and no pixels to pick. The first answer given
was that code would keep picking the lit colour — flat materials, the palette as
the sole authority for every colour, no light in the shader at all. That answer is
coherent, deterministic, and it was reversed, because it cannot produce the thing
the same session had already asked for: **real cast shadows.** A shadow map needs
a light to be cast from, and a tower shadowing a worker is the strongest occlusion
cue an isometric world has.

There is a second question underneath it. The flat town has three times of day —
`DAYLIGHT` in `ui/src/daylight.ts:109-143` — and in it only the sky colour and
whether windows glow change; the light itself never moves.

There is a third question underneath that one, and it is the one that forced a
decision. `CONTEXT.md`'s rule — light fixed at the picture's top-left — is stated
in **picture** space, while a real light is a direction in the **world**. Orbiting
a camera around a world-fixed sun moves that sun across the picture, so the rule
and the sun cannot both hold. The question is which one the solid town keeps.

## Decision

**The solid town is lit by a real directional light. Its direction changes with
the time of day. The light never turns with the town — the reader does.**

1. **Real GPU lighting.** Materials carry a base colour from the palette `P` and
   the light supplies the shading. This knowingly gives up "the palette is the
   sole authority for the rendered colour", which is recorded here precisely
   because a future reader will see `assertPaletteClean`, see a lit surface whose
   tone is not in the palette, and wonder which of the two is the mistake. Neither
   is: `P` owns the *base* colour and the light owns the illumination.

2. **The sun moves across the three phases.** Shadows lengthen and swing between
   day, dusk and night, and the town is lit from a different side at each. This is
   what makes cast shadows worth their cost, and it gives the solid town something
   the flat one cannot do.

3. **The sun is fixed in world space, and a turn re-lights the town.** Turn stays a
   reader preference and the world never turns — but the light is a direction in
   the world rather than a corner of the picture, so orbiting the camera moves the
   light across every face and a building is lit from a different side at each
   turn. This deliberately diverges from the flat town, where the key is pinned to
   the picture's top-left. The rule's *intent* survives — the light never follows
   the reader. Its *mechanism* does not, and cannot.

4. **Windows gain their meaning.** Glazing is already a rank on the ladder
   (`glazed`), and `scene.ts:1948` already gates a lit window on
   `DAYLIGHT[day].lit` and that rank. In a solid town at night, glazing is
   literally what lights up, and the ladder and the light agree about it.

## Why

**Why the reversal is honest rather than a wobble.** The first answer optimised for
one authority over colour. The second optimises for legibility, which is the stated
purpose of the whole project (ADR-0025). Shadows are a legibility instrument and
flat unlit materials cannot have them, so the authority argument lost to the
purpose. Recording both is the point: the trade was real and it was made in the
open.

**Why the picture's top-left was never a law.** Because it is a rasteriser artifact
wearing a law's clothes. A cel's shading is baked into its pixels, so the only
affordable way to light a flat town is to fix the key to the canvas and let the
world turn under it; re-lighting 1145 cels per turn, or per hour, is not on the
table. Once the sun is a real light that moves with the hour, the picture's light
direction already varies across a day, and "always top-left" is revealed as a
property of the medium rather than a fact about the town. The solid town keeps the
part that was ever about the town and drops the part that was about the canvas.

**Why the sun moving does not break determinism.** Geometry stays a pure function
of (archetype, material, footprint, rank), so the town is the same town on every
machine. The light direction is a function of the *phase*, and the phase is store
state exactly as the turn is — so the same project at the same phase is lit the
same way, everywhere. Nothing reads the wall clock.

**Why not a fixed sun with static shadows.** Because the flat town already has
static shadow: a `P.grass[0]` footprint baked under each building, and a running
ellipse under each worker. A solid town whose shadows never move has bought a
second renderer to reproduce something the first one already does.

## Consequences

- **`CONTEXT.md`'s Turn entry is rewritten, and it stops being a shared rule.** The
  light follows the reader in neither renderer, but the mechanism differs and the
  entry must say so: the flat town fixes the key to the picture because its shading
  is baked, and the solid town fixes it in the world because its light is real. A
  turned town is therefore lit identically in the flat renderer and differently in
  the solid one.
- **The two renderers diverge in appearance, and the flat one is not touched.** It
  keeps its three phases and its picture-fixed key exactly as they are. Only the
  solid town gains a moving sun.
- The palette's role narrows in the solid town to base colours, and the five
  ramps become five base tones. Each ramp's mid step is the base, which is a
  choice that has to be made once per material and asserted.
- Shadow casting needs a decision about what casts and what does not: a building
  casts, and a ground decal, a label and the sky do not.
- The day-phase control is shared by both renderers and means the same thing in
  each — but it does more in the solid one, and a reader may reasonably expect
  more of it there.
- This is the only decision in this series that reverses an answer given in the
  same session, which is why it has its own ADR rather than a line inside
  ADR-0025.
- **Reading the system clock is deferred, and deliberately not built now.** The
  obvious next step is for the town to take its phase from the reader's local time,
  so a town at 1am is a town at night. It is not in this decision because it changes
  what the phase *control* is — from a selection the reader makes into a default
  they may override — and because a reader working through the night would then
  never see their town lit, which is a product decision and not a lighting one. The
  groundwork is small when it is wanted: inject the clock as a source rather than
  reading it ambiently, so a phase stays a pure function of an input.
