-- GODAC V2 — Lavage (module `washes`, new): a driver logs a wash from
-- the vehicle's QR landing page (/v/[id], see app/(dashboard)/v) —
-- exterior / cabin interior / trailer, with an optional photo. Kept as
-- its own table rather than folded into vehicle_interventions: a wash
-- isn't a problem report or a scheduled maintenance item, it has no
-- status workflow, and its "at least one box checked" constraint is
-- meaningless for that table's shape.

create table vehicle_washes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  vehicle_id uuid not null references vehicles (id) on delete cascade,
  driver_id uuid not null references users (id) on delete restrict,
  washed_exterior boolean not null default false,
  washed_cabin_interior boolean not null default false,
  washed_trailer boolean not null default false,
  photo_path text,
  created_at timestamptz not null default now(),
  check (washed_exterior or washed_cabin_interior or washed_trailer)
);

create index vehicle_washes_organization_id_idx on vehicle_washes (organization_id);
create index vehicle_washes_vehicle_id_idx on vehicle_washes (vehicle_id, created_at desc);

alter table vehicle_washes enable row level security;

-- Any org member can log a wash they performed themselves — reachable
-- from the vehicle QR page, open to the chauffeur role same as the
-- tour start/end flows — but only management-like roles browse the
-- history (the fiche véhicule they'd read it from is itself gated to
-- those roles, see app/(dashboard)/vehicles/[id]/page.tsx).
create policy "vehicle_washes: any member logs own wash"
  on vehicle_washes for insert
  with check (organization_id = public.current_organization_id() and driver_id = public.current_app_user_id());

create policy "vehicle_washes: manager-like reads"
  on vehicle_washes for select
  using (organization_id = public.current_organization_id() and public.is_manager_like());

-- Reuses the existing tour-photos bucket (already a generic
-- "any member uploads/reads within org" bucket, nothing tour-specific
-- in its policies) rather than adding a third near-identical bucket
-- for a single optional photo field.

-- ── module catalog ───────────────────────────────────────────────
-- Placeholder pricing (no real number was specified, same caveat as
-- 20260101000015) — included_from_plan left null and included=false
-- on every plan below, so the module stays off for every existing org
-- (no organization_modules row at all) and for every new signup
-- (app/api/onboarding/create-organization seeds `enabled: included`,
-- which resolves to false here) until an organisation turns it on
-- itself from Admin > Organisation.
insert into modules (key, name, description, wave, is_transverse, base_price, included_from_plan, sort_order) values
  ('washes', 'Lavage', 'Suivi des lavages véhicule (extérieur, cabine, semi-remorque) avec historique par véhicule.', 'v2', false, 19, null, 28);

insert into module_plan_prices (module_key, plan_id, monthly_price, setup_price, included)
select 'washes', p.id, 19, 0, false
from plans p;
