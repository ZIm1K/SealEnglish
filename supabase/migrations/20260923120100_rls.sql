-- Seal English — access helpers and row level security

-- ───────────────────────── Access helpers (security definer → no RLS recursion) ─────────────────────────
create or replace function public.auth_role()
returns public.user_role
language sql stable security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid()) and is_active;
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(public.auth_role() in ('manager', 'admin'), false);
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(public.auth_role() = 'admin', false);
$$;

create or replace function public.is_teacher()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(public.auth_role() = 'teacher', false);
$$;

create or replace function public.is_group_member(p_group uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group and student_id = (select auth.uid())
  );
$$;

create or replace function public.teaches_group(p_group uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.groups
    where id = p_group and teacher_id = (select auth.uid())
  );
$$;

create or replace function public.teaches_student(p_student uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.group_members gm
      join public.groups g on g.id = gm.group_id
      where gm.student_id = p_student and g.teacher_id = (select auth.uid())
    )
    or exists (
      select 1 from public.lessons l
      where l.student_id = p_student and l.teacher_id = (select auth.uid())
    )
    or exists (
      select 1 from public.assignments a
      where a.student_id = p_student and a.teacher_id = (select auth.uid())
    );
$$;

create or replace function public.shares_group(p_student uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members a
    join public.group_members b on b.group_id = a.group_id
    where a.student_id = (select auth.uid()) and b.student_id = p_student
  );
$$;

create or replace function public.can_view_material(p_material uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select public.is_staff() or public.is_teacher() or exists (
    select 1 from public.material_shares s
    where s.material_id = p_material
      and (s.student_id = (select auth.uid()) or (s.group_id is not null and public.is_group_member(s.group_id)))
  );
$$;

create or replace function public.can_view_assignment(p_assignment uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.assignments a
    where a.id = p_assignment
      and (
        public.is_staff()
        or a.teacher_id = (select auth.uid())
        or a.student_id = (select auth.uid())
        or (a.group_id is not null and public.is_group_member(a.group_id))
      )
  );
$$;

create or replace function public.teaches_assignment(p_assignment uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.assignments a
    where a.id = p_assignment and a.teacher_id = (select auth.uid())
  );
$$;

create or replace function public.teaches_lesson(p_lesson uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.lessons l
    where l.id = p_lesson and l.teacher_id = (select auth.uid())
  );
$$;

revoke execute on function
  public.auth_role(), public.is_staff(), public.is_admin(), public.is_teacher(),
  public.is_group_member(uuid), public.teaches_group(uuid), public.teaches_student(uuid),
  public.shares_group(uuid), public.can_view_material(uuid), public.can_view_assignment(uuid),
  public.teaches_assignment(uuid), public.teaches_lesson(uuid)
from public, anon;
grant execute on function
  public.auth_role(), public.is_staff(), public.is_admin(), public.is_teacher(),
  public.is_group_member(uuid), public.teaches_group(uuid), public.teaches_student(uuid),
  public.shares_group(uuid), public.can_view_material(uuid), public.can_view_assignment(uuid),
  public.teaches_assignment(uuid), public.teaches_lesson(uuid)
to authenticated, service_role;

-- ───────────────────────── Profiles ─────────────────────────
create policy "profiles: read" on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or role in ('teacher', 'manager', 'admin')
  or public.is_staff()
  or (public.is_teacher() and public.teaches_student(id))
  or public.shares_group(id)
);

create policy "profiles: update self or staff" on public.profiles for update to authenticated
using (id = (select auth.uid()) or public.is_staff())
with check (id = (select auth.uid()) or public.is_staff());

-- Non-staff users cannot escalate role, reactivate themselves or forge Telegram links.
create or replace function private.protect_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not public.is_staff() then
    new.role := old.role;
    new.is_active := old.is_active;
    new.telegram_chat_id := old.telegram_chat_id;
    new.telegram_username := old.telegram_username;
    new.email := old.email;
  end if;
  -- only admins may grant/revoke admin
  if (select auth.uid()) is not null and public.auth_role() = 'manager'
     and (new.role = 'admin' or old.role = 'admin') and new.role is distinct from old.role then
    raise exception 'Only admins can change admin role';
  end if;
  return new;
end;
$$;
create trigger profiles_protect before update on public.profiles
  for each row execute function private.protect_profile();

-- ───────────────────────── Groups ─────────────────────────
create policy "groups: read" on public.groups for select to authenticated
using (public.is_staff() or teacher_id = (select auth.uid()) or public.is_group_member(id));
create policy "groups: staff write" on public.groups for all to authenticated
using (public.is_staff()) with check (public.is_staff());

create policy "group_members: read" on public.group_members for select to authenticated
using (
  public.is_staff()
  or public.teaches_group(group_id)
  or student_id = (select auth.uid())
  or public.is_group_member(group_id)
);
create policy "group_members: staff write" on public.group_members for all to authenticated
using (public.is_staff()) with check (public.is_staff());

-- ───────────────────────── Leads ─────────────────────────
create policy "leads: staff all" on public.leads for all to authenticated
using (public.is_staff()) with check (public.is_staff());
create policy "leads: trial teacher read" on public.leads for select to authenticated
using (exists (
  select 1 from public.lessons l where l.lead_id = leads.id and l.teacher_id = (select auth.uid())
));

create policy "lead_events: staff read" on public.lead_events for select to authenticated
using (public.is_staff());
create policy "lead_events: staff insert" on public.lead_events for insert to authenticated
with check (public.is_staff() and actor_id = (select auth.uid()));

-- ───────────────────────── Lessons ─────────────────────────
-- Lessons are created / rescheduled through the `schedule` Edge Function (Google Meet sync).
create policy "lessons: read" on public.lessons for select to authenticated
using (
  public.is_staff()
  or teacher_id = (select auth.uid())
  or student_id = (select auth.uid())
  or (group_id is not null and public.is_group_member(group_id))
);
create policy "lessons: teacher/staff update" on public.lessons for update to authenticated
using (public.is_staff() or teacher_id = (select auth.uid()))
with check (public.is_staff() or teacher_id = (select auth.uid()));
revoke insert, update, delete on public.lessons from authenticated, anon;
grant update (title, topic, teacher_notes, status) on public.lessons to authenticated;

create policy "attendance: read" on public.lesson_attendance for select to authenticated
using (public.is_staff() or public.teaches_lesson(lesson_id) or student_id = (select auth.uid()));
create policy "attendance: teacher write" on public.lesson_attendance for all to authenticated
using (public.is_staff() or public.teaches_lesson(lesson_id))
with check (public.is_staff() or public.teaches_lesson(lesson_id));

-- ───────────────────────── Materials ─────────────────────────
create policy "materials: read" on public.materials for select to authenticated
using (public.can_view_material(id));
create policy "materials: teacher insert" on public.materials for insert to authenticated
with check ((public.is_staff() or public.is_teacher()) and owner_id = (select auth.uid()));
create policy "materials: owner update" on public.materials for update to authenticated
using (public.is_staff() or owner_id = (select auth.uid()))
with check (public.is_staff() or owner_id = (select auth.uid()));
create policy "materials: owner delete" on public.materials for delete to authenticated
using (public.is_staff() or owner_id = (select auth.uid()));

create policy "material_shares: read" on public.material_shares for select to authenticated
using (
  public.is_staff() or public.is_teacher()
  or student_id = (select auth.uid())
  or (group_id is not null and public.is_group_member(group_id))
);
create policy "material_shares: teacher write" on public.material_shares for insert to authenticated
with check (
  public.is_staff()
  or (public.is_teacher() and (
    (group_id is not null and public.teaches_group(group_id))
    or (student_id is not null and public.teaches_student(student_id))
  ))
);
create policy "material_shares: teacher delete" on public.material_shares for delete to authenticated
using (public.is_staff() or shared_by = (select auth.uid()) or (group_id is not null and public.teaches_group(group_id)));

-- ───────────────────────── Homework ─────────────────────────
create policy "assignments: read" on public.assignments for select to authenticated
using (
  public.is_staff()
  or teacher_id = (select auth.uid())
  or student_id = (select auth.uid())
  or (group_id is not null and public.is_group_member(group_id))
);
create policy "assignments: teacher insert" on public.assignments for insert to authenticated
with check (
  public.is_staff()
  or (public.is_teacher() and teacher_id = (select auth.uid()) and (
    (group_id is not null and public.teaches_group(group_id))
    or (student_id is not null and public.teaches_student(student_id))
  ))
);
create policy "assignments: owner update" on public.assignments for update to authenticated
using (public.is_staff() or teacher_id = (select auth.uid()))
with check (public.is_staff() or teacher_id = (select auth.uid()));
create policy "assignments: owner delete" on public.assignments for delete to authenticated
using (public.is_staff() or teacher_id = (select auth.uid()));

create policy "submissions: read" on public.submissions for select to authenticated
using (public.is_staff() or student_id = (select auth.uid()) or public.teaches_assignment(assignment_id));
create policy "submissions: student insert" on public.submissions for insert to authenticated
with check (student_id = (select auth.uid()) and public.can_view_assignment(assignment_id));
create policy "submissions: student/teacher update" on public.submissions for update to authenticated
using (public.is_staff() or student_id = (select auth.uid()) or public.teaches_assignment(assignment_id))
with check (public.is_staff() or student_id = (select auth.uid()) or public.teaches_assignment(assignment_id));

-- Students edit only their answer (review resets to "submitted"); teachers edit only the review.
create or replace function private.guard_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'submitted';
    new.score := null;
    new.feedback := null;
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.submitted_at := now();
    return new;
  end if;
  if new.student_id = v_uid and not public.teaches_assignment(new.assignment_id) and not public.is_staff() then
    if old.status = 'reviewed' then
      raise exception 'Робота вже перевірена';
    end if;
    new.student_id := old.student_id;
    new.assignment_id := old.assignment_id;
    new.score := old.score;
    new.feedback := old.feedback;
    new.reviewed_at := old.reviewed_at;
    new.reviewed_by := old.reviewed_by;
    new.status := 'submitted';
    new.submitted_at := now();
  else
    new.student_id := old.student_id;
    new.assignment_id := old.assignment_id;
    new.body := old.body;
    new.attachments := old.attachments;
    new.submitted_at := old.submitted_at;
    if new.status is distinct from old.status or new.score is distinct from old.score or new.feedback is distinct from old.feedback then
      new.reviewed_at := now();
      new.reviewed_by := v_uid;
    end if;
  end if;
  return new;
end;
$$;
create trigger submissions_guard before insert or update on public.submissions
  for each row execute function private.guard_submission();

-- ───────────────────────── Notifications ─────────────────────────
create policy "notifications: own read" on public.notifications for select to authenticated
using (user_id = (select auth.uid()));
create policy "notifications: own update" on public.notifications for update to authenticated
using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "notifications: own delete" on public.notifications for delete to authenticated
using (user_id = (select auth.uid()));
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ───────────────────────── Settings ─────────────────────────
create policy "app_settings: public read" on public.app_settings for select to anon, authenticated
using (is_public or public.is_admin());
create policy "app_settings: admin write" on public.app_settings for all to authenticated
using (public.is_admin()) with check (public.is_admin());
