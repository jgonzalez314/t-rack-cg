import { Suspense } from "react";
import { FolderView } from "@/components/FolderView";

// One static page for every folder (the folder id is in ?id=), so it can be
// cached and opened offline, even for folders made while offline.
export default function FolderPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-6">
      <h1 className="text-2xl font-bold">T-rack-CG</h1>
      <Suspense fallback={<p className="mt-6 text-neutral-500">Loading…</p>}>
        <FolderView />
      </Suspense>
    </main>
  );
}
