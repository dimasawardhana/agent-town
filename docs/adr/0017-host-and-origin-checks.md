# ADR-0017: The daemon checks Host and Origin on every request

## Context

The daemon binds loopback and serves an unauthenticated UI and API. ADR-0013
recorded loopback binding as security-relevant for that reason. Loopback is
necessary but **not sufficient**: a page the developer visits can reach
localhost, and DNS rebinding defeats both the same-origin policy and CORS by
making the attacker's hostname resolve to `127.0.0.1`.

Verified against the daemon as it stood:

- `Host: evil.example` is served `200` — no `Host` validation exists
- `POST /events` with `Origin: https://evil.example` returns `204` — accepted
- A `text/plain` POST is a CORS *simple request*, so it is not preflighted

The third point matters independently of rebinding: any web page open in a
browser on the same machine can inject frames into the town today. Rebound
requests can also *read*, because the browser treats the request as
same-origin.

What is reachable is bounded — no endpoint returns file contents, and the
analyzer reads only `.gitignore` — but `/api/town` returns the project's
absolute root and its full directory tree. It is a path-enumeration oracle,
and ADR-0014 makes the daemon hold several projects at once.

## Decision

Every request must pass two checks before any handler runs:

- **Host** must be `127.0.0.1`, `localhost`, or `[::1]`, with any port. This
  is the check that defeats rebinding: a rebound request carries the
  attacker's hostname in `Host`, whatever it resolved to.
- **Origin**, when present, must match the daemon's own loopback origin. A
  request with no `Origin` is allowed — that is a non-browser client, such as
  the extension, which is not subject to the same threat.

The middleware wraps the whole mux rather than individual routes, so a route
added later is covered by default. Registering it per-handler would make
protection something a future contributor must remember.

## Why not a shared secret or token

A token in `AI_TOWN_URL` would also close this, and would additionally protect
against a local process. It was rejected because it reintroduces the
configuration step ADR-0016 removes, and because a local process with the
developer's privileges can read the project directly — the token buys nothing
against that adversary. Host and Origin checks close the browser-reachable
path, which is the path that a fixed port makes easy.

## Consequences

- **The daemon may now reject legitimate requests from unconventional
  clients.** A tool that connects by a different hostname — a container
  reaching the host, or a port-forward with a rewritten `Host` — will be
  refused. The check is deliberately strict, and the error names the rule so
  the cause is obvious rather than looking like a crash.
- **A route added later is protected automatically**, which is the point of
  wrapping the mux.
- **This does not make the daemon safe to expose.** It remains loopback-only
  by design; these checks harden the loopback case rather than relaxing it.
