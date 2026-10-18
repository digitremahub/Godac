-- Link a parcel-delivery run to the planning assignment that created it.
-- One planning assignment can have at most one parcel run.
alter table public.delivery_runs
  add column if not exists planning_entry_id uuid references public.planning_entries(id) on delete set null;

create unique index if not exists delivery_runs_planning_entry_id_uidx
  on public.delivery_runs (planning_entry_id)
  where planning_entry_id is not null;
