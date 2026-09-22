# 04 — A fixed default port, loud when it is taken

**What to build:** The daemon listens on `127.0.0.1:7777` by default instead of an ephemeral port, so the address is stable and the extension can guess it. `--port` overrides it, and the existing `--addr` still works for a full address.

A collision must fail loudly and name the fix. Silent fallback to a nearby port is the trap to avoid: the extension posts to a fixed address, so a daemon that quietly moved would receive nothing and the town would look broken with no error anywhere.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] Default listen address is `127.0.0.1:7777`
- [x] `--port 8080` listens on `127.0.0.1:8080`
- [x] A second daemon on the same port exits non-zero with a message naming the port, the conflict, and how to change it
- [x] The address printed on startup is the address actually bound, including when overridden
- [x] The loopback-only refusal is unaffected: a non-loopback address still exits with an explanation
