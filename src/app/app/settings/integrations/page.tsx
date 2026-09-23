"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Copy, ExternalLink, Globe, Link2Off, Plug, Send, ShieldAlert, Video, CircleAlert } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/app/AppShell";
import { useMe } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Badge, Card, CardHeader, Skeleton } from "@/components/ui/misc";
import { callFunction } from "@/lib/supabase";

interface Status {
  telegram: { configured: boolean; bot_username: string | null; webhook_url: string | null; pending_updates: number; last_error: string | null };
  google: { client_configured: boolean; client_id: string | null; connected: boolean; account: { email: string | null; connected_at: string } | null; redirect_uri: string };
  site_url: string;
}

const GOOGLE_MESSAGES: Record<string, [string, "success" | "error"]> = {
  connected: ["Google Calendar підключено! Тепер кожен урок отримує посилання на Meet автоматично 🎉", "success"],
  denied: ["Доступ до Google не надано", "error"],
  expired: ["Сесія підключення застаріла — спробуйте ще раз", "error"],
  no_client: ["Спочатку збережіть Client ID і Client secret", "error"],
  no_refresh: ["Google не видав refresh token. Відкличте доступ у myaccount.google.com/permissions і підключіть ще раз", "error"],
  error: ["Помилка під час підключення Google", "error"],
};

function copy(text: string) {
  navigator.clipboard.writeText(text);
  toast.success("Скопійовано");
}

function Inner() {
  const me = useMe();
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const { data: st, isLoading } = useQuery({
    queryKey: ["integrations"],
    enabled: me.role === "admin",
    queryFn: () => callFunction<Status>("admin", { action: "integrations_status" }),
  });

  useEffect(() => {
    const g = params.get("google");
    if (g && GOOGLE_MESSAGES[g]) {
      const [msg, kind] = GOOGLE_MESSAGES[g];
      const reason = params.get("reason");
      (kind === "success" ? toast.success : toast.error)(msg, reason ? { description: reason, duration: 20_000 } : undefined);
      router.replace("/app/settings/integrations/");
    }
  }, [params, router]);

  if (me.role !== "admin") return <EmptyState title="Лише для адміністратора" emotion="sad" />;
  const refresh = () => qc.invalidateQueries({ queryKey: ["integrations"] });

  return (
    <div className="grid gap-6">
      <PageHeader title="Інтеграції" description="Telegram-бот, Google Meet і адреса сайту. Секрети зберігаються зашифровано у Supabase Vault." />
      {isLoading || !st ? (
        <div className="grid gap-6 lg:grid-cols-2"><Skeleton className="h-80" /><Skeleton className="h-80" /></div>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <TelegramBlock st={st} onChange={refresh} />
            <GoogleBlock st={st} onChange={refresh} />
          </div>
          <SiteBlock st={st} onChange={refresh} />
        </>
      )}
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 text-sm text-ink-soft">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-seal-100 text-xs font-bold text-seal-700">{n}</span>
      <span className="pt-0.5">{children}</span>
    </li>
  );
}

function TelegramBlock({ st, onChange }: { st: Status; onChange: () => void }) {
  const [token, setToken] = useState("");
  const save = useMutation({
    mutationFn: () => callFunction<{ bot_username: string }>("admin", { action: "save_telegram", token }),
    onSuccess: (r) => {
      toast.success(`Бот @${r.bot_username} підключено!`);
      setToken("");
      onChange();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => callFunction("admin", { action: "remove_telegram" }),
    onSuccess: () => {
      toast.success("Бота відключено");
      onChange();
    },
  });
  const test = useMutation({
    mutationFn: () => callFunction("admin", { action: "test_telegram" }),
    onSuccess: () => toast.success("Тестове повідомлення надіслано"),
    onError: (e: Error) => toast.error(e.message),
  });

  const t = st.telegram;
  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Send className="size-5 text-sky-500" /> Telegram-бот</span>}
        description="Заявки для менеджерів, нагадування та сповіщення для учнів і викладачів"
        action={t.configured ? <Badge tone="mint"><CheckCircle2 className="size-3" /> Працює</Badge> : <Badge tone="gray">Не налаштовано</Badge>}
      />
      <div className="grid gap-5 p-5 sm:p-6">
        {t.configured ? (
          <>
            <div className="rounded-2xl bg-sky-50 p-4 text-sm">
              <div className="font-semibold">@{t.bot_username}</div>
              <div className="mt-1 text-ink-soft">Webhook: {t.webhook_url ? "встановлено ✓" : "не встановлено"}{t.pending_updates ? ` · в черзі ${t.pending_updates}` : ""}</div>
              {t.last_error && <div className="mt-1 flex items-center gap-1.5 text-coral-700"><CircleAlert className="size-4" /> {t.last_error}</div>}
            </div>
            <ol className="grid gap-2">
              <Step n={1}>Кожен менеджер: <b>Налаштування → Підключити Telegram</b> — нові заявки приходитимуть з кнопками статусів.</Step>
              <Step n={2}>Учні та викладачі підключаються так само — отримують нагадування й оцінки.</Step>
            </ol>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline"><a href={`https://t.me/${t.bot_username}`} target="_blank" rel="noreferrer"><ExternalLink /> Відкрити бота</a></Button>
              <Button variant="soft" onClick={() => test.mutate()} loading={test.isPending}>Тестове повідомлення</Button>
              <Button variant="ghost" className="text-red-600" onClick={() => confirm("Відключити бота?") && remove.mutate()}><Link2Off /> Відключити</Button>
            </div>
          </>
        ) : (
          <ol className="grid gap-2">
            <Step n={1}>Відкрийте <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="font-semibold text-seal-700 underline">@BotFather</a> → <code>/newbot</code>, задайте ім&apos;я (напр. «Seal English») та username.</Step>
            <Step n={2}>Скопіюйте токен і вставте нижче — вебхук, команди й опис бота налаштуються автоматично.</Step>
            <Step n={3}>Необов&apos;язково: у BotFather встановіть аватар бота (файл <code>/brand/seal-english-icon-512.png</code>).</Step>
          </ol>
        )}
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="grid gap-3">
          <Field label={t.configured ? "Замінити токен" : "Токен бота"}>
            <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456789:AA…" type="password" autoComplete="off" />
          </Field>
          <Button type="submit" disabled={!token} loading={save.isPending}><Plug /> {t.configured ? "Оновити" : "Підключити бота"}</Button>
        </form>
      </div>
    </Card>
  );
}

function GoogleBlock({ st, onChange }: { st: Status; onChange: () => void }) {
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const g = st.google;
  const saveClient = useMutation({
    mutationFn: () => callFunction("admin", { action: "save_google_client", client_id: clientId, client_secret: secret }),
    onSuccess: () => {
      toast.success("OAuth-клієнт збережено. Тепер підключіть акаунт.");
      setClientId("");
      setSecret("");
      onChange();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const connect = useMutation({
    mutationFn: () => callFunction<{ url: string }>("google-oauth", { action: "start" }),
    onSuccess: (r) => (window.location.href = r.url),
    onError: (e: Error) => toast.error(e.message),
  });
  const disconnect = useMutation({
    mutationFn: () => callFunction("google-oauth", { action: "disconnect" }),
    onSuccess: () => {
      toast.success("Google відключено");
      onChange();
    },
  });

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Video className="size-5 text-emerald-600" /> Google Calendar + Meet</span>}
        description="Автоматичні посилання на Google Meet для кожного уроку й подій у календарі"
        action={g.connected ? <Badge tone="mint"><CheckCircle2 className="size-3" /> Підключено</Badge> : <Badge tone="gray">Не підключено</Badge>}
      />
      <div className="grid gap-5 p-5 sm:p-6">
        {g.connected ? (
          <>
            <div className="rounded-2xl bg-emerald-50 p-4 text-sm">
              Акаунт школи: <b>{g.account?.email ?? "—"}</b>
              <div className="mt-1 text-ink-soft">Уроки створюються в його календарі, учні й викладачі додаються як гості.</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => connect.mutate()} loading={connect.isPending}>Перепідключити</Button>
              <Button variant="ghost" className="text-red-600" onClick={() => confirm("Відключити Google? Нові уроки будуть без Meet.") && disconnect.mutate()}><Link2Off /> Відключити</Button>
            </div>
          </>
        ) : (
          <>
            <ol className="grid gap-2">
              <Step n={1}>У <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer" className="font-semibold text-seal-700 underline">Google Cloud Console</a> створіть проєкт і увімкніть <b>Google Calendar API</b>.</Step>
              <Step n={2}><b>OAuth consent screen</b>: тип External, додайте scope <code>calendar.events</code>, опублікуйте застосунок (<b>In production</b>) — інакше доступ злітатиме кожні 7 днів.</Step>
              <Step n={3}><b>Credentials → OAuth client ID → Web application</b>. У «Authorized redirect URIs» додайте:</Step>
            </ol>
            <button onClick={() => copy(g.redirect_uri)} className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-2xl bg-ocean-900 px-4 py-3 text-left font-mono text-xs text-seal-100">
              <span className="truncate">{g.redirect_uri}</span><Copy className="size-4 shrink-0" />
            </button>
            {g.client_configured ? (
              <>
                <p className="text-sm text-ink-soft">Клієнт <code>{g.client_id}</code> збережено. Увійдіть акаунтом Google школи (з нього створюватимуться зустрічі):</p>
                <Button onClick={() => connect.mutate()} loading={connect.isPending}><Globe /> Підключити акаунт Google</Button>
              </>
            ) : null}
          </>
        )}
        <form onSubmit={(e) => { e.preventDefault(); saveClient.mutate(); }} className="grid gap-3 border-t border-line pt-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Client ID"><Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="….apps.googleusercontent.com" /></Field>
            <Field label="Client secret"><Input value={secret} onChange={(e) => setSecret(e.target.value)} type="password" placeholder="GOCSPX-…" autoComplete="off" /></Field>
          </div>
          <Button type="submit" variant={g.client_configured ? "outline" : "primary"} disabled={!clientId || !secret} loading={saveClient.isPending}>
            {g.client_configured ? "Замінити OAuth-клієнт" : "Зберегти OAuth-клієнт"}
          </Button>
        </form>
      </div>
    </Card>
  );
}

function SiteBlock({ st, onChange }: { st: Status; onChange: () => void }) {
  const [url, setUrl] = useState(st.site_url);
  const save = useMutation({
    mutationFn: () => callFunction("admin", { action: "set_site_url", url }),
    onSuccess: () => {
      toast.success("Адресу збережено");
      onChange();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const mismatch = typeof window !== "undefined" && !window.location.origin.startsWith("http://localhost") && url.replace(/\/$/, "") !== window.location.origin;
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Globe className="size-5 text-seal-600" /> Адреса сайту</span>} description="Використовується в посиланнях з Telegram і після підключення Google" />
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="grid gap-3 p-5 sm:grid-cols-[1fr_auto] sm:items-end sm:p-6">
        <Field label="URL"><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://sealenglish.com.ua" /></Field>
        <Button type="submit" loading={save.isPending}>Зберегти</Button>
        {mismatch && (
          <button type="button" onClick={() => setUrl(window.location.origin)} className="flex cursor-pointer items-center gap-2 text-left text-sm text-coral-700 sm:col-span-2">
            <ShieldAlert className="size-4" /> Ви зараз на {window.location.origin} — використати цю адресу?
          </button>
        )}
      </form>
    </Card>
  );
}

export default function IntegrationsPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
