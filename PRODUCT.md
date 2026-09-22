# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Existing and fixed by the repository: a single Go daemon (`cmd/townd`) that
serves the UI and the event stream from one process; the UI is React 19 +
Phaser 4 + Zustand built by Vite and embedded with `go:embed`. The Go binary
has no third-party dependencies and the build is offline. That constraint is
load-bearing for this surface, not incidental.

## Users

Developers running AI coding agents on their own machines — omp and pi first,
opencode and hermes supported but not load-bearing. They are mid-task: an agent
is working in a terminal beside them and they want to know what it is actually
doing, and what it did last week, without reading a log or a transcript.

Established from `README.md`, `CONTEXT.md` and the extension work; not restated
by the user in this session.

## Product Purpose

Make a software project's construction legible. A directory tree becomes a
town — districts are architectural domains, buildings are directories sized by
how much source they hold — and an agent's live activity becomes a worker
walking to a building and visibly working on it.

Success is that a developer can glance at the town and know where the agent is,
what it is doing there, and whether the work left the building better or worse
— and that the town persists between sessions, because the town is the result
of the work rather than a recording of it.

## Positioning

The town is a *persistent projection* of two things a neighbouring tool does
not have together: the repository's real architecture (deterministic layout
from the directory tree, ADR-0012) and the agent's normalized event stream.
It is not a log viewer with a skin. Switching projects never pauses another
town's folding, worker movement is computed daemon-side so the browser is never
a second authority on where anything is, and the map is a pure function of the
tree — so the same repo always yields the same town and a developer keeps their
spatial memory of it.

## Operating Context

- One daemon binds loopback only and refuses non-loopback Host/Origin
  (ADR-0017). It is unauthenticated by design and must never be reachable from
  a network.
- It must not be reachable from the internet, so no CDN, no web font host, no
  remote asset may be required at runtime; the built UI travels inside the
  binary.
- The developer watches this while an agent edits the same machine. Frames
  arrive continuously over SSE; the surface is idle for long stretches and then
  busy in bursts.
- The UI is a monitor, not a controller. It starts no sessions and launches no
  agents.

## Capabilities and Constraints

- Worker states: IDLE, WALKING, WAITING, LEAVING. Worker actions: READING,
  HAMMERING, BUILDING, DEMOLISHING, TESTING, COMMANDING, PLANNING, CELEBRATING
  (`internal/town/action.go`). These are the animations the renderer must draw;
  a new action means new art. The Go vocabulary and the UI's `Action` type are
  kept aligned by test.
- Building lifecycle: one ordered ladder of eight ranks, each rank adding exactly
  one part of a building — PLANNED → FOUNDATION → FRAMED → WALLED → ROOFED →
  GLAZED → DOORED → COMPLETED (`internal/town/town.go`, ADR-0018). The first
  four are structure and are raised by making changes; the last three are finish
  and are raised by *passing tests*. One event advances at most one rank, so a
  building is never seen to skip a part.
- Damage is a condition, not a rank: a failed tool sets it and the next success
  clears it, without ever moving the building down the ladder. A building can be
  half-built and damaged at once, which is why the two are separate fields.
- Worker tiers: chief workers (full size, distinct helmet) and sub workers
  (smaller, different helmet). Crews are told apart by colour per agent.
- Places: building, workshop, yard, depot. The Yard is the most common place by
  a wide margin (~half of a real session) and the Depot roughly a third; a town
  that renders either as idle is lying.
- Rendering is Phaser.CANVAS with a React DOM overlay (ADR-0002). The camera is
  Phaser's. State flows one way, game to UI.
- Layout arrives from the daemon in world units and is never recomputed in the
  browser (ADR-0012).
- Metaphor intensity (low/medium/high, PRD §29 / ADR-0004) is **undecided and
  unbuilt**. This session ships one world, not three tiers; the ADR is not
  contradicted because no tier was ever shipped.
- Explicitly refused: emoji standing in for art (PRD §29's table is a
  placeholder, not a specification).

## Brand Commitments

- The vocabulary is binding: town, district, building, worker, crew, construction
  problem, Yard, Workshop, Depot. `CONTEXT.md` lists the synonyms to avoid.
- The construction metaphor is the product, not decoration on it.

## Evidence on Hand

- `CONTEXT.md` — the glossary and the ADRs, authoritative for vocabulary.
- `docs/adr/` — 17 decisions with the alternatives that lost.
- `prd.md` — the original 33-section PRD, including §29 Visual Design.
- `internal/analyzer/layout.go` — the real layout algorithm, and the sizes it
  actually emits (44/60/78/100 world units per building, a 420×150 Yard).
- `README.md` — status, including the gaps stated rather than hidden.
- No screenshots, no brand assets, no logo, and no sample imagery exist. Every
  art asset this surface needs must be authored; nothing may be fabricated as
  if it were supplied.

## Product Principles

1. **Show the work, not the log.** If a worker looks idle while the agent is
   working, the town is lying — the failure to design against.
2. **The map is the memory.** Deterministic layout, persistent state: the town
   is worth returning to.
3. **Never a second authority.** One component owns each fact. The daemon owns
   where things are; the browser draws it.
4. **Gaps stated, not hidden.** The codebase documents what is unbuilt and why.
5. **Local and self-contained.** Loopback, zero dependencies, nothing fetched.
