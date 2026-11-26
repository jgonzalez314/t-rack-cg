"use client";

import Link from "next/link";
import { useState } from "react";
import { useCollection } from "@/lib/data/use-collection";
import { ExportButton } from "./ExportButton";
import { SyncBadge } from "./SyncBadge";
import { buttonClass, cardClass, inputClass, labelClass } from "./ui";

export function FolderList() {
  const { store, status, run, syncNow } = useCollection();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!store) return <p className="mt-6 text-muted">Loading…</p>;

  const folders = store.listFolders();
  const counts = store.countCardsByFolder();

  function create(e: React.FormEvent) {
    e.preventDefault();
    const { error } = run((s) => s.createFolder({ name, description }));
    setError(error ?? null);
    if (!error) {
      setName("");
      setDescription("");
    }
  }

  return (
    <section className="mt-4 flex flex-col gap-6">
      <SyncBadge status={status} onRetry={() => void syncNow()} />

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3 px-1">
          <h2 className={labelClass}>Folders</h2>
          {folders.length > 0 && <ExportButton store={store} />}
        </div>
        {folders.length === 0 ? (
          <p className={`${cardClass} text-muted`}>
            No folders yet. Create one below to start adding cards.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-2xl bg-surface shadow-tile">
            {folders.map((f) => (
              <li
                key={f.id}
                className="border-t border-divider first:border-t-0"
              >
                <Link
                  href={`/folder?id=${f.id}`}
                  className="flex items-center gap-3 px-4 py-3 active:bg-sunken"
                >
                  <span
                    aria-hidden
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-lg text-accent"
                  >
                    ▦
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">
                      {f.name}
                    </span>
                    {f.description && (
                      <span className="block truncate text-[13px] text-muted">
                        {f.description}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-[13px] text-muted tabular-nums">
                    {counts[f.id] ?? 0} {counts[f.id] === 1 ? "card" : "cards"}
                  </span>
                  <span aria-hidden className="text-faint">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        onSubmit={create}
        className={`${cardClass} flex flex-col gap-2.5 py-4`}
        aria-label="New folder"
      >
        <h2 className="text-[17px] font-semibold">New folder</h2>
        <input
          aria-label="Folder name"
          placeholder="Folder name, like Main binder"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
        <input
          aria-label="Description (optional)"
          placeholder="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputClass}
        />
        {error && <p className="text-sm text-neg">{error}</p>}
        <button type="submit" className={`${buttonClass} self-start`}>
          Create folder
        </button>
      </form>
    </section>
  );
}
