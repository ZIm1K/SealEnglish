"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import { ArrowLeft, CalendarClock, CheckCircle2, Send, Trash2, Users, UserRound, RotateCcw, Star } from "lucide-react";
import { useMe, isStaffRole } from "@/components/app/session";
import { EmptyState } from "@/components/app/AppShell";
import { AttachmentList, FilePicker, uploadFiles } from "@/components/app/files";
import { Seal } from "@/components/mascot/Seal";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Avatar, Badge, Card, CardHeader, Skeleton } from "@/components/ui/misc";
import { supabase } from "@/lib/supabase";
import { ASSIGNMENT_SELECT, targetLabel } from "@/lib/queries";
import { fmtDateTime } from "@/lib/dates";
import { SUBMISSION_STATUS, type Assignment, type Profile, type Submission } from "@/lib/types";
import { cn } from "@/lib/utils";

function View() {
  const id = useSearchParams().get("id") ?? "";
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: a, isLoading } = useQuery({
    queryKey: ["assignment", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("assignments").select(ASSIGNMENT_SELECT).eq("id", id).maybeSingle();
      if (error) throw error;
      return data as Assignment | null;
    },
  });

  const isOwner = !!a && (a.teacher_id === me.id || isStaffRole(me.role));

  const remove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("assignments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Завдання видалено");
      qc.invalidateQueries({ queryKey: ["assignments"] });
      router.replace("/app/homework/");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <div className="grid gap-4"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-48" /></div>;
  if (!a) return <EmptyState title="Завдання не знайдено" text="Можливо, його видалили або у вас немає доступу." emotion="sad" action={<Button asChild variant="outline"><Link href="/app/homework/">До списку</Link></Button>} />;

  const late = a.due_at && new Date(a.due_at) < new Date();

  return (
    <div className="grid gap-6">
      <div>
        <Link href="/app/homework/" className="inline-flex items-center gap-1.5 text-sm font-medium text-mute hover:text-ink"><ArrowLeft className="size-4" /> Домашні завдання</Link>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-ocean-900 sm:text-3xl">{a.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-mute">
              <span className="flex items-center gap-1.5">{a.group ? <Users className="size-4" /> : <UserRound className="size-4" />}{targetLabel(a)}</span>
              {a.teacher && <span className="flex items-center gap-1.5"><Avatar name={a.teacher.full_name} size={22} />{a.teacher.full_name}</span>}
              {a.due_at && <span className={cn("flex items-center gap-1.5", late && "text-coral-600")}><CalendarClock className="size-4" />до {fmtDateTime(a.due_at)}</span>}
              <span className="flex items-center gap-1.5"><Star className="size-4" />макс. {a.max_score} б.</span>
            </div>
          </div>
          {isOwner && (
            <Button variant="ghost" size="sm" className="text-red-600" onClick={() => confirm("Видалити завдання разом з усіма роботами учнів?") && remove.mutate()}>
              <Trash2 /> Видалити
            </Button>
          )}
        </div>
      </div>

      <div className={cn("grid gap-6", !isOwner && "lg:grid-cols-[1.1fr_1fr]")}>
        <Card className="p-5 sm:p-6">
          <h2 className="font-display font-semibold">Завдання</h2>
          {a.description ? <p className="mt-3 leading-relaxed whitespace-pre-wrap text-ink-soft">{a.description}</p> : <p className="mt-3 text-sm text-mute">Без опису</p>}
          {a.attachments?.length > 0 && <div className="mt-5"><AttachmentList items={a.attachments} /></div>}
        </Card>
        {isOwner ? <ReviewPanel a={a} /> : <SubmitPanel key={submissionKey(a, me.id)} a={a} />}
      </div>
    </div>
  );
}

function submissionKey(a: Assignment, uid: string) {
  const s = a.submissions?.find((x) => x.student_id === uid);
  return s ? `${s.id}:${s.status}:${s.submitted_at}` : "new";
}

function SubmitPanel({ a }: { a: Assignment }) {
  const me = useMe();
  const qc = useQueryClient();
  const mine = a.submissions?.find((s) => s.student_id === me.id);
  const [body, setBody] = useState(mine?.body ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [editing, setEditing] = useState(!mine);

  const submit = useMutation({
    mutationFn: async () => {
      const uploaded = files.length ? await uploadFiles("homework", `s/${me.id}/${a.id}`, files) : [];
      const attachments = [...(mine?.attachments ?? []), ...uploaded];
      if (!body.trim() && attachments.length === 0) throw new Error("Додайте відповідь або файл");
      if (mine) {
        const { error } = await supabase.from("submissions").update({ body: body.trim() || null, attachments }).eq("id", mine.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("submissions").insert({ assignment_id: a.id, student_id: me.id, body: body.trim() || null, attachments });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Роботу надіслано! 🚀", { description: "Викладач отримав сповіщення" });
      confetti({ particleCount: 90, spread: 70, origin: { y: 0.7 }, colors: ["#8cc1f2", "#fb7b63", "#ffffff", "#ffd166"] });
      setFiles([]);
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["assignment", a.id] });
      qc.invalidateQueries({ queryKey: ["assignments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (mine && !editing) {
    const st = SUBMISSION_STATUS[mine.status];
    return (
      <Card className="overflow-hidden">
        <div className={cn("flex items-center gap-4 p-5 sm:p-6", mine.status === "reviewed" ? "bg-emerald-50" : mine.status === "needs_revision" ? "bg-amber-50" : "bg-seal-50")}>
          <div className="w-20 shrink-0">
            <Seal crop="head" emotion={mine.status === "reviewed" ? (mine.score != null && mine.score >= a.max_score * 0.75 ? "joy" : "happy") : mine.status === "needs_revision" ? "sad" : "neutral"} idle={false} />
          </div>
          <div>
            <Badge tone={st.tone}>{st.label}</Badge>
            {mine.score != null && (
              <div className="mt-2 font-display text-3xl font-bold text-ocean-900">{mine.score}<span className="text-base text-mute">/{a.max_score}</span></div>
            )}
            <div className="mt-1 text-xs text-mute">Здано {fmtDateTime(mine.submitted_at)}</div>
          </div>
        </div>
        <div className="grid gap-4 p-5 sm:p-6">
          {mine.feedback && (
            <div className="rounded-2xl border border-line bg-white p-4">
              <div className="text-xs font-semibold text-mute">Коментар викладача</div>
              <p className="mt-1 whitespace-pre-wrap">{mine.feedback}</p>
            </div>
          )}
          {mine.body && <p className="whitespace-pre-wrap text-ink-soft">{mine.body}</p>}
          <AttachmentList items={mine.attachments} />
          {mine.status !== "reviewed" && (
            <Button variant="outline" onClick={() => setEditing(true)}><RotateCcw /> {mine.status === "needs_revision" ? "Доопрацювати" : "Змінити відповідь"}</Button>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title={mine ? "Оновити відповідь" : "Ваша відповідь"} description="Напишіть відповідь і/або прикріпіть файли (фото зошита, документ, аудіо)" />
      <form onSubmit={(e) => { e.preventDefault(); submit.mutate(); }} className="grid gap-4 p-5 sm:p-6">
        <Textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Type your answer here…" />
        {mine?.attachments?.length ? <AttachmentList items={mine.attachments} /> : null}
        <FilePicker files={files} onChange={setFiles} />
        <div className="flex justify-end gap-2">
          {mine && <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Скасувати</Button>}
          <Button type="submit" loading={submit.isPending}><Send /> Надіслати на перевірку</Button>
        </div>
      </form>
    </Card>
  );
}

function ReviewPanel({ a }: { a: Assignment }) {
  const { data: roster = [] } = useQuery({
    queryKey: ["assignment-roster", a.id],
    queryFn: async () => {
      if (a.student_id) {
        const { data } = await supabase.from("profiles").select("id, full_name, avatar_url").eq("id", a.student_id);
        return (data ?? []) as Profile[];
      }
      const { data } = await supabase.from("group_members").select("student:profiles!group_members_student_id_fkey(id, full_name, avatar_url)").eq("group_id", a.group_id!);
      return (data ?? []).map((r: { student: unknown }) => r.student as Profile);
    },
  });
  const subs = a.submissions ?? [];
  const byStudent = useMemo(() => new Map(subs.map((s) => [s.student_id, s])), [subs]);
  const [active, setActive] = useState<string | null>(null);
  const done = subs.length;

  return (
    <Card>
      <CardHeader title="Роботи учнів" description={`Здали ${done} з ${roster.length || "—"}`} />
      <div className="grid gap-2 p-5 sm:p-6">
        {roster.length === 0 && <p className="text-sm text-mute">Немає учнів у цій групі.</p>}
        {roster.map((st) => {
          const s = byStudent.get(st.id);
          const open = active === st.id;
          return (
            <div key={st.id} className={cn("rounded-2xl border transition", open ? "border-seal-300 bg-seal-50/40" : "border-line")}>
              <button onClick={() => setActive(open ? null : st.id)} className="flex w-full cursor-pointer items-center gap-3 p-3 text-left">
                <Avatar name={st.full_name} src={st.avatar_url} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{st.full_name}</span>
                  <span className="text-xs text-mute">{s ? `Здано ${fmtDateTime(s.submitted_at)}` : "Ще не здано"}</span>
                </span>
                {s ? (
                  <Badge tone={SUBMISSION_STATUS[s.status].tone}>
                    {s.status === "reviewed" && s.score != null ? `${s.score}/${a.max_score}` : SUBMISSION_STATUS[s.status].label}
                  </Badge>
                ) : (
                  <Badge tone="gray">—</Badge>
                )}
              </button>
              {open && s && <ReviewForm a={a} s={s} onDone={() => setActive(null)} />}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ReviewForm({ a, s, onDone }: { a: Assignment; s: Submission; onDone: () => void }) {
  const qc = useQueryClient();
  const [score, setScore] = useState<string>(s.score?.toString() ?? "");
  const [feedback, setFeedback] = useState(s.feedback ?? "");
  const save = useMutation({
    mutationFn: async (status: "reviewed" | "needs_revision") => {
      const n = score === "" ? null : Number(score);
      if (n != null && (n < 0 || n > a.max_score)) throw new Error(`Бал має бути від 0 до ${a.max_score}`);
      const { error } = await supabase.from("submissions").update({ status, score: n, feedback: feedback.trim() || null }).eq("id", s.id);
      if (error) throw error;
    },
    onSuccess: (_, status) => {
      toast.success(status === "reviewed" ? "Оцінку збережено" : "Відправлено на доопрацювання");
      qc.invalidateQueries({ queryKey: ["assignment", a.id] });
      qc.invalidateQueries({ queryKey: ["assignments"] });
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="grid gap-4 border-t border-line p-4">
      {s.body && <p className="rounded-2xl bg-white p-4 whitespace-pre-wrap ring-1 ring-line">{s.body}</p>}
      <AttachmentList items={s.attachments} />
      <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <Field label={`Бал (0–${a.max_score})`}><Input type="number" min={0} max={a.max_score} value={score} onChange={(e) => setScore(e.target.value)} /></Field>
        <Field label="Коментар"><Textarea rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Great job! Watch out for articles…" /></Field>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" onClick={() => save.mutate("needs_revision")} loading={save.isPending && save.variables === "needs_revision"}><RotateCcw /> На доопрацювання</Button>
        <Button onClick={() => save.mutate("reviewed")} loading={save.isPending && save.variables === "reviewed"}><CheckCircle2 /> Зарахувати</Button>
      </div>
    </div>
  );
}

export default function HomeworkViewPage() {
  return (
    <Suspense>
      <View />
    </Suspense>
  );
}
