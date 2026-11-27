// Folders, cards, purchases and sales in DynamoDB, for one user.
//
// DynamoDB has no unique indexes, foreign keys, triggers or views, so this
// file enforces the rules that supabase/migrations/20261110000000_init.sql
// (and the sale listings migration) leave to Postgres:
//
// - One row per raw card (name, number, game, language, condition) in a
//   folder, and one per slab cert in a folder. Each card also writes a
//   UNIQ# item for its key, put on the condition that no other card owns it.
// - A card needs its folder, and a purchase or sale needs its card.
// - Never more copies sold than bought. Each card keeps running totals
//   (bought, sold) that every purchase or sale change updates in the same
//   transaction, on the condition that nobody changed the card meanwhile.
// - Deleting a folder deletes its cards, and deleting a card deletes its
//   purchases and sales.
//
// card_summary is not stored: the app works out the same numbers on the
// device (LocalStore.listCardSummaries).
//
// Errors carry the Postgres error code for the same problem, so sync treats
// them exactly as it treats Supabase's: 23505 duplicate card, 23503 missing
// folder or card, 23514 broken rule, 40001 changed at the same time (try
// again).

import type { Data, Table } from "@/lib/data/local-store";
import {
  CONDITIONS,
  GRADING_COMPANIES,
  type Card,
  type Folder,
  type Purchase,
  type Sale,
} from "@/lib/data/types";
import { ConditionFailed, type Item, type ItemTable, type Op } from "./table";

export type StoreResult =
  { ok: true } | { ok: false; code: string; message: string };

export const TABLES: readonly Table[] = [
  "folders",
  "cards",
  "purchases",
  "sales",
];

const PREFIX: Record<Table, string> = {
  folders: "FOLDER#",
  cards: "CARD#",
  purchases: "PURCHASE#",
  sales: "SALE#",
};
const sk = (table: Table, id: string) => PREFIX[table] + id;

const FIELDS = {
  folders: [
    "id",
    "name",
    "description",
    "sort_order",
    "created_at",
    "updated_at",
  ],
  cards: [
    "id",
    "folder_id",
    "type",
    "name",
    "card_number",
    "game",
    "language",
    "condition",
    "grading_company",
    "grade",
    "cert_number",
    "sort_order",
    "created_at",
    "updated_at",
  ],
  purchases: [
    "id",
    "card_id",
    "buy_date",
    "buy_price",
    "buy_percentage",
    "quantity",
    "created_at",
    "updated_at",
  ],
  sales: [
    "id",
    "card_id",
    "sell_date",
    "sell_price",
    "sell_percentage",
    "sell_quantity",
    "created_at",
    "updated_at",
  ],
} as const satisfies Record<Table, readonly string[]>;

class Refused extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const broken = (message: string) => new Refused("23514", message);
/** Someone changed the same item meanwhile. Worth trying again. */
class Raced extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function text(v: unknown, what: string, max = 500): string {
  if (typeof v !== "string" || !v.trim()) throw broken(`${what} is required`);
  if (v.length > max) throw broken(`${what} is too long`);
  return v;
}
function optionalText(v: unknown, what: string, max = 2000): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") throw broken(`${what} must be text`);
  if (v.length > max) throw broken(`${what} is too long`);
  return v;
}
function id(v: unknown, what: string): string {
  if (typeof v !== "string" || !UUID.test(v))
    throw broken(`${what} is not a valid id`);
  return v;
}
function stamp(v: unknown, fallback: string): string {
  return typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : fallback;
}
function date(v: unknown, what: string): string {
  if (typeof v !== "string" || !DATE.test(v) || Number.isNaN(Date.parse(v))) {
    throw broken(`${what} must be a date`);
  }
  return v;
}
function money(v: unknown, what: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n >= 1e10)
    throw broken(`${what} must be 0 or more`);
  return Math.round(n * 100) / 100;
}
function count(v: unknown, what: string, min: number): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > 1e9)
    throw broken(`${what} must be a whole number of at least ${min}`);
  return n;
}

function pick<T extends Table>(table: T, item: Item): Data[T][number] {
  const out: Record<string, unknown> = {};
  for (const f of FIELDS[table]) out[f] = item[f] ?? null;
  return out as unknown as Data[T][number];
}

function cleanFolder(row: Record<string, unknown>, now: string): Folder {
  return {
    id: id(row.id, "Folder"),
    name: text(row.name, "Folder name", 200),
    description: optionalText(row.description, "Description"),
    sort_order: sortOrder(row.sort_order),
    created_at: stamp(row.created_at, now),
    updated_at: now,
  };
}

function sortOrder(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 1e9)
    throw broken("Order must be a whole number of 0 or more");
  return n;
}

function cleanCard(row: Record<string, unknown>, now: string): Card {
  const base = {
    id: id(row.id, "Card"),
    folder_id: id(row.folder_id, "Folder"),
    name: text(row.name, "Card name", 200),
    card_number: text(row.card_number, "Card number", 50),
    game:
      typeof row.game === "string" && row.game
        ? row.game.slice(0, 50)
        : "Pokemon",
    language:
      typeof row.language === "string" && row.language
        ? row.language.slice(0, 50)
        : "English",
    sort_order: sortOrder(row.sort_order),
    created_at: stamp(row.created_at, now),
    updated_at: now,
  };
  if (row.type === "raw") {
    if (!CONDITIONS.includes(row.condition as never))
      throw broken("A raw card needs a condition");
    if (
      row.grading_company != null ||
      row.grade != null ||
      row.cert_number != null
    ) {
      throw broken("A raw card has no grade or cert number");
    }
    return {
      ...base,
      type: "raw",
      condition: row.condition as Card["condition"],
      grading_company: null,
      grade: null,
      cert_number: null,
    };
  }
  if (row.type === "slab") {
    if (row.condition != null) throw broken("A slab has no condition");
    if (!GRADING_COMPANIES.includes(row.grading_company as never)) {
      throw broken("A slab needs a grading company");
    }
    const grade = Number(row.grade);
    if (
      !Number.isFinite(grade) ||
      grade < 1 ||
      grade > 10 ||
      Math.round(grade * 10) !== grade * 10
    ) {
      throw broken("Grade must be from 1 to 10");
    }
    return {
      ...base,
      type: "slab",
      condition: null,
      grading_company: row.grading_company as Card["grading_company"],
      grade,
      cert_number: text(row.cert_number, "Cert number", 50),
    };
  }
  throw broken("Card type must be raw or slab");
}

function cleanPurchase(row: Record<string, unknown>, now: string): Purchase {
  return {
    id: id(row.id, "Purchase"),
    card_id: id(row.card_id, "Card"),
    buy_date: date(row.buy_date, "Buy date"),
    buy_price: money(row.buy_price, "Buy price"),
    buy_percentage: money(row.buy_percentage ?? 100, "Buy percentage"),
    quantity: count(row.quantity, "Quantity", 1),
    created_at: stamp(row.created_at, now),
    updated_at: now,
  };
}

function cleanSale(row: Record<string, unknown>, now: string): Sale {
  return {
    id: id(row.id, "Sale"),
    card_id: id(row.card_id, "Card"),
    sell_date: date(row.sell_date, "Sell date"),
    sell_price: money(row.sell_price, "Sell price"),
    sell_percentage: money(row.sell_percentage ?? 100, "Sell percentage"),
    sell_quantity: count(row.sell_quantity, "Sell quantity", 0),
    created_at: stamp(row.created_at, now),
    updated_at: now,
  };
}

/**
 * The key that makes two cards "the same card in the same folder". Matches
 * the cards_raw_unique_in_folder and cards_slab_unique_in_folder indexes.
 */
export function uniqueKey(
  card: Pick<
    Card,
    | "folder_id"
    | "type"
    | "name"
    | "card_number"
    | "game"
    | "language"
    | "condition"
    | "grading_company"
    | "cert_number"
  >,
) {
  const parts =
    card.type === "raw"
      ? [
          "RAW",
          card.folder_id,
          card.name.toLowerCase(),
          card.card_number.toLowerCase(),
          card.game,
          card.language,
          card.condition,
        ]
      : ["SLAB", card.folder_id, card.grading_company, card.cert_number];
  return "UNIQ#" + parts.map((p) => encodeURIComponent(String(p))).join("#");
}

const rev = (item: Item | undefined) =>
  typeof item?.rev === "number" ? item.rev : 0;
/** The item is unchanged since it was read (or still missing). */
const unchanged = (item: Item | undefined) =>
  item
    ? ({ kind: "equals", attrs: { rev: rev(item) } } as const)
    : ({ kind: "absent" } as const);

const ATTEMPTS = 4;

export class DynamoStore {
  constructor(
    private table: ItemTable,
    private now: () => Date = () => new Date(),
  ) {}

  private async run(fn: () => Promise<void>): Promise<StoreResult> {
    for (let attempt = 1; ; attempt++) {
      try {
        await fn();
        return { ok: true };
      } catch (e) {
        if (e instanceof Refused)
          return { ok: false, code: e.code, message: e.message };
        if (e instanceof Raced) {
          if (attempt < ATTEMPTS) continue;
          return {
            ok: false,
            code: "40001",
            message: "Changed on another device at the same time, try again",
          };
        }
        throw e;
      }
    }
  }

  upsert(table: Table, row: Record<string, unknown>): Promise<StoreResult> {
    if (!row || typeof row !== "object")
      return Promise.resolve({
        ok: false,
        code: "23514",
        message: "Nothing to save",
      });
    return this.run(async () => {
      const now = this.now().toISOString();
      if (table === "folders") return this.putFolder(cleanFolder(row, now));
      if (table === "cards") return this.putCard(cleanCard(row, now));
      if (table === "purchases")
        return this.putMove("purchases", cleanPurchase(row, now));
      return this.putMove("sales", cleanSale(row, now));
    });
  }

  remove(table: Table, rowId: string): Promise<StoreResult> {
    return this.run(async () => {
      if (typeof rowId !== "string" || !rowId)
        throw broken("Nothing to delete");
      if (table === "folders") return this.removeFolder(rowId);
      if (table === "cards") return this.removeCards([rowId]);
      return this.removeMove(table, rowId);
    });
  }

  async findMatchingCard(card: Card): Promise<string | null> {
    let key: string;
    try {
      key = uniqueKey(
        cleanCard(
          card as unknown as Record<string, unknown>,
          this.now().toISOString(),
        ),
      );
    } catch {
      return null;
    }
    const owner = await this.table.get(key);
    return typeof owner?.card_id === "string" ? owner.card_id : null;
  }

  async fetchAll(): Promise<Data> {
    const data: Data = { folders: [], cards: [], purchases: [], sales: [] };
    for (const item of await this.table.all()) {
      for (const t of TABLES) {
        if (item.sk.startsWith(PREFIX[t]))
          (data[t] as unknown[]).push(pick(t, item));
      }
    }
    // A card saved while its folder was being deleted can outlive it. Leave
    // such leftovers out, as the database's cascades would have removed them.
    const folders = new Set(data.folders.map((f) => f.id));
    data.cards = data.cards.filter((c) => folders.has(c.folder_id));
    const cards = new Set(data.cards.map((c) => c.id));
    data.purchases = data.purchases.filter((p) => cards.has(p.card_id));
    data.sales = data.sales.filter((s) => cards.has(s.card_id));
    return data;
  }

  // ---- Writes ---------------------------------------------------------------

  private async transact(ops: Op[], refusals: Record<number, Refused>) {
    try {
      await this.table.transact(ops);
    } catch (e) {
      if (e instanceof ConditionFailed) throw refusals[e.index] ?? new Raced();
      throw e;
    }
  }

  private async putFolder(folder: Folder) {
    const old = await this.table.get(sk("folders", folder.id));
    await this.transact(
      [
        {
          type: "put",
          item: { sk: sk("folders", folder.id), ...folder, rev: rev(old) + 1 },
          cond: unchanged(old),
        },
      ],
      {},
    );
  }

  private async putCard(card: Card) {
    const old = await this.table.get(sk("cards", card.id));
    const key = uniqueKey(card);
    const ops: Op[] = [
      {
        type: "check",
        sk: sk("folders", card.folder_id),
        cond: { kind: "exists" },
      },
      {
        type: "put",
        item: { sk: key, card_id: card.id },
        cond: { kind: "absentOrEquals", attrs: { card_id: card.id } },
      },
      {
        type: "put",
        item: {
          sk: sk("cards", card.id),
          ...card,
          uniq: key,
          bought: typeof old?.bought === "number" ? old.bought : 0,
          sold: typeof old?.sold === "number" ? old.sold : 0,
          rev: rev(old) + 1,
        },
        cond: unchanged(old),
      },
    ];
    if (typeof old?.uniq === "string" && old.uniq !== key) {
      ops.push({
        type: "delete",
        sk: old.uniq,
        cond: { kind: "absentOrEquals", attrs: { card_id: card.id } },
      });
    }
    await this.transact(ops, {
      0: new Refused("23503", "That folder no longer exists"),
      1: new Refused("23505", "This card is already in the folder"),
    });
  }

  /**
   * Saves a purchase or sale and moves the card's running totals by the
   * difference, checking that no more copies are sold than bought.
   */
  private async putMove(table: "purchases" | "sales", row: Purchase | Sale) {
    const field = table === "purchases" ? "bought" : "sold";
    const amount = (r: Item | Purchase | Sale | undefined) =>
      Number(
        table === "purchases"
          ? ((r as Purchase | undefined)?.quantity ?? 0)
          : ((r as Sale | undefined)?.sell_quantity ?? 0),
      );

    const old = await this.table.get(sk(table, row.id));
    const cardIds = [
      ...new Set([
        row.card_id,
        ...(typeof old?.card_id === "string" ? [old.card_id] : []),
      ]),
    ];
    const cards = await Promise.all(
      cardIds.map((c) => this.table.get(sk("cards", c))),
    );
    if (!cards[0]) throw new Refused("23503", "That card no longer exists");

    const ops: Op[] = [
      {
        type: "put",
        item: { sk: sk(table, row.id), ...row, rev: rev(old) + 1 },
        cond: unchanged(old),
      },
    ];
    cardIds.forEach((cardId, i) => {
      const card = cards[i];
      if (!card) return; // The old card is gone, and its totals with it.
      let total = Number(card[field] ?? 0);
      if (old && old.card_id === cardId) total -= amount(old);
      if (cardId === row.card_id) total += amount(row);
      const bought = field === "bought" ? total : Number(card.bought ?? 0);
      const sold = field === "sold" ? total : Number(card.sold ?? 0);
      if (sold > bought)
        throw broken(`Cannot sell ${sold} copies; only ${bought} bought`);
      ops.push({
        type: "put",
        item: { ...card, [field]: total, rev: rev(card) + 1 },
        cond: unchanged(card),
      });
    });
    await this.transact(ops, {});
  }

  private async removeMove(table: "purchases" | "sales", rowId: string) {
    const old = await this.table.get(sk(table, rowId));
    if (!old) return;
    const ops: Op[] = [{ type: "delete", sk: old.sk, cond: unchanged(old) }];
    const card =
      typeof old.card_id === "string"
        ? await this.table.get(sk("cards", old.card_id))
        : undefined;
    if (card) {
      const field = table === "purchases" ? "bought" : "sold";
      const total =
        Number(card[field] ?? 0) -
        Number(table === "purchases" ? old.quantity : old.sell_quantity);
      const bought = field === "bought" ? total : Number(card.bought ?? 0);
      const sold = field === "sold" ? total : Number(card.sold ?? 0);
      if (sold > bought)
        throw broken(`Cannot sell ${sold} copies; only ${bought} bought`);
      ops.push({
        type: "put",
        item: { ...card, [field]: total, rev: rev(card) + 1 },
        cond: unchanged(card),
      });
    }
    await this.transact(ops, {});
  }

  /**
   * Deletes cards with their purchases, sales and unique keys. Children go
   * first and the card last, so a delete cut short is finished by retrying.
   */
  private async removeCards(cardIds: string[], items?: Item[]) {
    const all = items ?? (await this.table.all());
    const doomed = new Set(cardIds);
    const children = all
      .filter(
        (i) =>
          (i.sk.startsWith(PREFIX.purchases) ||
            i.sk.startsWith(PREFIX.sales)) &&
          doomed.has(String(i.card_id)),
      )
      .map((i) => i.sk);
    const cards = all.filter(
      (i) => i.sk.startsWith(PREFIX.cards) && doomed.has(String(i.id)),
    );
    const keys = all
      .filter((i) => i.sk.startsWith("UNIQ#") && doomed.has(String(i.card_id)))
      .map((i) => i.sk);
    await this.table.deleteMany([...children, ...keys]);
    await this.table.deleteMany(cards.map((c) => c.sk));
  }

  private async removeFolder(folderId: string) {
    const all = await this.table.all();
    const cardIds = all
      .filter((i) => i.sk.startsWith(PREFIX.cards) && i.folder_id === folderId)
      .map((i) => String(i.id));
    await this.removeCards(cardIds, all);
    await this.table.deleteMany([sk("folders", folderId)]);
  }
}
