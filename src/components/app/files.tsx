"use client";
/* eslint-disable @next/next/no-img-element -- static export: previews are blob: or signed Supabase URLs */

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, ClipboardPaste, Download, ExternalLink, FileText, Image as ImageIcon, Loader2, Paperclip, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { signedUrl, supabase } from "@/lib/supabase";
import type { Attachment } from "@/lib/types";
import { cn, formatBytes, safeFileName } from "@/lib/utils";

const MAX_MB = 25;

type Bucket = "materials" | "homework";

export async function uploadFiles(bucket: Bucket, prefix: string, files: File[]): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const f of files) {
    if (f.size > MAX_MB * 1024 * 1024) throw new Error(`«${f.name}» більший за ${MAX_MB} МБ`);
    const path = `${prefix}/${crypto.randomUUID().slice(0, 8)}-${safeFileName(f.name)}`;
    const { error } = await supabase.storage.from(bucket).upload(path, f, { contentType: f.type || undefined, upsert: false });
    if (error) throw new Error(`Не вдалося завантажити «${f.name}»: ${error.message}`);
    out.push({ name: f.name, path, size: f.size, type: f.type });
  }
  return out;
}

const isImage = (type?: string) => !!type?.startsWith("image/");

/** Clipboard screenshots arrive as "image.png" — give them a readable, unique name. */
function clipboardFiles(data: DataTransfer | null): File[] {
  const files = Array.from(data?.files ?? []);
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  return files.map((f, i) => {
    if (!/^image\.\w+$/i.test(f.name)) return f;
    const ext = f.name.split(".").pop();
    return new File([f], `Скріншот ${stamp}${files.length > 1 ? ` (${i + 1})` : ""}.${ext}`, { type: f.type });
  });
}

function LocalThumb({ file }: { file: File }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const u = URL.createObjectURL(file);
    if (ref.current) ref.current.src = u;
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return <img ref={ref} alt="" className="size-full object-cover" />;
}

export function FilePicker({
  files, onChange, accept, multiple = true, label = "Перетягніть файли або натисніть, щоб обрати",
}: {
  files: File[];
  onChange: (f: File[]) => void;
  accept?: string;
  multiple?: boolean;
  label?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const add = (list: FileList | File[] | null) => {
    if (!list) return;
    const next = multiple ? [...files, ...Array.from(list)] : Array.from(list).slice(0, 1);
    onChange(next.slice(0, 10));
  };
  const addRef = useRef(add);
  useEffect(() => {
    addRef.current = add;
  });

  // Ctrl+V anywhere on the page/dialog adds a copied screenshot or file. Text pasted into a field is left alone.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const pasted = clipboardFiles(e.clipboardData);
      if (!pasted.length) return;
      const t = e.target as HTMLElement | null;
      const editable = !!t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA");
      if (editable && e.clipboardData?.getData("text/plain")) return;
      e.preventDefault();
      addRef.current(pasted);
      toast.success(pasted.length > 1 ? `Додано ${pasted.length} файли з буфера` : `Додано з буфера: ${pasted[0].name}`);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  return (
    <div>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          add(e.dataTransfer.files);
        }}
        className={cn(
          "flex w-full cursor-pointer flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-4 py-6 text-center text-sm transition",
          drag ? "border-seal-500 bg-seal-50" : "border-line bg-white hover:border-seal-300 hover:bg-seal-50/40",
        )}
      >
        <UploadCloud className="size-7 text-seal-500" />
        <span className="font-medium text-ink-soft">{label}</span>
        <span className="text-xs text-mute">
          до {MAX_MB} МБ на файл<span className="hidden sm:inline"> · <ClipboardPaste className="inline size-3.5 align-[-2px]" /> або вставте скриншот Ctrl+V</span>
        </span>
      </button>
      <input ref={ref} type="file" className="hidden" multiple={multiple} accept={accept} onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      {files.length > 0 && (
        <ul className="mt-3 grid gap-2">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2 text-sm">
              {isImage(f.type) ? (
                <span className="size-11 shrink-0 overflow-hidden rounded-lg bg-seal-50 ring-1 ring-line"><LocalThumb file={f} /></span>
              ) : (
                <Paperclip className="size-4 text-mute" />
              )}
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="text-xs text-mute">{formatBytes(f.size)}</span>
              <button type="button" onClick={() => onChange(files.filter((_, j) => j !== i))} className="cursor-pointer rounded-lg p-1 text-mute hover:bg-seal-50 hover:text-ink" aria-label="Прибрати файл">
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Signed preview URLs for every stored image, fetched in one request and reused until shortly before they expire. */
function useImageUrls(bucket: Bucket, items: Attachment[]) {
  const paths = items.filter((a) => isImage(a.type) && a.path && !a.url).map((a) => a.path!);
  return useQuery({
    queryKey: ["signed-previews", bucket, paths],
    enabled: paths.length > 0,
    staleTime: 50 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, 3600);
      if (error) throw error;
      return Object.fromEntries((data ?? []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl])) as Record<string, string>;
    },
  });
}

export function AttachmentList({ items, bucket = "homework" }: { items: Attachment[]; bucket?: Bucket }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const { data: urls = {} } = useImageUrls(bucket, items ?? []);
  const images = (items ?? []).filter((a) => isImage(a.type));
  const others = (items ?? []).filter((a) => !isImage(a.type));
  const step = (d: number) => setViewing((v) => (v == null ? v : (v + d + images.length) % images.length));
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  });
  useEffect(() => {
    if (viewing == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") stepRef.current(-1);
      if (e.key === "ArrowRight") stepRef.current(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewing]);
  if (!items?.length) return null;

  const srcOf = (a: Attachment) => a.url ?? (a.path ? urls[a.path] : undefined);

  const open = async (a: Attachment, download = false) => {
    try {
      if (a.url) return window.open(a.url, "_blank");
      if (!a.path) return;
      setBusy(a.path);
      if (download) {
        const { data, error } = await supabase.storage.from(bucket).createSignedUrl(a.path, 60, { download: a.name });
        if (error) throw error;
        window.location.assign(data.signedUrl);
      } else {
        window.open(await signedUrl(bucket, a.path), "_blank");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не вдалося відкрити файл");
    } finally {
      setBusy(null);
    }
  };

  const current = viewing == null ? null : images[viewing];

  return (
    <div className="grid gap-3">
      {images.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {images.map((a, i) => {
            const src = srcOf(a);
            return (
              <li key={a.path ?? a.url ?? a.name}>
                <button
                  type="button"
                  onClick={() => setViewing(i)}
                  className="group relative block aspect-[4/3] w-full cursor-zoom-in overflow-hidden rounded-2xl border border-line bg-seal-50 transition hover:border-seal-300 hover:shadow-soft"
                  aria-label={`Переглянути ${a.name}`}
                >
                  {src ? (
                    <img src={src} alt={a.name} loading="lazy" className="size-full object-cover transition duration-300 group-hover:scale-[1.03]" />
                  ) : (
                    <span className="flex size-full items-center justify-center text-seal-400"><ImageIcon className="size-6" /></span>
                  )}
                  <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-ocean-950/70 to-transparent px-2.5 pt-6 pb-1.5 text-left text-xs font-medium text-white">
                    {a.name}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {others.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {others.map((a) => (
            <li key={a.path ?? a.url ?? a.name}>
              <button onClick={() => open(a)} className="flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-line bg-white px-3 py-2.5 text-left text-sm transition hover:border-seal-300 hover:shadow-soft">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-seal-50 text-seal-600">
                  <FileText className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{a.name}</span>
                  {a.size ? <span className="text-xs text-mute">{formatBytes(a.size)}</span> : null}
                </span>
                {busy === a.path ? <Loader2 className="size-4 animate-spin text-mute" /> : <Download className="size-4 text-mute" />}
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={current != null} onOpenChange={(o) => !o && setViewing(null)}>
        {current && (
          <DialogContent
            size="xl"
            title={<span className="block truncate">{current.name}</span>}
            description={[formatBytes(current.size), images.length > 1 ? `${viewing! + 1} з ${images.length}` : ""].filter(Boolean).join(" · ") || undefined}
          >
            <div className="relative flex items-center justify-center overflow-hidden rounded-2xl bg-ocean-950/[0.04]">
              {srcOf(current) ? (
                <img src={srcOf(current)} alt={current.name} className="max-h-[65dvh] w-auto max-w-full object-contain" />
              ) : (
                <Loader2 className="my-24 size-6 animate-spin text-mute" />
              )}
              {images.length > 1 && (
                <>
                  <button type="button" onClick={() => step(-1)} aria-label="Попереднє фото" className="absolute left-2 flex size-10 cursor-pointer items-center justify-center rounded-full bg-white/90 text-ink shadow-soft transition hover:bg-white">
                    <ChevronLeft className="size-5" />
                  </button>
                  <button type="button" onClick={() => step(1)} aria-label="Наступне фото" className="absolute right-2 flex size-10 cursor-pointer items-center justify-center rounded-full bg-white/90 text-ink shadow-soft transition hover:bg-white">
                    <ChevronRight className="size-5" />
                  </button>
                </>
              )}
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => open(current)}><ExternalLink /> Відкрити в новій вкладці</Button>
              <Button variant="soft" size="sm" onClick={() => open(current, true)} loading={busy === current.path}><Download /> Завантажити</Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
