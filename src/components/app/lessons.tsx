"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CalendarPlus, Clock, ExternalLink, Repeat, Trash2, Users, Video, XCircle, UserRound, Sparkles, UserPlus, X, MessagesSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { Field, Input, Segmented, Select, Textarea, Checkbox } from "@/components/ui/form";
import { Avatar, Badge } from "@/components/ui/misc";
import { callFunction, supabase } from "@/lib/supabase";
import { countdown, fmtRelativeDay, fmtTime, isKyivZone, toDateInput } from "@/lib/dates";
import { LESSON_SELECT, targetLabel, useAiFeatures, useGroups, usePeople } from "@/lib/queries";
import { GROUP_COLORS, LEAD_STATUS, type AttendanceStatus, type Lead, type Lesson, type Profile } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useMe, isStaffRole } from "./session";
import { LessonSummaryEditor, LessonTopicsForStudent } from "./lesson-summary";

const MAX_TRIAL_LEADS = 4;

export function lessonState(l: Lesson) {
  const now = Date.now();
  const s = new Date(l.starts_at).getTime();
  const e = new Date(l.ends_at).getTime();
  if (l.status === "cancelled") return "cancelled" as const;
  if (now >= s - 15 * 60_000 && now <= e) return "live" as const;
  if (now > e) return "past" as const;
  return "upcoming" as const;
}

export function JoinButton({ lesson, size = "sm", className, compact }: { lesson: Lesson; size?: "sm" | "md" | "lg"; className?: string; /** icon-only on phones */ compact?: boolean }) {
  const st = lessonState(lesson);
  if (!lesson.meet_url || st === "cancelled" || st === "past") return null;
  return (
    <Button asChild size={size} variant={st === "live" ? "primary" : "soft"} className={cn(st === "live" && "animate-pulse", className)}>
      <a href={lesson.meet_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
        <Video /> <span className={cn(compact && "sr-only sm:not-sr-only")}>{st === "live" ? "Приєднатися" : "Meet"}</span>
      </a>
    </Button>
  );
}

export function LessonRow({ lesson, onClick, showTeacher }: { lesson: Lesson; onClick?: () => void; showTeacher?: boolean }) {
  const st = lessonState(lesson);
  const color = GROUP_COLORS[lesson.group?.color ?? (lesson.kind === "trial" ? "coral" : "sky")] ?? GROUP_COLORS.sky;
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "group flex items-center gap-3 rounded-2xl border border-line bg-white p-3 transition sm:gap-4 sm:p-3.5",
        onClick && "cursor-pointer hover:border-seal-300 hover:shadow-soft",
        st === "cancelled" && "opacity-55",
      )}
    >
      <div className={cn("flex w-14 shrink-0 flex-col sm:w-16 items-center rounded-xl py-2", color.soft)}>
        <span className={cn("font-display text-sm font-bold", color.text)}>{fmtTime(lesson.starts_at)}</span>
        <span className="text-[11px] text-mute">{fmtTime(lesson.ends_at)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn("truncate font-semibold text-ink", st === "cancelled" && "line-through")}>
            {lesson.title ?? (lesson.kind === "trial" ? "Пробний урок" : "Урок англійської")}
          </span>
          {lesson.kind === "trial" && <Badge tone="coral">Пробний{(lesson.lesson_leads?.length ?? 0) > 1 ? ` · ${lesson.lesson_leads!.length}` : ""}</Badge>}
          {st === "live" && <Badge tone="mint">Зараз</Badge>}
          {st === "cancelled" && <Badge tone="gray">Скасовано</Badge>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-mute">
          <span className="flex min-w-0 items-center gap-1">{lesson.group ? <Users className="size-3.5 shrink-0" /> : <UserRound className="size-3.5 shrink-0" />}<span className="truncate">{targetLabel(lesson)}</span></span>
          {showTeacher && lesson.teacher && <span>· {lesson.teacher.full_name}</span>}
          {lesson.topic && <span className="truncate">· {lesson.topic}</span>}
          {st === "upcoming" && <span className="text-seal-700">· {countdown(lesson.starts_at)}</span>}
        </div>
      </div>
      <JoinButton lesson={lesson} compact className="shrink-0" />
    </div>
  );
}

// ───────────────────────── create lesson ─────────────────────────
const WEEKDAYS = [
  { v: 1, l: "Пн" }, { v: 2, l: "Вт" }, { v: 3, l: "Ср" }, { v: 4, l: "Чт" }, { v: 5, l: "Пт" }, { v: 6, l: "Сб" }, { v: 7, l: "Нд" },
];

type LeadLite = Pick<Lead, "id" | "name">;

export function NewLessonDialog({
  open, onOpenChange, lead, defaultDate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** a trial lesson for this lead: new mini-group or joining an existing trial */
  lead?: LeadLite | null;
  defaultDate?: Date;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent
          title={lead ? `Пробний урок · ${lead.name}` : "Новий урок"}
          description={`Посилання на Google Meet створиться автоматично.${isKyivZone() ? "" : " Час — за Києвом."}`}
          size="lg"
        >
          {lead ? <TrialForm lead={lead} defaultDate={defaultDate} onDone={() => onOpenChange(false)} /> : <NewLessonForm defaultDate={defaultDate} onDone={() => onOpenChange(false)} />}
        </DialogContent>
      )}
    </Dialog>
  );
}

function useCreateLesson(onDone: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      callFunction<{ created: number; meet: boolean; google_connected: boolean; google_error: string | null }>("schedule", { action: "create", ...body }),
    onSuccess: (r) => {
      toast.success(r.created > 1 ? `Створено ${r.created} уроків` : "Урок створено", {
        description: r.google_error
          ? `Google Meet: ${r.google_error}`
          : r.meet
            ? "Посилання на Google Meet додано ✨"
            : !r.google_connected
              ? "Google не підключено — посилання на Meet не створено"
              : undefined,
      });
      qc.invalidateQueries({ queryKey: ["lessons"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["lead"] });
      qc.invalidateQueries({ queryKey: ["trial-slots"] });
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

function DateTimeFields({ date, setDate, time, setTime, duration, setDuration, durations }: {
  date: string; setDate: (v: string) => void; time: string; setTime: (v: string) => void;
  duration: number; setDuration: (v: number) => void; durations: number[];
}) {
  return (
    <div className="grid gap-5 sm:grid-cols-3">
      <Field label="Дата"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
      <Field label="Початок"><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} step={300} required /></Field>
      <Field label="Тривалість">
        <Select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
          {durations.map((d) => <option key={d} value={d}>{d} хв</option>)}
        </Select>
      </Field>
    </div>
  );
}

function NewLessonForm({ defaultDate, onDone }: { defaultDate?: Date; onDone: () => void }) {
  const me = useMe();
  const staff = isStaffRole(me.role);
  const { data: groups = [] } = useGroups();
  const { data: students = [] } = usePeople(["student"]);
  const { data: teachers = [] } = usePeople(["teacher", "manager", "admin"]);

  const [targetType, setTargetType] = useState<"group" | "student">("group");
  const [targetId, setTargetId] = useState<string>("");
  const [teacherId, setTeacherId] = useState<string>(me.id);
  const [date, setDate] = useState(toDateInput(defaultDate ?? new Date()));
  const [time, setTime] = useState(defaultDate && defaultDate.getHours() > 0 ? fmtTime(defaultDate) : "18:00");
  const [duration, setDuration] = useState(60);
  const [repeat, setRepeat] = useState(false);
  const [weeks, setWeeks] = useState(8);
  const [days, setDays] = useState<number[]>([]);
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [invites, setInvites] = useState(false);

  const myGroups = useMemo(() => (staff ? groups : groups.filter((g) => g.teacher_id === me.id)), [groups, staff, me.id]);
  const create = useCreateLesson(onDone);

  const targetOptions =
    targetType === "group"
      ? myGroups.map((g) => ({ id: g.id, label: `${g.name}${g.level ? ` · ${g.level}` : ""}` }))
      : students.filter((s) => s.is_active).map((s) => ({ id: s.id, label: s.full_name }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!targetId) return toast.error("Оберіть, для кого урок");
        create.mutate({
          teacher_id: teacherId,
          target: { type: targetType, id: targetId },
          date, time,
          duration_min: duration,
          repeat_weeks: repeat ? weeks : 0,
          weekdays: repeat && days.length ? days : undefined,
          title: title || undefined,
          topic: topic || undefined,
          send_invites: invites,
        });
      }}
      className="grid gap-5"
    >
      <Field label="Для кого">
        <Segmented
          value={targetType}
          onChange={(v) => {
            setTargetType(v);
            setTargetId("");
            setDuration(v === "student" ? 50 : 60);
          }}
          options={[
            { value: "group", label: "Група" },
            { value: "student", label: "Учень (індивідуально)" },
          ]}
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={targetType === "group" ? "Група" : "Учень"}>
          <Select
            value={targetId}
            onChange={(e) => {
              setTargetId(e.target.value);
              const g = targetType === "group" ? groups.find((x) => x.id === e.target.value) : null;
              if (staff && g?.teacher_id) setTeacherId(g.teacher_id);
            }}
            required
          >
            <option value="">Оберіть…</option>
            {targetOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </Select>
        </Field>
        {staff && (
          <Field label="Викладач">
            <Select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
              {teachers.filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
            </Select>
          </Field>
        )}
      </div>
      <DateTimeFields date={date} setDate={setDate} time={time} setTime={setTime} duration={duration} setDuration={setDuration} durations={[30, 40, 45, 50, 60, 75, 90, 120]} />
      <div className="rounded-2xl border border-line bg-seal-50/50 p-4">
        <Checkbox checked={repeat} onChange={(e) => setRepeat(e.target.checked)} label={<span className="flex items-center gap-1.5 font-semibold text-ink"><Repeat className="size-4 text-seal-600" /> Повторювати щотижня</span>} />
        {repeat && (
          <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_8rem]">
            <Field label="Дні тижня" hint="за замовчуванням — день першого уроку">
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Дні тижня">
                {WEEKDAYS.map((d) => (
                  <button
                    type="button"
                    key={d.v}
                    aria-pressed={days.includes(d.v)}
                    onClick={() => setDays((cur) => (cur.includes(d.v) ? cur.filter((x) => x !== d.v) : [...cur, d.v]))}
                    className={cn(
                      "size-10 cursor-pointer rounded-xl text-sm font-semibold transition",
                      days.includes(d.v) ? "bg-ocean-800 text-white" : "bg-white text-ink-soft shadow-soft hover:bg-seal-100",
                    )}
                  >
                    {d.l}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Тижнів">
              <Input type="number" min={1} max={52} value={weeks} onChange={(e) => setWeeks(Math.min(52, Math.max(1, Number(e.target.value) || 1)))} />
            </Field>
          </div>
        )}
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Назва" hint="необов'язково"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Англійська · Teens B1" /></Field>
        <Field label="Тема уроку" hint="необов'язково"><Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Present Perfect in stories" /></Field>
      </div>
      <Checkbox checked={invites} onChange={(e) => setInvites(e.target.checked)} label="Надіслати запрошення в Google Calendar учасникам" />
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onDone}>Скасувати</Button>
        <Button type="submit" loading={create.isPending}><CalendarPlus /> Створити</Button>
      </div>
    </form>
  );
}

// ───────────────────────── trial: new mini-group or join an existing one (FR-26) ─────────────────────────
function useTrialSlots() {
  return useQuery({
    queryKey: ["trial-slots"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lessons")
        .select(LESSON_SELECT)
        .eq("kind", "trial")
        .eq("status", "scheduled")
        .gte("ends_at", new Date().toISOString())
        .order("starts_at")
        .limit(30);
      if (error) throw error;
      return (data ?? []) as Lesson[];
    },
  });
}

function TrialForm({ lead, defaultDate, onDone }: { lead: LeadLite; defaultDate?: Date; onDone: () => void }) {
  const qc = useQueryClient();
  const me = useMe();
  const { data: slots = [] } = useTrialSlots();
  const { data: teachers = [] } = usePeople(["teacher", "manager", "admin"]);
  const { data: waiting = [] } = useQuery({
    queryKey: ["leads", "waiting-trial"],
    queryFn: async () => {
      const { data } = await supabase.from("leads").select("id, name, age_group, level, level_estimate").in("status", ["new", "contacted"]).order("created_at").limit(50);
      return (data ?? []) as (LeadLite & { age_group: string | null; level: string | null; level_estimate: string | null })[];
    },
  });
  const open = slots.filter((s) => (s.lesson_leads?.length ?? 0) < MAX_TRIAL_LEADS && !s.lesson_leads?.some((l) => l.lead_id === lead.id));
  const [mode, setMode] = useState<"new" | "join">("new");
  const [teacherId, setTeacherId] = useState(me.id);
  const [date, setDate] = useState(toDateInput(defaultDate ?? new Date()));
  const [time, setTime] = useState("18:00");
  const [duration, setDuration] = useState(60);
  const [extra, setExtra] = useState<string[]>([]);
  const [slot, setSlot] = useState("");
  const create = useCreateLesson(onDone);
  const join = useMutation({
    mutationFn: () => callFunction("schedule", { action: "add_lead", lesson_id: slot, lead_id: lead.id }),
    onSuccess: () => {
      toast.success("Заявку додано до пробного уроку");
      qc.invalidateQueries({ queryKey: ["lessons"] });
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["lead"] });
      qc.invalidateQueries({ queryKey: ["trial-slots"] });
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const others = waiting.filter((l) => l.id !== lead.id);

  return (
    <div className="grid gap-5">
      <Segmented
        value={mode}
        onChange={setMode}
        label="Спосіб призначення"
        options={[{ value: "new", label: "Новий пробний урок" }, { value: "join", label: `Додати до наявного${open.length ? ` · ${open.length}` : ""}` }]}
      />
      {mode === "new" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ teacher_id: teacherId, target: { type: "leads", ids: [lead.id, ...extra] }, date, time, duration_min: duration });
          }}
          className="grid gap-5"
        >
          <p className="rounded-2xl bg-seal-50 p-3 text-sm text-ink-soft">
            Пробний у міні-групі до {MAX_TRIAL_LEADS} заявок (60 хв) дешевший для школи, ніж індивідуальний (30 хв). Статус кожної заявки ведеться окремо.
          </p>
          <Field label="Викладач">
            <Select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
              {teachers.filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
            </Select>
          </Field>
          <DateTimeFields date={date} setDate={setDate} time={time} setTime={setTime} duration={duration} setDuration={setDuration} durations={[30, 40, 45, 60]} />
          {others.length > 0 && (
            <Field label="Запросити інших у цю міні-групу" hint={`до ${MAX_TRIAL_LEADS - 1} заявок`}>
              <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
                {others.map((l) => {
                  const on = extra.includes(l.id);
                  const full = !on && extra.length >= MAX_TRIAL_LEADS - 1;
                  return (
                    <button
                      type="button"
                      key={l.id}
                      disabled={full}
                      aria-pressed={on}
                      onClick={() => {
                        setExtra((c) => (on ? c.filter((x) => x !== l.id) : [...c, l.id]));
                        if (!on && duration < 60) setDuration(60);
                      }}
                      className={cn("cursor-pointer rounded-full px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40", on ? "bg-ocean-800 text-white" : "bg-seal-50 text-ink-soft hover:bg-seal-100")}
                    >
                      {l.name}{l.level_estimate ?? l.level ? ` · ${l.level_estimate ?? l.level}` : ""}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onDone}>Скасувати</Button>
            <Button type="submit" loading={create.isPending}><CalendarPlus /> Призначити{extra.length ? ` (${extra.length + 1})` : ""}</Button>
          </div>
        </form>
      ) : open.length === 0 ? (
        <p className="py-6 text-center text-sm text-mute">Немає запланованих пробних уроків з вільними місцями. Створіть новий.</p>
      ) : (
        <div className="grid gap-3">
          <div className="grid max-h-80 gap-2 overflow-y-auto" role="radiogroup" aria-label="Пробні уроки">
            {open.map((s) => (
              <button
                type="button"
                key={s.id}
                role="radio"
                aria-checked={slot === s.id}
                onClick={() => setSlot(s.id)}
                className={cn("flex cursor-pointer items-center gap-3 rounded-2xl border p-3 text-left transition", slot === s.id ? "border-seal-400 bg-seal-50" : "border-line hover:border-seal-300")}
              >
                <div className="w-24 shrink-0 text-sm font-semibold">{fmtRelativeDay(s.starts_at)}<div className="text-xs font-normal text-mute">{fmtTime(s.starts_at)}–{fmtTime(s.ends_at)}</div></div>
                <div className="min-w-0 flex-1 text-sm">
                  <div className="truncate font-medium">{s.teacher?.full_name}</div>
                  <div className="truncate text-xs text-mute">{(s.lesson_leads ?? []).map((l) => l.lead?.name).join(", ")}</div>
                </div>
                <Badge tone="grape">{s.lesson_leads?.length ?? 0}/{MAX_TRIAL_LEADS}</Badge>
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onDone}>Скасувати</Button>
            <Button disabled={!slot} loading={join.isPending} onClick={() => join.mutate()}><UserPlus /> Додати до уроку</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── lesson details ─────────────────────────
export function LessonDialog({ lesson, onClose }: { lesson: Lesson | null; onClose: () => void }) {
  return (
    <Dialog open={!!lesson} onOpenChange={(v) => !v && onClose()}>
      {lesson && (
        <DialogContent title={lesson.title ?? (lesson.kind === "trial" ? "Пробний урок" : "Урок англійської")} description={`${fmtRelativeDay(lesson.starts_at)}, ${fmtTime(lesson.starts_at)}–${fmtTime(lesson.ends_at)}`} size="lg">
          <LessonDetails key={lesson.id} lesson={lesson} onClose={onClose} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function LessonDetails({ lesson, onClose }: { lesson: Lesson; onClose: () => void }) {
  const me = useMe();
  const qc = useQueryClient();
  const staff = isStaffRole(me.role);
  const canEdit = staff || lesson.teacher_id === me.id;
  const { data: ai } = useAiFeatures();
  const [topic, setTopic] = useState(lesson.topic ?? "");
  const [notes, setNotes] = useState(lesson.teacher_notes ?? "");
  const [moveDate, setMoveDate] = useState(toDateInput(new Date(lesson.starts_at)));
  const [moveTime, setMoveTime] = useState(fmtTime(lesson.starts_at));
  const [duration, setDuration] = useState(Math.round((new Date(lesson.ends_at).getTime() - new Date(lesson.starts_at).getTime()) / 60000));
  const [teacherId, setTeacherId] = useState(lesson.teacher_id);
  const [scope, setScope] = useState<"this" | "following">("this");
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});
  const { data: teachers = [] } = usePeople(["teacher", "manager", "admin"]);

  const { data: roster } = useQuery({
    queryKey: ["lesson-roster", lesson.id],
    enabled: canEdit && !!(lesson.group_id || lesson.student_id),
    queryFn: async () => {
      let people: Profile[] = [];
      if (lesson.group_id) {
        const { data } = await supabase.from("group_members").select("student:profiles!group_members_student_id_fkey(*)").eq("group_id", lesson.group_id);
        people = (data ?? []).map((r: { student: unknown }) => r.student as Profile).filter(Boolean);
      } else if (lesson.student) {
        people = [lesson.student as Profile];
      }
      const { data: att } = await supabase.from("lesson_attendance").select("*").eq("lesson_id", lesson.id);
      const attendance = Object.fromEntries((att ?? []).map((x) => [x.student_id, x.status as AttendanceStatus])) as Record<string, AttendanceStatus>;
      return { people, attendance };
    },
  });
  const attendees = roster?.people ?? [];
  const attendance = { ...(roster?.attendance ?? {}), ...marks };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["lessons"] });
    qc.invalidateQueries({ queryKey: ["trial-slots"] });
  };

  const saveInfo = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("lessons").update({ topic: topic || null, teacher_notes: notes || null }).eq("id", lesson.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Збережено");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const act = useMutation({
    mutationFn: (body: Record<string, unknown>) => callFunction("schedule", { lesson_id: lesson.id, scope, ...body }),
    onSuccess: (_, body) => {
      const msg: Record<string, string> = {
        cancel: "Урок скасовано", delete: "Урок видалено", ensure_meet: "Посилання на Meet створено",
        update: "Урок оновлено", remove_lead: "Заявку знято з уроку", add_lead: "Заявку додано",
      };
      toast.success(msg[String(body.action)] ?? "Готово");
      invalidate();
      qc.invalidateQueries({ queryKey: ["leads"] });
      if (["cancel", "delete", "update"].includes(String(body.action))) onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mark = async (studentId: string, status: AttendanceStatus) => {
    setMarks((a) => ({ ...a, [studentId]: status }));
    const { error } = await supabase.from("lesson_attendance").upsert({ lesson_id: lesson.id, student_id: studentId, status });
    if (error) toast.error(error.message);
  };

  const st = lessonState(lesson);
  const changed = moveDate !== toDateInput(new Date(lesson.starts_at)) || moveTime !== fmtTime(lesson.starts_at);
  const durationChanged = duration !== Math.round((new Date(lesson.ends_at).getTime() - new Date(lesson.starts_at).getTime()) / 60000);
  const teacherChanged = teacherId !== lesson.teacher_id;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-seal-50 p-4">
        {lesson.teacher && (
          <div className="flex items-center gap-2.5">
            <Avatar name={lesson.teacher.full_name} src={lesson.teacher.avatar_url} size={34} />
            <div className="text-sm"><div className="text-xs text-mute">Викладач</div><div className="font-semibold">{lesson.teacher.full_name}</div></div>
          </div>
        )}
        <div className="min-w-0 text-sm">
          <div className="text-xs text-mute">Учасники</div>
          <div className="truncate font-semibold">{targetLabel(lesson)}</div>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {lesson.meet_url ? (
            <>
              <JoinButton lesson={lesson} size="md" />
              <Button asChild variant="outline" size="md"><a href={lesson.meet_url} target="_blank" rel="noreferrer"><ExternalLink /> Посилання</a></Button>
            </>
          ) : canEdit && st !== "cancelled" ? (
            <Button variant="soft" onClick={() => act.mutate({ action: "ensure_meet" })} loading={act.isPending && act.variables?.action === "ensure_meet"}><Sparkles /> Створити Meet</Button>
          ) : (
            <span className="text-sm text-mute">Посилання з&apos;явиться пізніше</span>
          )}
        </div>
      </div>

      {!canEdit && (
        <div className="grid gap-3 text-sm">
          {lesson.topic && <p><b>Тема:</b> {lesson.topic}</p>}
          {lesson.teacher_notes && <p className="rounded-2xl bg-white p-3 whitespace-pre-wrap ring-1 ring-line"><b>Підсумок від викладача:</b> {lesson.teacher_notes}</p>}
          {me.role === "student" && <LessonTopicsForStudent lessonId={lesson.id} />}
          {me.role === "student" && ai?.tutor && st === "past" && (
            <Button asChild variant="soft" className="justify-self-start">
              <Link href={`/app/practice/?lesson=${lesson.id}`}><MessagesSquare /> Потренуватися з Сілі за цим уроком</Link>
            </Button>
          )}
        </div>
      )}

      {canEdit && lesson.kind === "trial" && <TrialLeads lesson={lesson} staff={staff} onAct={(b) => act.mutate(b)} busy={act.isPending} />}

      {canEdit && st !== "cancelled" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Тема уроку"><Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Про що урок?" /></Field>
            <Field label="Підсумок для учнів" hint="бачать учасники"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Що вивчили, на що звернути увагу" className="min-h-11" /></Field>
          </div>
          <div className="flex justify-end"><Button variant="soft" size="sm" onClick={() => saveInfo.mutate()} loading={saveInfo.isPending}>Зберегти</Button></div>

          {attendees.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between gap-2 text-sm font-semibold text-ink-soft">
                Відвідуваність
                {st === "past" && Object.keys(attendance).length < attendees.length && <span className="text-xs font-medium text-coral-600">не всі відмічені — від цього залежить оплата уроку</span>}
              </div>
              <div className="grid gap-2">
                {attendees.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line px-3 py-2">
                    <div className="flex items-center gap-2.5 text-sm font-medium"><Avatar name={s.full_name} src={s.avatar_url} size={28} />{s.full_name}</div>
                    <Segmented
                      size="sm"
                      label={`Відвідуваність: ${s.full_name}`}
                      value={attendance[s.id] ?? ("" as AttendanceStatus)}
                      onChange={(v) => mark(s.id, v)}
                      options={[{ value: "present", label: "Був" }, { value: "late", label: "Запізнився" }, { value: "absent", label: "Не був" }]}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {lesson.kind === "regular" && (st === "past" || st === "live") && ai !== undefined && (
            <LessonSummaryEditor lesson={lesson} aiEnabled={!!ai?.lesson} onNotes={(recap) => setNotes(recap)} />
          )}

          <div className="rounded-2xl border border-line p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Clock className="size-4 text-seal-600" /> Змінити або скасувати</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Дата"><Input type="date" value={moveDate} onChange={(e) => setMoveDate(e.target.value)} /></Field>
              <Field label="Час"><Input type="time" value={moveTime} onChange={(e) => setMoveTime(e.target.value)} step={300} /></Field>
              <Field label="Тривалість">
                <Select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                  {[...new Set([30, 40, 45, 50, 60, 75, 90, 120, duration])].sort((a, b) => a - b).map((d) => <option key={d} value={d}>{d} хв</option>)}
                </Select>
              </Field>
              {staff && (
                <Field label="Викладач" className="sm:col-span-3">
                  <Select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
                    {!teachers.some((t) => t.id === lesson.teacher_id) && <option value={lesson.teacher_id}>{lesson.teacher?.full_name ?? "Поточний викладач"}</option>}
                    {teachers.filter((t) => t.is_active || t.id === lesson.teacher_id).map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                  </Select>
                </Field>
              )}
            </div>
            {lesson.series_id && (
              <div className="mt-3">
                <Segmented
                  size="sm"
                  label="Які уроки серії змінити"
                  value={scope}
                  onChange={setScope}
                  options={[{ value: "this", label: "Лише цей урок" }, { value: "following", label: "Цей і наступні в серії" }]}
                />
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!changed && !durationChanged && !teacherChanged}
                onClick={() => act.mutate({
                  action: "update",
                  ...(changed ? { date: moveDate, time: moveTime } : {}),
                  ...(durationChanged ? { duration_min: duration } : {}),
                  ...(teacherChanged ? { teacher_id: teacherId } : {}),
                })}
                loading={act.isPending && act.variables?.action === "update"}
              >
                Зберегти зміни
              </Button>
              <Button variant="ghost" size="sm" className="text-coral-700" onClick={() => confirm("Скасувати урок? Учасники отримають сповіщення.") && act.mutate({ action: "cancel" })}>
                <XCircle /> Скасувати урок
              </Button>
              {staff && (
                <Button variant="ghost" size="sm" className="text-red-600" onClick={() => confirm("Видалити урок назавжди? Відвідуваність і підсумок уроку теж зникнуть.") && act.mutate({ action: "delete" })}>
                  <Trash2 /> Видалити
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function TrialLeads({ lesson, staff, onAct, busy }: { lesson: Lesson; staff: boolean; onAct: (b: Record<string, unknown>) => void; busy: boolean }) {
  const qc = useQueryClient();
  const [local, setLocal] = useState<Record<string, boolean | null>>({});
  const [adding, setAdding] = useState("");
  const leads = lesson.lesson_leads ?? [];
  const st = lessonState(lesson);
  const { data: waiting = [] } = useQuery({
    queryKey: ["leads", "waiting-trial"],
    enabled: staff && st !== "past" && st !== "cancelled" && leads.length < MAX_TRIAL_LEADS,
    queryFn: async () => {
      const { data } = await supabase.from("leads").select("id, name, level, level_estimate").in("status", ["new", "contacted"]).order("created_at").limit(50);
      return (data ?? []) as (LeadLite & { level: string | null; level_estimate: string | null })[];
    },
  });

  const setAttended = async (leadId: string, attended: boolean) => {
    setLocal((c) => ({ ...c, [leadId]: attended }));
    const { error } = await supabase.from("lesson_leads").update({ attended }).eq("lesson_id", lesson.id).eq("lead_id", leadId);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["lessons"] });
    qc.invalidateQueries({ queryKey: ["leads"] });
  };

  return (
    <div className="rounded-2xl border border-line p-4">
      <div className="mb-3 flex items-center justify-between gap-2 text-sm font-semibold">
        <span>Учасники пробного · {leads.length}/{MAX_TRIAL_LEADS}</span>
        {st === "past" && <span className="text-xs font-medium text-mute">відмітьте, хто прийшов — статус заявки оновиться</span>}
      </div>
      <ul className="grid gap-2">
        {leads.map((l) => {
          const attended = l.lead_id in local ? local[l.lead_id] : l.attended;
          return (
            <li key={l.lead_id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-seal-50/60 px-3 py-2">
              <div className="min-w-0 flex-1">
                {staff ? (
                  <Link href={`/app/leads/?id=${l.lead_id}`} className="font-semibold hover:underline">{l.lead?.name ?? "Заявка"}</Link>
                ) : (
                  <span className="font-semibold">{l.lead?.name ?? "Заявка"}</span>
                )}
                {l.lead?.status && <Badge tone={LEAD_STATUS[l.lead.status].tone} className="ml-2">{LEAD_STATUS[l.lead.status].label}</Badge>}
              </div>
              {(st === "past" || st === "live") && (
                <Segmented
                  size="sm"
                  label={`Чи був на пробному: ${l.lead?.name ?? ""}`}
                  value={attended == null ? ("" as "yes" | "no") : attended ? "yes" : "no"}
                  onChange={(v) => setAttended(l.lead_id, v === "yes")}
                  options={[{ value: "yes", label: "Був" }, { value: "no", label: "Не був" }]}
                />
              )}
              {staff && st === "upcoming" && (
                <Button size="icon-sm" variant="ghost" className="text-mute hover:text-red-600" aria-label="Зняти з уроку" disabled={busy}
                  onClick={() => confirm(`Зняти ${l.lead?.name ?? "заявку"} з цього пробного?`) && onAct({ action: "remove_lead", lead_id: l.lead_id })}>
                  <X className="size-4" />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {staff && st === "upcoming" && leads.length < MAX_TRIAL_LEADS && waiting.length > 0 && (
        <div className="mt-3 flex gap-2">
          <div className="flex-1">
            <Select value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Додати заявку до пробного">
              <option value="">Додати заявку…</option>
              {waiting.filter((w) => !leads.some((l) => l.lead_id === w.id)).map((w) => (
                <option key={w.id} value={w.id}>{w.name}{w.level_estimate ?? w.level ? ` · ${w.level_estimate ?? w.level}` : ""}</option>
              ))}
            </Select>
          </div>
          <Button disabled={!adding || busy} onClick={() => { onAct({ action: "add_lead", lead_id: adding }); setAdding(""); }}><UserPlus /> Додати</Button>
        </div>
      )}
      {lesson.status === "scheduled" && st === "past" && leads.some((l) => (l.lead_id in local ? local[l.lead_id] : l.attended) == null) && (
        <p className="mt-2 text-xs text-coral-600">Оплата пробного міні-групи рахується за тими, хто прийшов.</p>
      )}
    </div>
  );
}
