// Sends queued folder and card changes to Supabase, then pulls the server's
// copy back so this device sees changes made on other devices.
//
// The app always reads and writes the local store first, so folders and cards
// can be made with no connection. Sync runs whenever the device is online.

import type { Card, Folder } from "./types";
import type { KeyValueStorage, LocalStore } from "./local-store";
import type { Outbox } from "./outbox";

export const SYNC_STATE_KEY = "t-rack-cg:sync:v1";

export type BackendResult =
  | { ok: true }
  | { ok: false; message: string; duplicate?: boolean; temporary?: boolean };

/** What sync needs from the server. The Supabase version is below. */
export interface SyncBackend {
  upsert(table: "folders" | "cards", row: Folder | Card): Promise<BackendResult>;
  remove(table: "folders" | "cards", id: string): Promise<BackendResult>;
  /** The server's id for a card that matches this one under the folder's unique rules. */
  findMatchingCard(card: Card): Promise<string | null>;
  fetchAll(): Promise<{ folders: Folder[]; cards: Card[] }>;
}

export type SyncResult =
  | { status: "synced"; at: string }
  | { status: "offline" }
  | { status: "error"; message: string };

interface SyncState {
  /** Set once local data from before sync was turned on has been uploaded. */
  seeded?: boolean;
  lastSyncedAt?: string;
}

function readState(storage: KeyValueStorage): SyncState {
  try {
    return JSON.parse(storage.getItem(SYNC_STATE_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

function writeState(storage: KeyValueStorage, state: SyncState) {
  storage.setItem(SYNC_STATE_KEY, JSON.stringify(state));
}

export function lastSyncedAt(storage: KeyValueStorage): string | undefined {
  return readState(storage).lastSyncedAt;
}

function isNetworkError(e: unknown) {
  return e instanceof TypeError || (e instanceof Error && /fetch|network/i.test(e.message));
}

export async function syncNow(opts: {
  store: LocalStore;
  outbox: Outbox;
  backend: SyncBackend;
  storage: KeyValueStorage;
  now?: () => Date;
}): Promise<SyncResult> {
  const { store, outbox, backend, storage } = opts;
  const now = opts.now ?? (() => new Date());

  try {
    const state = readState(storage);

    // The first time sync runs, queue anything made before it was set up so
    // the pull below does not replace it.
    if (!state.seeded) {
      const { folders, cards } = store.allFoldersAndCards();
      for (const row of folders) outbox.add({ kind: "upsert", table: "folders", row });
      for (const row of cards) outbox.add({ kind: "upsert", table: "cards", row });
      writeState(storage, { ...state, seeded: true });
    }

    // Push, oldest first.
    const rejected: string[] = [];
    for (let change = outbox.list()[0]; change; change = outbox.list()[0]) {
      const result =
        change.kind === "upsert"
          ? await backend.upsert(change.table, change.row)
          : await backend.remove(change.table, change.id);

      if (result.ok) {
        outbox.shift();
        continue;
      }
      if (change.kind === "upsert" && change.table === "cards" && result.duplicate) {
        // Another device already added this card to the folder. Use that
        // entry, so purchases made here add to the same quantity.
        const serverId = await backend.findMatchingCard(change.row);
        if (serverId) {
          store.replaceCardId(change.row.id, serverId);
          outbox.renameCard(change.row.id, serverId);
          outbox.shift();
          continue;
        }
      }
      if (result.temporary) {
        // Try again next time, keeping the order.
        return { status: "error", message: result.message };
      }
      // The server will never accept this change (for example, its folder was
      // deleted on another device). Drop it; the pull below brings this device
      // back in line with the server.
      rejected.push(result.message);
      outbox.shift();
    }

    // Pull. Anything changed locally during the pull waits for the next sync.
    const server = await backend.fetchAll();
    if (outbox.size === 0) store.replaceFoldersAndCards(server.folders, server.cards);

    const at = now().toISOString();
    writeState(storage, { ...readState(storage), seeded: true, lastSyncedAt: at });
    if (rejected.length) {
      return { status: "error", message: `Some changes were not saved: ${rejected.join("; ")}` };
    }
    return { status: "synced", at };
  } catch (e) {
    if (isNetworkError(e)) return { status: "offline" };
    return { status: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

// ---- Supabase ----------------------------------------------------------------

type SupabaseLike = {
  from(table: string): {
    // Loosely typed so the generated Supabase types are not needed here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [method: string]: any;
  };
};

function toResult(error: { code?: string; message: string } | null): BackendResult {
  if (!error) return { ok: true };
  if (!error.code && /fetch|network/i.test(error.message)) throw new TypeError(error.message);
  // Postgres error codes: class 23 is a broken rule, 42501 is a blocked row.
  // Anything else (timeouts, server errors) is worth trying again.
  const permanent = /^(23|42501|PGRST)/.test(error.code ?? "");
  return {
    ok: false,
    message: error.message,
    duplicate: error.code === "23505",
    temporary: !permanent,
  };
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

export function supabaseBackend(client: SupabaseLike): SyncBackend {
  return {
    async upsert(table, row) {
      // user_id is filled in by the database from the signed-in user.
      const { error } = await client.from(table).upsert(row, { onConflict: "id" });
      return toResult(error);
    },
    async remove(table, id) {
      const { error } = await client.from(table).delete().eq("id", id);
      return toResult(error);
    },
    async findMatchingCard(card) {
      let q = client
        .from("cards")
        .select("id")
        .eq("folder_id", card.folder_id)
        .eq("type", card.type);
      q =
        card.type === "raw"
          ? q
              .ilike("name", escapeLike(card.name))
              .ilike("card_number", escapeLike(card.card_number))
              .eq("game", card.game)
              .eq("language", card.language)
              .eq("condition", card.condition)
          : q.eq("grading_company", card.grading_company).eq("cert_number", card.cert_number);
      const { data, error } = await q.limit(1);
      toResult(error);
      return data?.[0]?.id ?? null;
    },
    async fetchAll() {
      const columns =
        "id, folder_id, type, name, card_number, game, language, condition, grading_company, grade, cert_number, created_at, updated_at";
      const [folders, cards] = await Promise.all([
        client.from("folders").select("id, name, description, created_at, updated_at"),
        client.from("cards").select(columns),
      ]);
      for (const r of [folders, cards]) {
        const res = toResult(r.error);
        if (!res.ok) throw new Error(res.message);
      }
      return {
        folders: folders.data as Folder[],
        cards: (cards.data as Card[]).map((c) => ({
          ...c,
          grade: c.grade === null ? null : Number(c.grade),
        })),
      };
    },
  };
}
