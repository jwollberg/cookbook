import { describe, expect, it } from "vitest";
import menuJs from "../menu.js?raw";
import themeJs from "../theme.js?raw";
import { scriptHash } from "./security";
import { POLICY, refusesWrite } from "./shared-address";

const SHARED = "https://oikos.atheosstudios.com";
const OWN = "https://hestia.atheosstudios.com";

function write(origin: string, path: string, referer?: string, method = "POST") {
  const headers: Record<string, string> = { Origin: origin, "Sec-Fetch-Site": "same-origin" };
  if (referer !== undefined) headers.Referer = `${origin}${referer}`;
  return new Request(`${origin}${path}`, { method, headers });
}

describe("served from oikos.atheosstudios.com/hestia", () => {
  const base = "/hestia";

  it("takes a write from Hestia's own pages", () => {
    expect(refusesWrite(write(SHARED, "/hestia/api/shopping", "/hestia/shopping"), "/api/shopping", base)).toBe(false);
    expect(refusesWrite(write(SHARED, "/hestia/api/plans/x", "/hestia/plan", "PUT"), "/api/plans/x", base)).toBe(false);
    expect(refusesWrite(write(SHARED, "/hestia/api/recipes/x", "/hestia", "DELETE"), "/api/recipes/x", base)).toBe(false);
  });

  it("refuses a write from another app's folder, or Oikos's own pages", () => {
    for (const from of ["/tamias/", "/tamias/settings", "/telos/today", "/hestiax/", "/", "/people"]) {
      expect(refusesWrite(write(SHARED, "/hestia/api/shopping", from), "/api/shopping", base)).toBe(true);
    }
  });

  it("refuses a write with no Referer, or from another site", () => {
    expect(refusesWrite(write(SHARED, "/hestia/api/shopping"), "/api/shopping", base)).toBe(true);
    const cross = new Request(`${SHARED}/hestia/api/shopping`, {
      method: "PATCH",
      headers: { Origin: "https://evil.example", Referer: "https://evil.example/hestia/", "Sec-Fetch-Site": "cross-site" },
    });
    expect(refusesWrite(cross, "/api/shopping", base)).toBe(true);
  });

  it("leaves /internal/ to its token, and reads to the gate", () => {
    const vault = new Request("http://atheos-kitchen-pilot:8080/hestia/internal/forget", { method: "POST" });
    expect(refusesWrite(vault, "/internal/forget", base)).toBe(false);
    expect(refusesWrite(new Request("http://atheos-kitchen-pilot:8080/internal/glance", { method: "POST" }), "/internal/glance", base)).toBe(false);
    expect(refusesWrite(new Request(`${SHARED}/hestia/recipes`), "/recipes", base)).toBe(false);
    expect(refusesWrite(new Request(`${SHARED}/hestia/recipes`, { method: "HEAD" }), "/recipes", base)).toBe(false);
  });
});

describe("served from hestia.atheosstudios.com", () => {
  it("takes a same-origin write, with or without a Referer", () => {
    expect(refusesWrite(write(OWN, "/api/shopping", "/shopping"), "/api/shopping", "")).toBe(false);
    expect(refusesWrite(write(OWN, "/api/shopping"), "/api/shopping", "")).toBe(false);
  });

  it("refuses one from another origin, and exempts /internal/", () => {
    const cross = new Request(`${OWN}/api/shopping`, { method: "POST", headers: { Origin: SHARED } });
    expect(refusesWrite(cross, "/api/shopping", "")).toBe(true);
    expect(refusesWrite(new Request("http://atheos-kitchen:8080/internal/forget", { method: "POST" }), "/internal/forget", "")).toBe(false);
  });
});

describe("the Content-Security-Policy", () => {
  const directive = (name: string) => POLICY.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

  it("runs no inline script but the layout's two, by hash, and never eval", () => {
    const scripts = directive("script-src");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
    expect(scripts).toContain(scriptHash(themeJs));
    expect(scripts).toContain(scriptHash(menuJs));
    expect(POLICY).toContain("script-src-attr 'none'");
  });

  it("loads images only from Hestia and Google's account pictures", () => {
    expect(directive("img-src")).toBe("img-src 'self' data: blob: https://lh3.googleusercontent.com");
    expect(directive("connect-src")).toBe("connect-src 'self'");
    expect(POLICY).toContain("frame-src 'none'");
  });
});
