-- Lets cards be put in any order within a folder. Lower comes first. Cards
-- with no sort_order (all cards made before this, new cards, and cards moved
-- in from another folder) come after the ordered ones, by name, so existing
-- folders keep their A to Z order until someone reorders them.

alter table public.cards
  add column sort_order integer check (sort_order >= 0);

create index cards_folder_order_idx on public.cards (folder_id, sort_order);
