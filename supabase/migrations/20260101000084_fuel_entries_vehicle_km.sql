-- A driver filling up from the company's own cuve has no reason to
-- know or type a price (see lib/fuel/current-pmp.ts — it's derived
-- from the tank's own weighted-average cost instead) nor to retype
-- the litres the totalizer delta already gives exactly — but they do
-- know the vehicle's current odometer reading, which fuel_entries had
-- nowhere to record. Feeds lib/vehicles/odometer-reference.ts too, so
-- every fill-up becomes another data point for the regression check,
-- not just tour starts/ends and interventions.
alter table fuel_entries add column vehicle_km numeric(10,2);
