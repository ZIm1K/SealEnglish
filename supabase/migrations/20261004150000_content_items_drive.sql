-- Content farm: finished videos live on the owner's Google Drive (they would fill the Supabase
-- bucket within weeks). drive_file_id is the Drive file; video_path stays for older items and as
-- the fallback when Drive is unavailable.
alter table public.content_items
  add column if not exists drive_file_id text;
