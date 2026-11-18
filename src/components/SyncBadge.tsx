"use client";

import type { SyncStatus } from "@/lib/data/use-collection";

const changes = (n: number) => (n === 1 ? "1 change" : `${n} changes`);

function label(status: SyncStatus): { text: string; tone: string } | null {
  switch (status.state) {
    case "local":
      return null;
    case "offline":
      return {
        text: status.pending
          ? `Offline. ${changes(status.pending)} saved on this device, will sync when you're back online.`
          : "Offline. You can keep adding folders and cards.",
        tone: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200",
      };
    case "syncing":
      return { text: "Syncing…", tone: "border-neutral-200 text-neutral-600 dark:border-neutral-800 dark:text-neutral-400" };
    case "pending":
      return {
        text: `${changes(status.pending)} waiting to sync.`,
        tone: "border-neutral-200 text-neutral-600 dark:border-neutral-800 dark:text-neutral-400",
      };
    case "synced":
      return {
        text: status.at ? `Synced ${new Date(status.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Synced",
        tone: "border-neutral-200 text-neutral-600 dark:border-neutral-800 dark:text-neutral-400",
      };
    case "error":
      return {
        text: `Sync problem: ${status.message}${status.pending ? ` (${changes(status.pending)} still saved here)` : ""}`,
        tone: "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
      };
  }
}

export function SyncBadge({ status, onRetry }: { status: SyncStatus; onRetry: () => void }) {
  const l = label(status);
  if (!l) return null;
  return (
    <div role="status" className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${l.tone}`}>
      <span>{l.text}</span>
      {status.state === "error" && (
        <button type="button" onClick={onRetry} className="shrink-0 font-medium underline">
          Retry
        </button>
      )}
    </div>
  );
}
