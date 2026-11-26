"use client";

// Settings saved in this browser. They are per device, like the cached prices.

import { useSyncExternalStore } from "react";

export type SellPriceSource = "manual" | "tcgplayer";

export interface Settings {
  /** "tcgplayer" fills a raw card's sell price with its TCGplayer suggested price. */
  sellPriceSource: SellPriceSource;
}

export const SETTINGS_KEY = "t-rack-cg-settings";
const DEFAULTS: Settings = { sellPriceSource: "manual" };

const listeners = new Set<() => void>();
let cached: { raw: string | null; value: Settings } | null = null;

export function parseSettings(raw: string | null): Settings {
  try {
    const v = JSON.parse(raw ?? "{}") as Partial<Settings>;
    return {
      sellPriceSource:
        v.sellPriceSource === "tcgplayer" ? "tcgplayer" : "manual",
    };
  } catch {
    return DEFAULTS;
  }
}

function read(): Settings {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(SETTINGS_KEY);
  } catch {
    // Storage blocked: use the defaults.
  }
  // Return the same object while nothing changed, as useSyncExternalStore needs.
  if (!cached || cached.raw !== raw)
    cached = { raw, value: parseSettings(raw) };
  return cached.value;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === SETTINGS_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function updateSettings(change: Partial<Settings>) {
  const next = { ...read(), ...change };
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: the setting can't be saved.
  }
  listeners.forEach((l) => l());
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, read, () => DEFAULTS);
}
