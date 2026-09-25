# 04 — Roofs: the axis, end to end, with two shapes

**What to build:** A building's roof shape is chosen by hashing its directory path, and buildings in the town visibly differ in roof shape. Two shapes ship here — a pitched roof (today's, as the baseline) and a flat roof — so the mechanism is provably working before more looks are added.

A roof is ornament and carries no reading (see the glossary term **Roof**). The only thing that may vary a roof is the path hash, widened from its current two-valued form to take a roof kind. It must stay deterministic: the same repository always yields the same roofs.

**Where the decision lives.** The roof is chosen in the browser, exactly as the existing skin variant is — the daemon sends geometry (footprint, floors) and knows nothing about appearance. There is therefore **no wire change, no daemon change and no analyzer change** in this ticket. The detail panel must not report a building's roof: it is meaningless, so there is nothing to display and nothing that could disagree.

**The shape of the change.** A roof kind owns the cap cel's whole appearance: its shape, its material and its height. The existing skin loses its roof properties, becoming a wall-material axis for the base and band only. This is a real trade-off, recorded in ADR-0021: fusing the roof into one axis means every existing town's skyline changes, because the roof can no longer vary by building skin. That was chosen deliberately — it buys ten shapes where the alternative buys five shapes times two materials, and shape is far more legible at the fitted zoom.

**Containers get roofs too**, automatically, because they are drawn through the same pipeline. This is intended rather than tolerated: containers dominate the shallowest, most-read view, so that view becomes the varied one.

Verification is visual: run the town and see roofs that differ between neighbouring buildings, on both buildings and containers, stable across a reload.

**Blocked by:** 02, 03.

**Status:** done

- [x] A roof kind is a closed set, and two kinds ship: pitched (preserving today's look) and flat
- [x] The roof kind is selected by hashing the site's path, so the same repository always yields the same roofs
- [x] The hash input and the selection are deterministic and free of iteration-order dependence
- [x] Roof kinds are baked for every footprint, construction stage and damage state, so a roof appears correctly on a staked plot and on a damaged building
- [x] Building caps draw the selected roof kind; the base and the band are unaffected by it
- [x] Containers draw roofs by the same rule, using their own path
- [x] The skin's roof properties are gone, and the skin still drives wall material and framing on the base and band
- [x] The following invariants hold for every roof kind, proven by test rather than assumed: cells are non-empty, every pixel is on the palette, no pixel is semi-transparent, and no cel has artwork on its border
- [x] No change to the daemon, the wire format or the analyzer
- [x] The detail panel does not mention a building's roof
- [x] Verified live in a running town: neighbouring buildings show different roofs, containers show roofs, and a reload reproduces them exactly
- [x] Measured and recorded in the ticket's comments: the new total cel count and atlas dimensions

## Comments

### What shipped

`ui/src/art/roof.ts` is new and holds the whole axis: `ROOF_KINDS` (a closed set),
`hashPath`, `roofFor`, a `RoofKit` per kind, and the four accessors the rest of the
code needs (`roofHeight`, `roofTrim`, `buildRoof`, `buildRoofStack`,
`buildRoofDamage`). A kind owns **everything** above the wall — its shape, material,
rise, rooftop furniture and the way it breaks — so no roof detail leaked into
`building.ts`.

The axis swap is exact and cuts across three files:

| | before | after |
|---|---|---|
| `capFrame` | `cap:size:variant:stage[:dmg]` | `cap:size:ROOF:stage[:dmg]` |
| `capBox` | `capBox(side, skin)` | `capBox(side, roof)` |
| `buildCap` | `buildCap(side, skin, ...)` | `buildCap(side, roof, ...)` |
| `skinFor` | `{ wall, roof, roofHeight, framed }` | `{ wall, framed }` |

`skinVariant`, `skinFor` and `baseFrame`/`bandFrame` are untouched, so existing
walls keep their material and the base/band cels are unchanged in shape.

### The hash reads a different bit, and that is load-bearing

`roofFor` uses `(hash >>> 1) % N`, not `% N`. Reading the low bit — the same bit
`skinVariant` reads — would make every warm-walled building wear the same roof, so
the two ornaments would carry the same information. That is exactly the redundancy
this change exists to remove, so a test asserts the independence directly: over 200
paths, all `2 × N` (skin, roof) pairs must occur. Starting at bit 1 also stays
correct as the set grows, since bits 1–3 cover up to ten kinds — the atlas's own
ceiling.

### The count came out exactly neutral, which is a coincidence worth recording

The cap went from `2 skins × 64` to `2 roofs × 64` — **628 cels before and after**.
So the atlas did not grow at all in this ticket, and the sheet halved anyway
(2048×8192 → 2048×4096) because ticket 03's shorter cels are what the taller sheet
was paying for. The next kind is where the count actually moves: +64 cels each.

Measured per footprint, from the real tables: band 64, base 128, cap 128 (64 per
kind), shadow 4, ground 120, props 108, workers 76.

### Verified live, not inferred

Run on port 7822 against this repo, in the browser:

- **15 buildings, roofs split 7 pitched / 8 flat, interleaved** — neighbouring sites
  differ, which is the whole point. `ui` is pitched, `ui/src` is flat, `ui/src/art`
  pitched, `ui/src/art/props` flat.
- **Containers get roofs**, as ADR-0021 rule 5 intended: `internal/web/static` is
  pitched and its child `internal/web/static/assets` is flat.
- **Reload reproduces every roof**: 0 of 15 changed, both on an in-page reload and
  across a full daemon restart. Determinism is real end-to-end, not just in the
  unit test.
- **The detail panel reports no roof.** Clicked a building: it shows Kind, Path,
  Source files, Stage, Work here — and `/roof|pitched|flat/` does not match the page
  text anywhere.
- **Both silhouettes render and are distinguishable.** Extracted the two cap cels
  and read them as ASCII: the pitched cap is a triangle with a chimney at the apex;
  the flat cap is a straight lid with a rooftop housing on the deck. Confirmed both
  materials present in the rendered frame (stone slab 15,694 + 15,466 + 1,477 px;
  pitched roof ramp 4,098 + 230 + 85 px).
- **Live atlas**: 628 frames, 128 cap frames (`pitched` 64, `flat` 64), tallest
  `cap:100:pitched` at 91px, sheet 2048×4096.

A correction to ticket 03's comment: the tallest shipped cel is the **cap** at 91,
not the base/band at 83, so the atlas cell height is 93 and the true ceiling is
**1408** cels rather than 1536. Still above the ticket's 1400 target, but the
number in that ticket's table was computed from the base rather than the cap.

### Tests

Five new in `art.test.ts`, all over the flat two-dimensional tables:

- `a roof is a pure function of the path` — the same paths give the same roofs.
- `in a real town's paths, both roof kinds occur` — a roof nobody sees is ornament
  not delivered. Stated as "both occur" rather than an exact split, because the
  split is a property of those particular strings.
- `the roof does not restate the skin` — the bit-independence proof above.
- `each roof kind draws a different picture, and the cap answers to the roof not
  the skin` — catches a kind added to the set but wired to another kind's drawing.
- `a roof kind's cel is tall enough for everything it draws` — the anti-clipped-
  chimney check: nothing may touch the cap cel's top row, per kind.

The count test was rewritten to name the two axes separately, since the band and
base answer to the skin while the cap answers to the roof — and it now asserts every
kind in the set has a full complement of cap cels, so a kind with no drawing fails
loudly instead of rendering as a missing frame.

Suites green: art 72, visibility 19, light 1, atlas 5. `tsc` clean.

### Not done, deliberately

- No daemon, wire or analyzer change: `git status` on `internal/` shows only the
  rebuilt UI bundle.
- Metaphor-intensity setting still deferred (ADR-0021), as it needs a position to
  exist before it can be evaluated.
