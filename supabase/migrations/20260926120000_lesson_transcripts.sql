-- Lesson transcripts: the teacher's browser records the lesson (teacher mic + Meet tab audio as two tracks),
-- uploads 10-minute chunks to `lesson-audio`, ai-transcribe turns them into text and deletes the audio,
-- then ai-lesson drafts the summary from the transcript. Students never see transcripts or audio.
--   lesson-audio: <lesson_id>/<track t|s>-<index>-<offset_sec>.webm

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lesson-audio', 'lesson-audio', false, 31457280, array['audio/webm', 'audio/ogg', 'video/webm'])
on conflict (id) do nothing;

create policy "lesson-audio: teacher upload" on storage.objects for insert to authenticated
with check (
  bucket_id = 'lesson-audio'
  and (public.is_staff() or public.teaches_lesson(((storage.foldername(name))[1])::uuid))
);
create policy "lesson-audio: teacher read" on storage.objects for select to authenticated
using (
  bucket_id = 'lesson-audio'
  and (public.is_staff() or public.teaches_lesson(((storage.foldername(name))[1])::uuid))
);
create policy "lesson-audio: teacher delete" on storage.objects for delete to authenticated
using (
  bucket_id = 'lesson-audio'
  and (public.is_staff() or public.teaches_lesson(((storage.foldername(name))[1])::uuid))
);

create table public.lesson_transcripts (
  lesson_id uuid primary key references public.lessons (id) on delete cascade,
  status text not null default 'recording' check (status in ('recording', 'processing', 'ready', 'failed')),
  text text,                       -- "[mm:ss] ВИКЛАДАЧ: …" lines
  duration_sec int,
  error text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger lesson_transcripts_touch before update on public.lesson_transcripts
  for each row execute function private.touch_updated_at();

alter table public.lesson_transcripts enable row level security;
create policy "lesson_transcripts: teacher" on public.lesson_transcripts for all to authenticated
using (public.is_staff() or public.teaches_lesson(lesson_id))
with check (public.is_staff() or public.teaches_lesson(lesson_id));

-- The client decides whether to show the "record lesson" button.
create or replace function public.ai_features()
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_on boolean := coalesce((private.ai_setting('enabled'))::boolean, false)
    and coalesce((select value = 'true'::jsonb from public.app_settings where key = 'ai_configured'), false);
  v_spent record;
begin
  if v_uid is null then
    return null;
  end if;
  select * into v_spent from private.ai_spent_today(v_uid);
  return jsonb_build_object(
    'enabled', v_on,
    'tutor', private.tutor_allowed(v_uid),
    'review', v_on and coalesce((private.ai_setting('review_enabled'))::boolean, false),
    'lesson', v_on and coalesce((private.ai_setting('lesson_enabled'))::boolean, false),
    'transcribe', v_on and coalesce((private.ai_setting('lesson_enabled'))::boolean, false)
      and coalesce((select value = 'true'::jsonb from public.app_settings where key = 'stt_configured'), false),
    'risk', v_on and coalesce((private.ai_setting('risk_enabled'))::boolean, false),
    'parent_reports', coalesce((private.ai_setting('parent_reports_enabled'))::boolean, false),
    'tutor_messages_left', greatest(0, coalesce((private.ai_setting('tutor_daily_messages'))::int, 30) - v_spent.messages)
  );
end;
$$;
revoke execute on function public.ai_features() from public, anon;
grant execute on function public.ai_features() to authenticated;
