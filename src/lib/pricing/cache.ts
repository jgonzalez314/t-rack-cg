// Price lookups and the set/printing picks are saved in this browser, so the
// last known price still shows (and exports) offline.

import type { Card, Condition } from "@/lib/data/types";
import { sortPrintings, suggestedPrice, type PriceLookup } from "./tcgplayer";

export const CACHE_KEY = "t-rack-cg-prices";
export const PICK_KEY = "t-rack-cg-price-picks";

export type Cached = { at: number; lookup: PriceLookup };
export type PricePick = { match?: string; printing?: string };

export function readJson<T>(key: string): Record<string, T> {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? "{}") as Record<
      string,
      T
    >;
  } catch {
    return {};
  }
}

export function writeJson<T>(key: string, id: string, value: T) {
  try {
    const all = readJson<T>(key);
    all[id] = value;
    window.localStorage.setItem(key, JSON.stringify(all));
  } catch {
    // Storage full or blocked: the price just isn't saved.
  }
}

export const lookupKey = (c: Pick<Card, "name" | "card_number">) =>
  `${c.name.trim().toLowerCase()}|${c.card_number.trim().toLowerCase()}`;

/** The match and printing to price: the user's pick, or the best match. */
export function selection(lookup: PriceLookup, pick: PricePick) {
  const match =
    lookup.matches.find((m) => m.id === pick.match) ?? lookup.matches[0];
  if (!match) return null;
  const printings = sortPrintings(match.prices);
  const printing = printings.includes(pick.printing ?? "")
    ? pick.printing!
    : printings[0];
  return { match, printings, printing };
}

export interface SavedSuggestion {
  price: number | null;
  /** TCGplayer's date for the price, YYYY-MM-DD. */
  date: string | null;
  set: string;
  printing: string;
}

/**
 * The suggested price last shown for each raw card, from saved lookups only
 * (no network). Cards that were never priced on this device are left out.
 */
export function savedSuggestions(
  cards: Card[],
): Record<string, SavedSuggestion> {
  const cache = readJson<Cached>(CACHE_KEY);
  const picks = readJson<PricePick>(PICK_KEY);
  const out: Record<string, SavedSuggestion> = {};
  for (const card of cards) {
    if (card.type !== "raw") continue;
    const cached = cache[lookupKey(card)];
    if (!cached?.lookup?.matches) continue;
    const picked = selection(cached.lookup, picks[card.id] ?? {});
    if (!picked) continue;
    out[card.id] = {
      price: suggestedPrice(
        picked.match.prices[picked.printing],
        (card.condition ?? "NM") as Condition,
      ),
      date: picked.match.updatedAt,
      set: picked.match.set,
      printing: picked.printing,
    };
  }
  return out;
}
