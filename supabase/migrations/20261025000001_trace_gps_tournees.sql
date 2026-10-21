-- Tracé GPS réel des tournées colis (fil d'Ariane), pour analyser les
-- trajets dans l'historique (Exploitation › Historique › Tournées colis).
--
-- RGPD (géolocalisation des salariés) : collecte UNIQUEMENT pendant une
-- tournée en cours (status = 'in_progress', entre le démarrage et la
-- clôture), application ouverte et partage de position non mis en pause ;
-- indicateur « Trajet enregistré » visible par le chauffeur ; conservation
-- 1 an (purge quotidienne : lib/retention/purge.ts, cron /api/cron/retention).
--
-- ADDITIVE et idempotente : créations « if not exists », aucune suppression,
-- aucun drop.
--  1. delivery_run_track_points : points (≈ 1 tous les 20 m en roulant,
--     1 toutes les 30 s à l'arrêt, précision ≤ 50 m), envoyés par lots par
--     l'app chauffeur (POST /api/colis/trace).
--  2. RLS : le chauffeur insère pour SA tournée en cours et relit les
--     siennes ; direction et managers (is_manager_like) de l'organisation
--     lisent. Aucune policy update / delete : rien n'est modifiable ni
--     supprimable côté client (la purge passe par le service role).
--  3. Trigger de garde : refuse l'insertion si la tournée n'est pas en
--     cours, n'appartient pas au chauffeur ou à l'organisation indiqués
--     (vaut aussi pour le service role).

-- ── 1. Table ────────────────────────────────────────────────────────
create table if not exists public.delivery_run_track_points (
  id bigserial primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  run_id uuid not null references public.delivery_runs (id) on delete cascade,
  driver_id uuid not null references public.users (id) on delete cascade,
  recorded_at timestamptz not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy real check (accuracy is null or accuracy >= 0),
  speed real check (speed is null or speed >= 0),
  heading real check (heading is null or (heading >= 0 and heading <= 360)),
  created_at timestamptz not null default now()
);

create index if not exists delivery_run_track_points_run_idx on public.delivery_run_track_points (run_id, recorded_at);
-- Purge des points de plus d'un an.
create index if not exists delivery_run_track_points_recorded_idx on public.delivery_run_track_points (recorded_at);

comment on table public.delivery_run_track_points is
  'Tracé GPS réel d''une tournée colis, enregistré seulement pendant la tournée en cours (RGPD). Conservé 1 an (lib/retention/purge.ts).';

-- ── 2. RLS ──────────────────────────────────────────────────────────
alter table public.delivery_run_track_points enable row level security;

-- Ni modification ni suppression côté client (aucune policy ne les permet,
-- et les droits sont retirés en plus).
revoke update, delete, truncate on public.delivery_run_track_points from anon, authenticated;
revoke all on public.delivery_run_track_points from anon;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'delivery_run_track_points'
      and policyname = 'track_points: driver inserts own running run'
  ) then
    create policy "track_points: driver inserts own running run" on public.delivery_run_track_points
      for insert
      with check (
        organization_id = public.current_organization_id()
        and driver_id = public.current_app_user_id()
        and exists (
          select 1 from public.delivery_runs r
          where r.id = run_id
            and r.driver_id = public.current_app_user_id()
            and r.organization_id = public.current_organization_id()
            and r.status = 'in_progress'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'delivery_run_track_points'
      and policyname = 'track_points: driver reads own'
  ) then
    create policy "track_points: driver reads own" on public.delivery_run_track_points
      for select
      using (organization_id = public.current_organization_id() and driver_id = public.current_app_user_id());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'delivery_run_track_points'
      and policyname = 'track_points: manager-like reads organization'
  ) then
    create policy "track_points: manager-like reads organization" on public.delivery_run_track_points
      for select
      using (organization_id = public.current_organization_id() and public.is_manager_like());
  end if;
end $$;

-- ── 3. Trigger de garde ─────────────────────────────────────────────
create or replace function public.garde_trace_gps_tournee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.delivery_runs r
    where r.id = new.run_id
      and r.driver_id = new.driver_id
      and r.organization_id = new.organization_id
      and r.status = 'in_progress'
  ) then
    raise exception 'Tracé GPS refusé : la tournée n''est pas en cours ou n''appartient pas à ce chauffeur.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.garde_trace_gps_tournee() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'delivery_run_track_points_garde'
      and tgrelid = 'public.delivery_run_track_points'::regclass
  ) then
    create trigger delivery_run_track_points_garde
      before insert on public.delivery_run_track_points
      for each row execute function public.garde_trace_gps_tournee();
  end if;
end $$;
