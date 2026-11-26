"use client";

import { useEffect, useState } from "react";
import type { LocalStore } from "@/lib/data/local-store";
import type { CardSummary } from "@/lib/data/types";
import { updateSettings, useSettings } from "@/lib/settings";
import { inputClass, labelClass, profitTone } from "./ui";

type Run = <T>(fn: (s: LocalStore) => T) => { value?: T; error?: string };

export const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD" });

const today = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** One-line totals shown under each card. */
export function CardTotals({ card }: { card: CardSummary }) {
  return (
    <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2.5 border-t border-divider pt-3 text-sm">
      <Stat label="Own" value={String(card.quantity_owned)} />
      <Stat label="Bought" value={String(card.copies_bought)} />
      <Stat label="Sold" value={String(card.copies_sold)} />
      <Stat label="Avg cost" value={money(card.average_cost)} />
      <Stat label="Received" value={money(card.total_received)} />
      <Stat
        label="Profit"
        value={money(card.realized_profit)}
        tone={profitTone(card.realized_profit)}
      />
      {card.asking_price !== null && card.quantity_owned > 0 && (
        <Stat label="Asking" value={money(card.asking_price)} />
      )}
    </dl>
  );
}

function Stat({
  label,
  value,
  tone = "",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div>
      <dt className={labelClass}>{label}</dt>
      <dd className={`mt-0.5 text-[15px] font-semibold tabular-nums ${tone}`}>
        {value}
      </dd>
    </div>
  );
}

/** Buys and sells for one card, with forms to add more. */
export function CardMoney({
  store,
  card,
  run,
  suggestedPrice,
}: {
  store: LocalStore;
  card: CardSummary;
  run: Run;
  /** TCGplayer suggested price for a raw card (null while unknown). */
  suggestedPrice?: number | null;
}) {
  const purchases = store.listPurchases(card.id);
  const sales = store.listSales(card.id);
  const [error, setError] = useState<string | null>(null);
  const { sellPriceSource } = useSettings();
  const useTcgplayer = card.type === "raw" && sellPriceSource === "tcgplayer";

  return (
    <div className="mt-3 flex flex-col gap-4 border-t border-divider pt-3">
      <EntryForm
        kind="buy"
        onSubmit={(v) => {
          const r = run((s) =>
            s.addPurchase({
              card_id: card.id,
              buy_date: v.date,
              buy_price: v.price,
              buy_percentage: v.percent,
              quantity: v.quantity,
            }),
          );
          setError(r.error ?? null);
          return !r.error;
        }}
      />
      <EntryList
        title="Buys"
        empty="No buys yet."
        rows={purchases.map((p) => ({
          id: p.id,
          date: p.buy_date,
          price: p.buy_price,
          percent: p.buy_percentage,
          quantity: p.quantity,
        }))}
        onDelete={(id) =>
          setError(run((s) => s.deletePurchase(id)).error ?? null)
        }
      />

      <EntryForm
        kind="sell"
        autoPrice={useTcgplayer ? (suggestedPrice ?? null) : undefined}
        setting={
          card.type === "raw" ? (
            <label className="flex items-center gap-2 text-xs text-ink-soft">
              <input
                type="checkbox"
                className="h-4 w-4 accent-accent"
                checked={sellPriceSource === "tcgplayer"}
                onChange={(e) =>
                  updateSettings({
                    sellPriceSource: e.target.checked ? "tcgplayer" : "manual",
                  })
                }
              />
              Use the TCGplayer price as the sell price (all raw cards)
            </label>
          ) : null
        }
        onSubmit={(v) => {
          const r = run((s) =>
            s.addSale({
              card_id: card.id,
              sell_date: v.date,
              sell_price: v.price,
              sell_percentage: v.percent,
              sell_quantity: v.quantity,
            }),
          );
          setError(r.error ?? null);
          return !r.error;
        }}
      />
      <EntryList
        title="Sells"
        empty="No sells yet."
        rows={sales.map((s) => ({
          id: s.id,
          date: s.sell_date,
          price: s.sell_price,
          percent: s.sell_percentage,
          quantity: s.sell_quantity,
        }))}
        onDelete={(id) => setError(run((s) => s.deleteSale(id)).error ?? null)}
      />
      {error && <p className="text-sm text-neg">{error}</p>}
    </div>
  );
}

type Entry = { date: string; price: number; percent: number; quantity: number };

function EntryForm({
  kind,
  onSubmit,
  autoPrice,
  setting,
}: {
  kind: "buy" | "sell";
  onSubmit: (v: Entry) => boolean;
  /** When set, the price field is filled with this (null: price not known yet). */
  autoPrice?: number | null;
  setting?: React.ReactNode;
}) {
  const [date, setDate] = useState(today);
  const [price, setPrice] = useState("");
  const autoText = autoPrice == null ? "" : autoPrice.toFixed(2);
  // Fill the price when the setting is turned on or the TCGplayer price
  // changes. The field can still be edited for one sale.
  useEffect(() => {
    if (autoText) setPrice(autoText);
  }, [autoText]);
  const [percent, setPercent] = useState("100");
  const [quantity, setQuantity] = useState("1");
  const verb = kind === "buy" ? "Buy" : "Sell";
  const each = (Number(price) || 0) * ((Number(percent) || 0) / 100);
  const listing = kind === "sell" && quantity !== "" && Number(quantity) === 0;
  const total = each * (Number(quantity) || 0);

  return (
    <form
      aria-label={`Add ${kind}`}
      onSubmit={(e) => {
        e.preventDefault();
        const ok = onSubmit({
          date,
          price: Number(price),
          percent: Number(percent),
          quantity: Number(quantity),
        });
        if (ok) {
          setPrice(autoText);
          setQuantity("1");
        }
      }}
      className="flex flex-col gap-2"
    >
      <h4 className="text-[15px] font-semibold">Add a {kind}</h4>
      {setting}
      {autoPrice === null && (
        <p className="text-xs text-muted">
          No TCGplayer price for this card yet, so enter the sell price.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          {verb} date
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          {verb} price ($ market)
          <input
            type="number"
            inputMode="decimal"
            required
            min={0}
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          {verb} percentage (%)
          <input
            type="number"
            inputMode="decimal"
            required
            min={0}
            step="any"
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          {kind === "buy" ? "Quantity" : "Sold quantity (0 = listed)"}
          <input
            type="number"
            inputMode="numeric"
            required
            min={kind === "buy" ? 1 : 0}
            step={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="submit"
          className={`rounded-xl px-4 py-2 text-sm font-semibold ${
            kind === "buy"
              ? "bg-accent text-accent-ink"
              : "border border-line bg-surface text-ink"
          }`}
        >
          {listing ? "Add listing" : `Add ${kind}`}
        </button>
        <span className="text-sm text-muted tabular-nums">
          {listing
            ? `Asking: ${money(each)} each`
            : `${kind === "buy" ? "Cost" : "Received"}: ${money(total)}`}
        </span>
      </div>
    </form>
  );
}

function EntryList({
  title,
  empty,
  rows,
  onDelete,
}: {
  title: string;
  empty: string;
  rows: (Entry & { id: string })[];
  onDelete: (id: string) => void;
}) {
  return (
    <div>
      <h4 className={labelClass}>{title}</h4>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-1 flex flex-col divide-y divide-divider text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-2.5 py-2">
              <span
                aria-hidden
                className={`w-10 shrink-0 rounded-md py-0.5 text-center text-[10.5px] font-bold ${
                  title === "Buys"
                    ? "bg-accent-soft text-accent"
                    : r.quantity === 0
                      ? "bg-sunken text-ink-soft"
                      : "bg-pos-soft text-pos"
                }`}
              >
                {title === "Buys" ? "BUY" : r.quantity === 0 ? "LIST" : "SELL"}
              </span>
              {r.quantity === 0 ? (
                <span className="min-w-0 flex-1 tabular-nums text-ink-soft">
                  {r.date} · Listed, not sold · {money(r.price)} at {r.percent}%
                  ={" "}
                  <span className="font-semibold text-ink">
                    {money((r.price * r.percent) / 100)} each
                  </span>
                </span>
              ) : (
                <span className="min-w-0 flex-1 tabular-nums text-ink-soft">
                  {r.date} · {r.quantity} × {money(r.price)} at {r.percent}% ={" "}
                  <span className="font-semibold text-ink">
                    {money((r.quantity * r.price * r.percent) / 100)}
                  </span>
                </span>
              )}
              <button
                type="button"
                onClick={() => onDelete(r.id)}
                className="shrink-0 font-medium text-neg"
                aria-label={`Delete ${title.toLowerCase().slice(0, -1)} from ${r.date}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
