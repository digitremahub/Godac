-- GODAC V2 — centralised alerts (Module 8).
create table alerts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  type alert_type not null,
  severity alert_severity not null default 'warning',
  message text not null,
  related_table text,
  related_id uuid,
  -- Snapshot of who should be emailed, e.g. {"to": ["gerant"], "cc":
  -- ["direction", "comptable"]}. Resolved to real addresses at send
  -- time by lib/email — kept as roles here so recipients stay
  -- correct even if org membership changes after the alert fires.
  recipient_roles user_role[] not null default '{}',
  status alert_status not null default 'open',
  acknowledged_by uuid references users (id),
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create index alerts_org_status_idx on alerts (organization_id, status);
create index alerts_related_idx on alerts (related_table, related_id);
