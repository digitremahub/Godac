-- GODAC V2 — a driver can be qualified on several services ("formé à
-- plusieurs services"), each at its own level: titulaire (fully
-- qualified, the normal case), formation (in training — can be
-- staffed but a manager should keep an eye on it), remplacement
-- (occasional backup cover only). user_services already allowed
-- several rows per driver (user_id, service_id) — nothing stopped
-- that — but it carried no status and the admin UI only ever
-- edited a single row per user. This is the data side of that fix;
-- the manager-facing "several services, each with a status" UI is a
-- DriverServicesPanel on the driver's own admin fiche page.
create type driver_service_status as enum ('titulaire', 'formation', 'remplacement');

alter table user_services add column status driver_service_status not null default 'titulaire';
