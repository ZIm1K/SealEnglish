-- Content farm: trend scans → ideas → generated items (video/text) → per-platform posts.
-- Written by the content-farm worker (service role); admins read and moderate from the cabinet/bot.

create table public.content_runs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,                       -- daily | scan | produce | text
  status text not null default 'running',   -- running | done | failed
  signals jsonb,                            -- raw trend signals
  web_report text,                          -- Claude trend-watcher report
  cost_usd numeric(10,4) not null default 0,
  log text,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table public.content_ideas (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.content_runs(id) on delete set null,
  title text not null,
  format text not null,
  score numeric(5,2) not null default 0,
  data jsonb not null,                      -- full Idea (trend, bridge, audience layers, scores…)
  status text not null default 'new',       -- new | used | rejected
  created_at timestamptz not null default now()
);
create index content_ideas_status_idx on public.content_ideas (status, score desc);

create table public.content_items (
  id uuid primary key default gen_random_uuid(),
  idea_id uuid references public.content_ideas(id) on delete set null,
  kind text not null,                       -- video | text
  status text not null default 'review',    -- review | approved | rejected | scheduled | published | failed
  title text not null,
  script jsonb,                             -- Script (video) or TextPost (text)
  video_path text,                          -- storage path in bucket "content"
  cover_path text,
  image_path text,
  duration_s numeric(6,2),
  cost_usd numeric(10,4) not null default 0,
  cost_breakdown jsonb,
  scheduled_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index content_items_status_idx on public.content_items (status, created_at desc);

create table public.content_posts (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.content_items(id) on delete cascade,
  platform text not null,                   -- tiktok | instagram | threads | telegram
  status text not null default 'pending',   -- pending | posted | failed | skipped
  external_id text,
  url text,
  error text,
  metrics jsonb,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (item_id, platform)
);

alter table public.content_runs enable row level security;
alter table public.content_ideas enable row level security;
alter table public.content_items enable row level security;
alter table public.content_posts enable row level security;

create policy "content_runs: admin read" on public.content_runs for select to authenticated using (public.is_admin());
create policy "content_ideas: admin all" on public.content_ideas for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "content_items: admin all" on public.content_items for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "content_posts: admin read" on public.content_posts for select to authenticated using (public.is_admin());

-- Public bucket: Instagram/Threads publishing APIs fetch media by public URL.
insert into storage.buckets (id, name, public, file_size_limit)
values ('content', 'content', true, 104857600)
on conflict (id) do nothing;

insert into public.app_settings (key, value, is_public)
values ('content_farm', '{}'::jsonb, false)
on conflict (key) do nothing;
