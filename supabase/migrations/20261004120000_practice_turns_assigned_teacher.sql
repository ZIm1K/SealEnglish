-- Practice transcripts: whoever teaches the student reads them, whatever their role
-- (an admin or manager who also teaches was shut out by the is_teacher() check).
-- Staff who don't teach the student still get summaries only.
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
        or public.teaches_student(ps.student_id)
        or (not p_turns and public.is_staff())
      )
  );
$$;
