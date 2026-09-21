# AI Town

A visual observability tool that represents software projects as persistent towns, where AI coding agents become construction workers and their activity becomes construction events. One town per git repository.

omp is the reference agent: it is the first adapter, and where the glossary needs a concrete example it uses omp. pi is the second. opencode and hermes are supported but not load-bearing.

## Language

### The town

**Town**:
The persistent visual representation of a single git repository. A town is a collection of districts, buildings, infrastructure, and roads that evolves over time as AI agents work. One town = one git repo.
_Avoid_: project map, dashboard, workspace

**District**:
A domain boundary within a town, grouping related buildings. Districts map to architectural concerns or directory groupings. A district can contain multiple buildings.
_Avoid_: module, folder, namespace, group

**Building**:
A single deployable unit or service within a district. Each building has a lifecycle state (PLANNED → FOUNDATION → CONSTRUCTING → TESTING → COMPLETED → BROKEN → ARCHIVED) and tracks construction progress.
_Avoid_: service, package, component, module

**Construction Problem**:
A physical defect in a building representing a failure or error. Triggered by a failed tool call, a test failure, or an agent error.
_Avoid_: bug, error, issue, defect

**Construction Activity**:
The visual representation of a normalized event mapped to a building. A FILE_EDITED event becomes a worker hammering; a failed tool becomes a construction problem.
_Avoid_: action, task, animation, interaction

### The work

**Worker**:
An active entity representing an AI agent or subagent performing construction activity within the town. Workers have two tiers:

- **Chief Worker** (main agent): Full-size worker with a distinct helmet. Owns the session and can spawn sub-workers.
- **Sub Worker** (subagent): Smaller worker with a different helmet. Spawned by chief workers for specific tasks.

A worker has a **state** — its lifecycle — and an **action** — the work it is doing. They are separate because they move independently: a worker can be WALKING to a building before READING anything, and a worker whose session ends is LEAVING whatever it was last doing.

States: IDLE, WALKING, WAITING, LEAVING.

Actions: READING, HAMMERING, BUILDING, DEMOLISHING, TESTING, COMMANDING, PLANNING, CELEBRATING.

COMMANDING and PLANNING exist because most of a real session is not file work: shell commands are roughly half of all tool calls and meta tools roughly a third. Without them those actions would have no way to be shown, and the town would render a working agent as idle.
_Avoid_: agent, bot, process, thread

**Construction Crew**:
The set of workers spawned for a single agent session. A session creates a crew; the crew spawns workers (one chief per session, plus sub-workers).
_Avoid_: session, team, group, party

**Session**:
A single agent's run, from start to completion, identified by the agent's own session id. A session creates one crew. AI Town does not start sessions — it observes the ones the developer runs.
_Avoid_: run, task, job, execution, process

**Project**:
A git repository imported into AI Town. One git repo = one town. Nested `.git` dirs (monorepo packages, submodules) create separate towns.
_Avoid_: repo, workspace, directory

### The plumbing

**Event**:
A normalized, agent-agnostic record of one agent action. The full field set is fixed — `id`, `session_id`, `agent`, `type`, `tool`, `target.path`, `result`, `timestamp` — and every adapter MUST produce exactly it. `agent` and `result` are not optional: omitting `agent` mislabels which agent acted, and `result` distinguishes a completed action from a failed one.
_Avoid_: log, record, message, payload, datum

**Frame**:
The wire message an extension sends to the daemon. A frame carries the agent's raw fields — tool name, arguments, call id, error flag — plus transport metadata: the directory it came from, its sequence number, and the adapter identity. The normalizer turns a frame into an event. Frames are a transport concern; events are the domain.
_Avoid_: message, packet, envelope, event

**Event Normalizer**:
The component that translates a specific agent's frame vocabulary into the normalized event. This is where agent-agnosticism is enforced.
_Avoid_: translator, converter, mapper

**Place**:
Where a worker stands. Every event either resolves to a place or is explicitly placed elsewhere — an event is never silently dropped for want of a location. Places are:

- a **Building**, when the event names a file inside one
- the **Workshop**, when the event names a file at the repo root
- the **Yard**, when the event is site-wide — a test run, a build, a git command
- the **Depot**, when the event is meta-work with no site at all — planning, task dispatch, evaluation

_Avoid_: location, target, coordinate, address

**Place Resolution**:
The rule that turns an event into a Place. The deepest matching building wins, so a file three directories inside a building still lands on that building. It must always return a Place, and must report *why* a path failed rather than discarding it.
_Avoid_: path matching, lookup

**Yard**:
The place of site-wide work. Tests, builds, git operations and dependency installs act on the whole town, not one building, so they are staged in the Yard and their workers are visible to the whole site. This is the most common place by a wide margin — roughly half of a real session — because agents spend most of their time running commands rather than editing files.
_Avoid_: plaza, centre, global

**Workshop**:
The place of repo-root files. A file such as a manifest or readme belongs to no building, so it is worked in the Workshop. Without it, root files would either be dropped or invent a fake building at the root.
_Avoid_: root, misc, lobby

**Depot**:
The place of meta-work: planning, task dispatch, evaluation, and note-taking. It is work *about* the work, with no site to act on. A third of a real session is spent here, so it is never filtered out — an agent that looks idle while planning is the town lying about what happened.
_Avoid_: office, backstage, admin

**Agent Adapter**:
AI Town's own per-agent translation code: the hook names it subscribes to, the keys it reads a file path from, and the mapping from that agent's tool names to normalized event types. One adapter per agent. An adapter is a component of AI Town; it is not the same thing as an extension.
_Avoid_: plugin, connector, bridge, integration

**Extension**:
The module AI Town installs **into** an agent process so that agent forwards its activity to the daemon. It runs inside the agent, inherits its environment, and must never alter agent behaviour. omp and pi call this an *extension*; opencode calls it a *plugin*; hermes calls it a *hook*. AI Town uses "extension" throughout.
_Avoid_: plugin, hook, addon, module

**Daemon**:
The long-running AI Town process that receives frames, applies the adapter, and emits normalized events. It binds loopback only. It never launches an agent.
_Avoid_: server, backend, collector, listener

## Architecture Decisions

**Agent Connection — push**: The verified mode. An extension inside the agent pushes frames to the daemon over loopback HTTP; AI Town neither attaches to nor launches the agent. The developer starts the agent, AI Town observes it. *Spawn* (AI Town launching the agent) and *attach* (AI Town connecting to an existing agent server) are both unbuilt; attach is impossible for omp and pi, which expose no server at all. See ADR-0006 and ADR-0009.

**Event Transport**: Extension-first. The agent's own HTTP event stream is not used, because for opencode it leaks every project on the machine (`?directory=` is accepted and ignored), and for omp and pi it does not exist. See ADR-0009 and ADR-0011.

**Adapter Contract**: Every adapter subscribes only to **observation** hooks — never intercepting ones. omp's and pi's intercepting hook fails closed: a throwing handler blocks the developer's tool. See ADR-0011.

**Rendering**: Phaser.CANVAS renderer with React DOM overlay. Zustand shared state layer connects the Phaser game loop and React HUDs. Phaser owns the camera. React overlays use CSS `position:absolute` with `transform:scale()`. See ADR-0002.

**Town Layout**: Computed deterministically from the directory tree — districts as blocks, buildings on a grid inside them, footprint scaled by source-file count. No physics, no stored coordinates. The same repo always yields the same town. See ADR-0012.

**Serving and Transport**: One process serves the UI and streams events over SSE from the same origin. No WebSocket, no separate dev server, no CORS. The daemon binds loopback only. See ADR-0013.

**Persistence**: Dual strategy — materialized town state for fast startup, plus an append-only event store for replay and analytics. The event store is the source of truth; the materialized state is a projection of it. See ADR-0003.

**District Granularity**: Districts group multiple buildings. A district is an architectural domain boundary, not a directory. See ADR-0007.

**Worker Distinction**: Chief workers (main agents) are full-size with a distinct helmet; sub workers (subagents) are smaller with a different helmet. Chief can spawn sub-workers. See ADR-0007.

**Worker State Distinction**: THINKING = no tool calls, the agent is reasoning. READING = file access. IDLE = no activity within a timeout. See ADR-0004.

**Metaphor Boundaries**: Ignore lists, empty directories, agent death, and multi-agent work are all defined. See ADR-0004.

**Event Mapping Edge Cases**: Read/write cycles, rapid edits, nested tool calls, failed tool calls, multi-failure tests, infrastructure commands, mid-construction session end, duplicate events, large files. See ADR-0005.

**Per-District View**: Districts have zoom levels. The camera auto-focuses when a worker enters a district, which keeps large towns renderable. See ADR-0007.

**Metaphor Intensity**: User-adjustable low/medium/high. Low = labelled rectangles. Medium = detailed buildings with workers. High = full pixel-art with effects. See ADR-0004.

## ADRs

- ADR-0001: OpenCode-first adapter integration (verified claims)
- ADR-0002: Phaser.CANVAS + React DOM overlay rendering
- ADR-0003: Dual persistence strategy (materialized state + event store)
- ADR-0004: Metaphor failure modes and boundaries
- ADR-0005: Event-to-visual mapping edge cases
- ADR-0006: Agent connection and reconnection model
- ADR-0007: District granularity, worker distinction, and metaphor boundaries
- ADR-0008: OpenCode integration surface (attach to default TUI is impossible)
- ADR-0009: Plugin-first event transport with HTTP control plane
- ADR-0010: Extension durability and load handshake
- ADR-0011: Agent adapter contract and the fail-closed rule
- ADR-0012: Town layout is computed deterministically from the directory tree
- ADR-0013: One process serves the UI and the event stream over SSE

## Resolved Questions

Answered by live experiment. Kept because the reasoning matters more than the answer.

- **Event durability.** Solved. A fire-and-forget extension loses events silently when the daemon is down — verified. The extension now keeps a bounded queue with retry, and stamps every frame with a monotonic sequence number so the daemon can detect a gap. Verified: seven events buffered through a full outage and delivered on recovery.
- **Extension load confirmation.** Solved. Load failures are swallowed by the agent, so an unloaded extension looks identical to an agent doing nothing. The extension now sends a handshake on load, and the daemon treats it as a precondition before reporting a session live.
- **Tool payload internals.** Solved for omp and pi. Live runs produced real payloads. One wart remains: omp sends arguments only on the tool-start hook, not the tool-end hook, so the extension must cache them and merge forward.
- **Version support floor.** Partially resolved. omp 18.0.3 and pi 0.79.4 are the tested versions. opencode was tested at 1.4.3 only, while current is 1.18.31 — treat opencode above 1.4.3 as unverified.

## Open Questions

- **Multi-agent in one town.** `prd.md` §33 promises simultaneous agents. Attribution by session id is designed but not demonstrated with two concurrent sessions.
- **Subagent mapping.** omp gives subagents their own session id inside the parent process. Rendering them as Sub Workers is mechanically possible; the policy is undecided.
- **omp's edit path.** omp carries no top-level path for `edit` — it is embedded in a hashline string. Unobserved in any live run so far, so an edit may currently arrive pathless.
