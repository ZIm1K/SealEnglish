-- Student payments on the «Оплата уроків» page: how a package was paid, and a per-month view of every
-- student's lessons (bought / held this month) next to the all-time balance from private.balance_of.
-- Payments themselves stay in public.student_payments (20261017120000_student_balance.sql), same RLS.

alter table public.student_payments
  add column if not exists method text check (method in ('card', 'cash', 'transfer', 'other'));

-- One row per student for the month: overall balance plus what was paid and held within the month.
-- Held = the same rule as private.used_lessons (individual lesson over and not cancelled; group lesson with
-- the student present or late; trials never count). With billing on, lessons before billing_from are left
-- out so the month agrees with the balance; with billing off every held lesson is shown.
create or replace function public.student_billing_month(p_month date)
returns table (
  student_id uuid, full_name text, avatar_url text, age_group public.age_group, is_active boolean,
  enabled boolean, has_payments boolean, balance_uah numeric, lessons_paid int, lessons_used int, lessons_left int,
  price_per_lesson numeric, last_paid_on date, upcoming int,
  month_used int, month_paid_uah numeric, month_lessons_bought int, month_payments int
)
language sql stable security definer
set search_path = ''
as $$
  with bounds as (
    select (date_trunc('month', p_month)::timestamp at time zone 'Europe/Kyiv') as f,
           ((date_trunc('month', p_month) + interval '1 month')::timestamp at time zone 'Europe/Kyiv') as t,
           date_trunc('month', p_month)::date as d_from,
           (date_trunc('month', p_month) + interval '1 month')::date as d_to
  )
  select s.id, s.full_name, s.avatar_url, s.age_group, s.is_active,
    b.enabled, b.has_payments, b.balance_uah, b.lessons_paid, b.lessons_used, b.lessons_left,
    b.price_per_lesson, b.last_paid_on, b.upcoming,
    (select count(*)::int
      from public.lessons l
      where l.kind = 'regular'
        and l.starts_at >= case when s.billing_enabled then greatest(bounds.f, s.billing_from) else bounds.f end
        and l.starts_at < bounds.t
        and (l.status = 'completed' or (l.status = 'scheduled' and l.ends_at < now()))
        and (
          l.student_id = s.id
          or (l.group_id is not null and exists (
            select 1 from public.lesson_attendance a
            where a.lesson_id = l.id and a.student_id = s.id and a.status in ('present', 'late')
          ))
        )),
    coalesce(pm.amount, 0), coalesce(pm.lessons, 0)::int, coalesce(pm.cnt, 0)::int
  from bounds
  cross join public.profiles s
  cross join lateral private.balance_of(s.id) b
  left join lateral (
    select sum(sp.amount) as amount, sum(sp.lessons) as lessons, count(*) as cnt
    from public.student_payments sp
    where sp.student_id = s.id and sp.paid_on >= bounds.d_from and sp.paid_on < bounds.d_to
  ) pm on true
  where s.role = 'student' and public.is_staff()
  order by s.full_name;
$$;

revoke execute on function public.student_billing_month(date) from public, anon;
grant execute on function public.student_billing_month(date) to authenticated;
