-- Tournée colis : plusieurs listes dans une même tournée (ex. « Liste
-- Amazon », « Liste Chronopost »), renommables et ordonnées. L'ordre de
-- passage est optimisé liste par liste, enchaînées dans leur ordre.
-- Un arrêt sans liste (list_id null) appartient à la liste implicite
-- « Liste principale » : les tournées existantes ne changent pas.
--
-- Historique : camion de la tournée (vehicle_id), renseigné à la création
-- d'après le planning du chauffeur ce jour-là quand il est connu. Pour les
-- tournées plus anciennes, l'historique le retrouve dans planning_entries.
--
-- Migration non destructive : création de table, d'index, de politique et
-- ajout de colonnes nullables uniquement.

create table if not exists delivery_lists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  run_id uuid not null references delivery_runs (id) on delete cascade,
  name text not null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists delivery_lists_run_idx on delivery_lists (run_id, position);

alter table delivery_lists enable row level security;

create policy "delivery_lists: through own run or manager-like"
  on delivery_lists for all
  using (
    organization_id = public.current_organization_id()
    and exists (
      select 1 from delivery_runs r
      where r.id = run_id and (r.driver_id = public.current_app_user_id() or public.is_manager_like())
    )
  )
  with check (
    organization_id = public.current_organization_id()
    and exists (
      select 1 from delivery_runs r
      where r.id = run_id and (r.driver_id = public.current_app_user_id() or public.is_manager_like())
    )
  );

alter table delivery_stops add column if not exists list_id uuid references delivery_lists (id) on delete set null;
create index if not exists delivery_stops_list_idx on delivery_stops (list_id);

alter table delivery_runs add column if not exists vehicle_id uuid references vehicles (id) on delete set null;
