# T-rack-CG

Track a trading card collection, raw and graded, on a computer or a phone.
Version 1 covers English Pokemon cards.

Built with Next.js, TypeScript, Tailwind CSS and Supabase. It installs on a
phone's home screen as a web app.

## Status

- [x] Phase 1: project setup, sign-in, database schema, home screen install
- [ ] Phase 2: folders and cards
- [ ] Phase 3: purchases and sales
- [ ] Phase 4: search
- [ ] Phase 5: polish and CSV export

## Setup

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
