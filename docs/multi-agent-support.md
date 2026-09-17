# Multi-Agent Support Findings

**Date:** 2026-09-18
**Question:** Can AI Town observe agents other than OpenCode — specifically pi, omp, and hermes?
**Method:** Live probing of installed binaries plus source/doc reading. Versions: opencode 1.4.3, pi 0.79.4, omp 18.0.3, hermes 0.15.1.

---

## Answer

**All four are observable, and by the same mechanism: an in-process extension that forwards events to the AI Town daemon.**

This validates the plugin architecture chosen in ADR-0009. It was not a workaround for OpenCode's quirks — it is the general answer. Three of the four agents have **no usable HTTP event stream at all**, so the plugin is not merely preferred, it is the only path.

| Agent | Extension system | Tool hook with name + path + status | HTTP/SSE event stream | Live events reachable out-of-process? |
|---|---|---|---|---|
| **opencode** | ✅ plugin | ✅ `message.part.updated` | ⚠️ exists but **leaks other projects** | Only via plugin |
| **pi** | ✅ extension | ✅ `tool_call` + `tool_execution_end` | ❌ **none** | Only via plugin |
| **omp** | ✅ extension | ✅ `tool_execution_start/end` (best) | ❌ **none** | Only via plugin |
| **hermes** | ✅ 3 hook systems | ✅ `post_tool_call` | ✅ `/v1/runs/{id}/events` SSE | Yes, or plugin |

---

## Per-agent detail

### pi 0.79.4

**Extensions** are TypeScript modules loaded via jiti (no compilation). Auto-discovered from `~/.pi/agent/extensions/*.ts` (global) and `.pi/extensions/*.ts` (project-local). The project-local path is **trust-gated** — it does not load in headless mode without `--approve`/`-a`. Global install needs no flag.

**Tool observability** — two hooks, both verified live on success and failure paths:

```ts
pi.on("tool_call", async (event, ctx) => {
  // event.toolName, event.toolCallId, event.input.path
})
pi.on("tool_execution_end", async (event) => {
  // event.toolName, event.toolCallId, event.result, event.isError
})
```

**Path field is `args.path` — uniform across tools.**  This is cleaner than OpenCode's tool-dependent key. Verified schemas: `read {path, offset?, limit?}`, `write {path, content}`, `edit {path, edits[]}`.

Built-in tools: `read`, `bash`, `edit`, `write`, plus off-by-default `grep`, `find`, `ls`. Verified in a real session file: `{'bash': 89, 'read': 50, 'write': 38, 'edit': 70}` — the same vocabulary class as OpenCode.

**No HTTP server.** Verified by grepping the entire `dist/` for `createServer`/`.listen(` — zero hits. There is no `opencode serve` analogue. An out-of-process adapter cannot subscribe over the network.

**Control surfaces:** `--mode rpc` (JSONL over stdio), `--mode json` (event stream on stdout), or the SDK (`createAgentSession`).

**Session identity:** `ctx.sessionManager.getSessionId()`. Notably, `--session-id <id>` lets AI Town **assign** a deterministic crew id before launching, rather than inferring it afterwards. Ids must match `/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/`.

**Storage:** JSONL at `~/.pi/agent/sessions/--<encoded-cwd>--/<timestamp>_<session-id>.jsonl`, appended incrementally — tailable as a zero-install fallback. Assistant entries carry `toolCall.name` + `arguments`; paired `toolResult` entries carry `isError`.

**Env propagation:** verified — an extension read `AI_TOWN_URL` and POSTed to a local daemon.

### omp 18.0.3

**Extensions** are TypeScript, auto-discovered from `.omp/extensions/*.ts` (project) and `~/.omp/agent/extensions/*.ts` (user), plus `.omp/hooks/pre|post/*.ts`. The installed package ships full `src/`, so all findings are source-verified.

**Best observability surface of the four.** `tool_execution_start` / `tool_execution_end` carry a clean boolean status:

```ts
export interface ToolExecutionEndEvent {
  type: "tool_execution_end";
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
}
```

Verified live, success and failure:
```json
{"toolName":"bash","args":{"command":"echo full-json"},"isError":false}
{"toolName":"write","args":{"path":"/nonexistent-dir-xyz/f.txt"},"isError":true}
```

**No HTTP server — verified three ways.** No `Bun.serve` addressable listener, no `ss -ltnp`/`ss -lxnp` listener for the PID mid-turn, no `omp serve` subcommand. Internal loopback bridges exist but are `port: 0` with UUID bearer tokens, and probe as 403.

**Path extraction is not uniform.** Captured real shapes: `read {path}`, `write {path, content}`, `glob {path}`, `grep {pattern, path}`, `bash {command}` — but **`edit` has no top-level `path`**; it is embedded in a hashline string (`§c.txt\n...`). The robust recipe is `result.details.path ?? result.details.resolvedPath ?? args.path`, plus parsing the `§<path>` prefix for `edit`. `PI_EDIT_VARIANT` changes this shape.

**A safety constraint:** omp's `tool_call` hook **fails closed** — a handler error blocks tool execution. An observer must use `tool_execution_*` (notification-only), never `tool_call`. Same hazard in pi, where an error in `tool_call` blocks the tool.

**Subagents share the parent PID** but emit their own `session_start` and tool events with a distinct session id. AI Town must decide whether a subagent renders as its own crew or folds into the parent's.

**Storage:** JSONL, append-only, incrementally written — verified live, line count advanced during a run. `custom`/`tool_execution_start` entries carry truncated `args {command?, path?}`; `message`/`role:"toolResult"` carries `isError`. Note the path projection is deliberately truncated — good enough for visualization, insufficient for full arguments.

**Env propagation:** verified — an extension read `AITOWN_URL` and POSTed tool events to a local Python daemon, logging an identical `process.pid` to the omp process.

### hermes 0.15.1

**Strictly the most observable of the four**, and structurally different: it is Python (Nous Research), not a Node CLI, with an accompanying TUI and a messaging gateway personality.

**Three hook systems:**

| System | Registered via | Lives at | Language | Isolation |
|---|---|---|---|---|
| Plugin hooks | `register(ctx)` + `plugin.yaml` | `$HERMES_HOME/plugins/<name>/` | Python | in-process |
| **Shell hooks** | `hooks:` in `config.yaml` | `~/.hermes/agent-hooks/` | **any** | **subprocess** |
| Gateway hooks | `HOOK.yaml` + `handler.py` | `~/.hermes/hooks/<name>/` | Python | gateway only |

**Tool observability** is a documented, versioned contract — `hermes.observer.v1`. `post_tool_call` carries `tool_name`, `args`, `result`, `session_id`, `tool_call_id`, `duration_ms`, `status`, `error_type`, `error_message`. Status is richer than a boolean: **`ok` / `error` / `blocked` / `cancelled`**. Verified live:

```
post_tool_call | write_file | {'path': '/tmp/aitown_probe.txt'} | status=ok
post_tool_call | read_file  | {'path': '/tmp/missing.txt'}      | status=error
```

**It is the only agent with a genuine HTTP+SSE run stream** — the closest analogue to OpenCode's `/global/event`, but scoped by run id rather than leaking globally:

```
GET /v1/runs/{run_id}/events   → SSE
  data: {"event":"tool.started",   "tool":"write_file", "preview":"/tmp/sse_probe.txt"}
  data: {"event":"tool.completed", "tool":"read_file",  "duration":0.073, "error":true}
```

Every frame carries `run_id`, `session_id`, `seq`, `ts`. Enable via `API_SERVER_ENABLED=true` + `API_SERVER_KEY`.

**Storage is SQLite, not JSONL** — `$HERMES_HOME/state.db`, WAL mode, tables `sessions` and `messages`. Queryable concurrently, but it is a store not a live feed; polling, not push.

**Directory isolation is the weak point.** A project-local plugin at `./.hermes/plugins/` is discovered but stays **unloaded** until its name appears in `plugins.enabled` in the global `~/.hermes/config.yaml` — verified empirically. Per-project isolation is instead achieved by pointing `HERMES_HOME` at a project-local directory, which isolates config, plugins, hooks and database wholesale.

**Headless:** `hermes -z "<prompt>"` prints only the final response (verified: stdout exactly `ONESHOT-OK\n`, stderr 0 bytes). `hermes chat -q -Q` additionally prints `session_id: <id>` — the one to use when AI Town needs the id back.

---

## What this changes for the plan

### 1. The plugin architecture is confirmed as the general answer

ADR-0009 chose a plugin for OpenCode because SSE leaked. That reasoning generalises: **pi and omp have no HTTP surface at all**, so a plugin is the only live path. hermes is the exception, and even there a hook is the better fit because it is scoped and versioned.

The plan's Tasks 1–5 stand. The `Receiver`, the frame format, the queue/`seq`/`hello` design, and the directory gate are all agent-agnostic already.

### 2. Path extraction must be per-adapter

The normalizer's `ExtractPath` is OpenCode-specific. The real matrix:

| Agent | Keys to try |
|---|---|
| opencode | `filePath`, `file_path`, `path`, `filename` |
| pi | `path` (uniform) |
| omp | `path`, then `details.path`, then `§`-prefix parse for `edit` |
| hermes | `path` |

This belongs behind an adapter interface, not hardcoded in one function.

### 3. Never use intercepting hooks in an observer

pi and omp both **fail closed** on `tool_call` handler errors — a buggy observer would break the user's agent. AI Town must subscribe only to observation hooks: `tool_execution_*` (pi/omp), `tool.execute.after` (opencode), `post_tool_call` (hermes).

This is a hard rule, not a preference. It should be in the plan as a constraint.

### 4. Subagent policy is now an open question with evidence

omp gives subagents their own `session_id` in the same PID. `prd.md` §15 says subagents become **Sub Workers** of the chief. The mechanism exists; the mapping is a decision.

### 5. Agent-neutral vocabulary is confirmed practical

Tool names across agents: `read`, `write`, `edit`, `bash`, `grep`, `find`, `ls` (pi); `read`, `write`, `edit`, `bash`, `glob`, `grep` (omp); `read_file`, `write_file`, `patch`, `search_files`, `terminal` (hermes); `read`, `write`, `edit`, `bash` (opencode).

Three of four use near-identical names. hermes differs (`read_file` vs `read`, `terminal` vs `bash`), so the mapping table needs a hermes column. The existing `ToolToEventType` covers pi nearly verbatim and needs a hermes alias set.

### 6. Session id can be assigned, not just observed (pi)

pi's `--session-id` lets AI Town choose the crew id before launch. That is better than inferring it — it removes a race and makes crew identity deterministic. Worth adopting as the spawn contract for any adapter that supports it.

---

## Recommended next steps

1. **Keep the current plan as-is for OpenCode.** It is verified and nothing here invalidates it.
2. **Refactor `ExtractPath` into an adapter interface** before adding a second agent, so the second adapter does not force a rewrite of the first.
3. **Add `pi` as the second adapter.** It is the closest structural match (TypeScript extension, same hook shape, `args.path` uniform), has the fewest unknowns, and offers `--session-id`.
4. **Add `omp` third.** Its `tool_execution_*` pair is the cleanest surface, but `edit` path extraction is a wart to budget for.
5. **Treat `hermes` as a distinct adapter with its own transport.** It is Python with a SQLite store and a real SSE endpoint; forcing it into the same shape as the Node agents would be worse than a second code path.
6. **Write the fail-closed constraint into the plan** before any second adapter is built, so nobody wires up `tool_call` and starts blocking user tools.

---

## LIVE verification (added after a free-model run)

**pi and omp were driven with a real LLM and their tool hooks fired with real payloads.** The blocker was that every paid provider fails in this environment; free OpenRouter models work.

### omp — success and failure paths

```
{"ev":"session_start","sessionId":"01a0b0a6-b07d-753e-a3e7-dedaca95f584"}
{"ev":"start","toolName":"read","args":{"path":"/tmp/omp-live/probe.ts"}}
{"ev":"end","toolName":"read","isError":false}

# failure path
{"ev":"start","toolName":"read","args":{"path":"/tmp/omp-live/DOES_NOT_EXIST_9999.txt"}}
{"ev":"end","toolName":"read","isError":true}
```

Full chain (omp → extension → daemon) produced correctly normalized events:

```json
{"id":"read_...","session_id":"01a0b0ab-...","agent":"omp","type":"FILE_READ","tool":"read","target":{"path":"/tmp/chain/omp-town.ts"},"result":"success","timestamp":0}
{"id":"read_...","session_id":"01a0b0ac-...","agent":"omp","type":"FILE_READ","tool":"read","target":{"path":"/tmp/chain/DOES_NOT_EXIST_9999.txt"},"result":"error","timestamp":0}
```

### pi — same chain, same shape

```json
{"id":"read_6x64vhhfae0q","session_id":"01a0b0ae-...","agent":"pi","type":"FILE_READ","tool":"read","target":{"path":"/tmp/pi-live/pi-town.ts"},"result":"success","timestamp":0}
```

### A structural difference that broke the first adapter

**omp's `tool_execution_end` does NOT carry `args`** — it carries `result` and `isError`. pi's `tool_execution_end` *does* carry `args`. An adapter written against pi's shape silently produces **pathless events** on omp.

Confirmed by inspecting the real payloads:
```
tool_execution_start  keys=['type','toolCallId','toolName','args','intent']
tool_execution_end    keys=['type','toolCallId','toolName','result','isError']   ← no args
```

**The adapter must cache args from `tool_execution_start` and merge them into the end frame.** This is now a documented requirement, not a discovery to repeat.

---

## Explicitly unresolved

- **hermes observed against a real LLM?** Yes, by the researcher, using an isolated `HERMES_HOME` and real model calls. pi and omp are now also live-verified (above). *Not* verified: hermes end-to-end through the AI Town daemon.
- **Parallel tool interleaving** not observed on any agent beyond what docs state.
- **hermes `edit` path**: hermes uses `patch` rather than `edit`; its path extraction was verified for `read_file`/`write_file` but the `patch` argument shape was not separately captured.
- **omp subagent-to-crew mapping** unexamined — the mechanism is known, the product decision is not.
- **Cross-agent concurrency** (two different agents on one repo simultaneously) remains untested for all four.
