# 39 — A signed hash put machine sprites inside buildings

**What to build:** Fix the lit-window pattern index, and stop a missing frame from
renumbering a building's stack.

**Status:** done

- [x] `lightPattern` wraps its result, and lives in `art/building.ts` so a test can
      call the real one
- [x] `stackContainer` gives a missing frame a transparent stand-in rather than
      skipping the child
- [x] The misses are counted, so a frame that is not there is visible
- [x] Two tests: the pattern is in range for every real path, and every light
      frame a building can ask for is in the atlas

## What it looked like

**Machine sprites drawn inside buildings, and buildings torn in half.** A reader
would have said "a lot of things floating" and been right, though nothing was
floating: what floated was the *top half of a building*, and what sat on it were
excavators.

The `ui/src` tower had six `m:excavator:chief:work` sprites as children at storey
heights, its cap, damage mark and pennant missing entirely, and two of its bands
drawn 56 pixels to the right of every other band. Same for `ui/test` and
`internal/analyzer`.

## Why

`hashPath` ends in `| 0`, so it is a **signed** 32-bit integer and roughly half of
all paths are negative — `ui/src` is −846872599, `ui/test` is −483228883. In
JavaScript `(negative) % 3` is −1 or −2, not 2 or 1, so the pattern index composed
a frame name of `lit:100:-1`, which was never baked.

That alone should have cost one invisible window. It cost the building, because
`stackContainer` had

```ts
const f = this.atlas[part.key];
if (!f) continue;   // <-- here since the beginning
```

and `restage` swaps frames **by index**. Skipping one child moves every child
after it down a slot, so from the first missing light onward the whole stack was
silently misaligned — which is why the damage mark and the pennant ended up on
machine sprites.

## The two halves, and why both were needed

Fixing the sign alone would have closed this instance. It would have left the
landmine, because a skipped child is a wrong answer to a missing frame and the
missing frame was never the thing anyone was looking for. Now a part whose frame
is absent gets a transparent stand-in, every index stays where it belongs, and
the miss is counted.

## What the tests got wrong first

The first version of the regression test recomputed the wrap itself rather than
calling the production function, so **it passed on the broken code** — 40 pass,
0 fail, with the bug reintroduced. That is `test:flagcorner`'s original mistake
again, and the reason `lightPattern` is exported rather than private: a test that
re-derives the thing it is testing is a test of the test.

Reintroducing the bug now fails 16 tests with
`ui/src storey 0: lightPattern returned -1, out of range`.

## Two false alarms worth recording

Both cost more time than the fix.

**`place()` projects.** `place(key, x, y)` takes a **world** point and projects it,
so a sprite's `x + ox` is a *projected* coordinate, not a world one. Reading it as
world put the crane "36 units outside the Yard" and 21 props "off their plates".
Inverting the projection put the crane back at cell 0, and a magnified look at
the Workshop and the Depot showed every prop sitting on its own plate where it
had been all along.

**The page can be running a stale bundle.** The fix was verified in source, in
the suite, and still appeared broken in the browser, because `vite build` had run
before the last edit and `townd` embeds the built assets at compile time. The
tell was `stackParts` returning 28 keys into a 20-child container while the
source was obviously correct.
