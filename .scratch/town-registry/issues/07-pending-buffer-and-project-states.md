# 07 — A registered project keeps its events before its town exists

**What to build:** Folding an event requires the analyzed town, because Path Resolution is built from it. A project that is registered but not yet analyzed therefore cannot place anything — but it must not lose what arrives, and it must not pretend to have placed it.

Frames are held in a bounded in-memory buffer until analysis lands, then replayed through the town so workers appear where they were actually working. The buffer is capped; overflow marks the project so the UI can say events were dropped, because a town that silently omits work is the product lying about what happened.

**Blocked by:** 05.

**Status:** done

- [x] A project reports one of Registered, Analyzing, Ready, Partial or Unreadable, and the state is visible to the UI
- [x] Frames arriving before analysis completes are buffered and replayed once the town exists, so no event is lost
- [x] The buffer is bounded; exceeding it marks the project and reports how many events were dropped
- [x] A project that fails analysis reports Unreadable and does not block other projects
- [x] Nothing is rendered as having happened before it has been placed — a buffered event produces no provisional worker
- [x] This does not use an event store: the buffer is in memory, nothing is written, and a restart loses buffered events only
