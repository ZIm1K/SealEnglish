"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  Bell, BookOpen, Bot, CalendarDays, CheckCheck, FolderOpen, Home, Inbox, LogOut, Menu as MenuIcon, MessagesSquare,
  Settings, ShieldCheck, Users, UsersRound, Wallet, X, Plug,
} from "lucide-react";
import { Popover } from "radix-ui";
import { formatDistanceToNow } from "date-fns";
import { uk } from "date-fns/locale";
import { useSession, isStaffRole } from "./session";
import { Logo } from "@/components/site/Logo";
import { Avatar, Badge, Spinner } from "@/components/ui/misc";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/overlay";
import { Seal, type SealEmotion } from "@/components/mascot/Seal";
import { supabase } from "@/lib/supabase";
import { useAiFeatures } from "@/lib/queries";
import { ROLE_LABEL, type Notification, type Role } from "@/lib/types";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: typeof Home;
  roles: Role[];
  badge?: "leads" | "flagged";
  /** shown only when the AI tutor is available to this student */
  needs?: "tutor";
}

const NAV: NavItem[] = [
  { href: "/app/", label: "Головна", icon: Home, roles: ["student", "teacher", "manager", "admin"] },
  { href: "/app/schedule/", label: "Розклад", icon: CalendarDays, roles: ["student", "teacher", "manager", "admin"] },
  { href: "/app/homework/", label: "Домашні завдання", icon: BookOpen, roles: ["student", "teacher", "manager", "admin"] },
  { href: "/app/practice/", label: "Практика з Сілі", icon: MessagesSquare, roles: ["student"], needs: "tutor" },
  { href: "/app/practice/", label: "Практика учнів", icon: MessagesSquare, roles: ["teacher", "manager", "admin"], badge: "flagged" },
  { href: "/app/materials/", label: "Матеріали", icon: FolderOpen, roles: ["student", "teacher", "manager", "admin"] },
  { href: "/app/leads/", label: "Заявки", icon: Inbox, roles: ["manager", "admin"], badge: "leads" },
  { href: "/app/groups/", label: "Групи", icon: UsersRound, roles: ["teacher", "manager", "admin"] },
  { href: "/app/people/", label: "Учні й команда", icon: Users, roles: ["teacher", "manager", "admin"] },
  { href: "/app/payouts/", label: "Оплата уроків", icon: Wallet, roles: ["teacher", "manager", "admin"] },
  { href: "/app/settings/", label: "Налаштування", icon: Settings, roles: ["student", "teacher", "manager", "admin"] },
  { href: "/app/ai/", label: "ШІ-модуль", icon: Bot, roles: ["admin"] },
  { href: "/app/settings/integrations/", label: "Інтеграції", icon: Plug, roles: ["admin"] },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { session, profile, loading, signOut, refreshProfile } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { data: ai } = useAiFeatures();

  useEffect(() => {
    if (!loading && !session) router.replace(`/login/`);
  }, [loading, session, router]);

  // Escape closes the mobile menu; the page behind it doesn't scroll while it's open.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileOpen(false);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [mobileOpen]);

  const items = useMemo(
    () => NAV.filter((n) => profile && n.roles.includes(profile.role) && (n.needs !== "tutor" || ai?.tutor)),
    [profile, ai?.tutor],
  );

  const { data: newLeads = 0 } = useQuery({
    queryKey: ["leads-new-count"],
    enabled: isStaffRole(profile?.role),
    queryFn: async () => {
      const { count } = await supabase.from("leads").select("id", { count: "exact", head: true }).eq("status", "new");
      return count ?? 0;
    },
    refetchInterval: 60_000,
  });

  const { data: flaggedCount = 0 } = useQuery({
    queryKey: ["practice-flagged-count"],
    enabled: !!profile && profile.role !== "student",
    queryFn: async () => {
      const { count } = await supabase.from("practice_sessions").select("id", { count: "exact", head: true }).eq("flagged", true).is("reviewed_at", null);
      return count ?? 0;
    },
    refetchInterval: 120_000,
  });

  // Signed in, but the profile couldn't be loaded (network error or a missing row) — don't spin forever.
  if (!loading && session && !profile) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="w-32"><Seal crop="head" emotion="surprised" /></div>
        <h1 className="font-display text-xl font-bold">Не вдалося завантажити профіль</h1>
        <p className="max-w-sm text-ink-soft">Перевірте з&apos;єднання й спробуйте ще раз. Якщо помилка повторюється — зверніться до менеджера школи.</p>
        <div className="flex gap-3">
          <button onClick={() => refreshProfile()} className="cursor-pointer rounded-xl bg-ocean-800 px-4 py-2 font-semibold text-white hover:bg-ocean-700">Спробувати ще раз</button>
          <button onClick={async () => { await signOut(); router.replace("/login/"); }} className="cursor-pointer font-semibold text-seal-700 hover:underline">Вийти</button>
        </div>
      </div>
    );
  }

  if (loading || !session || !profile) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3">
        <div className="w-28"><Seal crop="head" emotion="neutral" reading /></div>
        <Spinner />
      </div>
    );
  }

  if (!profile.is_active) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="w-36"><Seal crop="head" emotion="sad" /></div>
        <h1 className="font-display text-xl font-bold">Акаунт деактивовано</h1>
        <p className="max-w-sm text-ink-soft">Зверніться до менеджера школи, щоб відновити доступ.</p>
        <button onClick={signOut} className="font-semibold text-seal-700 hover:underline">Вийти</button>
      </div>
    );
  }

  const isActive = (href: string) => (href === "/app/" ? pathname === "/app" || pathname === "/app/" : pathname.startsWith(href.replace(/\/$/, "")));
  const activeItem = [...items].reverse().find((i) => isActive(i.href));

  const nav = (
    <nav className="grid gap-1">
      {items.map((n) => {
        const active = activeItem?.href === n.href;
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={() => setMobileOpen(false)}
            className={cn(
              "group relative flex items-center gap-3 rounded-2xl px-3.5 py-2.5 text-[0.93rem] font-medium transition-colors",
              active ? "bg-white text-ocean-900 shadow-soft" : "text-ink-soft hover:bg-white/70 hover:text-ink",
            )}
          >
            {active && <motion.span layoutId="nav-active" className="absolute inset-y-2 left-0 w-1 rounded-full bg-coral-500" />}
            <n.icon className={cn("size-[1.15rem] shrink-0", active ? "text-seal-600" : "text-mute group-hover:text-seal-600")} />
            <span className="truncate">{n.label}</span>
            {n.badge === "leads" && newLeads > 0 && (
              <span className="ml-auto rounded-full bg-coral-500 px-2 py-0.5 text-[11px] font-bold text-white" aria-label={`${newLeads} нових`}>{newLeads}</span>
            )}
            {n.badge === "flagged" && flaggedCount > 0 && (
              <span className="ml-auto rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-bold text-white" aria-label={`${flaggedCount} позначених сесій`}>{flaggedCount}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-svh bg-canvas lg:grid lg:grid-cols-[17rem_1fr]">
      <a href="#main" className="sr-only z-50 rounded-xl bg-white px-4 py-2 font-semibold text-ocean-900 shadow-lift focus:not-sr-only focus:fixed focus:top-3 focus:left-3">Перейти до змісту</a>
      {/* sidebar */}
      <aside className="sticky top-0 hidden h-svh flex-col border-r border-line bg-seal-50/60 p-4 lg:flex">
        <div className="px-2 py-2"><Logo href="/" /></div>
        <div className="mt-6 flex-1 overflow-y-auto">{nav}</div>
        <SidebarMascot role={profile.role} />
      </aside>

      {/* mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Меню кабінету" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-ocean-950/40 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 36 }}
              className="absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col bg-seal-50 p-4 shadow-lift"
            >
              <div className="flex items-center justify-between px-2 py-2">
                <Logo href="/" />
                <button onClick={() => setMobileOpen(false)} className="flex size-9 items-center justify-center rounded-xl hover:bg-white" aria-label="Закрити меню">
                  <X className="size-5" />
                </button>
              </div>
              <div className="mt-6 flex-1 overflow-y-auto">{nav}</div>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line/70 bg-canvas/85 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
          <button onClick={() => setMobileOpen(true)} className="flex size-10 items-center justify-center rounded-xl text-ink hover:bg-white lg:hidden" aria-label="Меню">
            <MenuIcon className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-[0.95rem] font-semibold text-ocean-900">{activeItem?.label ?? "Кабінет"}</div>
          </div>
          <NotificationsBell userId={profile.id} />
          <Menu>
            <MenuTrigger asChild>
              <button className="flex cursor-pointer items-center gap-2.5 rounded-2xl py-1 pr-2 pl-1 transition hover:bg-white">
                <Avatar name={profile.full_name} src={profile.avatar_url} size={34} />
                <span className="hidden text-left sm:block">
                  <span className="block max-w-40 truncate text-sm leading-tight font-semibold">{profile.full_name}</span>
                  <span className="block text-xs leading-tight text-mute">{ROLE_LABEL[profile.role]}</span>
                </span>
              </button>
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>{profile.email}</MenuLabel>
              <MenuItem onSelect={() => router.push("/app/settings/")}><Settings /> Налаштування</MenuItem>
              {profile.role === "admin" && (
                <MenuItem onSelect={() => router.push("/app/settings/integrations/")}><ShieldCheck /> Інтеграції</MenuItem>
              )}
              <MenuItem onSelect={() => router.push("/")}><Home /> Сайт школи</MenuItem>
              <MenuSeparator />
              <MenuItem danger onSelect={async () => { await signOut(); router.replace("/login/"); }}><LogOut /> Вийти</MenuItem>
            </MenuContent>
          </Menu>
        </header>
        <main id="main" tabIndex={-1} className="flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8">
          <motion.div key={pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  );
}

function SidebarMascot({ role }: { role: Role }) {
  const tips: Record<Role, string> = {
    student: "Не забудь про домашку! 📚",
    teacher: "Гарного уроку! ✨",
    manager: "Нові заявки чекають 💬",
    admin: "Школа під контролем 💙",
  };
  return (
    <div className="relative mt-4 overflow-hidden rounded-3xl bg-gradient-to-br from-ocean-800 to-seal-600 p-4 text-white">
      <div className="relative z-10 max-w-[9rem] text-sm font-semibold">{tips[role]}</div>
      <div className="absolute -right-4 -bottom-6 w-28">
        <Seal crop="bust" emotion="happy" idle />
      </div>
      <div className="h-14" />
    </div>
  );
}

function NotificationsBell({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { data: items = [] } = useQuery({
    queryKey: ["notifications", userId],
    queryFn: async () => {
      const { data } = await supabase.from("notifications").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(30);
      return (data ?? []) as Notification[];
    },
  });
  const unread = items.filter((n) => !n.read_at).length;

  useEffect(() => {
    const ch = supabase
      .channel(`notif-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` }, () => {
        qc.invalidateQueries({ queryKey: ["notifications", userId] });
        qc.invalidateQueries({ queryKey: ["leads-new-count"] });
        qc.invalidateQueries({ queryKey: ["practice-flagged-count"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId, qc]);

  const markAll = async () => {
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", userId).is("read_at", null);
    qc.invalidateQueries({ queryKey: ["notifications", userId] });
  };

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="relative flex size-10 cursor-pointer items-center justify-center rounded-xl text-ink-soft transition hover:bg-white hover:text-ink" aria-label="Сповіщення">
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="absolute top-1.5 right-1.5 flex min-w-4.5 items-center justify-center rounded-full bg-coral-500 px-1 text-[10px] font-bold text-white ring-2 ring-canvas">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="z-50 w-[min(24rem,calc(100vw-1.5rem))] rounded-3xl border border-line bg-white shadow-lift data-[state=open]:animate-[popIn_.16s_ease-out]">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <div className="font-display font-semibold">Сповіщення</div>
            {unread > 0 && (
              <button onClick={markAll} className="flex cursor-pointer items-center gap-1 text-xs font-semibold text-seal-700 hover:underline">
                <CheckCheck className="size-3.5" /> Прочитати всі
              </button>
            )}
          </div>
          <div className="max-h-[26rem] overflow-y-auto p-2">
            {items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-mute">
                <div className="w-20"><Seal crop="head" emotion="sleepy" idle={false} /></div>
                Поки тихо. Сповіщення з&apos;являться тут.
              </div>
            ) : (
              items.map((n) => (
                <Popover.Close asChild key={n.id}>
                  <button
                    onClick={async () => {
                      if (!n.read_at) {
                        await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id);
                        qc.invalidateQueries({ queryKey: ["notifications", userId] });
                      }
                      if (n.link) router.push(n.link);
                    }}
                    className={cn("flex w-full cursor-pointer gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-seal-50", !n.read_at && "bg-seal-50/60")}
                  >
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-coral-500")} />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">{n.title}</span>
                      {n.body && <span className="mt-0.5 block text-sm text-ink-soft">{n.body}</span>}
                      <span className="mt-1 block text-xs text-mute">{formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: uk })}</span>
                    </span>
                  </button>
                </Popover.Close>
              ))
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function PageHeader({ title, description, actions }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold text-ocean-900 sm:text-3xl">{title}</h1>
        {description && <p className="mt-1.5 text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  title, text, action, emotion = "neutral",
}: {
  title: string;
  text?: React.ReactNode;
  action?: React.ReactNode;
  emotion?: SealEmotion;
}) {
  return (
    <div className="flex flex-col items-center rounded-4xl border border-dashed border-seal-200 bg-white/60 px-6 py-14 text-center">
      <div className="w-28"><Seal crop="head" emotion={emotion} idle={false} /></div>
      <h3 className="mt-4 font-display text-lg font-semibold text-ocean-900">{title}</h3>
      {text && <p className="mt-1.5 max-w-md text-sm text-ink-soft">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export { Badge };
