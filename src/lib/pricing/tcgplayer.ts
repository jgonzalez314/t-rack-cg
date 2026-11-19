// TCGplayer prices for raw Pokemon cards.
//
// TCGplayer no longer gives out new API keys ("We are no longer granting new
// API access at this time", docs.tcgplayer.com). The Pokemon TCG API
// (pokemontcg.io) is free and returns TCGplayer's own prices for each card,
// so the app reads them from there. The lookup
// runs on the server (src/app/api/price), so an API key never reaches the
// browser.

import type { Condition } from "@/lib/data/types";

export const POKEMON_TCG_API = "https://api.pokemontcg.io/v2/cards";

/** TCGplayer's prices for one printing (holofoil, reverse holo, ...), USD. */
export interface PrintingPrice {
  low: number | null;
  mid: number | null;
  high: number | null;
  market: number | null;
}

/** One card that matches a name and number, with its TCGplayer prices. */
export interface PriceMatch {
  id: string;
  name: string;
  number: string;
  set: string;
  setTotal: number | null;
  releaseDate: string | null;
  url: string | null;
  updatedAt: string | null; // YYYY-MM-DD
  prices: Record<string, PrintingPrice>;
}

export interface PriceLookup {
  matches: PriceMatch[];
}

/** Splits "4/102" into a number the API knows ("4") and the set size (102). */
export function parseCardNumber(input: string): { number: string; total: number | null } {
  const [rawNumber, rawTotal] = input.trim().replace(/^#/, "").split("/");
  let number = (rawNumber ?? "").trim();
  // The API stores "4", not "004". Leave numbers like "TG01" alone.
  if (/^\d+$/.test(number)) number = String(Number(number));
  const total = rawTotal && /^\d+$/.test(rawTotal.trim()) ? Number(rawTotal) : null;
  return { number, total };
}

/** Search query in the Pokemon TCG API's syntax. */
export function buildQuery(name: string, cardNumber: string): string {
  const cleanName = name.trim().replace(/["\\]/g, "");
  const { number } = parseCardNumber(cardNumber);
  const parts = [`name:"${cleanName}*"`];
  if (number) parts.push(`number:"${number.replace(/["\\]/g, "")}"`);
  return parts.join(" ");
}

type ApiPrice = Partial<Record<"low" | "mid" | "high" | "market", number | null>>;
interface ApiCard {
  id: string;
  name: string;
  number: string;
  set?: { name?: string; printedTotal?: number; releaseDate?: string };
  tcgplayer?: { url?: string; updatedAt?: string; prices?: Record<string, ApiPrice> };
}

/** Only https links to TCGplayer, so a bad API answer can't link anywhere else. */
export function safeTcgplayerUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v);
    const host = u.hostname.toLowerCase();
    const trusted = ["tcgplayer.com", "tcgplayer.pxf.io", "pokemontcg.io"];
    if (u.protocol !== "https:") return null;
    return trusted.some((d) => host === d || host.endsWith(`.${d}`)) ? u.href : null;
  } catch {
    return null;
  }
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const isoDate = (d?: string) => (d ? d.replaceAll("/", "-") : null);

/**
 * Turns the API's cards into matches, best first: cards whose set size matches
 * the "/102" part of the number come first, then the newest sets.
 */
export function toMatches(cards: ApiCard[], cardNumber: string): PriceMatch[] {
  const { total } = parseCardNumber(cardNumber);
  const matches = cards
    .map((c): PriceMatch => {
      const prices: Record<string, PrintingPrice> = {};
      for (const [printing, p] of Object.entries(c.tcgplayer?.prices ?? {})) {
        prices[printing] = { low: num(p.low), mid: num(p.mid), high: num(p.high), market: num(p.market) };
      }
      return {
        id: c.id,
        name: c.name,
        number: c.number,
        set: c.set?.name ?? "Unknown set",
        setTotal: num(c.set?.printedTotal),
        releaseDate: isoDate(c.set?.releaseDate),
        url: safeTcgplayerUrl(c.tcgplayer?.url),
        updatedAt: isoDate(c.tcgplayer?.updatedAt),
        prices,
      };
    })
    .filter((m) => Object.keys(m.prices).length > 0);

  const score = (m: PriceMatch) => (total !== null && m.setTotal === total ? 1 : 0);
  return matches.sort(
    (a, b) => score(b) - score(a) || (b.releaseDate ?? "").localeCompare(a.releaseDate ?? ""),
  );
}

const PRINTING_ORDER = ["holofoil", "normal", "1stEditionHolofoil", "unlimitedHolofoil", "reverseHolofoil"];

/** Printings in a sensible order: the main printing first, reverse holo after. */
export function sortPrintings(prices: Record<string, PrintingPrice>): string[] {
  const rank = (p: string) => {
    const i = PRINTING_ORDER.indexOf(p);
    return i === -1 ? PRINTING_ORDER.length : i;
  };
  return Object.keys(prices).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** "reverseHolofoil" -> "Reverse Holofoil", "1stEditionHolofoil" -> "1st Edition Holofoil". */
export function printingLabel(printing: string): string {
  return printing
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * TCGplayer's market price is mostly Near Mint sales. For worse conditions the
 * suggestion takes a share of it. These shares are rules of thumb, not
 * TCGplayer data, so the app labels them as estimates.
 */
export const CONDITION_FACTOR: Record<Condition, number> = {
  NM: 1,
  LP: 0.85,
  MP: 0.7,
  HP: 0.5,
  DMG: 0.35,
};

/** Market price (or mid price when there is no market price yet). */
export function basePrice(p: PrintingPrice | undefined): number | null {
  if (!p) return null;
  return p.market ?? p.mid ?? null;
}

export function suggestedPrice(p: PrintingPrice | undefined, condition: Condition): number | null {
  const base = basePrice(p);
  if (base === null) return null;
  return Math.round(base * CONDITION_FACTOR[condition] * 100) / 100;
}
