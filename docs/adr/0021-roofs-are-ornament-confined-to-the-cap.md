# ADR-0021: Roofs are deliberate ornament, confined away from every measured channel

## Context

The town draws a building's form from exactly two measured facts: **height** from
total source bytes (`floorsForBytes`, 1–20 storeys) and **footprint** from source
file **count** (four baked sizes, 44/60/78/100). The construction ladder and
damage add two more: a building's shape says how much code it is, and its state
says how much work has landed on it.

A request for "variants — skyscraper, tower, airport, station" therefore had two
possible readings, and they are not compatible:

- **A reading of a third software fact** — a building's *role* (entry point, test
  suite, public boundary). The map stays a map: every difference on screen means
  something in the repo.
- **Pure variety** — the same facts, drawn with more visual difference.

The first was investigated and rejected on evidence. The analyzer computes
nothing that identifies a role: no manifest detection, no test-file ratio, no
entry-point convention, no leaf detection. Only the file count and the path are
read. Role variants would therefore need new analyzer work, and the signals
available are language-specific guesses — a `main.go` heuristic is meaningless in
a repo whose entry point is `index.ts`. ADR-0004 §9 had already named "the
metaphor exhausts itself — the mapping becomes arbitrary" as a failure mode, and
inventing per-language role heuristics is a good way to walk into it.

The second was chosen. This ADR records that choice, because the obvious reading
of the code is the opposite one: a data visualisation that adds *meaningless*
difference to its output looks like vandalism, and a future reader will want to
know it was deliberate.

## Decision

**A building's roof is chosen by hashing its path, and it is confined to the cap.**

1. **The roof is arbitrary by construction.** `skinVariant(path)` — already in the
   codebase for the path-hashed skin — picks the roof, widened from mod-2 to
   mod-N. It is stable across sessions and identical for a given repo, so the town
   remains a pure function of the project (ADR-0012); it just is not a function of
   anything *meaningful*.

2. **The roof is the only ornament, and it owns the cap.** A building's height
   still means bytes and its footprint still means file count. Those three — cap,
   band, base — are where the measured readings live, and the ornament is confined
   to the cap so a reader can tell at a glance which channels to trust.

3. **The roof axis replaces the existing skin on the cap, rather than multiplying
   with it.** The skin's `roof` and `roofHeight` fields *are* roof properties, so
   a roof kind absorbs them and the skin becomes a wall-material axis only. The
   skin's own cap contribution is the weakest part of it, measured: of the 64
   (footprint × stage × damage) variant pairs, **48 produce byte-identical cap
   cels** — the two skins differ on the cap at only two of the four footprints.
   Folding the roof into the cap therefore removes a partly-idle axis at the same
   time as it adds a live one. The same measurement on the base finds 54 of 64
   identical and on the band 27 of 32, so the skin is worth keeping where it
   still varies — and it stays a wall-material axis there.
   This is not only a cosmetic preference: multiplying the two axes would reach
   the atlas ceiling twice as fast (below).

4. **The roof rises from the base as a closed set**, one per building — not
   composable tags. Matches the codebase's existing habit (`Stage` and `Place` are
   both closed sets).

5. **Containers get roofs too**, automatically, since they are drawn through the
   same pipeline. This is worth stating because it is a choice rather than an
   accident: containers are most of the shallowest, most-read view, so that view
   becomes the varied one.

6. **A `MAX_CEL` guard ships with this**, because the change moves the atlas
   toward a limit that currently fails silently.

## The cost, measured

Counted from the real tables, not estimated: `STAGE_ORDER` = 8, `GROUND_KINDS` =
6, `EDGES` = 4, `ALL_PROP_KINDS` = 54, worker frames = 38 per tier over 10 states.
The non-building families are fixed at **308** cels (shadow 4, ground 24, ground
edges 96, props 108, workers 76), and today's total is **628** — which is what the
live atlas holds.

Base and cap are `4 sizes × 8 stages × 2 damaged = 64` per axis value.

| | band | base | cap | shared | total |
|---|---|---|---|---|---|
| **Before** (2 skins everywhere) | 64 | 128 | 128 | 308 | **628** |
| **N=4 roofs, skins kept on base** | 64 | 128 | 256 | 308 | **756** |
| **N=6** | 64 | 128 | 384 | 308 | **884** |
| **N=10** | 64 | 128 | 640 | 308 | **1140** |
| **N=14** (the ceiling) | 64 | 128 | 896 | 308 | **1396** |

The atlas is `nextPow2(16 × cellW) × nextPow2(ceil(cels/16) × cellH)`.

**The ceiling moved after this ADR was written, upward.** It was first costed at a
tallest cel of 113 px, which put 8192 at 72 rows = 1152 cels, and the ten-roof row
above was the ceiling at the time. Separating each cel to the height it actually
drawn — the base needed no roof headroom, and the ground shadow none at all —
lowered the tallest cel to **91 px** and the cell height to **93**, which raises the
ceiling to **88 rows = 1408 cels**. So the original cost is conservative:
**fourteen roofs fit, fifteen do not**, where ten was the figure when this was
written. The five kinds that shipped occupy **820 cels** at a sheet of 2048×8192.

The alternative — letting a roof kind multiply with the skin axis rather than
replacing it on the cap — gives `4 × 2 × N × 8 × 2` cap cels. At N=4 that is
**1012 cels against 756**, and against the same 1408 ceiling it runs out at eight
where replacing still has room for fourteen. Rule 3 exists to prevent exactly that:
it buys the same four looks for 256 cels instead of 512, which is the difference
between a feature that can grow to fourteen roofs and one that is out of room at
seven.

A roof taller than today's (a spire) also raises `cellH` for *every* cel in the
sheet. At the current cell height that costs roughly **160 cels of ceiling per
12 px of height** — more than the ~110 it cost at 113 px, because a shorter cell
means each extra row is a larger share of what is left. A spired kind therefore
buys its look with headroom, and buys noticeably more of it than this ADR
originally assumed.

## Consequences

- `bake.ts`'s `capFrame` gains a roof kind and `capBox` takes its height from the
  kind rather than from the skin. `skinFor` loses `roof`/`roofHeight` for the cap,
  keeping them only where the base and band read them.
- **The skin is not a dead axis and this ADR does not claim it is.** `skinFor`'s
  file-count thresholds are deliberately the analyzer's own footprint steps, so
  the *tier* restates the footprint by design ("so that size and material always
  say the same thing"). The *variant* — the path hash — is live on the base and
  band. Only its cap contribution is mostly idle, and that is what this change
  reclaims.
- `everyCel()` in `art.test.ts` mirrors the bake loop by hand, so a new axis added
  to `bake()` and missed there leaves the palette/transparency invariants silently
  incomplete. Any change to this table must touch both.
- The `MAX_CEL` guard converts an oversized atlas from a **blank texture** — which
  is how an oversized canvas actually fails, and why `paintGround` already has
  this guard — into a boot failure.
- **Rejected: role variants.** Recorded so nobody re-proposes them without new
  analyzer work. `Site.Total` (the recursive file count) is already computed by the
  analyzer and still not sent, so a "hub" reading is cheap if it is ever wanted —
  but it is a different feature from this one and would need its own decision.
- **Rejected: a new Place for "airport/station".** `Place` is a closed set of four
  (Building, Workshop, Yard, Depot), and a fifth member would need a fifth *kind of
  event* to route there. The action vocabulary has no routing event. The
  airport/station look is a roof kind.
- **Deferred: the metaphor-intensity setting.** ADR-0004 promised low/medium/high
  and it was never built. It is the natural home for "turn the ornament off", but
  a three-position setting cannot be evaluated before one position exists.
