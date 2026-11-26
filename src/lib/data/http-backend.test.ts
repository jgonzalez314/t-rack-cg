import { describe, expect, it } from "vitest";
import { httpBackend } from "./http-backend";
import type { Folder } from "./types";

const folder = { id: "f1", name: "Binder" } as Folder;
const reply = (status: number, body: unknown) => async () =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
  });

describe("httpBackend", () => {
  it("reads the server's error codes the same way as Supabase's", async () => {
    const dup = await httpBackend(
      reply(409, { ok: false, code: "23505", message: "dup" }),
    ).upsert("cards", folder as never);
    expect(dup).toMatchObject({ ok: false, duplicate: true, temporary: false });
    const raced = await httpBackend(
      reply(409, { ok: false, code: "40001", message: "again" }),
    ).upsert("folders", folder);
    expect(raced).toMatchObject({ ok: false, temporary: true });
  });

  it("keeps changes queued when signed out or the server is down", async () => {
    for (const r of [
      reply(401, { ok: false, code: "", message: "Sign in" }),
      reply(502, "<html>"),
    ]) {
      expect(await httpBackend(r).upsert("folders", folder)).toMatchObject({
        ok: false,
        temporary: true,
      });
    }
  });

  it("treats a failed fetch as offline", async () => {
    const offline = async () => {
      throw new TypeError("Failed to fetch");
    };
    await expect(
      httpBackend(offline).upsert("folders", folder),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it("returns the server's data", async () => {
    const data = { folders: [folder], cards: [], purchases: [], sales: [] };
    expect(
      await httpBackend(reply(200, { ok: true, data })).fetchAll(),
    ).toEqual(data);
    expect(
      await httpBackend(reply(200, { ok: true, data: "c9" })).findMatchingCard(
        {} as never,
      ),
    ).toBe("c9");
  });
});
