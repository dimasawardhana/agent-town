# 05 — Retire the display-only silent-town lift

**What to build:** Remove `drawStage`, `FIRST_BUILT_STAGE` and the `statusOf`
branch that lifts a `planned` building to `framed` while the town is silent.

That lift was a display patch for a missing seed, added because a town reporting
nothing drew mostly bare dirt. Once the daemon seeds honestly there is nothing
left to patch, and shipping both would mean the browser quietly disagreeing with
the daemon about what a stage means — the browser/daemon split ADR-0012 exists to
prevent. `statusOf` goes back to reading the status it is given.

This is a clean cutover, not a fallback. The behaviour it produced is now the
daemon's to produce, and a UI that second-guesses it is a bug waiting for the
two sides to drift.

**Blocked by:** 01, 02

**Status:** done

- [x] `drawStage` and `FIRST_BUILT_STAGE` are gone
- [x] `statusOf` reads the status and nothing else
- [x] The scene no longer reads `events` to decide a stage
- [x] The blank-band invariant survives as a direct ladder assertion
- [x] A silent town still looks like a town, because the daemon seeded it — the
      browser is no longer what makes that true

## Comments

Removed from `scene.ts`: the import, the `silent` computation, and the
`drawStage` call. `statusOf` is four lines again and reads the status the daemon
gave it. The scene no longer touches the store's `events` at all — silence is not
something the renderer has an opinion about any more.

Removed from `art/building.ts`: both exports. `FIRST_BUILT_STAGE` existed only to
give `drawStage` something to name, and naming the first rung that draws ink is
now a test's job rather than the renderer's.

### The test was rewritten, not deleted

The old test asserted what the *patch* did. What remains asserts the **ladder
fact** underneath it, which the daemon now depends on: `planned` and `foundation`
bands are blank, `framed` is the first that draws. That matters twice over,
because `SeedStatus` seeds the structural half and so which rung is the first
that puts ink on a storey decides what a small building looks like.

The predicate was inverted on the first attempt — it asserted the planned band
*draws*, when the claim is that it does not — and the test caught it immediately.
Recorded because a test that passes for the wrong reason is worse than no test.

### Verified end to end, not just by suite

With the daemon seeding and the browser no longer second-guessing it, the live
town carries all 15 buildings with real stages: 4 `completed`, 1 `doored`, 1
`roofed`, 4 `foundation`, 3 `framed`, 2 `planned`. The two `planned` are the
1-storey directories that genuinely seed at the bottom — `cmd/analyze` at 1,947
bytes and `internal/web/static/assets` with no authored mass at all.
