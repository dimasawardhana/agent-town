// ProjectSwitcher lists the registry and chooses which town is shown.
//
// ADR-0014: one daemon serves several projects, so the UI needs a way to say
// which one it is looking at. Switching changes only what is drawn — every
// registered project keeps folding events in the daemon, because a town is the
// result of real work and switching away must not pause someone's build.

import { useTown, type ProjectRef } from "./store";

// label says what state a project is in, because an unanalyzed project
// accepting events but showing no town looks broken unless it says why.
function label(p: ProjectRef): string {
  switch (p.state) {
    case "analyzing":
      return " (analyzing)";
    case "partial":
      return " (partial)";
    case "unreadable":
      return " (unreadable)";
    default:
      return p.analyzed ? "" : " (not analyzed)";
  }
}

export function ProjectSwitcher() {
  const projects = useTown((s) => s.projects);
  const current = useTown((s) => s.current);
  const setCurrent = useTown((s) => s.setCurrent);

  // Nothing to switch between. Rendering a control with one option would be
  // noise, so the switcher only appears when there is a choice to make.
  if (projects.length === 0) return null;

  return (
    <section className="switcher">
      <label htmlFor="project">Project</label>
      <select
        id="project"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
      >
        {projects.map((p) => (
          <option key={p.path} value={p.path}>
            {p.name}
            {label(p)}
          </option>
        ))}
      </select>
      {/* The full path is shown rather than only the name, because two
          projects can share a basename and the choice would be ambiguous. */}
      {current && <p className="muted path">{current}</p>}
    </section>
  );
}
