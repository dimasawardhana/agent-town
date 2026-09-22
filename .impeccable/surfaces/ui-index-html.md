---
version: 1
slug: "ui-index-html"
primary_target: "ui/index.html"
related_targets: []
---

# Surface: the town view (`/`)

Mode: **Operate**. The developer is monitoring an agent that is editing the same
machine; the surface is read at a glance, in bursts, while something else is
being worked on.

## Audience and job

A developer with an agent running in a terminal beside them. Their question is
"where is it, what is it doing there, and is the work going well" — answered in
one look, without reading a log. Frequency is glance-frequency: seconds at a
time, repeatedly, for the length of a session.

## Direction

A **16-bit isometric construction site**, seen as a fixed-camera diorama. The
town is a place you look at, from one angle, the way a SimCity or Transport
Tycoon screen was read: a tiled ground, buildings that rise through real
construction stages, and small figures walking between them.

## The world

THE THING: a persistent, glanceable picture of what an agent is doing right
now. Not a log, not a graph.

THE DEFAULT: dark dashboard with a sidebar of raw event rows, flat rectangles
for buildings, and pulsing circles for workers. Refused in full.

THE MECHANICAL GAMUT: the 16-bit isometric town-builder — SimCity 2000,
Transport Tycoon, Settlers, Age of Empires. Real, documented, and the exact
screen language this product's subject already lives in. Its disciplines:
tiled ground with edge pieces, buildings composited from modular wall/roof
parts, palette ramps with hue-shifted shadows, hard 1px ink outlines, and
animation carried by 2–4 frame loops.

THE LIGHT: cool ambient, one clear sun from the top-left, so every building's
west roof slope is lit and its front wall is a shade cooler and darker. The
mood is a working site at dawn: cold air, warm wood and lamps.

## Craft bar

Read at 1×. A 44-unit building is about 22 screen pixels wide before zoom; a
worker is 12. If a shape does not read at that size, it is redrawn rather than
detailed. Silhouette first, then one midtone, then one shadow, then one ink
line.

## What must remain untouched

- The daemon, the analyzer, the layout algorithm, and every world-unit number
  they emit (ADR-0012). The browser projects; it never re-derives.
- The one-way store flow, game to UI (ADR-0002).
- Loopback-only, zero dependencies, offline build. Every asset is authored in
  the bundle — no CDN, no image host, no runtime fetch.
- The domain vocabulary in `CONTEXT.md`. Never "agent" where "worker" is meant.

## Constraints carried by the subject

- Chief and sub workers must be distinguishable at a glance (ADR-0007).
- Eight worker actions must each be visibly different; the Go vocabulary and
  the UI's `Action` type are kept in sync by test.
- The Yard is roughly half of real work and the Depot a third. Neither may
  render as an empty field.
- A broken building must be visibly damaged and stay damaged.

## Unresolved

- Metaphor intensity (low/medium/high, ADR-0004) is unbuilt. This surface ships
  one world; the ADR is not contradicted by shipping it.
- Whether the isometric projection should live daemon-side.

## Direction contract

THESIS: a fixed-camera 16-bit isometric construction site, read at a glance;
refuses the dark-dashboard-plus-log-rows default and the flat rectangle.

OWN-WORLD: an authored 16-bit palette with hue-shifted ramps and hard 1px ink;
tiled grass and earth ground with a walkable Yard; buildings composited from
modular wall, roof, window and scaffold parts that visibly rise through stages;
figures 12px tall on two-tone legs; 3×5 bitmap letters for in-world labels;
a beveled slate side panel in the same palette.

STORY: the developer looks, sees that the agent is hammering the Analyzer
building and has left a scaffold where it is still framing, and sees a red
crack on the one it just failed — then goes back to work.

FIRST VIEWPORT: the whole town as a diorama, camera fitted to it, grass with a
band of Yard/Workshop/Depot props across the top, districts as diamond plates
below; the side panel is the monitor's read-out, not the main event.

FORM: 2:1 isometric projection computed from the untouched world-unit layout.
The town is the product; the panel annotates it.

SIGNATURE MOMENT: a worker walks a real diagonal path to a building and
switches to the animation for what the agent is actually doing — hammer blows
for an edit, a slow wide sweep for a test run — and the building it is working
on **climbs one rank per event**, so the frame goes up, then the walls close,
then the roof lands, then a passing test fits the windows. Damage is drawn over
whatever it has reached, so a failure at `walled` shows a crack in walls that
stay standing.

One rank, one part: `ui/src/art/building.ts` carries the ladder and the part
each rank adds, and the compositor draws every part up to the building's rank
in order. A roof cannot be drawn on a building with no walls, because the roof
is simply not reached. See ADR-0018.

VISIBLE RISK: isometric pixel art is easy to make muddy. The mitigation is a
restricted palette, integer zoom only, and a 1× readability rule enforced by
redrawing rather than detailing.
