# 29 — Why nine roads

**What to build:** Check the explanation offered for the road count, because it was
load-bearing and had never been tested.

**Blocked by:** 22.

**Status:** done

- [x] Measured every import specifier in this repository and where it lands
- [x] The offered explanation is wrong, and the test says so in the other direction
- [x] A permanent test asserts the corrected claim

## Comments

### I was wrong, and in the most embarrassing direction

I said, three separate times and with confidence, that nine import roads is low
**because this repository has two TypeScript buildings, so most imports resolve
within one**. It reads well and it had never been checked.

Measured on this repository's own code:

    same-building 65 · cross-building 111 · unresolvable 0 · bare 180 · roads 9

**Most imports are cross-building** — 111 of 176, 63% — and the count is low
because **the edge set is deduplicated**. 111 statements collapse to 9 distinct
building pairs:

    ui/test        -> ui/src/art          x43
    ui/src         -> ui/src/art          x20
    ui/src/art/props -> ui/src/art        x16
    ui/test        -> ui/src              x15
    ui/src/art     -> ui/src              x4
    ui/src         -> ui/src/art/props     x1
    ui/src/art     -> ui/src/art/props     x9
    ui/src/art/props -> ui/src/art/props   x1   (self, after nesting)
    internal/analyzer -> internal/town      x1

One pair — the test suite reaching into the art modules — is 43 of the 111. A
road per import would be 111 roads and would be a lie: it would say `ui/test`
depends on `ui/src/art` 43 times, which is a count of *how often* and not a fact
about the shape of the tree.

### The failure the test guards

`importmeasure_test.ts` asserts the *corrected* claim, so it fails if the
deduplication ever stops being the explanation:

- `cross <= roads` fails — the collapse would no longer be the whole story
- any unresolvable relative specifier fails — a dependency the map cannot draw
- zero roads fails

And the probe itself had a bug worth recording: it double-relativised the
building paths (`filepath.Rel` against an already-relative path), which made
**every one of 176 relative imports report as unresolvable**. The number looked
like a catastrophic scanner failure and was a mistake in the measuring. I nearly
concluded the scanner was broken on the strength of my own arithmetic.

### What this changes

Nothing about the code. The scanner was right and the explanation was wrong. That
is the whole finding, and it is the fourth time this session that a number I had
been quoting was not the number behind it.
