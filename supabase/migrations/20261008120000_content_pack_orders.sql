-- Content farm: a pack is ordered from the cabinet («Згенерувати ідеї») instead of every other morning.
-- The admin inserts a run with status 'requested' and request = {"channels": ["tiktok", …], "topic": "…"}
-- (which materials to write and an optional wish); the farm's next `work` run writes that pack.
-- The insert starts the job at once through farm-kick; the hourly `work` schedule is the safety net.
alter table public.content_runs
  add column if not exists request jsonb;

drop policy if exists "content_runs: admin orders a pack" on public.content_runs;
create policy "content_runs: admin orders a pack" on public.content_runs
  for insert to authenticated
  with check (public.is_admin() and kind = 'pack' and status = 'requested');

create or replace function private.kick_content_farm_run()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.call_function('farm-kick', jsonb_build_object('run_id', new.id, 'status', new.status));
  return new;
end;
$$;

drop trigger if exists content_runs_kick on public.content_runs;
create trigger content_runs_kick
  after insert on public.content_runs
  for each row when (new.status = 'requested')
  execute function private.kick_content_farm_run();
