# Spike Results: OpenCode SSE Observation

**Date:** 2026-09-17
**Environment:** OpenCode 1.4.3, Go 1.27.0, Linux x86_64
**Question:** Does the `/global/event` SSE stream carry tool activity, and can AI Town observe a spawned OpenCode server end-to-end?

## Answer

**Yes on transport. Unconfirmed on tool payloads** — blocked by provider credentials in this environment.

---

## What was verified

### 1. Spawn and port discovery — WORKS

`townd` spawned `opencode serve --port 0 --hostname 127.0.0.1` and parsed the announced port from stdout:

```
townd: starting opencode serve in /tmp/spike-proj
townd: opencode listening at http://127.0.0.1:4096
townd: waiting for agent activity
```

Despite `--port 0`, OpenCode resolved to 4096 (its documented first-choice fallback, then any free port). Port parsing via the `opencode server listening on ...` line works exactly as the official SDK does it.

### 2. SSE transport — WORKS

`GET /global/event` streams. Captured frame types over a 20-second window spanning a session creation:

```
1 server.connected
1 session.created
1 session.updated
1 server.heartbeat
```

A second capture spanning a message send produced:

```
4 session.status      2 session.updated     1 message.part.updated
4 message.updated     2 session.idle        1 session.error
2 idle                2 busy                1 session.diff
1 text                1 server.heartbeat    1 server.connected
```

**`message.part.updated` is delivered on `/global/event`.** This was the single question the spike existed to answer, and the answer is yes.

### 3. Frame envelope — CONFIRMED

Inspecting a live `message.part.updated` frame:

```
TOP-LEVEL KEYS:  ['directory', 'payload']
PAYLOAD KEYS:    ['type', 'properties']
PROPERTIES KEYS: ['sessionID', 'part', 'time']
```

The nesting is `directory` → `payload` → `properties` → `part`. Note the outer `directory` key, which `/global/event` adds and `/event` does not.

Verbatim frame:

```json
{"directory":"/tmp/spike-proj","payload":{"type":"message.part.updated","properties":{"sessionID":"ses_f50118bcdffenR0vZ6yLM3Sh1G","part":{"type":"text","text":"hi","messageID":"msg_0afeea70c001e5gyUbjy7F0dQm","sessionID":"ses_f50118bcdffenR0vZ6yLM3Sh1G","id":"prt_0afeea70c00276WkDhYTqH34yj"},"time":1789658048269}}}
```

The captured `part` happened to be a `text` part, not a `tool` part — see the gap below.

### 4. Session creation and prompting — WORKS

- `POST /session` → 200, returned a session object
- `POST /session/{id}/prompt_async` → **204** (confirms this route exists on 1.4.3)
- `POST /session/{id}/message` → 200, returns the assistant message

### 5. Normalizer correctness — VERIFIED

`NormalizeOpenCode` was tested against the confirmed envelope shape. Applying it to the real captured `text` frame correctly returns `false` (ignored, not a tool part). All 11 unit tests pass against `go build` + `go vet` + `go test`.

---

## What could NOT be verified

**No live tool payload was ever captured.** Every LLM provider in this environment failed authentication:

| Provider | Error |
|---|---|
| `opencode` | `401 No payment method` |
| `github-copilot` | `403 not licensed to use Copilot` |
| `google` | API key invalid |

Diagnosis was confirmed by reading the session's assistant message, which carried an explicit error:

```json
{"error":{"name":"APIError","data":{"message":"No payment method...","statusCode":401,"isRetryable":false}}}
```

No tool executed, therefore no `part.type == "tool"` frame was ever emitted.

**Consequence:** the internal shape of `part.state.input` for file tools — specifically whether the key is `filePath` — remains sourced from type definitions only, not from a live capture. `ExtractPath` handles this defensively by trying four key names and returning `""` on failure, so an unexpected key degrades to a pathless event rather than a dropped one.

---

## Bugs found during verification

The plan's code was written, compiled, and tested before the plan was finalized. Three real bugs surfaced:

1. **Envelope nesting.** `rawToolPart` originally decoded `part` at the top level instead of under `properties`. Because `json.Unmarshal` ignores unknown fields, this failed **silently** — every event would have been dropped with no error. Caught by the table test; the correct shape was then confirmed against a live frame.
2. **Keepalive handling.** The SSE parser returned an `errEmptyFrame` sentinel for comment-only frames, forcing every caller to special-case it. Changed to skip keepalives internally.
3. **Unused import.** An unused `time` import broke the build.

---

## Implications for the design

- **Spawn, not attach, is the MVP path.** This spike validates spawning. Attach to a default TUI remains impossible (ADR-0008) — the TUI binds no TCP port.
- **SSE is viable.** No need for polling fallback on the grounds of transport, though it remains the fallback if tool parts prove absent.
- **The remaining unknown is narrow:** does a *tool* part reach `/global/event`, and does `state.input` carry `filePath`? Both are answerable with one authenticated run.
- **A version check is required.** Local install is 1.4.3 while current is 1.18.31. The `/api/*` routes exist only on the newer surface; everything used here is on 1.4.3.

## Next step

Re-run Task 4 Step 5 of `docs/plans/2026-09-17-agent-observability-spike.md` on a machine with a working provider credential. One successful `read` tool call settles the last unknown.
