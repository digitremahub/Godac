-- GODAC V2 — Intranet : un salarié peut demander un rendez-vous
-- (entretien avec la direction/un responsable) au lieu de l'inverse
-- uniquement (announcements/convocations, qui vont déjà manager-like
-- -> tout le monde). Même table pour tout le monde plutôt qu'une par
-- rôle : direction/manager-like la font passer de 'pending' à
-- 'scheduled'/'declined'/'done', le salarié ne voit/crée que la sienne
-- — mêmes policies "own or manager-like" que announcement_reads.
create type meeting_request_status as enum ('pending', 'scheduled', 'declined', 'done');

create table meeting_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  requested_by uuid not null references users (id) on delete cascade,
  reason text not null,
  preferred_date date,
  status meeting_request_status not null default 'pending',
  scheduled_at timestamptz,
  handled_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index meeting_requests_organization_id_idx on meeting_requests (organization_id, status);

create trigger meeting_requests_set_updated_at
  before update on meeting_requests
  for each row execute function set_updated_at();

alter table meeting_requests enable row level security;

create policy "meeting_requests: own or manager-like reads"
  on meeting_requests for select
  using (
    organization_id = public.current_organization_id()
    and (requested_by = public.current_app_user_id() or public.is_manager_like())
  );

create policy "meeting_requests: any member requests"
  on meeting_requests for insert
  with check (organization_id = public.current_organization_id() and requested_by = public.current_app_user_id());

create policy "meeting_requests: manager-like updates"
  on meeting_requests for update
  using (organization_id = public.current_organization_id() and public.is_manager_like())
  with check (organization_id = public.current_organization_id() and public.is_manager_like());
