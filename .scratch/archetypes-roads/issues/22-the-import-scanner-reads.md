# 22 — The import scanner actually reads

**What to build:** Multi-line imports, re-exports, lazy imports, and no comments.

**Blocked by:** none

**Status:** done

- [x] A multi-line TypeScript import produces a road
- [x] `export … from "…"` and a dynamic `import("…")` produce roads
- [x] A commented-out import produces none, in all three comment forms
- [x] Comment stripping respects string literals, so a `//` in a URL is not one

## Comments

### What it could not see, measured on this repository

`importSpecifiers` read one line at a time. That is fine for Go's single form and
useless for the form this project actually uses:

- **16 of 322 TypeScript files** open with `import {` and name the specifier on a
  closing line several rows later. Every one of those dependencies was absent
  from the map — not mis-drawn, *absent*.
- **Re-exports** (`export … from "./x"`) and **dynamic imports**
  (`await import("./x")`, which is how a lazily-loaded module names its target)
  were not recognised at all.
- **Comments were read as dependencies.** `imports.go` and `layout.go` both
  contain the literal text `import "../store"` inside a Go comment describing the
  exact case this scanner exists to reject.

The comment case is the one that matters. A missing road is a gap; a road to a
dependency that does not exist is a **confident lie**, and the whole design exists
to refuse those.

### Why a scanner and not a parser

A whole-file match with `(?s)`, bounded to the closing brace, is the right size
of tool: it reads every form the project uses and is still a scanner. A parser
would be more precise and would be a worse trade — it would have to be right
about TypeScript to read TypeScript, and a scanner that is slightly wrong here
fails *silent and in the safe direction*, because an unresolvable specifier draws
nothing.

Bounded as well as non-greedy, deliberately: an unbounded `.*?` from `import` to
the last quote on the page would pair one import with an unrelated string, and
that failure mode is invisible in the output.

### The comment stripper respects strings

Without that, the `//` in `"https://example.com"` eats the rest of the line and
takes a real import with it. Strings are tracked, so a URL stays a URL.

### The tests, and proving they bite

`TestCommentedImportIsNotARoad` asserts **exactly one** road, not "at least one" —
three commented Go imports sit in the fixture beside one real TypeScript import, so
a stripper that did nothing would produce four. The first version of that test
asserted `n != 0`, which passes with the stripper completely broken. Disabling
`stripComments` now produces 2 roads instead of 1 and the test fails.

`TestMultiLineImportStillMakesARoad` is decisive by construction: the fixture
contains no single-line import at all, so the road can only come from the
multi-line path.
