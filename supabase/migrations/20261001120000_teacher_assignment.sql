-- Seal English — students and groups are assigned to a teacher, substitutions, teacher handover;
-- Google Calendar events of deleted/cancelled lessons are removed through a retrying queue.

-- ───────────────────────── Individual students: assigned teacher ─────────────────────────
alter table public.profiles
  add column teacher_id uuid references public.profiles (id) on delete set null;
create index profiles_teacher_idx on public.profiles (teacher_id) where teacher_id is not null;

-- Backfill: the teacher of the student's latest individual lesson.
update public.profiles p
set teacher_id = x.teacher_id
from (
  select distinct on (student_id) student_id, teacher_id
  from public.lessons
  where student_id is not null and status <> 'cancelled'
  order by student_id, starts_at desc
) x
where p.id = x.student_id and p.role = 'student' and p.teacher_id is null;

-- ───────────────────────── Substitutions ─────────────────────────
-- `substitute_for` = the assigned teacher who is replaced on this lesson; `teacher_id` = who actually teaches (and gets paid).
alter table public.lessons
  add column substitute_for uuid references public.profiles (id) on delete set null;
create index lessons_substitute_idx on public.lessons (substitute_for) where substitute_for is not null;

-- ───────────────────────── Access: a teacher sees only their own students ─────────────────────────
-- Assigned group (not archived), assigned individual student, or a lesson with the student around now
-- (a substitute keeps access for two weeks to review the lesson). History of handed-over students is no longer visible.
create or replace function public.teaches_student(p_student uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.group_members gm
      join public.groups g on g.id = gm.group_id
      where gm.student_id = p_student and g.teacher_id = (select auth.uid()) and not g.is_archived
    )
    or exists (
      select 1 from public.profiles p
      where p.id = p_student and p.teacher_id = (select auth.uid())
    )
    or exists (
      select 1 from public.lessons l
      where l.teacher_id = (select auth.uid())
        and l.status <> 'cancelled'
        and l.starts_at > now() - interval '14 days'
        and (l.student_id = p_student or (l.group_id is not null and exists (
          select 1 from public.group_members gm where gm.group_id = l.group_id and gm.student_id = p_student
        )))
    );
$$;

-- Non-staff cannot reassign themselves to a teacher.
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
    new.teacher_id := old.teacher_id;
  end if;
  if (select auth.uid()) is not null and public.auth_role() = 'manager'
     and (new.role = 'admin' or old.role = 'admin') and new.role is distinct from old.role then
    raise exception 'Only admins can change admin role';
  end if;
  return new;
end;
$$;

-- Teacher load for the "Teachers" page (staff only).
create or replace function public.teacher_load()
returns table (
  teacher_id uuid,
  groups int,
  students int,
  lessons_next_14d int,
  substitutions_next_14d int,
  pending_reviews int
)
language sql stable security definer
set search_path = ''
as $$
  select
    t.id,
    (select count(*)::int from public.groups g where g.teacher_id = t.id and not g.is_archived),
    (select count(*)::int from public.profiles s where s.teacher_id = t.id and s.role = 'student' and s.is_active),
    (select count(*)::int from public.lessons l where l.teacher_id = t.id and l.status = 'scheduled'
      and l.starts_at >= now() and l.starts_at < now() + interval '14 days'),
    (select count(*)::int from public.lessons l where l.teacher_id = t.id and l.substitute_for is not null
      and l.status = 'scheduled' and l.starts_at >= now() and l.starts_at < now() + interval '14 days'),
    (select count(*)::int from public.submissions sb join public.assignments a on a.id = sb.assignment_id
      where a.teacher_id = t.id and sb.status = 'submitted')
  from public.profiles t
  where public.is_staff() and t.role in ('teacher', 'manager', 'admin');
$$;
revoke execute on function public.teacher_load() from public, anon;
grant execute on function public.teacher_load() to authenticated;

-- ───────────────────────── Google Calendar: delete queue ─────────────────────────
-- Every lesson that disappears (deleted directly, by cascade from a group/student/lead, or cancelled)
-- leaves its event id here; the `schedule` function deletes it from Google and retries failures.
create table public.google_event_trash (
  event_id text primary key,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  tried_at timestamptz
);
alter table public.google_event_trash enable row level security;
revoke all on public.google_event_trash from anon, authenticated;

create or replace function private.trash_lesson_events()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if tg_op = 'DELETE' then
    insert into public.google_event_trash (event_id)
    select distinct o.google_event_id from old_rows o where o.google_event_id is not null
    on conflict (event_id) do nothing;
  else
    insert into public.google_event_trash (event_id)
    select distinct o.google_event_id
    from old_rows o join new_rows n on n.id = o.id
    where o.google_event_id is not null
      and ((n.status = 'cancelled' and o.status <> 'cancelled') or n.google_event_id is distinct from o.google_event_id)
    on conflict (event_id) do nothing;
  end if;
  get diagnostics v_count = row_count;
  if v_count > 0 then
    perform private.call_function('schedule', jsonb_build_object('action', 'purge_google'));
  end if;
  return null;
end;
$$;

create trigger lessons_trash_events_del after delete on public.lessons
  referencing old table as old_rows
  for each statement execute function private.trash_lesson_events();
create trigger lessons_trash_events_upd after update on public.lessons
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.trash_lesson_events();

-- Earlier cancellations swallowed Google errors: re-check them (already deleted → 410, treated as done).
insert into public.google_event_trash (event_id)
select distinct google_event_id from public.lessons
where status = 'cancelled' and google_event_id is not null
on conflict (event_id) do nothing;

-- Retries every 10 minutes; nightly sweep of Seal events that no longer match a lesson.
create or replace function private.run_google_cleanup(p_sweep boolean default false)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_sweep then
    perform private.call_function('schedule', jsonb_build_object('action', 'sync_google'));
  elsif exists (select 1 from public.google_event_trash where attempts < 30) then
    perform private.call_function('schedule', jsonb_build_object('action', 'purge_google'));
  end if;
end;
$$;

select cron.schedule('seal-google-purge', '*/10 * * * *', $$select private.run_google_cleanup(false)$$);
select cron.schedule('seal-google-sweep', '40 0 * * *', $$select private.run_google_cleanup(true)$$);
