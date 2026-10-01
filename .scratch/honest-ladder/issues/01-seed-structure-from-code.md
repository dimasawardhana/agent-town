# 01 — Seed the structural ranks from authored bytes

**What to build:** The bottom five ranks of the ladder stop being earned by
edits and start being read off the tree, so a building is drawn at the size its
source actually is.

`SeedStatus` maps a building's authored bytes onto `planned`…`roofed` using the
thresholds the analyzer already owns: 8 KB, 32 KB, 128 KB, 512 KB. The top three
ranks stay event-driven.

It belongs in `internal/town`, not the analyzer: the ladder vocabulary is
`town`'s, and the analyzer cannot import `town` without a cycle. The analyzer's
role is unchanged — it already publishes `AuthoredBytes`, so `town` reads the
same number `Floors` reads and the two cannot disagree about what "authored"
means.

**Blocked by:** None

**Status:** done

- [x] `SeedStatus` maps the four byte bands onto the five structural ranks
- [x] It uses authored bytes, not total, matching `Floors`
- [x] It never returns a finishing rank, whatever the size
- [x] A test pins each band, and a test pins that a huge pure artefact stays low
- [x] The ladder is still climbed one rank per event; seeding does not make an
      event advance two ranks

## Comments

Lives in `internal/town/town.go` and takes an `analyzer.Building` rather than a
byte count, so "authored, not total" is in the signature rather than in a
comment someone can route around.

Measured against the real tree, which is the check that matters — a band table
can be internally consistent and still classify everything wrongly:

| path | authored | seed |
|---|---|---|
| `cmd/analyze` | 1,947 | `planned` |
| `internal/web/static/assets` | 0 | `planned` |
| `internal/agent/extension` | 11,819 | `foundation` |
| `internal/web/static` | 15,740 | `foundation` |
| `cmd/townd` | 23,971 | `foundation` |
| `internal/web` | 28,119 | `foundation` |
| `internal/registry` | 59,186 | `framed` |
| `internal/agent` | 63,608 | `framed` |
| `internal/town` | 70,766 | `framed` |
| `ui/test` | 99,994 | `framed` |
| `ui/src/art/props` | 101,409 | `framed` |
| `internal/analyzer` | 122,061 | `framed` |
| `ui/src/art` | 302,591 | `walled` |
| `ui/src` | 445,329 | `walled` |

`ui` itself is a container rather than a building, so it is not in this table;
at 875KB it would seed to `roofed`, which is the point — the building with 101
touches and no failures finally has a roof, and its tests can now buy finishing
ranks instead of being discarded.

The band test pins both sides of every threshold (7,999 and 8,000) so a boundary
that drifts in either direction fails rather than reclassifying buildings
silently. Verified by mutation: switching the function to read `TotalBytes`
fails `TestSeedStatusBands` and `TestSeedStatusReadsAuthoredNotTotal`.

`TestSeedStatusReadsAuthoredNotTotal` carries its own fixture check — it
asserts that 1.7MB of total *alone* seeds to `planned` — so if the two readings
ever stop disagreeing the test refuses to pass rather than quietly proving
nothing.

Not yet wired to anything: `SeedStatus` has no call sites outside its own tests,
which is correct for this ticket. It goes live in 02, on `Load`.
