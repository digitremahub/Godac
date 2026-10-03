-- GODAC V2 — notifications for the assistant's human relay
-- (support_requests). Two triggers:
--
-- 1. On creation targeting 'gestionnaire': broadcasts an alert to
--    manager-like/direction, same role-broadcast pattern as
--    maintenance_request/meeting_request (service-level narrowing of
--    "which manager" happens at query time on /support, same
--    established convention as /qr-codes and the dashboard widget —
--    see those pages' comments — not via a new RLS policy).
--    A request targeting 'support_godac' raises NO alert here: alerts
--    are strictly organization-scoped (alerts.organization_id is
--    not-null, references organizations), and GODAC's own staff isn't
--    a member of any tenant org. That case is emailed directly via
--    Resend from app/api/support-requests/route.ts to
--    GODAC_STAFF_EMAILS instead of going through this alert/webhook
--    pipeline.
-- 2. On the requester's own request being resolved: a personal alert
--    (recipient_user_id) so they're told their question was answered,
--    same mechanism as planning_assignment's personal notification.
create or replace function public.after_support_request_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.recipient = 'gestionnaire' then
    insert into alerts (organization_id, type, severity, message, related_table, related_id, recipient_roles)
    values (
      new.organization_id,
      'support_request',
      'info',
      format('Nouvelle demande d''assistance : %s', left(new.question, 140)),
      'support_requests',
      new.id,
      array['manager', 'manager_chauffeur', 'direction']::user_role[]
    );
  end if;
  return new;
end;
$$;

revoke execute on function public.after_support_request_insert() from public, anon, authenticated;

create trigger support_requests_after_insert
  after insert
  on support_requests
  for each row
  execute function public.after_support_request_insert();

create or replace function public.after_support_request_resolved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'resolved' and new.response is not null and (old.status is distinct from 'resolved' or old.response is distinct from new.response) then
    insert into alerts (organization_id, type, severity, message, related_table, related_id, recipient_user_id)
    values (
      new.organization_id,
      'support_request',
      'info',
      'Votre question a reçu une réponse — consultez-la dans l''assistant.',
      'support_requests',
      new.id,
      new.requested_by
    );
  end if;
  return new;
end;
$$;

revoke execute on function public.after_support_request_resolved() from public, anon, authenticated;

create trigger support_requests_after_resolved
  after update of status, response
  on support_requests
  for each row
  execute function public.after_support_request_resolved();
