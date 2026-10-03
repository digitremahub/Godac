-- GODAC V2 — reliable tour start/end (Lot 3): the mandatory,
-- never-pre-checked vehicle-state confirmation at both ends of a
-- tour, and the automatic signalement it creates when a problem is
-- reported. A signalement raised this way is the same
-- vehicle_interventions row a driver creates from /maintenance (see
-- 20260101000019_maintenance_requests.sql's "any member requests"
-- policy, which already covers this insert) — just pre-filled by the
-- tour flow and linked back to it.
alter table planning_entries add column start_vehicle_ok boolean;
alter table planning_entries add column end_vehicle_ok boolean;

alter table vehicle_interventions add column planning_entry_id uuid references planning_entries (id) on delete set null;
-- Reuses the tour-photos bucket (already generic "any member
-- uploads/reads within org", nothing tour-specific in its policy
-- text) rather than standing up a dedicated bucket for this one
-- optional photo — same reuse call as vehicle_washes photos.
alter table vehicle_interventions add column photo_path text;

-- A tour covering an implausible distance (long-haul SPL aside, this
-- usually means a typo on one of the two km readings) is accepted —
-- rejecting it would block a driver over a data-quality concern a
-- manager should just glance at — but flagged via the alert center.
-- Mirrors lib/business/odometer.ts's checkTourDistanceGap, same
-- dual-implementation split (pure TS for the client/API rejection
-- path on regression, SQL trigger as the DB-level source of truth for
-- raising the alert) as compute_fuel_entry_derived/totalizer_gap.
create or replace function public.after_planning_entry_odometer_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  gap_km numeric(12, 1);
  large_gap_threshold constant numeric := 1500;
  vehicle_registration text;
begin
  if new.end_km is null or new.start_km is null then
    return new;
  end if;
  if old.end_km is not null and old.end_km = new.end_km then
    return new;
  end if;

  gap_km := new.end_km - new.start_km;
  if gap_km > large_gap_threshold then
    select registration into vehicle_registration from vehicles where id = new.vehicle_id;

    insert into alerts (organization_id, type, severity, message, related_table, related_id, recipient_roles)
    values (
      new.organization_id,
      'odometer_anomaly',
      'warning',
      format(
        'Tournée n°%s (%s) : écart de %s km entre départ et retour — à vérifier.',
        new.tour_number,
        coalesce(vehicle_registration, 'véhicule'),
        gap_km
      ),
      'planning_entries',
      new.id,
      array['manager', 'manager_chauffeur', 'direction']::user_role[]
    );
  end if;

  return new;
end;
$$;

revoke execute on function public.after_planning_entry_odometer_check() from public, anon, authenticated;

create trigger planning_entries_after_odometer_check
  after update of end_km
  on planning_entries
  for each row
  when (new.end_km is not null)
  execute function public.after_planning_entry_odometer_check();
