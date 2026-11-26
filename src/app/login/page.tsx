"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { buttonClass, inputClass } from "@/components/ui";
import { isStaticPreview } from "@/lib/config";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // The GitHub Pages preview shows this screen as a demo. It has no
    // Supabase keys, so nothing is sent anywhere.
    if (isStaticPreview) {
      setError(null);
      setNotice("Sign-in is off in this preview. This screen is a demo.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const supabase = createClient();

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setError(error.message);
      } else {
        router.replace("/");
        router.refresh();
      }
    } else {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setError(error.message);
      } else if (data.session) {
        router.replace("/");
        router.refresh();
      } else {
        setNotice("Check your email to confirm your account, then sign in.");
        setMode("signin");
      }
    }
    setBusy(false);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <h1 className="mb-1 text-[32px] font-bold tracking-tight">T-rack-CG</h1>
      <p className="mb-8 text-sm text-muted">
        Track your Pokemon cards, raw and graded.
      </p>

      {isStaticPreview && (
        <div className="mb-6 rounded-2xl border border-warn-line bg-warn-soft px-4 py-3 text-sm text-warn">
          <p className="font-medium">Demo only</p>
          <p className="mt-1">
            This is how the sign-in screen looks. Sign-in is off in this
            preview, so nothing you type is sent.{" "}
            <Link href="/" className="font-medium underline">
              Back to the preview
            </Link>
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
          Email
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-ink-soft">
          Password
          <input
            type="password"
            required
            minLength={6}
            autoComplete={
              mode === "signin" ? "current-password" : "new-password"
            }
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </label>

        {error && <p className="text-sm text-neg">{error}</p>}
        {notice && <p className="text-sm text-pos">{notice}</p>}

        <button type="submit" disabled={busy} className={`${buttonClass} mt-2`}>
          {busy
            ? "Please wait…"
            : mode === "signin"
              ? "Sign in"
              : "Create account"}
        </button>
      </form>

      <button
        type="button"
        onClick={() => {
          setMode(mode === "signin" ? "signup" : "signin");
          setError(null);
          setNotice(null);
        }}
        className="mt-4 text-sm font-medium text-accent"
      >
        {mode === "signin"
          ? "New here? Create an account"
          : "Already have an account? Sign in"}
      </button>
    </main>
  );
}
