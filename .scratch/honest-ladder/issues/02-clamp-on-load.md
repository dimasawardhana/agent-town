# 02 — Clamp restored status up to the seed

**What to build:** On load, every restored building rises to its seed if it sits
below it, keeping the finishing half of whatever it had.

`status = max(seed, stored)` on the structural half, which is just
`if b.Status < seed { b.Status = seed }`. Idempotent: loading twice changes
nothing the second time, and a building at `completed` stays there.

This is where the discontinuity is absorbed. It belongs in `Load` rather than in
`New` because `New` has no stored state to reconcile, and in `Load` because that
is the one moment a persisted status and a freshly-walked tree meet.

**No persistence version bump.** `Verified` arriving in ticket 03 reads `false`
when absent, which is honest rather than stale. Bumping would discard 786
recorded touches to preserve a distinction that carries no meaning.

**Blocked by:** 01

**Status:** done

- [x] `Load` raises any building whose stored status is below its seed
- [x] A building at `completed` is left at `completed`
- [x] Loading twice is idempotent
- [x] A stored status for a path that no longer exists is still dropped
- [x] The existing `persistenceVersion` guard is untouched

## Comments

`New` now seeds every building, which is the part the ticket did not say but
without which it cannot work: `Load` clamps the buildings it finds, and a
building nobody has ever worked on has no stored entry to clamp. Seeding in
`New` means the live snapshot carries all 15 rather than only the handful with
events against them.

That is what broke three existing tests, and all three were using "the list is
empty" as a proxy for "no history was recorded". Each now asserts the claim it
was actually making — no touches, no problems, no adopted status — which is a
stronger assertion than the proxy was, not a weaker one.

Verified by mutation: restoring the old `Load` (which replaced the map wholesale
and ignored the seed) fails `TestLoadRaisesAStoredStatusToTheSeed` and
`TestLoadDropsAStoredPathThatNoLongerExists`.

Measured on the real repository, this is the discontinuity:

| path | was | now |
|---|---|---|
| `ui` | `foundation` | **`roofed`** |
| `internal/registry` | `planned` | `framed` |
| `internal/agent` | `planned` | `framed` |
| `cmd/townd` | `planned` | `foundation` |
| `internal/analyzer`, `ui/src`, `ui/test` | `completed` | `completed` (kept) |
| `ui/src/art` | `doored` | `doored` (kept) |

`ui` is the case that started this: 109 touches and no failures, previously on
foundations, now roofed and able to buy finishing ranks.

Two fixture mistakes worth recording, because both produced a test that would
have passed for the wrong reason.

**Buildings are directories, not files.** A stored path of `src/a.ts` matches
nothing — the building is `src`. A fixture naming the file restores silently
nothing, which reads as a passing test.

**A 200KB fixture written as zero bytes measures as an empty building.** The
analyzer excludes binary and minified-looking content, so `make([]byte, 200_000)`
is not a large building, it is no building. `writeBulk` exists for that now and
writes real text.
