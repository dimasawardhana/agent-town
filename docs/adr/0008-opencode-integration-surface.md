# OpenCode integration surface

## Context

The PRD assumes AI Town can attach to an already-running agent (Section 24, DECISIONS §6). Source-level and empirical verification of OpenCode v1.4.3 / v1.18.31 was performed to establish what is actually observable.

## Decision

Use `opencode serve` + the `/global/event` SSE stream as the primary integration surface, and `message.part.updated` with `part.type == "tool"` as the canonical tool-activity signal. **Drop attach-to-default-TUI from the MVP** — it is not possible.

## Findings that forced this

**1. The default TUI binds no TCP port.** `packages/opencode/src/cli/cmd/tui.ts:234-249` — the TUI talks to its server over an in-process RPC bridge to a Worker with the synthetic origin `http://opencode.internal`. Verified empirically: `ss -ltnp` shows no listener for the TUI process. An external process cannot attach because there is no socket to connect to. This is not a discoverability problem; the transport is not TCP.

**2. `opencode serve` does not attach to a running TUI.** Official docs, verbatim: "If you have the opencode TUI running, `opencode serve` will start a new server." It creates a separate process with its own sessions.

**3. Plugins load only at process start.** Verified: a plugin file added while the server ran was never loaded; only a restart picked it up.

**4. Therefore attach requires an opted-in agent.** The three real options are: TUI started with `--port`, `--mdns` discovery (requires non-loopback hostname), or plugin-side out-of-band forwarding. All require the user to do something before the session starts.

**5. Two disagreeing event vocabularies.** The plugin `Hooks.event` type imports the v1 `Event` union (32 names) but at runtime receives v2 `EventV2Bridge` payloads (88 names). v1 has **no** dedicated tool events; v2 has `session.next.tool.called/progress/success/failed`. The typed interface is narrower than reality — a real hazard.

**6. `message.part.updated` is the only tool signal present in both vocabularies**, and it was captured live:

```json
{"type":"tool","tool":"read","callID":"toolu_...",
 "state":{"status":"completed","input":{"filePath":"/home/.../src/app"},
          "output":"...","title":"home/.../src/app",
          "time":{"start":1778030130074,"end":1778030130363}}}
```

Tool name = `part.tool`; status = `part.state.status`; args = `part.state.input`; output = `part.state.output`; error = `part.state.error`. Note there is **no top-level `filePath`** — the path lives inside `state.input`.

## Consequences

- **MVP supports spawn only.** AI Town spawns `opencode serve --port 0` with `cwd` set to the project, parses `opencode server listening on http://<host>:<port>` from stdout, and subscribes to `/global/event`. No plugin injection into the user's repository is required.
- **Attach is deferred.** When added, its precondition is a TUI started with `--port` (or mDNS). AI Town must detect the absence of a port and say so, offering spawn instead.
- **Normalization reads `message.part.updated`.** The v2 `session.next.tool.*` events are richer but were not captured live and their presence on the SSE stream is unverified. Do not build on them.
- **Server auth.** `opencode serve` is unauthenticated by default. AI Town binds `--hostname 127.0.0.1`. If `OPENCODE_SERVER_PASSWORD` is set in the environment, AI Town must send HTTP Basic (`opencode:<password>`).
- **Directory scoping.** The SSE stream is instance-wide; filter by session, and pass `?directory=` where relevant.
- **Version floor.** Local install is 1.4.3 (stale); current is 1.18.31. AI Town must read `/global/health` and warn on untested versions. The `/api/*` routes exist only in the v2 SDK and are not served by 1.4.3.

## Open risks

- **The drive mechanism is unverified.** The research confirmed `POST /session/{id}/message` returns 200 live, but did NOT confirm whether it blocks until the turn completes, nor whether `POST /session/{id}/prompt_async` exists on the target version. Whether AI Town can *drive* a session, as opposed to merely observe one, must be settled by a spike before the adapter is built.
- Tool hook payloads (`tool.execute.before/after`) were verified from shipped types and call sites but never captured live — every provider failed auth in the research sandbox.
