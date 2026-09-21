# 02 — Subdirectory agents are accepted, and a rejection is per-directory

**What to build:** An agent running inside a subdirectory of a watched project has its frames accepted. Today the directory gate is exact-match, so a session in `/repo/pkg` is rejected when `/repo` is watched — a monorepo package produces no town at all.

The rejection is worse than a single lost frame. A rejection sets the extension's `disabled` flag **process-wide**, so one rejected frame blinds that agent for the rest of its life, even after the project becomes watched.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] A frame from a directory inside a watched project is accepted
- [ ] A frame from a sibling that merely shares a prefix — `/repo-other` when `/repo` is watched — is **rejected**, so the fix is segment-aware rather than a naive prefix test
- [ ] A frame from an unrelated directory is still rejected
- [ ] A rejection disables forwarding only for the directory that was rejected; frames from a watched directory are still forwarded afterwards
- [ ] The prefix trap is covered by a test, because a naive comparison passes the first criterion and fails the second
