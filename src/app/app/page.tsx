"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { addDays, startOfDay } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BookOpen, CalendarPlus, Inbox, Send, Sparkles, Users, UsersRound, CalendarDays, ClipboardCheck, FilePlus2 } from "lucide-react";
import { useMe, isStaffRole } from "@/components/app/session";
import { EmptyState } from "@/components/app/AppShell";
import { JoinButton, LessonDialog, LessonRow, NewLessonDialog } from "@/components/app/lessons";
import { Seal } from "@/components/mascot/Seal";
import { Button } from "@/components/ui/button";
import { Avatar, Badge, Card, CardHeader, Skeleton } from "@/components/ui/misc";
import { supabase } from "@/lib/supabase";
import { useAssignments, useLessons, targetLabel } from "@/lib/queries";
import { countdown, fmtDateTime, fmtRelativeDay, fmtTime } from "@/lib/dates";
import { LEAD_STATUS, SUBMISSION_STATUS, type Lead, type Lesson } from "@/lib/types";

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Доброї ночі";
  if (h < 12) return "Доброго ранку";
  if (h < 18) return "Доброго дня";
  return "Доброго вечора";
}

export default function Dashboard() {
  const me = useMe();
  const today = useMemo(() => startOfDay(new Date()), []);
  const { data: lessons = [], isLoading } = useLessons(today, addDays(today, 14), me.role === "teacher" ? { teacherId: me.id } : {});
  const upcoming = lessons.filter((l) => l.status === "scheduled" && new Date(l.ends_at) > new Date());
  const next = upcoming[0];
  const [open, setOpen] = useState<Lesson | null>(null);

  return (
    <div className="grid gap-6">
      <Hello next={next} />
      {me.role === "student" && <StudentBoard upcoming={upcoming} loading={isLoading} onOpen={setOpen} />}
      {me.role === "teacher" && <TeacherBoard upcoming={upcoming} loading={isLoading} onOpen={setOpen} />}
      {isStaffRole(me.role) && <StaffBoard upcoming={upcoming} loading={isLoading} onOpen={setOpen} />}
      <LessonDialog lesson={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function Hello({ next }: { next?: Lesson }) {
  const me = useMe();
  const first = me.full_name.split(" ")[0] || "друже";
  return (
    <section className="relative overflow-hidden rounded-4xl bg-gradient-to-br from-ocean-900 via-ocean-800 to-seal-700 p-6 text-white shadow-lift sm:p-8">
      <div aria-hidden className="absolute -top-20 -right-20 size-72 rounded-full bg-seal-400/25 blur-3xl" />
      <div className="relative grid items-center gap-6 md:grid-cols-[1fr_auto]">
        <div className="max-w-xl">
          <p className="text-sm text-seal-200/80">{greeting()},</p>
          <h1 className="mt-1 font-display text-3xl font-bold sm:text-4xl">{first}! 👋</h1>
          {next ? (
            <div className="mt-5 rounded-3xl bg-white/10 p-4 backdrop-blur">
              <div className="flex flex-wrap items-center gap-2 text-xs text-seal-100/80">
                <Badge tone="coral">{fmtRelativeDay(next.starts_at)}, {fmtTime(next.starts_at)}</Badge>
                <span>{countdown(next.starts_at)}</span>
              </div>
              <div className="mt-2 font-display text-lg font-semibold">{next.title ?? (next.kind === "trial" ? "Пробний урок" : "Урок англійської")}</div>
              <div className="text-sm text-seal-100/75">{targetLabel(next)}{next.topic ? ` · ${next.topic}` : ""}</div>
              <div className="mt-4 flex flex-wrap gap-2">
                <JoinButton lesson={next} size="md" />
                <Button asChild variant="glass" size="md"><Link href="/app/schedule/"><CalendarDays /> Розклад</Link></Button>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-seal-100/80">Найближчим часом уроків немає. Гарний момент повторити матеріали 📚</p>
          )}
          {!me.telegram_chat_id && (
            <Link href="/app/settings/#telegram" className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-white/20">
              <Send className="size-4 text-seal-200" /> Підключіть Telegram, щоб отримувати нагадування
            </Link>
          )}
        </div>
        <div className="mx-auto hidden w-52 md:block">
          <Seal emotion={next ? "happy" : "neutral"} wave reading track crop="bust" />
        </div>
      </div>
    </section>
  );
}

function UpcomingCard({ upcoming, loading, onOpen, title = "Найближчі уроки", showTeacher }: { upcoming: Lesson[]; loading: boolean; onOpen: (l: Lesson) => void; title?: string; showTeacher?: boolean }) {
  return (
    <Card>
      <CardHeader title={title} action={<Button asChild variant="ghost" size="sm"><Link href="/app/schedule/">Усі <ArrowRight /></Link></Button>} />
      <div className="grid gap-2 p-5 sm:p-6">
        {loading ? (
          Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-16" />)
        ) : upcoming.length === 0 ? (
          <p className="py-6 text-center text-sm text-mute">Уроків найближчими днями немає</p>
        ) : (
          upcoming.slice(0, 6).map((l) => (
            <div key={l.id}>
              <div className="mb-1 text-xs font-semibold text-mute">{fmtRelativeDay(l.starts_at)}</div>
              <LessonRow lesson={l} onClick={() => onOpen(l)} showTeacher={showTeacher} />
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

// ───────────── student ─────────────
function StudentBoard({ upcoming, loading, onOpen }: { upcoming: Lesson[]; loading: boolean; onOpen: (l: Lesson) => void }) {
  const me = useMe();
  const { data: assignments = [], isLoading } = useAssignments();
  const open = assignments.filter((a) => {
    const s = a.submissions?.find((x) => x.student_id === me.id);
    return !s || s.status === "needs_revision";
  });
  const graded = assignments
    .map((a) => ({ a, s: a.submissions?.find((x) => x.student_id === me.id && x.status === "reviewed") }))
    .filter((x) => x.s)
    .slice(0, 4);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <UpcomingCard upcoming={upcoming} loading={loading} onOpen={onOpen} />
      <div className="grid gap-6">
        <Card>
          <CardHeader title="Домашні завдання" description={open.length ? `${open.length} до виконання` : "Все здано ✨"} action={<Button asChild variant="ghost" size="sm"><Link href="/app/homework/">Усі <ArrowRight /></Link></Button>} />
          <div className="grid gap-2 p-5 sm:p-6">
            {isLoading ? <Skeleton className="h-14" /> : open.length === 0 ? (
              <div className="flex items-center gap-3 rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800"><Sparkles className="size-5" /> Молодець! Нових завдань немає.</div>
            ) : (
              open.slice(0, 4).map((a) => {
                const late = a.due_at && new Date(a.due_at) < new Date();
                return (
                  <Link key={a.id} href={`/app/homework/view/?id=${a.id}`} className="flex items-center justify-between gap-3 rounded-2xl border border-line p-3 transition hover:border-seal-300 hover:shadow-soft">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{a.title}</div>
                      <div className={`text-xs ${late ? "text-coral-600" : "text-mute"}`}>{a.due_at ? `${late ? "Прострочено · " : "До "}${fmtDateTime(a.due_at)}` : "Без дедлайну"}</div>
                    </div>
                    <BookOpen className="size-5 shrink-0 text-seal-500" />
                  </Link>
                );
              })
            )}
          </div>
        </Card>
        {graded.length > 0 && (
          <Card>
            <CardHeader title="Останні оцінки" />
            <div className="grid gap-2 p-5 sm:p-6">
              {graded.map(({ a, s }) => (
                <Link key={a.id} href={`/app/homework/view/?id=${a.id}`} className="flex items-center justify-between gap-3 rounded-2xl bg-seal-50 p-3">
                  <span className="truncate text-sm font-medium">{a.title}</span>
                  <span className="font-display text-lg font-bold text-seal-700">{s!.score ?? "✓"}<span className="text-xs text-mute">/{a.max_score}</span></span>
                </Link>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

// ───────────── teacher ─────────────
function TeacherBoard({ upcoming, loading, onOpen }: { upcoming: Lesson[]; loading: boolean; onOpen: (l: Lesson) => void }) {
  const me = useMe();
  const [creating, setCreating] = useState(false);
  const { data: assignments = [] } = useAssignments();
  const toReview = assignments.filter((a) => a.teacher_id === me.id).flatMap((a) => (a.submissions ?? []).filter((s) => s.status === "submitted").map((s) => ({ a, s })));
  const todayCount = upcoming.filter((l) => new Date(l.starts_at).toDateString() === new Date().toDateString()).length;

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat icon={CalendarDays} label="Уроків сьогодні" value={todayCount} tone="from-seal-500 to-seal-700" />
        <Stat icon={ClipboardCheck} label="Робіт на перевірку" value={toReview.length} tone="from-coral-400 to-coral-600" href="/app/homework/" />
        <div className="card flex flex-col justify-center gap-2 p-5">
          <Button onClick={() => setCreating(true)}><CalendarPlus /> Новий урок</Button>
          <Button asChild variant="soft"><Link href="/app/homework/?new=1"><FilePlus2 /> Нове завдання</Link></Button>
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <UpcomingCard upcoming={upcoming} loading={loading} onOpen={onOpen} title="Мої уроки" />
        <Card>
          <CardHeader title="На перевірку" description="Нові роботи учнів" />
          <div className="grid gap-2 p-5 sm:p-6">
            {toReview.length === 0 ? (
              <p className="py-6 text-center text-sm text-mute">Усе перевірено 🎉</p>
            ) : (
              toReview.slice(0, 6).map(({ a, s }) => (
                <Link key={s.id} href={`/app/homework/view/?id=${a.id}`} className="flex items-center gap-3 rounded-2xl border border-line p-3 transition hover:border-seal-300">
                  <Avatar name={s.student?.full_name ?? "Учень"} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{a.title}</div>
                    <div className="text-xs text-mute">{fmtDateTime(s.submitted_at)}</div>
                  </div>
                  <Badge tone={SUBMISSION_STATUS[s.status].tone}>{SUBMISSION_STATUS[s.status].label}</Badge>
                </Link>
              ))
            )}
          </div>
        </Card>
      </div>
      <NewLessonDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

// ───────────── staff ─────────────
function StaffBoard({ upcoming, loading, onOpen }: { upcoming: Lesson[]; loading: boolean; onOpen: (l: Lesson) => void }) {
  const { data: stats } = useQuery({
    queryKey: ["staff-overview"],
    queryFn: async () => {
      const { data } = await supabase.rpc("staff_overview");
      return data as Record<string, number> | null;
    },
  });
  const { data: leads = [], isLoading } = useQuery({
    queryKey: ["leads", "recent"],
    queryFn: async () => {
      const { data } = await supabase.from("leads").select("*").in("status", ["new", "contacted", "trial_scheduled", "trial_done"]).order("created_at", { ascending: false }).limit(6);
      return (data ?? []) as Lead[];
    },
  });

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={Inbox} label="Нових заявок" value={stats?.leads_new} tone="from-coral-400 to-coral-600" href="/app/leads/" />
        <Stat icon={Sparkles} label="Заявок у роботі" value={stats?.leads_active} tone="from-violet-400 to-violet-600" href="/app/leads/" />
        <Stat icon={Users} label="Активних учнів" value={stats?.students} tone="from-seal-500 to-seal-700" href="/app/people/" />
        <Stat icon={UsersRound} label="Уроків цього тижня" value={stats?.lessons_week} tone="from-emerald-400 to-emerald-600" href="/app/schedule/" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader
            title="Заявки в роботі"
            description={stats ? `За місяць: ${stats.leads_month} · учнями стали: ${stats.won_month}` : undefined}
            action={<Button asChild variant="ghost" size="sm"><Link href="/app/leads/">CRM <ArrowRight /></Link></Button>}
          />
          <div className="grid gap-2 p-5 sm:p-6">
            {isLoading ? <Skeleton className="h-14" /> : leads.length === 0 ? (
              <EmptyState title="Поки порожньо" text="Нові заявки з сайту й Telegram з'являться тут автоматично." emotion="sleepy" />
            ) : (
              leads.map((l) => (
                <Link key={l.id} href={`/app/leads/?id=${l.id}`} className="flex items-center gap-3 rounded-2xl border border-line p-3 transition hover:border-seal-300 hover:shadow-soft">
                  <Avatar name={l.name} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">#{l.no} · {l.name}</div>
                    <div className="truncate text-xs text-mute">{l.phone} · {fmtDateTime(l.created_at)}</div>
                  </div>
                  <Badge tone={LEAD_STATUS[l.status].tone}>{LEAD_STATUS[l.status].label}</Badge>
                </Link>
              ))
            )}
          </div>
        </Card>
        <UpcomingCard upcoming={upcoming} loading={loading} onOpen={onOpen} title="Уроки школи" showTeacher />
      </div>
    </>
  );
}

function Stat({ icon: Icon, label, value, tone, href }: { icon: typeof Inbox; label: string; value?: number; tone: string; href?: string }) {
  const body = (
    <div className="card group flex items-center gap-4 p-5 transition hover:shadow-lift">
      <div className={`flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br ${tone} text-white shadow-soft transition-transform group-hover:scale-105`}>
        <Icon className="size-6" />
      </div>
      <div>
        <div className="font-display text-2xl font-bold text-ocean-900">{value ?? "—"}</div>
        <div className="text-sm text-mute">{label}</div>
      </div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
