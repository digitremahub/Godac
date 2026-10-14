-- Tournées de renfort : une tournée qui part avec des colis pour des
-- villages appartenant à plusieurs autres tournées du même service.
--
-- tour_routes.is_renfort : la fiche est une tournée de renfort. Elle se
-- planifie comme les autres (planning_entries.tour_number par valeur).
--
-- tour_route_renfort_villages : les villages couverts PAR DÉFAUT par une
-- tournée de renfort. Chaque village reste rattaché à sa tournée
-- d'origine (tour_route_villages.route_id) : on ne fait que l'emprunter.
--
-- planning_entry_renfort_villages : pour un passage planifié donné
-- (planning_entries), les villages couverts CE JOUR-LÀ, s'ils diffèrent
-- de la couverture par défaut. Aucune ligne = couverture par défaut.
--
-- Purement additif : une colonne et deux tables, aucune donnée modifiée.

alter table tour_routes
  add column if not exists is_renfort boolean not null default false;

comment on column tour_routes.is_renfort is
  'Tournée de renfort : couvre des villages d''autres tournées (tour_route_renfort_villages, planning_entry_renfort_villages)';

create table if not exists tour_route_renfort_villages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  renfort_route_id uuid not null references tour_routes (id) on delete cascade,
  village_id uuid not null references tour_route_villages (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (renfort_route_id, village_id)
);
create index if not exists tour_route_renfort_villages_village_idx on tour_route_renfort_villages (village_id);

create table if not exists planning_entry_renfort_villages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  planning_entry_id uuid not null references planning_entries (id) on delete cascade,
  village_id uuid not null references tour_route_villages (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (planning_entry_id, village_id)
);
create index if not exists planning_entry_renfort_villages_village_idx on planning_entry_renfort_villages (village_id);

alter table tour_route_renfort_villages enable row level security;
alter table planning_entry_renfort_villages enable row level security;

create policy "tour_route_renfort_villages: members read within org"
  on tour_route_renfort_villages for select
  using (organization_id = public.current_organization_id());
create policy "tour_route_renfort_villages: manager-like write within org"
  on tour_route_renfort_villages for all
  using (organization_id = public.current_organization_id() and public.is_manager_like())
  with check (organization_id = public.current_organization_id() and public.is_manager_like());

create policy "planning_entry_renfort_villages: members read within org"
  on planning_entry_renfort_villages for select
  using (organization_id = public.current_organization_id());
create policy "planning_entry_renfort_villages: manager-like write within org"
  on planning_entry_renfort_villages for all
  using (organization_id = public.current_organization_id() and public.is_manager_like())
  with check (organization_id = public.current_organization_id() and public.is_manager_like());
