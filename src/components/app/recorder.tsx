"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlay";
import { useSession } from "@/components/app/session";
import { outbox, queue } from "@/lib/audio-outbox";
import { ApiError, callFunction, supabase } from "@/lib/supabase";
import type { Lesson } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Lesson recording for automatic transcripts. The teacher's browser captures two tracks —
 * t = own microphone, s = the Meet tab (everyone else) — so the transcript knows who spoke.
 * Audio goes to storage in 10-minute chunks (a crash loses at most one chunk); ai-transcribe turns it
 * into text, deletes the audio and drafts the lesson summary. Chunks that can't be uploaded (signed out,
 * offline) wait in the browser and go out later. Lives above the cabinet shell, so neither moving
 * around the cabinet nor losing the session stops the recording.
 */

const SEGMENT_MS = 10 * 60_000;
const MAX_MS = 3 * 60 * 60_000;
const BUCKET = "lesson-audio";

type Phase = "idle" | "recording" | "stopping" | "processing";
interface Active {
  lessonId: string;
  title: string;
}
interface RecorderApi {
  supported: boolean;
  phase: Phase;
  active: Active | null;
  startedAt: number;
  levels: { t: number; s: number };
  signedOut: boolean;
  waiting: number;
  requestStart: (lesson: Lesson) => void;
  stop: () => void;
}

const Ctx = createContext<RecorderApi | null>(null);
export const useRecorder = () => useContext(Ctx);

function isSupported() {
  if (typeof window === "undefined") return false;
  return !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== "undefined" && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function mimeType() {
  return MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
}

/** One MediaRecorder per 10-minute segment; each segment is a standalone file. */
class TrackRecorder {
  private idx = 0;
  private rec: MediaRecorder | null = null;
  private done: Promise<void> = Promise.resolve();
  constructor(
    private stream: MediaStream,
    private track: "t" | "s",
    private t0: number,
    private onSegment: (name: string, blob: Blob) => Promise<void>,
  ) {}

  begin() {
    const offset = Math.round((Date.now() - this.t0) / 1000);
    const name = `${this.track}-${String(this.idx++).padStart(3, "0")}-${offset}.webm`;
    const rec = new MediaRecorder(this.stream, { mimeType: mimeType(), audioBitsPerSecond: 32_000 });
    const chunks: Blob[] = [];
    let resolve!: () => void;
    const finished = new Promise<void>((r) => (resolve = r));
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      this.onSegment(name, new Blob(chunks, { type: "audio/webm" })).finally(resolve);
    };
    rec.start();
    const prev = this.rec;
    this.rec = rec;
    this.done = Promise.all([this.done, finished]).then(() => {});
    prev?.stop(); // the new segment is already running, so there's no gap
  }

  async end() {
    if (this.rec && this.rec.state !== "inactive") this.rec.stop();
    this.rec = null;
    await this.done;
  }
}

const subscribeNever = () => () => {};

type Sent = "ok" | "signed-out" | "error";

async function send(lessonId: string, name: string, blob: Blob): Promise<Sent> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return "signed-out";
  const { error } = await supabase.storage.from(BUCKET).upload(`${lessonId}/${name}`, blob, { contentType: "audio/webm", upsert: true });
  return error ? "error" : "ok";
}

/** Mounted above the cabinet shell: losing the session sends the teacher to /login, and the recording must outlive that. */
export function RecorderProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const { session: auth } = useSession();
  const userId = auth?.user.id;
  // false during prerender and hydration; nothing reads it before the cabinet mounts on the client
  const supported = useSyncExternalStore(subscribeNever, isSupported, () => false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [active, setActive] = useState<Active | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [levels, setLevels] = useState({ t: 0, s: 0 });
  const [asking, setAsking] = useState<Lesson | null>(null);
  const [waiting, setWaiting] = useState(0); // segments kept in this browser until they can be uploaded
  const session = useRef<{
    lessonId: string;
    userId: string;
    recorders: TrackRecorder[];
    streams: MediaStream[];
    timers: number[];
    audio: AudioContext;
    stopping: boolean;
  } | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());

  // Leaving the page would lose the current segment.
  useEffect(() => {
    if (phase !== "recording" && phase !== "stopping") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  const upload = useCallback(async (userId: string, lessonId: string, name: string, blob: Blob) => {
    if (blob.size < 2000) return; // only a header — nothing was recorded
    for (let attempt = 0; attempt < 3; attempt++) {
      const sent = await send(lessonId, name, blob);
      if (sent === "ok") return;
      if (sent === "signed-out") break; // retrying won't help until the teacher signs in again
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
    await outbox.put({ lessonId, userId, name, blob });
    queue.add(lessonId, userId);
    setWaiting((n) => n + 1);
  }, []);

  /** Uploads what's waiting in the outbox; returns the lessons that still have segments left there. */
  const flush = useCallback(async (userId: string, recordingId?: string) => {
    const done = new Map<string, boolean>(); // lessons transcribed meanwhile without these segments
    const left = new Set<string>();
    for (const seg of (await outbox.all()).filter((s) => s.userId === userId)) {
      if (seg.lessonId !== recordingId && !done.has(seg.lessonId)) {
        const { data } = await supabase.from("lesson_transcripts").select("status").eq("lesson_id", seg.lessonId).maybeSingle();
        done.set(seg.lessonId, data?.status === "ready");
      }
      if (done.get(seg.lessonId)) {
        // uploading now would make a retry replace the whole transcript with this fragment
        await outbox.remove(seg.key);
        queue.remove(seg.lessonId);
      } else if ((await send(seg.lessonId, seg.name, seg.blob)) === "ok") await outbox.remove(seg.key);
      else left.add(seg.lessonId);
    }
    setWaiting((await outbox.all()).length);
    return left;
  }, []);

  const transcribe = useCallback(async (lessonId: string) => {
    setActive((a) => a ?? { lessonId, title: "" });
    setPhase("processing");
    try {
      const r = await callFunction<{ duration_sec: number; auto_summary: boolean }>("ai-transcribe", { action: "transcribe", lesson_id: lessonId });
      queue.remove(lessonId);
      toast.success(`Урок розшифровано · ${Math.round(r.duration_sec / 60)} хв`, {
        description: r.auto_summary ? "ШІ готує підсумок — прийде сповіщення, коли можна перевірити." : "Відкрийте урок, щоб оновити підсумок з урахуванням запису.",
        duration: 8000,
      });
    } catch (e) {
      const status = e instanceof ApiError ? e.status : -1;
      if (status === 401) {
        // the session was ended elsewhere; stays queued and runs after the next sign-in
        toast.warning("Сесію завершено — увійдіть знову", { description: "Аудіо збережено. Урок розшифрується автоматично після входу.", duration: 12000 });
      } else if (status === 0) {
        toast.warning("Немає з'єднання", { description: "Аудіо збережено. Урок розшифрується, щойно з'явиться інтернет.", duration: 12000 });
      } else {
        queue.remove(lessonId);
        toast.error((e as Error).message, { description: "Аудіо збережено — повторіть розшифровку з картки уроку." });
      }
    } finally {
      qc.invalidateQueries({ queryKey: ["lesson-transcript", lessonId] });
      qc.invalidateQueries({ queryKey: ["lesson-summary", lessonId] });
      setPhase("idle");
      setActive(null);
    }
  }, [qc]);

  /** Sends everything that's waiting: outbox segments first, then the lessons queued for transcription. */
  const resume = useCallback(() => {
    const step = async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) return;
      const left = await flush(uid, session.current?.lessonId);
      for (const lessonId of queue.list(uid)) {
        if (session.current) break; // a recording is running; the rest goes out when it stops
        if (left.has(lessonId)) continue;
        const { data: row } = await supabase.from("lesson_transcripts").select("status").eq("lesson_id", lessonId).maybeSingle();
        if (row?.status === "ready") queue.remove(lessonId); // already retried from the lesson card
        else await transcribe(lessonId);
      }
    };
    chain.current = chain.current.then(step, step);
    return chain.current;
  }, [flush, transcribe]);

  // After a sign-in (also the first load) and when the internet is back.
  useEffect(() => {
    if (!userId) return;
    void resume();
    const online = () => void resume();
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [userId, resume]);

  const stop = useCallback(async () => {
    const s = session.current;
    if (!s || s.stopping) return; // the button and Chrome's "Stop sharing" can both fire
    s.stopping = true;
    setPhase("stopping");
    s.timers.forEach((t) => clearInterval(t));
    await Promise.all(s.recorders.map((r) => r.end()));
    s.streams.forEach((st) => st.getTracks().forEach((t) => t.stop()));
    s.audio.close().catch(() => {});
    session.current = null;
    setLevels({ t: 0, s: 0 });

    queue.add(s.lessonId, s.userId);
    await resume();
    setPhase("idle");
    setActive(null);
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      toast.warning("Запис збережено на цьому комп'ютері", { description: "Сесію завершено. Увійдіть знову в цьому ж браузері — урок довантажиться й розшифрується автоматично.", duration: 15000 });
    } else if ((await outbox.all()).some((seg) => seg.lessonId === s.lessonId)) {
      toast.warning("Частину запису не вдалося завантажити", { description: "Вона збережена на цьому комп'ютері. Не закривайте кабінет — спробуємо ще раз, коли з'явиться зв'язок.", duration: 15000 });
    }
  }, [resume]);

  const start = useCallback(async (lesson: Lesson) => {
    const { data: signedIn } = await supabase.auth.getSession();
    const uid = signedIn.session?.user.id;
    if (!uid) return;
    let display: MediaStream | null = null;
    let mic: MediaStream | null = null;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: true, // Chrome only shares tab audio together with video; the video isn't recorded
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        // Chrome-specific hints: offer tabs first, don't offer this cabinet tab itself
        preferCurrentTab: false,
        selfBrowserSurface: "exclude",
        surfaceSwitching: "exclude",
        systemAudio: "include",
      } as DisplayMediaStreamOptions);
      if (!display.getAudioTracks().length) {
        display.getTracks().forEach((t) => t.stop());
        toast.error("Звук вкладки не вибрано", { description: "Виберіть вкладку з Google Meet і ввімкніть «Поділитися звуком вкладки»." });
        return;
      }
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      display?.getTracks().forEach((t) => t.stop());
      if ((e as Error).name !== "NotAllowedError") toast.error("Не вдалося почати запис", { description: (e as Error).message });
      else if (display) toast.error("Потрібен доступ до мікрофона, щоб записати ваш голос");
      return;
    }

    const t0 = Date.now();
    const tabAudio = new MediaStream(display.getAudioTracks());
    const recorders = [
      new TrackRecorder(mic, "t", t0, (n, b) => upload(uid, lesson.id, n, b)),
      new TrackRecorder(tabAudio, "s", t0, (n, b) => upload(uid, lesson.id, n, b)),
    ];

    // Live levels so the teacher sees both their voice and the students are being captured.
    const audio = new AudioContext();
    const meter = (stream: MediaStream) => {
      const a = audio.createAnalyser();
      a.fftSize = 512;
      audio.createMediaStreamSource(stream).connect(a);
      const buf = new Uint8Array(a.fftSize);
      return () => {
        a.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        return Math.min(1, Math.sqrt(sum / buf.length) * 4);
      };
    };
    const tLevel = meter(mic);
    const sLevel = meter(tabAudio);

    session.current = { lessonId: lesson.id, userId: uid, recorders, streams: [display, mic], timers: [], audio, stopping: false };
    recorders.forEach((r) => r.begin());
    session.current.timers.push(
      window.setInterval(() => recorders.forEach((r) => r.begin()), SEGMENT_MS),
      window.setInterval(() => setLevels({ t: tLevel(), s: sLevel() }), 150),
      window.setTimeout(() => stop(), MAX_MS),
    );
    // "Stop sharing" in Chrome's bar ends the recording too.
    display.getVideoTracks()[0]?.addEventListener("ended", () => stop());
    display.getAudioTracks()[0]?.addEventListener("ended", () => stop());

    await supabase.from("lesson_transcripts").upsert({ lesson_id: lesson.id, status: "recording", error: null });
    qc.invalidateQueries({ queryKey: ["lesson-transcript", lesson.id] });
    setActive({ lessonId: lesson.id, title: lesson.title ?? "Урок англійської" });
    setStartedAt(t0);
    setPhase("recording");
  }, [qc, stop, upload]);

  const api: RecorderApi = { supported, phase, active, startedAt, levels, signedOut: !userId, waiting, requestStart: setAsking, stop: () => void stop() };

  return (
    <Ctx.Provider value={api}>
      {children}
      <RecorderPill api={api} />
      <StartDialog lesson={asking} onClose={() => setAsking(null)} onStart={(l) => { setAsking(null); start(l); }} />
    </Ctx.Provider>
  );
}

function useClock(from: number, on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  const s = Math.max(0, Math.floor((now - from) / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function Level({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-1.5" title={label}>
      <span className="w-12 text-[11px] text-seal-100/80">{label}</span>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-white/15">
        <span className="block h-full rounded-full bg-emerald-400 transition-[width] duration-150" style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
    </div>
  );
}

function RecorderPill({ api }: { api: RecorderApi }) {
  const clock = useClock(api.startedAt, api.phase === "recording");
  if (api.phase === "idle" || !api.active) return null;
  return (
    <div className="fixed right-3 bottom-3 z-40 flex max-w-[calc(100vw-1.5rem)] items-center gap-3 rounded-3xl bg-ocean-900/95 py-2.5 pr-2.5 pl-4 text-white shadow-lift backdrop-blur sm:right-5 sm:bottom-5" role="status">
      {api.phase === "recording" ? (
        <>
          <span className="relative flex size-3 shrink-0">
            <span className="absolute inset-0 animate-ping rounded-full bg-coral-400 opacity-75" />
            <span className="relative size-3 rounded-full bg-coral-500" />
          </span>
          <div className="min-w-0">
            <div className="flex items-baseline gap-2 text-sm font-semibold">Запис уроку <span className="font-mono text-seal-100 tabular-nums">{clock}</span></div>
            <div className="mt-1 hidden gap-3 sm:flex">
              <Level label="Ви" value={api.levels.t} />
              <Level label="Учні" value={api.levels.s} />
            </div>
            {(api.signedOut || api.waiting > 0) && (
              <div className="mt-1 max-w-64 text-xs text-amber-200">
                {api.signedOut ? "Сесію завершено — увійдіть знову. Запис триває і зберігається на цьому комп'ютері." : "Немає зв'язку з сервером — запис зберігається на цьому комп'ютері."}
              </div>
            )}
          </div>
          <Button size="sm" variant="glass" onClick={api.stop}><Square className="size-3.5" /> Зупинити</Button>
        </>
      ) : (
        <>
          <Loader2 className="size-4 shrink-0 animate-spin text-seal-200" />
          <div className="text-sm">
            <div className="font-semibold">{api.phase === "stopping" ? "Зберігаю запис…" : "Розшифровую урок…"}</div>
            <div className="text-xs text-seal-100/75">Можна працювати далі в кабінеті</div>
          </div>
        </>
      )}
    </div>
  );
}

function StartDialog({ lesson, onClose, onStart }: { lesson: Lesson | null; onClose: () => void; onStart: (l: Lesson) => void }) {
  const [consent, setConsent] = useState(false);
  return (
    <Dialog open={!!lesson} onOpenChange={(v) => { if (!v) { onClose(); setConsent(false); } }}>
      {lesson && (
        <DialogContent title="Запис уроку" description="ШІ сам складе підсумок: лексику, граматику й помилки учнів" size="md">
          <ol className="grid gap-3 text-sm">
            {[
              <>Відкрийте урок у Google Meet (кнопка «Приєднатися»), якщо ще не відкрили.</>,
              <>Натисніть «Почати запис» і у вікні виберіть <b>вкладку з Google Meet</b>, увімкнувши <b>«Поділитися звуком вкладки»</b>. Потім дозвольте мікрофон.</>,
              <>Не закривайте цю вкладку кабінету до кінця уроку. Внизу буде індикатор запису з рівнями звуку «Ви» та «Учні».</>,
              <>Після уроку натисніть «Зупинити» — за хвилину-дві прийде готова чернетка підсумку.</>,
            ].map((t, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-seal-100 text-xs font-bold text-seal-700">{i + 1}</span>
                <span className="text-ink-soft">{t}</span>
              </li>
            ))}
          </ol>
          <p className="mt-4 rounded-2xl bg-seal-50 p-3 text-xs text-ink-soft">
            Запис іде лише з вашого браузера. Аудіо видаляється одразу після розшифровки, текст бачать тільки викладач і адміністрація — учням він недоступний.
          </p>
          <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-sm">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4 accent-seal-600" />
            <span>Учні (для неповнолітніх — батьки) знають про запис уроку й погодилися на нього</span>
          </label>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Скасувати</Button>
            <Button disabled={!consent} onClick={() => { onStart(lesson); setConsent(false); }}><Mic /> Почати запис</Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

/** "Record lesson" entry point; hidden when the browser can't capture tab audio or transcripts aren't set up. */
export function RecordLessonButton({ lesson, enabled, size = "md", variant = "outline", className }: {
  lesson: Lesson;
  enabled: boolean;
  size?: "sm" | "md";
  variant?: "outline" | "glass" | "soft";
  className?: string;
}) {
  const rec = useRecorder();
  const [now] = useState(() => Date.now());
  if (!rec?.supported || !enabled || lesson.status === "cancelled" || lesson.kind !== "regular") return null;
  if (new Date(lesson.ends_at).getTime() < now - 15 * 60_000) return null;
  if (rec.active?.lessonId === lesson.id && rec.phase === "recording") {
    return (
      <Button size={size} variant={variant} className={className} onClick={rec.stop}>
        <span className="size-2 animate-pulse rounded-full bg-coral-500" /> Зупинити запис
      </Button>
    );
  }
  const busy = rec.phase !== "idle";
  return (
    <Button size={size} variant={variant} className={cn(className)} disabled={busy} onClick={() => rec.requestStart(lesson)} title={busy ? "Уже йде запис іншого уроку" : undefined}>
      <Mic /> Записати урок
    </Button>
  );
}
