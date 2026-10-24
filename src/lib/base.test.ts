import { afterEach, describe, expect, it, vi } from "vitest";

// BASE is read once, when lib/base.ts loads: each case loads it afresh under its own BASE_URL.
async function load(baseUrl: string) {
  vi.resetModules();
  vi.stubEnv("BASE_URL", baseUrl);
  return import("./base");
}

afterEach(() => vi.unstubAllEnvs());

describe("served from its own hostname", () => {
  it("leaves every path as it is", async () => {
    const { withBase, routePath } = await load("/");
    expect(withBase("/recipes")).toBe("/recipes");
    expect(withBase("/")).toBe("/");
    expect(routePath("/recipes/apple-crisp")).toBe("/recipes/apple-crisp");
  });
});

describe("served from oikos.atheosstudios.com/hestia", () => {
  it("puts the app's own paths under the folder", async () => {
    const { withBase } = await load("/hestia");
    expect(withBase("/")).toBe("/hestia/");
    expect(withBase("/recipes?q=soup")).toBe("/hestia/recipes?q=soup");
    expect(withBase("/photos/recipes/x/1.jpg")).toBe("/hestia/photos/recipes/x/1.jpg");
  });

  it("leaves other addresses alone", async () => {
    const { withBase } = await load("/hestia/");
    expect(withBase("/cdn-cgi/access/logout")).toBe("/cdn-cgi/access/logout");
    expect(withBase("https://lh3.googleusercontent.com/a/x")).toBe("https://lh3.googleusercontent.com/a/x");
    expect(withBase("//cdn.example.com/x.png")).toBe("//cdn.example.com/x.png");
    expect(withBase("blob:http://x/1")).toBe("blob:http://x/1");
    expect(withBase("#main")).toBe("#main");
    expect(withBase(undefined)).toBeUndefined();
  });

  it("reads a request's path without the folder", async () => {
    const { routePath } = await load("/hestia");
    expect(routePath("/hestia")).toBe("/");
    expect(routePath("/hestia/")).toBe("/");
    expect(routePath("/hestia/api/shopping")).toBe("/api/shopping");
    expect(routePath("/hestiax/recipes")).toBe("/hestiax/recipes");
  });
});
