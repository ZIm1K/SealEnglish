export type Role = "student" | "teacher" | "manager" | "admin";
export type AgeGroup = "kids" | "teens" | "adults";
export type LeadStatus = "new" | "contacted" | "trial_scheduled" | "trial_done" | "won" | "lost";
export type LeadSource = "website" | "telegram" | "manual";
export type LessonStatus = "scheduled" | "completed" | "cancelled";
export type LessonKind = "regular" | "trial";
export type SubmissionStatus = "submitted" | "reviewed" | "needs_revision";
export type MaterialKind = "file" | "link" | "video" | "text";
export type AttendanceStatus = "present" | "late" | "absent";

export interface Profile {
  id: string;
  role: Role;
  full_name: string;
  email: string | null;
  phone: string | null;
  avatar_url: string | null;
  age_group: AgeGroup | null;
  level: string | null;
  bio: string | null;
  meet_room_url: string | null;
  telegram_chat_id: number | null;
  telegram_username: string | null;
  notify_telegram: boolean;
  is_active: boolean;
  created_at: string;
}

export type ProfileLite = Pick<Profile, "id" | "full_name" | "avatar_url"> & Partial<Pick<Profile, "email" | "role" | "level">>;

export interface Group {
  id: string;
  name: string;
  level: string | null;
  age_group: AgeGroup | null;
  teacher_id: string | null;
  color: string;
  description: string | null;
  schedule_note: string | null;
  is_archived: boolean;
  created_at: string;
  teacher?: ProfileLite | null;
  members?: { student: ProfileLite }[];
}

export interface Lesson {
  id: string;
  kind: LessonKind;
  title: string | null;
  topic: string | null;
  teacher_id: string;
  group_id: string | null;
  student_id: string | null;
  starts_at: string;
  ends_at: string;
  status: LessonStatus;
  meet_url: string | null;
  google_event_id: string | null;
  series_id: string | null;
  teacher_notes: string | null;
  teacher?: ProfileLite | null;
  student?: ProfileLite | null;
  group?: Pick<Group, "id" | "name" | "color"> | null;
  lesson_leads?: LessonLead[];
}

export interface LessonLead {
  lead_id: string;
  attended: boolean | null;
  lead?: { id: string; name: string; phone: string | null; status: LeadStatus } | null;
}

export interface Lead {
  id: string;
  no: number;
  name: string;
  phone: string | null;
  email: string | null;
  telegram_username: string | null;
  telegram_chat_id: number | null;
  age_group: AgeGroup | null;
  student_age: number | null;
  level: string | null;
  goal: string | null;
  preferred_time: string | null;
  comment: string | null;
  source: LeadSource;
  status: LeadStatus;
  manager_id: string | null;
  trial_lesson_id: string | null;
  converted_profile_id: string | null;
  lost_reason: string | null;
  level_estimate: string | null;
  utm: Record<string, string>;
  created_at: string;
  updated_at: string;
  manager?: ProfileLite | null;
  trial?: Pick<Lesson, "id" | "starts_at" | "meet_url" | "status"> & { teacher?: ProfileLite | null } | null;
}

export interface LeadEvent {
  id: string;
  lead_id: string;
  actor_id: string | null;
  actor_name: string | null;
  kind: "created" | "status" | "note" | "assigned" | "trial";
  from_status: LeadStatus | null;
  to_status: LeadStatus | null;
  body: string | null;
  created_at: string;
  actor?: ProfileLite | null;
}

export interface Attachment {
  name: string;
  path?: string;
  url?: string;
  size?: number;
  type?: string;
}

export interface Material {
  id: string;
  title: string;
  description: string | null;
  kind: MaterialKind;
  url: string | null;
  storage_path: string | null;
  file_name: string | null;
  file_size: number | null;
  mime_type: string | null;
  body: string | null;
  level: string | null;
  tags: string[];
  owner_id: string | null;
  created_at: string;
  owner?: ProfileLite | null;
  shares?: { id: string; group_id: string | null; student_id: string | null; group?: { name: string } | null; student?: ProfileLite | null }[];
}

export interface Assignment {
  id: string;
  title: string;
  description: string | null;
  teacher_id: string;
  group_id: string | null;
  student_id: string | null;
  lesson_id: string | null;
  due_at: string | null;
  max_score: number;
  attachments: Attachment[];
  created_at: string;
  teacher?: ProfileLite | null;
  group?: Pick<Group, "id" | "name" | "color"> | null;
  student?: ProfileLite | null;
  submissions?: Submission[];
}

export interface Submission {
  id: string;
  assignment_id: string;
  student_id: string;
  body: string | null;
  attachments: Attachment[];
  status: SubmissionStatus;
  score: number | null;
  feedback: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  student?: ProfileLite | null;
}

export type MistakeCategory = "grammar" | "vocabulary" | "spelling" | "word_order" | "punctuation" | "pronunciation" | "style" | "other";

export interface MistakeItem {
  category: MistakeCategory;
  example: string;
  correction: string;
  explanation?: string | null;
  student_id?: string | null;
  student_name?: string | null;
}

export interface StudentMistake extends MistakeItem {
  id: string;
  student_id: string;
  source: "lesson" | "homework" | "practice" | "teacher";
  occurrences: number;
  last_seen_at: string;
  resolved_at: string | null;
}

export interface LessonSummary {
  lesson_id: string;
  notes: string | null;
  vocabulary: { term: string; meaning?: string; example?: string }[];
  grammar: { point: string; note?: string }[];
  mistakes: MistakeItem[];
  recap: string | null;
  status: "draft" | "published";
  published_at: string | null;
  updated_at: string;
}

export interface SubmissionAiReview {
  submission_id: string;
  status: "pending" | "ready" | "approved" | "discarded" | "failed";
  feedback: string | null;
  score: number | null;
  teacher_note: string | null;
  mistakes: MistakeItem[];
  error: string | null;
  updated_at: string;
}

export interface PracticeSummary {
  summary: string;
  strengths: string[];
  mistakes: MistakeItem[];
  vocabulary_used: string[];
  engagement: "low" | "medium" | "high";
}

export interface PracticeSession {
  id: string;
  student_id: string;
  lesson_id: string | null;
  topic: string | null;
  started_at: string;
  last_activity_at: string;
  ended_at: string | null;
  turns: number;
  summary: PracticeSummary | null;
  flagged: boolean;
  flag_reason: string | null;
  reviewed_at: string | null;
  student?: ProfileLite | null;
}

export interface PracticeTurn {
  id: number;
  role: "user" | "assistant";
  content: string;
  flagged: boolean;
  created_at: string;
}

export interface AiFeatures {
  enabled: boolean;
  tutor: boolean;
  review: boolean;
  lesson: boolean;
  risk: boolean;
  parent_reports: boolean;
  tutor_messages_left: number;
}

export interface RiskRow {
  student_id: string;
  full_name: string;
  score: number;
  signals: Record<string, number>;
  explanation: string | null;
  computed_on: string;
  prev_score: number | null;
}

export const MISTAKE_LABEL: Record<MistakeCategory, string> = {
  grammar: "Граматика",
  vocabulary: "Лексика",
  spelling: "Правопис",
  word_order: "Порядок слів",
  punctuation: "Пунктуація",
  pronunciation: "Вимова",
  style: "Стиль",
  other: "Інше",
};

export interface Notification {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export const ROLE_LABEL: Record<Role, string> = {
  student: "Учень",
  teacher: "Викладач",
  manager: "Менеджер",
  admin: "Адміністратор",
};

export const AGE_LABEL: Record<AgeGroup, string> = {
  kids: "Діти 6–11",
  teens: "Підлітки 12–18",
  adults: "Дорослі",
};

export const LEVELS = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"] as const;

export const LEAD_STATUS: Record<LeadStatus, { label: string; tone: "seal" | "coral" | "mint" | "sun" | "grape" | "gray" | "red" | "ocean"; dot: string }> = {
  new: { label: "Нова", tone: "coral", dot: "bg-coral-500" },
  contacted: { label: "Зв'язалися", tone: "sun", dot: "bg-amber-400" },
  trial_scheduled: { label: "Пробний призначено", tone: "seal", dot: "bg-seal-500" },
  trial_done: { label: "Пробний проведено", tone: "grape", dot: "bg-violet-400" },
  won: { label: "Став учнем", tone: "mint", dot: "bg-emerald-500" },
  lost: { label: "Відмова", tone: "gray", dot: "bg-slate-400" },
};

export const LEAD_FLOW: LeadStatus[] = ["new", "contacted", "trial_scheduled", "trial_done", "won", "lost"];

export const SUBMISSION_STATUS: Record<SubmissionStatus, { label: string; tone: "seal" | "mint" | "sun" }> = {
  submitted: { label: "На перевірці", tone: "seal" },
  reviewed: { label: "Перевірено", tone: "mint" },
  needs_revision: { label: "Доопрацювати", tone: "sun" },
};

export const GROUP_COLORS: Record<string, { bg: string; text: string; dot: string; soft: string; hex: string }> = {
  sky: { bg: "bg-seal-500", text: "text-seal-700", dot: "bg-seal-500", soft: "bg-seal-100", hex: "#5f9fe3" },
  coral: { bg: "bg-coral-500", text: "text-coral-700", dot: "bg-coral-500", soft: "bg-coral-100", hex: "#fb7b63" },
  mint: { bg: "bg-emerald-500", text: "text-emerald-700", dot: "bg-emerald-500", soft: "bg-emerald-50", hex: "#10b981" },
  grape: { bg: "bg-violet-500", text: "text-violet-700", dot: "bg-violet-500", soft: "bg-violet-50", hex: "#8b5cf6" },
  sun: { bg: "bg-amber-500", text: "text-amber-700", dot: "bg-amber-500", soft: "bg-amber-50", hex: "#f59e0b" },
  ink: { bg: "bg-ocean-800", text: "text-ocean-800", dot: "bg-ocean-800", soft: "bg-slate-100", hex: "#16447a" },
};
