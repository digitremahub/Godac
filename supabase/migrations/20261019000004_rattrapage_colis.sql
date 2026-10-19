-- Audit 19/10/2026 : E7, M13, revue GPT.
-- Rattrapage des objets des migrations GPT jamais appliqués en base, dans
-- leur version unique et définitive :
--   - table delivery_stop_events (20261016000002 + 20261018000001) ;
--   - table driver_pickup_templates (20260101000175 / 20261016000001 +
--     20261018000001), policies restreintes au chauffeur et à l'encadrement ;
--   - colonne users.is_renfort (20261016000004) ;
--   - index unique delivery_runs_planning_entry_id_uidx (20261015000173),
--     vérifié le 19/10/2026 : aucun doublon de planning_entry_id.
-- Fixe aussi les types retenus en base (pickup_addresses jsonb,
-- packages_* integer) pour une base reconstruite depuis le dépôt, où des
-- migrations GPT contradictoires créaient text[] et smallint.
--
-- Vérifié en SELECT le 19/10/2026 : tout le reste (planning_tour_templates,
-- planned_stops, delivery_runs.planning_entry_id, driver_recovery_code_hash,
-- exceptional_pickup, proof_photo_paths, packages_*, kind point_relais) est
-- déjà présent : seuls des `if not exists` le touchent ici.
-- Strictement additif et idempotent ; aucune suppression de policy.

-- ---------------------------------------------------------------------------
-- Colonnes
-- ---------------------------------------------------------------------------
alter table public.users
  add column if not exists is_renfort boolean not null default false;
comment on column public.users.is_renfort is
  'Autorise le chauffeur à sélectionner une tournée de renfort compatible avec ses services et les villages attribués.';

alter table public.delivery_stops
  add column if not exists exceptional_pickup boolean not null default false;
alter table public.delivery_stops
  add column if not exists packages_picked_up integer;
alter table public.delivery_stops
  add column if not exists packages_delivered integer;

do $$
begin
  -- packages_* : integer (smallint dans une ancienne migration GPT).
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'delivery_stops'
      and column_name = 'packages_picked_up' and udt_name = 'int2'
  ) then
    alter table public.delivery_stops alter column packages_picked_up type integer;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'delivery_stops'
      and column_name = 'packages_delivered' and udt_name = 'int2'
  ) then
    alter table public.delivery_stops alter column packages_delivered type integer;
  end if;

  -- pickup_addresses : jsonb (text[] dans 20260101000176).
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tour_route_villages'
      and column_name = 'pickup_addresses' and udt_name = '_text'
  ) then
    alter table public.tour_route_villages alter column pickup_addresses drop default;
    alter table public.tour_route_villages
      alter column pickup_addresses type jsonb using to_jsonb(pickup_addresses);
    alter table public.tour_route_villages alter column pickup_addresses set default '[]'::jsonb;
  end if;
end $$;

alter table public.tour_route_villages
  add column if not exists pickup_addresses jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- Une seule tournée colis par affectation Planning
-- ---------------------------------------------------------------------------
create unique index if not exists delivery_runs_planning_entry_id_uidx
  on public.delivery_runs (planning_entry_id)
  where planning_entry_id is not null;

-- ---------------------------------------------------------------------------
-- delivery_stop_events : journal immuable des événements d'un arrêt
-- ---------------------------------------------------------------------------
create table if not exists public.delivery_stop_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null references public.delivery_runs(id) on delete cascade,
  stop_id uuid not null references public.delivery_stops(id) on delete cascade,
  actor_id uuid references public.users(id) on delete set null,
  event_type text not null,
  previous_value jsonb,
  new_value jsonb,
  details text,
  created_at timestamptz not null default now()
);

-- Types d'événements réellement écrits par app/api/colis/arrets/[id].
alter table public.delivery_stop_events drop constraint if exists delivery_stop_events_event_type_check;
alter table public.delivery_stop_events
  add constraint delivery_stop_events_event_type_check check (event_type in (
    'stop_created', 'status_changed', 'delivered', 'failed', 'reopened',
    'reordered', 'list_changed', 'pickup_count_recorded', 'delivery_count_recorded',
    'sms_prepared', 'sms_confirmed_sent', 'call_started', 'call_confirmed', 'note'
  ));

create index if not exists delivery_stop_events_stop_created_idx
  on public.delivery_stop_events (stop_id, created_at desc);
create index if not exists delivery_stop_events_run_created_idx
  on public.delivery_stop_events (run_id, created_at desc);

alter table public.delivery_stop_events enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'delivery_stop_events'
                 and policyname = 'delivery_stop_events_select_org') then
    create policy delivery_stop_events_select_org on public.delivery_stop_events
      for select using (organization_id = public.current_organization_id());
  else
    alter policy delivery_stop_events_select_org on public.delivery_stop_events
      using (organization_id = public.current_organization_id());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'delivery_stop_events'
                 and policyname = 'delivery_stop_events_insert_org') then
    create policy delivery_stop_events_insert_org on public.delivery_stop_events
      for insert with check (
        organization_id = public.current_organization_id()
        and (actor_id is null or actor_id = auth.uid())
        and exists (
          select 1 from public.delivery_runs r
          where r.id = delivery_stop_events.run_id
            and r.organization_id = delivery_stop_events.organization_id
        )
        and exists (
          select 1 from public.delivery_stops s
          where s.id = delivery_stop_events.stop_id
            and s.run_id = delivery_stop_events.run_id
            and s.organization_id = delivery_stop_events.organization_id
        )
      );
  else
    alter policy delivery_stop_events_insert_org on public.delivery_stop_events
      with check (
        organization_id = public.current_organization_id()
        and (actor_id is null or actor_id = auth.uid())
        and exists (
          select 1 from public.delivery_runs r
          where r.id = delivery_stop_events.run_id
            and r.organization_id = delivery_stop_events.organization_id
        )
        and exists (
          select 1 from public.delivery_stops s
          where s.id = delivery_stop_events.stop_id
            and s.run_id = delivery_stop_events.run_id
            and s.organization_id = delivery_stop_events.organization_id
        )
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- driver_pickup_templates : ramasses habituelles d'un chauffeur.
-- Privées au chauffeur ; l'encadrement de l'organisation peut les gérer.
-- ---------------------------------------------------------------------------
create table if not exists public.driver_pickup_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  driver_id uuid not null references public.users(id) on delete cascade,
  address text not null check (char_length(trim(address)) between 5 and 300),
  recipient text,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, driver_id, address)
);
alter table public.driver_pickup_templates add column if not exists active boolean not null default true;

create index if not exists driver_pickup_templates_driver_idx
  on public.driver_pickup_templates (organization_id, driver_id, active);

alter table public.driver_pickup_templates enable row level security;

do $$
declare
  acces text := '(organization_id = public.current_organization_id()
    and (driver_id = auth.uid() or public.is_manager_like()))';
  ecriture text := '(organization_id = public.current_organization_id()
    and (driver_id = auth.uid() or public.is_manager_like())
    and exists (select 1 from public.users u
                where u.id = driver_pickup_templates.driver_id
                  and u.organization_id = driver_pickup_templates.organization_id))';
  p record;
begin
  -- Policies existantes (versions GPT « _own » ou « _org ») : resserrées.
  for p in
    select policyname, cmd from pg_policies
    where schemaname = 'public' and tablename = 'driver_pickup_templates'
  loop
    if p.cmd = 'SELECT' or p.cmd = 'DELETE' then
      execute format('alter policy %I on public.driver_pickup_templates using %s', p.policyname, acces);
    elsif p.cmd = 'INSERT' then
      execute format('alter policy %I on public.driver_pickup_templates with check %s', p.policyname, ecriture);
    else
      execute format('alter policy %I on public.driver_pickup_templates using %s with check %s', p.policyname, acces, ecriture);
    end if;
  end loop;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'driver_pickup_templates' and cmd = 'SELECT') then
    execute format('create policy driver_pickup_templates_select on public.driver_pickup_templates for select using %s', acces);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'driver_pickup_templates' and cmd = 'INSERT') then
    execute format('create policy driver_pickup_templates_insert on public.driver_pickup_templates for insert with check %s', ecriture);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'driver_pickup_templates' and cmd = 'UPDATE') then
    execute format('create policy driver_pickup_templates_update on public.driver_pickup_templates for update using %s with check %s', acces, ecriture);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'driver_pickup_templates' and cmd = 'DELETE') then
    execute format('create policy driver_pickup_templates_delete on public.driver_pickup_templates for delete using %s', acces);
  end if;
end $$;

notify pgrst, 'reload schema';
