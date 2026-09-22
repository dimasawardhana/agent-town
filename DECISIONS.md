# AI Town — Grilling Session Decisions

All decisions made during the domain-modeling grilling session. These supersede ambiguous sections of the original PRD.

> **Implementation status.** This is the transcript of the original grilling
> session, kept for its reasoning. Some of it was never built, and where the
> code and this file disagree, the code and `CONTEXT.md` are authoritative.
> Notably: damage is now cleared by the next success rather than persisting to
> session end (ADR-0018), and the rapid-edit batching in §14 and the inspection
> progress in §17 were never implemented — no event is coalesced, and a read
> advances nothing.

## 1. Town Scope

- **One town = one git repository** (confirmed)
- Nested `.git` directories (monorepo packages) each create separate towns
- Git submodules create separate towns

## 2. District Granularity

- **Multi-building districts**: Districts group related buildings by architectural concern
- District = architectural domain boundary, not a directory
- Example: "Internal" district contains Auth Building, Payment Building, User Building
- Empty districts (no buildings) show as empty land
- District naming derived from parent directory or explicit user assignment

## 3. Worker Distinction

- **Chief Worker** (main agent): Full-size worker with distinct helmet/icon. Can spawn sub-workers. Owns the session lifecycle.
- **Sub Worker** (subagent): Smaller worker with different helmet/icon. Spawned by chief workers for specific tasks. Transient — disappears when task completes.
- Visual distinction is the primary differentiator (size, helmet, icon)

## 4. Worker State Distinction

- **THINKING**: Agent is planning/reasoning internally. No tool calls. Worker stands still with thought-bubble icon.
- **READING**: Agent has invoked a file-read tool. Worker walks to building and inspects it.
- **IDLE**: No activity detected for timeout period. Worker stands still with no icon.

## 5. Event Schema

- **Minimum fields**: `id`, `session_id`, `agent`, `type`, `tool`, `target`, `result`, `timestamp`
- `tool` distinguishes read from write
- `result` distinguishes success from failure
- Duplicate event IDs are deduplicated at the event store level

## 6. Agent Connection

**Two modes. Spawn is the default; attach is advanced.** Both produce the same normalized event stream, so adapters MUST implement both.

### Spawn (default)

- AI Town launches the agent process itself: `opencode serve --port 0 --hostname 127.0.0.1`
- Known port (parsed from stdout), guaranteed plugin availability, controllable lifecycle, restart on failure
- This is the MVP path — it is the only mode verified to work (see ADR-0008, docs/spike-results.md)

### Attach (advanced, deferred)

- Connects to an agent the user started themselves
- **Requires the agent to have been started with a TCP port.** The default OpenCode TUI binds no socket at all — it talks to its server in-process over a Worker RPC bridge. Attach to a default TUI is therefore **impossible**, not merely difficult (ADR-0008)
- Preconditions: TUI started with `--port`, or mDNS discovery with a non-loopback hostname
- If discovery fails, AI Town must say so and offer spawn instead

### Shared behavior

- Heartbeat-based loss detection: missed 3 consecutive pings = lost
- Reconnect: wait 2 seconds, retry up to 3 times
- On successful reconnect: replay missed events from event store
- Agent death: worker transitions to LEAVING, building retains progress
- Default adapter: fallback that tails terminal output or watches filesystem changes
- Bind loopback only. `opencode serve` is unauthenticated by default; never expose it to the network

## 7. Rendering Architecture

- Phaser.CANVAS renderer with React DOM overlay
- Zustand shared state layer connects Phaser game loop and React HUDs
- Phaser owns camera (CameraManager)
- React overlays use CSS `position:absolute` with `transform:scale()`

## 8. Persistence

- **Dual strategy**: Materialized town state (fast startup) + append-only event store (replay/analytics)
- CQRS-lite: materialized state is a projection of the event store
- Event store is source of truth; materialized state is a cache
- SQLite for both tables

## 9. Per-District View

- Districts have zoom levels
- Users can zoom into a district to see individual buildings
- Camera auto-focuses when a worker enters a district
- Prevents rendering too many buildings at once

## 10. Metaphor Intensity

- User-adjustable setting: low/medium/high
- Low: simple rectangles with labels
- Medium: detailed buildings with workers
- High: full pixel-art with animations and effects

## 11. Ignore List

- `.git`, `node_modules`, `dist`, `build`, `.next`, `.nuxt`, `__pycache__`, `.venv`, `venv` excluded from town generation
- Directories with zero source files produce no buildings
- Generated/config files contribute to infrastructure, not buildings

## 12. Construction Problem

- `result: error` creates construction problem WITHOUT progress advance
- Damaged buildings persist until explicitly fixed or session ends
- Multi-failure tests affect all buildings in the target directory

## 13. Agent Death

- Worker transitions to LEAVING (not ERROR)
- Building retains last progress
- No new workers spawn until user starts a new session
- Building shows "stopped mid-construction" visual marker

## 14. Rapid Edits

- Rapid edits (within 500ms) on same file are batched into one construction activity
- Building shows continuous hammer animation
- Progress increment is aggregated

## 15. Nested Tool Calls

- Nested tool calls spawn sub-worker icons (smaller, transient)
- Sub-workers appear briefly, do their work, and disappear

## 16. Session End Mid-Construction

- Building retains progress
- Worker transitions to LEAVING
- Building shows scaffolding/mid-construction visual marker
- New session continues from last progress

## 17. Reading Without Writing

- Workers in READING state have distinct animation from HAMMERING workers
- Town looks "busy but not advancing" — useful developer information
- READING events accumulate inspection progress
