"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { uk } from "date-fns/locale";
import { toast } from "sonner";
import { AlertTriangle, BookOpenCheck, CheckCircle2, Flag, GraduationCap, MessageCircleHeart, Send, ShieldCheck, Square, Target } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/app/AppShell";
import { useMe, isStaffRole } from "@/components/app/session";
import { MistakesProfile } from "@/components/app/mistakes";
import { Seal } from "@/components/mascot/Seal";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { Segmented, Textarea } from "@/components/ui/form";
import { Avatar, Badge, Card, CardHeader, Skeleton } from "@/components/ui/misc";
import { callFunction, streamFunction, supabase } from "@/lib/supabase";
import { useAiFeatures } from "@/lib/queries";
import { fmtDateTime } from "@/lib/dates";
import { MISTAKE_LABEL, type PracticeSession, type PracticeSummary, type PracticeTurn } from "@/lib/types";
import { cn } from "@/lib/utils";

const ago = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true, locale: uk });

type Mode = "lesson" | "mistakes" | "free" | "exam";
const MODES: { value: Mode; title: string; text: string; icon: typeof Target }[] = [
  { value: "lesson", title: "Мій останній урок", text: "Слова й граматика з уроку", icon: BookOpenCheck },
  { value: "mistakes", title: "Мої помилки", text: "Відпрацювати типові помилки", icon: Target },
  { value: "free", title: "Вільна розмова", text: "Ігри, музика, фільми, плани", icon: MessageCircleHeart },
  { value: "exam", title: "НМТ", text: "Завдання у форматі тесту", icon: GraduationCap },
];

function PracticeInner() {
  const me = useMe();
  return me.role === "student" ? <StudentPractice /> : <TeacherPractice />;
}

// ───────────────────────── student: chat with Seely ─────────────────────────
interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

function StudentPractice() {
  const me = useMe();
  const qc = useQueryClient();
  const params = useSearchParams();
  const lessonParam = params.get("lesson");
  const { data: ai, isLoading: aiLoading } = useAiFeatures();
  const [local, setLocal] = useState<{ id: string; turns: ChatTurn[] } | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [leftOverride, setLeft] = useState<number | null>(null);
  const [summary, setSummary] = useState<PracticeSummary | null | undefined>(undefined);
  const [flagged, setFlagged] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);

  // resume an unfinished session (e.g. after a page reload)
  const { data: open } = useQuery({
    queryKey: ["practice-open", me.id],
    enabled: !!ai?.tutor,
    queryFn: async () => {
      const { data } = await supabase
        .from("practice_sessions")
        .select("id, last_activity_at")
        .eq("student_id", me.id)
        .is("ended_at", null)
        .gte("last_activity_at", new Date(Date.now() - 25 * 60_000).toISOString())
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) return null;
      const { data: t } = await supabase.from("practice_turns").select("role, content").eq("session_id", data.id).order("id");
      if (!t?.length) return null;
      return { id: data.id as string, turns: t as ChatTurn[] };
    },
  });
  const session = local ?? (!dismissed && !lessonParam && open ? open : null);
  const sessionId = session?.id ?? null;
  const turns = session?.turns ?? [];
  const setTurns = (fn: (t: ChatTurn[]) => ChatTurn[]) => setLocal((cur) => {
    const base = cur ?? session;
    return base ? { id: base.id, turns: fn(base.turns) } : cur;
  });
  const left = leftOverride ?? ai?.tutor_messages_left ?? null;

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, streaming]);
  useEffect(() => () => abort.current?.abort(), []);

  const start = useMutation({
    mutationFn: (mode: Mode) => callFunction<{ session_id: string; greeting: string; messages_left: number }>("ai-tutor", { action: "start", mode, lesson_id: mode === "lesson" ? lessonParam ?? undefined : undefined }),
    onSuccess: (r) => {
      setLocal({ id: r.session_id, turns: [{ role: "assistant", content: r.greeting }] });
      setLeft(r.messages_left);
      setSummary(undefined);
      setFlagged(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const end = useMutation({
    mutationFn: () => callFunction<{ summary: PracticeSummary | null }>("ai-tutor", { action: "end", session_id: sessionId }),
    onSuccess: (r) => {
      setSummary(r.summary);
      qc.invalidateQueries({ queryKey: ["practice-history", me.id] });
      qc.invalidateQueries({ queryKey: ["mistakes", me.id] });
      qc.invalidateQueries({ queryKey: ["practice-open", me.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const send = async () => {
    const msg = text.trim();
    if (!msg || !sessionId || streaming !== null) return;
    setText("");
    setTurns((t) => [...t, { role: "user", content: msg }]);
    setStreaming("");
    abort.current = new AbortController();
    let acc = "";
    try {
      await streamFunction("ai-tutor", { action: "message", session_id: sessionId, text: msg }, (ev) => {
        if (ev.type === "delta") {
          acc += String(ev.text ?? "");
          setStreaming(acc);
        } else if (ev.type === "done") {
          setLeft(Number(ev.messages_left ?? 0));
          if (ev.flagged) setFlagged(true);
        } else if (ev.type === "error") {
          throw new Error(String(ev.message));
        }
      }, abort.current.signal);
      setTurns((t) => [...t, { role: "assistant", content: acc || "…" }]);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        toast.error(e instanceof Error ? e.message : "Не вдалося надіслати");
        if (!acc) setText(msg);
        setTurns((t) => (acc ? [...t, { role: "assistant", content: acc }] : t.slice(0, -1)));
      }
    } finally {
      setStreaming(null);
      qc.invalidateQueries({ queryKey: ["ai-features"] });
    }
  };

  if (aiLoading) return <Skeleton className="h-96" />;
  if (!ai?.tutor) {
    return <EmptyState title="Практика з Сілі ще недоступна" text="ШІ-тренер запускається поступово. Коли його увімкнуть для твоєї групи, він з'явиться тут." emotion="sleepy" />;
  }

  const chatting = sessionId && summary === undefined;

  return (
    <div>
      <PageHeader
        title="Практика з Сілі"
        description="Тренуй англійську між уроками — на матеріалі своїх уроків і помилок."
        actions={left != null && <Badge tone={left > 5 ? "seal" : "coral"}>Сьогодні ще {left} повідомлень</Badge>}
      />
      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <Card className="flex min-h-[32rem] flex-col overflow-hidden">
          {!sessionId ? (
            <div className="grid gap-5 p-5 sm:p-6">
              <div className="flex items-center gap-4">
                <div className="w-24 shrink-0"><Seal crop="head" emotion="happy" idle /></div>
                <div>
                  <h2 className="font-display text-lg font-semibold">Про що потренуємося?</h2>
                  <p className="text-sm text-ink-soft">Сілі відповідає англійською під твій рівень і м&apos;яко виправляє помилки.</p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    disabled={start.isPending || left === 0}
                    onClick={() => start.mutate(m.value)}
                    className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-white p-4 text-left transition hover:border-seal-300 hover:shadow-soft disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-seal-100 text-seal-700"><m.icon className="size-5" /></span>
                    <span>
                      <span className="block font-semibold">{m.title}</span>
                      <span className="block text-sm text-mute">{m.text}</span>
                    </span>
                  </button>
                ))}
              </div>
              <PrivacyNote />
            </div>
          ) : (
            <>
              <div className="flex-1 space-y-3 overflow-y-auto p-4 sm:p-5" aria-live="polite" aria-label="Розмова з Сілі">
                {turns.map((t, i) => <Bubble key={i} role={t.role} text={t.content} />)}
                {streaming !== null && <Bubble role="assistant" text={streaming || "…"} typing />}
                {summary !== undefined && <SummaryCard summary={summary} />}
                <div ref={bottom} />
              </div>
              {flagged && (
                <div className="flex items-center gap-2 border-t border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
                  <ShieldCheck className="size-4" /> Цю розмову побачить твій викладач. Якщо тобі потрібна допомога — звернись до дорослого, якому довіряєш.
                </div>
              )}
              {chatting ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    send();
                  }}
                  className="flex items-end gap-2 border-t border-line p-3"
                >
                  <Textarea
                    aria-label="Твоє повідомлення"
                    rows={1}
                    value={text}
                    maxLength={1500}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    placeholder={left === 0 ? "Ліміт на сьогодні вичерпано" : "Write in English… (Enter — надіслати)"}
                    disabled={left === 0}
                    className="max-h-40 min-h-11 flex-1 resize-none"
                  />
                  <Button type="submit" size="icon" aria-label="Надіслати" disabled={!text.trim() || streaming !== null || left === 0} loading={streaming !== null}><Send /></Button>
                  <Button type="button" variant="outline" onClick={() => end.mutate()} loading={end.isPending} disabled={streaming !== null}>
                    <Square className="size-4" /> Завершити
                  </Button>
                </form>
              ) : (
                <div className="flex justify-center border-t border-line p-3">
                  <Button onClick={() => { setLocal(null); setDismissed(true); setSummary(undefined); }}>Нова розмова</Button>
                </div>
              )}
            </>
          )}
        </Card>
        <div className="grid content-start gap-6">
          <Card>
            <CardHeader title="Мої типові помилки" description="Сілі враховує їх у практиці" />
            <div className="p-5 sm:p-6"><MistakesProfile studentId={me.id} limit={8} compact /></div>
          </Card>
          <History />
        </div>
      </div>
    </div>
  );
}

function PrivacyNote() {
  return (
    <p className="flex items-start gap-2 rounded-2xl bg-seal-50/70 p-3 text-xs text-ink-soft">
      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-seal-600" />
      Сілі — це ШІ, а не людина. Твій викладач бачить підсумки практики, щоб краще готувати уроки. Не пиши тут особисті дані (адресу, телефон, соцмережі). Текст розмов зберігається 90 днів.
    </p>
  );
}

function Bubble({ role, text, typing }: { role: "user" | "assistant"; text: string; typing?: boolean }) {
  const mine = role === "user";
  return (
    <div className={cn("flex items-end gap-2", mine && "flex-row-reverse")}>
      {!mine && <div className="w-9 shrink-0"><Seal crop="head" emotion="happy" idle={false} /></div>}
      <div className={cn(
        "max-w-[85%] rounded-2xl px-4 py-2.5 text-[0.95rem] leading-relaxed whitespace-pre-wrap",
        mine ? "rounded-br-md bg-ocean-800 text-white" : "rounded-bl-md bg-seal-50 text-ink ring-1 ring-seal-100",
        typing && "animate-pulse",
      )}>
        {text}
      </div>
    </div>
  );
}

function SummaryCard({ summary }: { summary: PracticeSummary | null }) {
  if (!summary) return <div className="rounded-2xl bg-seal-50 p-4 text-sm text-ink-soft">Сесію завершено. Гарна робота! 🦭</div>;
  return (
    <div className="grid gap-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm">
      <div className="flex items-center gap-2 font-semibold text-emerald-800"><CheckCircle2 className="size-4" /> Підсумок сесії</div>
      <p>{summary.summary}</p>
      {summary.strengths.length > 0 && <p><b>Добре вдається:</b> {summary.strengths.join("; ")}</p>}
      {summary.mistakes.length > 0 && (
        <ul className="grid gap-1">
          {summary.mistakes.map((m, i) => (
            <li key={i}><span className="text-coral-700 line-through">{m.example}</span> → <span className="font-medium text-emerald-700">{m.correction}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function History() {
  const me = useMe();
  const { data = [] } = useQuery({
    queryKey: ["practice-history", me.id],
    queryFn: async () => {
      const { data } = await supabase.from("practice_sessions").select("*").eq("student_id", me.id).not("ended_at", "is", null).order("started_at", { ascending: false }).limit(8);
      return (data ?? []) as PracticeSession[];
    },
  });
  if (!data.length) return null;
  return (
    <Card>
      <CardHeader title="Попередні сесії" />
      <ul className="grid gap-2 p-5 sm:p-6">
        {data.map((s) => (
          <li key={s.id} className="rounded-2xl border border-line p-3 text-sm">
            <div className="flex items-center justify-between gap-2 text-xs text-mute"><span>{fmtDateTime(s.started_at)}</span><span>{s.turns} реплік</span></div>
            <div className="mt-1 line-clamp-3 text-ink-soft">{s.summary?.summary ?? s.topic ?? "Практика"}</div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ───────────────────────── teacher / staff: practice summaries (FR-15) ─────────────────────────
function TeacherPractice() {
  const me = useMe();
  const params = useSearchParams();
  const router = useRouter();
  const openId = params.get("session");
  const [filter, setFilter] = useState<"flagged" | "all">("all");
  const { data = [], isLoading } = useQuery({
    queryKey: ["practice-sessions", filter],
    queryFn: async () => {
      let q = supabase
        .from("practice_sessions")
        .select("*, student:profiles!practice_sessions_student_id_fkey(id, full_name, avatar_url, level)")
        .order("started_at", { ascending: false })
        .limit(100);
      if (filter === "flagged") q = q.eq("flagged", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as PracticeSession[];
    },
  });
  const flaggedOpen = data.filter((s) => s.flagged && !s.reviewed_at);
  const [now] = useState(() => Date.now());
  const weekly = useMemo(() => {
    const since = now - 7 * 86400_000;
    return new Set(data.filter((s) => new Date(s.started_at).getTime() > since).map((s) => s.student_id)).size;
  }, [data, now]);

  return (
    <div>
      <PageHeader
        title="Практика учнів"
        description={isStaffRole(me.role) ? "Підсумки сесій з ШІ-тренером. Зміст переписки бачить лише викладач учня." : "Що практикували ваші учні з Сілі, їхні помилки й позначені сесії"}
        actions={<Segmented value={filter} onChange={setFilter} label="Фільтр" options={[{ value: "all", label: "Усі" }, { value: "flagged", label: `Позначені${flaggedOpen.length ? ` · ${flaggedOpen.length}` : ""}` }]} />}
      />
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <div className="card p-5"><div className="font-display text-2xl font-bold text-ocean-900">{weekly}</div><div className="text-sm text-mute">учнів практикувались за 7 днів</div></div>
        <div className="card p-5"><div className="font-display text-2xl font-bold text-ocean-900">{data.length}</div><div className="text-sm text-mute">сесій у списку</div></div>
        <div className="card p-5"><div className={cn("font-display text-2xl font-bold", flaggedOpen.length ? "text-amber-600" : "text-ocean-900")}>{flaggedOpen.length}</div><div className="text-sm text-mute">позначених, не переглянуто</div></div>
      </div>
      {isLoading ? (
        <div className="grid gap-3">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-20" />)}</div>
      ) : data.length === 0 ? (
        <EmptyState title="Сесій поки немає" text="Коли учні потренуються з Сілі, тут з'являться підсумки та їхні помилки." emotion="sleepy" />
      ) : (
        <div className="grid gap-2">
          {data.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => router.replace(`/app/practice/?session=${s.id}`, { scroll: false })}
              className={cn("flex w-full cursor-pointer items-start gap-3 rounded-2xl border bg-white p-4 text-left transition hover:border-seal-300 hover:shadow-soft", s.flagged && !s.reviewed_at ? "border-amber-300" : "border-line")}
            >
              <Avatar name={s.student?.full_name} src={s.student?.avatar_url} size={38} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{s.student?.full_name}</span>
                  {s.student?.level && <Badge tone="gray">{s.student.level}</Badge>}
                  {s.flagged && <Badge tone={s.reviewed_at ? "gray" : "sun"}><Flag className="size-3" /> {s.reviewed_at ? "переглянуто" : "позначено"}</Badge>}
                  {!s.ended_at && <Badge tone="mint">триває</Badge>}
                  <span className="ml-auto text-xs text-mute">{ago(s.started_at)}</span>
                </div>
                <div className="mt-1 line-clamp-2 text-sm text-ink-soft">{s.summary?.summary ?? s.topic ?? "—"}</div>
                {s.flag_reason && <div className="mt-1 text-xs text-amber-700">{s.flag_reason}</div>}
              </div>
            </button>
          ))}
        </div>
      )}
      <SessionDialog id={openId} onClose={() => router.replace("/app/practice/", { scroll: false })} />
    </div>
  );
}

function SessionDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const me = useMe();
  const qc = useQueryClient();
  const { data: s } = useQuery({
    queryKey: ["practice-session", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from("practice_sessions").select("*, student:profiles!practice_sessions_student_id_fkey(id, full_name, avatar_url, level)").eq("id", id!).maybeSingle();
      return data as PracticeSession | null;
    },
  });
  const { data: turns = [] } = useQuery({
    queryKey: ["practice-turns", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from("practice_turns").select("*").eq("session_id", id!).order("id");
      return (data ?? []) as PracticeTurn[];
    },
  });
  const review = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("practice_sessions").update({ reviewed_by: me.id, reviewed_at: new Date().toISOString() }).eq("id", id!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Позначено як переглянуте");
      qc.invalidateQueries({ queryKey: ["practice-sessions"] });
      qc.invalidateQueries({ queryKey: ["practice-session", id] });
      qc.invalidateQueries({ queryKey: ["practice-flagged-count"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!id} onOpenChange={(v) => !v && onClose()}>
      {id && (
        <DialogContent title={s ? `Практика · ${s.student?.full_name ?? ""}` : "Практика"} description={s ? `${fmtDateTime(s.started_at)} · ${s.turns} реплік` : undefined} size="xl">
          {!s ? <Skeleton className="h-64" /> : (
            <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
              <div className="grid content-start gap-4">
                {s.flagged && (
                  <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm">
                    <div className="flex items-center gap-2 font-semibold text-amber-800"><AlertTriangle className="size-4" /> Позначена сесія</div>
                    <p className="mt-1 text-amber-900">{s.flag_reason}</p>
                    <p className="mt-2 text-xs text-amber-800">Перегляньте розмову. За потреби зв&apos;яжіться з учнем, адміністратором і батьками (рукбук, розділ 11.3).</p>
                    {!s.reviewed_at ? (
                      <Button size="sm" variant="outline" className="mt-3" onClick={() => review.mutate()} loading={review.isPending}><CheckCircle2 /> Переглянуто</Button>
                    ) : (
                      <Badge tone="mint" className="mt-3">Переглянуто {fmtDateTime(s.reviewed_at)}</Badge>
                    )}
                  </div>
                )}
                {s.summary ? (
                  <div className="grid gap-2 rounded-2xl bg-seal-50/70 p-4 text-sm">
                    <div className="font-semibold">Підсумок</div>
                    <p>{s.summary.summary}</p>
                    {s.summary.strengths.length > 0 && <p><b>Сильні сторони:</b> {s.summary.strengths.join("; ")}</p>}
                    {s.summary.vocabulary_used.length > 0 && <p><b>Лексика:</b> {s.summary.vocabulary_used.join(", ")}</p>}
                    <p><b>Залученість:</b> {{ low: "низька", medium: "середня", high: "висока" }[s.summary.engagement]}</p>
                    {s.summary.mistakes.length > 0 && (
                      <ul className="grid gap-1">
                        {s.summary.mistakes.map((m, i) => (
                          <li key={i}><Badge tone="grape">{MISTAKE_LABEL[m.category] ?? m.category}</Badge> <span className="text-coral-700 line-through">{m.example}</span> → <span className="text-emerald-700">{m.correction}</span></li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  <p className="rounded-2xl bg-seal-50/70 p-4 text-sm text-mute">{s.ended_at ? "Підсумок недоступний." : "Сесія ще триває — підсумок з'явиться після завершення."}</p>
                )}
                {s.student && <Link href={`/app/people/?student=${s.student.id}`} className="text-sm font-semibold text-seal-700 hover:underline">Профіль помилок учня →</Link>}
              </div>
              <div className="max-h-[60vh] space-y-2 overflow-y-auto rounded-2xl bg-canvas p-3">
                {turns.length === 0 ? (
                  <p className="p-4 text-center text-sm text-mute">{me.role === "teacher" ? "Текст розмови видалено (зберігається 90 днів)." : "Зміст переписки бачить лише викладач учня — менеджерам доступні підсумки."}</p>
                ) : (
                  turns.map((t) => (
                    <div key={t.id} className={cn("rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap", t.role === "user" ? "ml-8 bg-ocean-800 text-white" : "mr-8 bg-white ring-1 ring-line", t.flagged && "ring-2 ring-amber-400")}>
                      {t.content}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}

export default function PracticePage() {
  return (
    <Suspense>
      <PracticeInner />
    </Suspense>
  );
}
