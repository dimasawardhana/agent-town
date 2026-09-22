package analyzer

import (
	"path/filepath"
	"sort"
	"strings"
)

// Reason explains why a path resolved the way it did. It exists so a miss is
// never silent: the town always knows where a worker belongs, and when it
// could not tell, it says which case it hit rather than dropping the event.
type Reason string

const (
	ReasonBuilding    Reason = "building"     // inside a known building
	ReasonWorkshop    Reason = "workshop"     // a file at the repo root
	ReasonOutsideRepo Reason = "outside-repo" // nothing to do with this town
	ReasonInternalURI Reason = "internal-uri" // skill://, memory:// — not a file
	ReasonGlob        Reason = "glob"         // a pattern, names no single file
	ReasonUnmapped    Reason = "unmapped"     // a real path with no building
)

// Resolver maps a path from an agent event onto a Place in the town.
//
// This is the rule that lets a worker stand where the work is. It must always
// return a Place — an event with nowhere to go would render as an agent doing
// nothing, which is the town lying about what happened.
type Resolver struct {
	root      string
	buildings []string // repo-relative building paths, longest first
}

// NewResolver indexes a town's buildings for lookup.
//
// Buildings are sorted longest-first so the deepest match wins: a file three
// directories inside `src/domain` resolves to `src/domain`, not to `src`.
func NewResolver(t *Town) *Resolver {
	paths := make([]string, 0, len(t.Buildings))
	for _, b := range t.Buildings {
		paths = append(paths, b.Path)
	}
	sort.Slice(paths, func(i, j int) bool {
		if len(paths[i]) != len(paths[j]) {
			return len(paths[i]) > len(paths[j])
		}
		return paths[i] < paths[j]
	})
	return &Resolver{root: t.Root, buildings: paths}
}

// headerPath extracts the file path from an edit tool's argument.
//
// omp's edit tool carries no `path` field: the target is named on the *first
// line* of a payload, and the rest of the payload is the edit body. Two
// spellings of that header are in the wild and both must be understood:
//
//	§internal/town/town.go          — the documented form
//	[internal/town/town.go#D006]    — what the harness actually sends
//
// The second one is why this function exists rather than a `§` prefix check.
// The bracket form was arriving as an ordinary path, so the wildcard test below
// scanned the *entire payload* — and an edit body containing a `*` (a comment,
// a glob, a multiplication) was classified as a glob and filed in the Yard.
// Every such edit therefore landed nowhere near its building, which is why no
// building could ever be raised: the town was not ignoring the work, it was
// misfiling it as site-wide.
//
// Everything after the target on the header line is dropped: `#D006` is the
// harness's own hash tag, not part of the filename, and the body below it is
// content rather than location.
//
// A plain path with no header at all passes through unchanged, because most
// tools do carry a real `path` field.
func headerPath(raw string) string {
	p := strings.TrimSpace(raw)
	if p == "" {
		return ""
	}

	// Only the first line can name the target. Taking it up front is what keeps
	// a payload's body out of every test below.
	line := p
	if i := strings.IndexByte(line, '\n'); i >= 0 {
		line = line[:i]
	}
	line = strings.TrimSpace(line)

	// A header is a line that opens with `[`. Two shapes reach here, and the
	// malformed one is not hypothetical: a truncated payload — a log line cut
	// mid-write, a client that dropped the closing bracket — arrives as
	// `[path` with a body under it.
	//
	// The discriminator against a genuine `[slug]` route directory is the
	// closing bracket *position*. In a path the bracket closes and the path
	// continues (`[slug]/page.tsx`); in a header the close is the line's last
	// character. So: a close that ends the line is a header; no close at all on
	// a *multi-line* payload is a truncated header; anything else is a path.
	//
	// Getting this wrong is the same defect as the one above. A truncated
	// header left whole would put its edit body back in front of the wildcard
	// test, so a `*` in the body would misfile the edit as a glob again.
	multiline := strings.IndexByte(p, '\n') >= 0
	switch {
	case strings.HasPrefix(line, "§"):
		// The documented form: the prefix is the marker, and any `#tag` after
		// the name is the harness's.
		line = strings.TrimSpace(line[len("§"):])
		line = trimTag(line)
	case strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]"):
		line = strings.TrimSpace(line[1 : len(line)-1])
		line = trimTag(line)
	case strings.HasPrefix(line, "[") && multiline && !strings.Contains(line, "]"):
		// A truncated header: no close anywhere, and there is a body beneath,
		// so this cannot be one line of a path.
		line = strings.TrimSpace(strings.TrimPrefix(line, "["))
		line = trimTag(line)
	}

	return normalisePath(line)
}

// normalisePath strips the spellings that mean the same file without being the
// same string.
//
// Each one arrives from a real tool and each was silently misrouting work
// before this existed:
//
//   - `./internal/town/town.go` — the form a shell tool reports. Trimming only
//     the leading `./` is not enough on its own, because the directory lookup
//     below compares against `internal/town`, and a path that kept its dot
//     segment resolved to nothing and fell through to the Yard.
//   - `"path with spaces"` — a quoted argument, as a shell or a JSON-in-JSON
//     payload may carry it. The quotes are delimiters, not part of the name.
//   - `internal\town\town.go` — Windows separators. A repository checked out on
//     Windows sends these, and a backslash path matched no building at all.
//   - a trailing slash — `internal/town/` is the directory the test command
//     names, not a file inside it.
//
// This is deliberately a *normalisation* and not a resolution: it changes the
// characters, never the meaning. Deciding what the resulting path is remains
// Resolve's job.
func normalisePath(s string) string {
	s = strings.TrimSpace(s)

	// Quotes first: a quoted path may contain spaces that the later trims
	// would otherwise leave stranded.
	if len(s) >= 2 {
		if (s[0] == '"' && s[len(s)-1] == '"') || (s[0] == '\'' && s[len(s)-1] == '\'') {
			s = s[1 : len(s)-1]
		}
	}

	// Backslashes to slashes, so one separator spelling has to be handled
	// rather than two. Done before the prefix trim so `.\internal` also works.
	s = strings.ReplaceAll(s, "\\", "/")

	// A leading `./` may repeat (`././x`), so it is trimmed in a loop.
	for strings.HasPrefix(s, "./") {
		s = s[2:]
	}
	// A trailing slash names the directory itself.
	s = strings.TrimRight(s, "/")

	return strings.TrimSpace(s)
}

// trimTag drops a trailing `#tag` from a header's target.
//
// It is the last `#` that starts a tag, so a filename containing one earlier is
// left intact. The tag is the harness's own edit identity and never part of a
// path on disk.
func trimTag(s string) string {
	if i := strings.LastIndexByte(s, '#'); i >= 0 {
		return strings.TrimSpace(s[:i])
	}
	return s
}

// Resolve maps one path onto a Place.
//
// It returns the Place kind and, for a building, its repo-relative path. The
// reason is always populated.
func (r *Resolver) Resolve(path string) (kind Place, place string, reason Reason) {
	p := headerPath(path)
	if p == "" {
		return PlaceYard, "", ReasonUnmapped
	}

	// Internal URIs are not filesystem paths. omp's read tool accepts
	// `skill://name` and similar, which appear verbatim in real events.
	if strings.Contains(p, "://") {
		return PlaceDepot, "", ReasonInternalURI
	}

	// A wildcard marks a pattern, and a pattern names a set rather than a
	// place. glob and grep tools send these.
	//
	// This runs on the *header line* only, never the whole argument — see
	// headerPath. An edit whose body happens to contain a `*` is still an edit
	// to the file its header names.
	if strings.ContainsAny(p, "*?") {
		return PlaceYard, "", ReasonGlob
	}

	// A bracket is not proof of a pattern. A Next.js app-router route is a
	// real directory called `[slug]`, and reading the bracket as a wildcard
	// put edits to that building's own files in the Yard as site-wide work.
	// Bracketed paths get the building lookup first and fall back below.
	bracketed := strings.ContainsAny(p, "[]")

	rel := p
	if filepath.IsAbs(p) {
		var err error
		rel, err = filepath.Rel(r.root, p)
		if err != nil {
			return PlaceYard, "", ReasonOutsideRepo
		}
	}
	rel = filepath.ToSlash(rel)

	// An absolute path elsewhere on the machine is not part of this town.
	if strings.HasPrefix(rel, "../") || rel == ".." {
		return PlaceYard, "", ReasonOutsideRepo
	}

	dir := pathDir(rel)

	// A root-level file belongs to the Workshop, not to a building. The root
	// is deliberately not a building, so this is the only home for it.
	if dir == "" {
		return PlaceWorkshop, "", ReasonWorkshop
	}

	for _, b := range r.buildings {
		if dir == b || strings.HasPrefix(dir, b+"/") {
			return PlaceBuilding, b, ReasonBuilding
		}
	}
	// No building owns it. A bracketed path that got this far is a character
	// class rather than a route directory, so it is a glob after all — that is
	// why brackets are resolved optimistically instead of up front.
	if bracketed {
		return PlaceYard, "", ReasonGlob
	}

	// A real path inside the repo that holds no source of its own — a
	// lockfile directory, a generated folder. It is still site work.
	return PlaceYard, "", ReasonUnmapped
}

// ResolveDir maps a *directory* onto the building it is.
//
// It exists because not every event names a file. A test command names a
// directory — `go test ./internal/town` — and passing that to Resolve would be
// wrong in a way that looks right: Resolve treats its argument as a file and
// takes the parent directory of it, so `internal/town` would resolve to
// `internal` and the test would be credited to the wrong building, or to none.
//
// The deepest matching building wins, exactly as it does for a file, so a test
// of a nested package lands on that package rather than on its parent.
//
// ReasonUnmapped is a normal answer: a test of a directory holding no source of
// its own — a scripts folder, a fixtures folder — genuinely belongs to no
// building.
func (r *Resolver) ResolveDir(dir string) (kind Place, place string, reason Reason) {
	d := strings.TrimSpace(dir)
	if d == "" {
		return PlaceYard, "", ReasonUnmapped
	}
	if strings.Contains(d, "://") {
		return PlaceDepot, "", ReasonInternalURI
	}
	if strings.ContainsAny(d, "*?") {
		return PlaceYard, "", ReasonGlob
	}

	// An absolute directory is made relative to the town's root, so a test run
	// from another working directory still lands on its building.
	if filepath.IsAbs(d) {
		rel, err := filepath.Rel(r.root, d)
		if err != nil {
			return PlaceYard, "", ReasonOutsideRepo
		}
		d = rel
	}
	d = filepath.ToSlash(d)
	d = strings.TrimPrefix(d, "./")
	d = strings.TrimSuffix(d, "/")

	if strings.HasPrefix(d, "../") || d == ".." {
		return PlaceYard, "", ReasonOutsideRepo
	}
	// The repo root is not a building: root files belong to the Workshop.
	if d == "" || d == "." {
		return PlaceYard, "", ReasonUnmapped
	}

	// buildings is sorted longest-first, so the first hit is the deepest one.
	for _, b := range r.buildings {
		if d == b || strings.HasPrefix(d, b+"/") {
			return PlaceBuilding, b, ReasonBuilding
		}
	}
	return PlaceYard, "", ReasonUnmapped
}

// pathDir returns a path's directory in slash form, or "" when the path is a
// bare filename at the repo root.
func pathDir(rel string) string {
	i := strings.LastIndex(rel, "/")
	if i < 0 {
		return ""
	}
	return rel[:i]
}
