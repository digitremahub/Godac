-- The "nouvelle demande" alert (broadcast to managers/direction) and
-- the "votre question a reçu une réponse" alert (personal, to the
-- original requester — any role, including chauffeur) shared the same
-- type 'support_request', so lib/alerts/resolve-url.ts could only
-- resolve both to the same destination: /support, which is gated to
-- manager-like/direction. A chauffeur notified that their own question
-- was answered hit "cette page est réservée aux gestionnaires et à la
-- direction" instead of ever seeing the answer — the trigger's own
-- comment already said this should open "dans l'assistant" (the
-- floating chat widget, available to every role on every page), not
-- /support. Splitting the type lets the two alerts resolve separately.
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
      'support_request_resolved',
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
