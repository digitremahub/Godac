-- GODAC V2 — Row Level Security.
--
-- Every tenant table is scoped by organization_id, checked against
-- public.current_organization_id() (resolved from the Clerk JWT).
-- This is the hard boundary: even a frontend bug that forgets a
-- `.eq('organization_id', ...)` filter can never leak another
-- client's rows, because Postgres itself refuses the read/write.
--
-- On top of tenant isolation, role-based policies restrict what each
-- of the 5 roles can see/do, per the spec:
--   chauffeur         -> own fuel_entries / leave_requests / planning only
--   manager            -> read/write scoped to their service(s)
--   manager_chauffeur  -> union of manager + chauffeur
--   comptable          -> read-only (exports, invoices), no operational writes
--   direction          -> full access within the organisation
--
-- The service_role key (used by webhooks and admin jobs) bypasses RLS
-- entirely and is never exposed to the browser.

alter table organizations enable row level security;
alter table services enable row level security;
alter table users enable row level security;
alter table user_services enable row level security;
alter table vehicles enable row level security;
alter table tanks enable row level security;
alter table fuel_entries enable row level security;
alter table fuel_price_history enable row level security;
alter table alerts enable row level security;
alter table planning_entries enable row level security;
alter table vehicle_interventions enable row level security;
alter table fines enable row level security;
alter table leave_requests enable row level security;
alter table ticpe_exports enable row level security;

-- ── organizations ───────────────────────────────────────────────
create policy "org: members can read their own org"
  on organizations for select
  using (id = public.current_organization_id());

create policy "org: direction can update their own org"
  on organizations for update
  using (id = public.current_organization_id() and public.is_direction());

-- ── services ─────────────────────────────────────────────────────
create policy "services: members read within org"
  on services for select
  using (organization_id = public.current_organization_id());

create policy "services: manager-like write within org"
  on services for all
  using (organization_id = public.current_organization_id() and public.is_manager_like())
  with check (organization_id = public.current_organization_id() and public.is_manager_like());

-- ── users ────────────────────────────────────────────────────────
create policy "users: read within org"
  on users for select
  using (organization_id = public.current_organization_id());

create policy "users: self update"
  on users for update
  using (organization_id = public.current_organization_id() and id = public.current_app_user_id());

create policy "users: direction manages members"
  on users for all
  using (organization_id = public.current_organization_id() and public.is_direction())
  with check (organization_id = public.current_organization_id() and public.is_direction());

-- ── user_services ────────────────────────────────────────────────
create policy "user_services: read within org"
  on user_services for select
  using (
    exists (
      select 1 from users u
      where u.id = user_services.user_id
        and u.organization_id = public.current_organization_id()
    )
  );

create policy "user_services: direction manages"
  on user_services for all
  using (
    public.is_direction()
    and exists (
      select 1 from users u
      where u.id = user_services.user_id
        and u.organization_id = public.current_organization_id()
    )
  );

-- ── vehicles ─────────────────────────────────────────────────────
create policy "vehicles: read within org"
  on vehicles for select
  using (organization_id = public.current_organization_id());

create policy "vehicles: manager-like write scoped to service"
  on vehicles for all
  using (
    organization_id = public.current_organization_id()
    and (
      public.is_direction()
      or (public.is_manager_like() and vehicles.service_id = any (public.current_user_service_ids()))
    )
  )
  with check (
    organization_id = public.current_organization_id()
    and (
      public.is_direction()
      or (public.is_manager_like() and vehicles.service_id = any (public.current_user_service_ids()))
    )
  );

-- ── tanks ────────────────────────────────────────────────────────
create policy "tanks: read within org"
  on tanks for select
  using (organization_id = public.current_organization_id());

create policy "tanks: manager-like write scoped to service"
  on tanks for all
  using (
    organization_id = public.current_organization_id()
    and (
      public.is_direction()
      or (public.is_manager_like() and tanks.service_id = any (public.current_user_service_ids()))
    )
  )
  with check (
    organization_id = public.current_organization_id()
    and (
      public.is_direction()
      or (public.is_manager_like() and tanks.service_id = any (public.current_user_service_ids()))
    )
  );

-- ── fuel_entries ─────────────────────────────────────────────────
-- A chauffeur only ever sees their own refuelling. manager/manager_
-- chauffeur see entries for vehicles in their service(s). comptable
-- and direction see the whole organisation (comptable read-only).
create policy "fuel_entries: chauffeur reads own"
  on fuel_entries for select
  using (
    organization_id = public.current_organization_id()
    and (
      driver_id = public.current_app_user_id()
      or public.current_role() in ('comptable', 'direction')
      or (
        public.is_manager_like()
        and exists (
          select 1 from vehicles v
          where v.id = fuel_entries.vehicle_id
            and v.service_id = any (public.current_user_service_ids())
        )
      )
    )
  );

create policy "fuel_entries: chauffeur inserts own"
  on fuel_entries for insert
  with check (
    organization_id = public.current_organization_id()
    and (
      driver_id = public.current_app_user_id()
      or (
        public.is_manager_like()
        and exists (
          select 1 from vehicles v
          where v.id = fuel_entries.vehicle_id
            and v.service_id = any (public.current_user_service_ids())
        )
      )
      or public.is_direction()
    )
  );

-- Chauffeurs may correct their own entry only before it has been
-- validated; managers/direction can validate/edit within their scope.
create policy "fuel_entries: update own unvalidated or manager scope"
  on fuel_entries for update
  using (
    organization_id = public.current_organization_id()
    and (
      (driver_id = public.current_app_user_id() and validated_at is null)
      or public.is_direction()
      or (
        public.is_manager_like()
        and exists (
          select 1 from vehicles v
          where v.id = fuel_entries.vehicle_id
            and v.service_id = any (public.current_user_service_ids())
        )
      )
    )
  );

-- ── fuel_price_history ───────────────────────────────────────────
-- Read-only, system-populated (trigger runs as table owner). No
-- insert/update/delete policy is defined, so only the service role
-- (or a security-definer trigger) can ever write here.
create policy "fuel_price_history: read within org"
  on fuel_price_history for select
  using (organization_id = public.current_organization_id());

-- ── alerts ───────────────────────────────────────────────────────
create policy "alerts: read within org for manager-like and comptable"
  on alerts for select
  using (
    organization_id = public.current_organization_id()
    and public.current_role() in ('manager', 'manager_chauffeur', 'direction', 'comptable')
  );

create policy "alerts: manager-like can acknowledge"
  on alerts for update
  using (
    organization_id = public.current_organization_id()
    and public.current_role() in ('manager', 'manager_chauffeur', 'direction')
  );

-- ── planning_entries ─────────────────────────────────────────────
create policy "planning: read within org"
  on planning_entries for select
  using (
    organization_id = public.current_organization_id()
    and (
      driver_id = public.current_app_user_id()
      or public.current_role() in ('comptable', 'direction')
      or (public.is_manager_like() and service_id = any (public.current_user_service_ids()))
    )
  );

create policy "planning: manager-like writes scoped to service"
  on planning_entries for all
  using (
    organization_id = public.current_organization_id()
    and (public.is_direction() or (public.is_manager_like() and service_id = any (public.current_user_service_ids())))
  )
  with check (
    organization_id = public.current_organization_id()
    and (public.is_direction() or (public.is_manager_like() and service_id = any (public.current_user_service_ids())))
  );

-- ── vehicle_interventions ────────────────────────────────────────
create policy "interventions: read within org"
  on vehicle_interventions for select
  using (organization_id = public.current_organization_id());

create policy "interventions: manager-like write scoped to service"
  on vehicle_interventions for all
  using (
    organization_id = public.current_organization_id()
    and (
      public.is_direction()
      or (
        public.is_manager_like()
        and exists (
          select 1 from vehicles v
          where v.id = vehicle_interventions.vehicle_id
            and v.service_id = any (public.current_user_service_ids())
        )
      )
    )
  );

-- ── fines ────────────────────────────────────────────────────────
create policy "fines: read within org"
  on fines for select
  using (
    organization_id = public.current_organization_id()
    and (
      driver_id = public.current_app_user_id()
      or public.current_role() in ('comptable', 'direction')
      or (
        public.is_manager_like()
        and exists (
          select 1 from vehicles v
          where v.id = fines.vehicle_id
            and v.service_id = any (public.current_user_service_ids())
        )
      )
    )
  );

create policy "fines: manager-like write"
  on fines for all
  using (
    organization_id = public.current_organization_id()
    and public.is_manager_like()
  );

-- ── leave_requests ───────────────────────────────────────────────
create policy "leave: chauffeur reads own, manager reads service"
  on leave_requests for select
  using (
    organization_id = public.current_organization_id()
    and (
      driver_id = public.current_app_user_id()
      or public.current_role() = 'direction'
      or (public.is_manager_like() and service_id = any (public.current_user_service_ids()))
    )
  );

create policy "leave: chauffeur creates own request"
  on leave_requests for insert
  with check (
    organization_id = public.current_organization_id()
    and driver_id = public.current_app_user_id()
  );

create policy "leave: manager-like decides within service"
  on leave_requests for update
  using (
    organization_id = public.current_organization_id()
    and (public.current_role() = 'direction' or (public.is_manager_like() and service_id = any (public.current_user_service_ids())))
  );

-- ── ticpe_exports ────────────────────────────────────────────────
-- Comptable and direction only, per spec ("téléchargeable en
-- self-service par le rôle Comptable").
create policy "ticpe: comptable and direction read"
  on ticpe_exports for select
  using (
    organization_id = public.current_organization_id()
    and public.current_role() in ('comptable', 'direction')
  );

create policy "ticpe: comptable and direction generate"
  on ticpe_exports for insert
  with check (
    organization_id = public.current_organization_id()
    and public.current_role() in ('comptable', 'direction')
  );
