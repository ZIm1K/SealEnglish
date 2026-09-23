import { getSecret, TZ } from "./core.ts";

const CAL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

let cachedToken: { token: string; exp: number } | null = null;

export async function googleConfigured(): Promise<boolean> {
  return !!(await getSecret("google_refresh_token"));
}

export async function googleAccessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;
  const [refresh, clientId, clientSecret] = await Promise.all([
    getSecret("google_refresh_token"),
    getSecret("google_client_id"),
    getSecret("google_client_secret"),
  ]);
  if (!refresh || !clientId || !clientSecret) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    console.error("google token refresh failed", data);
    return null;
  }
  cachedToken = { token: data.access_token, exp: Date.now() + (data.expires_in ?? 3600) * 1000 };
  return cachedToken.token;
}

export interface MeetEventInput {
  summary: string;
  description?: string;
  start: Date;
  end: Date;
  attendees?: string[];
  sendUpdates?: boolean;
  /** Reuse an existing Meet conference (series share one link). */
  conferenceData?: unknown;
}

export interface MeetEvent {
  id: string;
  meetUrl: string | null;
  conferenceData: unknown;
}

async function gfetch(url: string, init: RequestInit): Promise<Response> {
  const token = await googleAccessToken();
  if (!token) throw new Error("GOOGLE_NOT_CONNECTED");
  return fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
}

function eventBody(input: MeetEventInput) {
  const attendees = [...new Set((input.attendees ?? []).filter((e) => e && e.includes("@")))].map((email) => ({ email }));
  return {
    summary: input.summary,
    description: input.description,
    start: { dateTime: input.start.toISOString(), timeZone: TZ },
    end: { dateTime: input.end.toISOString(), timeZone: TZ },
    attendees,
    guestsCanSeeOtherGuests: false,
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 15 }] },
    conferenceData: input.conferenceData ?? {
      createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } },
    },
  };
}

function toMeetEvent(data: Record<string, unknown>): MeetEvent {
  // deno-lint-ignore no-explicit-any
  const conf = data.conferenceData as any;
  const video = conf?.entryPoints?.find((e: { entryPointType: string }) => e.entryPointType === "video");
  return { id: data.id as string, meetUrl: (data.hangoutLink as string) ?? video?.uri ?? null, conferenceData: conf ?? null };
}

export async function createMeetEvent(input: MeetEventInput): Promise<MeetEvent> {
  const params = new URLSearchParams({ conferenceDataVersion: "1", sendUpdates: input.sendUpdates ? "all" : "none" });
  const res = await gfetch(`${CAL}?${params}`, { method: "POST", body: JSON.stringify(eventBody(input)) });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google Calendar: ${data?.error?.message ?? res.status}`);
  let ev = toMeetEvent(data);
  // Meet link creation can be asynchronous: poll briefly while status is pending.
  // deno-lint-ignore no-explicit-any
  for (let i = 0; i < 4 && !ev.meetUrl && (data.conferenceData as any)?.createRequest?.status?.statusCode === "pending"; i++) {
    await new Promise((r) => setTimeout(r, 700));
    const again = await gfetch(`${CAL}/${ev.id}`, { method: "GET" });
    ev = toMeetEvent(await again.json());
  }
  return ev;
}

export async function patchMeetEvent(eventId: string, patch: Partial<MeetEventInput>): Promise<void> {
  const body: Record<string, unknown> = {};
  if (patch.summary) body.summary = patch.summary;
  if (patch.description !== undefined) body.description = patch.description;
  if (patch.start) body.start = { dateTime: patch.start.toISOString(), timeZone: TZ };
  if (patch.end) body.end = { dateTime: patch.end.toISOString(), timeZone: TZ };
  const params = new URLSearchParams({ sendUpdates: patch.sendUpdates ? "all" : "none" });
  const res = await gfetch(`${CAL}/${eventId}?${params}`, { method: "PATCH", body: JSON.stringify(body) });
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`Google Calendar: ${data?.error?.message ?? res.status}`);
  }
}

export async function deleteMeetEvent(eventId: string, notify = false): Promise<void> {
  const params = new URLSearchParams({ sendUpdates: notify ? "all" : "none" });
  const res = await gfetch(`${CAL}/${eventId}?${params}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    console.error("google delete failed", res.status, await res.text());
  }
}
