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
import {
  buttonClass,
  cardClass,
  chipClass,
  dangerLinkClass,
  gradeChipClass,
  inputClass,
  labelClass,
  linkClass,
  profitTone,
  segmentClass,
  segmentItemClass,
} from "./ui";

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

  if (!store) return <p className="mt-6 text-muted">Loading…</p>;

  const folder = store.getFolder(id);
  if (!folder) {
    return (
      <div className="mt-6 flex flex-col gap-3">
        <p>This folder doesn&apos;t exist anymore.</p>
        <Link href="/" className={linkClass}>
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
        ? s.addCard({
            type,
            folder_id: id,
            name,
            card_number: cardNumber,
            condition,
          })
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
    setNotice(
      merged ? "This card was already in the folder in that condition." : null,
    );
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

  const fieldLabel =
    "flex min-w-0 flex-col gap-1 text-[13px] font-medium text-ink-soft";

  return (
    <section className="flex flex-col gap-5 pb-20">
      <div>
        <Link href="/" className="text-[16px] text-accent">
          ‹ Folders
        </Link>
        <h2 className="mt-1.5 text-[32px] font-bold leading-tight tracking-tight">
          {folder.name}
        </h2>
        <p className="text-sm text-muted">
          {folder.description ? `${folder.description} · ` : ""}
          {cards.length} {cards.length === 1 ? "card" : "cards"}
        </p>
      </div>

      <SyncBadge status={status} onRetry={() => void syncNow()} />

      {cards.length > 0 && (
        <dl
          className={`${cardClass} grid grid-cols-3 py-3.5`}
          aria-label="Folder totals"
        >
          <div>
            <dt className={labelClass}>Spent</dt>
            <dd className="mt-0.5 text-[17px] font-semibold tabular-nums">
              {money(totals.cost)}
            </dd>
          </div>
          <div className="border-l border-divider pl-3.5">
            <dt className={labelClass}>Received</dt>
            <dd className="mt-0.5 text-[17px] font-semibold tabular-nums">
              {money(totals.received)}
            </dd>
          </div>
          <div className="border-l border-divider pl-3.5">
            <dt className={labelClass}>Profit</dt>
            <dd
              className={`mt-0.5 text-[17px] font-semibold tabular-nums ${profitTone(totals.profit)}`}
            >
              {money(totals.profit)}
            </dd>
          </div>
        </dl>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3 px-1">
          <h3 className={labelClass}>Cards ({cards.length})</h3>
          {cards.length > 0 && (
            <ExportButton store={store} folderId={folder.id} />
          )}
        </div>
        {cards.length === 0 ? (
          <p className={`${cardClass} text-muted`}>
            No cards in this folder yet. Add one below.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {cards.map((c) => (
              <li key={c.id} className={cardClass}>
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-[16px] font-semibold">
                      {c.name}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
                      #{c.card_number}
                      {c.type === "raw" ? (
                        <span className={chipClass}>{c.condition}</span>
                      ) : (
                        <>
                          <span className={gradeChipClass}>
                            {c.grading_company} {c.grade}
                          </span>
                          <span>cert {c.cert_number}</span>
                        </>
                      )}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => run((s) => s.deleteCard(c.id))}
                    className={`shrink-0 text-sm ${dangerLinkClass}`}
                    aria-label={`Remove ${c.name}`}
                  >
                    Remove
                  </button>
                </div>
                {c.type === "raw" && (
                  <SuggestedPrice card={c} onPrice={onPrice} />
                )}
                <CardTotals card={c} />
                <button
                  type="button"
                  aria-expanded={openCard === c.id}
                  onClick={() => setOpenCard(openCard === c.id ? null : c.id)}
                  className="mt-3 w-full rounded-xl bg-accent-soft py-2 text-sm font-semibold text-accent"
                >
                  {openCard === c.id ? "Hide buys and sells" : "Buys and sells"}
                </button>
                {openCard === c.id && (
                  <CardMoney
                    store={store}
                    card={c}
                    run={run}
                    suggestedPrice={prices[c.id]}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        id="add-card"
        onSubmit={add}
        className={`${cardClass} flex scroll-mt-4 flex-col gap-2.5 py-4`}
        aria-label="Add card"
      >
        <h3 className="text-[17px] font-semibold">Add a card</h3>
        <div className={segmentClass} role="radiogroup" aria-label="Card type">
          {(["raw", "slab"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={type === t}
              onClick={() => setType(t)}
              className={segmentItemClass(type === t)}
            >
              {t === "raw" ? "Raw" : "Slab (graded)"}
            </button>
          ))}
        </div>
        <input
          aria-label="Card name"
          placeholder="Card name, like Charizard"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
        <input
          aria-label="Card number"
          placeholder="Card number, like 4/102"
          value={cardNumber}
          onChange={(e) => setCardNumber(e.target.value)}
          className={inputClass}
        />
        {type === "raw" ? (
          <label className={fieldLabel}>
            Condition
            <select
              value={condition}
              onChange={(e) => setCondition(e.target.value as Condition)}
              className={inputClass}
            >
              {CONDITIONS.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <label className={fieldLabel}>
              Grading company
              <select
                value={company}
                onChange={(e) => setCompany(e.target.value as GradingCompany)}
                className={inputClass}
              >
                {GRADING_COMPANIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className={fieldLabel}>
              Grade
              <input
                type="number"
                min={1}
                max={10}
                step={0.5}
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
                className={inputClass}
              />
            </label>
            <input
              aria-label="Cert number"
              placeholder="Cert number"
              value={cert}
              onChange={(e) => setCert(e.target.value)}
              className={`${inputClass} col-span-2`}
            />
          </div>
        )}
        {error && <p className="text-sm text-neg">{error}</p>}
        {notice && <p className="text-sm text-muted">{notice}</p>}
        <button type="submit" className={`${buttonClass} self-start`}>
          Add to folder
        </button>
      </form>

      <button
        type="button"
        onClick={removeFolder}
        className={`self-start px-1 text-sm ${dangerLinkClass}`}
      >
        {confirmDelete
          ? "Tap again to delete this folder and its cards"
          : "Delete folder"}
      </button>

      <a
        href="#add-card"
        className="fixed right-4 bottom-[max(1.25rem,env(safe-area-inset-bottom))] rounded-full bg-accent px-5 py-3 text-[15px] font-semibold text-accent-ink shadow-float"
      >
        + Add card
      </a>
    </section>
  );
}
