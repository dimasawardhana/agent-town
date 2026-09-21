# 03 — Project becomes a town

**What to build:** Given the path to a git repository, AI Town produces the town's structure — its districts, its buildings and their sizes — without any agent running. This is the static town: the thing that exists before work starts, and the thing that grows as the project grows.

Verifiable by running it against `team-builder` (25 buildings, 3 districts) and `Image-nation` (which must not drown in vendored noise).

**Blocked by:** None — can start immediately, in parallel with 01.

**Status:** done

- [x] Pointing at a repo produces a set of buildings, each with a path, a name, a district, and a size in source files
- [x] **Vendored noise is excluded.** `Image-nation` holds 9392 `.h` and 7498 `.pyc` files under `venv/` and `onyx_data/`; only its ~86 real source files may become buildings. If the ignore rules fail, that repo alone produces thousands of buildings and the town is unusable
- [x] Ignore rules cover at least: `.git`, `node_modules`, `dist`, `build`, `.next`, `.nuxt`, `__pycache__`, `venv`, `.venv`, `coverage`, `.turbo`, and any dot-directory
- [x] The **repo root is not a building.** Root files belong to the Workshop, so they neither invent a building nor get dropped
- [x] Districts come from the top path segment, and a building's size scales with its source-file count — a project twice the size produces a visibly bigger town
- [x] A file nested several directories inside a building resolves to that building, not to a sub-building
- [x] Running against two different repos produces two different towns; running twice on one repo is stable
- [x] The output includes each building's source-file count, which the layout in ADR-0012 uses to size it
- [x] The output is a pure function of the tree — no timestamps, no ordering instability — so the same repo always yields the same town

**Guard against:** a directory tree that is technically correct but visually useless. `team-builder` yields an `e2e` district of 15 buildings averaging 2 files each. Test directories swamping source directories is the first thing that breaks the metaphor at scale — decide and record how test-heavy trees are handled.
