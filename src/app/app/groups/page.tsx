"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Archive, Pencil, Plus, UserMinus, UserPlus, UsersRound, CalendarPlus } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/app/AppShell";
import { useMe, isStaffRole } from "@/components/app/session";
import { NewLessonDialog } from "@/components/app/lessons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Avatar, Badge, Skeleton } from "@/components/ui/misc";
import { supabase } from "@/lib/supabase";
import { useGroups, usePeople } from "@/lib/queries";
import { AGE_LABEL, GROUP_COLORS, LEVELS, type AgeGroup, type Group } from "@/lib/types";
import { cn } from "@/lib/utils";

export default function GroupsPage() {
  const me = useMe();
  const staff = isStaffRole(me.role);
  const { data: groups = [], isLoading } = useGroups();
  const [editing, setEditing] = useState<Group | "new" | null>(null);
  const [managing, setManaging] = useState<Group | null>(null);
  const [scheduling, setScheduling] = useState(false);

  const visible = staff ? groups : groups.filter((g) => g.teacher_id === me.id);

  return (
    <div>
      <PageHeader
        title="Групи"
        description={staff ? "Склад груп, викладачі й рівні" : "Ваші групи та учні"}
        actions={
          <>
            {me.role !== "student" && <Button variant="outline" onClick={() => setScheduling(true)}><CalendarPlus /> Розклад для групи</Button>}
            {staff && <Button onClick={() => setEditing("new")}><Plus /> Нова група</Button>}
          </>
        }
      />
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-52" />)}</div>
      ) : visible.length === 0 ? (
        <EmptyState
          title="Груп поки немає"
          text={staff ? "Створіть першу групу, призначте викладача й додайте учнів." : "Менеджер призначить вам групи — вони з'являться тут."}
          action={staff ? <Button onClick={() => setEditing("new")}><Plus /> Нова група</Button> : undefined}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((g) => {
            const c = GROUP_COLORS[g.color] ?? GROUP_COLORS.sky;
            const members = g.members ?? [];
            return (
              <article key={g.id} className="card overflow-hidden transition hover:shadow-lift">
                <div className={cn("h-2", c.bg)} />
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-display text-lg font-semibold text-ocean-900">{g.name}</h3>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {g.level && <Badge tone="ocean">{g.level}</Badge>}
                        {g.age_group && <Badge>{AGE_LABEL[g.age_group]}</Badge>}
                      </div>
                    </div>
                    <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-2xl", c.soft, c.text)}><UsersRound className="size-5" /></span>
                  </div>
                  {g.schedule_note && <p className="mt-3 text-sm text-ink-soft">🗓 {g.schedule_note}</p>}
                  {g.description && <p className="mt-1 line-clamp-2 text-sm text-mute">{g.description}</p>}
                  <div className="mt-4 flex items-center gap-2 text-sm">
                    <Avatar name={g.teacher?.full_name ?? "?"} src={g.teacher?.avatar_url} size={26} />
                    <span className="text-ink-soft">{g.teacher?.full_name ?? "Викладача не призначено"}</span>
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <div className="flex -space-x-2">
                      {members.slice(0, 6).map((m) => <Avatar key={m.student.id} name={m.student.full_name} src={m.student.avatar_url} size={30} />)}
                      {members.length > 6 && <span className="flex size-[30px] items-center justify-center rounded-full bg-seal-100 text-xs font-semibold text-seal-700 ring-2 ring-white">+{members.length - 6}</span>}
                    </div>
                    <span className="text-xs text-mute">{members.length} учн.</span>
                  </div>
                  <div className="mt-5 flex gap-2">
                    <Button size="sm" variant="soft" onClick={() => setManaging(g)}><UsersRound /> Учні</Button>
                    {staff && <Button size="sm" variant="ghost" onClick={() => setEditing(g)}><Pencil /> Змінити</Button>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {staff && editing && <GroupDialog group={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {managing && <MembersDialog group={managing} editable={staff} onClose={() => setManaging(null)} />}
      <NewLessonDialog open={scheduling} onOpenChange={setScheduling} />
    </div>
  );
}

function GroupDialog({ group, onClose }: { group: Group | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: teachers = [] } = usePeople(["teacher", "manager", "admin"]);
  const [name, setName] = useState(group?.name ?? "");
  const [level, setLevel] = useState(group?.level ?? "");
  const [age, setAge] = useState<AgeGroup | "">(group?.age_group ?? "teens");
  const [teacher, setTeacher] = useState(group?.teacher_id ?? "");
  const [color, setColor] = useState(group?.color ?? "sky");
  const [note, setNote] = useState(group?.schedule_note ?? "");
  const [description, setDescription] = useState(group?.description ?? "");

  const save = useMutation({
    mutationFn: async () => {
      const row = { name: name.trim(), level: level || null, age_group: age || null, teacher_id: teacher || null, color, schedule_note: note || null, description: description || null };
      const { error } = group ? await supabase.from("groups").update(row).eq("id", group.id) : await supabase.from("groups").insert(row);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(group ? "Групу оновлено" : "Групу створено");
      qc.invalidateQueries({ queryKey: ["groups"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const archive = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("groups").update({ is_archived: true }).eq("id", group!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Групу архівовано");
      qc.invalidateQueries({ queryKey: ["groups"] });
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={group ? "Редагувати групу" : "Нова група"}>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="grid gap-5">
          <Field label="Назва"><Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Teens B1 · Вечірня" /></Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Рівень">
              <Select value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="">—</option>
                {LEVELS.map((l) => <option key={l}>{l}</option>)}
              </Select>
            </Field>
            <Field label="Вікова група">
              <Select value={age} onChange={(e) => setAge(e.target.value as AgeGroup)}>
                {Object.entries(AGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
          </div>
          <Field label="Викладач">
            <Select value={teacher} onChange={(e) => setTeacher(e.target.value)}>
              <option value="">Не призначено</option>
              {teachers.filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
            </Select>
          </Field>
          <Field label="Колір">
            <div className="flex gap-2">
              {Object.entries(GROUP_COLORS).map(([k, c]) => (
                <button type="button" key={k} onClick={() => setColor(k)} className={cn("size-9 cursor-pointer rounded-xl transition", c.bg, color === k ? "ring-4 ring-seal-200 ring-offset-2" : "opacity-70 hover:opacity-100")} aria-label={k} />
              ))}
            </div>
          </Field>
          <Field label="Розклад (текстом)" hint="напр. Пн/Ср 18:00"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <Field label="Опис" hint="необов'язково"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <div className="flex flex-wrap justify-between gap-2">
            {group ? <Button type="button" variant="ghost" className="text-mute" onClick={() => confirm("Архівувати групу?") && archive.mutate()}><Archive /> Архівувати</Button> : <span />}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>Скасувати</Button>
              <Button type="submit" loading={save.isPending}>Зберегти</Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MembersDialog({ group, editable, onClose }: { group: Group; editable: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: students = [] } = usePeople(["student"]);
  const [members, setMembers] = useState(group.members?.map((m) => m.student) ?? []);
  const [pick, setPick] = useState("");
  const available = useMemo(() => students.filter((s) => s.is_active && !members.some((m) => m.id === s.id)), [students, members]);

  const add = async () => {
    if (!pick) return;
    const { error } = await supabase.from("group_members").insert({ group_id: group.id, student_id: pick });
    if (error) return toast.error(error.message);
    const s = students.find((x) => x.id === pick);
    if (s) setMembers((m) => [...m, s]);
    setPick("");
    qc.invalidateQueries({ queryKey: ["groups"] });
  };
  const remove = async (id: string) => {
    const { error } = await supabase.from("group_members").delete().eq("group_id", group.id).eq("student_id", id);
    if (error) return toast.error(error.message);
    setMembers((m) => m.filter((x) => x.id !== id));
    qc.invalidateQueries({ queryKey: ["groups"] });
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title={`Учні · ${group.name}`} description={`${members.length} учн.`}>
        <div className="grid gap-4">
          {editable && (
            <div className="flex gap-2">
              <div className="flex-1">
                <Select value={pick} onChange={(e) => setPick(e.target.value)}>
                  <option value="">Додати учня…</option>
                  {available.map((s) => <option key={s.id} value={s.id}>{s.full_name}{s.level ? ` · ${s.level}` : ""}</option>)}
                </Select>
              </div>
              <Button onClick={add} disabled={!pick}><UserPlus /> Додати</Button>
            </div>
          )}
          <ul className="grid gap-2">
            {members.length === 0 && <li className="py-6 text-center text-sm text-mute">У групі ще немає учнів</li>}
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 rounded-2xl border border-line px-3 py-2">
                <Avatar name={m.full_name} src={m.avatar_url} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{m.full_name}</div>
                  {m.email && <div className="truncate text-xs text-mute">{m.email}</div>}
                </div>
                {editable && (
                  <Button size="icon-sm" variant="ghost" className="text-mute hover:text-red-600" onClick={() => remove(m.id)} aria-label="Прибрати з групи"><UserMinus className="size-4" /></Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
