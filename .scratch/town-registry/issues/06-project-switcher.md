# 06 — The UI switches which town is on screen

**What to build:** A control listing the registry, where choosing a project shows that town. Switching changes only what is drawn — every registered project keeps folding events and persisting in the background, because a town is the result of real work and switching away must not pause someone's build.

**Blocked by:** 05.

**Status:** done

- [x] The UI lists every registered project and marks which one is being viewed
- [x] Choosing a project shows its town, with its own workers, buildings and canvas bounds
- [x] The live event stream delivers only the viewed project's snapshots, so a snapshot from another project never redraws the wrong town
- [x] Work continuing in a project that is not being viewed still updates that project's state
- [x] Switching back shows the work that happened while it was away
