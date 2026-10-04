-- Content farm: a pack written through the Message Batches API spans several worker runs.
-- state        — where the pack is (stage, batch id, ideas, drafts, cost lines); see content-farm/src/pack.ts
-- locked_until — the run is held by a worker until then, so two overlapping runs don't both advance it
alter table public.content_runs
  add column if not exists state jsonb,
  add column if not exists locked_until timestamptz;
