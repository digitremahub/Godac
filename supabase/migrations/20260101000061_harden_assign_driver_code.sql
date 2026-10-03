-- GODAC V2 — same hardening as 20260101000045_harden_vehicle_km_traveled.sql:
-- pins the function's search_path so it can't be hijacked by a
-- session-level search_path change.
create or replace function public.assign_driver_code()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  candidate text;
begin
  if new.driver_code is not null then
    return new;
  end if;
  loop
    candidate := lpad((100000 + floor(random() * 900000))::text, 6, '0');
    exit when not exists (
      select 1 from users where organization_id = new.organization_id and driver_code = candidate
    );
  end loop;
  new.driver_code := candidate;
  return new;
end;
$$;
