package analyzer

import (
	"math"
	"sort"
)

// SiteIDBuildingPrefix marks a Site whose ID names a building rather than one
// of the special places. It is the join key between an event's resolved Place
// and a position on the map, so it is defined once here and mirrored in the
// UI — a silent divergence would place a worker at the wrong spot rather than
// failing.
const SiteIDBuildingPrefix = "building:"

// World units are pixels. The frontend scales the camera; it never recomputes
// positions, so the layout stays the single source of truth (ADR-0012).
const (
	cellPad    = 20.0   // padding inside a district block
	cellGap    = 14.0   // gap between buildings
	labelSpace = 30.0   // room for a district label above its buildings
	rowGap     = 28.0   // gap between district rows
	maxRowW    = 1400.0 // target row width; a busy row may exceed it
	rowStart   = 40.0   // left margin, and where each new row begins

	// testPitch tightens a test district's cell spacing. Below 1 so a sprawl
	// of one-file spec directories reads as a compact cluster rather than
	// outranking the code it covers.
	testPitch = 0.7
)

// maxBuildingFootprint is the largest cel the atlas bakes, and therefore the
// largest thing that can stand anywhere — including a container standing for a
// whole district. A block is floored at this size so the thing standing on it
// always has ground.
const maxBuildingFootprint = 100.0

// Site is one place a worker can stand, with its position on the map.
type Site struct {
	ID       string `json:"id"`
	Kind     Place  `json:"kind"`
	Label    string `json:"label"`
	District string `json:"district,omitempty"`
	// DistrictKind lets the renderer colour a building without re-deriving
	// which district it belongs to from geometry. Two sources of truth for
	// the same fact drift; one cannot.
	DistrictKind Place  `json:"districtKind,omitempty"`
	Path         string `json:"path,omitempty"`
	Files        int    `json:"files"`
	// Bytes is the building's total source size and Floors the height derived
	// from it. Both travel rather than being recomputed in the browser: the
	// layout is the single source of truth for geometry (ADR-0012), and a
	// renderer deriving its own height could disagree with the cell reserved
	// for it.
	//
	// Floors is 1 for the three special places, which are not measured and have
	// no storeys to speak of — a place is furnished ground, not a building.
	Bytes  int `json:"bytes"`
	Floors int `json:"floors"`
	// Depth is how many path segments below the root this site sits: a
	// building at `a` is 1, at `a/b` is 2. The three special places are not in
	// the directory hierarchy at all and carry 0, so a display filter keyed on
	// depth can never hide them — which matters, because most of a session
	// happens in the Yard and hiding it would empty the map of its busiest
	// place.
	//
	// Sent rather than derived by the renderer for the usual reason: the
	// layout is the single source of truth for geometry (ADR-0012), and a
	// second derivation of the same fact drifts from the first.
	Depth int `json:"depth"`
	// MinChildDepth is only meaningful for a container: the shallowest depth of
	// any building beneath it. A container is drawn while
	// `Depth <= filter < MinChildDepth`, so it is on screen exactly while the
	// buildings it summarises are hidden and steps aside the moment they appear.
	//
	// Zero for a building, which has no children to wait for and is simply drawn
	// while `Depth <= filter`.
	MinChildDepth int     `json:"minChildDepth,omitempty"`
	X             float64 `json:"x"`
	Y             float64 `json:"y"`
	W             float64 `json:"w"`
	H             float64 `json:"h"`
}

// PlacedDistrict is a district's block on the map, drawn as its neighbourhood.
type PlacedDistrict struct {
	Name string  `json:"name"`
	Kind Place   `json:"kind"`
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	W    float64 `json:"w"`
	H    float64 `json:"h"`
}

// Layout is a town's geometry. It is a pure function of a Town, so the same
// project always produces the same map and a developer keeps their spatial
// memory of it (ADR-0012).
type Layout struct {
	Sites     []Site           `json:"sites"`
	Districts []PlacedDistrict `json:"districts"`
	Width     float64          `json:"width"`
	Height    float64          `json:"height"`
}

// buildingSize scales a building's footprint by its source-file count.
//
// Size is the whole point of the town: a glance should tell you which parts
// of the project are big. Four discrete steps rather than a continuous scale,
// because a continuous one produces a row of near-identical rectangles.
func buildingSize(files int) (w, h float64) {
	switch {
	case files <= 2:
		return 44, 44
	case files <= 5:
		return 60, 60
	case files <= 12:
		return 78, 78
	default:
		return 100, 100
	}
}

// Floors maps a building's total source bytes to a number of storeys.
//
// Height is a second, independent reading of "how big is this". The footprint
// comes from the file *count*; the height comes from the *mass*, so a directory
// of a few very large files is a narrow tower and one of many small files is a
// broad low block. Both are true statements about a codebase, and a map with
// only one of them is answering a smaller question than it could.
//
// A table rather than a formula, for the reason buildingSize gives about its own
// four steps: a continuous scale produces a row of near-identical towers, while
// a table can be argued about row by row and tuned without touching logic. The
// thresholds were calibrated against this repository's real distribution (1.9 kB
// to 1.7 MB across 15 building directories). Applied to those real totals they
// give: cmd/analyze 1, internal/agent/extension 2, cmd/townd 3,
// internal/{registry,agent} 4, internal/{town,analyzer,ui/src/art/props} 5,
// ui/src/art 7, ui/src 9, ui 9 — a spread legible as a skyline rather than as a
// row of equals. The three generated directories draw one storey each despite
// out-weighing everything else.
//
// A generated directory is one storey whatever its size. Without that the
// embedded UI bundle, 1.68 MB sitting alone in a directory with no other source,
// would be the tallest thing in the town: a skyline ranking compiled output above
// written output, which is a map of the wrong thing.
//
// The cap of 20 is a rendering limit as much as an aesthetic one: a storey is 20
// world units, so 20 storeys is 400 units of wall, and past that a tower stops
// reading as a building and starts reading as a vertical stripe with a roof on.
func Floors(b Building) int {
	if b.Generated {
		return 1
	}
	return floorsForBytes(b.TotalBytes)
}

// floorsForBytes is the byte-to-storey table on its own, so a container is
// measured with the same ruler as a building. Two tables would drift, and the
// drift would show as a container visibly the wrong height for the buildings
// standing under it.
func floorsForBytes(bytes int) int {
	switch {
	case bytes < 8_000:
		return 1
	case bytes < 16_000:
		return 2
	case bytes < 32_000:
		return 3
	case bytes < 64_000:
		return 4
	case bytes < 128_000:
		return 5
	case bytes < 256_000:
		return 7
	case bytes < 512_000:
		return 9
	case bytes < 1_000_000:
		return 12
	case bytes < 2_000_000:
		return 16
	default:
		return 20
	}
}

// ContainerFloors sizes a container from its hand-written mass.
//
// Authored bytes rather than total, and that is the whole reason the field
// exists: a module whose only large content is an embedded build artefact would
// otherwise collapse to one storey, hiding the authored code a reader is
// actually looking for. Measured on this repository: `internal` totals 2.0 MB of
// which 1.68 MB is the bundle, so total gives 1 storey where authored gives 9.
func ContainerFloors(c Container) int {
	return floorsForBytes(c.AuthoredBytes)
}

// LayoutTown computes where everything sits.
//
// Special places come first, in a band across the top: the Yard widest,
// because it is where the most work happens — roughly half of a real session
// is site-wide work like tests and builds. Districts follow underneath in
// wrapped rows.
func LayoutTown(t *Town) Layout {
	// Sites and districts are always non-nil: the three special places exist
	// even for an empty project, and the UI should never receive a null list.
	l := Layout{Sites: []Site{}, Districts: []PlacedDistrict{}}

	// --- The three places that are not in the directory tree ---
	//
	// These have no source files, so they cannot be sized from the tree. They
	// are given fixed land regardless of whether the project is empty, since
	// an event must always have somewhere to land (ADR-0012).
	y := 40.0
	yardW, yardH := 420.0, 150.0
	// The three places carry one floor and no bytes: they are furnished ground
	// rather than buildings, and a Yard twenty storeys high would be nonsense.
	// Set explicitly rather than left at Go's zero, because `floors: 0` on the
	// wire is a claim the renderer would have to defend against — and a fact
	// that is only true because a reader clamps it is not a fact the data holds.
	l.Sites = append(l.Sites,
		Site{ID: "yard", Kind: PlaceYard, Label: "Yard", X: 40, Y: y, W: yardW, H: yardH, Floors: 1},
		Site{ID: "workshop", Kind: PlaceWorkshop, Label: "Workshop", X: 40 + yardW + 24, Y: y, W: 200, H: yardH, Floors: 1},
		Site{ID: "depot", Kind: PlaceDepot, Label: "Depot", X: 40 + yardW + 24 + 200 + 24, Y: y, W: 200, H: yardH, Floors: 1},
	)
	y += yardH + 48

	// --- Districts ---
	//
	// Order comes from Analyze, which sorts by file count. That ordering is
	// what keeps the layout deterministic.
	x := 40.0
	rowH := 0.0

	for _, d := range t.Districts {
		buildings := buildingsIn(t, d.Name)
		if len(buildings) == 0 {
			continue
		}

		w := districtWidth(d, buildings)

		// Wrap before placing, not after. Testing the fit after the block has
		// been emitted would leave a straddling block sitting past the row
		// edge, outside the camera bounds the width implies — reachable only
		// by nothing.
		if x > rowStart && x+w > maxRowW {
			x = rowStart
			y += rowH + rowGap
			rowH = 0
		}

		blk := placeDistrict(&l, d, buildings, containersIn(t, d.Name), x, y)

		x += blk.W + rowGap
		if blk.H > rowH {
			rowH = blk.H
		}
	}

	// --- Bounds ---
	//
	// Derived from what was actually placed, never assumed. A district can be
	// wider than maxRowW on its own, so the canvas has to follow the content
	// rather than the target width — otherwise the camera bounds clip it.
	l.Width = rowStart
	l.Height = 0
	for _, s := range l.Sites {
		if r := s.X + s.W; r > l.Width {
			l.Width = r
		}
		if b := s.Y + s.H; b > l.Height {
			l.Height = b
		}
	}
	for _, d := range l.Districts {
		if r := d.X + d.W; r > l.Width {
			l.Width = r
		}
		if b := d.Y + d.H; b > l.Height {
			l.Height = b
		}
	}
	l.Width += rowStart
	l.Height += rowStart

	return l
}

// districtWidth returns the width a district's block will occupy.
//
// It exists separately from placeDistrict because the wrap decision has to be
// made before anything is placed.
func districtWidth(d District, buildings []Building) float64 {
	_, _, _, _, w, _ := districtBox(d, buildings)
	return w
}

// districtBox computes a district block's grid and extents.
//
// A test district is clustered rather than spread: it holds many directories
// with very few files each, so counting buildings would hand it more land than
// the code it tests (measured on team-builder: e2e is 16 buildings across 22
// files against src's 9 across 65). Test territory stays visible, because
// hiding it would be its own lie, but it cannot dominate the site. This is the
// correction ADR-0012 records.
func districtBox(d District, buildings []Building) (cols, rows int, cellW, cellH, blockW, blockH float64) {
	n := len(buildings)

	cols = int(math.Ceil(math.Sqrt(float64(n))))

	// Size the cell from the largest building in this district, so a district
	// of big buildings is not cramped and one of small buildings is not
	// mostly empty.
	var maxW, maxH float64
	for _, b := range buildings {
		w, h := buildingSize(b.Files)
		if w > maxW {
			maxW = w
		}
		if h > maxH {
			maxH = h
		}
	}
	cellW, cellH = maxW+cellGap, maxH+cellGap
	rows = int(math.Ceil(float64(n) / float64(cols)))

	// A test district holds many small directories and few files. Sizing it by
	// building count alone hands it more land than the code it tests —
	// measured on team-builder, e2e is 16 buildings across 22 files against
	// src's 9 across 65.
	//
	// The correction is a tighter cell pitch, not fewer columns: fewer
	// columns would raise the row count and make the block taller, which is
	// the opposite of compact. Test territory stays visible, because hiding it
	// would be its own lie, but it cannot dominate the site.
	pitch := 1.0
	if d.Kind == DistrictTest {
		pitch = testPitch
	}
	cellW, cellH = cellW*pitch, cellH*pitch

	// A plate must be able to hold whatever stands on it, and the largest thing
	// that can stand on a district is the container summarising it. `testPitch`
	// tightens cells to 0.7, so a single small spec directory can leave an inner
	// area smaller than the smallest cel the atlas bakes — measured at 30.8 units
	// for one 44-unit directory, against a 44-unit cel. The container then
	// overhung its own neighbourhood's pad.
	//
	// Flooring the block rather than shrinking the container is the honest fix:
	// the container's size is a reading of the code, and clamping it to a
	// shed-sized plate would make the map understate the tree. A slightly larger
	// block costs ground, which is the one thing the town is not short of.
	//
	// This changes no building's position within its own cell — the cell grid is
	// untouched — so the stability property this layout is built on holds.
	blockW = float64(cols)*cellW - cellGap*pitch + 2*cellPad
	blockH = float64(rows)*cellH - cellGap*pitch + 2*cellPad + labelSpace
	if blockW < maxBuildingFootprint+2*cellPad {
		blockW = maxBuildingFootprint + 2*cellPad
	}
	if blockH < maxBuildingFootprint+2*cellPad+labelSpace {
		blockH = maxBuildingFootprint + 2*cellPad + labelSpace
	}
	return cols, rows, cellW, cellH, blockW, blockH
}

// placeDistrict lays out one district's block, its buildings, and the
// containers that summarise it, and appends all of them to the layout.
//
// A container site is placed on the block's own area rather than given a cell of
// its own. The two are never on screen together — the display filter drops
// the container exactly when its children appear — so a reserved cell would
// shift every building in the district to make room for a site that is, at any
// given filter value, invisible. With 12 of 18 buildings moving the last time
// this layout was re-derived for a subset (issue 09), that is the mistake this
// avoids making twice.
func placeDistrict(l *Layout, d District, buildings []Building, containers []Container, x, y float64) PlacedDistrict {
	cols, _, cellW, cellH, blockW, blockH := districtBox(d, buildings)

	pd := PlacedDistrict{Name: d.Name, Kind: d.Kind, X: x, Y: y, W: blockW, H: blockH}
	l.Districts = append(l.Districts, pd)

	for i, b := range buildings {
		r, c := i/cols, i%cols
		w, h := buildingSize(b.Files)

		// Centre each building in its cell so a row of mixed sizes still
		// reads as a row.
		bx := x + cellPad + float64(c)*cellW + (cellW-cellGap-w)/2
		by := y + labelSpace + cellPad + float64(r)*cellH + (cellH-cellGap-h)/2

		l.Sites = append(l.Sites, Site{
			ID:           "building:" + b.Path,
			Kind:         PlaceBuilding,
			Label:        b.Name,
			District:     b.District,
			DistrictKind: d.Kind,
			Path:         b.Path,
			Files:        b.Files,
			Bytes:        b.TotalBytes,
			Floors:       Floors(b),
			Depth:        b.Depth,
			X:            bx,
			Y:            by,
			W:            w,
			H:            h,
		})
	}

	// The containers that summarise this district. Each is centred on the block's
	// inner area, because it speaks for the whole neighbourhood: `internal` is a
	// tower standing for all of `internal/`.
	//
	// Its footprint is a *baked* size from `buildingSize`, not the plate's own
	// extent, and that is the correction of a real defect. Sending the plate
	// extent made the daemon and the renderer disagree about what the site was:
	// the atlas bakes four footprints (44, 60, 78, 100), so the art was drawn at
	// the nearest of those while the layout centred the plate's size. Measured:
	// `internal`'s tower stood 81 units left and 66 units up of its plate, and
	// `cmd`'s 100-unit art overflowed its 142x114 plate by 43 units vertically.
	// A site whose declared footprint is not the footprint its art occupies
	// cannot be placed correctly by anyone.
	// Centreing uses the same expression a building's cell does, so a container
	// and a building stand on their ground by one rule.
	//
	// The footprint is also capped to the plate, because the mismatch above is
	// not only about which size is chosen — the two can genuinely disagree in
	// size. A container holding more than twelve files wants a 100-unit cel, and
	// a district whose only building is a 44-unit hut has a plate 84 units wide
	// (or 71 in a test district, which tightens its pitch). Reachable, and it put
	// the tower through its own neighbourhood's kerb. Capping keeps the art on
	// the ground it is standing for; the label and the plate still say how big
	// the neighbourhood is, so nothing is lost but the overhang.
	innerW := blockW - 2*cellPad
	innerH := blockH - labelSpace - 2*cellPad
	for _, c := range containers {
		if c.District != d.Name {
			continue
		}
		w, h := buildingSize(c.Files)
		l.Sites = append(l.Sites, Site{
			ID:       "container:" + c.Path,
			Kind:     PlaceContainer,
			Label:    c.Name,
			District: c.District,
			Path:     c.Path,
			Files:    c.Files,
			Bytes:    c.Bytes,
			// Floors come from authored bytes, so an embedded bundle does not
			// drag a module down to one storey.
			Floors:       ContainerFloors(c),
			DistrictKind: d.Kind,
			// Depth is the real distance from the root; MinChildDepth is when
			// this container steps aside. The renderer draws it while
			// `Depth <= filter < MinChildDepth`.
			Depth:         c.Depth,
			MinChildDepth: c.MinChildDepth,
			X:             x + cellPad + (innerW-w)/2,
			Y:             y + labelSpace + cellPad + (innerH-h)/2,
			W:             w,
			H:             h,
		})
	}
	return pd
}

// containersIn returns a district's containers in stable order.

func containersIn(t *Town, district string) []Container {
	var out []Container
	for _, c := range t.Containers {
		if c.District == district {
			out = append(out, c)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out
}

// buildingsIn returns a district's buildings in stable order.
func buildingsIn(t *Town, district string) []Building {
	var out []Building
	for _, b := range t.Buildings {
		if b.District == district {
			out = append(out, b)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out
}
