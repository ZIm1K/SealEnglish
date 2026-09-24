-- Seal English — phase 0: group trial lessons (FR-26), teacher payouts (FR-25),
-- delivery retries & error log (ADR-03, NFR-10), privacy and reminder fixes.

-- ───────────────────────── Privacy: students no longer read classmates' profiles ─────────────────────────
-- Students never need other students' rows (phone, email, Telegram of minors); staff profiles stay readable.
drop policy "profiles: read" on public.profiles;
create policy "profiles: read" on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or role in ('teacher', 'manager', 'admin')
  or public.is_staff()
  or (public.is_teacher() and public.teaches_student(id))
);

-- The first deploy seeded the old Wasmer address; the production site lives on www.sealenglish.school.
update public.app_settings
set value = to_jsonb('https://www.sealenglish.school'::text), updated_at = now()
where key = 'site_url' and value = to_jsonb('https://sealenglish.wasmer.app'::text);

-- A moved deadline must be reminded again.
create or replace function private.reset_assignment_reminder()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.due_at is distinct from old.due_at then
    new.reminded_at := null;
  end if;
  return new;
end;
$$;
create trigger assignments_due_changed before update on public.assignments
  for each row execute function private.reset_assignment_reminder();

-- ───────────────────────── DB → Edge Function helper ─────────────────────────
create or replace function private.call_function(p_name text, p_body jsonb)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select value #>> '{}' into v_url from public.app_settings where key = 'functions_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'internal_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := v_url || '/' || p_name,
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret),
    timeout_milliseconds := 8000
  );
end;
$$;

-- ───────────────────────── Group trial lessons (FR-26) ─────────────────────────
-- A trial lesson may host up to 4 leads; each lead keeps its own status.
create table public.lesson_leads (
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  attended boolean,
  added_at timestamptz not null default now(),
  primary key (lesson_id, lead_id)
);
create index lesson_leads_lead_idx on public.lesson_leads (lead_id);
alter table public.lesson_leads enable row level security;

insert into public.lesson_leads (lesson_id, lead_id)
select id, lead_id from public.lessons where lead_id is not null
on conflict do nothing;

drop policy "leads: trial teacher read" on public.leads;
alter table public.lessons drop constraint lessons_target_chk;
alter table public.lessons drop column lead_id;
alter table public.lessons add constraint lessons_target_chk check (
  (kind = 'regular' and num_nonnulls(group_id, student_id) = 1)
  or (kind = 'trial' and num_nonnulls(group_id, student_id) = 0)
);

create or replace function public.teaches_lead(p_lead uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.lesson_leads ll
    join public.lessons l on l.id = ll.lesson_id
    where ll.lead_id = p_lead and l.teacher_id = (select auth.uid())
  );
$$;
revoke execute on function public.teaches_lead(uuid) from public, anon;
grant execute on function public.teaches_lead(uuid) to authenticated, service_role;

create policy "leads: trial teacher read" on public.leads for select to authenticated
using (public.teaches_lead(id));

-- Leads are attached/detached by the `schedule` function; teachers only mark attendance.
create policy "lesson_leads: read" on public.lesson_leads for select to authenticated
using (public.is_staff() or public.teaches_lesson(lesson_id));
create policy "lesson_leads: mark attendance" on public.lesson_leads for update to authenticated
using (public.is_staff() or public.teaches_lesson(lesson_id))
with check (public.is_staff() or public.teaches_lesson(lesson_id));
revoke insert, update, delete on public.lesson_leads from anon, authenticated;
grant update (attended) on public.lesson_leads to authenticated;

create or replace function private.guard_lesson_leads()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if (select kind from public.lessons where id = new.lesson_id) is distinct from 'trial' then
    raise exception 'Лідів можна додавати лише до пробного уроку';
  end if;
  if (select count(*) from public.lesson_leads where lesson_id = new.lesson_id) >= 4 then
    raise exception 'У пробній міні-групі максимум 4 учасники';
  end if;
  return new;
end;
$$;
create trigger lesson_leads_guard before insert on public.lesson_leads
  for each row execute function private.guard_lesson_leads();

-- Attendance of a trial moves that lead (only that lead) forward in the funnel.
create or replace function private.on_trial_attendance()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.attended is not distinct from old.attended then
    return new;
  end if;
  if new.attended then
    update public.leads set status = 'trial_done'
    where id = new.lead_id and status in ('new', 'contacted', 'trial_scheduled');
  end if;
  insert into public.lead_events (lead_id, kind, actor_id, body)
  values (new.lead_id, 'trial', (select auth.uid()),
    case when new.attended then 'Був(ла) на пробному уроці' else 'Не прийшов(ла) на пробний урок' end);
  return new;
end;
$$;
create trigger lesson_leads_attendance after update of attended on public.lesson_leads
  for each row execute function private.on_trial_attendance();

-- ───────────────────────── Notifications: delivery retries & error log ─────────────────────────
alter table public.notifications
  add column tg_attempts int not null default 0,
  add column tg_error text;

create table public.error_log (
  id bigint generated always as identity primary key,
  source text not null,
  message text not null,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index error_log_created_idx on public.error_log (created_at desc);
alter table public.error_log enable row level security;
create policy "error_log: admin read" on public.error_log for select to authenticated
using (public.is_admin());
revoke insert, update, delete on public.error_log from anon, authenticated;

-- Health summary for the admin cabinet (delivery failures are other users' rows → definer).
create or replace function public.admin_health()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case when not public.is_admin() then null else jsonb_build_object(
    'tg_failed_7d', (select count(*) from public.notifications where tg_status = 'failed' and created_at > now() - interval '7 days'),
    'tg_sent_7d', (select count(*) from public.notifications where tg_status = 'sent' and created_at > now() - interval '7 days'),
    'errors_24h', (select count(*) from public.error_log where created_at > now() - interval '24 hours'),
    'errors_7d', (select count(*) from public.error_log where created_at > now() - interval '7 days'),
    'last_tg_errors', coalesce((
      select jsonb_agg(x order by x.created_at desc) from (
        select n.created_at, n.kind, n.tg_error, p.full_name
        from public.notifications n join public.profiles p on p.id = n.user_id
        where n.tg_status = 'failed' order by n.created_at desc limit 5
      ) x), '[]'::jsonb)
  ) end;
$$;
revoke execute on function public.admin_health() from public, anon;
grant execute on function public.admin_health() to authenticated;

-- ───────────────────────── Lesson changes → participants (incl. trial leads & new teacher) ─────────────────────────
create or replace function private.on_lesson_update()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_users uuid[];
  v_name text := coalesce(new.title, case when new.kind = 'trial' then 'Пробний урок' else 'Урок' end);
begin
  v_users := private.lesson_student_ids(new.id) || new.teacher_id;
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    perform private.notify_users(v_users, 'lesson_cancelled', 'Урок скасовано',
      v_name || ' · ' || private.kyiv(new.starts_at), '/app/schedule/',
      jsonb_build_object('lesson_id', new.id));
    if new.kind = 'trial' then
      perform private.call_function('notify', jsonb_build_object('lead_lesson', jsonb_build_object('lesson_id', new.id, 'event', 'cancelled')));
    end if;
  elsif new.status = 'scheduled' and new.starts_at is distinct from old.starts_at then
    perform private.notify_users(v_users, 'lesson_moved', 'Урок перенесено',
      v_name || ': ' || private.kyiv(old.starts_at) || ' → ' || private.kyiv(new.starts_at), '/app/schedule/',
      jsonb_build_object('lesson_id', new.id, 'meet_url', new.meet_url));
    new.reminded_at := null;
    if new.kind = 'trial' then
      perform private.call_function('notify', jsonb_build_object('lead_lesson', jsonb_build_object('lesson_id', new.id, 'event', 'moved')));
    end if;
  end if;
  if new.teacher_id is distinct from old.teacher_id and new.status = 'scheduled' then
    perform private.notify_users(array[new.teacher_id], 'lesson_new', 'Вам призначено урок',
      v_name || ' · ' || private.kyiv(new.starts_at), '/app/schedule/',
      jsonb_build_object('lesson_id', new.id, 'meet_url', new.meet_url));
  end if;
  return new;
end;
$$;

-- ───────────────────────── Teacher payouts (FR-25) ─────────────────────────
-- Group: base + per present student; individual & trial: fixed rates. Rates are editable by the admin.
insert into public.app_settings (key, value, is_public) values
  ('payout_rates', '{"group_base": 180, "group_per_student": 30, "individual": 250, "trial_individual": 150, "trial_group_per_lead": 90}'::jsonb, false)
on conflict (key) do nothing;

create or replace function private.payout_lines(p_from timestamptz, p_to timestamptz)
returns table (
  lesson_id uuid, teacher_id uuid, starts_at timestamptz, duration_min int, title text, target text,
  line_kind text, participants int, present int, marked boolean, amount numeric
)
language sql stable security definer
set search_path = ''
as $$
  with r as (
    select coalesce((select value from public.app_settings where key = 'payout_rates'), '{}'::jsonb) as v
  ), base as (
    select l.*,
      g.name as group_name, s.full_name as student_name,
      (select count(*) from public.group_members gm where gm.group_id = l.group_id)::int as group_size,
      (select count(*) from public.lesson_attendance a where a.lesson_id = l.id and a.status in ('present', 'late'))::int as att_present,
      (select count(*) from public.lesson_attendance a where a.lesson_id = l.id)::int as att_marked,
      (select count(*) from public.lesson_leads ll where ll.lesson_id = l.id)::int as leads_total,
      (select count(*) from public.lesson_leads ll where ll.lesson_id = l.id and ll.attended)::int as leads_came,
      (select count(*) from public.lesson_leads ll where ll.lesson_id = l.id and ll.attended is not null)::int as leads_marked
    from public.lessons l
    left join public.groups g on g.id = l.group_id
    left join public.profiles s on s.id = l.student_id
    where l.starts_at >= p_from and l.starts_at < p_to
      and (l.status = 'completed' or (l.status = 'scheduled' and l.ends_at < now()))
  )
  select
    b.id, b.teacher_id, b.starts_at,
    (extract(epoch from (b.ends_at - b.starts_at)) / 60)::int,
    b.title,
    coalesce(b.group_name, b.student_name, 'Пробний урок'),
    case
      when b.group_id is not null then 'group'
      when b.student_id is not null then 'individual'
      when b.leads_total > 1 then 'trial_group'
      else 'trial_individual'
    end,
    case when b.group_id is not null then b.group_size when b.student_id is not null then 1 else b.leads_total end,
    case when b.kind = 'trial' then b.leads_came else b.att_present end,
    case when b.kind = 'trial' then b.leads_marked > 0 else b.att_marked > 0 end,
    case
      when b.group_id is not null then
        coalesce((r.v ->> 'group_base')::numeric, 180) + coalesce((r.v ->> 'group_per_student')::numeric, 30) * b.att_present
      when b.student_id is not null then coalesce((r.v ->> 'individual')::numeric, 250)
      when b.leads_total > 1 then coalesce((r.v ->> 'trial_group_per_lead')::numeric, 90) * b.leads_came
      else coalesce((r.v ->> 'trial_individual')::numeric, 150)
    end
  from base b cross join r;
$$;

-- Monthly totals: the admin sees every teacher, anyone else only their own lessons.
create or replace function public.teacher_payouts(p_month date)
returns table (
  teacher_id uuid, teacher_name text, lessons_group int, lessons_individual int, lessons_trial int,
  students_present int, unmarked int, amount numeric
)
language sql stable security definer
set search_path = ''
as $$
  with bounds as (
    select (date_trunc('month', p_month)::timestamp at time zone 'Europe/Kyiv') as f,
           ((date_trunc('month', p_month) + interval '1 month')::timestamp at time zone 'Europe/Kyiv') as t
  )
  select x.teacher_id, p.full_name,
    count(*) filter (where x.line_kind = 'group')::int,
    count(*) filter (where x.line_kind = 'individual')::int,
    count(*) filter (where x.line_kind like 'trial%')::int,
    coalesce(sum(x.present), 0)::int,
    count(*) filter (where not x.marked)::int,
    coalesce(sum(x.amount), 0)
  from bounds, private.payout_lines(bounds.f, bounds.t) x
  join public.profiles p on p.id = x.teacher_id
  where (select auth.uid()) is not null
    and (public.is_admin() or x.teacher_id = (select auth.uid()))
  group by x.teacher_id, p.full_name
  order by p.full_name;
$$;

create or replace function public.teacher_payout_lines(p_month date, p_teacher uuid)
returns table (
  lesson_id uuid, starts_at timestamptz, duration_min int, title text, target text,
  line_kind text, participants int, present int, marked boolean, amount numeric
)
language sql stable security definer
set search_path = ''
as $$
  with bounds as (
    select (date_trunc('month', p_month)::timestamp at time zone 'Europe/Kyiv') as f,
           ((date_trunc('month', p_month) + interval '1 month')::timestamp at time zone 'Europe/Kyiv') as t
  )
  select x.lesson_id, x.starts_at, x.duration_min, x.title, x.target, x.line_kind, x.participants, x.present, x.marked, x.amount
  from bounds, private.payout_lines(bounds.f, bounds.t) x
  where x.teacher_id = p_teacher
    and (select auth.uid()) is not null
    and (public.is_admin() or p_teacher = (select auth.uid()))
  order by x.starts_at;
$$;

create or replace function public.payout_rates()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case when (select auth.uid()) is null or public.auth_role() = 'student' then null
    else (select value from public.app_settings where key = 'payout_rates') end;
$$;

revoke execute on function public.teacher_payouts(date), public.teacher_payout_lines(date, uuid), public.payout_rates() from public, anon;
grant execute on function public.teacher_payouts(date), public.teacher_payout_lines(date, uuid), public.payout_rates() to authenticated;

-- ───────────────────────── Scheduled jobs (reminders, retries, housekeeping) ─────────────────────────
create or replace function private.run_reminders()
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
  v_users uuid[];
begin
  -- lessons starting within the next hour
  for r in
    update public.lessons set reminded_at = now()
    where status = 'scheduled' and reminded_at is null
      and starts_at > now() and starts_at <= now() + interval '62 minutes'
    returning *
  loop
    v_users := private.lesson_student_ids(r.id) || r.teacher_id;
    perform private.notify_users(
      v_users, 'lesson_reminder',
      'Скоро урок · ' || to_char(r.starts_at at time zone 'Europe/Kyiv', 'HH24:MI'),
      coalesce(r.title, case when r.kind = 'trial' then 'Пробний урок' else 'Урок англійської' end)
        || ' через ' || greatest(1, round(extract(epoch from (r.starts_at - now())) / 60))::int || ' хв',
      '/app/schedule/',
      jsonb_build_object('lesson_id', r.id, 'meet_url', r.meet_url)
    );
    -- leads have no account: the bot reminds them directly
    if r.kind = 'trial' then
      perform private.call_function('notify', jsonb_build_object('lead_lesson', jsonb_build_object('lesson_id', r.id, 'event', 'reminder')));
    end if;
  end loop;

  -- homework due within 24h, only for students who haven't submitted yet
  for r in
    update public.assignments set reminded_at = now()
    where reminded_at is null and due_at > now() and due_at <= now() + interval '24 hours'
    returning *
  loop
    select coalesce(array_agg(s), '{}') into v_users
    from unnest(private.assignment_student_ids(r.id)) as s
    where not exists (select 1 from public.submissions x where x.assignment_id = r.id and x.student_id = s);
    perform private.notify_users(
      v_users, 'homework_due', 'Нагадування про домашнє завдання',
      r.title || ' · дедлайн ' || private.kyiv(r.due_at),
      '/app/homework/view/?id=' || r.id,
      jsonb_build_object('assignment_id', r.id)
    );
  end loop;

  -- Telegram delivery retries: failed (up to 3 attempts) or lost pg_net calls. The windows are short so that
  -- someone who links Telegram later doesn't get a burst of stale messages (e.g. reminders for past lessons).
  for r in
    select n.id from public.notifications n
    join public.profiles p on p.id = n.user_id
    where n.send_tg and p.telegram_chat_id is not null and p.notify_telegram and p.is_active
      and n.tg_attempts < 3
      and (
        (n.tg_status = 'failed' and n.created_at between now() - interval '24 hours' and now() - interval '4 minutes')
        or (n.tg_status is null and n.created_at between now() - interval '2 hours' and now() - interval '10 minutes')
      )
      and (n.kind <> 'lesson_reminder' or n.created_at > now() - interval '50 minutes')
    order by n.created_at
    limit 50
  loop
    perform private.call_function('notify', jsonb_build_object('id', r.id));
  end loop;

  -- housekeeping
  update public.lessons set status = 'completed'
  where status = 'scheduled' and ends_at < now() - interval '3 hours';
  delete from public.api_hits where created_at < now() - interval '2 days';
  delete from public.tg_link_codes where expires_at < now();
  delete from public.oauth_states where created_at < now() - interval '1 hour';
  delete from public.error_log where created_at < now() - interval '30 days';
end;
$$;
