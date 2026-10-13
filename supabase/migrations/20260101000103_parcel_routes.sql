-- Module « Tournée colis » : le chauffeur charge ses colis (scan du code,
-- photo de l'étiquette ou saisie), GODAC géocode chaque adresse et
-- calcule l'ordre de passage (lib/colis/optimisation.ts).
--
-- Données personnelles (adresse, nom du destinataire) : visibles du
-- chauffeur et de l'encadrement de l'entreprise seulement, purgées
-- 30 jours après la tournée (/api/cron/retention).

insert into modules (key, name, description, wave, is_transverse, base_price, included_from_plan, sort_order) values
  ('route_optimizer', 'Tournée colis', 'Scan des colis (QR, Datamatrix, code-barres, photo d''étiquette), adresses ajoutées à la tournée et ordre de passage optimisé, navigation arrêt par arrêt.', 'v2', false, 29, null, 31)
on conflict (key) do nothing;

insert into module_plan_prices (module_key, plan_id, monthly_price, setup_price, included)
select 'route_optimizer', p.id, 29, 0, false
from plans p
on conflict do nothing;

create table delivery_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  driver_id uuid not null references users (id) on delete cascade,
  run_date date not null,
  status text not null default 'loading' check (status in ('loading', 'in_progress', 'done')),
  start_label text,
  start_lat numeric(9, 6),
  start_lng numeric(9, 6),
  return_to_start boolean not null default true,
  optimized_at timestamptz,
  created_at timestamptz not null default now(),
  unique (driver_id, run_date)
);
create index delivery_runs_org_date_idx on delivery_runs (organization_id, run_date);

create table delivery_stops (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  run_id uuid not null references delivery_runs (id) on delete cascade,
  position integer not null default 0,
  parcel_code text,
  parcel_count integer not null default 1,
  address text not null,
  lat numeric(9, 6),
  lng numeric(9, 6),
  recipient text,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index delivery_stops_run_idx on delivery_stops (run_id, position);

alter table delivery_runs enable row level security;
alter table delivery_stops enable row level security;

create policy "delivery_runs: own or manager-like"
  on delivery_runs for all
  using (organization_id = public.current_organization_id() and (driver_id = public.current_app_user_id() or public.is_manager_like()))
  with check (organization_id = public.current_organization_id() and (driver_id = public.current_app_user_id() or public.is_manager_like()));

create policy "delivery_stops: through own run or manager-like"
  on delivery_stops for all
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
