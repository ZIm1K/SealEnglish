// Public endpoint: trial-lesson request from the website.
import { admin, clientIp, handle, HttpError, json, readJson } from "../_shared/core.ts";

interface LeadInput {
  name?: string;
  phone?: string;
  email?: string;
  telegram?: string;
  age_group?: string;
  student_age?: number | string;
  level?: string;
  goal?: string;
  preferred_time?: string;
  comment?: string;
  utm?: Record<string, string>;
  website?: string; // honeypot
  started_at?: number; // ms timestamp when the form was rendered
}

/** Hourly rate limit. Fails open: a limiter problem must never lose a real lead. */
async function allowed(bucket: string, max: number): Promise<boolean> {
  const { data, error } = await admin.rpc("hit_rate_limit", { p_bucket: bucket, p_max: max, p_window_seconds: 3600 });
  if (error) {
    console.error("rate limit check failed", bucket, error.message);
    return true;
  }
  return data !== false;
}

const clean = (v: unknown, max: number) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};

Deno.serve(handle(async (req) => {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
  const body = await readJson<LeadInput>(req);

  // Bots: honeypot filled or form submitted inhumanly fast → pretend success.
  if (body.website || (body.started_at && Date.now() - Number(body.started_at) < 2500)) {
    return json({ ok: true });
  }

  const name = clean(body.name, 80);
  const phoneRaw = clean(body.phone, 32);
  const phone = phoneRaw ? phoneRaw.replace(/[^\d+]/g, "") : null;
  if (!name || name.length < 2) throw new HttpError(422, "Вкажіть, будь ласка, ім'я");
  if (!phone || phone.replace(/\D/g, "").length < 9) throw new HttpError(422, "Перевірте номер телефону");

  const email = clean(body.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(422, "Перевірте email");

  const ageGroup = ["kids", "teens", "adults"].includes(String(body.age_group)) ? String(body.age_group) : null;
  const ageNum = Number(body.student_age);
  const studentAge = Number.isFinite(ageNum) && ageNum >= 3 && ageNum <= 99 ? Math.round(ageNum) : null;

  const ip = clientIp(req);
  if (!(await allowed(`lead:${ip}`, 5)) || !(await allowed("lead:*", 300))) {
    throw new HttpError(429, "Забагато заявок. Спробуйте трохи пізніше або напишіть нам у Telegram.");
  }

  // Double-submit protection: same phone within 15 minutes → reuse.
  const { data: recent } = await admin
    .from("leads")
    .select("no")
    .eq("phone", phone)
    .gte("created_at", new Date(Date.now() - 15 * 60_000).toISOString())
    .limit(1)
    .maybeSingle();
  if (recent) return json({ ok: true, no: recent.no, duplicate: true });

  const utm: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.utm ?? {})) {
    if (/^(utm_[a-z]+|ref|gclid|fbclid)$/.test(k)) utm[k] = String(v).slice(0, 120);
  }

  const { data, error } = await admin
    .from("leads")
    .insert({
      name,
      phone,
      email,
      telegram_username: clean(body.telegram, 64)?.replace(/^@/, "").replace(/^https?:\/\/t\.me\//, "") ?? null,
      age_group: ageGroup,
      student_age: studentAge,
      level: clean(body.level, 40),
      goal: clean(body.goal, 200),
      preferred_time: clean(body.preferred_time, 120),
      comment: clean(body.comment, 1000),
      source: "website",
      utm,
    })
    .select("no")
    .single();
  if (error) throw error;
  return json({ ok: true, no: data.no });
}));
