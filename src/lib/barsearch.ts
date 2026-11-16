/**
 * The bar's search (app-shell README "Search in the bar"). Every page has one, in the top bar:
 * Recipes and Edit → Prices search their own list as you type (the form carries data-as-live and
 * the shell fires "as-search" on window); every other page sends Enter to /recipes?q=.
 * Pure, used on both sides: the layout draws it, the islands listen to it.
 */
export interface BarSearch {
  /** A root path ("/recipes"); the layout puts it under the build's folder. */
  action: string;
  placeholder: string;
  /** The starting text, e.g. Recipes' ?q=. */
  value?: string;
  /** The page searches its own list as you type; Enter never navigates. */
  live?: boolean;
  /** Other GET parameters that survive a search, drawn as hidden inputs. */
  keep?: Record<string, string>;
}

/** Hestia's main search, on every page without one of its own. */
export const MAIN_SEARCH: BarSearch = { action: "/recipes", placeholder: "Search recipes" };

/** The bar's field, where the page's own search starts from. */
export const BAR_INPUT = ".as-top .as-search input[type=search]";

/** The text in the bar's field when the page loaded ("" with no bar, e.g. on the server). */
export function barSearchValue(): string {
  if (typeof document === "undefined") return "";
  return document.querySelector<HTMLInputElement>(BAR_INPUT)?.value ?? "";
}

/** Calls `run` with the bar's text on every change; the returned function stops listening. */
export function onBarSearch(run: (q: string) => void): () => void {
  const listen = (event: Event) => run(String((event as CustomEvent<{ q?: unknown }>).detail?.q ?? ""));
  window.addEventListener("as-search", listen);
  return () => window.removeEventListener("as-search", listen);
}
