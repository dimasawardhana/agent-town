// Package extension embeds the AI Town extension that agents load.
//
// The extension travels inside the binary so `townd install` works from a
// built binary rather than a source checkout. go:embed cannot reach outside
// its own package directory, so this package exists alongside the .ts file
// purely to carry it — the file cannot be embedded from cmd/townd.
package extension

import (
	_ "embed"
	"os"
	"path/filepath"
)

//go:embed ai-town.ts
var source string

// Name is the filename the agent expects, which is also the embedded name.
const Name = "ai-town.ts"

// Source is the extension's contents.
func Source() string { return source }

// GlobalDir is where a global install puts the extension.
//
// A global install covers every agent session on the machine, which is what a
// developer wants when they are working across several repositories.
func GlobalDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".omp", "agent", "extensions")
}

// ProjectDir is where a per-project install puts the extension.
//
// It is relative to the project because that is the point of a project-local
// install: it affects one repository and nobody else's sessions.
func ProjectDir(project string) string {
	return filepath.Join(project, ".omp", "extensions")
}

// Write installs the extension into dir and returns the path written.
//
// An existing file is not overwritten unless force is set: a developer may
// have edited their installed copy, and silently replacing it would throw that
// away with no way to notice.
func Write(dir string, force bool) (string, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(dir, Name)

	if !force {
		if _, err := os.Stat(path); err == nil {
			return path, os.ErrExist
		}
	}
	if err := os.WriteFile(path, []byte(source), 0o644); err != nil {
		return "", err
	}
	return path, nil
}
