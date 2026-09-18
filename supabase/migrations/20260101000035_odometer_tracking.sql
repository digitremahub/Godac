-- GODAC V2 — vehicle odometer tracking, fed from the two places a
-- driver already touches a vehicle's dashboard: the start/end of a
-- tour (planning_entries already had start_km/end_km as plain numbers,
-- this adds the photo so they can be OCR-read like the tank totalizer
-- is) and a maintenance request (vehicle_interventions had no
-- odometer field at all). The vehicle detail page reads both to build
-- one combined km history — see app/(dashboard)/vehicles/[id].
alter table planning_entries add column start_km_photo_path text;
alter table planning_entries add column end_km_photo_path text;

alter table vehicle_interventions add column odometer_km numeric(10, 1);
alter table vehicle_interventions add column odometer_photo_path text;
