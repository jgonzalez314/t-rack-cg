import { NextResponse, type NextRequest } from "next/server";
import { POKEMON_TCG_API, buildQuery, toMatches, type PriceLookup } from "@/lib/pricing/tcgplayer";

// GET /api/price?name=Charizard&number=4/102
// Looks up TCGplayer prices for a raw card through the Pokemon TCG API.
// POKEMONTCG_API_KEY is optional: without it the API allows about 1,000
// lookups a day, with a free key 20,000.
export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name")?.trim() ?? "";
  const number = request.nextUrl.searchParams.get("number")?.trim() ?? "";
  if (!name) return NextResponse.json({ error: "Card name is required" }, { status: 400 });

  const url = new URL(POKEMON_TCG_API);
  url.searchParams.set("q", buildQuery(name, number));
  url.searchParams.set("select", "id,name,number,set,tcgplayer");
  url.searchParams.set("pageSize", "20");

  const headers: Record<string, string> = { Accept: "application/json" };
  const key = process.env.POKEMONTCG_API_KEY;
  if (key) headers["X-Api-Key"] = key;

  try {
    const res = await fetch(url, {
      headers,
      // Prices change about once a day, so reuse an answer for 6 hours.
      next: { revalidate: 60 * 60 * 6 },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const message =
        res.status === 429 ? "Too many price lookups today, try again later" : "Price lookup failed";
      return NextResponse.json({ error: message }, { status: 502 });
    }
    const body = (await res.json()) as { data?: Parameters<typeof toMatches>[0] };
    const result: PriceLookup = { matches: toMatches(body.data ?? [], number).slice(0, 10) };
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Price lookup failed" }, { status: 502 });
  }
}
