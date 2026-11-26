import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { LocalStore, type KeyValueStorage } from "@/lib/data/local-store";
import { Outbox } from "@/lib/data/outbox";
import { syncNow, toResult, type SyncBackend } from "@/lib/data/sync";
import type { Card } from "@/lib/data/types";
import { MemoryTable } from "./memory-table";
import { DynamoStore, type StoreResult } from "./store";

const NOW = "2026-11-25T00:00:00.000Z";
let table: MemoryTable;
let db: DynamoStore;

beforeEach(() => {
  table = new MemoryTable();
  db = new DynamoStore(table, () => new Date(NOW));
});

const stamps = {
  created_at: "2026-11-20T00:00:00.000Z",
  updated_at: "2026-11-20T00:00:00.000Z",
};
const folder = (id = randomUUID()) => ({
  id,
  name: "Binder",
  description: null,
  ...stamps,
});
const raw = (folder_id: string, extra: Partial<Card> = {}) => ({
  id: randomUUID(),
  folder_id,
  type: "raw",
  name: "Charizard",
  card_number: "4/102",
  game: "Pokemon",
  language: "English",
  condition: "NM",
  grading_company: null,
  grade: null,
  cert_number: null,
  ...stamps,
  ...extra,
});
const slab = (folder_id: string, cert = "123") => ({
  ...raw(folder_id),
  condition: null,
  type: "slab",
  grading_company: "PSA",
  grade: 9.5,
  cert_number: cert,
});
const buy = (card_id: string, quantity: number, id = randomUUID()) => ({
  id,
  card_id,
  buy_date: "2026-11-01",
  buy_price: 100,
  buy_percentage: 80,
  quantity,
  ...stamps,
});
const sell = (card_id: string, sell_quantity: number, id = randomUUID()) => ({
  id,
  card_id,
  sell_date: "2026-11-10",
  sell_price: 150,
  sell_percentage: 90,
  sell_quantity,
  ...stamps,
});

const ok: StoreResult = { ok: true };
const code = (r: StoreResult) => (r.ok ? "ok" : r.code);

async function binderWithCard() {
  const f = folder();
  const c = raw(f.id);
  expect(await db.upsert("folders", f)).toEqual(ok);
  expect(await db.upsert("cards", c)).toEqual(ok);
  return { f, c };
}

describe("cards", () => {
  it("saves and reads back folders and cards, with the server's update time", async () => {
    const { f, c } = await binderWithCard();
    const data = await db.fetchAll();
    expect(data.folders).toEqual([{ ...f, updated_at: NOW }]);
    expect(data.cards).toEqual([{ ...c, updated_at: NOW }]);
  });

  it("refuses the same raw card twice in a folder, ignoring case, and finds the first one", async () => {
    const { f, c } = await binderWithCard();
    const twin = raw(f.id, { name: "CHARIZARD" });
    expect(code(await db.upsert("cards", twin))).toBe("23505");
    expect(await db.findMatchingCard(twin as Card)).toBe(c.id);
  });

  it("allows the same card in another condition or another folder", async () => {
    const { f } = await binderWithCard();
    expect(await db.upsert("cards", raw(f.id, { condition: "LP" }))).toEqual(
      ok,
    );
    const other = folder();
    await db.upsert("folders", other);
    expect(await db.upsert("cards", raw(other.id))).toEqual(ok);
  });

  it("frees a card's old key when it is edited", async () => {
    const { f, c } = await binderWithCard();
    expect(await db.upsert("cards", { ...c, condition: "LP" })).toEqual(ok);
    expect(await db.upsert("cards", raw(f.id))).toEqual(ok);
    expect(
      [...table.items.keys()].filter((k) => k.startsWith("UNIQ#")),
    ).toHaveLength(2);
  });

  it("keeps slab certs unique in a folder", async () => {
    const f = folder();
    await db.upsert("folders", f);
    expect(await db.upsert("cards", slab(f.id))).toEqual(ok);
    expect(code(await db.upsert("cards", slab(f.id)))).toBe("23505");
    expect(await db.upsert("cards", slab(f.id, "456"))).toEqual(ok);
  });

  it("needs the folder to exist", async () => {
    expect(code(await db.upsert("cards", raw(randomUUID())))).toBe("23503");
  });

  it("checks the same rules as the database", async () => {
    const f = folder();
    await db.upsert("folders", f);
    expect(code(await db.upsert("cards", raw(f.id, { name: "  " })))).toBe(
      "23514",
    );
    expect(code(await db.upsert("cards", raw(f.id, { condition: null })))).toBe(
      "23514",
    );
    expect(
      code(await db.upsert("cards", raw(f.id, { cert_number: "1" }))),
    ).toBe("23514");
    expect(code(await db.upsert("cards", { ...slab(f.id), grade: 11 }))).toBe(
      "23514",
    );
    expect(
      code(await db.upsert("cards", { ...slab(f.id), cert_number: null })),
    ).toBe("23514");
    expect(code(await db.upsert("folders", { ...folder(), name: "" }))).toBe(
      "23514",
    );
    expect(
      code(await db.upsert("folders", { ...folder(), id: "not-a-uuid" })),
    ).toBe("23514");
  });

  it("only stores known columns", async () => {
    const f = { ...folder(), user_id: "someone-else", extra: "x" };
    await db.upsert("folders", f);
    const [saved] = (await db.fetchAll()).folders;
    expect(Object.keys(saved).sort()).toEqual([
      "created_at",
      "description",
      "id",
      "name",
      "updated_at",
    ]);
  });
});

describe("purchases and sales", () => {
  it("needs the card to exist", async () => {
    expect(code(await db.upsert("purchases", buy(randomUUID(), 1)))).toBe(
      "23503",
    );
    expect(code(await db.upsert("sales", sell(randomUUID(), 1)))).toBe("23503");
  });

  it("never sells more copies than were bought", async () => {
    const { c } = await binderWithCard();
    const b = buy(c.id, 2);
    expect(await db.upsert("purchases", b)).toEqual(ok);
    const s = sell(c.id, 2);
    expect(await db.upsert("sales", s)).toEqual(ok);
    expect(code(await db.upsert("sales", sell(c.id, 1)))).toBe("23514");
    // Lowering or deleting the purchase would leave more sold than bought.
    expect(code(await db.upsert("purchases", { ...b, quantity: 1 }))).toBe(
      "23514",
    );
    expect(code(await db.remove("purchases", b.id))).toBe("23514");
    // Deleting the sale first makes room.
    expect(await db.remove("sales", s.id)).toEqual(ok);
    expect(await db.remove("purchases", b.id)).toEqual(ok);
  });

  it("allows a listing (0 sold) with nothing bought", async () => {
    const { c } = await binderWithCard();
    expect(await db.upsert("sales", sell(c.id, 0))).toEqual(ok);
    expect(code(await db.upsert("purchases", buy(c.id, 0)))).toBe("23514");
  });

  it("moves totals when a purchase moves to another card", async () => {
    const { f, c } = await binderWithCard();
    const other = raw(f.id, { condition: "LP" });
    await db.upsert("cards", other);
    const b = buy(c.id, 3);
    await db.upsert("purchases", b);
    await db.upsert("sales", sell(c.id, 1));
    // Moving it would leave the first card with 1 sold and 0 bought.
    expect(
      code(await db.upsert("purchases", { ...b, card_id: other.id })),
    ).toBe("23514");
    await db.upsert("purchases", buy(c.id, 1));
    expect(await db.upsert("purchases", { ...b, card_id: other.id })).toEqual(
      ok,
    );
    expect(table.items.get(`CARD#${c.id}`)).toMatchObject({
      bought: 1,
      sold: 1,
    });
    expect(table.items.get(`CARD#${other.id}`)).toMatchObject({
      bought: 3,
      sold: 0,
    });
  });

  it("keeps a card's totals when the card itself is edited", async () => {
    const { c } = await binderWithCard();
    await db.upsert("purchases", buy(c.id, 2));
    await db.upsert("cards", { ...c, name: "Charizard Holo" });
    expect(table.items.get(`CARD#${c.id}`)).toMatchObject({
      bought: 2,
      name: "Charizard Holo",
    });
  });

  it("saving the same change twice does not count it twice", async () => {
    const { c } = await binderWithCard();
    const b = buy(c.id, 2);
    await db.upsert("purchases", b);
    await db.upsert("purchases", b);
    expect(table.items.get(`CARD#${c.id}`)).toMatchObject({ bought: 2 });
  });
});

describe("deletes", () => {
  it("deleting a folder deletes its cards, buys, sells and card keys", async () => {
    const { f, c } = await binderWithCard();
    await db.upsert("purchases", buy(c.id, 1));
    await db.upsert("sales", sell(c.id, 1));
    const keep = folder();
    await db.upsert("folders", keep);
    await db.upsert("cards", raw(keep.id));

    expect(await db.remove("folders", f.id)).toEqual(ok);
    const data = await db.fetchAll();
    expect(data.folders.map((x) => x.id)).toEqual([keep.id]);
    expect(data.cards).toHaveLength(1);
    expect(data.purchases).toEqual([]);
    expect(data.sales).toEqual([]);
    expect(table.items.size).toBe(3); // folder, card, its key
    // The card can be added again to a new folder with the same id rules.
    expect(await db.findMatchingCard(c as Card)).toBeNull();
  });

  it("deleting a card deletes its buys and sells", async () => {
    const { c } = await binderWithCard();
    await db.upsert("purchases", buy(c.id, 1));
    expect(await db.remove("cards", c.id)).toEqual(ok);
    expect(table.items.size).toBe(1);
  });

  it("deleting something already gone is fine", async () => {
    expect(await db.remove("sales", randomUUID())).toEqual(ok);
    expect(await db.remove("cards", randomUUID())).toEqual(ok);
  });
});

describe("with sync", () => {
  function memoryStorage(): KeyValueStorage {
    const map = new Map<string, string>();
    return {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
    };
  }
  const backend: () => SyncBackend = () => ({
    upsert: async (t, row) =>
      toResult(asError(await db.upsert(t, row as never))),
    remove: async (t, id) => toResult(asError(await db.remove(t, id))),
    findMatchingCard: (card) => db.findMatchingCard(card),
    fetchAll: () => db.fetchAll(),
  });
  const asError = (r: StoreResult) =>
    r.ok ? null : { code: r.code, message: r.message };

  function device() {
    const storage = memoryStorage();
    const outbox = new Outbox(storage);
    const store = new LocalStore(
      storage,
      undefined,
      () => randomUUID(),
      (change) => outbox.add(change),
    );
    return {
      store,
      sync: () => syncNow({ store, outbox, backend: backend(), storage }),
    };
  }

  it("merges a raw card two devices added to the same folder, adding up their buys", async () => {
    const phone = device();
    const laptop = device();
    const f = phone.store.createFolder({ name: "Binder" });
    await phone.sync();
    await laptop.sync();

    const card = {
      type: "raw",
      folder_id: f.id,
      name: "Pikachu",
      card_number: "58/102",
      condition: "NM",
    } as const;
    const a = phone.store.addCard(card);
    phone.store.addPurchase({
      card_id: a.id,
      buy_date: "2026-11-01",
      buy_price: 10,
      buy_percentage: 100,
      quantity: 1,
    });
    const b = laptop.store.addCard(card);
    laptop.store.addPurchase({
      card_id: b.id,
      buy_date: "2026-11-02",
      buy_price: 12,
      buy_percentage: 100,
      quantity: 2,
    });

    expect((await phone.sync()).status).toBe("synced");
    expect((await laptop.sync()).status).toBe("synced");
    await phone.sync();
    for (const d of [phone, laptop]) {
      const [s] = d.store.listCardSummaries(f.id);
      expect(s).toMatchObject({ id: a.id, copies_bought: 3 });
    }
  });
});
