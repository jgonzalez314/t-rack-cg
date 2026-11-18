// Changes made on this device that have not reached Supabase yet. They are
// kept in browser storage, so they survive closing the app while offline.

import type { Change, KeyValueStorage } from "./local-store";

export const OUTBOX_KEY = "t-rack-cg:outbox:v1";

const idOf = (c: Change) => (c.kind === "upsert" ? c.row.id : c.id);

export class Outbox {
  constructor(private storage: KeyValueStorage) {}

  list(): Change[] {
    const raw = this.storage.getItem(OUTBOX_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private save(changes: Change[]) {
    this.storage.setItem(OUTBOX_KEY, JSON.stringify(changes));
  }

  get size() {
    return this.list().length;
  }

  /**
   * Adds a change. A newer save of the same row replaces the older one, and a
   * delete drops earlier saves of that row, so the queue stays short.
   */
  add(change: Change) {
    const id = idOf(change);
    const list = this.list();
    const same = (c: Change) => c.table === change.table && idOf(c) === id;
    if (change.kind === "upsert") {
      // Replace in place, so a folder is still sent before the cards in it.
      const index = list.findIndex((c) => same(c) && c.kind === "upsert");
      if (index >= 0) {
        list[index] = change;
        this.save(list);
        return;
      }
    }
    const rest = list.filter((c) => !same(c));
    if (change.kind === "delete" && change.table === "folders") {
      // The server deletes the folder's cards with it, so drop their saves.
      const kept = rest.filter(
        (c) => !(c.kind === "upsert" && c.table === "cards" && c.row.folder_id === id),
      );
      this.save([...kept, change]);
      return;
    }
    this.save([...rest, change]);
  }

  /** Removes the first change once it has been sent. */
  shift() {
    this.save(this.list().slice(1));
  }

  /** Points queued changes for a card at its new id. */
  renameCard(oldId: string, newId: string) {
    this.save(
      this.list().map((c) => {
        if (c.table !== "cards") return c;
        if (c.kind === "upsert" && c.row.id === oldId) return { ...c, row: { ...c.row, id: newId } };
        if (c.kind === "delete" && c.id === oldId) return { ...c, id: newId };
        return c;
      }),
    );
  }
}
