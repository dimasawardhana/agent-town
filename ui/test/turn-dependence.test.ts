import { strict as assert } from "node:assert";
import { test } from "node:test";

import { buildBase, buildBand, buildCap, buildShadow } from "../src/art/building";
import { buildMachine, MACHINES } from "../src/art/machine";
import { buildProp } from "../src/art/props";
import { ARCHETYPES } from "../src/art/roof";
import type { Pix } from "../src/art/surface";

const TURNS = [0, 1, 2, 3] as const;

function fingerprint(pix: Pix): string {
  return Buffer.from(pix.data).toString("base64");
}

function assertAnswersToTurn(name: string, draw: (turn: number) => Pix): void {
  const drawings = TURNS.map(draw);
  assert.ok(drawings.every((pix) => !pix.empty()), `${name} has an empty turn`);
  assert.ok(new Set(drawings.map(fingerprint)).size > 1, `${name} ignores turn`);
}

test("building base, band, cap, and shadow art answer to turn", () => {
  assertAnswersToTurn("base", (turn) => buildBase(58, "stone", "completed", false, turn));
  assertAnswersToTurn("band", (turn) => buildBand(58, "stone", "completed", turn));
  assertAnswersToTurn("cap", (turn) => buildCap(58, ARCHETYPES[1], "completed", turn));
  assertAnswersToTurn("shadow", (turn) => buildShadow(58, 9, "b", turn));
});

test("an asymmetric cap changes across a half turn", () => {
  const turn0 = buildCap(58, ARCHETYPES[1], "completed", 0);
  const turn2 = buildCap(58, ARCHETYPES[1], "completed", 2);
  assert.notDeepEqual(turn0.data, turn2.data);
});

test("machine art answers to turn for every kind", () => {
  for (const kind of MACHINES) {
    assertAnswersToTurn(`machine ${kind}`, (turn) => buildMachine(kind, "work", "chief", turn));
  }
});

test("prop art answers to turn for representative asymmetric props", () => {
  for (const kind of ["signpost", "wheelbarrow", "crane"] as const) {
    assertAnswersToTurn(`prop ${kind}`, (turn) => buildProp(kind, 0, turn));
  }
});
