-- Cloche de notifications : lecture par personne. Une alerte destinée
-- à un rôle (tous les managers) a un seul statut partagé ; « lu » doit
-- en revanche rester propre à chacun.
create table if not exists alert_reads (
  alert_id uuid not null references alerts (id) on delete cascade,
  user_id uuid not null references users (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (alert_id, user_id)
);

alter table alert_reads enable row level security;

create policy "alert_reads: own"
  on alert_reads for all
  using (user_id = public.current_app_user_id())
  with check (user_id = public.current_app_user_id());

-- Le chauffeur qui a signalé un problème est prévenu quand sa demande
-- d'entretien change de statut (prise en charge, terminée, annulée).
create or replace function public.notify_intervention_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  reg text;
  svc uuid;
  label text;
begin
  if new.requested_by is null or new.status is not distinct from old.status then
    return new;
  end if;
  select registration, service_id into reg, svc from vehicles where id = new.vehicle_id;
  label := case new.status
    when 'in_progress' then 'prise en charge'
    when 'done' then 'terminée'
    when 'cancelled' then 'annulée'
    else 'planifiée'
  end;
  insert into alerts (organization_id, service_id, type, severity, message, related_table, related_id, recipient_user_id)
  values (
    new.organization_id,
    svc,
    'maintenance_request',
    'info',
    format('Votre demande « %s » (%s) est %s.', new.type, coalesce(reg, 'véhicule'), label),
    'vehicle_interventions',
    new.id,
    new.requested_by
  );
  return new;
end;
$$;

revoke execute on function public.notify_intervention_status() from public, anon, authenticated;

drop trigger if exists vehicle_interventions_status_notify on vehicle_interventions;
create trigger vehicle_interventions_status_notify
  after update of status on vehicle_interventions
  for each row execute function public.notify_intervention_status();
