"use client";

import { useState } from "react";
import { clearThisDevice, pendingChanges } from "@/lib/data/use-collection";

/**
 * Signs out and wipes this account's folders and cards from the browser, so
 * the next person on this device can't see them.
 */
export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setMessage(null);
    // Signing out needs the server. Offline, the wipe would happen but the
    // sign-out wouldn't, so wait until there is a connection.
    if (!navigator.onLine) {
      setMessage("Go online to sign out.");
      return;
    }
    setBusy(true);
    const pending = await pendingChanges();
    if (
      pending > 0 &&
      !window.confirm(
        `${pending === 1 ? "1 change hasn't" : `${pending} changes haven't`} synced yet and will be lost if you sign out now. Sign out anyway?`,
      )
    ) {
      setBusy(false);
      return;
    }
    await clearThisDevice();
    form.submit();
  }

  return (
    <form
      action="/auth/signout"
      method="post"
      onSubmit={handleSubmit}
      className="text-right"
    >
      <button
        type="submit"
        disabled={busy}
        className="text-[15px] font-medium text-accent"
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {message && <p className="text-xs text-muted">{message}</p>}
    </form>
  );
}
