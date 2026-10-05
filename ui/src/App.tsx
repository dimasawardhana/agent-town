// The UI shell. React renders panels; Phaser renders the town (ADR-0002).
//
// This is the DOM overlay: it sits on top of the canvas and reads the same
// store the scene writes to.

import { useEffect, useRef } from "react";
import { type BuildingState, useTown } from "./store";
import { EMBER_MS } from "./embers";
import { ARCHETYPES, archetypeFor, type Archetype } from "./art/roof";
import { STAGE_ORDER, type Stage } from "./art/building";
import { PLACE_INFO, PLACE_ORDER, placeInfoFor } from "./place";
import { fetchProjects, fetchTown, subscribe } from "./api";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { TownCanvas } from "./TownCanvas";
import { SolidView } from "./solid/SolidView";
import { Hud } from "./Hud";

/**
 * The ladder in the words a developer would use, and what each rank adds.
 *
 * The map shows how far along a building is; this is where the panel says which
 * part that is, because "glazed" is the name of a stage and "windows fitted" is
 * what happened. Kept in step with `Stage` by the index signature, so a rank
 * added to the union fails the build here rather than rendering blank.
 */
/**
 * The archetype a site is drawn as, by the same precedence the scene uses: a
 * declaration this build recognises, otherwise the path hash.
 *
 * Duplicated rather than imported from the scene because the scene's copy is a
 * private method on a Phaser object and this is a React component — sharing it
 * would mean hoisting a rule out of the renderer for the sake of one label. The
 * two must agree, so the precedence is pinned once in `archetypes.test.ts` and
 * this comment says where the other half lives.
 */
export function archetypeForSite(site: { archetype?: string; path?: string }): Archetype {
  const declared = site.archetype as Archetype | undefined;
  if (declared && ARCHETYPES.includes(declared)) return declared;
  return archetypeFor(site.archetype, site.path);
}

/**
 * The declared name even when this build cannot draw it.
 *
 * A repository asking for something the town has never heard of is worth
 * reporting rather than silently replacing with whatever the hash picked: the
 * declaration is the repository's own assertion, and a reader looking at the
 * panel is exactly the person who should see that the request went unmet.
 */
function declaredArchetypeName(site: { archetype?: string }): string | null {
  return site.archetype ? site.archetype : null;
}

const BUILD_STAGE_LABEL: Record<BuildingState["status"], string> = {
  planned: "plot staked out",
  foundation: "foundations in",
  framed: "frame up",
  walled: "walls closed",
  roofed: "roof on",
  glazed: "windows fitted",
  doored: "door hung",
  completed: "complete",
};
/**
 * The stage ladder, in build order, with the label a developer would use.
 *
 * Order is the point: a count per stage is only readable if the stages read
 * left to right as progress, so this is the ladder and not the alphabet.
 *
 * **Every rank, derived from `STAGE_ORDER` rather than restated.** A hand-typed
 * five-entry version dropped `foundation`, `glazed` and `doored`, and because
 * the counts are filtered through this list those buildings were then reported
 * nowhere — the chips did not sum to the "N buildings" line printed directly
 * above them. CONTEXT.md is explicit that the ladder never skips a rank, so the
 * panel cannot either: the list is the art's own, and a rank added there shows
 * up here without anyone remembering this file.
 */
const STAGE_LABELS: Partial<Record<Stage, string>> = {
  planned: "plot",
  foundation: "found",
  framed: "framed",
  walled: "walled",
  roofed: "roofed",
  glazed: "glazed",
  doored: "doored",
  completed: "done",
};

const LADDER = STAGE_ORDER.map((key) => ({ key, label: STAGE_LABELS[key] ?? key }));

/**
 * TownPulse replaces a line that read "14 buildings · 5 districts".
 *
 * That was true and useless. The panel exists to answer *what has the agent
 * actually built here*, and a count of buildings cannot answer it — the same
 * 14 buildings are a staked field or a finished town, and the difference is
 * exactly what a reader came for. So this is the one place that says it: how far
 * along the ladder the town is, what is failing, and what is being worked on
 * right now.
 */
function TownPulse() {
  const town = useTown((s) => s.town);
  const live = useTown((s) => s.live);
  // Above the guard on purpose. A hook called after `if (!town) return null`
  // changes the hook count on the render where the town first arrives, and
  // React throws on that rather than on the thing that is actually wrong.
  const layout = useTown((s) => s.layout);
  if (!town) return null;

  const at = new Map<string, number>();
  for (const b of live.buildings) at.set(b.status, (at.get(b.status) ?? 0) + 1);
  const unresolved = layout?.unresolvedImports;
  const damaged = live.buildings.filter((b) => b.damaged).length;
  const verified = live.buildings.filter((b) => b.verified).length;

  // The same two minutes the ember claims, counted the same way. Reusing the
  // constant is the point: a "recently worked" figure that disagreed with the
  // glow on the map would be two different claims about one fact.
  const now = Date.now();
  const recent = live.buildings.filter((b) => now - b.updated < EMBER_MS).length;

  const present = LADDER.filter((l) => (at.get(l.key) ?? 0) > 0);

  return (
    <section className="pulse">
      <h2>Town</h2>
      <p className="meta">
        {town.buildings.length} buildings · {town.districts.length} districts
      </p>

      {present.length > 0 && (
        <ul className="ladder">
          {present.map((l) => {
            const n = at.get(l.key) ?? 0;
            return (
              <li key={l.key} title={`${n} at ${l.label}`}>
                <span className="lcount">{n}</span>
                <span className="lname">{l.label}</span>
              </li>
            );
          })}
        </ul>
      )}

      {/* What the map could not draw.
          A relative import the scanner resolved to no building produces no road,
          because a guessed road is a confident lie. But the reader cannot tell
          "this project has no inter-district dependencies" from "this project
          has six the map could not place", and those are very different claims.
          Said here rather than on the map, because it is about the *absence* of a
          thing and belongs where absences are reported. */}
      {(unresolved ?? 0) > 0 && (
        <p className="signals">
          <span
            className="sig dim"
            title="Relative imports naming something the analyzer found no building for. They are real dependencies the map cannot draw, not missing ones."
          >
            {unresolved} not drawn
          </span>
        </p>
      )}

      {/* Only what is present. A row of zeroes is noise, and its absence
          already says the thing it would have said. */}
      {(damaged > 0 || verified > 0 || recent > 0) && (
        <p className="signals">
          {damaged > 0 && (
            <span className="sig down">
              {damaged} failing
            </span>
          )}
          {verified > 0 && (
            <span className="sig done">
              {verified} verified
            </span>
          )}
          {recent > 0 && (
            <span className="sig hot" title="worked on in the last two minutes">
              {recent} just worked
            </span>
          )}
        </p>
      )}
    </section>
  );
}

export function App() {
  const town = useTown((s) => s.town);
  const projects = useTown((s) => s.projects);
  const current = useTown((s) => s.current);
  const setProjects = useTown((s) => s.setProjects);
  const renderer = useTown((s) => s.renderer);
  const selected = useTown((s) => s.selected);
  const live = useTown((s) => s.live);
  const rawEvents = useTown((s) => s.events);
  // The daemon publishes whole snapshots when it has a town to interpret, and
  // bare events when it does not. Prefer the snapshot: it is the authority.
  const events = live.events.length > 0 ? live.events : rawEvents;
  const connected = useTown((s) => s.connected);
  const error = useTown((s) => s.error);
  const setTown = useTown((s) => s.setTown);
  const setLive = useTown((s) => s.setLive);
  const setConnected = useTown((s) => s.setConnected);
  const setError = useTown((s) => s.setError);
  const pushEvent = useTown((s) => s.pushEvent);
  const select = useTown((s) => s.select);
  const focus = useTown((s) => s.focus);


  // The selected site's building state, if it is a building the town knows
  // about. A site can be selected before any work has landed on it, in which
  // case the panel shows no stage rather than claiming one.
  const built = selected?.path
    ? live.buildings.find((b) => b.path === selected.path)
    : undefined;
  // The selected site's place description, for the three that are places rather
  // than buildings. A place is never "built", so this and `built` are mutually
  // exclusive and the panel picks one branch or the other.
  const place = selected ? placeInfoFor(selected) : null;
  // What this building is drawn as, and what the repository said it is when the
  // two differ. Computed here rather than in the scene so the panel and the map
  // cannot disagree about which building got which name.
  const drawnName = selected && selected.kind === "building" ? archetypeForSite(selected) : null;
  const declaredName = selected && selected.kind === "building" ? declaredArchetypeName(selected) : null;
  // What this building imports, if anything. The map marks *whether* with a ring
  // inside the building's own plot; this is where the *which* is answered,
  // because the panel has room for exact names and the map does not.
  const imports = selected?.imports ?? [];

  // load reads one project's town. An empty path names none, which the daemon
  // answers with every project it serves.
  const load = useRef(async (project: string) => {
    try {
      const { town, layout, live } = await fetchTown(project);
      setTown(town, layout, live);
      // Viewing a project analyzes it, which changes its state in the registry.
      // Re-reading the list keeps the switcher's labels honest rather than
      // leaving a project marked "analyzing" after it has finished.
      const list = await fetchProjects();
      setProjects(list, project);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  });

  // The registry is read once. A daemon with no projects is a normal state,
  // not an error: the panel says so rather than rendering an empty town.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await fetchProjects();
        if (cancelled) return;
        setProjects(list, list[0]?.path ?? "");
        if (list.length === 0) {
          // Fall back to the unfiltered town so a daemon started with --dir
          // but no registry still draws something.
          await load.current("");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setProjects]);

  // Subscribe once, scoped to the viewed project. Re-opening the stream on
  // every switch is what keeps a client from being handed another town's
  // snapshots, and the daemon closes the old one when we do.
  useEffect(() => {
    if (!current) return;
    void load.current(current);
    return subscribe(
      setLive,
      pushEvent,
      setConnected,
      () => void load.current(current),
      current,
      // The registry changed under us — a project was added or removed in
      // another terminal. Update the switcher without a page reload.
      (list) => setProjects(list, current),
    );
  }, [current, setLive, pushEvent, setConnected]);

  return (
    <div className="app">
      {/* The stage is the positioning context for the floating controls. It is
          its own element rather than `#town` itself, because `#town` is the
          element Phaser mounts the canvas into and two owners appending children
          to one node is a race neither of them admits to.

          **Exactly one renderer is mounted at a time.** They are two canvases
          with two frame loops, and leaving both alive would draw the flat town
          under a solid one — and, worse, keep a WebGL context open for a view
          nobody is looking at. `SolidView` tears its context down on unmount for
          that reason. */}
      <div className="stage">
        {renderer === "solid" ? <SolidView /> : <TownCanvas />}
        <Hud />
      </div>
      <aside className="panel">
        <header>
          <h1>{town ? town.name : "AI Town"}</h1>
          {/* The lamp says the same thing in words as in colour, so the
              connection state is not carried by hue alone. */}
          <span className={connected ? "dot ok" : "dot down"} />
          <span className="lamp-label">{connected ? "live" : "down"}</span>
        </header>

        <ProjectSwitcher />


        {town && <TownPulse />}


        {!town && projects.length === 0 && (
          <p className="muted">
            No projects registered. Run <code>townd add &lt;path&gt;</code> to
            add one — <code>townd</code> prints the same advice on startup.
          </p>
        )}

        {selected && (
          <section className="detail">
            <h2>{selected.label}</h2>
            {/* A building is a directory and says so; a place is a metaphor and
                needs explaining every time it is opened, because a reader who
                clicked the Depot is asking exactly what a Depot is. */}
            {place && (
              <>
                <p className="blurb">{place.blurb}</p>
                <dl>
                  <dt>Work here</dt>
                  <dd>{place.takes}</dd>
                  <dt>Crew here</dt>
                  <dd>{live.workers.filter((w) => w.placeKind === selected.kind).length}</dd>
                </dl>
              </>
            )}
            {!place && (
              <dl>
                <dt>Kind</dt>
                <dd>{selected.kind}</dd>
                {selected.path && (
                  <>
                    <dt>Path</dt>
                    <dd className="path">{selected.path}</dd>
                  </>
                )}
                {/* What this building *is*, named. The silhouette has to work
                    on its own — a placard would let a weak drawing hide behind
                    a strong word — so this is the fallback for a reader who is
                    not sure, and the only place the archetype is ever written
                    down. It reports what the repository declared where there is
                    a declaration, and the hash's pick otherwise, because a name
                    the renderer could not draw is still worth saying: it is what
                    the repository asked for. */}
                {selected.kind === "building" && (
                  <>
                    <dt>Built as</dt>
                    <dd className="archetype">
                      {declaredName
                        ? `${declaredName}${drawnName !== declaredName ? " (declared)" : ""}`
                        : drawnName}
                    </dd>
                  </>
                )}
                {selected.files > 0 && (
                  <>
                    <dt>Source files</dt>
                    <dd>{selected.files}</dd>
                  </>
                )}
                {/* A building's stage is the point of the ladder, so the panel
                    names it in words and the part it just gained: the map shows
                    how far along it is, and this says which part that is. */}
                {built && (
                  <>
                    <dt>Stage</dt>
                    <dd className={built.damaged ? "stage damaged" : "stage"}>
                      {BUILD_STAGE_LABEL[built.status]}
                      {built.damaged ? " — damaged" : ""}
                    </dd>
                    <dt>Work here</dt>
                    <dd>{built.touches}</dd>
                    {built.problems > 0 && (
                      <>
                        <dt>Failures</dt>
                        <dd className="problems">{built.problems}</dd>
                      </>
                    )}
                  </>
                )}
              </dl>
            )}
            <button
              className="bevel"
              onClick={() => {
                // The focus goes with the panel, because the pinned label is the
                // panel's own subject: leaving it lit over a building whose
                // details have been dismissed would be a label with nothing left
                // saying why it is open, and no way to close it.
                select(null);
                focus(null);
              }}
            >
              Close
            </button>
          </section>
        )}

        {imports.length > 0 && (
          /* The map rings a building that imports anything; this says to whom.
             Kept to a count plus the list because a town where every building
             imports nine others should not turn the panel into a second map. */
          <section className="crew">
            <h2>Imports</h2>
            <ul>
              {imports.map((to) => (
                <li key={to}>
                  <span className="at">{to}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* The legend, before the crew: a reader meeting this town for the
            first time needs to know what the Yard, the Workshop and the Depot
            are before seeing a worker standing in one. The map letters each
            place's name onto its own ground; this says what the work in it is,
            which no amount of furniture can. */}
        <section className="legend">
          <h2>Places</h2>
          <ul>
            {PLACE_ORDER.map((k) => {
              const p = PLACE_INFO[k];
              const here = live.workers.filter((w) => w.placeKind === k).length;
              return (
                <li key={k} className={here > 0 ? "busy" : ""}>
                  <span className="nm">{p.name}</span>
                  <span className="cnt">{here > 0 ? here : ""}</span>
                  <p className="blurb">{p.blurb}</p>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="feed">
          <h2>Activity</h2>
          {events.length === 0 ? (
            <p className="muted">
              No events yet. Install the AI Town extension and start your
              agent — it finds the daemon on the default port, so no environment
              variable is needed. Only a daemon started with <code>--port</code>{" "}
              wants <code>AI_TOWN_URL</code>.
            </p>
          ) : (
            <ul>
              {events.map((e, i) => (
                <li key={`${e.id}-${i}`} className={e.result === "error" ? "err" : ""}>
                  <span className="type">{e.type}</span>
                  <span className="tool">{e.tool}</span>
                  {e.target?.path && <span className="path">{e.target.path}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}
