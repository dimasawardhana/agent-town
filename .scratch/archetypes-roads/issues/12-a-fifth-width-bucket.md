# 12 — A fifth width bucket, paid for by moving the pennant to an overlay

**What to build:** Buildings are drawn at five widths rather than four, so a town
of eleven archetypes reads as eleven different buildings rather than four shapes
repeated.

**Blocked by:** 09, 10

**Status:** done

- [x] Five footprints, evenly spaced
- [x] The verification pennant is an overlay, not a cap axis
- [x] The atlas still fits, and the sheet does not grow
- [x] A test district still does not outrank the source it covers
- [x] Every budget figure is derived from the tables, not remembered

## Comments

### The price quoted was wrong, and the correction is the point

This was quoted as "5 buckets → 1348, 60 spare". That arithmetic used a
**stale ceiling of 1408**. The ceiling is `floor(8192 / cellH) × 16`, and the
Chapel had already set `cellH` to 101 — which makes it **1296**. Five buckets
came to 1348 against that, and the sheet tried to become 2048×16384.

The number is now asserted where everything else is priced from, so the next
recalculation cannot be made from a stale figure:

```
assert.equal(Math.floor(8192 / layout.cellH) * 16, 1296, ...)
```

This is the second time in this project a budget has been computed against a
ceiling that had since moved. Both times it looked affordable and was not.

### What it actually cost

| | 4 buckets | 5 buckets |
|---|---|---|
| cap (11 archetypes) | 352 | 220 |
| pennant overlay | — | 110 |
| everything else | 792 | 909 |
| **total** | **1144** | **1239** |
| ceiling | 1296 | 1296 |
| spare | 152 | **57** |

The pennant moving from a cap axis to an overlay is what paid for it: an axis
costs one cel per *stage*, and a flag looks the same on a roofed building and a
finished one. Three overlays now sit on a roof — damage, its blank, the pennant,
its blank — which is the same pattern the project has used twice already.

### A real invariant nearly went with it

`TestTestDistrictDoesNotDominateSource` — ADR-0012's "a test district must not
outrank the code it covers" — failed by 3%. Not a test bug: a finer table shrinks
a 7-file source building from 78 to 58 while a 1-file spec directory stays at 44,
and `testPitch` only squeezes *spacing*, so it cannot beat a 3× building-count
difference. Confirmed by trying 0.65, 0.60 and 0.55 — all still failed.

The fix was the **thresholds**, not the pitch: keeping the 5→7 boundary at 5→9
leaves a 7-file building at 72 and restores the invariant. The alternative —
tuning `testPitch` until a synthetic fixture passed — was rejected as fitting
the test to the code.

### The real payoff

Widths went from four to five, and the tests now read `SIZES` from the bake
rather than a hard-coded list that had already drifted twice.
