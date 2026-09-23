"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { AuthShell } from "@/components/app/AuthShell";
import { useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Spinner } from "@/components/ui/misc";
import { humanizeError, supabase } from "@/lib/supabase";

/** One-time bootstrap: creates the first administrator while the school has none. */
export default function SetupPage() {
  const router = useRouter();
  const { session, refreshProfile } = useSession();
  const [state, setState] = useState<"loading" | "open" | "closed" | "confirm">("loading");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.rpc("has_admin").then(({ data }) => setState(data ? "closed" : "open"));
  }, []);

  const claim = async () => {
    const { data, error } = await supabase.rpc("claim_first_admin");
    if (error) throw error;
    if (!data) throw new Error("Адміністратор уже існує");
    await refreshProfile();
    toast.success("Готово! Ви — адміністратор школи 🎉");
    router.replace("/app/settings/integrations/");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (session) {
        await claim();
        return;
      }
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { full_name: name.trim() }, emailRedirectTo: `${window.location.origin}/auth/callback/?next=/setup/` },
      });
      if (error) throw error;
      if (data.session) await claim();
      else setState("confirm");
    } catch (err) {
      toast.error(humanizeError(err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  };

  if (state === "loading") {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (state === "closed") {
    return (
      <AuthShell title="Налаштування завершено" subtitle="Адміністратор школи вже існує." emotion="neutral" bubble="All set! ✅">
        <Button onClick={() => router.push("/login/")} size="lg" className="w-full">Перейти до входу</Button>
      </AuthShell>
    );
  }

  if (state === "confirm") {
    return (
      <AuthShell title="Підтвердіть email" subtitle="Ми надіслали лист із посиланням. Після підтвердження ви повернетеся сюди й завершите налаштування." emotion="wink" bubble="Check your inbox! 📬">
        <Button variant="outline" onClick={() => router.push("/login/")} size="lg" className="w-full">Я вже підтвердив(ла) — увійти</Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Перший запуск школи"
      subtitle="Створіть акаунт адміністратора. Ця сторінка працює лише доки в школі немає жодного адміністратора."
      emotion="joy"
      bubble="Let's set up your school! 🏫"
    >
      <form onSubmit={submit} className="grid gap-5">
        {session ? (
          <div className="rounded-3xl border border-line bg-white p-5 text-sm">
            Ви увійшли як <b>{session.user.email}</b>. Натисніть кнопку, щоб отримати права адміністратора.
          </div>
        ) : (
          <>
            <Field label="Ваше ім'я" htmlFor="name">
              <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Олександр" />
            </Field>
            <Field label="Email" htmlFor="email">
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </Field>
            <Field label="Пароль" hint="мінімум 8 символів" htmlFor="password">
              <Input id="password" type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </Field>
          </>
        )}
        <Button type="submit" size="lg" loading={busy} className="w-full">
          <ShieldCheck /> {session ? "Стати адміністратором" : "Створити адміністратора"}
        </Button>
      </form>
    </AuthShell>
  );
}
