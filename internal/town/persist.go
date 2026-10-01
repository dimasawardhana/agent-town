package town

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"time"
)

// persistenceVersion guards the on-disk shape. A file written by an older build
// is discarded rather than misread: the town is a cache of what happened, and
// starting fresh beats starting wrong.
//
// Bumped to 2 when damage was split out of the status. A version-1 file holds
// statuses from the old five-word vocabulary — `untouched`, `constructing`,
// `broken` — and `broken` is not a rank on the ladder, so loading one would put
// a value in the field that no stage matches and the building would draw as
// whatever the fallback happened to be. Discarding is the only honest option:
// the events themselves are not persisted yet (ADR-0003), so the ladder cannot
// be reconstructed from a stale file.
const persistenceVersion = 2

// stored is the on-disk shape of the live state.
//
// Only what cannot be recomputed is written. The map comes back from the
// directory tree on every start — it is a pure function of the tree (ADR-0012)
// — so a path that no longer exists simply has no building to paint. Storing
// geometry would let it drift from the code it describes.
type stored struct {
	Version   int             `json:"version"`
	Updated   int64           `json:"updated"`
	Buildings []BuildingState `json:"buildings"`
}

// Load restores the live state saved for a project.
//
// A missing file is not an error: the first run has nothing to restore, and
// that is the normal case. A corrupt or stale file is discarded for the same
// reason — losing history is better than rendering something untrue.
func (t *Town) Load(path string) error {
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	var s stored
	if err := json.Unmarshal(b, &s); err != nil {
		return nil // unreadable state is discarded, not fatal
	}
	if s.Version != persistenceVersion {
		return nil
	}

	t.mu.Lock()
	defer t.mu.Unlock()
	for i := range s.Buildings {
		b := s.Buildings[i]
		seed, known := t.buildings[b.Path]
		if !known {
			// The path is no longer in the tree. The stored entry describes
			// something the map cannot paint, and keeping it would have the
			// snapshot claim buildings that do not exist — the same reason
			// geometry is not stored.
			continue
		}
		// History wins, but the tree sets the floor. A stored rank below the
		// seed is corrected upward rather than preserved: the finishing half
		// is real history and survives untouched, but the structural half is
		// recomputed on every start, so a stale one is not history at all. It
		// is an older reading of a tree that has since been measured
		// properly, and restoring it would undo the correction on every start
		// and leave the town stuck showing a size it no longer has.
		if rank(seed.Status) > rank(b.Status) {
			b.Status = seed.Status
		}
		t.buildings[b.Path] = &b
	}
	return nil
}

// Save writes the live state so a restart shows what was already built.
//
// Sorted before writing so the file is stable: an unchanged town produces an
// identical file, which makes it diffable and keeps a watcher from firing on
// a no-op save.
func (t *Town) Save(path string) error {
	t.mu.RLock()
	buildings := make([]BuildingState, 0, len(t.buildings))
	for _, b := range t.buildings {
		buildings = append(buildings, *b)
	}
	t.mu.RUnlock()

	sort.Slice(buildings, func(i, j int) bool { return buildings[i].Path < buildings[j].Path })

	b, err := json.MarshalIndent(stored{
		Version:   persistenceVersion,
		Updated:   time.Now().UnixMilli(),
		Buildings: buildings,
	}, "", "  ")
	if err != nil {
		return err
	}

	// Written via a temporary file and renamed, so a crash mid-write leaves
	// the previous state intact rather than a truncated file.
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// StatePath returns where a project's live state lives.
//
// It is keyed by the project's absolute path so several projects can be
// watched without their histories colliding, and lives under the user's data
// directory rather than in the project — a town is AI Town's record, not a
// file the developer asked for in their repository.
func StatePath(projectRoot string) string {
	base := os.Getenv("XDG_DATA_HOME")
	if base == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return ""
		}
		base = filepath.Join(home, ".local", "share")
	}

	// A short stable suffix keeps the filename readable while still
	// distinguishing two projects that share a basename.
	name := filepath.Base(projectRoot)
	sum := 0
	for _, c := range projectRoot {
		sum = (sum*31 + int(c)) & 0xffffff
	}
	return filepath.Join(base, "ai-town", name+"-"+itoaHex(sum)+".json")
}

func itoaHex(n int) string {
	const digits = "0123456789abcdef"
	if n == 0 {
		return "0"
	}
	var out []byte
	for n > 0 {
		out = append([]byte{digits[n%16]}, out...)
		n /= 16
	}
	return string(out)
}
