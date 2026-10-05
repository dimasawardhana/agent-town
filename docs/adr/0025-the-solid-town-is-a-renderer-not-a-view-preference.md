# ADR-0025: The solid town is a renderer, not a view preference

## Context

This project already has a vocabulary for "how the reader is looking at the
town": **Turn** (which way round, in quarter turns) and **Follow** (which way the
camera is pointed at one worker). Both are defined as view preferences, and
ADR-0020 states the rule they obey — the view turns, the world does not.

There is also a third: `store.view`, a `ViewMode` holding `iso` and `plan`. But
`iso` and `plan` are not two ways of looking at one drawing; they are two
*drawings* of one layout inside one Phaser scene, and `plan.ts` says so — a
top-down rendering of that art "is not a transform, it is a re-authoring of all
1145 cels."

The first answer given to "where does the solid town live" was that it is a third
`ViewMode`. That was chosen while the plan was still that the solid town would
share the flat town's art through one `Drawer` interface and a second backend. It
does not: the geometry is authored separately (ADR-0023), so the two renderers
share no drawing at all.

## Decision

**The solid town is a second renderer of the same town. It shares the layout the
daemon sends, the vocabulary, and the camera — and nothing else.**

1. **Not a `ViewMode`.** `store.view` keeps exactly its two values. Folding a
   renderer choice into a field that means "which drawing of this layout" would
   bury a lifecycle difference inside a drawing difference: a different canvas, a
   different scene graph, a different frame loop, a different asset set.

2. **Turn and Follow apply to both.** They are preferences about *where the reader
   stands*, and that question has an answer in either renderer. ADR-0020 and
   ADR-0022 therefore survive verbatim, which is the test of whether this is
   really one town: a turn is a camera orbit around the same fixed origin, and a
   follow is a camera distance and aim rather than a zoom floor. The world never
   turns in either renderer; only the reader moves.

3. **The solid town has no plan view.** A plan is a flat drawing of a flat town,
   and in a solid one "from directly above" is a camera position that would
   contradict the fixed 2:1 dimetric angle. The plan view is one of the things the
   flat town has that the solid town does not, and the cost is real: the plan is
   how a large town stays navigable.

4. **The renderer choice is a control, not a mode switch.** It sits beside the
   turn and day controls as something a reader changes about the view. What it is
   *not* is a preference in the sense Turn is, and the glossary says so.

## Why

**Why the distinction earns a word.** Turn is cheap to honour precisely because it
changes nothing but the camera. Calling the solid town a preference would promise
that same cheapness and then fail it, because switching renderers tears down a
scene and builds another. A reader who understood "preference" would expect a
toggle to be instant and lossless.

**Why ADR-0020 and ADR-0022 get to survive rather than being replaced.** Both were
written as decisions about *cameras*, not about pixels. ADR-0022's own words: a
follow "is a camera, not a projection." An orbit and a distance are what those
sentences describe, so the solid town is the first renderer that implements them
literally rather than by proxy.

**Why no plan view rather than a second projection.** Because the fixed 2:1
dimetric angle is load-bearing for spatial memory — the same repo yields the same
town from the same seat, which is what PRODUCT.md means by "the map is the
memory". A second projection in the same renderer is a second thing to test and a
second way for the town to look unfamiliar.

## Consequences

- The store grows a renderer selection beside `view`, `turn` and `day`, and it is
  display state like the others: it never reaches the daemon.
- Turn's glossary entry gains a sentence: in the solid town the same preference is
  a camera orbit, and the sun still does not turn with it.
- Follow's entry changes its mechanism, not its meaning: "the zoom floors at
  three" becomes a minimum camera distance, because there is no pixel grid whose
  whole-number zoom would matter.
- The integer zoom rule does not carry over. `follow.ts` clamps isometric zoom to
  whole numbers in `[1,4]` because "a fractional scale makes some world steps two
  pixels and their neighbours one" — a property of the rasteriser, not of the
  camera. The solid renderer has no rasteriser and so does not inherit the rule;
  it does inherit the *reason* for it, which is that a machine too far away cannot
  be read.
- A reader can flip between the two renderers on one project, which is the
  cheapest possible way to judge whether the solid town is actually more legible.
  That comparison is the point of building it additively.
