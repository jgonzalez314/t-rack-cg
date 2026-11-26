// An in-memory ItemTable for tests. It checks conditions the same way
// DynamoDB does, and applies a transaction all or nothing.

import {
  ConditionFailed,
  MAX_TRANSACTION,
  type Cond,
  type Item,
  type ItemTable,
  type Op,
} from "./table";

export class MemoryTable implements ItemTable {
  items = new Map<string, Item>();

  private met(cond: Cond | undefined, item: Item | undefined) {
    if (!cond) return true;
    const equals = (attrs: Record<string, unknown>) =>
      !!item && Object.entries(attrs).every(([k, v]) => item[k] === v);
    switch (cond.kind) {
      case "absent":
        return !item;
      case "exists":
        return !!item;
      case "equals":
        return equals(cond.attrs);
      case "absentOrEquals":
        return !item || equals(cond.attrs);
    }
  }

  async get(sk: string) {
    const item = this.items.get(sk);
    return item ? structuredClone(item) : undefined;
  }

  async all() {
    return [...this.items.values()].map((i) => structuredClone(i));
  }

  async transact(ops: Op[]) {
    if (ops.length > MAX_TRANSACTION)
      throw new Error("Too many changes in one transaction");
    const sks = ops.map((op) => (op.type === "put" ? op.item.sk : op.sk));
    if (new Set(sks).size !== sks.length)
      throw new Error("Two operations on one item");
    ops.forEach((op, i) => {
      if (!this.met(op.cond, this.items.get(sks[i])))
        throw new ConditionFailed(i);
    });
    for (const op of ops) {
      if (op.type === "put")
        this.items.set(op.item.sk, structuredClone(op.item));
      else if (op.type === "delete") this.items.delete(op.sk);
    }
  }

  async deleteMany(sks: string[]) {
    for (const sk of sks) this.items.delete(sk);
  }
}
