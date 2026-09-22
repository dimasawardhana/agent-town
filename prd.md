# AI Town — Visual AI Coding Agent Observatory

**Status:** Draft
**Version:** 0.1
**Product Type:** Developer Tool / AI Agent Observability
**Primary Platform:** Desktop/Web local application
**Initial Target:** Individual developers using AI coding agents

---

# 1. Product Overview

AI Town is a visual development environment that represents software projects as persistent towns.

Instead of monitoring AI coding agents through terminal output, logs, or traditional dashboards, AI Town translates agent activity into a visual construction process.

A software project becomes a town.

AI coding sessions become construction crews.

AI agents become workers.

Tool calls and lifecycle events become construction activities.

The resulting codebase becomes the completed town.

### Core metaphor

```text
Software Project
      ↓
     Town
      ↓
Software Architecture
      ↓
Districts / Buildings / Infrastructure
      ↓
AI Coding Session
      ↓
Construction Crew
      ↓
Agent Tool Calls / Lifecycle Events
      ↓
Construction Activities
      ↓
Persistent Changes to the Town
```

Example:

```text
Claude starts a session
        ↓
Construction truck arrives
        ↓
Workers enter the town
        ↓
Agent reads authentication code
        ↓
Worker inspects existing building
        ↓
Agent creates auth files
        ↓
Worker starts constructing
        ↓
Agent edits implementation
        ↓
Worker hammers the building
        ↓
Agent runs tests
        ↓
Inspector checks the building
        ↓
Tests pass
        ↓
Building becomes completed
        ↓
Session ends
        ↓
Workers leave
        ↓
Building remains
```

The town therefore becomes a visual history of how the software has evolved.

---

# 2. Problem

AI coding agents are increasingly capable of performing substantial software development tasks autonomously.

However, the developer experience remains heavily terminal-oriented.

A developer may have multiple agents running:

```text
OpenCode
Claude Code
Codex
Pi
OMP
Other coding agents
```

Each agent can produce large amounts of:

* tool calls
* file modifications
* shell commands
* test execution
* planning
* subagent activity
* errors
* commits
* session events

Traditional interfaces expose this as logs:

```text
Read auth.go
Edit service.go
Run go test
Read repository.go
Edit handler.go
Run git diff
...
```

This is useful for debugging but difficult to understand at a glance.

AI Town attempts to answer:

> **"What are my AI agents actually doing?"**

without requiring the developer to continuously read terminal output.

---

# 3. Product Vision

Create a persistent visual world where developers can observe their AI agents building software in real time.

The product should make software development feel tangible:

```text
Code architecture → Town architecture

Files/modules      → Buildings
Services           → Buildings
Infrastructure     → Infrastructure
Domains            → Districts
Dependencies       → Roads
Tests              → Inspection
Git commits        → Construction milestones
AI sessions        → Construction crews
Subagents          → Workers
Tool calls         → Worker activities
Errors             → Construction problems
```

The visual world is not intended to replace the source code.

It is an abstraction layer over the source code.

---

# 4. Target Users

## Primary User

Individual software developers who regularly use AI coding agents.

Examples:

* OpenCode users
* Claude Code users
* Codex users
* Pi users
* Other CLI-based coding-agent users

## Secondary Users

Future versions may support:

* Engineering teams
* Technical leads
* Engineering managers
* AI-agent-heavy development teams
* Development organizations experimenting with autonomous agents

---

# 5. Core User Journey

The fundamental experience should be:

```text
Create / Import Project
        ↓
Analyze Repository
        ↓
Generate Initial Town
        ↓
Start AI Coding Session
        ↓
Spawn Construction Crew
        ↓
Observe Agent Activity
        ↓
Town Changes in Real Time
        ↓
Session Ends
        ↓
Crew Leaves
        ↓
Construction Remains
        ↓
Town Represents Current Project
```

---

# 6. Business Flow

## 6.1 Project Onboarding

The user opens AI Town and selects a project directory.

Example:

```text
~/projects/payment-service
```

AI Town scans the repository.

It detects:

```text
Go
PostgreSQL
Redis
REST API
Authentication
Payment
Docker
Tests
```

The system creates an initial town.

Example:

```text
                 PAYMENT SERVICE

       ┌───────────────────────┐
       │    AUTH DISTRICT      │
       │                       │
       │      🔐 Auth          │
       └───────────────────────┘

                    │
                    🛣️

       ┌───────────────────────┐
       │   PAYMENT DISTRICT    │
       │                       │
       │      💳 Payment       │
       └───────────────────────┘

              🗄️ Database
```

The initial town does not need to be perfectly accurate.

It should provide a useful visual representation of the repository.

---

# 7. Starting a Session

The user selects:

```text
Project: Payment Service

Agent:
[ OpenCode ▼ ]

Model:
[ Claude Sonnet ▼ ]

Prompt:
"Implement MFA authentication"

[ Start Session ]
```

AI Town starts or attaches to the selected agent.

The town responds:

```text
🚚 Construction crew arriving...
```

Then:

```text
👷 Worker 1
👷 Worker 2
👷 Worker 3
```

appear in the relevant district.

---

# 8. Agent Activity → Construction Activity

The system receives events from the coding agent.

Example:

```text
tool.execute
tool = read_file
file = internal/auth/service.go
```

AI Town maps this to:

```text
👷 Worker
   ↓
walks toward Auth building
   ↓
🔍 inspects building
```

Another event:

```text
tool.execute
tool = edit_file
file = internal/auth/service.go
```

becomes:

```text
👷 Worker
   ↓
🔨 starts construction
```

Another:

```text
tool.execute
tool = bash
command = go test ./...
```

becomes:

```text
👷 Inspector
   ↓
🧪 runs inspection
```

---

# 9. Event Abstraction

The frontend must not depend directly on Claude, OpenCode, or Codex event formats.

All external events should be normalized.

**Minimum event schema**:

```json
{
  "id": "evt_123",
  "session_id": "session_42",
  "agent": "opencode",
  "type": "FILE_EDITED",
  "tool": "edit_file",
  "target": {
    "path": "internal/auth/service.go"
  },
  "result": "success",
  "timestamp": "2026-09-17T10:30:00Z"
}
```

The `tool` field distinguishes read from write operations. The `result` field distinguishes success from failure. These fields are the minimum required for the visual engine to map events to construction activities.

The visual engine consumes this normalized event.

This makes the system agent-agnostic.

---

# 10. Initial Event Vocabulary

## Session Events

```text
SESSION_STARTED
SESSION_PAUSED
SESSION_RESUMED
SESSION_COMPLETED
SESSION_FAILED
```

Visualization:

```text
SESSION_STARTED
→ construction truck arrives

SESSION_COMPLETED
→ construction crew leaves
```

---

## File Events

```text
FILE_CREATED
FILE_EDITED
FILE_DELETED
FILE_READ
```

Visualization:

```text
FILE_CREATED
→ foundation/material added

FILE_EDITED
→ worker constructs

FILE_DELETED
→ demolition

FILE_READ
→ worker inspects
```

---

## Tool Events

```text
TOOL_STARTED
TOOL_COMPLETED
TOOL_FAILED
```

Visualization depends on tool type.

---

## Shell / Command Events

```text
COMMAND_STARTED
COMMAND_COMPLETED
COMMAND_FAILED
```

Example:

```text
go test
→ inspector

npm install
→ supply delivery

docker compose up
→ infrastructure machinery
```

---

## Test Events

```text
TEST_STARTED
TEST_PASSED
TEST_FAILED
```

Visualization:

```text
TEST_STARTED
→ inspector arrives

TEST_FAILED
→ 🚧 construction problem

TEST_PASSED
→ ✅ building inspection passed
```

---

## Git Events

Future event types:

```text
GIT_BRANCH_CREATED
GIT_COMMIT_CREATED
GIT_MERGED
GIT_PUSHED
```

Visualization:

```text
branch
→ new construction zone

commit
→ construction milestone

merge
→ roads/connectors merge

push
→ delivery truck
```

---

# 11. Project → Town Mapping

The town should represent architecture, not individual files. Districts group related buildings by architectural concern. A district can contain multiple buildings.

### Example repository

```text
payment-service/

internal/
├── auth/
├── user/
├── payment/
├── notification/
└── repository/

cmd/
└── server/

pkg/
└── middleware/

migrations/

tests/
```

Possible town:

```text
                   SOFTWARE TOWN

             ┌──────────────────────────────┐
             │        INTERNAL DISTRICT     │
             │                              │
             │  🔐 Auth    💳 Payment       │
             │  🏢         🏢              │
             │  👤 User                  │
             │  🏢                       │
             │  🔔 Notification           │
             │  🏢                       │
             │  🗄️ Repository            │
             │  🏢                       │
             └──────────────────────────────┘

                    │
                    🛣️

             ┌───────────────────────┐
             │     CMD DISTRICT      │
             │                       │
             │    🏢 Server          │
             └───────────────────────┘

              🗄️ DATABASE
```

Districts group related buildings. Each building represents a deployable unit or service within the district. The exact mapping depends on the project analyzer (Section 28).

---

# 12. Building Model

Each significant software domain can become a building. A directory holding
source files directly is a building; one holding none is not.

Example:

```json
{
  "id": "building_auth",
  "type": "service",
  "name": "Authentication",
  "path": "internal/auth",
  "status": "walled",
  "damaged": false
}
```

Building states — one ordered ladder, each rank adding exactly one part:

```text
PLANNED      the plot is staked out
   ↓
FOUNDATION   footings dug, spoil heaped
   ↓
FRAMED       pillars and beams up, open to the sky
   ↓
WALLED       the shell is closed
   ↓
ROOFED       the roof is on, weathertight
   ↓
GLAZED       windows fitted
   ↓
DOORED       door hung
   ↓
COMPLETED    trimmed, plinth, chimney
```

The first four ranks are structure and are raised by making changes; the last
three are finish and are raised by passing tests. See ADR-0018 for why, and for
what happened to the states named here originally.

Damage is **not** a state. It is a condition held separately (`damaged`), drawn
over whatever the building has reached, and repaired by the next success. A
failed tool never moves a building down the ladder.

## Superseded

This section originally described a flat list — PLANNED, FOUNDATION,
CONSTRUCTING, TESTING, COMPLETED, BROKEN, ARCHIVED — alongside a `progress`
float, and §13 named a different sequence again (STRUCTURE, FUNCTIONAL). The
flat list conflated progress with condition, and the two lists disagreed with
each other; both are replaced above.

`ARCHIVED` is deliberately not implemented: a project whose path disappears is
*Unreadable* at the project level (ADR-0015), and no event could archive one
building.

---

# 13. Construction Progress

Buildings visibly evolve, and the ladder *is* the progress model.

There is no progress number to interpolate, and the `progress` float this
section originally specified was removed rather than built. Interpolating a
fraction would draw work that did not happen — a building two-thirds of the way
up a wall it never had — and the case that motivated the float, "how far along
is this?", is answered better and more honestly by naming which part is standing.

Progress is computed from signals that are already in the event stream:

```text
Changes    (FILE_CREATED, FILE_EDITED, and the tools that produce them)
               → one structural rank each, up to ROOFED
Tests      (a passing test naming this building)
               → one finishing rank each, up to COMPLETED
Failures   (any tool returning an error)
               → damage, never a rank
```

The algorithm is deterministic and deliberately simple: one event advances at
most one rank, nothing is inferred from file counts, and a whole-repo test run
(`go test ./...`) advances no single building because it names none. See
ADR-0018.

---

# 14. Workers

Workers represent active agent activity. Workers have two tiers:

- **Chief Worker** (main agent): Full-size worker with a distinct helmet/icon. Can spawn sub-workers. Owns the session lifecycle.
- **Sub Worker** (subagent): Smaller worker with a different helmet/icon. Spawned by chief workers for specific tasks. Transient — disappears when task completes.

A worker should have:

```text
worker_id
session_id
agent_id
worker_type (chief | sub)
current_action
current_target
position
animation
status
```

Example:

```json
{
  "id": "worker_123",
  "session_id": "session_42",
  "agent": "claude",
  "type": "chief",
  "state": "HAMMERING",
  "target": "building_auth"
}
```

Worker states:

```text
IDLE — No activity detected for timeout period
WALKING — Moving between buildings
THINKING — Agent planning/reasoning internally (no tool calls)
READING — Agent reading a file (worker inspects building)
SEARCHING — Agent searching for code
HAMMERING — Agent editing a file (worker constructs)
BUILDING — Agent creating a new file (worker builds foundation)
DEMOLISHING — Agent deleting a file
TESTING — Agent running tests (inspector)
WAITING — Agent waiting for external input
ERROR — Tool call failed
CELEBRATING — Test passed, building completed
LEAVING — Worker departing (session end or agent disconnect)
```

State distinction rules:
- THINKING = no tool calls (agent reasoning)
- READING = file access (worker inspects building)
- IDLE = no activity detected for timeout period

---

# 15. Subagents

If an agent creates subagents, they become Sub Workers with a distinct smaller helmet and different icon from the Chief Worker.

Example:

```text
Main Agent (Chief Worker)
     │
     ├── Sub Worker A
     │      └── authentication task
     │
     ├── Sub Worker B
     │      └── tests task
     │
     └── Sub Worker C
            └── documentation task
```

Chief Workers have full-size helmets with a distinct mark. Sub Workers have smaller helmets with a different color. This gives the town a visual representation of parallel AI work and the hierarchy between main agents and subagents.

---







---

# 17. Town Persistence

The town must persist after the AI session ends.

This is one of the product's defining characteristics.

Example:

```text
Monday

Claude
→ builds Authentication

Result:

🏢 Authentication
```

Tuesday:

```text
OpenCode
→ builds Payment

Result:

🏢 Authentication

🏢 Payment
```

Wednesday:

```text
Codex
→ builds Tests

Result:

🏢 Authentication
🏢 Payment
🧪 Test Center
```

The town continuously represents project evolution.

---

# 18. Session Replay

Users should eventually be able to replay a previous session.

Example:

```text
Authentication Session #42

00:00  Crew arrives
00:05  Agent starts planning
00:12  Worker inspects existing code
00:21  Foundation begins
00:42  Files constructed
01:03  Tests begin
01:12  Test fails
01:17  Worker repairs building
01:30  Tests pass
01:35  Commit created
01:38  Crew leaves
```

Replay controls:

```text
[▶ Play]

Speed:
0.5x
1x
2x
5x
10x
```

---

# 19. Building Details

Clicking a building opens its project information.

Example:

```text
┌──────────────────────────────┐
│ Authentication               │
├──────────────────────────────┤
│ Path                         │
│ internal/auth                │
│                              │
│ Files                        │
│ 18                           │
│                              │
│ Tests                        │
│ 42                           │
│                              │
│ Last Agent                   │
│ Claude                       │
│                              │
│ Last Session                 │
│ #42                          │
│                              │
│ Status                       │
│ ✓ Completed                  │
│                              │
│ [View Files]                 │
│ [View Sessions]              │
│ [Replay Construction]        │
└──────────────────────────────┘
```

---

# 20. Real-Time Architecture

The high-level system:

```text
                  AI Coding Agents
        ┌─────────────┬─────────────┐
        │             │             │
    OpenCode       Claude          Codex
        │             │             │
        └─────────────┼─────────────┘
                      │
                 Agent Adapters
                      │
                      ▼
              ┌────────────────┐
              │ Event Normalizer│
              └───────┬────────┘
                      │
                      ▼
              ┌────────────────┐
              │ Session Manager │
              └───────┬────────┘
                      │
             ┌────────┴────────┐
             ▼                 ▼
       Project State       Event Store
             │                 │
             └────────┬────────┘
                      │
                   WebSocket
                      │
                      ▼
              React + Phaser (CANVAS)
                      │
                      ▼
                Visual Town
```

**Rendering detail**: Phaser.CANVAS renderer for the game world. React DOM overlay for UI panels. Zustand shared state layer connects Phaser game loop and React HUDs. Phaser owns camera (CameraManager). React overlays use CSS `position:absolute` with `transform:scale()`. See ADR-0002.

---

# 21. Recommended Tech Stack

## Frontend

### React

Responsible for application UI:

* project selector
* session controls
* agent details
* event timeline
* building details
* settings
* session history

### TypeScript

Used throughout frontend code.

### Vite

Frontend development/build tooling.

### Phaser

Responsible for the actual town:

* tilemap
* buildings
* workers
* animations
* camera
* movement
* world interactions
* visual effects

### Zustand

Client-side state for:

* active session
* selected building
* worker state
* town state
* UI state

### TanStack Query

For API-backed data:

* projects
* sessions
* historical events
* building metadata

---

# 22. Backend

## Go

Go will be the main backend/runtime because the product needs to interact with local development processes and AI coding agents.

Responsibilities:

```text
Process management
Agent adapters
Event normalization
Session management
Project analysis
Town state
WebSocket server
Persistence
```

Potential structure:

```text
backend/

cmd/
  server/

internal/
  agent/
    opencode/
    claude/
    codex/

  events/
    normalizer/

  project/
    analyzer/

  town/
    building/
    worker/
    district/

  session/

  websocket/

  persistence/
```

---

# 23. Agent Adapter Architecture

Every supported coding agent gets an adapter.

```text
AgentAdapter

Start()
Stop()
Detect()
Subscribe()
NormalizeEvent()
```

Example:

```text
OpenCodeAdapter
ClaudeAdapter
CodexAdapter
PiAdapter
```

All produce:

```text
UnifiedAgentEvent
```

Example:

```json
{
  "type": "FILE_EDITED",
  "session_id": "session_123",
  "agent": "opencode",
  "path": "internal/auth/service.go",
  "timestamp": 1758100000
}
```

This prevents the game engine from becoming tightly coupled to individual AI products.

---

# 24. OpenCode Integration

OpenCode is a strong candidate for the first adapter.

Current OpenCode exposes a plugin system and typed events, including session, file, shell, permission, and tool events. Its CLI also provides JSON-formatted command output, session export, an HTTP server/API, and an ACP server.

Therefore the first implementation can potentially use:

```text
OpenCode Plugin
      ↓
AI Town Event Collector
      ↓
WebSocket / Local IPC
      ↓
Go Backend
      ↓
Phaser
```

The integration should prefer supported APIs/plugins over scraping terminal output.

---

# 25. Local-First Architecture

The first version should run locally.

No cloud infrastructure is required.

**One town = one git repository**. Nested `.git` directories (monorepo packages, submodules) each create separate towns.

```text
Developer Machine

┌──────────────────────────────────────┐
│                                      │
│  AI Town                             │
│  ├── Go backend                      │
│  ├── React frontend                  │
│  └── Phaser world                    │
│                                      │
│  AI Agents                           │
│  ├── OpenCode                        │
│  ├── Claude                          │
│  └── Codex                           │
│                                      │
│  Git repositories                    │
│    ├── payment-service/.git → Town 1│
│    ├── auth-lib/.git → Town 2       │
│    └── shared/.git → Town 3         │
│                                      │
└──────────────────────────────────────┘
```

Benefits:

* Source code stays local
* AI credentials stay local
* No cloud dependency
* Low latency
* Easier MVP development
* Works naturally with CLI coding agents


---

# 26. Persistence

For MVP: SQLite or a lightweight local database.

**Dual persistence strategy**: Materialized town state (for fast startup) + append-only event store (for replay and analytics). This is CQRS-lite: the materialized state is a projection of the event store. The event store is the source of truth; materialized state is a cache. See ADR-0003.

**Materialized state stores**:

```text
current buildings (id, type, name, path, status, damaged, problems, touches)
current workers (id, session_id, agent, state, target)
current districts
town visual layout
```

**Event store stores**:

```text
every normalized event (id, session_id, agent, type, tool, target, result, timestamp)
```

Example flow:

```text
projects
    ↓
sessions
    ↓
events
    ↓
town snapshots (materialized state)
    ↓
replay (from event store)
```

PostgreSQL should not be required for the first local version. A future hosted/team version can migrate to PostgreSQL.

---

# 27. Event Storage

Every meaningful agent event can be stored.

Example:

```json
{
  "id": "evt_123",
  "project_id": "project_1",
  "session_id": "session_42",
  "agent": "claude",
  "type": "FILE_EDITED",
  "payload": {
    "path": "internal/auth/service.go"
  },
  "timestamp": 1758100000
}
```

This enables:

* replay
* analytics
* debugging
* historical timelines
* town reconstruction

---

# 28. Project Analyzer

When a project is first imported:

```text
Repository
    ↓
Project Analyzer
    ↓
Language detection
    ↓
Directory analysis
    ↓
Dependency analysis
    ↓
Git analysis
    ↓
Architecture classification
    ↓
Initial Town
```

Initial implementation should use deterministic heuristics.

Example:

```text
/internal/auth
    → Authentication Building

/internal/payment
    → Payment Building

/migrations
    → Database Infrastructure

/tests
    → Testing Facility
```

LLM-based classification can be added later.

---

# 29. Visual Design

The visual style should be:

* 2D
* pixel-art inspired
* readable
* pleasant
* slightly playful
* developer-oriented

The world should prioritize clarity over realism.

**Metaphor intensity** is a user-adjustable setting (low/medium/high):

- **Low**: Simple rectangles with labels. No animations.
- **Medium**: Detailed buildings with workers. Basic animations.
- **High**: Full pixel-art with animations, effects, and particle systems.

Example:

```text
🏢 Building
👷 Worker
🛣️ Road
🗄️ Database
🚚 Session
🧪 Testing
🚧 Error
📦 Commit
```

Actual assets can eventually be custom pixel art.

---
# 30. MVP Scope

The MVP should be deliberately small.

## MVP Goal

> Start one AI coding session and watch a persistent town change based on real agent activity.

### Required

```text
✓ Create project
✓ Analyze repository
✓ Generate simple town
✓ OpenCode integration
✓ Start session
✓ Detect tool events
✓ Normalize events
✓ Spawn worker
✓ Worker animations
✓ Map events to buildings
✓ Advance building progress up the ladder
✓ Session completion
✓ Persist town
✓ View building details
```

### Not required

```text
✗ Multiplayer
✗ WebRTC
✗ Cloud synchronization
✗ Team accounts
✗ Mobile app
✗ Advanced 3D
✗ Complex AI classification
✗ Full map editor
✗ Multiple-agent orchestration
```

---

# 31. MVP Example

User has:

```text
my-api/

internal/
├── auth/
├── users/
└── payments/
```

They start:

```text
OpenCode
"Implement JWT authentication"
```

AI Town:

```text
             MY API TOWN

      🏢 Users

                    👷
                    │
                    ▼

              🔐 Auth Site
             ┌────────────┐
             │            │
             │     👷     │
             │    🔨      │
             │            │
             └────────────┘

      🏢 Payments
```

Agent events:

```text
read auth/service.go
→ 👷 reads building

create auth/token.go
→ 👷 places foundation

edit auth/service.go
→ 👷 hammers

go test ./internal/auth
→ 🧪 inspector

test passed
→ 🏢 building becomes completed
```

Session ends:

```text
👷 → 🚚 → leaves

             🔐 AUTH
          ┌────────────┐
          │     ✓      │
          │ COMPLETED  │
          └────────────┘
```

The town remains.

---

# 32. Success Metrics

For MVP, technical/product metrics should focus on whether the visualization is actually useful.

### Primary

**Event-to-visual latency**

Target:

```text
< 500ms
```

between receiving an agent event and displaying the corresponding activity.

### Reliability

Target:

```text
>99% event ingestion without crash
```

### Session reconstruction

The system should be able to reconstruct the town from stored events.

### User comprehension

A user should be able to identify:

* which agent is working
* what it is doing
* where it is working
* whether the work succeeded
* what has been completed

without reading the raw terminal output.

---

# 33. Future Features

## Multiple Agents

```text
Claude
OpenCode
Codex
Pi
OMP
```

all working simultaneously.

---

## Agent Collaboration

Workers can visibly communicate:

```text
👷 Claude
    │
    │ task
    ▼
👷 Codex
```

---

## Git Visualization

```text
branch
→ district

commit
→ milestone

merge
→ bridge

push
→ delivery
```

---

## CI/CD Visualization

```text
🏗️ Code
   ↓
🧪 Tests
   ↓
📦 Build
   ↓
🚢 Deploy
   ↓
☁️ Production
```

---

## Production Monitoring

Eventually the town could represent the complete software lifecycle:

```text
Development
    ↓
Testing
    ↓
CI
    ↓
Deployment
    ↓
Production
```

The project becomes a living digital city.

---

# 34. Product Principle

The most important principle is:

> **The town is a visualization of reality, not a simulation that invents activity.**

If the agent is actually editing code:

```text
→ worker builds
```

If the agent is actually running tests:

```text
→ inspector tests
```

If the agent fails:

```text
→ construction problem
```

If nothing is happening:

```text
→ workers wait
```

The visual system should never claim that an agent performed an action that did not actually occur.

---

# 35. Technical Architecture Summary

```text
                           ┌──────────────────┐
                           │  AI Coding Agent │
                           │                  │
                           │ OpenCode         │
                           │ Claude           │
                           │ Codex            │
                           │ Pi               │
                           └────────┬─────────┘
                                    │
                              Agent Events
                                    │
                                    ▼
                       ┌────────────────────────┐
                       │    Agent Adapters      │
                       └────────────┬───────────┘
                                    │
                                    ▼
                       ┌────────────────────────┐
                       │   Event Normalizer     │
                       └────────────┬───────────┘
                                    │
                         Unified Agent Events
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
             Session Manager                 Event Storage
                    │                               │
                    ▼                               ▼
              Town Engine                    SQLite / DB
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
      Buildings            Workers
          │                   │
          └─────────┬─────────┘
                    │
                 WebSocket
                    │
                    ▼
          ┌──────────────────────┐
          │ React + Phaser       │
          │                      │
          │ 🏢 Buildings         │
          │ 👷 Workers           │
          │ 🛣️ Roads             │
          │ 🧪 Testing           │
          │ 🚧 Errors            │
          └──────────────────────┘
```

---

# 36. Proposed Technology Stack

| Layer                 | Technology                                    |
| --------------------- | --------------------------------------------- |
| UI                    | React                                         |
| Language              | TypeScript                                    |
| Build                 | Vite                                          |
| 2D Engine             | Phaser                                        |
| State                 | Zustand                                       |
| API Data              | TanStack Query                                |
| Backend               | Go                                            |
| Realtime              | WebSocket                                     |
| Local DB              | SQLite                                        |
| Future DB             | PostgreSQL                                    |
| Agent Integration     | Agent-specific adapters/plugins               |
| OpenCode Integration  | OpenCode Plugin/API/events                    |
| Process Communication | Local HTTP / WebSocket / IPC                  |
| Repository Analysis   | Go                                            |
| Git Integration       | Git CLI / Git libraries                       |
| Packaging             | TBD: Web app initially, desktop wrapper later |
| Deployment            | Local-first                                   |

---

# 37. Development Phases

## Phase 1 — Town Engine

Build:

```text
Phaser
+
map
+
buildings
+
workers
+
animations
```

No AI integration yet.

---

## Phase 2 — Project Analyzer

Input:

```text
Git repository
```

Output:

```text
Project
 ├── Districts
 ├── Buildings
 └── Infrastructure
```

---

## Phase 3 — OpenCode Adapter

Implement:

```text
OpenCode
   ↓
events
   ↓
normalized events
```

OpenCode is a practical first integration because its current ecosystem provides plugins, event subscriptions, sessions, an API/server mode, and machine-readable CLI/session interfaces.

---

## Phase 4 — Construction Engine

Implement:

```text
FILE_CREATED
→ foundation

FILE_EDITED
→ construction

FILE_DELETED
→ demolition

TEST
→ inspection

ERROR
→ construction problem
```

---

## Phase 5 — Persistence

Implement:

```text
sessions
events
buildings
town state
replay
```

---

## Phase 6 — Multiple Agents

Add:

```text
Claude
Codex
Pi
OMP
```

through independent adapters.

---

## Phase 7 — Advanced Visualization

Add:

```text
Git
CI/CD
dependencies
architecture visualization
subagents
agent collaboration
replay
analytics
```

---

# 38. Long-Term Product Direction

The long-term product can evolve from:

```text
AI Agent Visualizer
```

into:

```text
AI Development Observatory
```

and eventually:

```text
AI Development World
```

where the developer can visually understand:

```text
What are my agents doing?
        ↓
Where are they working?
        ↓
What did they build?
        ↓
Why did they build it?
        ↓
What failed?
        ↓
How did the architecture evolve?
        ↓
What is the current state of my software?
```

The core differentiator is the persistent town metaphor:

> **The software isn't represented as a collection of logs. It is represented as a place that AI agents continuously build and modify.**
