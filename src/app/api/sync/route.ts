import { NextResponse, type NextRequest } from "next/server";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { dataBackend, isLocalMode } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";
import { DynamoStore, TABLES } from "@/lib/dynamo/store";
import { dynamoTable } from "@/lib/dynamo/table";
import type { Card } from "@/lib/data/types";
import type { Table } from "@/lib/data/local-store";

// POST /api/sync
// The DynamoDB version of what the browser does with Supabase directly. The
// signed-in user comes from the Supabase session cookie, never from the
// request body, so a user can only reach their own items.
//
// Needs DYNAMODB_TABLE, AWS_REGION and AWS credentials (server only).

const MAX_BODY = 64 * 1024;

let documents: DynamoDBDocumentClient | null = null;
function documentClient() {
  documents ??= DynamoDBDocumentClient.from(new DynamoDBClient({}), {
    marshallOptions: { removeUndefinedValues: true },
  });
  return documents;
}

const refuse = (status: number, message: string, code = "") =>
  NextResponse.json({ ok: false, code, message }, { status });

export async function POST(request: NextRequest) {
  if (isLocalMode || dataBackend !== "dynamodb")
    return refuse(404, "DynamoDB sync is not turned on");
  const tableName = process.env.DYNAMODB_TABLE;
  if (!tableName) return refuse(500, "DYNAMODB_TABLE is not set");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // No code: the change stays queued until the user signs in again.
  if (!user) return refuse(401, "Sign in to sync your changes");

  const raw = await request.text();
  if (raw.length > MAX_BODY) return refuse(413, "Change is too large", "23514");
  let body: {
    op?: string;
    table?: string;
    row?: unknown;
    id?: unknown;
    card?: unknown;
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return refuse(400, "Bad request", "23514");
  }

  const store = new DynamoStore(
    dynamoTable(documentClient(), tableName, user.id),
  );
  const table = body.table as Table;
  const knownTable = TABLES.includes(table);

  try {
    switch (body.op) {
      case "upsert": {
        if (!knownTable) return refuse(400, "Unknown table", "23514");
        const res = await store.upsert(
          table,
          body.row as Record<string, unknown>,
        );
        return NextResponse.json(res, { status: res.ok ? 200 : 409 });
      }
      case "remove": {
        if (!knownTable) return refuse(400, "Unknown table", "23514");
        const res = await store.remove(table, String(body.id ?? ""));
        return NextResponse.json(res, { status: res.ok ? 200 : 409 });
      }
      case "findMatchingCard":
        return NextResponse.json({
          ok: true,
          data: await store.findMatchingCard(body.card as Card),
        });
      case "fetchAll":
        return NextResponse.json({ ok: true, data: await store.fetchAll() });
      default:
        return refuse(400, "Unknown operation", "23514");
    }
  } catch (e) {
    console.error("sync failed", e);
    return refuse(503, "The database is unavailable, try again");
  }
}
