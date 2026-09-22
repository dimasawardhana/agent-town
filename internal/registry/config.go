package registry

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"

	"github.com/dimasajiwardhana/agent-town/internal/analyzer"
)

// configVersion guards the config file's shape. A file written by a newer
// build is refused rather than misread, so an older binary cannot silently
// drop projects it does not understand.
const configVersion = 1

// config is the on-disk shape of the registry.
//
// Only the paths are stored. Everything else about a project — its buildings,
// its workers, its layout — is either recomputed from the tree or persisted by
// the town itself, so duplicating any of it here would create a second
// authority that can disagree.
type config struct {
	Version  int      `json:"version"`
	Projects []string `json:"projects"`
}

// ConfigPath returns where the registry is persisted.
//
// It lives under the user's config directory rather than the project, for the
// same reason the town state lives under the data directory: which projects a
// developer is working on is a preference about the machine, not a file they
// asked for in a repository.
func ConfigPath() string {
	base := os.Getenv("XDG_CONFIG_HOME")
	if base == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return ""
		}
		base = filepath.Join(home, ".config")
	}
	return filepath.Join(base, "ai-town", "config.json")
}

// loadConfig reads the persisted project list.
//
// A missing file returns an empty list rather than an error: the first run has
// no projects, and that is the normal case rather than a fault. A corrupt or
// future-versioned file is likewise treated as empty, because refusing to start
// over a bad config would make the daemon unusable with no way out.
func loadConfig(path string) ([]string, error) {
	if path == "" {
		return nil, nil
	}
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}

	var c config
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, nil
	}
	if c.Version > configVersion {
		return nil, nil
	}

	out := make([]string, 0, len(c.Projects))
	for _, p := range c.Projects {
		if p != "" {
			out = append(out, p)
		}
	}
	sort.Strings(out)
	return out, nil
}

// saveConfig writes the project list atomically.
//
// A temporary file renamed into place means a crash mid-write leaves the
// previous list intact rather than a truncated one. Losing the registry is
// recoverable — the projects still exist on disk and can be re-added — but a
// half-written file that fails to parse would silently lose all of them.
func saveConfig(path string, projects []string) error {
	if path == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}

	sorted := append([]string(nil), projects...)
	sort.Strings(sorted)

	b, err := json.MarshalIndent(config{Version: configVersion, Projects: sorted}, "", "  ")
	if err != nil {
		return err
	}
	b = append(b, '\n')

	tmp, err := os.CreateTemp(filepath.Dir(path), ".config-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)

	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}

// Load registers every project listed at path, without analyzing them.
//
// Registration is deliberately separate from analysis: a daemon serving a
// dozen projects should answer immediately rather than walking a dozen trees
// before its first response. Each map is built on first view, and events
// arriving before then are buffered rather than lost (see Project.Analyze).
func Load(path string) (*Registry, error) {
	return LoadBounded(path, analyzer.DefaultMaxFiles)
}

// LoadBounded is Load with an explicit file budget.
func LoadBounded(path string, maxFiles int) (*Registry, error) {
	r := NewBounded(maxFiles)
	dirs, err := loadConfig(path)
	if err != nil {
		return r, err
	}
	for _, d := range dirs {
		// Register cannot fail on a path that does not exist: a project in the
		// developer's config stays registered and reports itself unreadable,
		// rather than vanishing because its directory is temporarily gone.
		if _, err := r.Register(d); err != nil {
			return r, err
		}
	}
	return r, nil
}

// Save writes every registered project path to the config.
func (r *Registry) Save(path string) error {
	return saveConfig(path, r.Paths())
}
