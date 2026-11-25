import { describe, expect, it } from "vitest";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { ConditionFailed, dynamoTable } from "./table";

function fakeClient(reply: (input: Record<string, unknown>) => unknown = () => ({})) {
  const sent: { name: string; input: Record<string, unknown> }[] = [];
  const client = {
    send: async (cmd: { constructor: { name: string }; input: Record<string, unknown> }) => {
      sent.push({ name: cmd.constructor.name, input: cmd.input });
      return reply(cmd.input);
    },
  } as unknown as DynamoDBDocumentClient;
  return { client, sent };
}

describe("dynamoTable", () => {
  it("keeps every key inside the user's partition", async () => {
    const { client, sent } = fakeClient(() => ({ Item: { pk: "USER#u1", sk: "FOLDER#1", name: "x" } }));
    const t = dynamoTable(client, "cards-table", "u1");
    expect(await t.get("FOLDER#1")).toEqual({ sk: "FOLDER#1", name: "x" });
    await t.transact([{ type: "put", item: { sk: "FOLDER#2", pk: "USER#u2" }, cond: { kind: "absent" } }]);
    const put = (sent[1].input.TransactItems as { Put: { Item: { pk: string } } }[])[0].Put;
    expect(sent[0].input).toMatchObject({ TableName: "cards-table", Key: { pk: "USER#u1", sk: "FOLDER#1" } });
    expect(put.Item.pk).toBe("USER#u1");
  });

  it("writes conditions as DynamoDB condition expressions", async () => {
    const { client, sent } = fakeClient();
    await dynamoTable(client, "t", "u1").transact([
      { type: "put", item: { sk: "UNIQ#a", card_id: "c1" }, cond: { kind: "absentOrEquals", attrs: { card_id: "c1" } } },
      { type: "delete", sk: "SALE#1", cond: { kind: "equals", attrs: { rev: 3 } } },
      { type: "check", sk: "FOLDER#1", cond: { kind: "exists" } },
    ]);
    const items = sent[0].input.TransactItems as Record<string, Record<string, unknown>>[];
    expect(items[0].Put).toMatchObject({
      ConditionExpression: "attribute_not_exists(sk) OR (#c0 = :c0)",
      ExpressionAttributeNames: { "#c0": "card_id" },
      ExpressionAttributeValues: { ":c0": "c1" },
    });
    expect(items[1].Delete).toMatchObject({ ConditionExpression: "attribute_exists(sk) AND #c0 = :c0" });
    expect(items[2].ConditionCheck).toMatchObject({ ConditionExpression: "attribute_exists(sk)" });
  });

  it("says which condition failed", async () => {
    const { client } = fakeClient(() => {
      throw Object.assign(new Error("cancelled"), {
        CancellationReasons: [{ Code: "None" }, { Code: "ConditionalCheckFailed" }],
      });
    });
    const err = await dynamoTable(client, "t", "u1")
      .transact([{ type: "check", sk: "a", cond: { kind: "exists" } }])
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConditionFailed);
    expect(err.index).toBe(1);
  });

  it("reads every page of a user's items", async () => {
    let page = 0;
    const { client } = fakeClient(() =>
      page++ === 0
        ? { Items: [{ pk: "USER#u1", sk: "A" }], LastEvaluatedKey: { pk: "USER#u1", sk: "A" } }
        : { Items: [{ pk: "USER#u1", sk: "B" }] },
    );
    expect(await dynamoTable(client, "t", "u1").all()).toEqual([{ sk: "A" }, { sk: "B" }]);
  });
});
