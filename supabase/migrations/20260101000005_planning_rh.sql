-- GODAC V2 — Phase 2 scope (Modules 5 & 6), tables created now so the
-- schema is stable, UI shipped after the MVP core is live.

create table planning_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  service_id uuid not null references services (id) on delete cascade,
  tour_number text not null,
  driver_id uuid references users (id) on delete set null,
  vehicle_id uuid references vehicles (id) on delete set null,
  start_at timestamptz not null,
  end_at timestamptz,
  status text not null default 'planned',
  created_at timestamptz not null default now(),
  unique (organization_id, service_id, tour_number, start_at)
);

create index planning_entries_org_idx on planning_entries (organization_id);
create index planning_entries_driver_idx on planning_entries (driver_id);
create index planning_entries_vehicle_period_idx on planning_entries (vehicle_id, start_at, end_at);

create table vehicle_interventions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  vehicle_id uuid not null references vehicles (id) on delete cascade,
  type text not null,
  description text,
  status intervention_status not null default 'scheduled',
  scheduled_at timestamptz,
  completed_at timestamptz,
  cost numeric(10, 2),
  created_at timestamptz not null default now()
);

create index vehicle_interventions_vehicle_idx on vehicle_interventions (vehicle_id);

create table fines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  vehicle_id uuid not null references vehicles (id) on delete cascade,
  -- Nullable until the date/planning cross-match below identifies the
  -- responsible driver.
  driver_id uuid references users (id) on delete set null,
  matched_planning_entry_id uuid references planning_entries (id) on delete set null,
  infraction_at timestamptz not null,
  amount numeric(10, 2) not null,
  reference text,
  status fine_status not null default 'pending_identification',
  created_at timestamptz not null default now()
);

create index fines_org_idx on fines (organization_id);
create index fines_vehicle_idx on fines (vehicle_id, infraction_at);

create table leave_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  driver_id uuid not null references users (id) on delete cascade,
  service_id uuid not null references services (id) on delete cascade,
  start_date date not null,
  end_date date not null,
  status leave_status not null default 'pending',
  reason text,
  decided_by uuid references users (id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index leave_requests_service_period_idx on leave_requests (service_id, start_date, end_date);
