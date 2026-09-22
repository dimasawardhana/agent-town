// The palette. One author's 16-bit set, written once and never extended
// casually: every colour here is a decision, and the discipline is what keeps
// the town reading as one drawn world rather than as coloured rectangles.
//
// The rules the ramps follow, and which any new colour must follow too:
//
//   1. Shadows shift hue cool (toward blue/violet), highlights shift warm.
//      A shadow that is only a darker version of its own hue looks dead.
//   2. Every ramp is 3 to 4 steps. More steps than that and the extra tones
//      are invisible at a 12-pixel worker.
//   3. One ink. Every figure and building is outlined in the same near-black,
//      at 1px, at every size.
//   4. Light comes from the top-left, always. Lit faces take the warm step,
//      the faces away from it take the cool step.

/** A ramp runs dark to light, index 0 = darkest. */
export type Ramp = readonly [string, string, string, string];

export const P = {
  // --- Terrain -----------------------------------------------------------
  // The void behind everything, and the base of the sky the town sits in.
  void: "#0e141c",
  // Ground tones, hue-shifted from a cool shadow green to a warm lit green.
  grass: ["#1d3327", "#274632", "#32583d", "#3e6b49"] as Ramp,
  grassLit: "#4a7d54",
  earth: ["#3a2c1e", "#543f2a", "#6f5436", "#8c6d45"] as Ramp,
  // The Yard is packed dirt, warmer and lighter than the grass so half a
  // session's work has somewhere legible to happen. Its two surface steps are
  // named rather than taken from the earth ramp, because packed dirt is a
  // different surface from the bare earth around it, not a darker one.
  yardFloorDark: "#61492f",
  yardFloorLit: "#96784f",

  // --- Wood --------------------------------------------------------------
  // The town's most-used material: scaffolding, framing, planks, props.
  wood: ["#4a3320", "#6d4c2c", "#94693c", "#c39558"] as Ramp,

  // --- Roofs -------------------------------------------------------------
  // Terracotta, hue-shifted rather than desaturated for its shadow side. The
  // ramp's own top step is the ridge highlight, so no separate ridge colour.
  roof: ["#5c2b22", "#833d2d", "#a85439", "#c9724a"] as Ramp,
  // Thatch for the lower-tier buildings, so size reads as wealth.
  thatch: ["#6b5527", "#8e7338", "#b3924c", "#d4b366"] as Ramp,

  // --- Stone -------------------------------------------------------------
  stone: ["#3c4149", "#575e68", "#7c858f", "#a5aeb8"] as Ramp,

  // --- Workers -----------------------------------------------------------
  skin: ["#7d5236", "#a8724a", "#cd9464", "#e6b688"] as Ramp,
  tunic: ["#3f2415", "#6b3f22", "#8f5a30", "#b07c45"] as Ramp,
  leather: "#4a3422",
  metal: ["#4c545e", "#77828d", "#a3aeb9", "#d2dae2"] as Ramp,
  // Chief and sub helmets. These two are load-bearing: they are how a glance
  // separates the agent driving the session from what it spawned (ADR-0007).
  helmetChief: ["#8a6414", "#bd8f1d", "#e6bb38", "#f7dc72"] as Ramp,
  helmetSub: ["#5b646e", "#8b959f", "#bcc5cd", "#e6ecf1"] as Ramp,
  // --- Walls -------------------------------------------------------------
  // Daub-and-plaster with exposed timber, which is the wall of the town's
  // lower tiers. Added deliberately rather than improvised per building: a
  // wall colour invented at a call site is how a palette drifts.
  plaster: ["#4e4238", "#7d6d5c", "#a89480", "#cfbb9d"] as Ramp,
  // Window glass, taking the sky rather than the inside of the room. It reads
  // as a window at four pixels wide only because it is the only cool blue in
  // the building palette. Four steps like every other ramp: a step of pure
  // highlight is what catches the eye at 1x, and a three-step ramp would have
  // had to fake it by reusing the midtone.
  glass: ["#1e2a33", "#2f4048", "#4a6270", "#7191a4"] as Ramp,

  // --- Plant and equipment -----------------------------------------------
  // The Yard and the Workshop hold things that are neither timber nor bright
  // steel: tarpaulins, hoses, aged iron. One ramp per material, and each is
  // here rather than at a call site because these materials appear on several
  // props — a prop that invented its own brown would be the start of a second
  // palette, which is what this file exists to prevent.
  //
  // `rust` takes a cooler, less saturated shadow than `roof` does, because
  // oxidised iron in shade goes grey-brown where terracotta stays warm. That
  // single difference is what stops a rusted skip reading as a clay pot.
  rust: ["#452a2b", "#6b3d28", "#935231", "#b46c3d"] as Ramp,
  // Canvas: tarpaulins, sackcloth, rope. Slightly olive, because the town's
  // green is spoken for by grass and a second green would compete with it.
  canvas: ["#3f4230", "#5f6244", "#83865f", "#a7ab7e"] as Ramp,
  // Rubber and cable: tyres, hose, sheathing. The darkest ramp in the palette
  // after ink, which is what makes a tyre read as a hole in the ground rather
  // than as a grey box.
  rubber: ["#211e20", "#332f37", "#49444e", "#635d69"] as Ramp,
  // --- Placard plates ----------------------------------------------------
  // The boards behind the map's lettering. They live here rather than as
  // literals in `placard.ts` for the reason the rest of this palette exists:
  // `assertPaletteClean` refuses any colour not in `P`, so a plate invented at
  // a call site fails the boot instead of shipping. Three tones, because a
  // label's role is readable from its board before its text is — a place's name
  // is the loudest thing on the map, and a worker's caption is deliberately the
  // quietest.
  plateWarm: "#2b1f10",
  plateCool: "#1b1a20",
  plateDim: "#241d16",

  // One outline colour for the whole town.
  ink: "#140f0b",
  // Labels are drawn in near-white; pure white would glare at this scale.
  paper: "#e8e0cd",
  paperDim: "#a89f8c",

  /** The accent: the chief's helmet yellow, used for the flag on a finished
   *  session and for the panel's live-state marks. Never decoration. */
  accent: "#e6bb38",
  accentDim: "#8a6414",
} as const;

// Deliberately absent from this palette, each for a reason worth recording:
//
//   - Panel colours. The side panel is styled in CSS from its own variables
//     (ui/index.html). Copying them here as literals would be a second source
//     of truth for one colour, and the two would drift the first time either
//     changed — so the palette's job stops at the town.
//   - Building-status colours. A building's condition is carried by its
//     *structure*: a broken one has rubble at its base, a crack up its wall and
//     a hole in its roof, and a completed one has a door. A tint would say the
//     same thing worse, and would fight the art's own lighting, so no status
//     colour is drawn with.

/** Crew colours, so two sessions on one repo are tellable apart. */
export const CREW_COLOURS = [
  "#5aa9d9",
  "#e6bb38",
  "#a98cd9",
  "#6fbf7a",
  "#d97a9a",
  "#c9d96f",
] as const;

/** Palette index for a crew colour, chosen by hashing the agent name so a
 *  given agent keeps its colour across sessions and restarts. */
export function crewColour(agent: string): string {
  let h = 0;
  for (let i = 0; i < agent.length; i++) h = (h * 31 + agent.charCodeAt(i)) | 0;
  return CREW_COLOURS[Math.abs(h) % CREW_COLOURS.length];
}

/**
 * Every colour the artist may draw with.
 *
 * It walks the palette's own structure rather than restating the colours, so a
 * ramp added to `P` is automatically allowed and a hex typed into a sprite by
 * hand is automatically not. That asymmetry is the whole point: the bake
 * asserts every drawn pixel is in this set, which makes an off-palette colour a
 * failed build rather than a slow drift nobody notices.
 *
 * Descent handles both shapes the palette uses: bare hex strings and ramps
 * (arrays of hex strings).
 */
export function paletteSet(): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === "string") {
      out.add(v.toLowerCase());
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (v && typeof v === "object") {
      for (const x of Object.values(v)) walk(x);
    }
  };
  walk(P);
  walk(CREW_COLOURS);
  return out;
}
