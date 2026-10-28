-- Fin de contrat : suppression des données 3 mois après la fin, avec préavis
-- à 60 jours (30 jours avant la suppression) et blocage en cas de litige.
-- Additive et idempotente : rien n'est supprimé par cette migration.
-- Code : lib/fin-contrat (règles pures, tests), app/api/cron/fin-contrat
-- (quotidien, protégé par CRON_SECRET, DRY-RUN tant que
-- FIN_CONTRAT_PURGE_ACTIVE n'est pas « true »), docs/garde-fous-techniques.md.

-- 1. État de fin de contrat sur l'organisation.
alter table public.organizations
  add column if not exists contrat_termine_le timestamptz,
  add column if not exists suppression_preavis_envoye_le timestamptz,
  add column if not exists suppression_bloquee boolean not null default false,
  add column if not exists suppression_bloquee_motif text,
  add column if not exists suppression_bloquee_le timestamptz,
  add column if not exists suppression_bloquee_par text;

comment on column public.organizations.contrat_termine_le is 'Date de fin du contrat (abonnement Stripe terminé, ou fixée par GODAC). Point de départ du préavis (+60 j) et de la suppression (+90 j).';
comment on column public.organizations.suppression_preavis_envoye_le is 'Date d''envoi du préavis de suppression au contact de l''organisation. La suppression a lieu au plus tôt 30 jours après.';
comment on column public.organizations.suppression_bloquee is 'Posé par la direction GODAC en cas de litige déclaré : aucune suppression ni préavis tant que vrai.';

-- Ces colonnes ne se modifient que côté serveur (clé de service) : ni la
-- direction d'une entreprise cliente ni un autre rôle ne peuvent lever le blocage
-- ni déplacer la date de fin (la policy « direction can update their own org »
-- laisserait sinon passer).
create or replace function public.organizations_guard_fin_contrat()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if coalesce(auth.role(), '') not in ('anon', 'authenticated') then
    return new;
  end if;
  if new.contrat_termine_le is distinct from old.contrat_termine_le
     or new.suppression_preavis_envoye_le is distinct from old.suppression_preavis_envoye_le
     or new.suppression_bloquee is distinct from old.suppression_bloquee
     or new.suppression_bloquee_motif is distinct from old.suppression_bloquee_motif
     or new.suppression_bloquee_le is distinct from old.suppression_bloquee_le
     or new.suppression_bloquee_par is distinct from old.suppression_bloquee_par then
    raise exception 'La fin de contrat et le blocage de suppression ne se modifient que par GODAC.'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists organizations_guard_fin_contrat on public.organizations;
create trigger organizations_guard_fin_contrat
  before update on public.organizations
  for each row execute function public.organizations_guard_fin_contrat();

-- 2. Conservation du strict nécessaire pour GODAC après la suppression :
--    identité de facturation et identifiants Stripe (les factures elles-mêmes
--    restent chez Stripe), dates de contrat, preuves d'acceptation / de
--    consentement et traces du préavis (copie minimale du journal d'audit).
--    Aucun contenu métier : ni salarié, ni pointage, ni tournée, ni fichier.
create table if not exists public.organisations_supprimees (
  id uuid primary key,
  nom text not null,
  identite jsonb not null default '{}'::jsonb,
  stripe_customer_id text,
  stripe_subscription_id text,
  subscription_status text,
  plan text,
  cree_le timestamptz,
  contrat_termine_le timestamptz,
  preavis_envoye_le timestamptz,
  supprimee_le timestamptz not null default now(),
  auth_utilisateurs_restants uuid[] not null default '{}'::uuid[]
);

create table if not exists public.organisations_supprimees_journal (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations_supprimees (id) on delete cascade,
  action text not null,
  details jsonb,
  cree_le timestamptz not null
);
create index if not exists organisations_supprimees_journal_org_idx on public.organisations_supprimees_journal (organisation_id, cree_le);

-- Accès réservé à la clé de service (aucune policy : RLS actif = tout refusé aux autres rôles).
alter table public.organisations_supprimees enable row level security;
alter table public.organisations_supprimees_journal enable row level security;

-- 3. Suppression atomique d'une organisation dont le contrat est terminé.
--    Les garde-fous sont revérifiés ici, dans la même transaction que la
--    suppression, même si le code applicatif les a déjà contrôlés :
--    jamais de démo, jamais sous blocage, jamais avant 90 jours après la fin,
--    jamais sans préavis envoyé depuis au moins 30 jours, jamais avec un
--    abonnement vivant. Renvoie les identifiants des comptes de connexion à
--    supprimer ensuite côté API d'authentification (le code les retire un par un).
--    Les fichiers du stockage sont effacés par le code AVANT cet appel.
create or replace function public.supprimer_organisation_fin_contrat(p_org uuid, p_actions_conservees text[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  o public.organizations%rowtype;
  v_users uuid[];
  v_json jsonb;
begin
  select * into o from public.organizations where id = p_org for update;
  if not found then
    raise exception 'organisation_introuvable' using errcode = 'P0002';
  end if;
  v_json := to_jsonb(o);

  if o.is_demo then raise exception 'organisation_demo' using errcode = 'P0001'; end if;
  if o.suppression_bloquee then raise exception 'suppression_bloquee' using errcode = 'P0001'; end if;
  if o.contrat_termine_le is null or o.contrat_termine_le > now() - interval '90 days' then
    raise exception 'delai_90_jours_non_ecoule' using errcode = 'P0001';
  end if;
  if o.suppression_preavis_envoye_le is null
     or o.suppression_preavis_envoye_le < o.contrat_termine_le
     or o.suppression_preavis_envoye_le > now() - interval '30 days' then
    raise exception 'preavis_30_jours_non_ecoule' using errcode = 'P0001';
  end if;
  if o.stripe_subscription_id is not null and o.subscription_status::text in ('active', 'past_due', 'trialing', 'incomplete') then
    raise exception 'abonnement_vivant' using errcode = 'P0001';
  end if;

  select coalesce(array_agg(id), '{}'::uuid[]) into v_users from public.users where organization_id = p_org;

  insert into public.organisations_supprimees
    (id, nom, identite, stripe_customer_id, stripe_subscription_id, subscription_status, plan, cree_le,
     contrat_termine_le, preavis_envoye_le, auth_utilisateurs_restants)
  values
    (o.id, o.name,
     jsonb_strip_nulls(jsonb_build_object(
       'pays', v_json -> 'country', 'siret', v_json -> 'siret', 'siren', v_json -> 'siren',
       'raison_sociale', v_json -> 'legal_name', 'adresse', v_json -> 'legal_address', 'offre', v_json -> 'offre')),
     o.stripe_customer_id, o.stripe_subscription_id, o.subscription_status::text, o.plan, o.created_at,
     o.contrat_termine_le, o.suppression_preavis_envoye_le, v_users);

  -- Preuves d'acceptation / de consentement et traces du préavis (liste fournie par le code).
  insert into public.organisations_supprimees_journal (organisation_id, action, details, cree_le)
    select p_org, a.action, a.details, a.created_at
    from public.audit_log a
    where a.organization_id = p_org and a.action = any (p_actions_conservees);
  insert into public.organisations_supprimees_journal (organisation_id, action, details, cree_le)
    values (p_org, 'fin_contrat_suppression', jsonb_build_object('comptes_utilisateurs', coalesce(array_length(v_users, 1), 0)), now());

  -- Tables dont les clés étrangères vers les utilisateurs, véhicules ou cuves
  -- sont en ON DELETE RESTRICT : à vider avant l'organisation (comme le démontage de la démo).
  delete from public.fuel_gap_reviews where organization_id = p_org;
  delete from public.fuel_entries where organization_id = p_org;
  delete from public.vehicle_washes where organization_id = p_org;
  delete from public.ticpe_exports where organization_id = p_org;

  -- Le reste suit en cascade (toutes les clés étrangères vers organizations sont en CASCADE ou SET NULL).
  delete from public.organizations where id = p_org;

  return jsonb_build_object('utilisateurs', to_jsonb(v_users));
end;
$function$;

revoke all on function public.supprimer_organisation_fin_contrat(uuid, text[]) from public, anon, authenticated;
grant execute on function public.supprimer_organisation_fin_contrat(uuid, text[]) to service_role;

-- 4. Organisations dont l'abonnement est déjà annulé avant cette migration :
--    on ne connaît pas la date réelle de fin ; le délai de 90 jours part de
--    l'application de la migration (choix prudent : jamais de suppression
--    anticipée). Les futures annulations renseignent la date par le webhook Stripe.
update public.organizations
   set contrat_termine_le = now()
 where subscription_status::text = 'canceled'
   and contrat_termine_le is null
   and coalesce(is_demo, false) = false;
