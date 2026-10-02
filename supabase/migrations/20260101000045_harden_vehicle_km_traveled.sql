-- GODAC V2 — the Supabase linter flagged vehicle_km_traveled (added in
-- 20260101000043) for a mutable search_path, same class of fix as the
-- project's existing harden_* migrations for other functions. Pinning
-- it removes any ambiguity about which schema's objects it resolves
-- against.
create or replace function public.vehicle_km_traveled(p_vehicle_id uuid, p_since timestamptz, p_until timestamptz)
returns numeric
language sql
stable
set search_path = public
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
