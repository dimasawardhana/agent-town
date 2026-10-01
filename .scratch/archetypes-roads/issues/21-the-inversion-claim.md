# 21 — The inversion claim, measured

**What to build:** `TestTestDistrictDoesNotDominateSource` passes for a reason.

**Blocked by:** none

**Status:** done

- [x] The claim written as a property over 30+ shapes, not one case
- [x] The two real limits found and asserted
- [x] ADR-0012 corrected to say what the code does

## Comments

### The test was evidence of nothing

It checked one hand-picked shape. It stopped passing when `testPitch` was
introduced, and the fix at the time was to **move a threshold** — which is
exactly the thing that makes a test unfalsifiable, written down as though it
were not.

Written as a property over 90 shapes it reports **29 inversions and a worst ratio
of 2.58**. The single case had been carrying a claim the layout does not make.

### What the code actually does

`testPitch = 0.7`. A constant. The ADR described something else entirely: it said
the layout weights test districts *by file count*. **Those are different
mechanisms**, and the difference is the whole finding — a constant cannot express
a relationship between two districts, and a file count can.

### Two limits, both worth knowing

**The pitch is invisible below the block floor.** A one-building district is
floored to a plate sized for the largest thing that can stand on it, so a test
district and a source district of the same shape weigh *exactly the same*. Anyone
reading `testPitch` as "test districts are always smaller" is wrong for every
small district in the town, and that is most of them.

**A constant is not a relationship.** The 29 inversions are all large-suite
cases. Making them go away means the file-count weighting the ADR originally
described — a real change to the layout, deliberately not done under a bugfix.

### The test that replaced it

Three tests, each stating something true:

- **the mechanism** — a test district of the same shape weighs less, above the
  floor. Cannot drift.
- **the limit** — below the floor both weigh the same. Asserted rather than
  avoided by choosing friendlier shapes.
- **the bound** — 8 of 30 shapes invert, worst 2.58, and a change that makes it
  *worse* fails. The bound is generous on purpose: a tighter one would be a
  threshold dressed as a property, which is the mistake this file exists to stop
  repeating.
