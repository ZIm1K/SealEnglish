"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, CheckCircle2, ClipboardList, Plus, Sparkles, Users, UserRound } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/app/AppShell";
import { useMe, isStaffRole } from "@/components/app/session";
import { FilePicker, uploadFiles } from "@/components/app/files";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { Field, Input, Segmented, Select, Textarea } from "@/components/ui/form";
import { Badge, Skeleton } from "@/components/ui/misc";
import { callFunction, supabase } from "@/lib/supabase";
import { useAiFeatures, useAssignments, useGroups, usePeople, targetLabel } from "@/lib/queries";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { SUBMISSION_STATUS, type Assignment } from "@/lib/types";
import { cn } from "@/lib/utils";

function HomeworkInner() {
  const me = useMe();
  const params = useSearchParams();
  const router = useRouter();
  const teacherish = me.role === "teacher" || isStaffRole(me.role);
  const { data: all = [], isLoading } = useAssignments();
  const [tab, setTab] = useState<"active" | "done" | "all">("active");
  const [creating, setCreating] = useState(() => params.get("new") === "1" && teacherish);

  useEffect(() => {
    if (params.get("new") === "1") router.replace("/app/homework/");
  }, [params, router]);

  const list = useMemo(() => {
    if (me.role === "student") {
      return all.filter((a) => {
        const s = a.submissions?.find((x) => x.student_id === me.id);
        const done = s && s.status !== "needs_revision";
        return tab === "all" ? true : tab === "active" ? !done : done;
      });
    }
    const mine = isStaffRole(me.role) ? all : all.filter((a) => a.teacher_id === me.id);
    return mine.filter((a) => {
      const pending = (a.submissions ?? []).some((s) => s.status === "submitted");
      const past = a.due_at && new Date(a.due_at) < new Date();
      return tab === "all" ? true : tab === "active" ? pending || !past : !pending && past;
    });
  }, [all, me, tab]);

  return (
    <div>
      <PageHeader
        title="Домашні завдання"
        description={me.role === "student" ? "Завдання від викладачів, здача робіт і оцінки" : "Створюйте завдання й перевіряйте роботи учнів"}
        actions={
          <>
            <Segmented
              value={tab}
              onChange={setTab}
              options={
                me.role === "student"
                  ? [{ value: "active", label: "До виконання" }, { value: "done", label: "Здані" }, { value: "all", label: "Усі" }]
                  : [{ value: "active", label: "Активні" }, { value: "done", label: "Завершені" }, { value: "all", label: "Усі" }]
              }
            />
            {teacherish && <Button onClick={() => setCreating(true)}><Plus /> Нове завдання</Button>}
          </>
        }
      />
      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-32" />)}</div>
      ) : list.length === 0 ? (
        <EmptyState
          title={me.role === "student" ? (tab === "active" ? "Все виконано! 🎉" : "Тут поки порожньо") : "Завдань ще немає"}
          text={me.role === "student" ? "Нові завдання з'являться тут, а нагадування прийдуть у Telegram." : "Створіть перше завдання для групи або учня."}
          emotion={me.role === "student" && tab === "active" ? "joy" : "neutral"}
          action={teacherish ? <Button onClick={() => setCreating(true)}><Plus /> Нове завдання</Button> : undefined}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((a) => <AssignmentCard key={a.id} a={a} />)}
        </div>
      )}
      {teacherish && <NewAssignmentDialog open={creating} onOpenChange={setCreating} />}
    </div>
  );
}

function AssignmentCard({ a }: { a: Assignment }) {
  const me = useMe();
  const mine = a.submissions?.find((s) => s.student_id === me.id);
  const late = a.due_at && new Date(a.due_at) < new Date();
  const subs = a.submissions ?? [];
  const pending = subs.filter((s) => s.status === "submitted").length;
  return (
    <Link href={`/app/homework/view/?id=${a.id}`} className="card group flex flex-col p-5 transition hover:-translate-y-0.5 hover:shadow-lift">
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-10 items-center justify-center rounded-2xl bg-seal-100 text-seal-700"><ClipboardList className="size-5" /></span>
        {me.role === "student" ? (
          mine ? (
            <Badge tone={SUBMISSION_STATUS[mine.status].tone}>
              {mine.status === "reviewed" && mine.score != null ? `${mine.score}/${a.max_score}` : SUBMISSION_STATUS[mine.status].label}
            </Badge>
          ) : (
            <Badge tone={late ? "red" : "coral"}>{late ? "Прострочено" : "Не здано"}</Badge>
          )
        ) : (
          pending > 0 && <Badge tone="coral">{pending} на перевірку</Badge>
        )}
      </div>
      <h3 className="mt-4 line-clamp-2 font-display text-base font-semibold text-ocean-900 group-hover:text-seal-700">{a.title}</h3>
      {a.description && <p className="mt-1.5 line-clamp-2 text-sm text-ink-soft">{a.description}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-4 text-xs text-mute">
        <span className="flex items-center gap-1">{a.group ? <Users className="size-3.5" /> : <UserRound className="size-3.5" />}{targetLabel(a)}</span>
        {a.due_at && <span className={cn("flex items-center gap-1", late && me.role === "student" && !mine && "text-coral-600")}><CalendarClock className="size-3.5" />{fmtDateTime(a.due_at)}</span>}
        {me.role !== "student" && <span className="flex items-center gap-1"><CheckCircle2 className="size-3.5" />{subs.length} здано</span>}
      </div>
    </Link>
  );
}

function NewAssignmentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Нове домашнє завдання" description="Учні одразу отримають сповіщення" size="lg">
        <NewAssignmentForm onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function NewAssignmentForm({ onDone }: { onDone: () => void }) {
  const me = useMe();
  const staff = isStaffRole(me.role);
  const qc = useQueryClient();
  const { data: groups = [] } = useGroups();
  const { data: students = [] } = usePeople(["student"]);
  const [type, setType] = useState<"group" | "student">("group");
  const [target, setTarget] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [due, setDue] = useState("");
  const [maxScore, setMaxScore] = useState(12);
  const [files, setFiles] = useState<File[]>([]);
  const [wish, setWish] = useState("");
  const [basedOn, setBasedOn] = useState<string | null>(null);
  const { data: ai } = useAiFeatures();

  const myGroups = staff ? groups : groups.filter((g) => g.teacher_id === me.id);

  const create = useMutation({
    mutationFn: async () => {
      if (due && new Date(due).getTime() < Date.now() && !confirm("Дедлайн уже минув. Все одно створити завдання?")) throw new Error("Скасовано");
      const attachments = files.length ? await uploadFiles("homework", `t/${me.id}`, files) : [];
      const { data, error } = await supabase
        .from("assignments")
        .insert({
          title: title.trim(),
          description: description.trim() || null,
          teacher_id: me.id,
          group_id: type === "group" ? target : null,
          student_id: type === "student" ? target : null,
          due_at: due ? new Date(due).toISOString() : null,
          max_score: maxScore,
          attachments,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: () => {
      toast.success("Завдання створено", { description: "Учні отримають сповіщення в кабінеті й Telegram" });
      qc.invalidateQueries({ queryKey: ["assignments"] });
      onDone();
    },
    onError: (e: Error) => e.message !== "Скасовано" && toast.error(e.message.includes("row-level") ? "Можна задавати ДЗ лише своїм групам і учням" : e.message),
  });

  const generate = useMutation({
    mutationFn: () =>
      callFunction<{ title: string; description: string; due_at: string | null; lesson: { title: string | null; topic: string | null; starts_at: string; has_summary: boolean } }>(
        "ai-homework",
        { [type === "group" ? "group_id" : "student_id"]: target, wish: wish.trim() || undefined },
      ),
    onSuccess: (r) => {
      setTitle(r.title);
      setDescription(r.description);
      // Deadline = start of the next lesson, unless the teacher already set one.
      if (!due && r.due_at) {
        const d = new Date(r.due_at);
        setDue(new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
      }
      setBasedOn(`${r.lesson.topic || r.lesson.title || "Урок"} · ${fmtDate(r.lesson.starts_at)}${r.lesson.has_summary ? "" : " (без підсумку — лише тема)"}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const runGenerate = () => {
    if ((title.trim() || description.trim()) && !confirm("Замінити назву й опис згенерованим завданням?")) return;
    generate.mutate();
  };

  return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!target) return toast.error("Оберіть групу або учня");
            create.mutate();
          }}
          className="grid gap-5"
        >
          <div className="grid gap-5 sm:grid-cols-[auto_1fr]">
            <Field label="Кому">
              <Segmented value={type} onChange={(v) => { setType(v); setTarget(""); }} label="Кому" options={[{ value: "group", label: "Групі" }, { value: "student", label: "Учню" }]} />
            </Field>
            <Field label={type === "group" ? "Група" : "Учень"}>
              <Select value={target} onChange={(e) => { setTarget(e.target.value); setBasedOn(null); }} required>
                <option value="">Оберіть…</option>
                {type === "group"
                  ? myGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)
                  : students.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </Select>
            </Field>
          </div>
          {ai?.lesson && target && (
            <div className="grid gap-2 rounded-2xl border border-seal-200 bg-seal-50/60 p-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input value={wish} onChange={(e) => setWish(e.target.value)} maxLength={500} placeholder="Побажання (необов'язково): більше граматики, коротше…" className="bg-white" />
                <Button type="button" variant="soft" onClick={runGenerate} loading={generate.isPending}><Sparkles /> Згенерувати з минулого уроку</Button>
              </div>
              <p className="text-xs text-mute">{basedOn ? `За уроком: ${basedOn}. Перевірте й відредагуйте перед створенням.` : "ШІ складе завдання за лексикою, граматикою й помилками останнього уроку."}</p>
            </div>
          )}
          <Field label="Назва"><Input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Essay: My dream job" /></Field>
          <Field label="Опис завдання"><Textarea rows={5} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Що потрібно зробити, вимоги, посилання…" /></Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Дедлайн" hint="необов'язково"><Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
            <Field label="Максимальний бал"><Input type="number" min={1} max={100} value={maxScore} onChange={(e) => setMaxScore(Math.min(100, Math.max(1, Number(e.target.value) || 1)))} /></Field>
          </div>
          <Field label="Файли" hint="необов'язково"><FilePicker files={files} onChange={setFiles} /></Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onDone}>Скасувати</Button>
            <Button type="submit" loading={create.isPending}><Plus /> Створити</Button>
          </div>
        </form>
  );
}

export default function HomeworkPage() {
  return (
    <Suspense>
      <HomeworkInner />
    </Suspense>
  );
}
