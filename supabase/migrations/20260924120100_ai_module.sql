-- Seal English — AI module, phase 1 (FR-11…FR-17): lesson summaries, mistake profile,
-- AI homework review drafts, text tutor, usage accounting and limits.
-- Principle P1: AI only drafts — a teacher publishes summaries and grades; students never see drafts.

-- ───────────────────────── Settings ─────────────────────────
-- Prices live in settings (ADR-07: tariffs are not hard-coded). Phase 2/3 features ship disabled.
insert into public.app_settings (key, value, is_public) values
  ('ai_settings', '{
    "enabled": false,
    "tutor_enabled": true,
    "review_enabled": true,
    "lesson_enabled": true,
    "model_main": "claude-sonnet-5",
    "model_fast": "claude-haiku-4-5",
    "tutor_daily_messages": 30,
    "tutor_daily_usd": 0.2,
    "global_daily_usd": 10,
    "pilot_group_ids": [],
    "practice_retention_days": 90,
    "usd_rate": 42,
    "avg_check_uah": 2520,
    "pricing": {
      "claude-sonnet-5": {"input": 2, "output": 10, "cache_read": 0.2, "cache_write": 2.5},
      "claude-haiku-4-5": {"input": 1, "output": 5, "cache_read": 0.1, "cache_write": 1.25}
    },
    "risk_enabled": false,
    "parent_reports_enabled": false,
    "level_test_enabled": false,
    "night_reply_enabled": false
  }'::jsonb, false),
  ('ai_configured', 'false'::jsonb, false)
on conflict (key) do nothing;

create or replace function private.ai_setting(p_key text)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select (select value from public.app_settings where key = 'ai_settings') -> p_key;
$$;

-- ───────────────────────── Tables ─────────────────────────
create table public.lesson_summaries (
  lesson_id uuid primary key references public.lessons (id) on delete cascade,
  notes text,
  vocabulary jsonb not null default '[]'::jsonb,   -- [{term, meaning, example}]
  grammar jsonb not null default '[]'::jsonb,      -- [{point, note}]
  mistakes jsonb not null default '[]'::jsonb,     -- [{category, example, correction, explanation, student_id}]
  recap text,                                      -- short recap for students (goes to lessons.teacher_notes)
  source text not null default 'teacher_form' check (source in ('teacher_form', 'transcript')),
  status text not null default 'draft' check (status in ('draft', 'published')),
  model text,
  created_by uuid references public.profiles (id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger lesson_summaries_touch before update on public.lesson_summaries
  for each row execute function private.touch_updated_at();

create table public.student_mistakes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  category text not null check (category in ('grammar', 'vocabulary', 'spelling', 'word_order', 'punctuation', 'pronunciation', 'style', 'other')),
  example text not null,
  correction text not null,
  explanation text,
  source text not null check (source in ('lesson', 'homework', 'practice', 'teacher')),
  source_id uuid,
  occurrences int not null default 1,
  key text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  constraint student_mistakes_uniq unique (student_id, key)
);
create index student_mistakes_open_idx on public.student_mistakes (student_id, occurrences desc) where resolved_at is null;

-- Drafts are a separate table so RLS guarantees students never read an unconfirmed AI score (6.3).
create table public.submission_ai_reviews (
  submission_id uuid primary key references public.submissions (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'ready', 'approved', 'discarded', 'failed')),
  feedback text,
  score int,
  teacher_note text,
  mistakes jsonb not null default '[]'::jsonb,
  model text,
  error text,
  reviewed_version timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger submission_ai_reviews_touch before update on public.submission_ai_reviews
  for each row execute function private.touch_updated_at();

create table public.practice_sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  lesson_id uuid references public.lessons (id) on delete set null,
  mode text not null default 'text' check (mode in ('text', 'voice')),
  topic text,
  context text,                                    -- prompt layers 2–4 frozen at session start (cache-friendly)
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  ended_at timestamptz,
  turns int not null default 0,
  summary jsonb,
  flagged boolean not null default false,
  flag_reason text,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz
);
create index practice_sessions_student_idx on public.practice_sessions (student_id, started_at desc);
create index practice_sessions_open_idx on public.practice_sessions (last_activity_at) where ended_at is null;

create table public.practice_turns (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.practice_sessions (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  flagged boolean not null default false,
  created_at timestamptz not null default now()
);
create index practice_turns_session_idx on public.practice_turns (session_id, id);
create index practice_turns_created_idx on public.practice_turns (created_at);

create table public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles (id) on delete set null,
  feature text not null,
  model text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cached_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  audio_seconds numeric not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  ref_id uuid,
  created_at timestamptz not null default now()
);
create index ai_usage_created_idx on public.ai_usage (created_at);
create index ai_usage_user_idx on public.ai_usage (user_id, created_at);

alter table public.lesson_summaries enable row level security;
alter table public.student_mistakes enable row level security;
alter table public.submission_ai_reviews enable row level security;
alter table public.practice_sessions enable row level security;
alter table public.practice_turns enable row level security;
alter table public.ai_usage enable row level security;

-- ───────────────────────── Access helpers ─────────────────────────
create or replace function public.teaches_submission(p_submission uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.submissions s
    join public.assignments a on a.id = s.assignment_id
    where s.id = p_submission and a.teacher_id = (select auth.uid())
  );
$$;

-- Practice turns: the student and their teachers; managers/admins see summaries only (6.3).
create or replace function public.can_read_practice(p_session uuid, p_turns boolean)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.practice_sessions ps
    where ps.id = p_session
      and (
        ps.student_id = (select auth.uid())
        or (public.is_teacher() and public.teaches_student(ps.student_id))
        or (not p_turns and public.is_staff())
      )
  );
$$;

revoke execute on function public.teaches_submission(uuid), public.can_read_practice(uuid, boolean) from public, anon;
grant execute on function public.teaches_submission(uuid), public.can_read_practice(uuid, boolean) to authenticated, service_role;

-- ───────────────────────── RLS ─────────────────────────
-- Lesson summaries: teachers of the lesson and staff; students read published vocabulary via RPC.
create policy "lesson_summaries: read" on public.lesson_summaries for select to authenticated
using (public.is_staff() or public.teaches_lesson(lesson_id));
create policy "lesson_summaries: write" on public.lesson_summaries for all to authenticated
using (public.is_staff() or public.teaches_lesson(lesson_id))
with check (public.is_staff() or public.teaches_lesson(lesson_id));

create policy "student_mistakes: read" on public.student_mistakes for select to authenticated
using (student_id = (select auth.uid()) or public.is_staff() or (public.is_teacher() and public.teaches_student(student_id)));
create policy "student_mistakes: teacher write" on public.student_mistakes for all to authenticated
using (public.is_staff() or (public.is_teacher() and public.teaches_student(student_id)))
with check (public.is_staff() or (public.is_teacher() and public.teaches_student(student_id)));

create policy "submission_ai_reviews: read" on public.submission_ai_reviews for select to authenticated
using (public.is_staff() or public.teaches_submission(submission_id));
create policy "submission_ai_reviews: update" on public.submission_ai_reviews for update to authenticated
using (public.is_staff() or public.teaches_submission(submission_id))
with check (public.is_staff() or public.teaches_submission(submission_id));
revoke insert, delete on public.submission_ai_reviews from anon, authenticated;
revoke update on public.submission_ai_reviews from anon, authenticated;
grant update (status) on public.submission_ai_reviews to authenticated;

create policy "practice_sessions: read" on public.practice_sessions for select to authenticated
using (public.can_read_practice(id, false));
create policy "practice_sessions: teacher review" on public.practice_sessions for update to authenticated
using (public.is_staff() or (public.is_teacher() and public.teaches_student(student_id)))
with check (public.is_staff() or (public.is_teacher() and public.teaches_student(student_id)));
revoke insert, delete, update on public.practice_sessions from anon, authenticated;
grant update (reviewed_by, reviewed_at) on public.practice_sessions to authenticated;

create policy "practice_turns: read" on public.practice_turns for select to authenticated
using (public.can_read_practice(session_id, true));
revoke insert, update, delete on public.practice_turns from anon, authenticated;

create policy "ai_usage: admin read" on public.ai_usage for select to authenticated
using (public.is_admin());
revoke insert, update, delete on public.ai_usage from anon, authenticated;

-- ───────────────────────── Mistake profile (FR-12) ─────────────────────────
create or replace function private.mistake_key(p_category text, p_correction text)
returns text
language sql immutable
set search_path = ''
as $$
  select p_category || ':' || left(regexp_replace(lower(trim(p_correction)), '[^[:alnum:]]+', ' ', 'g'), 160);
$$;

-- Upserts mistakes: repeated ones bump `occurrences` and reopen if they were resolved.
create or replace function private.upsert_mistakes(p_student uuid, p_source text, p_source_id uuid, p_items jsonb, p_actor uuid)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_count int := 0;
  v_cat text;
begin
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) limit 30
  loop
    continue when coalesce(trim(v_item ->> 'example'), '') = '' or coalesce(trim(v_item ->> 'correction'), '') = '';
    v_cat := case when v_item ->> 'category' in ('grammar', 'vocabulary', 'spelling', 'word_order', 'punctuation', 'pronunciation', 'style')
      then v_item ->> 'category' else 'other' end;
    insert into public.student_mistakes (student_id, category, example, correction, explanation, source, source_id, key, created_by)
    values (p_student, v_cat, left(v_item ->> 'example', 300), left(v_item ->> 'correction', 300),
      left(nullif(v_item ->> 'explanation', ''), 500), p_source, p_source_id,
      private.mistake_key(v_cat, v_item ->> 'correction'), p_actor)
    on conflict (student_id, key) do update set
      -- re-publishing the same lesson / re-reviewing the same work doesn't count the mistake twice
      occurrences = public.student_mistakes.occurrences
        + case when public.student_mistakes.source_id is not distinct from excluded.source_id then 0 else 1 end,
      source = excluded.source,
      source_id = excluded.source_id,
      example = excluded.example,
      explanation = coalesce(excluded.explanation, public.student_mistakes.explanation),
      last_seen_at = now(),
      resolved_at = null;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Teacher confirms mistakes (from an AI draft or typed by hand).
create or replace function public.add_student_mistakes(p_student uuid, p_source text, p_source_id uuid, p_items jsonb)
returns int
language plpgsql security definer
set search_path = ''
as $$
begin
  if not (public.is_staff() or (public.is_teacher() and public.teaches_student(p_student))) then
    raise exception 'Недостатньо прав';
  end if;
  if p_source not in ('lesson', 'homework', 'teacher') then
    raise exception 'Невідоме джерело';
  end if;
  return private.upsert_mistakes(p_student, p_source, p_source_id, p_items, (select auth.uid()));
end;
$$;

-- Publishing a lesson summary: attributes mistakes to students of that lesson.
create or replace function public.publish_lesson_summary(p_lesson uuid)
returns int
language plpgsql security definer
set search_path = ''
as $$
declare
  v_sum public.lesson_summaries;
  v_students uuid[];
  v_item jsonb;
  v_count int := 0;
  v_target uuid;
begin
  if not (public.is_staff() or public.teaches_lesson(p_lesson)) then
    raise exception 'Недостатньо прав';
  end if;
  select * into v_sum from public.lesson_summaries where lesson_id = p_lesson;
  if v_sum.lesson_id is null then
    raise exception 'Підсумок ще не створено';
  end if;
  v_students := private.lesson_student_ids(p_lesson);
  for v_item in select * from jsonb_array_elements(v_sum.mistakes)
  loop
    v_target := nullif(v_item ->> 'student_id', '')::uuid;
    -- individual lesson: the only student; group lesson: only mistakes attributed to a member
    if v_target is null and array_length(v_students, 1) = 1 then
      v_target := v_students[1];
    end if;
    continue when v_target is null or not (v_target = any (v_students));
    v_count := v_count + private.upsert_mistakes(v_target, 'lesson', p_lesson, jsonb_build_array(v_item), (select auth.uid()));
  end loop;
  update public.lesson_summaries set status = 'published', published_at = now() where lesson_id = p_lesson;
  return v_count;
end;
$$;

-- Students (and the tutor UI) read only what the lesson covered — never the mistakes list.
create or replace function public.lesson_topics(p_lesson uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object('topic', l.topic, 'vocabulary', s.vocabulary, 'grammar', s.grammar, 'published_at', s.published_at)
  from public.lessons l
  join public.lesson_summaries s on s.lesson_id = l.id and s.status = 'published'
  where l.id = p_lesson
    and (
      public.is_staff() or l.teacher_id = (select auth.uid()) or l.student_id = (select auth.uid())
      or (l.group_id is not null and public.is_group_member(l.group_id))
    );
$$;

-- Edge Functions (service role) feed mistakes from AI review / practice summaries.
create or replace function public.ingest_mistakes(p_student uuid, p_source text, p_source_id uuid, p_items jsonb)
returns int
language sql security definer
set search_path = ''
as $$
  select private.upsert_mistakes(p_student, p_source, p_source_id, p_items, null);
$$;
revoke execute on function public.ingest_mistakes(uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_mistakes(uuid, text, uuid, jsonb) to service_role;

revoke execute on function public.add_student_mistakes(uuid, text, uuid, jsonb), public.publish_lesson_summary(uuid), public.lesson_topics(uuid) from public, anon;
grant execute on function public.add_student_mistakes(uuid, text, uuid, jsonb), public.publish_lesson_summary(uuid), public.lesson_topics(uuid) to authenticated;

-- ───────────────────────── Feature flags & limits for the UI ─────────────────────────
create or replace function private.ai_spent_today(p_user uuid)
returns table (messages int, usd numeric)
language sql stable security definer
set search_path = ''
as $$
  select
    (select count(*) from public.practice_turns t join public.practice_sessions s on s.id = t.session_id
      where s.student_id = p_user and t.role = 'user'
        and t.created_at >= (date_trunc('day', now() at time zone 'Europe/Kyiv') at time zone 'Europe/Kyiv'))::int,
    coalesce((select sum(cost_usd) from public.ai_usage where user_id = p_user
      and created_at >= (date_trunc('day', now() at time zone 'Europe/Kyiv') at time zone 'Europe/Kyiv')), 0);
$$;

create or replace function private.tutor_allowed(p_student uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce((private.ai_setting('enabled'))::boolean, false)
    and coalesce((private.ai_setting('tutor_enabled'))::boolean, false)
    and coalesce((select value = 'true'::jsonb from public.app_settings where key = 'ai_configured'), false)
    and exists (select 1 from public.profiles where id = p_student and role = 'student' and is_active)
    and (
      jsonb_array_length(coalesce(private.ai_setting('pilot_group_ids'), '[]'::jsonb)) = 0
      or exists (
        select 1 from public.group_members gm
        where gm.student_id = p_student
          and gm.group_id::text in (select jsonb_array_elements_text(private.ai_setting('pilot_group_ids')))
      )
    );
$$;

create or replace function public.ai_features()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_on boolean := coalesce((private.ai_setting('enabled'))::boolean, false)
    and coalesce((select value = 'true'::jsonb from public.app_settings where key = 'ai_configured'), false);
  v_spent record;
begin
  if v_uid is null then
    return null;
  end if;
  select * into v_spent from private.ai_spent_today(v_uid);
  return jsonb_build_object(
    'enabled', v_on,
    'tutor', private.tutor_allowed(v_uid),
    'review', v_on and coalesce((private.ai_setting('review_enabled'))::boolean, false),
    'lesson', v_on and coalesce((private.ai_setting('lesson_enabled'))::boolean, false),
    'risk', v_on and coalesce((private.ai_setting('risk_enabled'))::boolean, false),
    'parent_reports', coalesce((private.ai_setting('parent_reports_enabled'))::boolean, false),
    'tutor_messages_left', greatest(0, coalesce((private.ai_setting('tutor_daily_messages'))::int, 30) - v_spent.messages)
  );
end;
$$;
revoke execute on function public.ai_features() from public, anon;
grant execute on function public.ai_features() to authenticated;

-- Admin usage report (FR-16 / 9.5): cost per feature, per student, share of revenue.
create or replace function public.ai_usage_report(p_days int default 30)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  with u as (
    select * from public.ai_usage where created_at > now() - make_interval(days => greatest(1, least(p_days, 366)))
  ), students as (
    select count(*)::numeric as n from public.profiles where role = 'student' and is_active
  )
  select case when not public.is_admin() then null else jsonb_build_object(
    'days', p_days,
    'total_usd', coalesce((select sum(cost_usd) from u), 0),
    'today_usd', coalesce((select sum(cost_usd) from public.ai_usage
      where created_at >= (date_trunc('day', now() at time zone 'Europe/Kyiv') at time zone 'Europe/Kyiv')), 0),
    'calls', (select count(*) from u),
    'active_students', (select n from students),
    'cache_read_tokens', coalesce((select sum(cached_tokens) from u), 0),
    'input_tokens', coalesce((select sum(input_tokens) from u), 0),
    'by_feature', coalesce((select jsonb_agg(f order by f.usd desc) from (
      select feature, count(*) as calls, sum(cost_usd) as usd from u group by feature) f), '[]'::jsonb),
    'by_day', coalesce((select jsonb_agg(d order by d.day) from (
      select (created_at at time zone 'Europe/Kyiv')::date as day, sum(cost_usd) as usd from u group by 1) d), '[]'::jsonb),
    'top_users', coalesce((select jsonb_agg(t order by t.usd desc) from (
      select u.user_id, p.full_name, p.role, count(*) as calls, sum(u.cost_usd) as usd
      from u left join public.profiles p on p.id = u.user_id
      group by u.user_id, p.full_name, p.role order by sum(u.cost_usd) desc limit 10) t), '[]'::jsonb),
    'practice_students_7d', (select count(distinct student_id) from public.practice_sessions where started_at > now() - interval '7 days'),
    'flagged_open', (select count(*) from public.practice_sessions where flagged and reviewed_at is null)
  ) end;
$$;
revoke execute on function public.ai_usage_report(int) from public, anon;
grant execute on function public.ai_usage_report(int) to authenticated;

-- ───────────────────────── Triggers: AI review draft on every new/updated answer ─────────────────────────
create or replace function private.on_submission_ai()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status <> 'submitted' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.body is not distinct from new.body and old.attachments is not distinct from new.attachments
     and old.status = 'submitted' then
    return new;
  end if;
  if not (
    coalesce((private.ai_setting('enabled'))::boolean, false)
    and coalesce((private.ai_setting('review_enabled'))::boolean, false)
    and coalesce((select value = 'true'::jsonb from public.app_settings where key = 'ai_configured'), false)
  ) then
    return new;
  end if;
  insert into public.submission_ai_reviews (submission_id, status, reviewed_version)
  values (new.id, 'pending', new.submitted_at)
  on conflict (submission_id) do update set status = 'pending', error = null, reviewed_version = excluded.reviewed_version;
  perform private.call_function('ai-review', jsonb_build_object('submission_id', new.id));
  return new;
end;
$$;
create trigger submissions_ai after insert or update on public.submissions
  for each row execute function private.on_submission_ai();

-- A teacher's decision closes the draft: approved when the final grade was saved, discarded otherwise.
create or replace function private.on_submission_reviewed()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status in ('reviewed', 'needs_revision') and old.status = 'submitted' then
    update public.submission_ai_reviews set status = 'discarded'
    where submission_id = new.id and status in ('pending', 'ready', 'failed');
  end if;
  return new;
end;
$$;
create trigger submissions_ai_closed after update on public.submissions
  for each row execute function private.on_submission_reviewed();

-- ───────────────────────── Practice housekeeping (NFR-04) ─────────────────────────
create or replace function private.run_ai_housekeeping()
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
begin
  -- practice text is kept for N days (default 90); summaries stay
  delete from public.practice_turns
  where created_at < now() - make_interval(days => coalesce((private.ai_setting('practice_retention_days'))::int, 90));
  -- abandoned sessions get summarised by the tutor function
  for r in
    select id from public.practice_sessions
    where ended_at is null and last_activity_at < now() - interval '30 minutes'
    order by last_activity_at limit 20
  loop
    perform private.call_function('ai-tutor', jsonb_build_object('action', 'finalize', 'session_id', r.id));
  end loop;
end;
$$;

select cron.schedule('seal-ai-housekeeping', '*/15 * * * *', $$select private.run_ai_housekeeping()$$);

-- Weekly AI cost report to admins (9.5), Monday 09:00 Kyiv ≈ 06:00/07:00 UTC.
create or replace function private.weekly_ai_report()
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_admins uuid[];
  v_usd numeric;
  v_students numeric;
  v_rate numeric := coalesce((private.ai_setting('usd_rate'))::numeric, 42);
  v_check numeric := coalesce((private.ai_setting('avg_check_uah'))::numeric, 2520);
  v_practising int;
  v_share numeric;
begin
  select coalesce(sum(cost_usd), 0) into v_usd from public.ai_usage where created_at > now() - interval '7 days';
  if v_usd = 0 then
    return;
  end if;
  select count(*) into v_students from public.profiles where role = 'student' and is_active;
  select count(distinct student_id) into v_practising from public.practice_sessions where started_at > now() - interval '7 days';
  select coalesce(array_agg(id), '{}') into v_admins from public.profiles where role = 'admin' and is_active;
  -- weekly cost per student vs a quarter of the monthly average check
  v_share := case when v_students > 0 then round(100 * (v_usd * v_rate / v_students) / (v_check / 4.33), 1) else null end;
  perform private.notify_users(
    v_admins, 'ai_report', 'Звіт ШІ за тиждень',
    '$' || round(v_usd, 2) || ' (' || round(v_usd * v_rate) || ' ₴)'
      || case when v_students > 0 then ' · ' || round(v_usd * v_rate / v_students, 1) || ' ₴ на учня' else '' end
      || coalesce(' · ' || v_share || '% чеку', '')
      || ' · практикувались ' || v_practising || ' з ' || v_students::int || ' учнів',
    '/app/ai/', '{}'::jsonb
  );
end;
$$;

select cron.schedule('seal-ai-weekly', '0 6 * * 1', $$select private.weekly_ai_report()$$);
