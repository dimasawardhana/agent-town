# ADR-0014: The daemon serves a registry of projects, not one

## Context

The daemon originally took a single `--dir` and welded it into startup: the
town was analyzed once, the receiver watched one path, and the state file was
one closure-captured string. Changing which project you were looking at meant
restarting the process with a different flag and opening a new browser URL.

The request was to make switching projects as cheap as changing a dropdown
value. That raised a question the single-project design never had to answer:
who decides which directories the daemon may read?

## Decision

The daemon serves a **Town Registry** — a set of projects, each with one town.
One process holds all of them on one fixed port. The UI switches which town it
views; the daemon never stops observing any of them.

Projects are **registered explicitly** and persisted at
`$XDG_CONFIG_HOME/ai-town/config.json` (falling back to
`~/.config/ai-town/config.json`). `townd add <path>` analyzes eagerly, prints
what it found, and refuses a path that is missing, not a directory, or already
registered. `townd rm <path>` removes one. Repeated `--dir` flags add
projects for one run without persisting them, so scripts and one-off debugging
keep working.

## Why registration, not runtime path selection

Analyzing a path handed over by the UI is the more convenient product, and it
was on the table. It was rejected because **the HTTP surface has no origin
check**, which makes a directory picker into an exfiltration oracle.

Verified: a request with `Host: evil.example` is served `200`, and a `POST
/events` carrying a foreign `Origin` is accepted `204`. A page the developer
visits can therefore reach the daemon by DNS rebinding. Today the damage is
bounded by `--dir`: the attacker can enumerate the one directory named on the
command line. If the UI could name directories, the attacker could POST a path
and then read `/api/town` to enumerate it.

The leak is bounded — no endpoint returns file *contents* (`ServeFile` is
scoped to the embedded UI, and the analyzer's only `ReadFile` is
`.gitignore`), so this is a path-and-structure oracle rather than a read
primitive. But combined with a fixed port it is trivially reachable, and
unbounded by project once the UI can name paths.

Registration keeps the set of readable directories a decision the developer
makes in a terminal, where a web page cannot reach it. The convenience cost is
one command, and `townd add` prints the result so the path is proven working
before it enters the registry.

This is a reversible decision: if the Host and Origin checks are added, a
runtime picker can sit beside registration without changing the registry.

## Why one process, not one per project

Port collisions become routine once the port is fixed. One process owning all
towns means a collision only happens if a second daemon is started, and the
developer's browser tab survives switching projects. A daemon per project
would reintroduce exactly the port coordination ADR-0013 removed.

## Consequences

- **A frame is routed by longest matching root.** Registered roots can nest
  (`/code/foo` and `/code/foo/pkg`), so the gate matches on path segments and
  the deepest root wins — the same longest-prefix rule the Resolver already
  uses for buildings. A naive `HasPrefix` would accept `/code/foo-other` as a
  child of `/code/foo`.
- **Registered is not the same as analyzed.** A project accepts frames from
  the moment it is registered, so no event is 403'd while analysis runs. The
  states are `Registered`, `Analyzing`, `Ready`, `Partial`, `Unreadable`.
- **ADR-0013 is amended, not superseded.** One process serving one loopback
  port still holds; it now serves N towns rather than one.
