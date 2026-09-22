# ADR-0018: The building lifecycle is one ordered ladder, and damage is not a rank

## Context

Every building has a lifecycle. The PRD (§12, §13) named seven states —
PLANNED, FOUNDATION, CONSTRUCTING, TESTING, COMPLETED, BROKEN, ARCHIVED — and
the code implemented five of them (`untouched`, `constructing`, `testing`,
`completed`, `broken`). Two defects came out of the gap between the two lists.

**The status field served two jobs.** It held both the building's progress and
its condition, so `broken` was simultaneously "a rank you reach" and "a thing
that happened to you". Neither survived. Ranked as a stage, `broken` sat at
rank 0, so a successful delete — which maps to it — could never apply to a
building that had anything built. Used as a condition, it *overwrote* the
progress: a building that had reached its roof and then failed a test lost the
roof. ADR-0004 already described the correct behaviour ("A damaged COMPLETED
building means it passed tests initially but later broke"), but the type could
not represent it.

**`completed` was unreachable.** It was declared, ranked highest, and assigned
nowhere. Two independent causes: nothing computed it, and *no test could ever
reach a building at all* — `Classify` sent every shell command, tests included,
to the Yard. So the ladder's top rank was dead code, and the finished building
was dead art.

**A single event jumped the whole ladder.** `statusFor` mapped an action onto a
status directly, so one edit set a building to `constructing`, which was drawn
as framing plus 60% walls plus scaffold. There was no rank for "just the
pillars", so a building could not be seen to be part-built; it was a pillar, or
almost-finished, or nothing.

## Decision

**One ordered ladder of eight ranks, each adding exactly one part of a building,
and damage held as a separate condition.**

```
PLANNED → FOUNDATION → FRAMED → WALLED → ROOFED → GLAZED → DOORED → COMPLETED
```

1. **Rank maps to a part.** Each rank means one more thing is standing: stakes,
   footings, frame, walls, roof, windows, door, trim. The renderer draws every
   part up to the rank, so a stage is by construction the stage below it plus
   exactly one part, and no stage can skip one.

2. **An event advances at most one rank.** `advanceBy` returns the rank one
   above the current one, never a status chosen from the action. A change makes
   one course of structure; the next change makes the next.

3. **Structure by change, finish by test.** The first four ranks are raised by
   `BUILD`, `HAMMER` and their file-event equivalents. The last three are raised
   by a passing `TEST` — and only once the building is `ROOFED`, because a test
   verifies work rather than raising a roof. Reads, shell commands and planning
   events advance nothing.

4. **A test that names a building is that building's test.** A shell tool
   carries no path, so `testTargets` reads the directory arguments out of the
   command and `Resolver.ResolveDir` maps them to a building. A whole-repo run
   (`go test ./...`, `npm test`) names no one building and stays in the Yard —
   the town does not guess where work happened.

5. **Damage is a condition, not a rank.** `Damaged` is set by a failed tool and
   cleared by the next success, at whatever rank the building holds. `Problems`
   keeps the running count as history. A failure never moves a building down the
   ladder.

6. **The renderer knows the same ladder.** `STAGE_ORDER` in `ui/src/art/
   building.ts` is asserted against `AllStatuses()` rank by rank, and every rank
   must appear both in `PART_FOR_STAGE` and as a draw guard in the compositor. A
   rank the renderer cannot draw is a build failure, not a blank building.

## Why

The alternative was to keep a flat status and set it from the action, which is
what the previous shape did and what produced all three defects. A ladder where
each rank is a part is the only shape that answers the question the map is
actually asked — *how finished is that building?* — from the status alone, with
no interpolation and no second field to consult.

Gating the finish on tests was the decision that made the ladder work. It gives
a test run a destination on the building it verified, which is what the Yard
could never provide, and it is the mechanism that finally reaches `COMPLETED`.
The alternative — completing a building on its Nth change — was rejected
because it would make "complete" mean "edited a lot" rather than "verified".

Separating damage from status is what makes ADR-0004's own description true, and
it is strictly more informative: a reader can now tell a building that was never
started from one that was finished and has since broken.

## Consequences

- **The ladder is strictly increasing and every rank is reachable.** Asserted by
  `TestEveryRankIsReachableOnePartAtATime`, which climbs the whole ladder one
  event at a time and checks each step moves exactly one rank.
- **`ARCHIVED` is not implemented and not planned.** A project whose path
  disappears becomes *Unreadable* at the project level (ADR-0015); there is no
  per-building archive, and no event could set one. It is recorded here as
  deliberately absent rather than left to be discovered.
- **Persistence version 2.** A version-1 state file holds the old vocabulary
  including `broken`, which is not a rank, so `Load` discards it. Since the
  event store is unbuilt (ADR-0003), the ladder cannot be reconstructed from a
  stale file — starting fresh is the only honest option.
- **Damage is baked, not overlaid.** The atlas holds a damaged variant of every
  stage, because the damage drawing depends on how far the building got: there
  is no wall to crack until there are walls. A runtime tint could not do that.
- **Reachability is a test, not a promise.** The original defect survived
  because nothing asserted that a declared rank could be reached. That is now
  the first property the ladder's test checks.
