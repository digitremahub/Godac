-- GODAC V2 — les chefs d'équipe voulaient construire le planning de la
-- semaine sans que chaque ajout/modif notifie immédiatement le
-- chauffeur (c'est ce que fait after_planning_entry_upsert,
-- 20260101000030, depuis le début) : un seul envoi groupé, au moment
-- où ils valident la semaine. Cette table retient, par service et
-- semaine, l'instant de validation ; le trigger ci-dessous s'en sert
-- pour rester silencieux tant que la semaine n'est pas validée, puis
-- recommence à notifier à chaque changement une fois validée (une
-- modif après l'envoi doit prévenir le chauffeur concerné).
create table planning_validations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  service_id uuid not null references services(id) on delete cascade,
  week_start date not null,
  validated_at timestamptz not null default now(),
  validated_by uuid not null references users(id),
  unique (organization_id, service_id, week_start)
);

alter table planning_validations enable row level security;

create policy "planning_validations: read within org"
  on planning_validations for select
  using (organization_id = public.current_organization_id());

-- Volontairement 'manager' seul (pas manager_chauffeur) + direction —
-- choix explicite du client, la validation/envoi du planning reste une
-- décision de chef de service ou de direction.
create policy "planning_validations: manager+direction write scoped to service"
  on planning_validations for all
  using (
    organization_id = public.current_organization_id()
    and (public.is_direction() or (public.current_role() = 'manager' and service_id = any (public.current_user_service_ids())))
  )
  with check (
    organization_id = public.current_organization_id()
    and (public.is_direction() or (public.current_role() = 'manager' and service_id = any (public.current_user_service_ids())))
  );

create or replace function public.after_planning_entry_upsert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
        and week_start = (date_trunc('week', new.start_at at time zone 'utc'))::date
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
          to_char(new.start_at, 'DD/MM/YYYY à HH24:MI'),
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
$$;
