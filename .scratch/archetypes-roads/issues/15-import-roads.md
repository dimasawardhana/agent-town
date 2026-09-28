# 15 — Import roads: "this calls that"

**What to build:** A road from a building to each building whose source it
imports, so the map shows dependency rather than only containment.

**Blocked by:** 08

**Status:** done

- [x] An import between two buildings in this town draws a road
- [x] A specifier that escapes the repository draws nothing
- [x] A bare specifier — a package, a module, the standard library — draws nothing
- [x] A string that merely looks like an import, in a function body, draws nothing
- [x] JavaScript `from "..."` and `require("...")` are recognised, and Go's
      import block
- [x] The scan is order-independent, so the same tree gives the same roads
      (ADR-0012)

## Comments

### The rule that bounds the whole feature

**An edge exists only when both ends resolve to buildings this analyzer
actually found.** Everything else draws nothing.

A scanner that read anything looking like an import and assumed a target would
draw roads to packages, to the standard library, to directories that do not
exist — every one a confident line to a place the map does not contain, on a map
whose entire claim is that it only says true things.

So a bare specifier yields no road. Not because it is unparseable but because it
names something *outside this town*, and a road to it would be a fiction. The
test asserts the refusals as hard as the drawing, because the refusals are the
feature: a repository this cannot read simply has no import roads, and that is a
correct description rather than a failure.

### Relative specifiers resolve to a file; the town draws a directory

A relative specifier names a *file* and the town draws *directories*, so the
resolved path is walked up to its longest ancestor that is a building. That is
the whole of the resolution, and it is why relative imports work at all here.

### Measured

**8 import roads on this repository**, of 14 roads in total. The map now says
which buildings depend on which, which is the thing a reader scanning a town is
usually trying to learn and the one thing containment roads could never say.
