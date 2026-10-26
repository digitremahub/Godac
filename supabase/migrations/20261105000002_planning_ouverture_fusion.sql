-- Planning : tournée ouverte / fermée, et tournées FUSIONNÉES du lundi.
--
-- 1. Ouverture : planning_entries.tour_open (true par défaut). Une tournée
--    fermée n'accepte plus de changement d'affectation et ne peut plus être
--    démarrée par le chauffeur ; la rouvrir rétablit tout. Rien n'est
--    supprimé (la fiche Tournée colis liée reste intacte). closed_at /
--    closed_by gardent qui a fermé et quand (message « Tournée fermée par … »).
--
-- 2. Fusion : le lundi, plusieurs tournées sont regroupées en une seule ligne
--    de planning. planning_entry_merged_routes liste les tournées d'origine
--    (tour_routes) de cette ligne ; planning_entry_repartition porte la
--    répartition PROVISOIRE de chaque village et de chaque ramasse vers un
--    chauffeur (ou une tournée réelle). Pas de ligne = « À attribuer ».
--    La réconciliation avec les tournées réelles (delivery_runs) met à jour
--    la ligne (statut « confirme ») : calcul dans lib/planning/fusion.ts.
--
-- Migration ADDITIVE et rejouable ; NON appliquée à la création. Le code
-- tolère son absence (colonnes et tables introuvables = tout reste ouvert,
-- aucune fusion), comme pour optim_depart.

set local lock_timeout = '10s';

-- ── 1. Tournée ouverte / fermée ──────────────────────────────────────────
alter table public.planning_entries
  add column if not exists tour_open boolean not null default true,
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references public.users (id) on delete set null;

create index if not exists planning_entries_fermees_idx
  on public.planning_entries (organization_id, start_at)
  where tour_open = false;

-- ── 2. Tournées fusionnées ───────────────────────────────────────────────
create table if not exists public.planning_entry_merged_routes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  planning_entry_id uuid not null references public.planning_entries (id) on delete cascade,
  route_id uuid not null references public.tour_routes (id) on delete cascade,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (planning_entry_id, route_id)
);
create index if not exists planning_entry_merged_routes_route_idx
  on public.planning_entry_merged_routes (route_id);

create table if not exists public.planning_entry_repartition (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  planning_entry_id uuid not null references public.planning_entries (id) on delete cascade,
  -- 'village' (clé = identifiant du village) ou 'ramasse' (clé = « ramasse: » + adresse normalisée).
  kind text not null check (kind in ('village', 'ramasse')),
  element_key text not null,
  element_label text not null,
  -- Cible : un chauffeur et/ou une tournée réelle. Les deux vides = À attribuer.
  driver_id uuid references public.users (id) on delete set null,
  route_id uuid references public.tour_routes (id) on delete set null,
  -- provisoire : saisi avant les tournées réelles ; confirme : aligné sur le réel.
  statut text not null default 'provisoire' check (statut in ('provisoire', 'confirme')),
  updated_by uuid references public.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (planning_entry_id, kind, element_key)
);
create index if not exists planning_entry_repartition_driver_idx
  on public.planning_entry_repartition (driver_id)
  where driver_id is not null;

alter table public.planning_entry_merged_routes enable row level security;
alter table public.planning_entry_repartition enable row level security;

-- Lecture : toute personne qui voit la ligne de planning (la sous-requête
-- passe sous la RLS de planning_entries : un chauffeur ne voit que les siennes).
drop policy if exists "fusion_routes: lecture avec la ligne de planning" on public.planning_entry_merged_routes;
create policy "fusion_routes: lecture avec la ligne de planning"
  on public.planning_entry_merged_routes for select
  using (
    organization_id = public.current_organization_id()
    and exists (select 1 from public.planning_entries e where e.id = planning_entry_id)
  );

drop policy if exists "fusion_routes: encadrement du service écrit" on public.planning_entry_merged_routes;
create policy "fusion_routes: encadrement du service écrit"
  on public.planning_entry_merged_routes for all
  using (
    organization_id = public.current_organization_id()
    and exists (
      select 1 from public.planning_entries e
      where e.id = planning_entry_id
        and (public.est_encadrement_org() or (public.is_manager_like() and e.service_id = any (public.current_user_service_ids())))
    )
  )
  with check (
    organization_id = public.current_organization_id()
    and exists (
      select 1 from public.planning_entries e
      where e.id = planning_entry_id
        and (public.est_encadrement_org() or (public.is_manager_like() and e.service_id = any (public.current_user_service_ids())))
    )
  );

drop policy if exists "fusion_repartition: lecture avec la ligne de planning" on public.planning_entry_repartition;
create policy "fusion_repartition: lecture avec la ligne de planning"
  on public.planning_entry_repartition for select
  using (
    organization_id = public.current_organization_id()
    and exists (select 1 from public.planning_entries e where e.id = planning_entry_id)
  );

drop policy if exists "fusion_repartition: encadrement du service écrit" on public.planning_entry_repartition;
create policy "fusion_repartition: encadrement du service écrit"
  on public.planning_entry_repartition for all
  using (
    organization_id = public.current_organization_id()
    and exists (
      select 1 from public.planning_entries e
      where e.id = planning_entry_id
        and (public.est_encadrement_org() or (public.is_manager_like() and e.service_id = any (public.current_user_service_ids())))
    )
  )
  with check (
    organization_id = public.current_organization_id()
    and exists (
      select 1 from public.planning_entries e
      where e.id = planning_entry_id
        and (public.est_encadrement_org() or (public.is_manager_like() and e.service_id = any (public.current_user_service_ids())))
    )
  );
