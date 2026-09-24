"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  KeyRound, MoreHorizontal, Search, ShieldCheck, Trash2, UserCheck, UserPlus, UserX, Send, Check, Pencil, TrendingDown, Copy, Link2Off,
  BellRing,
} from "lucide-react";
import { PageHeader, EmptyState } from "@/components/app/AppShell";
import { useMe, isStaffRole } from "@/components/app/session";
import { MistakesProfile } from "@/components/app/mistakes";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/overlay";
import { Field, Input, Segmented, Select } from "@/components/ui/form";
import { Avatar, Badge, Skeleton } from "@/components/ui/misc";
import { callFunction, supabase } from "@/lib/supabase";
import { useAiFeatures, useGroups, usePeople } from "@/lib/queries";
import { fmtDateTime } from "@/lib/dates";
import { AGE_LABEL, LEVELS, ROLE_LABEL, type AgeGroup, type PracticeSession, type Profile, type RiskRow, type Role } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CredentialsDialog } from "@/components/app/CredentialsDialog";

type Tab = "student" | "teacher" | "staff" | "risk";

function PeopleInner() {
  const me = useMe();
  const staff = isStaffRole(me.role);
  const params = useSearchParams();
  const router = useRouter();
  const { data: people = [], isLoading } = usePeople();
  const { data: groups = [] } = useGroups();
  const { data: ai } = useAiFeatures();
  const [tab, setTab] = useState<Tab>(() => (params.get("risk") ? "risk" : "student"));
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [credentials, setCredentials] = useState<{ email: string; password: string; name: string } | null>(null);
  const openId = params.get("student");

  const groupsOf = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const g of groups) for (const m of g.members ?? []) map.set(m.student.id, [...(map.get(m.student.id) ?? []), g.name]);
    return map;
  }, [groups]);

  const { data: risk = [] } = useQuery({
    queryKey: ["risk-overview"],
    enabled: !!ai?.risk,
    queryFn: async () => {
      const { data } = await supabase.rpc("risk_overview");
      return ((data ?? []) as RiskRow[]).sort((a, b) => b.score - a.score);
    },
  });
  const riskOf = useMemo(() => new Map(risk.map((r) => [r.student_id, r])), [risk]);

  const list = people.filter((p) => {
    const inTab = tab === "risk"
      ? p.role === "student" && (riskOf.get(p.id)?.score ?? 0) >= 40
      : tab === "student" ? p.role === "student" : tab === "teacher" ? p.role === "teacher" : isStaffRole(p.role);
    const match = !q || `${p.full_name} ${p.email ?? ""} ${p.phone ?? ""} ${(groupsOf.get(p.id) ?? []).join(" ")}`.toLowerCase().includes(q.toLowerCase());
    return inTab && match && (staff || p.role === "student");
  }).sort((a, b) => (tab === "risk" ? (riskOf.get(b.id)?.score ?? 0) - (riskOf.get(a.id)?.score ?? 0) : 0));

  const open = (id: string | null) => router.replace(id ? `/app/people/?student=${id}` : "/app/people/", { scroll: false });

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
            label="Категорія"
            options={[
              { value: "student", label: `Учні · ${people.filter((p) => p.role === "student").length}` },
              { value: "teacher", label: `Викладачі · ${people.filter((p) => p.role === "teacher").length}` },
              { value: "staff", label: "Персонал" },
              ...(ai?.risk ? [{ value: "risk" as Tab, label: <span className="flex items-center gap-1"><TrendingDown className="size-3.5" /> Ризик</span> }] : []),
            ]}
          />
        )}
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-mute" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ім'я, email, телефон або група" className="pl-10" aria-label="Пошук" />
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-2">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : list.length === 0 ? (
        <EmptyState
          title={tab === "risk" ? "Учнів із помітним ризиком немає" : "Нікого не знайдено"}
          text={tab === "risk" ? "Оцінка оновлюється щоночі за відвідуваністю, ДЗ і практикою." : staff ? "Додайте користувача або перетворіть заявку на учня в розділі «Заявки»." : undefined}
          emotion={tab === "risk" ? "joy" : "neutral"}
        />
      ) : (
        <div className="card divide-y divide-line overflow-hidden">
          {list.map((p) => (
            <PersonRow key={p.id} p={p} groups={groupsOf.get(p.id) ?? []} risk={riskOf.get(p.id)} editable={staff && p.id !== me.id} onCredentials={setCredentials} onOpen={p.role === "student" ? () => open(p.id) : undefined} />
          ))}
        </div>
      )}

      {staff && <CreateUserDialog key={tab} open={creating} onOpenChange={setCreating} onCreated={setCredentials} defaultRole={tab === "teacher" ? "teacher" : tab === "staff" ? "manager" : "student"} />}
      <CredentialsDialog data={credentials} onClose={() => setCredentials(null)} />
      <StudentDialog id={openId} person={people.find((p) => p.id === openId) ?? null} groups={openId ? groupsOf.get(openId) ?? [] : []} risk={openId ? riskOf.get(openId) : undefined} onClose={() => open(null)} />
    </div>
  );
}

function RiskBadge({ r }: { r?: RiskRow }) {
  if (!r || r.score < 40) return null;
  return <Badge tone={r.score >= 60 ? "red" : "sun"} title={r.explanation ?? undefined}><TrendingDown className="size-3" /> ризик {r.score}</Badge>;
}

function PersonRow({ p, groups, risk, editable, onCredentials, onOpen }: {
  p: Profile;
  groups: string[];
  risk?: RiskRow;
  editable: boolean;
  onCredentials: (c: { email: string; password: string; name: string }) => void;
  onOpen?: () => void;
}) {
  const me = useMe();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
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
      <button type="button" disabled={!onOpen} onClick={onOpen} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left disabled:cursor-default">
        <Avatar name={p.full_name} src={p.avatar_url} size={42} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("truncate font-semibold", onOpen && "hover:underline")}>{p.full_name}</span>
            {p.role !== "student" && <Badge tone={p.role === "admin" ? "ocean" : p.role === "manager" ? "grape" : "seal"}>{ROLE_LABEL[p.role]}</Badge>}
            {p.level && <Badge tone="gray">{p.level}</Badge>}
            {!p.is_active && <Badge tone="red">Деактивовано</Badge>}
            <RiskBadge r={risk} />
          </div>
          <div className="truncate text-sm text-mute">{[p.email, p.phone].filter(Boolean).join(" · ")}</div>
        </div>
      </button>
      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
        {groups.map((g) => <Badge key={g} tone="seal">{g}</Badge>)}
        {p.telegram_chat_id ? <Badge tone="mint"><Send className="size-3" /> Telegram</Badge> : null}
        {editable && (
          <Menu>
            <MenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label={`Дії: ${p.full_name}`}><MoreHorizontal className="size-4" /></Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={() => setEditing(true)}><Pencil /> Редагувати профіль</MenuItem>
              <MenuSeparator />
              <MenuLabel>Роль</MenuLabel>
              {(["student", "teacher", "manager", ...(me.role === "admin" ? ["admin"] : [])] as Role[]).map((r) => (
                <MenuItem
                  key={r}
                  onSelect={() => r !== p.role && confirm(`Змінити роль ${p.full_name}: ${ROLE_LABEL[p.role]} → ${ROLE_LABEL[r]}?`) && act.mutate({ action: "update_user", role: r })}
                >
                  {r === p.role ? <Check /> : <ShieldCheck />} {ROLE_LABEL[r]}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem onSelect={() => confirm(`Згенерувати новий пароль для ${p.full_name}? Старий перестане працювати.`) && act.mutate({ action: "reset_password" })}><KeyRound /> Новий пароль</MenuItem>
              {p.is_active ? (
                <MenuItem onSelect={() => confirm(`Деактивувати ${p.full_name}? Людина не зможе увійти.`) && act.mutate({ action: "update_user", is_active: false })}><UserX /> Деактивувати</MenuItem>
              ) : (
                <MenuItem onSelect={() => act.mutate({ action: "update_user", is_active: true })}><UserCheck /> Активувати</MenuItem>
              )}
              {me.role === "admin" && (
                <MenuItem danger onSelect={() => confirm(`Видалити ${p.full_name} назавжди? Це не можна скасувати.`) && act.mutate({ action: "delete_user" })}><Trash2 /> Видалити</MenuItem>
              )}
            </MenuContent>
          </Menu>
        )}
      </div>
      {editing && <EditProfileDialog p={p} onClose={() => setEditing(false)} />}
    </div>
  );
}

function EditProfileDialog({ p, onClose }: { p: Profile; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(p.full_name);
  const [email, setEmail] = useState(p.email ?? "");
  const [phone, setPhone] = useState(p.phone ?? "");
  const [level, setLevel] = useState(p.level ?? "");
  const [age, setAge] = useState<AgeGroup | "">(p.age_group ?? "");
  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("profiles").update({
        full_name: name.trim(),
        phone: phone.replace(/[^\d+]/g, "") || null,
        level: level || null,
        age_group: age || null,
      }).eq("id", p.id);
      if (error) throw error;
      if (email.trim().toLowerCase() !== (p.email ?? "")) {
        await callFunction("admin", { action: "update_user", user_id: p.id, email: email.trim().toLowerCase() });
      }
    },
    onSuccess: () => {
      toast.success("Профіль оновлено");
      qc.invalidateQueries({ queryKey: ["people"] });
      qc.invalidateQueries({ queryKey: ["groups"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Профіль · ${p.full_name}`} description={ROLE_LABEL[p.role]}>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="grid gap-4">
          <Field label="Ім'я та прізвище"><Input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Email (логін)" hint="зміна логіна"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
            <Field label="Телефон"><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+380…" /></Field>
          </div>
          {p.role === "student" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Рівень" hint="ШІ підлаштовується під нього">
                <Select value={level} onChange={(e) => setLevel(e.target.value)}>
                  <option value="">—</option>
                  {LEVELS.map((l) => <option key={l}>{l}</option>)}
                </Select>
              </Field>
              <Field label="Вікова група">
                <Select value={age} onChange={(e) => setAge(e.target.value as AgeGroup)}>
                  <option value="">—</option>
                  {Object.entries(AGE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Скасувати</Button>
            <Button type="submit" loading={save.isPending}>Зберегти</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── student card: mistakes, practice, risk, parents ─────────────────────────
function StudentDialog({ id, person, groups, risk, onClose }: { id: string | null; person: Profile | null; groups: string[]; risk?: RiskRow; onClose: () => void }) {
  const me = useMe();
  const { data: ai } = useAiFeatures();
  const [tab, setTab] = useState<"mistakes" | "practice" | "parents">("mistakes");
  return (
    <Dialog open={!!id} onOpenChange={(v) => !v && onClose()}>
      {id && (
        <DialogContent title={person?.full_name ?? "Учень"} description={[person?.level, person?.age_group && AGE_LABEL[person.age_group], ...groups].filter(Boolean).join(" · ") || undefined} size="xl">
          <div className="grid gap-5">
            {risk && risk.score >= 40 && (
              <div className={cn("rounded-2xl p-4 text-sm", risk.score >= 60 ? "bg-red-50 text-red-900" : "bg-amber-50 text-amber-900")}>
                <div className="flex items-center gap-2 font-semibold"><TrendingDown className="size-4" /> Ризик відтоку {risk.score}/100{risk.prev_score != null && ` (було ${risk.prev_score})`}</div>
                {risk.explanation ? <p className="mt-1">{risk.explanation}</p> : (
                  <p className="mt-1">Пропуски: {risk.signals.absent ?? 0} з {risk.signals.lessons_marked ?? 0} · не здано ДЗ: {risk.signals.hw_missed ?? 0} з {risk.signals.hw_due ?? 0} · практика за 2 тижні: {risk.signals.practice_recent ?? 0}</p>
                )}
              </div>
            )}
            <Segmented
              value={tab}
              onChange={setTab}
              label="Розділ"
              options={[
                { value: "mistakes", label: "Профіль помилок" },
                { value: "practice", label: "Практика з ШІ" },
                ...(isStaffRole(me.role) || ai?.parent_reports ? [{ value: "parents" as const, label: "Батьки" }] : []),
              ]}
            />
            {tab === "mistakes" && <MistakesProfile studentId={id} editable />}
            {tab === "practice" && <StudentPractice studentId={id} />}
            {tab === "parents" && <Parents studentId={id} enabled={!!ai?.parent_reports} />}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

function StudentPractice({ studentId }: { studentId: string }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["student-practice", studentId],
    queryFn: async () => {
      const { data } = await supabase.from("practice_sessions").select("*").eq("student_id", studentId).order("started_at", { ascending: false }).limit(20);
      return (data ?? []) as PracticeSession[];
    },
  });
  if (isLoading) return <Skeleton className="h-24" />;
  if (!data.length) return <p className="rounded-2xl bg-seal-50/70 p-4 text-sm text-mute">Учень ще не практикувався з Сілі.</p>;
  return (
    <ul className="grid gap-2">
      {data.map((s) => (
        <li key={s.id}>
          <Link href={`/app/practice/?session=${s.id}`} className={cn("block rounded-2xl border p-3 text-sm transition hover:border-seal-300", s.flagged && !s.reviewed_at ? "border-amber-300" : "border-line")}>
            <div className="flex items-center justify-between gap-2 text-xs text-mute">
              <span>{fmtDateTime(s.started_at)} · {s.turns} реплік</span>
              {s.flagged && <Badge tone={s.reviewed_at ? "gray" : "sun"}>{s.reviewed_at ? "переглянуто" : "позначено"}</Badge>}
            </div>
            <div className="mt-1 text-ink-soft">{s.summary?.summary ?? s.topic ?? "—"}</div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** FR-20: parents subscribe to weekly Telegram reports by opening an invite link and confirming consent in the bot. */
function Parents({ studentId, enabled }: { studentId: string; enabled: boolean }) {
  const me = useMe();
  const qc = useQueryClient();
  const [link, setLink] = useState<string | null>(null);
  const { data: contacts = [] } = useQuery({
    queryKey: ["parent-contacts", studentId],
    queryFn: async () => {
      const { data } = await supabase.from("parent_contacts").select("*").eq("student_id", studentId).order("created_at");
      return (data ?? []) as { id: string; name: string | null; consent_at: string; revoked_at: string | null; last_report_at: string | null }[];
    },
  });
  const { data: bot } = useQuery({
    queryKey: ["bot-username"],
    queryFn: async () => {
      const { data } = await supabase.from("app_settings").select("value").eq("key", "telegram_bot_username").maybeSingle();
      return (typeof data?.value === "string" ? data.value : null) as string | null;
    },
  });
  const invite = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("create_parent_link", { p_student: studentId });
      if (error) throw error;
      return `https://t.me/${bot}?start=parent_${data}`;
    },
    onSuccess: (url) => setLink(url),
    onError: (e: Error) => toast.error(e.message),
  });
  const revoke = async (id: string) => {
    const { error } = await supabase.from("parent_contacts").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Підписку скасовано");
    qc.invalidateQueries({ queryKey: ["parent-contacts", studentId] });
  };
  return (
    <div className="grid gap-4 text-sm">
      {!enabled && <p className="rounded-2xl bg-seal-50 p-3 text-ink-soft">Щотижневі звіти батькам вимкнено (ШІ-модуль → «Звіти батькам», фаза 2). Підписки можна зібрати заздалегідь.</p>}
      {contacts.length === 0 ? <p className="text-mute">Батьки ще не підписані.</p> : (
        <ul className="grid gap-2">
          {contacts.map((c) => (
            <li key={c.id} className={cn("flex items-center gap-3 rounded-2xl border border-line p-3", c.revoked_at && "opacity-55")}>
              <BellRing className="size-4 text-seal-600" />
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{c.name ?? "Telegram"}</div>
                <div className="text-xs text-mute">Згода {fmtDateTime(c.consent_at)}{c.last_report_at ? ` · останній звіт ${fmtDateTime(c.last_report_at)}` : ""}{c.revoked_at ? " · відписано" : ""}</div>
              </div>
              {!c.revoked_at && isStaffRole(me.role) && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => revoke(c.id)}><Link2Off /> Відписати</Button>}
            </li>
          ))}
        </ul>
      )}
      {bot ? (
        <div className="grid gap-2 rounded-2xl border border-dashed border-seal-300 p-4">
          <p className="text-ink-soft">Надішліть батькам посилання (діє 7 днів). Бот попросить згоду на обробку даних; відписатися можна командою /stop.</p>
          {link ? (
            <button type="button" onClick={() => { navigator.clipboard.writeText(link); toast.success("Скопійовано"); }} className="flex cursor-pointer items-center justify-between gap-2 rounded-xl bg-ocean-900 px-3 py-2 text-left font-mono text-xs text-seal-100">
              <span className="truncate">{link}</span><Copy className="size-4 shrink-0" />
            </button>
          ) : (
            <Button variant="soft" className="justify-self-start" onClick={() => invite.mutate()} loading={invite.isPending}><Send /> Створити посилання для батьків</Button>
          )}
        </div>
      ) : (
        <p className="text-mute">Спершу підключіть Telegram-бота (Інтеграції).</p>
      )}
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
        full_name: name.trim(),
        email: email.trim(),
        phone: phone.replace(/[^\d+]/g, "") || null,
        level: role === "student" ? level || null : null,
        age_group: role === "student" ? age || null : null,
        group_ids: role === "student" ? groupIds : [],
      }),
    onSuccess: (r) => {
      onCreated({ email: r.email, password: r.password, name });
      qc.invalidateQueries({ queryKey: ["people"] });
      qc.invalidateQueries({ queryKey: ["groups"] });
      onOpenChange(false);
      setName(""); setEmail(""); setPhone(""); setGroupIds([]); setLevel("");
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
            label="Роль"
            options={(["student", "teacher", "manager", ...(me.role === "admin" ? ["admin"] : [])] as Role[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Ім'я та прізвище"><Input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} /></Field>
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
                      aria-pressed={on}
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

export default function PeoplePage() {
  return (
    <Suspense>
      <PeopleInner />
    </Suspense>
  );
}
