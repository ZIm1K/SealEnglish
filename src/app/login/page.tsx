"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { toast } from "sonner";
import { AuthShell } from "@/components/app/AuthShell";
import { useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { humanizeError, supabase } from "@/lib/supabase";
import type { SealEmotion } from "@/components/mascot/Seal";

export default function LoginPage() {
  const router = useRouter();
  const { session, loading } = useSession();
  const [mode, setMode] = useState<"login" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [emotion, setEmotion] = useState<SealEmotion>("happy");
  const [bubble, setBubble] = useState("Welcome back! 👋");
  const [look, setLook] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!loading && session) router.replace("/app/");
  }, [loading, session, router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        setEmotion("joy");
        setBubble("Yay! Let's go! 🎉");
        router.replace("/app/");
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/auth/callback/?next=/auth/reset/`,
        });
        if (error) throw error;
        toast.success("Лист для відновлення пароля надіслано. Перевірте пошту.");
        setMode("login");
      }
    } catch (err) {
      const msg = humanizeError(err instanceof Error ? err.message : String(err));
      toast.error(msg);
      setEmotion("sad");
      setBubble("Oops… let's try again 🥺");
      setTimeout(() => setEmotion("happy"), 1800);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title={mode === "login" ? "Вхід до кабінету" : "Відновлення пароля"}
      subtitle={mode === "login" ? "Для учнів, викладачів і менеджерів Seal English" : "Надішлемо посилання для створення нового пароля"}
      emotion={emotion}
      bubble={bubble}
      look={look}
    >
      <form onSubmit={submit} className="grid gap-5">
        <Field label="Логін (email)" htmlFor="email" hint={mode === "login" ? "ваш логін — це ваша пошта" : undefined}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onFocus={() => {
              setEmotion("happy");
              setLook({ x: 0.9, y: 0.3 });
              setBubble("What's your email? ✉️");
            }}
            placeholder="you@example.com"
          />
        </Field>
        {mode === "login" && (
          <Field
            label="Пароль"
            htmlFor="password"
            hint={
              <button type="button" onClick={() => setMode("reset")} className="cursor-pointer font-semibold text-seal-700 hover:underline">
                Забули пароль?
              </button>
            }
          >
            <div className="relative">
              <Input
                id="password"
                type={show ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => {
                  setEmotion(show ? "wink" : "sleepy");
                  setLook(null);
                  setBubble(show ? "I see it! 😉" : "I'm not looking! 🙈");
                }}
                onBlur={() => setEmotion("happy")}
                className="pr-11"
              />
              <button
                type="button"
                onClick={() => {
                  setShow((v) => !v);
                  setEmotion(!show ? "wink" : "sleepy");
                }}
                className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-mute hover:bg-seal-50 hover:text-ink"
                aria-label={show ? "Сховати пароль" : "Показати пароль"}
              >
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
        )}
        <Button type="submit" size="lg" loading={busy} className="mt-1 w-full">
          {mode === "login" ? (<><LogIn /> Увійти</>) : "Надіслати посилання"}
        </Button>
        {mode === "reset" && (
          <button type="button" onClick={() => setMode("login")} className="cursor-pointer text-sm font-semibold text-seal-700 hover:underline">
            ← Повернутися до входу
          </button>
        )}
      </form>
      <div className="mt-10 rounded-3xl border border-line bg-white p-5 text-sm text-ink-soft">
        Ще не навчаєтесь у нас? Акаунт створює менеджер після пробного уроку.{" "}
        <Link href="/#trial" className="font-semibold text-coral-600 hover:underline">
          Записатися на безкоштовний урок →
        </Link>
      </div>
    </AuthShell>
  );
}
