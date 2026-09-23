"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Seal } from "@/components/mascot/Seal";
import { supabase } from "@/lib/supabase";

function Callback() {
  const router = useRouter();
  const params = useSearchParams();
  const [asyncError, setError] = useState<string | null>(null);
  const error = params.get("error_description") ?? asyncError;

  useEffect(() => {
    const next = params.get("next") || "/app/";
    const code = params.get("code");
    if (params.get("error_description")) return;
    const go = () => router.replace(next.startsWith("/") ? next : "/app/");
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => (error ? setError(error.message) : go()));
    } else {
      supabase.auth.getSession().then(({ data }) => (data.session ? go() : setError("Посилання недійсне або застаріло")));
    }
  }, [params, router]);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="w-40">
        <Seal crop="head" emotion={error ? "sad" : "neutral"} reading />
      </div>
      {error ? (
        <>
          <h1 className="font-display text-xl font-bold text-ocean-900">Не вдалося увійти</h1>
          <p className="max-w-sm text-ink-soft">{error}</p>
          <a href="/login/" className="font-semibold text-seal-700 hover:underline">Повернутися до входу</a>
        </>
      ) : (
        <p className="font-medium text-ink-soft">Секундочку, заходимо…</p>
      )}
    </div>
  );
}

export default function CallbackPage() {
  return (
    <Suspense>
      <Callback />
    </Suspense>
  );
}
