# 09 — Deep detail is drawn on request, without moving anything

**What to build:** The town draws shallower sites first and reveals deeper ones on request. Because the layout is computed once from the full analysis and only *filtered* for display, revealing deeper buildings never moves the ones already on screen.

This is the property that makes the feature safe. Buildings are placed by index into a sorted slice, so re-running the layout over a subset moves them — measured at 12 of 18 buildings. Filtering the output avoids that entirely.

**Blocked by:** 06, 08.

**Status:** ready-for-agent

- [ ] A detail control limits which buildings are drawn, by depth
- [ ] Revealing deeper buildings leaves every visible building in exactly the position it already occupied
- [ ] Positions are identical to the full layout, so the same repository yields the same town regardless of how much detail is shown
- [ ] The camera bounds account for what is drawn, so revealing deeper buildings does not clip them
- [ ] A site that is not drawn yet still resolves — a worker sent there is not lost
