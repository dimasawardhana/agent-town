# ADR-0009: Plugin-first event transport with HTTP control plane

## Context

`docs/adr/0008` established that AI Town must spawn the agent, and `docs/plan-maturity-assessment.md` found that the HTTP/SSE surface leaks: `GET /session` returns every session on the machine, and `GET /global/event` streams events for **all** directories with `?directory=` accepted but ignored. A plan built on `/global/event` would render another project's agent work into this project's town.

Two candidate transports were probed against a live OpenCode 1.4.3 server.

## Decision

Use a **plugin as the event source** and **HTTP as the control plane** (session creation, prompting, health).

## Evidence

### Plugin wins on correctness

The plugin is directory-isolated by OpenCode itself (`packages/opencode/src/plugin/index.ts:255-260`):

```ts
const unsubscribe = yield* events.listen((event) => {
  if (event.location?.directory !== ctx.directory) return Effect.void
  ...
})
```

Verified empirically. One plugin in `/tmp/iso-a`, activity in both `/tmp/iso-a` and `/tmp/iso-b`:

```
{'/tmp/iso-a': 7}     ← seven events for its own directory
                      ← zero for the other
```

The HTTP/SSE equivalent leaked both directories' events in the same test shape.

### The plugin reaches sessions HTTP cannot

A plugin loads and fires inside a **portless** TUI. Started `opencode /tmp/plugtest2` with no `--port`; `ss -ltnp` showed zero listeners, yet the plugin received events. HTTP/SSE cannot observe this case at all — there is no socket.

### Forwarding works

A plugin posting to an external HTTP listener delivered 8 events for one message turn:

```
1  event:message.updated
1  event:message.part.updated
2  event:session.status
1  event:session.updated
1  event:session.error
1  event:session.idle
```

`message.part.updated` — the frame the normalizer depends on — is delivered over the plugin path.

### HTTP wins on control

The plugin cannot create sessions or send prompts. Those need `POST /session` and `POST /session/{id}/message|prompt_async`, which are HTTP-only. The two transports are complementary, not competing.

## Consequences

- **Event flow:** agent → plugin → HTTP POST → AI Town. Not agent → SSE → AI Town.
- **Control flow:** AI Town → HTTP → agent. Unchanged.
- **The plugin must be installed into the user's repo** at `.opencode/plugins/` or globally at `~/.config/opencode/plugins/`. This is a new setup burden the SSE path did not have.
- **Forwarding failures are silent and non-fatal.** Verified: with no listener running, the agent continued and the events were simply dropped. AI Town MUST detect gaps rather than assume a complete stream. Sequence numbers or a heartbeat is required.
- **The plugin loads only at process start**, and lazily at instance init. A plugin added mid-run is never picked up.
- **A plugin load failure is swallowed.** `getLegacyPlugins` throws on any non-plugin named export and the load path catches without surfacing. AI Town must verify its own plugin actually loaded, or it will observe nothing and not know why.
- **Both surfaces remain needed.** Dropping HTTP would remove control; dropping the plugin would remove isolation and attach reach.

## Open risks

- The plugin's forward channel (HTTP POST) is unauthenticated on loopback. Any local process could post forged events. Acceptable for a local-first tool; should be revisited if AI Town ever binds beyond loopback.
- No backpressure design. The verified `fetch(...).catch(() => {})` pattern drops on failure. A burst of events could overflow without signal.
