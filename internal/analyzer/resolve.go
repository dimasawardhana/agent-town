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

// Resolve maps one path onto a Place.
//
// It returns the Place kind and, for a building, its repo-relative path. The
// reason is always populated.
func (r *Resolver) Resolve(path string) (kind Place, place string, reason Reason) {
	p := strings.TrimSpace(path)
	if p == "" {
		return PlaceYard, "", ReasonUnmapped
	}

	// Internal URIs are not filesystem paths. omp's read tool accepts
	// `skill://name` and similar, which appear verbatim in real events.
	if strings.Contains(p, "://") {
		return PlaceDepot, "", ReasonInternalURI
	}

	// A glob names a set, not a place. glob and grep tools send these.
	if strings.ContainsAny(p, "*?[") {
		return PlaceYard, "", ReasonGlob
	}

	// omp's edit tool carries no top-level path; the path is a `§<path>`
	// prefix on a hashline payload.
	if strings.HasPrefix(p, "§") {
		p = strings.TrimSpace(strings.SplitN(p, "\n", 2)[0][len("§"):])
		if p == "" {
			return PlaceYard, "", ReasonUnmapped
		}
	}

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

	// A real path inside the repo that holds no source of its own — a
	// lockfile directory, a generated folder. It is still site work.
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
