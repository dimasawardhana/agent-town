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
// Several syntaxes are recognised, because the project is written in them: Go's
// import block, and the `from "..."`, `require("...")`, `import("...")` and
// `export ... from "..."` forms every JavaScript dialect uses.
//
// Comments are stripped first, so a string that merely *looks* like an import — in
// a comment, or in a test fixture describing one — is not a road. That is not
// hypothetical: this very file, and `layout.go`, contain the literal text
// `import "../store"` inside Go comments describing the case this scanner is
// built to reject.

import (
	"os"
	"path"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// importEdges finds every import between two buildings in this town.
//
// The result is a set of ordered pairs, deduplicated, so a package that imports
// its neighbour forty times produces one road rather than forty.
func importEdges(root string, buildings map[string]bool) map[[2]string]bool {
	edges, _ := importEdgesCounting(root, buildings)
	return edges
}

// importEdgesCounting is importEdges, and also reports what it could not place.
//
// The count is the point of the second return. A scanner that silently drops
// what it cannot resolve is safe but unreadable: the map shows fewer roads than
// the code has dependencies, and nothing says so, so the absence reads as a
// fact about the repository rather than a limit of the scanner.
func importEdgesCounting(root string, buildings map[string]bool) (map[[2]string]bool, int) {
	out := map[[2]string]bool{}
	unresolved := 0
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
				// Only a *relative* specifier can name a building in this town,
				// so only one that fails to is something the map was asked to
				// draw and could not. A bare specifier is a package elsewhere by
				// definition and counting it would report a scanner failure
				// where there is none — which is the noise that makes a real
				// number stop being read.
				if !strings.HasPrefix(spec, ".") && !strings.HasPrefix(spec, "/") {
					continue
				}
				to := resolveImport(root, file, spec, buildings)
				if to == "" {
					unresolved++
				} else if to != from {
					out[[2]string{from, to}] = true
				}
			}
		}
	}
	return out, unresolved
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
	raw, err := os.ReadFile(file)
	if err != nil {
		return nil
	}
	src := stripComments(string(raw))
	var out []string

	// Go's block form: `import (` … `)`. The contents are quoted specifiers and
	// nothing else, so each quoted string inside the block is one.
	if i := strings.Index(src, "import ("); i >= 0 {
		if j := strings.Index(src[i:], "\n)"); j >= 0 {
			for _, line := range strings.Split(src[i+len("import ("):i+j], "\n") {
				if sp, ok := quoted(line); ok {
					out = append(out, sp)
				}
			}
		}
	}

	// Everything else, across the whole file rather than line by line.
	//
	// A line scanner misses the form this repository mostly uses: 44 of its
	// TypeScript files open an import with `import {` and close it four lines
	// later with `} from "./x"`, and the specifier is on neither the first line
	// nor any other single line. Every one of those imports was invisible.
	//
	// So this is a whole-file match with `(?s)`, bounded so it cannot run past
	// the closing brace, and it is bounded *and* not greedy for the same reason:
	// an unbounded `.*?` from `import` to the last quote on the page would
	// happily pair one import with an unrelated string.
	re := regexp.MustCompile(`(?s)import\s*(?:type\s*)?(?:\{[^}]*\}\s*from\s*)?[('"]+([./][^'"]*)[)'"]`)
	for _, m := range re.FindAllStringSubmatch(src, -1) {
		out = append(out, m[1])
	}
	// A re-export: `export … from "./x"`, and `export * from "./x"` which
	// re-exports a whole module and names no braces at all — a form the first
	// version missed, so a barrel file's edges were simply absent.
	rex := regexp.MustCompile(`(?m)^\s*export\s+(?:type\s+)?(?:(?:\{[^}]*\}|\*)\s+)?from\s*['"]([./][^'"]*)['"]`)
	for _, m := range rex.FindAllStringSubmatch(src, -1) {
		out = append(out, m[1])
	}
	// `require("./x")` and a dynamic `import("./x")` in a body, which is how a
	// lazily-loaded module names its target.
	rd := regexp.MustCompile(`(?:require|import)\s*\(\s*['"]([./][^'"]*)['"]`)
	for _, m := range rd.FindAllStringSubmatch(src, -1) {
		out = append(out, m[1])
	}
	return out
}

// stripComments removes `//` and block comments, respecting string literals.
//
// Without it a commented-out import is a road to a dependency that is not there,
// and this file's own comment in `layout.go` — which contains the literal text
// `import "../store"` inside a Go comment — would have been read as one. That is
// not hypothetical: three files in this repository have comment lines that begin
// with `import `, and a false road is exactly the confident lie the whole design
// refuses to draw.
//
// The string-awareness is what keeps a `//` inside a string — a URL, a path — from
// eating the rest of the line.
func stripComments(src string) string {
	var b strings.Builder
	b.Grow(len(src))
	inBlock, inStr := false, byte(0)
	for i := 0; i < len(src); i++ {
		c := src[i]
		if inBlock {
			if c == '*' && i+1 < len(src) && src[i+1] == '/' {
				inBlock = false
				i++
			}
			continue
		}
		if inStr != 0 {
			b.WriteByte(c)
			if c == '\\' && i+1 < len(src) {
				i++
				b.WriteByte(src[i])
			} else if c == inStr {
				inStr = 0
			}
			continue
		}
		if c == '"' || c == '\'' || c == '`' {
			inStr = c
			b.WriteByte(c)
			continue
		}
		if c == '/' && i+1 < len(src) {
			if src[i+1] == '/' {
				for i < len(src) && src[i] != '\n' {
					i++
				}
				b.WriteByte('\n')
				continue
			}
			if src[i+1] == '*' {
				inBlock = true
				i++
				continue
			}
		}
		b.WriteByte(c)
	}
	return b.String()
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
