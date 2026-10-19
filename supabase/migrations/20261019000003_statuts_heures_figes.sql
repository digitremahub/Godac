-- Audit 19/10/2026 : E4, E5, M1, M2.
-- Les policies RLS laissent l'auteur d'une ligne (chauffeur, salarié)
-- écrire n'importe quelle valeur dans les colonnes de statut, d'heures ou
-- de décision via l'API REST. Ces triggers figent ces colonnes quand
-- l'auteur n'est pas encadrant (`is_manager_like()`), sans toucher aux
-- écritures du serveur (service role) ni de l'encadrement.
-- Idempotent ; aucune policy supprimée.

-- Vrai pour une requête d'un utilisateur connecté (ou anonyme) via
-- PostgREST ; faux pour le service role et les sessions SQL directes.
create or replace function public.ecriture_utilisateur()
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select coalesce(auth.role(), '') in ('anon', 'authenticated');
$$;

-- ---------------------------------------------------------------------------
-- E4 : planning_entries
-- Parcours chauffeur existants (app/api/tours) :
--   - démarrage : insertion (status in_progress) ou passage planned →
--     in_progress, avec start_at = maintenant et service du véhicule ou
--     d'un service où il est qualifié ;
--   - clôture : passage in_progress → done, avec end_at = maintenant et
--     end_km renseigné.
-- Tout le reste (start_at, service_id, tour_number, end_at, statut) est
-- figé pour un non-encadrant.
-- ---------------------------------------------------------------------------
create or replace function public.planning_entries_guard_author()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  tolerance constant interval := interval '15 minutes';
  service_autorise boolean;
begin
  if not public.ecriture_utilisateur() or public.is_manager_like() then
    return new;
  end if;

  service_autorise := new.service_id is null
    or new.service_id = any(public.current_user_service_ids())
    or exists (
      select 1 from public.vehicles v
      where v.id = new.vehicle_id
        and v.organization_id = new.organization_id
        and v.service_id = new.service_id
    );

  if tg_op = 'INSERT' then
    if new.status is distinct from 'in_progress' then
      raise exception 'Seul l''encadrement peut planifier ou clôturer une tournée.' using errcode = '42501';
    end if;
    if new.start_at is null or abs(extract(epoch from (new.start_at - now()))) > extract(epoch from tolerance) then
      raise exception 'L''heure de départ est celle du démarrage de la tournée.' using errcode = '42501';
    end if;
    if new.end_at is not null then
      raise exception 'L''heure de fin est fixée à la clôture.' using errcode = '42501';
    end if;
    if not service_autorise then
      raise exception 'Service non autorisé pour cette tournée.' using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.tour_number is distinct from old.tour_number then
    raise exception 'Le numéro de tournée est fixé par l''encadrement.' using errcode = '42501';
  end if;

  if old.status = 'planned' and new.status = 'in_progress' then
    -- Démarrage d'une tournée planifiée.
    if new.start_at is distinct from old.start_at
       and (new.start_at is null or abs(extract(epoch from (new.start_at - now()))) > extract(epoch from tolerance)) then
      raise exception 'L''heure de départ est celle du démarrage de la tournée.' using errcode = '42501';
    end if;
    if new.service_id is distinct from old.service_id and not service_autorise then
      raise exception 'Service non autorisé pour cette tournée.' using errcode = '42501';
    end if;
    if new.end_at is distinct from old.end_at then
      raise exception 'L''heure de fin est fixée à la clôture.' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.start_at is distinct from old.start_at then
    raise exception 'L''heure de départ ne peut être modifiée que par l''encadrement.' using errcode = '42501';
  end if;
  if new.service_id is distinct from old.service_id then
    raise exception 'Le service ne peut être modifié que par l''encadrement.' using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'in_progress' and new.status = 'done' then
      -- Clôture (app/api/tours/[id]) : fin à l'instant de la clôture.
      if new.end_at is null or abs(extract(epoch from (new.end_at - now()))) > extract(epoch from tolerance) then
        raise exception 'L''heure de fin est celle de la clôture de la tournée.' using errcode = '42501';
      end if;
      if new.end_km is null then
        raise exception 'Le kilométrage de retour est obligatoire pour clôturer.' using errcode = '42501';
      end if;
      return new;
    end if;
    raise exception 'Ce changement de statut est réservé à l''encadrement.' using errcode = '42501';
  end if;

  if new.end_at is distinct from old.end_at then
    raise exception 'L''heure de fin ne peut être modifiée que par l''encadrement.' using errcode = '42501';
  end if;
  if old.status = 'done' then
    raise exception 'Une tournée clôturée ne peut plus être modifiée que par l''encadrement.' using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists planning_entries_guard_author on public.planning_entries;
create trigger planning_entries_guard_author
  before insert or update on public.planning_entries
  for each row execute function public.planning_entries_guard_author();

-- ---------------------------------------------------------------------------
-- E5 : demandes créées par leur auteur. À l'insertion par un
-- non-encadrant, statut initial forcé à la valeur par défaut et champs de
-- décision vidés (pas d'erreur : les formulaires existants n'envoient
-- jamais ces champs).
-- ---------------------------------------------------------------------------
create or replace function public.leave_requests_guard_author()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if public.ecriture_utilisateur() and not public.is_manager_like() then
    new.status := 'pending';
    new.decided_by := null;
    new.decided_at := null;
    new.replacement_driver_id := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists leave_requests_guard_author on public.leave_requests;
create trigger leave_requests_guard_author
  before insert on public.leave_requests
  for each row execute function public.leave_requests_guard_author();

create or replace function public.vehicle_interventions_guard_author()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if public.ecriture_utilisateur() and not public.is_manager_like() then
    new.status := 'scheduled';
    new.completed_at := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists vehicle_interventions_guard_author on public.vehicle_interventions;
create trigger vehicle_interventions_guard_author
  before insert on public.vehicle_interventions
  for each row execute function public.vehicle_interventions_guard_author();

create or replace function public.support_requests_guard_author()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if public.ecriture_utilisateur() and not public.is_manager_like() then
    new.status := 'open';
    new.assigned_to := null;
    new.response := null;
    new.responded_at := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists support_requests_guard_author on public.support_requests;
create trigger support_requests_guard_author
  before insert on public.support_requests
  for each row execute function public.support_requests_guard_author();

create or replace function public.meeting_requests_guard_author()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if public.ecriture_utilisateur() and not public.is_manager_like() then
    new.status := 'pending';
    new.handled_by := null;
    new.scheduled_at := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists meeting_requests_guard_author on public.meeting_requests;
create trigger meeting_requests_guard_author
  before insert on public.meeting_requests
  for each row execute function public.meeting_requests_guard_author();

create or replace function public.tank_photos_guard_author()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if public.ecriture_utilisateur() and not public.is_manager_like() then
    new.status := 'pending_review';
    new.reviewed_by := null;
    new.reviewed_at := null;
  end if;
  return new;
end;
$function$;

drop trigger if exists tank_photos_guard_author on public.tank_photos;
create trigger tank_photos_guard_author
  before insert on public.tank_photos
  for each row execute function public.tank_photos_guard_author();

-- ---------------------------------------------------------------------------
-- M2 : pointage. Hors direction, l'heure d'arrivée est celle de
-- l'insertion et ne se modifie plus ; l'heure de départ est celle du
-- dépointage.
-- ---------------------------------------------------------------------------
create or replace function public.time_clock_entries_guard_author()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if not public.ecriture_utilisateur() or public.is_direction() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.clocked_in_at := now();
    new.clocked_out_at := null;
    return new;
  end if;
  if new.clocked_in_at is distinct from old.clocked_in_at then
    raise exception 'L''heure d''arrivée ne peut être modifiée que par la direction.' using errcode = '42501';
  end if;
  if new.clocked_out_at is distinct from old.clocked_out_at
     and (new.clocked_out_at is null or abs(extract(epoch from (new.clocked_out_at - now()))) > 900) then
    raise exception 'L''heure de départ est celle du dépointage.' using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists time_clock_entries_guard_author on public.time_clock_entries;
create trigger time_clock_entries_guard_author
  before insert or update on public.time_clock_entries
  for each row execute function public.time_clock_entries_guard_author();

-- ---------------------------------------------------------------------------
-- M1 : une seule entrée de pointage ouverte par utilisateur.
-- Vérifié le 19/10/2026 en SELECT : aucun doublon ouvert en base.
-- ---------------------------------------------------------------------------
create unique index if not exists time_clock_entries_one_open_per_user_uidx
  on public.time_clock_entries (user_id)
  where clocked_out_at is null;
