import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LocalStore, type KeyValueStorage } from "@/lib/data/local-store";
import { buildWorkbook, buildWorkbookSheets, exportFileName } from "./workbook";
import { unzip } from "./test-unzip";

function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

function sample() {
  let n = 0;
  const store = new LocalStore(memoryStorage(), () => new Date("2026-11-10T00:00:00Z"), () => `id-${++n}`);
  const binder = store.createFolder({ name: "Main binder", description: "Vintage" });
  const slabs = store.createFolder({ name: "Slabs" });
  const zard = store.addCard({ type: "raw", folder_id: binder.id, name: "Charizard", card_number: "4/102", condition: "LP" });
  const pika = store.addCard({ type: "raw", folder_id: binder.id, name: "Pikachu", card_number: "58/102", condition: "NM" });
  const slab = store.addCard({
    type: "slab",
    folder_id: slabs.id,
    name: "Blastoise",
    card_number: "2/102",
    grading_company: "PSA",
    grade: 9,
    cert_number: "12345678",
  });
  store.addPurchase({ card_id: zard.id, buy_date: "2026-01-05", buy_price: 300, buy_percentage: 80, quantity: 2 });
  store.addPurchase({ card_id: pika.id, buy_date: "2026-02-01", buy_price: 10, buy_percentage: 72.5, quantity: 4 });
  store.addPurchase({ card_id: slab.id, buy_date: "2026-03-01", buy_price: 500, buy_percentage: 90, quantity: 1 });
  store.addSale({ card_id: zard.id, sell_date: "2026-04-01", sell_price: 350, sell_percentage: 95, sell_quantity: 1 });
  store.addSale({ card_id: zard.id, sell_date: "2026-05-01", sell_price: 360, sell_percentage: 100, sell_quantity: 0 });
  store.addSale({ card_id: pika.id, sell_date: "2026-04-10", sell_price: 8, sell_percentage: 50, sell_quantity: 1 });
  return { store, binder, slabs, zard, pika, slab };
}

const now = new Date(2026, 10, 19, 12);

describe("buildWorkbookSheets", () => {
  it("makes summary, cards, buys and sells sheets with totals", () => {
    const { store, zard } = sample();
    const sheets = buildWorkbookSheets(store.allData(), {
      now,
      suggestions: { [zard.id]: { price: 340, date: "2026-11-15", set: "Base", printing: "holofoil" } },
    });
    expect(sheets.map((s) => s.name)).toEqual(["Summary", "Cards", "Buys", "Sells"]);
    for (const s of sheets) expect(s.freezeRows).toBe(1);

    const [summary, cards, buys, sells] = sheets;
    const value = (c: unknown) => (c && typeof c === "object" && "value" in c ? c.value : c);

    // Summary: one row per folder, then totals with SUM formulas.
    expect(summary.rows[1].map(value).slice(0, 9)).toEqual(["Main binder", "Vintage", 2, 6, 2, 4, 509, 336.5, 89.25]);
    expect(value(summary.rows[1][9])).toBe(340); // 1 Charizard owned × $340
    const totals = summary.rows[3];
    expect(value(totals[0])).toBe("Total");
    expect(totals[6]).toMatchObject({ formula: "SUM(G2:G3)", value: 959 });

    // Cards are sorted by folder then name.
    expect(cards.rows.slice(1, 4).map((r) => value(r[1]))).toEqual(["Charizard", "Pikachu", "Blastoise"]);
    expect(value(cards.rows[1][15])).toBe(360); // asking price from the listing
    expect(value(cards.rows[1][16])).toBe(340);
    expect(cards.filterRows).toBe(4);

    // Buys: percent as a fraction, per-card and total paid as formulas.
    expect(buys.rows[2][6]).toMatchObject({ value: 0.725, style: { numFmt: "0.0%" } });
    expect(buys.rows[1][9]).toMatchObject({ formula: "F2*G2*I2", value: 480 });
    expect(buys.rows[4][9]).toMatchObject({ formula: "SUM(J2:J4)", value: 959 });

    // Sells: listings are marked and count 0.
    expect(sells.rows.slice(1, 4).map((r) => value(r[5]))).toEqual(["Sold", "Listed", "Sold"]);
    expect(sells.rows[4][10]).toMatchObject({ formula: "SUM(K2:K4)", value: 336.5 });
  });

  it("exports one folder when asked", () => {
    const { store, slabs } = sample();
    const [summary, cards, buys, sells] = buildWorkbookSheets(store.allData(), { folderId: slabs.id, now });
    expect(summary.rows[1][0]).toBe("Slabs");
    expect(cards.rows).toHaveLength(3); // header, Blastoise, totals
    expect(cards.rows[1][3]).toBe("Slab");
    expect(buys.rows).toHaveLength(3);
    expect(sells.rows).toHaveLength(1); // header only
    expect(sells.filterRows).toBeUndefined();
  });

  it("builds a valid file", () => {
    const { store, zard } = sample();
    const bytes = buildWorkbook(store.allData(), {
      now,
      suggestions: { [zard.id]: { price: 340, date: "2026-11-15", set: "Base", printing: "holofoil" } },
    });
    if (process.env.XLSX_OUT) writeFileSync(process.env.XLSX_OUT, bytes);
    const files = unzip(bytes);
    expect(Object.keys(files).filter((f) => f.startsWith("xl/worksheets/"))).toHaveLength(4);
    expect(files["xl/workbook.xml"]).toContain('<sheet name="Sells" sheetId="4" r:id="rId4"/>');
  });
});

describe("exportFileName", () => {
  it("names the file by date and folder", () => {
    expect(exportFileName(undefined, now)).toBe("t-rack-cg-2026-11-19.xlsx");
    expect(exportFileName({ name: "Main Binder #1!" } as never, now)).toBe("t-rack-cg-main-binder-1-2026-11-19.xlsx");
    expect(exportFileName({ name: "!!!" } as never, now)).toBe("t-rack-cg-2026-11-19.xlsx");
  });
});
