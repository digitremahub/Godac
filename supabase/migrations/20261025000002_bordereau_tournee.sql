-- Tournée colis : bordereau de tournée DPD importé par photos.
--
-- Le chauffeur photographie les pages du « BORDEREAU DE TOURNEE » remis au
-- départ ; les arrêts sont créés dans la fiche (delivery_stops). On garde
-- ici, pour le rapprochement ultérieur (bordereau ↔ fiche ↔ compte-rendu),
-- le n° de bordereau, les pages lues, les colis et le poids retrouvés face
-- aux totaux imprimés. Une ligne par fiche et par bordereau ; un nouvel
-- import du même bordereau la met à jour.
--
-- Migration ADDITIVE : création de table, d'index et de politique
-- uniquement. Tant qu'elle n'est pas appliquée, l'import fonctionne et
-- n'enregistre simplement pas cette ligne (app/api/colis/arrets/bulk).

create table if not exists delivery_run_bordereaux (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  run_id uuid not null references delivery_runs (id) on delete cascade,
  numero text not null check (char_length(numero) between 1 and 40),
  tour_number text check (tour_number is null or char_length(tour_number) <= 40),
  bordereau_date date,
  pages_read integer[] not null default '{}',
  parcels integer not null default 0 check (parcels >= 0),
  weight_kg numeric(10, 2) not null default 0 check (weight_kg >= 0),
  total_parcels integer check (total_parcels is null or total_parcels >= 0),
  total_weight_kg numeric(10, 2) check (total_weight_kg is null or total_weight_kg >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, numero)
);
create index if not exists delivery_run_bordereaux_org_numero_idx on delivery_run_bordereaux (organization_id, numero);

alter table delivery_run_bordereaux enable row level security;

create policy "delivery_run_bordereaux: through own run or manager-like"
  on delivery_run_bordereaux for all
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
