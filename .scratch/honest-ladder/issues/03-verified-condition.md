# 03 — Make verification a condition

**What to build:** `BuildingState` gains `Verified bool`, set and cleared by
tests, and carried on the wire.

This is ADR-0018's split applied to a second axis. `Damaged` was separated from
`Status` because damage is a condition and folding it into the ladder made
"failed and fixed" indistinguishable from "never failed". Verification has the
same shape: it is a fact about the code, not a stage, and folding it in would
spend a structural rank on a verdict.

- a passing test sets `Verified = true`
- a failing test clears `Verified` and sets `Damaged = true`
- an edit never sets `Verified`

`Verified` and `Damaged` are mutually exclusive and together exhaustive, so the
pair is a three-state condition: good, broken, unknown.

**Blocked by:** 01

**Status:** done

- [x] `BuildingState.Verified` exists and is persisted in `stored`
- [x] A passing test sets it; a failing test clears it and damages
- [x] A missing field on an older state file reads as `false`
- [x] An edit never sets it, and a failure of any kind clears it (see Comments)
- [x] A test pins the three-state invariant: never both, never a passing test
      that leaves the building broken

## Comments

### One acceptance criterion was wrong and was not implemented as written

The ticket originally said *"an edit changes neither `Verified` nor `Damaged`"*,
citing the argument that an edit which does not compile is not a repair. That
second half contradicts **ADR-0004**, which states *"the next successful change
or test repairs it"*, and contradicts `town_test.go`, which asserts it with an
`edit` event. Implementing it would have silently broken a documented decision to
fix a defect in an unrelated feature.

So only the `Verified` half was taken. An edit never verifies; an edit still
repairs, exactly as ADR-0004 says. The rule shipped is narrower and the conflict
is recorded here rather than buried in the diff.

### A failure withdraws verification whatever caused it

The ticket said "a failing test clears it". The implementation clears on **any**
error, because an edit that does not apply is the same claim as a red suite: the
code is not known to work. Leaving the flag up after a failed edit would let a
building keep advertising a passing test suite that nothing has run since, which
is the exact overstatement the whole feature exists to stop.

### Verified is checked exhaustively, not sampled

`TestVerifiedAndDamagedAreNeverBothTrue` replays every ordered pair of seven
event kinds — 42 sequences — rather than a handful. It is the invariant the
renderer depends on and has no way to draw around, so it is worth the 42.

### No persistence version bump, as specified

`TestAnOlderStateFileReadsAsUnverified` loads a version-2 file with no `verified`
key and asserts both that it reads `false` and that the rest of the history
survives. The second half is the point: a default that quietly cost 12 touches
and one recorded problem would not be worth having.
