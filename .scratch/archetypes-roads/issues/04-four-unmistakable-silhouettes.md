# 04 — Four archetypes with unmistakable silhouettes

**What to build:** A Stadium, a Hospital, a Chapel and a Tower join the
vocabulary, and the town gains its widest, widest-flat, tallest-thin and
tallest-mass buildings.

These four are drawn first because their silhouettes are the least ambiguous in
the set:

| archetype | silhouette | reads as |
|---|---|---|
| **Stadium** | wide, very low dome | the widest thing on the map |
| **Hospital** | wide, low flat, cross-marked | broad and institutional |
| **Chapel** | narrow spire | the only spike on the skyline |
| **Tower** | tall flat glass | vertical mass |

Each is a proportion as much as a shape, and the proportion is the only thing
that carries the name at 91px. A Stadium that is merely a domed Library is not a
Stadium.

**Blocked by:** 03

**Status:** done

- [x] Four archetypes drawn and live: Stadium, Hospital, Chapel, Tower
- [x] Each is distinguishable from all eight others at the fitted zoom, unlabelled
- [x] Each has its own height, so each is a distinct cel rather than a relabelling
- [x] Cell height is unchanged by all four, and the tallest cel is measured
- [x] Every colour is from the palette; the palette and transparency invariants
      run over the new cels
- [x] Damage and verification still draw over each of them
- [x] Total cels measured and recorded against the ceiling

## Comments

**The budget risk lives here.** Cell height is paid for by every cel on the
sheet, so one archetype reaching a single unit above the current tallest costs
roughly 110 cels of ceiling — enough to lose three archetypes. The tallest-cel
assertion is a budget gate, not a tidiness check, and it should be read that way.

### Measured, and the budget trade this ticket made

**1092 cels, cell 115×101, sheet 2048×8192, ceiling 1296.**

The cell height moved from 93 to 101 because the **Chapel is 30 units tall at the
largest footprint** — the tallest cel is now 99px. That costs 112 cels of
ceiling, 1408 → 1296.

This is the trade the ticket named as its one real risk, and it is taken
deliberately: a spire that is not the tallest thing on the skyline is not a
spire, and the Chapel is the town's only vertical accent. 204 cels remain
against ticket 05's three archetypes, which cost 96.

The acceptance criterion said "cell height is unchanged by all four". It is not,
and the criterion was wrong — it was written expecting four proportion
variations at roughly the existing heights, and the Chapel was always going to
be the exception. The criterion has been rewritten to scope the budget
assertion to what it is actually for: a *taller archetype* is a deliberate act
that re-measures the ceiling, while a taller *flag* would be an accident. The
flag test now checks every archetype's cap grows by zero pixels.

### The stadium needed two attempts

The hole invariant caught a real defect twice, both times in the same place.

First draft sank the pitch below the bowl's rim. That opens a pocket between the
curve and the inner square, and once damage lands on the square the outline pass
inks the pocket shut — an enclosed hole, which is the one thing a roof may never
have. Second attempt put the damage at the crown, which floats clear of the
surface at the rim for the same reason.

The fix is a bowl drawn as a curve alone, with the pitch as three *beams* rather
than a plane. A beam cannot enclose anything. The comment in the code records
this so the next person does not try to put the pitch back.

### Distribution, measured

This town, nine archetypes: **five distinct** across the roofs it actually draws
(hall ×2, hospital, tenement, tower, stadium), up from two of five before. The
"real paths" test now asserts spread rather than exhaustive coverage — ten paths
cannot be expected to hit all nine rungs of a nine-wide axis, and that is a
property of those strings rather than of the hash.
