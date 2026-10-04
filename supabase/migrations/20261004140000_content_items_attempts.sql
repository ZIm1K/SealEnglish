-- Content farm: production runs that failed on a passing provider outage since the last approval.
-- The worker re-queues such an item (status back to "approved") until settings.production_attempts
-- is reached; approving in the cabinet starts the count again.
alter table public.content_items
  add column if not exists attempts int not null default 0;
