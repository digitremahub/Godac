-- GODAC V2 — Lot A: fiche véhicule complétée par IA.
--
-- The vehicle form only ever asked for registration/type/tank
-- capacity/km — no brand/model at all, so there was nothing an AI (or
-- a human) could look specs up from. This adds the identification
-- fields plus the specs an AI estimate can fill in, and
-- `spec_sources` to track, per field, where the value came from
-- (`ia` | `saisie` | `import`) and whether a human has confirmed it —
-- the TICPE export (lib/business/ticpe.ts) must never trust an
-- unconfirmed AI-guessed vehicle `type`.
alter table vehicles add column brand text;
alter table vehicles add column model text;
alter table vehicles add column model_year smallint;
alter table vehicles add column gearbox text;
-- Free text ("diesel", "essence", "électrique"...) — deliberately NOT
-- the existing `fuel_type` enum (diesel|adblue), which describes a
-- *tank*/fill-up, not a vehicle's engine. Informational only: never
-- read by the TICPE/PMP/totalizer business logic.
alter table vehicles add column fuel_type text;
alter table vehicles add column ptac_kg numeric(10, 0);
alter table vehicles add column reference_consumption_l_100km numeric(5, 1);
alter table vehicles add column adblue_capacity_liters numeric(10, 2);
-- Shape: { "<field>": { "origin": "ia"|"saisie"|"import", "confirmed": boolean } }
alter table vehicles add column spec_sources jsonb not null default '{}'::jsonb;

-- Rate-limit log for POST /api/vehicles/ai-specs — 30 calls/org/hour
-- per spec. No personal data beyond who-called-when (brand/model
-- strings sent to the AI are never stored here). Read via the normal
-- RLS-scoped client from the route (manager-like only ever call it),
-- written the same way — no admin client needed since every row a
-- caller can insert is already scoped to their own org by the policy.
create table ai_spec_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index ai_spec_requests_org_created_idx on ai_spec_requests (organization_id, created_at);

alter table ai_spec_requests enable row level security;

create policy "ai_spec_requests: manager-like read within org"
  on ai_spec_requests for select
  using (organization_id = public.current_organization_id() and public.is_manager_like());

create policy "ai_spec_requests: manager-like inserts own"
  on ai_spec_requests for insert
  with check (
    organization_id = public.current_organization_id()
    and user_id = public.current_app_user_id()
    and public.is_manager_like()
  );
