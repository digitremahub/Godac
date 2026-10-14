-- Audit sécurité : journal des actions sensibles (exports TICPE, corrections
-- de rapports et de pleins, annulation de livraison de cuve, changements de
-- rôle / réinitialisation de PIN, code PIN bloqué…). Lecture direction ;
-- écriture côté serveur uniquement. Conservé 3 ans (purge nocturne).
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id uuid references users (id) on delete set null,
  action text not null,
  target_table text,
  target_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_org_idx on audit_log (organization_id, created_at desc);
alter table audit_log enable row level security;
create policy "audit_log: direction reads own org"
  on audit_log for select
  using (organization_id = public.current_organization_id() and public.is_direction());
