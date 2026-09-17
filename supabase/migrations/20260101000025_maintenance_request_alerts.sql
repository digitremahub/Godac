-- GODAC V2 — wire up notifications for "Demandes d'Entretien".
--
-- A chauffeur's maintenance request landed in vehicle_interventions
-- with nobody told: no alert, no email. This raises an alert (same
-- alerts -> Supabase DB webhook -> Resend pipeline already used for
-- fuel anomalies, see app/api/webhooks/supabase-alerts/route.ts) to
-- every manager-like/direction user whenever a new intervention is
-- opened, severity following the driver-set urgency. The priority
-- itself was already editable after the fact by manager-like/direction
-- (see app/api/vehicle-interventions/[id]/route.ts) — this only adds
-- the missing notification.
create or replace function public.after_vehicle_intervention_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  vehicle_registration text;
  computed_severity alert_severity;
begin
  select registration into vehicle_registration from vehicles where id = new.vehicle_id;

  computed_severity := case new.urgency
    when 'critical' then 'critical'
    when 'high' then 'warning'
    else 'info'
  end;

  insert into alerts (organization_id, type, severity, message, related_table, related_id, recipient_roles)
  values (
    new.organization_id,
    'maintenance_request',
    computed_severity,
    format('Nouvelle demande d''entretien (%s) pour %s — %s', new.urgency, coalesce(vehicle_registration, 'véhicule'), new.type),
    'vehicle_interventions',
    new.id,
    array['manager', 'manager_chauffeur', 'direction']::user_role[]
  );

  return new;
end;
$$;

revoke execute on function public.after_vehicle_intervention_insert() from public, anon, authenticated;

create trigger vehicle_interventions_after_insert
  after insert
  on vehicle_interventions
  for each row
  execute function public.after_vehicle_intervention_insert();
