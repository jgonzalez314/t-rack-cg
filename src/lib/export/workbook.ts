// Turns the collection into a formatted Excel workbook: a summary per
// folder, then every card, buy and sell. Everything comes from data saved in
// this browser, so it works offline.

import { summarize, type Data } from "@/lib/data/local-store";
import type { Card, CardSummary, Folder } from "@/lib/data/types";
import type { SavedSuggestion } from "@/lib/pricing/cache";
import { buildXlsx, columnName, excelDate, excelDateFromIso, type Cell, type CellStyle, type Row, type Sheet } from "./xlsx";

const CURRENCY = "$#,##0.00";
const PROFIT = "$#,##0.00;[Red]-$#,##0.00";
const DATE = "yyyy-mm-dd";
const INT = "#,##0";

const header: CellStyle = {
  bold: true,
  color: "FFFFFF",
  fill: "1F4E78",
  align: "center",
  wrap: true,
  borderBottom: true,
};
const totalFill = "DDEBF7";
const total = (numFmt?: string): CellStyle => ({ bold: true, fill: totalFill, borderTop: true, numFmt });

const money = (value: number | null | undefined, numFmt = CURRENCY): Cell => ({ value, style: { numFmt } });
const int = (value: number | null | undefined): Cell => ({ value, style: { numFmt: INT } });
const date = (iso: string | null | undefined): Cell =>
  iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? { value: excelDateFromIso(iso.slice(0, 10)), style: { numFmt: DATE } } : {};
/** Percent stored as 80 in the app; Excel wants 0.8. */
const percent = (p: number): Cell => ({
  value: p / 100,
  style: { numFmt: Number.isInteger(p) ? "0%" : "0.0%", align: "right" },
});

const round2 = (n: number) => Math.round(n * 100) / 100;

export function cardDetails(c: Card): string {
  return c.type === "raw"
    ? (c.condition ?? "")
    : `${c.grading_company ?? ""} ${c.grade ?? ""}${c.cert_number ? ` · cert ${c.cert_number}` : ""}`.trim();
}

interface Column {
  title: string;
  width?: number;
  /** How the totals row adds up this column: a SUM, or a label. */
  total?: "sum" | string;
  numFmt?: string;
}

/** A table sheet: styled header, frozen and filterable, with a totals row. */
function table(name: string, columns: Column[], rows: Row[]): Sheet {
  const out: Row[] = [columns.map((c) => ({ value: c.title, style: header }))];
  out.push(...rows);
  const last = rows.length + 1; // last data row, 1-based
  if (rows.length) {
    out.push(
      columns.map((c, i): Cell => {
        if (c.total === "sum") {
          const values = rows.map((r) => {
            const cell = r[i];
            const v = cell && typeof cell === "object" && !(cell instanceof Date) ? cell.value : cell;
            return typeof v === "number" ? v : 0;
          });
          const col = columnName(i);
          return {
            formula: `SUM(${col}2:${col}${last})`,
            value: round2(values.reduce((a, b) => a + b, 0)),
            style: total(c.numFmt),
          };
        }
        return { value: c.total ?? "", style: total() };
      }),
    );
  }
  return {
    name,
    rows: out,
    widths: columns.map((c) => c.width ?? 0),
    freezeRows: 1,
    filterRows: rows.length ? last : undefined,
  };
}

export interface ExportOptions {
  /** Only this folder. Leave out for everything. */
  folderId?: string;
  /** Saved TCGplayer suggestions by card id (see savedSuggestions). */
  suggestions?: Record<string, SavedSuggestion>;
  now?: Date;
}

export function buildWorkbookSheets(data: Data, options: ExportOptions = {}): Sheet[] {
  const suggestions = options.suggestions ?? {};
  const now = options.now ?? new Date();
  const folders = data.folders
    .filter((f) => !options.folderId || f.id === options.folderId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const folderById = new Map(folders.map((f) => [f.id, f]));
  const cards: CardSummary[] = data.cards
    .filter((c) => folderById.has(c.folder_id))
    .map((c) => summarize(c, data.purchases, data.sales));
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const folderName = (c: Card) => folderById.get(c.folder_id)?.name ?? "";
  const byFolderThenCard = (a: CardSummary, b: CardSummary) =>
    folderName(a).localeCompare(folderName(b)) ||
    a.name.localeCompare(b.name) ||
    a.card_number.localeCompare(b.card_number, undefined, { numeric: true }) ||
    cardDetails(a).localeCompare(cardDetails(b));
  cards.sort(byFolderThenCard);
  const cardOrder = new Map(cards.map((c, i) => [c.id, i]));

  const suggestedValue = (c: CardSummary) => {
    const price = suggestions[c.id]?.price;
    return price == null ? null : round2(price * c.quantity_owned);
  };

  // ---- Summary ----
  const summaryRows: Row[] = folders.map((f: Folder) => {
    const inFolder = cards.filter((c) => c.folder_id === f.id);
    const sum = (fn: (c: CardSummary) => number) => round2(inFolder.reduce((n, c) => n + fn(c), 0));
    const priced = inFolder.filter((c) => suggestedValue(c) !== null);
    return [
      f.name,
      f.description ?? "",
      int(inFolder.length),
      int(sum((c) => c.copies_bought)),
      int(sum((c) => c.copies_sold)),
      int(sum((c) => c.quantity_owned)),
      money(sum((c) => c.total_cost)),
      money(sum((c) => c.total_received)),
      money(sum((c) => c.realized_profit), PROFIT),
      money(priced.length ? round2(priced.reduce((n, c) => n + (suggestedValue(c) ?? 0), 0)) : null),
    ];
  });
  const summary = table(
    "Summary",
    [
      { title: "Folder", total: "Total", width: 24 },
      { title: "Description", width: 30 },
      { title: "Cards", total: "sum", numFmt: INT, width: 9 },
      { title: "Copies bought", total: "sum", numFmt: INT, width: 11 },
      { title: "Copies sold", total: "sum", numFmt: INT, width: 11 },
      { title: "Copies owned", total: "sum", numFmt: INT, width: 11 },
      { title: "Spent", total: "sum", numFmt: CURRENCY, width: 14 },
      { title: "Received", total: "sum", numFmt: CURRENCY, width: 14 },
      { title: "Profit", total: "sum", numFmt: PROFIT, width: 14 },
      { title: "Suggested value (raw, owned)", total: "sum", numFmt: CURRENCY, width: 16 },
    ],
    summaryRows,
  );
  const note: CellStyle = { color: "595959" };
  summary.rows.push(
    [],
    [{ value: "Exported", style: { bold: true } }, { value: excelDate(now), style: { numFmt: DATE, align: "left" } }],
    [{ value: "Profit uses average cost. Listings (sold quantity 0) are not counted as sales.", style: note }],
    [
      {
        value:
          "Suggested value: copies owned × the TCGplayer suggested price last saved on this device, for raw cards that have one.",
        style: note,
      },
    ],
  );

  // ---- Cards ----
  const cardRows: Row[] = cards.map((c) => {
    const s = suggestions[c.id];
    return [
      folderName(c),
      c.name,
      c.card_number,
      c.type === "raw" ? "Raw" : "Slab",
      c.condition ?? "",
      c.grading_company ?? "",
      { value: c.grade ?? null, style: { align: "center" } },
      c.cert_number ?? "",
      int(c.copies_bought),
      int(c.copies_sold),
      int(c.quantity_owned),
      money(c.total_cost),
      money(c.copies_bought ? c.average_cost : null),
      money(c.total_received),
      money(c.realized_profit, PROFIT),
      money(c.quantity_owned > 0 ? c.asking_price : null),
      money(s?.price ?? null),
      date(s?.date),
      date(c.created_at),
    ];
  });
  const cardsSheet = table(
    "Cards",
    [
      { title: "Folder", total: "Total", width: 20 },
      { title: "Card", width: 24 },
      { title: "Number", width: 10 },
      { title: "Type", width: 7 },
      { title: "Condition", width: 10 },
      { title: "Grader", width: 8 },
      { title: "Grade", width: 7 },
      { title: "Cert number", width: 14 },
      { title: "Bought", total: "sum", numFmt: INT, width: 8 },
      { title: "Sold", total: "sum", numFmt: INT, width: 8 },
      { title: "Owned", total: "sum", numFmt: INT, width: 8 },
      { title: "Spent", total: "sum", numFmt: CURRENCY, width: 13 },
      { title: "Average cost", width: 13 },
      { title: "Received", total: "sum", numFmt: CURRENCY, width: 13 },
      { title: "Profit", total: "sum", numFmt: PROFIT, width: 13 },
      { title: "Asking price", width: 13 },
      { title: "TCGplayer suggested", width: 13 },
      { title: "TCGplayer price date", width: 12 },
      { title: "Added", width: 12 },
    ],
    cardRows,
  );

  // ---- Buys ----
  const inOrder = <T extends { card_id: string; created_at: string }>(rows: T[], dateOf: (r: T) => string) =>
    rows
      .filter((r) => cardById.has(r.card_id))
      .sort(
        (a, b) =>
          cardOrder.get(a.card_id)! - cardOrder.get(b.card_id)! ||
          dateOf(a).localeCompare(dateOf(b)) ||
          a.created_at.localeCompare(b.created_at),
      );

  const buyRows: Row[] = inOrder(data.purchases, (p) => p.buy_date).map((p, i) => {
    const c = cardById.get(p.card_id)!;
    const r = i + 2;
    const each = round2((p.buy_price * p.buy_percentage) / 100);
    return [
      folderName(c),
      c.name,
      c.card_number,
      cardDetails(c),
      date(p.buy_date),
      money(p.buy_price),
      percent(p.buy_percentage),
      { formula: `F${r}*G${r}`, value: each, style: { numFmt: CURRENCY } },
      int(p.quantity),
      { formula: `F${r}*G${r}*I${r}`, value: round2((p.buy_price * p.buy_percentage * p.quantity) / 100), style: { numFmt: CURRENCY } },
    ];
  });
  const buys = table(
    "Buys",
    [
      { title: "Folder", total: "Total", width: 20 },
      { title: "Card", width: 24 },
      { title: "Number", width: 10 },
      { title: "Condition / grade", width: 22 },
      { title: "Date", width: 12 },
      { title: "Market price", width: 13 },
      { title: "% paid", width: 9 },
      { title: "Paid per card", width: 13 },
      { title: "Quantity", total: "sum", numFmt: INT, width: 9 },
      { title: "Total paid", total: "sum", numFmt: CURRENCY, width: 13 },
    ],
    buyRows,
  );

  // ---- Sells ----
  const sellRows: Row[] = inOrder(data.sales, (s) => s.sell_date).map((s, i) => {
    const c = cardById.get(s.card_id)!;
    const r = i + 2;
    return [
      folderName(c),
      c.name,
      c.card_number,
      cardDetails(c),
      date(s.sell_date),
      s.sell_quantity === 0 ? "Listed" : "Sold",
      money(s.sell_price),
      percent(s.sell_percentage),
      { formula: `G${r}*H${r}`, value: round2((s.sell_price * s.sell_percentage) / 100), style: { numFmt: CURRENCY } },
      int(s.sell_quantity),
      {
        formula: `G${r}*H${r}*J${r}`,
        value: round2((s.sell_price * s.sell_percentage * s.sell_quantity) / 100),
        style: { numFmt: CURRENCY },
      },
    ];
  });
  const sells = table(
    "Sells",
    [
      { title: "Folder", total: "Total", width: 20 },
      { title: "Card", width: 24 },
      { title: "Number", width: 10 },
      { title: "Condition / grade", width: 22 },
      { title: "Date", width: 12 },
      { title: "Status", width: 9 },
      { title: "Market price", width: 13 },
      { title: "% received", width: 10 },
      { title: "Price per card", width: 13 },
      { title: "Quantity sold", total: "sum", numFmt: INT, width: 10 },
      { title: "Total received", total: "sum", numFmt: CURRENCY, width: 14 },
    ],
    sellRows,
  );

  return [summary, cardsSheet, buys, sells];
}

export function exportFileName(folder: Folder | undefined, now = new Date()): string {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const slug = folder
    ? "-" +
      folder.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40)
    : "";
  return `t-rack-cg${slug === "-" ? "" : slug}-${day}.xlsx`;
}

export function buildWorkbook(data: Data, options: ExportOptions = {}): Uint8Array {
  return buildXlsx(buildWorkbookSheets(data, options), { title: "T-rack-CG collection", created: options.now });
}
