# 01 — Daemon accepts and normalizes extension frames

**What to build:** A running `townd` daemon that turns an HTTP POST from an agent extension into AI Town's normalized event, and refuses frames from directories it does not watch. The extension does not exist yet — this ticket is verifiable by posting frames directly with `curl`.

The daemon binds loopback only and prints its own `AI_TOWN_URL` on stdout.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] `townd --dir <path>` starts, binds `127.0.0.1` on an ephemeral port, and prints `AI_TOWN_URL=http://127.0.0.1:<port>` on stdout
- [ ] A frame from the watched directory returns 204; the same frame from any other directory returns 403 and logs the rejection
- [ ] A completed tool frame becomes a normalized event with `agent`, `type`, `tool`, `target.path`, `result` and `timestamp` populated
- [ ] A frame with `isError: true` produces `result: "error"` — a failed tool must never read as success
- [ ] `agent` is taken from the frame, so an `omp` frame yields `"agent":"omp"`
- [ ] A tool-started frame produces no event, because the work has not happened
- [ ] A sequence jump emits a gap warning **and** still emits the frame's own event
- [ ] A frame arriving before any sequence baseline does not report a spurious gap
- [ ] A malformed body returns 204 and does not kill the stream
- [ ] A non-POST returns 405
- [ ] The daemon also serves the frontend: `GET /` returns the UI, and `GET /stream` streams normalized events as Server-Sent Events (ADR-0013)
- [ ] `POST /events` and `GET /stream` share an origin, so no CORS headers are needed
- [ ] `go build ./... && go vet ./...` passes with no third-party dependencies
- [ ] `go test ./...` passes

**Note for the implementer:** the code is fully written and dry-run verified in `docs/plans/2026-09-18-omp-event-transport.md`, Tasks 1, 2, 3 and 5. Transcribe it; do not redesign it. Task 5 carries the exact `curl` commands and expected output.

The failure and agent-identity criteria each guard a bug found only by running the real chain. Both have regression tests in Task 2.

**Scope note:** the plan in `docs/plans/2026-09-18-omp-event-transport.md` was written before ADR-0013, so it describes a daemon that prints events to stdout. This ticket extends it: the same process must also serve the UI and stream events. The stdout output stays — it is the fastest way to verify the pipeline — but it is no longer the only output.
