"use client";

import { toast } from "sonner";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Card, CardHeader } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

// Shapes mirror content-farm/src/schema.ts (the farm writes them, this page edits them).
export type Speaker = "narrator" | "seal" | "uk_male" | "uk_female" | "uk_old" | "en_male" | "en_female" | "en_male_2" | "en_female_2" | "en_child";
export interface Beat {
  speaker: Speaker;
  speaker_name: string;
  narration: string;
  delivery: string;
  spoken: string;
  speed: number;
  translation: string;
  location: number;
  shot: "wide" | "npc" | "seal" | "punch";
  seal_visible: boolean;
  seal_side: "left" | "right";
  seal_pose: string;
  keyword: string;
  english: string;
}
export interface Location {
  prompt: string;
  npc_side: "left" | "center" | "right" | "none";
}
export interface Captions {
  caption_tiktok: string;
  caption_instagram: string;
  hashtags: string[];
  threads_post: string;
  telegram_post: string;
  music_mood: string;
  cover_title: string;
}
export interface Story extends Captions {
  hook_overlay: string;
  visual_style: string;
  locations: Location[];
  beats: Beat[];
  ending_question: string;
  sources: string;
}
export interface Scene {
  kind: "hook" | "say" | "compare" | "quiz" | "list_item" | "cta";
  voice: string;
  headline: string;
  sub: string;
  english: string;
  wrong: string;
  right: string;
  options: string[];
  answer: number;
  reveal_voice: string;
  mascot: string;
  background: "brand" | "image";
  image_prompt: string;
}
export interface Edu extends Captions {
  format: string;
  series_label: string;
  scenes: Scene[];
}
export interface TextPost {
  threads_post: string;
  telegram_post: string;
  image_prompt: string;
}
export type ScriptJson = (Story | Edu | TextPost) & { idea?: { title?: string; trend?: string; format?: string; facts?: string } };

const SPEAKERS: { value: Speaker; label: string }[] = [
  { value: "narrator", label: "🎙 Оповідач" },
  { value: "seal", label: "🦭 Сілі" },
  { value: "uk_male", label: "Чоловік (укр)" },
  { value: "uk_female", label: "Жінка (укр)" },
  { value: "uk_old", label: "Літня людина (укр)" },
  { value: "en_male", label: "Чоловік (EN)" },
  { value: "en_female", label: "Жінка (EN)" },
  { value: "en_male_2", label: "Чоловік 2 (EN)" },
  { value: "en_female_2", label: "Жінка 2 (EN)" },
  { value: "en_child", label: "Дитина (EN)" },
];
const SHOTS = [
  { value: "wide", label: "Загальний план" },
  { value: "npc", label: "На героя фону" },
  { value: "seal", label: "На Сілі" },
  { value: "punch", label: "Різкий наїзд (шок)" },
];
const POSES = ["stand-happy", "stand-joy", "stand-neutral", "stand-surprised", "stand-sad", "stand-wink", "wave-happy", "read-happy", "read-joy", "read-neutral"];
const POSE_LABEL: Record<string, string> = {
  "stand-happy": "Усміхається",
  "stand-joy": "Радіє",
  "stand-neutral": "Спокійний",
  "stand-surprised": "Здивований / шок",
  "stand-sad": "Сумний",
  "stand-wink": "Підморгує",
  "wave-happy": "Махає",
  "read-happy": "Читає, усміхається",
  "read-joy": "Читає, радіє",
  "read-neutral": "Читає, думає",
};
const MOODS = ["upbeat", "chill", "funny", "suspense"];

export const isStory = (s: ScriptJson): s is Story & ScriptJson => Array.isArray((s as Story).beats);
export const isEdu = (s: ScriptJson): s is Edu & ScriptJson => Array.isArray((s as Edu).scenes);
/** Rough voice length: ~14 chars per second of speech + pauses between lines. */
const estimateSeconds = (lines: { text: string; speed?: number }[]) =>
  Math.round(lines.reduce((a, l) => a + l.text.length / (14 * (l.speed || 1)) + 0.5, 0));

function move<T>(arr: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const next = [...arr];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function RowTools({ onUp, onDown, onCopy, onDelete }: { onUp: () => void; onDown: () => void; onCopy: () => void; onDelete: () => void }) {
  return (
    <div className="flex gap-1">
      <Button type="button" variant="ghost" size="icon-sm" onClick={onUp} aria-label="Вище"><ArrowUp /></Button>
      <Button type="button" variant="ghost" size="icon-sm" onClick={onDown} aria-label="Нижче"><ArrowDown /></Button>
      <Button type="button" variant="ghost" size="icon-sm" onClick={onCopy} aria-label="Дублювати"><Copy /></Button>
      <Button type="button" variant="ghost" size="icon-sm" onClick={onDelete} aria-label="Видалити"><Trash2 className="text-red-500" /></Button>
    </div>
  );
}

export function StoryEditor({ value, onChange }: { value: Story & ScriptJson; onChange: (v: ScriptJson) => void }) {
  const setBeat = (i: number, patch: Partial<Beat>) => onChange({ ...value, beats: value.beats.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const setLoc = (i: number, patch: Partial<Location>) => onChange({ ...value, locations: value.locations.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const seconds = estimateSeconds(value.beats.map((b) => ({ text: b.spoken || b.narration, speed: b.speed })));
  const blank: Beat = {
    speaker: "narrator", speaker_name: "", narration: "", delivery: "", spoken: "", speed: 1, translation: "",
    location: 0, shot: "wide", seal_visible: true, seal_side: "right", seal_pose: "stand-happy", keyword: "", english: "",
  };

  return (
    <>
      <Card>
        <CardHeader title="Основне" description={`≈ ${seconds} с · ${value.beats.length} реплік (ціль: 7–9 реплік, 30–45 с)`} />
        <div className="grid gap-4 p-5 sm:p-6">
          <Field label="Хук у білій плашці (перші 2.5 с)" hint="до 45 символів">
            <Input value={value.hook_overlay} onChange={(e) => onChange({ ...value, hook_overlay: e.target.value })} />
          </Field>
          {value.idea?.facts && (
            <details className="rounded-2xl bg-seal-50 p-3 text-sm text-ink-soft">
              <summary className="cursor-pointer font-semibold">Факти й джерела з дослідження</summary>
              <p className="mt-2 whitespace-pre-wrap">{value.idea.facts}</p>
            </details>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Локації (фони)"
          description="Опис англійською для генератора. Другорядні герої (бариста, вчитель) — частина фону; вкажіть, де вони стоять."
          action={<Button type="button" variant="soft" size="sm" onClick={() => onChange({ ...value, locations: [...value.locations, { prompt: "", npc_side: "none" }] })}><Plus /> Локація</Button>}
        />
        <div className="grid gap-3 p-5 sm:p-6">
          {value.locations.map((l, i) => (
            <div key={i} className="grid gap-3 rounded-2xl border border-line p-3 sm:grid-cols-[1fr_200px_auto]">
              <Field label={`Локація ${i + 1}`}>
                <Textarea rows={2} value={l.prompt} onChange={(e) => setLoc(i, { prompt: e.target.value })} />
              </Field>
              <Field label="Де стоїть герой фону">
                <Select value={l.npc_side} onChange={(e) => setLoc(i, { npc_side: e.target.value as Location["npc_side"] })}>
                  <option value="left">Ліворуч</option>
                  <option value="center">По центру</option>
                  <option value="right">Праворуч</option>
                  <option value="none">Немає</option>
                </Select>
              </Field>
              <div className="self-end">
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Видалити локацію" disabled={value.locations.length < 2}
                  onClick={() => onChange({ ...value, locations: value.locations.filter((_, j) => j !== i), beats: value.beats.map((b) => ({ ...b, location: Math.max(0, b.location > i ? b.location - 1 : b.location === i ? 0 : b.location) })) })}>
                  <Trash2 className="text-red-500" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Репліки" description="Порядок = порядок у відео. «Як вимовити» — якщо голос має сказати інакше, ніж написано (скоромовка, паузи «…»)." />
        <div className="grid gap-3 p-5 sm:p-6">
          {value.beats.map((b, i) => {
            const en = b.speaker.startsWith("en_");
            return (
              <div key={i} className={cn("rounded-2xl border p-4", b.speaker === "seal" ? "border-seal-200 bg-seal-50/50" : b.speaker === "narrator" ? "border-line" : "border-coral-100 bg-coral-50/30")}>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="grid size-7 place-items-center rounded-full bg-ocean-800 text-xs font-bold text-white">{i + 1}</span>
                  <Select className="w-auto" value={b.speaker} onChange={(e) => setBeat(i, { speaker: e.target.value as Speaker, speaker_name: e.target.value === "seal" ? "Сілі" : e.target.value === "narrator" ? "" : b.speaker_name })}>
                    {SPEAKERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </Select>
                  {b.speaker !== "narrator" && (
                    <Input className="w-44" placeholder="Підпис героя" value={b.speaker_name} onChange={(e) => setBeat(i, { speaker_name: e.target.value })} />
                  )}
                  <span className="ml-auto" />
                  <RowTools
                    onUp={() => onChange({ ...value, beats: move(value.beats, i, -1) })}
                    onDown={() => onChange({ ...value, beats: move(value.beats, i, 1) })}
                    onCopy={() => onChange({ ...value, beats: [...value.beats.slice(0, i + 1), { ...b }, ...value.beats.slice(i + 1)] })}
                    onDelete={() => onChange({ ...value, beats: value.beats.filter((_, j) => j !== i) })}
                  />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Текст репліки (на екрані)" className="md:col-span-2">
                    <Textarea rows={2} value={b.narration} onChange={(e) => setBeat(i, { narration: e.target.value })} />
                  </Field>
                  <Field label="Як вимовити" hint="порожньо — як написано">
                    <Input value={b.spoken} placeholder={b.narration} onChange={(e) => setBeat(i, { spoken: e.target.value })} />
                  </Field>
                  <Field label="Емоція / подача" hint="напр. «розгублено», «пошепки»">
                    <Input value={b.delivery} onChange={(e) => setBeat(i, { delivery: e.target.value })} />
                  </Field>
                  {(en || /[a-z]{3,}/i.test(b.narration)) && b.speaker !== "narrator" && (
                    <Field label="Переклад (під бульбашкою)">
                      <Input value={b.translation} onChange={(e) => setBeat(i, { translation: e.target.value })} />
                    </Field>
                  )}
                  {b.speaker === "narrator" && (
                    <Field label="Англійська плашка" hint="лише 1–2 на відео">
                      <Input value={b.english} onChange={(e) => setBeat(i, { english: e.target.value })} />
                    </Field>
                  )}
                  <Field label="Темп" hint={`${b.speed.toFixed(2)}×`}>
                    <input type="range" min={0.8} max={1.2} step={0.05} value={b.speed} onChange={(e) => setBeat(i, { speed: Number(e.target.value) })} className="w-full accent-seal-600" />
                  </Field>
                </div>
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer font-semibold text-ink-soft">Кадр і Сілі</summary>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="Локація">
                      <Select value={b.location} onChange={(e) => setBeat(i, { location: Number(e.target.value) })}>
                        {value.locations.map((_, j) => <option key={j} value={j}>Локація {j + 1}</option>)}
                      </Select>
                    </Field>
                    <Field label="Камера">
                      <Select value={b.shot} onChange={(e) => setBeat(i, { shot: e.target.value as Beat["shot"] })}>
                        {SHOTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                      </Select>
                    </Field>
                    <Field label="Емоція Сілі">
                      <Select value={b.seal_pose} onChange={(e) => setBeat(i, { seal_pose: e.target.value })}>
                        {POSES.map((p) => <option key={p} value={p}>{POSE_LABEL[p]}</option>)}
                      </Select>
                    </Field>
                    <Field label="Де стоїть Сілі">
                      <Select value={b.seal_side} onChange={(e) => setBeat(i, { seal_side: e.target.value as Beat["seal_side"] })}>
                        <option value="left">Ліворуч</option>
                        <option value="right">Праворуч</option>
                      </Select>
                    </Field>
                    <Checkbox label="Сілі в кадрі" checked={b.seal_visible} onChange={(e) => setBeat(i, { seal_visible: e.target.checked })} />
                    <Field label="Слово для підсвітки">
                      <Input value={b.keyword} onChange={(e) => setBeat(i, { keyword: e.target.value })} />
                    </Field>
                  </div>
                </details>
              </div>
            );
          })}
          <Button type="button" variant="soft" onClick={() => onChange({ ...value, beats: [...value.beats, { ...blank, location: value.beats.at(-1)?.location ?? 0 }] })}>
            <Plus /> Додати репліку
          </Button>
        </div>
      </Card>
    </>
  );
}

export function EduEditor({ value, onChange }: { value: Edu & ScriptJson; onChange: (v: ScriptJson) => void }) {
  const setScene = (i: number, patch: Partial<Scene>) => onChange({ ...value, scenes: value.scenes.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const seconds = estimateSeconds(value.scenes.map((s) => ({ text: `${s.voice} ${s.reveal_voice}` }))) + value.scenes.filter((s) => s.kind === "quiz").length * 3;
  const KINDS: Record<Scene["kind"], string> = { hook: "Хук", say: "Пояснення", compare: "Неправильно / правильно", quiz: "Квіз", list_item: "Пункт списку", cta: "Заклик" };
  return (
    <Card>
      <CardHeader title={`Сцени · ≈ ${seconds} с`} description="Сілі озвучує все, що в полі «Голос»." />
      <div className="grid gap-4 p-5 sm:p-6">
        <Field label="Плашка рубрики">
          <Input value={value.series_label} onChange={(e) => onChange({ ...value, series_label: e.target.value })} />
        </Field>
        {value.scenes.map((sc, i) => (
          <div key={i} className="rounded-2xl border border-line p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="grid size-7 place-items-center rounded-full bg-ocean-800 text-xs font-bold text-white">{i + 1}</span>
              <Select className="w-auto" value={sc.kind} onChange={(e) => setScene(i, { kind: e.target.value as Scene["kind"] })}>
                {Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
              <Select className="w-auto" value={sc.mascot} onChange={(e) => setScene(i, { mascot: e.target.value })}>
                {POSES.map((p) => <option key={p} value={p}>{POSE_LABEL[p]}</option>)}
              </Select>
              <span className="ml-auto" />
              <RowTools
                onUp={() => onChange({ ...value, scenes: move(value.scenes, i, -1) })}
                onDown={() => onChange({ ...value, scenes: move(value.scenes, i, 1) })}
                onCopy={() => onChange({ ...value, scenes: [...value.scenes.slice(0, i + 1), { ...sc }, ...value.scenes.slice(i + 1)] })}
                onDelete={() => onChange({ ...value, scenes: value.scenes.filter((_, j) => j !== i) })}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Голос" className="md:col-span-2"><Textarea rows={2} value={sc.voice} onChange={(e) => setScene(i, { voice: e.target.value })} /></Field>
              <Field label="Заголовок на екрані"><Input value={sc.headline} onChange={(e) => setScene(i, { headline: e.target.value })} /></Field>
              <Field label="Підпис"><Input value={sc.sub} onChange={(e) => setScene(i, { sub: e.target.value })} /></Field>
              {sc.kind !== "compare" && sc.kind !== "quiz" && <Field label="Англійська фраза"><Input value={sc.english} onChange={(e) => setScene(i, { english: e.target.value })} /></Field>}
              {sc.kind === "compare" && (
                <>
                  <Field label="❌ Неправильно"><Input value={sc.wrong} onChange={(e) => setScene(i, { wrong: e.target.value })} /></Field>
                  <Field label="✅ Правильно"><Input value={sc.right} onChange={(e) => setScene(i, { right: e.target.value })} /></Field>
                </>
              )}
              {sc.kind === "quiz" && (
                <>
                  <Field label="Варіанти" hint="кожен з нового рядка">
                    <Textarea rows={3} value={sc.options.join("\n")} onChange={(e) => setScene(i, { options: e.target.value.split("\n") })} />
                  </Field>
                  <Field label="Правильний варіант">
                    <Select value={sc.answer} onChange={(e) => setScene(i, { answer: Number(e.target.value) })}>
                      {sc.options.map((o, j) => <option key={j} value={j}>{o || `Варіант ${j + 1}`}</option>)}
                    </Select>
                  </Field>
                  <Field label="Голос після відповіді" className="md:col-span-2"><Textarea rows={2} value={sc.reveal_voice} onChange={(e) => setScene(i, { reveal_voice: e.target.value })} /></Field>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function TextEditor({ value, onChange }: { value: TextPost & ScriptJson; onChange: (v: ScriptJson) => void }) {
  return (
    <Card>
      <CardHeader title="Текстовий пост" />
      <div className="grid gap-4 p-5 sm:p-6">
        <Field label="Threads" hint={`${value.threads_post.length} / 500`}><Textarea rows={6} value={value.threads_post} onChange={(e) => onChange({ ...value, threads_post: e.target.value })} /></Field>
        <Field label="Telegram" hint={`${value.telegram_post.length} / 1024`}><Textarea rows={8} value={value.telegram_post} onChange={(e) => onChange({ ...value, telegram_post: e.target.value })} /></Field>
        <Field label="Картинка (опис англійською)" hint="порожньо — без картинки"><Input value={value.image_prompt} onChange={(e) => onChange({ ...value, image_prompt: e.target.value })} /></Field>
      </div>
    </Card>
  );
}

export function CaptionsEditor({ value, onChange }: { value: Captions; onChange: (c: Partial<Captions>) => void }) {
  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast.success("Скопійовано"));
  const tags = value.hashtags.map((h) => `#${h}`).join(" ");
  const box = (label: string, key: keyof Captions, rows: number, withTags = false) => (
    <Field
      label={
        <span className="flex items-center gap-2">
          {label}
          <button type="button" className="cursor-pointer text-seal-600 hover:text-seal-800" aria-label={`Копіювати: ${label}`} onClick={() => copy(withTags ? `${value[key]}\n\n${tags}` : String(value[key]))}>
            <Copy className="size-4" />
          </button>
        </span>
      }
    >
      <Textarea rows={rows} value={String(value[key])} onChange={(e) => onChange({ [key]: e.target.value })} />
    </Field>
  );
  return (
    <Card>
      <CardHeader title="Підписи для соцмереж" />
      <div className="grid gap-4 p-5 sm:p-6 lg:grid-cols-2">
        {box("TikTok", "caption_tiktok", 3, true)}
        {box("Instagram Reels", "caption_instagram", 5, true)}
        {box("Threads", "threads_post", 5)}
        {box("Telegram", "telegram_post", 5)}
        <Field label="Хештеги" hint="через пробіл">
          <Input value={value.hashtags.join(" ")} onChange={(e) => onChange({ hashtags: e.target.value.split(/\s+/).map((h) => h.replace(/^#/, "")).filter(Boolean) })} />
        </Field>
        <Field label="Музика">
          <Select value={value.music_mood} onChange={(e) => onChange({ music_mood: e.target.value })}>
            {MOODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </Select>
        </Field>
      </div>
    </Card>
  );
}
