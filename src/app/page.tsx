import { FolderList } from "@/components/FolderList";
import { SignOutButton } from "@/components/SignOutButton";
import { isLocalMode } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  let email: string | undefined;
  if (!isLocalMode) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    email = user?.email;
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-10">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-[32px] font-bold tracking-tight">T-rack-CG</h1>
        {!isLocalMode && <SignOutButton />}
      </header>

      {isLocalMode ? (
        <div className="rounded-2xl border border-warn-line bg-warn-soft px-4 py-3 text-sm text-warn">
          <p className="font-medium">Local mode</p>
          <p className="mt-1">
            No database is connected, so there is no sign-in and your cards are
            saved in this browser only. Add Supabase keys to{" "}
            <code>.env.local</code> to sync across devices.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted">
          Signed in as <span className="font-medium">{email}</span>.
        </p>
      )}

      <FolderList />
    </main>
  );
}
