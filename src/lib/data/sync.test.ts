import { beforeEach, describe, expect, it } from "vitest";
import { LocalStore, type KeyValueStorage } from "./local-store";
import { Outbox } from "./outbox";
import { syncNow, type BackendResult, type SyncBackend } from "./sync";
import type { Card, Folder } from "./types";

function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

/** A pretend Supabase that follows the same unique rules as the database. */
class FakeServer implements SyncBackend {
  folders = new Map<string, Folder>();
  cards = new Map<string, Card>();
  online = true;
  calls: string[] = [];

  private check() {
    if (!this.online) throw new TypeError("Failed to fetch");
  }

  async upsert(table: "folders" | "cards", row: Folder | Card): Promise<BackendResult> {
    this.check();
    this.calls.push(`upsert ${table} ${row.id}`);
    if (table === "folders") {
      this.folders.set(row.id, row as Folder);
      return { ok: true };
    }
    const card = row as Card;
    if (!this.folders.has(card.folder_id)) {
      return { ok: false, message: "folder is gone", temporary: false };
    }
    if ([...this.cards.values()].some((c) => c.id !== card.id && sameCard(c, card))) {
      return { ok: false, message: "duplicate", duplicate: true, temporary: false };
    }
    this.cards.set(card.id, card);
    return { ok: true };
  }

  async remove(table: "folders" | "cards", id: string): Promise<BackendResult> {
    this.check();
    this.calls.push(`delete ${table} ${id}`);
    if (table === "folders") {
      this.folders.delete(id);
      for (const [cid, c] of this.cards) if (c.folder_id === id) this.cards.delete(cid);
    } else {
      this.cards.delete(id);
    }
    return { ok: true };
  }

  async findMatchingCard(card: Card) {
    return [...this.cards.values()].find((c) => sameCard(c, card))?.id ?? null;
  }

  async fetchAll() {
    this.check();
    return { folders: [...this.folders.values()], cards: [...this.cards.values()] };
  }
}

const sameCard = (a: Card, b: Card) =>
  a.folder_id === b.folder_id &&
  a.type === b.type &&
  a.name.toLowerCase() === b.name.toLowerCase() &&
  a.card_number.toLowerCase() === b.card_number.toLowerCase() &&
  a.condition === b.condition &&
  a.cert_number === b.cert_number;

function device(name: string, server: FakeServer) {
  const storage = memoryStorage();
  const outbox = new Outbox(storage);
  let n = 0;
  const store = new LocalStore(
    storage,
    () => new Date("2026-11-18T00:00:00Z"),
    () => `${name}-${++n}`,
    (change) => outbox.add(change),
  );
  const sync = () => syncNow({ store, outbox, backend: server, storage });
  return { storage, outbox, store, sync };
}

const charizard = (folder_id: string) =>
  ({ type: "raw", folder_id, name: "Charizard", card_number: "4/102", condition: "NM" }) as const;

let server: FakeServer;

beforeEach(() => {
  server = new FakeServer();
});

describe("offline folders and cards", () => {
  it("keeps folders and cards made offline, then uploads them in order", async () => {
    const phone = device("phone", server);
    server.online = false;

    const folder = phone.store.createFolder({ name: "Binder" });
    phone.store.addCard(charizard(folder.id));
    phone.store.updateFolder(folder.id, { name: "Main binder" });

    expect(await phone.sync()).toEqual({ status: "offline" });
    expect(phone.store.listFolders().map((f) => f.name)).toEqual(["Main binder"]);
    expect(phone.outbox.size).toBe(2);

    server.online = true;
    expect((await phone.sync()).status).toBe("synced");
    // The folder goes first even though it was edited after the card was added.
    expect(server.calls).toEqual(["upsert folders phone-1", "upsert cards phone-2"]);
    expect(server.folders.get(folder.id)?.name).toBe("Main binder");
    expect(phone.outbox.size).toBe(0);
  });

  it("pulls folders and cards made on another device", async () => {
    const phone = device("phone", server);
    const laptop = device("laptop", server);
    const folder = laptop.store.createFolder({ name: "Trade binder" });
    laptop.store.addCard(charizard(folder.id));
    await laptop.sync();

    await phone.sync();
    expect(phone.store.listFolders().map((f) => f.name)).toEqual(["Trade binder"]);
    expect(phone.store.listCardSummaries(folder.id)).toHaveLength(1);
  });

  it("does not send a folder that was made and deleted while offline", async () => {
    const phone = device("phone", server);
    await phone.sync();
    server.online = false;
    const folder = phone.store.createFolder({ name: "Oops" });
    phone.store.addCard(charizard(folder.id));
    phone.store.deleteFolder(folder.id);
    expect(phone.outbox.list()).toEqual([{ kind: "delete", table: "folders", id: folder.id }]);
  });

  it("merges a raw card that another device added to the same folder", async () => {
    const phone = device("phone", server);
    const laptop = device("laptop", server);
    const folder = laptop.store.createFolder({ name: "Binder" });
    await laptop.sync();
    await phone.sync();

    // Both add the same card; the laptop syncs first.
    server.online = false;
    const fromPhone = phone.store.addCard(charizard(folder.id));
    phone.store.addPurchase({ card_id: fromPhone.id, buy_date: "2026-11-01", buy_price: 100, buy_percentage: 80, quantity: 1 });
    server.online = true;
    const fromLaptop = laptop.store.addCard(charizard(folder.id));
    await laptop.sync();

    expect((await phone.sync()).status).toBe("synced");
    const [card] = phone.store.listCardSummaries(folder.id);
    expect(card.id).toBe(fromLaptop.id);
    expect(card.quantity_owned).toBe(1); // the phone's purchase moved to the shared entry
  });

  it("drops a change the server refuses and matches the server afterwards", async () => {
    const phone = device("phone", server);
    const laptop = device("laptop", server);
    const folder = laptop.store.createFolder({ name: "Binder" });
    await laptop.sync();
    await phone.sync();

    server.online = false;
    phone.store.addCard(charizard(folder.id));
    server.online = true;
    laptop.store.deleteFolder(folder.id);
    await laptop.sync();

    const result = await phone.sync();
    expect(result).toMatchObject({ status: "error", message: expect.stringContaining("folder is gone") });
    expect(phone.outbox.size).toBe(0);
    expect(phone.store.listFolders()).toEqual([]);
  });

  it("keeps changes queued when the server has a temporary problem", async () => {
    const phone = device("phone", server);
    phone.store.createFolder({ name: "Binder" });
    server.upsert = async () => ({ ok: false, message: "timeout", temporary: true });
    expect(await phone.sync()).toEqual({ status: "error", message: "timeout" });
    expect(phone.outbox.size).toBe(1);
    expect(phone.store.listFolders()).toHaveLength(1);
  });

  it("uploads data saved before sync was set up instead of wiping it", async () => {
    const storage = memoryStorage();
    const before = new LocalStore(storage);
    const folder = before.createFolder({ name: "Made in local mode" });
    before.addCard(charizard(folder.id));

    const outbox = new Outbox(storage);
    const store = new LocalStore(storage, undefined, undefined, (c) => outbox.add(c));
    await syncNow({ store, outbox, backend: server, storage });

    expect([...server.folders.values()].map((f) => f.name)).toEqual(["Made in local mode"]);
    expect(server.cards.size).toBe(1);
    expect(store.listFolders()).toHaveLength(1);
  });
});
