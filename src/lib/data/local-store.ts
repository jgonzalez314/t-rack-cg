// Browser storage version of the database, used in local mode.
// It enforces the same rules as supabase/migrations/20261110000000_init.sql:
//   - raw cards with the same name, number, game, language and condition in
//     one folder share one entry
//   - a slab's cert number is unique within a folder
//   - you cannot sell more copies than you bought
//   - a sale with 0 sold is a listing: the asking price, not a sale
//   - deleting a folder deletes its cards; deleting a card deletes its
//     purchases and sales

import {
  CONDITIONS,
  GRADING_COMPANIES,
  type Card,
  type CardSummary,
  type Folder,
  type NewCard,
  type NewFolder,
  type NewPurchase,
  type NewSale,
  type Purchase,
  type Sale,
} from "./types";

export const STORAGE_KEY = "t-rack-cg:data:v1";

export type KeyValueStorage = Pick<Storage, "getItem" | "setItem">;

export type Table = "folders" | "cards" | "purchases" | "sales";

/**
 * A row that was saved or deleted locally. The sync code queues
 * these and sends them to Supabase when the device is online.
 */
export type Change =
  | { kind: "upsert"; table: "folders"; row: Folder }
  | { kind: "upsert"; table: "cards"; row: Card }
  | { kind: "upsert"; table: "purchases"; row: Purchase }
  | { kind: "upsert"; table: "sales"; row: Sale }
  | { kind: "delete"; table: Table; id: string };

export interface Data {
  folders: Folder[];
  cards: Card[];
  purchases: Purchase[];
  sales: Sale[];
}

export class LocalStoreError extends Error {}

/** The fields of a card entry that can be edited. */
export type CardChanges = Partial<
  Pick<
    Card,
    | "folder_id"
    | "type"
    | "name"
    | "card_number"
    | "condition"
    | "grading_company"
    | "grade"
    | "cert_number"
  >
>;

const emptyData = (): Data => ({
  folders: [],
  cards: [],
  purchases: [],
  sales: [],
});

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The order of folders, and of cards in a folder: by sort_order (set by
 * reordering), then those with none by name, so lists nobody has reordered
 * stay A to Z.
 */
export function bySortOrder(
  a: { sort_order?: number | null; name: string },
  b: { sort_order?: number | null; name: string },
) {
  const ao = a.sort_order ?? Infinity;
  const bo = b.sort_order ?? Infinity;
  if (ao !== bo) return ao < bo ? -1 : 1;
  return a.name.localeCompare(b.name);
}
const norm = (s: string) => s.trim().toLowerCase();

function requireText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new LocalStoreError(`${field} is required`);
  return trimmed;
}

function requireNonNegative(value: number, field: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new LocalStoreError(`${field} must be 0 or more`);
  }
}

function requirePositiveInt(value: number, field: string) {
  if (!Number.isInteger(value) || value < 1) {
    throw new LocalStoreError(`${field} must be a whole number of 1 or more`);
  }
}

function requireNonNegativeInt(value: number, field: string) {
  if (!Number.isInteger(value) || value < 0) {
    throw new LocalStoreError(`${field} must be a whole number of 0 or more`);
  }
}

function requireDate(value: string, field: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new LocalStoreError(`${field} must be a date like 2026-01-31`);
  }
}

export class LocalStore {
  constructor(
    private storage: KeyValueStorage,
    private now: () => Date = () => new Date(),
    private newId: () => string = () => crypto.randomUUID(),
    private onChange: (change: Change) => void = () => {},
  ) {}

  // ---- storage ------------------------------------------------------------

  private load(): Data {
    const raw = this.storage.getItem(STORAGE_KEY);
    if (!raw) return emptyData();
    try {
      return { ...emptyData(), ...(JSON.parse(raw) as Partial<Data>) };
    } catch {
      return emptyData();
    }
  }

  private save(data: Data) {
    this.storage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  private stamp() {
    const t = this.now().toISOString();
    return { created_at: t, updated_at: t };
  }

  // ---- folders ------------------------------------------------------------

  listFolders(): Folder[] {
    return [...this.load().folders].sort(bySortOrder);
  }

  /**
   * Puts the folders in the given order, by id. Folders left out keep their
   * current order after the listed ones. Only folders whose place changed
   * are saved.
   */
  reorderFolders(orderedIds: string[]) {
    const data = this.load();
    const current = [...data.folders].sort(bySortOrder);
    const byId = new Map(current.map((f) => [f.id, f]));
    const listed = [...new Set(orderedIds)].filter((fid) => byId.has(fid));
    const rest = current.filter((f) => !listed.includes(f.id));
    const order = [...listed.map((fid) => byId.get(fid)!), ...rest];
    const t = this.now().toISOString();
    const changed: Folder[] = [];
    order.forEach((folder, i) => {
      if (folder.sort_order === i) return;
      const index = data.folders.findIndex((f) => f.id === folder.id);
      const updated = { ...folder, sort_order: i, updated_at: t };
      data.folders[index] = updated;
      changed.push(updated);
    });
    if (!changed.length) return;
    this.save(data);
    for (const row of changed)
      this.onChange({ kind: "upsert", table: "folders", row });
  }

  createFolder(input: NewFolder): Folder {
    const data = this.load();
    const folder: Folder = {
      id: this.newId(),
      name: requireText(input.name, "Folder name"),
      description: input.description?.trim() || null,
      // New folders go after the ones the user has put in order.
      sort_order: null,
      ...this.stamp(),
    };
    data.folders.push(folder);
    this.save(data);
    this.onChange({ kind: "upsert", table: "folders", row: folder });
    return folder;
  }

  updateFolder(id: string, changes: Partial<NewFolder>): Folder {
    const data = this.load();
    const folder = data.folders.find((f) => f.id === id);
    if (!folder) throw new LocalStoreError("Folder not found");
    if (changes.name !== undefined)
      folder.name = requireText(changes.name, "Folder name");
    if (changes.description !== undefined) {
      folder.description = changes.description?.trim() || null;
    }
    folder.updated_at = this.now().toISOString();
    this.save(data);
    this.onChange({ kind: "upsert", table: "folders", row: folder });
    return folder;
  }

  deleteFolder(id: string) {
    const data = this.load();
    const cardIds = new Set(
      data.cards.filter((c) => c.folder_id === id).map((c) => c.id),
    );
    data.folders = data.folders.filter((f) => f.id !== id);
    data.cards = data.cards.filter((c) => !cardIds.has(c.id));
    data.purchases = data.purchases.filter((p) => !cardIds.has(p.card_id));
    data.sales = data.sales.filter((s) => !cardIds.has(s.card_id));
    this.save(data);
    // The database deletes the folder's cards with it.
    this.onChange({ kind: "delete", table: "folders", id });
  }

  getFolder(id: string): Folder | undefined {
    return this.load().folders.find((f) => f.id === id);
  }

  /** Number of card entries in each folder, by folder id. */
  countCardsByFolder(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const c of this.load().cards)
      counts[c.folder_id] = (counts[c.folder_id] ?? 0) + 1;
    return counts;
  }

  // ---- cards --------------------------------------------------------------

  private validateCard(data: Data, card: Card) {
    if (!data.folders.some((f) => f.id === card.folder_id)) {
      throw new LocalStoreError("Folder not found");
    }
    if (card.type === "raw") {
      if (!card.condition || !CONDITIONS.includes(card.condition)) {
        throw new LocalStoreError("Raw cards need a condition");
      }
      const dupe = data.cards.find(
        (c) =>
          c.id !== card.id &&
          c.type === "raw" &&
          c.folder_id === card.folder_id &&
          norm(c.name) === norm(card.name) &&
          norm(c.card_number) === norm(card.card_number) &&
          c.game === card.game &&
          c.language === card.language &&
          c.condition === card.condition,
      );
      if (dupe) {
        throw new LocalStoreError(
          "This folder already has this card in that condition",
        );
      }
    } else {
      if (
        !card.grading_company ||
        !GRADING_COMPANIES.includes(card.grading_company)
      ) {
        throw new LocalStoreError("Slabs need a grading company");
      }
      if (card.grade === null || !(card.grade >= 1 && card.grade <= 10)) {
        throw new LocalStoreError("Grade must be between 1 and 10");
      }
      requireText(card.cert_number ?? "", "Cert number");
      const dupe = data.cards.find(
        (c) =>
          c.id !== card.id &&
          c.type === "slab" &&
          c.folder_id === card.folder_id &&
          c.grading_company === card.grading_company &&
          c.cert_number === card.cert_number,
      );
      if (dupe) {
        throw new LocalStoreError(
          "This folder already has a slab with that cert number",
        );
      }
    }
  }

  /**
   * Adds a card to a folder. A raw card that matches an existing entry (same
   * name, number and condition in the same folder) returns that entry instead,
   * so its purchases add to the same quantity.
   */
  addCard(input: NewCard): Card {
    const data = this.load();
    const base = {
      id: this.newId(),
      folder_id: input.folder_id,
      type: input.type,
      name: requireText(input.name, "Card name"),
      card_number: requireText(input.card_number, "Card number"),
      game: "Pokemon",
      language: "English",
      // New cards go after the ones the user has put in order.
      sort_order: null,
      ...this.stamp(),
    };
    const card: Card =
      input.type === "raw"
        ? {
            ...base,
            condition: input.condition,
            grading_company: null,
            grade: null,
            cert_number: null,
          }
        : {
            ...base,
            condition: null,
            grading_company: input.grading_company,
            grade: input.grade,
            cert_number: input.cert_number.trim(),
          };

    if (card.type === "raw") {
      const existing = data.cards.find(
        (c) =>
          c.type === "raw" &&
          c.folder_id === card.folder_id &&
          norm(c.name) === norm(card.name) &&
          norm(c.card_number) === norm(card.card_number) &&
          c.game === card.game &&
          c.language === card.language &&
          c.condition === card.condition,
      );
      if (existing) return existing;
    }

    this.validateCard(data, card);
    data.cards.push(card);
    this.save(data);
    this.onChange({ kind: "upsert", table: "cards", row: card });
    return card;
  }

  /**
   * Changes any field of a card entry, including raw/slab and its folder.
   * Its buys and sells stay with it. The same rules as adding apply, so an
   * edit that would make it a copy of another entry in the folder is refused.
   */
  updateCard(id: string, changes: CardChanges): Card {
    const data = this.load();
    const index = data.cards.findIndex((c) => c.id === id);
    if (index < 0) throw new LocalStoreError("Card not found");
    const old = data.cards[index];
    const updated: Card = {
      ...old,
      ...changes,
      updated_at: this.now().toISOString(),
    };
    // Moved to another folder: its place in the old folder means nothing
    // there, so it goes after that folder's ordered cards.
    if (updated.folder_id !== old.folder_id) updated.sort_order = null;
    updated.name = requireText(updated.name, "Card name");
    updated.card_number = requireText(updated.card_number, "Card number");
    if (updated.type === "raw") {
      updated.grading_company = null;
      updated.grade = null;
      updated.cert_number = null;
    } else {
      updated.condition = null;
      updated.cert_number = updated.cert_number?.trim() ?? null;
    }
    this.validateCard(data, updated);
    data.cards[index] = updated;
    this.save(data);
    this.onChange({ kind: "upsert", table: "cards", row: updated });
    return updated;
  }

  /**
   * Puts a folder's cards in the given order, by id. Cards left out keep
   * their current order after the listed ones. Only cards whose place
   * changed are saved, so moving one card up a step touches as few as
   * possible once a folder has been ordered.
   * (Dragging a card one place swaps it with its neighbour: two saves.)
   */
  reorderCards(folderId: string, orderedIds: string[]) {
    const data = this.load();
    const inFolder = data.cards
      .filter((c) => c.folder_id === folderId)
      .sort(bySortOrder);
    const byId = new Map(inFolder.map((c) => [c.id, c]));
    const listed = [...new Set(orderedIds)].filter((cid) => byId.has(cid));
    const rest = inFolder.filter((c) => !listed.includes(c.id));
    const order = [...listed.map((cid) => byId.get(cid)!), ...rest];
    const t = this.now().toISOString();
    const changed: Card[] = [];
    order.forEach((card, i) => {
      if (card.sort_order === i) return;
      const index = data.cards.findIndex((c) => c.id === card.id);
      const updated = { ...card, sort_order: i, updated_at: t };
      data.cards[index] = updated;
      changed.push(updated);
    });
    if (!changed.length) return;
    this.save(data);
    for (const row of changed)
      this.onChange({ kind: "upsert", table: "cards", row });
  }

  deleteCard(id: string) {
    const data = this.load();
    data.cards = data.cards.filter((c) => c.id !== id);
    data.purchases = data.purchases.filter((p) => p.card_id !== id);
    data.sales = data.sales.filter((s) => s.card_id !== id);
    this.save(data);
    this.onChange({ kind: "delete", table: "cards", id });
  }

  // ---- purchases and sales ------------------------------------------------

  private checkOwned(data: Data, cardId: string) {
    const bought = data.purchases
      .filter((p) => p.card_id === cardId)
      .reduce((n, p) => n + p.quantity, 0);
    const sold = data.sales
      .filter((s) => s.card_id === cardId)
      .reduce((n, s) => n + s.sell_quantity, 0);
    if (sold > bought) {
      throw new LocalStoreError(
        `Cannot sell ${sold} copies; only ${bought} bought`,
      );
    }
  }

  private validatePurchase(data: Data, p: NewPurchase) {
    if (!data.cards.some((c) => c.id === p.card_id))
      throw new LocalStoreError("Card not found");
    requireDate(p.buy_date, "Buy date");
    requireNonNegative(p.buy_price, "Buy price");
    requireNonNegative(p.buy_percentage, "Buy percentage");
    requirePositiveInt(p.quantity, "Quantity");
  }

  private validateSale(data: Data, s: NewSale) {
    if (!data.cards.some((c) => c.id === s.card_id))
      throw new LocalStoreError("Card not found");
    requireDate(s.sell_date, "Sell date");
    requireNonNegative(s.sell_price, "Sell price");
    requireNonNegative(s.sell_percentage, "Sell percentage");
    requireNonNegativeInt(s.sell_quantity, "Sold quantity");
  }

  listPurchases(cardId: string): Purchase[] {
    return this.load()
      .purchases.filter((p) => p.card_id === cardId)
      .sort((a, b) => b.buy_date.localeCompare(a.buy_date));
  }

  addPurchase(input: NewPurchase): Purchase {
    const data = this.load();
    this.validatePurchase(data, input);
    const purchase: Purchase = { id: this.newId(), ...input, ...this.stamp() };
    data.purchases.push(purchase);
    this.save(data);
    this.onChange({ kind: "upsert", table: "purchases", row: purchase });
    return purchase;
  }

  updatePurchase(
    id: string,
    changes: Partial<Omit<NewPurchase, "card_id">>,
  ): Purchase {
    const data = this.load();
    const index = data.purchases.findIndex((p) => p.id === id);
    if (index < 0) throw new LocalStoreError("Purchase not found");
    const updated = {
      ...data.purchases[index],
      ...changes,
      updated_at: this.now().toISOString(),
    };
    this.validatePurchase(data, updated);
    data.purchases[index] = updated;
    this.checkOwned(data, updated.card_id);
    this.save(data);
    this.onChange({ kind: "upsert", table: "purchases", row: updated });
    return updated;
  }

  deletePurchase(id: string) {
    const data = this.load();
    const purchase = data.purchases.find((p) => p.id === id);
    if (!purchase) return;
    data.purchases = data.purchases.filter((p) => p.id !== id);
    this.checkOwned(data, purchase.card_id);
    this.save(data);
    this.onChange({ kind: "delete", table: "purchases", id });
  }

  listSales(cardId: string): Sale[] {
    return this.load()
      .sales.filter((s) => s.card_id === cardId)
      .sort((a, b) => b.sell_date.localeCompare(a.sell_date));
  }

  addSale(input: NewSale): Sale {
    const data = this.load();
    this.validateSale(data, input);
    const sale: Sale = { id: this.newId(), ...input, ...this.stamp() };
    data.sales.push(sale);
    this.checkOwned(data, sale.card_id);
    this.save(data);
    this.onChange({ kind: "upsert", table: "sales", row: sale });
    return sale;
  }

  updateSale(id: string, changes: Partial<Omit<NewSale, "card_id">>): Sale {
    const data = this.load();
    const index = data.sales.findIndex((s) => s.id === id);
    if (index < 0) throw new LocalStoreError("Sale not found");
    const updated = {
      ...data.sales[index],
      ...changes,
      updated_at: this.now().toISOString(),
    };
    this.validateSale(data, updated);
    data.sales[index] = updated;
    this.checkOwned(data, updated.card_id);
    this.save(data);
    this.onChange({ kind: "upsert", table: "sales", row: updated });
    return updated;
  }

  deleteSale(id: string) {
    const data = this.load();
    data.sales = data.sales.filter((s) => s.id !== id);
    this.save(data);
    this.onChange({ kind: "delete", table: "sales", id });
  }

  // ---- sync helpers -------------------------------------------------------
  // These make local data match the server, so they do not call onChange.

  allData(): Data {
    return this.load();
  }

  /** Swaps in the server's copy of everything. */
  replaceAll(data: Data) {
    this.save({ ...emptyData(), ...data });
  }

  /**
   * Gives a local card the id of the matching card on the server, moving its
   * purchases and sales with it.
   */
  replaceCardId(oldId: string, newId: string) {
    const data = this.load();
    const swap = (id: string) => (id === oldId ? newId : id);
    const hasNew = data.cards.some((c) => c.id === newId);
    data.cards = hasNew
      ? data.cards.filter((c) => c.id !== oldId)
      : data.cards.map((c) => (c.id === oldId ? { ...c, id: newId } : c));
    data.purchases = data.purchases.map((p) => ({
      ...p,
      card_id: swap(p.card_id),
    }));
    data.sales = data.sales.map((s) => ({ ...s, card_id: swap(s.card_id) }));
    this.save(data);
  }

  // ---- totals and search --------------------------------------------------

  /**
   * Same numbers as the card_summary view in the database. One folder's
   * cards come in their saved order; all cards come by name.
   */
  listCardSummaries(folderId?: string): CardSummary[] {
    const data = this.load();
    return data.cards
      .filter((c) => !folderId || c.folder_id === folderId)
      .map((card) => summarize(card, data.purchases, data.sales))
      .sort(folderId ? bySortOrder : (a, b) => a.name.localeCompare(b.name));
  }

  /** Finds cards whose name, card number or cert number contains the text. */
  searchCards(query: string): CardSummary[] {
    const q = norm(query);
    if (!q) return this.listCardSummaries();
    return this.listCardSummaries().filter(
      (c) =>
        norm(c.name).includes(q) ||
        norm(c.card_number).includes(q) ||
        (c.cert_number ? norm(c.cert_number).includes(q) : false),
    );
  }
}

export function summarize(
  card: Card,
  purchases: Purchase[],
  sales: Sale[],
): CardSummary {
  let copiesBought = 0;
  let totalCost = 0;
  for (const p of purchases) {
    if (p.card_id !== card.id) continue;
    copiesBought += p.quantity;
    totalCost += (p.quantity * p.buy_price * p.buy_percentage) / 100;
  }
  let copiesSold = 0;
  let totalReceived = 0;
  let listing: Sale | null = null;
  for (const s of sales) {
    if (s.card_id !== card.id) continue;
    if (s.sell_quantity === 0) {
      // A listing: nothing sold, so it does not count toward profit.
      if (!listing || isNewer(s, listing)) listing = s;
      continue;
    }
    copiesSold += s.sell_quantity;
    totalReceived += (s.sell_quantity * s.sell_price * s.sell_percentage) / 100;
  }
  const averageCost = copiesBought ? totalCost / copiesBought : 0;
  return {
    ...card,
    copies_bought: copiesBought,
    copies_sold: copiesSold,
    quantity_owned: copiesBought - copiesSold,
    total_cost: round2(totalCost),
    average_cost: round2(averageCost),
    total_received: round2(totalReceived),
    realized_profit: round2(totalReceived - averageCost * copiesSold),
    asking_price: listing
      ? round2((listing.sell_price * listing.sell_percentage) / 100)
      : null,
  };
}

/** Newer by sell date, then by when it was entered. */
function isNewer(a: Sale, b: Sale) {
  return a.sell_date !== b.sell_date
    ? a.sell_date > b.sell_date
    : a.created_at > b.created_at;
}

/** The store for this browser. Only call it from client components. */
export function browserStore(): LocalStore {
  return new LocalStore(window.localStorage);
}
