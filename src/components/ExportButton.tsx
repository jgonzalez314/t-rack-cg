"use client";

import { useState } from "react";
import type { LocalStore } from "@/lib/data/local-store";
import { buildWorkbook, exportFileName } from "@/lib/export/workbook";
import { savedSuggestions } from "@/lib/pricing/cache";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Downloads the collection (or one folder) as a formatted Excel file. It is
 * built in the browser from saved data, so it works offline.
 */
export function ExportButton({ store, folderId }: { store: LocalStore; folderId?: string }) {
  const [error, setError] = useState<string | null>(null);

  function download() {
    try {
      const data = store.allData();
      const bytes = buildWorkbook(data, { folderId, suggestions: savedSuggestions(data.cards) });
      const blob = new Blob([bytes as BlobPart], { type: XLSX_TYPE });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportFileName(folderId ? store.getFolder(folderId) : undefined);
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Give the browser time to start the download before freeing it.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={download}
        className="self-start rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-blue-600 dark:border-neutral-700"
      >
        {folderId ? "Export folder to Excel" : "Export to Excel"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
