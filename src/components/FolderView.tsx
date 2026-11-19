"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { useCollection } from "@/lib/data/use-collection";
import {
  CONDITIONS,
  GRADING_COMPANIES,
  type CardType,
  type Condition,
  type GradingCompany,
} from "@/lib/data/types";
import { CardMoney, CardTotals, money } from "./CardMoney";
import { ExportButton } from "./ExportButton";
import { SuggestedPrice } from "./SuggestedPrice";
import { SyncBadge } from "./SyncBadge";
import { buttonClass, cardClass, inputClass } from "./ui";

export function FolderView() {
  const id = useSearchParams().get("id") ?? "";
  const router = useRouter();
  const { store, status, run, syncNow } = useCollection();

  const [type, setType] = useState<CardType>("raw");
  const [name, setName] = useState("");
  const [cardNumber, setCardNumber] = useState("");
  const [condition, setCondition] = useState<Condition>("NM");
  const [company, setCompany] = useState<GradingCompany>("PSA");
  const [grade, setGrade] = useState("10");
  const [cert, setCert] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const onPrice = useCallback(
    (cardId: string, price: number | null) =>
      setPrices((p) => (p[cardId] === price ? p : { ...p, [cardId]: price })),
    [],
  );

  if (!store) return <p className="mt-6 text-neutral-500">Loading…</p>;

  const folder = store.getFolder(id);
  if (!folder) {
    return (
      <div className="mt-6 flex flex-col gap-3">
        <p>This folder doesn&apos;t exist anymore.</p>
        <Link href="/" className="text-blue-600">
          Back to folders
        </Link>
      </div>
    );
  }

  const cards = store.listCardSummaries(folder.id);
  const totals = cards.reduce(
    (t, c) => ({
      cost: t.cost + c.total_cost,
      received: t.received + c.total_received,
      profit: t.profit + c.realized_profit,
    }),
    { cost: 0, received: 0, profit: 0 },
  );

  function add(e: React.FormEvent) {
    e.preventDefault();
    const before = store!.listCardSummaries(id).length;
    const { error, value } = run((s) =>
      type === "raw"
        ? s.addCard({ type, folder_id: id, name, card_number: cardNumber, condition })
        : s.addCard({
            type,
            folder_id: id,
            name,
            card_number: cardNumber,
            grading_company: company,
            grade: Number(grade),
            cert_number: cert,
          }),
    );
    setError(error ?? null);
    if (error) return;
    const merged = store!.listCardSummaries(id).length === before;
    setNotice(merged ? "This card was already in the folder in that condition." : null);
    // Open the card so its buy can be entered right away.
    if (value) setOpenCard(value.id);
    setName("");
    setCardNumber("");
    setCert("");
  }

  function removeFolder() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    run((s) => s.deleteFolder(id));
    router.push("/");
  }

  return (
    <section className="mt-2 flex flex-col gap-6">
      <div>
        <Link href="/" className="text-sm text-blue-600">
          ← Folders
        </Link>
        <h2 className="mt-2 text-xl font-semibold">{folder.name}</h2>
        {folder.description && <p className="text-neutral-500">{folder.description}</p>}
      </div>

      <SyncBadge status={status} onRetry={() => void syncNow()} />

      <form onSubmit={add} className="flex flex-col gap-2" aria-label="Add card">
        <h3 className="text-lg font-semibold">Add a card</h3>
        <div className="flex gap-2" role="radiogroup" aria-label="Card type">
          {(["raw", "slab"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={type === t}
              onClick={() => setType(t)}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                type === t
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-neutral-300 dark:border-neutral-700"
              }`}
            >
              {t === "raw" ? "Raw" : "Slab (graded)"}
            </button>
          ))}
        </div>
        <input aria-label="Card name" placeholder="Card name, like Charizard" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        <input aria-label="Card number" placeholder="Card number, like 4/102" value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} className={inputClass} />
        {type === "raw" ? (
          <label className="flex flex-col gap-1 text-sm">
            Condition
            <select value={condition} onChange={(e) => setCondition(e.target.value as Condition)} className={inputClass}>
              {CONDITIONS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm">
              Grading company
              <select value={company} onChange={(e) => setCompany(e.target.value as GradingCompany)} className={inputClass}>
                {GRADING_COMPANIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Grade
              <input type="number" min={1} max={10} step={0.5} value={grade} onChange={(e) => setGrade(e.target.value)} className={inputClass} />
            </label>
            <input aria-label="Cert number" placeholder="Cert number" value={cert} onChange={(e) => setCert(e.target.value)} className={`${inputClass} col-span-2`} />
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        {notice && <p className="text-sm text-neutral-600 dark:text-neutral-400">{notice}</p>}
        <button type="submit" className={`${buttonClass} self-start`}>
          Add to folder
        </button>
      </form>

      <div className="flex flex-col gap-2">
        <h3 className="text-lg font-semibold">
          Cards <span className="font-normal text-neutral-500">({cards.length})</span>
        </h3>
        {cards.length > 0 && (
          <>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              Spent {money(totals.cost)} · Received {money(totals.received)} · Profit {money(totals.profit)}
            </p>
            <ExportButton store={store} folderId={folder.id} />
          </>
        )}
        {cards.length === 0 ? (
          <p className="text-neutral-500">No cards in this folder yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {cards.map((c) => (
              <li key={c.id} className={cardClass}>
                <div className="flex items-start justify-between gap-3">
                  <span>
                    <span className="block font-medium">{c.name}</span>
                    <span className="block text-sm text-neutral-500">
                      #{c.card_number} ·{" "}
                      {c.type === "raw" ? c.condition : `${c.grading_company} ${c.grade} · cert ${c.cert_number}`}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => run((s) => s.deleteCard(c.id))}
                    className="shrink-0 text-sm text-red-600"
                    aria-label={`Remove ${c.name}`}
                  >
                    Remove
                  </button>
                </div>
                {c.type === "raw" && <SuggestedPrice card={c} onPrice={onPrice} />}
                <CardTotals card={c} />
                <button
                  type="button"
                  aria-expanded={openCard === c.id}
                  onClick={() => setOpenCard(openCard === c.id ? null : c.id)}
                  className="mt-2 text-sm font-medium text-blue-600"
                >
                  {openCard === c.id ? "Hide buys and sells" : "Buys and sells"}
                </button>
                {openCard === c.id && <CardMoney store={store} card={c} run={run} suggestedPrice={prices[c.id]} />}
              </li>
            ))}
          </ul>
        )}
      </div>

      <button type="button" onClick={removeFolder} className="self-start text-sm text-red-600">
        {confirmDelete ? "Tap again to delete this folder and its cards" : "Delete folder"}
      </button>
    </section>
  );
}
