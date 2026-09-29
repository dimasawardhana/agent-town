// test/commenttruth.test.ts
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
var BUNDLE_DIR = dirname(fileURLToPath(import.meta.url));
var ROOT = resolve(BUNDLE_DIR, "..");
var SCAN_ROOTS = ["ui/src", "internal", ".scratch"];
var EXCLUDED = [
  // A checked-in Vite build. Minified, and its comments are licence banners
  // that name no constant; scanning it would report on a file nobody edits.
  "internal/web/static",
  // A vendored licence text, not code.
  "ui/src/assets/fonts"
];
var REGEX_KEYWORDS = /* @__PURE__ */ new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "case",
  "do",
  "else",
  "yield",
  "await"
]);
var REGEX_PRECEDERS = /* @__PURE__ */ new Set([
  "(",
  ",",
  "=",
  ":",
  "[",
  "!",
  "&",
  "|",
  "?",
  "{",
  "}",
  ";",
  "+",
  "-",
  "*",
  "%",
  "^",
  "~",
  "<",
  ">",
  "\n",
  ""
]);
function lex(src, lang) {
  const regions = [];
  let i = 0;
  let line = 1;
  let mode = "code";
  let braceDepth = 0;
  const templateBrace = [];
  let prevChar = "";
  let prevWord = "";
  const noteWord = (c) => {
    if (/[\w$]/.test(c)) {
      prevWord = prevWord + c;
    } else if (prevWord !== "") {
      prevWord = "";
    }
  };
  while (i < src.length) {
    const c = src[i];
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
        if (floor !== void 0 && braceDepth === floor) {
          mode = "code";
          templateBrace.pop();
        } else {
          braceDepth--;
        }
      }
      i++;
      continue;
    }
    if (c === " " || c === "	" || c === "\r") {
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
        line: startLine
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
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === "[") inClass = true;
        else if (src[i] === "]") inClass = false;
        else if (src[i] === "/" && !inClass) {
          i++;
          break;
        } else if (src[i] === "\n") break;
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
function commentBlocks(src, regions) {
  const comments = regions.filter(
    (r) => r.kind === "line" || r.kind === "doc" || r.kind === "block"
  );
  const blocks = [];
  const make = (parts, doc) => {
    let text = "";
    const lines = [];
    for (const p of parts) {
      const body = src.slice(p.start, p.end).replace(/^\/\*+/, "").replace(/\*+\/$/, "").replace(/^\/\//, "");
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
    const lead = text.length - text.replace(/^[ \t\n]+/, "").length;
    const trimmed = text.replace(/^[ \t\n]+/, "").replace(/[ \t\n]+$/, "");
    return {
      text: trimmed,
      startLine: parts[0].line,
      // The line the block *ends* on, which is what "attached to the
      // declaration below" is measured from. Counting the newlines inside the
      // region is exact; a `//` line ends on the line it starts on.
      endLine: (() => {
        const last = parts[parts.length - 1];
        let n = last.line;
        for (let i = last.start; i < last.end; i++) if (src[i] === "\n") n++;
        return n;
      })(),
      lineAt: (index) => lines[Math.min(index + lead, lines.length - 1)] ?? parts[0].line,
      doc
    };
  };
  let run = [];
  const flush = () => {
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
      const last = run[run.length - 1];
      if (last.end + 1 !== r.start) flush();
    }
    run.push(r);
  }
  flush();
  return blocks;
}
function maskComments(src, regions) {
  const out = src.split("");
  for (const r of regions) {
    if (r.kind === "code" || r.kind === "string") continue;
    for (let i = r.start; i < r.end; i++) if (out[i] !== "\n") out[i] = " ";
  }
  return out.join("");
}
function lineStarts(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") starts.push(i + 1);
  return starts;
}
function lineOf(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = lo + hi + 1 >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}
var UNIT_TO_FAMILY = {
  ms: "time",
  millisecond: "time",
  milliseconds: "time",
  s: "time",
  sec: "time",
  secs: "time",
  second: "time",
  seconds: "time",
  min: "time",
  mins: "time",
  minute: "time",
  minutes: "time",
  hr: "time",
  hrs: "time",
  hour: "time",
  hours: "time",
  px: "length",
  pixel: "length",
  pixels: "length"
};
var UNIT_SCALE = {
  ms: 1,
  millisecond: 1,
  milliseconds: 1,
  s: 1e3,
  sec: 1e3,
  secs: 1e3,
  second: 1e3,
  seconds: 1e3,
  min: 6e4,
  mins: 6e4,
  minute: 6e4,
  minutes: 6e4,
  hr: 36e5,
  hrs: 36e5,
  hour: 36e5,
  hours: 36e5,
  px: 1,
  pixel: 1,
  pixels: 1
};
var UNIT_WORD = "ms|milliseconds?|secs?|seconds?|mins?|minutes?|hrs?|hours?|px|pixels?";
var NAME_UNIT = [
  [/_(MS|MILLISECONDS?)$/i, "ms"],
  [/_(S|SEC|SECS|SECONDS)$/i, "s"],
  [/_(MIN|MINS|MINUTES)$/i, "min"],
  [/_(HR|HRS|HOURS)$/i, "hr"],
  [/_(PX|PIXELS)$/i, "px"]
];
function unitFromName(name) {
  for (const [re, unit] of NAME_UNIT) if (re.test(name)) return unit;
  return null;
}
var NUMBER_WORDS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  dozen: 12,
  couple: 2,
  pair: 2,
  both: 2,
  single: 1
};
var NUMBER_WORD_RE = Object.keys(NUMBER_WORDS).join("|");
function quantityValue(token) {
  if (/^\d/.test(token)) return Number(token.replace(/_/g, ""));
  return NUMBER_WORDS[token.toLowerCase()] ?? NaN;
}
var EXPLICIT_CLAIM = new RegExp(
  `\\b(\\d[\\d_]*(?:\\.\\d+)?|${NUMBER_WORD_RE})\\s*(?:of\\s+)?(${UNIT_WORD})\\b`,
  "gi"
);
var IMPLICIT_ONE_CLAIM = new RegExp(
  `\\b(?:the|over|within|for|in|since)\\s+(?:last|past|previous|following|next)\\s+(${UNIT_WORD})\\b`,
  "gi"
);
function sentences(text) {
  const out = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== "." && c !== "!" && c !== "?") continue;
    if (c === "." && /\d/.test(text[i - 1] ?? "") && /\d/.test(text[i + 1] ?? "")) continue;
    if (i + 1 < text.length && !/\s/.test(text[i + 1])) continue;
    out.push({ text: text.slice(start, i + 1), start });
    let next = i + 1;
    while (next < text.length && /\s/.test(text[next])) next++;
    start = next;
    i = next - 1;
  }
  if (start < text.length) out.push({ text: text.slice(start), start });
  return out;
}
function claimsIn(sentence) {
  const out = [];
  EXPLICIT_CLAIM.lastIndex = 0;
  let m;
  while (m = EXPLICIT_CLAIM.exec(sentence.text)) {
    const unit = m[2].toLowerCase();
    out.push({
      value: quantityValue(m[1]),
      unit,
      family: UNIT_TO_FAMILY[unit],
      implicit: false,
      index: m.index
    });
  }
  IMPLICIT_ONE_CLAIM.lastIndex = 0;
  while (m = IMPLICIT_ONE_CLAIM.exec(sentence.text)) {
    const unit = m[1].toLowerCase();
    out.push({
      value: 1,
      unit,
      family: UNIT_TO_FAMILY[unit],
      implicit: true,
      index: m.index
    });
  }
  return out.sort((a, b) => a.index - b.index);
}
var NEGATION_CUE = /\b(?:not|never|no longer|out of|outside|excludes?|excluded)\b|\bn't\b/;
var THRESHOLD_CUE = /\b(?:ago|after|older than|earlier than|more than|past|beyond)\b/;
function qualifierAfter(sentence, claim) {
  const after = sentence.text.slice(claim.index + 1);
  const window = after.split(/\s+/).slice(0, 5).join(" ");
  if (NEGATION_CUE.test(window)) return "negated";
  if (THRESHOLD_CUE.test(window)) return "threshold";
  return null;
}
var HISTORICAL_CUE = /\b(?:once|used to|formerly|originally|previously|no longer|history|historical|used to be|was changed|renamed)\b/;
function isHistorical(sentence) {
  if (!HISTORICAL_CUE.test(sentence.text)) return false;
  return /["“”'`]|comment|called|said|claimed|wrote|read/i.test(sentence.text);
}
var QUOTED_SPAN = /`[^`]*`|"[^"\n]*"|“[^”]*”/g;
function isQuoted(sentence, claim) {
  const end = claim.index + String(claim.value).length;
  QUOTED_SPAN.lastIndex = 0;
  let m;
  while (m = QUOTED_SPAN.exec(sentence.text)) {
    if (m.index <= claim.index && end <= m.index + m[0].length) return true;
  }
  return false;
}
var EACH_CUE = /\beach\b/i;
function reconciledAsProduct(sentence, claim, have) {
  if (!EACH_CUE.test(sentence.text)) return false;
  for (const n of [...sentence.text.matchAll(new RegExp(`\\b(\\d[\\d_]*(?:\\.\\d+)?|${NUMBER_WORD_RE})\\b`, "gi"))]) {
    const count = quantityValue(n[0]);
    if (Number.isFinite(count) && count >= 2 && same(claim.value * count, have)) return true;
  }
  return false;
}
var DECL_PATTERNS = [
  [/(?:^|\n)[ \t]*(?:export[ \t]+)?(?:declare[ \t]+)?(?:const|let|var)[ \t]+([A-Za-z_$][\w$]*)/g, "const"],
  [/(?:^|\n)[ \t]*(?:export[ \t]+)?(?:async[ \t]+)?function\*?[ \t]+([A-Za-z_$][\w$]*)/g, "function"],
  [/(?:^|\n)[ \t]*(?:export[ \t]+)?(?:abstract[ \t]+)?class[ \t]+([A-Za-z_$][\w$]*)/g, "function"],
  [/(?:^|\n)[ \t]*(?:export[ \t]+)?(?:type|interface|enum)[ \t]+([A-Za-z_$][\w$]*)/g, "type"],
  // Go: `func Name(`, `func (r Recv) Name(`, `const Name =`, `var Name =`.
  [/(?:^|\n)func[ \t]+(?:\([^)]*\)[ \t]+)?([A-Za-z_][\w]*)[ \t]*\(/g, "function"],
  [/(?:^|\n)type[ \t]+([A-Za-z_][\w]*)/g, "type"],
  [/(?:^|\n)(?:const|var)[ \t]+([A-Za-z_][\w]*)[ \t]*(?::|=)/g, "const"]
];
var METHOD_PATTERN = /(?:^|\n)[ \t]*(?:(?:public|private|protected|static|readonly|async|get|set)[ \t]+)*([A-Za-z_$][\w$]*)[ \t]*(?:<[^>\n]*>)?[ \t]*\([^)]*\)[ \t]*(?::[^{;\n]*)?\{/g;
function parseDecls(code, starts) {
  const found = /* @__PURE__ */ new Map();
  const add = (name, line, kind) => {
    const existing = found.get(name);
    if (existing) return existing;
    const decl = { name, line, kind, unit: unitFromName(name), unitFrom: unitFromName(name) ? "name" : null };
    found.set(name, decl);
    return decl;
  };
  for (const [re, kind] of DECL_PATTERNS) {
    re.lastIndex = 0;
    let m2;
    while (m2 = re.exec(code)) {
      const index = m2.index + (m2[0].startsWith("\n") ? 1 : 0);
      add(m2[1], lineOf(starts, index), kind);
    }
  }
  METHOD_PATTERN.lastIndex = 0;
  let m;
  while (m = METHOD_PATTERN.exec(code)) {
    const index = m.index + (m[0].startsWith("\n") ? 1 : 0);
    add(m[1], lineOf(starts, index), "method");
  }
  const VALUE_RE = /(?:^|\n)(?:export[ \t]+)?(?:const|let|var)[ \t]+([A-Za-z_$][\w$]*)[^=\n]*=[ \t]*/g;
  VALUE_RE.lastIndex = 0;
  while (m = VALUE_RE.exec(code)) {
    const name = m[1];
    const decl = found.get(name);
    if (!decl) continue;
    const rest = code.slice(m.index + m[0].length, m.index + m[0].length + 4e3);
    const scalar = rest.match(/^([ \t]*)((-?\d[\d_]*(?:\.\d+)?))/);
    if (scalar) {
      decl.value = Number(scalar[2].replace(/_/g, ""));
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
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    if (close === -1) continue;
    const body = rest.slice(open + 1, close);
    const members = /* @__PURE__ */ new Map();
    const MEMBER = /(?:^|[,{\n])[ \t\n]*"?([A-Za-z_$][\w$]*)"?[ \t]*:[ \t]*(\[[^\]]*\]|[^\n,]+)[ \t]*(?:,|$)/g;
    let mm;
    while (mm = MEMBER.exec(body)) {
      const numbers = [...mm[2].matchAll(/-?\d[\d_]*(?:\.\d+)?/g)].map((x) => Number(x[0].replace(/_/g, "")));
      if (numbers.length > 0) members.set(mm[1], numbers);
    }
    if (members.size > 0) decl.members = members;
  }
  return [...found.values()].sort((a, b) => a.line - b.line || a.name.localeCompare(b.name));
}
function trim(s, n = 96) {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? flat.slice(0, n - 1) + "\u2026" : flat;
}
var ALLOWLIST = [];
function allowlistKey(f) {
  return `${f.file} ${f.rule} ${f.claimed}`;
}
var IDENT = "[A-Za-z_$][\\w$]*";
function canonical(value, unit, family) {
  const scale = UNIT_SCALE[unit];
  if (scale === void 0) return null;
  return value * scale;
}
function same(a, b) {
  if (a === b) return true;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) < 1e-9 * scale;
}
function wordBoundaryHas(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`).test(text);
}
function analyseFile(path, src, lang) {
  const regions = lex(src, lang);
  const code = maskComments(src, regions);
  const starts = lineStarts(src);
  const blocks = commentBlocks(src, regions);
  const decls = parseDecls(code, starts);
  const byName = new Map(decls.map((d) => [d.name, d]));
  const findings = [];
  const numericDecls = decls.filter((d) => d.value !== void 0 || d.members && d.members.size > 0);
  const declaredUnits = /* @__PURE__ */ new Map();
  for (const d of numericDecls) {
    if (d.unit) {
      declaredUnits.set(d.name, d.unit);
      continue;
    }
    for (const b of blocks) {
      for (const s of sentences(b.text)) {
        if (!wordBoundaryHas(s.text, d.name)) continue;
        const u = s.text.match(new RegExp(`\\b(${UNIT_WORD})\\b`));
        if (u) declaredUnits.set(d.name, u[1].toLowerCase());
        break;
      }
    }
  }
  const record = (rule, bucket, b, line, claimed, actual, referent) => {
    findings.push({ rule, bucket, file: path, line, claimed, actual, evidence: trim(b.text), referent });
  };
  const blockEndingAt = /* @__PURE__ */ new Map();
  for (const b of blocks) blockEndingAt.set(b.endLine, b);
  const attachedTo = /* @__PURE__ */ new Map();
  for (const d of numericDecls) {
    const attached = blockEndingAt.get(d.line - 1);
    if (attached) attachedTo.set(attached, d);
  }
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
          if (d.value === void 0) continue;
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
            `${d.name} = ${d.value} ${unit} \u2192 ${have}`,
            `${path}:${d.line}`
          );
        }
      }
    }
  }
  for (const [attached, d] of attachedTo) {
    const unit = declaredUnits.get(d.name);
    if (d.value !== void 0 && unit) {
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
            `${d.name} = ${d.value} ${unit} \u2192 ${have}`,
            `${path}:${d.line}`
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
            const nums = d.members.get(k);
            const total = nums.reduce((a, b) => a + b, 0);
            const product = nums.reduce((a, b) => a * b, 1);
            return nums.some((v) => same(canonical(v, unit, c.family), want)) || same(canonical(total, unit, c.family), want) || same(canonical(product, unit, c.family), want);
          });
          if (ok) continue;
          record(
            "attached-record",
            "defect",
            attached,
            attached.lineAt(s.start + c.index),
            claimText(c),
            `${d.name}: ${keys.map((k) => `${k} = [${d.members.get(k).join(", ")}]`).join("; ")}`,
            `${path}:${d.line}`
          );
        }
      }
    }
  }
  const COUNTABLE_NOUNS = {
    colours: /\bcolours\b/i,
    colors: /\bcolors\b/i,
    entries: /\bentries\b/i,
    names: /\bnames\b/i,
    keys: /\bkeys\b/i
  };
  const NOUN_FAMILY = {
    colours: "hex",
    colors: "hex",
    entries: "any",
    names: "any",
    keys: "any"
  };
  const codeLines = code.split("\n");
  for (const b of blocks) {
    for (const s of sentences(b.text)) {
      if (isHistorical(s)) continue;
      for (const noun of Object.keys(COUNTABLE_NOUNS)) {
        const re = new RegExp(
          `\\b(\\d[\\d_]*|${NUMBER_WORD_RE})\\s+${COUNTABLE_NOUNS[noun].source}`,
          "i"
        );
        const m = s.text.match(re);
        if (!m) continue;
        const claimed = quantityValue(m[1]);
        if (!Number.isFinite(claimed)) continue;
        let i = b.endLine;
        const run = [];
        while (i < codeLines.length) {
          const line = codeLines[i];
          const entry = line.match(/^[ \t]*([A-Za-z_$][\w$]*|"[^"]+")?[ \t]*:[ \t]*(.+?)[ \t]*,?[ \t]*$/);
          if (!entry) break;
          const value = (entry[2] ?? "").trim().replace(/,$/, "").trim().replace(/^"(.*)"$/, "$1");
          if (value === "") break;
          run.push({ name: entry[1] ?? "", value, line: i + 1 });
          i++;
        }
        if (run.length < 2) continue;
        if (NOUN_FAMILY[noun] === "hex" && !run.every((e) => /^#[0-9a-f]{3,8}$/i.test(e.value))) continue;
        let opening = -1;
        for (let j = b.endLine - 1; j >= 0 && j > b.endLine - 400; j--) {
          if (/\{\s*$/.test(codeLines[j] ?? "")) {
            opening = j;
            break;
          }
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
          `${path}:${run[0].line}-${run[run.length - 1].line}`
        );
      }
    }
  }
  const lead = new RegExp(`^(${IDENT})(?=[ \\t])`);
  const camelCase = /^[a-z_$][\w$]*[A-Z]/;
  for (const b of blocks) {
    if (!b.doc) continue;
    const first = sentences(b.text)[0];
    if (!first) continue;
    const m = first.text.match(lead);
    if (!m) continue;
    const named = m[1];
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
      `${path}:${below.line}`
    );
  }
  return findings;
}
function claimText(c) {
  return c.implicit ? `the last ${c.unit} (an implicit 1)` : `${c.value} ${c.unit}`;
}
function walk(dir, out = []) {
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
var FENCE = /^([ \t]*)(`{3,})[ \t]*(ts|tsx|js|mjs|go)[ \t]*$/gm;
function fencesOf(md) {
  const out = [];
  const starts = lineStarts(md);
  FENCE.lastIndex = 0;
  let m;
  while (m = FENCE.exec(md)) {
    const marker = m[2];
    const openLine = lineOf(starts, m.index);
    const bodyStart = FENCE.lastIndex;
    let close = md.indexOf("\n" + m[1] + marker, bodyStart);
    if (close === -1) close = md.length;
    out.push({
      lang: m[3] === "go" ? "go" : "ts",
      body: md.slice(bodyStart, close),
      startLine: openLine
    });
    FENCE.lastIndex = close;
  }
  return out;
}
function scanTree() {
  const findings = [];
  const perRoot = {};
  let comments = 0;
  for (const root of SCAN_ROOTS) {
    perRoot[root] = 0;
    for (const p of walk(join(ROOT, root))) {
      const rel = relative(ROOT, p).split(sep).join("/");
      const src = readFileSync(p, "utf8");
      if (p.endsWith(".md")) {
        for (const f of fencesOf(src)) {
          perRoot[root]++;
          const found = analyseFile(`${rel}#fence@${f.startLine}`, f.body, f.lang);
          comments += commentBlocks(f.body, lex(f.body, f.lang)).length;
          for (const x of found) x.line += f.startLine;
          findings.push(...found);
        }
        continue;
      }
      if (!/\.(ts|tsx|mjs|js|go)$/.test(p)) continue;
      const lang = p.endsWith(".go") ? "go" : "ts";
      perRoot[root]++;
      comments += commentBlocks(src, lex(src, lang)).length;
      findings.push(...analyseFile(rel, src, lang));
    }
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
  return { findings, perRoot, comments };
}
var BUCKETS = ["defect", "qualified", "quoted", "historical", "allowlisted"];
function report(findings, perRoot, comments) {
  const files = Object.values(perRoot).reduce((a, b) => a + b, 0);
  const lines = [];
  lines.push("\u2500\u2500 comment truth \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500");
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
  lines.push("\u2500".repeat(64));
  return lines.join("\n");
}
function triage(findings, perRoot, comments) {
  const allowed = new Set(ALLOWLIST.map((a) => a.key));
  const used = /* @__PURE__ */ new Set();
  const defects = [];
  for (const f of findings) {
    if (f.bucket !== "defect") continue;
    const key = allowlistKey(f);
    if (allowed.has(key)) {
      used.add(key);
      f.bucket = "allowlisted";
      continue;
    }
    defects.push(
      `  ${f.file}:${f.line}  [${f.rule}]
      claimed   ${f.claimed}
      actual    ${f.actual}
      referent  ${f.referent}
      comment   ${f.evidence}`
    );
  }
  return {
    defects,
    stale: ALLOWLIST.filter((a) => !used.has(a.key)).map((a) => `  ${a.key} - ${a.why}`),
    out: report(findings, perRoot, comments)
  };
}
var FIXTURES = [
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
`
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
`
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
`
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
`
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
`
  }
];
for (const fx of FIXTURES) {
  test(`the checker catches: ${fx.name}`, () => {
    const found = analyseFile(fx.path, fx.src, "ts").filter((f) => f.bucket === "defect");
    const hit = found.find((f) => f.rule === fx.rule);
    assert.ok(
      hit,
      `rule "${fx.rule}" found nothing in the fixture
` + report(found, { fixture: 1 }, 1) + `
fixture was:
${fx.src}`
    );
    assert.equal(hit.file, fx.path);
    assert.ok(hit.line > 0, "a finding must carry a line a human can open");
    assert.ok(hit.claimed.length > 0, "a finding must say what was claimed");
    assert.ok(hit.actual.length > 0, "a finding must say what the code says");
  });
}
test("the checker stays quiet on claims it cannot resolve", () => {
  const src = `// Prose about the world: a second look, the second tallest roof, a
// single pole, two kinds of timber, one stage at a time.
export const STOREY = 20;
`;
  const found = analyseFile("fixture/f.ts", src, "ts");
  assert.deepEqual(
    found.filter((f) => f.bucket === "defect").map((f) => f.rule),
    [],
    report(found, { fixture: 1 }, 1)
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
    report(found, { fixture: 1 }, 1)
  );
  assert.ok(
    found.some((f) => f.bucket === "qualified"),
    "a threshold claim should still be reported, just not failed"
  );
});
test("the checker does not demand the repository delete its own explanation", () => {
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
  assert.deepEqual(found.filter((f) => f.bucket === "defect"), [], report(found, { fixture: 1 }, 1));
});
test("a number quoted from another program is not a claim about this one", () => {
  const src = `// The window is whatever the runner says: \`FAIL  pkg  336ms\`
// and nothing more.
export const EMBER_MS = 120_000;
`;
  const found = analyseFile("fixture/k.ts", src, "ts");
  assert.deepEqual(found.filter((f) => f.bucket === "defect"), [], report(found, { fixture: 1 }, 1));
  assert.ok(
    found.some((f) => f.bucket === "quoted" && f.claimed === "336 ms"),
    `the quoted quantity should still be reported, just not failed:
${report(found, { fixture: 1 }, 1)}`
  );
});
test("a per-item quantity and a count are a product, not a disagreement", () => {
  const src = `/** The distance one walk cycle covers. Two steps of about seven
 *  pixels each.
 */
const STRIDE_PX = 14;
`;
  const found = analyseFile("fixture/l.ts", src, "ts");
  assert.deepEqual(found.filter((f) => f.bucket === "defect"), [], report(found, { fixture: 1 }, 1));
});
test("an allowlist entry silences the hit it names and nothing else", () => {
  const findings = [
    {
      rule: "named-constant",
      bucket: "defect",
      file: "a.ts",
      line: 1,
      claimed: "1 minute",
      actual: "EMBER_MS = 120000 ms \u2192 120000",
      evidence: "x",
      referent: "a.ts:2"
    },
    {
      rule: "named-constant",
      bucket: "defect",
      file: "b.ts",
      line: 1,
      claimed: "1 minute",
      actual: "WINDOW_MS = 60000 ms \u2192 60000",
      evidence: "y",
      referent: "b.ts:2"
    }
  ];
  ALLOWLIST.push({ key: "a.ts named-constant 1 minute", why: "a known, argued exception" });
  try {
    const { defects, stale } = triage(findings, { fixture: 2 }, 2);
    assert.equal(defects.length, 1, "exactly the unlisted hit should fail");
    assert.match(defects[0], /^ {2}b\.ts:1/);
    assert.deepEqual(stale, [], "an entry that matched is not stale");
    assert.equal(findings[0].bucket, "allowlisted");
    assert.equal(findings[1].bucket, "defect");
  } finally {
    ALLOWLIST.pop();
  }
});
test("an allowlist entry that no longer matches is itself a failure", () => {
  ALLOWLIST.push({ key: "gone.ts named-constant 1 minute", why: "fixed in a commit nobody remembers" });
  try {
    const { stale } = triage([], {}, 0);
    assert.equal(stale.length, 1);
    assert.match(stale[0], /gone\.ts named-constant 1 minute/);
  } finally {
    ALLOWLIST.pop();
  }
});
test("every comment in the tree agrees with the code beside it", () => {
  const { findings, perRoot, comments } = scanTree();
  const files = Object.values(perRoot).reduce((a, b) => a + b, 0);
  for (const root of SCAN_ROOTS) {
    assert.ok(perRoot[root] > 0, `scan root ${root} contributed nothing; the walk is broken`);
  }
  assert.ok(files > 60, `only ${files} source units were scanned; the root is probably wrong`);
  assert.ok(comments > 200, `only ${comments} comment blocks were parsed; the lexer is probably wrong`);
  const { defects, stale, out } = triage(findings, perRoot, comments);
  if (defects.length === 0 && stale.length === 0) {
    console.log(out);
    return;
  }
  assert.fail(
    `${defects.length} comment(s) contradict the code beside them.

${out}
` + (defects.length > 0 ? `${defects.join("\n\n")}

` : "") + (stale.length > 0 ? `These allowlist entries no longer match anything, so they are suppressing nothing and are only hiding a future edit:
${stale.join("\n")}
` : "") + `Fix the comment, or fix the code. If the comment is right, add an entry to ALLOWLIST in test/commenttruth.test.ts with the reason it is not a defect.`
  );
});
