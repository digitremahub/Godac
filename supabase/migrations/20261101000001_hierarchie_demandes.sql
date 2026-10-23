-- Hiérarchie des demandes et des décisions (défense en profondeur).
--
-- Règle (miroir de lib/hierarchie/demandes.ts, l'application contrôle déjà
-- la même chose avec un message clair) :
--   chauffeur (0) < manager (1) < exploitation (2) < direction (3).
--   1. Personne ne décide la demande qui le concerne, sauf une direction
--      seule dans l'organisation (sinon le patron serait bloqué ; l'API
--      écrit alors « auto-validée (direction unique) » au journal d'audit).
--   2. Le décideur a un rang strictement supérieur à celui du demandeur ;
--      la direction décide pour une autre personne de la direction.
--   3. Le comptable n'est pas dans la chaîne : il ne décide que sur la
--      paie (acomptes, bulletins, arrêts), jamais pour lui-même.
--   4. Les écritures sans utilisateur (clé service : cron, API serveur
--      avec le client service) restent permises.
-- Le périmètre de service d'un manager reste porté par la RLS existante.
--
-- Contenu : fonctions rang_role / est_direction_unique /
-- verifier_decision_hierarchie / destinataires_hierarchie, un trigger
-- BEFORE par table de demandes (congés, arrêts, acomptes, bulletins,
-- amendes, contestations, entretien, demandes au loueur, rendez-vous,
-- assistance, convocations, traitement des écarts carburant), et le
-- routage des alertes de création (rendez-vous, assistance, entretien,
-- acompte) vers le niveau juste au-dessus du demandeur.
--
-- ADDITIVE : aucun drop, aucune suppression ; create or replace seulement.
-- Rejouable. L'application tolère l'absence de cette migration.

-- 1. Fonctions d'aide -----------------------------------------------------

-- Rang d'un rôle. Le comptable (hors chaîne) vaut 2 comme demandeur : seule
-- la direction décide pour lui. L'ancien manager_chauffeur vaut un manager.
create or replace function public.rang_role(p_role text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case p_role
    when 'chauffeur' then 0
    when 'manager' then 1
    when 'manager_chauffeur' then 1
    when 'exploitation' then 2
    when 'comptable' then 2
    when 'direction' then 3
    else 0
  end;
$$;

-- Une seule personne (active) en direction dans l'organisation ?
create or replace function public.est_direction_unique(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    select count(*) from public.users u
    where u.organization_id = p_org
      and u.role::text = 'direction'
      and u.active
      and not coalesce(u.pending_approval, false)
  ) <= 1;
$$;

-- Contrôle commun : l'utilisateur courant peut-il décider la demande de
-- p_demandeur ? Lève une erreur (42501) en français sinon. p_paie : décision
-- de paie que le comptable garde. Sans utilisateur (clé service) : permis.
create or replace function public.verifier_decision_hierarchie(p_demandeur uuid, p_paie boolean default false)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_moi uuid := auth.uid();
  v_role_moi text;
  v_role_dem text;
  v_org uuid;
begin
  if v_moi is null or not public.ecriture_utilisateur() or p_demandeur is null then
    return;
  end if;

  select u.role::text, u.organization_id into v_role_moi, v_org from public.users u where u.id = v_moi;
  if v_role_moi is null then
    return;
  end if;
  select u.role::text into v_role_dem from public.users u where u.id = p_demandeur;
  v_role_dem := coalesce(v_role_dem, 'chauffeur');

  if p_demandeur = v_moi then
    if v_role_moi = 'direction' and public.est_direction_unique(v_org) then
      return;
    end if;
    raise exception 'Vous ne pouvez pas décider de votre propre demande : elle doit être traitée par l''exploitation ou la direction.' using errcode = '42501';
  end if;

  if v_role_moi = 'comptable' then
    if p_paie then
      return;
    end if;
    raise exception 'Le comptable ne décide pas des demandes opérationnelles.' using errcode = '42501';
  end if;

  if v_role_moi = 'direction' and v_role_dem = 'direction' then
    return;
  end if;
  if public.rang_role(v_role_moi) <= public.rang_role(v_role_dem) then
    raise exception 'Cette demande doit être traitée par un rôle de rang supérieur (exploitation ou direction).' using errcode = '42501';
  end if;
end;
$$;

-- Destinataires d'une demande : le niveau juste au-dessus du demandeur,
-- jamais lui-même ni un pair, avec escalade si ce niveau est vide.
--   chauffeur  : managers de ses services (sans service : tous), puis
--                exploitation, puis direction ;
--   manager    : exploitation et direction ;
--   autres     : direction (les autres membres si le demandeur en est un).
create or replace function public.destinataires_hierarchie(p_demandeur uuid)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_role text;
  v_ids uuid[];
begin
  select u.organization_id, u.role::text into v_org, v_role from public.users u where u.id = p_demandeur;
  if v_org is null then
    return;
  end if;
  if v_role = 'manager_chauffeur' then
    v_role := 'manager';
  end if;

  if v_role = 'chauffeur' then
    select array_agg(u.id) into v_ids
    from public.users u
    where u.organization_id = v_org and u.active and not coalesce(u.pending_approval, false)
      and u.id <> p_demandeur
      and u.role::text in ('manager', 'manager_chauffeur')
      and (
        not exists (select 1 from public.user_services s where s.user_id = p_demandeur)
        or exists (
          select 1 from public.user_services a
          join public.user_services b on b.service_id = a.service_id
          where a.user_id = u.id and b.user_id = p_demandeur
        )
      );
    if v_ids is not null then
      return query select unnest(v_ids);
      return;
    end if;
    select array_agg(u.id) into v_ids
    from public.users u
    where u.organization_id = v_org and u.active and not coalesce(u.pending_approval, false)
      and u.id <> p_demandeur and u.role::text = 'exploitation';
    if v_ids is not null then
      return query select unnest(v_ids);
      return;
    end if;
    select array_agg(u.id) into v_ids
    from public.users u
    where u.organization_id = v_org and u.active and not coalesce(u.pending_approval, false)
      and u.id <> p_demandeur and u.role::text = 'direction';
    if v_ids is not null then
      return query select unnest(v_ids);
    end if;
    return;
  end if;

  if v_role = 'manager' then
    return query
      select u.id from public.users u
      where u.organization_id = v_org and u.active and not coalesce(u.pending_approval, false)
        and u.id <> p_demandeur and u.role::text in ('exploitation', 'direction');
    return;
  end if;

  -- Exploitation, comptable, direction : la direction (pas soi-même).
  return query
    select u.id from public.users u
    where u.organization_id = v_org and u.active and not coalesce(u.pending_approval, false)
      and u.id <> p_demandeur and u.role::text = 'direction';
end;
$$;

revoke execute on function public.est_direction_unique(uuid) from public, anon, authenticated;
revoke execute on function public.verifier_decision_hierarchie(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.destinataires_hierarchie(uuid) from public, anon, authenticated;

-- 2. Congés : approuver / refuser -------------------------------------------
create or replace function public.leave_requests_hierarchie()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    perform public.verifier_decision_hierarchie(old.driver_id);
  end if;
  return new;
end;
$$;
revoke execute on function public.leave_requests_hierarchie() from public, anon, authenticated;

create or replace trigger leave_requests_hierarchie
  before update on public.leave_requests
  for each row execute function public.leave_requests_hierarchie();

-- 3. Arrêts de travail : valider / refuser (saisie directement validée comprise)
create or replace function public.work_stoppages_hierarchie()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status in ('valide', 'refuse') then
      perform public.verifier_decision_hierarchie(new.user_id, true);
    end if;
  elsif new.status is distinct from old.status and new.status in ('valide', 'refuse') then
    perform public.verifier_decision_hierarchie(old.user_id, true);
  end if;
  return new;
end;
$$;
revoke execute on function public.work_stoppages_hierarchie() from public, anon, authenticated;

create or replace trigger work_stoppages_hierarchie
  before insert or update on public.work_stoppages
  for each row execute function public.work_stoppages_hierarchie();

-- 4. Acomptes : accepter, refuser, préparer, verser (l'auteur peut annuler) --
create or replace function public.salary_advance_requests_hierarchie()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status
     and not (new.status = 'annulee' and old.user_id = auth.uid()) then
    perform public.verifier_decision_hierarchie(old.user_id, true);
  elsif new.amount_granted is distinct from old.amount_granted or new.paid_at is distinct from old.paid_at then
    perform public.verifier_decision_hierarchie(old.user_id, true);
  end if;
  return new;
end;
$$;
revoke execute on function public.salary_advance_requests_hierarchie() from public, anon, authenticated;

create or replace trigger salary_advance_requests_hierarchie
  before update on public.salary_advance_requests
  for each row execute function public.salary_advance_requests_hierarchie();

-- 5. Bulletins : valider / refuser (direction) -------------------------------
create or replace function public.payslips_hierarchie()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.validation_status is distinct from old.validation_status and new.validation_status in ('valide', 'refuse') then
    perform public.verifier_decision_hierarchie(old.user_id, true);
  end if;
  return new;
end;
$$;
revoke execute on function public.payslips_hierarchie() from public, anon, authenticated;

create or replace trigger payslips_hierarchie
  before update on public.payslips
  for each row execute function public.payslips_hierarchie();

-- 6. Amendes : désigner le responsable, régler / contester / classer ---------
create or replace function public.fines_hierarchie()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.driver_id is distinct from old.driver_id and new.driver_id is not null then
    perform public.verifier_decision_hierarchie(new.driver_id);
  elsif new.status is distinct from old.status and old.driver_id is not null then
    perform public.verifier_decision_hierarchie(old.driver_id);
  end if;
  return new;
end;
$$;
revoke execute on function public.fines_hierarchie() from public, anon, authenticated;

create or replace trigger fines_hierarchie
  before update on public.fines
  for each row execute function public.fines_hierarchie();

-- 7. Contestations : désigner le responsable, clôturer ------------------------
--    (la réponse du chauffeur passe par la clé service : non concernée).
create or replace function public.customer_disputes_hierarchie()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.driver_id is distinct from old.driver_id and new.driver_id is not null then
    perform public.verifier_decision_hierarchie(new.driver_id);
  elsif new.status is distinct from old.status and new.status in ('resolved', 'rejected') and old.driver_id is not null then
    perform public.verifier_decision_hierarchie(old.driver_id);
  end if;
  return new;
end;
$$;
revoke execute on function public.customer_disputes_hierarchie() from public, anon, authenticated;

create or replace trigger customer_disputes_hierarchie
  before update on public.customer_disputes
  for each row execute function public.customer_disputes_hierarchie();

-- 8. Demandes d'entretien : planifier, démarrer, clore, annuler ----------------
create or replace function public.vehicle_interventions_hierarchie()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.requested_by is not null
     and (new.status is distinct from old.status
          or new.scheduled_at is distinct from old.scheduled_at
          or new.completed_at is distinct from old.completed_at) then
    perform public.verifier_decision_hierarchie(old.requested_by);
  end if;
  return new;
end;
$$;
revoke execute on function public.vehicle_interventions_hierarchie() from public, anon, authenticated;

create or replace trigger vehicle_interventions_hierarchie
  before update on public.vehicle_interventions
  for each row execute function public.vehicle_interventions_hierarchie();

-- 9. Demandes au loueur : valider, refuser, clore (demandeur = auteur de l'entretien)
create or replace function public.rental_maintenance_requests_hierarchie()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_demandeur uuid;
begin
  if new.status is distinct from old.status and new.status in ('validee', 'refusee', 'terminee') then
    select i.requested_by into v_demandeur from public.vehicle_interventions i where i.id = old.intervention_id;
    perform public.verifier_decision_hierarchie(v_demandeur);
  end if;
  return new;
end;
$$;
revoke execute on function public.rental_maintenance_requests_hierarchie() from public, anon, authenticated;

create or replace trigger rental_maintenance_requests_hierarchie
  before update on public.rental_maintenance_requests
  for each row execute function public.rental_maintenance_requests_hierarchie();

-- 10. Demandes de rendez-vous ----------------------------------------------------
create or replace function public.meeting_requests_hierarchie()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status
     or new.handled_by is distinct from old.handled_by
     or new.scheduled_at is distinct from old.scheduled_at then
    perform public.verifier_decision_hierarchie(old.requested_by);
  end if;
  return new;
end;
$$;
revoke execute on function public.meeting_requests_hierarchie() from public, anon, authenticated;

create or replace trigger meeting_requests_hierarchie
  before update on public.meeting_requests
  for each row execute function public.meeting_requests_hierarchie();

-- 11. Demandes d'assistance --------------------------------------------------------
create or replace function public.support_requests_hierarchie()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status or new.response is distinct from old.response then
    perform public.verifier_decision_hierarchie(old.requested_by);
  end if;
  return new;
end;
$$;
revoke execute on function public.support_requests_hierarchie() from public, anon, authenticated;

create or replace trigger support_requests_hierarchie
  before update on public.support_requests
  for each row execute function public.support_requests_hierarchie();

-- 12. Convocations : on ne se convoque pas soi-même, ni un pair ou un supérieur --
create or replace function public.convocations_hierarchie()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.verifier_decision_hierarchie(new.employee_id);
  elsif new.status is distinct from old.status then
    perform public.verifier_decision_hierarchie(old.employee_id);
  end if;
  return new;
end;
$$;
revoke execute on function public.convocations_hierarchie() from public, anon, authenticated;

create or replace trigger convocations_hierarchie
  before insert or update on public.convocations
  for each row execute function public.convocations_hierarchie();

-- 13. Écarts carburant : traiter / demander une explication -------------------------
--     (la réponse du chauffeur n'est pas une décision).
create or replace function public.fuel_gap_reviews_hierarchie()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conducteur uuid;
begin
  if new.action in ('traite', 'explication_demandee') then
    select fe.driver_id into v_conducteur from public.fuel_entries fe where fe.id = new.fuel_entry_id;
    perform public.verifier_decision_hierarchie(v_conducteur);
  end if;
  return new;
end;
$$;
revoke execute on function public.fuel_gap_reviews_hierarchie() from public, anon, authenticated;

create or replace trigger fuel_gap_reviews_hierarchie
  before insert on public.fuel_gap_reviews
  for each row execute function public.fuel_gap_reviews_hierarchie();

-- 14. Alertes de création : le niveau juste au-dessus du demandeur ---------------------
--     (plus de diffusion à tous les managers, demandeur et pairs compris).
--     Mêmes fonctions que 20260101000025 / 48 / 55 et 20261024000002, avec
--     public.destinataires_hierarchie() à la place des rôles diffusés.

create or replace function public.after_vehicle_intervention_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  vehicle_registration text;
  computed_severity alert_severity;
begin
  select registration into vehicle_registration from vehicles where id = new.vehicle_id;

  computed_severity := case new.urgency
    when 'critical' then 'critical'
    when 'high' then 'warning'
    else 'info'
  end;

  if new.requested_by is null then
    insert into alerts (organization_id, type, severity, message, related_table, related_id, recipient_roles)
    values (
      new.organization_id,
      'maintenance_request',
      computed_severity,
      format('Nouvelle demande d''entretien (%s) pour %s — %s', new.urgency, coalesce(vehicle_registration, 'véhicule'), new.type),
      'vehicle_interventions',
      new.id,
      array['manager', 'manager_chauffeur', 'direction']::user_role[]
    );
  else
    insert into alerts (organization_id, type, severity, message, related_table, related_id, recipient_user_id)
    select
      new.organization_id,
      'maintenance_request',
      computed_severity,
      format('Nouvelle demande d''entretien (%s) pour %s — %s', new.urgency, coalesce(vehicle_registration, 'véhicule'), new.type),
      'vehicle_interventions',
      new.id,
      d
    from public.destinataires_hierarchie(new.requested_by) d;
  end if;

  return new;
end;
$$;
revoke execute on function public.after_vehicle_intervention_insert() from public, anon, authenticated;

create or replace function public.after_meeting_request_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requester_name text;
begin
  select full_name into requester_name from users where id = new.requested_by;

  insert into alerts (organization_id, type, severity, message, related_table, related_id, recipient_user_id)
  select
    new.organization_id,
    'meeting_request',
    'info',
    format('%s a demandé un rendez-vous.', coalesce(requester_name, 'Un salarié')),
    'meeting_requests',
    new.id,
    d
  from public.destinataires_hierarchie(new.requested_by) d;

  return new;
end;
$$;
revoke execute on function public.after_meeting_request_insert() from public, anon, authenticated;

create or replace function public.after_support_request_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.recipient = 'gestionnaire' then
    insert into alerts (organization_id, type, severity, message, related_table, related_id, recipient_user_id)
    select
      new.organization_id,
      'support_request',
      'info',
      format('Nouvelle demande d''assistance : %s', left(new.question, 140)),
      'support_requests',
      new.id,
      d
    from public.destinataires_hierarchie(new.requested_by) d;
  end if;
  return new;
end;
$$;
revoke execute on function public.after_support_request_insert() from public, anon, authenticated;

-- Acompte : la direction (hors demandeur) et le comptable (sauf s'il est le demandeur).
create or replace function public.salary_advance_requests_alerte()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.alerts (organization_id, type, severity, message, related_table, related_id, recipient_user_id)
    select
      new.organization_id, 'salary_advance', 'info',
      'Nouvelle demande d''acompte à examiner (' || to_char(new.period, 'MM/YYYY') || ').',
      'salary_advance_requests', new.id, u.id
    from public.users u
    where u.organization_id = new.organization_id
      and u.active
      and u.id <> new.user_id
      and u.role::text in ('direction', 'comptable')
      and not (
        u.role::text = 'comptable'
        and (select r.role::text from public.users r where r.id = new.user_id) = 'comptable'
      );
    return null;
  end if;

  if new.status is distinct from old.status and old.status = 'en_attente' then
    update public.alerts
       set status = 'resolved'
     where organization_id = new.organization_id
       and type = 'salary_advance'
       and related_id = new.id
       and status = 'open';
    if new.status in ('acceptee', 'refusee') and new.decided_by is distinct from new.user_id then
      insert into public.alerts (organization_id, type, severity, message, related_table, related_id, recipient_user_id)
      values (
        new.organization_id, 'salary_advance', 'info',
        case when new.status = 'acceptee'
          then 'Votre demande d''acompte de ' || to_char(new.period, 'MM/YYYY') || ' est acceptée.'
          else 'Votre demande d''acompte de ' || to_char(new.period, 'MM/YYYY') || ' est refusée.'
        end,
        'salary_advance_requests', new.id, new.user_id
      );
    end if;
  end if;
  return null;
end;
$function$;
revoke execute on function public.salary_advance_requests_alerte() from public, anon, authenticated;
