-- RLS & access tests for every role (NFR-02). Run with `supabase test db` (pgTAP).
-- Each test switches to the `authenticated` role with a JWT `sub`, exactly like PostgREST does.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(52);

-- fixtures live in the middle of the previous month, so payouts never straddle a month boundary
create function pg_temp.t0() returns timestamptz language sql as $$
  select date_trunc('month', now()) - interval '10 days' + interval '12 hours';
$$;

-- ───────────── fixtures (as postgres: RLS bypassed) ─────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@test.ua', '{"full_name":"Admin"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'manager@test.ua', '{"full_name":"Manager"}'),
  ('00000000-0000-0000-0000-0000000000b1', 'teacher1@test.ua', '{"full_name":"Teacher One"}'),
  ('00000000-0000-0000-0000-0000000000b2', 'teacher2@test.ua', '{"full_name":"Teacher Two"}'),
  ('00000000-0000-0000-0000-0000000000c1', 's1@test.ua', '{"full_name":"Student One"}'),
  ('00000000-0000-0000-0000-0000000000c2', 's2@test.ua', '{"full_name":"Student Two"}'),
  ('00000000-0000-0000-0000-0000000000c3', 's3@test.ua', '{"full_name":"Student Three"}');
update profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000a1';
update profiles set role = 'manager' where id = '00000000-0000-0000-0000-0000000000a2';
update profiles set role = 'teacher' where id in ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2');
update profiles set phone = '+380000000000' where role = 'student';

insert into groups (id, name, teacher_id) values ('10000000-0000-0000-0000-000000000001', 'Teens B1', '00000000-0000-0000-0000-0000000000b1');
insert into group_members (group_id, student_id) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c2');

-- a past group lesson (teacher 1), a past individual lesson (teacher 2 ↔ student 3), a past trial (teacher 2)
insert into lessons (id, teacher_id, group_id, starts_at, ends_at) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000001', pg_temp.t0() - interval '3 hours', pg_temp.t0() - interval '2 hours');
insert into lessons (id, teacher_id, student_id, starts_at, ends_at) values
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c3', pg_temp.t0() - interval '5 hours', pg_temp.t0() - interval '4 hours');
insert into lessons (id, kind, teacher_id, starts_at, ends_at) values
  ('20000000-0000-0000-0000-000000000003', 'trial', '00000000-0000-0000-0000-0000000000b2', pg_temp.t0() - interval '26 hours', pg_temp.t0() - interval '25 hours');
insert into lesson_attendance (lesson_id, student_id, status) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', 'present'),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c2', 'absent');

insert into leads (id, name, phone) values
  ('30000000-0000-0000-0000-000000000001', 'Lead A', '+380111111111'),
  ('30000000-0000-0000-0000-000000000002', 'Lead B', '+380222222222'),
  ('30000000-0000-0000-0000-000000000003', 'Lead C', '+380333333333'),
  ('30000000-0000-0000-0000-000000000004', 'Lead D', '+380444444444'),
  ('30000000-0000-0000-0000-000000000005', 'Lead E', '+380555555555');
insert into lesson_leads (lesson_id, lead_id) values
  ('20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000002');

insert into assignments (id, title, teacher_id, group_id) values
  ('40000000-0000-0000-0000-000000000001', 'Essay', '00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000001');
insert into submissions (id, assignment_id, student_id, body) values
  ('50000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', 'My essay');
insert into submission_ai_reviews (submission_id, status, score, feedback) values
  ('50000000-0000-0000-0000-000000000001', 'ready', 9, 'Draft feedback');

insert into practice_sessions (id, student_id, summary) values
  ('60000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', '{"summary":"ok"}');
insert into practice_turns (session_id, role, content) values
  ('60000000-0000-0000-0000-000000000001', 'user', 'Hello Seely'),
  ('60000000-0000-0000-0000-000000000001', 'assistant', 'Hi!');
select private.upsert_mistakes('00000000-0000-0000-0000-0000000000c1', 'practice', '60000000-0000-0000-0000-000000000001',
  '[{"category":"grammar","example":"I goed","correction":"I went"}]', null);
insert into ai_usage (user_id, feature, model, cost_usd) values ('00000000-0000-0000-0000-0000000000c1', 'tutor', 'claude-sonnet-5', 0.01);
insert into error_log (source, message) values ('test', 'boom');
insert into lesson_summaries (lesson_id, vocabulary, mistakes, status) values
  ('20000000-0000-0000-0000-000000000001', '[{"term":"luggage"}]',
   '[{"category":"grammar","example":"he go","correction":"he goes","student_id":"00000000-0000-0000-0000-0000000000c2"}]', 'draft');
insert into risk_scores (student_id, computed_on, score) values ('00000000-0000-0000-0000-0000000000c1', current_date, 70);
insert into parent_contacts (student_id, telegram_chat_id, consent_at) values ('00000000-0000-0000-0000-0000000000c1', 777, now());
insert into level_tests (lead_id, level, completed_at) values ('30000000-0000-0000-0000-000000000001', 'B1', now());

create function pg_temp.login(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p::text, true);
$$;

-- ───────────── student 1 ─────────────
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');

select is((select count(*) from profiles where role = 'student')::int, 1, 'student sees only own student profile (no classmates'' phones)');
select is((select count(*) from profiles where role in ('teacher', 'manager', 'admin'))::int, 4, 'student sees staff profiles');
select is((select count(*) from leads)::int, 0, 'student sees no leads');
select is((select count(*) from lesson_leads)::int, 0, 'student sees no trial participants');
select is((select count(*) from submissions)::int, 1, 'student sees own submission');
select is((select count(*) from submission_ai_reviews)::int, 0, 'student never sees the AI draft score');
select is((select count(*) from practice_sessions)::int, 1, 'student sees own practice session');
select is((select count(*) from practice_turns)::int, 2, 'student sees own practice turns');
select is((select count(*) from student_mistakes)::int, 1, 'student sees own mistake profile');
select is((select count(*) from lesson_summaries)::int, 0, 'student does not read raw lesson summaries (mistakes stay private)');
select is(lesson_topics('20000000-0000-0000-0000-000000000001'), null, 'unpublished summary is not visible via lesson_topics');
select is((select count(*) from ai_usage)::int, 0, 'student sees no AI usage');
select is((select count(*) from error_log)::int, 0, 'student sees no error log');
select is((select count(*) from risk_scores)::int, 0, 'student sees no risk scores');
select is((select count(*) from parent_contacts)::int, 0, 'student sees no parent contacts');
select is((select count(*) from level_tests)::int, 0, 'student sees no level tests');
select is((select count(*) from teacher_payouts(pg_temp.t0()::date))::int, 0, 'student gets no payout rows');
select is(payout_rates(), null, 'student cannot read payout rates');
select ok(ai_features() ? 'tutor_messages_left', 'ai_features answers for a student');
select throws_ok($$insert into practice_sessions (student_id) values ('00000000-0000-0000-0000-0000000000c1')$$, '42501', null, 'student cannot create practice sessions directly');
select throws_ok($$insert into student_mistakes (student_id, category, example, correction, source, key) values ('00000000-0000-0000-0000-0000000000c1', 'grammar', 'a', 'b', 'teacher', 'k')$$, '42501', null, 'student cannot write own mistake profile');
select throws_ok($$select add_student_mistakes('00000000-0000-0000-0000-0000000000c1', 'teacher', null, '[]')$$, 'P0001', 'Недостатньо прав', 'student cannot call add_student_mistakes');
select is((select count(*) from submission_ai_reviews)::int, 0, 'still no drafts after attempts');
update profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000c1';
reset role;
select is((select role::text from profiles where id = '00000000-0000-0000-0000-0000000000c1'), 'student', 'student cannot escalate own role');

-- ───────────── teacher 1 (group teacher of students 1 & 2) ─────────────
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select is((select count(*) from profiles where role = 'student')::int, 2, 'teacher sees students of own group only');
select is((select count(*) from submission_ai_reviews)::int, 1, 'teacher sees AI drafts for own assignments');
select is((select count(*) from practice_turns)::int, 2, 'teacher reads own student''s practice turns');
select is((select count(*) from student_mistakes)::int, 1, 'teacher sees own students'' mistakes');
select is((select count(*) from lesson_summaries)::int, 1, 'teacher reads summaries of own lessons');
select is((select count(*) from leads)::int, 0, 'teacher without trials sees no leads');
select is(publish_lesson_summary('20000000-0000-0000-0000-000000000001'), 1, 'publishing attributes the mistake to the group member');
select is((select count(*) from teacher_payouts(pg_temp.t0()::date))::int, 1, 'teacher sees only own payout row');
select is((select amount from teacher_payouts(pg_temp.t0()::date)), 210::numeric, 'group lesson: 180 + 30 × 1 present');
select ok(payout_rates() is not null, 'teacher can read payout rates');
select is((select count(*) from risk_scores)::int, 1, 'teacher sees risk of own students');
select lives_ok($$update practice_sessions set reviewed_at = now() where id = '60000000-0000-0000-0000-000000000001'$$, 'teacher can mark a flagged session reviewed');

-- ───────────── teacher 2 (trial + individual student 3) ─────────────
select pg_temp.login('00000000-0000-0000-0000-0000000000b2');
select is((select count(*) from profiles where role = 'student')::int, 1, 'teacher 2 sees only own individual student');
select is((select count(*) from leads)::int, 2, 'trial teacher sees the leads of own trial');
select is((select count(*) from lesson_leads)::int, 2, 'trial teacher sees trial participants');
select is((select count(*) from submission_ai_reviews)::int, 0, 'teacher 2 sees no drafts of other teachers');
select is((select count(*) from practice_turns)::int, 0, 'teacher 2 cannot read other teachers'' students practice');
select throws_ok($$select add_student_mistakes('00000000-0000-0000-0000-0000000000c1', 'teacher', null, '[]')$$, 'P0001', 'Недостатньо прав', 'teacher cannot add mistakes for a student they don''t teach');
update lesson_leads set attended = true where lead_id = '30000000-0000-0000-0000-000000000001';
reset role;
select is((select status::text from leads where id = '30000000-0000-0000-0000-000000000001'), 'trial_done', 'marking a lead attended moves only that lead to trial_done');
select is((select status::text from leads where id = '30000000-0000-0000-0000-000000000002'), 'new', 'the other lead of the mini-group keeps its status');

-- ───────────── manager ─────────────
set local role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select is((select count(*) from practice_sessions)::int, 1, 'manager sees practice summaries');
select is((select count(*) from practice_turns)::int, 0, 'manager does not read practice turns (privacy of practice)');
select is((select count(*) from ai_usage)::int, 0, 'manager does not read AI usage (admin only)');
select is((select count(*) from teacher_payouts(pg_temp.t0()::date))::int, 0, 'manager sees only own payouts (none)');

-- ───────────── admin ─────────────
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select is((select count(*) from ai_usage)::int, 1, 'admin reads AI usage');
select is((select count(*) from error_log)::int, 1, 'admin reads the error log');
select is((select count(*) from teacher_payouts(pg_temp.t0()::date))::int, 2, 'admin sees all teachers'' payouts');
reset role;

-- ───────────── constraints ─────────────
insert into lesson_leads (lesson_id, lead_id) values
  ('20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003'),
  ('20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000004');
select throws_ok($$insert into lesson_leads (lesson_id, lead_id) values ('20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000005')$$,
  'P0001', 'У пробній міні-групі максимум 4 учасники', 'a trial mini-group holds at most 4 leads');

select * from finish();
rollback;
