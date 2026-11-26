// Sync through this app's own server (POST /api/sync), which keeps the data
// in DynamoDB. Used when NEXT_PUBLIC_DATA_BACKEND=dynamodb.

import type { Card } from "./types";
import type { Data } from "./local-store";
import { toResult, type BackendResult, type SyncBackend } from "./sync";

export const SYNC_URL = "/api/sync";

type Reply =
  { ok: true; data?: unknown } | { ok: false; code?: string; message?: string };

async function call(body: unknown, fetcher: typeof fetch): Promise<Reply> {
  // A failed fetch throws a TypeError, which sync reads as being offline.
  const res = await fetcher(SYNC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  let reply: Reply | null = null;
  try {
    reply = (await res.json()) as Reply;
  } catch {
    // Not JSON: a proxy or server error page.
  }
  if (reply && typeof reply.ok === "boolean") return reply;
  // No code means sync tries again later.
  return { ok: false, message: `Sync server error (${res.status})` };
}

function result(reply: Reply): BackendResult {
  if (reply.ok) return { ok: true };
  return toResult({
    code: reply.code ?? "",
    message: reply.message ?? "Sync failed",
  });
}

export function httpBackend(
  fetcher: typeof fetch = (...a) => fetch(...a),
): SyncBackend {
  return {
    async upsert(table, row) {
      return result(await call({ op: "upsert", table, row }, fetcher));
    },
    async remove(table, id) {
      return result(await call({ op: "remove", table, id }, fetcher));
    },
    async findMatchingCard(card: Card) {
      const reply = await call({ op: "findMatchingCard", card }, fetcher);
      return reply.ok && typeof reply.data === "string" ? reply.data : null;
    },
    async fetchAll() {
      const reply = await call({ op: "fetchAll" }, fetcher);
      if (!reply.ok) throw new Error(reply.message ?? "Sync failed");
      return reply.data as Data;
    },
  };
}
