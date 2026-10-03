-- GODAC V2 — fuel entries + PMP history.
--
-- `totalizer_before` / `totalizer_after` are the tank's totalizer
-- index, NOT the vehicle's odometer. Continuity is enforced across
-- *all* drivers sharing a tank (see lib/business/totalizer-gap.ts and
-- the trigger in 20260101000010_business_functions.sql).

create table fuel_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  vehicle_id uuid not null references vehicles (id) on delete restrict,
  driver_id uuid not null references users (id) on delete restrict,
  tank_id uuid not null references tanks (id) on delete restrict,

  occurred_at timestamptz not null default now(),
  totalizer_before numeric(12, 2),
  -- Nullable: a freshly captured OCR ticket (status pending_ocr) has
  -- none of these yet. They become mandatory once the row reaches
  -- 'manual' or 'validated' — see the check constraint below — so a
  -- trusted entry can never be missing the data the PMP/gap trigger
  -- (migration 10) depends on.
  totalizer_after numeric(12, 2),
  liters numeric(10, 2) check (liters is null or liters > 0),
  unit_price numeric(10, 4) check (unit_price is null or unit_price >= 0),
  total_amount numeric(12, 2) generated always as (round(liters * unit_price, 2)) stored,

  station_name text,

  -- OCR pipeline (Module 3). `manual` entries never populate the
  -- ocr_* columns. The original photo stays attached even after
  -- validation, for audit/litige.
  ticket_photo_path text,
  status fuel_entry_status not null default 'manual',
  ocr_raw jsonb,
  ocr_confidence jsonb,
  ocr_error text,

  -- Business-logic derived columns, written by the trigger in
  -- migration 10 — never computed client-side, and never derived
  -- from an unvalidated OCR row.
  pmp_at_entry numeric(10, 4),
  totalizer_gap numeric(12, 2),
  gap_flagged boolean not null default false,

  created_by uuid not null references users (id),
  validated_by uuid references users (id),
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A trusted row (manual entry, or an OCR ticket a human has
  -- validated) must always carry the figures the business logic
  -- needs. Untrusted statuses (pending_ocr / awaiting_validation /
  -- ocr_failed) are allowed to have them null while the pipeline or a
  -- reviewer is still filling them in.
  constraint fuel_entries_trusted_requires_figures check (
    status not in ('manual', 'validated')
    or (liters is not null and unit_price is not null and totalizer_after is not null)
  )
);

create index fuel_entries_org_idx on fuel_entries (organization_id);
create index fuel_entries_tank_occurred_idx on fuel_entries (tank_id, occurred_at);
create index fuel_entries_vehicle_idx on fuel_entries (vehicle_id);
create index fuel_entries_driver_idx on fuel_entries (driver_id);
create index fuel_entries_status_idx on fuel_entries (status) where status in ('pending_ocr', 'awaiting_validation');

create trigger fuel_entries_set_updated_at
  before update on fuel_entries
  for each row execute function set_updated_at();

-- One row per fuel_entries insert, keeping the running PMP (Prix
-- Moyen Pondéré) trail per tank. Populated exclusively by the
-- recompute_pmp() trigger — never written directly by the app.
create table fuel_price_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  tank_id uuid not null references tanks (id) on delete cascade,
  fuel_entry_id uuid not null references fuel_entries (id) on delete cascade,
  unit_price numeric(10, 4) not null,
  liters numeric(10, 2) not null,
  pmp_after numeric(10, 4) not null,
  recorded_at timestamptz not null default now()
);

create index fuel_price_history_tank_idx on fuel_price_history (tank_id, recorded_at);
