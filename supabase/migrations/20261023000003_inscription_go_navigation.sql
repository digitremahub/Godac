-- Inscription GO Navigation sur invitation (décision client du 20/10/2026).
--
-- Des personnes extérieures testent GO Navigation (navigation chauffeur avec
-- la Tournée colis intégrée) via un lien unique généré par le staff GODAC
-- (/godac-staff/go-navigation). Le lien crée une organisation d'essai
-- limitée : 30 jours, Tournée colis seule, plafonds stricts.
--
-- ADDITIVE et idempotente : créations « if not exists », insertions
-- « on conflict do nothing », aucune suppression, aucun drop.
--  1. organizations.offre : marqueur d'offre ('go_navigation' ; null = offre
--     classique). Le plan (`plans`, enum plan_tier) n'est pas touché : ajouter
--     une valeur d'enum n'est pas utilisable dans la même transaction. Passer
--     un compte sur une vraie offre = remettre offre à null, choisir le plan
--     et l'abonnement ; aucune donnée n'est perdue.
--  2. go_navigation_invitations : jetons hachés (SHA-256), usage unique,
--     expiration, note libre, révocation. RLS sans policy : service role
--     uniquement.
--  3. go_navigation_access_log : limitation de débit de la page publique
--     (IP hachée). RLS sans policy : service role uniquement.
--  4. Fonction de quota « route_optimization » (optimisation de tournée,
--     app/api/colis/optimiser) : prix 0 €, volume large pour les formules
--     classiques (aucun changement pour les clients existants).
--  5. usage_quota_overrides : plafond mensuel propre à une organisation,
--     prioritaire sur la formule et sans dépassement facturé. RLS sans
--     policy : lu par le serveur (client service) uniquement.
--  6. inscrire_go_navigation() : création atomique (une transaction) de
--     l'organisation, des modules, du service, du profil, des plafonds et
--     rattachement de l'invitation. Exécutable par le service role seul.

-- ── 1. Marqueur d'offre ─────────────────────────────────────────────
alter table public.organizations add column if not exists offre text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_offre_valide' and conrelid = 'public.organizations'::regclass) then
    alter table public.organizations add constraint organizations_offre_valide check (offre is null or offre in ('go_navigation'));
  end if;
end $$;

comment on column public.organizations.offre is
  'Offre particulière : go_navigation = essai GO Navigation sur invitation (menu réduit, plafonds stricts, bloqué à la fin de l''essai). Null = offre classique.';

-- ── 2. Invitations ──────────────────────────────────────────────────
create table if not exists public.go_navigation_invitations (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  note text check (note is null or char_length(note) <= 200),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by_email text not null,
  -- Réservation au moment de l'inscription (mise à jour conditionnelle),
  -- puis rattachement définitif par inscrire_go_navigation().
  used_at timestamptz,
  used_by_user_id uuid references auth.users (id) on delete set null,
  organization_id uuid references public.organizations (id) on delete set null,
  revoked_at timestamptz,
  revoked_by_email text
);

create index if not exists go_navigation_invitations_created_idx on public.go_navigation_invitations (created_at desc);

alter table public.go_navigation_invitations enable row level security;

-- ── 3. Journal de la page publique (limitation de débit) ───────────
create table if not exists public.go_navigation_access_log (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,
  kind text not null check (kind in ('echec', 'tentative')),
  created_at timestamptz not null default now()
);

create index if not exists go_navigation_access_log_ip_idx on public.go_navigation_access_log (ip_hash, kind, created_at);

alter table public.go_navigation_access_log enable row level security;

-- ── 4. Quota « optimisation de tournée » ───────────────────────────
insert into public.usage_prices (feature, label, unit_label, unit_price_eur, sort_order) values
  ('route_optimization', 'Optimisation des tournées colis', 'calcul', 0, 12)
on conflict (feature) do nothing;

insert into public.usage_quotas (plan_id, feature, included_per_month, daily_cap)
select q.plan_id::plan_tier, 'route_optimization', 100000, 5000
from (values ('essentiel'), ('starter'), ('pro'), ('business')) as q (plan_id)
on conflict (plan_id, feature) do nothing;

-- ── 5. Plafonds propres à une organisation ─────────────────────────
create table if not exists public.usage_quota_overrides (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  feature text not null references public.usage_prices (feature),
  included_per_month integer not null check (included_per_month >= 0),
  daily_cap integer not null check (daily_cap > 0),
  created_at timestamptz not null default now(),
  primary key (organization_id, feature)
);

alter table public.usage_quota_overrides enable row level security;

-- ── 6. Création atomique du compte d'essai ─────────────────────────
create or replace function public.inscrire_go_navigation(
  p_invitation_id uuid,
  p_user_id uuid,
  p_email text,
  p_full_name text,
  p_org_name text,
  p_trial_ends_at timestamptz,
  p_modules text[],
  p_service_name text,
  p_quotas jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_service uuid;
begin
  -- L'invitation doit avoir été réservée (used_at) et pas encore rattachée.
  perform 1 from go_navigation_invitations
   where id = p_invitation_id and used_at is not null and used_by_user_id is null and organization_id is null and revoked_at is null
   for update;
  if not found then
    raise exception 'invitation_indisponible' using errcode = 'P0001';
  end if;

  insert into organizations (name, country, offre, subscription_status, trial_ends_at, usage_overage_enabled, auto_clock_enabled)
  values (p_org_name, 'FR', 'go_navigation', 'trialing', p_trial_ends_at, false, false)
  returning id into v_org;

  insert into organization_modules (organization_id, module_key, enabled, pricing_mode, effective_monthly_price)
  select v_org, m.key, true, 'included', 0
  from modules m
  where m.key = any (p_modules)
  on conflict (organization_id, module_key) do update set enabled = true;

  insert into services (organization_id, name) values (v_org, p_service_name)
  returning id into v_service;

  insert into users (id, organization_id, role, full_name, email, can_drive)
  values (p_user_id, v_org, 'manager', p_full_name, p_email, true);

  insert into user_services (user_id, service_id) values (p_user_id, v_service);

  insert into usage_quota_overrides (organization_id, feature, included_per_month, daily_cap)
  select v_org, q.feature, q.included_per_month, q.daily_cap
  from jsonb_to_recordset(coalesce(p_quotas, '[]'::jsonb)) as q (feature text, included_per_month integer, daily_cap integer)
  on conflict (organization_id, feature) do nothing;

  update go_navigation_invitations
     set used_by_user_id = p_user_id, organization_id = v_org
   where id = p_invitation_id;

  return v_org;
end;
$$;

revoke all on function public.inscrire_go_navigation(uuid, uuid, text, text, text, timestamptz, text[], text, jsonb) from public, anon, authenticated;
grant execute on function public.inscrire_go_navigation(uuid, uuid, text, text, text, timestamptz, text[], text, jsonb) to service_role;
