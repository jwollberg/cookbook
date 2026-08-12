import { describe, it, expect } from "vitest";
import {
  bucketKey,
  dimensionOf,
  formatAmount,
  formatQuantity,
  formatUnitQuantity,
  fromBase,
  resolveUnit,
  toBase,
  toGrams,
} from "./units";

describe("resolveUnit", () => {
  it("resolves canonical ids, labels, plurals and aliases", () => {
    expect(resolveUnit("cup")).toBe("cup");
    expect(resolveUnit("cups")).toBe("cup");
    expect(resolveUnit("tablespoon")).toBe("tbsp");
    expect(resolveUnit("Tbsp")).toBe("tbsp");
    expect(resolveUnit("grams")).toBe("g");
    expect(resolveUnit("lbs")).toBe("lb");
    expect(resolveUnit("garbage")).toBeNull();
  });

  it("treats a blank unit as a bare count", () => {
    expect(resolveUnit("")).toBe("each");
    expect(resolveUnit("  ")).toBe("each");
  });
});

describe("bucketKey", () => {
  it("collapses mass and volume to one bucket each", () => {
    expect(bucketKey("g")).toBe("mass");
    expect(bucketKey("lb")).toBe("mass");
    expect(bucketKey("cup")).toBe("volume");
    expect(bucketKey("ml")).toBe("volume");
  });

  it("gives every count unit its own bucket", () => {
    // The rule that stops "2 cloves" being merged with "2 heads".
    expect(bucketKey("clove")).toBe("count:clove");
    expect(bucketKey("head")).toBe("count:head");
    expect(bucketKey("each")).toBe("count:each");
    expect(bucketKey("clove")).not.toBe(bucketKey("head"));
  });
});

describe("toBase / fromBase", () => {
  it("converts within mass", () => {
    expect(toBase(1, "kg")).toBe(1000);
    expect(toBase(1, "lb")).toBeCloseTo(453.592, 2);
    expect(fromBase(453.59237, "lb")).toBeCloseTo(1, 6);
  });

  it("converts within volume", () => {
    expect(toBase(1, "cup")).toBeCloseTo(236.588, 2);
    expect(toBase(3, "tsp")).toBeCloseTo(toBase(1, "tbsp"), 6);
    expect(toBase(1, "l")).toBe(1000);
  });

  it("round-trips", () => {
    expect(fromBase(toBase(2.5, "cup"), "cup")).toBeCloseTo(2.5, 9);
  });

  it("throws on an unknown unit rather than silently returning zero", () => {
    expect(() => toBase(1, "furlong")).toThrow();
  });
});

describe("toGrams", () => {
  it("passes mass straight through", () => {
    expect(toGrams(250, "mass", undefined)).toBe(250);
  });

  it("uses density for volume", () => {
    // Olive oil, 0.918 g/ml.
    expect(toGrams(100, "volume", { gramsPerMl: 0.918 })).toBeCloseTo(91.8, 6);
  });

  it("uses per-unit weight for a count", () => {
    expect(toGrams(4, "count:clove", { countWeights: { clove: 5 } })).toBe(20);
  });

  it("REFUSES to guess when the factor is missing", () => {
    // This null is the whole safety mechanism. If it ever starts returning a
    // number, every shopping list silently gains invented quantities.
    expect(toGrams(100, "volume", undefined)).toBeNull();
    expect(toGrams(100, "volume", { countWeights: { each: 5 } })).toBeNull();
    expect(toGrams(2, "count:head", { countWeights: { clove: 5 } })).toBeNull();
    expect(toGrams(2, "count:each", undefined)).toBeNull();
  });

  it("refuses a zero or negative factor rather than producing zero grams", () => {
    expect(toGrams(100, "volume", { gramsPerMl: 0 })).toBeNull();
  });
});

describe("formatAmount", () => {
  it("snaps to fractions a cook can act on", () => {
    expect(formatAmount(0.5, "us")).toBe("½");
    expect(formatAmount(0.25, "us")).toBe("¼");
    expect(formatAmount(1.5, "us")).toBe("1½");
    // 1/3 as a decimal must not render as "0.33".
    expect(formatAmount(1 / 3, "us")).toBe("⅓");
    expect(formatAmount(2.75, "us")).toBe("2¾");
  });

  it("drops a negligible fraction to a whole number", () => {
    expect(formatAmount(3.004, "us")).toBe("3");
  });

  it("does not use fractions for large amounts", () => {
    expect(formatAmount(12.4, "us")).toBe("12");
  });

  it("uses decimals for metric", () => {
    expect(formatAmount(0.5, "metric")).toBe("0.5");
    expect(formatAmount(501.2, "metric")).toBe("501");
  });
});

describe("formatQuantity", () => {
  it("walks down the mass ladder", () => {
    expect(formatQuantity(1000, "mass", "metric").text).toBe("1 kg");
    expect(formatQuantity(500, "mass", "metric").text).toBe("500 g");
    expect(formatQuantity(453.59237, "mass", "us").text).toBe("1 lb");
  });

  it("falls back to the smallest unit rather than rendering a fraction of a large one", () => {
    expect(formatQuantity(5, "mass", "metric").text).toBe("5 g");
    expect(formatQuantity(10, "volume", "metric").text).toBe("10 ml");
  });

  it("prefers a larger US unit when it lands on a clean fraction", () => {
    // Half a cup must not render as "8 tbsp" — technically right, reads like
    // a machine wrote it.
    expect(formatQuantity(toBase(0.5, "cup"), "volume", "us").text).toBe("½ cup");
    expect(formatQuantity(toBase(0.25, "cup"), "volume", "us").text).toBe("¼ cup");
    expect(formatQuantity(toBase(2.5, "lb"), "mass", "us").text).toBe("2½ lb");
  });

  it("never subdivides a unit cooks do not subdivide", () => {
    // A cup of parsley is "1 cup", not "¼ quart".
    expect(formatQuantity(toBase(1, "cup"), "volume", "us").text).toBe("1 cup");
    // A teaspoon of pepper is "1 tsp", not "⅓ tbsp".
    expect(formatQuantity(toBase(1, "tsp"), "volume", "us").text).toBe("1 tsp");
    expect(formatQuantity(toBase(2, "tsp"), "volume", "us").text).toBe("2 tsp");
    // 7 oz of feta stays in ounces rather than becoming 0.44 lb.
    expect(formatQuantity(toBase(7, "oz"), "mass", "us").text).toBe("7 oz");
  });

  it("falls back to a precise smaller unit when the larger one is untidy", () => {
    // 192.23 ml is 0.81 of a cup — no tidy fraction, so "13 tbsp" beats
    // "0.81 cups".
    expect(formatQuantity(192.23, "volume", "us").text).toBe("13 tbsp");
  });

  it("keeps metric on whole base units rather than fractions of a big one", () => {
    // 500 g is idiomatic; 0.5 kg is not.
    expect(formatQuantity(500, "mass", "metric").text).toBe("500 g");
    expect(formatQuantity(toBase(0.5, "l"), "volume", "metric").text).toBe("500 ml");
  });

  it("pluralises count units and omits the label for bare counts", () => {
    expect(formatQuantity(1, "count:clove", "us").text).toBe("1 clove");
    expect(formatQuantity(4, "count:clove", "us").text).toBe("4 cloves");
    expect(formatQuantity(3, "count:each", "us").text).toBe("3");
  });

  it("keeps fractions singular", () => {
    // English takes the singular below one: "½ cup", not "½ cups".
    expect(formatQuantity(toBase(0.5, "cup"), "volume", "us").unit).toBe("cup");
    expect(formatQuantity(0.5, "count:clove", "us").text).toBe("½ clove");
    expect(formatUnitQuantity(0.5, "cup")).toBe("½ cup");
    expect(formatUnitQuantity(1, "cup")).toBe("1 cup");
    expect(formatUnitQuantity(1.5, "cup")).toBe("1½ cups");
  });
});

describe("dimensionOf", () => {
  it("classifies units", () => {
    expect(dimensionOf("kg")).toBe("mass");
    expect(dimensionOf("tbsp")).toBe("volume");
    expect(dimensionOf("clove")).toBe("count");
    expect(dimensionOf("nope")).toBeNull();
  });
});
