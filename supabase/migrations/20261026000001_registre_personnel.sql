-- Registre unique du personnel (art. L1221-13 et D1221-23 du code du
-- travail) et remise électronique des bulletins (art. L3243-2).
--
-- Migration ADDITIVE : colonnes nullables, nouvelles tables, nouvelles
-- valeurs d'énumération. Aucune suppression, aucune policy existante
-- modifiée. Le code lit ces colonnes de façon tolérante (select("*"),
-- erreurs ignorées) : il fonctionne avant comme après son application.
--
-- Déjà présents : users.full_name, users.role_title (emploi),
-- users.active ; employee_files.contract_type, hire_date,
-- contract_end_date, hr_status, birth_date, matricule,
-- social_security_number, classification (qualification) ;
-- payroll_profiles.coefficient, job_group, contractual_hours.

-- 1. Mentions du registre dans le dossier RH --------------------------------
-- employee_files garde sa RLS : lecture par le salarié (sa fiche), la
-- direction et le comptable (20261020000003) ; écriture direction.
alter table public.employee_files
  add column if not exists last_name text,
  add column if not exists first_names text,
  add column if not exists sex text,
  add column if not exists exit_date date,
  add column if not exists temp_agency text,
  -- Compte qui ne figure pas au registre (gérant mandataire non salarié,
  -- prestataire) : coché par la direction.
  add column if not exists register_excluded boolean;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'employee_files_sex_check') then
    alter table public.employee_files
      add constraint employee_files_sex_check check (sex is null or sex in ('F', 'M'));
  end if;
end
$$;

-- Contrats en alternance et stages (le registre les distingue).
alter type public.contract_type add value if not exists 'professionnalisation';
alter type public.contract_type add value if not exists 'stage';

-- 2. Données sensibles : nationalité et titre de travail --------------------
-- Table à part : le comptable lit employee_files, pas ces données.
-- Lecture : direction de l'organisation, et le salarié pour lui-même.
-- Écriture : direction seulement. Pas de policy DELETE (suppression avec
-- le compte, en cascade).
create table if not exists public.employee_register_private (
  user_id uuid primary key references public.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  nationality text,
  work_permit_type text,
  work_permit_number text,
  work_permit_expiry date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists employee_register_private_org_idx on public.employee_register_private (organization_id);

alter table public.employee_register_private enable row level security;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'employee_register_private_set_updated_at') then
    create trigger employee_register_private_set_updated_at
      before update on public.employee_register_private
      for each row execute function set_updated_at();
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'employee_register_private' and policyname = 'employee_register_private: own record or direction') then
    create policy "employee_register_private: own record or direction" on public.employee_register_private
      for select using (
        organization_id = public.current_organization_id()
        and (user_id = public.current_app_user_id() or public.is_direction())
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'employee_register_private' and policyname = 'employee_register_private: direction inserts') then
    create policy "employee_register_private: direction inserts" on public.employee_register_private
      for insert with check (organization_id = public.current_organization_id() and public.is_direction());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'employee_register_private' and policyname = 'employee_register_private: direction updates') then
    create policy "employee_register_private: direction updates" on public.employee_register_private
      for update using (organization_id = public.current_organization_id() and public.is_direction())
      with check (organization_id = public.current_organization_id() and public.is_direction());
  end if;
end
$$;

-- 3. Remise électronique des bulletins : opposition du salarié -------------
-- Sans ligne : remise électronique (par défaut). Le salarié enregistre
-- lui-même son choix, daté ; direction et comptable le lisent
-- (« bulletin papier demandé »).
create table if not exists public.payslip_delivery_preferences (
  user_id uuid primary key references public.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  paper_requested boolean not null default false,
  decided_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payslip_delivery_preferences_org_idx on public.payslip_delivery_preferences (organization_id);

alter table public.payslip_delivery_preferences enable row level security;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'payslip_delivery_preferences_set_updated_at') then
    create trigger payslip_delivery_preferences_set_updated_at
      before update on public.payslip_delivery_preferences
      for each row execute function set_updated_at();
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payslip_delivery_preferences' and policyname = 'payslip_delivery_preferences: own or payroll reads') then
    create policy "payslip_delivery_preferences: own or payroll reads" on public.payslip_delivery_preferences
      for select using (
        organization_id = public.current_organization_id()
        and (user_id = public.current_app_user_id() or public.current_role() in ('direction', 'comptable'))
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payslip_delivery_preferences' and policyname = 'payslip_delivery_preferences: own insert') then
    create policy "payslip_delivery_preferences: own insert" on public.payslip_delivery_preferences
      for insert with check (organization_id = public.current_organization_id() and user_id = public.current_app_user_id());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payslip_delivery_preferences' and policyname = 'payslip_delivery_preferences: own update') then
    create policy "payslip_delivery_preferences: own update" on public.payslip_delivery_preferences
      for update using (organization_id = public.current_organization_id() and user_id = public.current_app_user_id())
      with check (organization_id = public.current_organization_id() and user_id = public.current_app_user_id());
  end if;
end
$$;
