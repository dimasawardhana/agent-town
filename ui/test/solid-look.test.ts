import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import test from "node:test";
import { DAY_PHASES } from "../src/daylight";
import { P } from "../src/art/palette";
import { fillFor, fogFor, lookKnobs, sunFor } from "../src/solid/sun";
import { solidMaterial, litWindowMaterial } from "../src/solid/material";
import { solidFor, type BuiltPart } from "../src/solid/forms";
import type { Site } from "../src/store";
import { litWindowFor, phaseWindowIntensity, sceneLookPolicy } from "../src/solid/scene";

const paletteColours = new Set(Object.values(P).flatMap((value) =>
  Array.isArray(value) ? [...value] : [value],
));

for (const phase of DAY_PHASES) {
  test(`${phase} lighting and fog policy is finite and palette-derived`, () => {
    const sun = sunFor(phase);
    const magnitude = Math.hypot(...sun.toSun);
    assert.ok(Number.isFinite(magnitude));
    assert.ok(Math.abs(magnitude - 1) < 1e-9);
    assert.ok(paletteColours.has(sun.colour));
    assert.ok(paletteColours.has(fillFor(phase).colour));

    const fog = fogFor(phase);
    assert.ok(paletteColours.has(fog.colour));
    assert.ok(Number.isFinite(fog.near));
    assert.ok(Number.isFinite(fog.far));
    assert.ok(fog.near > 0);
    assert.ok(fog.near < fog.far);
  });
}

test("phase fog colours are distinct", () => {
  assert.equal(new Set(DAY_PHASES.map((phase) => fogFor(phase).colour)).size, DAY_PHASES.length);
});

test("phase fog fades the fitted town rather than starting at its roofs", () => {
  for (const phase of DAY_PHASES) {
    const fog = fogFor(phase);
    assert.ok(fog.near < 260, `${phase} fog does not start at far rooftops`);
    assert.ok(fog.far > 820, `${phase} fog reaches beyond farthest town faces`);
  }
});

test("phase suns stay above the world ground plane", () => {
  for (const phase of DAY_PHASES) {
    assert.ok(sunFor(phase).toSun[2] > 0, `${phase} sun is above ground`);
  }
});

test("scene light tuning knobs are positive", () => {
  assert.ok(lookKnobs.keyIntensity > 0);
  assert.ok(lookKnobs.fillIntensity > 0);
});

test("ordinary and lit-window materials have separate contracts", () => {
  const glass = Number.parseInt(P.glass[0].slice(1), 16);
  const normal = solidMaterial(glass);
  const window = litWindowMaterial(glass, 1.5);

  assert.equal(normal.side, 2);
  assert.equal(normal.emissive.getHex(), 0);
  assert.equal(window.side, 2);
  assert.ok(window.emissive.getHex() !== 0);
  assert.ok(window.emissiveIntensity > 0);
  assert.notEqual(window, normal);
});
function volume(positions: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i], ay = positions[i + 1], az = positions[i + 2];
    const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5];
    const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8];
    sum += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return sum / 6;
}

test("building detail roles contain footprint-scaled solids and repeat deterministically", () => {
  const site: Site = { id: "details", kind: "building", label: "details", files: 1, depth: 1, bytes: 1, x: 0, y: 0, w: 44, h: 44, floors: 2 };
  const parts = solidFor(site, "completed");
  const names = parts.map(({ name }) => name);
  assert.deepEqual(names, ["plot", "footings", "frame", "walls", "cap", "glazing", "door", "trim"]);
  const byName = (name: string) => parts.find((part) => part.name === name)!.geometry.positions;
  assert.ok(byName("cap").length > 0, "roof overhang geometry");
  assert.ok(byName("footings").length > 36, "plinth/chamfer geometry");
  assert.ok(byName("glazing").length > 36, "recessed window reveal geometry");
  for (const part of parts) {
    assert.ok(part.geometry.positions.every(Number.isFinite), `${part.name} finite coordinates`);
    assert.ok(volume(part.geometry.positions) > 0, `${part.name} positive signed volume`);
  }
  assert.deepEqual(solidFor(site, "completed"), parts);
});
test("detail geometry uses footprint-relative dimensions", () => {
  const site: Site = { id: "details", kind: "building", label: "details", files: 1, depth: 1, bytes: 1, x: 0, y: 0, w: 44, h: 44, floors: 2 };
  const small = solidFor(site, "completed");
  const large = solidFor({ ...site, w: 100, h: 100 }, "completed");
  const span = (parts: BuiltPart[], name: string, axis: number) => {
    const values = parts.find((part) => part.name === name)!.geometry.positions.filter((_, i) => i % 3 === axis);
    return Math.max(...values) - Math.min(...values);
  };
  for (const name of ["footings", "cap", "glazing"] as const) {
    assert.ok(span(large, name, 0) > span(small, name, 0));
  }
});
test("part shading is deterministic and darkens lower footprint corners", () => {
  const site: Site = { id: "shade", kind: "building", label: "shade", files: 1, depth: 1, bytes: 1, x: 0, y: 0, w: 44, h: 44, floors: 2 };
  const parts = solidFor(site, "completed");
  const part = parts.find(({ name }) => name === "walls")!;
  assert.equal(part.shade!.length, part.geometry.positions.length / 3);
  assert.ok(part.shade!.some((value) => value < 1));
  assert.ok(part.shade!.every((value) => value === 1 || value === 0.78));
  assert.deepEqual(solidFor(site, "completed").map(({ shade }) => shade), parts.map(({ shade }) => shade));
});


test("lit windows are deterministic and selective by site", () => {
  assert.equal(litWindowFor("site-a"), litWindowFor("site-a"));
  assert.equal(litWindowFor(undefined), false);
  assert.ok(["site-a", "site-b", "site-c", "site-d", "site-e", "site-f"].some((id) => litWindowFor(id)));
  assert.ok(["site-a", "site-b", "site-c", "site-d", "site-e", "site-f"].some((id) => !litWindowFor(id)));
});

test("only lit-window bloom is permitted and intensity follows phase", () => {
  assert.equal(sceneLookPolicy.selectiveBloomSupported, false);
  assert.equal(sceneLookPolicy.bloomTarget, "lit-window");
  assert.equal(sceneLookPolicy.excludesGlobalBloom, true);
  assert.equal(sceneLookPolicy.excludesVignette, true);
  assert.equal(sceneLookPolicy.excludesDepthOfField, true);
  assert.equal(sceneLookPolicy.excludesAmbientOcclusion, true);
  assert.equal(phaseWindowIntensity("day"), 0);
  assert.ok(phaseWindowIntensity("dusk") > 0);
  assert.ok(phaseWindowIntensity("night") > phaseWindowIntensity("dusk"));
});
test("solid scene registers and removes pointer tracking listeners", () => {
  const scene = readFileSync(new URL("../ui/src/solid/scene.ts", import.meta.url), "utf8");
  assert.match(scene, /addEventListener\("pointerdown", this\.onPointerDown\)/);
  assert.match(scene, /addEventListener\("pointermove", this\.onPointerMove\)/);
  assert.match(scene, /removeEventListener\("pointerdown", this\.onPointerDown\)/);
  assert.match(scene, /removeEventListener\("pointermove", this\.onPointerMove\)/);
});
