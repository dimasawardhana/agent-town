# 08 — Analysis is bounded by a file budget and admits when it truncated

**What to build:** Analysis stops after visiting a bounded number of source files, so pointing the daemon at something enormous cannot wedge it. Measured: `~/` is 20,827 buildings and takes about 50 seconds with no bound at all; a budget of 2000 files caps it at roughly 43ms while leaving every real repository intact.

Bounding *depth* instead was measured and rejected: at depth 2 the wedding-invitation repository yields an empty town, and depth 4 keeps 80% of the work anyway.

**Blocked by:** 05.

**Status:** done

- [x] Analysis stops after `--max-files` source files, defaulting to 2000
- [x] The bound is deterministic: the same tree yields the same buildings on every run
- [x] A repository within the budget is unaffected — a normal repository produces exactly the town it did before
- [x] A truncated project is reported as Partial, with the file count seen and the fact that the town is incomplete
- [x] The UI states that a Partial town is incomplete rather than presenting it as whole
- [x] A file count large enough to time the walk is measurably bounded, not merely claimed to be
