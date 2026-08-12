# Cookbook — working notes

Personal cookbook app: recipes → meals → weekly plan → generated cooking sheet + shopping list.

- **Live at** `https://cookbook.atheosstudios.com` (GitHub Pages, repo `jwollberg/cookbook`).
- **Sibling property:** `jwollberg/atheosstudios` owns `atheosstudios.com`. They are *separate*
  repos and separate Pages sites. Never edit one expecting the other to change.
- DNS is Cloudflare. The `cookbook` CNAME points at `jwollberg.github.io` and must stay
  **DNS-only (grey cloud)** — proxying it breaks GitHub's certificate validation.

## Architecture

Static site. No server, no database service, no backend anywhere.

```
Browser ──read──>  /data/*.json          (static, same origin, no auth)
        ──write─>  GitHub Git Data API   ──> commit ──> Actions ──> Pages redeploy
```

**The repo is the database.** All content lives as JSON under `public/data/`. That directory is the
single source of truth: Astro reads it at build time to generate static pages, and it is served
verbatim for runtime fetch. One location, so a build copy can never drift from a source copy.

**Reads need no authentication.** The site is public, so anything can fetch `/data/*.json` directly.
Auth exists only to *write*.

**Writes are local-first.** A commit triggers a Pages rebuild taking ~40–60s, far too slow to sit
behind a save button. Writes apply to an in-browser cache immediately, then push to GitHub in the
background. On load the app reads the built snapshot, then overlays fresher content from the GitHub
API if a token is present.

**Writes are atomic.** Saving a recipe often touches several files at once (the recipe, plus any new
ingredients it introduced). Use the **Git Data API** — blobs → tree → commit → update ref — never
sequential single-file PUTs, which can fail halfway and leave a recipe referencing an ingredient
that was never written.

**Auth is one fine-grained PAT** scoped to only this repo with `Contents: read/write`, held in
`localStorage`. Editing affordances stay hidden unless a token is present, so the public view is
clean and read-only.

## Client data loading

`/data/all.json` is generated at build time by `src/pages/data/all.json.ts` from the same loader
the pages use. A static host cannot list a directory, so the browser has no way to discover which
recipe files exist — this is that index, and it cannot drift because it is derived, not maintained.
The individual files under `public/data/` remain the source of truth the editor writes to.

Two loaders, deliberately separate — do not cross them:
- `src/lib/data.server.ts` — build time, uses `node:fs`. Never import from a React island.
- `src/lib/store.ts` — browser, fetches `/data/all.json`. Never import from Astro frontmatter.

## Reconcile rule (`mergeStash`)

A save writes to a local stash immediately and commits in the background, because a Pages rebuild
takes ~40–60s. On load the published bundle is fetched and the stash laid over the top.

**A stash entry is kept only while its `updatedAt` is strictly newer than the published copy's.**
Once the published copy catches up the entry is dropped. Getting this backwards is invisible in the
UI and permanent: a stale local copy would shadow every later edit made from another device. It is
covered by `store.test.ts` — keep it that way.

## Data model

`public/data/`
- `ingredients.json` — one canonical registry. Recipes reference ingredients **by id**, never by
  free text. This is what makes shopping-list aggregation possible at all.
- `recipes/<slug>.json`
- `meals/<slug>.json` — components with roles (main / side / starter / dessert / drink / sauce)
- `plans/<id>.json` — days → slots → meal or recipe, with servings
- `pantry.json` — what's already on hand

## Units and aggregation — read before touching `src/lib/units.ts`

Three dimensions with canonical bases: **MASS** (gram), **VOLUME** (millilitre), **COUNT** (each).
Within a dimension conversion is a fixed ratio. Across dimensions it needs the ingredient's own
physics: volume→mass requires `gramsPerMl`, count→mass requires `gramsPerEach`.

**When a cross-dimension factor is missing, do not guess.** Emit the line separately
(`500 g chicken` + `2 breasts`) rather than inventing a conversion. A silently wrong shopping
quantity is worse than a visibly split one, and the split doubles as a prompt to fill in the missing
factor on that ingredient.

Pipeline order is load-bearing — scaling must happen before summing, and pantry subtraction before
pretty-printing:

```
plan → expand meals to recipes → scale by servings → flatten to ingredient lines
     → convert to base units → sum per ingredient → subtract pantry → group by aisle
     → render back into human units
```

Conversion bugs are invisible in the UI but corrupt every shopping list, so `units.ts` and
`shopping.ts` carry real vitest coverage. Keep it that way.

## Design

Warm editorial, not app chrome. Driven by where this is actually read: propped on a counter at arm's
length while cooking, and one-handed on a phone in a supermarket aisle.

- Warm cream/ink palette. Warm near-black `#221D18`, **not** blue-black — blue-blacks read cold and
  clinical next to food.
- **Fraunces** (display) + **Inter** (UI/body). Tokens live in `src/styles/global.css`.
- Terracotta `#B4471F` primary, olive `#5C6B3C` secondary. Both clear AA on cream.
- Soft radii and hairline rules, not hard borders — heavy rules on every row are exhausting when
  scanning a 40-line list.
- Quantities use tabular numerals (`.num`, `.ing-qty`) so they align down a column. An ingredient
  list that doesn't align has to be read line by line instead of scanned.
- Min 42px tap targets: this gets used one-handed with wet hands.
- Aisle colours are **data, not decoration** — a shopping list is only usable in a store if sections
  are distinguishable at a glance.

## Commands

```bash
npm run dev      # 127.0.0.1:4321
npm run build    # astro check && astro build
npm test         # vitest
```

CI (`.github/workflows/deploy.yml`) runs tests before building, so a broken conversion test blocks
the deploy. Pushing to `main` deploys.
