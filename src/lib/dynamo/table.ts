// A small view of one user's slice of the DynamoDB table.
//
// Every item for a user shares the partition key USER#<id>, so a user can
// only ever read or change their own items: this takes the place of the
// row level security policies in the Supabase migrations.
//
// The store in ./store.ts is written against this interface, so tests can
// run it on the in-memory version in ./memory-table.ts.

import {
  BatchWriteCommand,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";

export type Item = { sk: string } & Record<string, unknown>;

/** A condition on the item an operation touches. */
export type Cond =
  | { kind: "absent" }
  | { kind: "exists" }
  /** The item exists and these attributes have these values. */
  | { kind: "equals"; attrs: Record<string, string | number> }
  /** The item does not exist, or it exists with these values. */
  | { kind: "absentOrEquals"; attrs: Record<string, string | number> };

export type Op =
  | { type: "put"; item: Item; cond?: Cond }
  | { type: "delete"; sk: string; cond?: Cond }
  | { type: "check"; sk: string; cond: Cond };

/** A transaction was refused because the condition on ops[index] failed. */
export class ConditionFailed extends Error {
  constructor(public index: number) {
    super(`Condition failed on operation ${index}`);
  }
}

/** DynamoDB allows at most 100 items in one transaction. */
export const MAX_TRANSACTION = 100;

export interface ItemTable {
  get(sk: string): Promise<Item | undefined>;
  /** Every item that belongs to this user. */
  all(): Promise<Item[]>;
  /** All or nothing. Throws ConditionFailed when a condition is not met. */
  transact(ops: Op[]): Promise<void>;
  /** Deletes items with no conditions, in batches. Not all or nothing. */
  deleteMany(sks: string[]): Promise<void>;
}

export const userPk = (userId: string) => `USER#${userId}`;

function condition(cond: Cond | undefined) {
  if (!cond) return {};
  if (cond.kind === "absent")
    return { ConditionExpression: "attribute_not_exists(sk)" };
  if (cond.kind === "exists")
    return { ConditionExpression: "attribute_exists(sk)" };
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const parts = Object.entries(cond.attrs).map(([attr, value], i) => {
    names[`#c${i}`] = attr;
    values[`:c${i}`] = value;
    return `#c${i} = :c${i}`;
  });
  const equals = parts.join(" AND ");
  return {
    ConditionExpression:
      cond.kind === "equals"
        ? `attribute_exists(sk) AND ${equals}`
        : `attribute_not_exists(sk) OR (${equals})`,
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  };
}

/** The real table. One per request, for the signed-in user. */
export function dynamoTable(
  client: DynamoDBDocumentClient,
  tableName: string,
  userId: string,
): ItemTable {
  const pk = userPk(userId);
  const strip = (item: Record<string, unknown>): Item => {
    const { pk: _pk, ...rest } = item;
    void _pk;
    return rest as Item;
  };

  return {
    async get(sk) {
      const out = await client.send(
        new GetCommand({
          TableName: tableName,
          Key: { pk, sk },
          ConsistentRead: true,
        }),
      );
      return out.Item ? strip(out.Item) : undefined;
    },

    async all() {
      const items: Item[] = [];
      let start: Record<string, unknown> | undefined;
      do {
        const out = await client.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: "pk = :pk",
            ExpressionAttributeValues: { ":pk": pk },
            ConsistentRead: true,
            ExclusiveStartKey: start,
          }),
        );
        for (const item of out.Items ?? []) items.push(strip(item));
        start = out.LastEvaluatedKey;
      } while (start);
      return items;
    },

    async transact(ops) {
      if (ops.length > MAX_TRANSACTION)
        throw new Error("Too many changes in one transaction");
      try {
        await client.send(
          new TransactWriteCommand({
            TransactItems: ops.map((op) => {
              if (op.type === "put") {
                return {
                  Put: {
                    TableName: tableName,
                    Item: { ...op.item, pk },
                    ...condition(op.cond),
                  },
                };
              }
              if (op.type === "delete") {
                return {
                  Delete: {
                    TableName: tableName,
                    Key: { pk, sk: op.sk },
                    ...condition(op.cond),
                  },
                };
              }
              return {
                ConditionCheck: {
                  TableName: tableName,
                  Key: { pk, sk: op.sk },
                  ...(condition(op.cond) as { ConditionExpression: string }),
                },
              };
            }),
          }),
        );
      } catch (e) {
        const reasons = (e as { CancellationReasons?: { Code?: string }[] })
          .CancellationReasons;
        const index =
          reasons?.findIndex((r) => r.Code === "ConditionalCheckFailed") ?? -1;
        if (index >= 0) throw new ConditionFailed(index);
        throw e;
      }
    },

    async deleteMany(sks) {
      for (let i = 0; i < sks.length; i += 25) {
        let requests: Record<
          string,
          { DeleteRequest: { Key: Record<string, string> } }[]
        > = {
          [tableName]: sks
            .slice(i, i + 25)
            .map((sk) => ({ DeleteRequest: { Key: { pk, sk } } })),
        };
        // DynamoDB may hand back some deletes to try again.
        for (let attempt = 0; requests[tableName]?.length; attempt++) {
          if (attempt === 5) throw new Error("DynamoDB is busy, try again");
          if (attempt)
            await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
          const out = await client.send(
            new BatchWriteCommand({ RequestItems: requests }),
          );
          requests = (out.UnprocessedItems ?? {}) as typeof requests;
        }
      }
    },
  };
}
