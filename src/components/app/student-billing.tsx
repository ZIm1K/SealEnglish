"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Search, Wallet } from "lucide-react";
import { EmptyState } from "@/components/app/AppShell";
import { lessonsWord, PaymentForm, PaymentsPanel } from "@/components/app/balance";
import { useMe } from "@/components/app/session";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { Field, Input, Segmented, Select } from "@/components/ui/form";
import { Avatar, Badge, Card, CardHeader, Skeleton } from "@/components/ui/misc";
import { supabase } from "@/lib/supabase";
import { fmtDate } from "@/lib/dates";
import { usePeople } from "@/lib/queries";
import { LOW_BALANCE_LESSONS, type StudentBillingMonth } from "@/lib/types";
import { cn } from "@/lib/utils";

const money = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 });
const uah = (n: number) => `${money.format(n)} ₴`;

type Status = "off" | "none" | "unpaid" | "minus" | "empty" | "low" | "ok";
type Filter = "all" | "attention" | "minus";

// Worst first: the list is sorted by this order, then by name.
const RANK: Record<Status, number> = { unpaid: 0, minus: 0, empty: 1, low: 2, ok: 3, none: 4, off: 5 };
// Red: lessons were held that nobody has paid for (or nothing is left).
const isRed = (s: Status) => s === "unpaid" || s === "minus" || s === "empty";

function statusOf(r: StudentBillingMonth): Status {
  if (!r.enabled) return "off";
  if (!r.has_payments) return r.lessons_used > 0 ? "unpaid" : "none";
  if (r.lessons_left < 0) return "minus";
  if (r.lessons_left === 0) return "empty";
  if (r.lessons_left <= LOW_BALANCE_LESSONS) return "low";
  return "ok";
}

function StatusBadge({ r }: { r: StudentBillingMonth }) {
  const s = statusOf(r);
  if (s === "off") return <Badge tone="gray" title="Учень платить по-старому — уроки не списуються">Баланс не ведеться</Badge>;
  if (s === "none") return <Badge tone="gray">Оплат ще немає</Badge>;
  if (s === "unpaid") return <Badge tone="red" title="Уроки вже проводяться, а оплату ще не внесено"><AlertTriangle className="size-3" /> Без оплати · {r.lessons_used} {lessonsWord(r.lessons_used)}</Badge>;
  if (s === "minus") return <Badge tone="red"><AlertTriangle className="size-3" /> У мінусі: {-r.lessons_left} {lessonsWord(-r.lessons_left)}</Badge>;
  if (s === "empty") return <Badge tone="red"><AlertTriangle className="size-3" /> Уроки закінчились</Badge>;
  if (s === "low") return <Badge tone="sun"><AlertTriangle className="size-3" /> Закінчуються</Badge>;
  return <Badge tone="mint">Оплачено</Badge>;
}

const num = (v: unknown) => Number(v ?? 0);

export function useStudentBilling(month: string, enabled = true) {
  return useQuery({
    queryKey: ["student-billing", month],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("student_billing_month", { p_month: month });
      if (error) throw error;
      // numeric columns arrive as strings from PostgREST
      return ((data ?? []) as Record<string, unknown>[]).map((r): StudentBillingMonth => ({
        ...(r as unknown as StudentBillingMonth),
        paid_uah: num(r.paid_uah),
        balance_uah: num(r.balance_uah),
        price_per_lesson: r.price_per_lesson == null ? null : num(r.price_per_lesson),
        month_paid_uah: num(r.month_paid_uah),
      }));
    },
  });
}

/** Staff: who paid for how many lessons, how many were held this month and overall, and who runs out. */
export function StudentBilling({ rows, loading }: { rows: StudentBillingMonth[]; loading: boolean }) {
  const { data: students = [] } = usePeople(["student"]);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  // Inactive students drop out unless something happened to them this month.
  const relevant = useMemo(
    () => rows.filter((r) => r.is_active || r.month_used > 0 || r.month_payments > 0),
    [rows],
  );
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return relevant
      .filter((r) => {
        const s = statusOf(r);
        if (filter === "minus" && !isRed(s)) return false;
        if (filter === "attention" && !(isRed(s) || s === "low")) return false;
        return !needle || r.full_name.toLowerCase().includes(needle);
      })
      .sort((a, b) => RANK[statusOf(a)] - RANK[statusOf(b)] || a.full_name.localeCompare(b.full_name, "uk"));
  }, [relevant, filter, q]);

  const totals = useMemo(() => {
    let paid = 0, bought = 0, used = 0, low = 0, minus = 0;
    for (const r of relevant) {
      paid += r.month_paid_uah;
      bought += r.month_lessons_bought;
      used += r.month_used;
      const s = statusOf(r);
      if (s === "low") low++;
      if (isRed(s)) minus++;
    }
    return { paid, bought, used, low, minus };
  }, [relevant]);

  const person = open ? students.find((s) => s.id === open) : undefined;

  if (loading) return <Skeleton className="h-64" />;
  if (relevant.length === 0) {
    return <EmptyState title="Учнів ще немає" text="Щойно в школі з'являться учні, тут буде видно їхні оплати й залишок уроків." emotion="sleepy" />;
  }

  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Оплачено за місяць" value={uah(totals.paid)} strong />
        <Stat label="Уроків куплено" value={totals.bought} />
        <Stat label="Уроків проведено" value={totals.used} />
        <Stat
          label={totals.minus ? "у мінусі або без оплати" : "уроки закінчуються"}
          value={totals.minus ? `${totals.minus} ${studentsWord(totals.minus)}` : `${totals.low} ${studentsWord(totals.low)}`}
          tone={totals.minus ? "text-red-600" : totals.low ? "text-amber-600" : undefined}
          hint={totals.minus && totals.low ? `і ще ${totals.low} — закінчуються` : undefined}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="Фільтр учнів"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: `Усі · ${relevant.length}` },
            { value: "attention", label: `Закінчуються · ${totals.low + totals.minus}` },
            { value: "minus", label: `У мінусі · ${totals.minus}` },
          ]}
        />
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-mute" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Пошук учня" className="pl-10" aria-label="Пошук учня" />
        </div>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <caption className="sr-only">Оплати учнів і залишок уроків</caption>
          <thead className="border-b border-line bg-seal-50/50 text-left text-xs text-mute uppercase">
            <tr>
              <th scope="col" className="px-4 py-3 font-semibold">Учень</th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">Оплачено<span className="block font-medium normal-case">за місяць</span></th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">Проведено<span className="block font-medium normal-case">за місяць</span></th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">Оплачено<span className="block font-medium normal-case">уроків усього</span></th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">Проведено<span className="block font-medium normal-case">усього</span></th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">Залишок</th>
              <th scope="col" className="px-4 py-3 font-semibold">Стан</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {list.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-mute">{q ? "Нікого не знайдено" : "Тут порожньо — у всіх учнів вистачає оплачених уроків"}</td></tr>
            )}
            {list.map((r) => {
              const s = statusOf(r);
              const tracked = s !== "off" && s !== "none";
              return (
                <tr
                  key={r.student_id}
                  onClick={() => {
                    setOpen(open === r.student_id ? null : r.student_id);
                    requestAnimationFrame(() => document.getElementById("student-payments-detail")?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
                  }}
                  className={cn(
                    "cursor-pointer transition",
                    isRed(s) ? "bg-red-50/60 hover:bg-red-50" : s === "low" ? "bg-amber-50/60 hover:bg-amber-50" : "hover:bg-seal-50/60",
                    open === r.student_id && "outline-2 -outline-offset-2 outline-seal-300",
                    !r.is_active && "opacity-60",
                  )}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={r.full_name} src={r.avatar_url} size={32} />
                      <div className="min-w-0">
                        <button type="button" className="cursor-pointer text-left font-semibold hover:underline" aria-expanded={open === r.student_id}>{r.full_name}</button>
                        {r.last_paid_on && <div className="text-xs text-mute">остання оплата {fmtDate(r.last_paid_on, "d MMMM")}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.month_payments ? (
                      <>
                        <div className="font-semibold">{uah(r.month_paid_uah)}</div>
                        <div className="text-xs text-mute">{r.month_lessons_bought} {lessonsWord(r.month_lessons_bought)}</div>
                      </>
                    ) : <span className="text-mute">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">{r.month_used || <span className="text-mute">0</span>}</td>
                  <td className="px-4 py-3 text-right">{tracked ? r.lessons_paid : <span className="text-mute">—</span>}</td>
                  <td className="px-4 py-3 text-right">{tracked ? r.lessons_used : <span className="text-mute">—</span>}</td>
                  <td className={cn("px-4 py-3 text-right font-display text-base font-bold", isRed(s) ? "text-red-600" : s === "low" ? "text-amber-600" : "text-ocean-900")}>
                    {tracked ? r.lessons_left : <span className="text-sm font-normal text-mute">—</span>}
                    {tracked && r.upcoming > Math.max(r.lessons_left, 0) && (
                      <div className="text-xs font-medium text-mute" title="Заплановано в розкладі">у розкладі {r.upcoming}</div>
                    )}
                  </td>
                  <td className="px-4 py-3"><StatusBadge r={r} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      {open && (
        <Card id="student-payments-detail" className="scroll-mt-24">
          <CardHeader title={`Оплати · ${rows.find((r) => r.student_id === open)?.full_name ?? ""}`} description="Баланс уроків, історія оплат і нова оплата" />
          <div className="p-5 sm:p-6">{person ? <PaymentsPanel student={person} /> : <Skeleton className="h-40" />}</div>
        </Card>
      )}
    </div>
  );
}

function studentsWord(n: number) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return "учнів";
  if (b === 1) return "учень";
  if (b >= 2 && b <= 4) return "учні";
  return "учнів";
}

function Stat({ label, value, strong, tone, hint }: { label: string; value: React.ReactNode; strong?: boolean; tone?: string; hint?: string }) {
  return (
    <div className="card p-5">
      <div className={cn("font-display font-bold text-ocean-900", strong ? "text-2xl" : "text-xl", tone)}>{value}</div>
      <div className="text-sm text-mute">{label}</div>
      {hint && <div className="mt-0.5 text-xs text-amber-700">{hint}</div>}
    </div>
  );
}

/** «Внести оплату» from the page header: pick a student, then the same form as on the student card. */
export function NewPaymentDialog({ rows, onClose }: { rows: StudentBillingMonth[]; onClose: () => void }) {
  const me = useMe();
  const qc = useQueryClient();
  const { data: students = [], isLoading } = usePeople(["student"]);
  const [studentId, setStudentId] = useState("");
  const active = students.filter((s) => s.is_active);
  const student = active.find((s) => s.id === studentId);
  const row = rows.find((r) => r.student_id === studentId);
  const done = () => {
    qc.invalidateQueries({ queryKey: ["student-billing"] });
    qc.invalidateQueries({ queryKey: ["student-balance", studentId] });
    qc.invalidateQueries({ queryKey: ["student-balances"] });
    qc.invalidateQueries({ queryKey: ["student-payments", studentId] });
    onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" title="Внести оплату" description="Оплачені уроки списуються по одному за кожен проведений урок — спершу зі старішого пакета.">
        <div className="grid gap-4">
          <Field label="Учень">
            <Select value={studentId} onChange={(e) => setStudentId(e.target.value)} disabled={isLoading} autoFocus>
              <option value="" disabled>{isLoading ? "Завантаження…" : "Оберіть учня"}</option>
              {active.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </Select>
          </Field>
          {row && row.has_payments && row.enabled && (
            <p className={cn("rounded-2xl p-3 text-sm", row.lessons_left <= 0 ? "bg-red-50 text-red-700" : row.lessons_left <= LOW_BALANCE_LESSONS ? "bg-amber-50 text-amber-900" : "bg-seal-50/70 text-ink-soft")}>
              <Wallet className="mr-1.5 inline size-4 align-[-3px]" />
              Зараз {row.lessons_left < 0 ? `у мінусі на ${-row.lessons_left} ${lessonsWord(-row.lessons_left)}` : `залишилось ${row.lessons_left} ${lessonsWord(row.lessons_left)}`} · оплачено {row.lessons_paid}, проведено {row.lessons_used}
            </p>
          )}
          {row && !row.has_payments && row.enabled && row.lessons_used > 0 && (
            <p className="rounded-2xl bg-red-50 p-3 text-sm text-red-700">
              <Wallet className="mr-1.5 inline size-4 align-[-3px]" />
              Уже проведено {row.lessons_used} {lessonsWord(row.lessons_used)} без оплати — вони спишуться з цього пакета
            </p>
          )}
          {student && !student.billing_enabled && (
            <p className="rounded-2xl bg-seal-50/70 p-3 text-sm text-mute">Для цього учня баланс не ведеться (платить по-старому). Оплата збережеться в історії, але уроки не списуватимуться, поки баланс не ввімкнуть на картці учня.</p>
          )}
          {student && (
            <PaymentForm key={student.id} student={student} lastPrice={row?.price_per_lesson ?? null} meId={me.id} onDone={done} onCancel={onClose} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
