-- Changement de véhicule (hors dépannage) : photos obligatoires de
-- l'habitacle, du tableau de bord et du tour du véhicule (4 faces), prises
-- par le chauffeur qui récupère le véhicule. Elles datent l'état du
-- véhicule à chaque passage de main pour savoir qui a fait les dégâts.
create type vehicle_change_photo_kind as enum ('habitacle', 'tableau_de_bord', 'avant', 'arriere', 'cote_gauche', 'cote_droit');

create table vehicle_change_photos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  planning_entry_id uuid not null references planning_entries (id) on delete cascade,
  vehicle_id uuid references vehicles (id) on delete set null,
  driver_id uuid references users (id) on delete set null,
  stage text not null check (stage in ('depart', 'retour')),
  kind vehicle_change_photo_kind not null,
  photo_path text not null,
  created_at timestamptz not null default now()
);

create index vehicle_change_photos_vehicle_idx on vehicle_change_photos (vehicle_id, created_at desc);

alter table vehicle_change_photos enable row level security;

create policy "vehicle_change_photos: read within org"
  on vehicle_change_photos for select
  using (organization_id = public.current_organization_id());

create policy "vehicle_change_photos: insert within org"
  on vehicle_change_photos for insert
  with check (organization_id = public.current_organization_id());

-- Dépannage (panne, remorquage) : pas de photos exigées, motif tracé.
alter table planning_entries add column vehicle_change_type text check (vehicle_change_type in ('changement', 'depannage'));
