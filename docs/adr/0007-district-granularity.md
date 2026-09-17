# District granularity: multi-building districts

## Context

The PRD Section 11 shows a town where each district contains one building (e.g., AUTH DISTRICT with one 🏢). Section 28 maps directories to buildings (e.g., `/internal/auth/` → Authentication Building). The granularity of districts vs buildings is undefined.

## Decision

Districts group multiple buildings. A district is an architectural domain boundary. Buildings are individual deployable units within it. Multi-building districts.

## Why

Three options exist:

1. **1:1 (one building per district)**: Simple but creates unnecessary districts for every package. A project with 20 packages = 20 districts = visual sprawl.
2. **Many-to-one (multiple packages per district)**: Districts by architectural concern, buildings by package. Example: "Internal" district contains Auth Building, Payment Building, User Building. This matches how developers think about their code.
3. **One-to-many (one package with multiple buildings)**: Overly complex. Most packages are a single deployable unit.

Option 2 is chosen because:
- It matches real-world architecture (developers think in domains, not individual files)
- It prevents visual sprawl (fewer districts to navigate)
- It allows the per-district zoom view to work naturally (each district has enough buildings to be interesting but not overwhelming)
- It aligns with the directory-based heuristic (all `/internal/` packages form a district)

## Consequences

- District boundaries are determined by directory grouping or architectural concern
- A district can have 1 to N buildings
- The per-district zoom view shows all buildings within a district
- If a district has 0 buildings, it shows as empty land (no building marker)
- District naming convention: derived from the parent directory or explicit user assignment
- Initial town generation groups directories by their parent path into districts

## Example

```
my-project/
  internal/
    auth/        → Auth Building (in "Internal" district)
    payment/     → Payment Building (in "Internal" district)
    user/        → User Building (in "Internal" district)
  cmd/
    server/      → Server Building (in "Cmd" district)
  tests/         → Test Center (in "Testing" district)
  migrations/    → Database Infrastructure (in "Infrastructure" district)
```

This creates 4 districts with varying building counts, preventing visual sprawl while maintaining architectural clarity.
