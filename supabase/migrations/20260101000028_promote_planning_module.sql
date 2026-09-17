-- GODAC V2 — re-promote "planning" now that it has real UI behind it
-- (driver-submitted start/end-of-day tour reports, see
-- 20260101000027_tour_reports.sql + app/(dashboard)/tours). It was
-- demoted to v3 in 20260101000022 for having zero UI; same honesty
-- rule in reverse now applies: bundle it the way the other real V1
-- modules were bundled in 20260101000023 (free, included in every
-- plan) rather than inventing a new price nobody asked for.
update modules
set wave = 'v1', included_from_plan = 'essentiel', base_price = 0
where key = 'planning';

update module_plan_prices
set monthly_price = 0, setup_price = 0, included = true
where module_key = 'planning';

-- Every existing organization: this module never got an
-- organization_modules row before (the baseline seeding at signup
-- skips every wave='v3' module, see
-- app/api/onboarding/create-organization/route.ts), so insert rather
-- than just update.
insert into organization_modules (organization_id, module_key, enabled, pricing_mode, effective_monthly_price, effective_setup_price)
select o.id, 'planning', true, 'included', 0, 0
from organizations o
on conflict (organization_id, module_key) do update
set enabled = true, pricing_mode = 'included', effective_monthly_price = 0, effective_setup_price = 0;
