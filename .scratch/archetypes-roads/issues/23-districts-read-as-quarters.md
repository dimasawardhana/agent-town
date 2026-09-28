# 23 — Districts read as quarters

**What to build:** Wider gaps between districts, roads between them, machinery that
is visible.

**Blocked by:** none

**Status:** done

- [x] District gap 28 → 64, a 4.6:1 ratio against the 14 between buildings
- [x] A road is emitted into every district gap, not only on a row wrap
- [x] A machine's footprint 8 → 20, at no atlas cost
- [x] The road tally is asserted, not logged: 17 bands — 9 import, 6 containment,
      2 district

## Comments

### The ratio is the thing, not the number

`rowGap` was 28 against a `cellGap` of 14. A 2:1 separation does not read as a
boundary — the districts were a field of buildings with slightly wider seams, and
where one ended and the next began was only knowable from the labels. **The
hierarchy is carried by the ratio**, so buildings stay neighbours at 14 and
districts become quarters at 64. And 64 is a road with room in it rather than a
stripe.

### A town whose districts all fit in one row had no roads

`rowGap` bands were emitted **only on a wrap**. The wrap is a width decision, so a
repository with few or narrow districts never triggers it, and the map had no
roads between any two districts. That is most towns, including this one.

The fix applies the rule that was already written down and only half-implemented:
*the gap this placement leaves **is** the road*. Emitted here rather than drawn
by the browser, for the reason the original comment gave — the band and the gap
cannot disagree if one of them makes the other.

Emission is deferred by one block because a road's height is the taller of the
two blocks it separates, which is not known until the second is placed.

### The machinery was the size of the thing it replaced

A machine's footprint was 8 world units against a smallest building of 44 — a
sixth the width of the shed it was working on. That is the size a *person* was, so
swapping one for the other bought nothing at the zoom the town is actually read
at. It is 20 now: well under the smallest building, because a machine should read
as *at* a building and never as one.

**The atlas did not move.** 1125 cels before and after, because a machine is
narrower than the narrowest cel no matter how large it is drawn.

### The acceptance box that had nothing behind it

This ticket ticked "the road art is verified at 18 bands on this repository". The
only test near it asserted `n > 0` and `Logf`ed a tally. A number in an acceptance
box with nothing behind it is the same defect as an unticked claim: it reads as
evidence and is not.

The number was also **wrong** — it is 17, not 18 — because it was counted by hand
from a probe during the session rather than read from the code. There is now a
test that runs on this repository and asserts the properties the box means:
district roads exist, import roads exist, and the tally is logged rather than
remembered. When the map changes, the log says so and the assertions still hold.

### One clipping bug

The crane's raised mast drew 3px onto its own cel border in the `done` pose —
the box was sized to a static height and the raised pose is taller. `TALL` is now
sized for the tallest pose rather than the typical one.

## Comments

### The bug in the first version of this ticket

The roads were emitted at *placement*, sized by the block just laid. That is
right only when the two blocks are the same height, **and districts are not the
same height**. On this repository `ui` is 284 tall and `internal` is 356, so the
road between them stopped 72 units short and left the bottom of `internal`
standing beside bare grass — a stub, not a road.

A road is a street: it crosses the row, so it is as long as the row is deep.
Emission is now deferred to the end of the row, where the height is final.

Two smaller things the same change exposed:

- **`rowTop` was never seeded.** The first row never wraps, so its top was 0 and
  every road on it began 238 units above the districts it separated — off the map
  entirely. Seeded from `y`.
- **A trailing road past the last district**, leading to nothing. It read as a
  road *to somewhere* rather than as the end of the town, which is the same
  claim an unresolvable import refuses to make.

And one regression: routing the wrap band through the district flush had made the
`row` kind **dead**, and a test that expected a row road on a wrapping tree
caught it. The two kinds are genuinely different — one runs between rows across
the full width of the map, the other runs between districts down the depth of one
row — so both are emitted again.

### The tests

- `TestDistrictRoadsSpanTheWholeRow` — a road reaches its row's floor. Reverting
  to the old sizing fails it.
- `TestNoRoadLeadsOffTheEndOfTheTown` — nothing past the last district.
- Reintroducing the old height fails the first; seeding `rowTop` back to 0 fails
  it on the row check. Both verified by mutation, not by inspection.
