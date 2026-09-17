# Event-to-visual mapping edge cases

## Context

The event-to-visual mapping (Section 8 of the PRD) defines how normalized events become construction activities. This document covers edge cases where the mapping is ambiguous, impossible, or produces confusing visuals.

## Edge cases

### 1. Read without write
A `read_file` event maps to "worker inspects building." But what if the agent reads 10 files before writing any? The worker spends time inspecting and the building shows no progress.

**Resolution**: READING events increment a "inspection" counter on the building. After N reads without writes, the building shows "analyzing" state. Workers can inspect multiple buildings before hammering any. The visual should show multiple workers inspecting different buildings if parallel reads occur.

### 2. Rapid file edit cycles
An agent rapidly edits a file (multiple small changes). Each `edit_file` creates a "worker hammers" animation. At high frequency, the animation becomes a blur.

**Resolution**: Rapid edits on the same file within a short window (configurable, default 500ms) are batched into a single construction activity. The building shows a continuous hammer animation. Progress increment is aggregated.

### 3. Tool call within tool call
Some agents invoke tools within tools (e.g., a subagent spawning within a tool call). The event hierarchy is nested.

**Resolution**: Nested tool calls create sub-workers. The main worker spawns a sub-worker icon that appears briefly, does its work, and disappears. Sub-workers are visually smaller and transient. This maps to the subagent concept in Section 15.

### 4. Failed tool call with partial state
An agent edits a file but the edit fails (permission error, file locked). The event has `result: error`. The visual should show a construction problem, but the file wasn't actually changed.

**Resolution**: `result: error` creates a construction problem on the building WITHOUT advancing progress. The building shows a crack/hole icon overlay. The worker enters ERROR state briefly then returns to IDLE or WALKING to another target.

### 5. Test run with multiple failures
An agent runs `go test ./...` and gets 3 failures. The event maps to "inspector" but which building gets the construction problem?

**Resolution**: The test event targets a directory/package. All buildings in that directory get a construction problem overlay. The inspector walks to each affected building. If tests are in a separate `tests/` directory, the test building itself gets the problem.

### 6. Command with no file target
`npm install` or `docker compose up` has no specific file target. How does this map to a building?

**Resolution**: Infrastructure commands map to infrastructure elements, not buildings. `npm install` → "supply delivery" animation near the town entrance. `docker compose up` → "infrastructure machinery" animation near the database. These are visual effects, not building changes.

### 7. Session end mid-construction
The session ends while a worker is actively hammering. The building is mid-construction (PROGRESS: 0.72). The worker leaves.

**Resolution**: The building retains its progress state. The worker transitions to LEAVING and exits the town. The building shows a "mid-construction" visual marker (scaffolding, partially built walls). When a new session starts on the same project, a new worker arrives at the building and continues from 0.72.

### 8. Agent reads but doesn't write
An agent reads files extensively (code review, exploration) but makes no edits. The town shows workers walking around inspecting buildings but no construction progress.

**Resolution**: This is valid and should be visually distinct. Workers in READING state have a different animation (magnifying glass, looking at building) than HAMMERING workers. The town looks "busy but not advancing" — this is actually useful information for the developer (the agent is exploring, not building).

### 9. Duplicate events from reconnection
After a reconnection (ADR on agent connection), the agent may emit duplicate events for the same tool call.

**Resolution**: Events have unique `id` fields. Duplicate event IDs are deduplicated by the event store. If the same event ID arrives twice, it's silently ignored. The visual doesn't show duplicate construction activity.

### 10. Large file operations
An agent creates or deletes a large file (e.g., a 10,000-line generated file). The event is a single FILE_CREATED or FILE_DELETED but represents massive construction or demolition.

**Resolution**: File size determines the duration of the construction/demolition animation. Large files → longer animation. Progress increment is proportional to estimated file size. A 10,000-line file shows a building being built quickly with a "large foundation" animation.

## Decisions

- READING events accumulate inspection progress; N reads without writes shows "analyzing"
- Rapid edits (within 500ms) on same file are batched into one construction activity
- Nested tool calls spawn sub-worker icons (smaller, transient)
- `result: error` creates construction problem WITHOUT progress advance
- Multi-failure tests affect all buildings in the target directory
- Infrastructure commands map to visual effects, not building changes
- Mid-construction buildings retain progress and show scaffolding markers
- Reading workers have distinct animation from hammering workers
- Duplicate event IDs are deduplicated at the event store level
- File size affects animation duration and progress increment

## Consequences

These edge cases cover 90% of real-world scenarios. The mapping algorithm must handle all of them. The event schema must include `result`, `tool`, `file_size` (optional), and `parent_event_id` (for nested calls) to support these mappings.
