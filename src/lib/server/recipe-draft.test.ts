/**
 * Recipe drafts from a link or a photo: the page is read from public addresses only, its
 * schema.org Recipe goes to Claude when it has one, a photo is shrunk first, the draft's
 * ingredients link to the shared registry without guessing, nothing is saved, and the use is
 * counted against the person who asked (and forgotten with them). No call reaches Anthropic or
 * the web: both are faked.
 */

import { generateKeyPairSync } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiUsage, resetClaude } from "./claude";
import { openD1, type D1Database } from "./d1";
import { loadLibrary, upsertUser, type Viewer } from "./db";
import {
  draftToRecipe,
  fetchPage,
  FAKE_LINK_DRAFT,
  isPrivateAddress,
  pageText,
  recipeJsonLd,
  type Draft,
} from "./recipe-draft";
import type { Ingredient } from "../schema";
import { POST as linkRoute } from "../../pages/api/drafts/link";
import { POST as photoRoute } from "../../pages/api/drafts/photo";
import { POST as forgetRoute } from "../../pages/internal/forget";

const MIGRATIONS = join(process.cwd(), "migrations");
const REGISTRY: Ingredient[] = JSON.parse(readFileSync(join(process.cwd(), "seed", "ingredients.json"), "utf8"));
const byName = (name: string) => REGISTRY.find((i) => i.name === name)!;

let dir: string;
let db: D1Database;
let keyFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kitchen-draft-"));
  const migrations = join(dir, "migrations");
  mkdirSync(migrations);
  for (const name of readdirSync(MIGRATIONS)) copyFileSync(join(MIGRATIONS, name), join(migrations, name));
  db = openD1(join(dir, "app.sqlite"), migrations);
  const insert = db.sqlite.prepare("INSERT INTO ingredients (id, data, updated_at) VALUES (?, ?, ?)");
  for (const i of REGISTRY) insert.run(i.id, JSON.stringify(i), "2026-10-01T00:00:00.000Z");
  keyFile = join(dir, "claude-wif.key");
  writeFileSync(keyFile, generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetClaude();
  db?.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const signedIn = () => ({
  ANTHROPIC_ORGANIZATION_ID: "62126109-ee75-47a4-840b-6241d6473261",
  ANTHROPIC_FEDERATION_RULE_ID: "fdrl_rule",
  ANTHROPIC_SERVICE_ACCOUNT_ID: "svac_account",
  CLAUDE_WIF_KEY_FILE: keyFile,
});

/** What an API route sees: the request plus the locals the middleware sets. */
function call(route: (context: never) => Response | Promise<Response>, viewer: Viewer, request: Request, env: Partial<Env> = {}) {
  const context = {
    request,
    params: {},
    url: new URL(request.url),
    locals: { viewer, runtime: { env: { DB: db, ...env }, cf: {}, ctx: { waitUntil() {} } } },
  };
  return Promise.resolve(route(context as never));
}

const draft = (more: Partial<Draft> = {}): Draft => ({
  found: true,
  title: " Garlic Chickpeas ",
  description: null,
  servings: null,
  yieldNote: null,
  prepMin: 9.6,
  cookMin: null,
  restMin: -1,
  tags: ["Greek", "greek", " side "],
  ingredients: [
    { quantity: 2, unit: "clove", name: "garlic", note: "minced", optional: false, group: null, aisle: "produce" },
    { quantity: 1, unit: "each", name: "dragon fruit", note: null, optional: true, group: "To finish", aisle: "produce" },
    { quantity: 0.5, unit: "each", name: "Dragon fruit", note: null, optional: false, group: null, aisle: "produce" },
    { quantity: null, unit: "toTaste", name: "yuzu kosho", note: null, optional: false, group: null, aisle: "spices" },
    { quantity: 1, unit: "each", name: "  ", note: null, optional: false, group: null, aisle: "other" },
  ],
  steps: [
    { text: "Fry the garlic.", heading: null, group: null },
    { text: "  ", heading: null, group: null },
  ],
  notes: "",
  ...more,
});

const RECIPE_PAGE = `<html><head><title>Pie</title>
<script type="application/ld+json">{ not json </script>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"Pie page"},
{"@type":["Recipe","NewsArticle"],"name":"Apple Pie","recipeYield":"8","prepTime":"PT30M","recipeIngredient":["6 apples","1 cup sugar"],
"recipeInstructions":[{"@type":"HowToStep","text":"Bake it."}],"author":{"name":"Someone"},"aggregateRating":{"ratingValue":5}}]}</script>
<style>body{color:red}</style></head><body><nav>Home · Recipes · Shop</nav><h1>Apple Pie</h1><p>My grandmother&#39;s pie &amp; its story.</p>
<script>track()</script></body></html>`;

/** The web and Anthropic, faked: pages by address, Claude answering `reply` (as JSON text). */
function fakeWorld(pages: Record<string, Response | (() => Response)>, reply: unknown) {
  const seen = { pages: [] as string[], messages: [] as Record<string, any>[] };
  vi.stubGlobal("fetch", async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url instanceof Request ? url.url : url);
    if (u.startsWith("https://api.anthropic.com/")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (u.endsWith("/v1/oauth/token")) return Response.json({ access_token: "sk-ant-oat01-x", token_type: "Bearer", expires_in: 598 });
      seen.messages.push(body);
      return Response.json({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: body.model,
        content: [{ type: "text", text: JSON.stringify(reply) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 2000, output_tokens: 600 },
      });
    }
    seen.pages.push(u);
    const page = pages[u];
    if (!page) return new Response("nope", { status: 404 });
    return typeof page === "function" ? page() : page;
  });
  return seen;
}

const html = (body: string) => new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });

describe("a draft becomes an unsaved recipe", () => {
  it("links ingredients the registry knows and makes the rest once, without saving anything", () => {
    const { recipe, created } = draftToRecipe(draft(), REGISTRY, "https://example.com/chickpeas");
    expect(recipe.id).toBe("");
    expect(recipe).toMatchObject({ title: "Garlic Chickpeas", servings: 4, prepMin: 10, cookMin: 0, restMin: 0, sourceUrl: "https://example.com/chickpeas" });
    expect(recipe.tags).toEqual(["greek", "side"]);
    expect(recipe.notes).toBeUndefined();
    expect(recipe.steps).toEqual([{ text: "Fry the garlic." }]);

    const [garlic, fruit, fruitAgain, salt] = recipe.ingredients;
    expect(recipe.ingredients).toHaveLength(4);
    expect(garlic).toMatchObject({ ingredientId: byName("garlic").id, quantity: 2, unit: "clove", note: "minced" });
    expect(fruit).toMatchObject({ ingredientId: "dragon-fruit", optional: true, group: "To finish" });
    expect(fruitAgain.ingredientId).toBe("dragon-fruit");
    expect(salt).toMatchObject({ unit: "toTaste", quantity: 1 });
    expect(created.map((i) => i.id)).toEqual(["dragon-fruit", "yuzu-kosho"]);
    expect(created[0]).toEqual({ id: "dragon-fruit", name: "dragon fruit", aisle: "produce", aliases: [], isStaple: false });
  });
});

describe("reading a recipe page", () => {
  it("finds the schema.org Recipe in a @graph, skips a broken block and keeps only the recipe's fields", () => {
    expect(recipeJsonLd(RECIPE_PAGE)).toEqual({
      name: "Apple Pie",
      recipeYield: "8",
      prepTime: "PT30M",
      recipeIngredient: ["6 apples", "1 cup sugar"],
      recipeInstructions: [{ "@type": "HowToStep", text: "Bake it." }],
    });
    expect(recipeJsonLd("<p>no data here</p>")).toBeNull();
  });

  it("keeps a page's words without its scripts, styles or menus", () => {
    const text = pageText(RECIPE_PAGE);
    expect(text).toContain("Apple Pie\nMy grandmother's pie & its story.");
    expect(text).not.toMatch(/track|color:red|Home · Recipes|ld\+json/);
  });

  it("knows the house's own addresses from the internet's", () => {
    for (const a of ["127.0.0.1", "192.168.1.22", "10.0.0.5", "172.18.0.4", "169.254.169.254", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:192.168.1.22"]) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
    for (const a of ["93.184.215.14", "8.8.8.8", "2606:4700::6810:84e5", "::ffff:8.8.8.8"]) expect(isPrivateAddress(a), a).toBe(false);
  });

  it("never fetches from Vault's own network, even through a redirect", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("public.example")
        ? new Response(null, { status: 302, headers: { Location: "http://atheos-home/internal/people" } })
        : html("secret"),
    );
    const resolve = async (host: string) => (host === "public.example" ? ["93.184.215.14"] : ["172.18.0.2"]);

    await expect(fetchPage("http://atheos-home/internal/people", fetcher, resolve)).rejects.toThrow("isn't on the public internet");
    await expect(fetchPage("https://public.example/pie", fetcher, resolve)).rejects.toThrow("isn't on the public internet");
    await expect(fetchPage("http://192.168.1.22/", fetcher, resolve)).rejects.toThrow("isn't on the public internet");
    expect(fetcher).toHaveBeenCalledTimes(1); // only the public page, never the private one
    await expect(fetchPage("file:///etc/passwd", fetcher, resolve)).rejects.toThrow("Only web pages");
    await expect(fetchPage("https://public.example:8443/", fetcher, resolve)).rejects.toThrow("isn't an ordinary web page");
    await expect(fetchPage("not a link", fetcher, resolve)).rejects.toThrow("doesn't look like a web address");
  });

  it("follows a redirect to another public page, and refuses what isn't a page", async () => {
    const fetcher = async (url: string | URL | Request) =>
      String(url) === "http://pie.example/"
        ? new Response(null, { status: 301, headers: { Location: "https://pie.example/recipe" } })
        : String(url).endsWith(".pdf")
          ? new Response("%PDF", { headers: { "Content-Type": "application/pdf" } })
          : html("<p>pie</p>");
    const resolve = async () => ["93.184.215.14"];
    expect(await fetchPage("http://pie.example/", fetcher as typeof fetch, resolve)).toBe("<p>pie</p>");
    await expect(fetchPage("https://pie.example/card.pdf", fetcher as typeof fetch, resolve)).rejects.toThrow("isn't a web page");
  });
});

describe("the draft routes", () => {
  let viewer: Viewer;
  const PAGE = "https://93.184.215.14/apple-pie";
  const pie = draft({ title: "Apple Pie", tags: [], ingredients: [draft().ingredients[0]] });

  beforeEach(async () => {
    viewer = await upsertUser(db, { id: "google-sub-josh", email: "josh.wollberg@gmail.com", name: "Josh" });
  });

  const postLink = (url: string, env: Partial<Env> = signedIn()) =>
    call(linkRoute, viewer, new Request("https://kitchen.test/api/drafts/link", { method: "POST", body: JSON.stringify({ url }) }), env);

  it("sends Claude the page's Recipe data, answers an unsaved draft and counts the call against the viewer", async () => {
    const seen = fakeWorld({ [PAGE]: html(RECIPE_PAGE) }, pie);
    const response = await postLink(PAGE);
    expect(response.status).toBe(200);
    const { recipe, created } = await response.json();
    expect(recipe).toMatchObject({ id: "", title: "Apple Pie", sourceUrl: PAGE });
    expect(created).toEqual([]);

    const [message] = seen.messages;
    expect(message).toMatchObject({ model: "claude-haiku-5-5", output_config: { effort: "low", format: { type: "json_schema" } } });
    const text = message.messages[0].content as string;
    expect(text).toContain('"recipeIngredient":["6 apples","1 cup sugar"]');
    expect(text).not.toContain("grandmother"); // the Recipe data, not the page's chatter
    expect(text).toContain("Known ingredients: ");

    expect(await aiUsage(db, viewer.id)).toMatchObject({ calls: 1 });
    expect((await loadLibrary(db)).recipes).toEqual([]);
  });

  it("sends the page's text when it has no Recipe data", async () => {
    const seen = fakeWorld({ [PAGE]: html(`<h1>Soup</h1><p>${"Simmer the onions slowly. ".repeat(6)}</p>`) }, pie);
    expect((await postLink(PAGE)).status).toBe(200);
    expect(seen.messages[0].messages[0].content).toContain("as the page's text");
  });

  it("says so when there's no recipe to find", async () => {
    fakeWorld({ [PAGE]: html(`<p>${"Welcome to my blog about my life. ".repeat(5)}</p>`) }, draft({ found: false, title: "", ingredients: [], steps: [] }));
    const response = await postLink(PAGE);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "Claude couldn't find a recipe in that page." });
  });

  it("refuses a private address before asking anyone", async () => {
    const seen = fakeWorld({}, pie);
    const response = await postLink("http://192.168.1.22:80/");
    expect(response.status).toBe(400);
    expect(seen.pages).toEqual([]);
    expect(seen.messages).toEqual([]);
  });

  it("refuses when Claude's sign-in isn't set up", async () => {
    fakeWorld({ [PAGE]: html(RECIPE_PAGE) }, pie);
    const response = await postLink(PAGE, {});
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/isn't set up/);
  });

  it("answers the dev server's canned draft with AI_FAKE=1", async () => {
    const seen = fakeWorld({ [PAGE]: html(RECIPE_PAGE) }, pie);
    const response = await postLink(PAGE, { AI_FAKE: "1" });
    const { recipe } = await response.json();
    expect(recipe.title).toBe(FAKE_LINK_DRAFT.title);
    expect(recipe.ingredients.find((r: { unit: string }) => r.unit === "clove").ingredientId).toBe(byName("garlic").id);
    expect(seen.messages).toEqual([]);
  });

  it("shrinks a photo to 900 px before Claude sees it, and never keeps it", async () => {
    const seen = fakeWorld({}, pie);
    const photo = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#f5e6c8" } }).png().toBuffer();
    const response = await call(
      photoRoute,
      viewer,
      new Request("https://kitchen.test/api/drafts/photo", { method: "POST", body: new Uint8Array(photo), headers: { "Content-Type": "image/png" } }),
      signedIn(),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).recipe).toMatchObject({ id: "", title: "Apple Pie" });

    const [image, words] = seen.messages[0].messages[0].content;
    expect(image.source.media_type).toBe("image/jpeg");
    const { width, height } = await sharp(Buffer.from(image.source.data, "base64")).metadata();
    expect([width, height]).toEqual([900, 600]);
    expect(words.text).toContain("photo of a cookbook page or recipe card");
    expect(await aiUsage(db, viewer.id)).toMatchObject({ calls: 1 });
  });

  it("refuses something that isn't a photo", async () => {
    const response = await call(
      photoRoute,
      viewer,
      new Request("https://kitchen.test/api/drafts/photo", { method: "POST", body: "hello", headers: { "Content-Type": "text/plain" } }),
      signedIn(),
    );
    expect(response.status).toBe(400);
  });

  it("forgets a person's count of Claude's use with the rest of their data", async () => {
    const other = await upsertUser(db, { id: "r", email: "reagenbrase@gmail.com" });
    fakeWorld({ [PAGE]: () => html(RECIPE_PAGE) }, pie);
    await postLink(PAGE);
    await call(linkRoute, other, new Request("https://kitchen.test/api/drafts/link", { method: "POST", body: JSON.stringify({ url: PAGE }) }), signedIn());

    const response = await call(
      forgetRoute,
      viewer,
      new Request("https://kitchen.test/internal/forget", { method: "POST", body: JSON.stringify({ email: "Josh.Wollberg@gmail.com" }) }),
    );
    expect(response.status).toBe(200);
    expect(await aiUsage(db, viewer.id)).toMatchObject({ calls: 0 });
    expect(await aiUsage(db, other.id)).toMatchObject({ calls: 1 });
  });
});
