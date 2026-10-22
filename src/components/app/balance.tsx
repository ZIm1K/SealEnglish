"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Phone, Plus, Send, Trash2, Wallet } from "lucide-react";
import { useMe } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Badge, Card, CardHeader, Skeleton } from "@/components/ui/misc";
import { SITE } from "@/content/site";
import { humanizeError, supabase } from "@/lib/supabase";
import { useStudentBalance } from "@/lib/queries";
import { fmtDate } from "@/lib/dates";
import { LOW_BALANCE_LESSONS, PAYMENT_METHOD_LABEL, type PaymentMethod, type Profile, type StudentBalance, type StudentPayment } from "@/lib/types";
import { cn } from "@/lib/utils";

const money = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const uah = (n: number) => `${money.format(n)} грн`;

/** 1 урок · 2 уроки · 5 уроків */
export function lessonsWord(n: number) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return "уроків";
  if (b === 1) return "урок";
  if (b >= 2 && b <= 4) return "уроки";
  return "уроків";
}

const isLow = (b: StudentBalance) => b.enabled && b.has_payments && b.lessons_left <= LOW_BALANCE_LESSONS;
const visible = (b?: StudentBalance | null): b is StudentBalance => !!b && b.enabled && b.has_payments;

function PayReminder({ b, compact }: { b: StudentBalance; compact?: boolean }) {
  const empty = b.lessons_left <= 0;
  return (
    <div className={cn("rounded-2xl p-4 text-sm", empty ? "bg-coral-50 text-coral-800" : "bg-amber-50 text-amber-900")}>
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="size-4 shrink-0" />
        {empty ? "Оплачені уроки закінчилися" : `Залишилось ${b.lessons_left} ${lessonsWord(b.lessons_left)}`}
      </div>
      <p className="mt-1">Щоб навчання не переривалося, зв&apos;яжіться з менеджером або викладачем і оплатіть наступний пакет уроків.</p>
      {!compact && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild size="sm" variant="white"><a href={SITE.social.telegram} target="_blank" rel="noreferrer"><Send /> Написати менеджеру</a></Button>
          <Button asChild size="sm" variant="white"><a href={`tel:${SITE.phone.replace(/\s/g, "")}`}><Phone /> {SITE.phone}</a></Button>
        </div>
      )}
    </div>
  );
}

/** Student dashboard (adult accounts only — the server hides the balance from kids and teens). */
export function BalanceCard() {
  const { data: b, isLoading } = useStudentBalance();
  if (isLoading) return <Skeleton className="h-40" />;
  if (!visible(b)) return null;
  const left = Math.max(b.lessons_left, 0);
  const pct = b.lessons_paid ? Math.min(100, (left / b.lessons_paid) * 100) : 0;
  return (
    <Card>
      <CardHeader title="Баланс" description={b.last_paid_on ? `Остання оплата ${fmtDate(b.last_paid_on, "d MMMM yyyy")}` : undefined} />
      <div className="grid gap-4 p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className={cn("font-display text-3xl font-bold", b.balance_uah < 0 ? "text-coral-600" : "text-ocean-900")}>{uah(b.balance_uah)}</div>
            <div className="text-sm text-mute">{b.price_per_lesson != null && `1 урок = ${uah(b.price_per_lesson)}`}</div>
          </div>
          <div className="text-right">
            <div className="font-display text-xl font-bold text-ocean-900">{left} <span className="text-sm font-medium text-mute">з {b.lessons_paid}</span></div>
            <div className="text-sm text-mute">{lessonsWord(left)} залишилось</div>
          </div>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-seal-100" role="progressbar" aria-valuenow={left} aria-valuemin={0} aria-valuemax={b.lessons_paid} aria-label="Оплачені уроки">
          <div className={cn("h-full rounded-full transition-all", isLow(b) ? "bg-amber-500" : "bg-seal-500")} style={{ width: `${pct}%` }} />
        </div>
        {b.lessons_left < 0 && <p className="text-sm text-coral-700">Проведено на {-b.lessons_left} {lessonsWord(-b.lessons_left)} більше, ніж оплачено.</p>}
        {isLow(b) && <PayReminder b={b} />}
      </div>
    </Card>
  );
}

/** Thin strip on every cabinet page while an adult student's paid lessons run low. */
export function LowBalanceBanner({ profile }: { profile: Profile }) {
  const on = profile.role === "student" && profile.age_group === "adults";
  const { data: b } = useStudentBalance(undefined, on);
  if (!on || !visible(b) || !isLow(b)) return null;
  const empty = b.lessons_left <= 0;
  return (
    <Link href="/app/" className={cn("flex items-center gap-2 px-4 py-2 text-sm font-medium text-white sm:px-6 lg:px-8", empty ? "bg-coral-500" : "bg-amber-500")}>
      <Wallet className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        {empty ? "Оплачені уроки закінчилися." : `Залишилось ${b.lessons_left} оплачених ${lessonsWord(b.lessons_left)}.`} Зв&apos;яжіться з менеджером або викладачем, щоб оплатити наступний пакет.
      </span>
    </Link>
  );
}

/** Staff list badge: paid lessons left. */
export function BalanceBadge({ b }: { b?: StudentBalance }) {
  if (!visible(b)) return null;
  return (
    <Badge tone={b.lessons_left <= 0 ? "red" : isLow(b) ? "sun" : "mint"} title={`Баланс ${uah(b.balance_uah)}`}>
      <Wallet className="size-3" /> {b.lessons_left} {lessonsWord(b.lessons_left)}
    </Badge>
  );
}

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date());
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Staff: balance, manual payment entry and history for one student. */
export function PaymentsPanel({ student }: { student: Profile }) {
  const me = useMe();
  const qc = useQueryClient();
  const { data: b, isLoading } = useStudentBalance(student.id);
  const { data: payments = [] } = useQuery({
    queryKey: ["student-payments", student.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("student_payments").select("*").eq("student_id", student.id).order("paid_on", { ascending: false }).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((p) => ({ ...p, amount: Number(p.amount) })) as StudentPayment[];
    },
  });
  const [adding, setAdding] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["student-balance", student.id] });
    qc.invalidateQueries({ queryKey: ["student-balances"] });
    qc.invalidateQueries({ queryKey: ["student-payments", student.id] });
    qc.invalidateQueries({ queryKey: ["people"] });
    qc.invalidateQueries({ queryKey: ["student-billing"] });
  };
  const toggle = useMutation({
    mutationFn: async (on: boolean) => {
      const { error } = await supabase.from("profiles").update({ billing_enabled: on }).eq("id", student.id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error(humanizeError(e.message)),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("student_payments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Оплату видалено"); refresh(); },
    onError: (e: Error) => toast.error(humanizeError(e.message)),
  });
  const enabled = b?.enabled ?? student.billing_enabled;

  return (
    <div className="grid gap-5">
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-line p-3 text-sm">
        <span>
          <span className="block font-semibold">Вести баланс уроків</span>
          <span className="block text-mute">Кожен проведений урок списує один оплачений. Вимкніть для тих, хто платить по-старому.</span>
        </span>
        <input type="checkbox" checked={enabled} disabled={toggle.isPending} onChange={(e) => toggle.mutate(e.target.checked)} className="size-5 shrink-0 accent-seal-600" />
      </label>

      {enabled && (
        <>
          {isLoading ? <Skeleton className="h-20" /> : b && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Баланс" value={uah(b.balance_uah)} tone={b.balance_uah < 0 ? "text-coral-600" : undefined} />
              <Stat label="Залишилось" value={`${b.lessons_left} ${lessonsWord(b.lessons_left)}`} tone={isLow(b) ? "text-amber-600" : undefined} />
              <Stat label="Проведено" value={`${b.lessons_used} з ${b.lessons_paid}`} />
              <Stat label="Ціна уроку" value={b.price_per_lesson != null ? uah(b.price_per_lesson) : "—"} />
            </div>
          )}
          {b && b.has_payments && b.upcoming > Math.max(b.lessons_left, 0) && (
            <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">У розкладі {b.upcoming} {lessonsWord(b.upcoming)}, а оплачено ще {Math.max(b.lessons_left, 0)}.</p>
          )}
          {student.age_group !== "adults" && (
            <p className="rounded-2xl bg-seal-50/70 p-3 text-sm text-mute">Учень не бачить баланс і нагадування про оплату — їх бачать лише менеджери, адміністратор і викладач. Показується тільки дорослим.</p>
          )}

          {adding ? (
            <PaymentForm student={student} lastPrice={b?.price_per_lesson ?? null} meId={me.id} onDone={() => { setAdding(false); refresh(); }} onCancel={() => setAdding(false)} />
          ) : (
            <Button variant="ocean" onClick={() => setAdding(true)} className="justify-self-start"><Plus /> Внести оплату</Button>
          )}

          <div>
            <div className="mb-2 text-sm font-semibold">Історія оплат</div>
            {payments.length === 0 ? (
              <p className="rounded-2xl bg-seal-50/70 p-4 text-sm text-mute">Оплат ще немає. Поки їх немає, учень не бачить баланс і не отримує нагадувань.</p>
            ) : (
              <ul className="divide-y divide-line rounded-2xl border border-line">
                {payments.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 p-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{uah(p.amount)} · {p.lessons} {lessonsWord(p.lessons)} <span className="font-normal text-mute">({uah(round2(p.amount / p.lessons))} за урок)</span></div>
                      <div className="truncate text-mute">{[fmtDate(p.paid_on, "d MMMM yyyy"), p.method && PAYMENT_METHOD_LABEL[p.method], p.note].filter(Boolean).join(" · ")}</div>
                    </div>
                    <Button size="icon-sm" variant="ghost" className="text-mute hover:text-red-600" aria-label="Видалити оплату"
                      onClick={() => confirm(`Видалити оплату ${uah(p.amount)} від ${fmtDate(p.paid_on, "d MMMM")}? Баланс перерахується.`) && remove.mutate(p.id)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl bg-seal-50/70 p-3">
      <div className="text-xs text-mute">{label}</div>
      <div className={cn("font-display text-lg font-bold text-ocean-900", tone)}>{value}</div>
    </div>
  );
}

/** Lessons × price − discount = amount; the amount can still be typed by hand. */
export function PaymentForm({ student, lastPrice, meId, onDone, onCancel }: { student: Profile; lastPrice: number | null; meId: string; onDone: () => void; onCancel: () => void }) {
  const [lessons, setLessons] = useState("10");
  const [price, setPrice] = useState("");
  const [discount, setDiscount] = useState("");
  // null = follow lessons × price − discount; a typed amount wins
  const [typed, setTyped] = useState<string | null>(null);
  const [paidOn, setPaidOn] = useState(today());
  const [method, setMethod] = useState<PaymentMethod>("card");
  const [note, setNote] = useState("");

  const n = Math.round(Number(lessons));
  const d = Number(discount.replace(",", ".")) || 0;
  const p = Number(price.replace(",", ".")) || lastPrice || 0;
  const auto = n > 0 && p > 0 ? String(round2(n * p * (1 - (price ? d : 0) / 100))) : "";
  const amount = typed ?? auto;
  const sum = Number(amount.replace(",", "."));
  const perLesson = n > 0 && sum >= 0 ? round2(sum / n) : null;

  const save = useMutation({
    mutationFn: async () => {
      if (!(n >= 1 && n <= 500)) throw new Error("Вкажіть кількість уроків");
      if (!amount.trim() || !(sum >= 0)) throw new Error("Вкажіть суму оплати");
      const auto = `Пакет ${n} ${lessonsWord(n)}${d ? `, знижка ${d}%` : ""}`;
      const { error } = await supabase.from("student_payments").insert({
        student_id: student.id, paid_on: paidOn, amount: sum, lessons: n, method, note: note.trim() || auto, created_by: meId,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Оплату внесено"); onDone(); },
    onError: (e: Error) => toast.error(humanizeError(e.message)),
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="grid gap-4 rounded-2xl border border-seal-200 bg-seal-50/40 p-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Уроків у пакеті"><Input type="number" min={1} max={500} value={lessons} onChange={(e) => setLessons(e.target.value)} required /></Field>
        <Field label="Ціна уроку" hint="без знижки"><Input inputMode="decimal" value={price} onChange={(e) => { setPrice(e.target.value); setTyped(null); }} placeholder="450" /></Field>
        <Field label="Знижка, %"><Input inputMode="decimal" value={discount} onChange={(e) => { setDiscount(e.target.value); setTyped(null); }} placeholder="0" /></Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Сплачено, грн"><Input inputMode="decimal" value={amount} onChange={(e) => setTyped(e.target.value)} required /></Field>
        <Field label="Дата оплати"><Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} required /></Field>
        <Field label="Спосіб оплати">
          <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Коментар" hint="необов'язково"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="напр. оплатила мама, пакет на листопад" /></Field>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-ink-soft">{perLesson != null && Number.isFinite(perLesson) ? <>Списуватиметься <b>{uah(perLesson)}</b> за урок</> : " "}</span>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>Скасувати</Button>
          <Button type="submit" variant="ocean" loading={save.isPending}><Wallet /> Зберегти оплату</Button>
        </div>
      </div>
    </form>
  );
}

