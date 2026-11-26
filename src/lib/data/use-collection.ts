"use client";

// One place for client components to read and change folders and cards.
// Every change is saved to this browser first, so it works offline. When
// Supabase is set up, changes are queued and synced whenever there is a
// connection.

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { isLocalMode } from "@/lib/config";
import { createClient } from "@/lib/supabase/client";
import { LocalStore, LocalStoreError, STORAGE_KEY } from "./local-store";
import { OUTBOX_KEY, Outbox } from "./outbox";
import {
  clearAccountData,
  lastSyncedAt,
  supabaseBackend,
  syncNow,
} from "./sync";

export type SyncStatus =
  | { state: "local" } // local mode: nothing to sync
  | { state: "offline"; pending: number }
  | { state: "syncing"; pending: number }
  | { state: "synced"; at?: string }
  | { state: "pending"; pending: number }
  | { state: "error"; pending: number; message: string };

type Client = {
  store: LocalStore;
  outbox: Outbox | null;
  version: number;
  status: SyncStatus;
  listeners: Set<() => void>;
};

let client: Client | null = null;

function notify() {
  if (!client) return;
  client.version++;
  client.listeners.forEach((l) => l());
}

function setStatus(status: SyncStatus) {
  if (!client) return;
  client.status = status;
  notify();
}

let syncing: Promise<void> | null = null;
let syncAgain = false;
let syncTimer: ReturnType<typeof setTimeout> | undefined;
// Set once this device's data has been wiped for signing out. No sync may run
// after that, or it would pull the account's data straight back.
let signedOut = false;

async function runSync() {
  const c = getClient();
  if (!c.outbox || signedOut) return;
  if (syncing) {
    syncAgain = true;
    return syncing;
  }
  const outbox = c.outbox;
  syncing = (async () => {
    do {
      syncAgain = false;
      if (!navigator.onLine) {
        setStatus({ state: "offline", pending: outbox.size });
        return;
      }
      setStatus({ state: "syncing", pending: outbox.size });
      const supabase = createClient();
      // Without a session the server would refuse every change, and sync
      // drops refused changes. Keep them queued until the user signs in.
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setStatus({
          state: "error",
          pending: outbox.size,
          message: "Sign in to sync your changes",
        });
        return;
      }
      const result = await syncNow({
        store: c.store,
        outbox,
        backend: supabaseBackend(supabase),
        storage: window.localStorage,
        userId: data.session.user.id,
      });
      if (result.status === "synced")
        setStatus({ state: "synced", at: result.at });
      else if (result.status === "offline")
        setStatus({ state: "offline", pending: outbox.size });
      else
        setStatus({
          state: "error",
          pending: outbox.size,
          message: result.message,
        });
    } while (syncAgain);
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

/**
 * Before signing out: tries one last sync and returns how many changes are
 * still not on the server, so the caller can warn before wiping them.
 */
export async function pendingChanges(): Promise<number> {
  const c = getClient();
  if (!c.outbox) return 0;
  clearTimeout(syncTimer);
  if (c.outbox.size) await runSync().catch(() => {});
  // A sync may already have been running with nothing to push. Let it finish
  // so it can't write anything after the wipe.
  else if (syncing) await syncing.catch(() => {});
  return c.outbox.size;
}

/** Wipes this account's data from the browser, for signing out. */
export async function clearThisDevice() {
  signedOut = true;
  clearTimeout(syncTimer);
  if (syncing) await syncing.catch(() => {});
  clearAccountData(window.localStorage);
}

/** Syncs soon, so a burst of changes goes out together. */
function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, 500);
}

function getClient(): Client {
  if (client) return client;
  const storage = window.localStorage;
  const outbox = isLocalMode ? null : new Outbox(storage);
  const store = new LocalStore(storage, undefined, undefined, (change) => {
    if (!outbox) return;
    outbox.add(change);
    scheduleSync();
  });
  client = {
    store,
    outbox,
    version: 0,
    status: outbox
      ? outbox.size
        ? { state: "pending", pending: outbox.size }
        : { state: "synced", at: lastSyncedAt(storage) }
      : { state: "local" },
    listeners: new Set(),
  };

  // Another tab changed the data.
  window.addEventListener("storage", (e) => {
    if (e.key === STORAGE_KEY || e.key === OUTBOX_KEY) notify();
  });
  if (outbox) {
    window.addEventListener("online", () => void runSync());
    window.addEventListener("offline", () =>
      setStatus({ state: "offline", pending: outbox.size }),
    );
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void runSync();
    });
    void runSync();
  }
  return client;
}

function subscribe(listener: () => void) {
  const c = getClient();
  c.listeners.add(listener);
  return () => void c.listeners.delete(listener);
}

/**
 * Returns the local store plus a version number that changes whenever the
 * data does, so components re-read after every change or sync. `ready` is
 * false during server rendering, where there is no browser storage.
 */
export function useCollection() {
  const version = useSyncExternalStore(
    subscribe,
    () => getClient().version,
    () => -1,
  );
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const store = ready && version >= 0 ? getClient().store : null;
  const status: SyncStatus = store ? getClient().status : { state: "local" };

  /** Runs a change, refreshes the screen, and returns an error message if it failed. */
  const run = useCallback(
    <T>(fn: (s: LocalStore) => T): { value?: T; error?: string } => {
      try {
        const value = fn(getClient().store);
        notify();
        return { value };
      } catch (e) {
        if (e instanceof LocalStoreError) return { error: e.message };
        throw e;
      }
    },
    [],
  );

  return { store, version, status, run, syncNow: runSync };
}
