# Plan Maturity Assessment: What To Investigate Next

**Date:** 2026-09-18
**Trigger:** "Let's mature our plan first. What do you think we should look further?"

Probing the spike plan against a live OpenCode 1.4.3 server turned up **five findings that change the plan's design**, two of which are correctness bugs that would have shipped. This document is the ranked answer to what to look at next.

---

## The headline finding: HTTP/SSE is the wrong primary transport

### `GET /session` returns every session on the machine

A server started in `/tmp/spike-proj` returned **71 sessions** spanning unrelated projects:

```
TOTAL SESSIONS: 71
BY DIRECTORY:
   12  /home/dimasajiwardhana
   11  /home/dimasajiwardhana/Documents/code/Image-nation
   10  /tmp/plugtest
    9  /home/dimasajiwardhana/Documents/code/wedding-invitation
    8  /home/dimasajiwardhana/Documents/code/roomstay-app
    6  /tmp/spike-proj
```

Sessions are stored globally under `~/.local/share/opencode/storage/session/<projectID>/`, and the HTTP API does not scope them to the server's working directory.

### `GET /global/event` streams other projects' events

Subscribing while creating a session under a different `directory` produced that session's events on the stream:

```
data: {"directory":"/home/dimasajiwardhana","payload":{"type":"session.created","properties":{... "title":"LEAK-TEST-from-home" ...}}}
data: {"directory":"/tmp/spike-proj","payload":{"type":"session.created","properties":{... "title":"MINE-spike-proj" ...}}}
```

**Both appeared.** The stream reports events for every directory the server knows about.

### `?directory=` does not filter the stream

Tested explicitly. With `?directory=/tmp/spike-proj` on the subscription and sessions created under two different directories, **both** appeared:

```
--- scoped stream titles ---
      2 "title":"NOISE-OTHER"      ← different directory
      2 "title":"WANT-MINE"        ← our directory
```

The query parameter is accepted and ignored. There is no server-side scoping.

**Why this matters:** the plan's `Events()` subscribes to `/global/event` and normalizes every tool frame it sees. On a developer machine with multiple projects, AI Town would render **another project's agent activity into this project's town**. That is precisely the failure the product's own principle forbids (`prd.md` §34: "The visual system should never claim that an agent performed an action that did not actually occur").

Worse, it would be silent. The frames are well-formed; nothing indicates the wrong project.

### Two servers are not isolated either

Started two `opencode serve` processes on ports 4201 and 4202. Created a session on A. Server B's SSE stream saw **nothing** — yet `GET /session` on B listed the session created on A.

So sessions are shared through global storage, but live events do not cross processes. A second process gives no isolation guarantees on reads and no event visibility on writes.

---

## The plugin path is materially better

Since HTTP/SSE leaks, the alternative is a **plugin** loaded inside the agent process. Tested directly.

### A plugin loads and fires in a portless TUI

This is the case HTTP cannot reach at all. Started `opencode /tmp/plugtest2` with no `--port`, dropped a plugin in `.opencode/plugins/`:

```
{"boot":true,"directory":"/tmp/plugtest2"}
{"type":"installation.update-available","keys":["version"]}
```

`ss -ltnp` confirmed **zero listeners**. The plugin loaded and received events anyway, because it runs inside the agent process rather than connecting to it.

### A plugin delivers tool-part events

With a server in `/tmp/iso-a`, a message on a session produced:

```
{"plugin":"A","dir":"/tmp/iso-a","type":"message.updated"}
{"plugin":"A","dir":"/tmp/iso-a","type":"message.part.updated"}
{"plugin":"A","dir":"/tmp/iso-a","type":"session.updated"}
{"plugin":"A","dir":"/tmp/iso-a","type":"session.status"}
{"plugin":"A","dir":"/tmp/iso-a","type":"session.idle"}
```

`message.part.updated` — the frame the normalizer depends on — is delivered.

### A plugin IS directory-isolated

The isolation test that HTTP failed. One plugin in `/tmp/iso-a`, then activity in `/tmp/iso-a` and `/tmp/iso-b`:

```
{'/tmp/iso-a': 7}
```

**Seven events for its own directory, zero for the other.** This is enforced by OpenCode itself at `plugin/index.ts:255-260`:

```ts
const unsubscribe = yield* events.listen((event) => {
  if (event.location?.directory !== ctx.directory) return Effect.void
  ...
})
```

The plugin contract guarantees the scoping that HTTP/SSE does not offer. That is a structural advantage, not an implementation detail.

### But the plugin has its own cost

- **Loads only at process start.** A plugin added while a server runs is never picked up; restart required.
- **Loads lazily at instance init.** The factory did not run until a session existed.
- **Failures are silent.** `getLegacyPlugins` throws on any non-plugin named export, and the load path swallows errors — a broken plugin is simply absent.
- **It must be written to disk in the user's repo** (`.opencode/plugins/`), or globally (`~/.config/opencode/plugins/`).

---

## Ranked recommendations

### P0 — Decide the transport: plugin-first, not HTTP-first

**This is the biggest open question and it invalidates the current plan's architecture.**

The evidence favors a plugin:
| | Plugin | HTTP/SSE |
|---|---|---|
| Directory isolation | **Yes** (enforced at `plugin/index.ts:255-260`) | **No** — leaks all projects |
| Works with portless TUI (attach) | **Yes** | **No** — no socket exists |
| Tool events | `message.part.updated` confirmed | `message.part.updated` confirmed |
| Requires writing into user's repo | Yes | **No** |
| Spawn control / lifecycle | No | **Yes** |
| Loads mid-session | **No** | Yes |

The pragmatic answer is likely **both, with different roles**: a plugin for correctness and attach-mode reach, HTTP for spawn-mode control and session driving. But that doubles the adapter surface, and the decision should be made deliberately rather than accreted.

**Recommended next step:** prototype the plugin as the *event source* while keeping HTTP as the *control plane* (create session, send prompt). Then measure whether the plugin alone suffices.

### P1 — Add session and directory filtering, regardless of transport

The plan has no filtering. Even with a plugin, the normalizer must key on `sessionID` — a single plugin sees every session in its directory, and a developer may run several. Add to `UnifiedAgentEvent` handling: drop frames whose `sessionID` is not the one AI Town is tracking. This is cheap and prevents the wrong-session bug in all transports.

### P2 — Settle the tool payload shape (still blocked)

No live tool payload has been captured. Every provider failed auth in this environment (`401 No payment method`, `403 Copilot not licensed`). Confirmed that no LLM-free path exists: file edits with no session, and file edits with a session but no turn, emit **no** events. Probed `/session/{id}/shell`, `/command`, `/tool`, `/execute` — the 200s were the SPA catch-all, not routes (`/api/*` and a bogus path both returned identical HTML). **A working credential is required.** `ExtractPath` already degrades safely.

### P3 — Resolve the version gap

Local is **1.4.3**; current is **1.18.31** — a wide gap across which the plugin `Hooks` type changed (`dispose` added, peer deps moved) and a second plugin API (`/v2/promise`) appeared. Everything verified here is 1.4.3 behaviour. The plan must read `/global/health` and refuse untested versions, or the first user on 1.18 will hit unverified ground.

### P4 — Decide who owns the agent lifecycle

Spawn gives control but means AI Town owns the process. Open questions: what happens when the user's own TUI is already running in that repo (two agents, one town)? Does AI Town spawn one server per project, or reuse? The session-store sharing means two agents in one repo would write to the same store.

### P5 — Design the multi-agent / multi-session model

`prd.md` §33 promises multiple agents working simultaneously. Today's evidence says sessions share global storage, and live events do not cross processes. Whether two agents can be observed into one town, and how their events interleave, is unexamined. This is the PRD's headline feature and it has no supporting evidence.

---

## Correctness bugs found in the current plan

Both would have shipped silently.

1. **No directory/session filtering.** The normalizer accepts any tool frame. Given the leak, AI Town would render another project's work as this project's town. **Fix: key on `sessionID` before the transport question is even settled.**

2. **`--port 0` does not mean "any free port" in the way the plan assumes.** It prefers 4096, then falls back. Verified by occupying 4096 with a dummy listener — the server then chose 36365. The plan's port parsing handles this correctly, but the assumption that 4096 is always free is wrong, and any code that hardcodes or predicts the port will break.

---

## What is now solid

- Spawn + stdout port discovery — verified
- SSE transport — verified
- Frame envelope `payload` → `properties` → `part` — verified against live frames
- `message.part.updated` reachable on both transports — verified
- Normalizer against real envelope — verified, 11 unit tests pass
- Plugin loads in a portless TUI and is directory-isolated — verified
- `POST /session/{id}/prompt_async` → 204 — verified

## What remains unknown

- Tool payload internals (`state.input` keys) — **blocked on credentials**
- Whether tool parts reach SSE (vs only non-tool parts) — **blocked on credentials**
- Behaviour on OpenCode ≥ 1.18.31 — **untested**
- Multi-agent observation into one town — **unexamined**

---

## Recommended plan revision

The spike plan should **not** proceed as written. Suggested order:

1. Add `sessionID` filtering to the normalizer — small, independent, fixes a real bug.
2. Prototype a plugin that forwards `event` frames out-of-band (file or unix socket), and confirm it carries `message.part.updated` with tool parts.
3. Re-decide the transport with evidence from (2).
4. Run the authenticated tool-payload capture.
5. Then build the town renderer.

Steps 1–2 need no credentials and can start immediately.
