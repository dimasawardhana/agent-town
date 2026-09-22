# Building a house: when and how a building gets finished

This is the operator's guide to the building lifecycle. It answers the question
the map is asked in practice — *why is that building still a frame, and what do I
have to do to finish it?*

It is deliberately about the **rules as the code implements them**, every claim
in it checked against a running daemon rather than read off the design. Where a
rule has a sharp edge, the edge is stated: several of them will surprise you.

For *why* the ladder is shaped this way, see
[ADR-0018](adr/0018-building-lifecycle-ladder.md). For how each rank is drawn,
see [DESIGN.md § The building ladder](../DESIGN.md).

---

## 1. The short answer

A building becomes a house in **seven events**: **four changes** to raise the
structure, then **three passing tests scoped to that building** to fit it off.

```
PLANNED ──change──> FOUNDATION ──change──> FRAMED ──change──> WALLED ──change──> ROOFED
                                                                                  │
                                       COMPLETED <──test── DOORED <──test── GLAZED <──test
```

Nothing else contributes. Reading a file, running `go build`, planning, listing
directories, and whole-repo test runs all advance **nothing**, however much work
they represent.

---

## 2. What counts as a building at all

This is decided **before any event arrives**, by the analyzer walking the
directory tree (`internal/analyzer/analyzer.go`).

- A directory becomes a building **if it holds source files directly**. Not
  underneath it — *directly*.
- **The repo root is never a building.** Its files belong to the Workshop.
- A directory holding only subdirectories is not a building; its subdirectories
  each may be.

So `internal/town/` with `town.go` in it is a building. `internal/` with only
directories under it is not. A file at the root — `README.md`, `package.json` —
lands in the Workshop, and the Workshop is not on the ladder at all: it can
never be finished, because it is not a building.

**A directory that holds no source directly can never become a building**, no
matter how much you work in it. It is not a building that stays unfinished; it
is not a building. Work there is site-wide work and is staged in the Yard.

### Size is fixed at analysis time

A building's footprint comes from how much source it holds (world units on a
side):

| Files | Footprint | Reads as |
| --- | --- | --- |
| ≤ 2 | 44 | a hut |
| ≤ 5 | 60 | a cottage |
| ≤ 12 | 78 | a workshop |
| > 12 | 100 | a hall |

The material follows the same thresholds (`ui/src/art/building.ts:skinFor`), so a
big directory is a big stone hall rather than a small cottage drawn large. **A
building's size does not change as you work on it** — it is a reading of the
tree, not of the session. Add enough files to cross a threshold and the building
is redrawn larger on the next analysis.

---

## 3. The eight ranks, and the one part each adds

| Rank | Part added | What you can see |
| --- | --- | --- |
| `planned` | stakes | cleared plot, four corner stakes, string lines |
| `foundation` | footings | trench outline, four stone pads, spoil heap |
| `framed` | frame | stud posts and beams at full height, open to the sky, scaffold up |
| `walled` | walls | the shell closed, painted or timber-framed per material |
| `roofed` | roof | gable roof and eaves; **scaffold struck, spoil cleared** |
| `glazed` | windows | lit openings punched into both visible walls |
| `doored` | door | a doorway with a lintel, so the building has an inside |
| `completed` | trim | plinth, corner boards, fascia, and the chimney |

Rendering is **cumulative**: the picture for a rank is every part up to it drawn
in order. That is what makes a rank trustworthy — a stage is by construction the
stage below it plus exactly one thing, and a roof cannot appear on a building
with no walls.

Two things on the plot are **not** ranks, because they belong to the *site*
rather than the building. They come and go on their own:

- **Scaffolding** is up from `framed` until `roofed`. It is not "gained" by a
  rank; it is present for part of the building's life.
- **The spoil heap** is left by `foundation` and cleared once the finish begins
  at `glazed`.

---

## 4. When a rank is raised

Two rules, and they are the whole mechanism (`internal/town/town.go:advanceBy`).

### Rule 1 — structure is raised by making changes

The first four ranks come from an event whose action is `build` or `hammer`:

| Tool (as normalized) | Action | Advances structure? |
| --- | --- | --- |
| `edit`, `patch`, `multiedit` | hammer | **yes** |
| `write` | build | **yes** |
| `read`, `grep`, `glob`, `list` | read | no |
| `bash`, `shell` | command | no |
| `todo`, `task`, `hub`, `eval`, `ask`, `reflect` | plan | no |

`ActionBuild` and `ActionHammer` are the same as far as the ladder is concerned.
Creating a file and editing one both add one course of structure.

### Rule 2 — finish is earned by passing tests

The last three ranks come from an event whose action is `test` — **and only once
the building is already `roofed`.**

> **This is the rule people trip on.** A test on a building that is still
> `planned`, `foundation`, `framed` or `walled` advances it **by nothing at all**.
> It is not queued, not banked, and not applied when the roof arrives. A test
> verifies work; it does not raise a roof.

So the order is not merely conventional, it is **enforced**:

```
4 × change    → ROOFED
3 × test      → GLAZED → DOORED → COMPLETED
```

Changing after `roofed` does nothing (the building is already weathertight).
Testing before `roofed` does nothing (there is nothing to fit off yet).

### One event, one rank

Each qualifying event raises at most **one** rank. There is no way to jump. A
single edit on a `planned` building makes it `foundation`, not `framed`, and a
single test on a `roofed` building makes it `glazed`, not `completed`.

This is deliberate: it is what lets the map show a building as *part-built*
rather than as a pillar or an almost-finished thing.

---

## 5. How a test gets credited to a building

A shell tool carries no path — the command string is the only signal — so the
daemon reads directory-looking arguments out of the command and asks the
resolver what each one is (`internal/town/action.go:testTargets`).

**It must be a test command.** Recognized invocations include `go test`,
`cargo test`, `vitest`, `jest`, `pytest`, `playwright`, `cypress`, `rspec`,
`phpunit`, `npm test`, `pnpm test`, `yarn test`, `bun test`, `tsc --noEmit`,
`typecheck`, `type-check`.

**It must name a directory.** Verified behaviour:

| Command | Credited to |
| --- | --- |
| `go test ./internal/town` | `internal/town` |
| `go test internal/town` | `internal/town` |
| `go test ./internal/town/` | `internal/town` |
| `go test ./internal/town/...` | `internal/town` |
| `go test -run TestFoo ./internal/town` | `internal/town` |
| `cd internal/town && go test .` | `internal/town` |
| `tsc --noEmit -p ui/tsconfig.json` | `ui` |
| `go test ./internal` | **Yard** — `internal` is not itself a building |
| `go test ./...` | **Yard** — names a set, not a place |
| `npm test` | **Yard** — names nothing at all |
| `npm run typecheck` | **Yard** — no path argument |
| `go test` | **Yard** — no arguments |
| `go vet ./internal/town` | **Yard** — `go vet` is not in the test list |

Three sharp edges, all confirmed:

- **A pattern names a set, not a place.** `./...` and `*` are stripped or
  dropped. `go test ./...` can never finish a building — this is the single most
  common reason a building sits at `roofed` forever.
- **`--prefix`, `--workspace` and similar forms are not understood.**
  `npm test --prefix ui` goes to the Yard.
- **Flags must come after the program but the directory must be present.**
  `-run`, `-race`, `-count` and other flags are ignored, not misread — but a
  command with no directory argument has nothing to resolve.
- **`go vet`, `go build`, `eslint`, `golangci-lint` are not tests here.** They
  are shell work and land in the Yard, so they advance nothing even when scoped
  to a building.

**The deepest match wins.** `go test ./internal/town/api` resolves to
`internal/town/api` if that is a building, and to `internal/town` if it is not.

---

## 6. Damage: what a failure does

A failed tool does **not** move a building down the ladder, and does not stop it
being finished. It sets a condition (`internal/town/town.go:Apply`):

- `damaged` becomes **true**. The building is drawn with rubble, a crack, or a
  hole in the roof — whichever its rank can support. There is no wall to crack
  before there are walls, and no roof to hole before there is a roof.
- `problems` **increments and is never cleared.** It is history: the running
  count of failures here.
- The rank **does not change**, up or down.

The next **successful** `build`, `hammer` or `test` on that building clears
`damaged` — *and may also advance it*. Repair and progress are separate facts,
which is why a `completed` building can be repaired: it has no rank left to
reach, but it can still stop being damaged.

### Verified sequence

```
edit                       → foundation
edit                       → framed
edit                       → walled
edit                       → roofed
edit                       → roofed      (already weathertight; no change)
go test ./internal/town    → glazed
go test ./internal/town    → doored
go test ./internal/town    → completed
go test ./internal/town    → completed   (top of the ladder)
go test ./...              → completed   (whole-repo run: nothing)
read internal/town/town.go → completed   (a read builds nothing)

go test ./internal/town (fails)
                           → completed, damaged = true, problems = 1
                           (condition changed; rank did not)

edit internal/town/action.go
                           → completed, damaged = false, problems = 1
                           (repaired; the failure is still on the record)
```

Note the last line: **`problems` stays at 1.** Repairing a building does not
erase the fact that it broke.

---

## 7. Can a building be un-built?

No. The ladder is **strictly increasing** — there is no rank below `planned` and
no event moves a building down it.

**Deleting a building's files does not demolish it — and mostly does not even
remove it.** Two things are separate here, and both surprise people:

- **The map loses the building.** A site is placed for a directory only if it
  holds source *now*, so once you delete the last source file directly inside it,
  the next analysis stops placing it and the building disappears from the map
  (`layout.sites` no longer has it). Verified: after deleting the only file in
  `src/gone`, the site list became `[yard, workshop, depot, building:src/keep]`.
- **The state is still held.** Its entry survives in the live state, because the
  state file is a record of what happened rather than a view of the tree. Nothing
  renders it, so this is harmless — but it does mean the rank is still there if
  the directory comes back with source in it.
- **A `delete` tool call advances the building it is in.** The adapter *derives*
  an event's Type from the tool name (`ToolToEventType`) and does not read a
  supplied one, so `delete` — which is not in that table — falls to its default,
  `FILE_EDITED`. `Classify` then matches on that Type before it ever consults its
  own delete table, so the event is a hammer. Verified: a `delete` after one edit
  took a building from `foundation` to `framed`, and sending an explicit
  conflicting `type` on the frame changed nothing.

  The consequence is worth stating because it is a latent trap: the
  `ActionDemolish` path in `Classify` (`deleteTools`) is **unreachable from a real
  frame**, for any tool, because `ToolToEventType` always supplies a Type and the
  Type check precedes the tool-name switch. The `demolishing` animation is
  therefore dead art in the current build.

So there is no way to demolish a building in the current build. The
`demolishing` animation exists in the art and a `demolish` action exists in the
vocabulary, but nothing routes an event to it.

## 8. When progress is lost

Progress lives in a state file, not in the events, so what survives a restart
matters.

- **Saved to** a per-project state file under the user's data directory, keyed by
  the project's absolute path (`internal/town/persist.go`). It is AI Town's
  record, not a file placed in your repository.
- **Restored on restart**, so a building that was `roofed` comes back `roofed`.
- **Discarded if the file's format version is stale.** The format is versioned,
  and a file from an older build is thrown away rather than misread — a town is a
  cache of what happened, and starting fresh beats starting wrong.
- **The event store is unbuilt** ([ADR-0003](adr/0003-dual-persistence.md)), so
  the ladder **cannot be reconstructed** from a stale or missing file. Losing the
  state file means every building restarts at `planned`.
- **The map itself is never lost.** Geometry is recomputed from the directory
  tree on every start, because it is a pure function of that tree.

## 9. Recipes

### Finish one building, minimally

Four changes then three scoped tests. Anywhere a file is touched inside the
directory counts, and the tests must name the directory:

```bash
# 4 changes — any edits or writes inside internal/town/
#   the agent does this itself while working

# 3 passing tests, scoped by directory
go test ./internal/town
go test ./internal/town
go test ./internal/town
```

Result: `completed`.

### Finish everything in a monorepo-ish repo

There is no single command. A whole-repo run names no building, so **each
building needs its own scoped run**:

```bash
for d in $(find . -name '*.go' -not -name '*_test.go' -exec dirname {} \; | sort -u); do
  go test "./$d"
done
```

Each of those credits its own directory. A building that has not reached
`roofed` will ignore its run.

### Building sits at `roofed` and will not finish

The tests are not reaching it. Check, in order:

1. Is the test command **one of the recognized ones**? `go vet`, `go build` and
   linters are not.
2. Does it **name a directory**? `go test ./...` and `npm test` do not.
3. Is the directory the one **the building is**? `go test ./internal` credits
   nothing if `internal` itself holds no source.
4. Is the test **passing**? A failure damages the building instead — the rank
   holds, but nothing advances.
5. Is the building actually `roofed`? Count the changes. Three edits leave it at
   `walled`, where tests legitimately do nothing.

### Building will not rise past `walled`

Something is not being counted as a change. Reads, shell commands and planning
events advance nothing — so a session that runs commands all day without editing
a file inside that directory will leave its buildings where they were.

### "I deleted the directory and the building is still there"

It is not. The map lost the building; what you are looking at is a neighbouring
one, or the same directory re-analyzed. Delete every source file directly inside
a directory and it stops being a building on the next analysis.

---

## 10. Quick reference

| | |
| --- | --- |
| Ranks | 8, strictly increasing, one part each |
| Advances structure | `edit`, `patch`, `multiedit`, `write` |
| Advances finish | a recognized test command naming a directory, **only if already `roofed`** |
| Advances nothing | reads, searches, shell work, planning, whole-repo tests, linters |
| Per event | one rank, maximum |
| Minimum to finish | 4 changes + 3 scoped passing tests |
| Effect of a failure | `damaged = true`, `problems++`, **rank unchanged** |
| Effect of next success | `damaged = false`, and possibly one rank up |
| Can it go down? | No |
| Can it be demolished? | No — and `delete` counts as an edit |
| Does work outside a building count? | No. It is Yard work |
| Size and material | Fixed by file count at analysis time |
| Survives restart? | Yes, from the state file; discarded if its version is stale |

### Where the rules live

| Rule | File |
| --- | --- |
| The ladder, ranks, and one-rank-per-event | `internal/town/town.go` |
| Which events qualify, as tests | `internal/town/town_test.go` |
| Test-command matching and directory extraction | `internal/town/action.go` |
| What makes a directory a building; size thresholds | `internal/analyzer/analyzer.go`, `layout.go` |
| Which directory a path resolves to | `internal/analyzer/resolve.go` |
| How a rank is drawn | `ui/src/art/building.ts` |
| Persistence format and version | `internal/town/persist.go` |
