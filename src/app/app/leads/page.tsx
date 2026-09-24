"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { uk } from "date-fns/locale";
import { toast } from "sonner";
import { AnimatePresence, motion } from "motion/react";
import {
  CalendarPlus, Globe, LayoutGrid, List, Mail, MessageCircle, Phone, Plus, Search, Send, UserPlus, Video, X, XCircle, StickyNote,
  UserRound, Clock, Target, GraduationCap, Pencil, FlaskConical,
} from "lucide-react";
import { PageHeader, EmptyState } from "@/components/app/AppShell";
import { useMe } from "@/components/app/session";
import { NewLessonDialog } from "@/components/app/lessons";
import { CredentialsDialog } from "@/components/app/CredentialsDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { Field, Input, Segmented, Select, Textarea } from "@/components/ui/form";
import { Avatar, Badge, Skeleton } from "@/components/ui/misc";
import { callFunction, supabase } from "@/lib/supabase";
import { useGroups, usePeople } from "@/lib/queries";
import { fmtDateTime } from "@/lib/dates";
import { AGE_LABEL, LEAD_FLOW, LEAD_STATUS, LEVELS, type Lead, type LeadEvent, type LeadStatus, type AgeGroup } from "@/lib/types";
import { cn } from "@/lib/utils";

const LEAD_SELECT =
  "*, manager:profiles!leads_manager_id_fkey(id, full_name, avatar_url), trial:lessons!leads_trial_lesson_fk(id, starts_at, meet_url, status, teacher:profiles!lessons_teacher_id_fkey(id, full_name, avatar_url))";

const ago = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true, locale: uk });

function useLeadsRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    const ch = supabase
      .channel("leads-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => {
        qc.invalidateQueries({ queryKey: ["leads"] });
        qc.invalidateQueries({ queryKey: ["lead"] });
        qc.invalidateQueries({ queryKey: ["leads-new-count"] });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "lead_events" }, () => qc.invalidateQueries({ queryKey: ["lead-events"] }))
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);
}

function LeadsInner() {
  useLeadsRealtime();
  const router = useRouter();
  const params = useSearchParams();
  const openId = params.get("id");
  const qc = useQueryClient();
  const [view, setView] = useState<"board" | "list">("board");
  const [q, setQ] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [dragOver, setDragOver] = useState<LeadStatus | null>(null);

  const { data: leads = [], isLoading } = useQuery({
    queryKey: ["leads", "all"],
    queryFn: async () => {
      const { data, error } = await supabase.from("leads").select(LEAD_SELECT).order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      return (data ?? []) as Lead[];
    },
  });

  const filtered = useMemo(
    () => leads.filter((l) => !q || `${l.no} ${l.name} ${l.phone ?? ""} ${l.email ?? ""} ${l.telegram_username ?? ""}`.toLowerCase().includes(q.toLowerCase())),
    [leads, q],
  );

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: LeadStatus }) => {
      const { error } = await supabase.from("leads").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ["leads", "all"] });
      const prev = qc.getQueryData<Lead[]>(["leads", "all"]);
      qc.setQueryData<Lead[]>(["leads", "all"], (old) => old?.map((l) => (l.id === id ? { ...l, status } : l)));
      return { prev };
    },
    onError: (e: Error, _, ctx) => {
      if (ctx?.prev) qc.setQueryData(["leads", "all"], ctx.prev);
      toast.error(e.message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });

  const columns: LeadStatus[] = showClosed ? LEAD_FLOW : ["new", "contacted", "trial_scheduled", "trial_done"];
  const open = (id: string | null) => router.replace(id ? `/app/leads/?id=${id}` : "/app/leads/", { scroll: false });

  return (
    <div>
      <PageHeader
        title="Заявки"
        description={`${leads.filter((l) => l.status === "new").length} нових · ${leads.length} усього`}
        actions={
          <>
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: "board", label: <span className="flex items-center gap-1.5"><LayoutGrid className="size-4" />Дошка</span> },
                { value: "list", label: <span className="flex items-center gap-1.5"><List className="size-4" />Список</span> },
              ]}
            />
            <Button onClick={() => setCreating(true)}><Plus /> Нова заявка</Button>
          </>
        }
      />
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-mute" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ім'я, телефон, №…" className="pl-10" />
        </div>
        {view === "board" && (
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} className="size-4 accent-seal-600" />
            Показати закриті (учні та відмови)
          </label>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-64" />)}</div>
      ) : leads.length === 0 ? (
        <EmptyState
          title="Заявок ще немає"
          text="Щойно хтось залишить заявку на сайті або в Telegram-боті, вона миттєво з'явиться тут і прийде вам у Telegram."
          emotion="sleepy"
          action={<Button onClick={() => setCreating(true)}><Plus /> Додати вручну</Button>}
        />
      ) : view === "board" ? (
        <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="grid min-w-max auto-cols-[18.5rem] grid-flow-col gap-4">
            {columns.map((st) => {
              const items = filtered.filter((l) => l.status === st);
              return (
                <section
                  key={st}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(st);
                  }}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(null);
                    const id = e.dataTransfer.getData("text/lead");
                    const lead = leads.find((l) => l.id === id);
                    if (lead && lead.status !== st) setStatus.mutate({ id, status: st });
                  }}
                  className={cn("flex max-h-[calc(100svh-15rem)] flex-col rounded-3xl bg-seal-50/70 p-2 transition", dragOver === st && "bg-seal-100 ring-2 ring-seal-300")}
                >
                  <header className="flex items-center justify-between px-3 py-2.5">
                    <span className="flex items-center gap-2 font-display text-sm font-semibold text-ocean-900">
                      <span className={cn("size-2.5 rounded-full", LEAD_STATUS[st].dot)} />
                      {LEAD_STATUS[st].label}
                    </span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-mute">{items.length}</span>
                  </header>
                  <div className="grid gap-2 overflow-y-auto p-1">
                    <AnimatePresence initial={false}>
                      {items.map((l) => (
                        <motion.div key={l.id} layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}>
                          <LeadCard lead={l} onOpen={() => open(l.id)} />
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    {items.length === 0 && <div className="rounded-2xl border-2 border-dashed border-seal-200 px-3 py-6 text-center text-xs text-mute">Перетягніть сюди</div>}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b border-line bg-seal-50/50 text-left text-xs text-mute uppercase">
              <tr>
                <th className="px-4 py-3 font-semibold">№</th>
                <th className="px-4 py-3 font-semibold">Ім&apos;я</th>
                <th className="px-4 py-3 font-semibold">Контакт</th>
                <th className="px-4 py-3 font-semibold">Група</th>
                <th className="px-4 py-3 font-semibold">Статус</th>
                <th className="px-4 py-3 font-semibold">Менеджер</th>
                <th className="px-4 py-3 font-semibold">Створено</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((l) => (
                <tr key={l.id} onClick={() => open(l.id)} className="cursor-pointer transition hover:bg-seal-50/60">
                  <td className="px-4 py-3 font-semibold text-mute">#{l.no}</td>
                  <td className="px-4 py-3 font-semibold">{l.name}</td>
                  <td className="px-4 py-3 text-ink-soft">{l.phone ?? l.email ?? (l.telegram_username ? `@${l.telegram_username}` : "—")}</td>
                  <td className="px-4 py-3">{l.age_group ? AGE_LABEL[l.age_group] : "—"}</td>
                  <td className="px-4 py-3"><Badge tone={LEAD_STATUS[l.status].tone}>{LEAD_STATUS[l.status].label}</Badge></td>
                  <td className="px-4 py-3 text-ink-soft">{l.manager?.full_name ?? "—"}</td>
                  <td className="px-4 py-3 text-mute">{fmtDateTime(l.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <LeadDrawer id={openId} onClose={() => open(null)} />
      <NewLeadDialog open={creating} onOpenChange={setCreating} onCreated={(id) => open(id)} />
    </div>
  );
}

function LeadCard({ lead: l, onOpen }: { lead: Lead; onOpen: () => void }) {
  return (
    <button
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/lead", l.id)}
      onClick={onOpen}
      className="group w-full cursor-pointer rounded-2xl border border-line bg-white p-3.5 text-left shadow-[0_1px_2px_rgb(13_26_46/0.04)] transition hover:-translate-y-0.5 hover:border-seal-300 hover:shadow-soft active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-mute">#{l.no} · {ago(l.created_at)}</div>
          <div className="mt-0.5 truncate font-semibold text-ink">{l.name}{l.student_age ? `, ${l.student_age}` : ""}</div>
        </div>
        <span className="shrink-0 text-mute" title={l.source === "telegram" ? "Telegram" : l.source === "website" ? "Сайт" : "Вручну"}>
          {l.source === "telegram" ? <Send className="size-4 text-sky-500" /> : l.source === "website" ? <Globe className="size-4 text-seal-500" /> : <UserRound className="size-4" />}
        </span>
      </div>
      {l.phone && <div className="mt-2 text-sm text-ink-soft">{l.phone}</div>}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {l.age_group && <Badge tone="seal">{AGE_LABEL[l.age_group]}</Badge>}
        {l.trial && l.trial.status !== "cancelled" && <Badge tone="grape"><Clock className="size-3" />{fmtDateTime(l.trial.starts_at)}</Badge>}
        {l.manager && <span className="ml-auto"><Avatar name={l.manager.full_name} src={l.manager.avatar_url} size={22} /></span>}
      </div>
    </button>
  );
}

function LeadDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const me = useMe();
  const qc = useQueryClient();
  const { data: lead } = useQuery({
    queryKey: ["lead", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("leads").select(LEAD_SELECT).eq("id", id!).maybeSingle();
      if (error) throw error;
      return data as Lead | null;
    },
  });
  const { data: events = [] } = useQuery({
    queryKey: ["lead-events", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from("lead_events").select("*, actor:profiles!lead_events_actor_id_fkey(id, full_name, avatar_url)").eq("lead_id", id!).order("created_at", { ascending: false });
      return (data ?? []) as LeadEvent[];
    },
  });
  const { data: staff = [] } = usePeople(["manager", "admin"]);
  const { data: levelTest } = useQuery({
    queryKey: ["lead-level-test", id],
    enabled: !!id,
    queryFn: async () => {
      const { data } = await supabase.from("level_tests").select("level, mc_score, mc_total, feedback, writing, completed_at").eq("lead_id", id!).not("completed_at", "is", null).order("completed_at", { ascending: false }).limit(1).maybeSingle();
      return data as { level: string; mc_score: number; mc_total: number; feedback: string; writing: string | null; completed_at: string } | null;
    },
  });
  const [note, setNote] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const [converting, setConverting] = useState(false);
  const [losing, setLosing] = useState(false);
  const [editing, setEditing] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["lead", id] });
    qc.invalidateQueries({ queryKey: ["lead-events", id] });
    qc.invalidateQueries({ queryKey: ["leads"] });
  };

  const update = useMutation({
    mutationFn: async (patch: Partial<Lead>) => {
      const { error } = await supabase.from("leads").update(patch).eq("id", id!);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const addNote = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("lead_events").insert({ lead_id: id, kind: "note", body: note.trim(), actor_id: me.id });
      if (error) throw error;
    },
    onSuccess: () => {
      setNote("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!id} onOpenChange={(v) => !v && onClose()}>
      {id && (
        <DialogContent
          title={lead ? `#${lead.no} · ${lead.name}` : "Заявка"}
          description={lead ? `${lead.source === "telegram" ? "Telegram-бот" : lead.source === "website" ? "Сайт" : "Додано вручну"} · ${fmtDateTime(lead.created_at)}` : undefined}
          size="xl"
        >
          {!lead ? (
            <Skeleton className="h-64" />
          ) : (
            <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
              <div className="grid content-start gap-5">
                {/* status */}
                <div className="flex flex-wrap gap-1.5">
                  {LEAD_FLOW.map((s) => (
                    <button
                      key={s}
                      onClick={() => (s === "lost" ? setLosing(true) : s === "won" && !lead.converted_profile_id ? setConverting(true) : update.mutate({ status: s }))}
                      className={cn(
                        "cursor-pointer rounded-full px-3 py-1.5 text-xs font-semibold transition",
                        lead.status === s ? "bg-ocean-800 text-white shadow-soft" : "bg-seal-50 text-ink-soft hover:bg-seal-100",
                      )}
                    >
                      {LEAD_STATUS[s].label}
                    </button>
                  ))}
                </div>

                {/* contacts */}
                <div className="grid gap-2 sm:grid-cols-2">
                  {lead.phone && (
                    <a href={`tel:${lead.phone}`} className="flex items-center gap-3 rounded-2xl border border-line p-3 transition hover:border-seal-300">
                      <Phone className="size-5 text-seal-600" /><span className="font-semibold">{lead.phone}</span>
                    </a>
                  )}
                  {lead.telegram_username && (
                    <a href={`https://t.me/${lead.telegram_username.replace(/^@/, "")}`} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-2xl border border-line p-3 transition hover:border-seal-300">
                      <MessageCircle className="size-5 text-sky-500" /><span className="font-semibold">@{lead.telegram_username.replace(/^@/, "")}</span>
                    </a>
                  )}
                  {lead.phone && (
                    <a href={`https://wa.me/${lead.phone.replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-2xl border border-line p-3 transition hover:border-seal-300">
                      <MessageCircle className="size-5 text-emerald-500" /><span className="font-semibold">WhatsApp / Viber</span>
                    </a>
                  )}
                  {lead.email && (
                    <a href={`mailto:${lead.email}`} className="flex items-center gap-3 rounded-2xl border border-line p-3 transition hover:border-seal-300">
                      <Mail className="size-5 text-coral-500" /><span className="truncate font-semibold">{lead.email}</span>
                    </a>
                  )}
                </div>

                {/* details */}
                <dl className="relative grid grid-cols-2 gap-3 rounded-2xl bg-seal-50/70 p-4 text-sm">
                  <Button size="icon-sm" variant="ghost" className="absolute top-2 right-2" aria-label="Редагувати заявку" onClick={() => setEditing(true)}><Pencil className="size-4" /></Button>
                  <Detail icon={UserRound} label="Вік" value={[lead.age_group && AGE_LABEL[lead.age_group], lead.student_age && `${lead.student_age} р.`].filter(Boolean).join(" · ")} />
                  <Detail icon={GraduationCap} label="Рівень" value={[lead.level, lead.level_estimate && `тест: ${lead.level_estimate}`].filter(Boolean).join(" · ")} />
                  <Detail icon={Target} label="Мета" value={lead.goal} />
                  <Detail icon={Clock} label="Зручний час" value={lead.preferred_time} />
                  {lead.comment && <div className="col-span-2"><dt className="text-xs text-mute">Коментар</dt><dd className="mt-0.5 whitespace-pre-wrap">{lead.comment}</dd></div>}
                  {lead.lost_reason && <div className="col-span-2"><dt className="text-xs text-mute">Причина відмови</dt><dd className="mt-0.5">{lead.lost_reason}</dd></div>}
                  {levelTest && (
                    <div className="col-span-2 rounded-xl bg-white p-3 ring-1 ring-line">
                      <dt className="flex items-center gap-1.5 text-xs text-mute"><FlaskConical className="size-3.5" /> Тест рівня · {fmtDateTime(levelTest.completed_at)}</dt>
                      <dd className="mt-1"><b>{levelTest.level}</b> · тест {levelTest.mc_score}/{levelTest.mc_total}</dd>
                      <dd className="mt-1 text-ink-soft">{levelTest.feedback}</dd>
                      {levelTest.writing && <details className="mt-1 text-xs text-mute"><summary className="cursor-pointer">Текст учня</summary><p className="mt-1 whitespace-pre-wrap">{levelTest.writing}</p></details>}
                    </div>
                  )}
                  {Object.keys(lead.utm ?? {}).length > 0 && (
                    <div className="col-span-2 text-xs text-mute">UTM: {Object.entries(lead.utm).map(([k, v]) => `${k}=${v}`).join(" · ")}</div>
                  )}
                </dl>

                {/* trial */}
                <div className="rounded-2xl border border-line p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-mute">Пробний урок</div>
                      {lead.trial && lead.trial.status !== "cancelled" ? (
                        <div className="mt-1 font-semibold">{fmtDateTime(lead.trial.starts_at)} · {lead.trial.teacher?.full_name}</div>
                      ) : (
                        <div className="mt-1 text-sm text-ink-soft">Ще не призначено</div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      {lead.trial?.meet_url && lead.trial.status !== "cancelled" && (
                        <Button asChild size="sm" variant="soft"><a href={lead.trial.meet_url} target="_blank" rel="noreferrer"><Video /> Meet</a></Button>
                      )}
                      <Button size="sm" onClick={() => setScheduling(true)}><CalendarPlus /> {lead.trial && lead.trial.status !== "cancelled" ? "Інший час" : "Призначити"}</Button>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Відповідальний">
                    <Select value={lead.manager_id ?? ""} onChange={(e) => update.mutate({ manager_id: e.target.value || null })}>
                      <option value="">Не призначено</option>
                      {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                    </Select>
                  </Field>
                  <div className="flex items-end gap-2">
                    {lead.converted_profile_id ? (
                      <Badge tone="mint" className="h-11 w-full justify-center text-sm">🎉 Вже учень школи</Badge>
                    ) : (
                      <Button variant="ocean" className="w-full" onClick={() => setConverting(true)}><UserPlus /> Зробити учнем</Button>
                    )}
                  </div>
                </div>
              </div>

              {/* timeline */}
              <div className="flex min-h-0 flex-col rounded-3xl bg-canvas p-4">
                <form onSubmit={(e) => { e.preventDefault(); if (note.trim()) addNote.mutate(); }} className="flex gap-2">
                  <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Нотатка: про що домовились…" className="min-h-0" />
                  <Button type="submit" size="icon" loading={addNote.isPending} aria-label="Додати нотатку"><StickyNote /></Button>
                </form>
                <ol className="mt-4 grid max-h-[26rem] gap-3 overflow-y-auto pr-1">
                  {events.map((ev) => <TimelineItem key={ev.id} ev={ev} />)}
                </ol>
              </div>
            </div>
          )}
        </DialogContent>
      )}
      {lead && (
        <>
          <NewLessonDialog open={scheduling} onOpenChange={(v) => { setScheduling(v); if (!v) refresh(); }} lead={lead} />
          <ConvertDialog key={lead.id} lead={lead} open={converting} onOpenChange={setConverting} onDone={refresh} />
          {editing && <EditLeadDialog lead={lead} onClose={() => setEditing(false)} onSaved={refresh} />}
          <LostDialog open={losing} onOpenChange={setLosing} onConfirm={(reason) => update.mutate({ status: "lost", lost_reason: reason || null })} />
        </>
      )}
    </Dialog>
  );
}

function Detail({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value?: string | number | null }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs text-mute"><Icon className="size-3.5" />{label}</dt>
      <dd className="mt-0.5 font-medium">{value || "—"}</dd>
    </div>
  );
}

function TimelineItem({ ev }: { ev: LeadEvent }) {
  const who = ev.actor?.full_name ?? ev.actor_name ?? "Система";
  let text: React.ReactNode = ev.body;
  if (ev.kind === "created") text = "Заявку створено";
  if (ev.kind === "status") text = <>Статус: {ev.from_status && <>{LEAD_STATUS[ev.from_status].label} → </>}<b>{ev.to_status && LEAD_STATUS[ev.to_status].label}</b>{ev.body ? ` · ${ev.body}` : ""}</>;
  if (ev.kind === "assigned") text = <>Відповідальний: <b>{ev.body}</b></>;
  if (ev.kind === "trial") text = <>📅 {ev.body}</>;
  return (
    <li className={cn("rounded-2xl p-3 text-sm", ev.kind === "note" ? "bg-amber-50 ring-1 ring-amber-100" : "bg-white ring-1 ring-line")}>
      <div className="flex items-center justify-between gap-2 text-xs text-mute">
        <span className="font-semibold text-ink-soft">{who}</span>
        <span>{ago(ev.created_at)}</span>
      </div>
      <div className="mt-1 whitespace-pre-wrap">{text}</div>
    </li>
  );
}

function ConvertDialog({ lead, open, onOpenChange, onDone }: { lead: Lead; open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const { data: groups = [] } = useGroups();
  const [email, setEmail] = useState(lead.email ?? "");
  const [name, setName] = useState(lead.name);
  const [level, setLevel] = useState(lead.level_estimate ?? "");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [creds, setCreds] = useState<{ email: string; password: string; name: string } | null>(null);

  const convert = useMutation({
    mutationFn: () => callFunction<{ email: string; password: string; telegram_linked: boolean }>("admin", { action: "convert_lead", lead_id: lead.id, email, full_name: name, level: level || null, group_ids: groupIds }),
    onSuccess: (r) => {
      toast.success("Учня створено 🎉", { description: r.telegram_linked ? "Дані для входу вже надіслано в Telegram" : undefined });
      onOpenChange(false);
      setCreds({ email: r.email, password: r.password, name });
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent title="Зробити учнем" description="Створимо акаунт у кабінеті, заявка отримає статус «Став учнем»">
          <form onSubmit={(e) => { e.preventDefault(); convert.mutate(); }} className="grid gap-5">
            <Field label="Ім'я учня"><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
            <Field label="Email для входу" hint="це логін; на нього прийде відновлення пароля"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="student@gmail.com" /></Field>
            <Field label="Рівень">
              <Select value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="">—</option>
                {LEVELS.map((l) => <option key={l}>{l}</option>)}
              </Select>
            </Field>
            {groups.length > 0 && (
              <Field label="Додати в групи">
                <div className="flex flex-wrap gap-2">
                  {groups.map((g) => {
                    const on = groupIds.includes(g.id);
                    return (
                      <button type="button" key={g.id} onClick={() => setGroupIds((c) => (on ? c.filter((x) => x !== g.id) : [...c, g.id]))}
                        className={cn("cursor-pointer rounded-full px-3 py-1.5 text-sm font-medium transition", on ? "bg-ocean-800 text-white" : "bg-seal-50 text-ink-soft hover:bg-seal-100")}>
                        {g.name}
                      </button>
                    );
                  })}
                </div>
              </Field>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Скасувати</Button>
              <Button type="submit" loading={convert.isPending}><UserPlus /> Створити акаунт</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <CredentialsDialog data={creds} onClose={() => setCreds(null)} />
    </>
  );
}

function LostDialog({ open, onOpenChange, onConfirm }: { open: boolean; onOpenChange: (v: boolean) => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const presets = ["Дорого", "Не підійшов розклад", "Обрали іншу школу", "Не відповідає", "Передумали"];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Відмова" description="Причина допоможе покращити конверсію" size="sm">
        <div className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button key={p} onClick={() => setReason(p)} className={cn("cursor-pointer rounded-full px-3 py-1.5 text-sm transition", reason === p ? "bg-ocean-800 text-white" : "bg-seal-50 hover:bg-seal-100")}>{p}</button>
            ))}
          </div>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Своя причина" />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}><X /> Скасувати</Button>
            <Button variant="ocean" onClick={() => { onConfirm(reason); onOpenChange(false); setReason(""); }}><XCircle /> Позначити відмову</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NewLeadDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (id: string) => void }) {
  const me = useMe();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [tg, setTg] = useState("");
  const [age, setAge] = useState<AgeGroup>("teens");
  const [comment, setComment] = useState("");
  const create = useMutation({
    mutationFn: async () => {
      const cleanPhone = phone.replace(/[^\d+]/g, "");
      const handle = tg.trim().replace(/^@/, "").replace(/^https?:\/\/t\.me\//, "");
      if (!cleanPhone && !handle) throw new Error("Вкажіть телефон або Telegram, щоб можна було зв'язатися");
      if (cleanPhone && (cleanPhone.replace(/\D/g, "").length < 9 || cleanPhone.replace(/\D/g, "").length > 15)) throw new Error("Перевірте номер телефону");
      const { data, error } = await supabase
        .from("leads")
        .insert({ name: name.trim(), phone: cleanPhone || null, telegram_username: handle || null, age_group: age, comment: comment.trim() || null, source: "manual", manager_id: me.id })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => {
      toast.success("Заявку додано");
      qc.invalidateQueries({ queryKey: ["leads"] });
      onOpenChange(false);
      setName(""); setPhone(""); setTg(""); setComment("");
      onCreated(id);
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Нова заявка" description="Наприклад, з дзвінка чи Instagram">
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="grid gap-5">
          <Field label="Ім'я"><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Телефон"><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+380…" /></Field>
            <Field label="Telegram"><Input value={tg} onChange={(e) => setTg(e.target.value)} placeholder="@username" /></Field>
          </div>
          <Field label="Для кого">
            <Segmented value={age} onChange={setAge} options={Object.entries(AGE_LABEL).map(([k, v]) => ({ value: k as AgeGroup, label: v }))} />
          </Field>
          <Field label="Коментар"><Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Скасувати</Button>
            <Button type="submit" loading={create.isPending}><Plus /> Додати</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditLeadDialog({ lead, onClose, onSaved }: { lead: Lead; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({
    name: lead.name,
    phone: lead.phone ?? "",
    email: lead.email ?? "",
    telegram_username: lead.telegram_username ?? "",
    age_group: (lead.age_group ?? "") as AgeGroup | "",
    student_age: lead.student_age?.toString() ?? "",
    level: lead.level ?? "",
    goal: lead.goal ?? "",
    preferred_time: lead.preferred_time ?? "",
    comment: lead.comment ?? "",
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setV((c) => ({ ...c, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: async () => {
      const age = v.student_age ? Number(v.student_age) : null;
      if (age != null && (!Number.isFinite(age) || age < 3 || age > 99)) throw new Error("Вік — від 3 до 99");
      if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) throw new Error("Перевірте email");
      const { error } = await supabase.from("leads").update({
        name: v.name.trim(),
        phone: v.phone.replace(/[^\d+]/g, "") || null,
        email: v.email.trim() || null,
        telegram_username: v.telegram_username.trim().replace(/^@/, "") || null,
        age_group: v.age_group || null,
        student_age: age,
        level: v.level.trim() || null,
        goal: v.goal.trim() || null,
        preferred_time: v.preferred_time.trim() || null,
        comment: v.comment.trim() || null,
      }).eq("id", lead.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Заявку оновлено");
      onSaved();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Редагувати заявку #${lead.no}`} size="lg">
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
            <Field label="Ім'я"><Input value={v.name} onChange={set("name")} required minLength={2} /></Field>
            <Field label="Вік"><Input type="number" min={3} max={99} value={v.student_age} onChange={set("student_age")} /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Телефон"><Input value={v.phone} onChange={set("phone")} placeholder="+380…" /></Field>
            <Field label="Telegram"><Input value={v.telegram_username} onChange={set("telegram_username")} placeholder="@username" /></Field>
            <Field label="Email"><Input type="email" value={v.email} onChange={set("email")} /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Вікова група">
              <Select value={v.age_group} onChange={set("age_group")}>
                <option value="">—</option>
                {Object.entries(AGE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
            </Field>
            <Field label="Рівень"><Input value={v.level} onChange={set("level")} placeholder="B1" /></Field>
            <Field label="Зручний час"><Input value={v.preferred_time} onChange={set("preferred_time")} /></Field>
          </div>
          <Field label="Мета"><Input value={v.goal} onChange={set("goal")} /></Field>
          <Field label="Коментар"><Textarea rows={2} value={v.comment} onChange={set("comment")} /></Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Скасувати</Button>
            <Button type="submit" loading={save.isPending}>Зберегти</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function LeadsPage() {
  return (
    <Suspense>
      <LeadsInner />
    </Suspense>
  );
}
