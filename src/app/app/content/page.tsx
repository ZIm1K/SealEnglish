"use client";
/* eslint-disable @next/next/no-img-element -- static export: covers come from Supabase Storage as-is */

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, Clapperboard, FileText, Loader2, MessageSquareText, Save, Wand2, XCircle } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/app/AppShell";
import { useMe } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Segmented, Textarea } from "@/components/ui/form";
import { Badge, Card, Skeleton } from "@/components/ui/misc";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { supabase } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/dates";
import { CaptionsEditor, CHANNEL_LABEL, ChannelPostEditor, EduEditor, isChannelPost, isEdu, isStory, StoryEditor, TextEditor, type ScriptJson, type TextPost } from "@/components/app/content-editor";

interface Item {
  id: string;
  kind: "video" | "text";
  pack_id: string | null;
  channel: string | null;
  status: string;
  title: string;
  script: ScriptJson;
  video_path: string | null;
  cover_path: string | null;
  image_path: string | null;
  duration_s: number | null;
  cost_usd: number;
  review_note: string | null;
  attempts: number;
  created_at: string;
  updated_at: string;
}

const STATUS: Record<string, { label: string; tone: "seal" | "coral" | "mint" | "sun" | "grape" | "gray" | "red" }> = {
  script: { label: "На затвердженні", tone: "sun" },
  script_rewrite: { label: "Чекає переписування", tone: "grape" },
  rewriting: { label: "Переписується", tone: "grape" },
  approved: { label: "У черзі на генерацію", tone: "seal" },
  rendering: { label: "Генерується", tone: "seal" },
  review: { label: "Готово", tone: "mint" },
  published: { label: "Опубліковано", tone: "mint" },
  rejected: { label: "Відхилено", tone: "gray" },
  failed: { label: "Помилка", tone: "red" },
};
const TABS = {
  todo: { label: "На затвердженні", statuses: ["script", "script_rewrite", "rewriting"] },
  work: { label: "У роботі", statuses: ["approved", "rendering"] },
  done: { label: "Готові", statuses: ["review", "published"] },
  archive: { label: "Архів", statuses: ["rejected", "failed"] },
} as const;
type Tab = keyof typeof TABS;

const publicUrl = (path: string | null) => (path ? supabase.storage.from("content").getPublicUrl(path).data.publicUrl : null);
export default function ContentPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <ContentInner />
    </Suspense>
  );
}

function ContentInner() {
  const me = useMe();
  const id = useSearchParams().get("id");
  if (me.role !== "admin") return <EmptyState title="Лише для адміністратора" />;
  return id ? <Editor id={id} /> : <ItemList />;
}

const CHANNEL_ORDER = ["tiktok", "stories", "threads", "telegram", "instagram"];

/** Items of one pack stay together (in channel order); items without a pack form their own groups. */
function groupByPack(items: Item[]) {
  const groups: { key: string; packed: boolean; items: Item[] }[] = [];
  for (const it of items) {
    const key = it.pack_id ?? it.id;
    const g = groups.find((x) => x.key === key);
    if (g) g.items.push(it);
    else groups.push({ key, packed: !!it.pack_id, items: [it] });
  }
  for (const g of groups) g.items.sort((a, b) => CHANNEL_ORDER.indexOf(a.channel ?? "") - CHANNEL_ORDER.indexOf(b.channel ?? ""));
  return groups.map((g) => ({ ...g, packed: g.packed && g.items.length > 1 }));
}

function ItemList() {
  const [tab, setTab] = useState<Tab>("todo");
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["content-items"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("content_items")
        .select("id, kind, pack_id, channel, status, title, script, video_path, cover_path, image_path, duration_s, cost_usd, review_note, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(150);
      if (error) throw error;
      return data as Item[];
    },
  });
  const counts = useMemo(
    () => Object.fromEntries(Object.entries(TABS).map(([k, t]) => [k, items.filter((i) => (t.statuses as readonly string[]).includes(i.status)).length])) as Record<Tab, number>,
    [items],
  );
  const shown = items.filter((i) => (TABS[tab].statuses as readonly string[]).includes(i.status));

  return (
    <>
      <PageHeader
        title="Контент-ферма"
        description="Раз на 2 дні ферма готує пакет: історія для TikTok, навчальне відео для Stories, пости Threads, Telegram та Instagram. Відредагуйте й затвердіть — хмара згенерує медіа (до 30 хв)."
      />
      <Segmented
        className="mb-5"
        label="Статус"
        value={tab}
        onChange={setTab}
        options={(Object.keys(TABS) as Tab[]).map((k) => ({ value: k, label: `${TABS[k].label}${counts[k] ? ` · ${counts[k]}` : ""}` }))}
      />
      {isLoading ? (
        <div className="grid gap-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : shown.length === 0 ? (
        <EmptyState title="Тут порожньо" text={tab === "todo" ? "Новий пакет з'являється раз на 2 дні о 09:00." : undefined} emotion="happy" />
      ) : (
        <div className="grid gap-6">
          {groupByPack(shown).map((group) => (
            <section key={group.key}>
              {group.packed && (
                <h2 className="mb-2 text-sm font-semibold text-ink-soft">
                  📦 Пакет від {fmtDateTime(group.items[group.items.length - 1].created_at)} · {group.items.length} матеріалів
                </h2>
              )}
              <div className="grid gap-3">
                {group.items.map((it) => {
                  const st = STATUS[it.status] ?? { label: it.status, tone: "gray" as const };
                  const cover = publicUrl(it.cover_path ?? it.image_path);
                  const fmt = it.channel ? CHANNEL_LABEL[it.channel] : it.kind === "text" ? "Текстовий пост" : isStory(it.script) ? "Історія" : "Навчальний ролик";
                  return (
                    <Link key={it.id} href={`/app/content/?id=${it.id}`} className="card flex items-center gap-4 p-4 transition hover:shadow-lift">
                      <div className="grid h-20 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-seal-50">
                        {cover ? <img src={cover} alt="" className="h-full w-full object-cover" /> : it.kind === "text" ? <FileText className="size-5 text-seal-500" /> : <Clapperboard className="size-5 text-seal-500" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={st.tone}>{st.label}</Badge>
                          <Badge tone="gray">{fmt}</Badge>
                          {it.duration_s && <span className="text-xs text-mute">{Math.round(it.duration_s)} с</span>}
                        </div>
                        <div className="mt-1 truncate font-semibold text-ink">{it.title}</div>
                        <div className="text-xs text-mute">
                          {fmtDateTime(it.created_at)} · ${Number(it.cost_usd).toFixed(2)}
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function Editor({ id }: { id: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: item, isLoading } = useQuery({
    queryKey: ["content-item", id],
    refetchInterval: (q) => (["approved", "rendering", "script_rewrite", "rewriting"].includes((q.state.data as Item | undefined)?.status ?? "") ? 15_000 : false),
    queryFn: async () => {
      const { data, error } = await supabase.from("content_items").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data as Item | null;
    },
  });
  // Unsaved edits live in `edit`; without edits the page shows the latest saved script.
  const [edit, setEdit] = useState<ScriptJson | null>(null);
  const draft = edit ?? item?.script ?? null;
  const dirty = edit !== null;
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");

  const update = useMutation({
    mutationFn: async (patch: Partial<Item>) => {
      const { error } = await supabase.from("content_items").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      setEdit(null);
      qc.invalidateQueries({ queryKey: ["content-item", id] });
      qc.invalidateQueries({ queryKey: ["content-items"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-96" />;
  if (!item || !draft) return <EmptyState title="Матеріал не знайдено" action={<Button variant="outline" onClick={() => router.push("/app/content/")}>До списку</Button>} />;

  const set = (next: ScriptJson) => setEdit(next);
  const editable = ["script", "review", "failed", "rejected"].includes(item.status);
  const st = STATUS[item.status] ?? { label: item.status, tone: "gray" as const };
  const video = publicUrl(item.video_path);
  const image = publicUrl(item.image_path);

  const save = () => update.mutate({ script: draft }, { onSuccess: () => toast.success("Збережено") });
  const noMedia = isChannelPost(draft) && draft.channel === "threads";
  const approve = () =>
    update.mutate(
      // attempts: the farm counts failed production runs per approval, so a new approval starts over.
      { script: draft, status: noMedia ? "review" : "approved", review_note: null, attempts: 0 },
      { onSuccess: () => toast.success("Затверджено", { description: "Ферма згенерує матеріал протягом ~30 хвилин і надішле в Telegram." }) },
    );
  const askRewrite = () =>
    update.mutate(
      { script: draft, status: "script_rewrite", review_note: note.trim() },
      {
        onSuccess: () => {
          setNoteOpen(false);
          setNote("");
          toast.success("Відправлено на переписування", { description: "Нова версія прийде в Telegram протягом ~30 хвилин." });
        },
      },
    );
  const reject = () => update.mutate({ status: "rejected" }, { onSuccess: () => toast("Відхилено") });

  return (
    <div className="pb-28">
      <PageHeader
        title={item.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={st.tone}>{st.label}</Badge>
            {draft.idea?.trend && <span className="text-sm">Тренд: {draft.idea.trend}</span>}
          </span>
        }
        actions={
          <Button variant="ghost" onClick={() => router.push("/app/content/")}>
            <ArrowLeft /> До списку
          </Button>
        }
      />

      {(item.status === "approved" || item.status === "rendering") && (
        <Card className="mb-5 flex items-center gap-3 p-4 text-sm text-ink-soft">
          <Loader2 className="size-5 animate-spin text-seal-500" /> Генерується: голоси, фони, рендер. Зазвичай до 30 хвилин — сторінка оновиться сама.
        </Card>
      )}
      {(item.status === "script_rewrite" || item.status === "rewriting") && (
        <Card className="mb-5 flex items-center gap-3 p-4 text-sm text-ink-soft">
          <Wand2 className="size-5 text-violet-500" /> ШІ переписує сценарій за вашим коментарем: «{item.review_note}»
        </Card>
      )}
      {item.status === "failed" && item.review_note && <Card className="mb-5 p-4 text-sm text-red-600">{item.review_note}</Card>}

      {(video || image) && (
        <Card className="mb-5 grid gap-5 p-5 sm:grid-cols-[minmax(0,320px)_1fr]">
          {video ? (
            <video src={video} controls playsInline className="aspect-[9/16] w-full rounded-2xl bg-black" />
          ) : (
            <img src={image!} alt="" className="w-full rounded-2xl" />
          )}
          <div className="text-sm text-ink-soft">
            <p className="font-semibold text-ink">Готово до публікації</p>
            <p className="mt-1">
              Завантажте відео й опублікуйте з підписами нижче. Хочете змінити — відредагуйте сценарій і натисніть «Затвердити» знову: відео перегенерується.
            </p>
            {video && (
              <Button asChild variant="outline" size="sm" className="mt-3">
                <a href={video} download target="_blank" rel="noreferrer">Завантажити MP4</a>
              </Button>
            )}
          </div>
        </Card>
      )}

      <fieldset disabled={!editable} className="grid gap-5">
        {isChannelPost(draft) ? (
          <ChannelPostEditor value={draft} onChange={set} />
        ) : isStory(draft) ? (
          <StoryEditor value={draft} onChange={set} />
        ) : isEdu(draft) ? (
          <EduEditor value={draft} onChange={set} />
        ) : (
          <TextEditor value={draft as TextPost & ScriptJson} onChange={set} />
        )}
        {(isStory(draft) || isEdu(draft)) && <CaptionsEditor value={draft} onChange={(c) => set({ ...draft, ...c })} />}
      </fieldset>

      {editable && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-white/95 px-4 py-3 backdrop-blur lg:left-72">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-end gap-2">
            {dirty && <span className="mr-auto text-sm text-mute">Є незбережені зміни</span>}
            <Button variant="ghost" onClick={reject} disabled={update.isPending}>
              <XCircle /> Відхилити
            </Button>
            <Button variant="outline" onClick={() => setNoteOpen(true)} disabled={update.isPending}>
              <MessageSquareText /> Переписати з коментарем
            </Button>
            <Button variant="soft" onClick={save} disabled={update.isPending || !dirty}>
              <Save /> Зберегти
            </Button>
            <Button onClick={approve} disabled={update.isPending}>
              {update.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} {item.status === "review" ? "Перегенерувати" : "Затвердити й згенерувати"}
            </Button>
          </div>
        </div>
      )}

      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent title="Що змінити?" description="ШІ перепише сценарій за вашим коментарем і надішле нову версію на затвердження.">
          <Textarea rows={5} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Напр.: зроби фінал смішнішим, прибери репліку про PSL, хай бариста буде чоловіком" />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setNoteOpen(false)}>Скасувати</Button>
            <Button onClick={askRewrite} disabled={!note.trim() || update.isPending}>
              <Wand2 /> Переписати
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

