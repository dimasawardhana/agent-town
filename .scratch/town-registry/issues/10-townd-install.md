# 10 — Installing the extension is one command

**What to build:** `townd install` copies the extension into the agent's extension directory and reports what it wrote. Today installation is `mkdir` plus `cp` plus setting an environment variable, documented in a file the developer has no reason to have open.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] `townd install` copies the extension to the global omp extension directory and prints the path written
- [x] An existing extension is not overwritten without an explicit flag, so a local edit is not silently clobbered
- [x] A per-project install is available for scoping one repository
- [x] The command prints how to undo what it did
- [x] A missing agent extension directory is created rather than reported as an error
- [x] Installing does not require network access, so the stdlib-only rule holds
