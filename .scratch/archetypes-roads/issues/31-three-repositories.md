# 31 — Three repositories, not one

**What to build:** Check the import-road explanation against a sample rather than
against a single case.

**Blocked by:** 29.

**Status:** done

- [x] Three real repositories measured
- [x] The explanation holds, and the ratio is reported with it
- [x] A permanent test, skipped where the repositories are absent

## Comments

| repo | buildings | roads | same | cross | unresolvable | collapse |
|---|---|---|---|---|---|---|
| team-builder | 32 | **60** | 87 | 214 | 6 | 3.6x |
| wedding-invitation | 19 | **0** | 32 | **0** | 1 | — |
| agent-town | 14 | 9 | 65 | 111 | 0 | 12.3x |

### Two things no single row shows

**The collapse ratio is a property of how coupled a repository is, not a
constant.** 3.6x on team-builder, 12.3x here, where `ui/src` and `ui/src/art`
import each other constantly. "Imports collapse to roads" without the ratio is
as uninformative as the road count alone — which is how I got it wrong twice.

**`wedding-invitation` has 19 buildings, 32 imports and zero roads.** Every import
is internal to its own building. **That is the case the old explanation was
reaching for, and it is real** — it is just not *this* repository. A true fact
found once and applied too broadly. That is the whole shape of the error, and it
is the third time this session.

### team-builder has 6 unresolvable relative specifiers

Six relative imports reach no building the analyzer knows. Each is a dependency
the map cannot draw. Six out of 301 is good, and it is worth naming rather than
rounding to zero: the scanner refuses them by design, and a refusal that is
invisible is a refusal that looks like a success.

The test asserts the two invariants that survive any repository: cross-building
imports produce at least one road, and never more roads than edges exist.
