-- Demandes d'acompte sur salaire, reliées au bulletin de paie.
--
-- Le salarié (tout rôle) demande un montant pour le mois en cours depuis
-- « Mon espace » ; la direction accepte (montant modifiable, date de
-- versement) ou refuse (motif) ; le comptable peut préparer (montant,
-- date) et marquer versé, mais ne décide pas — même règle que la
-- validation des bulletins (20261020000003). L'acompte accepté est déduit
-- automatiquement du bulletin du mois (lib/paie/acomptes.ts) ; la demande
-- garde la référence du bulletin (payslip_id). Un bulletin déjà validé
-- n'est jamais complété : l'acompte passe au mois suivant.
--
-- Migration ADDITIVE : type d'alerte, table, colonnes de réglage,
-- policies et triggers créés seulement s'ils sont absents. Aucun
-- drop, aucune suppression de données. L'application tolère l'absence
-- de la table tant que la migration n'est pas passée.

-- 0. Type d'alerte. La valeur n'est utilisée que dans des corps de
--    fonction (évalués à l'exécution, après validation de la migration),
--    jamais dans cette transaction.
alter type public.alert_type add value if not exists 'salary_advance';

-- 1. Plafond indicatif, réglé par l'organisation ---------------------------
--    advance_cap_amount renseigné : plafond fixe en euros ;
--    sinon advance_cap_percent (50 % par défaut) du net habituel
--    (net avant retenues du dernier bulletin validé).
alter table public.payroll_settings
  add column if not exists advance_cap_percent numeric(5, 2) not null default 50
    constraint payroll_settings_advance_cap_percent_check check (advance_cap_percent >= 0 and advance_cap_percent <= 100),
  add column if not exists advance_cap_amount numeric(10, 2)
    constraint payroll_settings_advance_cap_amount_check check (advance_cap_amount is null or advance_cap_amount >= 0);

-- 2. Table ---------------------------------------------------------------
create table if not exists public.salary_advance_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  -- Mois de déduction : premier jour du mois.
  period date not null constraint salary_advance_requests_period_check check (extract(day from period) = 1),
  amount_requested numeric(10, 2) not null
    constraint salary_advance_requests_amount_requested_check check (amount_requested > 0 and amount_requested <= 100000),
  amount_granted numeric(10, 2)
    constraint salary_advance_requests_amount_granted_check check (amount_granted is null or (amount_granted > 0 and amount_granted <= 100000)),
  reason text constraint salary_advance_requests_reason_check check (reason is null or char_length(reason) <= 500),
  -- en_attente → acceptee → versee ; en_attente → refusee | annulee ;
  -- acceptee → annulee (direction).
  status text not null default 'en_attente'
    constraint salary_advance_requests_status_check check (status in ('en_attente', 'acceptee', 'refusee', 'versee', 'annulee')),
  decided_by uuid references public.users (id) on delete set null,
  decided_at timestamptz,
  decision_comment text constraint salary_advance_requests_comment_check check (decision_comment is null or char_length(decision_comment) <= 2000),
  -- Date de versement (prévue à l'acceptation, effective une fois « versée »).
  paid_at date,
  -- Bulletin sur lequel l'acompte est déduit.
  payslip_id uuid references public.payslips (id) on delete set null,
  -- Mois d'origine quand l'acompte a été reporté (bulletin déjà validé).
  original_period date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists salary_advance_requests_user_period_idx
  on public.salary_advance_requests (user_id, period);
create index if not exists salary_advance_requests_org_pending_idx
  on public.salary_advance_requests (organization_id, created_at)
  where status = 'en_attente';
create index if not exists salary_advance_requests_payslip_idx
  on public.salary_advance_requests (payslip_id)
  where payslip_id is not null;

alter table public.salary_advance_requests enable row level security;

-- 3. RLS -----------------------------------------------------------------
--    Lecture : le salarié ses demandes ; direction et comptable toute
--    l'organisation. Création : le salarié, pour lui-même. Mise à jour :
--    l'auteur (annulation), la direction et le comptable ; le trigger
--    ci-dessous borne ce que chacun peut changer. Pas de suppression.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'salary_advance_requests' and policyname = 'salary_advance_requests: read own or paie') then
    create policy "salary_advance_requests: read own or paie" on public.salary_advance_requests
      for select using (
        organization_id = public.current_organization_id()
        and (
          user_id = public.current_app_user_id()
          or public.is_direction()
          or public.current_role() = 'comptable'
        )
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'salary_advance_requests' and policyname = 'salary_advance_requests: own insert') then
    create policy "salary_advance_requests: own insert" on public.salary_advance_requests
      for insert with check (
        organization_id = public.current_organization_id()
        and user_id = public.current_app_user_id()
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'salary_advance_requests' and policyname = 'salary_advance_requests: author or paie updates') then
    create policy "salary_advance_requests: author or paie updates" on public.salary_advance_requests
      for update using (
        organization_id = public.current_organization_id()
        and (
          user_id = public.current_app_user_id()
          or public.is_direction()
          or public.current_role() = 'comptable'
        )
      )
      with check (
        organization_id = public.current_organization_id()
        and (
          user_id = public.current_app_user_id()
          or public.is_direction()
          or public.current_role() = 'comptable'
        )
      );
  end if;
end
$$;

-- 4. Garde (clients anon / authenticated ; le service serveur passe) ------
create or replace function public.salary_advance_requests_guard_author()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_client boolean := coalesce(auth.role(), '') in ('anon', 'authenticated');
  v_direction boolean := v_client and public.is_direction();
  v_comptable boolean := v_client and not public.is_direction() and public.current_role() = 'comptable';
  v_moi uuid := case when v_client then public.current_app_user_id() else null end;
begin
  if not v_client then
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Toute demande naît en attente, pour son auteur, sans décision.
    if new.user_id is distinct from v_moi then
      raise exception 'Une demande d''acompte se fait pour soi-même.' using errcode = '42501';
    end if;
    new.status := 'en_attente';
    new.amount_granted := null;
    new.decided_by := null;
    new.decided_at := null;
    new.decision_comment := null;
    new.paid_at := null;
    new.payslip_id := null;
    new.original_period := null;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  -- Jamais modifiables après création.
  if row(new.id, new.organization_id, new.user_id, new.amount_requested, new.reason, new.created_at)
     is distinct from row(old.id, old.organization_id, old.user_id, old.amount_requested, old.reason, old.created_at) then
    raise exception 'La demande d''acompte elle-même ne se modifie pas.' using errcode = '42501';
  end if;

  if not v_direction and not v_comptable then
    -- Le salarié : seulement annuler sa demande en attente.
    if new.user_id is distinct from v_moi
       or old.status <> 'en_attente'
       or new.status <> 'annulee'
       or row(new.period, new.amount_granted, new.decided_by, new.decided_at, new.decision_comment, new.paid_at, new.payslip_id, new.original_period)
          is distinct from row(old.period, old.amount_granted, old.decided_by, old.decided_at, old.decision_comment, old.paid_at, old.payslip_id, old.original_period) then
      raise exception 'Seule l''annulation d''une demande en attente est possible.' using errcode = '42501';
    end if;
    new.updated_at := now();
    return new;
  end if;

  if v_comptable then
    -- Le comptable prépare et marque versé ; il ne décide pas.
    if new.status is distinct from old.status and not (old.status = 'acceptee' and new.status = 'versee') then
      raise exception 'Seule la direction accepte ou refuse une demande d''acompte.' using errcode = '42501';
    end if;
    if row(new.decided_by, new.decided_at, new.decision_comment, new.period, new.original_period)
       is distinct from row(old.decided_by, old.decided_at, old.decision_comment, old.period, old.original_period) then
      raise exception 'Seule la direction décide d''une demande d''acompte.' using errcode = '42501';
    end if;
    if new.amount_granted is distinct from old.amount_granted and old.status <> 'en_attente' then
      raise exception 'Le montant d''un acompte décidé ne se modifie plus.' using errcode = '42501';
    end if;
    new.updated_at := now();
    return new;
  end if;

  -- Direction.
  if new.status is distinct from old.status then
    if not (
      (old.status = 'en_attente' and new.status in ('acceptee', 'refusee', 'annulee'))
      or (old.status = 'acceptee' and new.status in ('versee', 'annulee'))
    ) then
      raise exception 'Changement de statut impossible (% → %).', old.status, new.status using errcode = '23514';
    end if;
    if new.status = 'refusee' and coalesce(btrim(new.decision_comment), '') = '' then
      raise exception 'Un refus d''acompte doit être motivé.' using errcode = '23514';
    end if;
    if new.status = 'acceptee' then
      new.amount_granted := coalesce(new.amount_granted, old.amount_requested);
    end if;
    if new.status = 'annulee' and old.payslip_id is not null then
      raise exception 'Cet acompte est déjà déduit d''un bulletin : il ne s''annule plus.' using errcode = '23514';
    end if;
    if new.status in ('acceptee', 'refusee', 'annulee') then
      new.decided_by := v_moi;
      new.decided_at := now();
    else
      new.decided_by := old.decided_by;
      new.decided_at := old.decided_at;
    end if;
  else
    new.decided_by := old.decided_by;
    new.decided_at := old.decided_at;
  end if;
  if new.amount_granted is distinct from old.amount_granted and old.payslip_id is not null then
    raise exception 'Cet acompte est déjà déduit d''un bulletin : son montant ne se modifie plus.' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'salary_advance_requests_guard_author' and tgrelid = 'public.salary_advance_requests'::regclass) then
    create trigger salary_advance_requests_guard_author
      before insert or update on public.salary_advance_requests
      for each row execute function public.salary_advance_requests_guard_author();
  end if;
end
$$;

-- 5. Alertes ---------------------------------------------------------------
--    Nouvelle demande → direction et comptable (sans nom ni montant dans
--    le message : il s'affiche aussi dans le centre d'alertes) ; décision
--    → le salarié (alerte personnelle). L'alerte « nouvelle demande » se
--    résout dès que la demande n'est plus en attente.
create or replace function public.salary_advance_requests_alerte()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.alerts (organization_id, type, severity, message, related_table, related_id, recipient_roles)
    values (
      new.organization_id, 'salary_advance', 'info',
      'Nouvelle demande d''acompte à examiner (' || to_char(new.period, 'MM/YYYY') || ').',
      'salary_advance_requests', new.id,
      array['direction', 'comptable']::public.user_role[]
    );
    return null;
  end if;

  if new.status is distinct from old.status and old.status = 'en_attente' then
    update public.alerts
       set status = 'resolved'
     where organization_id = new.organization_id
       and type = 'salary_advance'
       and related_id = new.id
       and recipient_user_id is null
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

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'salary_advance_requests_alerte' and tgrelid = 'public.salary_advance_requests'::regclass) then
    create trigger salary_advance_requests_alerte
      after insert or update on public.salary_advance_requests
      for each row execute function public.salary_advance_requests_alerte();
  end if;
end
$$;
