# Kitchen — working notes

Private household kitchen app: shared recipes → meals → a weekly plan per household → generated
cooking sheet + one aggregated shopping list.

- **Live at** `https://kitchen.atheosstudios.com` — a Node server on **Vault** (Josh's Unraid
  server) behind a Cloudflare Tunnel and Cloudflare Access, repo `jwollberg/cookbook` (the repo
  name predates the rename to Kitchen). Hosting, operations and secrets:
  `../Websites/Website-Home/vault/README.md`.
- **Sibling property:** `jwollberg/atheosstudios` owns `atheosstudios.com`. Separate repo, separate
  hosting. Never edit one expecting the other to change.
- Astro SSR on Node (`@astrojs/node`, standalone), SQLite through a D1-shaped API
  (`src/lib/server/d1.ts`), photos in a folder through an R2-shaped API
  (`src/lib/server/bucket.ts`); `src/lib/server/platform.ts` builds `locals.runtime` from the
  environment. Sign-in is Cloudflare Access (see below).

## Architecture

```
Browser ──► Cloudflare Access ──► tunnel ──► Node on Vault (Astro SSR via @astrojs/node)
              ├─ src/middleware.ts   Google sign-in gate on EVERY page and API route
              ├─ pages render from SQLite per request
              ├─ /api/*              JSON writes, straight to SQLite — live the moment they return
              └─ /photos/*           uploaded photos from the photos folder (behind the gate too)
            /data/app.sqlite   users, households, library docs, household planning docs
            /data/photos/      uploaded photos
```

- **Everything is rendered by the server, behind sign-in.** Static files (`dist/client/`: JS, CSS,
  the starter photos in `public/images/`) are served *before* the middleware runs and skip its
  gate (Access still stands in front). So **nothing private may ever be a static file** — no
  prerendered pages, no data under `public/`.
- **Documents, validated.** Recipes, meals, ingredients, plans and the shopping list are JSON
  documents in the database, parsed with the zod schemas in `src/lib/schema.ts` on every read and write. The
  aggregation code consumes whole documents; do not normalise them into columns.
- **Recipe saves are atomic**: a recipe plus any ingredients it introduced go in one `db.batch`, so a
  recipe can never reference an ingredient that failed to write. The server also refuses a recipe
  whose ingredient ids do not exist.
- **The seed** (`seed/*.json`) is the starter library, loaded with `scripts/seed.mjs` using
  `INSERT OR IGNORE` — once live, the database is the source of truth and re-seeding never overwrites an edit.
  `src/lib/data.test.ts` validates the seed (schema, referential integrity, the Greek-dinner totals).

### Loaders — do not cross them

- `src/lib/server/*` — server only (the database, cookies, secrets). Never import from a React island.
- `src/lib/api.ts` — browser only (fetch to `/api/*`). Never import from Astro frontmatter.
- `src/lib/{units,shopping,scaling,list,plans,dates,format}.ts` — pure, used on both sides.
- `src/lib/constants.ts` holds the enums so islands can use them without pulling zod into the bundle.

## Sign-in and access

- **Cloudflare Access does the sign-in** — Google, the one login shared by every Atheos app
  (Home, Budget, the trackers). Access app "Kitchen" on `kitchen.atheosstudios.com`, policy
  "Household (Josh, Reagen, Gwen)", Google as the only identity provider, 30-day sessions. Team
  domain `atheosstudios.cloudflareaccess.com`. The Google OAuth client behind it lives in the
  Google project `atheos-access` (Testing mode, so a new person must also be a **test user**
  there).
- **The server re-checks everything** (`src/middleware.ts`, `src/lib/server/access.ts`): the
  Access JWT's signature against the team's keys, its audience (`ACCESS_AUD`), issuer and expiry,
  then the email against `ALLOWED_EMAILS` (compared the way Gmail does). Anything missing or
  wrong fails closed (403), so a mistake in the Access policy still lets nobody in. The list is
  checked on **every request**, so removing someone locks them out immediately.
- **Adding someone = three places:** the Access policy, `ALLOWED_EMAILS` (in Kitchen's `app.env`
  on Vault), and a test user in `atheos-access`.
- People are matched **by email** (`userForEmail` in `db.ts`): users from the old Google-OAuth
  days are keyed by their Google `sub`, newcomers by a random id. Access sends only the address,
  so a newcomer's household is named from it ("Gwenevere's Kitchen") — rename it on /household.
- `OWNER_EMAILS` (Josh) sees every app in the app switcher; everyone else sees Home and Kitchen.
- Sign out is `/cdn-cgi/access/logout`. The old `/login` and `/auth/*` pages are gone and
  redirect home. (`kitchen-atheos`, the Google project the old login used, was deleted on 2026-10-04 — restorable
  until early November with `gcloud projects undelete kitchen-atheos` if ever needed.)
- The dev server signs you in as "Dev Cook" (`import.meta.env.DEV`, compiled out of builds).
  Never add a bypass that is not behind that constant.
- Writes must carry a same-origin `Origin` header (middleware).
- **Glance:** `/internal/glance` (POST `{ email, today }` → household, tonight's dishes, planned
  days, list count) feeds Kitchen's tile on home.atheosstudios.com. Only the Home container on
  Vault reaches it, with `INTERNAL_TOKEN`; the tunnel never routes /internal/. It still answers
  only for people on `ALLOWED_EMAILS`.

## Households

- **Shared by everyone:** ingredients, recipes, meals — one recipe book any approved user edits.
- **Per household:** week plans (`plans`, keyed `week-<monday>`), the shopping list (`shopping`),
  its ticks (`shopping_ticks`), the pantry.
- **Any approved user may work in any household** — there are no memberships to check. Each person
  gets their own household ("Josh's Kitchen") on first sign-in; `users.household_id` records which
  one they are working in, and the header switcher changes it.
- **Writes name their household explicitly** (`householdId` in the body), never "whatever the
  session says now" — otherwise switching household in one tab would redirect another tab's edits.

## The shopping list

The list you shop from = **the chosen plan (optional) + the list's own extras**, aggregated together.
Extras (`ShoppingExtras`) are recipes and meals added directly (with servings) and hand-typed items.

- Typed items are parsed (`parseItem` in `src/lib/list.ts`): "2 lb ground beef" links to the
  ground-beef ingredient and **merges** with the pound a recipe asked for. Anything the registry
  does not know ("paper towels") stays free text under Other. **Ambiguity returns no match** ("oil"
  could be olive or neutral) — a wrong merge is worse than a loose line.
- Hand-added items go on **after** pantry subtraction and show even if they are staples.
- Edits are **operations** (`ListEditSchema`), applied server-side to the latest copy with
  optimistic concurrency on `updated_at` (`mutateShopping`) — two people adding at once both keep
  what they added. Ticks are rows, so concurrent ticking never conflicts.
- The plan choice lives on the list: absent = automatic (`pickCurrentPlan`: the earliest unfinished
  week with something planned), `null` = no plan, or a plan id.

Plans autosave (debounced) — there is no commit noise to avoid any more, and a household shares
them.

Dates: `src/lib/dates.ts` works in local time and formats by hand. The server runs in UTC, so "today"
comes from the household's time zone (`TIME_ZONE`, America/Chicago; see `viewerToday`). `toISOString()`
converts to UTC first and near midnight reports the wrong day — it silently moves a dinner onto the
wrong day's shopping list.

## Data model

- `ingredients` — one canonical registry. Recipes reference ingredients **by id**, never by free
  text. This is what makes shopping-list aggregation possible at all.
- `recipes`, `meals` — meals have components with roles (main / side / starter / dessert / drink /
  sauce) and an optional timeline that interleaves them.
- `plans` — per household: days → entries (meal or recipe, slot, servings).
- `shopping` + `shopping_ticks` — per household.
- Photos: starter photos are openly licensed Wikimedia images in `public/images/recipes/` and
  **must** carry `imageCredit` (CC BY / BY-SA require visible attribution; the data test enforces
  it). Uploaded photos live in the photos folder at `/photos/recipes/<id>/<key>` and need no credit.

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
plan + list dishes → expand meals to recipes → scale by servings → flatten to ingredient lines
     → convert to base units → sum per ingredient → subtract pantry → add hand-typed items
     → group by aisle → render back into human units
```

Conversion bugs are invisible in the UI but corrupt every shopping list, so `units.ts`,
`shopping.ts` and `list.ts` carry real vitest coverage. Keep it that way.

## Design

Modern and clean, photo-first. Driven by where this is actually read: propped on a counter at arm's
length while cooking, and one-handed on a phone in a supermarket aisle.

- One sans family: **Inter** for UI/body, **Inter Tight** for headings. Tokens in
  `src/styles/global.css`, light and dark.
- Warm off-white page, warm near-black ink `#1c1917` — **not** blue-black, which reads cold next to
  food. One accent, burnt orange `#c2410c`. Every text colour clears AA on every surface it sits on.
- Soft radii, hairlines rather than boxes, generous space. Photos do the talking: recipe cards are
  image + title, with a one-tap "+" to put the recipe on the list.
- **The frame is the shared Atheos app shell** (`src/styles/shell.css`, `src/lib/apps.json`; the
  canonical copy is `C:ProjectsWebsitesWebsite-Homeapp-shell`). Kitchen's colors: the
  orange as `--app`, and the shell's neutrals mapped to Kitchen's warm ones in `global.css`.
  Phones get the floating tab bar (thumb reach); desktop gets the nav in the top bar.
- Quantities use tabular numerals in a **fixed-width** column (`.ing-qty`, `.shop-row`) so every
  name starts at the same x. A list that doesn't align has to be read line by line.
- Min 44px tap targets: this gets used one-handed with wet hands.
- Aisle colours are **data, not decoration** — a shopping list is only usable in a store if sections
  are distinguishable at a glance.

## Commands

```bash
npm run dev               # astro dev on 127.0.0.1:4321; the database is .data/app.sqlite
npm run build             # astro check && astro build  (the server in dist/server/entry.mjs)
npm start                 # the built server
npm test                  # vitest
npm run ci                # tests, then build — what Vault's deploy runs
npm run db:seed           # load seed/ into .data/app.sqlite (never overwrites existing records)
```

First run locally: `npm run dev`, open any page (the database is created and migrated on the first
request), then `npm run db:seed`. The dev server signs you in as Dev Cook; there is no sign-in page.

## Deploying — pushing to `main` deploys

Vault's deployer fetches `main` every two minutes and builds the `Dockerfile`, whose first stage
runs `npm run ci`; only a passing build replaces the running container. So `git push` to `main`
IS the deploy: hold it to the bar a manual deploy would get — tests green, build clean, the change
exercised. Other branches are never built.

- **Migrations apply themselves** when the server opens the database (`migrations/*.sql`, recorded
  in `d1_migrations`), so a migration ships with the code that needs it, and must tolerate the
  code before it for the minute between.
- Secrets and settings live in Kitchen's `app.env` on Vault (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`,
  `ALLOWED_EMAILS`, `OWNER_EMAILS`, `TIME_ZONE`, `INTERNAL_TOKEN`): Home's `vault/README.md`.
- DNS is Cloudflare: `kitchen.atheosstudios.com` is a proxied CNAME to the tunnel `atheos-vault`.
