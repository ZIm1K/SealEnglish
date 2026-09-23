"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KeyRound, MoreHorizontal, Search, ShieldCheck, Trash2, UserCheck, UserPlus, UserX, Send, Check } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/app/AppShell";
import { useMe, isStaffRole } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/overlay";
import { Field, Input, Segmented, Select } from "@/components/ui/form";
import { Avatar, Badge, Skeleton } from "@/components/ui/misc";
import { callFunction } from "@/lib/supabase";
import { useGroups, usePeople } from "@/lib/queries";
import { AGE_LABEL, LEVELS, ROLE_LABEL, type AgeGroup, type Profile, type Role } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CredentialsDialog } from "@/components/app/CredentialsDialog";

type Tab = "student" | "teacher" | "staff";

export default function PeoplePage() {
  const me = useMe();
  const staff = isStaffRole(me.role);
  const { data: people = [], isLoading } = usePeople();
  const { data: groups = [] } = useGroups();
  const [tab, setTab] = useState<Tab>("student");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [credentials, setCredentials] = useState<{ email: string; password: string; name: string } | null>(null);

  const groupsOf = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const g of groups) for (const m of g.members ?? []) map.set(m.student.id, [...(map.get(m.student.id) ?? []), g.name]);
    return map;
  }, [groups]);

  const list = people.filter((p) => {
    const inTab = tab === "student" ? p.role === "student" : tab === "teacher" ? p.role === "teacher" : isStaffRole(p.role);
    const match = !q || `${p.full_name} ${p.email ?? ""} ${p.phone ?? ""}`.toLowerCase().includes(q.toLowerCase());
    return inTab && match && (staff || p.role === "student");
  });

  return (
    <div>
      <PageHeader
        title={staff ? "Учні й команда" : "Мої учні"}
        description={staff ? "Акаунти учнів, викладачів і менеджерів" : "Учні ваших груп та індивідуальних занять"}
        actions={staff && <Button onClick={() => setCreating(true)}><UserPlus /> Додати користувача</Button>}
      />
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        {staff && (
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "student", label: `Учні · ${people.filter((p) => p.role === "student").length}` },
              { value: "teacher", label: `Викладачі · ${people.filter((p) => p.role === "teacher").length}` },
              { value: "staff", label: "Персонал" },
            ]}
          />
        )}
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-mute" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ім'я, email або телефон" className="pl-10" />
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : list.length === 0 ? (
        <EmptyState title="Нікого не знайдено" text={staff ? "Додайте користувача або перетворіть заявку на учня в розділі «Заявки»." : undefined} />
      ) : (
        <div className="card divide-y divide-line overflow-hidden">
          {list.map((p) => (
            <PersonRow key={p.id} p={p} groups={groupsOf.get(p.id) ?? []} editable={staff && p.id !== me.id} onCredentials={setCredentials} />
          ))}
        </div>
      )}

      {staff && <CreateUserDialog open={creating} onOpenChange={setCreating} onCreated={setCredentials} defaultRole={tab === "teacher" ? "teacher" : tab === "staff" ? "manager" : "student"} />}
      <CredentialsDialog data={credentials} onClose={() => setCredentials(null)} />
    </div>
  );
}

function PersonRow({ p, groups, editable, onCredentials }: { p: Profile; groups: string[]; editable: boolean; onCredentials: (c: { email: string; password: string; name: string }) => void }) {
  const me = useMe();
  const qc = useQueryClient();
  const act = useMutation({
    mutationFn: (body: Record<string, unknown>) => callFunction<{ password?: string }>("admin", { user_id: p.id, ...body }),
    onSuccess: (r, body) => {
      if (body.action === "reset_password" && r.password) onCredentials({ email: p.email ?? "", password: r.password, name: p.full_name });
      else toast.success("Збережено");
      qc.invalidateQueries({ queryKey: ["people"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className={cn("flex flex-col gap-3 p-4 sm:flex-row sm:items-center", !p.is_active && "opacity-55")}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar name={p.full_name} src={p.avatar_url} size={42} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold">{p.full_name}</span>
            {p.role !== "student" && <Badge tone={p.role === "admin" ? "ocean" : p.role === "manager" ? "grape" : "seal"}>{ROLE_LABEL[p.role]}</Badge>}
            {p.level && <Badge tone="gray">{p.level}</Badge>}
            {!p.is_active && <Badge tone="red">Деактивовано</Badge>}
          </div>
          <div className="truncate text-sm text-mute">{[p.email, p.phone].filter(Boolean).join(" · ")}</div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {groups.map((g) => <Badge key={g} tone="seal">{g}</Badge>)}
        {p.telegram_chat_id ? <Badge tone="mint"><Send className="size-3" /> Telegram</Badge> : null}
        {editable && (
          <Menu>
            <MenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label="Дії"><MoreHorizontal className="size-4" /></Button>
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>Роль</MenuLabel>
              {(["student", "teacher", "manager", ...(me.role === "admin" ? ["admin"] : [])] as Role[]).map((r) => (
                <MenuItem key={r} onSelect={() => r !== p.role && act.mutate({ action: "update_user", role: r })}>
                  {r === p.role ? <Check /> : <ShieldCheck />} {ROLE_LABEL[r]}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem onSelect={() => act.mutate({ action: "reset_password" })}><KeyRound /> Новий пароль</MenuItem>
              {p.is_active ? (
                <MenuItem onSelect={() => confirm(`Деактивувати ${p.full_name}? Людина не зможе увійти.`) && act.mutate({ action: "update_user", is_active: false })}><UserX /> Деактивувати</MenuItem>
              ) : (
                <MenuItem onSelect={() => act.mutate({ action: "update_user", is_active: true })}><UserCheck /> Активувати</MenuItem>
              )}
              {me.role === "admin" && (
                <MenuItem danger onSelect={() => confirm(`Видалити ${p.full_name} назавжди?`) && act.mutate({ action: "delete_user" })}><Trash2 /> Видалити</MenuItem>
              )}
            </MenuContent>
          </Menu>
        )}
      </div>
    </div>
  );
}

function CreateUserDialog({
  open, onOpenChange, onCreated, defaultRole,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (c: { email: string; password: string; name: string }) => void;
  defaultRole: Role;
}) {
  const me = useMe();
  const qc = useQueryClient();
  const { data: groups = [] } = useGroups();
  const [role, setRole] = useState<Role>(defaultRole);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [level, setLevel] = useState("");
  const [age, setAge] = useState<AgeGroup | "">("teens");
  const [groupIds, setGroupIds] = useState<string[]>([]);

  const create = useMutation({
    mutationFn: () =>
      callFunction<{ id: string; email: string; password: string }>("admin", {
        action: "create_user",
        role,
        full_name: name,
        email,
        phone: phone || null,
        level: role === "student" ? level || null : null,
        age_group: role === "student" ? age || null : null,
        group_ids: role === "student" ? groupIds : [],
      }),
    onSuccess: (r) => {
      onCreated({ email: r.email, password: r.password, name });
      qc.invalidateQueries({ queryKey: ["people"] });
      qc.invalidateQueries({ queryKey: ["groups"] });
      onOpenChange(false);
      setName(""); setEmail(""); setPhone(""); setGroupIds([]);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Новий користувач" description="Пароль згенерується автоматично — передайте його людині" size="lg">
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="grid gap-5">
          <Segmented
            value={role}
            onChange={setRole}
            options={(["student", "teacher", "manager", ...(me.role === "admin" ? ["admin"] : [])] as Role[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Ім'я та прізвище"><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
            <Field label="Email (логін)"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          </div>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Телефон"><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+380…" /></Field>
            {role === "student" && (
              <>
                <Field label="Рівень">
                  <Select value={level} onChange={(e) => setLevel(e.target.value)}>
                    <option value="">—</option>
                    {LEVELS.map((l) => <option key={l}>{l}</option>)}
                  </Select>
                </Field>
                <Field label="Вік">
                  <Select value={age} onChange={(e) => setAge(e.target.value as AgeGroup)}>
                    {Object.entries(AGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </Field>
              </>
            )}
          </div>
          {role === "student" && groups.length > 0 && (
            <Field label="Групи">
              <div className="flex flex-wrap gap-2">
                {groups.map((g) => {
                  const on = groupIds.includes(g.id);
                  return (
                    <button
                      type="button"
                      key={g.id}
                      onClick={() => setGroupIds((cur) => (on ? cur.filter((x) => x !== g.id) : [...cur, g.id]))}
                      className={cn("cursor-pointer rounded-full px-3 py-1.5 text-sm font-medium transition", on ? "bg-ocean-800 text-white" : "bg-seal-50 text-ink-soft hover:bg-seal-100")}
                    >
                      {g.name}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Скасувати</Button>
            <Button type="submit" loading={create.isPending}><UserPlus /> Створити акаунт</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
