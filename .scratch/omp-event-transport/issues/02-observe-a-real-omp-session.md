# 02 — Observe a real omp session

**What to build:** An omp extension that forwards real agent activity to the daemon, so that driving omp in a terminal makes normalized events appear in AI Town.

**Blocked by:** 01 — the extension has nowhere to forward to until the daemon exists.

**Status:** ready-for-agent

- [ ] The extension is discovered from `.omp/extensions/` with no CLI flag, and from `~/.omp/agent/extensions/`
- [ ] On session start the extension POSTs a `hello` frame carrying the session id, and the daemon logs the handshake
- [ ] Driving omp to read a file produces a `FILE_READ` event with the real path and `result: "success"`
- [ ] Driving omp to read a nonexistent file produces `result: "error"` with the failing path preserved
- [ ] Running omp from an unwatched directory produces **zero** events, and the daemon logs a 403 rejection
- [ ] The extension never blocks a tool: only observation hooks are subscribed
- [ ] With the daemon stopped, omp completes normally and events are buffered rather than lost
- [ ] With `AI_TOWN_URL` unset, the extension is completely inert
- [ ] The extension typechecks with no imports and no dependencies

**Note for the implementer:** the extension is fully written and verified end to end in `docs/plans/2026-09-18-omp-event-transport.md`, Task 4. Task 6 gives the exact commands per criterion, with expected output.

Two constraints are load-bearing:

- **omp's `tool_execution_end` omits `args`** — only `tool_execution_start` carries them. Cache at start, merge into the end frame, or every event arrives pathless.
- **`tool_call` must never be subscribed.** It fails closed: a throwing handler blocks the user's tool.
