# 06 — A repo can declare its archetypes, and read one back

**What to build:** A manifest in the repository says what each directory is, and
a declaration overrides the hash. Selecting a building names it.

Two halves, because they are the same claim arriving from two directions: what
the repo says a building *is*, and what the town tells a reader it is.

A declared archetype is a claim the repository can get wrong, and a wrong claim
in a manifest is worse than a hash — one is a lie somebody chose, the other is
arbitrary and nobody minds. So the manifest is the repository's assertion about
itself, and the spec's rejection of *inferring* archetypes still stands: the
daemon reads what was said, it does not work out what was meant. That
distinction is why this is a later ticket rather than the first.

The name appears in the selection panel, which already exists and already shows
a building's state — never on a placard. The silhouette has to work first; the
label is what a reader gets when the silhouette did not convince them.

**Blocked by:** 03

**Status:** done

- [x] A manifest declares an archetype per directory path
- [x] A declared archetype overrides the hash; undeclared directories are
      unaffected and behave exactly as before
- [x] A path naming an archetype that does not exist falls back to the hash rather
      than drawing nothing
- [x] A directory with no entry is not an error, and an entry for a path that no
      longer exists is ignored
- [x] The manifest is read by the daemon; the browser never becomes a second
      authority on what a building is
- [x] Selecting a building names its archetype
- [x] The town stays deterministic: the same tree plus the same manifest gives the
      same town

## Comments

The format is unspecified here and should be a single JSON file at the repository
root — the town already reads and writes JSON for its own state, and a second
format would be a second thing to learn.

A repo with no manifest is unaffected by this entire ticket, which is the point:
it can land without changing anything anyone already has.

### Implemented: `ai-town.json` at the repository root

```json
{ "archetypes": { "ui/src/art": "chapel", "internal/town": "stadium" } }
```

**Measured against this repository**, with a manifest declaring three paths:
all three read back, and the town drew the declared chapel while falling back for
an unknown name.

### Two decisions worth keeping

**The analyzer does not validate archetype names.** A declaration of `bakery`
travels verbatim and the renderer ignores it. Validating here would mean holding
the vocabulary in two languages and letting them drift — the exact failure the
axis was built to avoid — and dropping unknown names early would make a *renamed*
archetype silently break every repo that declared the old one, with nothing to
say so. The panel still reports the declared name, so the request is visible
even when it could not be met.

**The precedence lives in one function.** `archetypeFor(declared, path)` is now
the only copy of the rule, and both the scene that draws and the panel that names
go through it. They were duplicates for a while, which is the shape that lets a
map and a label disagree about which building got which name — and importing the
panel's copy into a node test is what exposed that, since it dragged React in
behind it.

Everything a manifest can get wrong — absent, malformed, a non-object, a
non-string value, a path that no longer exists — yields no declaration and
nothing else. A town that refused to draw because a JSON file was mistyped would
be a worse failure than a town that quietly draws something else.
