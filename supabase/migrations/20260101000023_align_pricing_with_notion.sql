-- GODAC V2 — align the pricing catalog with the official pricing
-- strategy (Notion "Stratégie Pricing & ARR" / "Tarification —
-- Modules & Packs", validated June 2026). The catalog seeded during
-- early development used placeholder numbers that never matched the
-- real business pricing, which is how a customer could end up paying
-- less on Essentiel-with-every-addon than on the Business plan.
--
-- What changes:
--   1. Plans get a real vehicle-count range (their actual
--      differentiator) and an is_public flag — Essentiel is "caché,
--      accessible sur demande uniquement" per the pricing doc, so it's
--      no longer offered on the self-serve pricing page or onboarding.
--   2. The plan prices themselves move to the real numbers.
--   3. The "V1 pack" modules that are genuinely built (Congés &
--      Absences, Intranet & Convocations, alongside the already-free
--      Carburant/Flotte/OCR/TICPE/Alertes/Admin baseline) become
--      bundled into every plan's flat price instead of paid add-ons —
--      that's what "pack" means: the per-tier numbers in the pricing
--      doc price a standalone module purchase, not an extra charge on
--      top of a plan you already pay for.
--   4. Demandes d'Entretien (the one real V2 module) gets its real
--      per-tier monthly + one-time setup pricing.
alter table plans add column vehicle_min integer;
alter table plans add column vehicle_max integer;
alter table plans add column is_public boolean not null default true;

alter table module_plan_prices add column setup_price numeric(10,2) not null default 0;
alter table organization_modules add column effective_setup_price numeric(10,2) not null default 0;

update plans set monthly_base_price = 149, setup_price = 1490, vehicle_min = 1, vehicle_max = 10, is_public = false where id = 'essentiel';
update plans set monthly_base_price = 249, setup_price = 4490, vehicle_min = 5, vehicle_max = 20, is_public = true where id = 'starter';
update plans set monthly_base_price = 699, setup_price = 7490, vehicle_min = 20, vehicle_max = 60, is_public = true where id = 'pro';
update plans set monthly_base_price = 1190, setup_price = 11490, vehicle_min = 60, vehicle_max = 150, is_public = true where id = 'business';

alter table plans alter column vehicle_min set not null;

-- New self-serve organizations default to the cheapest *public* plan
-- now that Essentiel is request-only.
alter table organizations alter column plan set default 'starter';

-- Baseline operational modules + the real V1 "pack" modules: bundled
-- into every plan's flat price, no separate charge.
update module_plan_prices
set monthly_price = 0, setup_price = 0, included = true
where module_key in ('admin', 'alerts', 'auth_onboarding', 'fuel_tracking', 'fleet', 'ocr', 'ticpe_export', 'leave_management', 'intranet');

-- Demandes d'Entretien (Notion's one real, priced V2 upsell): real
-- per-tier monthly + setup pricing, never bundled.
update module_plan_prices set monthly_price = 99, setup_price = 990, included = false where module_key = 'maintenance_requests' and plan_id in ('essentiel', 'starter');
update module_plan_prices set monthly_price = 129, setup_price = 1290, included = false where module_key = 'maintenance_requests' and plan_id = 'pro';
update module_plan_prices set monthly_price = 159, setup_price = 1590, included = false where module_key = 'maintenance_requests' and plan_id = 'business';

-- Backfill: every organization gets the now-bundled modules for free,
-- whatever plan they're already on.
update organization_modules
set enabled = true, pricing_mode = 'included', effective_monthly_price = 0, effective_setup_price = 0
where module_key in ('admin', 'alerts', 'auth_onboarding', 'fuel_tracking', 'fleet', 'ocr', 'ticpe_export', 'leave_management', 'intranet');

-- Backfill: any org that already pays for Demandes d'Entretien as an
-- add-on gets re-priced to its plan's real tier pricing.
update organization_modules om
set effective_monthly_price = mpp.monthly_price, effective_setup_price = mpp.setup_price
from organizations o, module_plan_prices mpp
where om.organization_id = o.id
  and mpp.plan_id = o.plan
  and mpp.module_key = 'maintenance_requests'
  and om.module_key = 'maintenance_requests'
  and om.enabled = true
  and om.pricing_mode = 'a_la_carte';
