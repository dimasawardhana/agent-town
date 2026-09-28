package analyzer

// Import roads: "this calls that", drawn as a road.
//
// Containment roads say a subdirectory is inside its parent, which is true and
// which says nothing. An import road says one building depends on another, and
// that is the thing a reader scanning a town is usually trying to learn.
//
// The whole design is bounded by one rule: **an edge exists only when both ends
// resolve to buildings this analyzer actually found.** A scanner that guessed —
// that read anything looking like an import and assumed a target — would draw
// roads to packages, to standard library names, to directories that do not exist,
// and every one of those would be a confident lie on a map whose entire claim is
// that it only says true things. So an unresolvable specifier yields no road and
// is not an error: a repository this cannot read simply has no import roads, and
// that is the correct description rather than a failure.
//
// Two syntaxes are recognised, because the project is written in them: Go's
// import block, and the `from "..."` / `require("...")` forms every JavaScript
// dialect uses. Both are matched on the quoted specifier rather than on the
// surrounding keywords, so a string that merely *looks* like an import in a
// comment or a test fixture is not a road.

import (
	"bufio"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
)

// importEdges finds every import between two buildings in this town.
//
// The result is a set of ordered pairs, deduplicated, so a package that imports
// its neighbour forty times produces one road rather than forty.
func importEdges(root string, buildings map[string]bool) map[[2]string]bool {
	out := map[[2]string]bool{}
	files := map[string][]string{} // building path -> the files that make it

	_ = filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			if d != nil && d.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if d.IsDir() {
			if strings.HasPrefix(d.Name(), ".") && p != root {
				return filepath.SkipDir
			}
			return nil
		}
		if !isSource(d.Name()) {
			return nil
		}
		rel, rerr := filepath.Rel(root, p)
		if rerr != nil {
			return nil
		}
		owner := buildingOf(filepath.ToSlash(rel), buildings)
		if owner == "" {
			return nil
		}
		files[owner] = append(files[owner], p)
		return nil
	})

	// Sorted so the scan order cannot leak into the result: a road set that
	// depended on directory order would differ between machines, and the town is
	// a pure function of the tree (ADR-0012).
	owners := make([]string, 0, len(files))
	for o := range files {
		owners = append(owners, o)
	}
	sort.Strings(owners)

	for _, from := range owners {
		for _, file := range files[from] {
			specs := importSpecifiers(file)
			for _, spec := range specs {
				if to := resolveImport(root, file, spec, buildings); to != "" && to != from {
					out[[2]string{from, to}] = true
				}
			}
		}
	}
	return out
}

// buildingOf is the longest building path that is a prefix of a file's path.
func buildingOf(rel string, buildings map[string]bool) string {
	best := ""
	for b := range buildings {
		if b == rel || strings.HasPrefix(rel, b+"/") {
			if len(b) > len(best) {
				best = b
			}
		}
	}
	return best
}

// importSpecifiers reads the quoted strings out of a file's import lines.
//
// Deliberately not a parser. A real one per language is out of proportion to
// what it buys here, and the consequence of being wrong is bounded by
// `resolveImport`: a specifier that does not land on a real building is dropped.
func importSpecifiers(file string) []string {
	f, err := os.Open(file)
	if err != nil {
		return nil
	}
	defer func() { _ = f.Close() }()

	var out []string
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	inBlock := false
	for sc.Scan() {
		line := sc.Text()
		trimmed := strings.TrimSpace(line)

		// Go's import block: `import (` … `)`.
		if strings.HasPrefix(trimmed, "import (") {
			inBlock = true
			continue
		}
		if inBlock {
			if trimmed == ")" {
				inBlock = false
				continue
			}
			if s, ok := quoted(trimmed); ok {
				out = append(out, s)
			}
			continue
		}

		// Go's single form, and the JavaScript ones.
		if !strings.HasPrefix(trimmed, "import ") &&
			!strings.HasPrefix(trimmed, "require(") {
			continue
		}
		if s, ok := quoted(trimmed); ok {
			out = append(out, s)
		}
	}
	return out
}

// quoted is the first double-quoted string on a line, if there is one.
func quoted(line string) (string, bool) {
	i := strings.Index(line, `"`)
	if i < 0 {
		return "", false
	}
	j := strings.Index(line[i+1:], `"`)
	if j < 0 {
		return "", false
	}
	return line[i+1 : i+1+j], true
}

// resolveImport maps a specifier to the building it names, or "" when it names
// nothing in this town.
//
// Relative specifiers are the only ones that can usually be resolved, and only
// because a relative path names a *file* while the town draws *directories*: the
// file is walked up until one of its ancestors is a building. A bare specifier —
// an npm package, a Go module path, anything the standard library ships — names
// something outside this town, so it produces no road. That is the honest answer
// and not a gap to be papered over with a prefix match on the module name.
func resolveImport(root, file, spec string, buildings map[string]bool) string {
	if !strings.HasPrefix(spec, ".") {
		return ""
	}
	rel, err := filepath.Rel(root, filepath.Dir(file))
	if err != nil {
		return ""
	}
	target := path.Clean(path.Join(filepath.ToSlash(rel), spec))
	if strings.HasPrefix(target, "..") {
		return ""
	}
	// The specifier may name a file or a directory; either way the building is
	// the longest known ancestor.
	best := ""
	for b := range buildings {
		if b == target || strings.HasPrefix(target, b+"/") {
			if len(b) > len(best) {
				best = b
			}
		}
	}
	return best
}
