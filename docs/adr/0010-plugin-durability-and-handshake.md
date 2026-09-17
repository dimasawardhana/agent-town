# ADR-0010: Plugin event durability and load confirmation

## Context

`docs/adr/0009` chose a plugin as the event source. Two properties of that channel were unknown: whether events survive a listener outage, and whether AI Town can tell if the plugin loaded at all. Both were tested against OpenCode 1.4.3.

## Decision

The plugin maintains an **in-memory queue with retry**, stamps every frame with a monotonic **`seq`**, and sends a **`hello` handshake** on load. AI Town treats the handshake as a precondition for declaring a session live, and treats sequence gaps as recorded holes in the town's history.

## Evidence

### Buffering survives an outage

Listener down for session A, then restored:

```
A=ses_f4f8aa75  (listener DOWN)
received while down: 0
=== WHO ARRIVED? ===
  session ses_f4f8aa75... : 7 events   ← delayed, delivered on recovery
  session ses_f4f8a83f... : 9 events   ← live
```

All 7 events from the outage window were delivered. The naive `fetch(...).catch(() => {})` pattern discards them; the queue does not.

### The handshake fires per directory, lazily

```
=== HELLO frames (one per instance init?) ===
  HELLO dir= /tmp/multi-a
  HELLO dir= /tmp/multi-b
```

But with activity in only one directory, only that directory loaded:

```
  /tmp/attr-b:
        1  hello
```

So the plugin loads **per directory instance**, lazily, and only where a session starts — not once per process as first assumed.

## Consequences

- **Handshake is a gate, not a notification.** AI Town must wait for a `hello` matching its own directory, with a timeout that fails loudly. Loading is lazy, so the wait may race instance init — the spawn sequence must create a session first to force it.
- **Sequence numbers make gaps detectable.** Without them, an outage renders as an idle agent, which `prd.md` §34 forbids in spirit: the town would show less than happened without saying so.
- **The queue is process-lifetime only.** Agent death loses the queue. Disk spooling is possible but was not tested and is likely unnecessary for a local tool.
- **The queue needs a cap.** Unbounded growth on a long outage is a memory leak. Cap it and record the drop count.
- **Installation is global** (`~/.config/opencode/plugins/`), verified loading. It runs for every OpenCode session, so it must not forward unrelated projects to a dead port — it should buffer briefly, then stop.
- **Three history states, not two**: observed, known gap, unobserved. The town must never conflate "did nothing" with "nobody watching".
