-- Réorganisation, décision client Q1 (révisée le 19/10/2026) :
-- le comptable prépare et génère les bulletins, rien ne prend effet sans
-- la validation de la direction. Règle appliquée EN BASE (RLS + triggers),
-- pas seulement à l'écran.
--
-- À appliquer APRÈS 20261020000002 (valeur d'enum payslip_validation).
-- Migration ADDITIVE : colonnes ajoutées, policies modifiées par
-- ALTER POLICY, policies de lecture créées si absentes, triggers créés
-- (aucun trigger n'existait sur public.payslips, vérifié le 19/10/2026).

-- 1. Statut de validation -------------------------------------------------
--    en_attente : généré (ou régénéré), en attente de la direction
--    valide     : validé par un compte direction (qui, quand)
--    refuse     : refusé par la direction, avec commentaire ; renvoyé au
--                 comptable pour correction
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'payslips' and column_name = 'validation_status'
  ) then
    alter table public.payslips
      add column validation_status text not null default 'en_attente'
        constraint payslips_validation_status_check check (validation_status in ('en_attente', 'valide', 'refuse')),
      add column validated_by uuid references public.users (id) on delete set null,
      add column validated_at timestamptz,
      add column validation_comment text;

    -- Bulletins existants générés par la direction (ou sans auteur
    -- connu, antérieurs au suivi) : validés par défaut. Exécuté une seule
    -- fois, à l'ajout de la colonne, avant la création des triggers.
    update public.payslips p
       set validation_status = 'valide',
           validated_by = p.generated_by,
           validated_at = p.generated_at
     where p.generated_by is null
        or exists (select 1 from public.users u where u.id = p.generated_by and u.role = 'direction');
  end if;
end
$$;

create index if not exists payslips_validation_pending_idx
  on public.payslips (organization_id, period_start)
  where validation_status = 'en_attente';

-- 2. Garde : naissance « en attente », validation par la direction seule,
--    régénération = retour « en attente », pas d'envoi sans validation.
create or replace function public.payslips_guard_validation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_client boolean := coalesce(auth.role(), '') in ('anon', 'authenticated');
  v_direction boolean := v_client and public.is_direction();
begin
  if tg_op = 'INSERT' then
    -- Tout bulletin naît en attente, quel que soit son auteur.
    new.validation_status := 'en_attente';
    new.validated_by := null;
    new.validated_at := null;
    new.validation_comment := null;
  elsif row(new.user_id, new.period_start, new.period_end, new.gross_amount, new.net_amount, new.net_taxable,
            new.pas_amount, new.employer_cost, new.overtime_exempt, new.bonus_amount, new.meal_vouchers_amount,
            new.file_path, new.details, new.variables, new.generated_at)
        is distinct from
        row(old.user_id, old.period_start, old.period_end, old.gross_amount, old.net_amount, old.net_taxable,
            old.pas_amount, old.employer_cost, old.overtime_exempt, old.bonus_amount, old.meal_vouchers_amount,
            old.file_path, old.details, old.variables, old.generated_at) then
    -- Régénération ou correction du contenu : la validation précédente
    -- ne vaut plus. Le bulletin repasse en attente et n'est plus « envoyé ».
    new.validation_status := 'en_attente';
    new.validated_by := null;
    new.validated_at := null;
    new.validation_comment := null;
    if new.status = 'sent' then
      new.status := 'generated';
    end if;
  elsif new.validation_status is distinct from old.validation_status then
    if v_client and not v_direction then
      raise exception 'Seule la direction peut valider ou refuser un bulletin de paie.' using errcode = '42501';
    end if;
    if new.validation_status = 'refuse' and coalesce(btrim(new.validation_comment), '') = '' then
      raise exception 'Un refus de bulletin doit être motivé par un commentaire.' using errcode = '23514';
    end if;
    if new.validation_status = 'en_attente' then
      new.validated_by := null;
      new.validated_at := null;
    else
      new.validated_by := coalesce(public.current_app_user_id(), new.validated_by);
      new.validated_at := now();
    end if;
  else
    -- Statut inchangé : qui et quand ne se falsifient pas ; le commentaire
    -- de la direction ne se modifie que par la direction.
    new.validated_by := old.validated_by;
    new.validated_at := old.validated_at;
    if v_client and not v_direction then
      new.validation_comment := old.validation_comment;
    end if;
  end if;

  if new.status = 'sent' and new.validation_status <> 'valide' then
    raise exception 'Un bulletin non validé par la direction ne peut pas être envoyé.' using errcode = '23514';
  end if;
  return new;
end;
$function$;

create trigger payslips_guard_validation
  before insert or update on public.payslips
  for each row execute function public.payslips_guard_validation();

-- 3. Alerte à la direction quand des bulletins attendent sa validation
--    (une alerte ouverte par organisation et par mois, résolue d'elle-même
--    quand plus aucun bulletin du mois n'attend). Les bulletins générés
--    par la direction ne déclenchent pas d'alerte : l'application les
--    valide dans la foulée.
create or replace function public.payslips_alerte_validation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_mois text := to_char(new.period_start, 'MM/YYYY');
  v_message text := 'Bulletins de paie de ' || to_char(new.period_start, 'MM/YYYY') || ' en attente de votre validation.';
begin
  if new.validation_status = 'en_attente'
     and (tg_op = 'INSERT' or old.validation_status is distinct from 'en_attente')
     and not exists (select 1 from public.users u where u.id = new.generated_by and u.role = 'direction')
     and not exists (
       select 1 from public.alerts a
       where a.organization_id = new.organization_id
         and a.type = 'payslip_validation'
         and a.status = 'open'
         and a.message = v_message
     ) then
    insert into public.alerts (organization_id, type, severity, message, related_table, related_id, recipient_roles)
    values (new.organization_id, 'payslip_validation', 'warning', v_message, 'payslips', new.id, array['direction']::public.user_role[]);
  end if;

  if tg_op = 'UPDATE'
     and new.validation_status <> 'en_attente'
     and not exists (
       select 1 from public.payslips p
       where p.organization_id = new.organization_id
         and p.period_start = new.period_start
         and p.validation_status = 'en_attente'
     ) then
    update public.alerts
       set status = 'resolved'
     where organization_id = new.organization_id
       and type = 'payslip_validation'
       and status = 'open'
       and message = 'Bulletins de paie de ' || v_mois || ' en attente de votre validation.';
  end if;
  return null;
end;
$function$;

create trigger payslips_alerte_validation
  after insert or update on public.payslips
  for each row execute function public.payslips_alerte_validation();

-- 4. RLS des bulletins ----------------------------------------------------
--    Lecture : direction et comptable (toute l'organisation) ; le salarié
--    ne lit que SES bulletins VALIDÉS.
alter policy "payslips: own record or direction" on public.payslips
  using (
    organization_id = public.current_organization_id()
    and (
      public.is_direction()
      or public.current_role() = 'comptable'
      or (user_id = public.current_app_user_id() and validation_status = 'valide')
    )
  );

--    Génération (insertion) et régénération (mise à jour) : direction et
--    comptable. Le trigger ci-dessus empêche le comptable de valider.
alter policy "payslips: direction manages" on public.payslips
  with check (
    organization_id = public.current_organization_id()
    and (public.is_direction() or public.current_role() = 'comptable')
  );

alter policy "payslips: direction updates" on public.payslips
  using (
    organization_id = public.current_organization_id()
    and (public.is_direction() or public.current_role() = 'comptable')
  )
  with check (
    organization_id = public.current_organization_id()
    and (public.is_direction() or public.current_role() = 'comptable')
  );

-- 5. PDF (Storage, bucket payslips) ---------------------------------------
--    Le salarié ne télécharge que le PDF d'un bulletin validé qui est le
--    sien ; direction et comptable lisent et écrivent les PDF de
--    l'organisation.
alter policy "payslips-storage: own payslip or direction" on storage.objects
  using (
    bucket_id = 'payslips'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
    and (
      public.is_direction()
      or public.current_role() = 'comptable'
      or (
        (storage.foldername(name))[2] = public.current_app_user_id()::text
        and exists (
          select 1 from public.payslips p
          where p.file_path = objects.name
            and p.user_id = public.current_app_user_id()
            and p.validation_status = 'valide'
        )
      )
    )
  );

alter policy "payslips-storage: direction writes" on storage.objects
  using (
    bucket_id = 'payslips'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
    and (public.is_direction() or public.current_role() = 'comptable')
  )
  with check (
    bucket_id = 'payslips'
    and (storage.foldername(name))[1] = public.current_organization_id()::text
    and (public.is_direction() or public.current_role() = 'comptable')
  );

-- 6. Le comptable lit toute la paie (profils, réglages, contrats, dossiers,
--    absences) pour préparer les bulletins. Écritures inchangées
--    (direction). Policies créées seulement si absentes.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payroll_profiles' and policyname = 'payroll_profiles: comptable reads') then
    create policy "payroll_profiles: comptable reads" on public.payroll_profiles
      for select using (organization_id = public.current_organization_id() and public.current_role() = 'comptable');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payroll_settings' and policyname = 'payroll_settings: comptable reads') then
    create policy "payroll_settings: comptable reads" on public.payroll_settings
      for select using (organization_id = public.current_organization_id() and public.current_role() = 'comptable');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_contracts' and policyname = 'user_contracts: comptable reads') then
    create policy "user_contracts: comptable reads" on public.user_contracts
      for select using (
        public.current_role() = 'comptable'
        and exists (
          select 1 from public.users u
          where u.id = user_contracts.user_id and u.organization_id = public.current_organization_id()
        )
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'employee_files' and policyname = 'employee_files: comptable reads') then
    create policy "employee_files: comptable reads" on public.employee_files
      for select using (organization_id = public.current_organization_id() and public.current_role() = 'comptable');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'leave_requests' and policyname = 'leave: comptable reads') then
    create policy "leave: comptable reads" on public.leave_requests
      for select using (organization_id = public.current_organization_id() and public.current_role() = 'comptable');
  end if;
end
$$;
