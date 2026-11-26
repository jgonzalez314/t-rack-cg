"use client";

import { useEffect } from "react";

/** Registers public/sw.js so the app opens with no connection. */
export function ServiceWorker() {
  useEffect(() => {
    // Skipped in dev, where cached pages would hide code changes.
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    )
      return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
