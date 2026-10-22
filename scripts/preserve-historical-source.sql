-- Compatibility guard: older clients and backups do not know this protected field.
-- Keep the existing concurrency version and timestamp behavior.
create or replace function public.update_shtab_workspace_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.data->'cumulativeFlightSource' is not null
     and old.data->'cumulativeFlightSource' <> 'null'::jsonb
     and (new.data->'cumulativeFlightSource' is null or new.data->'cumulativeFlightSource' = 'null'::jsonb) then
    new.data := pg_catalog.jsonb_set(new.data, '{cumulativeFlightSource}', old.data->'cumulativeFlightSource', true);
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;
