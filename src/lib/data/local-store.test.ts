import { beforeEach, describe, expect, it } from "vitest";
import { LocalStore, LocalStoreError, STORAGE_KEY, type KeyValueStorage } from "./local-store";

function memoryStorage(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

let storage: ReturnType<typeof memoryStorage>;
let store: LocalStore;
let folderId: string;

beforeEach(() => {
  storage = memoryStorage();
  let n = 0;
  store = new LocalStore(storage, () => new Date("2026-11-10T00:00:00Z"), () => `id-${++n}`);
  folderId = store.createFolder({ name: "Binder" }).id;
});

const raw = (condition: "NM" | "LP" | "MP" = "LP") =>
  ({ type: "raw", folder_id: folderId, name: "Charizard", card_number: "4/102", condition }) as const;

describe("cards", () => {
  it("combines the same raw card and condition in a folder", () => {
    const a = store.addCard(raw("LP"));
    const b = store.addCard({ ...raw("LP"), name: " charizard " });
    expect(b.id).toBe(a.id);
    store.addPurchase({ card_id: a.id, buy_date: "2026-01-01", buy_price: 100, buy_percentage: 80, quantity: 1 });
    store.addPurchase({ card_id: b.id, buy_date: "2026-01-02", buy_price: 100, buy_percentage: 80, quantity: 1 });
    const [summary] = store.listCardSummaries(folderId);
    expect(store.listCardSummaries(folderId)).toHaveLength(1);
    expect(summary.quantity_owned).toBe(2);
  });

  it("keeps different conditions as separate entries", () => {
    const lp = store.addCard(raw("LP"));
    const mp = store.addCard(raw("MP"));
    expect(mp.id).not.toBe(lp.id);
  });

  it("treats the same card in another folder as separate", () => {
    const other = store.createFolder({ name: "Trade binder" });
    const a = store.addCard(raw());
    const b = store.addCard({ ...raw(), folder_id: other.id });
    expect(b.id).not.toBe(a.id);
    store.updateCard(a.id, { name: "Charizard Holo" });
    expect(store.listCardSummaries(other.id)[0].name).toBe("Charizard");
  });

  it("requires grade and cert number for slabs and blocks duplicate certs", () => {
    const slab = { type: "slab", folder_id: folderId, name: "Pikachu", card_number: "58/102", grading_company: "PSA", grade: 10, cert_number: "12345" } as const;
    store.addCard(slab);
    expect(() => store.addCard(slab)).toThrow(LocalStoreError);
    expect(() => store.addCard({ ...slab, cert_number: "999", grade: 11 })).toThrow(/Grade/);
    expect(() => store.addCard({ ...slab, cert_number: " " })).toThrow(/Cert number/);
  });

  it("deleting a folder removes its cards, purchases and sales", () => {
    const card = store.addCard(raw());
    store.addPurchase({ card_id: card.id, buy_date: "2026-01-01", buy_price: 10, buy_percentage: 100, quantity: 1 });
    store.deleteFolder(folderId);
    const saved = JSON.parse(storage.map.get(STORAGE_KEY)!);
    expect(saved).toEqual({ folders: [], cards: [], purchases: [], sales: [] });
  });
});

describe("money", () => {
  it("matches the plan example: bought $100 at 80%, sold $100 at 100% = $20 profit", () => {
    const card = store.addCard(raw());
    store.addPurchase({ card_id: card.id, buy_date: "2026-01-01", buy_price: 100, buy_percentage: 80, quantity: 1 });
    store.addSale({ card_id: card.id, sell_date: "2026-02-01", sell_price: 100, sell_percentage: 100, sell_quantity: 1 });
    const [s] = store.listCardSummaries();
    expect(s).toMatchObject({ total_cost: 80, average_cost: 80, total_received: 100, realized_profit: 20, quantity_owned: 0 });
  });

  it("uses average cost across purchases and allows partial sales", () => {
    const card = store.addCard(raw());
    store.addPurchase({ card_id: card.id, buy_date: "2026-01-01", buy_price: 100, buy_percentage: 80, quantity: 2 });
    store.addPurchase({ card_id: card.id, buy_date: "2026-02-01", buy_price: 120, buy_percentage: 100, quantity: 2 });
    store.addSale({ card_id: card.id, sell_date: "2026-03-01", sell_price: 150, sell_percentage: 90, sell_quantity: 2 });
    const [s] = store.listCardSummaries();
    // cost = 2*80 + 2*120 = 400, average 100; received = 2*135 = 270
    expect(s).toMatchObject({ copies_bought: 4, copies_sold: 2, quantity_owned: 2, average_cost: 100, total_received: 270, realized_profit: 70 });
  });

  it("blocks selling more than you bought, including by deleting a purchase", () => {
    const card = store.addCard(raw());
    const p = store.addPurchase({ card_id: card.id, buy_date: "2026-01-01", buy_price: 10, buy_percentage: 100, quantity: 2 });
    expect(() => store.addSale({ card_id: card.id, sell_date: "2026-02-01", sell_price: 10, sell_percentage: 100, sell_quantity: 3 })).toThrow(/only 2 bought/);
    store.addSale({ card_id: card.id, sell_date: "2026-02-01", sell_price: 10, sell_percentage: 100, sell_quantity: 2 });
    expect(() => store.deletePurchase(p.id)).toThrow(LocalStoreError);
    expect(() => store.updatePurchase(p.id, { quantity: 1 })).toThrow(LocalStoreError);
    expect(store.listCardSummaries()[0].quantity_owned).toBe(0);
  });
});

describe("search", () => {
  it("finds cards by name, number or cert number", () => {
    store.addCard(raw());
    store.addCard({ type: "slab", folder_id: folderId, name: "Pikachu", card_number: "58/102", grading_company: "PSA", grade: 9, cert_number: "ABC123" });
    expect(store.searchCards("char").map((c) => c.name)).toEqual(["Charizard"]);
    expect(store.searchCards("58/").map((c) => c.name)).toEqual(["Pikachu"]);
    expect(store.searchCards("abc1").map((c) => c.name)).toEqual(["Pikachu"]);
  });
});
