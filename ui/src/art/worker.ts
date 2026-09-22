// The workers. This is the product: everything else exists so that a figure
// can stand on the right building and visibly do the thing the agent is doing.
//
// The art is built the way 16-bit characters actually were: a handful of
// authored parts — head, torso, three arm poses, two legs — composited into
// cels. A helmet is drawn once rather than re-invented for each of the sixty
// cels, and a pose is data rather than a drawing, so the walk cycle cannot
// drift between frames.
//
// Three rules from the reference are load-bearing here and are enforced by the
// code rather than by discipline:
//
//   - Every cel is outlined once, at the end, in a single ink colour. Doing it
//     per part would draw interior lines at every joint.
//   - Nothing reaches the cel's border, so the outline always has a row to write
//     into. The cel box is chosen with that headroom rather than padded after
//     the fact — `Pix` has a `pad()` for growing a surface, and nothing calls it,
//     because sizing the box correctly is the rule here.
//   - A sub worker is drawn shorter, not scaled: fractional scaling is what
//     destroys pixel art. Cropping leg rows and dropping the whole upper body by
//     the same amount gives a genuinely smaller figure at the same pixel density
//     — 19 rows against the chief's 21 — which is what ADR-0007 means by
//     "smaller worker with a different helmet".

import { P } from "./palette";
import { Pix, compose, sprite } from "./surface";

/** The cel box every worker cel occupies. Big enough for a raised mallet and
 *  for the 1px outline that is added around the assembled figure. */
export const WORKER_CEL = 26;

/**
 * Where the cel's origin sits: the ground point the figure stands on.
 *
 * x is the centre line between the two legs. y is one row below the boots, not
 * on them, because the outline pass adds a row beneath the lowest boot — and the
 * origin is what the scene subtracts to place the figure, so an origin on the
 * boot row instead of under its outline would sink every worker one pixel into
 * whatever it stands on.
 */
export const WORKER_ORIGIN = { x: 13, y: 25 };

// One key for the whole figure, so a colour is named once and the parts read
// like the thing they draw.
const KEY: Record<string, string> = {
  o: P.ink,
  H: P.helmetChief[2],
  h: P.helmetChief[1],
  j: P.helmetChief[0],
  S: P.skin[3],
  s: P.skin[2],
  d: P.skin[1],
  T: P.tunic[3],
  t: P.tunic[2],
  u: P.tunic[0],
  l: P.leather,
  M: P.metal[3],
  m: P.metal[2],
  n: P.metal[0],
  R: P.roof[2],
  r: P.roof[1],
  w: P.wood[2],
  W: P.wood[3],
  // Boot leather, and its lit top edge. `leather` is the same tone the belt
  // uses, so a worker's boots and belt read as one material.
  b: P.leather,
  B: P.earth[3],
  p: P.paper,
  q: P.paperDim,
  // The plan's drawn line, in the same glass blue the buildings use for
  // windows: a drawing is a drawing wherever it appears, and reusing the
  // construction *status* colour here — as this once did — said "a building
  // here" about a sheet of paper.
  g: P.glass[2],
  a: P.accent,
};

// --- Parts -----------------------------------------------------------------
//
// Each is authored as character rows. One character is one pixel; the source
// looks like the thing it draws.

/** Head and hard hat, facing front-right. The brim overhangs one pixel to the
 *  right, which is what tells the reader which way the figure faces. */
const HEAD = sprite(
  [
    "...ooooo..",
    "..oHHHHo..",
    ".oHHHHhho.",
    ".ohhhhhho.",
    ".oooooooo.",
    ".osSSSdo..",
    ".oSoSodo..",
    "..odddo...",
  ],
  KEY,
);

/** Torso: tunic, shoulder straps, leather belt, hem in shadow. */
const TORSO = sprite(
  [
    "..oTTTTo..",
    ".oTtTttTo.",
    ".ottTttTo.",
    ".otttttto.",
    ".ollllllo.",
    "..otttto..",
    "..ouuuuo..",
  ],
  KEY,
);

/** An arm hanging at the side. Hand at the bottom. */
const ARM_DOWN = sprite(
  [".ott", ".ott", ".ott", ".ots", "..os", "..oo"],
  KEY,
);

/** An arm raised overhead, hand at the top. Used for a wind-up and a cheer. */
const ARM_UP = sprite(
  ["..oo.", "..os.", ".ott.", ".ott.", ".ott.", ".ott.", ".ots.", "..oo."],
  KEY,
);

/** An arm out in front, reaching. Used at the moment of a blow and for
 *  holding something up to read. */
const ARM_OUT = sprite(
  [".ooo..", ".ott..", ".otss.", ".otso.", "..oso.", "..ooo."],
  KEY,
);

/**
 * A leg: trouser, boot, sole.
 *
 * `b` is the boot leather and `B` its lit top, both deliberately distinct from
 * the trouser's `t`. A character that is absent from `KEY` is skipped by
 * `sprite()`, which meant the whole boot body drew as nothing and the cel-level
 * outline then boxed the bare 1px trouser stem into a solid ink blob. Nothing
 * caught it: the result is opaque and on-palette, so neither `tsc` nor the
 * bake's palette assertion could see it, and the boots were only found by
 * re-deriving the grid by hand.
 */
const LEG = sprite(
  [".ott", ".ott", ".ott", ".obb", ".obb", ".oBb", ".ooo"],
  KEY,
);

// --- Tools -----------------------------------------------------------------

/** A mallet: wooden head, metal band, handle. Held by its handle. */
const MALLET = sprite(
  [
    "...ooooo",
    "..oWWwwo",
    "..oWwwno",
    "...ooooo",
    "....oo..",
    "....ow..",
    "....ow..",
    "....oo..",
  ],
  KEY,
);

/** A pickaxe, for demolishing. Narrow head, long haft. */
const PICK = sprite(
  [
    "..oooo..",
    ".oMMmno.",
    "ooMmmnoo",
    ".oMMMMm.",
    "...oo...",
    "...oo...",
    "...oo...",
    "..ooo...",
  ],
  KEY,
);

/** A document: a sheet of paper with ruled lines. Reading. */
const PAPER = sprite(
  ["oooooo", "oppppo", "oppqpo", "oqppqo", "oppqpo", "oqppqo", "oooooo"],
  KEY,
);

/** A blueprint: a rolled plan held open, with one drawn line. Planning. */
const BLUEPRINT = sprite(
  [
    ".oooooo.",
    "oppppppo",
    "opqggqpo",
    "oppqqppo",
    "opqggqpo",
    "oppppppo",
    ".oooooo.",
  ],
  KEY,
);

/** A level with a bubble in it. Testing: the tool that says whether a thing is
 *  true, which is what a test run is. */
const LEVEL = sprite(
  [
    ".oooooooo.",
    "oMmmmmmmno",
    "oMoggggmno",
    "oMmmmmmmno",
    ".oooooooo.",
  ],
  KEY,
);

/** A wrench, held up. Commanding: shell work, which is a third of a session. */
const WRENCH = sprite(
  [
    ".oo..oo.",
    "oMmo.oMo",
    "oMmo.oMo",
    ".oMMno..",
    "..ommo..",
    "..ommo..",
    "..oooo..",
  ],
  KEY,
);

/** A plank carried on the shoulder, for building something new. */
const PLANK = sprite(
  ["oooooooooo", "oWWWwwwwwo", "owwwWWWWwo", "oooooooooo"],
  KEY,
);

/** A crew flag. Celebrating: a session finished cleanly. */
const FLAG = sprite(
  [
    "oo......",
    "oao.....",
    "oaao....",
    "oaaao...",
    "oaao....",
    "oao.....",
    "oo......",
    "ow......",
    "ow......",
    "oo......",
  ],
  KEY,
);

/** A spark, for the celebrate loop's peak frame. */
const SPARK = sprite(
  ["..a..", ".aaa.", "aaaaa", ".aaa.", "..a.."],
  KEY,
);

/** A hammer blow's impact mark: two short strokes, alive for one frame. */
const IMPACT = sprite(["o...o", ".o.o.", "..o..", ".o.o.", "o...o"], KEY);

// --- Poses -----------------------------------------------------------------

/** Which arm cel, which tool, and where the tool sits relative to the cel. */
interface PoseArm {
  part: Pix;
  /** Offset from the cel's top-left. */
  x: number;
  y: number;
}

interface Tool {
  part: Pix;
  x: number;
  y: number;
}

/**
 * A frame is a pose, not a drawing.
 *
 * `dy` moves the whole upper body, which is how a walk cycle bob and a hammer
 * blow's recoil are expressed; the legs carry their own offsets so one leg can
 * lift while the other plants.
 */
interface Pose {
  bodyDy: number;
  left: { x: number; y: number };
  right: { x: number; y: number };
  armL: PoseArm;
  armR: PoseArm;
  tools: Tool[];
  /** Extra marks drawn over everything: impact strokes, sparks. */
  marks?: Tool[];
}

/** Where the parts sit when standing at rest. */
const REST = { headX: 8, headY: 6, torsoX: 8, torsoY: 14, legX: 9, legY: 18 };

const armDown = (x: number, y: number): PoseArm => ({ part: ARM_DOWN, x, y });
const armUp = (x: number, y: number): PoseArm => ({ part: ARM_UP, x, y });
const armOut = (x: number, y: number): PoseArm => ({ part: ARM_OUT, x, y });

/** The mallet's handle sits four pixels below its head, so a hand at (hx, hy)
 *  holds it with the head up and to the left. */
const malletAt = (hx: number, hy: number): Tool => ({
  part: MALLET,
  x: hx - 5,
  y: hy - 6,
});

/**
 * composePose draws one cel.
 *
 * The parts arrive unpositioned and are placed here, once each. That is the
 * whole reason the head and torso are passed in separately rather than as one
 * pre-composed cel: a composed body already carries the torso's own offset, and
 * blitting it at that offset again adds it twice — which silently pushed the
 * head and torso off the top of the cel and left every worker in the town
 * headless while the legs and arms drew correctly.
 *
 * Order is the figure's own draw order — far leg, torso, near leg, arms, then
 * the tool — so a planted leg reads as in front of the one behind it and a
 * mallet always occludes the hand holding it.
 */
function composePose(p: Pose, head: Pix, torso: Pix, legPart: Pix): Pix {
  // Shorter legs are dropped so the boots land on the chief's ground line, and
  // the upper body drops with them. Both halves of that are required: dropping
  // only the legs keeps the figure's *total* height identical and merely hides
  // the missing rows inside the torso, so a sub worker came out exactly as tall
  // as a chief with squashed legs — the opposite of the smaller figure ADR-0007
  // asks for. Shifting the whole upper body down by the same amount shortens
  // the figure while keeping its feet planted.
  const shift = LEG.h - legPart.h;
  const body = p.bodyDy + shift;
  return compose(WORKER_CEL, WORKER_CEL, [
    { src: legPart, x: REST.legX + p.left.x, y: REST.legY + shift + p.left.y },
    { src: torso, x: REST.torsoX, y: REST.torsoY + body },
    { src: head, x: REST.headX, y: REST.headY + body },
    { src: legPart, x: REST.legX + 4 + p.right.x, y: REST.legY + shift + p.right.y },
    { src: p.armL.part, x: p.armL.x, y: p.armL.y + body },
    { src: p.armR.part, x: p.armR.x, y: p.armR.y + body },
    ...p.tools.map((t) => ({ src: t.part, x: t.x, y: t.y + shift })),
    ...(p.marks ?? []).map((t) => ({ src: t.part, x: t.x, y: t.y + shift })),
  ]);
}

// --- The action table ------------------------------------------------------

/**
 * WorkerState names every animation the town draws.
 *
 * These are exactly the actions `internal/town/action.go` classifies events
 * into. The two lists cannot share a definition across the language boundary,
 * so an assertion compares them: when they drifted before, every read rendered
 * with the default animation because the daemon said "inspecting" while the
 * renderer only knew "reading".
 */
export type WorkerState = "idle" | "walk" | "reading" | "hammering" | "building" | "demolishing" | "testing" | "commanding" | "planning" | "celebrating";

/**
 * FRAME_MS is each animation's per-frame duration.
 *
 * Walk is 120ms — a 480ms cycle, the reference's range for a walk, fast enough
 * that a worker crossing the town does not look like it is strolling. Hammering
 * is deliberately faster and uneven: 90ms of wind-up against 70ms of strike, so
 * the blow lands hard rather than swinging evenly like a metronome.
 */
export const FRAME_MS: Record<WorkerState, number[]> = {
  idle: [700, 700],
  walk: [120, 120, 120, 120],
  reading: [420, 420, 420, 420],
  hammering: [90, 90, 70, 110],
  building: [110, 110, 80, 130],
  demolishing: [100, 100, 70, 140],
  testing: [240, 240, 240, 240],
  commanding: [160, 160, 160, 160],
  planning: [340, 340, 340, 340],
  celebrating: [130, 130, 200, 200],
};

/** The four-frame walk: two contacts and two passings. Contact frames plant the
 *  legs apart; passing frames bring them under the body and lift the torso,
 *  which is what makes the walk read as weight rather than as sliding. */
const WALK_LEGS: { left: { x: number; y: number }; right: { x: number; y: number }; dy: number }[] = [
  { left: { x: 1, y: 0 }, right: { x: -1, y: 0 }, dy: 0 },
  { left: { x: 0, y: -1 }, right: { x: 0, y: 0 }, dy: -1 },
  { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, dy: 0 },
  { left: { x: 0, y: 0 }, right: { x: 0, y: -1 }, dy: -1 },
];

/**
 * buildPoses returns the pose table for one variant.
 *
 * It is a function rather than a constant because a sub worker is the same
 * figure with a shorter leg part, and a variant's poses must be built against
 * the legs it actually has.
 */
function buildPoses(): Record<WorkerState, Pose[]> {

  /** A standing pose with the arms where the action needs them. */
  const base = (over: Partial<Pose>): Pose => ({
    bodyDy: 0,
    left: { x: 0, y: 0 },
    right: { x: 0, y: 0 },
    armL: armDown(REST.torsoX - 2, REST.torsoY),
    armR: armDown(REST.torsoX + 8, REST.torsoY),
    tools: [],
    ...over,
  });

  // Hammering: the wind-up raises the mallet behind the shoulder, the strike
  // brings it down in front, and the follow-through is the hand low with the
  // impact marks alive for one frame.
  const hammer = (phase: 0 | 1 | 2 | 3): Pose => {
    switch (phase) {
      case 0:
        return base({
          armR: armUp(REST.torsoX + 8, REST.torsoY - 6),
          tools: [malletAt(REST.torsoX + 13, REST.torsoY - 6)],
        });
      case 1:
        return base({
          armR: armUp(REST.torsoX + 9, REST.torsoY - 3),
          tools: [malletAt(REST.torsoX + 14, REST.torsoY - 5)],
        });
      case 2:
        return base({
          bodyDy: 1,
          armR: armOut(REST.torsoX + 8, REST.torsoY + 2),
          tools: [malletAt(REST.torsoX + 13, REST.torsoY + 2)],
          marks: [{ part: IMPACT, x: REST.torsoX + 13, y: REST.torsoY + 1 }],
        });
      default:
        return base({
          bodyDy: 1,
          armR: armOut(REST.torsoX + 7, REST.torsoY + 3),
          tools: [malletAt(REST.torsoX + 11, REST.torsoY + 4)],
        });
    }
  };

  const states: Record<WorkerState, Pose[]> = {
    idle: [
      base({}),
      base({ bodyDy: -1, armL: armDown(REST.torsoX - 2, REST.torsoY - 1), armR: armDown(REST.torsoX + 8, REST.torsoY - 1) }),
    ],

    walk: WALK_LEGS.map((f) =>
      base({
        bodyDy: f.dy,
        left: f.left,
        right: f.right,
        // Arms swing opposite the legs, which is the whole reason a walk reads
        // as a walk rather than as a hop.
        armL: armDown(REST.torsoX - 2, REST.torsoY - f.dy - (f.left.x > 0 ? 1 : 0)),
        armR: armDown(REST.torsoX + 8, REST.torsoY - f.dy - (f.right.x > 0 ? 1 : 0)),
      }),
    ),

    // Reading holds the sheet up in both hands and leans in on the last frame.
    reading: [0, 1, 2, 3].map((i) =>
      base({
        bodyDy: i === 1 || i === 3 ? 1 : 0,
        armL: armOut(REST.torsoX - 1, REST.torsoY + 2),
        armR: armOut(REST.torsoX + 7, REST.torsoY + 2),
        tools: [{ part: PAPER, x: REST.torsoX + 2, y: REST.torsoY + (i === 1 || i === 3 ? -4 : -3) }],
      }),
    ),

    hammering: [hammer(0), hammer(1), hammer(2), hammer(3)],

    // Building carries a plank on the shoulder and hammers it down into place.
    building: [0, 1, 2, 3].map((i) =>
      base({
        bodyDy: i === 2 ? 1 : 0,
        armL: armUp(REST.torsoX - 3, REST.torsoY - 4),
        tools: [{ part: PLANK, x: REST.torsoX - 3, y: REST.torsoY - 6 }],
        armR: i === 2 ? armOut(REST.torsoX + 8, REST.torsoY + 2) : armUp(REST.torsoX + 8, REST.torsoY - 4),
        marks: i === 2 ? [{ part: IMPACT, x: REST.torsoX + 13, y: REST.torsoY + 1 }] : [],
      }),
    ),

    // Demolishing swings a pick over the shoulder; the second half of the loop
    // is the same swing with the body dropped, so the arc reads as one motion.
    demolishing: [0, 1, 2, 3].map((i) => {
      const up = i < 2;
      const haft = REST.torsoY + (up ? -6 : 2);
      return base({
        bodyDy: up ? 0 : 1,
        armR: up ? armUp(REST.torsoX + 8, haft) : armOut(REST.torsoX + 8, haft),
        tools: [{ part: PICK, x: REST.torsoX + (up ? 9 : 10), y: haft - (up ? 2 : 1) }],
        marks: i === 2 ? [{ part: IMPACT, x: REST.torsoX + 12, y: REST.torsoY + 2 }] : [],
      });
    }),

    // Testing holds the level at eye height and sweeps it half a pixel's worth
    // of travel across the frame: a check, not a construction.
    testing: [0, 1, 2, 3].map((i) =>
      base({
        armL: armOut(REST.torsoX - 1, REST.torsoY - 2),
        armR: armOut(REST.torsoX + 6, REST.torsoY - 2),
        tools: [{ part: LEVEL, x: REST.torsoX + (i % 2 === 0 ? 1 : 2), y: REST.torsoY - 5 }],
      }),
    ),

    // Commanding raises a wrench and plants the other hand on the hip; it is
    // the pose of someone running something, not making something.
    commanding: [0, 1, 2, 3].map((i) =>
      base({
        bodyDy: i % 2 === 0 ? 0 : -1,
        armL: armDown(REST.torsoX - 2, REST.torsoY + 1),
        armR: armUp(REST.torsoX + 8, REST.torsoY - 5),
        tools: [{ part: WRENCH, x: REST.torsoX + 8, y: REST.torsoY + (i % 2 === 0 ? -13 : -12) }],
      }),
    ),

    // Planning holds the blueprint open and unrolls it a pixel further on the
    // second half of the loop.
    planning: [0, 1, 2, 3].map((i) =>
      base({
        bodyDy: i === 1 || i === 3 ? -1 : 0,
        armL: armOut(REST.torsoX - 2, REST.torsoY + 1),
        armR: armOut(REST.torsoX + 7, REST.torsoY + 1),
        tools: [{ part: BLUEPRINT, x: REST.torsoX + 1, y: REST.torsoY + (i === 1 || i === 3 ? -6 : -5) }],
      }),
    ),

    // Celebrating: both arms up, a flag in one hand, and the spark alive for
    // the peak frame only — the one moment in the town that is allowed to be
    // bright.
    celebrating: [0, 1, 2, 3].map((i) => {
      const up = i >= 1;
      return base({
        bodyDy: up ? -1 : 0,
        armL: armUp(REST.torsoX - 3, REST.torsoY - 5),
        armR: armUp(REST.torsoX + 8, REST.torsoY - 5),
        tools: [{ part: FLAG, x: REST.torsoX + 4, y: REST.torsoY - 13 }],
        marks: i === 2 || i === 3 ? [{ part: SPARK, x: REST.torsoX + 12, y: REST.torsoY - 12 }] : [],
      });
    }),
  };

  return states;
}

/** A worker's full cel set, ready to bake. */
export interface WorkerSheet {
  /** Cels in animation order, keyed by state. */
  cels: Record<WorkerState, Pix[]>;
}

export type Tier = "chief" | "sub";

/**
 * buildWorker returns every cel for one tier.
 *
 * The sub worker's difference is exactly three things, all of them legible at
 * 18 pixels: shorter legs, a silver helmet, and no shoulder strap. It is not a
 * scaled copy, because a scale factor of anything other than a whole number is
 * what makes pixel art look broken.
 */
export function buildWorker(tier: Tier): WorkerSheet {
  const helmet = tier === "chief" ? P.helmetChief : P.helmetSub;
  // The helmet is a palette swap on one authored head, not a second drawing:
  // that is what keeps the two tiers recognisably the same worker, which is the
  // point of distinguishing them by helmet (ADR-0007) rather than by species.
  const head = HEAD.clone()
    .replace(P.helmetChief[2], helmet[2])
    .replace(P.helmetChief[1], helmet[1])
    .replace(P.helmetChief[0], helmet[0]);

  // A sub worker's legs are two rows shorter, taken off the top. Shortening
  // rather than scaling is deliberate: a scale factor of anything but a whole
  // number is what makes pixel art look broken, and the boot row stays intact
  // because the crop is anchored at the trouser end.
  const legs = tier === "chief" ? LEG : cropRows(LEG, 2);
  const torso = TORSO.clone();

  const poses = buildPoses();
  const cels = {} as Record<WorkerState, Pix[]>;
  for (const state of Object.keys(poses) as WorkerState[]) {
    cels[state] = poses[state].map((p) => composePose(p, head, torso, legs).outline(P.ink));
  }
  return { cels };
}

/** cropRows removes rows from the top of a part, which is how a sub worker's
 *  legs get shorter without any scaling. */
function cropRows(src: Pix, n: number): Pix {
  const out = new Pix(src.w, src.h - n);
  for (let y = n; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const [r, g, b, a] = src.at(x, y);
      if (a !== 0) out.set(x, y - n, [r, g, b, a]);
    }
  }
  return out;
}

/**
 * WALK_CYCLE_MS is how long one full walk cycle takes.
 *
 * The scene paces a worker's travel to this, so the feet plant at the speed the
 * figure is actually moving. A walk cycle that finishes before the figure
 * arrives is the classic slides-while-walking bug.
 */
export const WALK_CYCLE_MS = FRAME_MS.walk.reduce((a, b) => a + b, 0);
