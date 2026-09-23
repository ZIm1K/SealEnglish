"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarPlus, Clock, ExternalLink, Repeat, Trash2, Users, Video, XCircle, UserRound, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { Field, Input, Segmented, Select, Textarea, Checkbox } from "@/components/ui/form";
import { Avatar, Badge } from "@/components/ui/misc";
import { callFunction, supabase } from "@/lib/supabase";
import { countdown, fmtRelativeDay, fmtTime, isKyivZone, toDateInput } from "@/lib/dates";
import { targetLabel, useGroups, usePeople } from "@/lib/queries";
import { GROUP_COLORS, type AttendanceStatus, type Lead, type Lesson, type Profile } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useMe, isStaffRole } from "./session";

export function lessonState(l: Lesson) {
  const now = Date.now();
  const s = new Date(l.starts_at).getTime();
  const e = new Date(l.ends_at).getTime();
  if (l.status === "cancelled") return "cancelled" as const;
  if (now >= s - 15 * 60_000 && now <= e) return "live" as const;
  if (now > e) return "past" as const;
  return "upcoming" as const;
}

export function JoinButton({ lesson, size = "sm", className }: { lesson: Lesson; size?: "sm" | "md" | "lg"; className?: string }) {
  const st = lessonState(lesson);
  if (!lesson.meet_url || st === "cancelled" || st === "past") return null;
  return (
    <Button asChild size={size} variant={st === "live" ? "primary" : "soft"} className={cn(st === "live" && "animate-pulse", className)}>
      <a href={lesson.meet_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
        <Video /> {st === "live" ? "Приєднатися" : "Meet"}
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
      onKeyDown={(e) => e.key === "Enter" && onClick?.()}
      className={cn(
        "group flex items-center gap-4 rounded-2xl border border-line bg-white p-3.5 transition",
        onClick && "cursor-pointer hover:border-seal-300 hover:shadow-soft",
        st === "cancelled" && "opacity-55",
      )}
    >
      <div className={cn("flex w-16 shrink-0 flex-col items-center rounded-xl py-2", color.soft)}>
        <span className={cn("font-display text-sm font-bold", color.text)}>{fmtTime(lesson.starts_at)}</span>
        <span className="text-[11px] text-mute">{fmtTime(lesson.ends_at)}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn("truncate font-semibold text-ink", st === "cancelled" && "line-through")}>
            {lesson.title ?? (lesson.kind === "trial" ? "Пробний урок" : "Урок англійської")}
          </span>
          {lesson.kind === "trial" && <Badge tone="coral">Пробний</Badge>}
          {st === "live" && <Badge tone="mint">Зараз</Badge>}
          {st === "cancelled" && <Badge tone="gray">Скасовано</Badge>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-mute">
          <span className="flex items-center gap-1">{lesson.group ? <Users className="size-3.5" /> : <UserRound className="size-3.5" />}{targetLabel(lesson)}</span>
          {showTeacher && lesson.teacher && <span>· {lesson.teacher.full_name}</span>}
          {lesson.topic && <span className="truncate">· {lesson.topic}</span>}
          {st === "upcoming" && <span className="text-seal-700">· {countdown(lesson.starts_at)}</span>}
        </div>
      </div>
      <JoinButton lesson={lesson} />
    </div>
  );
}

// ───────────────────────── create lesson ─────────────────────────
const WEEKDAYS = [
  { v: 1, l: "Пн" }, { v: 2, l: "Вт" }, { v: 3, l: "Ср" }, { v: 4, l: "Чт" }, { v: 5, l: "Пт" }, { v: 6, l: "Сб" }, { v: 7, l: "Нд" },
];

export function NewLessonDialog({
  open, onOpenChange, lead, defaultDate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lead?: Pick<Lead, "id" | "name"> | null;
  defaultDate?: Date;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={lead ? `Пробний урок · ${lead.name}` : "Новий урок"}
        description={`Посилання на Google Meet створиться автоматично.${isKyivZone() ? "" : " Час — за Києвом."}`}
        size="lg"
      >
        <NewLessonForm lead={lead} defaultDate={defaultDate} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function NewLessonForm({ lead, defaultDate, onDone }: { lead?: Pick<Lead, "id" | "name"> | null; defaultDate?: Date; onDone: () => void }) {
  const me = useMe();
  const staff = isStaffRole(me.role);
  const qc = useQueryClient();
  const { data: groups = [] } = useGroups();
  const { data: students = [] } = usePeople(["student"]);
  const { data: teachers = [] } = usePeople(["teacher", "manager", "admin"]);

  const [targetType, setTargetType] = useState<"group" | "student" | "lead">(lead ? "lead" : "group");
  const [targetId, setTargetId] = useState<string>(lead?.id ?? "");
  const [teacherId, setTeacherId] = useState<string>(me.id);
  const [date, setDate] = useState(toDateInput(defaultDate ?? new Date()));
  const [time, setTime] = useState(defaultDate && defaultDate.getHours() > 0 ? fmtTime(defaultDate) : "18:00");
  const [duration, setDuration] = useState(lead ? 40 : 60);
  const [repeat, setRepeat] = useState(false);
  const [weeks, setWeeks] = useState(8);
  const [days, setDays] = useState<number[]>([]);
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [invites, setInvites] = useState(false);

  const myGroups = useMemo(() => (staff ? groups : groups.filter((g) => g.teacher_id === me.id)), [groups, staff, me.id]);

  const create = useMutation({
    mutationFn: () =>
      callFunction<{ created: number; meet: boolean; google_connected: boolean; google_error: string | null }>("schedule", {
        action: "create",
        teacher_id: teacherId,
        target: { type: targetType, id: targetId },
        date,
        time,
        duration_min: duration,
        repeat_weeks: repeat ? weeks : 0,
        weekdays: repeat && days.length ? days : undefined,
        title: title || undefined,
        topic: topic || undefined,
        send_invites: invites,
      }),
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
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const targetOptions =
    targetType === "group"
      ? myGroups.map((g) => ({ id: g.id, label: `${g.name}${g.level ? ` · ${g.level}` : ""}` }))
      : targetType === "student"
        ? students.filter((s) => s.is_active).map((s) => ({ id: s.id, label: s.full_name }))
        : lead ? [{ id: lead.id, label: lead.name }] : [];

  return (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!targetId) return toast.error("Оберіть, для кого урок");
            create.mutate();
          }}
          className="grid gap-5"
        >
          {!lead && (
            <Field label="Для кого">
              <Segmented
                value={targetType}
                onChange={(v) => {
                  setTargetType(v);
                  setTargetId("");
                }}
                options={[
                  { value: "group", label: "Група" },
                  { value: "student", label: "Учень (індивідуально)" },
                ]}
              />
            </Field>
          )}
          <div className="grid gap-5 sm:grid-cols-2">
            {!lead && (
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
            )}
            {staff && (
              <Field label="Викладач">
                <Select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
                  {teachers.filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                </Select>
              </Field>
            )}
          </div>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Дата"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
            <Field label="Початок"><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} step={300} required /></Field>
            <Field label="Тривалість">
              <Select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {[30, 40, 45, 50, 60, 75, 90, 120].map((d) => <option key={d} value={d}>{d} хв</option>)}
              </Select>
            </Field>
          </div>
          {!lead && (
            <div className="rounded-2xl border border-line bg-seal-50/50 p-4">
              <Checkbox checked={repeat} onChange={(e) => setRepeat(e.target.checked)} label={<span className="flex items-center gap-1.5 font-semibold text-ink"><Repeat className="size-4 text-seal-600" /> Повторювати щотижня</span>} />
              {repeat && (
                <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_8rem]">
                  <Field label="Дні тижня" hint="за замовчуванням — день першого уроку">
                    <div className="flex flex-wrap gap-1.5">
                      {WEEKDAYS.map((d) => (
                        <button
                          type="button"
                          key={d.v}
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
                    <Input type="number" min={1} max={52} value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} />
                  </Field>
                </div>
              )}
            </div>
          )}
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
  const canEdit = isStaffRole(me.role) || lesson.teacher_id === me.id;
  const [topic, setTopic] = useState(lesson.topic ?? "");
  const [notes, setNotes] = useState(lesson.teacher_notes ?? "");
  const [moveDate, setMoveDate] = useState(toDateInput(new Date(lesson.starts_at)));
  const [moveTime, setMoveTime] = useState(fmtTime(lesson.starts_at));
  const [scope, setScope] = useState<"this" | "following">("this");
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});

  const { data: roster } = useQuery({
    queryKey: ["lesson-roster", lesson.id],
    enabled: canEdit && !!(lesson.group_id || lesson.student_id),
    queryFn: async () => {
      let people: Profile[] = [];
      if (lesson.group_id) {
        const { data } = await supabase.from("group_members").select("student:profiles!group_members_student_id_fkey(*)").eq("group_id", lesson.group_id);
        people = (data ?? []).map((r: { student: unknown }) => r.student as Profile);
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

  const invalidate = () => qc.invalidateQueries({ queryKey: ["lessons"] });

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
      toast.success(body.action === "cancel" ? "Урок скасовано" : body.action === "delete" ? "Урок видалено" : body.action === "ensure_meet" ? "Посилання на Meet створено" : "Урок перенесено");
      invalidate();
      if (body.action !== "ensure_meet") onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const mark = async (studentId: string, status: AttendanceStatus) => {
    setMarks((a) => ({ ...a, [studentId]: status }));
    const { error } = await supabase.from("lesson_attendance").upsert({ lesson_id: lesson.id, student_id: studentId, status });
    if (error) toast.error(error.message);
  };

  const st = lessonState(lesson);

  return (
        <div className="grid gap-5">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-seal-50 p-4">
            {lesson.teacher && (
              <div className="flex items-center gap-2.5">
                <Avatar name={lesson.teacher.full_name} src={lesson.teacher.avatar_url} size={34} />
                <div className="text-sm"><div className="text-xs text-mute">Викладач</div><div className="font-semibold">{lesson.teacher.full_name}</div></div>
              </div>
            )}
            <div className="text-sm">
              <div className="text-xs text-mute">Учасники</div>
              <div className="font-semibold">{targetLabel(lesson)}</div>
            </div>
            <div className="ml-auto flex gap-2">
              {lesson.meet_url ? (
                <>
                  <JoinButton lesson={lesson} size="md" />
                  <Button asChild variant="outline" size="md"><a href={lesson.meet_url} target="_blank" rel="noreferrer"><ExternalLink /> Посилання</a></Button>
                </>
              ) : canEdit && st !== "cancelled" ? (
                <Button variant="soft" onClick={() => act.mutate({ action: "ensure_meet" })} loading={act.isPending}><Sparkles /> Створити Meet</Button>
              ) : (
                <span className="text-sm text-mute">Посилання з&apos;явиться пізніше</span>
              )}
            </div>
          </div>

          {!canEdit && (lesson.topic || lesson.teacher_notes) && (
            <div className="grid gap-2 text-sm">
              {lesson.topic && <p><b>Тема:</b> {lesson.topic}</p>}
              {lesson.teacher_notes && <p className="rounded-2xl bg-white p-3 ring-1 ring-line"><b>Підсумок від викладача:</b> {lesson.teacher_notes}</p>}
            </div>
          )}

          {canEdit && st !== "cancelled" && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Тема уроку"><Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Про що урок?" /></Field>
                <Field label="Підсумок уроку" hint="бачать учасники"><Textarea rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Що вивчили, на що звернути увагу" /></Field>
              </div>
              <div className="flex justify-end"><Button variant="soft" size="sm" onClick={() => saveInfo.mutate()} loading={saveInfo.isPending}>Зберегти</Button></div>

              {attendees.length > 0 && (
                <div>
                  <div className="mb-2 text-sm font-semibold text-ink-soft">Відвідуваність</div>
                  <div className="grid gap-2">
                    {attendees.map((s) => (
                      <div key={s.id} className="flex items-center justify-between gap-3 rounded-2xl border border-line px-3 py-2">
                        <div className="flex items-center gap-2.5 text-sm font-medium"><Avatar name={s.full_name} src={s.avatar_url} size={28} />{s.full_name}</div>
                        <Segmented
                          size="sm"
                          value={attendance[s.id] ?? ("" as AttendanceStatus)}
                          onChange={(v) => mark(s.id, v)}
                          options={[{ value: "present", label: "Був" }, { value: "late", label: "Запізнився" }, { value: "absent", label: "Не був" }]}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-line p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Clock className="size-4 text-seal-600" /> Перенести або скасувати</div>
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                  <Input type="date" value={moveDate} onChange={(e) => setMoveDate(e.target.value)} />
                  <Input type="time" value={moveTime} onChange={(e) => setMoveTime(e.target.value)} step={300} />
                  <Button variant="outline" onClick={() => act.mutate({ action: "update", date: moveDate, time: moveTime })} loading={act.isPending && act.variables?.action === "update"}>Перенести</Button>
                </div>
                {lesson.series_id && (
                  <div className="mt-3">
                    <Segmented
                      size="sm"
                      value={scope}
                      onChange={setScope}
                      options={[{ value: "this", label: "Лише цей урок" }, { value: "following", label: "Цей і наступні в серії" }]}
                    />
                  </div>
                )}
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="ghost" size="sm" className="text-coral-700" onClick={() => confirm("Скасувати урок? Учасники отримають сповіщення.") && act.mutate({ action: "cancel" })}>
                    <XCircle /> Скасувати урок
                  </Button>
                  {isStaffRole(me.role) && (
                    <Button variant="ghost" size="sm" className="text-red-600" onClick={() => confirm("Видалити урок назавжди?") && act.mutate({ action: "delete" })}>
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
