"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, KeyRound, Link2Off, Save, Send, BellRing, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/app/AppShell";
import { useMe, useSession } from "@/components/app/session";
import { Seal } from "@/components/mascot/Seal";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Avatar, Badge, Card, CardHeader } from "@/components/ui/misc";
import { humanizeError, supabase } from "@/lib/supabase";
import { ROLE_LABEL } from "@/lib/types";

export default function SettingsPage() {
  const me = useMe();
  const { refreshProfile } = useSession();
  return (
    <div className="grid gap-6">
      <PageHeader title="Налаштування" description="Профіль, безпека та сповіщення" />
      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <ProfileCard key={me.id} onSaved={refreshProfile} />
        <div className="grid content-start gap-6">
          <TelegramCard onChanged={refreshProfile} />
          <PasswordCard />
        </div>
      </div>
    </div>
  );
}

function ProfileCard({ onSaved }: { onSaved: () => Promise<void> }) {
  const me = useMe();
  const [name, setName] = useState(me.full_name);
  const [phone, setPhone] = useState(me.phone ?? "");
  const [bio, setBio] = useState(me.bio ?? "");
  const [room, setRoom] = useState(me.meet_room_url ?? "");
  const fileRef = useRef<HTMLInputElement>(null);
  const teacherish = me.role !== "student";

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: name.trim(), phone: phone.trim() || null, bio: bio.trim() || null, meet_room_url: room.trim() || null })
        .eq("id", me.id);
      if (error) throw error;
      await onSaved();
    },
    onSuccess: () => toast.success("Профіль збережено"),
    onError: (e: Error) => toast.error(humanizeError(e.message)),
  });

  const uploadAvatar = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Оберіть зображення (JPG, PNG або WebP)");
    if (file.size > 2 * 1024 * 1024) return toast.error("Фото має бути до 2 МБ");
    const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
    const path = `${me.id}/avatar-${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type });
    if (error) return toast.error(error.message);
    const url = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    const { error: pErr } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", me.id);
    if (pErr) return toast.error(pErr.message);
    // remove the previous file so old photos don't pile up in storage
    const old = me.avatar_url?.split("/avatars/")[1];
    if (old && old !== path) await supabase.storage.from("avatars").remove([decodeURIComponent(old)]);
    await onSaved();
    toast.success("Фото оновлено");
  };

  return (
    <Card>
      <CardHeader title="Профіль" description={`${ROLE_LABEL[me.role]} · ${me.email}`} />
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="grid gap-5 p-5 sm:p-6">
        <div className="flex items-center gap-4">
          <div className="relative">
            <Avatar name={me.full_name} src={me.avatar_url} size={72} />
            <button type="button" onClick={() => fileRef.current?.click()} className="absolute -right-1 -bottom-1 flex size-8 cursor-pointer items-center justify-center rounded-full bg-ocean-800 text-white shadow-soft hover:bg-ocean-700" aria-label="Змінити фото">
              <Camera className="size-4" />
            </button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => uploadAvatar(e.target.files?.[0])} />
          </div>
          <div className="text-sm text-mute">JPG або PNG, до 2 МБ</div>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Ім'я та прізвище"><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
          <Field label="Телефон"><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+380…" /></Field>
        </div>
        {teacherish && (
          <>
            <Field label="Коротко про себе" hint="бачать учні"><Textarea rows={3} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Сертифікати, досвід, улюблені теми…" /></Field>
            <Field label="Постійна кімната Google Meet" hint="використовується, якщо Google не підключено">
              <Input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="https://meet.google.com/abc-defg-hij" />
            </Field>
          </>
        )}
        <div className="flex justify-end"><Button type="submit" loading={save.isPending}><Save /> Зберегти</Button></div>
      </form>
    </Card>
  );
}

function TelegramCard({ onChanged }: { onChanged: () => Promise<void> }) {
  const me = useMe();
  const [link, setLink] = useState<string | null>(null);
  const { data: bot } = useQuery({
    queryKey: ["bot-username"],
    queryFn: async () => {
      const { data } = await supabase.from("app_settings").select("value").eq("key", "telegram_bot_username").maybeSingle();
      return (typeof data?.value === "string" ? data.value : null) as string | null;
    },
  });

  // poll until the bot confirms the link (the code expires in 15 minutes — stop polling then)
  useEffect(() => {
    if (!link || me.telegram_chat_id) return;
    const t = setInterval(() => onChanged(), 3000);
    const stop = setTimeout(() => {
      clearInterval(t);
      setLink(null);
    }, 15 * 60_000);
    return () => {
      clearInterval(t);
      clearTimeout(stop);
    };
  }, [link, me.telegram_chat_id, onChanged]);

  const connect = async () => {
    const { data, error } = await supabase.rpc("create_telegram_link");
    if (error) return toast.error(error.message);
    const url = `https://t.me/${bot}?start=link_${data}`;
    setLink(url);
    window.open(url, "_blank");
  };

  const unlink = async () => {
    if (!confirm("Відключити Telegram? Сповіщення перестануть надходити.")) return;
    const { error } = await supabase.rpc("unlink_telegram");
    if (error) return toast.error(error.message);
    await onChanged();
    toast.success("Telegram відключено");
  };

  const toggle = async (v: boolean) => {
    const { error } = await supabase.from("profiles").update({ notify_telegram: v }).eq("id", me.id);
    if (error) return toast.error(error.message);
    await onChanged();
  };

  return (
    <Card id="telegram" className="overflow-hidden">
      <div className="flex items-center gap-4 bg-gradient-to-br from-sky-50 to-seal-50 p-5 sm:p-6">
        <div className="w-20 shrink-0"><Seal crop="head" emotion={me.telegram_chat_id ? "joy" : "wink"} idle={false} /></div>
        <div>
          <h3 className="font-display font-semibold">Telegram-сповіщення</h3>
          <p className="mt-1 text-sm text-ink-soft">Нагадування про уроки, нові домашні завдання, оцінки{me.role !== "student" ? " і заявки" : ""} — одразу в Telegram.</p>
        </div>
      </div>
      <div className="grid gap-4 p-5 sm:p-6">
        {!bot ? (
          <p className="text-sm text-mute">Бот ще не налаштований адміністратором школи.</p>
        ) : me.telegram_chat_id ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <Badge tone="mint"><Send className="size-3" /> Підключено{me.telegram_username ? ` · @${me.telegram_username}` : ""}</Badge>
              <Button variant="ghost" size="sm" onClick={unlink}><Link2Off /> Відключити</Button>
            </div>
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-line p-3 text-sm">
              <span className="flex items-center gap-2 font-medium"><BellRing className="size-4 text-seal-600" /> Надсилати сповіщення</span>
              <input type="checkbox" checked={me.notify_telegram} onChange={(e) => toggle(e.target.checked)} className="size-5 accent-seal-600" />
            </label>
            <Button asChild variant="outline"><a href={`https://t.me/${bot}`} target="_blank" rel="noreferrer"><ExternalLink /> Відкрити бота @{bot}</a></Button>
          </>
        ) : (
          <>
            <Button onClick={connect} className="bg-[#2AABEE] shadow-none hover:bg-[#229ED9]"><Send /> Підключити Telegram</Button>
            {link && (
              <p className="text-sm text-ink-soft">
                Відкрийте бота й натисніть <b>Start</b>. Якщо вікно не відкрилося — <a className="font-semibold text-seal-700 underline" href={link} target="_blank" rel="noreferrer">перейдіть за посиланням</a>. Сторінка оновиться автоматично.
              </p>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

function PasswordCard() {
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      if (p1.length < 8) throw new Error("Пароль має містити щонайменше 8 символів");
      if (p1 !== p2) throw new Error("Паролі не збігаються");
      const { error } = await supabase.auth.updateUser({ password: p1 });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Пароль змінено");
      setP1("");
      setP2("");
    },
    onError: (e: Error) => toast.error(humanizeError(e.message)),
  });
  return (
    <Card>
      <CardHeader title="Пароль" description="Рекомендуємо змінити тимчасовий пароль після першого входу" />
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="grid gap-4 p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Новий пароль"><Input type="password" value={p1} onChange={(e) => setP1(e.target.value)} autoComplete="new-password" /></Field>
          <Field label="Повторіть"><Input type="password" value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="new-password" /></Field>
        </div>
        <div className="flex justify-end"><Button type="submit" variant="ocean" loading={save.isPending}><KeyRound /> Змінити пароль</Button></div>
      </form>
    </Card>
  );
}
