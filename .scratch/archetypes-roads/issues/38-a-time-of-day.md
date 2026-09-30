# 38 — A time of day, and the windows that are lit in it

**What to build:** One key light for the whole town, in three phases, with some
windows lit warm in two of them.

**Status:** done

- [x] `daylight.ts` — three phases, each a *selection* from the validated sky
      palette, plus the lit/not-lit rule
- [x] The backdrop repaints per phase, and a phase change repaints the sky and
      restages the storeys without a full redraw
- [x] `buildWindowLightCel` — three patterns per storey, cut from the band box
- [x] `stackParts` — every child of a building carries its own height, because an
      overlay belongs *on* its storey rather than wherever its position puts it
- [x] A panel control naming all three phases
- [x] 10 tests and a mutation; the two atlas invariants re-derived, not adjusted

## Why an overlay and not an axis

The atlas is the wall, and it is a hard one. Measured before writing any of this:

```
cels 1125 of ceiling 1312   free 187
one extra axis on base+band = 400 cels  ->  OVER by 213
```

So a second axis on the base and the band was never available, and the feature
was an overlay or nothing. The thing that made it cheap is that `baseBox` and
`bandBox` turn out to be **the same box** — measured identical at every footprint
and every turn — so one family of cels covers the ground storey and every storey
above it. Three patterns x five footprints x four turns is 60 cels, and 1145 of
1312 after.

As shipped: **1145 of 1296** (the project prices the sheet at a cell height of
101; my first budget script measured the tallest cel and got 99 and a ceiling of
1312, which is a second budget for one atlas and the looser one — see the note
below).

## What it does not do, and why

**The facades do not change value with the phase.** The spec said a time of day
"changes the palette those faces draw from", which is a simulated key light, and
it is not affordable: 400 cels for a second axis, or a re-bake per phase, and
one atlas is already 2048x8192 — twelve of them is not a thing this town can
hold.

So the light is the sky and the emissive. A wall is the same colour at night as
at noon, and the town reads as *a dark sky over a lit town*: a look, not a
simulation. It is asserted as a fact in `daylight.test.ts` so nobody has to
infer it.

## Two things this nearly got wrong

**The phases invented colours.** The first version gave each phase its own
`#rrggbb` triple, which looked like it belonged to the town and sat outside every
relationship `sky.test.ts` checks between the seven sky keys — the plain darker
than the void, lighter than the haze, less saturated than the grass behind it. A
phase therefore *selects* from the palette, and there is now a test that fails if
one ever stops.

**The first budget script measured the wrong ceiling.** It took the tallest cel
and computed `floor(8192 / h) * 16`, which gave 99 and 1312 where the project
prices the sheet at 101 and 1296. Two budgets for one atlas, and the looser is
the one a new feature would have been allowed to spend against. The test now
goes through `layoutAtlas`.

## The lesson, which is the same one as always

The lit overlay walks the **same placement function** `windows` does —
`eachWindow`, extracted for the purpose — because a second place that knows
where a window is would be a second place to be off by one, and the failure is a
warm smear on the wall beside the glass. It is measured rather than asserted
about the code: every opaque pixel of every overlay, at every size, pattern and
turn, coincides with an opaque pixel of the band beneath it.

And the overlay's *registered origin* is checked against its own box, which is
issue 37's bug applied forward rather than waiting to be rediscovered. A blank
cut from a different box would leave every window a storey out of place the
moment the light came on.

## The cost, stated

A lit window is a fact about the **hour** and nothing else. It does not say an
agent is inside. The machine is still the only mover that means an agent, and if
features 2 to 4 ever light a window for a reason, the two signals collide and one
of them has to go.
