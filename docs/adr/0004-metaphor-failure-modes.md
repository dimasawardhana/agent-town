# Metaphor failure modes and boundaries

## Context

AI Town's entire UX relies on the construction/town metaphor mapping software concepts to visual elements. This metaphor works for small-to-medium repos but breaks down at scale and edge cases. Documenting these failure modes now prevents them becoming unhandled edge cases during implementation.

## Failure modes identified

### 1. Monorepo density
A monorepo with 50+ packages creates 50+ buildings. The town becomes unreadable.

**Mitigation**: Per-district view with zoom levels. Districts auto-collapse when zoomed out. Users drill into districts to see buildings. This requires camera zoom/pan + level-of-detail rendering.

### 2. Dependency sprawl
`node_modules/` contains thousands of packages. `.git/` contains thousands of objects. Neither should become buildings.

**Mitigation**: Explicit ignore list. `.git`, `node_modules`, `dist`, `build`, `.next`, `__pycache__` are excluded from town generation. Only source directories become buildings.

### 3. Empty directories
A directory with no files creates an empty plot. A building with no construction is just an empty foundation or no building at all.

**Mitigation**: Directories with no source files do not generate buildings. A district with no buildings shows as empty land.

### 4. Generated files and config
`dist/`, `build/`, generated protobuf files, mock data — these are artifacts, not source. They shouldn't create buildings.

**Mitigation**: File-type heuristics exclude generated/config files from building construction progress. They may appear as infrastructure (roads, pipes) but not as buildings.

### 5. Symlinks
Symlinks between packages create roads that loop or buildings that reference each other.

**Mitigation**: Symlinks are resolved when determining district boundaries. Circular references are detected and represented as "loop roads" (visual ring roads connecting buildings).

### 6. Failed construction without recovery
When a test fails or an agent errors, the building gets a construction problem (hole/crack). But what if the agent never fixes it? The building stays damaged indefinitely.

**Mitigation**: Damage is a *condition*, held separately from the building's progress, and drawn over whatever has been built — rubble at the base, a crack up the wall, a hole in the roof, each appearing only once there is something for it to damage. It never blocks progress and never rolls it back: a damaged building keeps the rank it had, so a building at ROOFED that fails a test stays ROOFED and gains a hole in its roof, and a COMPLETED building that later breaks is visibly a broken *finished* building rather than one that was never built. The next successful change or test repairs it, and the count of failures is kept separately as history.

Implemented by ADR-0018; the split of `Damaged` from `Status` is what makes this describeable. Before it, `broken` was a rank, so the two cases above were the same picture and a failure erased the progress it did not cause.

### 7. Agent death mid-construction
When an agent crashes, the worker disappears. The building it was working on is mid-construction with no one to finish it.

**Mitigation**: Worker state transitions to LEAVING (not ERROR — ERROR is for test failures, LEAVING is for worker departure). The building retains its last progress. No new worker spawns until the user starts a new session. The building shows a "stopped mid-construction" visual indicator.

### 8. Multi-agent conflicting work
Two agents editing the same file simultaneously. Two workers "hammering" the same building at the same time.

**Mitigation**: Multiple workers on one building is valid — it represents parallel work. The building shows multiple worker icons. Construction progress reflects aggregate activity (e.g., two workers = faster progress). Conflicts (git merge conflicts) appear as construction problems on the building.

### 9. The metaphor exhausts itself
At some complexity level, the town metaphor adds no clarity over a file tree. The mapping becomes arbitrary.

**Mitigation**: Allow users to toggle metaphor intensity. Low metaphor = buildings look like simple rectangles with labels. High metaphor = full pixel-art buildings with workers and animations. Users can also view a pure file-tree overlay.

## Decisions

- Ignore list: `.git`, `node_modules`, `dist`, `build`, `.next`, `.nuxt`, `__pycache__`, `.venv`, `venv`
- Directories with zero source files produce no buildings
- Generated/config files contribute to infrastructure, not buildings
- Symlink resolution uses real path resolution
- Damage is a condition, not a rank: it persists until the next success repairs it or the session ends, and it never moves a building down the ladder (ADR-0018)
- Agent death = worker LEAVING, building retains progress
- Multi-agent work on one building = multiple worker icons
- Metaphor intensity is a user setting (low/medium/high)

## Consequences

These decisions make the town robust to real-world repo complexity. They also define what "source code" means in the AI Town domain — it's not everything in the repo, only what matters for the software architecture.
