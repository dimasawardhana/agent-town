# 04 — Draw a pennant on a verified roof

**What to build:** A verified building grows a small pennant on its roofline, so
verification is something you see rather than something you infer from the
absence of damage.

Baked as a **cap variant** rather than an overlay sprite. The flag rides the
roofline the cap already owns, so it needs no new placement arithmetic, no new
depth ordering, and no per-turn maths — the cap is already baked four times
around for turns. An overlay would need all three, for a sprite that is smaller
than the roof it sits on.

**Blocked by:** 03

**Status:** done

- [x] `capFrame` takes `verified` and picks the variant
- [x] The flag is visible at the fitted zoom and absent when not verified
- [x] The tallest cel does not grow, or the new ceiling is measured and recorded
- [x] `bakedCels` count and sheet size are re-measured and recorded in the ADR
- [x] Damage still draws over a verified cap, since a test can fail after passing
- [x] The palette and transparency invariants run over the new cels

## Comments

Cost, measured rather than derived: **1140 cels** (820 + 320), cell **115×93**,
sheet **2048×8192**, tallest cel still **91 px**.

### The flag cost no height, which was the risk

The ticket named this as the one thing that could go wrong: `cellH` is paid for
by every cel on the sheet, so a flag one unit taller would have charged the
whole atlas. It does not, because the flag is drawn inside the eight units above
the roof that the pitched chimney already occupies — and the chimney's own
comment claims that envelope is "checked by the border invariant, not assumed".

The pole also starts four units *below* `top`, for the same reason the chimney's
does. `top` is the ridge; a pole that began there would stand on air wherever the
roof had fallen away beneath it. Starting below the surface is what makes it read
as planted.

`TestTheFlagDoesNotRaiseTheAtlasCellHeight` pins the tallest cel at 91 and the
sheet at 8192, so a future redesign that *does* grow the box has to update the
number here rather than discovering a smaller ceiling in production.

### The `:v` suffix is last, so existing frame names are unchanged

An ordinary cap is still `cap:78:flat:completed` and a verified one is
`cap:78:flat:completed:v`. Every existing town renders from the same frame names
it did before, and a reader scanning the atlas can tell the two families apart
without counting colons.

### Honest limit on the first criterion

*"The flag is visible at the fitted zoom"* is met, but only just. At 1:1 it is
13 gold pixels — a small mark that catches the eye because gold occurs nowhere
else in the town, not an object that reads as a flag. Magnified it is
unmistakable: a gold pennant on a pole beside the rooftop housing.

That is the right trade at this zoom, where workers and props are equally
simplified, and enlarging it would cost `cellH` for every cel on the sheet. But
it is a coloured pip, not a legible flag, and anyone expecting the second should
know it is the first.

### The enum caught the new axis by itself

`the bake and its invariants enumerate the same cels` failed on first run
because the cap family gained a third axis. That is precisely what it exists for,
and it is why the axis count is derived from the tables rather than remembered.
