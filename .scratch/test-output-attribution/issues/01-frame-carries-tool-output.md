# 01 — The frame carries the tool's output

**What to build:** `tool_execution_end`'s `result` reaches the daemon, truncated,
so anything downstream can read what a command actually printed. Today the
extension sends `isError` and drops `result` entirely.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] The extension reads `result.content[].text` and sends it as the frame's
      `result`
- [ ] The text is truncated at 64 kB with an explicit marker, so a runaway
      command cannot push an unbounded frame
- [ ] `Frame.Result` accepts it; the field is optional so older extensions keep
      working unchanged
- [ ] A frame with no result is indistinguishable from today's behaviour — no
      daemon path changes for agents that send none
- [ ] Verified against a real omp session, not a synthetic fixture: a `bash`
      call's output arrives at the daemon
- [ ] The extension still cannot break the agent: a malformed `result` is
      swallowed, never thrown

## Why

Measured: `result` is `{content:[{type:"text",text:"…"}], details:{…}}`, and
across 1,637 real tool results the median text is 559 bytes with a 50 kB maximum.
`details` holds only timing, so `content[].text` is the whole payload.

## Notes

The extension is observation-only by design (`docs/adr/0011`): `tool_call` fails
closed, so only `tool_execution_start` / `tool_execution_end` are used. Reading a
field off the end event adds no new hook and no new failure mode — but the
extraction must still be wrapped, because a `result` whose shape is not what we
expect must degrade to "no output" rather than throw.
