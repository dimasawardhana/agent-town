# ADR-0019: Labels are revealed on hover, and pinned one at a time by focus

## Context

The map names things. A district, a building, a container, one of the three
places, and what a worker is doing — each is lettered onto a placard (ADR-0004's
art direction), and until now the *rule* deciding when a name is shown keyed on
depth alone: `labelAlwaysVisible(s) => s.depth <= 1`. Top-level sites wore their
names outright; everything deeper was revealed by pointing at it.

That split was reached by measuring a failure. A version that labelled everything
was rejected; so was one that labelled nothing, because then the map is anonymous
huts and the only way to learn which is which is to click each one, which is the
work a map is supposed to save. "Top level outright, deeper on hover" was the
compromise.

**The compromise does not hold on a real project, and the user said so.** Measured
on this repository — eighteen sites — the top level alone is thirteen boards at
once: `INTERNAL`, `UI`, `CMD`, the three place names, and each place's "what it
is for" and "which actions land here" lines. Thirteen placards on a map whose
whole value is its skyline is a wall of type, and the skyline is the thing
obscured. Reported as "the label make it look like a mess".

**Two further defects came out of the same report**, both measured rather than
reasoned about:

1. **A label could not be pinned.** Hover was the only way to read a name, so
   reading it meant holding the cursor still over a building — and moving to the
   panel to read the details took the name away. There was no way to say "this one,
   I am reading this one".
2. **Focus could not move.** There was no notion of focus at all, so there was
   nothing to move. The user's description — "the label will disappear and show on
   the object we're focusing on" — is a statement about a *single* lit label.

Wave to the buildings: separately, a worker's caption could not be revealed at
all. Its sprite is drawn at its feet, and a site's hit zone is drawn at the screen
`y` of the corner it stands on, so a figure standing on a building is *underneath*
that building's zone. Phaser's `topOnly` hit test hands the pointer to the
building, and the sprite was measurably absent from the hit list at its own
position.

## Decision

**Nothing is named at rest. Hover reveals; a click pins; focus is one id.**

1. **The rule is one pure function.** `labelVisible(id, hovered, focused)` returns
   `id === focused || id === hovered`. It lives in `ui/src/visibility.ts` beside
   `visibleAt`, tested without a renderer, for the same reason: both rules have a
   failure mode that a screenshot of a small town will not show.

2. **Focus is a single id, not a flag per label.** The user's requirement is that
   the label disappears from the last object and shows on the new one. One id is
   what makes that the only thing the model can express; a boolean per label can
   hold two focuses at once, and clearing the previous one then becomes something
   every call site has to remember rather than something the type forbids.

3. **Hover is deliberately weaker than focus.** A pinned label stays lit while the
   pointer previews a second object, and only the preview drops when the pointer
   leaves. Pointing at another building to read its name must not throw away the
   one that was clicked.

4. **Hover lives in the store, beside the focus.** Two layers own labels — the
   scene owns site and district names, `WorkerLayer` owns action captions — and one
   rule has to resolve for both. Held privately by each, pointing at a worker would
   light its caption while leaving a building's name lit from before: the two would
   disagree about what "the thing under the pointer" means.

5. **One sweep, called by whichever half changed.** `TownScene.refreshLabels`
   walks its registry and then hands the figures their answer. A second
   subscription inside `WorkerLayer` would have to know which labels the scene owns
   in order to leave them alone, and that knowledge is exactly what drifts.

6. **Selection and focus are separate state.** A click on the map sets both, but
   focusing a worker sets only the focus, so a reader watching one figure work has
   not stopped reading about the building it is in. Closing the panel clears both,
   because the pinned label is the panel's own subject.

7. **A figure's hit target is its own object**, at `HIT_DEPTH` above every site
   zone and below every label. Raising the sprite's own depth would fix the hit
   test and break the drawing, because a figure must be drawn where it stands.

## Why

Naming the top level outright was a reasonable guess that a real project falsified.
The measurement is what settles it: thirteen boards for eighteen sites, and the
boards describe a skyline they were covering.

The pin exists because hover alone forces the reader to hold a gesture to keep
reading. A name that vanishes the moment the cursor moves is not a name a reader
can use; pinning is the difference between a peek and a reference.

One focused id is the whole reason the behaviour the user asked for is
*expressible*. With a flag per label, "show it on the one we are focusing instead"
is a convention maintained by hand at every call site; with one id it is the only
state the model can hold.

The cost is accepted: a reader scanning the map no longer sees any names until
they point at something. That is the trade the complaint asked for — the map shows
the town, and the names are answered on request. The legend panel still lists the
places, so the three that most need naming are named in the panel without asking.

## Consequences

- `labelAlwaysVisible` is deleted, with its tests, and replaced by `labelVisible`.
  The old rule's "keys on depth, not on the filter" property disappears with it —
  it is moot once nothing is shown by default.
- `Site.depth` no longer feeds the label rule; it still drives `visibleAt`, and
  containers still use `minChildDepth`.
- District plates gained a hover zone, so the ground names the neighbourhood. It is
  placed under the sites standing on it, and `topOnly` makes that ordering
  sufficient.
- The store gained `focused` and `hovered`, both cleared when the project changes:
  an id from the project being left names nothing in the one being opened, so
  keeping it would light whichever new label happened to reuse the id.
- Worker label ids are namespaced (`worker:<id>`), because focus and hover carry
  ids from two owners and a raw worker id equal to a site id would light both.
- A worker's click is guarded against map drags by the scene's own travelled
  distance, so a pan that ends over a figure does not pin it.
