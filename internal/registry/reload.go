package registry

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
)

// ReadConfigStrict reads the persisted project list and reports anything that
// stops it being trustworthy.
//
// It exists beside loadConfig because the two callers need opposite behaviour
// from a bad file. At startup, treating a corrupt config as empty is right: it
// is the only way out of a config the daemon cannot read, and the projects are
// still on disk to be re-added. While *running*, the same behaviour would be
// destructive — a half-written or malformed file would empty the registry and
// start rejecting the frames of agents that were working fine a moment ago.
// So the reload path uses this, and on error keeps what it already has.
func ReadConfigStrict(path string) ([]string, error) {
	if path == "" {
		return nil, fmt.Errorf("no config path")
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var c config
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, fmt.Errorf("config is not valid JSON: %w", err)
	}
	if c.Version > configVersion {
		return nil, fmt.Errorf("config version %d is newer than this build understands (%d)", c.Version, configVersion)
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

// ConfigStamp is configStamp for the daemon, which must compare fingerprints
// without the registry exposing its file format.
type ConfigStamp = configStamp

// Stamp reports a config file's current fingerprint.
func Stamp(path string) ConfigStamp { return stamp(path) }

// configStamp is a cheap fingerprint of the config file.
//
// The reload loop checks this before reading, so a daemon sitting idle costs
// one stat per interval rather than a parse. The modification time alone is not
// enough: a save and a subsequent edit can land inside the same timestamp
// granularity, and a same-size rewrite would otherwise go unnoticed.
type configStamp struct {
	size    int64
	modTime int64
	exists  bool
}

// stamp reports the config's current fingerprint.
func stamp(path string) configStamp {
	if path == "" {
		return configStamp{}
	}
	info, err := os.Stat(path)
	if err != nil {
		return configStamp{}
	}
	return configStamp{size: info.Size(), modTime: info.ModTime().UnixNano(), exists: true}
}

// Changed reports whether the file differs from a previous fingerprint.
func (s configStamp) Changed(other configStamp) bool { return s != other }

// Sync reconciles the registry against a desired set of project paths.
//
// It returns what was added and what was removed, so the daemon can report the
// change rather than applying it silently. Removal is not destruction: a
// project's town state stays on disk under the data directory, so removing and
// re-adding one restores what was built.
//
// keep names paths that must survive regardless of the config — the daemon's
// own --dir projects, which are served for one run and are absent from the file
// by design. Without that, syncing would drop them mid-session: their agents
// would start being refused frames while their daemon was still running.
func (r *Registry) Sync(desired []string, keep []string) (added, removed []string, err error) {
	want := make(map[string]bool, len(desired)+len(keep))
	for _, d := range desired {
		if abs, aerr := filepath.Abs(d); aerr == nil {
			want[abs] = true
		}
	}
	for _, d := range keep {
		if abs, aerr := filepath.Abs(d); aerr == nil {
			want[abs] = true
		}
	}

	// Added before removed, so a project present in one set and not the other
	// is never briefly absent: a frame arriving in that gap would be refused.
	for _, d := range sortedKeys(want) {
		if r.Get(d) != nil {
			continue
		}
		if _, aerr := r.Register(d); aerr != nil {
			return added, removed, aerr
		}
		added = append(added, d)
	}

	for _, d := range r.Paths() {
		if want[d] {
			continue
		}
		if r.Remove(d) {
			removed = append(removed, d)
		}
	}
	return added, removed, nil
}

// sortedKeys returns a map's keys in order, so Sync's result is deterministic
// and its reporting does not vary between runs.
func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
