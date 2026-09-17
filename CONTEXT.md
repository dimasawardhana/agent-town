# AI Town

A visual observability tool that represents software projects as persistent towns, where AI coding agents become construction workers and their activity becomes construction events. One town per git repository.

## Language

**Town**:
The persistent visual representation of a single git repository. A town is a collection of districts, buildings, infrastructure, and roads that evolves over time as AI agents work. One town = one git repo.
_Avoid_: project map, dashboard, workspace

**District**:
A domain boundary within a town, grouping related buildings. Districts map to architectural concerns or directory groupings (e.g., `internal/auth/` → Auth District). A district can contain multiple buildings.
_Avoid_: module, folder, namespace, group

**Building**:
A single deployable unit or service within a district. Each building has a lifecycle state (PLANNED → FOUNDATION → CONSTRUCTING → TESTING → COMPLETED → BROKEN → ARCHIVED) and tracks construction progress. Buildings have a physical metaphor — they can be damaged (BROKEN) or defective (CONSTRUCTION PROBLEM).
_Avoid_: service, package, component, module

**Construction Problem**:
A physical defect in a building representing a failure or error. Analogous to a hole in a wall or a cracked foundation. Triggered by test failures, agent errors, or failed operations.
_Avoid_: bug, error, issue, defect

**Worker**:
An active entity representing an AI agent or subagent performing construction activity within the town. Workers have two tiers:

- **Chief Worker** (main agent): Full-size worker with a distinct helmet/icon. Owns the session and can spawn sub-workers.
- **Sub Worker** (subagent): Smaller worker with a different helmet/icon. Spawned by chief workers for specific tasks.

Workers have states (IDLE, WALKING, THINKING, READING, HAMMERING, BUILDING, DEMOLISHING, TESTING, WAITING, ERROR, CELEBRATING, LEAVING) and target buildings.
_Avoid_: agent, bot, process, thread

**Construction Crew**:
The set of workers spawned for a single AI coding session. A crew represents one agent's activity within a town at a point in time. A session creates a crew; the crew spawns workers (one chief per agent, plus sub-workers).
_Avoid_: session, team, group, party

**Event**:
A normalized, agent-agnostic record of an AI agent's activity. Events include tool name, target path, result status, and timestamp. Minimum fields: `tool`, `target`, `result`, `timestamp`. Events are the bridge between raw agent output and visual construction activity.
_Avoid_: log, record, message, payload, datum

**Session**:
A unit of construction activity, representing one AI coding agent's lifecycle from start to completion. A session connects to an already-running agent (or spawns one) and reconnects on disconnection. A session creates a crew, which spawns workers.
_Avoid_: run, task, job, execution, process

**Project**:
A git repository imported into AI Town. Projects are the origin of towns — one git repo = one town. Projects with `.git` directories are eligible. Nested `.git` dirs (monorepo packages) create separate towns.
_Avoid_: repo, workspace, directory

**Construction Activity**:
The visual representation of a normalized event mapped to a building. A FILE_EDITED event becomes a worker hammering; a TEST_FAILED becomes a construction problem (crack/hole in the building).
_Avoid_: action, task, animation, interaction

**Event Normalizer**:
The backend component that translates agent-specific event formats into the unified event schema. Makes the system agent-agnostic.
_Avoid_: translator, adapter, converter, mapper

**Agent Adapter**:
A backend component that connects to a specific coding agent (OpenCode, Claude, Codex) and subscribes to its events. Each agent gets its own adapter. If no custom adapter exists, a default working adapter is used. Adapters connect to already-running agents and handle reconnection on disconnection.
_Avoid_: plugin, connector, bridge, integration

## Architecture Decisions

**Rendering**: Phaser.CANVAS renderer with React DOM overlay. Zustand shared state layer connects Phaser game loop and React HUDs. Phaser owns camera (CameraManager). React overlays use CSS `position:absolute` with `transform:scale()`. Pattern validated by production example (Phaser 4 + React 19 + Zustand 5 — the-11th-forest). See ADR-0002.

**Persistence**: Dual strategy — materialized town state (for fast startup) + append-only event store (for replay and analytics). This is CQRS-lite: the materialized state is a projection of the event store. See ADR-0003.

**Agent Connection**: Spawn is the default; attach is advanced. Both produce the same normalized stream. Attach to a running agent requires the plugin path — the default TUI binds no TCP port (ADR-0008). See ADR-0006 and ADR-0009.

**Event Transport**: Plugin-first. A plugin loaded inside the agent process forwards events to AI Town over HTTP; AI Town drives the agent over its HTTP API. The HTTP/SSE event stream is NOT used for events because it leaks other projects' activity — `?directory=` is accepted and ignored (ADR-0009).

**District Granularity**: Districts group multiple buildings. Multi-building districts. District = architectural domain boundary. See ADR-0007.

**Metaphor Boundaries**: Defined ignore lists, empty directory handling, agent death states, and multi-agent work visualization. See ADR-0004.

**Event Mapping Edge Cases**: Read/write cycles, rapid edits, nested tool calls, failed tool calls, multi-failure tests, infrastructure commands, mid-construction session end, reading vs hammering states, duplicate events, large file operations. See ADR-0005.

**Worker Distinction**: Chief workers (main agents) are full-size with distinct helmet. Sub workers (subagents) are smaller with different helmet. Chief can spawn sub-workers. See ADR-0007.

**Worker State Distinction**: THINKING = no tool calls (agent reasoning). READING = file access (worker inspects building). IDLE = no activity detected for timeout period. See ADR-0004.

**Event Schema**: Minimum fields: `tool`, `target`, `result`, `timestamp`. This enables the visual engine to distinguish read from write, success from failure. See ADR-0005.

**Default Adapter**: If no custom adapter exists, a default adapter tails the agent's terminal output or watches for file system changes. Fallback mechanism for agents with zero API exposure. See ADR-0006.

**Nested Git Repos**: Each `.git` directory creates a separate town. Monorepo packages with their own `.git` are separate towns. Git submodules are separate towns. See ADR-0007.

**Per-District View**: Districts have zoom levels. Users can zoom into a district to see individual buildings. Camera auto-focuses when a worker enters a district. District view prevents rendering too many buildings at once. See ADR-0007.

**Metaphor Intensity**: User-adjustable setting (low/medium/high). Low = simple rectangles with labels. Medium = detailed buildings with workers. High = full pixel-art with animations and effects. See ADR-0004.

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

## Open Questions

Unresolved as of the latest grilling session:

- **Event durability.** Plugin forwarding is fire-and-forget and fails silently. Verified: with no listener running, the agent continued and every event was dropped. How does AI Town detect a gap? Sequence numbers? Heartbeat? Untested.
- **Plugin load confirmation.** A plugin load failure is swallowed by OpenCode (`getLegacyPlugins` throws; the caller catches). How does AI Town know its plugin is live before concluding "no activity"?
- **Version support floor.** Everything verified is OpenCode 1.4.3; current is 1.18.31, where the plugin `Hooks` type changed and a second plugin API appeared. Untested above 1.4.3.
- **Multi-agent in one town.** `prd.md` §33 promises simultaneous agents. Sessions share global storage; events do not cross processes. Unexamined.
- **Two agents in one repo.** Both would write to the same session store. Whether their events can be attributed separately is unknown.
- **Tool payload internals.** `state.input` keys for file tools remain type-definition-derived, never observed live. Blocked on provider credentials.
