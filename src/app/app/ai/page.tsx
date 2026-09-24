"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bot, Coins, Flag, Save, TrendingUp, Users } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/app/AppShell";
import { useMe } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Field, Input, Segmented } from "@/components/ui/form";
import { Badge, Card, CardHeader, Skeleton } from "@/components/ui/misc";
import { callFunction, supabase } from "@/lib/supabase";
import { useGroups } from "@/lib/queries";
import { ROLE_LABEL, type Role } from "@/lib/types";
import { cn } from "@/lib/utils";

interface AiSettings {
  enabled: boolean;
  tutor_enabled: boolean;
  review_enabled: boolean;
  lesson_enabled: boolean;
  risk_enabled: boolean;
  parent_reports_enabled: boolean;
  level_test_enabled: boolean;
  night_reply_enabled: boolean;
  model_main: string;
  model_fast: string;
  tutor_daily_messages: number;
  tutor_daily_usd: number;
  global_daily_usd: number;
  pilot_group_ids: string[];
  practice_retention_days: number;
  usd_rate: number;
  avg_check_uah: number;
  pricing: Record<string, { input: number; output: number; cache_read: number; cache_write: number }>;
}

interface Report {
  total_usd: number;
  today_usd: number;
  calls: number;
  active_students: number;
  cache_read_tokens: number;
  input_tokens: number;
  by_feature: { feature: string; calls: number; usd: number }[];
  by_day: { day: string; usd: number }[];
  top_users: { user_id: string | null; full_name: string | null; role: Role | null; calls: number; usd: number }[];
  practice_students_7d: number;
  flagged_open: number;
}

const FEATURE_LABEL: Record<string, string> = {
  tutor: "Тренер (діалог)",
  practice_summary: "Підсумки практики",
  review: "Перевірка ДЗ",
  lesson_summary: "Підсумки уроків",
  risk: "Ризик відтоку",
  level_test: "Тест рівня",
  bot_night: "Нічні відповіді бота",
};

/** FR-16: limits, cost accounting and feature flags of the AI module (phases 2–3 stay off until the pilot passes). */
export default function AiPage() {
  const me = useMe();
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const { data: settings, isLoading } = useQuery({
    queryKey: ["ai-settings"],
    enabled: me.role === "admin",
    queryFn: () => callFunction<AiSettings>("admin", { action: "ai_settings" }),
  });
  const { data: report } = useQuery({
    queryKey: ["ai-report", days],
    enabled: me.role === "admin",
    queryFn: async () => {
      const { data, error } = await supabase.rpc("ai_usage_report", { p_days: Number(days) });
      if (error) throw error;
      return data as Report;
    },
  });

  if (me.role !== "admin") return <EmptyState title="Лише для адміністратора" emotion="sad" />;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="ШІ-модуль"
        description="Викладач + ШІ: чернетки перевірки ДЗ, підсумки уроків, тренер для учнів. Ліміти й облік витрат."
        actions={<Segmented value={days} onChange={setDays} label="Період" options={[{ value: "7", label: "7 днів" }, { value: "30", label: "30 днів" }, { value: "90", label: "90 днів" }]} />}
      />
      {report && settings && <UsageCards report={report} settings={settings} days={Number(days)} />}
      {isLoading || !settings ? <Skeleton className="h-96" /> : <SettingsForm key={JSON.stringify(settings)} initial={settings} />}
      {report && <UsageDetails report={report} rate={settings?.usd_rate ?? 42} />}
    </div>
  );
}

function UsageCards({ report, settings, days }: { report: Report; settings: AiSettings; days: number }) {
  const uah = report.total_usd * settings.usd_rate;
  const perStudentMonth = report.active_students ? (uah / report.active_students) * (30 / days) : 0;
  const share = settings.avg_check_uah ? (perStudentMonth / settings.avg_check_uah) * 100 : 0;
  const practiceShare = report.active_students ? (report.practice_students_7d / report.active_students) * 100 : 0;
  const cacheShare = report.input_tokens + report.cache_read_tokens ? (report.cache_read_tokens / (report.input_tokens + report.cache_read_tokens)) * 100 : 0;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Stat icon={Coins} label={`Витрати за ${days} дн.`} value={`$${report.total_usd.toFixed(2)}`} sub={`≈ ${Math.round(uah).toLocaleString("uk-UA")} ₴ · сьогодні $${report.today_usd.toFixed(2)} з $${settings.global_daily_usd}`} />
      <Stat icon={TrendingUp} label="На учня за місяць" value={`${perStudentMonth.toFixed(0)} ₴`} sub={`${share.toFixed(1)}% середнього чеку · ціль ≤ 3% (NFR-06)`} warn={share > 3} />
      <Stat icon={Users} label="Практикуються щотижня" value={`${practiceShare.toFixed(0)}%`} sub={`${report.practice_students_7d} з ${report.active_students} учнів · критерій пілоту ≥ 30%`} warn={report.active_students > 0 && practiceShare < 30} />
      <Stat icon={Flag} label="Позначені сесії" value={report.flagged_open} sub={`кеш промпта: ${cacheShare.toFixed(0)}% вхідних токенів`} warn={report.flagged_open > 0} href="/app/practice/" />
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub, warn, href }: { icon: typeof Coins; label: string; value: React.ReactNode; sub?: string; warn?: boolean; href?: string }) {
  const body = (
    <div className={cn("card flex h-full items-start gap-4 p-5", warn && "border-amber-300")}>
      <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-2xl text-white", warn ? "bg-amber-500" : "bg-gradient-to-br from-violet-400 to-seal-600")}><Icon className="size-5" /></span>
      <div className="min-w-0">
        <div className="font-display text-2xl font-bold text-ocean-900">{value}</div>
        <div className="text-sm font-medium text-ink-soft">{label}</div>
        {sub && <div className="mt-0.5 text-xs text-mute">{sub}</div>}
      </div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function SettingsForm({ initial }: { initial: AiSettings }) {
  const qc = useQueryClient();
  const { data: groups = [] } = useGroups();
  const [v, setV] = useState(initial);
  const set = <K extends keyof AiSettings>(k: K, val: AiSettings[K]) => setV((c) => ({ ...c, [k]: val }));
  const save = useMutation({
    mutationFn: () => callFunction<AiSettings>("admin", { action: "save_ai_settings", settings: v }),
    onSuccess: () => {
      toast.success("Налаштування ШІ збережено", { description: "Функції підхоплять зміни протягом хвилини" });
      qc.invalidateQueries({ queryKey: ["ai-settings"] });
      qc.invalidateQueries({ queryKey: ["ai-features"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const models = useMemo(() => Object.keys(v.pricing), [v.pricing]);
  const toggle = (k: keyof AiSettings, label: string, hint: string, phase?: string) => (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line p-3">
      <input type="checkbox" className="mt-1 size-4.5 accent-seal-600" checked={Boolean(v[k])} onChange={(e) => set(k, e.target.checked as never)} />
      <span className="text-sm">
        <span className="flex items-center gap-2 font-semibold text-ink">{label}{phase && <Badge tone="gray">{phase}</Badge>}</span>
        <span className="text-ink-soft">{hint}</span>
      </span>
    </label>
  );

  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><Bot className="size-5 text-violet-500" /> Функції</span>} description="Ключ Anthropic API задається в «Інтеграціях». Фази 2–3 вмикайте після критеріїв попередньої фази." />
        <div className="grid gap-3 p-5 sm:p-6">
          <label className={cn("flex cursor-pointer items-center justify-between gap-3 rounded-2xl p-4 text-sm font-semibold", v.enabled ? "bg-emerald-50 text-emerald-900" : "bg-seal-50 text-ink")}>
            ШІ-модуль увімкнено
            <input type="checkbox" className="size-5 accent-emerald-600" checked={v.enabled} onChange={(e) => set("enabled", e.target.checked)} />
          </label>
          {toggle("review_enabled", "Чернетки перевірки ДЗ", "ШІ пропонує оцінку й відгук, викладач підтверджує (FR-13)", "Ф1")}
          {toggle("lesson_enabled", "Підсумки уроків", "Нотатки викладача → лексика, граматика, помилки (FR-11)", "Ф1")}
          {toggle("tutor_enabled", "Текстовий тренер для учнів", "Практика між уроками з лімітами й модерацією (FR-14)", "Ф1")}
          {toggle("risk_enabled", "Ризик відтоку", "Нічний скоринг і пояснення для менеджера (FR-19)", "Ф2")}
          {toggle("parent_reports_enabled", "Звіти батькам у Telegram", "Щотижня, лише за згодою батьків (FR-20)", "Ф2")}
          {toggle("level_test_enabled", "Тест рівня для лідів", "Після заявки на сайті (FR-22)", "Ф3")}
          {toggle("night_reply_enabled", "Нічні відповіді бота", "21:00–08:00 ШІ відповідає на питання про школу (FR-23)", "Ф3")}
          {groups.length > 0 && (
            <Field label="Пілотні групи тренера" hint="порожньо — доступно всім учням">
              <div className="flex flex-wrap gap-2">
                {groups.map((g) => {
                  const on = v.pilot_group_ids.includes(g.id);
                  return (
                    <button key={g.id} type="button" aria-pressed={on} onClick={() => set("pilot_group_ids", on ? v.pilot_group_ids.filter((x) => x !== g.id) : [...v.pilot_group_ids, g.id])}
                      className={cn("cursor-pointer rounded-full px-3 py-1.5 text-sm font-medium transition", on ? "bg-ocean-800 text-white" : "bg-seal-50 text-ink-soft hover:bg-seal-100")}>
                      {g.name}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}
        </div>
      </Card>
      <Card>
        <CardHeader title="Ліміти, моделі й ціни" description="Ціни провайдера змінюються — перевіряйте щокварталу (ADR-07)." />
        <div className="grid gap-4 p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Повідомлень/день" hint="на учня"><Input type="number" min={0} max={500} value={v.tutor_daily_messages} onChange={(e) => set("tutor_daily_messages", Number(e.target.value))} /></Field>
            <Field label="$/день" hint="на учня"><Input type="number" min={0} step={0.05} value={v.tutor_daily_usd} onChange={(e) => set("tutor_daily_usd", Number(e.target.value))} /></Field>
            <Field label="$/день" hint="уся школа"><Input type="number" min={0} step={1} value={v.global_daily_usd} onChange={(e) => set("global_daily_usd", Number(e.target.value))} /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Основна модель" hint="діалог, перевірка ДЗ"><Input value={v.model_main} onChange={(e) => set("model_main", e.target.value.trim())} /></Field>
            <Field label="Швидка модель" hint="класифікація, підсумки"><Input value={v.model_fast} onChange={(e) => set("model_fast", e.target.value.trim())} /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Курс ₴/$"><Input type="number" min={1} step={0.5} value={v.usd_rate} onChange={(e) => set("usd_rate", Number(e.target.value))} /></Field>
            <Field label="Середній чек, ₴"><Input type="number" min={1} step={10} value={v.avg_check_uah} onChange={(e) => set("avg_check_uah", Number(e.target.value))} /></Field>
            <Field label="Зберігати текст" hint="днів"><Input type="number" min={7} max={365} value={v.practice_retention_days} onChange={(e) => set("practice_retention_days", Number(e.target.value))} /></Field>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <caption className="mb-2 text-left text-xs font-semibold text-mute">Ціна, $ за 1 млн токенів</caption>
              <thead className="text-left text-xs text-mute">
                <tr><th scope="col" className="py-1 pr-2">Модель</th><th scope="col">Вхід</th><th scope="col">Вихід</th><th scope="col">Кеш: читання</th><th scope="col">Кеш: запис</th></tr>
              </thead>
              <tbody>
                {models.map((m) => (
                  <tr key={m}>
                    <td className="py-1 pr-2 font-mono text-xs">{m}</td>
                    {(["input", "output", "cache_read", "cache_write"] as const).map((k) => (
                      <td key={k} className="py-1 pr-2">
                        <Input aria-label={`${m} ${k}`} type="number" min={0} step={0.01} className="h-9" value={v.pricing[m][k]} onChange={(e) => set("pricing", { ...v.pricing, [m]: { ...v.pricing[m], [k]: Number(e.target.value) } })} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!models.includes(v.model_main) || !models.includes(v.model_fast) ? (
            <p className="text-xs text-coral-700">Для обраної моделі немає ціни — витрати рахуватимуться за ціною основної моделі.</p>
          ) : null}
          <p className="text-xs text-mute">Аудіо не зберігається; текст практики видаляється автоматично через вказану кількість днів (NFR-04).</p>
          <Button type="submit" loading={save.isPending} className="justify-self-end"><Save /> Зберегти</Button>
        </div>
      </Card>
    </form>
  );
}

function UsageDetails({ report, rate }: { report: Report; rate: number }) {
  const max = Math.max(0.0001, ...report.by_day.map((d) => d.usd));
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader title="Витрати за днями" description={`${report.calls} викликів`} />
        <div className="p-5 sm:p-6">
          {report.by_day.length === 0 ? <p className="text-sm text-mute">Ще немає даних.</p> : (
            <div className="flex h-40 items-end gap-1" role="img" aria-label="Графік витрат за днями">
              {report.by_day.map((d) => (
                <div key={d.day} className="group relative flex-1">
                  <div className="rounded-t bg-gradient-to-t from-seal-600 to-violet-400" style={{ height: `${Math.max(2, (d.usd / max) * 150)}px` }} />
                  <span className="pointer-events-none absolute bottom-full left-1/2 mb-1 hidden -translate-x-1/2 rounded-lg bg-ocean-900 px-2 py-1 text-[11px] whitespace-nowrap text-white group-hover:block">
                    {d.day}: ${Number(d.usd).toFixed(3)}
                  </span>
                </div>
              ))}
            </div>
          )}
          <ul className="mt-5 grid gap-2 text-sm">
            {report.by_feature.map((f) => (
              <li key={f.feature} className="flex items-center justify-between gap-3">
                <span>{FEATURE_LABEL[f.feature] ?? f.feature}</span>
                <span className="text-mute">{f.calls} викл. · <b className="text-ink">${Number(f.usd).toFixed(2)}</b> ({Math.round(Number(f.usd) * rate)} ₴)</span>
              </li>
            ))}
          </ul>
        </div>
      </Card>
      <Card>
        <CardHeader title="Найдорожчі користувачі" description="Звідки йдуть витрати (рукбук 11.3)" />
        <ul className="grid gap-2 p-5 sm:p-6">
          {report.top_users.length === 0 && <li className="text-sm text-mute">Ще немає даних.</li>}
          {report.top_users.map((u, i) => (
            <li key={u.user_id ?? `anon-${i}`} className="flex items-center justify-between gap-3 text-sm">
              <span>{u.full_name ?? "Без акаунта (бот, тест рівня)"} {u.role && <Badge tone="gray">{ROLE_LABEL[u.role]}</Badge>}</span>
              <span className="text-mute">{u.calls} · <b className="text-ink">${Number(u.usd).toFixed(2)}</b></span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
