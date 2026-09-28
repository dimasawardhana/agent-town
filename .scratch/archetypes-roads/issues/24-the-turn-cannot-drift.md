# 24 — The turn cannot drift

**What to build:** The four quarter turns stay consistent, and a layer cannot
quietly apply the turn twice or not at all.

**Blocked by:** none

**Status:** done

- [x] Four quarter turns return every point to where it started
- [x] A quarter turn has order four, and a half turn is its own inverse
- [x] Turning is idempotent for a fixed turn, never accumulated
- [x] Rotation preserves the separation of every pair of sites
- [x] Every layer of a turned town agrees on where a building is
- [x] A per-building offset constant — the failure that leaves a town looking
      like a town while no longer being one

## Comments

### Written after the fact, deliberately

The user asked for rotation to be made safe and the suite was written in the same
turn. It shipped untracked, which the code review caught: 185 lines and 11 tests
answering no ticket is work the next reader cannot place. The tests are the
workings; this ticket is the index to them.

### What the measurements said, before anything was written

On a live town, at all four turns, the base cel sat at exactly **(-56, -76)** from
the projected cell corner. A constant, and therefore not drift — but the same
numbers would have hidden a real drift, and nothing was checking.

The arrangement rotates correctly: four turns return to the start exactly, and
each building-to-building delta is the quarter turn of the last.

### Three facts about rotation that were assumed rather than checked

- **A quarter turn has order four.** It is not an involution. My first test
  asserted a property rotation does not have, in a file whose subject is rotation.
- **`turnLayout(0, …)` returns the layout untouched**, so the origin shift is
  skipped at turn 0. A layer assuming a shifted origin would be right at turns 1
  to 3 and wrong at turn 0, which is the quietest possible way to be wrong.
- **The sprite and view paths differ by the origin shift**, so they must be
  compared *as a constant*, not for equality. Asserting they agree would have
  failed for the right reason and been "fixed" by breaking the shift.

### The assertion that carries the weight

Every building is offset from the projection by the *same* amount. A per-building
constant is precisely the failure that leaves the town looking like a town while
no longer being one, and it is invisible in any screenshot. Proven to bite by
injecting a three-pixel offset into one building and watching it fail.
