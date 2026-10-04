-- Content farm: start production right after the owner acts in the cabinet, instead of waiting
-- for the farm's next scheduled run. The farm-kick Edge Function runs the Cloud Run job.
-- An item the farm itself put back in the queue after a provider outage (attempts > 0) does not
-- kick: retrying at once would hit the same outage, so those wait for the scheduled run.
create or replace function private.kick_content_farm()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status
     and (new.status = 'script_rewrite' or (new.status = 'approved' and new.attempts = 0)) then
    perform private.call_function('farm-kick', jsonb_build_object('item_id', new.id, 'status', new.status));
  end if;
  return new;
end;
$$;

drop trigger if exists content_items_kick on public.content_items;
create trigger content_items_kick
  after update of status on public.content_items
  for each row execute function private.kick_content_farm();
