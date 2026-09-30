import { describe, it, expect } from "vitest";
import { slugify, uniqueSlug } from "./slug";

describe("slugs", () => {
  it("makes schema-valid kebab-case ids", () => {
    expect(slugify("Greek Lemon Potatoes")).toBe("greek-lemon-potatoes");
    expect(slugify("  Mum's  Best!! Stew  ")).toBe("mum-s-best-stew");
    expect(slugify("Crème Brûlée")).toBe("creme-brulee");
  });

  it("avoids collisions", () => {
    expect(uniqueSlug("Soup", ["soup"])).toBe("soup-2");
    expect(uniqueSlug("Soup", ["soup", "soup-2"])).toBe("soup-3");
    expect(uniqueSlug("Soup", [])).toBe("soup");
  });

  it("never produces an empty id", () => {
    expect(uniqueSlug("!!!", [])).toBe("untitled");
  });
});
