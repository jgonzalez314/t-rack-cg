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
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-6">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold">T-rack-CG</h1>
        {!isLocalMode && (
          <form action="/auth/signout" method="post">
            <button type="submit" className="text-sm text-blue-600">
              Sign out
            </button>
          </form>
        )}
      </header>

      {isLocalMode ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-medium">Local mode</p>
          <p className="mt-1">
            No database is connected, so there is no sign-in and your cards are
            saved in this browser only. Add Supabase keys to{" "}
            <code>.env.local</code> to sync across devices.
          </p>
        </div>
      ) : (
        <p className="text-neutral-600 dark:text-neutral-400">
          Signed in as <span className="font-medium">{email}</span>.
        </p>
      )}

      <p className="mt-4 text-neutral-600 dark:text-neutral-400">
        Folders and cards are coming in the next phase.
      </p>
    </main>
  );
}
