// Package town holds the live state of a town: where its workers are, what
// they are doing, and what state the buildings they touch are in.
//
// The analyzer answers "what is the town?" — a static function of a directory
// tree. This package answers "what is happening in it?", which changes with
// every agent event.
package town

import (
	"strings"

	"github.com/dimasajiwardhana/agent-town/internal/analyzer"
)

// Action is what a worker is visibly doing.
//
// These are the animations the renderer has to draw, and nothing more: a new
// Action means new art, so they are added deliberately rather than as a
// description of every tool an agent might call.
type Action string

const (
	ActionInspect   Action = "inspecting"  // reading, searching, listing
	ActionHammer    Action = "hammering"   // editing an existing thing
	ActionBuild     Action = "building"    // creating something new
	ActionDemolish  Action = "demolishing" // deleting
	ActionTest      Action = "testing"     // running tests
	ActionCommand   Action = "commanding"  // other shell work: git, installs, builds
	ActionPlan      Action = "planning"    // meta work: dispatch, notes, evaluation
	ActionCelebrate Action = "celebrating" // a session finished cleanly
)

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
func Classify(tool string, args map[string]any, r *analyzer.Resolver) Classification {
	switch {
	case metaTools[tool]:
		return Classification{Action: ActionPlan, Place: analyzer.PlaceDepot, Reason: "meta-tool"}

	case shellTools[tool]:
		// A shell command is site-wide work. Tests get their own staging
		// because the town should look different when tests run than when a
		// dependency installs.
		if isTestCommand(args) {
			return Classification{Action: ActionTest, Place: analyzer.PlaceYard, Reason: "test-command"}
		}
		return Classification{Action: ActionCommand, Place: analyzer.PlaceYard, Reason: "shell-tool"}

	case inspectTools[tool]:
		return viaPath(ActionInspect, tool, args, r)
	case writeTools[tool]:
		return viaPath(ActionBuild, tool, args, r)
	case editTools[tool]:
		return viaPath(ActionHammer, tool, args, r)
	case deleteTools[tool]:
		return viaPath(ActionDemolish, tool, args, r)
	}

	// An unknown tool is still work. If it names a file, place it there;
	// otherwise it belongs to the site.
	c := viaPath(ActionCommand, tool, args, r)
	if c.Place == analyzer.PlaceBuilding || c.Place == analyzer.PlaceWorkshop {
		c.Reason = "unknown-tool-with-path"
		return c
	}
	c.Reason = "unknown-tool"
	return c
}

// viaPath resolves a file-bearing tool onto its building.
//
// When the tool names no path at all — a bash call, a search with no target —
// the resolver is not consulted, because there is nothing to resolve and the
// work is site-wide by nature.
func viaPath(action Action, tool string, args map[string]any, r *analyzer.Resolver) Classification {
	path := pathOf(args)
	if path == "" {
		return Classification{Action: action, Place: analyzer.PlaceYard, Reason: "no-path"}
	}
	kind, place, reason := r.Resolve(path)
	return Classification{
		Action: action,
		Place:  kind,
		Path:   place,
		Reason: string(reason),
	}
}

// pathOf pulls a file path out of a tool's arguments.
//
// The key is tool-dependent: opencode and omp use filePath or path, hermes
// uses path, and omp's edit carries it as a § prefix on a hashline string.
// The resolver handles the § case; this only has to find the value.
func pathOf(args map[string]any) string {
	for _, key := range []string{"filePath", "file_path", "path", "filename", "file", "input"} {
		v, ok := args[key]
		if !ok {
			continue
		}
		s, ok := v.(string)
		if !ok || s == "" {
			continue
		}
		return s
	}
	return ""
}

// isTestCommand reports whether a shell invocation is running the tests.
func isTestCommand(args map[string]any) bool {
	cmd, _ := args["command"].(string)
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
