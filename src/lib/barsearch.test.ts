import { afterEach, describe, expect, it } from "vitest";
import { MAIN_SEARCH, barSearchValue, onBarSearch } from "./barsearch";
import layout from "../layouts/SiteLayout.astro?raw";
import today from "../pages/index.astro?raw";
import recipes from "../pages/recipes/index.astro?raw";
import prices from "../pages/edit/prices.astro?raw";
import recipeBrowser from "../components/RecipeBrowser.tsx?raw";
import priceEditor from "../components/PriceEditor.tsx?raw";
import planner from "../components/Planner.tsx?raw";

const g = globalThis as Record<string, unknown>;
afterEach(() => {
  delete g.window;
  delete g.document;
});

describe("the bar's search", () => {
  it("is Hestia's recipe search on every page without one of its own", () => {
    expect(MAIN_SEARCH).toEqual({ action: "/recipes", placeholder: "Search recipes" });
    expect(layout).toMatch(/search = MAIN_SEARCH/);
  });

  it("is drawn first in the bar's end, as a GET form of q, with sized icons", () => {
    const end = layout.slice(layout.indexOf('<div class="as-end">'));
    expect(end.indexOf('<form class="as-search"')).toBeGreaterThan(0);
    expect(end.indexOf('<form class="as-search"')).toBeLessThan(end.indexOf('class="as-switch"'));
    expect(end).toMatch(/action=\{withBase\(search\.action\)\} method="get" data-as-live=\{search\.live \|\| undefined\}/);
    expect(end).toMatch(/<input type="search" name="q"/);
    // keep: a page's other GET parameters ride along as hidden inputs.
    expect(end).toMatch(/search\.keep \?\? \{\}\)\.map\(\(\[name, value\]\) => <input type="hidden" name=\{name\} value=\{value\} \/>/);
    for (const [, px] of layout.matchAll(/sized\((?:SEARCH|CLOSE)_ICON, (\d+)\)/g)) expect(Number(px)).toBeGreaterThan(0);
    expect(layout).toMatch(/<svg width="\$\{px\}" height="\$\{px\}"/);
  });

  it("is live on Recipes (from ?q=) and on Prices", () => {
    expect(recipes).toMatch(/search=\{\{ action: "\/recipes", placeholder: "Search recipes", value: query, live: true \}\}/);
    expect(prices).toMatch(/search=\{\{ action: "\/edit\/prices", placeholder: "Search ingredients", live: true \}\}/);
  });

  it("leaves no search field of their own on Today, Recipes or Prices; the Planner keeps its filter", () => {
    for (const source of [today, recipes, prices, recipeBrowser, priceEditor]) expect(source).not.toMatch(/type="search"/);
    expect(today).not.toMatch(/role="search"/);
    expect(planner).toMatch(/placeholder="Filter…"/);
  });

  it("starts from the bar's field, and hands every change on until stopped", () => {
    const field = { value: "feta" };
    g.document = { querySelector: (sel: string) => (sel === ".as-top .as-search input[type=search]" ? field : null) };
    expect(barSearchValue()).toBe("feta");

    const target = new EventTarget();
    g.window = target;
    const seen: string[] = [];
    const stop = onBarSearch((q) => seen.push(q));
    target.dispatchEvent(new CustomEvent("as-search", { detail: { q: "lamb" } }));
    target.dispatchEvent(new CustomEvent("as-search", { detail: { q: "" } }));
    stop();
    target.dispatchEvent(new CustomEvent("as-search", { detail: { q: "ignored" } }));
    expect(seen).toEqual(["lamb", ""]);
  });

  it("is empty with no page around it (the server)", () => {
    expect(barSearchValue()).toBe("");
  });
});
