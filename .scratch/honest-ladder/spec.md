# The ladder should describe the code, not the work

## Problem

The construction ladder measures **event volume**, and is presented as though it
measured **code state**. Measured on this repository, the gap is not subtle:

| path | touches | problems | stage |
|---|---|---|---|
| `ui/src/art` | 201 | 1 | `doored` |
| `internal/analyzer` | 198 | 9 | `completed` |
| `ui/src` | 155 | 4 | `completed` |
| `ui` | 101 | 0 | `foundation` |
| `ui/test` | 58 | 2 | `completed` |
| `internal/town` | 56 | 1 | `walled` |
| `cmd/townd` | 8 | 1 | `planned` |

`ui` has 875 KB of source, 101 recorded touches and **zero** failures, and is
drawn on foundations. `internal/analyzer` is `completed` having failed nine
times. The ladder rewards volume and has no relationship to whether the code is
any good.

### Two distinct defects

**1. The bottom of the ladder is a lie.** `planned` → `roofed` is presented as
"how much of the building exists". But the code's existence *is* the building,
and the analyzer already knows every building's size. A directory is described
as unbuilt because nobody has pushed four edits at it.

**2. Verification has no representation, and test-driven work deadlocks.**
`Problems` counts failures; nothing counts passes. Worse, a passing test cannot
advance anything below `roofed` (`internal/town/town.go:154`). So a team whose
work is mostly running tests can never leave the bottom of the ladder, however
much they verify. `ui` is exactly this case.

The two compound: the ranks that would have recorded verification are
unreachable, and the ranks that *are* reachable record edits instead.

## Decision

Two changes, addressing the two defects separately.

### A. Seed structure from the tree

The analyzer derives a **seed stage** from a building's authored bytes, reusing
the thresholds it already owns. The bottom five ranks stop being earned and
start being read:

| authored bytes | seed |
|---|---|
| < 8 KB | `planned` |
| < 32 KB | `foundation` |
| < 128 KB | `framed` |
| < 512 KB | `walled` |
| ≥ 512 KB | `roofed` |

The top three ranks — `glazed`, `doored`, `completed` — stay event-driven, because
finishing trades genuinely are work and cannot be read off a file size.

This is the ADR-0012 shape applied to a second field: the map is a pure function
of the directory tree, and so is the structural half of its stage. Only the
finishing half is history, so only that half is stored.

Measured against this repository, the seed puts every building within reach of
being finished — `ui` reaches `roofed`, which is the whole point:

| path | authored | seed | was |
|---|---|---|---|
| `cmd/analyze` | 2 KB | `planned` | `planned` |
| `internal/web` | 28 KB | `foundation` | `foundation` |
| `internal/registry` | 59 KB | `framed` | `planned` |
| `internal/analyzer` | 120 KB | `walled` | `completed` (kept) |
| `ui/src` | 443 KB | `walled` | `completed` (kept) |
| `ui` | 875 KB | `roofed` | `foundation` |

### B. Make verification a condition, not a rank

`BuildingState` gains `Verified bool`, a condition beside `Damaged` and never a
rank. The two are mutually exclusive and together exhaustive: a building is
known-good, known-broken, or unknown.

- a passing test sets `Verified = true`
- a failing test clears it and sets `Damaged = true`
- an edit changes neither — code can change without anything being verified, and
  an edit is not a verdict

`Verified` is drawn as a pennant on the roofline, baked as a cap variant. It is
deliberately *not* a new ladder rung: verification is a fact about the code, and
a rung would spend a structural rank on it and re-create the same conflation.

### C. Retire the display-only silent-town lift

`drawStage` in `ui/src/art/building.ts` lifts `planned` to `framed` while the town
reports nothing. That was a display patch for a missing seed. Once the daemon
seeds honestly it is redundant, and shipping both would mean the UI quietly
disagreeing with the daemon about what a stage means — the exact split
ADR-0012 exists to prevent. It is removed, not kept as a fallback.

## Consequences

**Every existing town re-renders taller, once.** Buildings below their seed jump
up on the next daemon start. This is a one-time discontinuity and it is the
point: the old rendering was wrong. Nothing is lost — the finishing half of
every stored status is preserved, and a building at `completed` stays there.

**No persistence version bump.** `Verified` is a `bool` that reads `false` when
absent, which is the honest default: a building recorded before this change was
not verified. `persist.go` discards stale files so they are not *misread*, and a
missing boolean is not a misread. Bumping to 3 would throw away 786 touches of
real history to preserve a distinction that means nothing.

**The atlas grows by 320 cels**, to 1140, against a ceiling of 1408. Verified
caps are a second bake of the cap family, which is 320 cels today (measured, not
derived: 5 kinds × 4 sizes × 8 stages × 2 damaged), leaving 268 cels of
headroom. It needs no new placement logic — the flag rides the roofline the cap
already owns.

**The ladder's meaning shifts.** A rank now answers "how much of this building
exists and how finished is it", not "how hard has it been worked". `completed`
stops implying quality; that implication was never earned.

## Out of scope

- Counting passes (`Passes int` beside `Problems`). Worth doing — the data
  already flows — but it is a panel concern and changes no picture.
- The metaphor-intensity setting ADR-0004 promised. Still unevaluable until these
  positions settle.
- Letting a test advance a rank. Defect 2 is fixed by giving verification its
  own axis, not by loosening the gate that keeps a test from glazing a roofless
  building.
