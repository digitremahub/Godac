-- GODAC V2 — Lot 6: per-vehicle fuel consumption (L/100km) and its
-- anomaly alert. There is no odometer field on fuel_entries (see
-- 20260101000003_fuel_tables.sql) so "km traveled" is read from the
-- same three odometer sources as lib/vehicles/odometer-reference.ts:
-- tour start/end km and maintenance-request odometer readings.
--
-- vehicle_km_traveled mirrors lib/business/consumption.ts's
-- computeKmTraveled (earliest/latest reading by date within the
-- window, not by value) so the trigger's alert and the app's own
-- displayed numbers never disagree on method, even though the SQL and
-- TS implementations are necessarily separate — same dual
-- pure-function/trigger split as totalizer-gap.ts and odometer.ts.
alter table organizations add column consumption_anomaly_threshold_percent integer not null default 20;

create or replace function public.vehicle_km_traveled(p_vehicle_id uuid, p_since timestamptz, p_until timestamptz)
returns numeric
language sql
stable
as $$
  with readings as (
    select start_at as at, start_km as km
    from planning_entries
    where vehicle_id = p_vehicle_id and start_km is not null and start_at between p_since and p_until
    union all
    select end_at as at, end_km as km
    from planning_entries
    where vehicle_id = p_vehicle_id and end_km is not null and end_at between p_since and p_until
    union all
    select created_at as at, odometer_km as km
    from vehicle_interventions
    where vehicle_id = p_vehicle_id and odometer_km is not null and created_at between p_since and p_until
  ),
  bounds as (
    select
      (array_agg(km order by at asc))[1] as first_km,
      (array_agg(km order by at desc))[1] as last_km,
      count(*) as n
    from readings
  )
  select case when n < 2 or last_km <= first_km then null else last_km - first_km end
  from bounds;
$$;

create or replace function public.after_fuel_entry_consumption_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  threshold_percent numeric;
  recent_liters numeric;
  recent_km numeric;
  baseline_liters numeric;
  baseline_km numeric;
  fillup_count int;
  recent_consumption numeric;
  baseline_consumption numeric;
  vehicle_registration text;
begin
  select coalesce(consumption_anomaly_threshold_percent, 20) into threshold_percent
  from organizations where id = new.organization_id;

  select count(*), coalesce(sum(fe.liters), 0)
    into fillup_count, baseline_liters
  from fuel_entries fe
  join tanks t on t.id = fe.tank_id
  where fe.vehicle_id = new.vehicle_id
    and fe.status in ('manual', 'validated')
    and t.fuel_type = 'diesel'
    and fe.occurred_at between new.occurred_at - interval '90 days' and new.occurred_at;

  -- Needs a reasonably established baseline before flagging anything.
  if fillup_count < 3 then
    return new;
  end if;

  select coalesce(sum(fe.liters), 0) into recent_liters
  from fuel_entries fe
  join tanks t on t.id = fe.tank_id
  where fe.vehicle_id = new.vehicle_id
    and fe.status in ('manual', 'validated')
    and t.fuel_type = 'diesel'
    and fe.occurred_at between new.occurred_at - interval '30 days' and new.occurred_at;

  baseline_km := public.vehicle_km_traveled(new.vehicle_id, new.occurred_at - interval '90 days', new.occurred_at);
  recent_km := public.vehicle_km_traveled(new.vehicle_id, new.occurred_at - interval '30 days', new.occurred_at);

  if baseline_km is null or baseline_km <= 0 or recent_km is null or recent_km <= 0 then
    return new;
  end if;

  baseline_consumption := round(baseline_liters / baseline_km * 100, 1);
  recent_consumption := round(recent_liters / recent_km * 100, 1);

  if baseline_consumption > 0 and recent_consumption > baseline_consumption * (1 + threshold_percent / 100.0) then
    select registration into vehicle_registration from vehicles where id = new.vehicle_id;

    insert into alerts (organization_id, type, severity, message, related_table, related_id, recipient_roles)
    values (
      new.organization_id,
      'consumption_anomaly',
      'warning',
      format(
        'Consommation de %s en hausse : %s L/100km sur 30 jours contre %s L/100km habituellement.',
        coalesce(vehicle_registration, 'véhicule'),
        recent_consumption,
        baseline_consumption
      ),
      'fuel_entries',
      new.id,
      array['manager', 'manager_chauffeur', 'direction']::user_role[]
    );
  end if;

  return new;
end;
$$;

revoke execute on function public.after_fuel_entry_consumption_check() from public, anon, authenticated;

create trigger fuel_entries_after_consumption_check
  after insert or update of status
  on fuel_entries
  for each row
  when (new.status in ('manual', 'validated'))
  execute function public.after_fuel_entry_consumption_check();
