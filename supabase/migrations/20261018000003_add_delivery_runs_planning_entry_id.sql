-- Relie une tournée colis à l'affectation Planning qui l'a créée.
-- Idempotent pour les environnements où le champ est déjà présent.
alter table public.delivery_runs
  add column if not exists planning_entry_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'delivery_runs_planning_entry_id_fkey'
      and conrelid = 'public.delivery_runs'::regclass
  ) then
    alter table public.delivery_runs
      add constraint delivery_runs_planning_entry_id_fkey
      foreign key (planning_entry_id)
      references public.planning_entries(id)
      on delete set null;
  end if;
end $$;

create index if not exists delivery_runs_planning_entry_id_idx
  on public.delivery_runs(planning_entry_id)
  where planning_entry_id is not null;

notify pgrst, 'reload schema';
