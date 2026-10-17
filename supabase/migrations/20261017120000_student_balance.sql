-- Student balance: staff record paid lesson packages, every held lesson uses one paid lesson, and the
-- student sees what is left (money and lessons). At 3 lessons left (and again at 0) the student, their
-- teacher and the staff get a notification, so the next package is paid before lessons stop.
--
-- What uses a paid lesson:
--   individual lesson — held (completed, or scheduled and already over), not cancelled; a no-show counts too;
--   group lesson      — held and the student is marked present or late.
-- Trial lessons never count. Lessons before `billing_from` are not counted (paid the old way).
-- Money left is FIFO: lessons are taken from the oldest package first at that package's own price.

alter table public.profiles
  add column if not exists billing_enabled boolean not null default true,
  add column if not exists billing_from timestamptz not null default now();

create table if not exists public.student_payments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  paid_on date not null default ((now() at time zone 'Europe/Kyiv')::date),
  amount numeric(10, 2) not null check (amount >= 0),
  lessons int not null check (lessons between 1 and 500),
  note text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists student_payments_student_idx on public.student_payments (student_id, paid_on);

alter table public.student_payments enable row level security;

drop policy if exists "student_payments: read" on public.student_payments;
create policy "student_payments: read" on public.student_payments for select to authenticated
using (
  student_id = (select auth.uid())
  or public.is_staff()
  or (public.is_teacher() and public.teaches_student(student_id))
);

drop policy if exists "student_payments: staff write" on public.student_payments;
create policy "student_payments: staff write" on public.student_payments for all to authenticated
using (public.is_staff()) with check (public.is_staff());

-- Students cannot switch billing off for themselves.
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
    new.billing_enabled := old.billing_enabled;
    new.billing_from := old.billing_from;
  end if;
  if (select auth.uid()) is not null and public.auth_role() = 'manager'
     and (new.role = 'admin' or old.role = 'admin') and new.role is distinct from old.role then
    raise exception 'Only admins can change admin role';
  end if;
  return new;
end;
$$;

create or replace function private.used_lessons(p_student uuid, p_from timestamptz)
returns int
language sql stable security definer
set search_path = ''
as $$
  select count(*)::int
  from public.lessons l
  where l.kind = 'regular'
    and l.starts_at >= p_from
    and (l.status = 'completed' or (l.status = 'scheduled' and l.ends_at < now()))
    and (
      l.student_id = p_student
      or (l.group_id is not null and exists (
        select 1 from public.lesson_attendance a
        where a.lesson_id = l.id and a.student_id = p_student and a.status in ('present', 'late')
      ))
    );
$$;

create or replace function private.balance_of(p_student uuid)
returns table (
  student_id uuid, enabled boolean, has_payments boolean, paid_uah numeric, balance_uah numeric,
  lessons_paid int, lessons_used int, lessons_left int, price_per_lesson numeric, last_paid_on date, upcoming int
)
language sql stable security definer
set search_path = ''
as $$
  with s as (
    select p.id, p.billing_enabled, p.billing_from from public.profiles p where p.id = p_student and p.role = 'student'
  ), used as (
    select private.used_lessons(s.id, s.billing_from) as n from s
  ), pk as (
    select sp.amount, sp.lessons, sp.paid_on, sp.created_at, sp.amount / sp.lessons as price,
      sum(sp.lessons) over (order by sp.paid_on, sp.created_at, sp.id) as cum
    from public.student_payments sp where sp.student_id = p_student
  ), agg as (
    select
      coalesce(sum(pk.amount), 0) as paid,
      coalesce(sum(pk.lessons), 0)::int as total,
      coalesce(sum(greatest(0, least(pk.lessons, pk.cum - (select n from used))) * pk.price), 0) as left_money,
      (array_agg(pk.price order by pk.paid_on desc, pk.created_at desc))[1] as last_price,
      max(pk.paid_on) as last_paid,
      count(*) as cnt
    from pk
  )
  select
    s.id,
    s.billing_enabled,
    agg.cnt > 0,
    agg.paid,
    round(agg.left_money - greatest((select n from used) - agg.total, 0) * coalesce(agg.last_price, 0), 2),
    agg.total,
    (select n from used),
    agg.total - (select n from used),
    round(agg.last_price, 2),
    agg.last_paid,
    (select count(*)::int from public.lessons l
      where l.kind = 'regular' and l.status = 'scheduled' and l.starts_at > now()
        and (l.student_id = s.id or l.group_id in (select gm.group_id from public.group_members gm where gm.student_id = s.id)))
  from s cross join agg;
$$;

-- One student's balance: the student themself, staff, or a teacher of that student.
create or replace function public.student_balance(p_student uuid default null)
returns table (
  student_id uuid, enabled boolean, has_payments boolean, paid_uah numeric, balance_uah numeric,
  lessons_paid int, lessons_used int, lessons_left int, price_per_lesson numeric, last_paid_on date, upcoming int
)
language sql stable security definer
set search_path = ''
as $$
  select b.* from private.balance_of(coalesce(p_student, (select auth.uid()))) b
  where coalesce(p_student, (select auth.uid())) = (select auth.uid())
     or public.is_staff()
     or (public.is_teacher() and public.teaches_student(coalesce(p_student, (select auth.uid()))));
$$;

-- Every visible student's balance (people list badges).
create or replace function public.student_balances()
returns table (
  student_id uuid, enabled boolean, has_payments boolean, paid_uah numeric, balance_uah numeric,
  lessons_paid int, lessons_used int, lessons_left int, price_per_lesson numeric, last_paid_on date, upcoming int
)
language sql stable security definer
set search_path = ''
as $$
  select b.*
  from public.profiles s
  cross join lateral private.balance_of(s.id) b
  where s.role = 'student'
    and (public.is_staff() or (public.is_teacher() and public.teaches_student(s.id)));
$$;

revoke execute on function public.student_balance(uuid), public.student_balances() from public, anon;
grant execute on function public.student_balance(uuid), public.student_balances() to authenticated;
revoke execute on function private.used_lessons(uuid, timestamptz), private.balance_of(uuid) from public, anon, authenticated;

-- Alerts: once per package at ≤3 lessons left, and once when nothing is left. A new payment re-arms them.
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
    select s.id, s.full_name, s.teacher_id, b.lessons_left, b.balance_uah,
      (select max(sp.created_at) from public.student_payments sp where sp.student_id = s.id) as last_pay,
      (select l.teacher_id from public.lessons l where l.student_id = s.id and l.status <> 'cancelled'
        order by abs(extract(epoch from l.starts_at - now())) limit 1) as lesson_teacher
    from public.profiles s
    cross join lateral private.balance_of(s.id) b
    where s.role = 'student' and s.is_active and b.enabled and b.has_payments and b.lessons_left <= 3
  loop
    v_kind := case when r.lessons_left <= 0 then 'balance_empty' else 'balance_low' end;
    continue when exists (
      select 1 from public.notifications n where n.user_id = r.id and n.kind = v_kind and n.created_at > r.last_pay
    );
    v_title := case
      when r.lessons_left <= 0 then 'Оплачені уроки закінчилися'
      when r.lessons_left = 1 then 'Залишився 1 оплачений урок'
      else format('Залишилось %s оплачені уроки', r.lessons_left)
    end;
    perform private.notify_users(
      array[r.id], v_kind, v_title,
      'Щоб навчання не переривалося, зв''яжіться з менеджером або викладачем і оплатіть наступний пакет уроків.',
      '/app/', jsonb_build_object('lessons_left', r.lessons_left, 'balance_uah', r.balance_uah)
    );
    perform private.notify_users(
      v_staff || r.teacher_id || r.lesson_teacher, v_kind || '_staff',
      format('%s: %s', r.full_name, lower(v_title)),
      format('Баланс %s грн. Нагадайте про оплату наступного пакета.', to_char(r.balance_uah, 'FM999990.00')),
      format('/app/people/?student=%s', r.id), jsonb_build_object('student_id', r.id, 'lessons_left', r.lessons_left)
    );
  end loop;
end;
$$;

select cron.unschedule('seal-balance-alerts') where exists (select 1 from cron.job where jobname = 'seal-balance-alerts');
select cron.schedule('seal-balance-alerts', '*/30 * * * *', $$select private.run_balance_alerts()$$);
