"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Link2, Plus, PlayCircle, Search, Share2, Trash2, Type, Download, ExternalLink, X } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/app/AppShell";
import { useMe, isStaffRole } from "@/components/app/session";
import { FilePicker, uploadFiles } from "@/components/app/files";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { Field, Input, Segmented, Select, Textarea } from "@/components/ui/form";
import { Badge, Skeleton } from "@/components/ui/misc";
import { signedUrl, supabase } from "@/lib/supabase";
import { useGroups, usePeople } from "@/lib/queries";
import { fmtDate } from "@/lib/dates";
import { LEVELS, type Material, type MaterialKind } from "@/lib/types";
import { cn, formatBytes } from "@/lib/utils";

const KIND: Record<MaterialKind, { label: string; icon: typeof FileText; tone: string }> = {
  file: { label: "Файл", icon: FileText, tone: "from-seal-400 to-seal-600" },
  link: { label: "Посилання", icon: Link2, tone: "from-violet-400 to-violet-600" },
  video: { label: "Відео", icon: PlayCircle, tone: "from-coral-400 to-coral-600" },
  text: { label: "Нотатка", icon: Type, tone: "from-emerald-400 to-emerald-600" },
};

const SELECT = "*, owner:profiles!materials_owner_id_fkey(id, full_name, avatar_url), shares:material_shares(id, group_id, student_id, group:groups(name), student:profiles!material_shares_student_id_fkey(id, full_name, avatar_url))";

export default function MaterialsPage() {
  const me = useMe();
  const teacherish = me.role === "teacher" || isStaffRole(me.role);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"all" | MaterialKind>("all");
  const [level, setLevel] = useState("");
  const [creating, setCreating] = useState(false);
  const [sharing, setSharing] = useState<Material | null>(null);
  const [reading, setReading] = useState<Material | null>(null);
  const qc = useQueryClient();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["materials"],
    queryFn: async () => {
      const { data, error } = await supabase.from("materials").select(SELECT).order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Material[];
    },
  });

  const list = useMemo(
    () =>
      items.filter(
        (m) =>
          (kind === "all" || m.kind === kind) &&
          (!level || m.level === level) &&
          (!q || `${m.title} ${m.description ?? ""} ${m.tags.join(" ")}`.toLowerCase().includes(q.toLowerCase())),
      ),
    [items, kind, level, q],
  );

  const remove = useMutation({
    mutationFn: async (m: Material) => {
      if (m.storage_path) await supabase.storage.from("materials").remove([m.storage_path]);
      const { error } = await supabase.from("materials").delete().eq("id", m.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Матеріал видалено");
      qc.invalidateQueries({ queryKey: ["materials"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const open = async (m: Material) => {
    try {
      if (m.kind === "text") return setReading(m);
      if (m.url) return window.open(m.url, "_blank", "noopener");
      if (m.storage_path) window.open(await signedUrl("materials", m.storage_path), "_blank");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не вдалося відкрити");
    }
  };

  return (
    <div>
      <PageHeader
        title="Матеріали"
        description={teacherish ? "Бібліотека школи: завантажуйте й відкривайте доступ групам та учням" : "Матеріали від ваших викладачів"}
        actions={teacherish && <Button onClick={() => setCreating(true)}><Plus /> Додати матеріал</Button>}
      />
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-mute" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Пошук за назвою або тегом…" className="pl-10" />
        </div>
        <Segmented
          value={kind}
          onChange={setKind}
          options={[{ value: "all", label: "Усі" }, ...Object.entries(KIND).map(([k, v]) => ({ value: k as MaterialKind, label: v.label }))]}
        />
        <Select value={level} onChange={(e) => setLevel(e.target.value)} className="h-10 lg:w-36">
          <option value="">Усі рівні</option>
          {LEVELS.map((l) => <option key={l}>{l}</option>)}
        </Select>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-44" />)}</div>
      ) : list.length === 0 ? (
        <EmptyState
          title={items.length ? "Нічого не знайдено" : "Матеріалів поки немає"}
          text={teacherish ? "Додайте презентації, аудіо, посилання чи конспекти — і поділіться з групою в один клік." : "Коли викладач поділиться матеріалами, вони з'являться тут."}
          emotion={items.length ? "surprised" : "neutral"}
          action={teacherish && !items.length ? <Button onClick={() => setCreating(true)}><Plus /> Додати матеріал</Button> : undefined}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((m) => {
            const K = KIND[m.kind];
            const canManage = isStaffRole(me.role) || m.owner_id === me.id;
            return (
              <article key={m.id} className="card group flex flex-col p-5 transition hover:-translate-y-0.5 hover:shadow-lift">
                <div className="flex items-start justify-between gap-3">
                  <span className={cn("flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-soft", K.tone)}><K.icon className="size-5" /></span>
                  <div className="flex gap-1.5">
                    {m.level && <Badge tone="ocean">{m.level}</Badge>}
                    <Badge tone="gray">{K.label}</Badge>
                  </div>
                </div>
                <h3 className="mt-4 line-clamp-2 font-display font-semibold text-ocean-900">{m.title}</h3>
                {m.description && <p className="mt-1.5 line-clamp-2 text-sm text-ink-soft">{m.description}</p>}
                {m.tags.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">{m.tags.map((t) => <span key={t} className="rounded-md bg-seal-50 px-2 py-0.5 text-xs text-seal-700">#{t}</span>)}</div>
                )}
                <div className="mt-auto pt-4">
                  <div className="mb-3 text-xs text-mute">
                    {m.owner?.full_name ?? "—"} · {fmtDate(m.created_at)}{m.file_size ? ` · ${formatBytes(m.file_size)}` : ""}
                    {teacherish && (
                      <span className="block truncate">
                        Доступ: {m.shares?.length ? m.shares.map((s) => s.group?.name ?? s.student?.full_name).join(", ") : "лише персонал"}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="soft" onClick={() => open(m)}>
                      {m.kind === "file" ? <><Download /> Відкрити</> : m.kind === "text" ? <><Type /> Читати</> : <><ExternalLink /> Перейти</>}
                    </Button>
                    {teacherish && <Button size="sm" variant="outline" onClick={() => setSharing(m)}><Share2 /> Поділитися</Button>}
                    {canManage && (
                      <Button size="icon-sm" variant="ghost" className="ml-auto text-mute hover:text-red-600" onClick={() => confirm(`Видалити «${m.title}»?`) && remove.mutate(m)} aria-label="Видалити">
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {teacherish && <NewMaterialDialog open={creating} onOpenChange={setCreating} />}
      {sharing && <ShareDialog material={sharing} onClose={() => setSharing(null)} />}
      <Dialog open={!!reading} onOpenChange={(v) => !v && setReading(null)}>
        {reading && (
          <DialogContent title={reading.title} description={reading.description ?? undefined} size="lg">
            <div className="prose max-w-none leading-relaxed whitespace-pre-wrap text-ink-soft">{reading.body}</div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function NewMaterialDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const me = useMe();
  const qc = useQueryClient();
  const [kind, setKind] = useState<MaterialKind>("file");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [url, setUrl] = useState("");
  const [body, setBody] = useState("");
  const [level, setLevel] = useState("");
  const [tags, setTags] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const create = useMutation({
    mutationFn: async () => {
      let file: { path?: string; name?: string; size?: number; type?: string } = {};
      if (kind === "file") {
        if (!files[0]) throw new Error("Оберіть файл");
        const [up] = await uploadFiles("materials", me.id, files.slice(0, 1));
        file = up;
      }
      if ((kind === "link" || kind === "video") && !/^https?:\/\//.test(url)) throw new Error("Вкажіть посилання, що починається з https://");
      const { error } = await supabase.from("materials").insert({
        title: title.trim() || file.name || "Матеріал",
        description: description.trim() || null,
        kind,
        url: kind === "link" || kind === "video" ? url.trim() : null,
        body: kind === "text" ? body : null,
        storage_path: file.path ?? null,
        file_name: file.name ?? null,
        file_size: file.size ?? null,
        mime_type: file.type ?? null,
        level: level || null,
        tags: tags.split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean).slice(0, 8),
        owner_id: me.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Матеріал додано");
      qc.invalidateQueries({ queryKey: ["materials"] });
      onOpenChange(false);
      setTitle(""); setDescription(""); setUrl(""); setBody(""); setTags(""); setFiles([]);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Новий матеріал" description="Після створення поділіться ним з групою або учнем" size="lg">
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="grid gap-5">
          <Segmented value={kind} onChange={setKind} options={Object.entries(KIND).map(([k, v]) => ({ value: k as MaterialKind, label: v.label }))} />
          <Field label="Назва"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Unit 5 · Travel vocabulary" required={kind !== "file"} /></Field>
          {kind === "file" && <Field label="Файл"><FilePicker files={files} onChange={setFiles} multiple={false} /></Field>}
          {(kind === "link" || kind === "video") && (
            <Field label={kind === "video" ? "Посилання на відео (YouTube, Drive…)" : "Посилання"}>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" type="url" />
            </Field>
          )}
          {kind === "text" && <Field label="Текст"><Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Конспект, правило, список слів…" /></Field>}
          <Field label="Опис" hint="необов'язково"><Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Рівень">
              <Select value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="">Будь-який</option>
                {LEVELS.map((l) => <option key={l}>{l}</option>)}
              </Select>
            </Field>
            <Field label="Теги" hint="через кому"><Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="grammar, НМТ, speaking" /></Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Скасувати</Button>
            <Button type="submit" loading={create.isPending}><Plus /> Додати</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ShareDialog({ material, onClose }: { material: Material; onClose: () => void }) {
  const me = useMe();
  const qc = useQueryClient();
  const staff = isStaffRole(me.role);
  const { data: groups = [] } = useGroups();
  const { data: students = [] } = usePeople(["student"]);
  const [type, setType] = useState<"group" | "student">("group");
  const [target, setTarget] = useState("");
  // live list, so several groups/students can be added without reopening the dialog
  const { data: shares = material.shares ?? [] } = useQuery({
    queryKey: ["material-shares", material.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("material_shares")
        .select("id, group_id, student_id, group:groups(name), student:profiles!material_shares_student_id_fkey(id, full_name, avatar_url)")
        .eq("material_id", material.id);
      if (error) throw error;
      return (data ?? []) as unknown as NonNullable<Material["shares"]>;
    },
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["material-shares", material.id] });
    qc.invalidateQueries({ queryKey: ["materials"] });
  };

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("material_shares").insert({
        material_id: material.id,
        group_id: type === "group" ? target : null,
        student_id: type === "student" ? target : null,
        shared_by: me.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Доступ відкрито");
      setTarget("");
      refresh();
    },
    onError: (e: Error) => toast.error(e.message.includes("duplicate") ? "Вже поширено" : e.message),
  });

  const revoke = async (id: string) => {
    const { error } = await supabase.from("material_shares").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Доступ закрито");
    refresh();
  };

  const myGroups = staff ? groups : groups.filter((g) => g.teacher_id === me.id);
  const taken = new Set(shares.map((s) => s.group_id ?? s.student_id));

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent title="Поділитися матеріалом" description={material.title}>
        <div className="grid gap-5">
          {shares.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {shares.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-1.5 rounded-full bg-seal-100 py-1 pr-1.5 pl-3 text-sm font-medium text-seal-800">
                  {s.group?.name ?? s.student?.full_name}
                  <button onClick={() => revoke(s.id)} className="cursor-pointer rounded-full p-0.5 hover:bg-white" aria-label={`Закрити доступ: ${s.group?.name ?? s.student?.full_name ?? ""}`}><X className="size-3.5" /></button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-mute">Поки бачать лише викладачі й персонал.</p>
          )}
          <Segmented value={type} onChange={(v) => { setType(v); setTarget(""); }} label="Кому відкрити" options={[{ value: "group", label: "Групі" }, { value: "student", label: "Учню" }]} />
          <Select value={target} onChange={(e) => setTarget(e.target.value)} aria-label={type === "group" ? "Група" : "Учень"}>
            <option value="">Оберіть…</option>
            {type === "group"
              ? myGroups.filter((g) => !taken.has(g.id)).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)
              : students.filter((s) => s.is_active && !taken.has(s.id)).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </Select>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Готово</Button>
            <Button disabled={!target} loading={add.isPending} onClick={() => add.mutate()}><Share2 /> Відкрити доступ</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
