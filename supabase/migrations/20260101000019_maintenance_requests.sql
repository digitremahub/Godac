-- GODAC V2 — "Demandes d'Entretien" (module `maintenance_requests`):
-- urgency levels + a chauffeur-initiated request flow on top of the
-- existing vehicle_interventions table (an entretien and a driver's
-- maintenance request are the same underlying record — a request is
-- just one that started life with a driver-set urgency and no
-- manager decision yet), rather than a parallel table.

create type intervention_urgency as enum ('low', 'normal', 'high', 'critical');

alter table vehicle_interventions add column urgency intervention_urgency not null default 'normal';
alter table vehicle_interventions add column requested_by uuid references users (id) on delete set null;

-- Existing RLS ("interventions: manager-like write scoped to
-- service") stays for manager-like/direction managing any
-- intervention. This adds the missing half of the spec's "flux
-- chauffeur → gestionnaire": any org member can open a request for a
-- vehicle in their own organisation, naming themselves as requester —
-- they can't set status/urgency-after-the-fact edits on someone
-- else's request, only create their own.
create policy "interventions: any member requests"
  on vehicle_interventions for insert
  with check (organization_id = public.current_organization_id() and requested_by = public.current_app_user_id());
