-- GODAC V2 — a vehicle's odometer baseline at the moment it enters
-- GODAC. Without this, a truck added with 180 000 km already on the
-- clock would show a "suivi kilométrique" starting from nothing until
-- its first tour or intervention — same reasoning as tank_deliveries
-- needing an initial delivery to seed current_stock_liters.
alter table vehicles add column initial_km numeric(10, 1);
