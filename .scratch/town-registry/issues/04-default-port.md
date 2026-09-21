# 04 — A fixed default port, loud when it is taken

**What to build:** The daemon listens on `127.0.0.1:7777` by default instead of an ephemeral port, so the address is stable and the extension can guess it. `--port` overrides it, and the existing `--addr` still works for a full address.

A collision must fail loudly and name the fix. Silent fallback to a nearby port is the trap to avoid: the extension posts to a fixed address, so a daemon that quietly moved would receive nothing and the town would look broken with no error anywhere.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] Default listen address is `127.0.0.1:7777`
- [ ] `--port 8080` listens on `127.0.0.1:8080`
- [ ] A second daemon on the same port exits non-zero with a message naming the port, the conflict, and how to change it
- [ ] The address printed on startup is the address actually bound, including when overridden
- [ ] The loopback-only refusal is unaffected: a non-loopback address still exits with an explanation
