-- Quotas par entreprise sur les fonctions payantes (lectures IA/OCR,
-- assistant…) puis facturation à la dépense.
--
-- Chaque appel à un service d'IA externe facturé à GODAC est compté
-- dans `usage_events` (côté serveur uniquement, client service) avant
-- l'appel — voir lib/usage/consommer.ts. Chaque formule inclut un
-- volume mensuel gratuit par fonction (`usage_quotas`) ; au-delà, les
-- unités sont facturées à l'unité (`usage_prices`) si l'entreprise a
-- accepté le dépassement (`organizations.usage_overage_enabled`),
-- sinon bloquées. Un plafond journalier de sécurité (≈ 10× la moyenne
-- journalière incluse) stoppe les abus dans tous les cas.
--
-- Migration NON destructive : uniquement des créations et un ajout de
-- colonne avec valeur par défaut.

alter table organizations add column if not exists usage_overage_enabled boolean not null default true;

-- ── Prix unitaires du dépassement (€ HT) ────────────────────────────
create table if not exists usage_prices (
  feature text primary key,
  label text not null,
  unit_label text not null,
  unit_price_eur numeric(10, 4) not null check (unit_price_eur >= 0),
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);

insert into usage_prices (feature, label, unit_label, unit_price_eur, sort_order) values
  ('ocr_ticket', 'Lecture automatique des tickets carburant', 'ticket', 0.05, 1),
  ('ocr_tour_report', 'Lecture des rapports de tournée', 'photo', 0.05, 2),
  ('tour_report_reread', 'Relecture d''un rapport de tournée', 'relecture', 0.10, 3),
  ('ocr_counter', 'Lecture des compteurs kilométriques', 'photo', 0.03, 4),
  ('ocr_totalizer', 'Lecture des totalisateurs de cuve', 'photo', 0.03, 5),
  ('ocr_fine', 'Lecture des avis de contravention', 'avis', 0.10, 6),
  ('ocr_label', 'Lecture des étiquettes colis', 'étiquette', 0.03, 7),
  ('contestation', 'Lecture des contestations clients', 'document', 0.15, 8),
  ('vehicle_ai_specs', 'Fiche véhicule complétée par IA', 'véhicule', 0.10, 9),
  ('import_ai', 'Import de fichier assisté par IA', 'fichier', 0.50, 10),
  ('assistant', 'Assistant GODAC', 'message', 0.05, 11)
on conflict (feature) do nothing;

-- ── Volume inclus par formule et par mois ──────────────────────────
create table if not exists usage_quotas (
  plan_id plan_tier not null references plans (id),
  feature text not null references usage_prices (feature),
  included_per_month integer not null check (included_per_month >= 0),
  -- Plafond de sécurité par jour et par entreprise (dépassement
  -- autorisé ou non) : ≈ 10× la moyenne journalière incluse.
  daily_cap integer not null check (daily_cap > 0),
  created_at timestamptz not null default now(),
  primary key (plan_id, feature)
);

insert into usage_quotas (plan_id, feature, included_per_month, daily_cap)
select q.plan_id::plan_tier, q.feature, q.inclus, greatest(20, ceil(q.inclus * 10 / 30.0)::integer)
from (values
  ('essentiel', 'ocr_ticket', 300), ('starter', 'ocr_ticket', 1000), ('pro', 'ocr_ticket', 3000), ('business', 'ocr_ticket', 8000),
  ('essentiel', 'ocr_tour_report', 400), ('starter', 'ocr_tour_report', 1500), ('pro', 'ocr_tour_report', 4500), ('business', 'ocr_tour_report', 12000),
  ('essentiel', 'tour_report_reread', 20), ('starter', 'tour_report_reread', 50), ('pro', 'tour_report_reread', 150), ('business', 'tour_report_reread', 400),
  ('essentiel', 'ocr_counter', 150), ('starter', 'ocr_counter', 500), ('pro', 'ocr_counter', 1500), ('business', 'ocr_counter', 4000),
  ('essentiel', 'ocr_totalizer', 60), ('starter', 'ocr_totalizer', 150), ('pro', 'ocr_totalizer', 400), ('business', 'ocr_totalizer', 1000),
  ('essentiel', 'ocr_fine', 10), ('starter', 'ocr_fine', 30), ('pro', 'ocr_fine', 80), ('business', 'ocr_fine', 200),
  ('essentiel', 'ocr_label', 300), ('starter', 'ocr_label', 1000), ('pro', 'ocr_label', 3000), ('business', 'ocr_label', 8000),
  ('essentiel', 'contestation', 20), ('starter', 'contestation', 60), ('pro', 'contestation', 200), ('business', 'contestation', 500),
  ('essentiel', 'vehicle_ai_specs', 20), ('starter', 'vehicle_ai_specs', 50), ('pro', 'vehicle_ai_specs', 150), ('business', 'vehicle_ai_specs', 400),
  ('essentiel', 'import_ai', 5), ('starter', 'import_ai', 10), ('pro', 'import_ai', 20), ('business', 'import_ai', 40),
  ('essentiel', 'assistant', 200), ('starter', 'assistant', 600), ('pro', 'assistant', 2000), ('business', 'assistant', 5000)
) as q (plan_id, feature, inclus)
on conflict (plan_id, feature) do nothing;

-- ── Événements de consommation ─────────────────────────────────────
create table if not exists usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id uuid references users (id) on delete set null,
  feature text not null references usage_prices (feature),
  units integer not null default 1 check (units > 0),
  -- Part de l'événement au-delà du volume inclus × prix unitaire
  -- (0 tant que l'entreprise reste dans son forfait).
  cost_estimate_eur numeric(10, 4) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists usage_events_org_feature_created_idx on usage_events (organization_id, feature, created_at);
create index if not exists usage_events_org_created_idx on usage_events (organization_id, created_at);

-- ── Facturation mensuelle du dépassement (idempotence Stripe) ──────
create table if not exists usage_billing_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  feature text not null references usage_prices (feature),
  units integer not null,
  amount_eur numeric(10, 2) not null,
  stripe_invoice_item_id text,
  created_at timestamptz not null default now(),
  unique (organization_id, period, feature)
);

-- ── RLS ────────────────────────────────────────────────────────────
alter table usage_prices enable row level security;
alter table usage_quotas enable row level security;
alter table usage_events enable row level security;
alter table usage_billing_runs enable row level security;

-- Grille publique (page Modules & tarifs), comme plans/module_plan_prices.
create policy "usage_prices: public read" on usage_prices for select using (true);
create policy "usage_quotas: public read" on usage_quotas for select using (true);

-- Lecture réservée à la direction de l'entreprise ; aucune policy
-- d'écriture : l'insertion passe exclusivement par le client service.
create policy "usage_events: direction reads within org"
  on usage_events for select
  using (organization_id = public.current_organization_id() and public.is_direction());

create policy "usage_billing_runs: direction reads within org"
  on usage_billing_runs for select
  using (organization_id = public.current_organization_id() and public.is_direction());

-- ── Agrégats (évite la limite de lignes de l'API) ──────────────────
-- security invoker : la RLS ci-dessus s'applique aux appels utilisateur.
create or replace function public.usage_totals(p_org uuid, p_from timestamptz, p_to timestamptz)
returns table (feature text, units bigint, cost_eur numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select e.feature, sum(e.units)::bigint, coalesce(sum(e.cost_estimate_eur), 0)
  from usage_events e
  where e.organization_id = p_org and e.created_at >= p_from and e.created_at < p_to
  group by e.feature
$$;

-- Unités d'une fonction depuis le début du mois et depuis le début du jour (heure de Paris, bornes calculées côté app).
create or replace function public.usage_feature_totals(p_org uuid, p_feature text, p_month_start timestamptz, p_day_start timestamptz)
returns table (month_units bigint, day_units bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(sum(e.units), 0)::bigint,
    coalesce(sum(e.units) filter (where e.created_at >= p_day_start), 0)::bigint
  from usage_events e
  where e.organization_id = p_org and e.feature = p_feature and e.created_at >= least(p_month_start, p_day_start)
$$;

-- Historique par mois (heure de Paris) depuis p_from.
create or replace function public.usage_monthly(p_org uuid, p_from timestamptz)
returns table (period text, feature text, units bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select to_char(e.created_at at time zone 'Europe/Paris', 'YYYY-MM'), e.feature, sum(e.units)::bigint
  from usage_events e
  where e.organization_id = p_org and e.created_at >= p_from
  group by 1, 2
$$;

grant execute on function public.usage_totals(uuid, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.usage_feature_totals(uuid, text, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.usage_monthly(uuid, timestamptz) to authenticated, service_role;
