-- GODAC V2 — correct the module catalog to match reality.
--
-- Ten modules were seeded as wave v1/v2 ("Disponible aujourd'hui")
-- and some even carry a monthly price and an included_from_plan,
-- but have zero actual UI or feature behind them (no page, no route,
-- no sidebar entry, nothing a user could ever open):
--   employee_files, payslips, hr_status, planning (wave v1)
--   fuel_station_prices, freight_return_trips, subcontract_requests,
--   messenger, hr_status_v2, planning_v2 (wave v2)
-- They were being listed as purchasable everywhere the catalog is
-- read from (public /modules page, the pricing simulator, the
-- onboarding module picker, and the per-org module toggle), which
-- both misrepresents the product and can bill for nothing.
--
-- Reclassifying them to v3 puts them in the same "coming soon"
-- bucket as the other unbuilt modules: still visible as a roadmap
-- item on the public page, but excluded from every selectable/
-- purchasable listing (all of which filter on `wave <> 'v3'`), with
-- no price and no plan-inclusion claim attached.
update modules
set wave = 'v3', included_from_plan = null, base_price = 0
where key in (
  'employee_files', 'payslips', 'hr_status', 'planning',
  'fuel_station_prices', 'freight_return_trips', 'subcontract_requests',
  'messenger', 'hr_status_v2', 'planning_v2'
);

-- Clear any organization that already had one of these flipped on
-- (e.g. bundled "included" by a plan) — stale data now that the
-- module is no longer sellable.
update organization_modules
set enabled = false, pricing_mode = 'a_la_carte', effective_monthly_price = 0
where module_key in (
  'employee_files', 'payslips', 'hr_status', 'planning',
  'fuel_station_prices', 'freight_return_trips', 'subcontract_requests',
  'messenger', 'hr_status_v2', 'planning_v2'
) and enabled = true;
