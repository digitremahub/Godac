-- Ramasses habituelles : mémorisées par chauffeur et réintégrées à chaque nouvelle tournée.
create table if not exists driver_pickup_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  driver_id uuid not null references users(id) on delete cascade,
  address text not null check (char_length(trim(address)) between 5 and 300),
  recipient text,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, driver_id, address)
);

create index if not exists driver_pickup_templates_driver_idx
  on driver_pickup_templates (organization_id, driver_id, active);

alter table driver_pickup_templates enable row level security;

drop policy if exists driver_pickup_templates_select_own on driver_pickup_templates;
create policy driver_pickup_templates_select_own on driver_pickup_templates
  for select to authenticated
  using (organization_id = (select u.organization_id from users u where u.id = auth.uid()));

drop policy if exists driver_pickup_templates_insert_own on driver_pickup_templates;
create policy driver_pickup_templates_insert_own on driver_pickup_templates
  for insert to authenticated
  with check (
    driver_id = auth.uid()
    and organization_id = (select u.organization_id from users u where u.id = auth.uid())
  );

drop policy if exists driver_pickup_templates_update_own on driver_pickup_templates;
create policy driver_pickup_templates_update_own on driver_pickup_templates
  for update to authenticated
  using (driver_id = auth.uid() and organization_id = (select u.organization_id from users u where u.id = auth.uid()))
  with check (driver_id = auth.uid() and organization_id = (select u.organization_id from users u where u.id = auth.uid()));

alter table delivery_stops add column if not exists exceptional_pickup boolean not null default false;
