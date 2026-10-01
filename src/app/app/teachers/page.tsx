"use client";

import { useMemo, useState } from "react";
import { addDays } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRightLeft, CalendarClock, ClipboardCheck, GraduationCap, Repeat, Undo2, UserRound, Users, UsersRound } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/app/AppShell";
import { useMe, isStaffRole } from "@/components/app/session";
import { LessonRow } from "@/components/app/lessons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { Avatar, Badge, Skeleton } from "@/components/ui/misc";
import { callFunction, supabase } from "@/lib/supabase";
import { fetchLessons, LESSON_SELECT, useGroups, usePeople } from "@/lib/queries";
import { fmtRelativeDay, toDateInput } from "@/lib/dates";
import { ROLE_LABEL, type Group, type Lesson, type Profile } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Load {
  teacher_id: string;
  groups: number;
  students: number;
  lessons_next_14d: number;
  substitutions_next_14d: number;
  pending_reviews: number;
}

type ReassignItem = { type: "group" | "student"; id: string; to: string | null };

function useReassign(onDone?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { items: ReassignItem[]; from_date?: string }) =>
      callFunction<{ changed: number; lessons: number; homework: number }>("schedule", { action: "reassign", ...body }),
    onSuccess: (r) => {
      toast.success("Закріплення оновлено", { description: `Передано уроків: ${r.lessons}, домашніх завдань: ${r.homework}` });
      for (const k of ["groups", "people", "teacher-load", "lessons", "assignments", "teacher-lessons"]) qc.invalidateQueries({ queryKey: [k] });
      onDone?.();
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export default function TeachersPage() {
  const me = useMe();
  const staff = isStaffRole(me.role);
  const { data: people = [], isLoading } = usePeople();
  const { data: groups = [] } = useGroups();
  const { data: load = [] } = useQuery({
    queryKey: ["teacher-load"],
    enabled: staff,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("teacher_load");
      if (error) throw error;
      return (data ?? []) as Load[];
    },
  });
  const [assigning, setAssigning] = useState<Profile | null>(null);
  const [substituting, setSubstituting] = useState<Profile | null>(null);

  const loadOf = useMemo(() => new Map(load.map((l) => [l.teacher_id, l])), [load]);
  const teachers = useMemo(() => {
    const list = people.filter((p) => {
      if (p.role === "teacher") return true;
      if (p.role !== "manager" && p.role !== "admin") return false;
      const l = loadOf.get(p.id);
      return !!l && (l.groups + l.students + l.lessons_next_14d + l.pending_reviews > 0);
    });
    return list.sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.full_name.localeCompare(b.full_name, "uk"));
  }, [people, loadOf]);

  // Anyone who can teach may take over or substitute.
  const candidates = useMemo(() => people.filter((p) => p.is_active && ["teacher", "manager", "admin"].includes(p.role)), [people]);

  // Who has no teacher yet: groups without one, and students in no group and without an individual teacher.
  const inGroup = useMemo(() => new Set(groups.flatMap((g) => (g.members ?? []).map((m) => m.student.id))), [groups]);
  const orphanGroups = groups.filter((g) => !g.teacher_id);
  const orphanStudents = people.filter((p) => p.role === "student" && p.is_active && !p.teacher_id && !inGroup.has(p.id));

  if (!staff) return <EmptyState title="Розділ для менеджерів" text="Тут менеджер закріплює учнів за викладачами й призначає заміни." />;

  return (
    <div>
      <PageHeader
        title="Викладачі"
        description="Навантаження, закріплення груп і учнів, заміни на уроки та передача учнів, коли викладач іде"
      />

      {(orphanGroups.length > 0 || orphanStudents.length > 0) && (
        <Unassigned groups={orphanGroups} students={orphanStudents} teachers={candidates} />
      )}

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-48" />)}</div>
      ) : teachers.length === 0 ? (
        <EmptyState title="Викладачів ще немає" text="Додайте викладача в розділі «Учні й команда»." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {teachers.map((t) => {
            const l = loadOf.get(t.id);
            return (
              <article key={t.id} className={cn("card flex flex-col p-5", !t.is_active && "opacity-60")}>
                <div className="flex items-center gap-3">
                  <Avatar name={t.full_name} src={t.avatar_url} size={44} />
                  <div className="min-w-0">
                    <div className="truncate font-display text-lg font-semibold text-ocean-900">{t.full_name}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {t.role !== "teacher" && <Badge tone="grape">{ROLE_LABEL[t.role]}</Badge>}
                      {!t.is_active && <Badge tone="red">Деактивовано</Badge>}
                    </div>
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                  <Stat icon={<UsersRound />} label="Групи" value={l?.groups ?? 0} />
                  <Stat icon={<UserRound />} label="Індивідуальні" value={l?.students ?? 0} />
                  <Stat icon={<CalendarClock />} label="Уроків за 14 днів" value={l?.lessons_next_14d ?? 0} extra={l?.substitutions_next_14d ? `${l.substitutions_next_14d} заміни` : undefined} />
                  <Stat icon={<ClipboardCheck />} label="ДЗ на перевірку" value={l?.pending_reviews ?? 0} warn={(l?.pending_reviews ?? 0) > 0} />
                </dl>
                <div className="mt-auto flex flex-wrap gap-2 pt-5">
                  <Button size="sm" variant="soft" onClick={() => setAssigning(t)}><Users /> Учні й групи</Button>
                  <Button size="sm" variant="outline" onClick={() => setSubstituting(t)}><Repeat /> Заміна</Button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {assigning && <AssignDialog teacher={assigning} teachers={candidates} people={people} groups={groups} onClose={() => setAssigning(null)} />}
      {substituting && <SubstituteDialog teacher={substituting} teachers={candidates} onClose={() => setSubstituting(null)} />}
    </div>
  );
}

function Stat({ icon, label, value, extra, warn }: { icon: React.ReactNode; label: string; value: number; extra?: string; warn?: boolean }) {
  return (
    <div className="rounded-2xl bg-seal-50/70 px-3 py-2">
      <dt className="flex items-center gap-1.5 text-xs text-mute [&_svg]:size-3.5">{icon}{label}</dt>
      <dd className={cn("font-display text-lg font-semibold text-ocean-900", warn && "text-coral-600")}>
        {value}{extra && <span className="ml-1.5 text-xs font-normal text-violet-700">{extra}</span>}
      </dd>
    </div>
  );
}

function Unassigned({ groups, students, teachers }: { groups: Group[]; students: Profile[]; teachers: Profile[] }) {
  const [pick, setPick] = useState<Record<string, string>>({});
  const reassign = useReassign(() => setPick({}));
  const items: ReassignItem[] = Object.entries(pick).filter(([, to]) => to).map(([key, to]) => {
    const [type, id] = key.split(":") as ["group" | "student", string];
    return { type, id, to };
  });
  const row = (key: string, icon: React.ReactNode, name: string) => (
    <li key={key} className="flex flex-col gap-2 rounded-2xl border border-line bg-white px-3 py-2 sm:flex-row sm:items-center">
      <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium">{icon}<span className="truncate">{name}</span></span>
      <Select value={pick[key] ?? ""} onChange={(e) => setPick((p) => ({ ...p, [key]: e.target.value }))} aria-label={`Викладач: ${name}`} className="sm:max-w-56">
        <option value="">Оберіть викладача…</option>
        {teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
      </Select>
    </li>
  );
  return (
    <section className="mb-8 rounded-3xl border border-amber-200 bg-amber-50/60 p-5">
      <h2 className="font-display text-lg font-semibold text-ocean-900">Без викладача</h2>
      <p className="mt-1 text-sm text-ink-soft">Ці групи й учні (без групи) ще не закріплені — їхні ДЗ і розклад нікому не видно з викладачів.</p>
      <ul className="mt-4 grid gap-2">
        {groups.map((g) => row(`group:${g.id}`, <UsersRound className="size-4 text-seal-600" />, g.name))}
        {students.map((s) => row(`student:${s.id}`, <UserRound className="size-4 text-seal-600" />, s.full_name))}
      </ul>
      <div className="mt-4 flex justify-end">
        <Button disabled={!items.length} loading={reassign.isPending} onClick={() => reassign.mutate({ items })}>Закріпити ({items.length})</Button>
      </div>
    </section>
  );
}

/**
 * The teacher's groups and individual students. Each can be handed to another teacher (or unassigned);
 * "all to one teacher" covers a teacher leaving. Future lessons and homework follow on the server.
 */
function AssignDialog({ teacher, teachers, people, groups, onClose }: {
  teacher: Profile; teachers: Profile[]; people: Profile[]; groups: Group[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const myGroups = groups.filter((g) => g.teacher_id === teacher.id);
  const myStudents = people.filter((p) => p.role === "student" && p.teacher_id === teacher.id);
  const others = teachers.filter((t) => t.id !== teacher.id && t.is_active);
  const [target, setTarget] = useState<Record<string, string>>({});
  const [fromDate, setFromDate] = useState(toDateInput(new Date()));
  const [deactivate, setDeactivate] = useState(false);
  const [addGroup, setAddGroup] = useState("");
  const [addStudent, setAddStudent] = useState("");

  const keyOf = (type: "group" | "student", id: string) => `${type}:${id}`;
  const rows = [
    ...myGroups.map((g) => ({ key: keyOf("group", g.id), type: "group" as const, id: g.id, name: g.name, sub: `${g.members?.length ?? 0} учн.` })),
    ...myStudents.map((s) => ({ key: keyOf("student", s.id), type: "student" as const, id: s.id, name: s.full_name, sub: "індивідуально" })),
  ];
  const changes: ReassignItem[] = rows
    .filter((r) => target[r.key] !== undefined && target[r.key] !== teacher.id)
    .map((r) => ({ type: r.type, id: r.id, to: target[r.key] === "none" ? null : target[r.key] }));
  if (addGroup) changes.push({ type: "group", id: addGroup, to: teacher.id });
  if (addStudent) changes.push({ type: "student", id: addStudent, to: teacher.id });
  const leavesEverything = rows.length > 0 && rows.every((r) => target[r.key] && target[r.key] !== teacher.id);

  const deactivateMut = useMutation({
    mutationFn: () => callFunction("admin", { action: "update_user", user_id: teacher.id, is_active: false }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["people"] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const reassign = useReassign(() => {
    if (deactivate && leavesEverything) deactivateMut.mutate();
    onClose();
  });

  const setAll = (to: string) => setTarget(Object.fromEntries(rows.map((r) => [r.key, to])));
  const { data: leftovers = [] } = useQuery({
    queryKey: ["teacher-lessons", teacher.id, "leftover"],
    queryFn: async () => {
      const { data } = await supabase.from("lessons").select("id").eq("teacher_id", teacher.id).eq("status", "scheduled")
        .gte("starts_at", new Date().toISOString()).or("kind.eq.trial,substitute_for.not.is.null");
      return data ?? [];
    },
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={`Учні й групи · ${teacher.full_name}`} description="Майбутні уроки (з обраної дати) і домашні завдання переходять разом із групою чи учнем" size="lg">
        <div className="grid gap-5">
          {rows.length > 0 && others.length > 0 && (
            <div className="grid gap-3 rounded-2xl bg-seal-50 p-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <Field label="Викладач іде? Передати всіх одному викладачу">
                <Select value="" onChange={(e) => e.target.value && setAll(e.target.value)}>
                  <option value="">Оберіть, кому передати…</option>
                  {others.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
                </Select>
              </Field>
              <span className="text-xs text-mute sm:pb-3">або оберіть окремо нижче</span>
            </div>
          )}

          {rows.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line py-6 text-center text-sm text-mute">Груп і закріплених учнів поки немає</p>
          ) : (
            <ul className="grid gap-2">
              {rows.map((r) => (
                <li key={r.key} className="flex flex-col gap-2 rounded-2xl border border-line px-3 py-2 sm:flex-row sm:items-center">
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    {r.type === "group" ? <UsersRound className="size-4 shrink-0 text-seal-600" /> : <UserRound className="size-4 shrink-0 text-seal-600" />}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{r.name}</span>
                      <span className="block text-xs text-mute">{r.sub}</span>
                    </span>
                  </span>
                  <Select
                    value={target[r.key] ?? teacher.id}
                    onChange={(e) => setTarget((t) => ({ ...t, [r.key]: e.target.value }))}
                    aria-label={`Кому: ${r.name}`}
                    className={cn("sm:max-w-60", target[r.key] && target[r.key] !== teacher.id && "border-seal-400 bg-seal-50")}
                  >
                    <option value={teacher.id}>Залишити</option>
                    {others.map((t) => <option key={t.id} value={t.id}>→ {t.full_name}</option>)}
                    <option value="none">Відкріпити</option>
                  </Select>
                </li>
              ))}
            </ul>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Закріпити групу">
              <Select value={addGroup} onChange={(e) => setAddGroup(e.target.value)}>
                <option value="">—</option>
                {groups.filter((g) => g.teacher_id !== teacher.id).map((g) => (
                  <option key={g.id} value={g.id}>{g.name}{g.teacher ? ` (зараз: ${g.teacher.full_name})` : " (без викладача)"}</option>
                ))}
              </Select>
            </Field>
            <Field label="Закріпити учня (індивідуально)">
              <Select value={addStudent} onChange={(e) => setAddStudent(e.target.value)}>
                <option value="">—</option>
                {people.filter((p) => p.role === "student" && p.is_active && p.teacher_id !== teacher.id).map((p) => {
                  const cur = p.teacher_id ? people.find((x) => x.id === p.teacher_id)?.full_name : null;
                  return <option key={p.id} value={p.id}>{p.full_name}{cur ? ` (зараз: ${cur})` : ""}</option>;
                })}
              </Select>
            </Field>
          </div>

          <Field label="Уроки переходять з дати" hint="раніші уроки залишаться за попереднім викладачем (і в його оплаті)">
            <Input type="date" value={fromDate} min={toDateInput(new Date())} onChange={(e) => setFromDate(e.target.value)} className="sm:max-w-48" />
          </Field>

          {leavesEverything && (
            <div className="grid gap-2 rounded-2xl border border-amber-200 bg-amber-50/60 p-4 text-sm">
              {leftovers.length > 0 && (
                <p className="text-amber-800">У викладача ще {leftovers.length} майбутніх пробних уроків або замін — призначте їм заміну кнопкою «Заміна».</p>
              )}
              <Checkbox checked={deactivate} onChange={(e) => setDeactivate(e.target.checked)} label="Деактивувати акаунт викладача після передачі (контракт завершено)" />
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Скасувати</Button>
            <Button disabled={!changes.length} loading={reassign.isPending} onClick={() => reassign.mutate({ items: changes, from_date: fromDate })}>
              <ArrowRightLeft /> Зберегти{changes.length ? ` (${changes.length})` : ""}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Substitution: pick the teacher's lessons in a period and give them to another teacher; covered lessons can be returned. */
function SubstituteDialog({ teacher, teachers, onClose }: { teacher: Profile; teachers: Profile[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [from, setFrom] = useState(toDateInput(new Date()));
  const [to, setTo] = useState(toDateInput(addDays(new Date(), 7)));
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [sub, setSub] = useState("");
  const [invites, setInvites] = useState(false);
  const others = teachers.filter((t) => t.id !== teacher.id && t.is_active);

  const range = useMemo(() => {
    const start = new Date(`${from}T00:00:00`);
    const end = addDays(new Date(`${to || from}T00:00:00`), 1);
    return { start: start < new Date() ? new Date() : start, end };
  }, [from, to]);

  const { data: lessons = [], isLoading } = useQuery({
    queryKey: ["teacher-lessons", teacher.id, range.start.toISOString(), range.end.toISOString()],
    enabled: range.end > range.start,
    queryFn: async () => (await fetchLessons(range.start, range.end, { teacherId: teacher.id })).filter((l) => l.status === "scheduled"),
  });
  // Lessons of this teacher currently given to someone else.
  const { data: covered = [] } = useQuery({
    queryKey: ["teacher-lessons", teacher.id, "covered"],
    queryFn: async () => {
      const { data, error } = await supabase.from("lessons").select(LESSON_SELECT).eq("substitute_for", teacher.id).eq("status", "scheduled")
        .gte("starts_at", new Date().toISOString()).order("starts_at").limit(100);
      if (error) throw error;
      return (data ?? []) as Lesson[];
    },
  });

  const chosen = selected ?? new Set(lessons.map((l) => l.id));
  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const act = useMutation({
    mutationFn: (body: { lesson_ids: string[]; teacher_id: string }) =>
      callFunction<{ changed: number }>("schedule", { action: "substitute", send_invites: invites, ...body }),
    onSuccess: (r, body) => {
      toast.success(body.teacher_id === teacher.id ? "Уроки повернуто викладачу" : `Заміну призначено: ${r.changed}`, {
        description: "Викладачі й учні отримали сповіщення",
      });
      setSelected(null);
      for (const k of ["lessons", "teacher-lessons", "teacher-load"]) qc.invalidateQueries({ queryKey: [k] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={`Заміна · ${teacher.full_name}`} description="Хто проведе обрані уроки. Оплату за урок отримує викладач, що його провів." size="lg">
        <div className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="З"><Input type="date" value={from} min={toDateInput(new Date())} onChange={(e) => { setFrom(e.target.value); setSelected(null); }} /></Field>
            <Field label="По (включно)"><Input type="date" value={to} min={from} onChange={(e) => { setTo(e.target.value); setSelected(null); }} /></Field>
          </div>

          {isLoading ? (
            <Skeleton className="h-32" />
          ) : lessons.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line py-6 text-center text-sm text-mute">У цей період уроків немає</p>
          ) : (
            <div className="grid gap-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold text-ink-soft">Уроки: {chosen.size} з {lessons.length}</span>
                <button type="button" className="cursor-pointer text-seal-700 hover:underline" onClick={() => setSelected(chosen.size === lessons.length ? new Set() : new Set(lessons.map((l) => l.id)))}>
                  {chosen.size === lessons.length ? "Зняти всі" : "Обрати всі"}
                </button>
              </div>
              <ul className="grid max-h-80 gap-2 overflow-y-auto pr-1">
                {lessons.map((l) => (
                  <li key={l.id} className="flex items-center gap-3">
                    <input type="checkbox" className="size-4 shrink-0 accent-seal-600" checked={chosen.has(l.id)} onChange={() => toggle(l.id)} aria-label={`Обрати урок ${l.title ?? ""}`} />
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 text-xs font-medium text-mute">{fmtRelativeDay(l.starts_at)}</div>
                      <LessonRow lesson={l} onClick={() => toggle(l.id)} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-3 rounded-2xl bg-seal-50 p-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field label="Хто замінює">
              <Select value={sub} onChange={(e) => setSub(e.target.value)}>
                <option value="">Оберіть викладача…</option>
                {others.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
              </Select>
            </Field>
            <Button disabled={!sub || chosen.size === 0} loading={act.isPending && act.variables?.teacher_id !== teacher.id} onClick={() => act.mutate({ lesson_ids: [...chosen], teacher_id: sub })}>
              <Repeat /> Призначити заміну
            </Button>
            <Checkbox className="sm:col-span-2" checked={invites} onChange={(e) => setInvites(e.target.checked)} label="Надіслати оновлене запрошення Google Calendar" />
          </div>

          {covered.length > 0 && (
            <div className="grid gap-2">
              <div className="text-sm font-semibold text-ink-soft">Уроки цього викладача, які зараз веде інший</div>
              <ul className="grid gap-2">
                {covered.map((l) => (
                  <li key={l.id} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 text-xs font-medium text-mute">{fmtRelativeDay(l.starts_at)} · веде {l.teacher?.full_name}</div>
                      <LessonRow lesson={l} />
                    </div>
                    <Button size="sm" variant="ghost" loading={act.isPending && act.variables?.lesson_ids[0] === l.id} onClick={() => act.mutate({ lesson_ids: [l.id], teacher_id: teacher.id })}>
                      <Undo2 /> Повернути
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {others.length === 0 && <p className="text-sm text-mute"><GraduationCap className="mr-1 inline size-4" />Немає інших активних викладачів для заміни.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
