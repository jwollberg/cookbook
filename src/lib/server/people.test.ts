import { afterEach, describe, expect, it, vi } from "vitest";
import { accessFor, fromEnv, ownerKey, people, resetPeople } from "./people";

const env = { INTERNAL_TOKEN: "t", ALLOWED_EMAILS: "josh.wollberg@gmail.com", OWNER_EMAILS: "josh.wollberg@gmail.com", PEOPLE: "josh.wollberg@gmail.com=Josh" };
const home = [
  { email: "josh.wollberg@gmail.com", name: "Josh", owner: true, apps: ["home", "kitchen", "budget"] },
  { email: "pat@gmail.com", name: "Pat", owner: false, apps: ["home", "kitchen"] },
];

afterEach(() => {
  vi.unstubAllGlobals();
  resetPeople();
});

describe("the People list, as an app sees it", () => {
  it("asks Home, and answers who may use this app", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push(`${url} ${(init.headers as Record<string, string>)["X-Internal-Token"]}`);
      return new Response(JSON.stringify({ people: home }));
    });
    expect(await accessFor("Pat@Gmail.com", "kitchen", env)).toEqual({ allowed: true, owner: false, name: "Pat", apps: ["home", "kitchen"] });
    expect((await accessFor("pat@gmail.com", "budget", env)).allowed).toBe(false);
    expect((await accessFor("stranger@gmail.com", "kitchen", env)).allowed).toBe(false);
    expect(calls).toEqual(["http://atheos-home:8080/internal/people t"]);
  });

  it("keeps the last good answer while Home is away", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ people: home })));
    await people(env, "kitchen");
    vi.stubGlobal("fetch", async () => new Response("down", { status: 502 }));
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_000);
    expect((await accessFor("pat@gmail.com", "kitchen", env)).allowed).toBe(true);
    vi.restoreAllMocks();
  });

  it("uses the app's own lists until Home has answered once, so its owner is never locked out", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("connection refused");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await accessFor("josh.wollberg@gmail.com", "budget", env)).toEqual({ allowed: true, owner: true, name: "Josh", apps: ["budget"] });
    expect((await accessFor("pat@gmail.com", "budget", env)).allowed).toBe(false);
    vi.restoreAllMocks();
  });

  it("without INTERNAL_TOKEN (a dev server) uses the app's own lists", async () => {
    expect(fromEnv({ ALLOWED_EMAILS: "a@x.com, b@y.com" }, "kitchen").map((p) => p.email)).toEqual(["a@x.com", "b@y.com"]);
    expect((await accessFor("a@x.com", "kitchen", { ALLOWED_EMAILS: "a@x.com" })).allowed).toBe(true);
  });

  it("keys a person's data by one owner key, however their email is written", () => {
    const keys = ["josh.wollberg@gmail.com", "JoshWollberg@gmail.com", "josh.wollberg+x@gmail.com", " Josh.Wollberg@GoogleMail.com "].map(ownerKey);
    expect(new Set(keys)).toEqual(new Set(["joshwollberg@gmail.com"]));
    expect(ownerKey("Pat.Smith@Example.com")).toBe("pat.smith@example.com");
    expect(ownerKey("pat.smith@example.com")).not.toBe(ownerKey("patsmith@example.com"));
  });
});
