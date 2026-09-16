-- GODAC V2 — core multi-tenant tables.
-- One row in `organizations` == one Clerk Organization == one client company.

create table organizations (
  id uuid primary key default gen_random_uuid(),
  clerk_org_id text not null unique,
  name text not null,
  plan text not null default 'starter',
  ocr_enabled boolean not null default true,
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_status subscription_status not null default 'trialing',
  trial_ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table services (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null,
  code text,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

-- Mirrors Clerk users. One row per (clerk_user_id) globally; a user
-- belongs to exactly one GODAC organization at a time, matching the
-- "one Clerk organisation = one tenant" model.
create table users (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text not null unique,
  organization_id uuid not null references organizations (id) on delete cascade,
  role user_role not null default 'chauffeur',
  full_name text not null,
  email text not null,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index users_organization_id_idx on users (organization_id);

-- A driver/manager can be attached to several services (small
-- structures often run one manager across two agences).
create table user_services (
  user_id uuid not null references users (id) on delete cascade,
  service_id uuid not null references services (id) on delete cascade,
  primary key (user_id, service_id)
);

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  service_id uuid references services (id) on delete set null,
  registration text not null,
  type vehicle_type not null,
  tank_capacity_liters numeric(10, 2),
  status vehicle_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, registration)
);

create index vehicles_organization_id_idx on vehicles (organization_id);
create index vehicles_service_id_idx on vehicles (service_id);

-- A tank is shared by every driver who refuels there — this is the
-- object the totalizer-continuity check (see business logic) is
-- computed against, never a single vehicle's odometer.
create table tanks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  service_id uuid references services (id) on delete set null,
  name text not null,
  fuel_type fuel_type not null default 'diesel',
  capacity_liters numeric(10, 2) not null,
  current_totalizer_index numeric(12, 2) not null default 0,
  last_reading_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tanks_organization_id_idx on tanks (organization_id);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_set_updated_at
  before update on organizations
  for each row execute function set_updated_at();

create trigger users_set_updated_at
  before update on users
  for each row execute function set_updated_at();

create trigger vehicles_set_updated_at
  before update on vehicles
  for each row execute function set_updated_at();

create trigger tanks_set_updated_at
  before update on tanks
  for each row execute function set_updated_at();
