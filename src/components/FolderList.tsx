"use client";

import Link from "next/link";
import { useState } from "react";
import { useCollection } from "@/lib/data/use-collection";
import { ExportButton } from "./ExportButton";
import { SyncBadge } from "./SyncBadge";
import { useDragReorder } from "./useDragReorder";
import { buttonClass, cardClass, inputClass, labelClass } from "./ui";

export function FolderList() {
  const { store, status, run, syncNow } = useCollection();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const folders = store ? store.listFolders() : [];
  // Rows sit flush in one tile, so there is no gap between them. Each row is
  // a link, so a press on it may start a drag (only form fields may not).
  const { drag, itemProps, offset } = useDragReorder(
    folders.map((f) => f.id),
    (order) => run((s) => s.reorderFolders(order)),
    { gap: 0, noDrag: "input, select, textarea, label, [contenteditable]" },
  );

  if (!store) return <p className="mt-6 text-muted">Loading…</p>;

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
        {folders.length > 1 && (
          <p className="px-1 text-[13px] text-muted">
            Press and hold a folder, then drag it to change the order.
          </p>
        )}
        {folders.length === 0 ? (
          <p className={`${cardClass} text-muted`}>
            No folders yet. Create one below to start adding cards.
          </p>
        ) : (
          <ul
            className={`rounded-2xl bg-surface shadow-tile ${drag ? "" : "overflow-hidden"}`}
          >
            {folders.map((f, i) => (
              <li
                key={f.id}
                {...itemProps(f.id)}
                style={
                  drag ? { transform: `translateY(${offset(i)}px)` } : undefined
                }
                className={`relative border-t border-divider select-none first:rounded-t-2xl first:border-t-0 last:rounded-b-2xl [-webkit-touch-callout:none] ${
                  drag?.id === f.id
                    ? "z-10 scale-[1.02] cursor-grabbing rounded-2xl border-transparent bg-surface shadow-float ring-2 ring-accent/40"
                    : drag
                      ? "bg-surface transition-transform duration-150"
                      : ""
                }`}
              >
                <Link
                  href={`/folder?id=${f.id}`}
                  draggable={false}
                  className="flex items-center gap-3 px-4 py-3 [-webkit-touch-callout:none] active:bg-sunken"
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
