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
	"bytes"
	"io"
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
	// PlaceContainer is a directory that holds source below it and none of its
	// own. It is deliberately its own kind rather than a building: a container
	// has no rank and cannot be damaged, because it is an aggregate of what is
	// under it rather than something a worker can work on. Drawing it as a
	// building would make the town claim a lifecycle it does not have.
	PlaceContainer Place = "container"
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
	Root       string      `json:"root"`
	Name       string      `json:"name"`
	Districts  []District  `json:"districts"`
	Buildings  []Building  `json:"buildings"`
	Containers []Container `json:"containers"`

	// Partial records that the walk stopped at its budget, so this town is
	// drawn from part of the repository. It travels with the map because the
	// renderer must say so: a partial town presented as whole is the product
	// claiming work it did not do.
	Partial bool `json:"partial,omitempty"`

	// FilesSeen and MaxFiles report the size of that truncation, so the UI can
	// state how much was left out rather than only that something was.
	FilesSeen int `json:"filesSeen,omitempty"`
	MaxFiles  int `json:"maxFiles,omitempty"`
}

// Container is a directory that holds source *below* it but none of its own.
//
// These are where the shallowest view of a repository goes wrong. A directory
// is a Building only if it holds source directly, so on a Go project laid out as
// `internal/<pkg>/` the answer at the top level is almost nothing: the mass is
// all one or two levels down and, once the depth filter hides those, no building
// on the map stands for it. Measured on this repository, "top level only" drew
// one building holding 7.9% of the source.
//
// A container is not a second kind of building and is not drawn as one. It is
// the honest answer to "what is this neighbourhood made of", which is why it is
// carried separately and sized from AuthoredBytes.
type Container struct {
	Path string `json:"path"`
	Name string `json:"name"`
	// District is the first path segment, so a container is placed on the same
	// plate as the buildings it holds.
	District string `json:"district"`
	Kind     Place  `json:"kind"`
	// Files and Bytes are the subtree's totals, and AuthoredBytes the same with
	// machine-written files left out.
	Files         int  `json:"files"`
	Bytes         int  `json:"bytes"`
	AuthoredBytes int  `json:"authoredBytes"`
	Generated     bool `json:"generated,omitempty"`
	Depth         int  `json:"depth"`
	// MinChildDepth is the shallowest depth of any building beneath this
	// container, which is what decides when the container stops being the best
	// answer. A container is drawn while `depth <= filter < MinChildDepth`: deep
	// enough to be in view, but before the buildings it summarises are drawn
	// beside it.
	//
	// A single `depth <= filter` rule cannot express this, and the failure is
	// visible rather than theoretical — measured with that rule, `internal` and
	// its ten packages were both on screen at filter 2, a tower standing on the
	// same plate as the things it stands for.
	//
	// Computed here because the renderer would need the whole tree; the daemon
	// already has it.
	MinChildDepth int `json:"minChildDepth"`
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
	// Bytes is the total size of the source files directly in this directory,
	// and TotalBytes the same including subdirectories.
	//
	// Size in bytes is a different reading from the file count, and the two
	// disagree usefully: a directory of two vendored blobs and one of forty
	// small modules can hold the same count and wildly different mass. The count
	// drives the building's footprint and the bytes drive its height, so a
	// narrow tall tower and a broad low block are both expressible.
	//
	// Only source files are counted — the same `isSource` filter the count uses
	// — so a checked-in fixture or an asset cannot inflate a building.
	Bytes      int `json:"bytes"`
	TotalBytes int `json:"totalBytes"`
	// Generated marks a directory whose mass is machine-written output rather
	// than authored code. Such a directory is drawn one storey high whatever its
	// size, because otherwise the embedded UI bundle — 1.68 MB sitting alone in
	// a directory that is otherwise empty of source — would be the tallest
	// building in the town. A skyline ranking compiled output above written
	// output is a map of the wrong thing.
	Generated bool  `json:"generated,omitempty"`
	Kind      Place `json:"kind"`  // always PlaceBuilding
	Depth     int   `json:"depth"` // path segments below the root
	// AuthoredBytes is TotalBytes with machine-written files left out, rolled up
	// the same way. It is the mass a directory holds that somebody actually
	// wrote.
	//
	// The distinction exists for containers. A directory that holds subtrees but
	// no source of its own — `internal/`, `cmd/`, `src/` — is not a building
	// today, so its mass has no representative on the map at all and the
	// shallowest view of a Go repository is almost empty. Sizing such a
	// container from TotalBytes would collapse it to one storey the moment
	// anything below it was generated, which is the common case for a Go module
	// that embeds a built UI; sizing it from authored bytes is the reading that
	// survives.
	AuthoredBytes int `json:"authoredBytes,omitempty"`
}

// Analyze walks root and produces its town.
//
// It returns an error only if the root cannot be read at all. Unreadable
// subdirectories are skipped: a single permission-denied folder should not
// fail an otherwise valid town.
// DefaultMaxFiles bounds how many source files an analysis will visit.
//
// It exists because the analyzer has no natural stopping point: pointed at a
// home directory it visits tens of thousands of files and takes tens of
// seconds, during which the daemon can answer nothing else. A budget bounds
// the walk by cost, which a depth limit does not — depth truncates by tree
// shape, so a shallow cap can empty a real repository while still walking a
// pathological one.
//
// 2000 keeps every ordinary repository whole (the largest here has 12
// buildings from 35 files) while capping a home directory at tens of
// milliseconds.
const DefaultMaxFiles = 2000

// Analyze walks root and produces its town.
//
// It returns an error only if the root cannot be read at all. Unreadable
// subdirectories are skipped: a single permission-denied folder should not
// fail an otherwise valid town.
func Analyze(root string) (*Town, error) {
	return AnalyzeBounded(root, DefaultMaxFiles)
}

// AnalyzeBounded is Analyze with an explicit file budget.
//
// A budget of zero or less means unbounded. When the walk stops early the
// town is marked Partial rather than silently presented as whole: a town drawn
// from part of a repository is not the town, and PRD 34 forbids passing one
// off as the other.
func AnalyzeBounded(root string, maxFiles int) (*Town, error) {
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
		Root:       abs,
		Name:       filepath.Base(abs),
		Buildings:  []Building{},
		Districts:  []District{},
		Containers: []Container{},
	}

	// The repo already declares what is generated: .gitignore. Reading it
	// beats hardcoding every tool's output directory, because a project that
	// adds a new build tool teaches the analyzer about it for free.
	gitignored := readGitignore(abs)

	// files directly in each directory, keyed by repo-relative path
	direct := map[string]int{}
	// source bytes directly in each directory, same key
	directBytes := map[string]int{}
	// machine-generated output per directory, from the opening-line test
	directGenerated := map[string]bool{}
	// hand-written bytes directly in each directory: directBytes minus anything
	// a compiler wrote. This is what a container's height is built from, so a
	// directory holding nothing but a build artefact has no authored mass.
	authoredBytes := map[string]int{}
	seen := 0
	// truncated records that the walk stopped because the budget ran out,
	// rather than because the tree ended. Without it, a tree holding exactly
	// maxFiles files is indistinguishable from one that was cut off, and would
	// be reported as partial when nothing was omitted.
	truncated := false

	walkErr := filepath.WalkDir(abs, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			// Skip what we cannot read rather than abandoning the walk.
			if d != nil && d.IsDir() {
				return fs.SkipDir
			}
			return nil
		}

		// Stop once the budget is spent. WalkDir visits in lexical order, so
		// this is deterministic: the same tree yields the same town on every
		// run, which ADR-0012 requires.
		if maxFiles > 0 && seen >= maxFiles {
			truncated = true
			return fs.SkipAll
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
		seen++

		rel, relErr := filepath.Rel(abs, filepath.Dir(path))
		if relErr != nil {
			return nil
		}
		size := 0
		if info, infoErr := d.Info(); infoErr == nil {
			size = int(info.Size())
		}
		key := filepath.ToSlash(rel)
		// Only a large file can be machine-written, and only a large file is
		// worth opening: the smallest bundle worth caring about is tens of
		// kilobytes, while the median source file in this repository is under
		// 3 kB. So the walk reads an 8 kB prefix of big files and nothing else,
		// which leaves the ordinary case at zero extra I/O.
		//
		// Decided per file and before the accumulation below, because
		// "hand-written bytes" is what a *container* is sized by: a directory
		// whose only large content is a compiler's output holds no authored
		// mass, and a tower built from it would rank compiled code above code
		// somebody wrote.
		generated := size > largeFileBytes && !directGenerated[key] && looksGenerated(path)
		if generated {
			directGenerated[key] = true
		}
		direct[key]++
		directBytes[key] += size
		if !generated {
			authoredBytes[key] += size
		}
		return nil
	})
	if walkErr != nil {
		return nil, walkErr
	}

	// The budget stopped the walk before the tree was exhausted. Recorded
	// rather than left implicit so nothing downstream can present a partial
	// town as a whole one.
	if truncated {
		t.Partial = true
		t.FilesSeen = seen
		t.MaxFiles = maxFiles
	}

	// A directory is a building if it holds source directly. The repo root is
	// deliberately excluded: root files belong to the Workshop, so they neither
	// invent a building nor get dropped.
	for rel, n := range direct {
		if rel == "." || n == 0 {
			continue
		}
		t.Buildings = append(t.Buildings, Building{
			Path:      rel,
			Name:      lastSegment(rel),
			District:  districtOf(rel),
			Files:     n,
			Bytes:     directBytes[rel],
			Generated: directGenerated[rel],
			Kind:      PlaceBuilding,
			Depth:     strings.Count(rel, "/") + 1,
		})
	}

	// Totals include subdirectories, so a building that contains other buildings
	// is not undercounted. A directory holding a generated bundle is itself
	// treated as generated: its total is then a fact about a compiler, and
	// drawing it as a tower would say the same wrong thing one level up.
	for i := range t.Buildings {
		bi := &t.Buildings[i]
		bi.Total = bi.Files
		bi.TotalBytes = bi.Bytes
		bi.AuthoredBytes = authoredBytes[bi.Path]
		for rel, n := range direct {
			if rel != bi.Path && strings.HasPrefix(rel, bi.Path+"/") {
				bi.Total += n
				bi.TotalBytes += directBytes[rel]
				bi.AuthoredBytes += authoredBytes[rel]
				if directGenerated[rel] {
					bi.Generated = true
				}
			}
		}
	}

	// Containers: directories holding source below them and none of their own.
	//
	// Derived from the buildings rather than from the directory tree, because a
	// directory with no source anywhere beneath it is not part of the town at
	// all: `docs/`, `scripts/`, a vendored asset folder. Only an ancestor of an
	// actual building has anything to say, and walking the buildings gives
	// exactly those.
	//
	// The repo root is excluded for the same reason it is excluded from
	// buildings: its files belong to the Workshop, which is already on the map,
	// and a fourth place duplicating it would be one more thing to read.
	seenContainer := map[string]bool{}
	for _, b := range t.Buildings {
		// Every proper ancestor of the building's path. Walked by index rather
		// than with a `strings.Index` cursor, because `Index` returning -1 for
		// "no more separators" and -1 being a valid index into a sliced string
		// is an infinite loop rather than an error — measured, not theorised.
		for i := 0; i < len(b.Path); i++ {
			if b.Path[i] == '/' {
				seenContainer[b.Path[:i]] = true
			}
		}
	}
	for anc := range seenContainer {
		if _, isBuilding := direct[anc]; isBuilding {
			continue
		}
		c := Container{
			Path:     anc,
			Name:     lastSegment(anc),
			District: districtOf(anc),
			Kind:     districtKind(districtOf(anc)),
			Depth:    strings.Count(anc, "/") + 1,
		}
		for rel, n := range direct {
			if rel == anc || strings.HasPrefix(rel, anc+"/") {
				c.Files += n
				c.Bytes += directBytes[rel]
				c.AuthoredBytes += authoredBytes[rel]
				if directGenerated[rel] {
					c.Generated = true
				}
			}
		}
		if c.Files == 0 {
			// Reachable only if a building was recorded under a path whose
			// parents hold nothing, which the ancestor walk above cannot
			// produce — but an empty container would be a site with no mass on
			// a plate sized for nothing.
			continue
		}
		t.Containers = append(t.Containers, c)
	}
	// Sorted by path so the list is reproducible, which the depth filter and any
	// test over it depend on (ADR-0012).

	// MinChildDepth: the shallowest building under each container, from which the
	// display filter works out when the container should step aside.
	//
	// Taken from buildings rather than from nested containers, because a
	// container is never drawn alongside another container of the same subtree:
	// `internal` must wait for `internal/web`'s packages, not for
	// `internal/web` itself.
	for i := range t.Containers {
		c := &t.Containers[i]
		c.MinChildDepth = c.Depth + 1
		for _, b := range t.Buildings {
			if strings.HasPrefix(b.Path, c.Path+"/") && b.Depth < c.MinChildDepth {
				c.MinChildDepth = b.Depth
			}
		}
	}
	sort.Slice(t.Containers, func(i, j int) bool { return t.Containers[i].Path < t.Containers[j].Path })

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

// largeFileBytes is the size above which a source file is worth opening to ask
// whether a machine wrote it.
//
// It exists to keep the common case free: this repository's median source file
// is under 3 kB, and a hand-written file never approaches 64 kB, so the walk
// opens almost nothing. A generated bundle is orders of magnitude larger.
const largeFileBytes = 64_000

// generatedPrefixBytes is how much of a large file is read to decide.
//
// A minifier's first line is measured in kilobytes; a person's first line is
// measured in characters. One 8 kB read settles it, which is why this test costs
// a single read per large file rather than a scan of the tree.
const generatedPrefixBytes = 8192

// looksGenerated reports whether a file's opening looks machine-written.
//
// The first rule considered here was *dominance* — "one file eight times the
// size of all its siblings" — and it was wrong, in a way worth recording. The
// case it exists to catch is `internal/web/static/assets/index-*.js`, and that
// directory holds exactly ONE source file: the two `.woff2` fonts beside it are
// not source extensions and are not counted. A single file cannot be "larger
// than the rest of its directory", so the rule returned false and the minified
// bundle would have been the tallest building in the town — it missed the one
// case it was written for.
//
// What does work is the *shape of the opening*. A minifier emits one enormous
// line and no newline for kilobytes. Measured across all 71 source files in this
// repository, the bundle averages 14,629 bytes per line while the next-highest
// file averages 51 — a 287x gap with nothing in it. So this is not a tuned
// threshold but a different-kind-of-artefact detector, and it costs one read.
//
// A file that cannot be read is not reported as generated: the honest failure
// mode is "unknown", and treating unknown as generated would flatten real
// buildings.
func looksGenerated(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer func() { _ = f.Close() }()

	buf := make([]byte, generatedPrefixBytes)
	n, _ := io.ReadFull(f, buf)
	return n > 0 && !bytes.ContainsRune(buf[:n], '\n')
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
