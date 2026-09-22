# Town Registry — opening a project without restarting

**Source:** a grilling session on making setup easier.

## The request

Make changing town as easy as changing a dropdown value, and make install
easier. The daemon currently welds one project into startup: `--dir` is
analyzed once, the receiver watches one path, and the state file is one
string. Switching projects means restarting the process and reopening a new
URL.

## What this delivers

A daemon you start once. It holds a set of projects — the **Town Registry** —
and the UI switches which town is on screen. Adding a project is
`townd add ~/code/foo`, and installing the extension is one `townd install`.

## Decisions

Recorded in ADR-0014 through ADR-0017:

- **ADR-0014** — the daemon serves a registry, not one directory. Projects are
  registered explicitly rather than chosen at runtime, because the HTTP
  surface had no origin check and a picker would have become an exfiltration
  oracle. `townd add` analyzes eagerly and refuses a path that does not work.
- **ADR-0015** — analysis is bounded by a file budget (default 2000 files),
  and depth is a display concern. Measured: bounding *analysis* by depth is
  disproportionate (wedding-invitation at depth 2 is an empty town) and moves
  buildings that were already drawn (12 of 18 at depth 3), because placement
  is by index into a sorted slice.
- **ADR-0016** — the extension defaults to `127.0.0.1:7777` and stays silent
  on failure. This relaxes ADR-0011's fail-closed rule to the extent of
  allowing an unconfigured *attempt*, while keeping the silence.
- **ADR-0017** — every request must pass a Host and Origin check. Verified
  before writing: `Host: evil.example` was served 200, and a foreign-Origin
  POST returned 204.

## Bugs found while designing this, to be fixed first

Both are in shipping code, both verified, and neither depends on the rest.

1. **Dynamic routes resolve as globs.** Next.js app-router routes live in
   directories named `[slug]`, `[id]`, `[...catchAll]`, and Path Resolution
   treats any `[` as a glob pattern. Every file in such a directory lands in
   the Yard as `reason=glob` instead of on its building. Nine such directories
   exist in the author's own `~/Documents/code`. `src/app/[slug]/page.tsx`
   resolves to `yard`, not `building:src/app/[slug]`.
2. **An agent in a subdirectory is rejected.** The directory gate is
   exact-match, so a session in `/repo/pkg` is 403'd when `/repo` is watched —
   a monorepo package produces no town at all. The 403 then sets the
   extension's process-wide `disabled`, so that agent is blind for the rest of
   its life. Verified: `/tmp/nest2` returned 204, `/tmp/nest2/pkg-a` returned
   403.

## Not in scope

- **The event store.** ADR-0003 records it as unbuilt. The registry does not
  need it: a project's state is the same materialized JSON as before, one file
  per project, and events arriving before a town exists are kept in the
  existing bounded in-memory buffer rather than written to a log.
- **Deriving place from command output.** Still the natural next slice after
  this one; a failing test still lights the Yard rather than the building.
- **pi, opencode and hermes adapters.** Unchanged by this work.
