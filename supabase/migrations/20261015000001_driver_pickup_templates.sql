-- Ramasses habituelles par chauffeur et suivi des colis réellement collectés.
alter table delivery_stops add column if not exists packages_picked_up smallint;
alter table delivery_stops add column if not exists exceptional_pickup boolean not null default false;

create table if not exists driver_pickup_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  driver_id uuid not null references users(id) on delete cascade,
  address text not null,
  recipient text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (driver_id, address)
);
alter table driver_pickup_templates enable row level security;
create policy "driver_pickup_templates_select_own" on driver_pickup_templates
  for select using (driver_id = auth.uid());
create policy "driver_pickup_templates_insert_own" on driver_pickup_templates
  for insert with check (driver_id = auth.uid());
create policy "driver_pickup_templates_update_own" on driver_pickup_templates
  for update using (driver_id = auth.uid()) with check (driver_id = auth.uid());
create policy "driver_pickup_templates_delete_own" on driver_pickup_templates
  for delete using (driver_id = auth.uid());
