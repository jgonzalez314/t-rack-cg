# T-rack-CG

Track a trading card collection, raw and graded, on a computer or a phone.
Version 1 covers English Pokemon cards.

Built with Next.js, TypeScript, Tailwind CSS and Supabase. It installs on a
phone's home screen as a web app.

## Status

- [x] Phase 1: project setup, sign-in, database schema, home screen install
- [ ] Phase 2: folders and cards (folders and adding cards done, works offline)
- [ ] Phase 3: purchases and sales
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
2. Open **SQL Editor**, paste the contents of
   [`supabase/migrations/20261110000000_init.sql`](supabase/migrations/20261110000000_init.sql),
   and click **Run**.
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
one entry after syncing. Purchases and sales are not synced yet.

## Data model

| Table | What it holds |
| --- | --- |
| `folders` | Folders you create |
| `cards` | One entry per card in a folder. Raw cards with the same name, number and condition share one entry. Slabs store grading company, grade and cert number. |
| `purchases` | Each buy: date, market price per card, percent of market paid, quantity |
| `sales` | Each sale: date, market price per card, percent of market received, quantity |
| `card_summary` (view) | Quantity owned, total cost, average cost, total received and profit per card |

Profit uses average cost: `(sell price × sell % − average cost) × copies sold`.
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
