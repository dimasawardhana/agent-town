// The time of day, as one key light for the whole town.
//
// Not per building. A real light per building is 1,237 new cels and the
// pixel-art rules forbid the soft gradient it wants; the honest version of a
// key light is one the whole town shares, and the honest version is also the
// cheap one. It is spec feature 5 in `docs/superpowers/specs/2026-09-29-town-liveliness.md`,
// and it is last in that document only because it touches every baked cel's
// palette — which is what this file exists to make smaller.
//
// **Three phases, not twenty-four.** A clock would be a claim the town cannot
// support: nothing in the analysis or the event stream says what time it is, so
// any value would be invented. What the town *can* support is the one fact a
// reader is already reading the map in — is the work happening or is it quiet —
// expressed as light. So the axis is day / dusk / night, and the middle one is
// the default because it is the only one that says anything.
//
// Nothing here is a cel. The phases carry sky colours and a boolean, and the
// boolean picks which of the window-light cels the scene draws. The atlas budget
// is the wall on this project (`floor(8192 / cellH) x 16`, 187 free when this
// was written) and nothing in this file spends a pixel of it.

/** A phase of the town's one key light. */
import { P } from "./art/palette";

export type DayPhase = "day" | "dusk" | "night";

/** Every phase, in the order the control steps through them. */
export const DAY_PHASES: readonly DayPhase[] = ["day", "dusk", "night"];

export interface Daylight {
  /** What the reader is told, in the panel. Never more than one word. */
  label: string;
  /** Which of the validated sky palette keys play the backdrop's three roles.
   *
   *  **Keys, not colours.** The sky palette is not a free list: `sky.test.ts`
   *  checks the value relationships between all seven of them — the plain
   *  darker than the void, lighter than the haze, less saturated than the
   *  grass it sits behind — and a phase that invented its own `#rrggbb` would
   *  sit outside every one of those checks while still looking like it belonged
   *  in the town. So a phase is a *selection*: day takes the plain it always
   *  was, dusk takes the glow, night takes the zenith.
   *
   *  The backdrop is painted from these three and nothing else, so a phase costs
   *  three assignments and no cel. */
  sky: { ground: string; mid: string; void: string };
  /** Whether a window with glass in it is lit.
   *
   *  A claim, not a mood: a lit window says the building has an inside worth
   *  lighting, and at dusk the town is a town where the work has stopped for
   *  the day. At `day` the same windows read as glass, which is what they are. */
  lit: boolean;
  /** The cloud colour, or null when this phase has no visible cloud.
   *
   *  `null` at night, and that is a claim rather than a mood: you cannot see
   *  cloud at night, and drawing one there would be the sky asserting something
   *  it knows to be false.
   *
   *  A palette key, like every other sky colour, for the reason
   *  `sky.test.ts` exists. */
  cloud: string | null;
  /** How many birds are in the sky at this phase.
   *
   *  **A count, and it is the claim.** A bird in the sky is the first thing in
   *  this town that moves without saying anything about the code, and the
   *  liveliness spec's first rule is that a figure moving because it looks nice
   *  is decoration wearing a claim's clothes. So the bird is tied to the hour
   *  rather than to the repository: it is a claim about the *sky*, the same
   *  claim a lit window makes, and it is a claim the town can actually support
   *  because the phase is in the store.
   *
   *  **Dusk only, and not night.** Birds come out at dusk and roost by dark, so
   *  a night bird would be asserting something the town knows to be untrue — the
   *  same rule that puts no cloud in a night sky, and for the same reason. Zero
   *  at day is the same honesty: a bird is a speck against a bright sky and
   *  would read as dirt on the lens.
   *
   *  What it may never mean is *an agent is working here*. That is the machine's
   *  claim, and it is the only one. A flock over a busy district would say
   *  "something is happening there" and quietly take a job that belongs to a
   *  signal the reader can act on. */
  birds: number;

  /** The palette key the lit glass is drawn in, or null when this phase lights
   *  nothing.
   *
   *  One colour, not one per phase. A second, brighter lamp for `night` would
   *  double the overlay family from 60 cels to 120 and leave the atlas 47 cels
   *  from its ceiling, to make a difference the *sky* already makes for free.
   *  The phase is carried by the backdrop; the lamp is one emissive.
   *
   *  Null at `day` on purpose: a phase that could be asked for its lamp would
   *  be a phase whose flag could be left on by accident. */
  lamp: "lamp" | null;
}

/**
 * The three phases, and why there are three.
 *
 * `dusk` is the default, because it is the only phase that carries information:
 * it says the light is going, which is the one honest reading of a town that is
 * still. `day` is the plain case — the one a reader falls back to when the
 * light is not the point. `night` is the extreme: the same claim as dusk, said
 * harder, for a reader who wants the town dark enough that the lit windows are
 * the only warm thing in it.
 */
export const DAYLIGHT: Record<DayPhase, Daylight> = {
  day: {
    label: "Day",
    sky: { ground: P.skyGround, mid: P.skyHaze, void: P.skyNear },
    // Haze for the body and the glow for its lit top edge, which is what makes
    // a cloud read as a cloud and not as a smudge on the sky.
    cloud: P.skyHaze,
    birds: 0,
    lit: false,
    lamp: null,
  },
  dusk: {
    label: "Dusk",
    sky: { ground: P.skyFar, mid: P.skyGlow, void: P.void },
    // The glow. A cloud at dusk is the one thing lit from underneath, and this
    // palette already has the colour of light coming up off a horizon.
    cloud: P.skyGlow,
    birds: 6,
    lit: true,
    lamp: "lamp",
  },
  night: {
    label: "Night",
    sky: { ground: P.skyZenith, mid: P.skyMid, void: P.void },
    cloud: null,
    birds: 0,
    lit: true,
    lamp: "lamp",
  },
};

export function isDayPhase(v: unknown): v is DayPhase {
  return v === "day" || v === "dusk" || v === "night";
}

/** normaliseDay folds anything into a phase, defaulting to dusk.
 *
 *  Dusk rather than day is the default for the same reason it is the middle of
 *  the list: a town that has not been told otherwise is a town at dusk, and
 *  that is the one phase where the light is saying something. */
export function normaliseDay(v: unknown): DayPhase {
  return isDayPhase(v) ? v : "dusk";
}

/** stepDay moves through the phases, wrapping, for a single control. */
export function stepDay(from: unknown, delta: number): DayPhase {
  const i = DAY_PHASES.indexOf(normaliseDay(from));
  const n = DAY_PHASES.length;
  return DAY_PHASES[(((i + delta) % n) + n) % n];
}
