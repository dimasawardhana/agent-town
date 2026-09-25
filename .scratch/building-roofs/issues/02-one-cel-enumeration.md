# 02 — One cel enumeration, so the invariants cannot miss a cel

**What to build:** The palette, transparency and border-ink invariants provably cover *every* cel the atlas actually ships.

Today the bake loop and the test helper that enumerates cels for those invariants are maintained separately by hand, and they do not agree. Measured, two gaps:

- The helper composites a whole one-storey building rather than the parts that are baked, so its names do not correspond to atlas frames.
- It **never builds a band cel at all** — the cel that tiles up every storey of every tower. So the most-repeated artwork in the town has no palette or transparency coverage.

That gap is silent: an off-palette pixel introduced into a band cel, or into any cel the helper forgets, passes the whole suite. Adding an art axis (the point of the following tickets) is exactly the change that would walk into it.

The fix is one enumeration, used by both the bake and the invariants, so a new axis cannot be added to one and missed in the other. Prefer deriving the enumeration from the same tables the bake iterates over, rather than writing a third parallel list.

No user-visible behaviour changes. The verification is that the invariants now fail if a cel is deliberately given an off-palette pixel — proof the coverage is real rather than merely asserted.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] One enumeration produces the cels the bake registers, and the invariants consume it rather than a second hand-written list
- [x] The enumeration includes every cel family the bake registers: building base, band and cap (for every footprint, stage, damage state and skin variant), shadow, ground, ground edges, props, workers
- [x] The count from the enumeration equals the number of frames the atlas registers, asserted so a future divergence fails loudly
- [x] The palette, no-semi-transparent-pixel and no-border-ink invariants all run over that full set
- [x] Proven, not assumed: deliberately corrupting a cel that the old helper *missed* makes an invariant fail
- [x] The suite is green, and no user-visible behaviour changes

## Comments

`bakedCels(turn)` now lives in `ui/src/art/bake.ts` and is the single enumeration
of what the atlas holds; `bake()` is built from it, and `ui/test/art.test.ts`
reads it instead of listing cels by hand. The old helper composited a whole
one-storey building per cel (`buildBuilding`), so every name it produced matched
no frame in the atlas, and it never built a band cel.

### Two real defects it was hiding

Coverage is not just "more cels now"; moving to the real enumeration immediately
exposed two things the old list could not see.

**1. The border invariant was demanding outlines from ground.** Its skip list said
`ground/` and `edge/`, but the frame keys the bake registers are `g:` and `ge:`.
The old helper's invented names happened to match the skip, so the exception
worked by accident; switching to real keys broke the match and `g:grass:0` failed
with artwork on its border (7px). Fixed by matching the real prefixes — and
commenting why, since a skip list keyed on names that no longer exist is a silent
re-opening of the invariant.

**2. `every cel is non-empty` is false, and was only ever true by accident.** 80 of
628 cels are blank, and correctly so:

| family | blanks | why |
|---|---|---|
| band | 16 | 4 sizes x 2 variants x 2 stages (planned, foundation) |
| cap | 64 | 4 sizes x 2 variants x 4 stages (planned..walled) x 2 damage |

The construction ladder is monotone and the parts are drawn when their feature
exists: `storeyShell` draws walls from `framed`, `roof` from `roofed`. The old
helper never saw a blank because it composited the whole building, so a plot with
no walls yet still had *stakes* in it.

A blank cel is **load-bearing**, not waste: `stackKeys` builds a fixed
base-bands-cap stack sized by floor count and `restage` swaps each child's frame by
index, so the child count must not vary with stage. A planned tower's four
invisible storeys point at the blank band frames.

So the invariant was replaced by three that say what is actually true:

- `the base is never empty, at any stage` — a plot always shows something.
- `only the band and the cap may be blank, and only before their feature exists` —
  blanks are expected, a *third* family going blank is a failure.
- `a part that is drawn at one stage is drawn at every later stage` — the ladder is
  monotone, which catches a cel that appears and then vanishes.

### Proof the coverage is real

`the palette invariant would catch a band cel, which the old enumeration never
checked` corrupts one band cel, runs the real checker over it, and requires the
throw. Verified by counter-experiment: filtering bands out of `everyCel` makes it
fail with `the enumeration must contain at least one band cel`. The checker was
extracted to `assertPaletteOnly` so the proof exercises the real one rather than a
reimplementation of it.

### Result

Suites green: art 65, visibility 19, light 1, atlas 5. `tsc --noEmit` clean.
Cel count 628, unchanged — this ticket changes what is *checked*, not what is baked.
