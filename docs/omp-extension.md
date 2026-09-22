# The omp extension: how it works inside the agent

**To install it, see [install.md](install.md).** This document is about the
agent-side mechanics — why an extension is the only option for omp, which hooks
it uses, and what it cannot do.

## Why an extension

omp has **no HTTP server**. Verified three ways: no addressable `Bun.serve`
listener, no `ss -ltnp`/`ss -lxnp` listener for the process mid-turn, and no
`omp serve` subcommand. Its internal loopback bridges bind `port: 0` with a
random bearer token and are not addressable from outside.

An extension is therefore the **only** way to observe omp live. Unlike
opencode, there is no server to subscribe to.

## Discovery

Two locations, both scanned automatically with no CLI flag:

```
.omp/extensions/ai-town.ts          project-local
~/.omp/agent/extensions/ai-town.ts  global
```

omp has **no trust gate** — unlike pi, whose project-local extensions do not
load headlessly without `--approve`.

A globally installed extension runs for **every** omp session, not only the
ones AI Town serves. That is safe by design: the daemon rejects directories it
does not serve with `403`, and the extension stops forwarding for *that
directory only* — one unwatched project must not silence a watched one in the
same process.

## What it forwards

Three hooks, every one **observation-only**:

| Hook | Purpose |
|---|---|
| `session_start` | sends the handshake, proving the extension loaded |
| `tool_execution_start` | caches the tool's arguments |
| `tool_execution_end` | forwards the completed action, with its result |

`tool_call` is deliberately **never** subscribed. It fails closed: a throwing
handler blocks the developer's tool, so a bug in an observer could break the
agent it is watching.

There is one wrinkle worth knowing. omp's `tool_execution_end` does **not**
carry the tool's arguments — only `tool_execution_start` does, and
`tool_execution_end` carries the result. The extension caches the arguments at
start and merges them into the end frame. Without that, every event would
arrive with no file path and no worker would have anywhere to stand.

## How it finds the daemon

`AI_TOWN_URL`, or `http://127.0.0.1:7777` when unset. The default exists so the
common install needs no configuration (ADR-0016).

One port can be guessed; a search cannot. The extension does **not** scan for a
daemon, because probing several addresses would make AI Town's presence
observable through timing and log noise — which is what the fail-closed rule
exists to prevent. A daemon on a non-default port therefore needs the variable.

## Durability

The extension keeps an in-memory queue and retries on a timer, so a daemon that
is restarting costs latency rather than history. Verified: with the listener
down as a session began and started a few seconds in, all four queued frames
arrived in order.

Two honest limits:

- **The queue lives in the process.** If the daemon is unreachable for the
  entire run, those frames die when omp exits. There is no disk spool, by
  design: ADR-0010 judged one unnecessary for a local tool.
- **The exit flush needs the daemon to be reachable at exit.** omp fires
  `session_shutdown` and awaits async handlers in it, so the extension flushes
  there — verified with the retry timer disabled at 600s, where two frames
  still arrived. That covers a daemon that came back mid-run. It cannot cover
  one that is still down when the process ends.

## Verifying it works

If the daemon logs no handshake, the extension did not load. Check, in order:

1. `AI_TOWN_URL` is set in the environment omp inherited — or that the daemon
   is on the default port.
2. The file is at `.omp/extensions/ai-town.ts` or
   `~/.omp/agent/extensions/ai-town.ts` — both are scanned, no flag needed.
3. omp is 18.0.3 or later.

A common misreading: the extension is loaded when the **first session starts**,
not when omp launches, so the handshake appears only once you send a prompt.
