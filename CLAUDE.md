# Kitchen — working notes

Private household kitchen app: shared recipes → meals → a weekly plan per household → generated
cooking sheet + one aggregated shopping list.

- **Live at** `https://kitchen.atheosstudios.com` — a Cloudflare Worker (custom domain), repo
  `jwollberg/cookbook` (the repo name predates the rename to Kitchen).
- **Sibling property:** `jwollberg/atheosstudios` owns `atheosstudios.com`. Separate repo, separate
  hosting. Never edit one expecting the other to change.
- Same stack as Homeschool Hero (`C:\Projects\Homeschool Hero`): Workers + static assets (not
  Pages), D1, R2, Google OAuth done server-side.

## Architecture

```
Browser ──► Cloudflare Worker (Astro SSR via @astrojs/cloudflare)
              ├─ src/middleware.ts   Google sign-in gate on EVERY page and API route
              ├─ pages render from D1 per request
              ├─ /api/*              JSON writes, straight to D1 — live the moment they return
              └─ /photos/*           uploaded photos streamed from R2 (behind the gate too)
            D1 "kitchen"   users, households, library docs, household planning docs
            R2 "kitchen-photos"
```

- **Everything is rendered by the Worker, behind sign-in.** Static files (`dist/`: JS, CSS, the
  starter photos in `public/images/`) are served by Cloudflare *before* the Worker runs and skip the
  gate. So **nothing private may ever be a static file** — no prerendered pages, no data under
  `public/`. `public/.assetsignore` keeps the Worker bundle itself out of the assets.
- **Documents, validated.** Recipes, meals, ingredients, plans and the shopping list are JSON
  documents in D1, parsed with the zod schemas in `src/lib/schema.ts` on every read and write. The
  aggregation code consumes whole documents; do not normalise them into columns.
- **Recipe saves are atomic**: a recipe plus any ingredients it introduced go in one `db.batch`, so a
  recipe can never reference an ingredient that failed to write. The server also refuses a recipe
  whose ingredient ids do not exist.
- **The seed** (`seed/*.json`) is the starter library, loaded with `scripts/seed.mjs` using
  `INSERT OR IGNORE` — once live, D1 is the source of truth and re-seeding never overwrites an edit.
  `src/lib/data.test.ts` validates the seed (schema, referential integrity, the Greek-dinner totals).

### Loaders — do not cross them

- `src/lib/server/*` — Worker only (D1, cookies, secrets). Never import from a React island.
- `src/lib/api.ts` — browser only (fetch to `/api/*`). Never import from Astro frontmatter.
- `src/lib/{units,shopping,scaling,list,plans,dates,format}.ts` — pure, used on both sides.
- `src/lib/constants.ts` holds the enums so islands can use them without pulling zod into the bundle.

## Sign-in and access

- **Google OAuth 2.0 authorization code + PKCE, server-side** (`src/pages/auth/*`,
  `src/lib/server/auth.ts`). The browser only ever holds our own signed session cookie
  (`__Host-kitchen_session`, HMAC-SHA256 with `SESSION_SECRET`, 30 days). Rotating the secret signs
  everyone out.
- **Closed by default.** Only addresses in the `ALLOWED_EMAILS` secret may sign in, compared the way
  Gmail does (dots and `+tags` ignored). An empty or missing list admits nobody. The list is checked
  on **every request**, not only at sign-in, so removing someone locks them out immediately.
- The Google OAuth client is in *Testing* mode, so an address must **also** be a test user in the
  Google console — a second, separate gate.
- Writes must carry a same-origin `Origin` header (middleware), on top of SameSite=Lax cookies.
- `/auth/dev` and the "Continue as Dev Cook" button exist only under `import.meta.env.DEV`; the
  production bundle compiles them out. Never add a bypass that is not behind that constant.

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

Dates: `src/lib/dates.ts` works in local time and formats by hand. The Worker runs in UTC, so "today"
comes from the visitor's time zone (`request.cf.timezone`, see `viewerToday`). `toISOString()`
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
  it). Uploaded photos live in R2 at `/photos/recipes/<id>/<key>` and need no credit.

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
- Phones get a bottom tab bar (thumb reach); desktop gets the top nav.
- Quantities use tabular numerals in a **fixed-width** column (`.ing-qty`, `.shop-row`) so every
  name starts at the same x. A list that doesn't align has to be read line by line.
- Min 44px tap targets: this gets used one-handed with wet hands.
- Aisle colours are **data, not decoration** — a shopping list is only usable in a store if sections
  are distinguishable at a glance.

## Commands

```bash
npm run dev               # astro dev on 127.0.0.1:4321, local D1/R2 via wrangler's platform proxy
npm run build             # astro check && astro build  (Worker bundle in dist/_worker.js)
npm run preview           # build, then wrangler dev on :8787 — the real Workers runtime
npm test                  # vitest
npm run ci                # tests, then build — what a deploy runs
npm run db:migrate:local  # / db:migrate:remote — apply migrations/
npm run db:seed:local     # / db:seed:remote — load seed/ (never overwrites existing records)
```

First run locally: `npm run db:migrate:local && npm run db:seed:local && npm run dev`, then use
"Continue as Dev Cook" on the sign-in page. `.dev.vars` (gitignored) may hold `SESSION_SECRET`,
`ALLOWED_EMAILS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` for testing real sign-in locally
(redirect URI `http://127.0.0.1:4321/auth/callback`).

## Deploying — pushing to `main` deploys

Cloudflare **Workers Builds** is connected to `jwollberg/cookbook` (build command `npm run ci`,
deploy command `npx wrangler deploy`), the same model as Homeschool Hero. So `git push` to `main`
IS the deploy: hold it to the bar a manual deploy would get — tests green, build clean, the change
exercised. Non-production branches build but do not deploy.

- **Migrations are not part of the build.** `npm run db:migrate:remote` is manual; apply a
  migration *after* the code that tolerates it is live, or ship code that handles both shapes.
- Secrets are set with `npx wrangler secret put <NAME>`: `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `ALLOWED_EMAILS` (comma-separated).
- DNS is Cloudflare. `kitchen.atheosstudios.com` is a Workers custom domain (a "Worker" record),
  declared in `wrangler.jsonc` `routes`.
