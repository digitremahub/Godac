-- Team leader per service, and the villages served by each tour.
--
-- services.team_leader_*: the chef d'équipe a service's drivers report
-- to — shown on each driver's dashboard for every service they belong
-- to (user_services). Free text on purpose: the team leader is not
-- always a GODAC user.
--
-- tour_routes: one reference sheet per tour number (e.g. T106), not
-- per day — planning_entries.tour_number points at it by value.
-- tour_route_villages: its ordered villages, each with practical
-- notes (access, delivery hours, gate codes, local contact…).
-- Everyone in the organisation reads them; manager-like roles
-- (direction, chefs d'équipe) write them.

alter table services
  add column if not exists team_leader_name text,
  add column if not exists team_leader_phone text,
  add column if not exists team_leader_email text;

create table tour_routes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  service_id uuid references services (id) on delete set null,
  tour_number text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, tour_number)
);

create table tour_route_villages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  route_id uuid not null references tour_routes (id) on delete cascade,
  position integer not null default 0,
  name text not null,
  postal_code text,
  notes text,
  created_at timestamptz not null default now()
);
create index tour_route_villages_route_idx on tour_route_villages (route_id, position);

alter table tour_routes enable row level security;
alter table tour_route_villages enable row level security;

create policy "tour_routes: members read within org"
  on tour_routes for select
  using (organization_id = public.current_organization_id());
create policy "tour_routes: manager-like write within org"
  on tour_routes for all
  using (organization_id = public.current_organization_id() and public.is_manager_like())
  with check (organization_id = public.current_organization_id() and public.is_manager_like());

create policy "tour_route_villages: members read within org"
  on tour_route_villages for select
  using (organization_id = public.current_organization_id());
create policy "tour_route_villages: manager-like write within org"
  on tour_route_villages for all
  using (organization_id = public.current_organization_id() and public.is_manager_like())
  with check (organization_id = public.current_organization_id() and public.is_manager_like());
