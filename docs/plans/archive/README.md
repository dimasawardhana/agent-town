# Plans: what happened to each

Every plan in this directory was written before the work it describes, and each
one ends one of three ways: **shipped**, **abandoned**, or **still live**. This
file exists because a plan with unchecked boxes looks like pending work, and
three of them were sitting in `docs/plans/` looking like 94 open tasks, which is
wrong by two orders of magnitude.

Read this before reading any plan here.

## Live

| Plan | What it is |
|---|---|
| [`2026-09-22-building-floors.md`](../2026-09-22-building-floors.md) | Building height from source bytes; storeys stacked at runtime. **Not yet executed.** |

## Shipped

| Plan | Ended as |
|---|---|
| [`2026-09-18-omp-event-transport.md`](../2026-09-18-omp-event-transport.md) | **Shipped.** The omp extension exists at `internal/agent/extension/ai-town.ts` and all five of its tickets are `done`. |

Its boxes are unchecked because a plan is a record of what was intended at
writing time, and this one was written to be executed rather than ticked. The
work it describes is in the tree; `internal/agent/extension/ai-town.ts` and the
frame normalizer are its result. Do not read its checkboxes as outstanding.

## Abandoned

| Plan | Ended as |
|---|---|
| [`2026-09-18-plugin-event-transport.md`](../2026-09-18-plugin-event-transport.md) | **Abandoned.** The transport shipped, but the *direction* changed: the daemon stopped spawning and attaching, and agents now push to it. |
| [`2026-09-17-agent-observability-spike.md`](../2026-09-17-agent-observability-spike.md) | **Abandoned — and it did its job.** Its question was answered; its implementation was superseded. |

Both were written against a model where AI Town **spawns or attaches to** an
agent: start `opencode serve` as a child process, parse its stdout for the bound
port, subscribe to its SSE stream. ADR-0006 chose the opposite — *connect to
already-running agents*, which became *agents push to the daemon* — because
spawning requires knowing each agent's CLI invocation and users already have
agents running.

The consequence is checkable rather than a matter of interpretation: there is
**no `exec.Command` anywhere in the daemon**, so nothing in either plan's
architecture survives. What does survive is knowledge, and both files are worth
keeping for it:

- The **spike** answered its own question: `message.part.updated` *is* delivered
  on `/global/event`, and the frame envelope is
  `directory` → `payload` → `properties` → `part`. Its findings live on in
  `normalizePart`, which still handles `message.part.updated` and still reads
  the `part` object — the push model changed *who connects*, not what a frame
  contains.
- The **spike results** are recorded separately in
  [`docs/spike-results.md`](../../spike-results.md), including three real bugs
  found by running the code (a silent envelope-nesting error, keepalive
  handling, an unused import).
- The **plugin plan** contains verified measurements — queue durability across a
  daemon outage, monotonic sequence numbers, the 403 rejection path — that the
  shipped extension reimplements in TypeScript. It is the evidence base for the
  push transport that replaced it.

Neither is deleted, because a record of a road not taken is worth more than a
tidy directory. Neither should be executed.
