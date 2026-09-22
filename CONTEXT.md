# AI Town

A visual observability tool that represents software projects as persistent towns, where AI coding agents become construction workers and their activity becomes construction events. One town per imported project.

omp is the reference agent: it is the first adapter, and where the glossary needs a concrete example it uses omp. pi is the second. opencode and hermes are supported but not load-bearing.

## Language

### The town

**Town**:
The persistent visual representation of a single imported project. A town is a collection of districts, buildings, infrastructure, and roads that evolves over time as AI agents work. One town = one project.
_Avoid_: project map, dashboard, workspace

**District**:
A domain boundary within a town, grouping related buildings. Districts map to architectural concerns or directory groupings. A district can contain multiple buildings.
_Avoid_: module, folder, namespace, group

**Building**:
A single deployable unit or service within a district. A building appears the moment its project is analyzed: a directory holding source files directly is a building, and one holding none is not. It is then built up a ladder, one part per rank, and never skips a rank:

PLANNED → FOUNDATION → FRAMED → WALLED → ROOFED → GLAZED → DOORED → COMPLETED

The first four ranks are structure and are raised by making changes: a change adds one course. The last three are finish and are raised by *passing tests*: a test is what says the work is sound enough to be fitted off. That split is what puts a test run on the building it verified, and it is the only way COMPLETED is reached.
_Avoid_: service, package, component, module

**Floors**:
A building's height, derived from the total source bytes in it, one storey per band of bytes up to a cap of twenty. Floors are independent of the construction ladder: a building keeps the same number of storeys whether it is a staked plot or a finished tower, because height describes how much code the building *is* while the ladder describes how much work has landed on it. Height and footprint are two separate readings — footprint comes from the file **count** and floors from the byte **total** — so a few large files read as a narrow tower and many small files as a broad low block.

A directory whose mass is machine-written is drawn one storey high regardless of its size. The embedded UI bundle is 1.68 MB in a directory otherwise holding a few kilobytes, and a skyline that ranked compiled output above hand-written code would be a map of the wrong thing. The test is the *shape* of the file, not its size: a build artefact is minified, so its first eight kilobytes contain no newline, while source of any length always breaks lines.
_Avoid_: storeys, levels, height (when the ladder's ranks are meant), size

**Container**:
A directory that holds source *below* it but none of its own. It is not a building — it has no rank and cannot be damaged, because it is an aggregate of what is under it rather than something anyone worked on — but it is drawn as a tower so the shallowest view of a project still says what the project is made of. Without them, a Go module laid out as `internal/<pkg>/` has nothing at the top level at all: the mass is all one or two levels down, and once the detail filter hides those, one building stood for 7.9% of the source.

A container's height comes from **hand-written** bytes rather than its total, because the common case is a module that embeds a built UI: `internal/` totals 2.0 MB of which 1.68 MB is the bundle, so sizing from the total would collapse it to one storey and hide the 317 kB of authored code a reader is looking for. A container steps aside the moment the buildings it summarises are drawn beside it — never both at once, which would show the same bytes twice.
_Avoid_: group, folder, parent, namespace, node

**Hover Label**:
What a site is called, shown when it is asked for and hidden otherwise. Nothing wears its name at rest: pointing at a building, a container, a district plate or a worker reveals that object's label, and pointing away hides it again. Clicking pins the label open so it can be read without holding the cursor still, and focusing something else moves the light — the previously pinned label goes dark. Exactly one label is pinned at a time, because that is what "show it on the thing we are focusing on instead" means.

Labelling the top level outright was tried and abandoned: on one real town of eighteen sites it left thirteen boards on screen at once and the map read as a wall of type, with the skyline the boards described being the thing least visible. Nothing is lost — only deferred until asked for.
_Avoid_: tooltip, popup, annotation, caption (when a building's name is meant)

**Damage**:
A building's current condition, not a stage: whether the most recent work on it failed. Damage is drawn *over* whatever the building has reached — rubble, a crack, a hole in the roof — and a later successful change or test repairs it. It never rolls the ladder back, because a failed command must not erase the progress it did not cause. The count of failures is kept separately as history.
_Avoid_: broken, error state, health

**Construction Problem**:
A physical defect in a building representing a failure or error. Triggered by a failed tool call, a test failure, or an agent error. It is what *damage* shows: the defect is the event, the damage is what is visible on the building because of it.
_Avoid_: bug, error, issue, defect

**Construction Activity**:
The visual representation of a normalized event mapped to a building. A FILE_EDITED event becomes a worker hammering; a failed tool becomes a construction problem.
_Avoid_: action, task, animation, interaction

**Section**:
Any rectangle of ground the map draws as its own place: a district's plate, or one of the three special places. Every section carries a **Kerb** — a hard ring of pixels along its own outline, a dark outer line with a bright inner one. It is what says where a section ends, and it is separate from the dithered band `terrain.ts` draws where two kinds of ground meet: the band marks a change of material, the kerb marks a boundary, and a boundary has to be legible at the fitted zoom where a whole district is ninety pixels across.
_Avoid_: border, box, outline, frame

**Placard**:
A label with a board behind it. Every name the map letters — a district, a building, a place, or what a worker is doing — is set on a placard rather than as bare type, because bare type over grass and pebbles is genuinely hard to find at the fitted zoom. The board is dark and the type light, one pixel of ink bounds the board, and the type sits on a fixed baseline so labels on one street line up.
_Avoid_: badge, chip, tooltip, caption box

**Action Caption**:
The placard above a worker saying what it is doing and to what — "Hammering / town" — where "Hammering" is the world's word for the animation being played and "town" is the building's own directory name. It exists so the map alone answers what a session is doing, without the side panel. Distinct from the panel's reading of the same action, which says the developer's word instead — "editing an existing file" — because the map is allowed to speak in the town's own terms and the panel is not.
_Avoid_: label, tag, status text

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
A directory the developer chose to import into AI Town. One project = one town. A project need not be a git repository, and a directory containing nested repositories is still one project: what makes it a town is that the developer imported it, not what it contains.
_Avoid_: repo, workspace, directory

A project is in exactly one state: **Registered** (known to the daemon, accepting frames, not yet analyzed), **Analyzing**, **Ready**, **Partial** (analyzed up to the file budget, so the town is incomplete and says so), or **Unreadable** (the path is gone or is not a directory). Registration and analysis are separate so that frames arriving before a town exists are kept rather than rejected.

**Town Registry**:
The set of projects one daemon serves. A registry holds many projects, each with one town. It is what the project switcher lists, and it is the answer to "which towns can I look at right now" — a question about the daemon, not about any single town.
_Avoid_: workspace, collection, list, dashboard

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

**Building Lifecycle**: One ordered ladder of eight ranks, each adding exactly one part. Damage is a condition held separately, not a rank. The first four ranks are raised by changes, the last three by passing tests. See ADR-0018.
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
- ADR-0014: The daemon serves a registry of projects, not one
- ADR-0015: Analysis is bounded by a file budget, and detail is a display concern
- ADR-0016: The extension may default its target address, but still fails silent
- ADR-0017: The daemon checks Host and Origin on every request
- ADR-0018: The building lifecycle is one ordered ladder, and damage is not a rank

## Resolved Questions

Answered by live experiment. Kept because the reasoning matters more than the answer.

- **Event durability.** Solved. A fire-and-forget extension loses events silently when the daemon is down — verified. The extension now keeps a bounded queue with retry, and stamps every frame with a monotonic sequence number so the daemon can detect a gap. Verified: seven events buffered through a full outage and delivered on recovery.
- **Extension load confirmation.** Solved. Load failures are swallowed by the agent, so an unloaded extension looks identical to an agent doing nothing. The extension now sends a handshake on load, and the daemon treats it as a precondition before reporting a session live.
- **Tool payload internals.** Solved for omp and pi. Live runs produced real payloads. One wart remains: omp sends arguments only on the tool-start hook, not the tool-end hook, so the extension must cache them and merge forward.
- **Version support floor.** Partially resolved. omp 18.0.3 and pi 0.79.4 are the tested versions. opencode was tested at 1.4.3 only, while current is 1.18.31 — treat opencode above 1.4.3 as unverified.

## Open Questions

- **The default port.** 7777 was chosen over 7000 because 7000 collides with macOS AirPlay. It is a guess, not a measured choice.

- **Multi-agent in one town.** `prd.md` §33 promises simultaneous agents. Attribution by session id is designed but not demonstrated with two concurrent sessions.
- **Subagent mapping.** omp gives subagents their own session id inside the parent process. Rendering them as Sub Workers is mechanically possible; the policy is undecided.
- **omp's edit path.** omp carries no top-level path for `edit` — it is embedded in a hashline string. Unobserved in any live run so far, so an edit may currently arrive pathless.
