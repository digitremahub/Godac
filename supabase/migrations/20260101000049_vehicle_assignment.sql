-- GODAC V2 — persistent vehicle<->driver assignment ("Mon véhicule"),
-- distinct from the transient "active tour" concept (planning_entries
-- in_progress). A vehicle can sit assigned to one driver between
-- tours — this is who the driver fiche at /my-vehicle resolves to,
-- and who the manager fiche's "chauffeur assigné" field edits.
--
-- No new RLS policy needed for the manager-edit path: "vehicles:
-- manager-like write scoped to service" (20260101000009_rls_policies.sql)
-- already covers UPDATE of any column on vehicles for manager-like
-- roles within their service. A chauffeur claiming/releasing an
-- unassigned vehicle themselves is a narrower, conditional case that
-- doesn't fit a blanket RLS grant (it would also grant them every
-- other column) — see app/api/vehicles/[id]/assignment/route.ts,
-- which validates the "unassigned, or already theirs" condition in
-- application code before writing via the service-role client, same
-- trust model as lib/auth/driver-pin.ts's account creation.
alter table vehicles add column assigned_driver_id uuid references users (id) on delete set null;

create index vehicles_assigned_driver_id_idx on vehicles (assigned_driver_id);
