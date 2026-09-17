# Dual persistence strategy: materialized state + event store

## Context

AI Town must persist the town's current visual state (for fast startup) and the full event history (for replay and reconstruction). The PRD Section 17 requires persistence after session ends. Section 18 requires session replay. Section 32 requires town reconstruction from events.

## Decision

Persist both: a materialized town state snapshot and an append-only event store. This is CQRS-lite — the materialized state is a projection of the event store.

## Why

Three persistence requirements conflict:

1. **Fast startup**: Loading the materialized state is instant. Replaying the entire event store on every startup is slow for long sessions.
2. **Replay**: The full event history is required to reconstruct any point in time and power the session replay feature (Section 18).
3. **Analytics**: Historical analysis (e.g., "how many events per session", "which buildings changed most") requires the event store.

Storing only the materialized state makes replay impossible. Storing only events makes startup slow and requires replay computation on every load. Both solves this.

## Consequences

- **Materialized state** stores: current buildings (id, type, name, path, status, progress), workers (id, session_id, agent, state, target), districts, and the town's current visual layout. Loaded on startup for instant rendering.
- **Event store** stores: every normalized event (id, session_id, agent, type, tool, target, result, timestamp). Append-only. Used for replay, analytics, and reconstructing state from any point.
- **Reconciliation**: On startup, if materialized state exists, load it. If not, replay events to reconstruct. If event store has events not reflected in materialized state, reconcile by replaying deltas.
- **Storage**: SQLite stores both tables. The event store grows indefinitely; consider archiving old events after a configurable threshold.
- **Backups**: The event store is the source of truth. Materialized state is a cache. If materialized state corrupts, it can be rebuilt from events.

## Trade-off

This doubles write operations (one event write + one state update per agent event). For local-first, this is acceptable — SQLite handles this trivially. The cost is negligible compared to the benefit of having both fast startup and full replay.
