# ADR-0011: Agent adapter contract and the fail-closed rule

## Context

`docs/adr/0009` chose an in-process plugin as the OpenCode event source. That choice was made to work around OpenCode's leaking HTTP/SSE stream. Investigation of pi (0.79.4), omp (18.0.3) and hermes (0.15.1) — see `docs/multi-agent-support.md` — establishes whether the plugin approach generalises or was a workaround.

## Decision

The in-process extension is the **primary event source for every agent**. Adapters differ only in hook names and path-extraction keys, behind a shared interface. Adapters MUST subscribe only to **observation** hooks, never to **intercepting** hooks.

## Evidence

### Three of four agents have no usable HTTP event stream

| Agent | HTTP/SSE event stream |
|---|---|
| opencode | exists, but leaks every directory (`?directory=` ignored) |
| pi | **none** — grepping all of `dist/` for `createServer`/`.listen(` returns zero hits |
| omp | **none** — no addressable listener; internal bridges are `port: 0` with random bearer tokens and probe as 403 |
| hermes | yes — `GET /v1/runs/{id}/events`, scoped by run id |

So the plugin is the only path for pi and omp, and the better path for the other two. The architecture generalises.

### Tool observability is present everywhere, with different keys

All four expose tool name, arguments and a success/failure signal:

| Agent | Hook | Path key |
|---|---|---|
| opencode | `tool.execute.after` / `message.part.updated` | `filePath`, `file_path`, `path`, `filename` |
| pi | `tool_call` + `tool_execution_end` | `path` (uniform) |
| omp | `tool_execution_start` + `tool_execution_end` | `path`; `edit` embeds it in a hashline string |
| hermes | `post_tool_call` | `path` |

Tool names are near-identical across three of four (`read`, `write`, `edit`, `bash`). hermes differs (`read_file`, `terminal`, `patch`), so it needs an alias table.

### Intercepting hooks fail closed — an observer must never use them

pi and omp both abort tool execution when a `tool_call` handler throws. Verified constraint, documented for omp as "fail-closed" and confirmed in pi's source. An AI Town adapter subscribed to `tool_call` that throws — a daemon hiccup, a malformed frame — would **block the user's agent**.

This is why the rule is a MUST, not a preference. Observation hooks only:
`tool_execution_start`/`tool_execution_end` (pi, omp), `tool.execute.after` (opencode), `post_tool_call` (hermes).

## Consequences

- **`ExtractPath` must move behind an adapter interface.** It is currently OpenCode-specific. Adding a second agent without this refactor forces a rewrite of the first.
- **The frame format and receiver are already agent-neutral** and need no change. Only the extraction and normalization layer is adapter-specific.
- **hermes is a genuinely different adapter.** Python, SQLite storage, all four `status` values (`ok`/`error`/`blocked`/`cancelled`) rather than a boolean, and a real SSE option. Forcing it into the Node-agent shape would be worse than a second code path.
- **pi offers `--session-id`**, letting AI Town assign the crew id before launch instead of inferring it. Adopt as the spawn contract where supported.
- **omp subagents share the parent PID** but emit their own session id. Rendering them as separate crews (per `prd.md` §15) is mechanically possible; the policy is undecided.
- **omp's `tool_execution_end` omits `args`; pi's includes it.** Verified live. An adapter written against pi's shape produces pathless events on omp. Adapters MUST cache args from `tool_execution_start` and merge into the end frame. This is a real structural difference, not a style choice.
- **pi and omp are now live-verified** end-to-end (extension → daemon) using a free OpenRouter model, on both success and failure paths, producing correct `agent`, `target.path` and `result`. hermes is verified only at the hook level, not through the daemon.
- **Two bugs were found only by running the real chain**, not by unit tests: the daemon hardcoded `agent: "opencode"` (so omp and pi events were mislabelled), and hardcoded `result: "success"` (so a failed tool rendered as a completed building, violating `prd.md` §34). Both are now fixed with regression tests.

## Where an event goes when it has no building

Ticket 05 required this be recorded rather than left to fall through, because
a miss that renders as nothing is the town lying about what happened. Every
event resolves to exactly one Place, and the resolution rule is:

| Case | Place | Reason |
|---|---|---|
| Path inside a building | that **Building** | `building` |
| Path at the repo root | **Workshop** | `workshop` |
| Path inside the repo with no building of its own | **Yard** | `unmapped` |
| Path outside the repo | **Yard** | `outside-repo` |
| Internal URI (`skill://`, `memory://`) | **Depot** | `internal-uri` |
| Glob pattern (`src/**/*.ts`) | **Yard** | `glob` |
| A shell command | **Yard**, or testing if it runs the tests | `shell-tool` |
| Meta tool (planning, dispatch, evaluation) | **Depot** | `meta-tool` |
| A tool with no path at all | **Yard** | `no-path` |

The reasoning behind the two that are judgement calls:

**An internal URI is Depot, not Yard.** `skill://using-superpowers` is the
agent consulting its own instructions, which is work *about* the work — the
same category as planning. It is not site work, and putting it in the Yard
would make reading a skill look like running a build.

**A path that resolves to nothing is Yard, not dropped.** A real path inside
the repo whose directory holds no source is site work by default. The
alternative — staying silent — would make an agent editing a lockfile or a
config directory at the repo root look idle.

Every classification carries its Reason, so a placement can be audited rather
than inferred from a missing worker.
