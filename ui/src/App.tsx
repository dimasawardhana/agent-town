// The UI shell. React renders panels; Phaser renders the town (ADR-0002).
//
// This is the DOM overlay: it sits on top of the canvas and reads the same
// store the scene writes to.

import { useEffect, useRef } from "react";
import { SITE_ID_BUILDING_PREFIX, useTown } from "./store";
import { fetchTown, subscribe } from "./api";
import { TownCanvas } from "./TownCanvas";

export function App() {
  const town = useTown((s) => s.town);
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

  const load = useRef(async () => {
    try {
      const { town, layout, live } = await fetchTown();
      setTown(town, layout, live);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  });

  useEffect(() => {
    void load.current();
    return subscribe(setLive, pushEvent, setConnected, () => void load.current());
  }, [setLive, pushEvent, setConnected]);

  return (
    <div className="app">
      <TownCanvas />
      <aside className="panel">
        <header>
          <h1>{town ? town.name : "AI Town"}</h1>
          <span className={connected ? "dot ok" : "dot down"} />
        </header>

        {error && <p className="error">{error}</p>}

        {town && (
          <p className="meta">
            {town.buildings.length} buildings · {town.districts.length} districts
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
