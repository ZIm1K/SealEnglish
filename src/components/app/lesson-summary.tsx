"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BookMarked, CheckCircle2, Plus, Sparkles, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Badge, Skeleton } from "@/components/ui/misc";
import { callFunction, supabase } from "@/lib/supabase";
import { MISTAKE_LABEL, type Lesson, type LessonSummary, type MistakeCategory, type MistakeItem, type Profile } from "@/lib/types";
import { cn } from "@/lib/utils";

type Vocab = LessonSummary["vocabulary"][number];
type Grammar = LessonSummary["grammar"][number];

const CATEGORIES = Object.keys(MISTAKE_LABEL) as MistakeCategory[];

/**
 * FR-11: the teacher writes rough notes, AI structures them, the teacher edits and publishes.
 * Publishing attributes mistakes to students' profiles and fills the recap students see (P1: the teacher decides).
 */
export function LessonSummaryEditor({ lesson, aiEnabled, onNotes }: { lesson: Lesson; aiEnabled: boolean; onNotes: (recap: string) => void }) {
  const qc = useQueryClient();
  const { data: saved, isLoading } = useQuery({
    queryKey: ["lesson-summary", lesson.id],
    queryFn: async () => {
      const { data } = await supabase.from("lesson_summaries").select("*").eq("lesson_id", lesson.id).maybeSingle();
      return (data as LessonSummary | null) ?? null;
    },
  });
  const { data: roster = [] } = useQuery({
    queryKey: ["lesson-roster-lite", lesson.id],
    queryFn: async () => {
      if (lesson.group_id) {
        const { data } = await supabase.from("group_members").select("student:profiles!group_members_student_id_fkey(id, full_name)").eq("group_id", lesson.group_id);
        return (data ?? []).map((r: { student: unknown }) => r.student as Pick<Profile, "id" | "full_name">).filter(Boolean);
      }
      return lesson.student ? [{ id: lesson.student.id, full_name: lesson.student.full_name }] : [];
    },
  });

  if (isLoading) return <Skeleton className="h-24" />;
  return <Editor key={saved?.updated_at ?? "new"} lesson={lesson} saved={saved ?? null} roster={roster} aiEnabled={aiEnabled} onNotes={onNotes} onSaved={() => qc.invalidateQueries({ queryKey: ["lesson-summary", lesson.id] })} />;
}

function Editor({ lesson, saved, roster, aiEnabled, onNotes, onSaved }: {
  lesson: Lesson;
  saved: LessonSummary | null;
  roster: Pick<Profile, "id" | "full_name">[];
  aiEnabled: boolean;
  onNotes: (recap: string) => void;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(!!saved);
  const [notes, setNotes] = useState(saved?.notes ?? "");
  const [vocab, setVocab] = useState<Vocab[]>(saved?.vocabulary ?? []);
  const [grammar, setGrammar] = useState<Grammar[]>(saved?.grammar ?? []);
  const [mistakes, setMistakes] = useState<MistakeItem[]>(saved?.mistakes ?? []);
  const [recap, setRecap] = useState(saved?.recap ?? "");
  const published = saved?.status === "published";

  const generate = useMutation({
    mutationFn: () => callFunction<{ vocabulary: Vocab[]; grammar: Grammar[]; mistakes: MistakeItem[]; recap: string }>("ai-lesson", { lesson_id: lesson.id, notes }),
    onSuccess: (r) => {
      setVocab(r.vocabulary);
      setGrammar(r.grammar);
      setMistakes(r.mistakes);
      setRecap(r.recap);
      toast.success("Чернетку готово ✨", { description: "Перевірте й відредагуйте перед публікацією" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const save = useMutation({
    mutationFn: async (publish: boolean) => {
      const clean = {
        vocabulary: vocab.filter((v) => v.term.trim()),
        grammar: grammar.filter((g) => g.point.trim()),
        mistakes: mistakes.filter((m) => m.example.trim() && m.correction.trim()),
      };
      const { error } = await supabase.from("lesson_summaries").upsert({ lesson_id: lesson.id, notes: notes || null, recap: recap || null, ...clean, status: published ? "published" : "draft" });
      if (error) throw error;
      if (!publish) return 0;
      const { data, error: pErr } = await supabase.rpc("publish_lesson_summary", { p_lesson: lesson.id });
      if (pErr) throw pErr;
      if (recap.trim()) {
        await supabase.from("lessons").update({ teacher_notes: recap.trim() }).eq("id", lesson.id);
        onNotes(recap.trim());
      }
      return data as number;
    },
    onSuccess: (n, publish) => {
      toast.success(publish ? "Підсумок опубліковано" : "Чернетку збережено", {
        description: publish ? `Учні бачать лексику й граматику${n ? `; ${n} помилок додано в профілі учнів` : ""}. Сілі використає їх у практиці.` : undefined,
      });
      onSaved();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-seal-300 bg-seal-50/50 p-4 text-left transition hover:bg-seal-50">
        <span className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-400 to-seal-600 text-white"><Wand2 className="size-5" /></span>
        <span>
          <span className="block font-semibold text-ink">Підсумок уроку {aiEnabled && "з ШІ"}</span>
          <span className="block text-sm text-mute">Лексика, граматика й помилки — для профілю учнів і практики з Сілі</span>
        </span>
      </button>
    );
  }

  return (
    <section className="grid gap-4 rounded-2xl border border-seal-200 bg-gradient-to-b from-seal-50/70 to-white p-4" aria-label="Підсумок уроку">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><Wand2 className="size-4 text-violet-500" /> Підсумок уроку</h3>
        {published ? <Badge tone="mint"><CheckCircle2 className="size-3" /> Опубліковано</Badge> : saved ? <Badge tone="sun">Чернетка</Badge> : null}
      </div>
      <Field label="Нотатки викладача" hint="як завгодно: що робили, слова, хто де помилявся">
        <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Past Simple vs Present Perfect. Слова: journey, luggage, to book a room… Софія: I have been in Paris last year." />
      </Field>
      {aiEnabled ? (
        <Button type="button" variant="soft" className="justify-self-start" onClick={() => generate.mutate()} loading={generate.isPending} disabled={notes.trim().length < 15}>
          <Sparkles /> {vocab.length || grammar.length ? "Перегенерувати з ШІ" : "Структурувати з ШІ"}
        </Button>
      ) : (
        <p className="text-xs text-mute">ШІ-модуль вимкнено — заповніть підсумок вручну.</p>
      )}

      <ListEditor
        title="Лексика"
        items={vocab}
        empty={{ term: "", meaning: "", example: "" }}
        onChange={setVocab}
        render={(v, set) => (
          <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_1fr_1.4fr]">
            <Input aria-label="Слово або фраза" value={v.term} onChange={(e) => set({ ...v, term: e.target.value })} placeholder="luggage" className="h-9" />
            <Input aria-label="Значення" value={v.meaning ?? ""} onChange={(e) => set({ ...v, meaning: e.target.value })} placeholder="багаж" className="h-9" />
            <Input aria-label="Приклад" value={v.example ?? ""} onChange={(e) => set({ ...v, example: e.target.value })} placeholder="Where can I leave my luggage?" className="h-9" />
          </div>
        )}
      />
      <ListEditor
        title="Граматика"
        items={grammar}
        empty={{ point: "", note: "" }}
        onChange={setGrammar}
        render={(g, set) => (
          <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_1.6fr]">
            <Input aria-label="Тема граматики" value={g.point} onChange={(e) => set({ ...g, point: e.target.value })} placeholder="Present Perfect" className="h-9" />
            <Input aria-label="Пояснення" value={g.note ?? ""} onChange={(e) => set({ ...g, note: e.target.value })} placeholder="досвід без точного часу" className="h-9" />
          </div>
        )}
      />
      <ListEditor
        title="Помилки"
        hint={roster.length > 1 ? "оберіть учня, щоб помилка потрапила в його профіль" : undefined}
        items={mistakes}
        empty={{ category: "grammar", example: "", correction: "", explanation: "", student_id: roster.length === 1 ? roster[0].id : null }}
        onChange={setMistakes}
        render={(m, set) => (
          <div className="grid flex-1 gap-2 sm:grid-cols-2 lg:grid-cols-[8rem_1fr_1fr_10rem]">
            <Select aria-label="Категорія" value={m.category} onChange={(e) => set({ ...m, category: e.target.value as MistakeCategory })} className="h-9 text-sm">
              {CATEGORIES.map((c) => <option key={c} value={c}>{MISTAKE_LABEL[c]}</option>)}
            </Select>
            <Input aria-label="Як сказав учень" value={m.example} onChange={(e) => set({ ...m, example: e.target.value })} placeholder="I have been in Paris last year" className="h-9 text-coral-700 line-through decoration-coral-300" />
            <Input aria-label="Як правильно" value={m.correction} onChange={(e) => set({ ...m, correction: e.target.value })} placeholder="I was in Paris last year" className="h-9 text-emerald-700" />
            <Select aria-label="Учень" value={m.student_id ?? ""} onChange={(e) => set({ ...m, student_id: e.target.value || null })} className={cn("h-9 text-sm", !m.student_id && roster.length > 1 && "text-mute")}>
              <option value="">{roster.length > 1 ? "Уся група" : "—"}</option>
              {roster.map((r) => <option key={r.id} value={r.id}>{r.full_name}</option>)}
            </Select>
          </div>
        )}
      />
      <Field label="Підсумок для учнів" hint="з'явиться в уроці після публікації">
        <Textarea rows={3} value={recap} onChange={(e) => setRecap(e.target.value)} placeholder="Сьогодні говорили про подорожі та повторили Present Perfect…" />
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => save.mutate(false)} loading={save.isPending && save.variables === false}>Зберегти чернетку</Button>
        <Button type="button" size="sm" onClick={() => save.mutate(true)} loading={save.isPending && save.variables === true} disabled={!vocab.length && !grammar.length && !mistakes.length && !recap.trim()}>
          <CheckCircle2 /> {published ? "Оновити й опублікувати" : "Опублікувати"}
        </Button>
      </div>
    </section>
  );
}

function ListEditor<T>({ title, hint, items, empty, onChange, render }: {
  title: string;
  hint?: string;
  items: T[];
  empty: T;
  onChange: (items: T[]) => void;
  render: (item: T, set: (next: T) => void) => React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-ink-soft">{title} <span className="font-normal text-mute">· {items.length}</span></span>
        {hint && <span className="text-xs text-mute">{hint}</span>}
      </div>
      <ul className="grid gap-2">
        {items.map((it, i) => (
          <li key={i} className="flex items-start gap-2">
            {render(it, (next) => onChange(items.map((x, j) => (j === i ? next : x))))}
            <Button type="button" size="icon-sm" variant="ghost" className="mt-0.5 text-mute hover:text-red-600" aria-label={`Видалити рядок: ${title}`} onClick={() => onChange(items.filter((_, j) => j !== i))}>
              <Trash2 className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
      <Button type="button" variant="ghost" size="xs" className="mt-1" onClick={() => onChange([...items, empty])}><Plus /> Додати</Button>
    </div>
  );
}

/** What students see after the teacher publishes: vocabulary and grammar only (mistakes stay private). */
export function LessonTopicsForStudent({ lessonId }: { lessonId: string }) {
  const { data } = useQuery({
    queryKey: ["lesson-topics", lessonId],
    queryFn: async () => {
      const { data } = await supabase.rpc("lesson_topics", { p_lesson: lessonId });
      return data as { vocabulary: Vocab[]; grammar: Grammar[] } | null;
    },
  });
  if (!data || (!data.vocabulary?.length && !data.grammar?.length)) return null;
  return (
    <div className="grid gap-3 rounded-2xl bg-seal-50/70 p-4">
      <div className="flex items-center gap-2 font-semibold"><BookMarked className="size-4 text-seal-600" /> Що вивчили на уроці</div>
      {data.vocabulary?.length > 0 && (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {data.vocabulary.map((v, i) => (
            <li key={i} className="rounded-xl bg-white px-3 py-2 text-sm ring-1 ring-line">
              <b>{v.term}</b>{v.meaning ? ` — ${v.meaning}` : ""}
              {v.example && <div className="text-xs text-mute italic">{v.example}</div>}
            </li>
          ))}
        </ul>
      )}
      {data.grammar?.length > 0 && (
        <ul className="grid gap-1 text-sm">
          {data.grammar.map((g, i) => <li key={i}>📘 <b>{g.point}</b>{g.note ? ` — ${g.note}` : ""}</li>)}
        </ul>
      )}
    </div>
  );
}
