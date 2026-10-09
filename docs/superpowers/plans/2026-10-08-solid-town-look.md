# Solid Town Look Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the solid town read as a dusk-lit place with palette-derived lighting, haze, deterministic geometry shading, visible architectural details, and selective window bloom.

**Architecture:** Keep phase policy pure in `sun.ts`; keep Three.js application in `scene.ts` and material construction in `material.ts`. Add architectural geometry through existing solid forms and keep kit geometry framework-free. Use a focused pure test suite plus live browser verification.

**Tech Stack:** TypeScript, Three.js, Node test runner, existing palette and solid renderer.

**Spec:** `docs/superpowers/specs/2026-10-08-solid-town-look-design.md`

## Global Constraints

- Do not modify `ui/src/art/`.
- Use palette keys only for new colours.
- Preserve closed, positively wound solid geometry.
- Do not add screen-space ambient occlusion, vignette, or depth of field.
- Bloom may apply only to lit-window objects.
- Save recovery copies before changing existing files.
- Run focused tests, `npm run typecheck`, and `npm run build`; report missing `lint` and `type-check` scripts.

---

### Task 1: Phase lighting and fog policy

**Files:**
- Modify: `ui/src/solid/sun.ts`
- Test: `ui/test/solid-look.test.ts`
- Modify: `ui/package.json` only if the focused test script is absent

**Interfaces:**
- Preserve `sunFor(phase)` and `fillFor(phase)` signatures.
- Add exported `fogFor(phase): { colour: string; near: number; far: number }`.
- Add exported `lookKnobs`: immutable values for key intensity, fill intensity, fog near/far, and bloom threshold/strength/radius.

- [ ] **Step 1: Write failing tests**

Assert every phase returns finite unit sun direction, palette colours, positive fog range, distinct phase fog values, and knobs with `near < far`, nonnegative bloom threshold, and finite positive bloom parameters.

- [ ] **Step 2: Run the focused test and confirm failure**

Run `npm run test:solid-look` from `ui`. Expected failure: missing `fogFor`, `lookKnobs`, or test script.

- [ ] **Step 3: Implement minimal pure policy**

Extend the existing phase table with palette-derived fog colours and return stable fog distances. Export a frozen knobs object. Keep all phase decisions deterministic and free of `Date`, renderer imports, or ambient state.

- [ ] **Step 4: Run the focused test and confirm pass**

Run `npm run test:solid-look` from `ui`.

### Task 2: Materials and selective window channel

**Files:**
- Modify: `ui/src/solid/material.ts`
- Test: `ui/test/solid-look.test.ts`

**Interfaces:**
- Preserve `solidMaterial(colour)`.
- Add `litWindowMaterial(colour, intensity): THREE.MeshLambertMaterial` or the repository’s established material type, with emissive colour and no unrelated post-effect marker.

- [ ] **Step 1: Add failing material contract tests**

Assert normal materials are double-sided and non-emissive; assert lit-window material is emissive, has positive emissive intensity, and is distinct from normal surface material.

- [ ] **Step 2: Run the focused test and confirm failure**

Run `npm run test:solid-look`. Expected failure: missing lit-window export.

- [ ] **Step 3: Implement the dedicated window material**

Use palette `P.glass` values only. Keep all ordinary role materials unchanged. Do not make every glass surface emissive.

- [ ] **Step 4: Run the focused test and confirm pass**

Run `npm run test:solid-look`.

### Task 3: Geometry details and deterministic occlusion

**Files:**
- Modify: `ui/src/solid/forms.ts`
- Modify: `ui/src/solid/kit.ts` only where an existing operation needs strict validation
- Test: `ui/test/solid-look.test.ts`
- Recovery copies: `ui/src/solid/forms.ts.task113.bak`, `ui/src/solid/kit.ts.task113.bak`

**Interfaces:**
- Preserve `solidFor(site, rank)` and all existing part roles.
- Add detail geometry within the existing part output, not a second renderer path.
- Keep all generated parts finite, closed, and positively wound.

- [ ] **Step 1: Add failing geometry tests**

Build representative stone and glass forms at footprint 44 and 100. Assert the completed form contains plinth, chamfer, overhang, and window-reveal geometry through stable part-role/triangle-count contracts; assert all added solids have positive signed volume and no non-finite coordinates. Assert repeated builds are byte-identical.

- [ ] **Step 2: Run tests and confirm failure**

Run `npm run test:solid-look` and `npm run test:solid-winding`. Expected failure: required details are absent or geometry counts do not change.

- [ ] **Step 3: Implement details using existing kit operations**

Use footprint-relative `chamfer`, `windowReveal`, `roofOverhang`, `parapet`, and `canopy` where their current forms fit. Add a plinth as a low, footprint-relative base band. Keep windows recessed rather than emitting a coplanar overlay. Apply deterministic corner darkening from part adjacency/height in the form-to-material metadata, never from random or frame-time state.

- [ ] **Step 4: Run geometry tests and confirm pass**

Run `npm run test:solid-look`, `npm run test:solid-winding`, and `npm run test:solid`.

### Task 4: Scene lighting, fog, and bloom wiring

**Files:**
- Modify: `ui/src/solid/scene.ts`
- Test: `ui/test/solid-look.test.ts`
- Recovery copy: `ui/src/solid/scene.ts.task113.bak`

**Interfaces:**
- Preserve `SolidScene.setDay(phase)` and renderer lifecycle.
- Apply `fogFor` to the scene and `lookKnobs` to the lighting/post-processing rig.

- [ ] **Step 1: Add failing scene wiring checks**

Assert source-level/runtime configuration exposes fog, one directional key, one ambient fill, and a bloom pass whose selection contains only lit-window objects. Assert no vignette, depth-of-field, or screen-space ambient-occlusion pass is configured.

- [ ] **Step 2: Run the check and confirm failure**

Run `npm run test:solid-look`. Expected failure: fog and bloom configuration are absent.

- [ ] **Step 3: Implement scene wiring**

Set scene fog from `fogFor(this.day)`, update fog on `setDay`, and keep the clear colour palette-derived. Add the smallest available Three.js post-processing path already supported by project dependencies. Tag lit-window meshes and select only those for bloom; if the renderer lacks an existing post-processing dependency, implement selective emissive material plus renderer bloom capability without introducing a new dependency, and record the limitation rather than applying global bloom.

- [ ] **Step 4: Run focused tests and build**

Run `npm run test:solid-look`, `npm run test:solid`, `npm run test:solid-winding`, `npm run test:daylight`, `npm run typecheck`, and `npm run build`.

### Task 5: Live tuning and final verification

**Files:**
- Modify only the implementation files if measured tuning is needed.
- Do not modify `ui/src/art/`.

- [ ] **Step 1: Launch the actual solid renderer**

Use the repository’s existing dev/server command and browser tooling. Switch to Solid and capture dusk, day, and night screenshots at the fitted view.

- [ ] **Step 2: Check visual contracts**

Confirm warm low dusk key, cool fill, tinted—not black—shadows, distance haze, visible plinth/chamfer/overhang/recess, raised contact geometry, and bloom limited to lit windows.

- [ ] **Step 3: Run required project checks**

Run focused suites, `npm run typecheck`, and `npm run build`. Run `npm run lint` and `npm run type-check`; record missing-script failures if unchanged.

- [ ] **Step 4: Update task evidence**

Update Seraph TASK-113 with exact files and observed command/browser evidence, then release the claim.
