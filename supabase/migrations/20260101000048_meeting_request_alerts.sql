-- GODAC V2 — notifies manager-like/direction when a member requests
-- a meeting, same notification pipeline as maintenance requests
-- (alerts -> Supabase DB webhook -> Resend, see
-- 20260101000025_maintenance_request_alerts.sql).
create or replace function public.after_meeting_request_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requester_name text;
begin
  select full_name into requester_name from users where id = new.requested_by;

  insert into alerts (organization_id, type, severity, message, related_table, related_id, recipient_roles)
  values (
    new.organization_id,
    'meeting_request',
    'info',
    format('%s a demandé un rendez-vous.', coalesce(requester_name, 'Un salarié')),
    'meeting_requests',
    new.id,
    array['manager', 'manager_chauffeur', 'direction']::user_role[]
  );

  return new;
end;
$$;

revoke execute on function public.after_meeting_request_insert() from public, anon, authenticated;

create trigger meeting_requests_after_insert
  after insert
  on meeting_requests
  for each row
  execute function public.after_meeting_request_insert();
