# 33 — A test that tests itself

**What to build:** The check that four green tests were not checks at all.

**Blocked by:** none.

**Status:** done

- [x] A local that *decides* what production decides is reported
- [x] A test double cast into an interface rather than built is a hard failure
- [x] A test that neither imports nor reads the source is a hard failure
- [x] The real `Embers.reconcile` is exercised, through a record of what it asked
      the engine for

## Comments

### Four times, and the same shape every time

A test passed while the code did the opposite, because the test reimplemented the
logic instead of calling it:

1. `reconcileSpy` — a local arrow standing in for `Embers.reconcile`, on a test
   named *"a session that leaves stops claiming it is there"*, guarding a ring
   that never came off.
2. `marked()` — the same, in the same file, on the same tick.
3. A canvas double that stored gradient *objects* verbatim, so it could not see a
   gradient — and was `as unknown as`-cast to fit the interface it was not
   implementing.
4. A road-count probe that double-relativised its paths and made all 176 imports
   look unresolvable.

`commenttruth` compares a *comment* to the code beside it. Nothing compared a
*test* to the code it names. That is the gap, and it cost three of those four.

### What the check can and cannot say

It reports, it does not block, on the strictest rule — and that decision is
measured rather than preferred. A name-shadowing check fires on four one-line
accessors in `art.test.ts` called `at`, `box` and `hex`. A check that blocks on
that gets disabled within a week.

The narrower signal is the one that mattered: a local whose body **branches on**
the thing production branches on. A helper that looks a value up is a fixture. A
helper that decides the same question is the defect.

The cast rule is a hard failure, because it bit once and the fix is mechanical:
build the whole shape, so a member the production code starts using is a type
error rather than `undefined` at runtime.

### The check shipped broken three ways

- It read `ui/` for test files, which are in `ui/test/` — so it examined nothing
  and **passed on an empty result.** The exact failure it exists to catch,
  committed by the check itself.
- It collected top-level exports and so never heard of `Embers.reconcile`, which
  is a *method*. Reintroducing the real defect did not trip it.
- It flagged its own documentation, which contains the phrase it greps for.

Each was found by making the check fail on a real instance and then noticing it
did not. **A check that has never failed has not been tested.**

### The fix for the guarded test

`embers.test.ts` now drives the real `Embers`, against the smallest engine that
will do: a record of what the layer *asked* for. The one question is "which
texture is the mark showing", and nothing in the double decides that — the layer
does, and the record answers.
