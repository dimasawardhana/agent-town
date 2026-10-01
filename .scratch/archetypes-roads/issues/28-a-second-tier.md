# 28 — A second tier, once someone reported it

**What to build:** The map-scale mark for "an agent is working here", distinct from
"this was touched recently".

**Blocked by:** 16, 27.

**Status:** done

- [x] A ring, where the ember is a dot
- [x] It is not placed alongside the ember — two marks at one point read as one
      mark flickering
- [x] It appears only while the daemon reports a session at that building
- [x] Its claim is the narrowest the town can make

## Comments

### Ticket 27 said to wait for a report. This is that report.

27 recorded: *"If a machine is genuinely hard to spot while an agent works, the
honest fix is a second ember tier or a badge over the building — both cheap, and
neither needed until someone reports it."* A report is a fact about the world, not
a preference, and it arrived, so the pre-emptive version was right and the
deferred one was also right.

### A different shape, not a brighter one

The first instinct was a brighter ember. It is wrong for a specific reason: **a
pulse is not a claim.** A dot that pulses says the same thing twice, more
emphatically. A ring says *occupied*, which is a different fact from *recently
touched*, and only one of the two should carry it.

The ring's middle is left open so the building's own contact shadow stays visible
through it — a filled mark would sit on the ground the building stands on.

### The claim is the narrowest available

A session is at this building. Not that it is busy, not that it is doing something
interesting, not that the work matters — the daemon reports where a worker is
standing, and that is the entire fact. Every one of those would be an invention,
and this is the file that already refuses to fade a glow rather than leave a false
one behind.

### Two tests, and one of them is nearly a fake

`the working mark is a different mark` is structural and weak on its own. The
second one — a session that leaves stops claiming it is there — is the expensive
failure, because a ring that outlived its session would say an agent stopped, and
**the town must not be the thing that says an agent stopped.**

Writing the first version of that test drove me to build a spy helper that
re-implemented the layer's own logic, which tests nothing. It now states the
contract in three lines instead, which is the second time this session a
test that passed was not testing anything.
