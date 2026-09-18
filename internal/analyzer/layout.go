package analyzer

import (
	"math"
	"sort"
)

// World units are pixels. The frontend scales the camera; it never recomputes
// positions, so the layout stays the single source of truth (ADR-0012).
const (
	cellPad    = 20.0 // padding inside a district block
	cellGap    = 14.0 // gap between buildings
	labelSpace = 30.0 // room for a district label above its buildings
	rowGap     = 28.0 // gap between district rows
	maxRowW    = 1400.0
)

// Site is one place a worker can stand, with its position on the map.
type Site struct {
	ID       string `json:"id"`
	Kind     Place  `json:"kind"`
	Label    string `json:"label"`
	District string `json:"district,omitempty"`
	// DistrictKind lets the renderer colour a building without re-deriving
	// which district it belongs to from geometry. Two sources of truth for
	// the same fact drift; one cannot.
	DistrictKind Place   `json:"districtKind,omitempty"`
	Path         string  `json:"path,omitempty"`
	Files        int     `json:"files"`
	X            float64 `json:"x"`
	Y            float64 `json:"y"`
	W            float64 `json:"w"`
	H            float64 `json:"h"`
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
	l.Sites = append(l.Sites,
		Site{ID: "yard", Kind: PlaceYard, Label: "Yard", X: 40, Y: y, W: yardW, H: yardH},
		Site{ID: "workshop", Kind: PlaceWorkshop, Label: "Workshop", X: 40 + yardW + 24, Y: y, W: 200, H: yardH},
		Site{ID: "depot", Kind: PlaceDepot, Label: "Depot", X: 40 + yardW + 24 + 200 + 24, Y: y, W: 200, H: yardH},
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

		blk := placeDistrict(&l, d, buildings, x, y)

		x += blk.W + rowGap
		if blk.H > rowH {
			rowH = blk.H
		}
		if x+blk.W > maxRowW {
			x = 40.0
			y += rowH + rowGap
			rowH = 0
		}
	}

	// --- Bounds ---
	l.Width = maxRowW
	l.Height = y + rowH + 60

	return l
}

// placeDistrict lays out one district's block and its buildings, and appends
// both to the layout. It returns the block's rectangle via the appended
// PlacedDistrict.
func placeDistrict(l *Layout, d District, buildings []Building, x, y float64) PlacedDistrict {
	cols := int(math.Ceil(math.Sqrt(float64(len(buildings)))))

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
	cellW, cellH := maxW+cellGap, maxH+cellGap
	rows := int(math.Ceil(float64(len(buildings)) / float64(cols)))

	blockW := float64(cols)*cellW - cellGap + 2*cellPad
	blockH := float64(rows)*cellH - cellGap + 2*cellPad + labelSpace

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
			X:            bx,
			Y:            by,
			W:            w,
			H:            h,
		})
	}

	return pd
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
