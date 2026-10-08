-- Hybrid pricing model: keep the 4 existing plans (Essentiel/Starter/
-- Pro/Business, vehicle-banded, unchanged monthly + setup prices) and
-- make the à la carte catalog clearly less attractive module-by-
-- module than taking the matching plan tier, per fleet size. A fixed
-- set of high-ticket modules (Suivi amende, Demande d'entretien,
-- Assistant IA, TICPE export, the whole RH group) are now permanent
-- upsells — never bundled into any plan, whatever the tier.

-- These three HR modules are real, built, and sellable — the v3 tag
-- was hiding them from every pricing surface (public /modules page,
-- onboarding ModuleSelector, PricingSimulator all filter out
-- wave='v3' as "documentation-only, unreleased").
update modules set wave = 'v2' where key in ('employee_files', 'hr_status', 'payslips');

update modules set name = 'Suivi amende' where key = 'fines';

-- TICPE export and Assistant IA become permanent à la carte upsells —
-- never bundled into any plan again, regardless of tier.
update modules set included_from_plan = null where key in ('ticpe_export', 'assistant');

-- Suivi amende (fines) — banded by plan tier (proxy for fleet size).
update module_plan_prices set monthly_price = 69, setup_price = 699 where module_key = 'fines' and plan_id in ('essentiel', 'starter');
update module_plan_prices set monthly_price = 105, setup_price = 1050 where module_key = 'fines' and plan_id = 'pro';
update module_plan_prices set monthly_price = 159, setup_price = 1590 where module_key = 'fines' and plan_id = 'business';

-- Lavage — à la carte on the two smaller plans, bundled free from Pro up (plan upsell incentive).
update module_plan_prices set monthly_price = 14, setup_price = 149, included = false where module_key = 'washes' and plan_id in ('essentiel', 'starter');
update module_plan_prices set monthly_price = 0, setup_price = 0, included = true where module_key = 'washes' and plan_id in ('pro', 'business');

-- Demande d'entretien — banded, premium ticket.
update module_plan_prices set monthly_price = 79, setup_price = 790 where module_key = 'maintenance_requests' and plan_id in ('essentiel', 'starter');
update module_plan_prices set monthly_price = 119, setup_price = 1185 where module_key = 'maintenance_requests' and plan_id = 'pro';
update module_plan_prices set monthly_price = 178, setup_price = 1780 where module_key = 'maintenance_requests' and plan_id = 'business';

-- Assistant IA — removed from the free Business bundle, always à la carte now.
update module_plan_prices set monthly_price = 49, setup_price = 499, included = false where module_key = 'assistant' and plan_id in ('essentiel', 'starter', 'pro');
update module_plan_prices set monthly_price = 69, setup_price = 699, included = false where module_key = 'assistant' and plan_id = 'business';

-- TICPE export — removed from every plan's free bundle, always à la carte.
update module_plan_prices set monthly_price = 99, setup_price = 990, included = false where module_key = 'ticpe_export' and plan_id in ('essentiel', 'starter');
update module_plan_prices set monthly_price = 149, setup_price = 1490, included = false where module_key = 'ticpe_export' and plan_id = 'pro';
update module_plan_prices set monthly_price = 249, setup_price = 2490, included = false where module_key = 'ticpe_export' and plan_id = 'business';

-- RH group (Dossiers Employés / Statuts RH / Fiches de Paie) — never
-- bundled, always à la carte regardless of plan.
update module_plan_prices set monthly_price = 29, setup_price = 290, included = false where module_key = 'employee_files' and plan_id in ('essentiel', 'starter');
update module_plan_prices set monthly_price = 39, setup_price = 390, included = false where module_key = 'employee_files' and plan_id = 'pro';
update module_plan_prices set monthly_price = 59, setup_price = 590, included = false where module_key = 'employee_files' and plan_id = 'business';

update module_plan_prices set monthly_price = 15, setup_price = 0, included = false where module_key = 'hr_status';

update module_plan_prices set monthly_price = 35, setup_price = 350, included = false where module_key = 'payslips' and plan_id in ('essentiel', 'starter');
update module_plan_prices set monthly_price = 45, setup_price = 450, included = false where module_key = 'payslips' and plan_id in ('pro', 'business');

-- New module: push notification channel (separate from the
-- always-free in-app alerts + email). Near-zero setup effort so no
-- one-time fee, banded by plan tier (proxy for headcount), free perk
-- on Business.
insert into modules (key, name, description, wave, is_transverse, base_price, included_from_plan, sort_order)
values ('push_notifications', 'Notifications Push', 'Alertes envoyées directement sur le téléphone/PC des utilisateurs, en plus de l''email.', 'v2', false, 9, null, 31);

insert into module_plan_prices (module_key, plan_id, monthly_price, setup_price, included)
values
  ('push_notifications', 'essentiel', 9, 0, false),
  ('push_notifications', 'starter', 9, 0, false),
  ('push_notifications', 'pro', 19, 0, false),
  ('push_notifications', 'business', 0, 0, true);

-- Digitrema's own org keeps push working (internal pilot, free) now that it's gated behind a module.
insert into organization_modules (organization_id, module_key, enabled, pricing_mode, effective_monthly_price)
values ('430c4259-54fd-45a5-b665-ef7e682448a0', 'push_notifications', true, 'included', 0)
on conflict (organization_id, module_key) do update set enabled = true;
