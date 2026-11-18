"use client";

import { useEffect, useState } from "react";
import type { CardSummary, Condition } from "@/lib/data/types";
import {
  basePrice,
  CONDITION_FACTOR,
  printingLabel,
  sortPrintings,
  suggestedPrice,
  type PriceLookup,
} from "@/lib/pricing/tcgplayer";
import { money } from "./CardMoney";

// Lookups are saved in this browser, so the last known price still shows
// offline and the API isn't asked again for 12 hours.
const CACHE_KEY = "t-rack-cg-prices";
const PICK_KEY = "t-rack-cg-price-picks";
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

type Cached = { at: number; lookup: PriceLookup };
type Pick = { match?: string; printing?: string };

function readJson<T>(key: string): Record<string, T> {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "{}") as Record<string, T>;
  } catch {
    return {};
  }
}

function writeJson<T>(key: string, id: string, value: T) {
  try {
    const all = readJson<T>(key);
    all[id] = value;
    window.localStorage.setItem(key, JSON.stringify(all));
  } catch {
    // Storage full or blocked: the price just isn't saved.
  }
}

const lookupKey = (c: CardSummary) => `${c.name.trim().toLowerCase()}|${c.card_number.trim().toLowerCase()}`;

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; lookup: PriceLookup; at: number };

/** Suggested price for a raw card, from TCGplayer's market price. */
/** The match and printing to price: the user's pick, or the best match. */
function selection(lookup: PriceLookup, pick: Pick) {
  const match = lookup.matches.find((m) => m.id === pick.match) ?? lookup.matches[0];
  if (!match) return null;
  const printings = sortPrintings(match.prices);
  const printing = printings.includes(pick.printing ?? "") ? pick.printing! : printings[0];
  return { match, printings, printing };
}

export function SuggestedPrice({
  card,
  onPrice,
}: {
  card: CardSummary;
  /** Called with the suggested price (or null) whenever it changes. */
  onPrice?: (cardId: string, price: number | null) => void;
}) {
  const key = lookupKey(card);
  const [state, setState] = useState<State>({ status: "loading" });
  const [pick, setPick] = useState<Pick>({});
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    setPick(readJson<Pick>(PICK_KEY)[card.id] ?? {});
  }, [card.id]);

  useEffect(() => {
    let cancelled = false;
    const cached = readJson<Cached>(CACHE_KEY)[key];
    if (cached) setState({ status: "ready", lookup: cached.lookup, at: cached.at });
    const fresh = cached && Date.now() - cached.at < MAX_AGE_MS;
    if ((fresh && refresh === 0) || !navigator.onLine) {
      if (!cached) setState({ status: "error", message: "Go online to look up the TCGplayer price." });
      return;
    }
    if (!cached) setState({ status: "loading" });
    const params = new URLSearchParams({ name: card.name, number: card.card_number });
    fetch(`/api/price?${params}`)
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as (PriceLookup & { error?: string }) | null;
        if (!res.ok || !body || !Array.isArray(body.matches)) {
          throw new Error(body?.error ?? "Price lookup failed");
        }
        return body;
      })
      .then((lookup) => {
        if (cancelled) return;
        const at = Date.now();
        writeJson<Cached>(CACHE_KEY, key, { at, lookup });
        setState({ status: "ready", lookup, at });
      })
      .catch((e: Error) => {
        // Keep showing a saved price if there is one.
        if (!cancelled && !cached) setState({ status: "error", message: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, [key, card.name, card.card_number, refresh]);

  const condition = (card.condition ?? "NM") as Condition;
  const picked = state.status === "ready" ? selection(state.lookup, pick) : null;
  const suggested = picked ? suggestedPrice(picked.match.prices[picked.printing], condition) : null;
  useEffect(() => {
    onPrice?.(card.id, suggested);
  }, [onPrice, card.id, suggested]);

  function choose(next: Pick) {
    setPick(next);
    writeJson<Pick>(PICK_KEY, card.id, next);
  }

  const box = "mt-2 rounded-lg bg-neutral-50 px-3 py-2 text-sm dark:bg-neutral-900";

  if (state.status === "loading") {
    return <p className={`${box} text-neutral-500`}>Looking up TCGplayer price…</p>;
  }
  if (state.status === "error") {
    return (
      <p className={`${box} text-neutral-500`}>
        {state.message}{" "}
        <button type="button" onClick={() => setRefresh((n) => n + 1)} className="text-blue-600">
          Try again
        </button>
      </p>
    );
  }

  const { matches } = state.lookup;
  if (!picked) {
    return (
      <p className={`${box} text-neutral-500`}>
        No TCGplayer price found for this name and number. Check the spelling and the number (like 4/102).
      </p>
    );
  }

  const { match, printings, printing } = picked;
  const market = basePrice(match.prices[printing]);
  const selectClass =
    "rounded border border-neutral-300 bg-white px-1.5 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-950";

  return (
    <div className={box} aria-label="Suggested price">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span>
          <span className="text-xs text-neutral-500">Suggested price ({condition})</span>{" "}
          <span className="text-base font-semibold tabular-nums">
            {suggested === null ? "No price yet" : money(suggested)}
          </span>
        </span>
        {market !== null && (
          <span className="text-xs text-neutral-500 tabular-nums">
            TCGplayer market {money(market)}
            {condition !== "NM" && ` × ${Math.round(CONDITION_FACTOR[condition] * 100)}% for ${condition} (estimate)`}
          </span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
        {matches.length > 1 ? (
          <select
            aria-label="Set"
            value={match.id}
            onChange={(e) => choose({ match: e.target.value })}
            className={selectClass}
          >
            {matches.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.set} {m.number}
                {m.setTotal ? `/${m.setTotal}` : ""}
              </option>
            ))}
          </select>
        ) : (
          <span>
            {match.name} · {match.set}
          </span>
        )}
        {printings.length > 1 ? (
          <select
            aria-label="Printing"
            value={printing}
            onChange={(e) => choose({ match: match.id, printing: e.target.value })}
            className={selectClass}
          >
            {printings.map((p) => (
              <option key={p} value={p}>
                {printingLabel(p)}
              </option>
            ))}
          </select>
        ) : (
          <span>{printingLabel(printing)}</span>
        )}
        {match.updatedAt && <span>TCGplayer price from {match.updatedAt}</span>}
        {match.url && (
          <a href={match.url} target="_blank" rel="noreferrer" className="text-blue-600">
            TCGplayer
          </a>
        )}
        <button type="button" onClick={() => setRefresh((n) => n + 1)} className="text-blue-600">
          Refresh
        </button>
      </div>
    </div>
  );
}
