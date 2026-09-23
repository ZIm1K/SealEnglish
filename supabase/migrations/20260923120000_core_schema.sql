-- Seal English — core schema
-- Roles: student / teacher / manager / admin. Lessons may target a student, a group, or a lead (trial).

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ───────────────────────── Enums ─────────────────────────
create type public.user_role as enum ('student', 'teacher', 'manager', 'admin');
create type public.age_group as enum ('kids', 'teens', 'adults');
create type public.lead_status as enum ('new', 'contacted', 'trial_scheduled', 'trial_done', 'won', 'lost');
create type public.lead_source as enum ('website', 'telegram', 'manual');
create type public.lesson_kind as enum ('regular', 'trial');
create type public.lesson_status as enum ('scheduled', 'completed', 'cancelled');
create type public.attendance_status as enum ('present', 'late', 'absent');
create type public.submission_status as enum ('submitted', 'reviewed', 'needs_revision');
create type public.material_kind as enum ('file', 'link', 'video', 'text');

-- ───────────────────────── Helpers ─────────────────────────
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ───────────────────────── Profiles ─────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'student',
  full_name text not null default '',
  email text,
  phone text,
  avatar_url text,
  age_group public.age_group,
  level text check (level in ('A0', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  bio text,
  meet_room_url text,
  telegram_chat_id bigint unique,
  telegram_username text,
  notify_telegram boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_role_idx on public.profiles (role) where is_active;
create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, phone)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(new.email, ''), '@', 1)),
    nullif(new.raw_user_meta_data ->> 'phone', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ───────────────────────── Groups ─────────────────────────
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  level text,
  age_group public.age_group,
  teacher_id uuid references public.profiles (id) on delete set null,
  color text not null default 'sky',
  description text,
  schedule_note text,
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index groups_teacher_idx on public.groups (teacher_id);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, student_id)
);
create index group_members_student_idx on public.group_members (student_id);

-- ───────────────────────── Leads (trial requests) ─────────────────────────
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  no bigint generated always as identity unique,
  name text not null,
  phone text,
  email text,
  telegram_username text,
  telegram_chat_id bigint,
  age_group public.age_group,
  student_age int check (student_age between 3 and 99),
  level text,
  goal text,
  preferred_time text,
  comment text,
  source public.lead_source not null default 'website',
  status public.lead_status not null default 'new',
  manager_id uuid references public.profiles (id) on delete set null,
  trial_lesson_id uuid,
  converted_profile_id uuid references public.profiles (id) on delete set null,
  lost_reason text,
  utm jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leads_status_idx on public.leads (status, created_at desc);
create trigger leads_touch before update on public.leads
  for each row execute function private.touch_updated_at();

create table public.lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text,
  kind text not null check (kind in ('created', 'status', 'note', 'assigned', 'trial')),
  from_status public.lead_status,
  to_status public.lead_status,
  body text,
  created_at timestamptz not null default now()
);
create index lead_events_lead_idx on public.lead_events (lead_id, created_at);

-- ───────────────────────── Lessons ─────────────────────────
create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  kind public.lesson_kind not null default 'regular',
  title text,
  topic text,
  teacher_id uuid not null references public.profiles (id) on delete restrict,
  group_id uuid references public.groups (id) on delete cascade,
  student_id uuid references public.profiles (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status public.lesson_status not null default 'scheduled',
  meet_url text,
  google_event_id text,
  series_id uuid,
  teacher_notes text,
  reminded_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lessons_time_chk check (ends_at > starts_at),
  constraint lessons_target_chk check (num_nonnulls(group_id, student_id, lead_id) = 1)
);
create index lessons_starts_idx on public.lessons (starts_at);
create index lessons_teacher_idx on public.lessons (teacher_id, starts_at);
create index lessons_student_idx on public.lessons (student_id, starts_at) where student_id is not null;
create index lessons_group_idx on public.lessons (group_id, starts_at) where group_id is not null;
create index lessons_series_idx on public.lessons (series_id) where series_id is not null;
create trigger lessons_touch before update on public.lessons
  for each row execute function private.touch_updated_at();

alter table public.leads
  add constraint leads_trial_lesson_fk foreign key (trial_lesson_id) references public.lessons (id) on delete set null;

create table public.lesson_attendance (
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  status public.attendance_status not null,
  primary key (lesson_id, student_id)
);

-- ───────────────────────── Materials ─────────────────────────
create table public.materials (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  kind public.material_kind not null default 'file',
  url text,
  storage_path text unique,
  file_name text,
  file_size bigint,
  mime_type text,
  body text,
  level text,
  tags text[] not null default '{}',
  owner_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index materials_owner_idx on public.materials (owner_id);

create table public.material_shares (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials (id) on delete cascade,
  group_id uuid references public.groups (id) on delete cascade,
  student_id uuid references public.profiles (id) on delete cascade,
  shared_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint material_shares_target_chk check (num_nonnulls(group_id, student_id) = 1),
  constraint material_shares_uniq unique nulls not distinct (material_id, group_id, student_id)
);
create index material_shares_group_idx on public.material_shares (group_id);
create index material_shares_student_idx on public.material_shares (student_id);

-- ───────────────────────── Homework ─────────────────────────
create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  teacher_id uuid not null references public.profiles (id) on delete cascade,
  group_id uuid references public.groups (id) on delete cascade,
  student_id uuid references public.profiles (id) on delete cascade,
  lesson_id uuid references public.lessons (id) on delete set null,
  due_at timestamptz,
  max_score int not null default 12 check (max_score between 1 and 100),
  attachments jsonb not null default '[]'::jsonb,
  reminded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint assignments_target_chk check (num_nonnulls(group_id, student_id) = 1)
);
create index assignments_teacher_idx on public.assignments (teacher_id, created_at desc);
create index assignments_group_idx on public.assignments (group_id) where group_id is not null;
create index assignments_student_idx on public.assignments (student_id) where student_id is not null;

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.assignments (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  body text,
  attachments jsonb not null default '[]'::jsonb,
  status public.submission_status not null default 'submitted',
  score int check (score >= 0),
  feedback text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  constraint submissions_uniq unique (assignment_id, student_id)
);
create index submissions_student_idx on public.submissions (student_id);

-- ───────────────────────── Notifications (in-app + Telegram outbox) ─────────────────────────
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  data jsonb not null default '{}'::jsonb,
  send_tg boolean not null default true,
  tg_status text check (tg_status in ('sent', 'skipped', 'failed')),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- ───────────────────────── Settings & internal tables ─────────────────────────
create table public.app_settings (
  key text primary key,
  value jsonb not null default 'null'::jsonb,
  is_public boolean not null default false,
  updated_at timestamptz not null default now()
);

-- Internal: accessed only by Edge Functions (service role). RLS on, no policies.
create table public.tg_sessions (
  chat_id bigint primary key,
  state text,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.tg_link_codes (
  code text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  expires_at timestamptz not null
);

create table public.oauth_states (
  state text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  return_to text,
  created_at timestamptz not null default now()
);

create table public.api_hits (
  id bigint generated always as identity primary key,
  bucket text not null,
  created_at timestamptz not null default now()
);
create index api_hits_bucket_idx on public.api_hits (bucket, created_at);

alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.leads enable row level security;
alter table public.lead_events enable row level security;
alter table public.lessons enable row level security;
alter table public.lesson_attendance enable row level security;
alter table public.materials enable row level security;
alter table public.material_shares enable row level security;
alter table public.assignments enable row level security;
alter table public.submissions enable row level security;
alter table public.notifications enable row level security;
alter table public.app_settings enable row level security;
alter table public.tg_sessions enable row level security;
alter table public.tg_link_codes enable row level security;
alter table public.oauth_states enable row level security;
alter table public.api_hits enable row level security;

revoke all on public.tg_sessions, public.tg_link_codes, public.oauth_states, public.api_hits from anon, authenticated;
