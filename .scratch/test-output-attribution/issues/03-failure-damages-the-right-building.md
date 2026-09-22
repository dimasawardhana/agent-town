# 03 — A failing test damages the building that broke

**What to build:** When a test run reports failing packages, damage those
buildings. The result is that a whole-repo test failure marks the one building
that actually broke, instead of landing nowhere.

**Blocked by:** 02 (the failing paths must be on the event).

**Status:** ready-for-agent

- [ ] A whole-repo run with one failing package damages exactly that building
- [ ] A whole-repo run with three failing packages damages all three
- [ ] The building the *command* named is still damaged as before, so a scoped
      failure is unchanged
- [ ] A failing package that resolves to no building is dropped; the event is
      still recorded in the feed, and the town does not invent a location
- [ ] Damage from a failure never advances a rank, and never rolls one back
      (existing behaviour, asserted again because this adds a second damage path)
- [ ] `Problems` increments once per damaged building, not once per failure

## Why

This is the gap as reported: *"a test that fails still cannot say which building
actually broke."* Ticket 02 supplies the names; this ticket is where they become
damage.

## Notes

`Town.Apply` currently damages the single building the classification named. The
change is to damage the *union* of that building and the resolved failing
packages, deduplicated — hence the "once per building" criterion, which a naive
`for _, p := range failing { damage(p) }` would get wrong when the command's own
building also appears in the failing list.

Ordering matters for the same reason: a scoped `go test ./internal/town` that
fails reports `internal/town` in both places, and it must end up with one
increment of `Problems`, not two.
