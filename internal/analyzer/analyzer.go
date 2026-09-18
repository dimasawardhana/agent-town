// Package analyzer turns a git repository into a town.
//
// A town is the static structure of a project: its districts, its buildings,
// and how big each building is. It is a pure function of the directory tree —
// the same repo always yields the same town (ADR-0012), so a developer can
// build spatial memory of their own codebase.
//
// The hard part is not walking the tree. It is deciding what counts as source,
// and what is vendored noise. `Image-nation` holds ~16,000 files under
// `venv/` and `onyx_data/` against ~86 real source files; a naive walk turns
// that into a town of thousands of buildings and ruins the metaphor.
package analyzer

import (
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Place is where a worker stands. Everything an event can resolve to is one
// of these, so the renderer always has somewhere to put a worker.
type Place string

const (
	PlaceBuilding Place = "building"
	PlaceWorkshop Place = "workshop" // files at the repo root
	PlaceYard     Place = "yard"     // site-wide work: tests, builds, git
	PlaceDepot    Place = "depot"    // meta work: planning, dispatch, evaluation
)

// sourceExtensions are the file types that make a directory a building.
//
// Deliberately source only. Assets, lockfiles and generated artefacts are not
// construction: a directory of PNGs is not a service, and counting them would
// let a media-heavy folder outrank the code it supports.
var sourceExtensions = map[string]bool{
	".go": true, ".py": true, ".rs": true, ".java": true, ".rb": true,
	".ts": true, ".tsx": true, ".js": true, ".jsx": true, ".mjs": true, ".cjs": true,
	".vue": true, ".svelte": true, ".astro": true,
	".c": true, ".cc": true, ".cpp": true, ".h": true, ".hpp": true,
	".cs": true, ".kt": true, ".swift": true, ".php": true,
	".css": true, ".scss": true, ".sass": true, ".less": true,
	".html": true, ".sql": true, ".sh": true, ".lua": true, ".ex": true, ".exs": true,
}

// ignoredDirs are excluded wholesale, by name, at any depth.
//
// This list is the single most important thing in this package. Each entry is
// a directory that holds either machine-generated or third-party files, none
// of which the developer wrote.
//
// Dot-prefixed directories are excluded separately by the walk itself, so
// they are deliberately absent here — listing `.next` or `.venv` would be
// dead weight, since the dot-prefix check skips them first.
var ignoredDirs = map[string]bool{
	// dependencies
	"node_modules": true, "bower_components": true, "vendor": true,
	"dist-packages": true, "Pods": true,

	// build output
	"dist": true, "build": true, "out": true, "target": true, "bin": true,
	"obj": true, "_build": true,

	// language caches
	"__pycache__": true,

	// virtualenvs — the Image-nation case
	"venv": true, "env": true, "virtualenv": true,

	// test and coverage artefacts
	"coverage": true, "htmlcov": true,

	// caches and local data
	"tmp": true, "temp": true, "logs": true,

	// bundled third-party data and deployment scaffolding. `onyx_data` ships
	// with the Onyx RAG product rather than being written by the developer;
	// counting it added a phantom building to Image-nation's town.
	"onyx_data": true,
}

// ignoredSuffixes are excluded by filename ending, anywhere in the tree.
var ignoredSuffixes = []string{
	".pyc", ".pyo", ".pyd", ".class", ".o", ".a", ".so", ".dylib", ".dll",
	".exe", ".min.js", ".min.css", ".map", ".lock", ".log", ".tmp",
	".egg-info", ".tsbuildinfo", ".orig", ".rej",
}

// Town is a project's static structure.
type Town struct {
	Root      string     `json:"root"`
	Name      string     `json:"name"`
	Districts []District `json:"districts"`
	Buildings []Building `json:"buildings"`
}

// District kinds. A test district is not less important, but it is a
// different kind of place — an inspector's territory rather than a
// construction site — and the town renders it differently.
const (
	DistrictSource Place = "source"
	DistrictTest   Place = "test"
)

// District is a top-level grouping of buildings. Districts map to the first
// path segment of a building's location.
type District struct {
	Name      string `json:"name"`
	Kind      Place  `json:"kind"`
	Buildings int    `json:"buildings"`
	Files     int    `json:"files"`
}

// testDirNames are directory names that mark a district as testing territory.
//
// Measured on a real repo, a test district can hold many more buildings than
// the source district while holding far fewer files (`team-builder`: 16
// buildings/22 files of e2e against 9 buildings/65 files of src). Sizing
// districts by building count alone would hand the test district more land
// than the code it tests, inverting the town. Marking the district lets the
// layout weight it correctly instead of guessing.
var testDirNames = map[string]bool{
	"test": true, "tests": true, "e2e": true, "spec": true, "specs": true,
	"__tests__": true, "testing": true, "cypress": true, "playwright": true,
	"integration": true, "unit": true, "fixtures": true,
}

func districtKind(name string) Place {
	if testDirNames[strings.ToLower(name)] {
		return DistrictTest
	}
	return DistrictSource
}

// Building is a directory that contains source code.
type Building struct {
	Path     string `json:"path"`     // repo-relative, slash-separated
	Name     string `json:"name"`     // last path segment, for display
	District string `json:"district"` // first path segment
	Files    int    `json:"files"`    // source files directly in this directory
	Total    int    `json:"total"`    // source files including subdirectories
	Kind     Place  `json:"kind"`     // always PlaceBuilding
	Depth    int    `json:"depth"`    // path segments below the root
}

// Analyze walks root and produces its town.
//
// It returns an error only if the root cannot be read at all. Unreadable
// subdirectories are skipped: a single permission-denied folder should not
// fail an otherwise valid town.
func Analyze(root string) (*Town, error) {
	abs, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, &fs.PathError{Op: "analyze", Path: abs, Err: os.ErrInvalid}
	}

	// Initialise the slices rather than leaving them nil. A nil slice
	// marshals to `null`, not `[]`, so an empty project would hand the UI a
	// null it has to special-case — and a project with no source is a normal
	// state, not an error.
	t := &Town{
		Root:      abs,
		Name:      filepath.Base(abs),
		Buildings: []Building{},
		Districts: []District{},
	}

	// The repo already declares what is generated: .gitignore. Reading it
	// beats hardcoding every tool's output directory, because a project that
	// adds a new build tool teaches the analyzer about it for free.
	gitignored := readGitignore(abs)

	// files directly in each directory, keyed by repo-relative path
	direct := map[string]int{}

	walkErr := filepath.WalkDir(abs, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			// Skip what we cannot read rather than abandoning the walk.
			if d != nil && d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}

		if d.IsDir() {
			if path == abs {
				return nil
			}
			name := d.Name()
			if ignoredDirs[name] || strings.HasPrefix(name, ".") {
				return fs.SkipDir
			}
			// A gitignored directory is not the developer's source.
			if rel, relErr := filepath.Rel(abs, path); relErr == nil {
				if gitignored[filepath.ToSlash(rel)+"/"] || gitignored[filepath.ToSlash(rel)] {
					return fs.SkipDir
				}
			}
			return nil
		}

		if !isSource(d.Name()) {
			return nil
		}

		rel, relErr := filepath.Rel(abs, filepath.Dir(path))
		if relErr != nil {
			return nil
		}
		direct[filepath.ToSlash(rel)]++
		return nil
	})
	if walkErr != nil {
		return nil, walkErr
	}

	// A directory is a building if it holds source directly. The repo root is
	// deliberately excluded: root files belong to the Workshop, so they
	// neither invent a building nor get dropped.
	for rel, n := range direct {
		if rel == "." || n == 0 {
			continue
		}
		t.Buildings = append(t.Buildings, Building{
			Path:     rel,
			Name:     lastSegment(rel),
			District: districtOf(rel),
			Files:    n,
			Kind:     PlaceBuilding,
			Depth:    strings.Count(rel, "/") + 1,
		})
	}

	// Total counts include subdirectories, so a building that contains other
	// buildings is not undercounted.
	for i := range t.Buildings {
		t.Buildings[i].Total = t.Buildings[i].Files
		for rel, n := range direct {
			if rel != t.Buildings[i].Path && strings.HasPrefix(rel, t.Buildings[i].Path+"/") {
				t.Buildings[i].Total += n
			}
		}
	}

	// Stable order: by district, then path. Determinism is what makes the
	// layout reproducible (ADR-0012).
	sort.Slice(t.Buildings, func(i, j int) bool {
		if t.Buildings[i].District != t.Buildings[j].District {
			return t.Buildings[i].District < t.Buildings[j].District
		}
		return t.Buildings[i].Path < t.Buildings[j].Path
	})

	// Roll districts up.
	byName := map[string]*District{}
	for _, b := range t.Buildings {
		d, ok := byName[b.District]
		if !ok {
			d = &District{Name: b.District, Kind: districtKind(b.District)}
			byName[b.District] = d
		}
		d.Buildings++
		d.Files += b.Files
	}
	for _, d := range byName {
		t.Districts = append(t.Districts, *d)
	}
	sort.Slice(t.Districts, func(i, j int) bool {
		if t.Districts[i].Files != t.Districts[j].Files {
			return t.Districts[i].Files > t.Districts[j].Files
		}
		return t.Districts[i].Name < t.Districts[j].Name
	})

	return t, nil
}

// isSource reports whether a filename counts as construction material.
//
// Hidden files are excluded. A dotfile is configuration or tooling state
// (.eslintrc.js, .babelrc.ts), not construction — and counting them lets a
// directory's real size be inflated by files the developer never reads.
func isSource(name string) bool {
	if strings.HasPrefix(name, ".") {
		return false
	}
	lower := strings.ToLower(name)
	for _, s := range ignoredSuffixes {
		if strings.HasSuffix(lower, s) {
			return false
		}
	}
	ext := strings.ToLower(filepath.Ext(lower))
	return sourceExtensions[ext]
}

// districtOf returns a building's district: the first path segment.
//
// A top-level directory such as `scripts` is its own district, not the
// Workshop. The Workshop is for files that sit *at* the repo root, and those
// never become buildings at all — so this never returns PlaceWorkshop. It did
// originally, which silently filed every top-level directory under
// "workshop" and made `scripts` look like a root file.
func districtOf(rel string) string {
	if i := strings.Index(rel, "/"); i >= 0 {
		return rel[:i]
	}
	return rel
}

// readGitignore parses the root .gitignore into a set of literal patterns.
//
// This is deliberately a light parse: comments, blank lines and simple
// directory patterns only. Glob patterns are kept verbatim and matched by
// exact path, which covers the common case (`playwright-report/`,
// `test-results/`) without reimplementing git's pattern language. Anything
// more exotic is handled by the built-in ignore list instead.
func readGitignore(root string) map[string]bool {
	out := map[string]bool{}
	b, err := os.ReadFile(filepath.Join(root, ".gitignore"))
	if err != nil {
		return out // no .gitignore is not an error
	}
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "!") {
			continue
		}
		// Only take patterns that name a path literally. A pattern with a
		// wildcard is skipped rather than misapplied.
		if strings.ContainsAny(line, "*?[]") {
			continue
		}
		out[strings.TrimSuffix(strings.TrimPrefix(line, "/"), "/")+"/"] = true
		out[strings.TrimSuffix(strings.TrimPrefix(line, "/"), "/")] = true
	}
	return out
}

func lastSegment(rel string) string {
	if i := strings.LastIndex(rel, "/"); i >= 0 {
		return rel[i+1:]
	}
	return rel
}
