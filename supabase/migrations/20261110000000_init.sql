-- T-rack-CG initial schema: folders, cards, purchases and sales.
-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.

-- ---------------------------------------------------------------------------
-- Dropdown values
-- ---------------------------------------------------------------------------
create type public.card_type as enum ('raw', 'slab');
create type public.card_condition as enum ('NM', 'LP', 'MP', 'HP', 'DMG');
create type public.grading_company as enum ('PSA', 'BGS', 'CGC', 'SGC');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Folders
-- ---------------------------------------------------------------------------
create table public.folders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index folders_user_id_idx on public.folders (user_id);

create trigger folders_set_updated_at
  before update on public.folders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Cards
--
-- One row per card entry in a folder. Raw cards with the same name, number,
-- game, language and condition in the same folder share one row; their
-- quantity comes from purchases minus sales. The same card in another folder
-- is a separate row, so editing one never changes the other.
-- ---------------------------------------------------------------------------
create table public.cards (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  folder_id       uuid not null references public.folders (id) on delete cascade,
  type            public.card_type not null,
  name            text not null check (length(trim(name)) > 0),
  card_number     text not null check (length(trim(card_number)) > 0),
  game            text not null default 'Pokemon',
  language        text not null default 'English',
  -- Raw only
  condition       public.card_condition,
  -- Slab only
  grading_company public.grading_company,
  grade           numeric(3, 1) check (grade between 1 and 10),
  cert_number     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint cards_raw_fields check (
    type <> 'raw'
    or (condition is not null
        and grading_company is null and grade is null and cert_number is null)
  ),
  constraint cards_slab_fields check (
    type <> 'slab'
    or (condition is null
        and grading_company is not null and grade is not null
        and cert_number is not null and length(trim(cert_number)) > 0)
  )
);

create index cards_user_id_idx on public.cards (user_id);
create index cards_folder_id_idx on public.cards (folder_id);
create index cards_name_idx on public.cards (lower(name));
create index cards_cert_number_idx on public.cards (cert_number) where cert_number is not null;

-- Same raw card + same condition in the same folder = one row.
create unique index cards_raw_unique_in_folder
  on public.cards (folder_id, lower(name), lower(card_number), game, language, condition)
  where type = 'raw';

-- A slab's cert number is unique within a folder.
create unique index cards_slab_unique_in_folder
  on public.cards (folder_id, grading_company, cert_number)
  where type = 'slab';

create trigger cards_set_updated_at
  before update on public.cards
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Purchases: each time copies of a card are bought.
-- Prices are market value per card; percentage is the share of market paid.
-- ---------------------------------------------------------------------------
create table public.purchases (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  card_id        uuid not null references public.cards (id) on delete cascade,
  buy_date       date not null,
  buy_price      numeric(12, 2) not null check (buy_price >= 0),
  buy_percentage numeric(6, 2) not null default 100 check (buy_percentage >= 0),
  quantity       integer not null check (quantity > 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index purchases_card_id_idx on public.purchases (card_id);

create trigger purchases_set_updated_at
  before update on public.purchases
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Sales: each time copies of a card are sold.
-- ---------------------------------------------------------------------------
create table public.sales (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  card_id         uuid not null references public.cards (id) on delete cascade,
  sell_date       date not null,
  sell_price      numeric(12, 2) not null check (sell_price >= 0),
  sell_percentage numeric(6, 2) not null default 100 check (sell_percentage >= 0),
  sell_quantity   integer not null check (sell_quantity > 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index sales_card_id_idx on public.sales (card_id);

create trigger sales_set_updated_at
  before update on public.sales
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Never sell more copies than were bought.
-- Checked after any change to purchases or sales.
-- ---------------------------------------------------------------------------
create or replace function public.check_quantity_owned()
returns trigger
language plpgsql
as $$
declare
  target_card uuid;
  bought      integer;
  sold        integer;
begin
  target_card := coalesce(new.card_id, old.card_id);

  select coalesce(sum(quantity), 0) into bought
    from public.purchases where card_id = target_card;
  select coalesce(sum(sell_quantity), 0) into sold
    from public.sales where card_id = target_card;

  if sold > bought then
    raise exception 'Cannot sell % copies; only % bought', sold, bought
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

create constraint trigger sales_check_quantity
  after insert or update on public.sales
  deferrable initially deferred
  for each row execute function public.check_quantity_owned();

create constraint trigger purchases_check_quantity
  after update or delete on public.purchases
  deferrable initially deferred
  for each row execute function public.check_quantity_owned();

-- ---------------------------------------------------------------------------
-- Row level security: each user sees and edits only their own data.
-- ---------------------------------------------------------------------------
alter table public.folders   enable row level security;
alter table public.cards     enable row level security;
alter table public.purchases enable row level security;
alter table public.sales     enable row level security;

create policy "Own folders" on public.folders
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Own cards" on public.cards
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.folders f
      where f.id = folder_id and f.user_id = (select auth.uid())
    )
  );

create policy "Own purchases" on public.purchases
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.cards c
      where c.id = card_id and c.user_id = (select auth.uid())
    )
  );

create policy "Own sales" on public.sales
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.cards c
      where c.id = card_id and c.user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Card totals, worked out from purchases and sales.
--   cost per card      = buy_price  * buy_percentage  / 100
--   received per card  = sell_price * sell_percentage / 100
--   average cost       = total cost / copies bought
--   realized profit    = total received - average cost * copies sold
-- security_invoker makes the view respect the RLS policies above.
-- ---------------------------------------------------------------------------
create view public.card_summary
with (security_invoker = true) as
with p as (
  select card_id,
         sum(quantity)                                   as copies_bought,
         sum(quantity * buy_price * buy_percentage / 100) as total_cost
    from public.purchases
   group by card_id
),
s as (
  select card_id,
         sum(sell_quantity)                                       as copies_sold,
         sum(sell_quantity * sell_price * sell_percentage / 100)  as total_received
    from public.sales
   group by card_id
)
select c.*,
       coalesce(p.copies_bought, 0)                             as copies_bought,
       coalesce(s.copies_sold, 0)                               as copies_sold,
       coalesce(p.copies_bought, 0) - coalesce(s.copies_sold, 0) as quantity_owned,
       round(coalesce(p.total_cost, 0), 2)                      as total_cost,
       round(coalesce(p.total_cost / nullif(p.copies_bought, 0), 0), 2) as average_cost,
       round(coalesce(s.total_received, 0), 2)                  as total_received,
       round(
         coalesce(s.total_received, 0)
         - coalesce(p.total_cost / nullif(p.copies_bought, 0), 0) * coalesce(s.copies_sold, 0),
         2
       )                                                        as realized_profit
  from public.cards c
  left join p on p.card_id = c.id
  left join s on s.card_id = c.id;
