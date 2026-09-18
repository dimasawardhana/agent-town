// The UI shell. React renders panels; Phaser renders the town (ADR-0002).
//
// This is the DOM overlay: it sits on top of the canvas and reads the same
// store the scene writes to.

import { useEffect, useRef } from "react";
import { useTown } from "./store";
import { fetchTown, subscribe } from "./api";
import { TownCanvas } from "./TownCanvas";

export function App() {
  const town = useTown((s) => s.town);
  const selected = useTown((s) => s.selected);
  const events = useTown((s) => s.events);
  const connected = useTown((s) => s.connected);
  const error = useTown((s) => s.error);
  const setTown = useTown((s) => s.setTown);
  const setConnected = useTown((s) => s.setConnected);
  const setError = useTown((s) => s.setError);
  const pushEvent = useTown((s) => s.pushEvent);
  const select = useTown((s) => s.select);

  const load = useRef(async () => {
    try {
      const { town, layout } = await fetchTown();
      setTown(town, layout);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  });

  useEffect(() => {
    void load.current();
    return subscribe(pushEvent, setConnected, () => void load.current());
  }, [pushEvent, setConnected]);

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

        <section className="feed">
          <h2>Activity</h2>
          {events.length === 0 ? (
            <p className="muted">
              No events yet. Start an agent with <code>AI_TOWN_URL</code> set.
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
