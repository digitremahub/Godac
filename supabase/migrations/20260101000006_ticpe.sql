-- GODAC V2 — TICPE exports (Module 7). Strict business rule: TICPE
-- never applies to VL, only PL/SPL. Enforced in lib/business/ticpe.ts
-- and mirrored here for audit trail of what was actually exported.

create table ticpe_exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  generated_by uuid not null references users (id),
  file_path text not null,
  vehicle_count integer not null,
  total_liters numeric(12, 2) not null,
  created_at timestamptz not null default now()
);

create index ticpe_exports_org_idx on ticpe_exports (organization_id);
