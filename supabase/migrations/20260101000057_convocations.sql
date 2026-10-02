-- GODAC V2 — convocations: direction/chefs d'équipe summoning an
-- employee (disciplinary, briefing, etc.) — the inverse direction of
-- meeting_requests (20260101000046), where the employee is the one
-- asking. Same table-per-concept split as that migration rather than
-- overloading one table with a "who initiated it" flag.
create type convocation_status as enum ('scheduled', 'done', 'cancelled');

create table convocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  employee_id uuid not null references users (id) on delete cascade,
  convened_by uuid not null references users (id) on delete cascade,
  reason text not null,
  scheduled_at timestamptz,
  location text,
  status convocation_status not null default 'scheduled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index convocations_org_idx on convocations (organization_id, employee_id);

create trigger convocations_set_updated_at
  before update on convocations
  for each row execute function set_updated_at();

alter table convocations enable row level security;

create policy "convocations: employee reads own"
  on convocations for select
  using (organization_id = public.current_organization_id() and employee_id = public.current_app_user_id());

create policy "convocations: manager-like manages"
  on convocations for all
  using (organization_id = public.current_organization_id() and public.is_manager_like())
  with check (organization_id = public.current_organization_id() and public.is_manager_like());
