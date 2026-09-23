"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { AuthShell } from "@/components/app/AuthShell";
import { useSession } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { humanizeError, supabase } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const router = useRouter();
  const { session, loading } = useSession();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Паролі не збігаються");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return toast.error(humanizeError(error.message));
    toast.success("Пароль оновлено");
    router.replace("/app/");
  };

  return (
    <AuthShell title="Новий пароль" subtitle="Придумайте надійний пароль — щонайменше 8 символів." emotion="sleepy" bubble="I won't peek! 🙈">
      {!loading && !session ? (
        <p className="rounded-3xl bg-coral-50 p-5 text-sm text-coral-700">
          Посилання недійсне або застаріло. <a href="/login/" className="font-semibold underline">Запросіть нове</a>.
        </p>
      ) : (
        <form onSubmit={submit} className="grid gap-5">
          <Field label="Новий пароль" htmlFor="p1">
            <Input id="p1" type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Повторіть пароль" htmlFor="p2">
            <Input id="p2" type="password" minLength={8} required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </Field>
          <Button type="submit" size="lg" loading={busy} className="w-full"><KeyRound /> Зберегти пароль</Button>
        </form>
      )}
    </AuthShell>
  );
}
