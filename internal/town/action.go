// Package town holds the live state of a town: where its workers are, what
// they are doing, and what state the buildings they touch are in.
//
// The analyzer answers "what is the town?" — a static function of a directory
// tree. This package answers "what is happening in it?", which changes with
// every agent event.
package town

import (
	"sort"
	"strings"

	"github.com/dimasajiwardhana/agent-town/internal/agent"
	"github.com/dimasajiwardhana/agent-town/internal/analyzer"
)

// Action is what a worker is visibly doing.
//
// These are the animations the renderer has to draw, and nothing more: a new
// Action means new art, so they are added deliberately rather than as a
// description of every tool an agent might call.
type Action string

const (
	ActionRead      Action = "reading"     // reading, searching, listing
	ActionHammer    Action = "hammering"   // editing an existing thing
	ActionBuild     Action = "building"    // creating something new
	ActionDemolish  Action = "demolishing" // deleting
	ActionTest      Action = "testing"     // running tests
	ActionCommand   Action = "commanding"  // other shell work: git, installs, builds
	ActionPlan      Action = "planning"    // meta work: dispatch, notes, evaluation
	ActionCelebrate Action = "celebrating" // a session finished cleanly
)

// AllActions is every action a worker can be doing, in a stable order.
//
// It exists so the vocabulary can be asserted rather than assumed. The daemon
// names an action as a string and the renderer switches on those strings to
// pick an animation; the two cannot share a definition across the language
// boundary, so a test compares this list against the UI's Action type. When
// they drifted, every read rendered with the default pulse because the action
// arrived as "inspecting" while the renderer only knew "reading".
func AllActions() []Action {
	return []Action{
		ActionBuild,
		ActionCelebrate,
		ActionCommand,
		ActionDemolish,
		ActionHammer,
		ActionPlan,
		ActionRead,
		ActionTest,
	}
}

// Classification says where an action happens and what it looks like.
type Classification struct {
	Action Action
	Place  analyzer.Place
	// Path is the target's repo-relative path, set only for a building.
	Path string
	// Reason records why the classification landed where it did. It exists so
	// a miss is never silent — the whole point is that every action is placed
	// somewhere, and how it got there stays inspectable.
	Reason string
}

// metaTools are the tools an agent uses to think and organise rather than to
// change code. In a real omp session these are roughly a third of all calls,
// and without the Depot they would render as a worker standing still while
// the agent works hard — the town showing less than what happened.
var metaTools = map[string]bool{
	"hub": true, "todo": true, "task": true, "eval": true, "ask": true,
	"reflect": true, "recall": true, "retain": true, "learn": true,
	"memory_edit": true, "manage_skill": true, "checkpoint": true,
	"rewind": true, "think": true, "plan": true, "skill": true,
}

// inspectTools look at existing code without changing it.
var inspectTools = map[string]bool{
	"read": true, "list": true, "glob": true, "grep": true, "find": true,
	"ls": true, "search": true, "ast_grep": true, "lsp": true,
	"read_file": true, "search_files": true, "codebase_search": true,
	"security_scan": true, "tree": true,
}

// writeTools create something new.
var writeTools = map[string]bool{
	"write": true, "create": true, "ast_edit": true,
	"write_file": true, "notebook_edit": true,
}

// editTools change something that exists.
var editTools = map[string]bool{
	"edit": true, "patch": true, "multiedit": true, "replace": true,
}

// deleteTools remove something.
var deleteTools = map[string]bool{
	"delete": true, "rm": true, "remove": true,
}

// shellTools run commands, which are site-wide work: a test run or a build
// touches the whole town, not one building. Roughly half of a real session.
var shellTools = map[string]bool{
	"bash": true, "shell": true, "terminal": true, "exec": true,
	"run_command": true, "computer": true, "process": true,
}

// testCommands are the shell invocations that verify the code holds together:
// unit tests, end-to-end tests, and type checkers.
//
// Matched on the command string, because a shell tool's arguments are the only
// signal available — bash carries no path. The order matters: "npm test" must
// match before the bare "test" substring does, which it does because the whole
// command is searched for each entry in turn and any hit wins.
var testCommands = []string{
	"go test", "cargo test", "vitest", "jest", "pytest", "playwright",
	"cypress", "rspec", "phpunit", "npm test", "pnpm test", "yarn test",
	"bun test", "tsc --noEmit", "typecheck", "type-check",
}

// Classify maps one normalized event onto where it happens and what it looks
// like. It always returns a place: an action with nowhere to go would render
// as an agent doing nothing.
//
// It reads the event's already-normalized Type and Target.Path rather than
// re-deriving them from the raw tool name and arguments. The adapter owns
// agent-agnosticism (CONTEXT.md): re-deciding here would mean every new
// agent's tool names had to be taught to the domain layer too, and the two
// vocabularies could disagree.
func Classify(ev agent.UnifiedAgentEvent, r *analyzer.Resolver) Classification {
	tool := ev.Tool
	switch {
	case ev.Type == "COMMAND_COMPLETED":
		// A shell command is site-wide work. A *test* is the exception, and the
		// exception is load-bearing: a test that names a directory is evidence
		// about that building, and the ladder's finishing ranks — glazing, the
		// door, the completed building — are gated on passing tests. Sending
		// every test to the Yard made those three ranks unreachable, so a
		// building could only ever be built, never finished.
		if isTestCommand(ev) {
			cmd := strings.ToLower(ev.Target.Command)
			for _, dir := range testTargets(cmd) {
				// A test names a directory, not a file, so this is the
				// directory lookup rather than the file one.
				if kind, place, reason := r.ResolveDir(dir); kind == analyzer.PlaceBuilding {
					return Classification{Action: ActionTest, Place: kind, Path: place,
						Reason: "test-of-building:" + string(reason)}
				}
			}
			// A whole-repo test run — `go test ./...`, `npm test` — names no one
			// building, so it stays site-wide work in the Yard. Claiming it for
			// a single building would be a guess, and the town does not guess
			// about where work happened.
			return Classification{Action: ActionTest, Place: analyzer.PlaceYard, Reason: "test-command"}
		}
		return Classification{Action: ActionCommand, Place: analyzer.PlaceYard, Reason: "shell-tool"}

	case metaTools[tool]:
		return Classification{Action: ActionPlan, Place: analyzer.PlaceDepot, Reason: "meta-tool"}

	case shellTools[tool]:
		return Classification{Action: ActionCommand, Place: analyzer.PlaceYard, Reason: "shell-tool"}

	// The file classes are what the event Type encodes, so they normally need
	// no tool-name table of their own.
	case ev.Type == "FILE_READ":
		return viaPath(ActionRead, ev, r)
	case ev.Type == "FILE_CREATED":
		return viaPath(ActionBuild, ev, r)
	case ev.Type == "FILE_EDITED":
		return viaPath(ActionHammer, ev, r)
	}

	// Fall back to the tool name for the file classes. An event whose Type is
	// missing or generic — an adapter that normalized imperfectly, or a tool
	// no adapter has classified yet — still knows what its tool was doing,
	// and losing the distinction would render an edit as mere inspection.
	//
	// Only the `inspectTools` and `writeTools`/`editTools` rows here are
	// reachable from a real frame: the adapter derives an event's Type from the
	// tool name (`agent.ToolToEventType`) and never reads a supplied one, so the
	// `ev.Type` cases above match first. A `delete` therefore arrives as
	// FILE_EDITED and becomes ActionHammer before this switch is consulted. The
	// Delete row is kept because it is the correct mapping for a
	// tool-name-keyed event, and reachable from a test that builds one directly
	// — but its presence is not evidence that demolishing works end to end.
	switch {
	case deleteTools[tool]:
		return viaPath(ActionDemolish, ev, r)
	case writeTools[tool]:
		return viaPath(ActionBuild, ev, r)
	case editTools[tool]:
		return viaPath(ActionHammer, ev, r)
	case inspectTools[tool]:
		return viaPath(ActionRead, ev, r)
	}

	// An unknown tool is still work. If it names a file, place it there;
	// otherwise it belongs to the site.
	c := viaPath(ActionCommand, ev, r)
	if c.Place == analyzer.PlaceBuilding || c.Place == analyzer.PlaceWorkshop {
		c.Reason = "unknown-tool-with-path"
		return c
	}
	c.Reason = "unknown-tool"
	return c
}

// viaPath resolves an event's target onto its building.
//
// The path is already extracted and normalized by the adapter, so this only
// has to resolve it. An event naming no file is site-wide work by nature —
// a bash call or a search with no target — and belongs to the Yard.
func viaPath(action Action, ev agent.UnifiedAgentEvent, r *analyzer.Resolver) Classification {
	if ev.Target.Path == "" {
		return Classification{Action: action, Place: analyzer.PlaceYard, Reason: "no-path"}
	}
	kind, place, reason := r.Resolve(ev.Target.Path)
	return Classification{
		Action: action,
		Place:  kind,
		Path:   place,
		Reason: string(reason),
	}
}

// isTestCommand reports whether a shell invocation is running the tests.
//
// The command string is the only signal available: a shell tool carries no
// path, and the adapter normalizes the type to COMMAND_COMPLETED for every
// invocation alike.
func isTestCommand(ev agent.UnifiedAgentEvent) bool {
	cmd := ev.Target.Command
	if cmd == "" {
		return false
	}
	// Both sides are folded: the command is what the agent typed, and the
	// needles are written readably. Comparing a folded command against
	// unfolded needles silently missed "tsc --noEmit", which is exactly the
	// kind of near-miss that makes a whole category of work invisible.
	lower := strings.ToLower(cmd)
	for _, t := range testCommands {
		if strings.Contains(lower, strings.ToLower(t)) {
			return true
		}
	}
	return false
}

// testTargets pulls the directory paths a test command names, outermost first.
//
// It exists because a test run is the only evidence the town has that a
// building's work holds together, and a shell tool carries no path field — the
// command string is the whole signal. So this reads the arguments that look
// like repo paths and hands them to the resolver, which owns the decision about
// what a path means.
//
// Deliberately conservative. It returns only arguments that start with a path
// marker (`./`, `../`, or a bare word containing `/`), never bare words: the
// first token is the program and the rest are flags, and treating `-run` or
// `-race` as a directory would file a test run against whatever happened to
// match. A pattern (`./...`, a `*`) is dropped for the same reason the resolver
// drops one — it names a set, not a place.
//
// Outermost first, so `go test ./internal/town/...` resolves the deepest
// matching building rather than stopping at a shorter prefix that also matches.
func testTargets(cmd string) []string {
	fields := strings.Fields(cmd)
	if len(fields) < 2 {
		return nil
	}

	var out []string
	seen := map[string]bool{}
	for _, f := range fields[1:] {
		// Trim the quoting a shell may carry, then normalise the forms that
		// mean the same directory.
		arg := strings.Trim(f, `"'`)
		if strings.HasPrefix(arg, "-") || arg == "" {
			continue
		}
		// A pattern names a set of directories, and an ellipsis is the Go
		// idiom for "this and everything under it" — the resolver refuses
		// wildcards, so stripping the ellipsis is what lets a scoped run
		// resolve to the building it names.
		arg = strings.TrimSuffix(arg, "/...")
		arg = strings.TrimSuffix(arg, "...")
		if arg == "" || strings.ContainsAny(arg, "*?[]") {
			continue
		}
		if !strings.Contains(arg, "/") {
			continue
		}
		arg = strings.TrimPrefix(arg, "./")
		arg = strings.TrimSuffix(arg, "/")
		if arg == "" || arg == ".." || arg == "." || seen[arg] {
			continue
		}
		seen[arg] = true
		out = append(out, arg)
	}

	// Longest first: `internal/town` is a better answer than `internal` for a
	// command naming both, because the deeper path is the more specific claim.
	sort.Slice(out, func(i, j int) bool {
		if len(out[i]) != len(out[j]) {
			return len(out[i]) > len(out[j])
		}
		return out[i] < out[j]
	})
	return out
}
