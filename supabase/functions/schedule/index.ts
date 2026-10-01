// Lessons: create (single / weekly series) with Google Meet, reschedule, cancel, delete;
// trial lessons in a mini-group of up to 4 leads (FR-26): add / remove a lead, each lead keeps its own status;
// substitutions and handover of groups / students between teachers (staff);
// internal: purge Google events of removed lessons (queue `google_event_trash`) and sweep orphaned Seal events.
import {
  admin, fmtKyiv, handle, HttpError, isInternal, isStaff, json, logError, readJson, requireUser, zonedToUtc, type Profile,
} from "../_shared/core.ts";
import {
  addEventAttendees, createMeetEvent, deleteMeetEvent, googleConfigured, listSealEvents, patchMeetEvent, swapEventAttendee,
} from "../_shared/google.ts";
import { esc, isPublicHttps, sendMessage } from "../_shared/telegram.ts";

// deno-lint-ignore no-explicit-any
type Any = any;

const MAX_TRIAL_LEADS = 4;

interface CreateInput {
  action: "create";
  teacher_id?: string;
  /** `lead` (one id) is kept for older clients; `leads` creates a group trial. */
  target: { type: "student" | "group" | "lead" | "leads"; id?: string; ids?: string[] };
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
    return { label: data.full_name, studentIds: [data.id], emails: [data.email].filter(Boolean) as string[], leads: [] as Any[] };
  }
  if (target.type === "group") {
    const { data: g } = await admin.from("groups").select("id, name, teacher_id, is_archived").eq("id", target.id).maybeSingle();
    if (!g || g.is_archived) throw new HttpError(422, "Групу не знайдено");
    const { data: members } = await admin.from("group_members").select("student:profiles!group_members_student_id_fkey(id, email, is_active)").eq("group_id", g.id);
    const active = (members ?? []).map((m: Any) => m.student).filter((s: Any) => s?.is_active);
    return { label: g.name, group: g, studentIds: active.map((s: Any) => s.id), emails: active.map((s: Any) => s.email).filter(Boolean), leads: [] as Any[] };
  }
  const ids = [...new Set(target.type === "lead" ? [target.id] : target.ids ?? [])].filter(Boolean) as string[];
  if (!ids.length) throw new HttpError(422, "Оберіть заявку");
  if (ids.length > MAX_TRIAL_LEADS) throw new HttpError(422, `У пробній міні-групі максимум ${MAX_TRIAL_LEADS} учасники`);
  const { data: leads } = await admin.from("leads").select("*").in("id", ids);
  if (!leads || leads.length !== ids.length) throw new HttpError(422, "Заявку не знайдено");
  return {
    label: leads.length === 1 ? leads[0].name : `міні-група (${leads.length})`,
    studentIds: [] as string[],
    emails: leads.map((l: Any) => l.email).filter(Boolean) as string[],
    leads,
  };
}

/** Attaches a lead to a trial lesson: funnel status, timeline and a Telegram message with the Meet link. */
async function attachLead(lead: Any, lesson: { id: string; starts_at: string; meet_url: string | null }, teacherName: string, me: Profile) {
  const next = ["new", "contacted"].includes(lead.status) ? "trial_scheduled" : lead.status;
  await admin.from("leads").update({
    status: next,
    trial_lesson_id: lesson.id,
    manager_id: lead.manager_id ?? (isStaff(me) ? me.id : null),
  }).eq("id", lead.id);
  await admin.from("lead_events").insert({
    lead_id: lead.id, kind: "trial", actor_id: me.id,
    body: `Пробний урок ${fmtKyiv(lesson.starts_at)} · ${teacherName}`,
    from_status: lead.status, to_status: next,
  });
  if (lead.telegram_chat_id) {
    const kb = isPublicHttps(lesson.meet_url) ? { inline_keyboard: [[{ text: "🎥 Посилання на урок", url: lesson.meet_url }]] } : undefined;
    await sendMessage(lead.telegram_chat_id, `🎁 <b>Пробний урок призначено!</b>\n\n🗓 ${esc(fmtKyiv(lesson.starts_at, { weekday: "long" }))}\n👩‍🏫 Викладач: ${esc(teacherName)}\n\nЯ нагадаю за годину до початку 🦭`, kb ? { reply_markup: kb } : {});
  }
}

async function create(input: CreateInput, me: Profile) {
  const teacherId = isStaff(me) ? (input.teacher_id ?? me.id) : me.id;
  if (!isStaff(me) && input.teacher_id && input.teacher_id !== me.id) throw new HttpError(403, "Викладач може планувати лише власні уроки");
  const trial = input.target?.type === "lead" || input.target?.type === "leads";
  if (trial && !isStaff(me)) throw new HttpError(403, "Пробні уроки призначає менеджер");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? "") || !/^\d{2}:\d{2}$/.test(input.time ?? "")) throw new HttpError(422, "Вкажіть дату й час");

  const { data: teacher } = await admin.from("profiles").select("id, full_name, email, role, meet_room_url, is_active").eq("id", teacherId).maybeSingle();
  if (!teacher || !teacher.is_active || !["teacher", "manager", "admin"].includes(teacher.role)) throw new HttpError(422, "Викладача не знайдено");

  const who = await participants(input.target);
  if (input.target.type === "group" && !isStaff(me) && who.group?.teacher_id !== me.id) throw new HttpError(403, "Це не ваша група");

  const duration = Math.min(Math.max(Number(input.duration_min) || 60, 15), 240);
  const weeks = trial ? 0 : Math.min(Math.max(Number(input.repeat_weeks) || 0, 0), 52);
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

  const kind = trial ? "trial" : "regular";
  const title = input.title?.trim() || (trial ? `Пробний урок · ${who.label}` : `Англійська · ${who.label}`);
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
      const description = `Seal English · ${trial ? "пробний урок" : "урок англійської"}\nВикладач: ${teacher.full_name}`;
      const first = await createMeetEvent({ summary: title, description, start: occurrences[0].start, end: occurrences[0].end, attendees, sendUpdates: !!input.send_invites });
      events[0] = { id: first.id, meetUrl: first.meetUrl };
      if (occurrences.length > 1) {
        const rest = await mapLimit(occurrences.slice(1), 4, (o) =>
          createMeetEvent({ summary: title, description, start: o.start, end: o.end, attendees, sendUpdates: false, conferenceData: first.conferenceData ?? undefined })
            .then((e) => ({ id: e.id, meetUrl: e.meetUrl ?? first.meetUrl }))
            .catch(async (e) => {
              await logError("schedule:meet", e, { occurrence: o.start });
              return { id: null, meetUrl: first.meetUrl };
            }));
        events = [events[0], ...rest];
      }
    } catch (e) {
      googleError = e instanceof Error ? e.message : String(e);
      await logError("schedule:meet", e, { stage: "create" });
    }
  }

  const rows = occurrences.map((o, i) => ({
    kind,
    title,
    topic: input.topic?.trim() || null,
    teacher_id: teacher.id,
    group_id: input.target.type === "group" ? input.target.id : null,
    student_id: input.target.type === "student" ? input.target.id : null,
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
  // The first regular lesson assigns an unassigned student / group to this teacher.
  if (input.target.type === "student") await admin.from("profiles").update({ teacher_id: teacher.id }).eq("id", input.target.id).is("teacher_id", null);
  if (input.target.type === "group") await admin.from("groups").update({ teacher_id: teacher.id }).eq("id", input.target.id).is("teacher_id", null);
  const when = occurrences.length > 1
    ? `${weekdays.map((d) => WEEKDAY_UA[d]).join(", ")} о ${input.time}, ${occurrences.length} уроків з ${fmtKyiv(occurrences[0].start, { hour: undefined, minute: undefined })}`
    : fmtKyiv(occurrences[0].start);

  // In-app + Telegram notifications (students, and the teacher if someone else planned it).
  const notify = [...who.studentIds];
  if (teacher.id !== me.id) notify.push(teacher.id);
  if (notify.length) {
    await admin.from("notifications").insert(notify.map((uid) => ({
      user_id: uid,
      kind: trial ? "trial_new" : "lesson_new",
      title: trial ? "Призначено пробний урок" : occurrences.length > 1 ? "Новий розклад уроків" : "Новий урок",
      body: `${title} · ${when}`,
      link: "/app/schedule/",
      data: { lesson_id: firstLesson.id, meet_url: firstLesson.meet_url },
    })));
  }

  if (trial) {
    const { error: llErr } = await admin.from("lesson_leads").insert(who.leads.map((l: Any) => ({ lesson_id: firstLesson.id, lead_id: l.id })));
    if (llErr) throw llErr;
    for (const lead of who.leads) await attachLead(lead, firstLesson, teacher.full_name, me);
  }

  return { ok: true, created: lessons!.length, lesson_id: firstLesson.id, series_id: seriesId, meet: events.some((e) => e.meetUrl), google_connected: google, google_error: googleError };
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
  if (lesson.status === "cancelled") throw new HttpError(409, "Урок скасовано");
  const targets = await seriesScope(lesson, input.scope);
  const google = await googleConfigured();
  const shiftMs = input.date && input.time
    ? zonedToUtc(input.date, input.time).getTime() - new Date(lesson.starts_at).getTime()
    : 0;
  const duration = input.duration_min ? Math.min(Math.max(Number(input.duration_min), 15), 240) : null;
  // A teacher change from the lesson card is a substitution: the assigned teacher is remembered.
  if (input.teacher_id && input.teacher_id !== lesson.teacher_id) {
    if (!isStaff(me)) throw new HttpError(403, "Змінити викладача може лише менеджер");
    await substitute({ lesson_ids: targets.map((l: Any) => l.id), teacher_id: input.teacher_id, send_invites: input.send_invites }, me);
  }
  if (!shiftMs && !duration && input.title === undefined && input.topic === undefined) return { ok: true, updated: targets.length };

  for (const l of targets) {
    const start = new Date(new Date(l.starts_at).getTime() + shiftMs);
    const end = duration ? new Date(start.getTime() + duration * 60000) : new Date(new Date(l.ends_at).getTime() + shiftMs);
    const patch: Record<string, unknown> = { starts_at: start.toISOString(), ends_at: end.toISOString() };
    if (input.title !== undefined) patch.title = input.title || null;
    if (input.topic !== undefined && l.id === lesson.id) patch.topic = input.topic || null;
    const { error } = await admin.from("lessons").update(patch).eq("id", l.id);
    if (error) throw error;
    if (google && l.google_event_id && (shiftMs || duration || input.title !== undefined)) {
      await patchMeetEvent(l.google_event_id, { start, end, summary: (patch.title as string) ?? undefined, sendUpdates: !!input.send_invites })
        .catch((e) => logError("schedule:meet", e, { stage: "patch", lesson_id: l.id }));
    }
  }
  return { ok: true, updated: targets.length };
}

async function cancel(input: Any, me: Profile) {
  const lesson = await loadLessonFor(me, input.lesson_id);
  const targets = await seriesScope(lesson, input.scope);
  // With invites the guests get Google's cancellation e-mail; otherwise the queue removes the events silently.
  if (input.send_invites && (await googleConfigured())) {
    for (const l of targets) {
      if (l.google_event_id) await deleteMeetEvent(l.google_event_id, true).catch((e) => logError("schedule:meet", e, { stage: "cancel", lesson_id: l.id }));
    }
  }
  const { error } = await admin.from("lessons").update({ status: "cancelled" }).in("id", targets.map((l: Any) => l.id));
  if (error) throw error;
  const google = await purgeGoogle(targets.map((l: Any) => l.google_event_id).filter(Boolean));
  // leads of a cancelled trial go back to "contacted" so the manager reschedules them
  if (lesson.kind === "trial") {
    const { data: ll } = await admin.from("lesson_leads").select("lead:leads(id, status, trial_lesson_id)").eq("lesson_id", lesson.id);
    for (const { lead } of (ll ?? []) as Any[]) {
      if (lead?.status === "trial_scheduled" && lead.trial_lesson_id === lesson.id) {
        await admin.from("leads").update({ status: "contacted" }).eq("id", lead.id);
        await admin.from("lead_events").insert({ lead_id: lead.id, kind: "status", from_status: "trial_scheduled", to_status: "contacted", actor_id: me.id, body: "Пробний урок скасовано" });
      }
    }
  }
  return { ok: true, cancelled: targets.length, google };
}

async function remove(input: Any, me: Profile) {
  if (!isStaff(me)) throw new HttpError(403, "Видаляти уроки може лише менеджер");
  const lesson = await loadLessonFor(me, input.lesson_id);
  const targets = await seriesScope(lesson, input.scope);
  // The delete trigger queues the Google events; purge them right away so the result is known.
  const { error } = await admin.from("lessons").delete().in("id", targets.map((l: Any) => l.id));
  if (error) throw error;
  const google = await purgeGoogle(targets.map((l: Any) => l.google_event_id).filter(Boolean));
  return { ok: true, deleted: targets.length, google };
}

async function ensureMeet(input: Any, me: Profile) {
  const lesson = await loadLessonFor(me, input.lesson_id);
  if (lesson.google_event_id && lesson.meet_url) return { ok: true, meet_url: lesson.meet_url };
  if (!(await googleConfigured())) throw new HttpError(409, "Google Calendar ще не підключено (Налаштування → Інтеграції)");
  const ev = await createMeetEvent({
    summary: lesson.title ?? "Урок англійської",
    description: "Seal English · урок англійської",
    start: new Date(lesson.starts_at),
    end: new Date(lesson.ends_at),
  });
  await admin.from("lessons").update({ meet_url: ev.meetUrl, google_event_id: ev.id }).eq("id", lesson.id);
  return { ok: true, meet_url: ev.meetUrl };
}

async function addLead(input: Any, me: Profile) {
  if (!isStaff(me)) throw new HttpError(403, "Пробні уроки призначає менеджер");
  const lesson = await loadLessonFor(me, input.lesson_id);
  if (lesson.kind !== "trial") throw new HttpError(422, "Це не пробний урок");
  if (lesson.status !== "scheduled" || new Date(lesson.ends_at) < new Date()) throw new HttpError(409, "Урок уже відбувся або скасований");
  const { data: lead } = await admin.from("leads").select("*").eq("id", input.lead_id).maybeSingle();
  if (!lead) throw new HttpError(404, "Заявку не знайдено");
  const { error } = await admin.from("lesson_leads").insert({ lesson_id: lesson.id, lead_id: lead.id });
  if (error) {
    if (error.code === "23505") throw new HttpError(409, "Ця заявка вже в цьому уроці");
    if (/максимум/.test(error.message)) throw new HttpError(422, `У пробній міні-групі максимум ${MAX_TRIAL_LEADS} учасники`);
    throw error;
  }
  const { data: teacher } = await admin.from("profiles").select("full_name").eq("id", lesson.teacher_id).maybeSingle();
  await attachLead(lead, lesson, teacher?.full_name ?? "", me);
  if (lead.email && lesson.google_event_id && (await googleConfigured())) {
    await addEventAttendees(lesson.google_event_id, [lead.email], !!input.send_invites).catch((e) => logError("schedule:meet", e, { stage: "attendee", lesson_id: lesson.id }));
  }
  return { ok: true };
}

async function removeLead(input: Any, me: Profile) {
  if (!isStaff(me)) throw new HttpError(403, "Недостатньо прав");
  const lesson = await loadLessonFor(me, input.lesson_id);
  const { data: lead } = await admin.from("leads").select("id, status, trial_lesson_id").eq("id", input.lead_id).maybeSingle();
  if (!lead) throw new HttpError(404, "Заявку не знайдено");
  await admin.from("lesson_leads").delete().eq("lesson_id", lesson.id).eq("lead_id", lead.id);
  const patch: Record<string, unknown> = {};
  if (lead.trial_lesson_id === lesson.id) patch.trial_lesson_id = null;
  if (lead.status === "trial_scheduled") patch.status = "contacted";
  if (Object.keys(patch).length) await admin.from("leads").update(patch).eq("id", lead.id);
  await admin.from("lead_events").insert({
    lead_id: lead.id, kind: "trial", actor_id: me.id, body: `Знято з пробного уроку ${fmtKyiv(lesson.starts_at)}`,
    from_status: lead.status, to_status: (patch.status as string) ?? lead.status,
  });
  return { ok: true };
}

// ───────────── Google cleanup ─────────────
const PURGE_MAX_ATTEMPTS = 30;

/** Deletes queued events from Google. `only` limits the run to these ids (the lessons just removed). */
async function purgeGoogle(only?: string[]) {
  if (only && !only.length) return { deleted: 0, failed: 0 };
  if (!(await googleConfigured())) return { deleted: 0, failed: 0, skipped: "google_not_connected" };
  let q = admin.from("google_event_trash").select("*").lt("attempts", PURGE_MAX_ATTEMPTS).order("created_at").limit(100);
  if (only) q = q.in("event_id", only);
  const { data: rows } = await q;
  let deleted = 0;
  let failed = 0;
  await mapLimit(rows ?? [], 4, async (r: Any) => {
    try {
      await deleteMeetEvent(r.event_id);
      await admin.from("google_event_trash").delete().eq("event_id", r.event_id);
      deleted++;
    } catch (e) {
      failed++;
      const attempts = r.attempts + 1;
      const message = e instanceof Error ? e.message : String(e);
      await admin.from("google_event_trash").update({ attempts, last_error: message.slice(0, 500), tried_at: new Date().toISOString() }).eq("event_id", r.event_id);
      if (attempts === 1 || attempts === PURGE_MAX_ATTEMPTS) await logError("schedule:google-delete", e, { event_id: r.event_id, attempts });
    }
  });
  return { deleted, failed };
}

/** Removes Seal events in the school calendar that no longer belong to a lesson (deleted or cancelled). */
async function syncGoogle() {
  if (!(await googleConfigured())) throw new HttpError(409, "Google Calendar ще не підключено");
  const events = await listSealEvents(new Date(Date.now() - 24 * 3600_000));
  const ids = events.map((e) => e.id);
  const alive = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin.from("lessons").select("google_event_id").in("google_event_id", ids.slice(i, i + 200)).neq("status", "cancelled");
    if (error) throw error;
    for (const l of data ?? []) alive.add(l.google_event_id);
  }
  // Skip events created in the last 15 minutes: their lesson may still be being saved.
  const orphans = events.filter((e) => !alive.has(e.id) && (!e.created || Date.now() - new Date(e.created).getTime() > 15 * 60_000));
  const removed: { summary: string; start: string | null }[] = [];
  await mapLimit(orphans, 4, async (e) => {
    try {
      await deleteMeetEvent(e.id);
      removed.push({ summary: e.summary, start: e.start });
    } catch (err) {
      await logError("schedule:google-sweep", err, { event_id: e.id });
    }
  });
  if (orphans.length) await admin.from("google_event_trash").delete().in("event_id", orphans.map((e) => e.id));
  const queue = await purgeGoogle();
  return { ok: true, checked: events.length, removed: removed.length, failed: orphans.length - removed.length, events: removed.slice(0, 50), queue };
}

// ───────────── Teachers: substitutions & handover ─────────────
async function loadTeacher(id: string) {
  const { data: t } = await admin.from("profiles").select("id, full_name, email, role, is_active").eq("id", id).maybeSingle();
  if (!t || !t.is_active || !["teacher", "manager", "admin"].includes(t.role)) throw new HttpError(422, "Викладача не знайдено");
  return t;
}

/** In Google the new teacher replaces the previous one among the guests; the Meet link stays. */
async function swapGuests(lessons: Any[], toEmail: string | null, notify: boolean) {
  if (!lessons.some((l) => l.google_event_id) || !(await googleConfigured())) return;
  const { data: prev } = await admin.from("profiles").select("id, email").in("id", [...new Set(lessons.map((l) => l.teacher_id))]);
  const emailOf = new Map((prev ?? []).map((p: Any) => [p.id, p.email as string | null]));
  await mapLimit(lessons.filter((l) => l.google_event_id), 4, (l) =>
    swapEventAttendee(l.google_event_id, emailOf.get(l.teacher_id) ?? null, toEmail, notify)
      .catch((e) => logError("schedule:meet", e, { stage: "teacher_swap", lesson_id: l.id })));
}

const lessonLabel = (l: Any) => `${l.title ?? "Урок"} · ${fmtKyiv(l.starts_at, { weekday: "short" })}`;

function lessonList(lessons: Any[]) {
  return lessons.slice(0, 5).map(lessonLabel).join("\n") + (lessons.length > 5 ? `\n… і ще ${lessons.length - 5}` : "");
}

/**
 * Substitution for particular lessons. `substitute_for` keeps the assigned teacher; choosing that
 * teacher again returns the lesson to them and clears the mark. The substitute is paid for the lesson.
 */
async function substitute(input: Any, me: Profile) {
  if (!isStaff(me)) throw new HttpError(403, "Заміни призначає менеджер");
  const ids = [...new Set((input.lesson_ids ?? []) as string[])];
  if (!ids.length) throw new HttpError(422, "Оберіть уроки");
  if (ids.length > 200) throw new HttpError(422, "Забагато уроків за раз");
  const to = await loadTeacher(input.teacher_id);
  const { data: lessons, error: loadErr } = await admin.from("lessons").select("*").in("id", ids).eq("status", "scheduled").order("starts_at");
  if (loadErr) throw loadErr;
  const moved = (lessons ?? []).filter((l: Any) => l.teacher_id !== to.id);
  if (!moved.length) return { ok: true, changed: 0 };

  await swapGuests(moved, to.email, !!input.send_invites);
  for (const l of moved) {
    const assigned = l.substitute_for ?? l.teacher_id;
    const { error } = await admin.from("lessons").update({ teacher_id: to.id, substitute_for: assigned === to.id ? null : assigned }).eq("id", l.id);
    if (error) throw error;
  }

  // The new teacher, the teacher who had the lessons, and the students.
  const notes: Any[] = [];
  if (to.id !== me.id) {
    notes.push({
      user_id: to.id, kind: "lesson_new",
      title: moved.length > 1 ? `Вам призначено ${moved.length} уроків на заміну` : "Вам призначено урок на заміну",
      body: lessonList(moved), link: "/app/schedule/", data: { lesson_id: moved[0].id, meet_url: moved[0].meet_url },
    });
  }
  for (const prev of new Set<string>(moved.map((l: Any) => l.teacher_id))) {
    if (prev === me.id) continue;
    const mine = moved.filter((l: Any) => l.teacher_id === prev);
    notes.push({ user_id: prev, kind: "lesson_moved", title: mine.length > 1 ? `${mine.length} ваших уроків проведе ${to.full_name}` : `Ваш урок проведе ${to.full_name}`, body: lessonList(mine), link: "/app/schedule/" });
  }
  const students = new Set<string>(moved.map((l: Any) => l.student_id).filter(Boolean));
  const groupIds = [...new Set(moved.map((l: Any) => l.group_id).filter(Boolean))];
  if (groupIds.length) {
    const { data: gm } = await admin.from("group_members").select("student_id").in("group_id", groupIds);
    for (const m of gm ?? []) students.add(m.student_id);
  }
  for (const sid of students) {
    notes.push({ user_id: sid, kind: "lesson_moved", title: `Урок проведе ${to.full_name}`, body: lessonList(moved), link: "/app/schedule/" });
  }
  if (notes.length) await admin.from("notifications").insert(notes);
  return { ok: true, changed: moved.length };
}

interface ReassignItem {
  type: "group" | "student";
  id: string;
  /** null = unassign: lessons and homework stay as they are */
  to: string | null;
}

/**
 * Assigns / hands over groups and individual students. Future lessons (from `from_date`, except
 * substitutions) and the homework of that group or student follow the new teacher, so pending
 * reviews move too. Used both for routine assignment and when a teacher leaves.
 */
async function reassign(input: Any, me: Profile) {
  if (!isStaff(me)) throw new HttpError(403, "Закріплювати учнів і групи може лише менеджер");
  const items: ReassignItem[] = (input.items ?? []).filter((x: Any) => x && ["group", "student"].includes(x.type) && x.id);
  if (!items.length) throw new HttpError(422, "Нічого не обрано");
  if (items.length > 300) throw new HttpError(422, "Забагато змін за раз");
  const from = /^\d{4}-\d{2}-\d{2}$/.test(input.from_date ?? "") ? zonedToUtc(input.from_date, "00:00") : new Date();
  const moveLessons = input.lessons !== false;
  const moveHomework = input.homework !== false;
  const teachers = new Map<string, Any>();
  for (const t of new Set(items.map((x) => x.to).filter(Boolean) as string[])) teachers.set(t, await loadTeacher(t));

  const gained = new Map<string, { names: string[]; lessons: number; homework: number }>();
  const lost = new Map<string, string[]>();
  let lessonsMoved = 0;
  let homeworkMoved = 0;

  for (const it of items) {
    let name: string;
    let prev: string | null;
    if (it.type === "group") {
      const { data: g } = await admin.from("groups").select("id, name, teacher_id").eq("id", it.id).maybeSingle();
      if (!g) throw new HttpError(404, "Групу не знайдено");
      name = `група «${g.name}»`;
      prev = g.teacher_id;
      if (prev !== it.to) {
        const { error } = await admin.from("groups").update({ teacher_id: it.to }).eq("id", g.id);
        if (error) throw error;
      }
    } else {
      const { data: s } = await admin.from("profiles").select("id, full_name, role, teacher_id").eq("id", it.id).maybeSingle();
      if (!s || s.role !== "student") throw new HttpError(404, "Учня не знайдено");
      name = s.full_name;
      prev = s.teacher_id;
      if (prev !== it.to) {
        const { error } = await admin.from("profiles").update({ teacher_id: it.to }).eq("id", s.id);
        if (error) throw error;
      }
    }
    if (prev && prev !== it.to) lost.set(prev, [...(lost.get(prev) ?? []), name]);
    if (!it.to) continue;

    const to = teachers.get(it.to);
    const col = it.type === "group" ? "group_id" : "student_id";
    let lessonsHere = 0;
    let homeworkHere = 0;
    if (moveLessons) {
      const { data: future, error } = await admin.from("lessons").select("*").eq(col, it.id).eq("status", "scheduled")
        .gte("starts_at", from.toISOString()).neq("teacher_id", to.id).is("substitute_for", null);
      if (error) throw error;
      if (future?.length) {
        await swapGuests(future, to.email, false);
        const { error: upErr } = await admin.from("lessons").update({ teacher_id: to.id }).in("id", future.map((l: Any) => l.id));
        if (upErr) throw upErr;
        lessonsHere = future.length;
      }
      // Planned substitutions now stand in for the new teacher; lessons the new teacher was substituting become theirs.
      await admin.from("lessons").update({ substitute_for: to.id }).eq(col, it.id).eq("status", "scheduled")
        .gte("starts_at", from.toISOString()).not("substitute_for", "is", null).neq("teacher_id", to.id);
      await admin.from("lessons").update({ substitute_for: null }).eq(col, it.id).eq("status", "scheduled")
        .gte("starts_at", from.toISOString()).eq("teacher_id", to.id).not("substitute_for", "is", null);
    }
    if (moveHomework) {
      const { data: hw, error } = await admin.from("assignments").update({ teacher_id: to.id }).eq(col, it.id).neq("teacher_id", to.id).select("id");
      if (error) throw error;
      homeworkHere = hw?.length ?? 0;
    }
    lessonsMoved += lessonsHere;
    homeworkMoved += homeworkHere;
    if (prev !== to.id || lessonsHere || homeworkHere) {
      const g = gained.get(to.id) ?? { names: [], lessons: 0, homework: 0 };
      g.names.push(name);
      g.lessons += lessonsHere;
      g.homework += homeworkHere;
      gained.set(to.id, g);
    }
  }

  const notes: Any[] = [];
  for (const [uid, g] of gained) {
    if (uid === me.id) continue;
    const extra = [g.lessons ? `уроків у розкладі: ${g.lessons}` : "", g.homework ? `домашніх завдань: ${g.homework}` : ""].filter(Boolean).join(", ");
    notes.push({ user_id: uid, kind: "info", title: "Вам закріплено учнів", body: `${g.names.join(", ")}${extra ? `\n${extra}` : ""}`, link: "/app/groups/" });
  }
  for (const [uid, names] of lost) {
    if (uid === me.id || gained.has(uid)) continue;
    notes.push({ user_id: uid, kind: "info", title: "Учнів передано іншому викладачу", body: names.join(", "), link: "/app/groups/" });
  }
  if (notes.length) await admin.from("notifications").insert(notes);
  return { ok: true, changed: items.length, lessons: lessonsMoved, homework: homeworkMoved };
}

Deno.serve(handle(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
  if (await isInternal(req)) {
    const input = await readJson<Any>(req);
    if (input.action === "purge_google") return json({ ok: true, ...(await purgeGoogle()) });
    if (input.action === "sync_google") return json((await googleConfigured()) ? await syncGoogle() : { ok: true, skipped: true });
    throw new HttpError(400, "Невідома дія");
  }
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
    case "add_lead":
      return json(await addLead(input, profile));
    case "remove_lead":
      return json(await removeLead(input, profile));
    case "substitute":
      return json(await substitute(input, profile));
    case "reassign":
      return json(await reassign(input, profile));
    case "sync_google":
      if (!isStaff(profile)) throw new HttpError(403, "Недостатньо прав");
      return json(await syncGoogle());
    default:
      throw new HttpError(400, "Невідома дія");
  }
}));
