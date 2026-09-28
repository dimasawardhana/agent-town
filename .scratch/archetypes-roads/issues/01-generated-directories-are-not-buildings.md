# 01 — A directory with no authored bytes is not a building

**What to build:** A directory containing only generated output stops appearing
as a building, so the town stops drawing a 1.7 MB compiled bundle as a plot.

Today a directory is a building when it holds source directly. Generated
directories are *marked* generated and sized at one storey, but they remain
buildings. ADR-0004 §4 already says they should not be: they "shouldn't create
buildings… may appear as infrastructure but not as buildings."

This is dull today — such a building draws as a bare plot. It is not dull after
ticket 03, where it would draw as a **Tenement**: a compiled artefact rendered as
a residential block, with a name attached. A label turns a vague drawing into a
false claim, so this lands first.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] A directory whose authored byte count is zero is not a building
- [x] Every directory with any authored source is still a building
- [x] The rule is stated in terms of authored bytes, matching the rule that sizes
      a building and the rule that sizes a container — one meaning of "authored"
- [x] A generated directory that also holds hand-written source is still a
      building
- [x] The repo's own map loses exactly the directories it should, and the count
      is measured and recorded
- [x] A repository that is nothing but generated output produces no buildings and
      does not fail

## Comments

This is the smallest ticket in the set and the only one that removes something
currently visible. The bundle *is* part of the repository, so there is a real
case for leaving it — the counter-argument is recorded in the spec and the
decision was to follow the ADR.

The bundle does not simply vanish. ADR-0004's alternative is infrastructure, and
ticket 08 is what gives infrastructure a visual language. So there is a gap
between this ticket and that one, deliberately: better a visible absence than a
building the town is confidently wrong about.

### Measured

This repository: 15 directories, **14 buildings**. The one dropped is
`internal/web/static/assets` — the embedded UI bundle, alone in its directory
with no authored bytes. The two directories beside it that also contain output
(`internal/web`, `internal/web/static`) both survive, because both hold
hand-written files. `TestTheRuleRemovesExactlyTheArtefactDirectoryFromThisRepo`
records the count so a change in what the analyzer sees is visible rather than
silent.
