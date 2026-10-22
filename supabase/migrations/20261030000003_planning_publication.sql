-- Planning : « Publier aux chauffeurs » regroupe les notifications
-- (lib/planning/publication.ts, app/api/planning/publier).
--
-- Avant : semaine non validée → silence ; semaine validée → UNE alerte par
-- changement (after_planning_entry_upsert), et rien pour le chauffeur à qui
-- l'on retire une tournée.
-- Désormais, une fois la semaine publiée (planning_validations) :
-- - changement pour aujourd'hui ou demain (heure de Paris) : alerte
--   immédiate, comme avant (urgent), y compris au chauffeur retiré ;
-- - changement plus lointain : rangé dans planning_changements ; la
--   publication suivante envoie UN récapitulatif par chauffeur touché
--   (ajouts, modifications, retraits) puis vide ces lignes.
-- Semaine pas encore publiée : silence, comme avant.
--
-- ADDITIF : une table, deux fonctions (dont after_planning_entry_upsert
-- remplacée avec la même signature, le même security definer et le même
-- search_path que 20261019000006), un trigger après suppression. Aucune
-- donnée modifiée, aucune policy retirée. Rejouable. Le code tolère
-- l'absence de la table (estSchemaManquant) : la publication envoie alors
-- le récapitulatif à tous les chauffeurs de la période.

set local lock_timeout = '10s';

-- ── 1. Changements en attente de publication ──────────────────────────
create table if not exists public.planning_changements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  service_id uuid references public.services (id) on delete cascade,
  driver_id uuid not null references public.users (id) on delete cascade,
  -- Pas de clé étrangère : l'affectation peut avoir été supprimée (retrait).
  planning_entry_id uuid,
  tour_number text not null,
  start_at timestamptz not null,
  nature text not null constraint planning_changements_nature_check check (nature in ('ajout', 'modif', 'retrait')),
  created_at timestamptz not null default now()
);
create index if not exists planning_changements_org_start_idx on public.planning_changements (organization_id, start_at);
create index if not exists planning_changements_driver_idx on public.planning_changements (driver_id);

alter table public.planning_changements enable row level security;

-- Lecture : l'encadrement (managers sur leurs services, exploitation et
-- direction sur l'organisation). Écriture : le trigger (security definer)
-- et la publication (client service role), aucune policy d'écriture.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'planning_changements' and policyname = 'planning_changements: encadrement read') then
    create policy "planning_changements: encadrement read" on public.planning_changements
      for select using (
        organization_id = public.current_organization_id()
        and (public.est_encadrement_org() or (public.is_manager_like() and service_id = any (public.current_user_service_ids())))
      );
  end if;
end $$;

-- ── 2. Ajout / modification / retrait d'un chauffeur ──────────────────
create or replace function public.after_planning_entry_upsert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_registration text;
  v_publiee boolean;
  v_demain date := (now() at time zone 'Europe/Paris')::date + 1;
begin
  -- Chauffeur placé (nouvelle affectation, autre chauffeur, autre véhicule, autre heure).
  if new.status = 'planned' and new.driver_id is not null and (
    tg_op = 'INSERT'
    or new.driver_id is distinct from old.driver_id
    or new.vehicle_id is distinct from old.vehicle_id
    or new.start_at is distinct from old.start_at
  ) then
    select exists(
      select 1 from planning_validations
      where organization_id = new.organization_id
        and service_id = new.service_id
        and week_start = (date_trunc('week', new.start_at at time zone 'Europe/Paris'))::date
    ) into v_publiee;

    if v_publiee then
      if (new.start_at at time zone 'Europe/Paris')::date <= v_demain then
        if new.vehicle_id is not null then
          select registration into v_registration from vehicles where id = new.vehicle_id;
        end if;
        insert into alerts (organization_id, type, severity, message, related_table, related_id, recipient_user_id)
        values (
          new.organization_id,
          'planning_assignment',
          'info',
          format(
            'Tournée n°%s prévue le %s%s',
            new.tour_number,
            to_char(new.start_at at time zone 'Europe/Paris', 'DD/MM/YYYY à HH24:MI'),
            case when v_registration is not null then ' — véhicule ' || v_registration else '' end
          ),
          'planning_entries',
          new.id,
          new.driver_id
        );
      else
        insert into planning_changements (organization_id, service_id, driver_id, planning_entry_id, tour_number, start_at, nature)
        values (
          new.organization_id, new.service_id, new.driver_id, new.id, new.tour_number, new.start_at,
          case when tg_op = 'INSERT' or new.driver_id is distinct from old.driver_id then 'ajout' else 'modif' end
        );
      end if;
    end if;
  end if;

  -- Chauffeur retiré (remplacé ou enlevé) : il est prévenu aussi.
  if tg_op = 'UPDATE' and old.status = 'planned' and old.driver_id is not null and old.driver_id is distinct from new.driver_id then
    select exists(
      select 1 from planning_validations
      where organization_id = old.organization_id
        and service_id = old.service_id
        and week_start = (date_trunc('week', old.start_at at time zone 'Europe/Paris'))::date
    ) into v_publiee;

    if v_publiee then
      if (old.start_at at time zone 'Europe/Paris')::date <= v_demain then
        insert into alerts (organization_id, type, severity, message, related_table, related_id, recipient_user_id)
        values (
          old.organization_id,
          'planning_assignment',
          'info',
          format('Tournée n°%s du %s retirée de votre planning', old.tour_number, to_char(old.start_at at time zone 'Europe/Paris', 'DD/MM/YYYY à HH24:MI')),
          'planning_entries',
          old.id,
          old.driver_id
        );
      else
        insert into planning_changements (organization_id, service_id, driver_id, planning_entry_id, tour_number, start_at, nature)
        values (old.organization_id, old.service_id, old.driver_id, old.id, old.tour_number, old.start_at, 'retrait');
      end if;
    end if;
  end if;

  return new;
end;
$function$;

-- ── 3. Affectation supprimée ──────────────────────────────────────────
create or replace function public.after_planning_entry_delete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_publiee boolean;
begin
  if old.status = 'planned' and old.driver_id is not null then
    select exists(
      select 1 from planning_validations
      where organization_id = old.organization_id
        and service_id = old.service_id
        and week_start = (date_trunc('week', old.start_at at time zone 'Europe/Paris'))::date
    ) into v_publiee;

    if v_publiee then
      if (old.start_at at time zone 'Europe/Paris')::date <= (now() at time zone 'Europe/Paris')::date + 1 then
        insert into alerts (organization_id, type, severity, message, related_table, recipient_user_id)
        values (
          old.organization_id,
          'planning_assignment',
          'info',
          format('Tournée n°%s du %s retirée de votre planning', old.tour_number, to_char(old.start_at at time zone 'Europe/Paris', 'DD/MM/YYYY à HH24:MI')),
          'planning_entries',
          old.driver_id
        );
      else
        insert into planning_changements (organization_id, service_id, driver_id, planning_entry_id, tour_number, start_at, nature)
        values (old.organization_id, old.service_id, old.driver_id, old.id, old.tour_number, old.start_at, 'retrait');
      end if;
    end if;
  end if;
  return old;
end;
$function$;

drop trigger if exists planning_entries_after_delete_publication on public.planning_entries;
create trigger planning_entries_after_delete_publication
  after delete on public.planning_entries
  for each row execute function public.after_planning_entry_delete();

notify pgrst, 'reload schema';
