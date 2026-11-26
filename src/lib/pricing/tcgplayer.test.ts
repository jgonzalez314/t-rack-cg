import { describe, expect, it } from "vitest";
import { allowLookup, RATE_LIMIT } from "./rate-limit";
import {
  buildQuery,
  parseCardNumber,
  printingLabel,
  safeTcgplayerUrl,
  sortPrintings,
  suggestedPrice,
  toMatches,
} from "./tcgplayer";

describe("parseCardNumber", () => {
  it("splits number and set size and drops leading zeros", () => {
    expect(parseCardNumber("004/102")).toEqual({ number: "4", total: 102 });
    expect(parseCardNumber("#58")).toEqual({ number: "58", total: null });
    expect(parseCardNumber("TG01/TG30")).toEqual({
      number: "TG01",
      total: null,
    });
  });
});

describe("buildQuery", () => {
  it("searches by name and number and strips quotes", () => {
    expect(buildQuery(' Char"izard ', "4/102")).toBe(
      'name:"Charizard*" number:"4"',
    );
    expect(buildQuery("Pikachu", "")).toBe('name:"Pikachu*"');
  });
});

describe("toMatches", () => {
  const card = (
    id: string,
    total: number,
    date: string,
    prices: Record<string, { market?: number }> = { holofoil: { market: 10 } },
  ) => ({
    id,
    name: "Charizard",
    number: "4",
    set: { name: id, printedTotal: total, releaseDate: date },
    tcgplayer: {
      url: `https://tcgplayer.com/${id}`,
      updatedAt: "2026/11/17",
      prices,
    },
  });

  it("puts the set whose size matches first, then newest, and drops cards with no prices", () => {
    const m = toMatches(
      [
        card("new", 200, "2024/01/01"),
        card("base1", 102, "1999/01/09"),
        card("none", 102, "2000/01/01", {}),
      ],
      "4/102",
    );
    expect(m.map((x) => x.id)).toEqual(["base1", "new"]);
    expect(m[0].updatedAt).toBe("2026-11-17");
    expect(m[0].prices.holofoil).toEqual({
      low: null,
      mid: null,
      high: null,
      market: 10,
    });
  });
});

describe("prices", () => {
  it("scales the market price by condition", () => {
    expect(suggestedPrice({ low: 1, mid: 5, high: 9, market: 100 }, "NM")).toBe(
      100,
    );
    expect(suggestedPrice({ low: 1, mid: 5, high: 9, market: 100 }, "LP")).toBe(
      85,
    );
    expect(
      suggestedPrice({ low: 1, mid: 5, high: 9, market: null }, "NM"),
    ).toBe(5);
    expect(
      suggestedPrice({ low: null, mid: null, high: null, market: null }, "NM"),
    ).toBeNull();
  });

  it("orders and labels printings", () => {
    expect(
      sortPrintings({ reverseHolofoil: {}, normal: {}, holofoil: {} } as never),
    ).toEqual(["holofoil", "normal", "reverseHolofoil"]);
    expect(printingLabel("reverseHolofoil")).toBe("Reverse Holofoil");
    expect(printingLabel("1stEditionHolofoil")).toBe("1st Edition Holofoil");
  });
});

describe("safeTcgplayerUrl", () => {
  it("keeps https links to TCGplayer and the Pokemon TCG API", () => {
    expect(
      safeTcgplayerUrl("https://prices.pokemontcg.io/tcgplayer/base1-4"),
    ).toBe("https://prices.pokemontcg.io/tcgplayer/base1-4");
    expect(safeTcgplayerUrl("https://www.tcgplayer.com/product/1")).toBe(
      "https://www.tcgplayer.com/product/1",
    );
  });

  it("drops anything else", () => {
    expect(safeTcgplayerUrl("javascript:alert(1)")).toBeNull();
    expect(safeTcgplayerUrl("http://tcgplayer.com/x")).toBeNull();
    expect(safeTcgplayerUrl("https://tcgplayer.com.evil.example/x")).toBeNull();
    expect(safeTcgplayerUrl("https://eviltcgplayer.com/x")).toBeNull();
    expect(safeTcgplayerUrl(42)).toBeNull();
  });
});

describe("allowLookup", () => {
  it("limits each client per time window", () => {
    const t = 1_000_000;
    for (let i = 0; i < RATE_LIMIT.MAX_PER_WINDOW; i++)
      expect(allowLookup("a", t)).toBe(true);
    expect(allowLookup("a", t)).toBe(false);
    expect(allowLookup("b", t)).toBe(true);
    expect(allowLookup("a", t + RATE_LIMIT.WINDOW_MS)).toBe(true);
  });
});
