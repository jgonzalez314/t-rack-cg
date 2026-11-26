"use client";

import { useEffect } from "react";
import { isStaticPreview } from "@/lib/config";

/** Registers public/sw.js so the app opens with no connection. */
export function ServiceWorker() {
  useEffect(() => {
    // Skipped in dev, where cached pages would hide code changes, and in the
    // GitHub Pages preview, which is served from a sub-path.
    if (
      process.env.NODE_ENV !== "production" ||
      isStaticPreview ||
      !("serviceWorker" in navigator)
    )
      return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
