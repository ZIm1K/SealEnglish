-- Content farm packs: every 2 days one pack = 5 items, one per channel.
alter table public.content_items
  add column if not exists pack_id uuid,
  add column if not exists channel text; -- tiktok | stories | threads | telegram | instagram
create index if not exists content_items_pack_idx on public.content_items (pack_id, created_at desc);
