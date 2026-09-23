-- Seal English — notifications, Telegram dispatch, reminders, RPCs, realtime

-- ───────────────────────── Secrets (Vault) ─────────────────────────
-- internal_secret authenticates DB → Edge Function calls. Integration secrets
-- (telegram_bot_token, google_client_secret, …) are written by the `admin` function.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'internal_secret', 'DB → Edge Functions shared secret')
where not exists (select 1 from vault.secrets where name = 'internal_secret');

create or replace function public.get_app_secret(p_name text)
returns text
language sql stable security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1;
$$;

create or replace function public.set_app_secret(p_name text, p_value text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = p_name;
  if p_value is null or p_value = '' then
    if v_id is not null then
      delete from vault.secrets where id = v_id;
    end if;
  elsif v_id is null then
    perform vault.create_secret(p_value, p_name);
  else
    perform vault.update_secret(v_id, p_value);
  end if;
end;
$$;

revoke execute on function public.get_app_secret(text), public.set_app_secret(text, text) from public, anon, authenticated;
grant execute on function public.get_app_secret(text), public.set_app_secret(text, text) to service_role;

insert into public.app_settings (key, value, is_public) values
  ('functions_url', to_jsonb('https://nivxzpsstjphxkodhjzu.supabase.co/functions/v1'::text), false),
  ('site_url', to_jsonb('https://sealenglish.wasmer.app'::text), true),
  ('telegram_bot_username', 'null'::jsonb, true),
  ('telegram_configured', 'false'::jsonb, false),
  ('google_account', 'null'::jsonb, false)
on conflict (key) do nothing;

-- ───────────────────────── Notification helpers ─────────────────────────
create or replace function private.notify_users(
  p_users uuid[], p_kind text, p_title text, p_body text, p_link text,
  p_data jsonb default '{}'::jsonb, p_send_tg boolean default true
)
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, kind, title, body, link, data, send_tg)
  select distinct u, p_kind, p_title, p_body, p_link, coalesce(p_data, '{}'::jsonb), p_send_tg
  from unnest(p_users) as u
  where u is not null;
$$;

create or replace function private.lesson_student_ids(p_lesson uuid)
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(x.id), '{}')
  from (
    select l.student_id as id from public.lessons l where l.id = p_lesson and l.student_id is not null
    union
    select gm.student_id from public.lessons l
    join public.group_members gm on gm.group_id = l.group_id
    where l.id = p_lesson
  ) x;
$$;

create or replace function private.assignment_student_ids(p_assignment uuid)
returns uuid[]
language sql stable security definer
set search_path = ''
as $$
  select coalesce(array_agg(x.id), '{}')
  from (
    select a.student_id as id from public.assignments a where a.id = p_assignment and a.student_id is not null
    union
    select gm.student_id from public.assignments a
    join public.group_members gm on gm.group_id = a.group_id
    where a.id = p_assignment
  ) x;
$$;

create or replace function private.kyiv(p_ts timestamptz)
returns text
language sql stable
set search_path = ''
as $$
  select to_char(p_ts at time zone 'Europe/Kyiv', 'DD.MM о HH24:MI');
$$;

-- Outbox → Telegram: each notification row (send_tg) pings the `notify` Edge Function.
create or replace function private.dispatch_notification()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = new.user_id and p.telegram_chat_id is not null and p.notify_telegram and p.is_active
  ) then
    return new;
  end if;
  select value #>> '{}' into v_url from public.app_settings where key = 'functions_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'internal_secret';
  if v_url is null or v_secret is null then
    return new;
  end if;
  perform net.http_post(
    url := v_url || '/notify',
    body := jsonb_build_object('id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret),
    timeout_milliseconds := 8000
  );
  return new;
end;
$$;
create trigger notifications_dispatch after insert on public.notifications
  for each row when (new.send_tg) execute function private.dispatch_notification();

-- ───────────────────────── Domain triggers ─────────────────────────
-- New lead → timeline entry + notify all active staff (Telegram card with status buttons).
create or replace function private.on_lead_created()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_staff uuid[];
begin
  insert into public.lead_events (lead_id, kind, to_status, actor_id, actor_name, body)
  values (
    new.id, 'created', new.status, (select auth.uid()),
    case new.source when 'website' then 'Сайт' when 'telegram' then 'Telegram-бот' else null end,
    null
  );
  select coalesce(array_agg(id), '{}') into v_staff
  from public.profiles where role in ('manager', 'admin') and is_active;
  perform private.notify_users(
    v_staff, 'lead_new',
    'Нова заявка #' || new.no,
    new.name || coalesce(' · ' || new.phone, ''),
    '/app/leads/?id=' || new.id,
    jsonb_build_object('lead_id', new.id)
  );
  return new;
end;
$$;
create trigger leads_created after insert on public.leads
  for each row execute function private.on_lead_created();

-- Status changes made from the cabinet are logged automatically (bot/functions log explicitly).
create or replace function private.on_lead_status()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status and (select auth.uid()) is not null then
    insert into public.lead_events (lead_id, kind, from_status, to_status, actor_id)
    values (new.id, 'status', old.status, new.status, (select auth.uid()));
  end if;
  if new.manager_id is distinct from old.manager_id and new.manager_id is not null and (select auth.uid()) is not null then
    insert into public.lead_events (lead_id, kind, actor_id, body)
    values (new.id, 'assigned', (select auth.uid()),
      (select full_name from public.profiles where id = new.manager_id));
  end if;
  return new;
end;
$$;
create trigger leads_status after update on public.leads
  for each row execute function private.on_lead_status();

-- Homework created → notify students.
create or replace function private.on_assignment_created()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.notify_users(
    private.assignment_student_ids(new.id), 'homework_new',
    'Нове домашнє завдання',
    new.title || coalesce(' · до ' || private.kyiv(new.due_at), ''),
    '/app/homework/view/?id=' || new.id,
    jsonb_build_object('assignment_id', new.id)
  );
  return new;
end;
$$;
create trigger assignments_created after insert on public.assignments
  for each row execute function private.on_assignment_created();

-- Submission flow → notify teacher / student.
create or replace function private.on_submission_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_a public.assignments;
  v_student text;
begin
  select * into v_a from public.assignments where id = new.assignment_id;
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status is distinct from 'submitted' or old.body is distinct from new.body or old.attachments is distinct from new.attachments) then
    select full_name into v_student from public.profiles where id = new.student_id;
    perform private.notify_users(
      array[v_a.teacher_id], 'homework_submitted',
      case when tg_op = 'INSERT' then 'Нова робота на перевірку' else 'Роботу оновлено' end,
      coalesce(v_student, 'Учень') || ' · ' || v_a.title,
      '/app/homework/view/?id=' || v_a.id,
      jsonb_build_object('assignment_id', v_a.id, 'submission_id', new.id)
    );
  elsif tg_op = 'UPDATE' and new.status in ('reviewed', 'needs_revision')
        and (old.status is distinct from new.status or old.score is distinct from new.score or old.feedback is distinct from new.feedback) then
    perform private.notify_users(
      array[new.student_id], 'homework_reviewed',
      case when new.status = 'reviewed' then 'Роботу перевірено' else 'Потрібно доопрацювати' end,
      v_a.title || coalesce(' · ' || new.score || '/' || v_a.max_score, ''),
      '/app/homework/view/?id=' || v_a.id,
      jsonb_build_object('assignment_id', v_a.id, 'submission_id', new.id)
    );
  end if;
  return new;
end;
$$;
create trigger submissions_changed after insert or update on public.submissions
  for each row execute function private.on_submission_change();

-- Lesson moved / cancelled → notify participants (creation is announced by the `schedule` function).
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
  elsif new.status = 'scheduled' and new.starts_at is distinct from old.starts_at then
    perform private.notify_users(v_users, 'lesson_moved', 'Урок перенесено',
      v_name || ': ' || private.kyiv(old.starts_at) || ' → ' || private.kyiv(new.starts_at), '/app/schedule/',
      jsonb_build_object('lesson_id', new.id, 'meet_url', new.meet_url));
    new.reminded_at := null;
  end if;
  return new;
end;
$$;
create trigger lessons_updated before update on public.lessons
  for each row execute function private.on_lesson_update();

-- ───────────────────────── Scheduled jobs ─────────────────────────
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

  -- housekeeping
  update public.lessons set status = 'completed'
  where status = 'scheduled' and ends_at < now() - interval '3 hours';
  delete from public.api_hits where created_at < now() - interval '2 days';
  delete from public.tg_link_codes where expires_at < now();
  delete from public.oauth_states where created_at < now() - interval '1 hour';
end;
$$;

select cron.schedule('seal-reminders', '*/5 * * * *', $$select private.run_reminders()$$);

-- ───────────────────────── RPCs for the app ─────────────────────────
-- Profile guard with a transaction-local bypass used by trusted RPCs (claim_first_admin).
create or replace function private.protect_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.profile_guard_bypass', true), '') = 'on' then
    return new;
  end if;
  if (select auth.uid()) is not null and not public.is_staff() then
    new.role := old.role;
    new.is_active := old.is_active;
    new.telegram_chat_id := old.telegram_chat_id;
    new.telegram_username := old.telegram_username;
    new.email := old.email;
  end if;
  if (select auth.uid()) is not null and public.auth_role() = 'manager'
     and (new.role = 'admin' or old.role = 'admin') and new.role is distinct from old.role then
    raise exception 'Only admins can change admin role';
  end if;
  return new;
end;
$$;

create or replace function public.has_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where role = 'admin');
$$;
grant execute on function public.has_admin() to anon, authenticated;

-- One-time bootstrap: the first signed-in user becomes admin while no admin exists.
create or replace function public.claim_first_admin()
returns boolean
language plpgsql security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return false;
  end if;
  lock table public.profiles in share row exclusive mode;
  if exists (select 1 from public.profiles where role = 'admin') then
    return false;
  end if;
  perform set_config('app.profile_guard_bypass', 'on', true);
  update public.profiles set role = 'admin' where id = (select auth.uid());
  perform set_config('app.profile_guard_bypass', 'off', true);
  return true;
end;
$$;
revoke execute on function public.claim_first_admin() from public, anon;
grant execute on function public.claim_first_admin() to authenticated;

create or replace function public.create_telegram_link()
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_code text := encode(extensions.gen_random_bytes(12), 'hex');
begin
  if (select auth.uid()) is null then
    raise exception 'not authenticated';
  end if;
  delete from public.tg_link_codes where user_id = (select auth.uid());
  insert into public.tg_link_codes (code, user_id, expires_at)
  values (v_code, (select auth.uid()), now() + interval '15 minutes');
  return v_code;
end;
$$;
revoke execute on function public.create_telegram_link() from public, anon;
grant execute on function public.create_telegram_link() to authenticated;

create or replace function public.unlink_telegram()
returns void
language sql security definer
set search_path = ''
as $$
  update public.profiles set telegram_chat_id = null, telegram_username = null
  where id = (select auth.uid());
$$;
revoke execute on function public.unlink_telegram() from public, anon;
grant execute on function public.unlink_telegram() to authenticated;

create or replace function public.staff_overview()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case when not public.is_staff() then null else jsonb_build_object(
    'leads_new', (select count(*) from public.leads where status = 'new'),
    'leads_active', (select count(*) from public.leads where status in ('new', 'contacted', 'trial_scheduled', 'trial_done')),
    'leads_month', (select count(*) from public.leads where created_at >= date_trunc('month', now())),
    'won_month', (select count(*) from public.leads where status = 'won' and updated_at >= date_trunc('month', now())),
    'students', (select count(*) from public.profiles where role = 'student' and is_active),
    'teachers', (select count(*) from public.profiles where role = 'teacher' and is_active),
    'groups', (select count(*) from public.groups where not is_archived),
    'lessons_week', (select count(*) from public.lessons where status <> 'cancelled'
      and starts_at >= date_trunc('week', now()) and starts_at < date_trunc('week', now()) + interval '7 days')
  ) end;
$$;
revoke execute on function public.staff_overview() from public, anon;
grant execute on function public.staff_overview() to authenticated;

-- Rate limit helper for public endpoints (service role only).
create or replace function public.hit_rate_limit(p_bucket text, p_max int, p_window_seconds int)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  select count(*) into v_count from public.api_hits
  where bucket = p_bucket and created_at > now() - make_interval(secs => p_window_seconds);
  if v_count >= p_max then
    return false;
  end if;
  insert into public.api_hits (bucket) values (p_bucket);
  return true;
end;
$$;
revoke execute on function public.hit_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, int, int) to service_role;

-- ───────────────────────── Realtime ─────────────────────────
alter publication supabase_realtime add table public.leads, public.lead_events, public.notifications, public.lessons;
