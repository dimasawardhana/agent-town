# Solid Town Look Design

## Goal
Make the solid town read as a dusk-lit place using the existing palette, real directional lighting, deterministic geometry-derived shading, visible architectural details, and selective window bloom.

## Decisions

- Keep phase policy pure in `ui/src/solid/sun.ts`; each `DayPhase` supplies a world-space directional key, a sky-coloured ambient fill, fog colour/density, and tunable intensities.
- Keep the scene as the Three.js adapter. It applies lighting and fog, exposes existing day controls, and owns the only post-processing pipeline.
- Use palette keys only. Shadows are produced by Lambert lighting plus sky-coloured ambient fill; no black overlay or screen-space ambient occlusion.
- Derive corner occlusion in the solid geometry path from the kit's part boundaries. Apply a deterministic darkening factor to vertices at sheltered lower/inside corners, without changing the framework-free kit contract.
- Make the requested architectural details real geometry: plinth, chamfered corners, roof overhang, and recessed window reveals. Preserve closed geometry and positive winding.
- Use emissive materials only for lit windows. Bloom is restricted to those window objects; no vignette or depth of field.
- Keep `ui/src/art/` unchanged.

## Files and seams

- `ui/src/solid/sun.ts`: pure phase lighting and fog policy.
- `ui/src/solid/material.ts`: palette-derived surface materials and the dedicated lit-window material.
- `ui/src/solid/forms.ts`: building detail geometry and deterministic occlusion metadata/vertex shading inputs.
- `ui/src/solid/scene.ts`: apply fog, lighting, window bloom, and knobs without adding geometry rules.
- `ui/test/solid-look.test.ts`: pure contract tests for phase parameters, deterministic occlusion, closed details, and selective bloom configuration.
- Existing solid tests remain regression coverage for winding, rank progression, turns, and rendering.

## Verification

- Add failing pure tests before implementation.
- Run the focused look, winding, solid, daylight, typecheck, and build commands.
- Run the live solid renderer and inspect screenshots at dusk, day, and night. Confirm warm low key, blue fill, tinted shadows, haze with distance, visible details, and lit-window-only bloom.
- Do not modify or depend on the flat renderer's art modules.
