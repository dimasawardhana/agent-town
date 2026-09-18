# 04 — The town is on screen

**What to build:** The first thing the developer can actually look at. Opening AI Town on a project shows the town: districts as areas, buildings drawn to scale, roads connecting them. Nothing animates yet — this ticket is the town standing still.

**Blocked by:** 03 — there is no town to draw until project analysis produces one.

**Status:** ready-for-agent

- [ ] Opening a project shows its town: every building visible, sized by source-file count
- [ ] Districts are visually grouped and labelled with the project's own vocabulary
- [ ] The Workshop, Yard and Depot are visible places, not absentees — an event there must have somewhere to land in ticket 05
- [ ] The camera pans and zooms; a large town is navigable rather than clipped
- [ ] Buildings are positioned by the deterministic layout rule in ADR-0012: districts as blocks, buildings on a grid inside them, footprint scaled by file count
- [ ] The layout is identical every time the same project is opened, so spatial memory holds
- [ ] The Workshop, Yard and Depot have reserved positions, so every event in ticket 05 has somewhere to land
- [ ] React renders the UI shell; Phaser renders the town. State flows one way, from the game to the UI
- [ ] The UI is served by the daemon and receives live events over SSE — one process, same origin, no CORS (ADR-0013)
- [ ] The renderer uses the CANVAS backend, which the overlay pattern requires
- [ ] A project with no source files shows an empty site rather than crashing or drawing nonsense

**Note for the implementer:** the rendering approach is decided in ADR-0002 — Phaser CANVAS with a React DOM overlay, Zustand as the shared state layer, Phaser owning the camera. Do not re-litigate it.

The **metaphor intensity** setting from ADR-0004 is out of scope here; draw at medium.

**Deliberately deferred:** animation, workers, and event-driven change. Those are ticket 05. Keep this ticket to a static town so there is a working thing to look at before anything moves.

**Two decisions this ticket depends on, both now recorded:**

- **ADR-0012** — the layout algorithm. Do not invent a layout; implement that one.
- **ADR-0013** — the transport. The daemon serves the UI and streams events over SSE. Do not add a WebSocket or a separate dev server.
