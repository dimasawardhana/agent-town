// The controls that float over the town: which agent to watch, and how to look
// at it.
//
// Both were sections in the side panel, and both are read while looking at the
// map rather than at the panel. Nine stacked sections in a 316px column put the
// controls a reader reaches for most furthest from the town and furthest below
// the fold: the crew list was clipped by the panel rather than scrolled to, and
// the detail slider and the turn buttons sat four sections down. The panel keeps
// what a panel is for — what this town is, and what has happened in it. These two
// move next to the thing they change.
//
// **The overlay must not take clicks.** `.hud` is `pointer-events: none` and
// only the controls inside it are `auto`. The town is panned and zoomed by
// dragging the canvas, and a full-bleed transparent layer that swallowed those
// drags would make the map feel broken in a way that is very hard to describe
// and very easy to blame on the renderer.
//
// One popover at a time. They are alternatives to the same gesture — look at
// something, then look at it differently — and two open at once would overlap on
// a screen this size. Clicking away closes, which is the whole dismissal model:
// there is still no keyboard handler anywhere in this app, and an escape key that
// worked on these two and nothing else would be a worse inconsistency than
// having none.

import { useEffect, useRef, useState } from "react";
import { RENDERERS } from "./solid/model";

import { actionInfo, crewLabel, targetOf } from "./actions";
import { DAYLIGHT, DAY_PHASES } from "./daylight";
import { SITE_ID_BUILDING_PREFIX, useTown } from "./store";

/** Which of the two popovers is open. One at a time, and never both. */
type Open = "agents" | "view" | null;

export function Hud() {
  const [open, setOpen] = useState<Open>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open === null) return;
    // `pointerdown` rather than `click`, so a drag that begins on the town and
    // ends over the control closes the popover instead of pressing the button
    // underneath it.
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  return (
    <div className="hud" ref={root}>
      <AgentPicker open={open === "agents"} onToggle={() => setOpen(open === "agents" ? null : "agents")} />
      <CameraControls open={open === "view"} onToggle={() => setOpen(open === "view" ? null : "view")} />
    </div>
  );
}

function AgentPicker({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const live = useTown((s) => s.live);
  const following = useTown((s) => s.following);
  const follow = useTown((s) => s.follow);
  const unfollow = useTown((s) => s.unfollow);

  // With no crew there is nothing to pick, so the control says nothing rather
  // than offering a button that opens an empty list over the town.
  if (live.workers.length === 0) return null;

  const watched = following ? live.workers.find((w) => w.id === following) : undefined;
  // The button carries the answer even when the popover is shut, because losing
  // track of which machine is being watched is the problem the control exists to
  // solve — a button that only said "agents" would put the answer one click
  // further away than it was before.
  const label = watched
    ? `${crewLabel(watched.agent, watched.session)} · ${actionInfo(watched.action).world}`
    : `${live.workers.length} ${live.workers.length === 1 ? "agent" : "agents"}`;

  return (
    <div className={`hud-group left ${open ? "open" : ""}`}>
      <button
        type="button"
        className={`hud-btn ${watched ? "following" : ""}`}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="k">{watched ? "Watching" : "Agents"}</span>
        <span className="v">{label}</span>
      </button>
      {open && (
        <div className="hud-pop">
          {watched && (
            <p className="following-now">
              <span className="nm">Following</span>
              <span className="who">{crewLabel(watched.agent, watched.session)}</span>
              <button type="button" onClick={unfollow}>
                Stop
              </button>
            </p>
          )}
          <ul className="crew-list">
            {live.workers.map((w) => {
              const on = following === w.id;
              return (
                <li key={w.id} className={w.action === "celebrating" ? "done" : ""}>
                  <button
                    type="button"
                    className={`follow ${on ? "on" : ""}`}
                    aria-pressed={on}
                    onClick={() => (on ? unfollow() : follow(w.id))}
                  >
                    <span className={`tier ${w.tier}`}>{w.tier}</span>
                    <span className="agent">{crewLabel(w.agent, w.session)}</span>
                    <span className="action">{actionInfo(w.action).plain}</span>
                    <span className="at">{targetOf(w.place, SITE_ID_BUILDING_PREFIX)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function CameraControls({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const town = useTown((s) => s.town);
  const layout = useTown((s) => s.layout);
  const depth = useTown((s) => s.depth);
  const setDepth = useTown((s) => s.setDepth);
  const turn = useTown((s) => s.turn);
  const turnBy = useTown((s) => s.turnBy);
  const setTurn = useTown((s) => s.setTurn);
  const view = useTown((s) => s.view);
  const toggleView = useTown((s) => s.toggleView);
  const day = useTown((s) => s.day);
  const setDay = useTown((s) => s.setDay);
  const renderer = useTown((s) => s.renderer);
  const setRenderer = useTown((s) => s.setRenderer);

  if (!town) return null;

  // The deepest building the daemon reported, so the slider's range reflects the
  // town rather than a guessed ceiling. A town whose buildings are all top level
  // has nothing to filter, and the control hides itself.
  const maxDepth = layout ? layout.sites.reduce((m, s) => Math.max(m, s.depth), 1) : 1;

  return (
    <div className={`hud-group right ${open ? "open" : ""}`}>
      <button type="button" className="hud-btn" aria-expanded={open} onClick={onToggle}>
        <span className="k">View</span>
        <span className="v">
          {renderer === "solid" ? "Solid" : view === "plan" ? "From above" : "Isometric"}
        </span>
      </button>
      {open && (
        <div className="hud-pop">
          {maxDepth > 1 && (
            <section className="detail-control">
              <h2>Detail</h2>
              <label htmlFor="hud-depth">
                {depth === Number.POSITIVE_INFINITY
                  ? "Everything"
                  : depth === 1
                    ? "Top level only"
                    : `${depth} levels deep`}
              </label>
              <input
                id="hud-depth"
                type="range"
                min={1}
                max={maxDepth}
                step={1}
                value={depth === Number.POSITIVE_INFINITY ? maxDepth : depth}
                onChange={(e) => setDepth(Number(e.target.value))}
              />
            </section>
          )}
          <section className="view-control">
            <div className="turn-row" role="group" aria-label="Renderer">
              {RENDERERS.map((r) => (
                <button
                  key={r}
                  className="bevel"
                  aria-pressed={renderer === r}
                  onClick={() => setRenderer(r)}
                  title={
                    r === "solid"
                      ? "The town as modelled geometry, with real light and depth"
                      : "The pixel town, which is the default"
                  }
                >
                  {r === "solid" ? "Solid" : "Flat"}
                </button>
              ))}
            </div>
            {/* **The plan drawing is offered only in the flat renderer.** The
                solid town has one drawing, and a control that appears to work and
                does nothing is worse than one that is not there — the same reason
                the detail slider hides itself on a town with nothing to filter. */}
            {renderer === "flat" && (
              <div className="turn-row">
                <button
                  className="bevel"
                  onClick={toggleView}
                  aria-pressed={view === "plan"}
                  title={view === "plan" ? "Back to the isometric town" : "Look at the town from directly above"}
                >
                  {view === "plan" ? "Isometric" : "From above"}
                </button>
              </div>
            )}
            <div className="turn-row">
              <button className="bevel" onClick={() => turnBy(-1)} title="Turn left">
                Turn left
              </button>
              <button className="bevel" onClick={() => turnBy(1)} title="Turn right">
                Turn right
              </button>
            </div>
            <p className="muted">
              {turn === 0 ? "Upright" : `Turned ${turn * 90}°`}
              {turn !== 0 && (
                <>
                  {" · "}
                  <button className="link" onClick={() => setTurn(0)}>
                    reset
                  </button>
                </>
              )}
            </p>
            <div className="turn-row" role="group" aria-label="Time of day">
              {DAY_PHASES.map((p) => (
                <button
                  key={p}
                  className="bevel"
                  aria-pressed={day === p}
                  onClick={() => setDay(p)}
                  title={`${DAYLIGHT[p].label} — ${DAYLIGHT[p].lit ? "windows lit" : "no lights"}`}
                >
                  {DAYLIGHT[p].label}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
