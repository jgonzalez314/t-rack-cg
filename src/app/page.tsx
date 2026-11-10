import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-6">
      <header className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold">T-rack-CG</h1>
        <form action="/auth/signout" method="post">
          <button type="submit" className="text-sm text-blue-600">
            Sign out
          </button>
        </form>
      </header>

      <p className="text-neutral-600 dark:text-neutral-400">
        Signed in as <span className="font-medium">{user?.email}</span>.
      </p>
      <p className="mt-4 text-neutral-600 dark:text-neutral-400">
        Folders and cards are coming in the next phase.
      </p>
    </main>
  );
}
