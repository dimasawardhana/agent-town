# Installing AI Town

For the impatient, this is the whole thing:

```bash
go install ./cmd/townd    # daemon
townd install             # agent extension
townd add ~/code/yourproject
townd
omp
```

Everything below is what to do when one of those steps does not work.

## What actually gets installed

Two things, and it is worth knowing they are separate because most confusion
comes from installing one and expecting the other.

| | Where it goes | What it is |
|---|---|---|
| `townd` | `$(go env GOPATH)/bin/townd` | the daemon: serves the UI and receives events |
| the extension | `~/.omp/agent/extensions/ai-town.ts` | runs inside your agent, forwards its activity |

The extension is embedded in the `townd` binary, which is why `townd install`
needs no source checkout and no network. If you move the binary, you can still
install its extension anywhere.

## 1. The daemon

Needs **Go 1.27 or later**. No npm, no database, no service, no third-party
dependencies.

```bash
go install ./cmd/townd
```

This is run from inside the AI Town repository, since `./cmd/townd` is a
relative path. (Once this is published, `go install
github.com/dimasajiwardhana/agent-town/cmd/townd@latest` will work from
anywhere.)

**If `townd: command not found`:**

```bash
echo 'export PATH="$PATH:$(go env GOPATH)/bin"' >> ~/.bashrc
exec $SHELL
```

`go install` always writes to `$(go env GOPATH)/bin` — usually `~/go/bin` —
and some shells do not have it on `PATH`.

## 2. The agent extension

```bash
townd install              # every omp session on this machine
townd install --project .  # only this repository
```

Both locations are auto-discovered. No flag, no config file.

`townd install` **refuses to overwrite** an existing extension, so a local edit
is not silently clobbered:

```
townd: /home/you/.omp/agent/extensions/ai-town.ts already exists; refusing to overwrite it
townd: pass --force to replace it, or edit it in place
```

That is usually what you want after upgrading `townd` — otherwise you would be
running a stale extension with no way to tell. The command prints the exact
`rm` to undo itself.

For **pi**, the same file works, but its project-local extensions do not load
headlessly without `--approve`. See [multi-agent-support.md](multi-agent-support.md).

## 3. Register a project

```bash
townd add ~/code/app
```

Each project is **analyzed as you add it**, so a path that cannot be a town is
refused immediately rather than showing up as an empty map later:

```
$ townd add ~/code/app
added /home/you/code/app — 19 buildings, 3 districts
config: /home/you/.config/ai-town/config.json

$ townd add /tmp/nope
townd: cannot add /tmp/nope: stat /tmp/nope: no such file or directory

$ townd add ~/code/app
townd: already registered: /home/you/code/app
```

Manage the list with:

```bash
townd ls              # what is registered, and how big each town is
townd rm ~/code/app   # unregister one
```

The registry lives at `$XDG_CONFIG_HOME/ai-town/config.json`, falling back to
`~/.config/ai-town/config.json`. It is plain JSON and safe to edit by hand:

```json
{
  "version": 1,
  "projects": ["/home/you/code/app", "/home/you/code/lib"]
}
```

> **Projects are not directories.** The words differ on purpose. A *project* is
> something you deliberately imported; a directory is just a path. `townd` will
> watch a project that is not a git repository, and a directory containing
> nested repositories is still one project. See `CONTEXT.md`.

## 4. Start the daemon

```bash
townd
```

It listens on `127.0.0.1:7777` and prints the address to open. Startup is
immediate: projects are *registered* at startup but not *analyzed* until you
first view one, so a daemon with a dozen projects does not walk a dozen trees
before answering.

```
AI_TOWN_URL=http://127.0.0.1:7777
townd: serving 2 project(s):
townd:   /home/you/code/app
townd:   /home/you/code/lib
townd: open http://127.0.0.1:7777
```

### If the port is taken

A fixed port makes collisions routine, so this is a first-class message rather
than a crash:

```
townd: cannot listen on 127.0.0.1:7777: bind: address already in use
townd: another daemon is probably already running
townd: use --port <n> to listen elsewhere, or stop the other one
```

There is deliberately **no silent fallback** to a nearby port. The extension
posts to a fixed address, so a daemon that quietly moved would receive nothing
and the town would look broken with no error anywhere.

```bash
townd --port 8080
```

## 5. Start your agent

```bash
omp
```

**No environment variable needed.** The extension targets `127.0.0.1:7777` by
default. Only if you started the daemon elsewhere:

```bash
AI_TOWN_URL=http://127.0.0.1:8080 omp
```

Then work normally. A worker appears and walks to whatever your agent touches.

## Options

```bash
townd                     # serve the registered projects
townd --dir <path>        # also serve this one, for this run only, unregistered
townd --port <n>          # listen elsewhere (default 7777)
townd --addr <host:port>  # full address, for a non-default host
townd --max-files <n>     # analysis budget per project (default 2000, 0 = unbounded)
townd --quiet             # do not also print events to stdout

townd add <path>          # register and analyze a project
townd rm <path>           # unregister
townd ls                  # list registered projects
townd install [--project <path>] [--force]
```

`--dir` adds a project **for one run without persisting it**, which is what you
want for a scratch directory or a script.

## Troubleshooting

### The town is empty and no worker appears

Work through these in order:

1. **Is the daemon running?** `curl -s http://127.0.0.1:7777/api/projects`.
2. **Did the extension load?** The daemon logs `townd: extension handshake from
   <dir>` when it does. No handshake means the extension never ran.
3. **Is that directory registered?** A handshake from a path you have not added
   is refused with `403`, and the log says `rejected frame from unwatched
   directory`. `townd add` it.
4. **Is the extension in the right place?** `townd ls`-style check:
   `ls ~/.omp/agent/extensions/ai-town.ts` (or `.omp/extensions/` in the
   project).

The extension loads when the **first session starts**, not when omp launches.
Before you send a prompt, there is nothing to see.

### `townd` refuses to bind

Only loopback addresses are allowed, and it exits rather than warning:

```
townd: refusing to bind "0.0.0.0:7777": only loopback addresses are allowed
```

This is deliberate, not a bug to work around. The daemon serves an
unauthenticated UI and a stream of your file paths.

### A project says `unreadable`

The registered path no longer exists — moved, deleted, or on an unmounted
volume. Its town is preserved and it is still listed so you can see what
happened:

```
$ townd ls
/tmp/absent — unreadable: stat /tmp/absent: no such file or directory
/home/you/code/app — 19 buildings, 3 districts
```

Restore the path, or `townd rm` it.

### A project says `partial`

Analysis stopped at the file budget — a town drawn from part of a repository.
It says so rather than presenting itself as whole:

```bash
$ townd ls --max-files 10
/tmp/huge — 10 buildings, PARTIAL (stopped after 10 files)
```

Seen at startup only for a project analyzed eagerly, which means one passed
with `--dir`:

```
townd:   /home/you/code/huge (10 buildings, PARTIAL — stopped after 10 files)
```

Registered projects are not analyzed at startup, so nothing is known about
their size yet — that is why the list usually shows bare paths.

Raise the budget, or point `townd` at a subdirectory. The budget bounds the
walk by cost; a depth limit was tried and rejected because it truncates by tree
shape — a repository whose source sits a few levels down came out empty while a
pathological tree was still walked in full (ADR-0015).

### The agent's activity is missing from the start of a session

Events arriving before a project has been analyzed are **buffered**, not
dropped, and replayed when you first view it. If more than 200 arrive first,
the oldest are dropped and the town reports the count — a town that silently
omitted history would be lying about what happened.

### Nothing works and the log is silent

Set the variable explicitly, so a wrong guess is visible:

```bash
AI_TOWN_URL=http://127.0.0.1:7777 omp
```

The extension is deliberately **silent when it cannot reach a daemon**, so that
your agent behaves identically whether or not AI Town is installed. That is why
a mismatch produces no diagnostic: the daemon's log is the only place the
failure shows.

## Uninstalling

```bash
rm ~/.omp/agent/extensions/ai-town.ts    # or .omp/extensions/ in a project
townd rm ~/code/app                      # unregister a project
rm -rf ~/.config/ai-town                 # the registry
rm -rf ~/.local/share/ai-town            # towns built so far
rm "$(go env GOPATH)/bin/townd"          # the daemon
```

The two state directories are separate on purpose: the registry is *which
projects* you are watching, and the data directory is *what got built*. Deleting
the second resets every town to an empty map while keeping the list.
