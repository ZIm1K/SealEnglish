"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Eye, LogIn, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { Input, Segmented } from "@/components/ui/form";
import { Avatar, Badge, Skeleton } from "@/components/ui/misc";
import { usePeople } from "@/lib/queries";
import { startImpersonation, stopImpersonation, useImpersonator } from "@/lib/impersonate";
import { ROLE_LABEL, type Profile, type Role } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Admin picks a role, then a real account of that role, and sees the cabinet exactly as that person does. */
export function ViewAsDialog({ open, onOpenChange, me }: { open: boolean; onOpenChange: (v: boolean) => void; me: Profile }) {
  const { data: people = [], isLoading } = usePeople();
  const [role, setRole] = useState<Role>("student");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const others = people.filter((p) => p.id !== me.id);
  const roles = (["student", "teacher", "manager", "admin"] as Role[]).filter((r) => r !== "admin" || others.some((p) => p.role === "admin"));
  const list = others
    .filter((p) => p.role === role)
    .filter((p) => !q || `${p.full_name} ${p.email ?? ""}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(b.is_active) - Number(a.is_active));

  const go = async (p: Profile) => {
    setBusy(p.id);
    try {
      await startImpersonation(p.id, me.full_name);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Переглянути як…" description="Кабінет відкриється від імені обраного акаунта — з його розкладом, домашкою й правами. Повернутися можна кнопкою вгорі.">
        <div className="grid gap-4">
          <Segmented
            value={role}
            onChange={(r) => { setRole(r); setQ(""); }}
            label="Роль"
            className="flex-wrap"
            options={roles.map((r) => ({ value: r, label: `${ROLE_LABEL[r]} · ${others.filter((p) => p.role === r).length}` }))}
          />
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-mute" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ім'я або email" className="pl-10" aria-label="Пошук" />
          </div>
          <div className="-mx-2 max-h-[22rem] overflow-y-auto">
            {isLoading ? (
              <div className="grid gap-2 px-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-14" />)}</div>
            ) : list.length === 0 ? (
              <p className="px-2 py-8 text-center text-sm text-mute">{q ? "Нікого не знайдено" : `Акаунтів з роллю «${ROLE_LABEL[role]}» поки немає`}</p>
            ) : (
              list.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={!p.is_active || !!busy}
                  onClick={() => go(p)}
                  className={cn(
                    "group flex w-full cursor-pointer items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition hover:bg-seal-50 disabled:cursor-default disabled:hover:bg-transparent",
                    !p.is_active && "opacity-55",
                  )}
                >
                  <Avatar name={p.full_name} src={p.avatar_url} size={38} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{p.full_name}</span>
                    <span className="block truncate text-sm text-mute">{p.email}</span>
                  </span>
                  {!p.is_active ? (
                    <Badge tone="red">Деактивовано</Badge>
                  ) : busy === p.id ? (
                    <span className="text-sm font-semibold text-seal-700">Входимо…</span>
                  ) : (
                    <span className="flex items-center gap-1 text-sm font-semibold text-seal-700 opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
                      <LogIn className="size-4" /> Увійти
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Shown on every cabinet page while the admin looks through someone else's account. */
export function ImpersonationBanner({ profile }: { profile: Profile }) {
  const admin = useImpersonator();
  const [busy, setBusy] = useState(false);
  if (!admin || admin.id === profile.id) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-gradient-to-r from-coral-500 to-amber-500 px-4 py-2 text-sm text-white sm:px-6 lg:px-8">
      <Eye className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        Ви переглядаєте кабінет як <b>{profile.full_name}</b> · {ROLE_LABEL[profile.role]}. Усі дії виконуються від імені цього акаунта.
      </span>
      <Button
        size="xs"
        variant="white"
        loading={busy}
        title={`Адміністратор: ${admin.name}`}
        onClick={async () => { setBusy(true); await stopImpersonation(); }}
      >
        <ArrowLeft /> Повернутися до свого акаунта
      </Button>
    </div>
  );
}
