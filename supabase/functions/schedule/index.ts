// Lessons: create (single / weekly series) with Google Meet, reschedule, cancel, delete.
import {
  admin, fmtKyiv, handle, HttpError, isStaff, json, readJson, requireUser, zonedToUtc, type Profile,
} from "../_shared/core.ts";
import { createMeetEvent, deleteMeetEvent, googleConfigured, patchMeetEvent } from "../_shared/google.ts";
import { esc, isPublicHttps, sendMessage } from "../_shared/telegram.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

interface CreateInput {
  action: "create";
  teacher_id?: string;
  target: { type: "student" | "group" | "lead"; id: string };
  date: string; // YYYY-MM-DD (Kyiv)
  time: string; // HH:MM (Kyiv)
  duration_min?: number;
  title?: string;
  topic?: string;
  repeat_weeks?: number; // 0 = single lesson
  weekdays?: number[]; // ISO 1..7; defaults to the weekday of `date`
  meet?: boolean;
  send_invites?: boolean;
}

const WEEKDAY_UA = ["", "пн", "вт", "ср", "чт", "пт", "сб", "нд"];

function isoWeekday(date: string): number {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function participants(target: CreateInput["target"]) {
  if (target.type === "student") {
    const { data } = await admin.from("profiles").select("id, full_name, email, role, is_active").eq("id", target.id).maybeSingle();
    if (!data || data.role !== "student" || !data.is_active) throw new HttpError(422, "Учня не знайдено");
    return { label: data.full_name, studentIds: [data.id], emails: [data.email].filter(Boolean) as string[], lead: null as Any };
  }
  if (target.type === "group") {
    const { data: g } = await admin.from("groups").select("id, name, teacher_id, is_archived").eq("id", target.id).maybeSingle();
    if (!g || g.is_archived) throw new HttpError(422, "Групу не знайдено");
    const { data: members } = await admin.from("group_members").select("student:profiles!group_members_student_id_fkey(id, email, is_active)").eq("group_id", g.id);
    const active = (members ?? []).map((m: Any) => m.student).filter((s: Any) => s?.is_active);
    return { label: g.name, group: g, studentIds: active.map((s: Any) => s.id), emails: active.map((s: Any) => s.email).filter(Boolean), lead: null as Any };
  }
  const { data: lead } = await admin.from("leads").select("*").eq("id", target.id).maybeSingle();
  if (!lead) throw new HttpError(422, "Заявку не знайдено");
  return { label: lead.name, studentIds: [] as string[], emails: [lead.email].filter(Boolean) as string[], lead };
}

async function create(input: CreateInput, me: Profile) {
  const teacherId = isStaff(me) ? (input.teacher_id ?? me.id) : me.id;
  if (!isStaff(me) && input.teacher_id && input.teacher_id !== me.id) throw new HttpError(403, "Викладач може планувати лише власні уроки");
  if (input.target?.type === "lead" && !isStaff(me)) throw new HttpError(403, "Пробні уроки призначає менеджер");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "") || !/^\d{2}:\d{2}$/.test(input.time ?? "")) throw new HttpError(422, "Вкажіть дату й час");

  const { data: teacher } = await admin.from("profiles").select("id, full_name, email, role, meet_room_url, is_active").eq("id", teacherId).maybeSingle();
  if (!teacher || !teacher.is_active || !["teacher", "manager", "admin"].includes(teacher.role)) throw new HttpError(422, "Викладача не знайдено");

  const who = await participants(input.target);
  if (input.target.type === "group" && !isStaff(me) && who.group?.teacher_id !== me.id) throw new HttpError(403, "Це не ваша група");

  const duration = Math.min(Math.max(Number(input.duration_min) || 60, 15), 240);
  const weeks = Math.min(Math.max(Number(input.repeat_weeks) || 0, 0), 52);
  const weekdays = [...new Set((input.weekdays?.length ? input.weekdays : [isoWeekday(input.date)]).filter((d) => d >= 1 && d <= 7))].sort();

  // Build occurrence dates: first week starts at `date`; include selected weekdays on/after it.
  const dates: string[] = [];
  if (weeks === 0) dates.push(input.date);
  else {
    const startDow = isoWeekday(input.date);
    const monday = addDays(input.date, -(startDow - 1));
    for (let w = 0; w < weeks; w++) {
      for (const wd of weekdays) {
        const d = addDays(monday, w * 7 + wd - 1);
        if (d >= input.date) dates.push(d);
      }
    }
  }
  if (!dates.length) throw new HttpError(422, "Немає жодної дати для уроку");
  if (dates.length > 104) throw new HttpError(422, "Забагато уроків в одній серії");

  const kind = input.target.type === "lead" ? "trial" : "regular";
  const title = input.title?.trim() || (kind === "trial" ? `Пробний урок · ${who.label}` : `Англійська · ${who.label}`);
  const seriesId = dates.length > 1 ? crypto.randomUUID() : null;
  const occurrences = dates.map((d) => {
    const start = zonedToUtc(d, input.time);
    return { start, end: new Date(start.getTime() + duration * 60000) };
  });

  // Google Meet: one conference per series, a calendar event per lesson.
  const wantMeet = input.meet !== false;
  const google = wantMeet && (await googleConfigured());
  let events: { id: string | null; meetUrl: string | null }[] = occurrences.map(() => ({ id: null, meetUrl: teacher.meet_room_url ?? null }));
  let googleError: string | null = null;
  if (google) {
    try {
      const attendees = [teacher.email, ...who.emails].filter(Boolean) as string[];
      const description = `Seal English · ${kind === "trial" ? "пробний урок" : "урок англійської"}\nВикладач: ${teacher.full_name}`;
      const first = await createMeetEvent({ summary: title, description, start: occurrences[0].start, end: occurrences[0].end, attendees, sendUpdates: !!input.send_invites });
      events[0] = { id: first.id, meetUrl: first.meetUrl };
      if (occurrences.length > 1) {
        const rest = await mapLimit(occurrences.slice(1), 4, (o) =>
          createMeetEvent({ summary: title, description, start: o.start, end: o.end, attendees, sendUpdates: false, conferenceData: first.conferenceData ?? undefined })
            .then((e) => ({ id: e.id, meetUrl: e.meetUrl ?? first.meetUrl }))
            .catch((e) => {
              console.error(e);
              return { id: null, meetUrl: first.meetUrl };
            }));
        events = [events[0], ...rest];
      }
    } catch (e) {
      googleError = e instanceof Error ? e.message : String(e);
      console.error("meet create failed", e);
    }
  }

  const rows = occurrences.map((o, i) => ({
    kind,
    title,
    topic: input.topic?.trim() || null,
    teacher_id: teacher.id,
    group_id: input.target.type === "group" ? input.target.id : null,
    student_id: input.target.type === "student" ? input.target.id : null,
    lead_id: input.target.type === "lead" ? input.target.id : null,
    starts_at: o.start.toISOString(),
    ends_at: o.end.toISOString(),
    meet_url: events[i].meetUrl,
    google_event_id: events[i].id,
    series_id: seriesId,
    created_by: me.id,
  }));
  const { data: lessons, error } = await admin.from("lessons").insert(rows).select("id, starts_at, meet_url");
  if (error) throw error;

  const firstLesson = lessons![0];
  const when = occurrences.length > 1
    ? `${weekdays.map((d) => WEEKDAY_UA[d]).join(", ")} о ${input.time}, ${occurrences.length} уроків з ${fmtKyiv(occurrences[0].start, { hour: undefined, minute: undefined })}`
    : fmtKyiv(occurrences[0].start);

  // In-app + Telegram notifications (students, and the teacher if someone else planned it).
  const notify = [...who.studentIds];
  if (teacher.id !== me.id) notify.push(teacher.id);
  if (notify.length) {
    await admin.from("notifications").insert(notify.map((uid) => ({
      user_id: uid,
      kind: kind === "trial" ? "trial_new" : "lesson_new",
      title: kind === "trial" ? "Призначено пробний урок" : occurrences.length > 1 ? "Новий розклад уроків" : "Новий урок",
      body: `${title} · ${when}`,
      link: "/app/schedule/",
      data: { lesson_id: firstLesson.id, meet_url: firstLesson.meet_url },
    })));
  }

  if (who.lead) {
    await admin.from("leads").update({
      status: ["new", "contacted"].includes(who.lead.status) ? "trial_scheduled" : who.lead.status,
      trial_lesson_id: firstLesson.id,
      manager_id: who.lead.manager_id ?? (isStaff(me) ? me.id : null),
    }).eq("id", who.lead.id);
    await admin.from("lead_events").insert({
      lead_id: who.lead.id, kind: "trial", actor_id: me.id,
      body: `Пробний урок ${fmtKyiv(occurrences[0].start)} · ${teacher.full_name}`,
      from_status: who.lead.status, to_status: ["new", "contacted"].includes(who.lead.status) ? "trial_scheduled" : who.lead.status,
    });
    if (who.lead.telegram_chat_id) {
      const kb = isPublicHttps(firstLesson.meet_url) ? { inline_keyboard: [[{ text: "🎥 Посилання на урок", url: firstLesson.meet_url }]] } : undefined;
      await sendMessage(who.lead.telegram_chat_id, `🎁 <b>Пробний урок призначено!</b>\n\n🗓 ${esc(fmtKyiv(occurrences[0].start, { weekday: "long" }))}\n👩‍🏫 Викладач: ${esc(teacher.full_name)}\n\nЯ нагадаю за годину до початку 🦭`, kb ? { reply_markup: kb } : {});
    }
  }

  return { ok: true, created: lessons!.length, series_id: seriesId, meet: events.some((e) => e.meetUrl), google_connected: google, google_error: googleError };
}

async function loadLessonFor(me: Profile, id: string) {
  const { data: lesson } = await admin.from("lessons").select("*").eq("id", id).maybeSingle();
  if (!lesson) throw new HttpError(404, "Урок не знайдено");
  if (!isStaff(me) && lesson.teacher_id !== me.id) throw new HttpError(403, "Недостатньо прав");
  return lesson;
}

async function seriesScope(lesson: Any, scope: string | undefined) {
  if (!lesson.series_id || scope !== "following") return [lesson];
  const { data } = await admin.from("lessons").select("*").eq("series_id", lesson.series_id).gte("starts_at", lesson.starts_at).neq("status", "cancelled").order("starts_at");
  return data ?? [lesson];
}

async function update(input: Any, me: Profile) {
  const lesson = await loadLessonFor(me, input.lesson_id);
  const targets = await seriesScope(lesson, input.scope);
  const google = await googleConfigured();
  const shiftMs = input.date && input.time
    ? zonedToUtc(input.date, input.time).getTime() - new Date(lesson.starts_at).getTime()
    : 0;
  const duration = input.duration_min ? Math.min(Math.max(Number(input.duration_min), 15), 240) : null;

  for (const l of targets) {
    const start = new Date(new Date(l.starts_at).getTime() + shiftMs);
    const end = duration ? new Date(start.getTime() + duration * 60000) : new Date(new Date(l.ends_at).getTime() + shiftMs);
    const patch: Record<string, unknown> = { starts_at: start.toISOString(), ends_at: end.toISOString() };
    if (input.title !== undefined) patch.title = input.title || null;
    if (input.topic !== undefined && l.id === lesson.id) patch.topic = input.topic || null;
    if (input.teacher_id && isStaff(me)) patch.teacher_id = input.teacher_id;
    const { error } = await admin.from("lessons").update(patch).eq("id", l.id);
    if (error) throw error;
    if (google && l.google_event_id) {
      await patchMeetEvent(l.google_event_id, { start, end, summary: (patch.title as string) ?? undefined, sendUpdates: !!input.send_invites })
        .catch((e) => console.error("meet patch failed", e));
    }
  }
  return { ok: true, updated: targets.length };
}

async function cancel(input: Any, me: Profile) {
  const lesson = await loadLessonFor(me, input.lesson_id);
  const targets = await seriesScope(lesson, input.scope);
  const google = await googleConfigured();
  for (const l of targets) {
    await admin.from("lessons").update({ status: "cancelled" }).eq("id", l.id);
    if (google && l.google_event_id) await deleteMeetEvent(l.google_event_id, !!input.send_invites).catch(() => {});
  }
  return { ok: true, cancelled: targets.length };
}

async function remove(input: Any, me: Profile) {
  if (!isStaff(me)) throw new HttpError(403, "Видаляти уроки може лише менеджер");
  const lesson = await loadLessonFor(me, input.lesson_id);
  const targets = await seriesScope(lesson, input.scope);
  const google = await googleConfigured();
  for (const l of targets) {
    if (google && l.google_event_id) await deleteMeetEvent(l.google_event_id).catch(() => {});
  }
  const { error } = await admin.from("lessons").delete().in("id", targets.map((l: Any) => l.id));
  if (error) throw error;
  return { ok: true, deleted: targets.length };
}

async function ensureMeet(input: Any, me: Profile) {
  const lesson = await loadLessonFor(me, input.lesson_id);
  if (lesson.google_event_id && lesson.meet_url) return { ok: true, meet_url: lesson.meet_url };
  if (!(await googleConfigured())) throw new HttpError(409, "Google Calendar ще не підключено (Налаштування → Інтеграції)");
  const ev = await createMeetEvent({
    summary: lesson.title ?? "Урок англійської",
    start: new Date(lesson.starts_at),
    end: new Date(lesson.ends_at),
  });
  await admin.from("lessons").update({ meet_url: ev.meetUrl, google_event_id: ev.id }).eq("id", lesson.id);
  return { ok: true, meet_url: ev.meetUrl };
}

Deno.serve(handle(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
  const { profile } = await requireUser(req, ["teacher", "manager", "admin"]);
  const input = await readJson<Any>(req);
  switch (input.action) {
    case "create":
      return json(await create(input as CreateInput, profile));
    case "update":
      return json(await update(input, profile));
    case "cancel":
      return json(await cancel(input, profile));
    case "delete":
      return json(await remove(input, profile));
    case "ensure_meet":
      return json(await ensureMeet(input, profile));
    default:
      throw new HttpError(400, "Невідома дія");
  }
}));
