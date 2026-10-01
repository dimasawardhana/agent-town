# 32 — Say what was not drawn

**What to build:** The map shows fewer roads than the code has dependencies. Say so.

**Blocked by:** 31.

**Status:** done

- [x] The analyzer counts relative imports it resolves to nothing
- [x] The count travels on the layout, not recomputed in the browser (ADR-0012)
- [x] The panel reports it, only when non-zero
- [x] A bare specifier is *not* counted, and a test says why

## Comments

### A silent refusal looks like a success

The scanner draws no road for a relative import it cannot resolve. That is the
only safe behaviour — a guessed road is a confident lie, which is the one thing
this town does not do. But the reader cannot tell:

- "this project has no dependencies between districts", from
- "this project has six, and the map could not place them".

Those are **very different claims about the code**, and the map made the second one
while looking like it made the first. Measured: 6 unresolvable of 301 on
team-builder, which has 60 import roads. Six is nothing. Six is *invisible*.

### The count is a claim, so it is checked

A number nobody checks is a claim in exactly the way the map's are not. The test
asserts the layout's number equals the scan's, and that it stays small — over 50
is not a few missed edges, it is the scanner failing, and the test says so rather
than reporting a comfortable number.

### What is deliberately *not* counted

A bare specifier (`react`, `fs`, `net/http`) is a package outside this town by
definition. Counting it would report a scanner failure where there is none, and a
number that cries wolf is worse than no number. The count is **only** the relative
imports the map was asked to draw and could not.

### Where it is said

In the panel, not on the map — because it is about the *absence* of a thing, and
absences belong where absences are reported. And styled as the dimmest chip in
the panel, because it is a limit of the scanner and not a state of a building;
dressing it in a signal colour would claim a building is in trouble.

Shown only when non-zero. A row of zeroes is noise, and its absence already says
the thing it would have said — the same rule the other three signals follow.
