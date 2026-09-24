-- Seal English — phase 2/3 foundations, all disabled by default in ai_settings:
--   FR-19 churn-risk scoring (SQL) + AI explanation, FR-20 weekly parent reports with consent,
--   FR-22 level test for leads. Each feature is switched on only after the previous phase's exit criteria.

-- ───────────────────────── Churn risk (FR-19) ─────────────────────────
create table public.risk_scores (
  student_id uuid not null references public.profiles (id) on delete cascade,
  computed_on date not null,
  score int not null check (score between 0 and 100),
  signals jsonb not null default '{}'::jsonb,
  explanation text,
  computed_at timestamptz not null default now(),
  primary key (student_id, computed_on)
);
create index risk_scores_day_idx on public.risk_scores (computed_on desc, score desc);
alter table public.risk_scores enable row level security;
create policy "risk_scores: staff read" on public.risk_scores for select to authenticated
using (public.is_staff() or (public.is_teacher() and public.teaches_student(student_id)));
revoke insert, update, delete on public.risk_scores from anon, authenticated;

create or replace function private.compute_risk_scores()
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Europe/Kyiv')::date;
  v_staff uuid[];
  r record;
begin
  if not coalesce((private.ai_setting('risk_enabled'))::boolean, false) then
    return;
  end if;
  insert into public.risk_scores (student_id, computed_on, score, signals)
  select s.id, v_today,
    least(100, round(
      35 * coalesce(x.absent::numeric / nullif(x.marked, 0), 0)
      + 30 * coalesce(x.hw_missed::numeric / nullif(x.hw_due, 0), 0)
      + case when x.practice_prev > 0 and x.practice_recent = 0 then 15 else 0 end
      + case when x.upcoming = 0 then 20 else 0 end
      + case when x.days_since_attended > 14 then 15 else 0 end
    ))::int,
    jsonb_build_object(
      'lessons_marked', x.marked, 'absent', x.absent, 'hw_due', x.hw_due, 'hw_missed', x.hw_missed,
      'practice_recent', x.practice_recent, 'practice_prev', x.practice_prev,
      'upcoming', x.upcoming, 'days_since_attended', x.days_since_attended
    )
  from public.profiles s
  cross join lateral (
    select
      (select count(*) from public.lesson_attendance a join public.lessons l on l.id = a.lesson_id
        where a.student_id = s.id and l.starts_at > now() - interval '28 days')::int as marked,
      (select count(*) from public.lesson_attendance a join public.lessons l on l.id = a.lesson_id
        where a.student_id = s.id and a.status = 'absent' and l.starts_at > now() - interval '28 days')::int as absent,
      (select count(*) from public.assignments asg
        where asg.due_at between now() - interval '28 days' and now()
          and (asg.student_id = s.id or asg.group_id in (select group_id from public.group_members where student_id = s.id)))::int as hw_due,
      (select count(*) from public.assignments asg
        where asg.due_at between now() - interval '28 days' and now()
          and (asg.student_id = s.id or asg.group_id in (select group_id from public.group_members where student_id = s.id))
          and not exists (select 1 from public.submissions sub where sub.assignment_id = asg.id and sub.student_id = s.id))::int as hw_missed,
      (select count(*) from public.practice_sessions p where p.student_id = s.id and p.started_at > now() - interval '14 days')::int as practice_recent,
      (select count(*) from public.practice_sessions p where p.student_id = s.id
        and p.started_at between now() - interval '28 days' and now() - interval '14 days')::int as practice_prev,
      (select count(*) from public.lessons l where l.status = 'scheduled' and l.starts_at between now() and now() + interval '14 days'
        and (l.student_id = s.id or l.group_id in (select group_id from public.group_members where student_id = s.id)))::int as upcoming,
      coalesce(extract(day from now() - (
        select max(l.starts_at) from public.lesson_attendance a join public.lessons l on l.id = a.lesson_id
        where a.student_id = s.id and a.status in ('present', 'late')
      )), 0)::int as days_since_attended
  ) x
  where s.role = 'student' and s.is_active
  on conflict (student_id, computed_on) do update set score = excluded.score, signals = excluded.signals, computed_at = now();

  delete from public.risk_scores where computed_on < v_today - 120;

  -- newly high-risk students → managers get a Telegram card; the explanation is written by `ai-risk`
  select coalesce(array_agg(id), '{}') into v_staff from public.profiles where role in ('manager', 'admin') and is_active;
  for r in
    select rs.student_id, rs.score, p.full_name
    from public.risk_scores rs
    join public.profiles p on p.id = rs.student_id
    where rs.computed_on = v_today and rs.score >= 60
      and not exists (
        select 1 from public.risk_scores prev
        where prev.student_id = rs.student_id and prev.computed_on between v_today - 7 and v_today - 1 and prev.score >= 60
      )
  loop
    perform private.notify_users(v_staff, 'risk_high', 'Ризик відтоку: ' || r.full_name,
      'Оцінка ризику ' || r.score || '/100 — варто зв''язатися з учнем або батьками', '/app/people/?risk=1',
      jsonb_build_object('student_id', r.student_id));
    perform private.call_function('ai-risk', jsonb_build_object('student_id', r.student_id, 'computed_on', v_today));
  end loop;
end;
$$;

select cron.schedule('seal-risk-nightly', '15 1 * * *', $$select private.compute_risk_scores()$$);

create or replace function public.risk_overview()
returns table (student_id uuid, full_name text, score int, signals jsonb, explanation text, computed_on date, prev_score int)
language sql stable security definer
set search_path = ''
as $$
  select distinct on (rs.student_id) rs.student_id, p.full_name, rs.score, rs.signals, rs.explanation, rs.computed_on,
    (select prev.score from public.risk_scores prev where prev.student_id = rs.student_id and prev.computed_on < rs.computed_on
      order by prev.computed_on desc limit 1)
  from public.risk_scores rs
  join public.profiles p on p.id = rs.student_id and p.is_active and p.role = 'student'
  where public.is_staff() or (public.is_teacher() and public.teaches_student(rs.student_id))
  order by rs.student_id, rs.computed_on desc;
$$;
revoke execute on function public.risk_overview() from public, anon;
grant execute on function public.risk_overview() to authenticated;

-- ───────────────────────── Parent reports (FR-20) ─────────────────────────
create table public.parent_contacts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  telegram_chat_id bigint not null,
  name text,
  consent_at timestamptz not null,
  consent_source text not null default 'telegram_bot',
  revoked_at timestamptz,
  last_report_at timestamptz,
  created_at timestamptz not null default now(),
  constraint parent_contacts_uniq unique (student_id, telegram_chat_id)
);
alter table public.parent_contacts enable row level security;
create policy "parent_contacts: read" on public.parent_contacts for select to authenticated
using (public.is_staff() or (public.is_teacher() and public.teaches_student(student_id)));
create policy "parent_contacts: staff revoke" on public.parent_contacts for update to authenticated
using (public.is_staff()) with check (public.is_staff());
revoke insert, delete, update on public.parent_contacts from anon, authenticated;
grant update (revoked_at) on public.parent_contacts to authenticated;

-- Internal: one-time invite codes for the parent bot deep link.
create table public.parent_link_codes (
  code text primary key,
  student_id uuid not null references public.profiles (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  expires_at timestamptz not null
);
alter table public.parent_link_codes enable row level security;
revoke all on public.parent_link_codes from anon, authenticated;

create or replace function public.create_parent_link(p_student uuid)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_code text := encode(extensions.gen_random_bytes(12), 'hex');
begin
  if not (public.is_staff() or (public.is_teacher() and public.teaches_student(p_student))) then
    raise exception 'Недостатньо прав';
  end if;
  if not exists (select 1 from public.profiles where id = p_student and role = 'student') then
    raise exception 'Учня не знайдено';
  end if;
  delete from public.parent_link_codes where expires_at < now();
  insert into public.parent_link_codes (code, student_id, created_by, expires_at)
  values (v_code, p_student, (select auth.uid()), now() + interval '7 days');
  return v_code;
end;
$$;
revoke execute on function public.create_parent_link(uuid) from public, anon;
grant execute on function public.create_parent_link(uuid) to authenticated;

create or replace function private.weekly_parent_reports()
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
begin
  if not coalesce((private.ai_setting('parent_reports_enabled'))::boolean, false) then
    return;
  end if;
  for r in
    select c.id from public.parent_contacts c
    join public.profiles p on p.id = c.student_id and p.is_active
    where c.revoked_at is null and (c.last_report_at is null or c.last_report_at < now() - interval '6 days')
    limit 300
  loop
    perform private.call_function('notify', jsonb_build_object('parent_report', jsonb_build_object('contact_id', r.id)));
  end loop;
end;
$$;

-- Sunday 16:00 UTC (18:00–19:00 Kyiv)
select cron.schedule('seal-parent-reports', '0 16 * * 0', $$select private.weekly_parent_reports()$$);

-- ───────────────────────── Level test for leads (FR-22) ─────────────────────────
alter table public.leads
  add column level_test_token text unique,
  add column level_estimate text;

create table public.level_tests (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  answers jsonb not null default '{}'::jsonb,
  mc_score int,
  mc_total int,
  writing text,
  level text,
  feedback text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index level_tests_lead_idx on public.level_tests (lead_id);
alter table public.level_tests enable row level security;
create policy "level_tests: read" on public.level_tests for select to authenticated
using (public.is_staff() or public.teaches_lead(lead_id));
revoke insert, update, delete on public.level_tests from anon, authenticated;

-- Funnel metrics for the staff dashboard, now including the level-test share.
create or replace function public.staff_overview()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case when not public.is_staff() then null else jsonb_build_object(
    'leads_new', (select count(*) from public.leads where status = 'new'),
    'leads_active', (select count(*) from public.leads where status in ('new', 'contacted', 'trial_scheduled', 'trial_done')),
    'leads_month', (select count(*) from public.leads where created_at >= date_trunc('month', now())),
    'won_month', (select count(distinct e.lead_id) from public.lead_events e
      where e.to_status = 'won' and e.created_at >= date_trunc('month', now())),
    'students', (select count(*) from public.profiles where role = 'student' and is_active),
    'teachers', (select count(*) from public.profiles where role = 'teacher' and is_active),
    'groups', (select count(*) from public.groups where not is_archived),
    'lessons_week', (select count(*) from public.lessons where status <> 'cancelled'
      and starts_at >= (date_trunc('week', now() at time zone 'Europe/Kyiv') at time zone 'Europe/Kyiv')
      and starts_at < (date_trunc('week', now() at time zone 'Europe/Kyiv') at time zone 'Europe/Kyiv') + interval '7 days'),
    'level_tests_month', (select count(distinct lead_id) from public.level_tests
      where completed_at >= date_trunc('month', now()))
  ) end;
$$;
