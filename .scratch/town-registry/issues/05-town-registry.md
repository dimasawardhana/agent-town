# 05 — The daemon serves a registry of projects

**What to build:** One daemon holds many projects and watches all of them at once. Projects come from a persisted config file, from `townd add` / `townd rm`, and from repeated `--dir` flags for a single run without persisting.

A frame is routed to the project whose registered root is the longest match, because registered roots can nest. Every registered project accepts frames from the moment it is registered, so nothing is rejected while analysis runs.

**Blocked by:** 02 (segment-aware matching), 03 (origin checks), 04 (fixed port).

**Status:** ready-for-agent

- [ ] `townd add <path>` analyzes the path, prints what it found, and persists it to the config file
- [ ] `townd add` refuses a path that is missing, is not a directory, or is already registered, exiting non-zero with the reason
- [ ] `townd rm <path>` removes a project; removing one that is not registered reports that rather than failing silently
- [ ] `townd --dir <path>` adds a project for one run without writing to the config file
- [ ] Every registered project accepts frames from startup, whether or not it has been analyzed
- [ ] A frame is routed to the deepest matching registered root; nesting two projects does not double-count or misroute either
- [ ] Each project's state persists to its own file, so restarting restores every town rather than one
- [ ] A project whose path has disappeared is reported as unreadable rather than crashing the daemon or blocking the others
