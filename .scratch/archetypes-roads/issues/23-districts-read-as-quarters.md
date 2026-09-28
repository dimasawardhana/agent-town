# 23 — Districts read as quarters

**What to build:** Wider gaps between districts, roads between them, machinery that
is visible.

**Blocked by:** none

**Status:** done

- [x] District gap 28 → 64, a 4.6:1 ratio against the 14 between buildings
- [x] A road is emitted into every district gap, not only on a row wrap
- [x] A machine's footprint 8 → 20, at no atlas cost
- [x] The road art is verified at 18 bands on this repository

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

### One clipping bug

The crane's raised mast drew 3px onto its own cel border in the `done` pose —
the box was sized to a static height and the raised pose is taller. `TALL` is now
sized for the tallest pose rather than the typical one.
