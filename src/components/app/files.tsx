"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { FileText, Image as ImageIcon, Paperclip, UploadCloud, X, Download, Loader2 } from "lucide-react";
import { signedUrl, supabase } from "@/lib/supabase";
import type { Attachment } from "@/lib/types";
import { cn, formatBytes, safeFileName } from "@/lib/utils";

const MAX_MB = 25;

export async function uploadFiles(bucket: "materials" | "homework", prefix: string, files: File[]): Promise<Attachment[]> {
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
  const add = (list: FileList | null) => {
    if (!list) return;
    const next = multiple ? [...files, ...Array.from(list)] : Array.from(list).slice(0, 1);
    onChange(next.slice(0, 10));
  };
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
        <span className="text-xs text-mute">до {MAX_MB} МБ на файл</span>
      </button>
      <input ref={ref} type="file" className="hidden" multiple={multiple} accept={accept} onChange={(e) => add(e.target.files)} />
      {files.length > 0 && (
        <ul className="mt-3 grid gap-2">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2 text-sm">
              <Paperclip className="size-4 text-mute" />
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

export function AttachmentList({ items, bucket = "homework" }: { items: Attachment[]; bucket?: "materials" | "homework" }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!items?.length) return null;
  const open = async (a: Attachment) => {
    try {
      if (a.url) return window.open(a.url, "_blank");
      if (!a.path) return;
      setBusy(a.path);
      window.open(await signedUrl(bucket, a.path), "_blank");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не вдалося відкрити файл");
    } finally {
      setBusy(null);
    }
  };
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {items.map((a) => {
        const img = a.type?.startsWith("image/");
        return (
          <li key={a.path ?? a.url ?? a.name}>
            <button onClick={() => open(a)} className="flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-line bg-white px-3 py-2.5 text-left text-sm transition hover:border-seal-300 hover:shadow-soft">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-seal-50 text-seal-600">
                {img ? <ImageIcon className="size-4" /> : <FileText className="size-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{a.name}</span>
                {a.size ? <span className="text-xs text-mute">{formatBytes(a.size)}</span> : null}
              </span>
              {busy === a.path ? <Loader2 className="size-4 animate-spin text-mute" /> : <Download className="size-4 text-mute" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
