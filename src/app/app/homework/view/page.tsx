"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import { ArrowLeft, CalendarClock, CheckCircle2, Send, Trash2, Users, UserRound, RotateCcw, Star, Sparkles, Pencil, X, Loader2 } from "lucide-react";
import { useMe, isStaffRole } from "@/components/app/session";
import { EmptyState } from "@/components/app/AppShell";
import { AttachmentList, FilePicker, uploadFiles } from "@/components/app/files";
import { Seal } from "@/components/mascot/Seal";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { Avatar, Badge, Card, CardHeader, Skeleton } from "@/components/ui/misc";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { callFunction, supabase } from "@/lib/supabase";
import { ASSIGNMENT_SELECT, targetLabel, useAiFeatures } from "@/lib/queries";
import { fmtDateTime, toDateInput } from "@/lib/dates";
import { MISTAKE_LABEL, SUBMISSION_STATUS, type Assignment, type Attachment, type Profile, type Submission, type SubmissionAiReview } from "@/lib/types";
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
  const [editing, setEditing] = useState(false);

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
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}><Pencil /> Змінити</Button>
              <Button variant="ghost" size="sm" className="text-red-600" onClick={() => confirm("Видалити завдання разом з усіма роботами учнів?") && remove.mutate()}>
                <Trash2 /> Видалити
              </Button>
            </div>
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
      {editing && <EditAssignmentDialog a={a} onClose={() => setEditing(false)} />}
    </div>
  );
}

function EditAssignmentDialog({ a, onClose }: { a: Assignment; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(a.title);
  const [description, setDescription] = useState(a.description ?? "");
  const [due, setDue] = useState(a.due_at ? `${toDateInput(new Date(a.due_at))}T${new Date(a.due_at).toTimeString().slice(0, 5)}` : "");
  const [maxScore, setMaxScore] = useState(a.max_score);
  const [attachments, setAttachments] = useState<Attachment[]>(a.attachments ?? []);
  const [files, setFiles] = useState<File[]>([]);
  const me = useMe();
  const save = useMutation({
    mutationFn: async () => {
      const graded = (a.submissions ?? []).some((s) => s.score != null);
      if (graded && maxScore !== a.max_score && !confirm("Деякі роботи вже оцінено за старою шкалою. Змінити максимальний бал?")) throw new Error("Скасовано");
      const uploaded = files.length ? await uploadFiles("homework", `t/${me.id}`, files) : [];
      const { error } = await supabase.from("assignments").update({
        title: title.trim(),
        description: description.trim() || null,
        due_at: due ? new Date(due).toISOString() : null,
        max_score: maxScore,
        attachments: [...attachments, ...uploaded],
      }).eq("id", a.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Завдання оновлено");
      qc.invalidateQueries({ queryKey: ["assignment", a.id] });
      qc.invalidateQueries({ queryKey: ["assignments"] });
      onClose();
    },
    onError: (e: Error) => e.message !== "Скасовано" && toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Редагувати завдання" size="lg">
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="grid gap-5">
          <Field label="Назва"><Input value={title} onChange={(e) => setTitle(e.target.value)} required /></Field>
          <Field label="Опис завдання"><Textarea rows={5} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Дедлайн" hint="зміна дедлайну — нове нагадування"><Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
            <Field label="Максимальний бал"><Input type="number" min={1} max={100} value={maxScore} onChange={(e) => setMaxScore(Math.min(100, Math.max(1, Number(e.target.value) || 1)))} /></Field>
          </div>
          {attachments.length > 0 && (
            <ul className="grid gap-2">
              {attachments.map((f, i) => (
                <li key={f.path ?? f.name} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{f.name}</span>
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={`Прибрати ${f.name}`} onClick={() => setAttachments((c) => c.filter((_, j) => j !== i))}><X className="size-4" /></Button>
                </li>
              ))}
            </ul>
          )}
          <Field label="Додати файли"><FilePicker files={files} onChange={setFiles} /></Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Скасувати</Button>
            <Button type="submit" loading={save.isPending}>Зберегти</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
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
  const [kept, setKept] = useState<Attachment[]>(mine?.attachments ?? []);
  const [editing, setEditing] = useState(!mine);

  const submit = useMutation({
    mutationFn: async () => {
      const uploaded = files.length ? await uploadFiles("homework", `s/${me.id}/${a.id}`, files) : [];
      const attachments = [...kept, ...uploaded];
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
        {kept.length > 0 && (
          <ul className="grid gap-2">
            {kept.map((f, i) => (
              <li key={f.path ?? f.name} className="flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <Button type="button" size="icon-sm" variant="ghost" aria-label={`Прибрати ${f.name}`} onClick={() => setKept((c) => c.filter((_, j) => j !== i))}><X className="size-4" /></Button>
              </li>
            ))}
          </ul>
        )}
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
  const subs = useMemo(() => a.submissions ?? [], [a.submissions]);
  const byStudent = useMemo(() => new Map(subs.map((s) => [s.student_id, s])), [subs]);
  const [active, setActive] = useState<string | null>(null);
  const done = subs.length;
  // students who left the group keep their submitted work visible to the teacher
  const people = useMemo(() => {
    const ids = new Set(roster.map((r) => r.id));
    const former = subs.filter((s) => !ids.has(s.student_id) && s.student).map((s) => ({ ...(s.student as Profile), id: s.student_id }));
    return [...roster, ...former].sort((x, y) => Number(!!byStudent.get(y.id) && byStudent.get(y.id)!.status === "submitted") - Number(!!byStudent.get(x.id) && byStudent.get(x.id)!.status === "submitted"));
  }, [roster, subs, byStudent]);

  return (
    <Card>
      <CardHeader title="Роботи учнів" description={`Здали ${done} з ${roster.length || "—"}`} />
      <div className="grid gap-2 p-5 sm:p-6">
        {people.length === 0 && <p className="text-sm text-mute">Немає учнів у цій групі.</p>}
        {people.map((st) => {
          const s = byStudent.get(st.id);
          const open = active === st.id;
          return (
            <div key={st.id} className={cn("rounded-2xl border transition", open ? "border-seal-300 bg-seal-50/40" : "border-line")}>
              <button onClick={() => setActive(open ? null : st.id)} aria-expanded={open} disabled={!s} className="flex w-full cursor-pointer items-center gap-3 p-3 text-left disabled:cursor-default">
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
  const { data: ai } = useAiFeatures();
  const [score, setScore] = useState<string>(s.score?.toString() ?? "");
  const [feedback, setFeedback] = useState(s.feedback ?? "");
  const [usedDraft, setUsedDraft] = useState(false);
  const [picked, setPicked] = useState<Record<number, boolean>>({});

  const { data: draft } = useQuery({
    queryKey: ["ai-review", s.id],
    enabled: s.status === "submitted",
    refetchInterval: (q) => ((q.state.data as SubmissionAiReview | null)?.status === "pending" ? 5000 : false),
    queryFn: async () => {
      const { data } = await supabase.from("submission_ai_reviews").select("*").eq("submission_id", s.id).maybeSingle();
      return (data as SubmissionAiReview | null) ?? null;
    },
  });
  const regenerate = useMutation({
    mutationFn: () => callFunction("ai-review", { submission_id: s.id }),
    onMutate: () => qc.setQueryData(["ai-review", s.id], (d: SubmissionAiReview | null) => (d ? { ...d, status: "pending" } : { submission_id: s.id, status: "pending", mistakes: [] })),
    onSettled: () => qc.invalidateQueries({ queryKey: ["ai-review", s.id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const applyDraft = (d: SubmissionAiReview) => {
    if (d.score != null) setScore(String(d.score));
    if (d.feedback) setFeedback(d.feedback);
    setUsedDraft(true);
    setPicked(Object.fromEntries(d.mistakes.map((_, i) => [i, true])));
  };

  const save = useMutation({
    mutationFn: async (status: "reviewed" | "needs_revision") => {
      const n = score === "" ? null : Number(score);
      if (n != null && (!Number.isInteger(n) || n < 0 || n > a.max_score)) throw new Error(`Бал має бути цілим числом від 0 до ${a.max_score}`);
      const { error } = await supabase.from("submissions").update({ status, score: n, feedback: feedback.trim() || null }).eq("id", s.id);
      if (error) throw error;
      if (draft && usedDraft) {
        await supabase.from("submission_ai_reviews").update({ status: "approved" }).eq("submission_id", s.id);
      }
      const items = (draft?.mistakes ?? []).filter((_, i) => picked[i]);
      if (items.length) {
        const { error: mErr } = await supabase.rpc("add_student_mistakes", { p_student: s.student_id, p_source: "homework", p_source_id: s.id, p_items: items });
        if (mErr) toast.error(`Помилки не додано в профіль: ${mErr.message}`);
      }
    },
    onSuccess: (_, status) => {
      toast.success(status === "reviewed" ? "Оцінку збережено" : "Відправлено на доопрацювання");
      qc.invalidateQueries({ queryKey: ["assignment", a.id] });
      qc.invalidateQueries({ queryKey: ["assignments"] });
      qc.invalidateQueries({ queryKey: ["mistakes", s.student_id] });
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid gap-4 border-t border-line p-4">
      {s.body && <p className="rounded-2xl bg-white p-4 whitespace-pre-wrap ring-1 ring-line">{s.body}</p>}
      <AttachmentList items={s.attachments} />

      {s.status === "submitted" && (draft || ai?.review) && (
        <div className="rounded-2xl border border-violet-200 bg-violet-50/50 p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-semibold text-violet-800"><Sparkles className="size-4" /> Чернетка ШІ <span className="font-normal text-violet-700/80">— бачите лише ви</span></span>
            {ai?.review && draft?.status !== "pending" && (
              <Button size="xs" variant="ghost" onClick={() => regenerate.mutate()} loading={regenerate.isPending}>{draft ? "Перегенерувати" : "Створити чернетку"}</Button>
            )}
          </div>
          {!draft ? (
            <p className="mt-2 text-mute">Чернетки ще немає.</p>
          ) : draft.status === "pending" ? (
            <p className="mt-2 flex items-center gap-2 text-violet-800"><Loader2 className="size-4 animate-spin" /> ШІ перевіряє роботу…</p>
          ) : draft.status === "failed" ? (
            <p className="mt-2 text-coral-700">{draft.error ?? "Не вдалося створити чернетку"}</p>
          ) : (
            <div className="mt-3 grid gap-3">
              <div className="flex flex-wrap items-baseline gap-3">
                {draft.score != null && <span className="font-display text-2xl font-bold text-violet-900">{draft.score}<span className="text-sm text-mute">/{a.max_score}</span></span>}
                {draft.status === "approved" && <Badge tone="mint">застосовано</Badge>}
              </div>
              {draft.feedback && <p className="whitespace-pre-wrap text-ink">{draft.feedback}</p>}
              {draft.teacher_note && <p className="rounded-xl bg-white/70 p-2.5 text-xs whitespace-pre-wrap text-ink-soft">🧑‍🏫 {draft.teacher_note}</p>}
              {draft.mistakes.length > 0 && (
                <fieldset className="grid gap-1.5">
                  <legend className="mb-1 text-xs font-semibold text-mute">Помилки → у профіль учня після збереження</legend>
                  {draft.mistakes.map((m, i) => (
                    <Checkbox
                      key={i}
                      checked={!!picked[i]}
                      onChange={(e) => setPicked((c) => ({ ...c, [i]: e.target.checked }))}
                      label={<span><Badge tone="grape">{MISTAKE_LABEL[m.category] ?? m.category}</Badge> <span className="text-coral-700 line-through">{m.example}</span> → <span className="text-emerald-700">{m.correction}</span></span>}
                    />
                  ))}
                </fieldset>
              )}
              <Button size="sm" variant="soft" className="justify-self-start" onClick={() => applyDraft(draft)}><Sparkles /> Перенести в оцінку й коментар</Button>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
        <Field label={`Бал (0–${a.max_score})`}><Input type="number" min={0} max={a.max_score} step={1} value={score} onChange={(e) => setScore(e.target.value)} /></Field>
        <Field label="Коментар для учня"><Textarea rows={usedDraft ? 5 : 2} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Great job! Watch out for articles…" /></Field>
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
