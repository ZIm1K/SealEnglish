"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Skeleton } from "@/components/ui/misc";
import { supabase } from "@/lib/supabase";
import { fmtDate } from "@/lib/dates";
import { MISTAKE_LABEL, type StudentMistake } from "@/lib/types";
import { cn } from "@/lib/utils";

const SOURCE_LABEL: Record<StudentMistake["source"], string> = {
  lesson: "урок",
  homework: "ДЗ",
  practice: "практика",
  teacher: "викладач",
};

/** FR-12: the mistake profile, updated from lessons, homework and practice. Teachers can resolve or remove items. */
export function MistakesProfile({ studentId, editable, limit = 30, compact }: { studentId: string; editable?: boolean; limit?: number; compact?: boolean }) {
  const qc = useQueryClient();
  const { data = [], isLoading } = useQuery({
    queryKey: ["mistakes", studentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("student_mistakes")
        .select("*")
        .eq("student_id", studentId)
        .order("resolved_at", { ascending: true, nullsFirst: true })
        .order("occurrences", { ascending: false })
        .order("last_seen_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as StudentMistake[];
    },
  });
  const act = useMutation({
    mutationFn: async ({ id, op }: { id: string; op: "resolve" | "reopen" | "delete" }) => {
      const q = supabase.from("student_mistakes");
      const { error } = op === "delete"
        ? await q.delete().eq("id", id)
        : await q.update({ resolved_at: op === "resolve" ? new Date().toISOString() : null }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mistakes", studentId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-24" />;
  if (!data.length) {
    return <p className="rounded-2xl bg-seal-50/70 p-4 text-sm text-mute">Поки порожньо. Помилки з&apos;являються після підсумків уроків, перевірки ДЗ і практики з Сілі.</p>;
  }
  return (
    <ul className="grid gap-2">
      {data.map((m) => (
        <li key={m.id} className={cn("flex items-start gap-3 rounded-2xl border border-line bg-white p-3", m.resolved_at && "opacity-55")}>
          <div className="min-w-0 flex-1 text-sm">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="grape">{MISTAKE_LABEL[m.category]}</Badge>
              {m.occurrences > 1 && <Badge tone="coral">×{m.occurrences}</Badge>}
              {m.resolved_at && <Badge tone="mint">виправлено</Badge>}
              {!compact && <span className="text-xs text-mute">{SOURCE_LABEL[m.source]} · {fmtDate(m.last_seen_at)}</span>}
            </div>
            <div className="mt-1.5">
              <span className="text-coral-700 line-through decoration-coral-300">{m.example}</span>
              <span className="mx-1.5 text-mute">→</span>
              <span className="font-medium text-emerald-700">{m.correction}</span>
            </div>
            {m.explanation && <div className="mt-0.5 text-xs text-ink-soft">{m.explanation}</div>}
          </div>
          {editable && (
            <div className="flex shrink-0 gap-1">
              {m.resolved_at ? (
                <Button size="icon-sm" variant="ghost" aria-label="Повернути в роботу" onClick={() => act.mutate({ id: m.id, op: "reopen" })}><RotateCcw className="size-4" /></Button>
              ) : (
                <Button size="icon-sm" variant="ghost" className="text-emerald-600" aria-label="Позначити як виправлену" onClick={() => act.mutate({ id: m.id, op: "resolve" })}><Check className="size-4" /></Button>
              )}
              <Button size="icon-sm" variant="ghost" className="text-mute hover:text-red-600" aria-label="Видалити" onClick={() => confirm("Видалити помилку з профілю?") && act.mutate({ id: m.id, op: "delete" })}><Trash2 className="size-4" /></Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
