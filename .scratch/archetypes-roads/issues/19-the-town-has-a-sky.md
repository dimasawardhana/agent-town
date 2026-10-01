# 19 — The town has a sky

**What to build:** The land stops floating on a flat void.

**Blocked by:** none

**Status:** done

- [x] A generated sky, horizon, treeline and plain, at zero atlas cost
- [x] The horizon crosses the island rather than standing in front of it
- [x] The backdrop survives a redraw
- [x] No backdrop colour leaks into baked art
- [x] No `Math.random()`
- [x] The plain shares the grass's hue and is separated by value and saturation

## Comments

### The void was information *and* a hole

Some of it is real: a region reads as a region partly because nothing surrounds
it. So this does not fill the void in. It puts a horizon **behind** the island and
leaves the land's own edge alone.

### Two failures worth recording

**The backdrop was created and never seen.** `draw` calls `children.removeAll`, so
the sky — added in `create` and not restored — was alive, textured, and *not in
the display list*, while the scene held a reference to a destroyed object. Nothing
threw. It is now restored beside the chimneys and embers, which are in the list for
exactly this reason and which I read while looking for the bug.

**The first sky was invisible by construction.** It kept the zenith at the void
colour and eased hard into the haze, so the entire band the town does not cover —
the only band that shows — sat at almost exactly the void it replaced. The first
horizon was at 0.74, which put the treeline *below* the island: a forest the town
stands behind, which is the opposite of a horizon, and it read as a barcode across
the bottom of the frame.

The horizon is now a fight with the camera fit, and it is the whole composition:
the sky is screen-space while the island is centred, so the horizon has to cross
the island for the skyline to be against haze and the land against sky.

### Why generated

Zero cels. The sheet is a power of two on every axis and every cel in it is paid
for by the whole town, so a baked backdrop would have come out of the archetype
budget. The seventh colour set in the palette and the only one a test forbids from
appearing in baked art.

### The plain is the same world

The first plain was a blue-grey, and it belonged to no landscape in the picture —
a different world, not a different field. It is now a desaturated relative of the
grass ramp, separated from the town by **value and saturation rather than by
hue**, which is what a distant field actually looks like and what atmosphere
does to one. Hue 140 against the grass's 135-147; saturation 0.15 against 0.42-0.44.

An intermediate version at the same hue and half the saturation still failed, at
14 units from one step of the grass ramp: related but not separate enough. The
fix was to lighten it as well, because distance lifts things as well as dulls
them, and that is what put every step of the ramp out of reach.

### The machines

Not in this ticket. The budget for them is measured and the design is settled —
five kinds, four poses, two tiers, 40 cels against the figure's 76 — and the atlas
has 135 spare, so this is a headroom win rather than a cost. That is the next
piece of work, not this one.
