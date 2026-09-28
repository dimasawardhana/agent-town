# 14 — One blank per condition, for the whole town

**What to build:** The frame a building carries when it is *not* damaged and the
one it carries when it is *not* verified become single shared cels, rather than
one per archetype per footprint.

**Blocked by:** 13

**Status:** done

- [x] One blank for damage, one for verification, for every building
- [x] Every combination of a condition and its absence still resolves
- [x] The stack's child count is unchanged, so restaging still lines up
- [x] The blanks are genuinely empty

## Comments

### The trick, a third time

| | cels | spare |
|---|---|---|
| before | 1279 | 17 |
| **after** | **1161** | **135** |

120 cels were baking nothing. A blank is a blank, and `setFrame` does not move a
sprite, so **the blank a mark swaps from does not need the mark's box** — the
per-archetype, per-footprint boxes were pure duplication. That is 118 cels for
two 1×1 transparent pixels.

This is the same move as ticket 02, which found 320 blank caps. It has now paid
three times, and the rule it teaches is short enough to be the project's most
reusable idea:

> **Before baking a cel per combination, ask what that combination draws. If it
> is nothing, bake it once and point every key at it.**

The child count is untouched: a building still carries one damage child and one
pennant child, whatever its conditions are. That is why the blank could be shared
without touching the restage invariant.
