-- GODAC V2 — notify a driver when a manager assigns (or reassigns)
-- them to a planned tour. Only fires for manager-authored planning
-- ('planned' rows, created from /planning) — never for the driver's
-- own scan-to-open-a-tour flow (/tours/start inserts 'in_progress'
-- directly), which would just be notifying someone of their own
-- action.
create or replace function public.after_planning_entry_upsert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_registration text;
begin
  if new.status = 'planned' and new.driver_id is not null and (
    tg_op = 'INSERT'
    or new.driver_id is distinct from old.driver_id
    or new.vehicle_id is distinct from old.vehicle_id
    or new.start_at is distinct from old.start_at
  ) then
    if new.vehicle_id is not null then
      select registration into v_registration from vehicles where id = new.vehicle_id;
    end if;

    insert into alerts (organization_id, type, severity, message, related_table, related_id, recipient_user_id)
    values (
      new.organization_id,
      'planning_assignment',
      'info',
      format(
        'Tournée n°%s prévue le %s%s',
        new.tour_number,
        to_char(new.start_at, 'DD/MM/YYYY à HH24:MI'),
        case when v_registration is not null then ' — véhicule ' || v_registration else '' end
      ),
      'planning_entries',
      new.id,
      new.driver_id
    );
  end if;
  return new;
end;
$$;

create trigger planning_entries_after_upsert
  after insert or update on planning_entries
  for each row execute function public.after_planning_entry_upsert();
