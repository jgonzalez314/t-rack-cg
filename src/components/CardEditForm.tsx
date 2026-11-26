"use client";

import { useState } from "react";
import type { LocalStore } from "@/lib/data/local-store";
import {
  CONDITIONS,
  GRADING_COMPANIES,
  type Card,
  type CardType,
  type Condition,
  type GradingCompany,
} from "@/lib/data/types";
import {
  buttonClass,
  inputClass,
  secondaryButtonClass,
  segmentClass,
  segmentItemClass,
} from "./ui";

type Run = <T>(fn: (s: LocalStore) => T) => { value?: T; error?: string };

const fieldLabel = "flex flex-col gap-1 text-[13px] font-medium text-ink-soft";

/** Edits every field of a card entry. Its buys and sells stay with it. */
export function CardEditForm({
  store,
  card,
  run,
  onDone,
}: {
  store: LocalStore;
  card: Card;
  run: Run;
  /** Called after saving or cancelling. */
  onDone: () => void;
}) {
  const [type, setType] = useState<CardType>(card.type);
  const [name, setName] = useState(card.name);
  const [cardNumber, setCardNumber] = useState(card.card_number);
  const [condition, setCondition] = useState<Condition>(card.condition ?? "NM");
  const [company, setCompany] = useState<GradingCompany>(
    card.grading_company ?? "PSA",
  );
  const [grade, setGrade] = useState(String(card.grade ?? 10));
  const [cert, setCert] = useState(card.cert_number ?? "");
  const [folderId, setFolderId] = useState(card.folder_id);
  const [error, setError] = useState<string | null>(null);
  const folders = store.listFolders();

  function save(e: React.FormEvent) {
    e.preventDefault();
    const { error } = run((s) =>
      s.updateCard(card.id, {
        folder_id: folderId,
        type,
        name,
        card_number: cardNumber,
        ...(type === "raw"
          ? { condition }
          : {
              grading_company: company,
              grade: Number(grade),
              cert_number: cert,
            }),
      }),
    );
    setError(error ?? null);
    if (!error) onDone();
  }

  return (
    <form
      onSubmit={save}
      className="mt-3 flex flex-col gap-2.5 border-t border-divider pt-3"
      aria-label={`Edit ${card.name}`}
    >
      <h4 className="text-[15px] font-semibold">Edit card</h4>
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
      <label className={fieldLabel}>
        Card name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </label>
      <label className={fieldLabel}>
        Card number
        <input
          value={cardNumber}
          onChange={(e) => setCardNumber(e.target.value)}
          className={inputClass}
        />
      </label>
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
          <label className={`${fieldLabel} col-span-2`}>
            Cert number
            <input
              value={cert}
              onChange={(e) => setCert(e.target.value)}
              className={inputClass}
            />
          </label>
        </div>
      )}
      {folders.length > 1 && (
        <label className={fieldLabel}>
          Folder
          <select
            value={folderId}
            onChange={(e) => setFolderId(e.target.value)}
            className={inputClass}
          >
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <p className="text-sm text-neg">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className={buttonClass}>
          Save changes
        </button>
        <button type="button" onClick={onDone} className={secondaryButtonClass}>
          Cancel
        </button>
      </div>
    </form>
  );
}
