#!/usr/bin/env node
// Does any test notice when the code is wrong?
//
// Three of the four ways this project shipped a useless test were *shapes* — a
// local that reimplemented the logic, a double that half-implemented an
// interface, a probe that computed the wrong thing. Those are greppable and
// `selftest.test.ts` catches them. The fourth is not: a test that calls the right
// function and asserts the wrong thing about it has no shape at all. It reads
// perfectly. The shadow test that guarded a ring which never came off imported
// the real module, used the real names, and was worth nothing.
//
// That question has a mechanical answer, and this is it. For each mutation, break
// the code on purpose, run the suite, and require it to go **red**. A mutation
// that survives is a claim that no test can tell right from wrong here — and it
// must be either fixed or written down, not left to be discovered later.
//
// Deliberately narrow. Mutation testing the whole suite is slow enough that
// nobody runs it, and a slow check is a dead check. This covers the handful of
// places where a wrong answer becomes a **false claim on the map** — the ember's
// window, the district geometry, the test-district weight, the import resolution.
// Those are the ones the project's founding promise depends on.
//
// Every mutation below is one the map would happily draw a lie about.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const UI = join(ROOT, "ui");

/** file, from, to, and the suites that must notice. */
const MUTATIONS = [
  {
    what: "the ember outlives its window",
    file: "src/embers.ts",
    from: "if (age >= EMBER_MS) return 0;",
    to: "if (age >= EMBER_MS * 4) return 0;",
    suite: "test:embers",
    // This one is a real hole, recorded rather than pretended away.
  },
  {
    what: "a touched building never stops glowing",
    file: "src/embers.ts",
    from: "if (age <= 0) return 1;",
    to: "if (age <= 0) return 0.5;",
    suite: "test:embers",
  },
  {
    what: "the sky gains a horizon again",
    file: "src/sky.ts",
    from: "  g.fillStyle = sky.ground;",
    to: "  g.fillStyle = sky.mid;",
    suite: "test:sky",
  },
  {
    what: "the tree's test district is no longer weighted down",
    file: "../internal/analyzer/layout.go",
    from: "testPitch = 0.7",
    to: "testPitch = 1.0",
    suite: null, // Go suite
    go: true,
  },
  {
    what: "districts are laid out on top of each other",
    file: "../internal/analyzer/layout.go",
    from: "x += blk.W + rowGap",
    to: "x += blk.W",
    suite: null,
    go: true,
  },
  {
    what: "a bare specifier is counted as unresolvable",
    file: "../internal/analyzer/imports.go",
    from: 'if !strings.HasPrefix(spec, ".") {',
    to: "if false {",
    suite: null,
    go: true,
  },
    {
    // A band stops being its own line and is drawn as its bounding box. This
    // existed for the containment band and the import road, and both are gone —
    // so rather than re-anchor it to whatever replaced them, it now pins the
    // invariant that outlived them: a road is an area, drawn from its rectangle,
    // and never from anything else.
    //
    // A stale mutation is worse than a missing one. It reports as coverage and
    // covers nothing, which is the same failure as a vacuous test.
    what: "a road stops being drawn from its own rectangle",
    file: "src/view.ts",
    from: "    const horizontal = r.w >= r.h;",
    to: "    const horizontal = r.h >= r.w;",
    suite: "test:turnroads",
  },
  {
    // The one the suite could not see for a week. The cap cel's pixels were
    // drawn for the real turn while its frame recorded turn 0's origin, so the
    // pennant and the roof damage — the two overlays cut from the *real* box —
    // landed 39x20px away from the building they belong to. It floated, and
    // every test that compared pixels passed, because both cels were
    // individually correct and only their recorded origins disagreed.
    what: "a cap's frame origin stops following the turn",
    file: "src/art/bake.ts",
    from: "const topBox = capBox(side, roof, turn);",
    to: "const topBox = capBox(side, roof);",
    suite: "test:flagcorner",
  },
  {
    // A phase that says `lit: true` while drawing nothing. The feature is a
    // table of three rows and a table is exactly the thing that can be correct
    // and unread — the sky would repaint and every window would stay glass, and
    // the whole claim of the feature would be decoration nobody could see.
    what: "dusk stops lighting anything",
    file: "src/daylight.ts",
    from: '  dusk: {\n    label: "Dusk",\n    sky: { ground: P.skyFar, mid: P.skyGlow, void: P.void },\n    lit: true,',
    to: '  dusk: {\n    label: "Dusk",\n    sky: { ground: P.skyFar, mid: P.skyGlow, void: P.void },\n    lit: false,',
    suite: "test:daylight",
  },
];

const run = (cmd, cwd) => {
  try {
    execSync(cmd, { cwd, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};

const results = [];
for (const m of MUTATIONS) {
  const abs = join(UI, m.file);
  const before = readFileSync(abs, "utf8");
  if (!before.includes(m.from)) {
    results.push({ ...m, verdict: "STALE", note: "the anchor text is gone; the mutation no longer applies" });
    continue;
  }
  writeFileSync(abs, before.replace(m.from, m.to));

  // Red means a test noticed. Green means nothing did.
  const green = m.go
    ? run("go test ./internal/analyzer/ -count=1", ROOT)
    : run(`npm run --silent ${m.suite}`, UI);

  writeFileSync(abs, before);
  if (!green) {
    results.push({ ...m, verdict: "caught" });
  } else if (m.survives) {
    results.push({ ...m, verdict: "survives (known)", why: m.why });
  } else {
    results.push({ ...m, verdict: "SURVIVES" });
  }
}

const pad = Math.max(...results.map((r) => r.what.length));
for (const r of results) {
  const mark = r.verdict === "caught" ? "caught   " : r.verdict === "SURVIVES" ? "SURVIVES " : r.verdict.padEnd(8) + " ";
  console.log(`  ${mark} ${r.what.padEnd(pad)}`);
  if (r.why) console.log(`  ${" ".repeat(9)}${r.why}`);
}

const uncaught = results.filter((r) => r.verdict === "SURVIVES" || r.verdict === "STALE");
console.log("");
console.log(`  ${results.length} mutations · ${results.filter((r) => r.verdict === "caught").length} caught · ${uncaught.length} unaccounted for`);
if (uncaught.length) {
  console.log("");
  console.log("  An unaccounted-for mutation means no test can tell right from wrong here.");
  console.log("  Fix a test, or write down why the survival is acceptable.");
  process.exit(1);
}
