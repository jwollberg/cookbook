/**
 * Unit conversion.
 *
 * The whole point of the app hangs off this file: a plan calling for
 * "2 cups flour" in one recipe and "250 g flour" in another must produce ONE
 * shopping line, not two.
 *
 * Three dimensions, each with a canonical base unit:
 *   MASS   -> gram
 *   VOLUME -> millilitre
 *   COUNT  -> the count unit itself (see below)
 *
 * Within mass or volume, conversion is a fixed ratio. Across dimensions it
 * needs the ingredient's own physics — volume->mass needs density, count->mass
 * needs a per-unit weight.
 *
 * TWO RULES THAT MATTER:
 *
 * 1. Count units do NOT convert to each other. "2 cloves garlic" is not
 *    "2 heads garlic" and neither is "2 each". Every count unit is its own
 *    bucket unless the ingredient explicitly gives it a weight. Collapsing
 *    them to a shared "each" base would silently produce nonsense.
 *
 * 2. When a cross-dimension factor is missing, DO NOT GUESS. Leave the line
 *    separate. A silently wrong shopping quantity is worse than a visibly
 *    split one, and the split doubles as a prompt to fill in the missing
 *    factor on that ingredient.
 */

export type Dimension = "mass" | "volume" | "count";

export interface UnitDef {
  id: string;
  dimension: Dimension;
  /** How many base units (g / ml) one of this unit equals. Count units: 1. */
  toBase: number;
  label: string;
  plural: string;
  aliases: string[];
}

/**
 * Per-ingredient conversion factors. Structural on purpose so the engine can
 * be tested without constructing whole Ingredient records.
 */
export interface ConversionFactors {
  /** Density in grams per millilitre. Enables volume <-> mass. */
  gramsPerMl?: number;
  /** Grams for ONE of a given count unit, e.g. { each: 150, clove: 3 }. */
  countWeights?: Record<string, number>;
}

const UNIT_LIST: UnitDef[] = [
  // ---- MASS (base: gram) ----
  { id: "g", dimension: "mass", toBase: 1, label: "g", plural: "g", aliases: ["gram", "grams", "gr"] },
  { id: "kg", dimension: "mass", toBase: 1000, label: "kg", plural: "kg", aliases: ["kilogram", "kilograms", "kilo", "kilos"] },
  { id: "oz", dimension: "mass", toBase: 28.349523125, label: "oz", plural: "oz", aliases: ["ounce", "ounces"] },
  { id: "lb", dimension: "mass", toBase: 453.59237, label: "lb", plural: "lb", aliases: ["pound", "pounds", "lbs"] },

  // ---- VOLUME (base: millilitre) ----
  { id: "ml", dimension: "volume", toBase: 1, label: "ml", plural: "ml", aliases: ["millilitre", "millilitres", "milliliter", "milliliters", "cc"] },
  { id: "l", dimension: "volume", toBase: 1000, label: "l", plural: "l", aliases: ["litre", "litres", "liter", "liters"] },
  { id: "tsp", dimension: "volume", toBase: 4.92892159375, label: "tsp", plural: "tsp", aliases: ["teaspoon", "teaspoons", "t"] },
  { id: "tbsp", dimension: "volume", toBase: 14.78676478125, label: "tbsp", plural: "tbsp", aliases: ["tablespoon", "tablespoons", "tbl", "tbs", "T"] },
  { id: "floz", dimension: "volume", toBase: 29.5735295625, label: "fl oz", plural: "fl oz", aliases: ["fl-oz", "fluid ounce", "fluid ounces", "fl. oz."] },
  { id: "cup", dimension: "volume", toBase: 236.5882365, label: "cup", plural: "cups", aliases: ["c"] },
  { id: "pt", dimension: "volume", toBase: 473.176473, label: "pint", plural: "pints", aliases: ["pint", "pints"] },
  { id: "qt", dimension: "volume", toBase: 946.352946, label: "quart", plural: "quarts", aliases: ["quart", "quarts"] },
  { id: "gal", dimension: "volume", toBase: 3785.411784, label: "gal", plural: "gal", aliases: ["gallon", "gallons"] },

  // ---- COUNT (each is its own base; see rule 1 above) ----
  { id: "each", dimension: "count", toBase: 1, label: "", plural: "", aliases: ["ea", "whole", "piece", "pieces", "x"] },
  { id: "clove", dimension: "count", toBase: 1, label: "clove", plural: "cloves", aliases: [] },
  { id: "head", dimension: "count", toBase: 1, label: "head", plural: "heads", aliases: [] },
  { id: "bunch", dimension: "count", toBase: 1, label: "bunch", plural: "bunches", aliases: [] },
  { id: "sprig", dimension: "count", toBase: 1, label: "sprig", plural: "sprigs", aliases: [] },
  { id: "stalk", dimension: "count", toBase: 1, label: "stalk", plural: "stalks", aliases: ["rib", "ribs"] },
  { id: "slice", dimension: "count", toBase: 1, label: "slice", plural: "slices", aliases: [] },
  { id: "can", dimension: "count", toBase: 1, label: "can", plural: "cans", aliases: ["tin", "tins"] },
  { id: "jar", dimension: "count", toBase: 1, label: "jar", plural: "jars", aliases: [] },
  { id: "block", dimension: "count", toBase: 1, label: "block", plural: "blocks", aliases: [] },
  { id: "package", dimension: "count", toBase: 1, label: "package", plural: "packages", aliases: ["pkg", "packet", "packets"] },
  { id: "pinch", dimension: "count", toBase: 1, label: "pinch", plural: "pinches", aliases: [] },
  { id: "toTaste", dimension: "count", toBase: 1, label: "to taste", plural: "to taste", aliases: ["to-taste"] },
];

export const UNITS: Record<string, UnitDef> = Object.fromEntries(
  UNIT_LIST.map((u) => [u.id, u]),
);

export const UNIT_IDS = UNIT_LIST.map((u) => u.id);

const LOOKUP: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const u of UNIT_LIST) {
    map[u.id.toLowerCase()] = u.id;
    map[u.label.toLowerCase()] = u.id;
    map[u.plural.toLowerCase()] = u.id;
    for (const a of u.aliases) map[a.toLowerCase()] = u.id;
  }
  delete map[""]; // "each" has an empty label/plural by design
  return map;
})();

/** Resolve a user-typed unit string to a canonical unit id. */
export function resolveUnit(input: string | null | undefined): string | null {
  if (input == null) return null;
  const key = String(input).trim().toLowerCase().replace(/\.$/, "");
  if (key === "") return "each";
  return LOOKUP[key] ?? null;
}

export function dimensionOf(unitId: string): Dimension | null {
  return UNITS[unitId]?.dimension ?? null;
}

/**
 * The bucket a measurement aggregates into.
 *
 * Mass and volume each collapse to one bucket. Count units get one bucket
 * EACH — that's rule 1, and it's why this returns "count:clove" rather than
 * a bare "count".
 */
export function bucketKey(unitId: string): string {
  const dim = dimensionOf(unitId);
  if (dim === null) return `unknown:${unitId}`;
  return dim === "count" ? `count:${unitId}` : dim;
}

/** Convert a quantity into its dimension's base unit (g, ml, or count). */
export function toBase(quantity: number, unitId: string): number {
  const unit = UNITS[unitId];
  if (!unit) throw new Error(`Unknown unit: ${unitId}`);
  return quantity * unit.toBase;
}

/** Convert an amount in base units back into a specific unit. */
export function fromBase(baseAmount: number, unitId: string): number {
  const unit = UNITS[unitId];
  if (!unit) throw new Error(`Unknown unit: ${unitId}`);
  return baseAmount / unit.toBase;
}

/**
 * Convert an amount to grams, using the ingredient's factors when the source
 * is not already a mass.
 *
 * Returns null when it cannot be done without guessing — that null is the
 * whole safety mechanism, so callers must handle it rather than defaulting.
 */
export function toGrams(
  baseAmount: number,
  bucket: string,
  factors: ConversionFactors | undefined,
): number | null {
  if (bucket === "mass") return baseAmount;

  if (bucket === "volume") {
    const density = factors?.gramsPerMl;
    return density && density > 0 ? baseAmount * density : null;
  }

  if (bucket.startsWith("count:")) {
    const unitId = bucket.slice("count:".length);
    const perUnit = factors?.countWeights?.[unitId];
    return perUnit && perUnit > 0 ? baseAmount * perUnit : null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export type MeasurementSystem = "us" | "metric";

/**
 * Ladders, largest-first.
 *
 * `fractionable` marks the units cooks actually subdivide. Cups and pounds
 * are routinely halved and quartered, so they are allowed to win below 1
 * ("½ cup"). Quarts, tablespoons and teaspoons are not — nobody asks for
 * "¼ quart" when they mean a cup, or "⅓ tbsp" when they mean a teaspoon.
 * Metric subdivides nothing: 500 g, never 0.5 kg.
 */
interface LadderStep {
  id: string;
  fractionable: boolean;
}

const MASS_LADDER: Record<MeasurementSystem, LadderStep[]> = {
  us: [
    { id: "lb", fractionable: true },
    { id: "oz", fractionable: false },
  ],
  metric: [
    { id: "kg", fractionable: false },
    { id: "g", fractionable: false },
  ],
};
const VOLUME_LADDER: Record<MeasurementSystem, LadderStep[]> = {
  us: [
    { id: "gal", fractionable: false },
    { id: "qt", fractionable: false },
    { id: "cup", fractionable: true },
    { id: "tbsp", fractionable: false },
    { id: "tsp", fractionable: false },
  ],
  metric: [
    { id: "l", fractionable: false },
    { id: "ml", fractionable: false },
  ],
};

/** Fractions a cook can actually act on. "0.33 cup" is not one of them. */
const FRACTIONS: [number, string][] = [
  [1 / 8, "⅛"],
  [1 / 4, "¼"],
  [1 / 3, "⅓"],
  [1 / 2, "½"],
  [2 / 3, "⅔"],
  [3 / 4, "¾"],
];

/**
 * Round to a cook-friendly string. US recipes are written in fractions, so
 * rendering "1.33 cups" instead of "1⅓ cups" makes a list feel machine-made
 * and is genuinely harder to act on at a counter.
 */
export function formatAmount(value: number, system: MeasurementSystem): string {
  if (!Number.isFinite(value)) return "0";
  if (value === 0) return "0";

  // Large amounts don't want fractions at all.
  if (value >= 10) return String(Math.round(value));

  if (system === "metric") {
    if (value >= 100) return String(Math.round(value));
    if (value >= 10) return value.toFixed(0);
    return trimZeros(value.toFixed(value < 1 ? 2 : 1));
  }

  const whole = Math.floor(value);
  const frac = value - whole;

  // Within ~2% of a familiar fraction, snap to it.
  let best: string | null = null;
  let bestDiff = 0.021;
  for (const [num, glyph] of FRACTIONS) {
    const diff = Math.abs(frac - num);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = glyph;
    }
  }
  if (frac < 0.021) return String(whole);
  if (best) return whole > 0 ? `${whole}${best}` : best;

  return trimZeros(value.toFixed(2));
}

function trimZeros(s: string): string {
  return s.replace(/\.?0+$/, "");
}

/**
 * Singular below and at one, plural above it.
 *
 * Note this is NOT `value === 1 ? singular : plural`: a half cup is "½ cup",
 * not "½ cups". Fractions take the singular in English.
 */
function pluralise(unit: UnitDef, value: number): string {
  return value > 1 ? unit.plural : unit.label;
}

/**
 * Render a quantity in the unit it was WRITTEN in.
 *
 * Distinct from formatQuantity, which walks a ladder to pick the friendliest
 * unit for a shopping total. On a recipe page that would be wrong: a cook
 * following "1/2 cup olive oil" wants to see cups, not the 118 ml or 4 fl oz
 * a ladder might land on. Scaling changes the number, never the unit.
 */
export function formatUnitQuantity(
  quantity: number,
  unitId: string,
  system: MeasurementSystem = "us",
): string {
  const unit = UNITS[unitId];
  const amount = formatAmount(quantity, system);
  if (!unit || unit.label === "") return amount;
  return `${amount} ${pluralise(unit, quantity)}`;
}

/** True when a value lands on a whole number or a familiar cooking fraction. */
function readsCleanly(value: number): boolean {
  if (value >= 10) return true;
  const frac = value - Math.floor(value);
  if (frac < 0.021 || frac > 0.979) return true;
  return FRACTIONS.some(([n]) => Math.abs(frac - n) < 0.021);
}

/**
 * Choose the unit a total is easiest to act on in.
 *
 * A plain "first unit at or above 1" walk renders half a cup as "8 tbsp",
 * which is correct but reads like a machine wrote it. So for US units — where
 * fractional cups and pounds are how people actually shop — a larger unit is
 * allowed to win from a quarter upwards, but only when the value lands on a
 * clean fraction. That gives "1/2 cup" for 118 ml, while 192 ml (0.81 of a
 * cup, which has no tidy fraction) still falls through to a precise
 * "13 tbsp" rather than an ugly "0.81 cups".
 *
 * Metric keeps the >= 1 rule: 500 g is idiomatic, 0.5 kg is not.
 */
function pickDisplayUnit(
  baseAmount: number,
  ladder: LadderStep[],
  system: MeasurementSystem,
): string {
  for (const step of ladder) {
    const value = fromBase(baseAmount, step.id);
    // A subdividable unit may win from a quarter up, but only on a clean
    // fraction — otherwise fall through to something precise.
    if (system === "us" && step.fractionable && value >= 0.25 && readsCleanly(value)) {
      return step.id;
    }
    if (value >= 1) return step.id;
  }
  // Smallest unit is the floor, so tiny amounts still render sensibly.
  return ladder[ladder.length - 1].id;
}

export interface FormattedQuantity {
  amount: string;
  unit: string;
  /** "1½ cups" — amount and unit joined with correct pluralisation. */
  text: string;
}

/**
 * Render a base-unit amount into the friendliest unit on the ladder.
 *
 * `countUnitId` is required for count buckets, since a count amount is
 * meaningless without knowing what is being counted.
 */
export function formatQuantity(
  baseAmount: number,
  bucket: string,
  system: MeasurementSystem = "us",
  countUnitId?: string,
): FormattedQuantity {
  if (bucket.startsWith("count:") || bucket === "count") {
    const unitId = countUnitId ?? (bucket.startsWith("count:") ? bucket.slice(6) : "each");
    const unit = UNITS[unitId];
    const amount = formatAmount(baseAmount, system);
    const label = !unit || unit.label === "" ? "" : pluralise(unit, baseAmount);
    return { amount, unit: label, text: label ? `${amount} ${label}` : amount };
  }

  const ladder =
    bucket === "mass" ? MASS_LADDER[system] : bucket === "volume" ? VOLUME_LADDER[system] : null;

  if (!ladder) {
    const amount = formatAmount(baseAmount, system);
    return { amount, unit: "", text: amount };
  }

  const unitId = pickDisplayUnit(baseAmount, ladder, system);
  const value = fromBase(baseAmount, unitId);
  const unit = UNITS[unitId];
  const amount = formatAmount(value, system);
  const label = pluralise(unit, value);
  return { amount, unit: label, text: `${amount} ${label}` };
}
