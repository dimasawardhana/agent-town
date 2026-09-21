# 11 — The extension needs no configuration

**What to build:** The extension targets `127.0.0.1:7777` when `AI_TOWN_URL` is unset, so no environment variable is needed for the common case. An unreachable daemon disables it for the session **silently** — no retry, no log, nothing surfaced to the agent, so an unreachable daemon stays indistinguishable from an uninstalled one.

**Blocked by:** 04.

**Status:** ready-for-agent

- [ ] With `AI_TOWN_URL` unset, the extension targets the default fixed port
- [ ] With `AI_TOWN_URL` set, that value wins, so a non-default port still works
- [ ] A refused connection disables forwarding for the session without retrying and without writing to the agent's output
- [ ] The agent's behaviour is identical whether the extension is installed and unable to reach a daemon, or not installed at all
- [ ] The default is a single guess, not a scan: no other port is probed
