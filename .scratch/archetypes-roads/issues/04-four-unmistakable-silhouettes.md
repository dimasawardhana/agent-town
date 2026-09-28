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

**Status:** ready-for-agent

- [ ] Four archetypes drawn and live: Stadium, Hospital, Chapel, Tower
- [ ] Each is distinguishable from all eight others at the fitted zoom, unlabelled
- [ ] Each has its own height, so each is a distinct cel rather than a relabelling
- [ ] Cell height is unchanged by all four, and the tallest cel is measured
- [ ] Every colour is from the palette; the palette and transparency invariants
      run over the new cels
- [ ] Damage and verification still draw over each of them
- [ ] Total cels measured and recorded against the ceiling

## Comments

**The budget risk lives here.** Cell height is paid for by every cel on the
sheet, so one archetype reaching a single unit above the current tallest costs
roughly 110 cels of ceiling — enough to lose three archetypes. The tallest-cel
assertion is a budget gate, not a tidiness check, and it should be read that way.
