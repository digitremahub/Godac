-- Dédoublonnage des actions rejouées par la file hors ligne : l'identifiant
-- de l'action (en-tête X-GODAC-Offline-Action) est réservé avant exécution
-- (lib/offline/idempotence-serveur.ts). Additif, idempotent. Accès réservé
-- au service (RLS activée, aucune politique).
create table if not exists public.offline_actions (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists offline_actions_created_at_idx on public.offline_actions (created_at);
alter table public.offline_actions enable row level security;
