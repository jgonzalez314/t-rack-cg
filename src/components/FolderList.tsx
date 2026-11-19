"use client";

import Link from "next/link";
import { useState } from "react";
import { useCollection } from "@/lib/data/use-collection";
import { ExportButton } from "./ExportButton";
import { SyncBadge } from "./SyncBadge";
import { buttonClass, cardClass, inputClass } from "./ui";

export function FolderList() {
  const { store, status, run, syncNow } = useCollection();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!store) return <p className="mt-6 text-neutral-500">Loading…</p>;

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
    <section className="mt-6 flex flex-col gap-6">
      <SyncBadge status={status} onRetry={() => void syncNow()} />

      <form onSubmit={create} className="flex flex-col gap-2" aria-label="New folder">
        <h2 className="text-lg font-semibold">New folder</h2>
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
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className={`${buttonClass} self-start`}>
          Create folder
        </button>
      </form>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Folders</h2>
          {folders.length > 0 && <ExportButton store={store} />}
        </div>
        {folders.length === 0 ? (
          <p className="text-neutral-500">No folders yet. Create one above to start adding cards.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {folders.map((f) => (
              <li key={f.id}>
                <Link href={`/folder?id=${f.id}`} className={`${cardClass} flex items-center justify-between`}>
                  <span>
                    <span className="block font-medium">{f.name}</span>
                    {f.description && (
                      <span className="block text-sm text-neutral-500">{f.description}</span>
                    )}
                  </span>
                  <span className="text-sm text-neutral-500">
                    {counts[f.id] ?? 0} {counts[f.id] === 1 ? "card" : "cards"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
