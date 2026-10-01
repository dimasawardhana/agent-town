# 37 — The pennant floated because a frame origin ignored the turn

**What to build:** Pass the turn to every cel box in the bake, so a cel's recorded
origin is the box its own pixels were drawn in.

**Status:** done

- [x] `baseBox`, `bandBox`, `capBox` and `shadowBox` are all called with the turn
- [x] The pennant and the roof damage — the two overlays already cut from the
      real box — now agree with the cap they land on, at every turn
- [x] Three tests on the recorded origins, in `test:flagcorner`
- [x] A mutation, so the suite can see it next time

## What was actually wrong

The bake gave the cap `capBox(side, roof)` — no `turn`, so the origin for turn 0 —
while giving the pennant and the roof damage `capBox(side, roof, turn)`. The flag
and the damage mark were the only two overlays cut from the *real* box; base,
band, cap, rubble and shadow were all cut from turn 0's, so they shared one
consistent wrong answer and the town held together.

The scene lays a sprite down using the frame's `ox`/`oy`, not the box its pixels
were drawn in. So the cap landed correctly for turn 0 and the flag landed
correctly for turn 1, and at a side-78 building those two answers differ by
**39 x 20 pixels**. At side 113, 57 x 29.

Measured: 0px gap between pennant and roof in the *baked art*, at every archetype
and every turn, because each builder was individually correct. The disagreement
was only ever in what the bake recorded about them.

## Why the suite passed

`test:flagcorner` had the decisive-looking test — "the pennant's pixels touch the
roof's, at every turn" — and it compares `buildCap` with `buildRoofFlagCel`. Both
of those build their own box internally, so it compares two pictures that are
each individually right and says nothing about what the bake *recorded*.

**A test that compares two builders cannot see a disagreement in the layer that
registers them.** The three new tests look at `bakedCels(turn)` instead:

- the pennant carries the cap's origin
- the rubble carries the base's origin
- and the general one — each cel's origin is the box its own builder used, which
  catches a wrong origin even when nothing else disagrees with it

Reintroducing the bug fails two of the three with
`turn 1, tenement at side 44: pennant origin x is 6, the roof's is 28`.

## What it looked like

At turn 0 every pennant sat on its roof. At turn 1 all of them floated: one
beside the blue tower over open grass, one right of the cream building, one
above the construction, each a gold square on a thin pole standing in mid-air
with nothing under it. The roof damage mark had the same fault, quieter, because
a hole in a roof reads as a hole somewhere nearby.

## Worth keeping

This is the third time this repo has paid for a mark placed against a coordinate
space it does not share — the first two were the damage overlay's origins and
the pennant's fixed world fraction. The common shape is the same each time: two
things that are *individually* right, and a third place where they are combined
that nobody checks.
