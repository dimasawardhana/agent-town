# 03 — Every request passes a Host and Origin check

**What to build:** The daemon refuses a request whose `Host` is not loopback, or whose `Origin` is present and not the daemon's own. Today a request carrying `Host: evil.example` is served `200`, and a `POST /events` with a foreign `Origin` is accepted — so a web page the developer has open can inject frames, and DNS rebinding can read the town.

This is a prerequisite for the registry rather than a follow-up: a fixed port makes the daemon trivially reachable, and a registry makes it hold several projects at once.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] A request with a non-loopback `Host` is refused, including when the connection genuinely arrived over loopback
- [x] `Host` values of `127.0.0.1`, `localhost` and `[::1]` are accepted, with or without a port
- [x] A request with no `Origin` is accepted, so the extension — which is not a browser — still works
- [x] A request whose `Origin` is not the daemon's own loopback origin is refused, including on `POST /events`
- [x] The check covers every route, and a route added later is covered without being registered individually
- [x] The refusal names the rule, so the cause is legible rather than looking like a crash
