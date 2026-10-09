import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const solidRule = html.match(/#solid\s*\{([^}]*)\}/)?.[1] ?? "";
const canvasRule = html.match(/#solid canvas\s*\{([^}]*)\}/)?.[1] ?? "";
const solidView = readFileSync(new URL("./src/solid/SolidView.tsx", import.meta.url), "utf8");

test("the solid host is bounded independently of its canvas", () => {
  assert.match(solidRule, /position\s*:\s*absolute/);
  assert.match(solidRule, /inset\s*:\s*0/);
  assert.match(solidView, /<div id="solid" ref={host} style={{ position: "absolute", inset: 0 }}/);
  assert.match(canvasRule, /display\s*:\s*block/);
});
