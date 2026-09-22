package registry

import (
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/dimasajiwardhana/agent-town/internal/analyzer"
)

// Registry is the set of projects one daemon serves (ADR-0014).
//
// It is the answer to "which towns can I look at right now" — a question about
// the daemon, not about any single town. Projects are keyed by their absolute
// path so that opening one twice returns the same town rather than a second
// copy of it.
type Registry struct {
	mu       sync.RWMutex
	projects map[string]*Project

	// maxFiles bounds every analysis this registry starts. Held here rather
	// than passed per call so one daemon cannot open some projects bounded and
	// others not, which would make the truncation rule unpredictable.
	maxFiles int
}

// New returns an empty registry using the analyzer's default file budget.
//
// Kept for tests and any caller without an opinion on the budget.
func New() *Registry {
	return NewBounded(analyzer.DefaultMaxFiles)
}

// NewBounded returns an empty registry with an explicit file budget. A budget
// of zero or less means unbounded.
func NewBounded(maxFiles int) *Registry {
	return &Registry{projects: map[string]*Project{}, maxFiles: maxFiles}
}

// Add registers a directory and analyzes it immediately.
//
// This is what `townd add` uses, so a path that cannot be a town is refused at
// the command line rather than discovered as an empty map in the browser.
// Re-adding an already-registered path returns the existing project rather
// than analyzing it twice.
//
// A daemon uses Register instead: starting up should not walk every project
// before it can answer.
func (r *Registry) Add(dir string) (*Project, error) {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}

	r.mu.Lock()
	if p, ok := r.projects[abs]; ok {
		r.mu.Unlock()
		return p, nil
	}
	r.mu.Unlock()

	// Analyzed before registering, and outside the lock: a path that turns out
	// not to be a directory must not enter the registry at all, and analysis
	// walks a tree, so holding the lock would block every other project.
	p := &Project{path: abs}
	p.Analyze(r.maxFiles)
	if err := p.AnalysisError(); err != nil {
		return nil, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if existing, ok := r.projects[abs]; ok {
		// Another caller registered the same path while this one was
		// analyzing. Its project wins, so a caller already holding that
		// pointer is not orphaned with a town nothing else can see.
		return existing, nil
	}
	r.projects[abs] = p
	return p, nil
}

// Register records a directory as a project without analyzing it.
//
// Registration and analysis are separate so that a daemon serving many
// projects starts immediately, and so that a frame arriving before its project
// has been opened is accepted and buffered rather than rejected. The map is
// built on first view, when the developer has actually asked for it.
func (r *Registry) Register(dir string) (*Project, error) {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if p, ok := r.projects[abs]; ok {
		return p, nil
	}
	p := &Project{path: abs}
	r.projects[abs] = p
	return p, nil
}

// Get returns the project for a directory, or nil.
func (r *Registry) Get(dir string) *Project {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.projects[abs]
}

// Remove unregisters a project and reports whether it was there.
func (r *Registry) Remove(dir string) bool {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.projects[abs]; !ok {
		return false
	}
	delete(r.projects, abs)
	return true
}

// Len is how many projects the registry holds.
func (r *Registry) Len() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.projects)
}

// Paths returns every registered project path, sorted.
func (r *Registry) Paths() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]string, 0, len(r.projects))
	for p := range r.projects {
		out = append(out, p)
	}
	sort.Strings(out)
	return out
}

// Projects returns every registered project, ordered by path so the UI's list
// is stable rather than varying with map iteration order.
func (r *Registry) Projects() []*Project {
	paths := r.Paths()
	out := make([]*Project, 0, len(paths))
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, p := range paths {
		if proj, ok := r.projects[p]; ok {
			out = append(out, proj)
		}
	}
	return out
}

// Owner returns the project that owns a directory, or nil when none does.
//
// Registered roots can nest — a monorepo and one of its packages are both
// legitimate projects — so the deepest match wins. Matching is on path
// segments rather than a string prefix, because a prefix test would accept
// /repo-other as a child of /repo and route one project's events into
// another's town.
func (r *Registry) Owner(dir string) *Project {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	var best *Project
	bestLen := -1
	for root, p := range r.projects {
		if !owns(root, abs) {
			continue
		}
		if len(root) > bestLen {
			best, bestLen = p, len(root)
		}
	}
	return best
}

// owns reports whether root contains dir, on a path-segment boundary.
func owns(root, dir string) bool {
	if dir == root {
		return true
	}
	// The separator matters: without it a sibling sharing a prefix —
	// /repo-other for /repo — would be treated as a child.
	return strings.HasPrefix(dir, root+string(filepath.Separator))
}
