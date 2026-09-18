# ADR-0013: One process serves the UI and the event stream over SSE

## Context

Tickets 01–05 left a structural gap: the daemon prints normalized events to stdout, the renderer draws a town, and nothing connected them. ADR-0003's architecture diagram shows a WebSocket, but no ticket built one and nothing decided whether it should exist.

Two questions had to be answered together: how the frontend receives live events, and how the developer launches the thing at all (the PRD left packaging as "TBD").

## Decision

The daemon serves the frontend itself. One process binds a loopback port, serves the built UI as static files, and streams normalized events to it over **Server-Sent Events**. No WebSocket, no separate frontend server, no CORS.

## Why SSE is sufficient

The deciding question is whether the frontend ever needs to *push*. It does not.

| What the frontend does | Direction | Transport |
|---|---|---|
| Receive normalized events | server → client | SSE |
| Open a project (load its town) | client → server, once | plain HTTP GET |
| Pan and zoom the camera | neither — it is Phaser's own camera, local | none |
| Select a building (ticket 05+) | client → server, occasional | plain HTTP GET |

The only continuous flow is server → client. SSE is exactly that, and it comes with automatic browser reconnection built in — a live town that survives the daemon restarting is free rather than hand-written.

## Why not WebSocket

It would work, and it is the reflexive choice for anything described as "real-time". But it buys bidirectional messaging that nothing currently needs, at the cost of hand-writing reconnection, heartbeat and backoff logic that `EventSource` provides natively. The PRD's own diagram specified WebSocket before the requirements were known; this is correcting a guess made early.

If a future feature genuinely needs upstream streaming, the existing `POST /events` endpoint is already the pattern for client-to-server, and a WebSocket can be added beside the SSE stream without disturbing it.

## Why one process

Prototyped: a single Go binary serving `/` from an embedded filesystem and `/stream` as SSE, with `POST /events` accepted on the same origin.

- **No CORS.** Same origin, so no preflight, no allowed-origins list, no misconfiguration class of bug. Verified — the response carries no `access-control-*` headers because none are needed.
- **No second server.** The developer runs one binary. No `npm run dev` alongside `townd`, no port coordination, no "which one do I start first".
- **`go:embed`** puts the built UI inside the binary, so there is nothing to install or path-resolve at runtime.

This also settles the packaging question the PRD left open: a local binary serving `127.0.0.1` on an ephemeral port, opened in the browser. A desktop wrapper (Tauri) can come later without changing the transport.

## Verified

- `GET /` serves the UI from the same process — 200
- `GET /stream` opens an SSE stream and delivers frames as they are posted
- `POST /events` accepts a frame and the frame appears on the stream
- No CORS headers required

**Not yet verified:** the keepalive interval under a real proxy, and behaviour when the browser tab is backgrounded for a long period. Neither is expected to be a problem on loopback.

## Consequences

- **The daemon becomes an HTTP server, not just a receiver.** Ticket 01's contract grows: it must serve static files and the stream, not only accept posts.
- **Loopback binding is now security-relevant, not just tidy.** The process serves a UI and an API with no authentication. It must never bind beyond `127.0.0.1`.
- **The event stream is one-way by design.** Any future feature needing upstream streaming should add a channel rather than convert this one.
- **Reconnection is the browser's job.** The server can be restarted and the UI recovers without custom code — but the client must request a full town snapshot on reconnect, since events missed during the gap are not replayed by the stream. The daemon's sequence numbers exist for exactly this: on reconnect, fetch the current town and report any gap.
