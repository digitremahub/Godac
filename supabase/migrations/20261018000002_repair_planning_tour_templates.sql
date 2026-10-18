-- Répare le schéma des modèles de tournées si la migration initiale
-- n'a pas été appliquée sur un environnement ou si la table a été supprimée.
-- Cette migration est volontairement idempotente.
create table if not exists public.planning_tour_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  route_id uuid not null references public.tour_routes(id) on delete cascade,
  name text not null,
  departure_time time not null default '07:00',
  weekdays smallint[] not null default array[1,2,3,4,5]::smallint[],
  default_vehicle_id uuid references public.vehicles(id) on delete set null,
  active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint planning_tour_templates_weekdays_check
    check (weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  constraint planning_tour_templates_name_unique
    unique (organization_id, service_id, name)
);

create index if not exists planning_tour_templates_service_idx
  on public.planning_tour_templates(organization_id, service_id, active);

alter table public.planning_tour_templates enable row level security;

drop policy if exists "planning_tour_templates: members read within org"
  on public.planning_tour_templates;
create policy "planning_tour_templates: members read within org"
  on public.planning_tour_templates for select
  using (organization_id = public.current_organization_id());

drop policy if exists "planning_tour_templates: manager-like write within org"
  on public.planning_tour_templates;
create policy "planning_tour_templates: manager-like write within org"
  on public.planning_tour_templates for all
  using (
    organization_id = public.current_organization_id()
    and public.is_manager_like()
  )
  with check (
    organization_id = public.current_organization_id()
    and public.is_manager_like()
  );

drop trigger if exists planning_tour_templates_set_updated_at
  on public.planning_tour_templates;
create trigger planning_tour_templates_set_updated_at
  before update on public.planning_tour_templates
  for each row execute function public.set_updated_at();

notify pgrst, 'reload schema';
