-- Module « Véhicules loués (loueurs) » — schéma.
--
-- Pour un véhicule loué (location, LLD, crédit-bail), l'entretien est
-- fait par le loueur ou un garage qu'il désigne. Une demande d'entretien
-- (vehicle_interventions, flux chauffeur → gestionnaire existant) sur un
-- tel véhicule ouvre automatiquement une « demande au loueur » à valider
-- par un responsable ; une fois validée, le prestataire est prévenu par
-- e-mail avec un lien sécurisé (jeton à usage limité, haché en base)
-- vers /prestataire/[token], où il répond sans compte GODAC.
-- Migration non destructive : création de tables, colonnes, index,
-- politiques, fonction et déclencheur uniquement.

-- ── Loueurs & prestataires ───────────────────────────────────────
create table if not exists rental_providers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name text not null,
  kind text not null default 'loueur' check (kind in ('loueur', 'garage', 'loueur_entretien')),
  contact_name text,
  -- Adresses qui reçoivent les demandes d'entretien validées.
  maintenance_emails text[] not null default '{}',
  phone text,
  contract_reference text,
  notes text,
  active boolean not null default true,
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rental_providers_org_idx on rental_providers (organization_id);

alter table rental_providers enable row level security;

create policy "rental_providers: manager-like read within org"
  on rental_providers for select
  using (organization_id = public.current_organization_id() and public.is_manager_like());

create policy "rental_providers: manager-like write within org"
  on rental_providers for all
  using (organization_id = public.current_organization_id() and public.is_manager_like())
  with check (organization_id = public.current_organization_id() and public.is_manager_like());

-- ── Véhicules : mode de détention et contrat ─────────────────────
alter table vehicles add column if not exists ownership text not null default 'propre'
  check (ownership in ('propre', 'location', 'credit_bail', 'location_longue_duree'));
alter table vehicles add column if not exists rental_provider_id uuid references rental_providers (id) on delete set null;
alter table vehicles add column if not exists rental_contract_ref text;
alter table vehicles add column if not exists rental_start_date date;
alter table vehicles add column if not exists rental_end_date date;
-- Forfait kilométrique total sur la durée du contrat, et kilométrage
-- compteur au début du contrat (base du calcul au prorata).
alter table vehicles add column if not exists rental_km_allowance integer check (rental_km_allowance is null or rental_km_allowance > 0);
alter table vehicles add column if not exists rental_start_km numeric(10, 1) check (rental_start_km is null or rental_start_km >= 0);
create index if not exists vehicles_rental_provider_idx on vehicles (rental_provider_id) where rental_provider_id is not null;

-- ── Demandes transmises aux loueurs ──────────────────────────────
-- Une ligne par demande d'entretien concernant un véhicule loué. Le
-- statut suit : a_valider → validee → transmise → planifiee → terminee,
-- ou refusee (voir lib/rental/workflow.ts, source de vérité des
-- transitions, testée).
create table if not exists rental_maintenance_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  intervention_id uuid not null unique references vehicle_interventions (id) on delete cascade,
  vehicle_id uuid not null references vehicles (id) on delete cascade,
  provider_id uuid references rental_providers (id) on delete set null,
  status text not null default 'a_valider'
    check (status in ('a_valider', 'validee', 'transmise', 'planifiee', 'terminee', 'refusee')),
  validated_by uuid references users (id) on delete set null,
  validated_at timestamptz,
  refused_by uuid references users (id) on delete set null,
  refused_at timestamptz,
  refusal_reason text,
  transmitted_by uuid references users (id) on delete set null,
  transmitted_at timestamptz,
  transmitted_to text[] not null default '{}',
  provider_accepted_at timestamptz,
  slot_start timestamptz,
  slot_end timestamptz,
  completed_at timestamptz,
  last_provider_comment text,
  invoice_paths text[] not null default '{}',
  -- Lien prestataire : seul le SHA-256 du jeton est stocké, jamais le
  -- jeton lui-même. Un nouveau lien remplace (et révoque) le précédent.
  token_hash text unique,
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rental_requests_org_status_idx on rental_maintenance_requests (organization_id, status);
create index if not exists rental_requests_vehicle_idx on rental_maintenance_requests (vehicle_id);
create index if not exists rental_requests_provider_idx on rental_maintenance_requests (provider_id);

alter table rental_maintenance_requests enable row level security;

create policy "rental_requests: manager-like read within org"
  on rental_maintenance_requests for select
  using (organization_id = public.current_organization_id() and public.is_manager_like());

create policy "rental_requests: manager-like write within org"
  on rental_maintenance_requests for all
  using (organization_id = public.current_organization_id() and public.is_manager_like())
  with check (organization_id = public.current_organization_id() and public.is_manager_like());

-- Historique (qui / quand / quoi) de chaque demande.
create table if not exists rental_request_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  request_id uuid not null references rental_maintenance_requests (id) on delete cascade,
  actor_kind text not null check (actor_kind in ('utilisateur', 'prestataire', 'systeme')),
  actor_user_id uuid references users (id) on delete set null,
  action text not null,
  status_from text,
  status_to text,
  comment text,
  created_at timestamptz not null default now()
);
create index if not exists rental_request_events_request_idx on rental_request_events (request_id, created_at);

alter table rental_request_events enable row level security;

create policy "rental_request_events: manager-like read within org"
  on rental_request_events for select
  using (organization_id = public.current_organization_id() and public.is_manager_like());

create policy "rental_request_events: manager-like insert within org"
  on rental_request_events for insert
  with check (organization_id = public.current_organization_id() and public.is_manager_like());

-- Limitation de débit du lien public /prestataire/[token] : adresse IP
-- hachée uniquement. Aucune politique : accès service-role seul.
create table if not exists rental_provider_access_log (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,
  request_id uuid references rental_maintenance_requests (id) on delete cascade,
  kind text not null check (kind in ('lecture', 'action', 'echec')),
  created_at timestamptz not null default now()
);
create index if not exists rental_provider_access_log_ip_idx on rental_provider_access_log (ip_hash, created_at);
alter table rental_provider_access_log enable row level security;

-- Dédoublonnage des alertes de contrat (cron quotidien) : une alerte
-- par véhicule, par type et par contrat (date de fin) / seuil.
create table if not exists rental_contract_alert_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  vehicle_id uuid not null references vehicles (id) on delete cascade,
  kind text not null,
  ref text not null,
  created_at timestamptz not null default now(),
  unique (vehicle_id, kind, ref)
);
alter table rental_contract_alert_log enable row level security;

-- ── Ouverture automatique de la demande au loueur ────────────────
-- Toute intervention créée (signalement chauffeur ou intervention
-- saisie par un gestionnaire) sur un véhicule loué rattaché à un
-- prestataire, dans une organisation qui a le module, ouvre une
-- demande « à valider ». L'alerte « maintenance_request » existante
-- prévient déjà les responsables ; rien n'est envoyé au prestataire
-- avant validation.
create or replace function public.after_vehicle_intervention_rental()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ownership text;
  v_provider uuid;
  v_request uuid;
begin
  select ownership, rental_provider_id into v_ownership, v_provider from vehicles where id = new.vehicle_id;
  if v_ownership is null or v_ownership = 'propre' or v_provider is null then
    return new;
  end if;
  if not exists (
    select 1 from organization_modules
    where organization_id = new.organization_id and module_key = 'rental_providers' and enabled
  ) then
    return new;
  end if;

  insert into rental_maintenance_requests (organization_id, intervention_id, vehicle_id, provider_id)
  values (new.organization_id, new.id, new.vehicle_id, v_provider)
  on conflict (intervention_id) do nothing
  returning id into v_request;

  if v_request is not null then
    insert into rental_request_events (organization_id, request_id, actor_kind, actor_user_id, action, status_to)
    values (new.organization_id, v_request, 'systeme', new.requested_by, 'creation', 'a_valider');
  end if;

  return new;
end;
$$;

revoke execute on function public.after_vehicle_intervention_rental() from public, anon, authenticated;

create trigger vehicle_interventions_after_insert_rental
  after insert
  on vehicle_interventions
  for each row
  execute function public.after_vehicle_intervention_rental();
