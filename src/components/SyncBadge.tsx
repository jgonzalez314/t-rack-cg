"use client";

import type { SyncStatus } from "@/lib/data/use-collection";

const changes = (n: number) => (n === 1 ? "1 change" : `${n} changes`);

function label(status: SyncStatus): { text: string; tone: string; dot: string } | null {
  switch (status.state) {
    case "local":
      return null;
    case "offline":
      return {
        text: status.pending
          ? `Offline. ${changes(status.pending)} saved on this device, will sync when you're back online.`
          : "Offline. You can keep adding folders and cards.",
        tone: "border-warn-line bg-warn-soft text-warn",
        dot: "bg-warn",
      };
    case "syncing":
      return { text: "Syncing…", tone: "border-line bg-surface text-ink-soft", dot: "bg-accent animate-pulse" };
    case "pending":
      return {
        text: `${changes(status.pending)} waiting to sync.`,
        tone: "border-line bg-surface text-ink-soft",
        dot: "bg-faint",
      };
    case "synced":
      return {
        text: status.at ? `Synced ${new Date(status.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Synced",
        tone: "border-line bg-surface text-ink-soft",
        dot: "bg-pos",
      };
    case "error":
      return {
        text: `Sync problem: ${status.message}${status.pending ? ` (${changes(status.pending)} still saved here)` : ""}`,
        tone: "border-neg/30 bg-neg-soft text-neg",
        dot: "bg-neg",
      };
  }
}

export function SyncBadge({ status, onRetry }: { status: SyncStatus; onRetry: () => void }) {
  const l = label(status);
  if (!l) return null;
  return (
    <div
      role="status"
      className={`flex items-center justify-between gap-3 border text-sm ${
        status.state === "synced" || status.state === "syncing"
          ? "self-start rounded-full px-3 py-1 text-xs"
          : "rounded-2xl px-3 py-2"
      } ${l.tone}`}
    >
      <span className="flex items-center gap-2">
        <span aria-hidden className={`h-[7px] w-[7px] shrink-0 rounded-full ${l.dot}`} />
        {l.text}
      </span>
      {status.state === "error" && (
        <button type="button" onClick={onRetry} className="shrink-0 font-medium underline">
          Retry
        </button>
      )}
    </div>
  );
}
