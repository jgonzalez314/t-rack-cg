-- A sale with sell_quantity = 0 is a listing: the card is up for sale at that
-- price but has not sold yet. It adds nothing to copies sold, money received
-- or profit. The newest listing is the card's asking price.

alter table public.sales drop constraint sales_sell_quantity_check;
alter table public.sales
  add constraint sales_sell_quantity_check check (sell_quantity >= 0);

-- Same columns as before, plus asking_price at the end.
--   asking price = sell_price * sell_percentage / 100 of the newest listing
create or replace view public.card_summary
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
),
l as (
  select distinct on (card_id)
         card_id,
         round(sell_price * sell_percentage / 100, 2) as asking_price
    from public.sales
   where sell_quantity = 0
   order by card_id, sell_date desc, created_at desc
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
       )                                                        as realized_profit,
       l.asking_price                                           as asking_price
  from public.cards c
  left join p on p.card_id = c.id
  left join s on s.card_id = c.id
  left join l on l.card_id = c.id;
