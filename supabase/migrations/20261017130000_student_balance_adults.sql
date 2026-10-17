-- Student balance is shown to the student only on adult accounts (age_group = 'adults'). Kids and teens
-- never see money or payment reminders; staff and teachers still see every balance and get the alerts.

drop policy if exists "student_payments: read" on public.student_payments;
create policy "student_payments: read" on public.student_payments for select to authenticated
using (
  public.is_staff()
  or (public.is_teacher() and public.teaches_student(student_id))
  or (student_id = (select auth.uid()) and exists (
    select 1 from public.profiles p where p.id = student_id and p.age_group = 'adults'
  ))
);

create or replace function public.student_balance(p_student uuid default null)
returns table (
  student_id uuid, enabled boolean, has_payments boolean, paid_uah numeric, balance_uah numeric,
  lessons_paid int, lessons_used int, lessons_left int, price_per_lesson numeric, last_paid_on date, upcoming int
)
language sql stable security definer
set search_path = ''
as $$
  select b.* from private.balance_of(coalesce(p_student, (select auth.uid()))) b
  where public.is_staff()
     or (public.is_teacher() and public.teaches_student(b.student_id))
     or (b.student_id = (select auth.uid()) and exists (
       select 1 from public.profiles p where p.id = b.student_id and p.age_group = 'adults'
     ));
$$;

create or replace function private.run_balance_alerts()
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
  v_kind text;
  v_title text;
  v_staff uuid[];
begin
  select coalesce(array_agg(id), '{}') into v_staff from public.profiles where role in ('manager', 'admin') and is_active;
  for r in
    select s.id, s.full_name, s.teacher_id, s.age_group, b.lessons_left, b.balance_uah,
      (select max(sp.created_at) from public.student_payments sp where sp.student_id = s.id) as last_pay,
      (select l.teacher_id from public.lessons l where l.student_id = s.id and l.status <> 'cancelled'
        order by abs(extract(epoch from l.starts_at - now())) limit 1) as lesson_teacher
    from public.profiles s
    cross join lateral private.balance_of(s.id) b
    where s.role = 'student' and s.is_active and b.enabled and b.has_payments and b.lessons_left <= 3
  loop
    v_kind := case when r.lessons_left <= 0 then 'balance_empty' else 'balance_low' end;
    -- the staff copy is the marker, so kids/teens (who get no copy of their own) are not re-alerted either
    continue when exists (
      select 1 from public.notifications n
      where n.kind = v_kind || '_staff' and (n.data ->> 'student_id')::uuid = r.id and n.created_at > r.last_pay
    );
    v_title := case
      when r.lessons_left <= 0 then 'Оплачені уроки закінчилися'
      when r.lessons_left = 1 then 'Залишився 1 оплачений урок'
      else format('Залишилось %s оплачені уроки', r.lessons_left)
    end;
    if r.age_group = 'adults' then
      perform private.notify_users(
        array[r.id], v_kind, v_title,
        'Щоб навчання не переривалося, зв''яжіться з менеджером або викладачем і оплатіть наступний пакет уроків.',
        '/app/', jsonb_build_object('lessons_left', r.lessons_left, 'balance_uah', r.balance_uah)
      );
    end if;
    perform private.notify_users(
      v_staff || r.teacher_id || r.lesson_teacher, v_kind || '_staff',
      format('%s: %s', r.full_name, lower(v_title)),
      format('Баланс %s грн. Нагадайте про оплату наступного пакета.', to_char(r.balance_uah, 'FM999990.00')),
      format('/app/people/?student=%s', r.id), jsonb_build_object('student_id', r.id, 'lessons_left', r.lessons_left)
    );
  end loop;
end;
$$;
