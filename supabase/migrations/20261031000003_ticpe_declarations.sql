-- TICPE — lot 5 : historique des déclarations et rappels.
--
-- ticpe_declarations : une période marquée « déclarée le … » avec le
--   montant demandé (pour ne pas la compter deux fois dans « argent non
--   réclamé »). Jamais supprimée : annulée (annulee_le) si erreur.
-- ticpe_rappels : journal des rappels déjà envoyés par le cron
--   (échéance de dépôt, ERA de janvier), pour ne pas les répéter.
--   Service role seulement (RLS sans policy).
--
-- ADDITIF : aucun drop, aucun delete.

create table if not exists public.ticpe_declarations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  periode_cle text not null,
  periode_libelle text,
  periode_debut date not null,
  periode_fin date not null,
  regime_tva text not null check (regime_tva in ('mensuel', 'trimestriel', 'annuel_ca12')),
  declaree_le date not null,
  montant numeric(12, 2) not null check (montant >= 0),
  litres numeric(14, 2),
  montant_calcule numeric(12, 2),
  note text,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  annulee_le timestamptz,
  annulee_par uuid references public.users (id) on delete set null,
  check (periode_fin >= periode_debut)
);

create index if not exists ticpe_declarations_org_idx on public.ticpe_declarations (organization_id, periode_debut);

alter table public.ticpe_declarations enable row level security;

create policy "ticpe_declarations: lecture direction, comptable, exploitation"
  on public.ticpe_declarations for select
  using (
    organization_id = public.current_organization_id()
    and (public.is_direction() or public.current_role()::text = 'comptable' or public.is_exploitation())
  );

create policy "ticpe_declarations: direction et comptable ajoutent"
  on public.ticpe_declarations for insert
  with check (
    organization_id = public.current_organization_id()
    and (public.is_direction() or public.current_role()::text = 'comptable')
  );

create policy "ticpe_declarations: direction et comptable annulent"
  on public.ticpe_declarations for update
  using (
    organization_id = public.current_organization_id()
    and (public.is_direction() or public.current_role()::text = 'comptable')
  )
  with check (
    organization_id = public.current_organization_id()
    and (public.is_direction() or public.current_role()::text = 'comptable')
  );

create table if not exists public.ticpe_rappels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null,
  ref text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, kind, ref)
);

alter table public.ticpe_rappels enable row level security;
