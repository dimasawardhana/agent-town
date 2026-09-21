// The UI shell. React renders panels; Phaser renders the town (ADR-0002).
//
// This is the DOM overlay: it sits on top of the canvas and reads the same
// store the scene writes to.

import { useEffect, useRef } from "react";
import { SITE_ID_BUILDING_PREFIX, useTown } from "./store";
import { fetchAllTowns, fetchProjects, fetchTown, subscribe } from "./api";
import { ProjectSwitcher } from "./ProjectSwitcher";
import { TownCanvas } from "./TownCanvas";

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
    );
  }, [current, setLive, pushEvent, setConnected]);

  return (
    <div className="app">
      <TownCanvas />
      <aside className="panel">
        <header>
          <h1>{town ? town.name : "AI Town"}</h1>
          <span className={connected ? "dot ok" : "dot down"} />
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
            </dl>
            <button onClick={() => select(null)}>Close</button>
          </section>
        )}

        {live.workers.length > 0 && (
          <section className="crew">
            <h2>Crew</h2>
            <ul>
              {live.workers.map((w) => (
                <li key={w.id} className={w.action === "celebrating" ? "done" : ""}>
                  <span className={`tier ${w.tier}`}>{w.tier}</span>
                  <span className="agent">{w.agent}</span>
                  <span className="action">{w.action}</span>
                  <span className="at">{w.place.replace(SITE_ID_BUILDING_PREFIX, "")}</span>
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
