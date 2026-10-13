-- Tournée colis : horaires d'ouverture des adresses professionnelles.
--
-- 1. Annuaire des horaires par entreprise (delivery_address_hours), indexé
--    par l'adresse normalisée (cleAdresse, lib/colis/serveur.ts) : saisi
--    une fois par un chauffeur ou l'encadrement, il s'applique
--    automatiquement dès que la même adresse revient dans une tournée.
--    weekly_schedule : { "1": [{"open":"08:00","close":"12:00"},
--    {"open":"14:00","close":"18:00"}], …, "7": [] } — jours ISO (1 = lundi,
--    7 = dimanche), 0 à 2 créneaux par jour, tableau vide = fermé, jour
--    absent = pas de contrainte connue.
-- 2. Créneau ponctuel sur un arrêt (window_start / window_end, ex.
--    « avant 10 h ») : prioritaire sur l'annuaire pour cet arrêt.
-- 3. Heure de départ prévue d'une tournée (planned_start), base du calcul
--    des heures d'arrivée avant le départ réel (08:00 par défaut).
--
-- Migration non destructive : création de table, d'index, de politiques
-- et ajout de colonnes nullables uniquement.

create table if not exists delivery_address_hours (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  address_key text not null,
  label text,
  address text not null,
  weekly_schedule jsonb not null default '{}'::jsonb,
  notes text,
  updated_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, address_key)
);

alter table delivery_address_hours enable row level security;

-- Lecture : toute l'entreprise (les tournées de chaque chauffeur en profitent).
create policy "delivery_address_hours: read within organization"
  on delivery_address_hours for select
  using (organization_id = public.current_organization_id());

-- Écriture : chauffeurs et encadrement de l'entreprise (pas la comptabilité).
create policy "delivery_address_hours: insert by drivers or manager-like"
  on delivery_address_hours for insert
  with check (
    organization_id = public.current_organization_id()
    and (public.current_role() in ('chauffeur', 'manager_chauffeur') or public.is_manager_like())
  );

create policy "delivery_address_hours: update by drivers or manager-like"
  on delivery_address_hours for update
  using (
    organization_id = public.current_organization_id()
    and (public.current_role() in ('chauffeur', 'manager_chauffeur') or public.is_manager_like())
  )
  with check (
    organization_id = public.current_organization_id()
    and (public.current_role() in ('chauffeur', 'manager_chauffeur') or public.is_manager_like())
  );

create policy "delivery_address_hours: delete by drivers or manager-like"
  on delivery_address_hours for delete
  using (
    organization_id = public.current_organization_id()
    and (public.current_role() in ('chauffeur', 'manager_chauffeur') or public.is_manager_like())
  );

alter table delivery_stops add column if not exists window_start time;
alter table delivery_stops add column if not exists window_end time;

alter table delivery_runs add column if not exists planned_start time;
