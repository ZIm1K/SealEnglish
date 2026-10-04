-- Practice transcripts are private to the student and the teacher responsible for them: the
-- assigned teacher or the teacher of the student's (non-archived) group. Having taught the student
-- once in the last 14 days (a substitute — see teaches_student) no longer opens the chat.
-- Session summaries keep the wider rule: staff and anyone who teaches the student.
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
        or exists (
          select 1 from public.profiles p
          where p.id = ps.student_id and p.teacher_id = (select auth.uid())
        )
        or exists (
          select 1 from public.group_members gm
          join public.groups g on g.id = gm.group_id
          where gm.student_id = ps.student_id and g.teacher_id = (select auth.uid()) and not g.is_archived
        )
        or (not p_turns and (public.is_staff() or public.teaches_student(ps.student_id)))
      )
  );
$$;
