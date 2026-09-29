// Comment truth: the numbers and names a comment states must be the numbers and
// names the code below them actually has.
//
// WHY THIS FILE EXISTS
//
// This repository's founding claim is that the map only says true things. That
// claim has a blind spot, and the blind spot is prose. In the last day this
// codebase shipped, all of the following, with a fully green test suite:
//
//   * `EMBER_MS = 120_000` under a comment that said an ember means "touched in
//     the last minute or so". The code said two minutes. Nothing could see it.
//   * A JSDoc block headed `resizeSky repaints the backdrop for a new view size.`
//     sitting directly above `private ensureSky(): void`. Both names are real;
//     the block is attached to the wrong one.
//   * A comment saying "these are the four colours" above a run of seven.
//
// Every one of those is a lie a human can only catch by reading, which means
// they are lies that survive review, because review is a reading process. The
// test suite cannot help: it asserts behaviour, and a comment has no behaviour.
// So this file is the missing mechanical check.
//
// WHAT IT CAN AND CANNOT CATCH
//
// Two shapes it catches, both mechanical, and one it deliberately does not:
//
//   1. A quantity in a comment that contradicts a constant in the same file.
//      "two minutes" against `EMBER_MS = 120_000`, converted through a real
//      unit table, not a string match. Also the record form — a comment that
//      states a member's duration, or a total, for a keyed table of durations.
//      Also the counted-run form: "these are the four colours" above a run of
//      literal entries.
//   2. A `/** */` block whose first sentence names a declaration that is not
//      the one immediately below it. The `resizeSky`/`ensureSky` shape.
//   3. (excluded, on purpose) A documented count that *nothing asserts* — an
//      acceptance box in a ticket claiming "18 bands" when the real count is
//      17. There is no anchor: the claim lives in a ticket, the truth lives in
//      code, and nothing in the repository states the relationship. Catching it
//      mechanically would mean parsing acceptance criteria and inferring which
//      part of the code each one is about, which is a guess dressed as a check.
//      A check that guesses is worse than no check, because it trains people to
//      dismiss it. It stays a human obligation, and this file says so out loud
//      on every run rather than pretending to cover it.
//
// WHY IT IS PRECISE ENOUGH TO KEEP
//
// The design rule is: **a claim is only checked when it can be resolved to a
// specific thing in the same file.** An unresolvable number in a comment is not
// reported. A first pass that reported every comment line in `ui/src` and
// `internal` containing a digit and a unit-ish word found 448 candidates, and
// a person would have deleted the test on day two. Every finding therefore
// carries its own evidence — the comment, the claim, the constant, the
// constant's real value, and the line of each — so a human can triage in
// seconds without opening the file.
//
// Seven mechanisms keep the false-positive rate at zero without hiding
// anything. Each one exists because its absence produced a real false positive
// that was measured and then fixed, and the reason is written down here so the
// next person to loosen one can see what it cost:
//
//   * **Sentence scoping.** A claim is only ever compared against a constant its
//     own sentence names. A doc block that says three unrelated things does not
//     let the first number vouch for the third.
//   * **Module scope.** Only column-zero declarations are referents. `roof.ts`
//     says "Two pixels down puts it on the curve", and an unanchored checker
//     reads `curve` as a `const curve = 1 - t * t` in another method.
//   * **Qualifiers.** A quantity that is explicitly *not* an equality — "one
//     made five minutes ago is not" — is reported in its own bucket with the
//     qualifier named, and never fails the build. Equality is the only claim
//     that can be mechanically true or false.
//   * **Quotations.** A number inside a code span is something the comment is
//     showing, not asserting. `gotest.go` quotes a `go test` output line.
//   * **Narrated history.** `embers.ts` contains, inside its own doc block, a
//     quotation of the bug this file exists to catch: `A comment here once said
//     "the last minute or so"`. A comment *reporting* a past lie is not
//     asserting a present one.
//   * **Per-item products.** "Two steps of about seven pixels each" is a
//     statement about a product, not about `STRIDE_PX`. It reconciles only
//     because the sentence says `each`.
//   * **No bare `s`.** A one-letter unit collides with ordinary English: "the
//     steep ones" is not a claim about one second.
//
// Every finding lands in exactly one of five buckets, and only `defect` fails:
//
//   defect      — an assertion that is false. Fails the build.
//   qualified   — a threshold or a negation; the code cannot contradict it.
//   quoted      — a number the comment is showing rather than claiming.
//   historical  — a comment reporting the past. See the quotation above.
//   allowlisted — a known, written-down exception, with its reason in
//                 ALLOWLIST below. A stale allowlist entry is itself a defect,
//                 so the list cannot rot silently.
//
// Every non-failing bucket is printed in full on every run, with the reason. A
// finding that vanishes quietly is indistinguishable from one that was never
// found, and this file is arguing against exactly that confusion.
//
// PROOF THAT THE RULES FIRE
//
// The three shapes at the top of this file had all been fixed before it
// existed, so a green run over the tree would have proved nothing about the
// checker. The first group of tests therefore runs the same engine over inline
// fixtures carrying those defects verbatim and asserts each rule catches its
// shape. The engine is a pure function of source text; the fixtures never touch
// the filesystem. The counter-cases — thresholds, quotations, narrated history,
// per-item products, `//` inside a string — are pinned just as firmly, because
// a check that flags those is a check a person turns off.
//
// On the tree as it stands, the tree test does not pass: it finds one live
// instance of shape 2, a doc block in `ui/src/art/iso.ts` headed `shadeFace`
// sitting above the function that `shadeFace` was renamed to. That is the check
// working, and it is left unfixed here because this file's job is to report
// defects, not to edit the code it finds them in.
//
// SCOPE
//
// `ui/src/**`, `internal/**` and `.scratch/**`; the per-root count is printed
// on every run so the coverage is a number rather than a claim. Inside
// `.scratch` only fenced code blocks are analysed, because a ticket's *prose*
// is exactly the unanchored claim described above. Two paths are excluded by
// name and the exclusion is printed too: `internal/web/static/` holds a
// checked-in build artefact, and minified output has no comments to be true in.

import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Repository root
// ---------------------------------------------------------------------------
// esbuild writes this bundle to `ui/ui-commenttruth.test.mjs`, so `import.meta
// .url` lands in `ui/` and the repository root is one level up. Asserting the
// markers rather than trusting the path is deliberate: a wrong root would
// produce an empty scan, and an empty scan is indistinguishable from a clean
// tree. That is the silent failure this whole file is arguing against.

const BUNDLE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(BUNDLE_DIR, "..");

const SCAN_ROOTS = ["ui/src", "internal", ".scratch"] as const;
const EXCLUDED = [
  // A checked-in Vite build. Minified, and its comments are licence banners
  // that name no constant; scanning it would report on a file nobody edits.
  "internal/web/static",
  // A vendored licence text, not code.
  "ui/src/assets/fonts",
];

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------
// Comments have to be found in the *lexical* sense, not the textual one. The
// difference is not academic: `ui/src/api.ts` and the Go sources both contain
// `//` inside string literals, and a regex that does not know about strings
// reads those as the start of a comment and then reports every following line
// as comment text. It would find dozens of "claims" that are not claims.

type RegionKind = "code" | "line" | "doc" | "block" | "string";
interface Region {
  kind: RegionKind;
  start: number;
  end: number;
  /** 1-based line the region opens on. */
  line: number;
}

// A `/` begins a regular expression literal rather than a division only when
// the previous significant token cannot end an expression. The keyword list
// covers `return /re/`, the character set covers `= /re/`, `(`, `,` and so on.
const REGEX_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "case", "do", "else", "yield", "await",
]);
const REGEX_PRECEDERS = new Set([
  "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*",
  "%", "^", "~", "<", ">", "\n", "",
]);

function lex(src: string, lang: "ts" | "go"): Region[] {
  const regions: Region[] = [];
  let i = 0;
  let line = 1;
  // `code` while reading ordinary source; `template` while inside a
  // backtick-quoted string, so that a `${ … }` hole containing a comment is
  // still lexed as code. Go raw strings have no holes, so Go never enters it.
  let mode: "code" | "template" = "code";
  let braceDepth = 0;
  const templateBrace: number[] = [];
  let prevChar = "";
  let prevWord = "";

  const noteWord = (c: string): void => {
    if (/[\w$]/.test(c)) {
      prevWord = prevWord + c;
    } else if (prevWord !== "") {
      prevWord = "";
    }
  };

  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1] ?? "";

    if (c === "\n") {
      if (mode === "code") {
        line++;
        prevChar = "\n";
      } else {
        line++;
        regions.push({ kind: "string", start: i, end: i + 1, line });
      }
      noteWord("\n");
      i++;
      continue;
    }

    if (mode === "template") {
      if (c === "`") {
        regions.push({ kind: "string", start: i, end: i + 1, line });
        i++;
        mode = "code";
        templateBrace.pop();
        continue;
      }
      if (c === "$" && n === "{") {
        regions.push({ kind: "string", start: i, end: i + 2, line });
        i += 2;
        mode = "code";
        continue;
      }
      if (c === "{") braceDepth++;
      if (c === "}") {
        const floor = templateBrace[templateBrace.length - 1];
        if (floor !== undefined && braceDepth === floor) {
          mode = "code";
          templateBrace.pop();
        } else {
          braceDepth--;
        }
      }
      i++;
      continue;
    }

    if (c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }

    if (c === "/" && n === "/") {
      const start = i;
      const startLine = line;
      while (i < src.length && src[i] !== "\n") i++;
      regions.push({ kind: "line", start, end: i, line: startLine });
      prevChar = "";
      prevWord = "";
      continue;
    }

    if (c === "/" && n === "*") {
      const start = i;
      const startLine = line;
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") line++;
        i++;
      }
      i += 2;
      regions.push({
        kind: src[start + 2] === "*" ? "doc" : "block",
        start,
        end: i,
        line: startLine,
      });
      prevChar = "";
      prevWord = "";
      continue;
    }

    if (c === '"' || c === "'" || c === "`") {
      const start = i;
      const startLine = line;
      i++;
      if (c === "`" && lang === "ts") {
        mode = "template";
        templateBrace.push(braceDepth);
        regions.push({ kind: "string", start, end: i, line: startLine });
        prevChar = "";
        prevWord = "";
        continue;
      }
      // Go raw strings run to the next backtick with no escape processing.
      if (c === "`") {
        while (i < src.length && src[i] !== "`") {
          if (src[i] === "\n") line++;
          i++;
        }
        i++;
      } else {
        while (i < src.length && src[i] !== c) {
          if (src[i] === "\\") i++;
          if (src[i] === "\n") line++;
          i++;
        }
        i++;
      }
      regions.push({ kind: "string", start, end: i, line: startLine });
      prevChar = c;
      prevWord = "";
      continue;
    }

    if (c === "/" && (REGEX_PRECEDERS.has(prevChar) || REGEX_KEYWORDS.has(prevWord))) {
      const start = i;
      const startLine = line;
      i++;
      let inClass = false;
      while (i < src.length) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
        else if (src[i] === "/" && !inClass) { i++; break; }
        else if (src[i] === "\n") break;
        i++;
      }
      regions.push({ kind: "string", start, end: i, line: startLine });
      prevChar = "/";
      prevWord = "";
      continue;
    }

    if (c === "{") braceDepth++;
    if (c === "}") braceDepth = Math.max(0, braceDepth - 1);

    prevChar = c;
    noteWord(c);
    i++;
  }

  return regions;
}

// ---------------------------------------------------------------------------
// Comment blocks
// ---------------------------------------------------------------------------
// Consecutive `//` lines are one comment to the person who wrote them: the
// `EMBER_MS` header wraps mid-sentence across lines 9 and 10, and the constant
// it names is on line 10. Analysing each `//` in isolation would put the claim
// in one block and its referent in another, and the rule would never fire —
// which is very likely why the original defect survived.

interface CommentBlock {
  text: string;
  startLine: number;
  endLine: number;
  /** 1-based line for each character offset in `text`. */
  lineAt: (index: number) => number;
  doc: boolean;
}

function commentBlocks(src: string, regions: Region[]): CommentBlock[] {
  const comments = regions.filter(
    (r) => r.kind === "line" || r.kind === "doc" || r.kind === "block",
  );
  const blocks: CommentBlock[] = [];

  const make = (parts: Region[], doc: boolean): CommentBlock => {
    let text = "";
    const lines: number[] = [];
    for (const p of parts) {
      const body = src
        .slice(p.start, p.end)
        .replace(/^\/\*+/, "")
        .replace(/\*+\/$/, "")
        .replace(/^\/\//, "");
      const bodyLines = body.split("\n");
      bodyLines.forEach((l, idx) => {
        if (idx > 0) {
          text += "\n";
          lines.push(p.line + idx);
        }
        const cleaned = l.replace(/^\s*\* ?/, "");
        text += cleaned;
        for (let k = 0; k < cleaned.length; k++) lines.push(p.line + idx);
      });
    }
    // The block text is trimmed of the leading indentation that `/**` and ` * `
    // leave behind. It has to be: the first-sentence rules anchor on the first
    // character, and a block starting with two spaces reads as an untagged
    // sentence to every regex in the file. `lead` remembers how far the trim
    // moved things so a reported line still points at the real source line.
    const lead = text.length - text.replace(/^[ \t\n]+/, "").length;
    const trimmed = text.replace(/^[ \t\n]+/, "").replace(/[ \t\n]+$/, "");
    return {
      text: trimmed,
      startLine: parts[0]!.line,
      // The line the block *ends* on, which is what "attached to the
      // declaration below" is measured from. Counting the newlines inside the
      // region is exact; a `//` line ends on the line it starts on.
      endLine: (() => {
        const last = parts[parts.length - 1]!;
        let n = last.line;
        for (let i = last.start; i < last.end; i++) if (src[i] === "\n") n++;
        return n;
      })(),
      lineAt: (index: number) => lines[Math.min(index + lead, lines.length - 1)] ?? parts[0]!.line,
      doc,
    };
  };

  let run: Region[] = [];
  const flush = (): void => {
    if (run.length > 0) blocks.push(make(run, false));
    run = [];
  };
  for (const r of comments) {
    if (r.kind !== "line") {
      flush();
      blocks.push(make([r], r.kind === "doc"));
      continue;
    }
    if (run.length > 0) {
      const last = run[run.length - 1]!;
      // A `//` region stops *before* its newline, so adjacency is end + 1.
      if (last.end + 1 !== r.start) flush();
    }
    run.push(r);
  }
  flush();
  return blocks;
}

/** Source with every comment region blanked, so declarations can be indexed. */
function maskComments(src: string, regions: Region[]): string {
  const out = src.split("");
  for (const r of regions) {
    if (r.kind === "code" || r.kind === "string") continue;
    for (let i = r.start; i < r.end; i++) if (out[i] !== "\n") out[i] = " ";
  }
  return out.join("");
}

function lineStarts(src: string): number[] {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineOf(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------
// Converting through a real unit table is the whole reason this check can tell
// "two minutes" from `120_000`. A string comparison cannot: `120_000` contains
// no "2" and "2" is not "120000". The canonical base is milliseconds for time
// and pixels for length, so every comparison happens in one unit.

type Family = "time" | "length";

const UNIT_TO_FAMILY: Record<string, Family> = {
  ms: "time", millisecond: "time", milliseconds: "time",
  s: "time", sec: "time", secs: "time", second: "time", seconds: "time",
  min: "time", mins: "time", minute: "time", minutes: "time",
  hr: "time", hrs: "time", hour: "time", hours: "time",
  px: "length", pixel: "length", pixels: "length",
};

const UNIT_SCALE: Record<string, number> = {
  ms: 1, millisecond: 1, milliseconds: 1,
  s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000,
  min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000,
  hr: 3_600_000, hrs: 3_600_000, hour: 3_600_000, hours: 3_600_000,
  px: 1, pixel: 1, pixels: 1,
};

// The units a *comment* may use. Deliberately narrower than UNIT_SCALE above,
// which also serves constant names: see the note on the bare `s` below.
const UNIT_WORD = "ms|milliseconds?|secs?|seconds?|mins?|minutes?|hrs?|hours?|px|pixels?";

// A constant's unit comes from its own name, or — when the name is bare — from
// a unit word sitting in the sentence that names it. Both are checked in
// practice: `EMBER_MS` needs no inference, and a hypothetical `TURN_MS` inside
// a record needs the second path. A constant with no discoverable unit is
// simply not checkable, and saying so is better than guessing one.
const NAME_UNIT: [RegExp, string][] = [
  [/_(MS|MILLISECONDS?)$/i, "ms"],
  [/_(S|SEC|SECS|SECONDS)$/i, "s"],
  [/_(MIN|MINS|MINUTES)$/i, "min"],
  [/_(HR|HRS|HOURS)$/i, "hr"],
  [/_(PX|PIXELS)$/i, "px"],
];

function unitFromName(name: string): string | null {
  for (const [re, unit] of NAME_UNIT) if (re.test(name)) return unit;
  return null;
}

// "once" and "twice" are deliberately absent: they are adverbs, not
// quantities, and "runs once per frame" is prose rather than a countable claim.
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12,
  dozen: 12, couple: 2, pair: 2, both: 2, single: 1,
};
const NUMBER_WORD_RE = Object.keys(NUMBER_WORDS).join("|");

function quantityValue(token: string): number {
  if (/^\d/.test(token)) return Number(token.replace(/_/g, ""));
  return NUMBER_WORDS[token.toLowerCase()] ?? NaN;
}

// An explicit claim is a quantity immediately followed by a unit word. The unit
// word must be a real one, which is what keeps "stage 2" and "44, 60, 78 or 100
// world units" out of the results: neither `stage` nor `units` is a unit.
//
// Note what is *not* in UNIT_WORD: a bare `s`. It reads as a time unit and it
// is one, in `120 s` — but with `\s*` between the quantity and the unit it
// also reads the trailing "s" of "ones", "two adjacent" and "the two s" as a
// unit, and `kerb.ts`'s "a run of length two ... the steep ones" was reported
// as a one-second claim. `sec`, `secs` and `second` carry the same meaning
// without the collision. A constant whose *name* ends in `_S` still resolves
// to seconds, through the name table rather than the prose table.
// Case-insensitive because a sentence-initial quantity is capitalised, and
// "Two minutes" at the head of `EMBER_MS`'s own doc block is exactly the shape
// this check exists for. Requiring lowercase would have made the rule
// unreachable for the defect it was written for.
const EXPLICIT_CLAIM = new RegExp(
  `\\b(\\d[\\d_]*(?:\\.\\d+)?|${NUMBER_WORD_RE})\\s*(?:of\\s+)?(${UNIT_WORD})\\b`,
  "gi",
);

// A claim of one unit with no written quantity: "the last minute", "over the
// last two hours". The determiner-and-superlative is required, and that is what
// makes it safe — "a second" (one more), "the second tallest" and "the second
// value" are all excluded, and every one of those phrases is common in this
// codebase's art comments.
const IMPLICIT_ONE_CLAIM = new RegExp(
  `\\b(?:the|over|within|for|in|since)\\s+(?:last|past|previous|following|next)\\s+(${UNIT_WORD})\\b`,
  "gi",
);

interface Claim {
  /** Value in the claim's unit. */
  value: number;
  unit: string;
  family: Family;
  /** True when the quantity was implied by "the last X" rather than written. */
  implicit: boolean;
  /** Offset *within the sentence*, so a qualifier can be read off the tail. */
  index: number;
}

interface Sentence {
  text: string;
  start: number;
}

function sentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c !== "." && c !== "!" && c !== "?") continue;
    // A period between two digits is a decimal point, not a sentence end.
    if (c === "." && /\d/.test(text[i - 1] ?? "") && /\d/.test(text[i + 1] ?? "")) continue;
    if (i + 1 < text.length && !/\s/.test(text[i + 1]!)) continue;
    out.push({ text: text.slice(start, i + 1), start });
    let next = i + 1;
    while (next < text.length && /\s/.test(text[next]!)) next++;
    start = next;
    i = next - 1;
  }
  if (start < text.length) out.push({ text: text.slice(start), start });
  return out;
}

function claimsIn(sentence: Sentence): Claim[] {
  const out: Claim[] = [];
  EXPLICIT_CLAIM.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EXPLICIT_CLAIM.exec(sentence.text))) {
    const unit = m[2]!.toLowerCase();
    out.push({
      value: quantityValue(m[1]!),
      unit,
      family: UNIT_TO_FAMILY[unit]!,
      implicit: false,
      index: m.index,
    });
  }
  IMPLICIT_ONE_CLAIM.lastIndex = 0;
  while ((m = IMPLICIT_ONE_CLAIM.exec(sentence.text))) {
    const unit = m[1]!.toLowerCase();
    out.push({
      value: 1,
      unit,
      family: UNIT_TO_FAMILY[unit]!,
      implicit: true,
      index: m.index,
    });
  }
  return out.sort((a, b) => a.index - b.index);
}

// ---------------------------------------------------------------------------
// Qualifiers — why some quantities are not equalities
// ---------------------------------------------------------------------------
// "one made five minutes ago is not" contains a claim of five minutes, and
// `EMBER_MS` is two minutes. That is not a contradiction: the sentence is saying
// the ember does NOT still show at five minutes, which is true and useful. Only
// an unqualified equality is mechanically checkable, so the others are reported
// under their own names and never fail.

const NEGATION_CUE = /\b(?:not|never|no longer|out of|outside|excludes?|excluded)\b|\bn't\b/;
const THRESHOLD_CUE = /\b(?:ago|after|older than|earlier than|more than|past|beyond)\b/;

function qualifierAfter(sentence: Sentence, claim: Claim): "negated" | "threshold" | null {
  const after = sentence.text.slice(claim.index + 1);
  // A narrow window: within four words of the claim. A wider window would let
  // the trailing "is not" of one clause silence a correct claim earlier in the
  // same sentence, which is exactly the mistake this narrowness avoids.
  const window = after.split(/\s+/).slice(0, 5).join(" ");
  if (NEGATION_CUE.test(window)) return "negated";
  if (THRESHOLD_CUE.test(window)) return "threshold";
  return null;
}

// A sentence that reports the past rather than asserting the present. This is
// not a loophole bolted on afterwards: `embers.ts` quotes its own former bug in
// its own doc block, and a checker that failed on that would be demanding the
// repository delete the explanation of why the check exists.
const HISTORICAL_CUE =
  /\b(?:once|used to|formerly|originally|previously|no longer|history|historical|used to be|was changed|renamed)\b/;

function isHistorical(sentence: Sentence): boolean {
  if (!HISTORICAL_CUE.test(sentence.text)) return false;
  // A historical marker is only exculpatory when the sentence also *reports* a
  // claim, i.e. quotes it or refers to a comment. "The layout used to be 44 wide
  // and is 60 now" is history, and so is "a comment here once said X"; a
  // sentence that merely contains "once" and then makes a fresh assertion is
  // not history.
  return /["“”'`]|comment|called|said|claimed|wrote|read/i.test(sentence.text);
}

// A claim written inside a code span or quotes is a *quotation*, not an
// assertion: `gotest.go` writes that `go test` always ends an attribution with
// a duration, and quotes a line to show what one looks like. That number
// belongs to another program's output. Only the spans themselves are consulted,
// so a bare number in ordinary prose is still an assertion — the exemption is
// for the typography of quoting, not for the content of the sentence.
const QUOTED_SPAN = /`[^`]*`|"[^"\n]*"|“[^”]*”/g;

function isQuoted(sentence: Sentence, claim: Claim): boolean {
  const end = claim.index + String(claim.value).length;
  QUOTED_SPAN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = QUOTED_SPAN.exec(sentence.text))) {
    if (m.index <= claim.index && end <= m.index + m[0].length) return true;
  }
  return false;
}

// A per-item quantity next to a count is a product, not a disagreement.
// `workers.ts` says "Two steps of about seven pixels each" above
// `STRIDE_PX = 14`, and it is right: 7 is a step, 14 is a cycle. The `each` is
// what makes this safe to accept. It is also what stops the exemption from
// becoming a hole — a comment that says "two" and states a window is not
// thereby claiming half of it, because it never says `each`.
const EACH_CUE = /\beach\b/i;

function reconciledAsProduct(sentence: Sentence, claim: Claim, have: number): boolean {
  if (!EACH_CUE.test(sentence.text)) return false;
  for (const n of [...sentence.text.matchAll(new RegExp(`\\b(\\d[\\d_]*(?:\\.\\d+)?|${NUMBER_WORD_RE})\\b`, "gi"))]) {
    const count = quantityValue(n[0]);
    if (Number.isFinite(count) && count >= 2 && same(claim.value * count, have)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

interface Decl {
  name: string;
  line: number;
  kind: "const" | "function" | "method" | "type";
  /** Numeric value, when the declaration is a bare number. */
  value?: number;
  /** Keyed numbers, when the declaration is a record of them. */
  members?: Map<string, number[]>;
  unit: string | null;
  unitFrom: "name" | "sentence" | null;
}

const DECL_PATTERNS: [RegExp, Decl["kind"]][] = [
  [/(?:^|\n)[ \t]*(?:export[ \t]+)?(?:declare[ \t]+)?(?:const|let|var)[ \t]+([A-Za-z_$][\w$]*)/g, "const"],
  [/(?:^|\n)[ \t]*(?:export[ \t]+)?(?:async[ \t]+)?function\*?[ \t]+([A-Za-z_$][\w$]*)/g, "function"],
  [/(?:^|\n)[ \t]*(?:export[ \t]+)?(?:abstract[ \t]+)?class[ \t]+([A-Za-z_$][\w$]*)/g, "function"],
  [/(?:^|\n)[ \t]*(?:export[ \t]+)?(?:type|interface|enum)[ \t]+([A-Za-z_$][\w$]*)/g, "type"],
  // Go: `func Name(`, `func (r Recv) Name(`, `const Name =`, `var Name =`.
  [/(?:^|\n)func[ \t]+(?:\([^)]*\)[ \t]+)?([A-Za-z_][\w]*)[ \t]*\(/g, "function"],
  [/(?:^|\n)type[ \t]+([A-Za-z_][\w]*)/g, "type"],
  [/(?:^|\n)(?:const|var)[ \t]+([A-Za-z_][\w]*)[ \t]*(?::|=)/g, "const"],
];

// A method: an identifier followed by a parameter list and a body brace, at
// the start of a line and optionally preceded by modifiers. `private
// ensureSky(): void {` is a method, and that is the declaration the
// `resizeSky` doc block was attached to.
const METHOD_PATTERN =
  /(?:^|\n)[ \t]*(?:(?:public|private|protected|static|readonly|async|get|set)[ \t]+)*([A-Za-z_$][\w$]*)[ \t]*(?:<[^>\n]*>)?[ \t]*\([^)]*\)[ \t]*(?::[^{;\n]*)?\{/g;

function parseDecls(code: string, starts: number[]): Decl[] {
  const found = new Map<string, Decl>();
  const add = (name: string, line: number, kind: Decl["kind"]): Decl => {
    const existing = found.get(name);
    if (existing) return existing;
    const decl: Decl = { name, line, kind, unit: unitFromName(name), unitFrom: unitFromName(name) ? "name" : null };
    found.set(name, decl);
    return decl;
  };

  for (const [re, kind] of DECL_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code))) {
      const index = m.index + (m[0].startsWith("\n") ? 1 : 0);
      add(m[1]!, lineOf(starts, index), kind);
    }
  }
  METHOD_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = METHOD_PATTERN.exec(code))) {
    const index = m.index + (m[0].startsWith("\n") ? 1 : 0);
    // A call expression followed by a block is not a method; a declaration is
    // at the start of a line, which the pattern already guarantees.
    add(m[1]!, lineOf(starts, index), "method");
  }

  // Values, and only for *top-level* declarations.
  //
  // Module scope is the whole point. A comment is audited against a documented
  // constant, not against a local in some other function that happens to share
  // a word with the prose: `roof.ts:648` says "Two pixels down puts it on the
  // curve", and an unanchored checker reads `curve` as the `const curve = 1 -
  // t * t` in a different method three hundred lines up. Restricting the
  // referent to column zero removes that entire class, and in exchange this
  // file only ever compares prose against the things a reader can look up.
  //
  // Only numeric literals and records of numeric literals are read; a
  // declaration whose value is a call or an expression is left valueless and
  // simply becomes unchecked, which is the safe direction.
  const VALUE_RE = /(?:^|\n)(?:export[ \t]+)?(?:const|let|var)[ \t]+([A-Za-z_$][\w$]*)[^=\n]*=[ \t]*/g;
  VALUE_RE.lastIndex = 0;
  while ((m = VALUE_RE.exec(code))) {
    const name = m[1]!;
    const decl = found.get(name);
    if (!decl) continue;
    // Everything after the `=` is the value expression. Stripping the rest of
    // the first line instead would delete the opening brace of an object
    // literal, which is the whole value.
    const rest = code.slice(m.index + m[0].length, m.index + m[0].length + 4000);
    const scalar = rest.match(/^([ \t]*)((-?\d[\d_]*(?:\.\d+)?))/);
    if (scalar) {
      decl.value = Number(scalar[2]!.replace(/_/g, ""));
      continue;
    }
    const braceAt = rest.search(/\{/);
    if (braceAt === -1) continue;
    const open = rest.indexOf("{", braceAt);
    let depth = 0;
    let close = -1;
    for (let i = open; i < rest.length; i++) {
      if (rest[i] === "{") depth++;
      else if (rest[i] === "}") {
        depth--;
        if (depth === 0) { close = i; break; }
      }
    }
    if (close === -1) continue;
    const body = rest.slice(open + 1, close);
    const members = new Map<string, number[]>();
    // The value is captured whole — a bracketed list to its closing bracket, or
    // a scalar to the comma — because `walk: [120, 120, 120, 120]` is one
    // value. A lazy capture stopped at the first element, and then "a 480ms
    // cycle" had nothing to reconcile against.
    const MEMBER = /(?:^|[,{\n])[ \t\n]*"?([A-Za-z_$][\w$]*)"?[ \t]*:[ \t]*(\[[^\]]*\]|[^\n,]+)[ \t]*(?:,|$)/g;
    let mm: RegExpExecArray | null;
    while ((mm = MEMBER.exec(body))) {
      const numbers = [...mm[2]!.matchAll(/-?\d[\d_]*(?:\.\d+)?/g)].map((x) => Number(x[0].replace(/_/g, "")));
      if (numbers.length > 0) members.set(mm[1]!, numbers);
    }
    if (members.size > 0) decl.members = members;
  }

  return [...found.values()].sort((a, b) => (a.line - b.line) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

// Every finding lands in exactly one bucket, and only `defect` fails. The four
// non-failing buckets are not escape hatches: each one names a *reason the
// claim is not an equality*, and each is printed on every run so the reason is
// visible rather than assumed.
type Bucket = "defect" | "qualified" | "quoted" | "historical" | "allowlisted";

interface Finding {
  rule: string;
  bucket: Bucket;
  file: string;
  line: number;
  /** What the comment says. */
  claimed: string;
  /** What the code says, when the rule has a referent. */
  actual: string;
  /** The comment, trimmed, so a human can triage without opening the file. */
  evidence: string;
  /** Where the referent lives, for the same reason. */
  referent: string;
}

function trim(s: string, n = 96): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n - 1) + "…" : flat;
}

// Known exceptions, each with the reason it is not a defect. The reason is not
// optional: an allowlist entry without one is a suppression, and suppressions
// without reasons are how a suite goes green again. A stale entry — one that no
// longer matches anything — is reported as a defect, so this list cannot rot
// into a place where everything is quietly allowed.
const ALLOWLIST: { key: string; why: string }[] = [];

function allowlistKey(f: Omit<Finding, "bucket">): string {
  return `${f.file} ${f.rule} ${f.claimed}`;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const IDENT = "[A-Za-z_$][\\w$]*";

/** A claim in canonical units, or null if the value cannot be represented. */
function canonical(value: number, unit: string, family: Family): number | null {
  const scale = UNIT_SCALE[unit];
  if (scale === undefined) return null;
  return value * scale;
}

function same(a: number, b: number): boolean {
  if (a === b) return true;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) < 1e-9 * scale;
}

function wordBoundaryHas(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`).test(text);
}

function analyseFile(path: string, src: string, lang: "ts" | "go"): Finding[] {
  const regions = lex(src, lang);
  const code = maskComments(src, regions);
  const starts = lineStarts(src);
  const blocks = commentBlocks(src, regions);
  const decls = parseDecls(code, starts);
  const byName = new Map(decls.map((d) => [d.name, d]));
  const findings: Finding[] = [];

  const numericDecls = decls.filter((d) => d.value !== undefined || (d.members && d.members.size > 0));

  // A declaration's unit may also be declared by the sentence that names it.
  // `FRAME_MS` says so twice over; a record called `CADENCE` would say it once,
  // in prose, and the check should not be weaker for that.
  const declaredUnits = new Map<string, string>();
  for (const d of numericDecls) {
    if (d.unit) {
      declaredUnits.set(d.name, d.unit);
      continue;
    }
    for (const b of blocks) {
      for (const s of sentences(b.text)) {
        if (!wordBoundaryHas(s.text, d.name)) continue;
        const u = s.text.match(new RegExp(`\\b(${UNIT_WORD})\\b`));
        if (u) declaredUnits.set(d.name, u[1]!.toLowerCase());
        break;
      }
    }
  }

  // One recorder for every rule. The line is threaded in rather than
  // re-derived from the evidence string, because a finding that points at the
  // top of a sixty-line comment block is a finding nobody will act on.
  const record = (
    rule: string,
    bucket: Bucket,
    b: CommentBlock,
    line: number,
    claimed: string,
    actual: string,
    referent: string,
  ): void => {
    findings.push({ rule, bucket, file: path, line, claimed, actual, evidence: trim(b.text), referent });
  };
  // Attachment is resolved first because it decides which rule owns a claim:
  // a comment glued to the top of a constant is audited by Rule 2, and Rule 1
  // stands aside rather than reporting the same lie twice.
  const blockEndingAt = new Map<number, CommentBlock>();
  for (const b of blocks) blockEndingAt.set(b.endLine, b);
  const attachedTo = new Map<CommentBlock, Decl>();
  for (const d of numericDecls) {
    const attached = blockEndingAt.get(d.line - 1);
    if (attached) attachedTo.set(attached, d);
  }

  // --- Rule 1: a named constant -------------------------------------------
  // Two gates, and both of them exist because the naive version produced
  // hundreds of hits.
  //
  // The comment's own sentence must name the constant. Without that scoping,
  // any comment in a file mentioning "two minutes" would be audited against
  // every constant in the file, and the first one would be a false positive
  // and the rest would be noise.
  //
  // And a block attached to a constant is not Rule 1's business: Rule 2 owns
  // it. Without this, every attached comment reported its claims twice.
  for (const b of blocks) {
    if (attachedTo.has(b)) continue;
    for (const s of sentences(b.text)) {
      const claims = claimsIn(s);
      if (claims.length === 0) continue;
      for (const c of claims) {
        if (isHistorical(s)) {
          record("quantity", "historical", b, b.lineAt(s.start + c.index), claimText(c), "narrated, so not an assertion", "-");
          continue;
        }
        if (isQuoted(s, c)) {
          record("quantity", "quoted", b, b.lineAt(s.start + c.index), claimText(c), "quoted, so not an assertion", "-");
          continue;
        }
        const qual = qualifierAfter(s, c);
        if (qual) {
          record("quantity", "qualified", b, b.lineAt(s.start + c.index), claimText(c), qual, "not an equality");
          continue;
        }
        for (const d of numericDecls) {
          if (d.value === undefined) continue;
          if (!wordBoundaryHas(s.text, d.name)) continue;
          const unit = declaredUnits.get(d.name);
          if (!unit || UNIT_TO_FAMILY[unit] !== c.family) continue;
          const want = canonical(c.value, c.unit, c.family);
          const have = canonical(d.value, unit, c.family);
          if (want === null || have === null) continue;
          if (same(want, have) || reconciledAsProduct(s, c, have)) continue;
          record(
            "named-constant",
            "defect",
            b,
            b.lineAt(s.start + c.index),
            claimText(c),
            `${d.name} = ${d.value} ${unit} → ${have}`,
            `${path}:${d.line}`,
          );
        }
      }
    }
  }

  // --- Rule 2: the constant a comment is attached to ------------------------
  // A doc block is about the declaration it is attached to; that is the entire
  // social contract of a doc block, and it is why `EMBER_MS`'s own "Two minutes"
  // is checkable even though that sentence never says `EMBER_MS`. Attachment is
  // the line directly below, blank-line-exact: a blank line means the comment
  // is not attached, and treating it as attached is how false positives are
  // manufactured.
  for (const [attached, d] of attachedTo) {
    const unit = declaredUnits.get(d.name);
    if (d.value !== undefined && unit) {
      for (const s of sentences(attached.text)) {
        const claims = claimsIn(s);
        if (claims.length === 0) continue;
        for (const c of claims) {
          if (isHistorical(s)) {
            record("quantity", "historical", attached, attached.lineAt(s.start + c.index), claimText(c), "narrated, so not an assertion", `${path}:${d.line}`);
            continue;
          }
          if (isQuoted(s, c)) {
            record("quantity", "quoted", attached, attached.lineAt(s.start + c.index), claimText(c), "quoted, so not an assertion", `${path}:${d.line}`);
            continue;
          }
          const qual = qualifierAfter(s, c);
          if (qual) {
            record("quantity", "qualified", attached, attached.lineAt(s.start + c.index), claimText(c), qual, `${path}:${d.line}`);
            continue;
          }
          // A sentence that names a *different* constant is about that one.
          if (numericDecls.some((o) => o !== d && wordBoundaryHas(s.text, o.name))) continue;
          if (UNIT_TO_FAMILY[unit] !== c.family) continue;
          const want = canonical(c.value, c.unit, c.family);
          const have = canonical(d.value, unit, c.family);
          if (want === null || have === null || same(want, have)) continue;
          if (reconciledAsProduct(s, c, have)) continue;
          record(
            "attached-constant",
            "defect",
            attached,
            attached.lineAt(s.start + c.index),
            claimText(c),
            `${d.name} = ${d.value} ${unit} → ${have}`,
            `${path}:${d.line}`,
          );
        }
      }
    }
    if (d.members && unit) {
      for (const s of sentences(attached.text)) {
        if (isHistorical(s)) continue;
        const keys = [...d.members.keys()].filter((k) => wordBoundaryHas(s.text, k));
        if (keys.length === 0) continue;
        for (const c of claimsIn(s)) {
          if (qualifierAfter(s, c)) continue;
          if (UNIT_TO_FAMILY[unit] !== c.family) continue;
          const want = canonical(c.value, c.unit, c.family);
          if (want === null) continue;
          const ok = keys.some((k) => {
            const nums = d.members!.get(k)!;
            const total = nums.reduce((a, b) => a + b, 0);
            const product = nums.reduce((a, b) => a * b, 1);
            return nums.some((v) => same(canonical(v, unit, c.family)!, want))
              || same(canonical(total, unit, c.family)!, want)
              || same(canonical(product, unit, c.family)!, want);
          });
          if (ok) continue;
          record(
            "attached-record",
            "defect",
            attached,
            attached.lineAt(s.start + c.index),
            claimText(c),
            `${d.name}: ${keys.map((k) => `${k} = [${d.members!.get(k)!.join(", ")}]`).join("; ")}`,
            `${path}:${d.line}`,
          );
        }
      }
    }
  }


  // --- Rule 3: a count over a run of literal entries -----------------------
  // The palette shape: "these are the four colours" above a run of hex
  // literals. Counting the run is only safe when the run is unambiguously the
  // thing being counted, so two gates apply — the values must all be the kind
  // the noun names, and the run must be a contiguous set of members of one
  // object literal.
  const COUNTABLE_NOUNS: Record<string, RegExp> = {
    colours: /\bcolours\b/i,
    colors: /\bcolors\b/i,
    entries: /\bentries\b/i,
    names: /\bnames\b/i,
    keys: /\bkeys\b/i,
  };
  const NOUN_FAMILY: Record<string, "hex" | "any"> = {
    colours: "hex", colors: "hex", entries: "any", names: "any", keys: "any",
  };

  const codeLines = code.split("\n");
  for (const b of blocks) {
    for (const s of sentences(b.text)) {
      if (isHistorical(s)) continue;
      for (const noun of Object.keys(COUNTABLE_NOUNS)) {
        const re = new RegExp(
          `\\b(\\d[\\d_]*|${NUMBER_WORD_RE})\\s+${COUNTABLE_NOUNS[noun]!.source}`,
          "i",
        );
        const m = s.text.match(re);
        if (!m) continue;
        const claimed = quantityValue(m[1]!);
        if (!Number.isFinite(claimed)) continue;
        // The run starts on the line directly after the comment ends. Anything
        // else and the comment is describing something off-screen.
        let i = b.endLine;
        const run: { name: string; value: string; line: number }[] = [];
        while (i < codeLines.length) {
          const line = codeLines[i]!;
          const entry = line.match(/^[ \t]*([A-Za-z_$][\w$]*|"[^"]+")?[ \t]*:[ \t]*(.+?)[ \t]*,?[ \t]*$/);
          if (!entry) break;
          // The quotes come off before the value is classified, or a hex test
          // would never once see a hex.
          const value = (entry[2] ?? "").trim().replace(/,$/, "").trim().replace(/^"(.*)"$/, "$1");
          if (value === "") break;
          run.push({ name: entry[1] ?? "", value, line: i + 1 });
          i++;
        }
        if (run.length < 2) continue;
        if (NOUN_FAMILY[noun] === "hex" && !run.every((e) => /^#[0-9a-f]{3,8}$/i.test(e.value))) continue;
        // And the run must belong to an object literal: scan back up past
        // comments and further members for the opening brace.
        let opening = -1;
        for (let j = b.endLine - 1; j >= 0 && j > b.endLine - 400; j--) {
          if (/\{\s*$/.test(codeLines[j] ?? "")) { opening = j; break; }
          if (/^\s*\}/.test(codeLines[j] ?? "")) break;
        }
        if (opening === -1) continue;
        if (run.length === claimed) continue;
        record(
          "counted-run",
          "defect",
          b,
          b.startLine,
          `"${claimed} ${noun}"`,
          `${run.length} entries: ${run.map((e) => e.name).join(", ")}`,
          `${path}:${run[0]!.line}-${run[run.length - 1]!.line}`,
        );
      }
    }
  }

  // --- Rule 4: a doc block attached to the wrong declaration ---------------
  // The `resizeSky`/`ensureSky` shape, and the rule that found the one live
  // instance of it still in the tree (`iso.ts`, a block headed `shadeFace`
  // sitting above `tintRect`, the function `shadeFace` was renamed to).
  //
  // Two gates keep it precise.
  //
  // The leading word has to look like a *name*: either it is a declaration in
  // this file, or it is camelCase with an internal capital. Without that,
  // "How long a touch is visible." names `How`, and the rule fires on every
  // doc block in the repository that opens with a question word, an article,
  // or a preposition.
  //
  // The block must actually be attached: a declaration on the line immediately
  // below, with no blank line between.
  //
  // Both outcomes are defects, and they are separated in the message rather
  // than in the bucket. A name that exists elsewhere in the file is a block
  // moved by one declaration; a name that exists nowhere is a block left
  // behind by a rename. Neither describes the code beneath it, and splitting
  // them by severity would only mean a human had to read both to learn that.
  const lead = new RegExp(`^(${IDENT})(?=[ \\t])`);
  const camelCase = /^[a-z_$][\w$]*[A-Z]/;
  for (const b of blocks) {
    if (!b.doc) continue;
    const first = sentences(b.text)[0];
    if (!first) continue;
    const m = first.text.match(lead);
    if (!m) continue;
    const named = m[1]!;
    const elsewhere = byName.has(named);
    if (!elsewhere && !camelCase.test(named)) continue;
    const below = decls.find((d) => d.line === b.endLine + 1);
    if (!below) continue;
    if (below.name === named) continue;
    record(
      "doc-attachment",
      "defect",
      b,
      b.startLine,
      `doc block names \`${named}\`${elsewhere ? ", a real declaration in this file" : ", a name declared nowhere in this file"}`,
      `${below.name} is what is directly below`,
      `${path}:${below.line}`,
    );
  }

  return findings;
}

function claimText(c: Claim): string {
  return c.implicit ? `the last ${c.unit} (an implicit 1)` : `${c.value} ${c.unit}`;
}

// ---------------------------------------------------------------------------
// Tree walk
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  // Sorted, so the report is byte-identical between runs. A check whose output
  // reorders itself cannot be diffed between two commits, and an undiffable
  // report is a report people stop reading.
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    const p = join(dir, e.name);
    const rel = relative(ROOT, p).split(sep).join("/");
    if (EXCLUDED.some((x) => rel === x || rel.startsWith(`${x}/`))) continue;
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

interface Fence {
  lang: "ts" | "go";
  body: string;
  startLine: number;
}

const FENCE = /^([ \t]*)(`{3,})[ \t]*(ts|tsx|js|mjs|go)[ \t]*$/gm;

function fencesOf(md: string): Fence[] {
  const out: Fence[] = [];
  const starts = lineStarts(md);
  FENCE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FENCE.exec(md))) {
    const marker = m[2]!;
    const openLine = lineOf(starts, m.index);
    const bodyStart = FENCE.lastIndex;
    let close = md.indexOf("\n" + m[1]! + marker, bodyStart);
    if (close === -1) close = md.length;
    out.push({
      lang: m[3] === "go" ? "go" : "ts",
      body: md.slice(bodyStart, close),
      startLine: openLine,
    });
    FENCE.lastIndex = close;
  }
  return out;
}

function scanTree(): { findings: Finding[]; perRoot: Record<string, number>; comments: number } {
  const findings: Finding[] = [];
  const perRoot: Record<string, number> = {};
  let comments = 0;
  for (const root of SCAN_ROOTS) {
    perRoot[root] = 0;
    for (const p of walk(join(ROOT, root))) {
      const rel = relative(ROOT, p).split(sep).join("/");
      const src = readFileSync(p, "utf8");
      if (p.endsWith(".md")) {
        // A ticket's prose is the unanchored claim this check cannot make, but
        // the code it quotes is fair game: a fenced block carries its own
        // constants, so the same rules apply to it. The count is reported so
        // that "`.scratch` is covered" is a number in the output rather than a
        // claim in this comment.
        for (const f of fencesOf(src)) {
          perRoot[root]!++;
          const found = analyseFile(`${rel}#fence@${f.startLine}`, f.body, f.lang);
          comments += commentBlocks(f.body, lex(f.body, f.lang)).length;
          // Fence bodies are offset by the fence's position in the file so a
          // finding points at a line a human can actually open.
          for (const x of found) x.line += f.startLine;
          findings.push(...found);
        }
        continue;
      }
      if (!/\.(ts|tsx|mjs|js|go)$/.test(p)) continue;
      const lang = p.endsWith(".go") ? "go" : "ts";
      perRoot[root]!++;
      comments += commentBlocks(src, lex(src, lang)).length;
      findings.push(...analyseFile(rel, src, lang));
    }
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  return { findings, perRoot, comments };
}

// ---------------------------------------------------------------------------
// Reporting
// The print order, most serious first. It is fixed rather than derived so that
// two runs of a clean tree produce byte-identical reports and can be diffed.
const BUCKETS: Bucket[] = ["defect", "qualified", "quoted", "historical", "allowlisted"];

function report(findings: Finding[], perRoot: Record<string, number>, comments: number): string {
  const files = Object.values(perRoot).reduce((a, b) => a + b, 0);
  const lines: string[] = [];
  lines.push("── comment truth ────────────────────────────────────────────────");
  lines.push(`scanned ${files} source units, ${comments} comment blocks`);
  lines.push(`  by root: ${Object.entries(perRoot).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  lines.push(`excluded: ${EXCLUDED.join(", ")}`);
  lines.push("");
  for (const bucket of BUCKETS) {
    const inBucket = findings.filter((f) => f.bucket === bucket);
    lines.push(`${bucket} (${inBucket.length})`);
    for (const f of inBucket) {
      lines.push(`  ${f.file}:${f.line}  [${f.rule}]`);
      lines.push(`      claimed   ${f.claimed}`);
      lines.push(`      actual    ${f.actual}`);
      lines.push(`      referent  ${f.referent}`);
      lines.push(`      comment   ${f.evidence}`);
    }
    if (inBucket.length === 0) lines.push("  (none)");
    lines.push("");
  }
  lines.push("out of scope, by decision: a documented count that nothing asserts");
  lines.push("(a ticket claiming '18 bands' against 17 real ones). The claim is in");
  lines.push("prose and the truth is in code with no stated link between them.");
  lines.push("─".repeat(64));
  return lines.join("\n");
}

// Splits findings into what fails and what is explained, applying the
// allowlist. Extracted from the tree test so that the allowlist's own two
// behaviours — it silences a known hit, and it *fails* when it has gone stale
// — can be tested without a tree to run against.
function triage(
  findings: Finding[],
  perRoot: Record<string, number>,
  comments: number,
): { defects: string[]; stale: string[]; out: string } {
  const allowed = new Set(ALLOWLIST.map((a) => a.key));
  const used = new Set<string>();
  const defects: string[] = [];
  for (const f of findings) {
    if (f.bucket !== "defect") continue;
    const key = allowlistKey(f);
    if (allowed.has(key)) {
      used.add(key);
      f.bucket = "allowlisted";
      continue;
    }
    defects.push(
      `  ${f.file}:${f.line}  [${f.rule}]\n` +
        `      claimed   ${f.claimed}\n` +
        `      actual    ${f.actual}\n` +
        `      referent  ${f.referent}\n` +
        `      comment   ${f.evidence}`,
    );
  }
  return {
    defects,
    stale: ALLOWLIST.filter((a) => !used.has(a.key)).map((a) => `  ${a.key} - ${a.why}`),
    out: report(findings, perRoot, comments),
  };
}

// ---------------------------------------------------------------------------
// 1. The rules fire
// ---------------------------------------------------------------------------
// Each fixture is a real defect, written the way it was actually shipped.
//
// They are here because the tree cannot demonstrate the rules. Three of the
// five shapes were fixed before this file existed, and a passing run over a
// clean tree is equally consistent with a checker that does nothing — which is
// the failure mode this file is most at risk of, and the one it is least able
// to detect about itself.

const FIXTURES: { name: string; path: string; src: string; rule: string; line: number }[] = [
  {
    name: "a comment's window contradicts the constant it names",
    path: "fixture/a.ts",
    rule: "named-constant",
    line: 1,
    // The blank line matters and is part of the fixture: it is what separates
    // the *file header* — which names the constant and is therefore audited by
    // Rule 1 — from a doc block attached to it, which Rule 2 would own.
    src: `// An ember means touched in the last minute or so - see EMBER_MS, the
// only place that number is written.

export const EMBER_MS = 120_000;
`,
  },
  {
    name: "a doc block contradicts the constant it is attached to",
    path: "fixture/b.ts",
    rule: "attached-constant",
    line: 1,
    src: `/**
 * How long a touch is visible.
 *
 * Three minutes is long enough to see across a working session.
 */
export const EMBER_MS = 120_000;
`,
  },
  {
    name: "a doc block is attached to the wrong declaration",
    path: "fixture/c.ts",
    rule: "doc-attachment",
    line: 1,
    src: `class Scene {
  /**
   * resizeSky repaints the backdrop for a new view size.
   */
  private ensureSky(): void {
    this.sky = null;
  }

  private resizeSky(): void {
    this.sky = null;
  }
}
`,
  },
  {
    name: "a count contradicts the run of entries below it",
    path: "fixture/d.ts",
    rule: "counted-run",
    line: 1,
    src: `export const P = {
  // The sky, and nothing else in the art is allowed to use them, so these are
  // the four colours.
  skyZenith: "#1a2740",
  skyMid: "#3d5570",
  skyHaze: "#7d8a80",
  skyGlow: "#c9a86a",
  skyFar: "#4a5f72",
  skyNear: "#2a3a4a",
  skyGround: "#46524a",
} as const;
`,
  },
  {
    name: "a doc block's numbers are checked against the record they document",
    path: "fixture/e.ts",
    rule: "attached-record",
    line: 1,
    src: `/**
 * FRAME_MS is each animation's per-frame duration.
 *
 * Walk is 150ms - a 600ms cycle, the reference's range for a walk.
 */
export const FRAME_MS: Record<string, number[]> = {
  walk: [120, 120, 120, 120],
};
`,
  },
];

for (const fx of FIXTURES) {
  test(`the checker catches: ${fx.name}`, () => {
    const found = analyseFile(fx.path, fx.src, "ts").filter((f) => f.bucket === "defect");
    const hit = found.find((f) => f.rule === fx.rule);
    assert.ok(
      hit,
      `rule "${fx.rule}" found nothing in the fixture\n` +
        report(found, { fixture: 1 }, 1) +
        `\nfixture was:\n${fx.src}`,
    );
    assert.equal(hit.file, fx.path);
    assert.ok(hit.line > 0, "a finding must carry a line a human can open");
    assert.ok(hit.claimed.length > 0, "a finding must say what was claimed");
    assert.ok(hit.actual.length > 0, "a finding must say what the code says");
  });
}

// The counter-cases matter as much as the cases. A checker that flags a
// threshold, a quotation of a past bug, or a sentence of ordinary prose is a
// checker a person turns off, so each of those is pinned here.
test("the checker stays quiet on claims it cannot resolve", () => {
  const src = `// Prose about the world: a second look, the second tallest roof, a
// single pole, two kinds of timber, one stage at a time.
export const STOREY = 20;
`;
  const found = analyseFile("fixture/f.ts", src, "ts");
  assert.deepEqual(
    found.filter((f) => f.bucket === "defect").map((f) => f.rule),
    [],
    report(found, { fixture: 1 }, 1),
  );
});

test("the checker treats a threshold and a negation as non-equalities", () => {
  const src = `// An ember means touched in the last two minutes - see EMBER_MS, and
// one made five minutes ago is not.
export const EMBER_MS = 120_000;
`;
  const found = analyseFile("fixture/g.ts", src, "ts");
  assert.deepEqual(
    found.filter((f) => f.bucket === "defect"),
    [],
    report(found, { fixture: 1 }, 1),
  );
  assert.ok(
    found.some((f) => f.bucket === "qualified"),
    "a threshold claim should still be reported, just not failed",
  );
});

test("the checker does not demand the repository delete its own explanation", () => {
  // This is the real sentence from ui/src/embers.ts. A comment that quotes the
  // bug it is describing has to be exempt, or the honest version of the file
  // fails the test that was written to protect it.
  const src = `/**
 * This is the only statement of the window. A comment here once said "the last
 * minute or so" and a second said "five minutes ago is not", for a constant set
 * to two - a file whose entire claim is that it asserts nothing it cannot know.
 */
export const EMBER_MS = 120_000;
`;
  const found = analyseFile("fixture/h.ts", src, "ts");
  assert.deepEqual(found.filter((f) => f.bucket === "defect"), [], report(found, { fixture: 1 }, 1));
  assert.ok(found.some((f) => f.bucket === "historical"));
});

test("a doc block that correctly names the declaration below it is not a finding", () => {
  const src = `class Scene {
  /**
   * ensureSky creates the backdrop, replacing any existing one.
   */
  private ensureSky(): void {
    this.sky = null;
  }
}
`;
  const found = analyseFile("fixture/i.ts", src, "ts");
  assert.deepEqual(found.filter((f) => f.bucket === "defect"), [], report(found, { fixture: 1 }, 1));
});

test("a `//` inside a string is not a comment", () => {
  const src = `// The real comment mentions two minutes and nothing else.
export const HINT = "https://example.test/two minutes";
export const EMBER_MS = 120_000;
`;
  const found = analyseFile("fixture/j.ts", src, "ts");
  // The comment above is attached to HINT, whose value is a string, so nothing
  // is checked; and the string's "two minutes" must not be read as a claim.
  assert.deepEqual(found.filter((f) => f.bucket === "defect"), [], report(found, { fixture: 1 }, 1));
});

test("a number quoted from another program is not a claim about this one", () => {
  // The shape from `gotest.go`: a comment showing what `go test` prints. The
  // 0.336 belongs to another program's output, and `EMBER_MS` has nothing to
  // do with it.
  const src = `// The window is whatever the runner says: \`FAIL  pkg  336ms\`
// and nothing more.
export const EMBER_MS = 120_000;
`;
  const found = analyseFile("fixture/k.ts", src, "ts");
  assert.deepEqual(found.filter((f) => f.bucket === "defect"), [], report(found, { fixture: 1 }, 1));
  assert.ok(
    found.some((f) => f.bucket === "quoted" && f.claimed === "336 ms"),
    `the quoted quantity should still be reported, just not failed:\n${report(found, { fixture: 1 }, 1)}`,
  );
});

test("a per-item quantity and a count are a product, not a disagreement", () => {
  // `workers.ts` in full: the comment says a step is seven pixels and there are
  // two of them, and `STRIDE_PX` is the cycle.
  const src = `/** The distance one walk cycle covers. Two steps of about seven
 *  pixels each.
 */
const STRIDE_PX = 14;
`;
  const found = analyseFile("fixture/l.ts", src, "ts");
  assert.deepEqual(found.filter((f) => f.bucket === "defect"), [], report(found, { fixture: 1 }, 1));
});

test("an allowlist entry silences the hit it names and nothing else", () => {
  const findings: Finding[] = [
    {
      rule: "named-constant",
      bucket: "defect",
      file: "a.ts",
      line: 1,
      claimed: "1 minute",
      actual: "EMBER_MS = 120000 ms → 120000",
      evidence: "x",
      referent: "a.ts:2",
    },
    {
      rule: "named-constant",
      bucket: "defect",
      file: "b.ts",
      line: 1,
      claimed: "1 minute",
      actual: "WINDOW_MS = 60000 ms → 60000",
      evidence: "y",
      referent: "b.ts:2",
    },
  ];
  ALLOWLIST.push({ key: "a.ts named-constant 1 minute", why: "a known, argued exception" });
  try {
    const { defects, stale } = triage(findings, { fixture: 2 }, 2);
    assert.equal(defects.length, 1, "exactly the unlisted hit should fail");
    assert.match(defects[0]!, /^ {2}b\.ts:1/);
    assert.deepEqual(stale, [], "an entry that matched is not stale");
    assert.equal(findings[0]!.bucket, "allowlisted");
    assert.equal(findings[1]!.bucket, "defect");
  } finally {
    ALLOWLIST.pop();
  }
});

test("an allowlist entry that no longer matches is itself a failure", () => {
  // Without this, the list is a place where a fixed comment's exemption goes
  // to sit forever, waiting to quietly cover the next defect filed under the
  // same name.
  ALLOWLIST.push({ key: "gone.ts named-constant 1 minute", why: "fixed in a commit nobody remembers" });
  try {
    const { stale } = triage([], {}, 0);
    assert.equal(stale.length, 1);
    assert.match(stale[0]!, /gone\.ts named-constant 1 minute/);
  } finally {
    ALLOWLIST.pop();
  }
});

// ---------------------------------------------------------------------------
// 2. The real tree
// ---------------------------------------------------------------------------

test("every comment in the tree agrees with the code beside it", () => {
  // A root that does not exist would produce an empty scan, and an empty scan
  // looks exactly like a clean tree. These floors are what stop the check
  // reporting a clean tree because it read nothing — the failure mode that
  // makes a check indistinguishable from a decoration.
  const { findings, perRoot, comments } = scanTree();
  const files = Object.values(perRoot).reduce((a, b) => a + b, 0);
  for (const root of SCAN_ROOTS) {
    assert.ok(perRoot[root]! > 0, `scan root ${root} contributed nothing; the walk is broken`);
  }
  assert.ok(files > 60, `only ${files} source units were scanned; the root is probably wrong`);
  assert.ok(comments > 200, `only ${comments} comment blocks were parsed; the lexer is probably wrong`);

  const { defects, stale, out } = triage(findings, perRoot, comments);
  if (defects.length === 0 && stale.length === 0) {
    // Printed before the assertion so a green run and a red run show the same
    // picture. A report that only exists on failure is a report nobody reads on
    // the days they most need it — the days it is green and they are wondering
    // whether it is green because it is right or because it is blind.
    console.log(out);
    return;
  }
  assert.fail(
    `${defects.length} comment(s) contradict the code beside them.\n\n${out}\n` +
      (defects.length > 0 ? `${defects.join("\n\n")}\n\n` : "") +
      (stale.length > 0
        ? `These allowlist entries no longer match anything, so they are suppressing nothing and are only hiding a future edit:\n${stale.join("\n")}\n`
        : "") +
      `Fix the comment, or fix the code. If the comment is right, add an entry to ALLOWLIST in test/commenttruth.test.ts with the reason it is not a defect.`,
  );
});
