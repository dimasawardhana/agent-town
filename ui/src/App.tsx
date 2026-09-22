// The UI shell. React renders panels; Phaser renders the town (ADR-0002).
//
// This is the DOM overlay: it sits on top of the canvas and reads the same
// store the scene writes to.

import { useEffect, useRef } from "react";
import { SITE_ID_BUILDING_PREFIX, type BuildingState, useTown } from "./store";
import { actionInfo, targetOf } from "./actions";
import { PLACE_INFO, PLACE_ORDER, placeInfoFor } from "./place";
import { fetchProjects, fetchTown, subscribe } from "./api";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { TownCanvas } from "./TownCanvas";

/**
 * The ladder in the words a developer would use, and what each rank adds.
 *
 * The map shows how far along a building is; this is where the panel says which
 * part that is, because "glazed" is the name of a stage and "windows fitted" is
 * what happened. Kept in step with `Stage` by the index signature, so a rank
 * added to the union fails the build here rather than rendering blank.
 */
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
export function App() {
  const town = useTown((s) => s.town);
  const projects = useTown((s) => s.projects);
  const current = useTown((s) => s.current);
  const setProjects = useTown((s) => s.setProjects);
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
      <TownCanvas />
      <aside className="panel">
        <header>
          <h1>{town ? town.name : "AI Town"}</h1>
          {/* The lamp says the same thing in words as in colour, so the
              connection state is not carried by hue alone. */}
          <span className={connected ? "dot ok" : "dot down"} />
          <span className="lamp-label">{connected ? "live" : "down"}</span>
        </header>

        <ProjectSwitcher />

        {error && <p className="error">{error}</p>}

        {town && (
          <p className="meta">
            {town.buildings.length} buildings · {town.districts.length} districts
          </p>
        )}

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
            <button className="bevel" onClick={() => select(null)}>
              Close
            </button>
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

        {live.workers.length > 0 && (
          <section className="crew">
            <h2>Crew</h2>
            <ul>
              {live.workers.map((w) => (
                <li key={w.id} className={w.action === "celebrating" ? "done" : ""}>
                  <span className={`tier ${w.tier}`}>{w.tier}</span>
                  <span className="agent">{w.agent}</span>
                  {/* The world's word is the map's job — it captions the figure
                      itself. Here the panel has room to be exact, so it says
                      what the agent actually did rather than which animation is
                      playing: "editing an existing file", not "hammering". */}
                  <span className="action">{actionInfo(w.action).plain}</span>
                  <span className="at">{targetOf(w.place, SITE_ID_BUILDING_PREFIX)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="feed">
          <h2>Activity</h2>
          {events.length === 0 ? (
            <p className="muted">
              No events yet. Install the AI Town extension, then start your
              agent with <code>AI_TOWN_URL</code> set — <code>townd</code>
              prints the exact commands on startup.
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
