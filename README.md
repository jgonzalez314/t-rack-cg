# T-rack-CG

Track a trading card collection, raw and graded, on a computer or a phone.
Version 1 covers English Pokemon cards.

Built with Next.js, TypeScript, Tailwind CSS and Supabase. It installs on a
phone's home screen as a web app.

## Status

- [x] Phase 1: project setup, sign-in, database schema, home screen install
- [x] Phase 2: folders and cards (works offline)
- [x] Phase 3: purchases and sales (entered on each card in a folder)
- [x] Suggested prices for raw cards (TCGplayer market price)
- [ ] Phase 4: search
- [ ] Phase 5: polish and CSV export

## Quick start (no database)

You can run the app without any database. When no Supabase keys are set, it
starts in **local mode**: there is no sign-in, and your data is saved in the
browser on that device.

```bash
npm install
npm run dev
```

Open http://localhost:3000. A yellow "Local mode" box confirms it. Local data
stays in that one browser, so clearing site data deletes it.

To force local mode even when keys are set, add `NEXT_PUBLIC_LOCAL_MODE=true`
to `.env.local`.

## Setup with Supabase (sync across devices)

### 1. Create a Supabase project

1. Sign up at [supabase.com](https://supabase.com) and create a new project (the free plan is enough).
2. Open **SQL Editor** and run each file in
   [`supabase/migrations`](supabase/migrations) in order, oldest first:
   paste its contents and click **Run**. (Already set up? Run only the newer
   ones, such as `20261119000000_sale_listings.sql`.)
3. Open **Project Settings > API** and copy the **Project URL** and the **anon public** key.

### 2. Run the app locally

```bash
cp .env.example .env.local   # then paste your URL and anon key into it
npm install
npm run dev
```

Open http://localhost:3000 and create an account.

### 3. Deploy to Vercel

1. Import this repo at [vercel.com/new](https://vercel.com/new).
2. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` as environment variables.
3. Deploy. In Supabase, go to **Authentication > URL Configuration** and set the
   **Site URL** to your Vercel address.

### 4. Add it to your phone's home screen

- **iPhone (Safari):** open the site, tap Share, then **Add to Home Screen**.
- **Android (Chrome):** open the site, tap the menu, then **Install app**.

## Working offline

Folders and cards are always saved in the browser first, so you can create
folders and add cards with no connection. Once the app has been opened online
one time, it also opens offline (a service worker keeps a copy of the app;
this only runs in a production build, not `npm run dev`).

With Supabase set up, changes made offline wait in a queue on the device and
sync the next time it is online. A bar at the top shows whether changes are
waiting. If two devices add the same raw card to the same folder, they share
one entry after syncing. Buys and sells sync the same way.

## Suggested prices (raw cards)

Each raw card shows a suggested price based on TCGplayer's market price. If
the name and number match more than one card (reprints, or a promo with the
same number), pick the right set and printing (holo, reverse holo, ...) from the
menus under the price. The choice is remembered on that device.

- **Where the price comes from.** TCGplayer has closed its API to new
  developers ("We are no longer granting new API access at this time"), so the
  app reads TCGplayer's prices through the free
  [Pokemon TCG API](https://pokemontcg.io). Each card shows the date that
  service gives for its TCGplayer price. That date can lag: Charizard 010/078
  showed 2026-10-15 in November 2026 while its $3.84 market price still
  matched TCGplayer.
- **Condition.** TCGplayer's market price is mostly Near Mint sales. For LP, MP,
  HP and DMG the app takes 85%, 70%, 50% and 35% of it. Those shares are an
  estimate, not TCGplayer data, and the card says so. Change them in
  `src/lib/pricing/tcgplayer.ts`.
- **Key.** None needed. Set `POKEMONTCG_API_KEY` (free from
  [dev.pokemontcg.io](https://dev.pokemontcg.io)) on the server or in Vercel to
  raise the limit from about 1,000 to 20,000 lookups a day.
- **Sell price from TCGplayer.** Tick **Use the TCGplayer price as the sell
  price** in any raw card's sell form. From then on, every raw card's sell
  price starts at its suggested price (for the condition and printing you
  picked). You can still change it for one sale. The setting is saved per
  device. Slabs are not affected.
- **Offline.** The last price is saved in the browser and shown offline. Prices
  refresh every 12 hours, or when you tap **Refresh**.

## Data model

| Table | What it holds |
| --- | --- |
| `folders` | Folders you create |
| `cards` | One entry per card in a folder. Raw cards with the same name, number and condition share one entry. Slabs store grading company, grade and cert number. |
| `purchases` | Each buy: date, market price per card, percent of market paid, quantity |
| `sales` | Each sale: date, market price per card, percent of market received, quantity. A quantity of 0 is a listing: up for sale at that price, not sold yet. |
| `card_summary` (view) | Quantity owned, total cost, average cost, total received, profit and asking price per card |

Profit uses average cost: `(sell price × sell % − average cost) × copies sold`.
Listings (sold quantity 0) are left out of profit. The newest listing's
`sell price × sell %` shows as **Asking** on the card while you still own a copy.
The database blocks selling more copies than were bought, and every user can
only see their own data.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run lint` | Lint |
| `npm run typecheck` | Type check |
| `npm test` | Unit tests |
