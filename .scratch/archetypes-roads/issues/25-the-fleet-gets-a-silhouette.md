# 25 — The fleet gets a silhouette

**What to build:** Machines you can name, drawn as art rather than as boxes.

**Blocked by:** 20.

**Status:** done

- [x] Every kind passes the silhouette test: fill it solid, still nameable
- [x] One key light applied by rule to all five kinds
- [x] A 1px outline, same weight everywhere, drawn round the finished silhouette
- [x] The pose is carried entirely by one asymmetric gesture
- [x] No artwork on a cel border, ink included

## Comments

### The audit found an architectural fault, not a styling nit

The old excavator, filled solid:

```
   ............####.....................
   ..........########...................
   .........###########.................
   .....#####################...........
   .....######################..........
   ..........###########.#####..........
```

**That is a lump.** The silhouette test — fill the sprite solid, can you still
name it? — fails outright, and that is the one test a machine has to pass before
any interior pixel is worth drawing.

The cause is `iso.box`. A box knows how to fill a rectangular prism and nothing
else: it cannot make a boom that angles, a cab that sits *on* a track rather than
merging with it, or a jib that is thin in one axis. Those gestures are the whole
vocabulary of a machine, and a prism has no words for them.

### So the fleet is drawn as grids

Each machine is a 26x20 authored mask: seven rows of undercarriage and body that
never change, thirteen rows of arm that carries the whole pose. **A machine is
three things** — a wide low undercarriage it cannot move without, something
standing on it, and one asymmetric gesture above that. Authoring the chassis once
is why a pose is legible at a glance: nothing else on the machine is allowed to
move.

### The light is a rule, not a hand

Five machines shaded by hand drift — one gets a top-left key, another an overhead
one, and a fleet lit from two directions reads as two fleets. One pass over one
mask makes the key the same for every pixel in the town, which is the same
argument the buildings' `visibleFaces` makes and the same reason it exists.

The rule is not a lighting model. A pixel with an empty upper-left neighbour is
a lit edge; one with an empty lower-right is a shadowed edge; anything else is
midtone. Simple, and identical for every machine.

### The outline goes round the drawing, not the parts

Applied after the fills, so it traces the finished silhouette. An outline applied
per-box is what made the old fleet look like a stack of separate objects, and an
outline of varying weight is the fastest way to make a set of sprites look like
an asset flip.

A one-pixel margin all round, because the outline pass writes ink into the cells
*beside* the art: a grid whose drawing touches an edge puts its own outline on
the cel border, and a clipped outline is worse than none.

### Known gap

**The crane's `work` and `idle` are nearly identical** — only the load changes.
That is honest to the machine (a crane's gesture is horizontal, so it has little
to articulate) but it means a working crane does not read differently from a
parked one. The next pass should give the jib a real length difference between
poses, and check the loader and dozer the same way.
