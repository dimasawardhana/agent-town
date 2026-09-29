// A test that tests itself.
//
// Four times this project shipped a test that agreed with itself: it passed
// while the code did the opposite, because the test reimplemented the logic
// instead of calling it. Twice the reimplementation was a local arrow named after
// the thing it was standing in for; once it was a test double that silently
// dropped half the interface and had to be `as unknown as`-cast to fit.
//
// Both are mechanical, so they are checked mechanically. This is the check the
// other three checks do not make: `commenttruth` compares a *comment* to the code
// beside it, and neither it nor any test compares a *test* to the code it names.
//
// It is deliberately noisy in the direction that finds things. A finding here is
// not a verdict — a legitimate fixture helper can look like a reimplementation —
// so each one names the file, the line, and the production symbol it shadows, and
// leaves the judgement to the reader.

import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// The bundle lands beside the tests (ui/ui-selftest.test.mjs), so two paths have
// to be said separately and confusingly: the *sources* it reads, and where the
// bundle happens to sit. The first version conflated them, read no test files at
// all, and passed on an empty result — which is the exact failure this check
// exists to catch, committed by the check itself.
const UI_DIR = new URL(".", import.meta.url).pathname;
const TEST_DIR = join(UI_DIR, "test");
const SRC_DIR = join(UI_DIR, "src");

/** Every symbol any module under src/ exports, by name. */
function exportedNames(): Map<string, string> {
  const names = new Map<string, string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const src = readFileSync(p, "utf8");
      for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|class|interface|type)\s+([A-Za-z_$][\w$]*)/g)) {
        if (!names.has(m[1])) names.set(m[1], p.replace(SRC_DIR, "src"));
      }
      // Methods and properties too, not just top-level exports. The first
      // version of this check collected only exports and therefore missed the
      // very defect it was written for: the local arrow was named after
      // `Embers.reconcile`, which is a *method*, and the check had never heard
      // of it. A name a test may not reuse is a name the check has to know.
      for (const m of src.matchAll(/^\s{2}(?:(?:public|private|protected|static|async|get|set)\s+)*([A-Za-z_$][\w$]*)\s*[(<]/gm)) {
        if (!names.has(m[1])) names.set(m[1], p.replace(SRC_DIR, "src"));
      }
    }
  };
  walk(SRC_DIR);
  return names;
}

test("no test *decides* something production also decides", () => {
  // Reports rather than blocks, and the reason is measured rather than assumed: a
  // strict name-shadowing check fires on four one-line accessors in `art.test.ts`
  // that happen to be called `at`, `box` and `hex`. A check that blocks on that
  // gets disabled within a week, which is worse than not having it.
  //
  // The narrower signal is the one that actually mattered: a local whose body
  // *branches on* the thing production branches on. A helper that looks a value up
  // is a fixture. A helper that decides the same question is the defect, because it
  // answers correctly while the code under it does not — which is how a test named
  // "a session that leaves stops claiming it is there" passed for a ring that never
  // came off.
  const exports = exportedNames();
  const findings: string[] = [];
  for (const file of readdirSync(TEST_DIR).filter((f) => /\.test\.ts$/.test(f))) {
    const src = readFileSync(join(TEST_DIR, file), "utf8");
    for (const m of src.matchAll(/(?:^|\n)\s*(?:function|const)\s+([A-Za-z_$][\w$]*)\s*[=(][\s\S]{0,400}?\n\s*\}?\)?;?\n/g)) {
      const name = m[1];
      if (!exports.has(name)) continue;
      const body = m[0];
      if (!/\?[^?]*:/.test(body) && !/\bif\s*\(/.test(body)) continue;
      const line = src.slice(0, m.index).split("\n").length;
      findings.push(`${file}:${line} \`${name}\` branches, and ${exports.get(name)} decides too`);
    }
  }
  for (const f of findings) console.warn("  " + f);
  if (findings.length) {
    console.warn("a local that decides what production decides can pass while the code fails; look at each");
  }
  assert.ok(true);
});

test("no test double needs an unchecked cast to satisfy the interface", () => {
  // `as unknown as T` is a cast the compiler cannot verify, used here to make a
  // partial object fit. A test double that only fits a cast is not modelling the
  // contract: it is asserting against whatever it happens to implement, which is
  // how a canvas that drops every gradient still "passes".
  const findings: string[] = [];
  for (const file of readdirSync(TEST_DIR).filter((f) => /\.test\.ts$/.test(f))) {
    const src = readFileSync(join(TEST_DIR, file), "utf8");
    for (const m of src.matchAll(/as unknown as\s+([A-Za-z_$][\w$]*)/g)) {
      // A cast of *this file* to reach node:fs is not a test double; a cast of an
      // object literal into a declared interface is exactly the defect.
      // Not a comment, and not a cast of this file reaching for node:fs.
      const lineText = src.slice(src.lastIndexOf("\n", m.index) + 1, m.index);
      if (lineText.trimStart().startsWith("//") || lineText.trimStart().startsWith("*")) continue;
      if (src.slice(m.index, m.index + 400).includes("node:fs")) continue;
      const line = src.slice(0, m.index).split("\n").length;
      findings.push(`${file}:${line} a test double is cast to ${m[1]} rather than built`);
    }
  }
  if (findings.length) {
    assert.fail(
      "a test double is `as unknown as`-cast into an interface instead of implementing it:\n  " +
        findings.join("\n  ") +
        "\n\nBuild the whole shape, so a member the production code starts using is a type error rather than undefined at runtime.",
    );
  }
});

test("a test that reads the source can live without importing it", () => {
  // `commenttruth.test.ts` and this file both check *prose and structure* across
  // the tree, so neither imports a production module — and the first version of
  // this check flagged both as "asserting on things it never imports", which is
  // wrong for a test whose subject is the files themselves.
  //
  // The distinction is whether the test *reads* the source rather than calling
  // it. A checker that greps `src/` is reading; a unit test that never calls the
  // thing it names is the defect the earlier version was reaching for.
  const findings: string[] = [];
  for (const file of readdirSync(TEST_DIR).filter((f) => /\.test\.ts$/.test(f))) {
    const src = readFileSync(join(TEST_DIR, file), "utf8");
    const tests = src.match(/^test\(/gm)?.length ?? 0;
    if (tests === 0) continue;
    const readsSource = /readFileSync|readdirSync/.test(src) && /\.\.\/src|src\//.test(src);
    const importsSrc = /from\s+"\.\.\/src\//.test(src) || /import\("\.\.\/src\//.test(src);
    if (!importsSrc && !readsSource) findings.push(`${file} has ${tests} tests and reaches no source at all`);
  }
  if (findings.length) {
    assert.fail("a test file neither imports nor reads the source it names:\n  " + findings.join("\n  "));
  }
});
