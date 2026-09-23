-- Seal English — storage buckets & policies
--   materials:  <owner_uid>/<uuid>-<file>
--   homework:   t/<teacher_uid>/<uuid>-<file>              (assignment attachments)
--               s/<student_uid>/<assignment_id>/<uuid>-<file> (student answers)
--   avatars:    <uid>/<file> (public)

-- anon has no EXECUTE on is_admin(): keep public settings policy free of helper calls.
drop policy "app_settings: public read" on public.app_settings;
create policy "app_settings: public read" on public.app_settings for select to anon, authenticated
using (is_public);
create policy "app_settings: admin read" on public.app_settings for select to authenticated
using (public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('materials', 'materials', false, 52428800),
  ('homework', 'homework', false, 26214400),
  ('avatars', 'avatars', true, 2097152)
on conflict (id) do nothing;

-- materials
create policy "materials bucket: read" on storage.objects for select to authenticated
using (
  bucket_id = 'materials' and (
    public.is_staff() or public.is_teacher()
    or exists (select 1 from public.materials m where m.storage_path = objects.name and public.can_view_material(m.id))
  )
);
create policy "materials bucket: upload" on storage.objects for insert to authenticated
with check (
  bucket_id = 'materials'
  and (public.is_staff() or public.is_teacher())
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
create policy "materials bucket: delete" on storage.objects for delete to authenticated
using (
  bucket_id = 'materials'
  and (public.is_staff() or (storage.foldername(name))[1] = (select auth.uid())::text)
);

-- homework
create policy "homework bucket: read" on storage.objects for select to authenticated
using (
  bucket_id = 'homework' and (
    public.is_staff()
    or (storage.foldername(name))[2] = (select auth.uid())::text
    or (
      (storage.foldername(name))[1] = 's'
      and public.teaches_assignment(((storage.foldername(name))[3])::uuid)
    )
    or (
      (storage.foldername(name))[1] = 't'
      and exists (
        select 1 from public.assignments a
        where a.attachments @> jsonb_build_array(jsonb_build_object('path', objects.name))
          and public.can_view_assignment(a.id)
      )
    )
  )
);
create policy "homework bucket: teacher upload" on storage.objects for insert to authenticated
with check (
  bucket_id = 'homework'
  and (storage.foldername(name))[1] = 't'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and (public.is_staff() or public.is_teacher())
);
create policy "homework bucket: student upload" on storage.objects for insert to authenticated
with check (
  bucket_id = 'homework'
  and (storage.foldername(name))[1] = 's'
  and (storage.foldername(name))[2] = (select auth.uid())::text
  and public.can_view_assignment(((storage.foldername(name))[3])::uuid)
);
create policy "homework bucket: delete own" on storage.objects for delete to authenticated
using (
  bucket_id = 'homework'
  and ((storage.foldername(name))[2] = (select auth.uid())::text or public.is_staff())
);

-- avatars
create policy "avatars bucket: public read" on storage.objects for select to anon, authenticated
using (bucket_id = 'avatars');
create policy "avatars bucket: own upload" on storage.objects for insert to authenticated
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars bucket: own update" on storage.objects for update to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars bucket: own delete" on storage.objects for delete to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
