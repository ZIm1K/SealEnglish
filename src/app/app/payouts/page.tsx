"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addMonths, format, startOfMonth } from "date-fns";
import { uk } from "date-fns/locale";
import { toast } from "sonner";
import { AlertTriangle, ChevronLeft, ChevronRight, Download, Settings2 } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/app/AppShell";
import { useMe } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { Field, Input } from "@/components/ui/form";
import { Badge, Card, CardHeader, Skeleton } from "@/components/ui/misc";
import { callFunction, supabase } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/dates";
import { cn } from "@/lib/utils";

interface PayoutRow {
  teacher_id: string;
  teacher_name: string;
  lessons_group: number;
  lessons_individual: number;
  lessons_trial: number;
  students_present: number;
  unmarked: number;
  amount: number;
}

interface PayoutLine {
  lesson_id: string;
  starts_at: string;
  duration_min: number;
  title: string | null;
  target: string;
  line_kind: "group" | "individual" | "trial_group" | "trial_individual";
  participants: number;
  present: number;
  marked: boolean;
  amount: number;
}

interface Rates {
  group_base: number;
  group_per_student: number;
  individual: number;
  trial_individual: number;
  trial_group_per_lead: number;
}

const KIND_LABEL: Record<PayoutLine["line_kind"], string> = {
  group: "Група",
  individual: "Індивідуально",
  trial_group: "Пробний (міні-група)",
  trial_individual: "Пробний",
};

const uah = (n: number) => `${Math.round(n).toLocaleString("uk-UA")} ₴`;
const monthParam = (d: Date) => format(d, "yyyy-MM-01");

/** FR-25: teacher pay = 180 + 30 × present students (group) or a fixed rate (individual, trial), from attendance. */
export default function PayoutsPage() {
  const me = useMe();
  const isAdmin = me.role === "admin";
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [open, setOpen] = useState<string | null>(null);
  const [editingRates, setEditingRates] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["payouts", monthParam(month)],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("teacher_payouts", { p_month: monthParam(month) });
      if (error) throw error;
      return (data ?? []) as PayoutRow[];
    },
  });
  const { data: rates } = useQuery({
    queryKey: ["payout-rates"],
    queryFn: async () => {
      const { data } = await supabase.rpc("payout_rates");
      return data as Rates | null;
    },
  });

  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  const selected = isAdmin ? open : me.id;

  const exportCsv = () => {
    const header = ["Викладач", "Групових", "Індивідуальних", "Пробних", "Присутніх учнів", "Без відмітки", "Сума, грн"];
    const lines = rows.map((r) => [r.teacher_name, r.lessons_group, r.lessons_individual, r.lessons_trial, r.students_present, r.unmarked, Math.round(Number(r.amount))]);
    const csv = [header, ...lines].map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `seal-english-payouts-${format(month, "yyyy-MM")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Оплата уроків"
        description={isAdmin ? "Нарахування викладачам за проведені уроки на основі відвідуваності" : "Ваші проведені уроки та нарахування за місяць"}
        actions={
          <>
            {isAdmin && <Button variant="outline" onClick={() => setEditingRates(true)}><Settings2 /> Ставки</Button>}
            {isAdmin && rows.length > 0 && <Button variant="outline" onClick={exportCsv}><Download /> CSV</Button>}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon" onClick={() => setMonth((m) => addMonths(m, -1))} aria-label="Попередній місяць"><ChevronLeft /></Button>
        <span className="min-w-40 text-center font-display font-semibold capitalize">{format(month, "LLLL yyyy", { locale: uk })}</span>
        <Button variant="outline" size="icon" onClick={() => setMonth((m) => addMonths(m, 1))} aria-label="Наступний місяць" disabled={month >= startOfMonth(new Date())}><ChevronRight /></Button>
        {rates && (
          <span className="ml-auto text-xs text-mute">
            Група: {rates.group_base} + {rates.group_per_student} ₴ × присутніх · індивідуально {rates.individual} ₴ · пробний {rates.trial_individual} ₴ / {rates.trial_group_per_lead} ₴ за ліда в міні-групі
          </span>
        )}
      </div>

      {isLoading ? (
        <Skeleton className="h-48" />
      ) : rows.length === 0 ? (
        <EmptyState title="Проведених уроків немає" text="Урок потрапляє сюди, коли він відбувся (не скасований). Не забувайте відмічати відвідуваність." emotion="sleepy" />
      ) : (
        <>
          {isAdmin && (
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <caption className="sr-only">Нарахування викладачам</caption>
                <thead className="border-b border-line bg-seal-50/50 text-left text-xs text-mute uppercase">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold">Викладач</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">Групи</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">Індив.</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">Пробні</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">Присутніх</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">Сума</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r) => (
                    <tr key={r.teacher_id} className={cn("cursor-pointer transition hover:bg-seal-50/60", open === r.teacher_id && "bg-seal-50")} onClick={() => setOpen(open === r.teacher_id ? null : r.teacher_id)}>
                      <td className="px-4 py-3 font-semibold">
                        <button type="button" className="cursor-pointer text-left hover:underline" aria-expanded={open === r.teacher_id}>{r.teacher_name}</button>
                        {r.unmarked > 0 && <Badge tone="sun" className="ml-2"><AlertTriangle className="size-3" /> {r.unmarked} без відмітки</Badge>}
                      </td>
                      <td className="px-4 py-3 text-right">{r.lessons_group}</td>
                      <td className="px-4 py-3 text-right">{r.lessons_individual}</td>
                      <td className="px-4 py-3 text-right">{r.lessons_trial}</td>
                      <td className="px-4 py-3 text-right">{r.students_present}</td>
                      <td className="px-4 py-3 text-right font-display font-semibold">{uah(Number(r.amount))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-line">
                  <tr>
                    <td className="px-4 py-3 font-semibold" colSpan={5}>Разом</td>
                    <td className="px-4 py-3 text-right font-display text-lg font-bold text-ocean-900">{uah(total)}</td>
                  </tr>
                </tfoot>
              </table>
            </Card>
          )}
          {!isAdmin && rows[0] && (
            <div className="grid gap-4 sm:grid-cols-4">
              <Stat label="Нараховано" value={uah(Number(rows[0].amount))} strong />
              <Stat label="Групових уроків" value={rows[0].lessons_group} />
              <Stat label="Індивідуальних" value={rows[0].lessons_individual} />
              <Stat label="Пробних" value={rows[0].lessons_trial} />
            </div>
          )}
          {selected && <Lines month={month} teacherId={selected} name={rows.find((r) => r.teacher_id === selected)?.teacher_name} />}
        </>
      )}
      {isAdmin && editingRates && rates && <RatesDialog rates={rates} onClose={() => setEditingRates(false)} />}
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="card p-5">
      <div className={cn("font-display font-bold text-ocean-900", strong ? "text-2xl" : "text-xl")}>{value}</div>
      <div className="text-sm text-mute">{label}</div>
    </div>
  );
}

function Lines({ month, teacherId, name }: { month: Date; teacherId: string; name?: string }) {
  const { data: lines = [], isLoading } = useQuery({
    queryKey: ["payout-lines", monthParam(month), teacherId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("teacher_payout_lines", { p_month: monthParam(month), p_teacher: teacherId });
      if (error) throw error;
      return (data ?? []) as PayoutLine[];
    },
  });
  const unmarked = useMemo(() => lines.filter((l) => !l.marked).length, [lines]);
  return (
    <Card>
      <CardHeader title={name ? `Уроки · ${name}` : "Уроки за місяць"} description={unmarked ? `${unmarked} уроків без відмітки відвідуваності — відкрийте урок у розкладі й відмітьте учнів` : "Відвідуваність відмічено для всіх уроків"} />
      <div className="overflow-x-auto p-5 sm:p-6">
        {isLoading ? <Skeleton className="h-32" /> : (
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-mute uppercase">
              <tr>
                <th scope="col" className="py-2 pr-3 font-semibold">Дата</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Урок</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Тип</th>
                <th scope="col" className="py-2 pr-3 text-right font-semibold">Присутні</th>
                <th scope="col" className="py-2 text-right font-semibold">Сума</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {lines.map((l) => (
                <tr key={l.lesson_id}>
                  <td className="py-2 pr-3 whitespace-nowrap text-mute">{fmtDateTime(l.starts_at)} · {l.duration_min} хв</td>
                  <td className="py-2 pr-3">{l.target}</td>
                  <td className="py-2 pr-3">{KIND_LABEL[l.line_kind]}</td>
                  <td className="py-2 pr-3 text-right">
                    {l.marked ? `${l.present} / ${l.participants}` : <Badge tone="sun">не відмічено</Badge>}
                  </td>
                  <td className="py-2 text-right font-semibold">{uah(Number(l.amount))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}

function RatesDialog({ rates, onClose }: { rates: Rates; onClose: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState(rates);
  const save = useMutation({
    mutationFn: () => callFunction<Rates>("admin", { action: "save_payout_rates", rates: v }),
    onSuccess: () => {
      toast.success("Ставки збережено");
      qc.invalidateQueries({ queryKey: ["payout-rates"] });
      qc.invalidateQueries({ queryKey: ["payouts"] });
      qc.invalidateQueries({ queryKey: ["payout-lines"] });
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const field = (k: keyof Rates, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <Input type="number" min={0} step={5} value={v[k]} onChange={(e) => setV((c) => ({ ...c, [k]: Number(e.target.value) }))} />
    </Field>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Ставки оплати викладачів" description="Бізнес-план: 180 ₴ + 30 ₴ за кожного присутнього учня групи (60 хв), 250 ₴ за індивідуальний урок (50 хв). Нові ставки застосовуються й до перерахунку минулих місяців.">
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {field("group_base", "Група: база", "₴ за урок")}
            {field("group_per_student", "Група: за учня", "₴ за присутнього")}
            {field("individual", "Індивідуальний урок", "₴")}
            {field("trial_individual", "Пробний індивідуальний", "₴")}
            {field("trial_group_per_lead", "Пробний у міні-групі", "₴ за ліда, що прийшов")}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Скасувати</Button>
            <Button type="submit" loading={save.isPending}>Зберегти</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
