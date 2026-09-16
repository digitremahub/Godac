-- GODAC V2 — data-driven module catalog & plan pricing grid.
--
-- Replaces a hardcoded-in-code module list with real tables so a new
-- module, a price change, or a plan's inclusion list never requires a
-- redeploy — exactly the "personnalisation = données, pas du code"
-- requirement. `organization_modules` is what actually drives which
-- menus/features a given organisation sees; everything else here is
-- catalog/pricing data feeding it.
--
-- Prices below are indicative placeholders (no real pricing was
-- specified) — edit `module_plan_prices` directly to adjust, no code
-- change needed. See README "Intégrations non branchées" for the
-- same caveat spelled out for whoever owns pricing decisions.

create type plan_tier as enum ('essentiel', 'starter', 'pro', 'business');
create type module_wave as enum ('v1', 'v2', 'v3');
create type module_pricing_mode as enum ('included', 'a_la_carte');

create table plans (
  id plan_tier primary key,
  name text not null,
  monthly_base_price numeric(10, 2) not null,
  setup_price numeric(10, 2) not null default 0,
  sort_order smallint not null unique,
  created_at timestamptz not null default now()
);

insert into plans (id, name, monthly_base_price, setup_price, sort_order) values
  ('essentiel', 'Essentiel', 49, 0, 1),
  ('starter', 'Starter', 99, 150, 2),
  ('pro', 'Pro', 199, 300, 3),
  ('business', 'Business', 349, 500, 4);

-- `included_from_plan` = the cheapest plan tier that bundles this
-- module for free; null means it's never bundled (either a pure
-- à-la-carte add-on, or — for the marketplace modules — priced by
-- commission tier rather than a flat fee at all, see
-- organization_modules.pricing_mode).
create table modules (
  key text primary key,
  name text not null,
  description text not null,
  wave module_wave not null,
  is_transverse boolean not null default false,
  base_price numeric(10, 2) not null default 0,
  included_from_plan plan_tier references plans (id),
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);

insert into modules (key, name, description, wave, is_transverse, base_price, included_from_plan, sort_order) values
  -- Vague V1 — cœur du produit
  ('fuel_tracking', 'Suivi Carburant', 'Déclaration de ravitaillement, PMP automatique, surveillance des cuves, alertes anomalies.', 'v1', false, 0, 'essentiel', 1),
  ('ocr', 'OCR tickets carburant', 'Capture photo, extraction automatique Mindee, validation humaine obligatoire.', 'v1', false, 39, 'starter', 2),
  ('employee_files', 'Dossiers Employés', 'Fiches individuelles, documents, contrats, accès restreint par rôle.', 'v1', false, 25, 'starter', 3),
  ('payslips', 'Fiches de Paie', 'Génération de bulletins de paie avec règles TRM natives.', 'v1', false, 35, 'pro', 4),
  ('leave_management', 'Congés & Absences', 'Demandes de congés, validation managériale, détection de chevauchement.', 'v1', false, 19, 'pro', 5),
  ('hr_status', 'Statuts RH Automatiques', 'Statut employé déduit automatiquement des autres modules (congés, arrêts...).', 'v1', false, 15, 'pro', 6),
  ('planning', 'Planning par Service', 'Plannings par pôle métier, tournées numérotées, vue consolidée direction.', 'v1', false, 25, 'pro', 7),
  ('intranet', 'Intranet & Convocations', 'Notes de service, convocations, statut lu/non lu.', 'v1', false, 15, 'business', 8),
  -- Vague V2 — upsell
  ('fuel_station_prices', 'Carte Prix Stations', 'Carte interactive des prix carburant (API PrixCarburants.gouv.fr).', 'v2', false, 0, 'essentiel', 9),
  ('maintenance_requests', 'Demandes d''Entretien', 'Flux chauffeur → gestionnaire avec niveaux d''urgence et assistant IA.', 'v2', false, 19, 'pro', 10),
  ('freight_return_trips', 'Retours à Vide', 'Marketplace de capacité véhicule disponible sur trajet retour.', 'v2', false, 0, null, 11),
  ('subcontract_requests', 'Bourse Sous-Traitance', 'Mise en relation donneur d''ordre / transporteurs du réseau GODAC.', 'v2', false, 0, null, 12),
  ('messenger', 'GODAC Messenger', 'Messagerie interne RGPD, coupure d''accès automatique à la désactivation.', 'v2', false, 29, null, 13),
  ('hr_status_v2', 'Statuts RH V2 Avancé', 'Workflow CPAM, déclarations AT automatisées, rapports réglementaires.', 'v2', false, 29, 'business', 14),
  ('planning_v2', 'Planning V2 Avancé', 'Chronotachygraphe, amplitudes TRM, export DUERP, multi-services.', 'v2', false, 29, 'business', 15),
  -- Vague V3 — documentation d'intention uniquement
  ('mobile_app', 'App Mobile Native', 'iOS + Android, notifications push, mode hors-ligne, scan de documents.', 'v3', false, 0, null, 16),
  ('bi_reporting', 'Reporting BI', 'Dashboards personnalisés par rôle, export comptable, rapports CO2.', 'v3', false, 0, null, 17),
  ('time_clock', 'Pointeuse Électronique', 'Badge NFC/QR, pointage automatique, intégration paie.', 'v3', false, 0, null, 18),
  ('tachograph', 'Intégration Tachygraphe', 'Import chronotachygraphe, alertes conduite/repos, rapports de conformité.', 'v3', false, 0, null, 19),
  ('gdpr_advanced', 'Module RGPD Avancé', 'Export de données à la demande, droit à l''oubli, registre des traitements.', 'v3', false, 0, null, 20),
  ('fleet_full', 'Gestion de Flotte Complète', 'Entretiens préventifs, TCO, sinistres, rotation de flotte.', 'v3', false, 0, null, 21),
  ('route_optimization', 'Tournées (optimisation)', 'Optimisation de tournées, dispatch automatique, suivi temps réel.', 'v3', false, 0, null, 22),
  -- Transverses (non numérotés dans le catalogue, mais activables/tarifables comme les autres)
  ('fleet', 'Gestion de flotte', 'Fiches véhicules, historique des interventions et entretiens.', 'v1', true, 25, 'starter', 23),
  ('ticpe_export', 'Export TICPE', 'Export Excel filtré PL/SPL, self-service pour le rôle comptable.', 'v1', true, 19, 'starter', 24),
  ('alerts', 'Alertes & Notifications', 'Centre d''alertes in-app et notifications email.', 'v1', true, 0, 'essentiel', 25),
  ('auth_onboarding', 'Authentification & Onboarding', 'Connexion, invitations, création et paramétrage d''organisation.', 'v1', true, 0, 'essentiel', 26),
  ('admin', 'Administration & espace client', 'Paramétrage self-service : logo, couleurs, services, cuves, modules.', 'v1', true, 0, 'essentiel', 27);

create table module_plan_prices (
  module_key text not null references modules (key) on delete cascade,
  plan_id plan_tier not null references plans (id) on delete cascade,
  monthly_price numeric(10, 2) not null default 0,
  included boolean not null default false,
  primary key (module_key, plan_id)
);

-- Generates the grid: free once the org's plan reaches the module's
-- included_from_plan tier; below that, priced à la carte at base
-- price + 40% (per spec: "à la carte (+40% hors grille de plan)").
-- Modules with no included_from_plan (the two marketplace modules,
-- and every V3 module) are never included by a plan upgrade.
insert into module_plan_prices (module_key, plan_id, monthly_price, included)
select
  m.key,
  p.id,
  case
    when m.included_from_plan is not null
      and p.sort_order >= (select sort_order from plans where id = m.included_from_plan)
      then 0
    else round(m.base_price * 1.4, 2)
  end,
  m.included_from_plan is not null
    and p.sort_order >= (select sort_order from plans where id = m.included_from_plan)
from modules m
cross join plans p;

alter table plans enable row level security;
alter table modules enable row level security;
alter table module_plan_prices enable row level security;

-- Public read-only catalog: needed by the unauthenticated /modules
-- presentation page and the onboarding flow, before an org exists to
-- scope RLS against. No write policy for any client-facing role —
-- only the service-role key (GODAC staff) can edit the catalog.
create policy "plans: public read" on plans for select using (true);
create policy "modules: public read" on modules for select using (true);
create policy "module_plan_prices: public read" on module_plan_prices for select using (true);

-- ── organization_modules ─────────────────────────────────────────
-- The actual activation switchboard: what a given organisation has
-- turned on, at what price, and how that price was derived. This is
-- what Sidebar navigation and page-level gates read — never the
-- catalog tables directly.
create table organization_modules (
  organization_id uuid not null references organizations (id) on delete cascade,
  module_key text not null references modules (key) on delete cascade,
  enabled boolean not null default true,
  pricing_mode module_pricing_mode not null default 'included',
  effective_monthly_price numeric(10, 2) not null default 0,
  enabled_at timestamptz not null default now(),
  primary key (organization_id, module_key)
);

alter table organization_modules enable row level security;

create policy "organization_modules: read within org"
  on organization_modules for select
  using (organization_id = public.current_organization_id());

create policy "organization_modules: direction manages"
  on organization_modules for all
  using (organization_id = public.current_organization_id() and public.is_direction())
  with check (organization_id = public.current_organization_id() and public.is_direction());

-- ── organizations: personalization + plan reference ─────────────
alter table organizations add column logo_url text;
alter table organizations add column accent_color text;
alter table organizations add column plan_id plan_tier not null default 'essentiel' references plans (id);

update organizations set plan_id = case
  when plan = 'starter' then 'starter'::plan_tier
  when plan = 'pro' then 'pro'::plan_tier
  when plan = 'business' then 'business'::plan_tier
  else 'essentiel'::plan_tier
end;

-- `ocr_enabled` and the old free-form `plan` text column predate this
-- migration; every organisation created before now defaults to
-- essentiel above, and existing OCR/fleet/ticpe activation is
-- backfilled into organization_modules by the block below before the
-- column is dropped, so no client loses access to something they
-- already had.
insert into organization_modules (organization_id, module_key, enabled, pricing_mode, effective_monthly_price)
select
  o.id,
  'ocr',
  coalesce(o.ocr_enabled, false),
  'included',
  0
from organizations o
on conflict (organization_id, module_key) do nothing;

insert into organization_modules (organization_id, module_key, enabled, pricing_mode, effective_monthly_price)
select o.id, m.key, true, 'included', 0
from organizations o
cross join (values ('fleet'), ('ticpe_export'), ('alerts'), ('auth_onboarding'), ('admin'), ('fuel_tracking')) as m(key)
on conflict (organization_id, module_key) do nothing;

alter table organizations drop column ocr_enabled;
alter table organizations drop column plan;
alter table organizations rename column plan_id to plan;
