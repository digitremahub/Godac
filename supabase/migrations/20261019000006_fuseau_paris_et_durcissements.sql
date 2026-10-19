-- Audit 19/10/2026 : M14 (fuseau Europe/Paris), M6 (Storage fine-photos),
-- M18 (jeton d'inscription chauffeur lisible par tous).
-- Idempotent ; aucune policy supprimée.

-- ---------------------------------------------------------------------------
-- M14 : notification d'affectation. Semaine validée et heure affichée en
-- heure de Paris (une tournée du lundi entre 00h et 02h était rattachée à
-- la semaine précédente, et l'heure affichée décalée de 1 à 2 h).
-- ---------------------------------------------------------------------------
create or replace function public.after_planning_entry_upsert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_registration text;
  v_is_validated boolean;
begin
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
    ) into v_is_validated;

    if v_is_validated then
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
    end if;
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- M6 : la policy « manager-like uploads » ne contrôlait pas le rôle. Seule
-- la direction saisit une amende (app/(dashboard)/fines) ; l'encadrement
-- reste autorisé, conformément au nom de la policy.
-- ---------------------------------------------------------------------------
alter policy "fine-photos: manager-like uploads within org" on storage.objects
  with check (
    bucket_id = 'fine-photos'
    and (storage.foldername(name))[1] = (public.current_organization_id())::text
    and public.is_manager_like()
  );

-- ---------------------------------------------------------------------------
-- M3 : une seule fiche « Tournée colis » ouverte par chauffeur et par jour
-- (double clic = deux fiches). Vérifié le 19/10/2026 en SELECT : aucun
-- doublon de fiche non clôturée en base. app/api/colis/tournees reprend la
-- fiche existante en cas de conflit.
-- ---------------------------------------------------------------------------
create unique index if not exists delivery_runs_driver_open_day_uidx
  on public.delivery_runs (organization_id, driver_id, run_date)
  where status <> 'done';
