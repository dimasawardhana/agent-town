# ADR-0015: Analysis is bounded by a file budget, and detail is a display concern

## Context

Two requirements pulled against each other. The daemon had to survive being
pointed at something enormous — measured, `~/` is 20,827 buildings and takes
about 50 seconds to analyze, with no timeout, cap, or depth limit in the
analyzer. And the developer wanted to limit how much of the town is drawn,
loading deeper detail only when needed.

The obvious implementation — bound the *analysis* by depth — was measured and
rejected. Depth is a bad proxy for size, because it truncates by tree shape
rather than by cost:

| Repo | Full | depth<=2 | depth<=3 | depth<=4 |
|---|---|---|---|---|
| agent-town | 11 buildings | 1 | 8 | 10 |
| wedding-invitation | 19 | 0 | 6 | 15 |
| `~/Documents/code` | 4063 | 15 | 62 | 164 |

At depth 2 the wedding-invitation town is empty, and depth 4 keeps 80% of the
work anyway.

Worse, trimming the input to `LayoutTown` **moves buildings that were already
on screen**. Buildings are placed by index into a sorted slice, and districts
are placed in a wrapping row, so removing one shifts the others — including
across districts:

- depth-trimmed: 12 of 18 buildings moved in wedding-invitation at depth 3
- removing one district moved 4 building sites in *other* districts

That is precisely the loss ADR-0012 exists to prevent.

## Decision

**Analyze the whole tree, bounded by a file budget. Filter for display.**

- Analysis stops after visiting `--max-files` source files (default 2000).
  `filepath.WalkDir` walks in lexical order, so the bound is deterministic.
  Measured: a budget of 2000 keeps every real repository intact (all 11 of
  agent-town's buildings) and caps `~/` at 43ms instead of 50 seconds.
- **Depth limits only what is drawn.** The layout is computed once from the
  full analysis; shallower sites are sent first and deeper ones revealed from
  the same layout on request. Positions never move because the layout is never
  recomputed.
- **A truncated analysis is reported, not hidden.** The project is `Partial`,
  and the UI says "showing the first 2000 of N files" rather than presenting a
  partial town as a whole one.

## Why this beats stable per-building slots

The alternative was to persist a permanent slot index per building so that
subsets of buildings keep their positions. It was rejected as unnecessary:
positions are already stable if the *input* to the layout never changes, and
filtering the output never changes the input. Stable-slot bookkeeping would
have required persisting layout state and amending ADR-0012 to say layout is a
function of the tree *and* a recorded assignment.

This decision leaves ADR-0012 intact: layout remains a pure function of the
directory tree.

## Consequences

- **ADR-0012 is unamended.** The same repository still yields the same town,
  and revealing deeper detail does not disturb what is already drawn.
- **`--max-files` is the escape hatch** for a legitimately enormous
  repository, and `Partial` is the honest state for it.
- **A budget truncates by path, not by importance**, so a large repository
  keeps whichever files sort first. This is deterministic and explainable, but
  it is not "the most important 2000 files" — no such ranking exists.
