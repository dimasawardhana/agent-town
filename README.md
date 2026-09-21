# AI Town

Watch your AI coding agents build your project, as a town.

Your repository becomes a town: districts are its domains, buildings are its
directories sized by how much code they hold. When an agent works, a worker
walks to the building it is touching and visibly works there. Buildings change
state as they are constructed and tested. The town persists between sessions —
it is the result of the work.

```
your repo                          the town
────────────────────────────────────────────────────
internal/auth/     →    Auth Building, in the Internal district
internal/payment/  →    Payment Building, same district
tests/             →    a test district, marked as such
running go test    →    an inspector sweeping the Yard
planning           →    a chief worker at the Depot
editing a file     →    a worker hammering that building
a failed tool      →    a construction problem on that building
```

## Try it

Full guide, including troubleshooting: **[docs/install.md](docs/install.md)**.

**1. Install the daemon.** Needs Go 1.27 or later. Nothing else — no npm, no
database, no service. The UI and the agent extension are both embedded in the
binary.

```bash
go install ./cmd/townd
```

That puts `townd` in `$(go env GOPATH)/bin`. If `townd: command not found`
afterwards, that directory is not on your `PATH` — add it:

```bash
echo 'export PATH="$PATH:$(go env GOPATH)/bin"' >> ~/.bashrc && exec $SHELL
```

**2. Install the agent extension.** One command. It covers every omp session on
the machine.

```bash
townd install              # global
townd install --project .  # or just this repository
```

**3. Register the projects you want to watch.**

```bash
townd add ~/code/app
townd add ~/code/lib
```

Each is analyzed as you add it, so a path that cannot be a town is refused
there and then rather than showing up as an empty map later. `townd ls` lists
what is registered, `townd rm <path>` removes one.

**4. Start the daemon.**

```bash
townd
```

It listens on `127.0.0.1:7777` and prints the address to open. To serve a
project for one run without registering it, add `--dir ~/code/scratch`.

**5. Start your agent. No environment variable needed.**

```bash
omp
```

The extension finds the daemon on the default port. Only if you started the
daemon elsewhere with `--port` do you need to say so:
`AI_TOWN_URL=http://127.0.0.1:<port> omp`.

Then work as you normally would. The town moves, and switching which project
you are looking at is a dropdown.

## What you will see

- **A worker per session.** Chief workers are the agent driving a session;
  sub workers are anything it spawns. Two sessions on one repo are two crews,
  distinguished by colour.
- **A worker walks before it works.** Reading a file sends it to that building
  to inspect; editing makes it hammer; running the tests sweeps the Yard.
  Each action has its own rhythm, so the town reads at a glance.
- **The Yard, Workshop and Depot.** Most of a real session is not file work:
  shell commands are roughly half of all tool calls and planning another
  third. Those are staged in the Yard and the Depot, so an agent that is
  thinking or running tests never looks idle.
- **Construction problems.** A failed tool damages the building rather than
  advancing it, and the damage stays until the work succeeds.

## Options

```bash
./townd --dir <path>       # the project to watch (default: current directory)
./townd --project <path>   # the project to draw, if different from --dir
./townd --addr <host:port> # default 127.0.0.1:0. Loopback only — see below
./townd --quiet            # do not also print events to stdout
```

The daemon binds **loopback only** and refuses anything else. It serves an
unauthenticated UI and a stream of your file paths, so it must not be
reachable from the network.

## Status

Working: the daemon, the project analyzer, the town renderer, worker movement,
and the omp extension. 92 tests, no third-party dependencies.

Known gaps, stated rather than hidden:

- **No event store.** The daemon keeps the last 200 events in memory and
  writes none of them. Replay and analytics need it; ADR-0003 records this.
- **omp and pi only.** Both verified. opencode was tested at 1.4.3 while
  current is 1.18.31, so treat it as unverified above that.
- **A session that loses the daemon for its whole run loses its events.** The
  queue lives in the agent process. A daemon that returns mid-run is fine.
- **Location comes from the path, not the output.** A failing test marks the
  Yard, not the building that actually failed. Deriving that from command
  output is the natural next slice.

## Guides

| | |
|---|---|
| **[docs/install.md](docs/install.md)** | installing, the CLI, troubleshooting, uninstalling |
| [docs/omp-extension.md](docs/omp-extension.md) | how the extension works inside the agent |
| [docs/multi-agent-support.md](docs/multi-agent-support.md) | omp, pi, opencode, hermes — what each exposes |
| [CONTEXT.md](CONTEXT.md) | the vocabulary, and what not to call things |
| [docs/adr/](docs/adr/) | decisions, with the alternatives that lost |

## Where things are

| | |
|---|---|
| `internal/agent` | frames in, normalized events out; the extension lives here too |
| `internal/analyzer` | a repository becomes a town; paths resolve to places |
| `internal/town` | live state: where workers are, what buildings are like |
| `internal/web` | the UI, embedded |
| `ui/` | React, Phaser, Zustand — the source the embedded UI is built from |
| `docs/adr/` | the decisions, and why the alternatives lost |
| `CONTEXT.md` | the vocabulary, and what not to call things |
| `.scratch/` | the tickets this was built from |
