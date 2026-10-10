-- The refueling wizard now captures the vehicle's odometer photo as
-- its own step (before the ticket/cuve branch), the same way
-- totalizer_before_photo_path/totalizer_after_photo_path already do
-- for the pump counter — vehicle_km itself (20260101000084) had
-- nowhere to keep the photo it was read from.
alter table fuel_entries add column vehicle_km_photo_path text;
