-- Personal alert to the convened employee — same mechanism as
-- planning_assignment's personal notification.
create or replace function public.after_convocation_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into alerts (organization_id, type, severity, message, related_table, related_id, recipient_user_id)
  values (
    new.organization_id,
    'convocation',
    'warning',
    format(
      'Vous êtes convoqué%s : %s',
      case when new.scheduled_at is not null then format(' le %s', to_char(new.scheduled_at, 'DD/MM/YYYY à HH24:MI')) else '' end,
      left(new.reason, 140)
    ),
    'convocations',
    new.id,
    new.employee_id
  );
  return new;
end;
$$;

revoke execute on function public.after_convocation_insert() from public, anon, authenticated;

create trigger convocations_after_insert
  after insert
  on convocations
  for each row
  execute function public.after_convocation_insert();
